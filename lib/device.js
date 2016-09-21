'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _semverCompare = require('semver-compare');

var _semverCompare2 = _interopRequireDefault(_semverCompare);

var _events = require('./events');

var _flowEvents = require('./flow-events');

var _session = require('./session');

var _session2 = _interopRequireDefault(_session);

var _connectionLock = require('./utils/connectionLock');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// a slight hack
// this error string is hard-coded
// in both bridge and extension
const WRONG_PREVIOUS_SESSION_ERROR_MESSAGE = 'wrong previous session';

class Device extends _events.EventEmitter {
    // in miliseconds
    constructor(transport, descriptor, features, deviceList) {
        super();

        // === immutable properties
        this.activityInProgress = false;
        this.connected = true;
        this.clearSession = false;
        this.clearSessionTime = 15 * 60 * 1000;
        this.clearSessionTimeout = null;
        this.clearSessionFuture = 0;
        this.rememberPlaintextPassphrase = false;
        this.rememberedPlaintextPasshprase = null;
        this.disconnectEvent = new _flowEvents.Event0('disconnect', this);
        this.buttonEvent = new _flowEvents.Event1('button', this);
        this.errorEvent = new _flowEvents.Event1('error', this);
        this.passphraseEvent = new _flowEvents.Event1('passphrase', this);
        this.wordEvent = new _flowEvents.Event1('word', this);
        this.changedSessionsEvent = new _flowEvents.Event2('changedSessions', this);
        this.pinEvent = new _flowEvents.Event2('pin', this);
        this.receiveEvent = new _flowEvents.Event2('receive', this);
        this.sendEvent = new _flowEvents.Event2('send', this);
        this._stolenEvent = new _flowEvents.Event0('stolen', this);
        this.transport = transport;
        this.originalDescriptor = descriptor;
        this.deviceList = deviceList;

        if (this.deviceList.options.clearSession) {
            this.clearSession = true;
            if (this.deviceList.options.clearSessionTime) {
                this.clearSessionTime = this.deviceList.options.clearSessionTime;
            }
        }
        if (this.deviceList.options.rememberDevicePassphrase) {
            this.rememberPlaintextPassphrase = true;
        }

        // === mutable properties
        // features get reloaded after every initialization
        this.features = features;
        this.connected = true;

        this._watch();
    }

    // Initializes device with the given descriptor,
    // runs a given function and then releases the session.
    // Return promise with the result of the function.
    // First parameter is a function that has two parameters
    // - first the session and second the fresh device features.
    // Note - when descriptor.path != null, this will steal the device from someone else
    static _run(fn, transport, descriptor, deviceList, onAcquire, onRelease) {
        return Device._acquire(transport, descriptor, deviceList, onAcquire).then(session => {
            return promiseFinally(session.initialize().then(res => {
                return fn(session, res.message);
            }), () => Device._release(descriptor, session, deviceList, onRelease));
        });
    }

    // Release and acquire are quite complex,
    // because we have to deal with various race conditions
    // for multitasking
    static _release(originalDescriptor, session, deviceList, onRelease) {
        const released = (0, _connectionLock.lock)(() => session.release());
        return promiseFinally(released, (res, error) => {
            if (error == null) {
                deviceList.setHard(originalDescriptor.path, null);
            }
            if (onRelease != null) {
                return onRelease(error);
            }
            return Promise.resolve();
        });
    }

    static _acquire(transport, descriptor, deviceList, onAcquire) {
        return (0, _connectionLock.lock)(() => transport.acquire({
            path: descriptor.path,
            previous: descriptor.session,
            checkPrevious: true
        })).then(result => {
            deviceList.setHard(descriptor.path, result);
            const session = new _session2.default(transport, result, descriptor, !!deviceList.options.debug);
            if (onAcquire != null) {
                onAcquire(session);
            }
            return session;
        });
    }

    waitForSessionAndRun(fn, options) {
        const options_ = options == null ? {} : options;
        return this.run(fn, _extends({}, options_, { waiting: true }));
    }

    runAggressive(fn, options) {
        const options_ = options == null ? {} : options;
        return this.run(fn, _extends({}, options_, { aggressive: true }));
    }

