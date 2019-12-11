/* @flow */
'use strict';

import * as bitcoin from '@trezor/utxo-lib';

import {EventEmitter} from './events';
import {Event0, Event1, Event2} from './flow-events';
import DescriptorStream from './descriptor-stream';
import Device from './device';
import UnacquiredDevice from './unacquired-device';

import type Session from './session';

import type {DeviceDescriptorDiff} from './descriptor-stream';

import type {
    Transport,
    TrezorDeviceInfoWithSession as DeviceDescriptor,
} from 'trezor-link';

const CONFIG_URL = 'https://wallet.trezor.io/data/config_signed.bin';

export type DeviceListOptions = {
    debug?: boolean;
    debugInfo?: boolean;
    transport?: Transport;
    nodeTransport?: Transport;
    configUrl?: string;
    config?: string;
    bridgeVersionUrl?: string;
    bridgeVersion?: string;
    clearSession?: boolean;
    clearSessionTime?: number;
    rememberDevicePassphrase?: boolean;

    // Second of two "advanced" integrity checks
    // In *the app itself*, we store the hash of the passphrase in localstorage
    // but we also want to periodically check whether it is saved correctly
    // This function needs to be set from app above.
    // It can be set later, not during creation of the list.
    getPassphraseHash?: ((device: Device) => ?Array<number>);

    xpubDerive?: (xpub: string, network: bitcoin.Network, index: number) => Promise<string>;
};

// a slight hack
// this error string is hard-coded
// in both bridge and extension
const WRONG_PREVIOUS_SESSION_ERROR_MESSAGE = 'wrong previous session';

const WEBUSB_ERROR_TOSTRING = 'NetworkError: Unable to claim interface.';

//
// Events:
//
//  connect: Device
//  disconnect: Device
//  transport: Transport
//  stream: DescriptorStream
//
export default class DeviceList extends EventEmitter {
    static _fetch: (input: string | Request, init?: RequestOptions) => Promise<Response> =
        () => Promise.reject(new Error('No fetch defined'));

    static _setFetch(fetch: any) {
        DeviceList._fetch = fetch;
    }

    static defaultTransport: () => Transport;
    static _setTransport(t: () => Transport) {
        DeviceList.defaultTransport = t;
    }

    static node: boolean;
    static _setNode(node: boolean) {
        DeviceList.node = node;
    }

    options: DeviceListOptions;
    transport: ?Transport;
    transportLoading: boolean = true;
    stream: ?DescriptorStream = null;
    devices: {[k: string]: Device} = {};
    unacquiredDevices: {[k: string]: UnacquiredDevice} = {};

    creatingDevices: {[k: string]: boolean} = {};

    sessions: {[path: string]: ?string} = {};
    debugSessions: {[path: string]: ?string} = {};

    errorEvent: Event1<Error> = new Event1('error', this);
    transportEvent: Event1<Transport> = new Event1('transport', this);
    streamEvent: Event1<DescriptorStream> = new Event1('stream', this);
    connectEvent: Event2<Device, ?UnacquiredDevice> = new Event2('connect', this);
    connectUnacquiredEvent: Event1<UnacquiredDevice> = new Event1('connectUnacquired', this);
    changedSessionsEvent: Event1<Device> = new Event1('changedSessions', this);
    acquiredEvent: Event1<Device> = new Event1('acquired', this);
    releasedEvent: Event1<Device> = new Event1('released', this);

    debugChangedSessionsEvent: Event1<Device> = new Event1('debugChangedSessions', this);
    debugAcquiredEvent: Event1<Device> = new Event1('debugAcquired', this);
    debugReleasedEvent: Event1<Device> = new Event1('debugReleased', this);

    disconnectEvent: Event1<Device> = new Event1('disconnect', this);
    disconnectUnacquiredEvent: Event1<UnacquiredDevice> = new Event1('disconnectUnacquired', this);
    updateEvent: Event1<DeviceDescriptorDiff> = new Event1('update', this);

    unreadableHidDeviceChange: Event0 = new Event0('unreadableHidDevice', this);

    requestNeeded: boolean;
    xpubDerive: (xpub: string, network: bitcoin.Network, index: number) => Promise<string>;

    constructor(options: ?DeviceListOptions) {
        super();

        this.options = options || {};
        this.requestNeeded = false;

        this.transportEvent.on((transport: Transport) => {
            this.transport = transport;
            this.transportLoading = false;
            this.requestNeeded = transport.requestNeeded;

            this._initStream(transport);
            this._setUnreadableHidDeviceChange();
        });

        this.streamEvent.on(stream => {
            this.stream = stream;
        });

        // using setTimeout to emit 'transport' in next tick,
        // so people from outside can add listener after constructor finishes
        setTimeout(() => this._initTransport(), 0);

        this.xpubDerive = this.options.xpubDerive != null ? this.options.xpubDerive : (xpub, network, index) => {
            return Promise.resolve(bitcoin.HDNode.fromBase58(xpub, network, false).derive(index).toBase58());
        };
    }

