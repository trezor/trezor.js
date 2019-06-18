/* @flow */
'use strict';

import semvercmp from 'semver-compare';

import {EventEmitter} from './events';
import {Event0, Event1, Event2} from './flow-events';
import Session from './session';
import {lock} from './utils/connectionLock';
import {BITCOIN_COIN_INFO, harden} from './utils/hdnode';
import * as bitcoin from '@trezor/utxo-lib';

import type DeviceList from './device-list';
import type {Features} from './trezortypes';
import type {CoinInfo} from './utils/hdnode';
import type {Transport, TrezorDeviceInfoWithSession as DeviceDescriptor} from 'trezor-link';

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
    debugLink?: boolean;
}

export default class Device extends EventEmitter {
    transport: Transport;
    originalDescriptor: DeviceDescriptor;
    features: Features;
    deviceList: DeviceList;
    activityInProgress: boolean = false;
    currentSessionObject: ?Session;
    currentDebugSessionObject: ?Session;
    connected: boolean = true;

    hasDebugLink: boolean;

    clearSession: boolean = false;
    clearSessionTime: number = 10 * 60 * 1000; // in miliseconds
    clearSessionTimeout: ?number = null;
    clearSessionFuture: number = 0;

    rememberPlaintextPassphrase: boolean = false;
    rememberedPlaintextPasshprase: ?string = null;

    passphraseState: ?string = null;

    // First of two "advanced" integrity checks
    // We check whether the xpub that we get from the trezor is
    // the same that *the application* remembers.
    // *The application* sets this based on what it remembers.
    // Then, before some actions (see @integrityCheck in session.js)
    // we first look for xpub with this path and compare.
    // If the application doesn't set this, we are still at least
    // comparing different calls with each other, since this is set on first call.
    integrityCheckingXpub: ?string;
    integrityCheckingXpubPath: Array<number> = [harden(49), harden(0), harden(0)];
    integrityCheckingXpubNetwork: string | bitcoin.Network | CoinInfo = BITCOIN_COIN_INFO;
    integrityCheckingPassphrase: ?string;

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

    constructor(transport: Transport, descriptor: DeviceDescriptor, features: Features, deviceList: DeviceList, hasDebugLink: boolean) {
        super();
        const { major_version, minor_version, patch_version, bootloader_mode } = features;
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
        this.features = {...features, ...this.getVersions(major_version, minor_version, patch_version, bootloader_mode)};
        this.connected = true;

        this.hasDebugLink = hasDebugLink;

        this._watch();
    }

    // Initializes device with the given descriptor,
    // runs a given function and then releases the session.
    // Return promise with the result of the function.
    // First parameter is a function that has two parameters
    // - first the session and second the fresh device features.
    // Note - when descriptor.path != null, this will steal the device from someone else
    static async _run<X>(
        fn: (session: Session, features: Features) => (X|Promise<X>),
        transport: Transport,
        descriptor: DeviceDescriptor,
        deviceList: DeviceList,
        onAcquire?: ?((session: Session) => void),
        onRelease?: ?((error: ?Error) => Promise<any>),
        device: ?Device,
        debugLink: boolean
    ): Promise<X> {
        const session = await Device._acquire(
            transport,
            descriptor,
            deviceList,
            onAcquire,
            device,
            debugLink
        );
        try {
            let features: ?Features;
            if (debugLink) {
                // do not reload features on debug link
                if (device == null) {
                    throw new Error('Debug link cannot load first');
                }
                features = device.features;
            } else {
                features = (await session.initialize()).message;
            }
            if (features == null) {
                throw new Error('Features unexpected null');
            }
            return await fn(session, features);
        } finally {
            await Device._release(descriptor, session, deviceList, onRelease);
        }
    }

