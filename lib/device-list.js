'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _events = require('./events');

var _flowEvents = require('./flow-events');

var _descriptorStream = require('./descriptor-stream');

var _descriptorStream2 = _interopRequireDefault(_descriptorStream);

var _device = require('./device');

var _device2 = _interopRequireDefault(_device);

var _unacquiredDevice = require('./unacquired-device');

var _unacquiredDevice2 = _interopRequireDefault(_unacquiredDevice);

var _bridge = require('trezor-link/lib/bridge');

var _bridge2 = _interopRequireDefault(_bridge);

var _fallback = require('trezor-link/lib/fallback');

var _fallback2 = _interopRequireDefault(_fallback);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const CONFIG_URL = 'https://wallet.mytrezor.com/data/config_signed.bin';

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
class DeviceList extends _events.EventEmitter {

    // slight hack to make Flow happy, but to allow Node to set its own fetch
    // Request, RequestOptions and Response are built-in types of Flow for fetch API


    // will be set if started by node.js
    static _setNode(LowlevelTransport, NodeHidPlugin, fetch) {
        DeviceList._isNode = true;
        DeviceList._LowlevelTransport = LowlevelTransport;
        DeviceList._NodeHidPlugin = NodeHidPlugin;
        DeviceList._fetch = fetch;
    }

    constructor(options) {
        super();

        this.transportLoading = true;
        this.stream = null;
        this.devices = {};
        this.unacquiredDevices = {};
        this.creatingDevices = {};
        this.sessions = {};
        this.errorEvent = new _flowEvents.Event1('error', this);
        this.transportEvent = new _flowEvents.Event1('transport', this);
        this.streamEvent = new _flowEvents.Event1('stream', this);
        this.connectEvent = new _flowEvents.Event2('connect', this);
        this.connectUnacquiredEvent = new _flowEvents.Event1('connectUnacquired', this);
        this.changedSessionsEvent = new _flowEvents.Event1('changedSessions', this);
        this.acquiredEvent = new _flowEvents.Event1('acquired', this);
        this.releasedEvent = new _flowEvents.Event1('released', this);
        this.disconnectEvent = new _flowEvents.Event1('disconnect', this);
        this.disconnectUnacquiredEvent = new _flowEvents.Event1('disconnectUnacquired', this);
        this.updateEvent = new _flowEvents.Event1('update', this);
        this.options = options || {};

        this.transportEvent.on(transport => {
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

    asArray() {
        return objectValues(this.devices);
    }

    unacquiredAsArray() {
        return objectValues(this.unacquiredDevices);
    }

    hasDeviceOrUnacquiredDevice() {
        return this.asArray().length + this.unacquiredAsArray().length > 0;
    }

    _createTransport() {
        if (DeviceList._isNode) {
            const bridge = new _bridge2.default(undefined, undefined, DeviceList._fetch);

            const NodeHidPlugin = DeviceList._NodeHidPlugin;
            const LowlevelTransport = DeviceList._LowlevelTransport;

            if (NodeHidPlugin == null || LowlevelTransport == null) {
                throw new Error('No transport.');
            }

            return new _fallback2.default([bridge, new LowlevelTransport(new NodeHidPlugin())]);
        } else {
            const bridge = new _bridge2.default(undefined, undefined, DeviceList._fetch);

            const ExtensionTransport = require('trezor-link/lib/extension');
            // $FlowIssue ignore default export
            return new _fallback2.default([new ExtensionTransport(), bridge]);
        }
    }

    // for mytrezor - returns "bridge" or "extension", or something else :)
    transportType() {
        if (this.transport == null) {
            return '';
        }
        if (this.transport instanceof _fallback2.default) {
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

    transportVersion() {
        if (this.transport == null) {
            return '';
        }
        return this.transport.version;
    }

    transportOutdated() {
        if (this.transport == null) {
            return false;
        }
        if (this.transport.isOutdated) {
            return true;
        }
        return false;
    }

    _configTransport(transport) {
        if (this.options.config != null) {
            return transport.configure(this.options.config);
        } else {
            const configUrl = this.options.configUrl == null ? CONFIG_URL : this.options.configUrl;
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

    _createAndSaveDevice(transport, descriptor, stream, previous) {
        const path = descriptor.path.toString();
        this.creatingDevices[path] = true;
        this._createDevice(transport, descriptor, stream, previous).then(device => {
            if (device instanceof _device2.default) {
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

    _createDevice(transport, descriptor, stream, previous) {
        const devRes = _device2.default.fromDescriptor(transport, descriptor, this).then(device => {
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

    _createUnacquiredDevice(transport, descriptor, stream) {
        // if (this.getSession(descriptor.path) == null) {
        //     return Promise.reject("Device no longer connected.");
        // }
        const res = _unacquiredDevice2.default.fromDescriptor(transport, descriptor, this).then(device => {
            return device;
        }).catch(error => {
            this.errorEvent.emit(error);
        });
        return res;
    }

    getSession(path) {
        return this.sessions[path];
    }

    setHard(path, session) {
        if (this.stream != null) {
            this.stream.setHard(path, session);
        }
        this.sessions[path] = session;
    }

    _initStream(transport) {
        const stream = new _descriptorStream2.default(transport);

        stream.updateEvent.on(diff => {
            this.sessions = {};
            diff.descriptors.forEach(descriptor => {
                this.sessions[descriptor.path.toString()] = descriptor.session;
            });

            diff.connected.forEach(descriptor => {
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

            const events = [{
                d: diff.changedSessions,
                e: this.changedSessionsEvent
            }, {
                d: diff.acquired,
                e: this.acquiredEvent
            }, {
                d: diff.released,
                e: this.releasedEvent
            }];

            events.forEach(_ref => {
                let d = _ref.d;
                let e = _ref.e;

                d.forEach(descriptor => {
                    const pathStr = descriptor.path.toString();
                    const device = this.devices[pathStr];
                    if (device != null) {
                        e.emit(device);
                    }
                });
            });

            diff.disconnected.forEach(descriptor => {
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

            diff.released.forEach(descriptor => {
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

        stream.errorEvent.on(error => {
            this.errorEvent.emit(error);
            stream.stop();
        });

        stream.listen();

        this.streamEvent.emit(stream);
    }

    onUnacquiredConnect(unacquiredDevice, listener) {
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

    onUnacquiredDisconnect(unacquiredDevice, listener) {
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

    onDisconnect(device, listener) {
        const path = device.originalDescriptor.path.toString();
        if (this.devices[path] == null && this.creatingDevices[path] == null) {
            listener(device);
        } else {
            this.disconnectEvent.on(listener);
        }
    }

    // If there is at least one physical device connected, returns it, steals it if necessary
    stealFirstDevice() {
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
    acquireFirstDevice() {
        return new Promise((resolve, reject) => {
            this.stealFirstDevice().then(device => {
                device.run(session => {
                    resolve({ device: device, session: session });
                    // this "inside" promise never resolves or rejects
                    return new Promise((resolve, reject) => {});
                });
            }, err => {
                reject(err);
            });
        });
    }

    onbeforeunload(clearSession) {
        this.asArray().forEach(device => device.onbeforeunload(clearSession));
    }

}

exports.default = DeviceList;
DeviceList._LowlevelTransport = null;
DeviceList._NodeHidPlugin = null;
DeviceList._fetch = typeof window === 'undefined' ? () => Promise.reject() : window.fetch;
DeviceList._isNode = false;
function objectValues(object) {
    return Object.keys(object).map(key => object[key]);
}
module.exports = exports['default'];