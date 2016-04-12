/* @flow */
'use strict';

import semvercmp from 'semver-compare';

import {EventEmitter} from './events';
import {Event0, Event1, Event2} from './flow-events';
import Session from './session';

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
        if (this.deviceList.options.rememberDevicePasshprase) {
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
        deviceList: DeviceList
    ): Promise<X> {
        return Device._acquire(transport, descriptor, deviceList).then((session: Session): Promise<X> => {
            return session.initialize().then((res: {message: Features}): X | Promise<X> => {
                return fn(session, res.message);
            }).then(
                (result:X): X | Promise<X> => {
                    // transport error means that something happened on transport level
                    // no need to do release, since that is done on that level anyway
                    const lastCallError = session.lastCallError;
                    if (lastCallError != null && lastCallError.transportError) {
                        return result;
                    }

                    return Device._release(descriptor, session, deviceList).then((): X => {
                        return result;
                    });
                },
                error => {
                    // transport error means that something happened on transport level
                    // no need to do release, since that is done on that level anyway
                    const lastCallError = session.lastCallError;
                    if (lastCallError != null && lastCallError.transportError) {
                        throw error;
                    }

                    // we want to throw the original error, even if
                    // the releasing fails for some reason
                    // since the original error is more "important" than the release error
                    return Device._release(descriptor, session, deviceList).then(
                        () => {
                            throw error;
                        },
                        () => {
                            throw error;
                        }
                    );
                }
           );
        });
    }

    // _release is so complex, because two things happen at transport, with slight delay
    // 1. release() call is successful
    // 2. enumerate() returns with the empty session
    // Because they don't happen immediately, but with a small delay, that can make an inconsistent state,
    // when the device still looks like in use, but the activity is already finished.
    // So instead we here wait until the device is marked as released even at enumerate.
    static _release(originalDescriptor: DeviceDescriptor, session: Session, deviceList: DeviceList): Promise {
        const released = session.release();
        const waitForEvent = new Promise((resolve, reject) => {
            const stream = deviceList.stream;
            if (stream == null) {
                reject(new Error('Stream is null'));
            } else {
                stream.releasedEvent.on(function onReleased({path, session}) {
                    if (path === originalDescriptor.path) {
                        stream.releasedEvent.removeListener(onReleased);
                        resolve();
                    }
                });
            }
        });
        return Promise.all([released, waitForEvent]);
    }

    // _acquire is complex, so that we are in a consistent state with enumerate() results
    // If we didn't wait for that, it can happen that the whole acquire-action-release is FASTER,
    // than two enumerations, so releasedEvent is never run.
    // note - when descriptor.path != null, this will steal the device from someone else
    static _acquire(transport: Transport, descriptor: DeviceDescriptor, deviceList: DeviceList): Promise<Session> {
        const sessionP = transport.acquire(descriptor, true).then(result => {
            if (result.session == null) {
                throw new Error('Session is null after acquire.');
            }
            return new Session(transport, result.session, descriptor);
        });
        const waitForEvent = new Promise((resolve, reject) => {
            const stream = deviceList.stream;
            if (stream == null) {
                reject(new Error('Stream is null'));
            } else {
                stream.acquiredEvent.on(function onAcquired({path, session}) {
                    if (path === descriptor.path) {
                        stream.acquiredEvent.removeListener(onAcquired);
                        resolve();
                    }
                });
            }
        });
        return Promise.all([sessionP, waitForEvent]).then(() => sessionP);
    }

    waitForSessionAndRun<X>(fn: (session: Session) => (X|Promise<X>), options: ?RunOptions): Promise<X> {
        const options_: RunOptions = options == null ? {} : options;
        return this.run(fn, {...options_, waiting: true});
    }

    // FOR DEBUGGING
    // emit(event: string, ...args: Array<any>) {
    //     console.log("[device] Emitting", event, ...args);
    //     super.emit(event, ...args);
    // }

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

        return waitingPromise.then((resolvedSession: ?(number|string)) => {
            const descriptor = { ...this.originalDescriptor, session: resolvedSession };
            return Device._run(
                (session, features) => this._runInside(fn, session, features, skipFinalReload),
                this.transport,
                descriptor,
                this.deviceList
            ).catch(error => {
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
                    console.warn('[device] Passphrase callback not configured, cancelling request');
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
        this.currentSessionObject = activeSession;

        forward2(activeSession.sendEvent, this.sendEvent);
        forward2(activeSession.receiveEvent, this.receiveEvent);
        forwardError(activeSession.errorEvent, this.errorEvent);

        forward1(activeSession.buttonEvent, this.buttonEvent);
        forwardCallback2(activeSession.pinEvent, this.pinEvent);
        forwardCallback1(activeSession.wordEvent, this.wordEvent);
        this.forwardPassphrase(activeSession.passphraseEvent);

        const reloadFinal = (err: ?(Error & {transportError: boolean})) => {
            const errIsTransport = err != null && err.transportError;
            if (skipFinalReload || errIsTransport) {
                return Promise.resolve();
            } else {
                return this._reloadFeaturesOrInitialize(activeSession);
            }
        };

        const cleanupFinal = () => {
            activeSession.deactivateEvents();
            this.activityInProgress = false;
            this.currentSessionObject = null;
            return true;
        };

        const addClearSession = () => {
            if (!this.clearSession) {
                return;
            }
            this._startClearSessionTimeout();
        };

        const runFinal = (err) => {
            return reloadFinal(err).then(
                () => cleanupFinal(),
                () => cleanupFinal()
            ).then(() => addClearSession());
        };

        return Promise.resolve(fn(activeSession)).then((res) => {
            return runFinal(activeSession.lastCallError).then(() => res);
        }, err => {
            return runFinal(activeSession.lastCallError).then(() => {
                throw err;
            });
        });
    }

    _waitForNullSession(): Promise<?string> {
        return new Promise((resolve, reject) => {
            let onDisconnect = () => {};
            const onUpdate = () => {
                const updatedSession = this.deviceList.getSession(this.originalDescriptor.path);
                if (updatedSession == null) {
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

            this.deviceList.updateEvent.on(onUpdate);
            this.deviceList.disconnectEvent.on(onDisconnect);
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
            }
        };

        this.deviceList.changedSessionsEvent.on(onChangedSessions);

        this.deviceList.disconnectEvent.on(function onDisconnect(device) {
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
        }.bind(this));
    }

    isUsed(): boolean {
        const session = this.deviceList.getSession(this.originalDescriptor.path);
        return session != null;
    }

    isUsedHere(): boolean {
        return this.isUsed() && this.activityInProgress;
    }

    isUsedElsewhere(): boolean {
        return this.isUsed() && !(this.activityInProgress);
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
            console.warn('[device] ' + target.type + 'callback not configured, cancelling request');
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
            console.warn('[device] ' + target.type + 'callback not configured, cancelling request');
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

