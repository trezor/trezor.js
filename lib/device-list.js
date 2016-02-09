/* @flow */
'use strict';

import EventEmitter from 'events';
import {initTransport} from './transport';
import DescriptorStream from './descriptor-stream';
import Device from './device';
import UnacquiredDevice from './unacquired-device';

import type {Transport, DeviceDescriptor} from './session';
import type {DeviceDescriptorDiff} from './descriptor-stream';

// a slight hack
// this error string is hard-coded
// in both bridge and extension
const WRONG_PREVIOUS_SESSION_ERROR_MESSAGE = 'wrong previous session';

type Options = {
    transport?: Transport;
};

type FixLaterUnacquiredDevice = any;

//
// Events:
//
//  connect: Device
//  disconnect: Device
//  transport: Transport
//  stream: DescriptorStream
//
export default class DeviceList extends EventEmitter {

    options: Options;
    transport: ?Transport;
    stream: ?DescriptorStream;
    devices: {[k: string]: Device};
    unacquiredDevices: {[k: string]: FixLaterUnacquiredDevice};
    sessions: {[path: string]: ?string};

    constructor(options: ?Options) {
        super();

        this.options = options || {};
        this.stream = null;
        this.devices = {};
        this.unacquiredDevices = {};
        this.sessions = {};

        this.on('transport', (transport: Transport) => {
            this.transport = transport;
            this._initStream(transport);
        });

        this.on('stream', stream => {
            this.stream = stream;
        });

        this._initTransport();
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

    _createDevice(transport: Transport, path: string, stream: DescriptorStream) {
        Device.fromPath(transport, path, this)
            .then((device: Device) => {
                this.devices[path] = device;
                const previousDevice = this.unacquiredDevices[path];
                if (previousDevice != null) {
                    delete this.unacquiredDevices[path];
                }
                this.emit('connect', device, previousDevice);
                return;
            }).catch(error => {
                if (error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE) {
                    const previousDevice = this.unacquiredDevices[path];
                    if (previousDevice == null) {
                        this._createUnacquiredDevice(transport, path, stream);
                    }
                } else {
                    this.emit('error', error);
                }
            });
    }

    // FOR DEBUGGING
    // emit(event: string, ...args: Array<any>) {
    //     console.log("[device-list] Emitting", event, ...args);
    //     super.emit(event, ...args);
    // }

    _createUnacquiredDevice(transport: Transport, path: string, stream: DescriptorStream) {
        UnacquiredDevice.fromPath(transport, path, this)
            .then((device: UnacquiredDevice) => {
                this.unacquiredDevices[path] = device;
                console.log('Connected unacquired');
                this.emit('connectUnacquired', device);
                return;
            }).catch(error => {
                this.emit('error', error);
            });
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

            ['changedSessions', 'acquired', 'released'].forEach(type => {
                diff[type].forEach((descriptor: DeviceDescriptor) => {
                    const path = descriptor.path;
                    const device = this.devices[path];
                    this.emit(type, device);
                });
            });

            diff.connected.forEach((descriptor: DeviceDescriptor) => {
                const path = descriptor.path;

                // if descriptor is null => we can acquire the device
                if (descriptor.session == null) {
                    this._createDevice(transport, path, stream);
                } else {
                    this._createUnacquiredDevice(transport, path, stream);
                }
            });

            diff.disconnected.forEach((descriptor: DeviceDescriptor) => {
                const path = descriptor.path;
                const device = this.devices[path];

                delete this.devices[path];

                this.emit('disconnect', device);
            });

            diff.released.forEach((descriptor: DeviceDescriptor) => {
                const path = descriptor.path;
                const device = this.unacquiredDevices[path];

                if (device != null) {
                    this._createDevice(transport, path, stream);
                }
            });

            this.emit('update');
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