    requestDevice(): Promise<void> {
        if (this.transport == null) {
            return Promise.reject();
        }
        return this.transport.requestDevice();
    }

    asArray(): Array<Device> {
        return objectValues(this.devices);
    }

    unacquiredAsArray(): Array<UnacquiredDevice> {
        return objectValues(this.unacquiredDevices);
    }

    hasDeviceOrUnacquiredDevice() {
        return ((this.asArray().length + this.unacquiredAsArray().length) > 0);
    }

    // for mytrezor - returns "bridge" or "extension", or something else :)
    transportType(): string {
        if (this.transport == null) {
            return '';
        }
        if (this.transport.activeName) {
            // $ FlowIssue
            const activeName: string = this.transport.activeName;
            if (activeName === 'BridgeTransport') {
                return 'bridge';
            }
            if (activeName === 'ExtensionTransport') {
                return 'extension';
            }
            return activeName;
        }
        return this.transport.name;
    }

    transportVersion(): string {
        if (this.transport == null) {
            return '';
        }
        return this.transport.version;
    }

    transportOutdated(): boolean {
        if (this.transport == null) {
            return false;
        }
        if (this.transport.isOutdated) {
            return true;
        }
        return false;
    }

    _configTransport(transport: Transport): Promise<any> {
        if (this.options.config != null) {
            return transport.configure(this.options.config);
        } else {
            const configUrl: string = (this.options.configUrl == null)
                ? (CONFIG_URL + '?' + Date.now())
                : this.options.configUrl;
            const fetch = DeviceList._fetch;
            return fetch(configUrl).then(response => {
                if (!response.ok) {
                    throw new Error('Wrong config response.');
                }
                return response.text();
            }).then(config => {
                return transport.configure(config);
            });
        }
    }

    _initTransport() {
        const transport = this.options.transport ? this.options.transport : DeviceList.defaultTransport();
        if (this.options.bridgeVersionUrl != null) {
            transport.setBridgeLatestUrl(this.options.bridgeVersionUrl);
        }
        if (this.options.bridgeVersion != null) {
            transport.setBridgeLatestVersion(this.options.bridgeVersion);
        }
        if (this.options.debugInfo) {
            console.log('[trezor.js] [device list] Initializing transports');
        }
        transport.init(this.options.debug).then(() => {
            if (this.options.debugInfo) {
                console.log('[trezor.js] [device list] Configuring transports');
            }
            this._configTransport(transport).then(() => {
                if (this.options.debugInfo) {
                    console.log('[trezor.js] [device list] Configuring transports done');
                }
                this.transportEvent.emit(transport);
            });
        }, error => {
            if (this.options.debugInfo) {
                console.error('[trezor.js] [device list] Error in transport', error);
            }
            this.errorEvent.emit(error);
        });
    }

    _createAndSaveDevice(
        transport: Transport,
        descriptor: DeviceDescriptor,
        stream: DescriptorStream,
        previous: ?UnacquiredDevice
    ): void {
        if (this.options.debugInfo) {
            console.log('[trezor.js] [device list] Creating Device', descriptor, previous);
        }

        const path = descriptor.path.toString();
        this.creatingDevices[path] = true;
        this._createDevice(transport, descriptor, stream, previous).then(device => {
            if (device instanceof Device) {
                this.devices[path] = device;
                delete this.creatingDevices[path];
                this.connectEvent.emit(device, previous);
            } else {
                delete this.creatingDevices[path];
                this.unacquiredDevices[path] = device;
                this.connectUnacquiredEvent.emit(device);
            }
        }).catch(err => {
            console.debug('[trezor.js] [device list] Cannot create device', err);
        });
    }

    _createDevice(
        transport: Transport,
        descriptor: DeviceDescriptor,
        stream: DescriptorStream,
        previous: ?UnacquiredDevice
    ): Promise<Device|UnacquiredDevice> {
        const devRes: Promise<Device | UnacquiredDevice> = Device.fromDescriptor(transport, descriptor, this)
            .then((device: Device) => {
                return device;
            }).catch(error => {
                if (error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE || error.toString() === WEBUSB_ERROR_TOSTRING) {
                    if (previous == null) {
                        return this._createUnacquiredDevice(transport, descriptor, stream);
                    } else {
                        this.unacquiredDevices[previous.originalDescriptor.path.toString()] = previous;
                        return previous;
                    }
                }
                this.errorEvent.emit(error);
                throw error;
            });
        return devRes;
    }

