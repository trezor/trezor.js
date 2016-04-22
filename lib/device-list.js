/* @flow */
'use strict';

import {EventEmitter} from './events';
import {Event1, Event2} from './flow-events';
import {initTransport} from './transport';
import DescriptorStream from './descriptor-stream';
import Device from './device';
import UnacquiredDevice from './unacquired-device';

import type {DeviceDescriptorDiff} from './descriptor-stream';
import type {
    Transport,
    DeviceDescriptor,
} from './transport';

export type DeviceListOptions = {
    transport?: Transport;
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

    options: DeviceListOptions;
    transport: ?Transport;
    stream: ?DescriptorStream = null;
    devices: {[k: string]: Device} = {};
    unacquiredDevices: {[k: string]: UnacquiredDevice} = {};

    // acquiringDevices -> when going from unacquired to normal
    acquiringDevices: {[k: string]: UnacquiredDevice} = {};

    // creating - when anything happens at all
    creatingDevices: {[k: string]: boolean} = {};

    sessions: {[path: string]: ?(string|number)} = {};

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

    _initTransport() {
        if (this.options.transport) {
            this.transportEvent.emit(this.options.transport);
        } else {
            initTransport(this.options)
                .then(transport => {
                    this.transportEvent.emit(transport);
                    return;
                })
                .catch(error => {
                    this.errorEvent.emit(error);
                });
        }
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
                delete this.acquiringDevices[path];
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

    getSession(path: (string|number)): ?(string|number) {
        return this.sessions[path.toString()];
    }

    setHard(path: (string|number), session: ?(string | number)) {
        if (this.stream != null) {
            this.stream.setHard(path, session);
        }
        this.sessions[path.toString()] = session;
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
                    this.acquiringDevices[path.toString()] = previous;
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
            if (this.acquiringDevices[path] != null) {
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

    onbeforeunload(clearSession?: ?boolean) {
        this.asArray().forEach(device => device.onbeforeunload(clearSession));
    }

}

function objectValues<X>(object: {[key: string]: X}): Array<X> {
    return Object.keys(object).map(key => object[key]);
}

