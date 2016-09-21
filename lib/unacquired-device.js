'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _device = require('./device');

var _device2 = _interopRequireDefault(_device);

var _events = require('./events');

var _flowEvents = require('./flow-events');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class UnacquiredDevice extends _events.EventEmitter {
    // note - if the device is changed to Device, this is also false

    constructor(transport, descriptor, deviceList) {
        super();
        this.connected = true;
        this.connectEvent = new _flowEvents.Event1('connect', this);
        this.disconnectEvent = new _flowEvents.Event0('disconnect', this);
        this.transport = transport;
        this.originalDescriptor = descriptor;
        this.deviceList = deviceList;
        this._watch();
    }

    _watchConnectDisconnect(onConnect, onDisconnect) {
        let _disconnectListener = dev => {};
        const connectListener = (device, unacquiredDevice) => {
            if (this === unacquiredDevice) {
                this.deviceList.connectEvent.removeListener(connectListener);
                this.deviceList.disconnectUnacquiredEvent.removeListener(_disconnectListener);
                onConnect(device);
            }
        };
        _disconnectListener = unacquiredDevice => {
            if (this === unacquiredDevice) {
                this.deviceList.connectEvent.removeListener(connectListener);
                this.deviceList.disconnectUnacquiredEvent.removeListener(_disconnectListener);
                onDisconnect();
            }
        };
        this.deviceList.onUnacquiredConnect(this, connectListener);
        this.deviceList.onUnacquiredDisconnect(this, _disconnectListener);
    }

    // returns Promise just to be similar to Device.fromPath
    static fromDescriptor(transport, descriptor, deviceList) {
        return Promise.resolve(new UnacquiredDevice(transport, descriptor, deviceList));
    }

    // what steal() does is that it does not actually keep the session for itself
    // because it immediately releases it again;
    // however, it might stop some other process in another app,
    // so the device will become "usable".
    // This function actually returns the new Device object
    steal() {
        // I will simultaniously run initialization and wait for devicelist to return device to me
        const result = new Promise((resolve, reject) => {
            this._watchConnectDisconnect(device => resolve(device), () => reject(new Error('Device disconnected before grabbing')));
        });
        const currentSession = this.deviceList.getSession(this.originalDescriptor.path);
        const descriptor = _extends({}, this.originalDescriptor, { session: currentSession });

        // if the run fails, I want to return that error, I guess
        const aggressiveRunResult = _device2.default._run(() => {
            return true;
        }, this.transport, descriptor, this.deviceList);
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
exports.default = UnacquiredDevice;
module.exports = exports['default'];