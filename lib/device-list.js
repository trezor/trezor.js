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

    devicesPromises: {[k: string]: Promise<Device | UnacquiredDevice>} = {};

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

    _createDevice(
        transport: Transport,
        descriptor: DeviceDescriptor,
        stream: DescriptorStream
    ): Promise<Device|UnacquiredDevice> {
        const path = descriptor.path;
        const devRes: Promise<Device | UnacquiredDevice> = Device.fromDescriptor(transport, descriptor, this)
            .then((device: Device) => {
                this.devices[path] = device;
                const previousDevice = this.unacquiredDevices[path];
                if (previousDevice != null) {
                    delete this.unacquiredDevices[path];
                }
                this.connectEvent.emit(device, previousDevice);
                return device;
            }).catch(error => {
                if (error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE) {
                    const previousDevice = this.unacquiredDevices[path];
                    if (previousDevice == null) {
                        return this._createUnacquiredDevice(transport, descriptor, stream);
                    }
                } else {
                    this.errorEvent.emit(error);
                    throw error;
                }
            });
        return devRes;
    }

    // FOR DEBUGGING
    // emit(event: string, ...args: Array<any>) {
    //     console.log("[device-list] Emitting", event, ...args);
    //     super.emit(event, ...args);
    // }

    _createUnacquiredDevice(
        transport: Transport,
        descriptor: DeviceDescriptor,
        stream: DescriptorStream
    ): Promise<UnacquiredDevice> {
        const path = descriptor.path;
        const res = UnacquiredDevice.fromDescriptor(transport, descriptor, this)
            .then((device: UnacquiredDevice) => {
                this.unacquiredDevices[path] = device;
                console.log('Connected unacquired');
                this.connectUnacquiredEvent.emit(device);
                return device;
            }).catch(error => {
                this.errorEvent.emit(error);
            });
        return res;
    }

    getSession(path: string): ?string {
        return this.sessions[path];
    }

    _initStream(transport: Transport) {
        const stream = new DescriptorStream(transport);

        stream.updateEvent.on((diff: DeviceDescriptorDiff) => {
            diff.descriptors.forEach(descriptor => {
                this.sessions[descriptor.path] = descriptor.session;
            });

            diff.connected.forEach((descriptor: DeviceDescriptor) => {
                const path = descriptor.path;

                // if descriptor is null => we can acquire the device
                if (descriptor.session == null) {
                    this.devicesPromises[path] = this._createDevice(transport, descriptor, stream);
                } else {
                    this.devicesPromises[path] = this._createUnacquiredDevice(transport, descriptor, stream);
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
                    const path = descriptor.path;
                    const deviceP = this.devicesPromises[path];
                    deviceP.then((device) => {
                        if (device instanceof Device) {
                            e.emit(device);
                        }
                    });
                });
            });

            diff.disconnected.forEach((descriptor: DeviceDescriptor) => {
                const path = descriptor.path;
                const deviceP = this.devicesPromises[path];
                deviceP.then(device => {
                    if (device instanceof Device) {
                        delete this.devices[path];
                        this.disconnectEvent.emit(device);
                    } else {
                        delete this.unacquiredDevices[path];
                        this.disconnectUnacquiredEvent.emit(device);
                    }
                });
            });

            diff.released.forEach((descriptor: DeviceDescriptor) => {
                const path = descriptor.path;
                const device = this.unacquiredDevices[path];

                if (device != null) {
                    this._createDevice(transport, descriptor, stream);
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

    onbeforeunload() {
        this.asArray().forEach(device => device.onbeforeunload());
    }

}

function objectValues<X>(object: {[key: string]: X}): Array<X> {
    return Object.keys(object).map(key => object[key]);
}