    // Release and acquire are quite complex,
    // because we have to deal with various race conditions
    // for multitasking
    static _release(
        originalDescriptor: DeviceDescriptor,
        session: Session,
        deviceList: DeviceList,
        onRelease?: ?((error: ?Error) => Promise<any>)
    ): Promise<void> {
        const released = lock(() =>
            promiseFinally(
                session.release(false),
                (res, error) => {
                    if (error == null) {
                        deviceList.setHard(originalDescriptor.path, null, session.debugLink);
                    }
                    return Promise.resolve();
                }
            )
        );
        return promiseFinally(
            released,
            (res, error) => {
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
        onAcquire?: ?((session: Session) => void),
        device: ?Device,
        debugLink: boolean,
    ): Promise<Session> {
        return lock(() =>
            transport.acquire({
                path: descriptor.path,
                previous: descriptor.session,
            }, debugLink).then(res => {
                deviceList.setHard(descriptor.path, res, debugLink);
                return res;
            })
        ).then(result => {
            const session = new Session(transport, result, descriptor, !!deviceList.options.debugInfo, device, deviceList.xpubDerive, debugLink);
            if (onAcquire != null) {
                onAcquire(session);
            }
            return session;
        });
    }

    waitForSessionAndRun<X>(fn: (session: Session) => (Promise<X> | X), options: ?RunOptions): Promise<X> {
        const options_: RunOptions = options == null ? {} : options;
        return this.run(fn, {...options_, waiting: true});
    }

    runAggressive<X>(fn: (session: Session) => (Promise<X> | X), options: ?RunOptions): Promise<X> {
        const options_: RunOptions = options == null ? {} : options;
        return this.run(fn, {...options_, aggressive: true});
    }

    getVersions(major_version: number, minor_version: number, patch_version: number, isBootloader: boolean) {
        let result = {};
        if (isBootloader) {
            result = {
                bootloader_major_version: major_version,
                bootloader_minor_version: minor_version,
                bootloader_patch_version: patch_version,
                firmware_major_version: null,
                firmware_minor_version: null,
                firmware_patch_version: null,
            };
        } else {
            result = {
                firmware_major_version: major_version,
                firmware_minor_version: minor_version,
                firmware_patch_version: patch_version,
                bootloader_major_version: null,
                bootloader_minor_version: null,
                bootloader_patch_version: null,
            };
        }

        return result;
    }

    // Initializes device with the given descriptor,
    // runs a given function and then releases the session.
    // Return promise with the result of the function.
    // First parameter is a function that has session as a parameter
    run<X>(fn: (session: Session) => (Promise<X> | X), options: ?RunOptions): Promise<X> {
        if (!this.connected) {
            return Promise.reject(new Error('Device disconnected.'));
        }
        const options_ = options == null ? {} : options;
        const aggressive = !!options_.aggressive;
        const waiting = !!options_.waiting;

        const debugLink = !!options_.debugLink;
        const skipFinalReload = !!options_.skipFinalReload || debugLink;
        const onlyOneActivity = !!options_.onlyOneActivity;
        if (onlyOneActivity && this.activityInProgress) {
            return Promise.reject(new Error('One activity already running.'));
        }

        this.activityInProgress = true;
        this._stopClearSessionTimeout();

        const currentSession = this.deviceList.getSession(this.originalDescriptor.path, debugLink);
        if ((!aggressive) && (!waiting) && (currentSession != null)) {
            return Promise.reject(new Error('Device used in another window.'));
        }
        if (aggressive && waiting) {
            return Promise.reject(new Error('Combination of aggressive and waiting doesn\'t make sense.'));
        }

        let waitingPromise: Promise<?string> = Promise.resolve(currentSession);
        if (waiting && currentSession != null) {
            waitingPromise = this._waitForNullSession(debugLink);
        }

        const runFinal = (res, error) => {
            if (!(error && error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE && waiting)) {
                if (this.clearSession) {
                    this._startClearSessionTimeout();
                }
            }
            return Promise.resolve();
        };

        return waitingPromise.then((resolvedSession: ?string) => {
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
                    if (debugLink) {
                        this.currentDebugSessionObject = session;
                    } else {
                        this.currentSessionObject = session;
                    }
                },
                (error) => {
                    if (debugLink) {
                        this.currentDebugSessionObject = null;
                    } else {
                        this.currentSessionObject = null;
                    }
                    if (!debugLink) {
                        this.activityInProgress = false;
                    }
                    if (error != null && this.connected) {
                        if (error.message === 'Action was interrupted.') {
                            this._stolenEvent.emit();
                            return Promise.resolve();
                        } else {
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
                        }
                    } else {
                        return Promise.resolve();
                    }
                },
                this,
                debugLink
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
                    return this._waitForNullSession(debugLink).then(() => {
                        return this.run(fn, options);
                    });
                } else {
                    throw error;
                }
            });
        });
    }

    // See the comment on top on integrityCheckingXpub.
    // This sets the xpub that we will re-check when possible (before important actions, and
    // after all action when it makes sense)
    setCheckingXpub(integrityCheckingXpubPath: Array<number>, integrityCheckingXpub: string, integrityCheckingXpubNetwork: string | bitcoin.Network | CoinInfo) {
        this.integrityCheckingXpubPath = integrityCheckingXpubPath;
        this.integrityCheckingXpub = integrityCheckingXpub;
        this.integrityCheckingXpubNetwork = integrityCheckingXpubNetwork;
        this.integrityCheckingPassphrase = this.rememberedPlaintextPasshprase;
    }

    // When we are doing integrity checking AFTER functions, we do it only when we can
    canSayXpub(oldFeatures: Features): boolean {
        if (this.features.bootloader_mode) {
            return false;
        }
        if (!this.features.initialized) {
            return false;
        }
        const noPassphrase = this.features.passphrase_protection ? (this.features.passphrase_cached || (this.rememberedPlaintextPasshprase != null)) : true;

        const passphraseDisabled = this.features.passphrase_protection === false &&
            oldFeatures.passphrase_protection === false &&
            this.integrityCheckingPassphrase == null;
        const passphraseEnabledRemembered =
            this.features.passphrase_protection === true &&
            oldFeatures.passphrase_protection === true &&
            this.rememberedPlaintextPasshprase != null &&
            this.rememberedPlaintextPasshprase === this.integrityCheckingPassphrase;
        const samePasshprase = passphraseDisabled || passphraseEnabledRemembered;

        const noPin = this.features.pin_protection ? this.features.pin_cached : true;
        return noPassphrase && samePasshprase && noPin;
    }

    // See the comment on top on integrityCheckingXpub.
    async xpubIntegrityCheck(session: Session): Promise<void> {
        const hdnode = await session._getHDNodeInternal(this.integrityCheckingXpubPath, this.integrityCheckingXpubNetwork);
        const xpub = hdnode.toBase58();
        if (this.integrityCheckingXpub == null) {
            this.integrityCheckingXpub = xpub;
            this.integrityCheckingPassphrase = this.rememberedPlaintextPasshprase;
        } else {
            if (xpub !== this.integrityCheckingXpub) {
                throw new Error('Inconsistent state');
            }
        }
    }

    _reloadFeaturesOrInitialize(session: Session): Promise<void> {
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

    // See comment on device-list option getPassphraseHash
    checkPassphraseHash(passphrase: string): boolean {
        if (this.deviceList.options.getPassphraseHash != null) {
            const websiteHash = this.deviceList.options.getPassphraseHash(this);
            if (websiteHash == null) {
                return true;
            }
            const id = this.features.device_id;
            const secret = 'TREZOR#' + id + '#' + passphrase;
            const hashed = sha256x2(secret);
            return (JSON.stringify([...hashed]) === JSON.stringify([...websiteHash]));
        }
        return true;
    }

    // See comment on device-list option getPassphraseHash
    forwardPassphrase(source: Event1<(e: ?Error, passphrase?: ?string) => void>) {
        source.on((arg: (e: ?Error, passphrase?: ?string) => void) => {
            if (this.rememberedPlaintextPasshprase != null) {
                const p: string = this.rememberedPlaintextPasshprase;

                const checkPasshprase = this.checkPassphraseHash(p);
                if (checkPasshprase) {
                    arg(null, p);
                } else {
                    arg(new Error('Inconsistent state'));
                }
                return;
            }

            const argAndRemember = (e: ?Error, passphrase: ?string) => {
                if (this.rememberPlaintextPassphrase) {
                    if (passphrase != null) {
                        const checkPasshprase = this.checkPassphraseHash(passphrase);
                        if (!checkPasshprase) {
                            arg(new Error('Inconsistent state'));
                            return;
                        }
                    }

                    this.rememberedPlaintextPasshprase = passphrase;
                }
                arg(e, passphrase);
            };
            this.passphraseEvent.emit(argAndRemember);
        });
    }

    async _runInside<X>(
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

        const res = await fn(activeSession);
        try {
            if (!skipFinalReload) {
                const oldFeatures = features;
                await this._reloadFeaturesOrInitialize(activeSession);
                if (this.canSayXpub(oldFeatures)) {
                    await this.xpubIntegrityCheck(activeSession);
                }
            }
        } finally {
            activeSession.deactivateEvents();
        }
        return res;
    }

    _waitForNullSession(debugLink: boolean): Promise<?string> {
        return new Promise((resolve, reject) => {
            let onDisconnect = () => {};
            const onUpdate = () => {
                const updatedSession = this.deviceList.getSession(this.originalDescriptor.path, debugLink);
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
        deviceList: DeviceList,
    ): Promise<Device> {
        // at this point I am assuming nobody else has the device
        const descriptor: DeviceDescriptor = { ...originalDescriptor, session: null };
        return Device._run((session, features) => {
            return new Device(transport, descriptor, features, deviceList, !!descriptor.debug);
        }, transport, descriptor, deviceList, null, null, null, false);
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

                const events: Array<Event0 | Event1<any> | Event2<any, any>> = [
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
        const session = this.deviceList.getSession(this.originalDescriptor.path, false);
        return session != null;
    }

    isUsedHere(): boolean {
        const session = this.deviceList.getSession(this.originalDescriptor.path, false);
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
            // cannot run .then() in browser; so let's just fire and hope for the best
            if (this.clearSession) {
                const model = this.features.model;
                if (model == null || model !== 'T') {
                    currentSession.clearSession();
                }
            }
            currentSession.release(true);
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
        target.emit(arg);
    });
}

function forwardCallback2<T1>(
    source: Event2<T1, (error: ?Error, result?: ?string) => void>,
    target: Event2<T1, (error: ?Error, result?: ?string) => void>
) {
    source.on((arg: T1, arg2: (error: ?Error, result?: ?string) => void) => {
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

function promiseFinally<X>(p: Promise<X>, fun: (res: ?X, error: ?Error) => Promise<any>): Promise<X> {
    return p.then(
        res => fun(res, null).then(() => res),
        err => fun(null, err).then(() => {
            throw err;
        }, () => {
            throw err;
        })
    );
}

function sha256x2(value: Buffer | string): Buffer {
    const realBuffer = typeof value === 'string' ? new Buffer(value, 'binary') : value;
    return bitcoin.crypto.hash256(realBuffer);
}

