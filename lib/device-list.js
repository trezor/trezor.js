/* @flow */
'use strict';

import {EventEmitter} from './events';
import {initTransport} from './transport';
import DescriptorStream from './descriptor-stream';
import Device from './device';
import UnacquiredDevice from './unacquired-device';

import type {DeviceDescriptorDiff, Transport, DeviceDescriptor, DeviceListOptions} from './flowtypes';

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
    stream: ?DescriptorStream;
    devices: {[k: string]: Device};
    unacquiredDevices: {[k: string]: UnacquiredDevice};

    devicesPromises: {[k: string]: Promise<Device | UnacquiredDevice>};

    sessions: {[path: string]: ?string};

    constructor(options: ?DeviceListOptions) {
        super();

        this.options = options || {};
        this.stream = null;
        this.devices = {};
        this.unacquiredDevices = {};
        this.devicesPromises = {};
        this.sessions = {};

        this.on('transport', (transport: Transport) => {
            this.transport = transport;

            this._initStream(transport);
        });

        this.on('stream', stream => {
            this.stream = stream;
        });

        // using setTimeout to emit 'transport' in next tick,
        // so people from outside can add listener after constructor finishes
        setTimeout(() => this._initTransport(), 0);
    }

    asArray(): Array<Device> {
        const array = [];
        for (const key in this.devices) {
            if (this.devices.hasOwnProperty(key)) {
                array.push(this.devices[key]);
            }
        }
        return array;
    }

    _initTransport() {
        if (this.options.transport) {
            this.emit('transport', this.options.transport);
        } else {
            initTransport(this.options)
                .then(transport => {
                    this.emit('transport', transport);
                    return;
                })
                .catch(error => {
                    this.emit('error', error);
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
                this.emit('connect', device, previousDevice);
                return device;
            }).catch(error => {
                if (error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE) {
                    const previousDevice = this.unacquiredDevices[path];
                    if (previousDevice == null) {
                        return this._createUnacquiredDevice(transport, descriptor, stream);
                    }
                } else {
                    this.emit('error', error);
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
                this.emit('connectUnacquired', device);
                return device;
            }).catch(error => {
                this.emit('error', error);
            });
        return res;
    }

    getSession(path: string): ?string {
        return this.sessions[path];
    }

    _initStream(transport: Transport) {
        const stream = new DescriptorStream(transport);

        stream.on('update', (diff: DeviceDescriptorDiff) => {
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

            ['changedSessions', 'acquired', 'released'].forEach(type => {
                diff[type].forEach((descriptor: DeviceDescriptor) => {
                    const path = descriptor.path;
                    const deviceP = this.devicesPromises[path];
                    deviceP.then((device) => {
                        if (device instanceof Device) {
                            this.emit(type, device);
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
                        this.emit('disconnect', device);
                    } else {
                        delete this.unacquiredDevices[path];
                        this.emit('disconnectUnacquired', device);
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

            this.emit('update', diff);
        });

        stream.on('error', (error: Error) => {
            this.emit('error', error);
            stream.stop();
        });

        stream.listen();

        this.emit('stream', stream);
    }

    onbeforeunload() {
        this.asArray().forEach(device => device.onbeforeunload());
    }

}

