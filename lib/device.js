/* @flow */
'use strict';

import semvercmp from 'semver-compare';

import {EventEmitter} from './events';
import {Event0, Event1, Event2} from './flow-events';
import Session from './session';
import {lock} from './utils/connectionLock';

import type DeviceList from './device-list';
import type {Features} from './trezortypes';
import type {
    Transport,
    DeviceDescriptor,
} from './transport';

// a slight hack
// this error string is hard-coded
// in both bridge and extension
const WRONG_PREVIOUS_SESSION_ERROR_MESSAGE = 'wrong previous session';

export type RunOptions = {
    // aggressive - stealing even when someone else is running things
    aggressive?: boolean;
    // skipFinalReload - normally, after action, features are reloaded again
    //                   because some actions modify the features
    //                   but sometimes, you don't need that and can skip that
    skipFinalReload?: boolean;
    // waiting - if waiting and someone else holds the session, it waits until it's free
    //          and if it fails on acquire (because of more tabs acquiring simultaneously),
    //          it tries repeatedly
    waiting?: boolean;
    onlyOneActivity?: boolean;
}

export default class Device extends EventEmitter {
    transport: Transport;
    originalDescriptor: DeviceDescriptor;
    features: Features;
    deviceList: DeviceList;
    activityInProgress: boolean = false;
    currentSessionObject: ?Session;
    connected: boolean = true;

    clearSession: boolean = false;
    clearSessionTime: number = 15 * 60 * 1000; // in miliseconds
    clearSessionTimeout: ?number = null;
    clearSessionFuture: number = 0;

    rememberPlaintextPassphrase: boolean = false;
    rememberedPlaintextPasshprase: ?string = null;

    disconnectEvent: Event0 = new Event0('disconnect', this);
    buttonEvent: Event1<string> = new Event1('button', this);
    errorEvent: Event1<Error> = new Event1('error', this);
    passphraseEvent: Event1<(e: ?Error, passphrase?: ?string) => void> = new Event1('passphrase', this);
    wordEvent: Event1<(e: ?Error, word?: ?string) => void> = new Event1('word', this);
    changedSessionsEvent: Event2<boolean, boolean> = new Event2('changedSessions', this);
    pinEvent: Event2<string, (e: ?Error, pin?: ?string) => void> = new Event2('pin', this);
    receiveEvent: Event2<string, Object> = new Event2('receive', this);
    sendEvent: Event2<string, Object> = new Event2('send', this);
    _stolenEvent: Event0 = new Event0('stolen', this);

