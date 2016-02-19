/* @flow */
'use strict';

import Device from './device';

import type {Transport} from './flowtypes';
import type DeviceList from './device-list';
import {EventEmitter} from './events-flowtype-bug';

export default class UnacquiredDevice extends EventEmitter {
    transport: Transport;
    deviceList: DeviceList;
    path: string;

    constructor(transport: Transport, path: string, deviceList: DeviceList) {
        super();

        // === immutable properties
        this.transport = transport;
        this.path = path;
        this.deviceList = deviceList;
        this._watch();
    }

    // returns Promise just to be similar to Device.fromPath
    static fromPath(transport: Transport, path: string, deviceList: DeviceList) {
        return Promise.resolve(new UnacquiredDevice(transport, path, deviceList));
    }

    // what steal() does is that it does not actually keep the session for itself
    // because it immediately releases it again;
    // however, it might stop some other process in another app,
    // so the device will become "usable".
    // This function actually returns the new Device object
    steal(): Promise {
        // I will simultaniously run initialization and wait for devicelist to return device to me
        const result = new Promise(resolve => {
            this.deviceList.on('connect', function onConnect(device, unacquiredDevice) {
                if (this === unacquiredDevice) {
                    this.deviceList.removeListener('connect', onConnect);
                    resolve(device);
                }
            }.bind(this));
        });
        const currentSession: ?string = this.deviceList.getSession(this.path);
        const descriptor = {path: this.path, session: currentSession};
        Device._run(() => {
            return true;
        }, this.transport, descriptor);
        return result;
    }

    _watch() {
        this.deviceList.on('disconnect', function onDisconnect(device) {
            if (device === this) {
                this.emit('disconnect');
                this.deviceList.removeListener('disconnect', onDisconnect);
            }
        }.bind(this));

        this.deviceList.on('connect', function onConnect(device, unacquiredDevice) {
            if (this === unacquiredDevice) {
                this.deviceList.removeListener('acquire', onConnect);
            }
        }.bind(this));
    }
}
