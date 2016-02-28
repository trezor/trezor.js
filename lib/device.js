/* @flow */
'use strict';

import {EventEmitter} from './events-flowtype-bug';
import Session from './session';
import semvercmp from './semvercmp';

import type DeviceList from './device-list';

import type {Features, Transport, DeviceDescriptor} from './flowtypes';

// a slight hack
// this error string is hard-coded
// in both bridge and extension
const WRONG_PREVIOUS_SESSION_ERROR_MESSAGE = 'wrong previous session';

export default class Device extends EventEmitter {
    transport: Transport;
    path: string;
    features: Features;
    deviceList: DeviceList;
    activityInProgress: boolean;
    currentSessionObject: ?Session;

    constructor(transport: Transport, path: string, features: Features, deviceList: DeviceList) {
        super();

        // === immutable properties
        this.transport = transport;
        this.path = path;
        this.deviceList = deviceList;

        // === mutable properties
        // features get reloaded after every initialization
        this.features = features;

        this.activityInProgress = false;

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
        descriptor: DeviceDescriptor
    ): Promise<X> {
        return Device._acquire(transport, descriptor).then((session: Session): Promise<X> => {
            return session.initialize().then((res: {message: Features}): X | Promise<X> => {
                return fn(session, res.message);
            }).then(
                (result:X): Promise<X> => {
                    return session.release().then((): X => {
                        return result;
                    });
                },
                error => {
                    // transport error means that something happened on transport level
                    // no need to do release, since that is done on that level anyway
                    if (error.transportError) {
                        throw error;
                    }

                    // we want to throw the original error from the call, even if
                    // the releasing fails for some reason
                    // since the original error is more "important" than the release error
                    return session.release().then(
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

    // note - when descriptor.path != null, this will steal the device from someone else
    static _acquire(transport: Transport, descriptor: DeviceDescriptor): Promise<Session> {
        return transport.acquire(descriptor, true).then(result => {
            if (result.session == null) {
                throw new Error('Session is null after acquire.');
            }
            return new Session(transport, result.session, descriptor);
        });
    }

    waitForSessionAndRun<X>(fn: (session: Session) => (X|Promise<X>)): Promise<X> {
        return this.run(fn, {waiting: true});
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
    run<X>(fn: (session: Session) => (X|Promise<X>), options: ?{
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
    }): Promise<X> {

        const options_ = options == null ? {} : options;
        const aggressive = !!options_.aggressive;
        const skipFinalReload = !!options_.skipFinalReload;
        const waiting = !!options_.waiting;

        const onlyOneActivity = !!options_.onlyOneActivity;
        if (onlyOneActivity && this.activityInProgress) {
            return Promise.reject(new Error('One activity already running.'));
        }

        this.activityInProgress = true;

        const currentSession = this.deviceList.getSession(this.path);
        if ((!aggressive) && (!waiting) && (currentSession != null)) {
            return Promise.reject(new Error('Not stealing when not aggressive'));
        }
        if (aggressive && waiting) {
            return Promise.reject(new Error('Combination of aggressive and waiting doesn\'t make sense.'));
        }

        let waitingPromise: Promise<?string> = Promise.resolve(currentSession);
        if (waiting && currentSession != null) {
            waitingPromise = this._waitForNullSession();
        }

        return waitingPromise.then((resolvedSession: ?string) => {
            const descriptor = {path: this.path, session: resolvedSession};
            return Device._run(
                (session, features) => this._runInside(fn, session, features, skipFinalReload),
                this.transport,
                descriptor
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

    _runInside<X>(
        fn: (session: Session) => (X|Promise<X>),
        activeSession: Session,
        features: Features,
        skipFinalReload: boolean
    ): Promise<X> {
        this.features = features;
        this.currentSessionObject = activeSession;

        forward(activeSession, this, 'send');
        forward(activeSession, this, 'receive');
        forward(activeSession, this, 'error');

        forward(activeSession, this, 'button');
        forward(activeSession, this, 'pin');
        forward(activeSession, this, 'word');
        forward(activeSession, this, 'passphrase');

        const reloadFinal = (err: ?(Error & {transportError: boolean})) => {
            const errIsTransport = err != null && err.transportError;
            if (skipFinalReload || errIsTransport) {
                return Promise.resolve();
            } else {
                return this._reloadFeaturesOrInitialize(activeSession);
            }
        }

        const cleanupFinal = () => {
            activeSession.removeAllListeners();
            this.activityInProgress = false;
            this.currentSessionObject = null;
        };

        const runFinal = (err) => {
            return reloadFinal(err).then(
                () => cleanupFinal(),
                () => cleanupFinal()
            );
        };

        return Promise.resolve(fn(activeSession)).then((res) => {
            return runFinal().then(() => res);
        }, err => {
            return runFinal(err).then(() => {
                throw err;
            });
        });
    }

    _waitForNullSession(): Promise<?string> {
        return new Promise((resolve, reject) => {
            let onDisconnect;
            const onUpdate = () => {
                const updatedSession = this.deviceList.getSession(this.path);
                if (updatedSession == null) {
                    this.deviceList.removeListener('disconnect', onDisconnect);
                    this.deviceList.removeListener('update', onUpdate);
                    resolve(updatedSession);
                }
            };
            onDisconnect = (device) => {
                if (device === this) {
                    this.deviceList.removeListener('disconnect', onDisconnect);
                    this.deviceList.removeListener('update', onUpdate);
                    reject();
                }
            };

            this.deviceList.on('update', onUpdate);
            this.deviceList.on('disconnect', onDisconnect);
        });
    }

    static fromPath(transport: Transport, path: string, deviceList: DeviceList): Promise<Device> {
        const session = null; // at this point I am assuming nobody else has the device
        const descriptor = {path: path, session: session};
        return Device._run((session, features) => {
            return new Device(transport, path, features, deviceList);
        }, transport, descriptor);
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
                this.emit('changedSessions', this.isUsed(), this.isUsedHere());
            }
        };

        this.deviceList.on('changedSessions', onChangedSessions);

        this.deviceList.on('disconnect', function onDisconnect(device) {
            if (device === this) {
                this.emit('disconnect');
                this.deviceList.removeListener('disconnect', onDisconnect);
                this.deviceList.removeListener('changedSessions', onChangedSessions);
            }
        }.bind(this));
    }

    isUsed(): boolean {
        const session = this.deviceList.getSession(this.path);
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
                currentSession.releaseSync();
            } else {
                currentSession.release();
            }
        }
    }
}

// Forwards events from source to target
function forward(source: Session, target: Device, event: string) {
    source.on(event, (...args) => {
        if (event === 'error') {
            // don't throw actual errors if there is nothing listening on "error"
            if (EventEmitter.listenerCount(target, 'error') === 0) {
                return;
            }
        }
        if (event === 'pin') {
            if (EventEmitter.listenerCount(target, 'pin') === 0) {
                // if event is pin and no listener -> bad, no callback
                console.warn('[device] PIN callback not configured, cancelling request');
                const callback = args[0];
                callback(new Error('No PIN callback.'));
                return;
            }
        }
        if (event === 'passphrase') {
            if (EventEmitter.listenerCount(target, 'passphrase') === 0) {
                console.warn('[device] Passphrase callback not configured, cancelling request');
                const callback = args[0];
                callback(new Error('No passphrase callback.'));
                return;
            }
        }
        if (event === 'word') {
            if (EventEmitter.listenerCount(target, 'word') === 0) {
                console.warn('[device] Word callback not configured, cancelling request');
                const callback = args[0];
                callback(new Error('No word callback.'));
                return;
            }
        }

        target.emit(event, ...args);
    });
}