    _createUnacquiredDevice(
        transport: Transport,
        descriptor: DeviceDescriptor,
        stream: DescriptorStream
    ): Promise<UnacquiredDevice> {
        if (this.options.debugInfo) {
            console.log('[trezor.js] [device list] Creating Unacquired Device', descriptor);
        }

        // if (this.getSession(descriptor.path) == null) {
        //     return Promise.reject("Device no longer connected.");
        // }
        const res = UnacquiredDevice.fromDescriptor(transport, descriptor, this)
            .then((device: UnacquiredDevice) => {
                return device;
            }).catch(error => {
                this.errorEvent.emit(error);
            });
        return res;
    }

    getSession(path: string, debug: boolean): ?string {
        if (debug) {
            return this.debugSessions[path];
        }
        return this.sessions[path];
    }

    setHard(path: string, session: ?string, debug: boolean) {
        if (this.stream != null) {
            this.stream.setHard(path, session, debug);
        }
        if (debug) {
            this.debugSessions[path] = session;
        } else {
            this.sessions[path] = session;
        }
    }

    _initStream(transport: Transport) {
        const stream = new DescriptorStream(transport);

        stream.updateEvent.on((diff: DeviceDescriptorDiff) => {
            this.sessions = {};
            this.debugSessions = {};
            diff.descriptors.forEach(descriptor => {
                this.sessions[descriptor.path.toString()] = descriptor.session;
                this.debugSessions[descriptor.path.toString()] = descriptor.debugSession;
            });

            diff.connected.forEach((descriptor: DeviceDescriptor) => {
                const path = descriptor.path;

                // if descriptor is null => we can acquire the device
                if (descriptor.session == null) {
                    this._createAndSaveDevice(transport, descriptor, stream);
                } else {
                    this.creatingDevices[path.toString()] = true;
                    this._createUnacquiredDevice(transport, descriptor, stream).then(device => {
                        this.unacquiredDevices[path.toString()] = device;
                        delete this.creatingDevices[path.toString()];
                        this.connectUnacquiredEvent.emit(device);
                    });
                }
            });

            const events : Array<{d: Array<DeviceDescriptor>, e: Event1<Device>}> = [
                {
                    d: diff.changedSessions,
                    e: this.changedSessionsEvent,
                }, {
                    d: diff.acquired,
                    e: this.acquiredEvent,
                }, {
                    d: diff.released,
                    e: this.releasedEvent,
                },
                {
                    d: diff.debugChangedSessions,
                    e: this.debugChangedSessionsEvent,
                }, {
                    d: diff.debugAcquired,
                    e: this.debugAcquiredEvent,
                }, {
                    d: diff.debugReleased,
                    e: this.debugReleasedEvent,
                },
            ];

            events.forEach(({d, e}) => {
                d.forEach((descriptor: DeviceDescriptor) => {
                    const pathStr = descriptor.path.toString();
                    const device = this.devices[pathStr];
                    if (device != null) {
                        e.emit(device);
                    }
                });
            });

            diff.disconnected.forEach((descriptor: DeviceDescriptor) => {
                const path = descriptor.path;
                const pathStr = path.toString();
                const device = this.devices[pathStr];
                if (device != null) {
                    delete this.devices[pathStr];
                    this.disconnectEvent.emit(device);
                }

                const unacquiredDevice = this.unacquiredDevices[pathStr];
                if (unacquiredDevice != null) {
                    delete this.unacquiredDevices[pathStr];
                    this.disconnectUnacquiredEvent.emit(unacquiredDevice);
                }
            });

            diff.released.forEach((descriptor: DeviceDescriptor) => {
                const path = descriptor.path;
                const device = this.unacquiredDevices[path.toString()];

                if (device != null) {
                    const previous = this.unacquiredDevices[path.toString()];
                    delete this.unacquiredDevices[path.toString()];
                    this._createAndSaveDevice(transport, descriptor, stream, previous);
                }
            });

            this.updateEvent.emit(diff);
        });

        stream.errorEvent.on((error: Error) => {
            this.errorEvent.emit(error);
            stream.stop();
        });

        stream.listen();

        this.streamEvent.emit(stream);
    }

    onUnacquiredConnect(
        unacquiredDevice: UnacquiredDevice,
        listener: (device: Device, unacquiredDevice: ?UnacquiredDevice) => void
    ): void {
        const path = unacquiredDevice.originalDescriptor.path.toString();
        if (this.unacquiredDevices[path] == null) {
            if (this.creatingDevices[path] != null) {
                this.connectEvent.on(listener);
            } else if (this.devices[path] != null) {
                listener(this.devices[path], unacquiredDevice);
            }
        } else {
            this.connectEvent.on(listener);
        }
    }