    constructor(transport: Transport, descriptor: DeviceDescriptor, features: Features, deviceList: DeviceList) {
        super();

        // === immutable properties
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
    static _run<X>(
        fn: (session: Session, features: Features) => (X|Promise<X>),
        transport: Transport,
        descriptor: DeviceDescriptor,
        deviceList: DeviceList,
        onAcquire?: ?((session: Session) => void),
        onRelease?: ?((error: ?Error) => Promise)
    ): Promise<X> {
        return Device._acquire(
            transport,
            descriptor,
            deviceList,
            onAcquire
        ).then((session: Session): Promise<X> => {
            return promiseFinally(
                session.initialize().then((res: {message: Features}): X | Promise<X> => {
                    return fn(session, res.message);
                }),
                () => Device._release(descriptor, session, deviceList, onRelease)
            );
        });
    }

    // Release and acquire are quite complex,
    // because we have to deal with various race conditions
    // for multitasking
    static _release(
        originalDescriptor: DeviceDescriptor,
        session: Session,
        deviceList: DeviceList,
        onRelease?: ?((error: ?Error) => Promise)
    ): Promise {
        const released = lock(() => session.release());
        return promiseFinally(
            released,
            (res, error) => {
                if (error == null) {
                    deviceList.setHard(originalDescriptor.path, null);
                }
                if (onRelease != null) {
                    return onRelease(error);
                }
                return Promise.resolve();
            }
        );
    }

    static _acquire(
        transport: Transport,
        descriptor: DeviceDescriptor,
        deviceList: DeviceList,
        onAcquire?: ?((session: Session) => void)
    ): Promise<Session> {
        return lock(() => transport.acquire(descriptor, true)).then(result => {
            if (result.session == null) {
                throw new Error('Session is null after acquire.');
            }
            deviceList.setHard(descriptor.path, result.session);
            const session = new Session(transport, result.session, descriptor);
            if (onAcquire != null) {
                onAcquire(session);
            }
            return session;
        });
    }

    waitForSessionAndRun<X>(fn: (session: Session) => (X|Promise<X>), options: ?RunOptions): Promise<X> {
        const options_: RunOptions = options == null ? {} : options;
        return this.run(fn, {...options_, waiting: true});
    }

    // Initializes device with the given descriptor,
    // runs a given function and then releases the session.
    // Return promise with the result of the function.
    // First parameter is a function that has session as a parameter
    run<X>(fn: (session: Session) => (X|Promise<X>), options: ?RunOptions): Promise<X> {
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
        if ((!aggressive) && (!waiting) && (currentSession != null)) {
            return Promise.reject(new Error('Not stealing when not aggressive'));
        }
        if (aggressive && waiting) {
            return Promise.reject(new Error('Combination of aggressive and waiting doesn\'t make sense.'));
        }

        let waitingPromise: Promise<?(number|string)> = Promise.resolve(currentSession);
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

        return waitingPromise.then((resolvedSession: ?(number|string)) => {
            const descriptor = { ...this.originalDescriptor, session: resolvedSession };

            // This is a bit overengineered, but I am not sure how to do it otherwise
            // I want the action to stop when the device is stolen,
            // but I don't want to add listener events that are never removed...
            // So I combine emitters and promises
            const e = new EventEmitter();
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

            const res = Device._run(
                (session, features) => this._runInside(fn, session, features, skipFinalReload),
                this.transport,
                descriptor,
                this.deviceList,
                (session) => {
                    this.currentSessionObject = session;
                },
                (error) => {
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
                }
            );

            return promiseFinally(
                Promise.all([
                    promiseFinally(res, (ok, err) => {
                        e.emit('done');
                        return Promise.resolve();
                    }),
                    stolenP,
                ]).then(() => res),
                (res, error) => runFinal(res, error)
            ).catch((error) => {
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

    _reloadFeaturesOrInitialize(session: Session): Promise {
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
            const options = {onlyOneActivity: true};
            this.run((session) => session.clearSession(), options);

            this.clearSessionTimeout = null;
        }, this.clearSessionTime);
        this.clearSessionFuture = Date.now() + this.clearSessionTime;
    }

    clearSessionRest(): number {
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

    forwardPassphrase(source: Event1<(e: ?Error, passphrase?: ?string) => void>) {
        source.on((arg: (e: ?Error, passphrase?: ?string) => void) => {
            if (this.rememberedPlaintextPasshprase != null) {
                const p: string = this.rememberedPlaintextPasshprase;
                arg(null, p);
                return;
            }
            if (this.passphraseEvent.listenerCount() === 0) {
                if (typeof arg === 'function') {
                    console.warn('[trezor.js] [device] Passphrase callback not configured, cancelling request');
                    arg(new Error('No passphrase callback'));
                    return;
                }
            }
            const argAndRemember = (e: ?Error, passphrase: ?string) => {
                if (this.rememberPlaintextPassphrase) {
                    this.rememberedPlaintextPasshprase = passphrase;
                }
                arg(e, passphrase);
            };
            this.passphraseEvent.emit(argAndRemember);
        });
    }

    _runInside<X>(
        fn: (session: Session) => (X|Promise<X>),
        activeSession: Session,
        features: Features,
        skipFinalReload: boolean
    ): Promise<X> {
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

    _waitForNullSession(): Promise<?string> {
        return new Promise((resolve, reject) => {
            let onDisconnect = () => {};
            const onUpdate = () => {
                const updatedSession = this.deviceList.getSession(this.originalDescriptor.path);
                const device = this.deviceList.devices[this.originalDescriptor.path.toString()];
                if (updatedSession == null && device != null) {
                    this.deviceList.disconnectEvent.removeListener(onDisconnect);
                    this.deviceList.updateEvent.removeListener(onUpdate);
                    resolve(updatedSession);
                }
            };
            onDisconnect = (device) => {
                if (device === this) {
                    this.deviceList.disconnectEvent.removeListener(onDisconnect);
                    this.deviceList.updateEvent.removeListener(onUpdate);
                    reject(new Error('Device disconnected'));
                }
            };
            onUpdate();
            this.deviceList.updateEvent.on(onUpdate);
            this.deviceList.onDisconnect(this, onDisconnect);
        });
    }

    static fromDescriptor(
        transport: Transport,
        originalDescriptor: DeviceDescriptor,
        deviceList: DeviceList
    ): Promise<Device> {
        // at this point I am assuming nobody else has the device
        const descriptor = { ...originalDescriptor, session: null };
        return Device._run((session, features) => {
            return new Device(transport, descriptor, features, deviceList);
        }, transport, descriptor, deviceList);
    }

    reloadFeatures(): Promise<boolean> {
        return this.run(() => {
            return true;
        });
    }

    // what steal() does is that it does not actually keep the session for itself
    // because it immediately releases it again;
    // however, it might stop some other process in another app,
    // so the device will become "usable"
    steal(): Promise<boolean> {
        return this.run(() => {
            return true;
        }, {aggressive: true});
    }

    isBootloader(): boolean {
        return this.features.bootloader_mode;
    }

    isInitialized(): boolean {
        return this.features.initialized;
    }

    getVersion(): string {
        return [
            this.features.major_version,
            this.features.minor_version,
            this.features.patch_version,
        ].join('.');
    }

    atLeast(version: string): boolean {
        return semvercmp(this.getVersion(), version) >= 0;
    }

    getCoin(name: boolean): Object {
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
                if (this.isStolen() && this.activityInProgress) {
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

                const events: Array<Event0 | Event1 | Event2> = [
                    this.changedSessionsEvent,
                    this.sendEvent,
                    this.receiveEvent,
                    this.errorEvent,
                    this.buttonEvent,
                    this.pinEvent,
                    this.wordEvent,
                ];
                events.forEach(ev => ev.removeAllListeners());
            }
        };
        onChangedSessions(this);
        this.deviceList.changedSessionsEvent.on(onChangedSessions);
        this.deviceList.onDisconnect(this, onDisconnect);
    }

    isUsed(): boolean {
        const session = this.deviceList.getSession(this.originalDescriptor.path);
        return session != null;
    }

    isUsedHere(): boolean {
        const session = this.deviceList.getSession(this.originalDescriptor.path);
        const mySession = this.currentSessionObject != null ? this.currentSessionObject.getId() : null;
        return session != null && mySession === session;
    }

    isUsedElsewhere(): boolean {
        return this.isUsed() && !(this.isUsedHere());
    }

    isStolen(): boolean {
        const shouldBeUsedHere: boolean = this.currentSessionObject != null;

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
            if (currentSession.supportsSync) {
                if (this.clearSession) {
                    currentSession.clearSessionSync();
                }
                currentSession.releaseSync();
            } else {
                // cannot run .then() in browser; so let's just fire and hope for the best
                if (this.clearSession) {
                    currentSession.clearSession();
                }
                currentSession.release();
            }
        }
    }
}

// Forwards events from source to target

function forwardError(source: Event1<Error>, target: Event1<Error>) {
    source.on((arg: Error) => {
        if (target.listenerCount() === 0) {
            return;
        }
        target.emit(arg);
    });
}

function forwardCallback1(
    source: Event1<(error: ?Error, result?: ?string) => void>,
    target: Event1<(error: ?Error, result?: ?string) => void>
) {
    source.on((arg: (error: ?Error, result?: ?string) => void) => {
        if (target.listenerCount() === 0) {
            console.warn('[trezor.js] [device] ' + target.type + 'callback not configured, cancelling request');
            arg(new Error('No ' + target.type + ' callback'));
            return;
        }
        target.emit(arg);
    });
}

function forwardCallback2<T1>(
    source: Event2<T1, (error: ?Error, result?: ?string) => void>,
    target: Event2<T1, (error: ?Error, result?: ?string) => void>
) {
    source.on((arg: T1, arg2: (error: ?Error, result?: ?string) => void) => {
        if (target.listenerCount() === 0) {
            console.warn('[trezor.js] [device] ' + target.type + 'callback not configured, cancelling request');
            arg2(new Error('No ' + target.type + ' callback'));
            return;
        }
        target.emit(arg, arg2);
    });
}

function forward1<T1>(source: Event1<T1>, target: Event1<T1>) {
    source.on((arg: T1) => {
        target.emit(arg);
    });
}

function forward2<T1, T2>(source: Event2<T1, T2>, target: Event2<T1, T2>) {
    source.on((arg1: T1, arg2: T2) => {
        target.emit(arg1, arg2);
    });
}

function promiseFinally<X>(p: Promise<X>, fun: (res: ?X, error: ?Error) => Promise): Promise<X> {
    return p.then(
        res => fun(res, null).then(() => res),
        err => fun(null, err).then(() => {
            throw err;
        }, () => {
            throw err;
        })
    );
}

