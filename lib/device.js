/* @flow */
"use strict";

import EventEmitter from 'events';
import Session from './session';
import semvercmp from './semvercmp';

import type DeviceList from './device-list';

import type {Transport, DeviceDescriptor} from './session';

// a slight hack
// this error string is hard-coded
// in both bridge and extension
const WRONG_PREVIOUS_SESSION_ERROR_MESSAGE = 'wrong previous session';

type Features = {
    bootloader_mode: boolean;
    initialized: boolean;
    major_version: number;
    minor_version: number;
    patch_version: number;
    coins: Array<{coin_name: string}>;
};

export default class Device extends EventEmitter {
    transport: Transport;
    path: string;
    features: Features;
    deviceList: DeviceList;
    activityInProgress: boolean;

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
            }).then((result:X): Promise<X> => {
                return session.release().then((): X => {
                    return result;
                });
            });
        });
    }

    // note - when descriptor.path != null, this will steal the device from someone else
    static _acquire(transport: Transport, descriptor: DeviceDescriptor): Promise<Session> {
        return transport.acquire(descriptor).then(result => {
            if (result.session == null) {
                throw new Error("Session is null after acquire.");
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
    }): Promise<X> {

        if (this.activityInProgress) {
            return new Promise.reject(new Error('One activity already running.'));
        }
        this.activityInProgress = true;

        const options_ = options == null ? {} : options;
        const aggressive = !!options_.aggressive;
        const skipFinalReload = !!options_.skipFinalReload;
        const waiting = !!options_.waiting;

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
        });
    }

    _runInside<X>(
        fn: (session: Session) => (X|Promise<X>), 
        activeSession: Session, 
        features: Features,
        skipFinalReload: boolean
    ): Promise<X> {
        this.features = features;

        forward(activeSession, this, 'send');
        forward(activeSession, this, 'receive');
        forward(activeSession, this, 'error');

        forward(activeSession, this, 'button');
        forward(activeSession, this, 'pin');
        forward(activeSession, this, 'word');
        forward(activeSession, this, 'passphrase');        

        const runFinal = () => {
            let finalReload;
            if (skipFinalReload) {
                finalReload = Promise.resolve();
            } else {
                finalReload = this._reloadFeaturesOrInitialize(activeSession);
            }
            return finalReload.then(() => {
                activeSession.removeAllListeners();
                this.activityInProgress = false;
            });
        };

        return Promise.resolve(fn(activeSession)).then((res) => {
            return runFinal().then(() => res);
        }, err => {
            return runFinal().then(() => {
                throw err;
            });
        });
    }

    _waitForNullSession(): Promise<?string> {
        return new Promise((resolve) => {
            this.deviceList.on('update', function onUpdate () {
                const updatedSession = this.deviceList.getSession(this.path);
                if (updatedSession == null) {
                    this.deviceList.removeListener('update', onUpdate);
                    resolve(updatedSession);
                }
            }.bind(this));
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
            return this;
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
            this.features.patch_version
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
        target.emit.apply(target, [event].concat(args));
    });
}
