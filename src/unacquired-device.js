/* @flow */
'use strict';

import Device from './device';
import {EventEmitter} from './events';
import {Event0, Event1} from './flow-events';

import type {Transport, TrezorDeviceInfoWithSession as DeviceDescriptor} from 'trezor-link';
import type DeviceList from './device-list';

export default class UnacquiredDevice extends EventEmitter {
    transport: Transport;
    deviceList: DeviceList;
    originalDescriptor: DeviceDescriptor;
    connected: boolean = true; // note - if the device is changed to Device, this is also false

    connectEvent: Event1<Device> = new Event1('connect', this);
    disconnectEvent: Event0 = new Event0('disconnect', this);

    constructor(transport: Transport, descriptor: DeviceDescriptor, deviceList: DeviceList) {
        super();
        this.transport = transport;
        this.originalDescriptor = descriptor;
        this.deviceList = deviceList;
        this._watch();
    }

    _watchConnectDisconnect(
        onConnect: (device: Device) => any,
        onDisconnect: () => any
    ) {
        let disconnectListener: (d: UnacquiredDevice) => void = (dev) => {};
        const connectListener = (device, unacquiredDevice) => {
            if (this === unacquiredDevice) {
                this.deviceList.connectEvent.removeListener(connectListener);
                this.deviceList.disconnectUnacquiredEvent.removeListener(disconnectListener);
                onConnect(device);
            }
        };
        disconnectListener = (unacquiredDevice) => {
            if (this === unacquiredDevice) {
                this.deviceList.connectEvent.removeListener(connectListener);
                this.deviceList.disconnectUnacquiredEvent.removeListener(disconnectListener);
                onDisconnect();
            }
        };
        this.deviceList.onUnacquiredConnect(this, connectListener);
        this.deviceList.onUnacquiredDisconnect(this, disconnectListener);
    }

    // returns Promise just to be similar to Device.fromPath
    static fromDescriptor(transport: Transport, descriptor: DeviceDescriptor, deviceList: DeviceList) {
        return Promise.resolve(new UnacquiredDevice(transport, descriptor, deviceList));
    }

    // what steal() does is that it does not actually keep the session for itself
    // because it immediately releases it again;
    // however, it might stop some other process in another app,
    // so the device will become "usable".
    // This function actually returns the new Device object
    steal(): Promise<Device> {
        // I will simultaniously run initialization and wait for devicelist to return device to me
        const result = new Promise((resolve, reject) => {
            this._watchConnectDisconnect(
                device => resolve(device),
                () => reject(new Error('Device disconnected before grabbing'))
            );
        });
        const currentSession = this.deviceList.getSession(this.originalDescriptor.path, false);
        const descriptor = { ...this.originalDescriptor, session: currentSession };

        // if the run fails, I want to return that error, I guess
        const aggressiveRunResult = Device._run(() => {
            return true;
        }, this.transport, descriptor, this.deviceList, null, null, null, false);
        return aggressiveRunResult.then(() => result);
    }

    _watch() {
        this._watchConnectDisconnect(device => {
            this.connected = false;
            this.connectEvent.emit(device);
        }, () => {
            this.connected = false;
            this.disconnectEvent.emit();
        });
    }
}