    // Initializes device with the given descriptor,
    // runs a given function and then releases the session.
    // Return promise with the result of the function.
    // First parameter is a function that has session as a parameter
    run(fn, options) {
        if (!this.connected) {
            return Promise.reject(new Error('Device disconnected.'));
        }
        const options_ = options == null ? {} : options;
        const aggressive = !!options_.aggressive;
        const skipFinalReload = !!options_.skipFinalReload;
        const waiting = !!options_.waiting;

        const onlyOneActivity = !!options_.onlyOneActivity;
        if (onlyOneActivity && this.activityInProgress) {
            return Promise.reject(new Error('One activity already running.'));
        }

        this.activityInProgress = true;
        this._stopClearSessionTimeout();

        const currentSession = this.deviceList.getSession(this.originalDescriptor.path);
        if (!aggressive && !waiting && currentSession != null) {
            return Promise.reject(new Error('Unable to grab device when not aggressive'));
        }
        if (aggressive && waiting) {
            return Promise.reject(new Error('Combination of aggressive and waiting doesn\'t make sense.'));
        }

        let waitingPromise = Promise.resolve(currentSession);
        if (waiting && currentSession != null) {
            waitingPromise = this._waitForNullSession();
        }

        const runFinal = (res, error) => {
            if (!(error && error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE && waiting)) {
                if (this.clearSession) {
                    this._startClearSessionTimeout();
                }
            }
            return Promise.resolve();
        };

        return waitingPromise.then(resolvedSession => {
            const descriptor = _extends({}, this.originalDescriptor, { session: resolvedSession });

            // This is a bit overengineered, but I am not sure how to do it otherwise
            // I want the action to stop when the device is stolen,
            // but I don't want to add listener events that are never removed...
            // So I combine emitters and promises
            const e = new _events.EventEmitter();
            const stolenP = new Promise((resolve, reject) => {
                const onceStolen = () => {
                    e.removeAllListeners();
                    reject(new Error('The action was interrupted by another application.'));
                };
                this._stolenEvent.once(onceStolen);
                e.once('done', () => {
                    this._stolenEvent.removeListener(onceStolen);
                    resolve();
                });
            });

            const res = Device._run((session, features) => this._runInside(fn, session, features, skipFinalReload), this.transport, descriptor, this.deviceList, session => {
                this.currentSessionObject = session;
            }, error => {
                this.currentSessionObject = null;
                this.activityInProgress = false;
                if (error != null && this.connected) {
                    return new Promise((resolve, reject) => {
                        let onDisconnect = () => {};
                        const onChanged = () => {
                            if (this.isStolen()) {
                                this._stolenEvent.emit();
                            }
                            this.disconnectEvent.removeListener(onDisconnect);
                            resolve();
                        };
                        onDisconnect = () => {
                            this.changedSessionsEvent.removeListener(onChanged);
                            resolve();
                        };
                        this.changedSessionsEvent.once(onChanged);
                        this.disconnectEvent.once(onDisconnect);
                    });
                } else {
                    return Promise.resolve();
                }
            });

            return promiseFinally(Promise.all([promiseFinally(res, (ok, err) => {
                e.emit('done');
                return Promise.resolve();
            }), stolenP]).then(() => res), (res, error) => runFinal(res, error)).catch(error => {
                if (!this.connected) {
                    throw new Error('Device was disconnected during action.');
                }
                if (error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE && waiting) {
                    // trying again!!!
                    return this.run(fn, options);
                } else {
                    throw error;
                }
            });
        });
    }

    _reloadFeaturesOrInitialize(session) {
        let featuresPromise;
        if (this.atLeast('1.3.3')) {
            featuresPromise = session.getFeatures();
        } else {
            featuresPromise = session.initialize();
        }
        return featuresPromise.then(res => {
            this.features = res.message;
            return;
        });
    }

    _startClearSessionTimeout() {
        if (this.features.bootloader_mode) {
            return;
        }
        this.clearSessionTimeout = window.setTimeout(() => {
            const options = { onlyOneActivity: true };
            this.run(session => session.clearSession(), options);

            this.clearSessionTimeout = null;
        }, this.clearSessionTime);
        this.clearSessionFuture = Date.now() + this.clearSessionTime;
    }

    clearSessionRest() {
        if (this.clearSessionTimeout == null) {
            return 0;
        } else {
            return this.clearSessionFuture - Date.now();
        }
    }

    _stopClearSessionTimeout() {
        if (this.clearSessionTimeout != null) {
            window.clearTimeout(this.clearSessionTimeout);
            this.clearSessionTimeout = null;
        }
    }

    forwardPassphrase(source) {
        source.on(arg => {
            if (this.rememberedPlaintextPasshprase != null) {
                const p = this.rememberedPlaintextPasshprase;
                arg(null, p);
                return;
            }

            const argAndRemember = (e, passphrase) => {
                if (this.rememberPlaintextPassphrase) {
                    this.rememberedPlaintextPasshprase = passphrase;
                }
                arg(e, passphrase);
            };
            this.passphraseEvent.emit(argAndRemember);
        });
    }

    _runInside(fn, activeSession, features, skipFinalReload) {
        this.features = features;

        forward2(activeSession.sendEvent, this.sendEvent);
        forward2(activeSession.receiveEvent, this.receiveEvent);
        forwardError(activeSession.errorEvent, this.errorEvent);

        forward1(activeSession.buttonEvent, this.buttonEvent);
        forwardCallback2(activeSession.pinEvent, this.pinEvent);
        forwardCallback1(activeSession.wordEvent, this.wordEvent);
        this.forwardPassphrase(activeSession.passphraseEvent);

        const runFinal = () => {
            activeSession.deactivateEvents();

            if (skipFinalReload) {
                return Promise.resolve();
            } else {
                return this._reloadFeaturesOrInitialize(activeSession);
            }
        };

        return promiseFinally(Promise.resolve(fn(activeSession)), () => runFinal());
    }

