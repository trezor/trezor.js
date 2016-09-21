/* @flow */
'use strict';

import {EventEmitter} from './events';
import {Event1, Event2} from './flow-events';
import DescriptorStream from './descriptor-stream';
import Device from './device';
import UnacquiredDevice from './unacquired-device';

import type Session from './session';

import type {DeviceDescriptorDiff} from './descriptor-stream';

import type {
  Transport,
  TrezorDeviceInfoWithSession as DeviceDescriptor,
} from 'trezor-link';

import type LowlevelTransport from 'trezor-link/lib/lowlevel';
import type NodeHidPlugin from 'trezor-link/lib/lowlevel/node-hid';

import BridgeTransport from 'trezor-link/lib/bridge';
import FallbackTransport from 'trezor-link/lib/fallback';

const CONFIG_URL = 'https://wallet.mytrezor.com/data/config_signed.bin';

export type DeviceListOptions = {
    debug?: boolean;
    transport?: Transport;
    nodeTransport?: Transport;
    configUrl?: string;
    config?: string;
    bridgeVersionUrl?: string;
    clearSession?: boolean;
    clearSessionTime?: number;
    rememberDevicePasshprase?: boolean;
};

// a slight hack
// this error string is hard-coded
// in both bridge and extension
const WRONG_PREVIOUS_SESSION_ERROR_MESSAGE = 'wrong previous session';

//
// Events:
//
//  connect: Device
//  disconnect: Device
//  transport: Transport
//  stream: DescriptorStream
//
export default class DeviceList extends EventEmitter {

    // will be set if started by node.js
    static _LowlevelTransport: ?Class<LowlevelTransport> = null;
    static _NodeHidPlugin: ?Class<NodeHidPlugin> = null;

    // slight hack to make Flow happy, but to allow Node to set its own fetch
    // Request, RequestOptions and Response are built-in types of Flow for fetch API
    static _fetch: (input: string | Request, init?: RequestOptions) => Promise<Response> =
        typeof window === 'undefined'
        ? () => Promise.reject()
        : window.fetch;

    static _isNode: boolean = false;

    static _setNode(LowlevelTransport: Class<LowlevelTransport>, NodeHidPlugin: Class<NodeHidPlugin>, fetch: any) {
        DeviceList._isNode = true;
        DeviceList._LowlevelTransport = LowlevelTransport;
        DeviceList._NodeHidPlugin = NodeHidPlugin;
        DeviceList._fetch = fetch;
    }

    options: DeviceListOptions;
    transport: ?Transport;
    transportLoading: boolean = true;
    stream: ?DescriptorStream = null;
    devices: {[k: string]: Device} = {};
    unacquiredDevices: {[k: string]: UnacquiredDevice} = {};

    creatingDevices: {[k: string]: boolean} = {};

    sessions: {[path: string]: ?string} = {};

    errorEvent: Event1<Error> = new Event1('error', this);
    transportEvent: Event1<Transport> = new Event1('transport', this);
    streamEvent: Event1<DescriptorStream> = new Event1('stream', this);
    connectEvent: Event2<Device, ?UnacquiredDevice> = new Event2('connect', this);
    connectUnacquiredEvent: Event1<UnacquiredDevice> = new Event1('connectUnacquired', this);
    changedSessionsEvent: Event1<Device> = new Event1('changedSessions', this);
    acquiredEvent: Event1<Device> = new Event1('acquired', this);
    releasedEvent: Event1<Device> = new Event1('released', this);
    disconnectEvent: Event1<Device> = new Event1('disconnect', this);
    disconnectUnacquiredEvent: Event1<UnacquiredDevice> = new Event1('disconnectUnacquired', this);
    updateEvent: Event1<DeviceDescriptorDiff> = new Event1('update', this);

    constructor(options: ?DeviceListOptions) {
        super();

        this.options = options || {};

        this.transportEvent.on((transport: Transport) => {
            this.transport = transport;
            this.transportLoading = false;

            this._initStream(transport);
        });

        this.streamEvent.on(stream => {
            this.stream = stream;
        });

        // using setTimeout to emit 'transport' in next tick,
        // so people from outside can add listener after constructor finishes
        setTimeout(() => this._initTransport(), 0);
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

    _createTransport(): Transport {
        if (DeviceList._isNode) {
            const bridge = new BridgeTransport(undefined, undefined, DeviceList._fetch);

            const NodeHidPlugin = DeviceList._NodeHidPlugin;
            const LowlevelTransport = DeviceList._LowlevelTransport;

            if (NodeHidPlugin == null || LowlevelTransport == null) {
                throw new Error('No transport.');
            }

            return new FallbackTransport([bridge, new LowlevelTransport(new NodeHidPlugin())]);
        } else {
            const bridge = new BridgeTransport(undefined, undefined, DeviceList._fetch);

            const ExtensionTransport = require('trezor-link/lib/extension');
          // $FlowIssue ignore default export
            return new FallbackTransport([new ExtensionTransport(), bridge]);
        }
    }

    // for mytrezor - returns "bridge" or "extension", or something else :)
    transportType(): string {
        if (this.transport == null) {
            return '';
        }
        if (this.transport instanceof FallbackTransport) {
            if (this.transport.activeName === 'BridgeTransport') {
                return 'bridge';
            }
            if (this.transport.activeName === 'ExtensionTransport') {
                return 'extension';
            }
            return this.transport.activeName;
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
            const configUrl: string = this.options.configUrl == null ? CONFIG_URL : this.options.configUrl;
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
        const transport = this.options.transport ? this.options.transport : this._createTransport();
        transport.init(this.options.debug).then(() => {
            this._configTransport(transport).then(() => {
                this.transportEvent.emit(transport);
            });
        }, error => {
            this.errorEvent.emit(error);
        });
    }

    _createAndSaveDevice(
        transport: Transport,
        descriptor: DeviceDescriptor,
        stream: DescriptorStream,
        previous: ?UnacquiredDevice
    ): void {
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
                if (error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE) {
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

    getSession(path: string): ?string {
        return this.sessions[path];
    }

    setHard(path: string, session: ?string) {
        if (this.stream != null) {
            this.stream.setHard(path, session);
        }
        this.sessions[path] = session;
    }

    _initStream(transport: Transport) {
        const stream = new DescriptorStream(transport);

        stream.updateEvent.on((diff: DeviceDescriptorDiff) => {
            this.sessions = {};
            diff.descriptors.forEach(descriptor => {
                this.sessions[descriptor.path.toString()] = descriptor.session;
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
    stealFirstDevice(): Promise<Device> {
        const devices = this.asArray();
        if (devices.length > 0) {
            return Promise.resolve(devices[0]);
        }
        const unacquiredDevices = this.unacquiredAsArray();
        if (unacquiredDevices.length > 0) {
            return unacquiredDevices[0].steal();
        }
        return Promise.reject(new Error('No device connected'));
    }

    // steals the first devices, acquires it and *never* releases it until the window is closed
    acquireFirstDevice(): Promise<{device: Device, session: Session}> {
        return new Promise((resolve, reject) => {
            this.stealFirstDevice().then(
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
        });
    }

    onbeforeunload(clearSession?: ?boolean) {
        this.asArray().forEach(device => device.onbeforeunload(clearSession));
    }

}

function objectValues<X>(object: {[key: string]: X}): Array<X> {
    return Object.keys(object).map(key => object[key]);
}