    onUnacquiredDisconnect(
        unacquiredDevice: UnacquiredDevice,
        listener: (unacquiredDevice: UnacquiredDevice) => void
    ): void {
        const path = unacquiredDevice.originalDescriptor.path.toString();
        if (this.unacquiredDevices[path] == null) {
            if (this.creatingDevices[path] != null) {
                this.disconnectUnacquiredEvent.on(listener);
            } else if (this.devices[path] == null) {
                listener(unacquiredDevice);
            }
        } else {
            this.disconnectUnacquiredEvent.on(listener);
        }
    }

    onDisconnect(
        device: Device,
        listener: (device: Device) => void
    ): void {
        const path = device.originalDescriptor.path.toString();
        if (this.devices[path] == null && this.creatingDevices[path] == null) {
            listener(device);
        } else {
            this.disconnectEvent.on(listener);
        }
    }

    // If there is at least one physical device connected, returns it, steals it if necessary
    stealFirstDevice(rejectOnEmpty?: ?boolean): Promise<Device> {
        const devices = this.asArray();
        if (devices.length > 0) {
            return Promise.resolve(devices[0]);
        }
        const unacquiredDevices = this.unacquiredAsArray();
        if (unacquiredDevices.length > 0) {
            return unacquiredDevices[0].steal();
        }
        if (rejectOnEmpty) {
            return Promise.reject(new Error('No device connected'));
        } else {
            return new Promise((resolve, reject) => {
                this.connectEvent.once(() => {
                    this.stealFirstDevice().then(d => resolve(d), e => reject(e));
                });
            });
        }
    }

    // steals the first devices, acquires it and *never* releases it until the window is closed
    acquireFirstDevice(rejectOnEmpty?: ?boolean): Promise<{device: Device, session: Session}> {
        const timeoutPromiseFn = (t) => new Promise((resolve) => { setTimeout(() => resolve(), t); });

        return new Promise((resolve, reject) => {
            this.stealFirstDevice(rejectOnEmpty).then(
                (device) => {
                    device.run(session => {
                        resolve({device, session});
                        // this "inside" promise never resolves or rejects
                        return new Promise((resolve, reject) => {});
                    });
                },
                (err) => {
                    reject(err);
                }
            );
        }).catch((err) => {
            if (err.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE) {
                return timeoutPromiseFn(1000).then(() => this.acquireFirstDevice(rejectOnEmpty));
            }
            throw err;
        });
    }

    _setUnreadableHidDeviceChange(): void {
        if (DeviceList.node) {
            return;
        }
        try {
            const transport = this.transport;
            if (transport == null) {
                return;
            }
            // $FlowIssue - this all is going around Flow :/
            const activeTransport = transport.activeTransport;
            if (activeTransport == null || activeTransport.name !== 'ParallelTransport') {
                return;
            }
            const webusbTransport = activeTransport.workingTransports['webusb'];
            if (webusbTransport == null) {
                return;
            }
            // one of the HID fallbacks are working -> do not display the message
            const hidTransport = activeTransport.workingTransports['hid'];
            if (hidTransport != null) {
                return;
            }
            return webusbTransport.plugin.unreadableHidDeviceChange.on('change', () => this.unreadableHidDeviceChange.emit('change'));
        } catch (e) {
            return;
        }
    }

    unreadableHidDevice(): boolean {
        if (DeviceList.node) {
            return false;
        }
        try {
            const transport = this.transport;
            if (transport == null) {
                return false;
            }
            // $FlowIssue - this all is going around Flow :/
            const activeTransport = transport.activeTransport;
            if (activeTransport == null || activeTransport.name !== 'ParallelTransport') {
                return false;
            }
            const webusbTransport = activeTransport.workingTransports['webusb'];
            if (webusbTransport == null) {
                return false;
            }
            // one of the HID fallbacks are working -> do not display the message
            const hidTransport = activeTransport.workingTransports['hid'];
            if (hidTransport != null) {
                return false;
            }
            return webusbTransport.plugin.unreadableHidDevice;
        } catch (e) {
            return false;
        }
    }

    onbeforeunload(clearSession?: ?boolean) {
        this.asArray().forEach(device => device.onbeforeunload(clearSession));
        // some weird issue on chrome on mac makes the window alive
        // even after closing
        // we need to stop the stream
        if (this.stream != null) {
            this.stream.stop();
        }
        if (this.transport != null) {
            this.transport.stop();
        }
    }
}

function objectValues<X>(object: {[key: string]: X}): Array<X> {
    return Object.keys(object).map(key => object[key]);
}