    _waitForNullSession() {
        return new Promise((resolve, reject) => {
            let _onDisconnect = () => {};
            const onUpdate = () => {
                const updatedSession = this.deviceList.getSession(this.originalDescriptor.path);
                const device = this.deviceList.devices[this.originalDescriptor.path.toString()];
                if (updatedSession == null && device != null) {
                    this.deviceList.disconnectEvent.removeListener(_onDisconnect);
                    this.deviceList.updateEvent.removeListener(onUpdate);
                    resolve(updatedSession);
                }
            };
            _onDisconnect = device => {
                if (device === this) {
                    this.deviceList.disconnectEvent.removeListener(_onDisconnect);
                    this.deviceList.updateEvent.removeListener(onUpdate);
                    reject(new Error('Device disconnected'));
                }
            };
            onUpdate();
            this.deviceList.updateEvent.on(onUpdate);
            this.deviceList.onDisconnect(this, _onDisconnect);
        });
    }

    static fromDescriptor(transport, originalDescriptor, deviceList) {
        // at this point I am assuming nobody else has the device
        const descriptor = _extends({}, originalDescriptor, { session: null });
        return Device._run((session, features) => {
            return new Device(transport, descriptor, features, deviceList);
        }, transport, descriptor, deviceList);
    }

    reloadFeatures() {
        return this.run(() => {
            return true;
        });
    }

    // what steal() does is that it does not actually keep the session for itself
    // because it immediately releases it again;
    // however, it might stop some other process in another app,
    // so the device will become "usable"
    steal() {
        return this.run(() => {
            return true;
        }, { aggressive: true });
    }

    isBootloader() {
        return this.features.bootloader_mode;
    }

    isInitialized() {
        return this.features.initialized;
    }

    getVersion() {
        return [this.features.major_version, this.features.minor_version, this.features.patch_version].join('.');
    }

    atLeast(version) {
        return (0, _semverCompare2.default)(this.getVersion(), version) >= 0;
    }

    getCoin(name) {
        const coins = this.features.coins;

        for (let i = 0; i < coins.length; i++) {
            if (coins[i].coin_name === name) {
                return coins[i];
            }
        }
        throw new Error('Device does not support given coin type');
    }

    _watch() {
        const onChangedSessions = device => {
            if (device === this) {
                this.changedSessionsEvent.emit(this.isUsed(), this.isUsedHere());
                if (this.isStolen() && this.currentSessionObject != null) {
                    this._stolenEvent.emit();
                }
            }
        };
        const onDisconnect = device => {
            if (device === this) {
                this.disconnectEvent.emit();
                this.deviceList.disconnectEvent.removeListener(onDisconnect);
                this.deviceList.changedSessionsEvent.removeListener(onChangedSessions);
                this.connected = false;

                const events = [this.changedSessionsEvent, this.sendEvent, this.receiveEvent, this.errorEvent, this.buttonEvent, this.pinEvent, this.wordEvent];
                events.forEach(ev => ev.removeAllListeners());
            }
        };
        onChangedSessions(this);
        this.deviceList.changedSessionsEvent.on(onChangedSessions);
        this.deviceList.onDisconnect(this, onDisconnect);
    }

    isUsed() {
        const session = this.deviceList.getSession(this.originalDescriptor.path);
        return session != null;
    }

    isUsedHere() {
        const session = this.deviceList.getSession(this.originalDescriptor.path);
        const mySession = this.currentSessionObject != null ? this.currentSessionObject.getId() : null;
        return session != null && mySession === session;
    }

    isUsedElsewhere() {
        return this.isUsed() && !this.isUsedHere();
    }

    isStolen() {
        const shouldBeUsedHere = this.currentSessionObject != null;

        if (this.isUsed()) {
            if (shouldBeUsedHere) {
                // is used and should be used here => returns true if it's used elsewhere
                return this.isUsedElsewhere();
            } else {
                // is used and should not be used => returns true
                return true;
            }
        } else {
            if (shouldBeUsedHere) {
                // isn't used and should be used => stolen (??)
                return true;
            } else {
                // isn't used and shouldn't be used => nothing
                return false;
            }
        }
    }

    onbeforeunload() {
        const currentSession = this.currentSessionObject;
        if (currentSession != null) {
            // cannot run .then() in browser; so let's just fire and hope for the best
            if (this.clearSession) {
                currentSession.clearSession();
            }
            currentSession.release();
        }
    }
}

exports.default = Device; // Forwards events from source to target

function forwardError(source, target) {
    source.on(arg => {
        if (target.listenerCount() === 0) {
            return;
        }
        target.emit(arg);
    });
}

function forwardCallback1(source, target) {
    source.on(arg => {
        target.emit(arg);
    });
}

function forwardCallback2(source, target) {
    source.on((arg, arg2) => {
        target.emit(arg, arg2);
    });
}

function forward1(source, target) {
    source.on(arg => {
        target.emit(arg);
    });
}

function forward2(source, target) {
    source.on((arg1, arg2) => {
        target.emit(arg1, arg2);
    });
}

function promiseFinally(p, fun) {
    return p.then(res => fun(res, null).then(() => res), err => fun(null, err).then(() => {
        throw err;
    }, () => {
        throw err;
    }));
}
module.exports = exports['default'];