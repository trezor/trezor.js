'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require('./events');

var _flowEvents = require('./flow-events');

var _descriptorStream = require('./descriptor-stream');

var _descriptorStream2 = _interopRequireDefault(_descriptorStream);

var _device = require('./device');

var _device2 = _interopRequireDefault(_device);

var _unacquiredDevice = require('./unacquired-device');

var _unacquiredDevice2 = _interopRequireDefault(_unacquiredDevice);

var _bridge2 = require('trezor-link/lib/bridge');

var _bridge3 = _interopRequireDefault(_bridge2);

var _fallback = require('trezor-link/lib/fallback');

var _fallback2 = _interopRequireDefault(_fallback);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var CONFIG_URL = 'https://wallet.mytrezor.com/data/config_signed.bin';

// a slight hack
// this error string is hard-coded
// in both bridge and extension
var WRONG_PREVIOUS_SESSION_ERROR_MESSAGE = 'wrong previous session';

//
// Events:
//
//  connect: Device
//  disconnect: Device
//  transport: Transport
//  stream: DescriptorStream
//

var DeviceList = function (_EventEmitter) {
    _inherits(DeviceList, _EventEmitter);

    _createClass(DeviceList, null, [{
        key: '_setNode',


        // slight hack to make Flow happy, but to allow Node to set its own fetch
        // Request, RequestOptions and Response are built-in types of Flow for fetch API


        // will be set if started by node.js
        value: function _setNode(LowlevelTransport, NodeHidPlugin, fetch) {
            DeviceList._isNode = true;
            DeviceList._LowlevelTransport = LowlevelTransport;
            DeviceList._NodeHidPlugin = NodeHidPlugin;
            DeviceList._fetch = fetch;
        }
    }]);

    function DeviceList(options) {
        _classCallCheck(this, DeviceList);

        var _this = _possibleConstructorReturn(this, (DeviceList.__proto__ || Object.getPrototypeOf(DeviceList)).call(this));

        _this.transportLoading = true;
        _this.stream = null;
        _this.devices = {};
        _this.unacquiredDevices = {};
        _this.creatingDevices = {};
        _this.sessions = {};
        _this.errorEvent = new _flowEvents.Event1('error', _this);
        _this.transportEvent = new _flowEvents.Event1('transport', _this);
        _this.streamEvent = new _flowEvents.Event1('stream', _this);
        _this.connectEvent = new _flowEvents.Event2('connect', _this);
        _this.connectUnacquiredEvent = new _flowEvents.Event1('connectUnacquired', _this);
        _this.changedSessionsEvent = new _flowEvents.Event1('changedSessions', _this);
        _this.acquiredEvent = new _flowEvents.Event1('acquired', _this);
        _this.releasedEvent = new _flowEvents.Event1('released', _this);
        _this.disconnectEvent = new _flowEvents.Event1('disconnect', _this);
        _this.disconnectUnacquiredEvent = new _flowEvents.Event1('disconnectUnacquired', _this);
        _this.updateEvent = new _flowEvents.Event1('update', _this);


        _this.options = options || {};

        _this.transportEvent.on(function (transport) {
            _this.transport = transport;
            _this.transportLoading = false;

            _this._initStream(transport);
        });

        _this.streamEvent.on(function (stream) {
            _this.stream = stream;
        });

        // using setTimeout to emit 'transport' in next tick,
        // so people from outside can add listener after constructor finishes
        setTimeout(function () {
            return _this._initTransport();
        }, 0);
        return _this;
    }

    _createClass(DeviceList, [{
        key: 'asArray',
        value: function asArray() {
            return objectValues(this.devices);
        }
    }, {
        key: 'unacquiredAsArray',
        value: function unacquiredAsArray() {
            return objectValues(this.unacquiredDevices);
        }
    }, {
        key: 'hasDeviceOrUnacquiredDevice',
        value: function hasDeviceOrUnacquiredDevice() {
            return this.asArray().length + this.unacquiredAsArray().length > 0;
        }
    }, {
        key: '_createTransport',
        value: function _createTransport() {
            if (DeviceList._isNode) {
                var bridge = new _bridge3.default(undefined, undefined, DeviceList._fetch);

                var _NodeHidPlugin = DeviceList._NodeHidPlugin;
                var _LowlevelTransport = DeviceList._LowlevelTransport;

                if (_NodeHidPlugin == null || _LowlevelTransport == null) {
                    throw new Error('No transport.');
                }

                return new _fallback2.default([bridge, new _LowlevelTransport(new _NodeHidPlugin())]);
            } else {
                var _bridge = new _bridge3.default(undefined, undefined, DeviceList._fetch);

                var ExtensionTransport = require('trezor-link/lib/extension');
                // $FlowIssue ignore default export
                return new _fallback2.default([new ExtensionTransport(), _bridge]);
            }
        }

        // for mytrezor - returns "bridge" or "extension", or something else :)

    }, {
        key: 'transportType',
        value: function transportType() {
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
    }, {
        key: 'transportVersion',
        value: function transportVersion() {
            if (this.transport == null) {
                return '';
            }
            return this.transport.version;
        }
    }, {
        key: 'transportOutdated',
        value: function transportOutdated() {
            if (this.transport == null) {
                return false;
            }
            if (this.transport.isOutdated) {
                return true;
            }
            return false;
        }
    }, {
        key: '_configTransport',
        value: function _configTransport(transport) {
            if (this.options.config != null) {
                return transport.configure(this.options.config);
            } else {
                var _configUrl = this.options.configUrl == null ? CONFIG_URL : this.options.configUrl;
                var fetch = DeviceList._fetch;
                return fetch(_configUrl).then(function (response) {
                    if (!response.ok) {
                        throw new Error('Wrong config response.');
                    }
                    return response.text();
                }).then(function (config) {
                    return transport.configure(config);
                });
            }
        }
    }, {
        key: '_initTransport',
        value: function _initTransport() {
            var _this2 = this;

            var transport = this.options.transport ? this.options.transport : this._createTransport();
            transport.init(this.options.debug).then(function () {
                _this2._configTransport(transport).then(function () {
                    _this2.transportEvent.emit(transport);
                });
            }, function (error) {
                _this2.errorEvent.emit(error);
            });
        }
    }, {
        key: '_createAndSaveDevice',
        value: function _createAndSaveDevice(transport, descriptor, stream, previous) {
            var _this3 = this;

            var path = descriptor.path.toString();
            this.creatingDevices[path] = true;
            this._createDevice(transport, descriptor, stream, previous).then(function (device) {
                if (device instanceof _device2.default) {
                    _this3.devices[path] = device;
                    delete _this3.creatingDevices[path];
                    _this3.connectEvent.emit(device, previous);
                } else {
                    delete _this3.creatingDevices[path];
                    _this3.unacquiredDevices[path] = device;
                    _this3.connectUnacquiredEvent.emit(device);
                }
            }).catch(function (err) {
                console.debug('[trezor.js] [device list] Cannot create device', err);
            });
        }
    }, {
        key: '_createDevice',
        value: function _createDevice(transport, descriptor, stream, previous) {
            var _this4 = this;

            var devRes = _device2.default.fromDescriptor(transport, descriptor, this).then(function (device) {
                return device;
            }).catch(function (error) {
                if (error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE) {
                    if (previous == null) {
                        return _this4._createUnacquiredDevice(transport, descriptor, stream);
                    } else {
                        _this4.unacquiredDevices[previous.originalDescriptor.path.toString()] = previous;
                        return previous;
                    }
                }
                _this4.errorEvent.emit(error);
                throw error;
            });
            return devRes;
        }
    }, {
        key: '_createUnacquiredDevice',
        value: function _createUnacquiredDevice(transport, descriptor, stream) {
            var _this5 = this;

            // if (this.getSession(descriptor.path) == null) {
            //     return Promise.reject("Device no longer connected.");
            // }
            var res = _unacquiredDevice2.default.fromDescriptor(transport, descriptor, this).then(function (device) {
                return device;
            }).catch(function (error) {
                _this5.errorEvent.emit(error);
            });
            return res;
        }
    }, {
        key: 'getSession',
        value: function getSession(path) {
            return this.sessions[path];
        }
    }, {
        key: 'setHard',
        value: function setHard(path, session) {
            if (this.stream != null) {
                this.stream.setHard(path, session);
            }
            this.sessions[path] = session;
        }
    }, {
        key: '_initStream',
        value: function _initStream(transport) {
            var _this6 = this;

            var stream = new _descriptorStream2.default(transport);

            stream.updateEvent.on(function (diff) {
                _this6.sessions = {};
                diff.descriptors.forEach(function (descriptor) {
                    _this6.sessions[descriptor.path.toString()] = descriptor.session;
                });

                diff.connected.forEach(function (descriptor) {
                    var path = descriptor.path;

                    // if descriptor is null => we can acquire the device
                    if (descriptor.session == null) {
                        _this6._createAndSaveDevice(transport, descriptor, stream);
                    } else {
                        _this6.creatingDevices[path.toString()] = true;
                        _this6._createUnacquiredDevice(transport, descriptor, stream).then(function (device) {
                            _this6.unacquiredDevices[path.toString()] = device;
                            delete _this6.creatingDevices[path.toString()];
                            _this6.connectUnacquiredEvent.emit(device);
                        });
                    }
                });

                var events = [{
                    d: diff.changedSessions,
                    e: _this6.changedSessionsEvent
                }, {
                    d: diff.acquired,
                    e: _this6.acquiredEvent
                }, {
                    d: diff.released,
                    e: _this6.releasedEvent
                }];

                events.forEach(function (_ref) {
                    var d = _ref.d;
                    var e = _ref.e;

                    d.forEach(function (descriptor) {
                        var pathStr = descriptor.path.toString();
                        var device = _this6.devices[pathStr];
                        if (device != null) {
                            e.emit(device);
                        }
                    });
                });

                diff.disconnected.forEach(function (descriptor) {
                    var path = descriptor.path;
                    var pathStr = path.toString();
                    var device = _this6.devices[pathStr];
                    if (device != null) {
                        delete _this6.devices[pathStr];
                        _this6.disconnectEvent.emit(device);
                    }

                    var unacquiredDevice = _this6.unacquiredDevices[pathStr];
                    if (unacquiredDevice != null) {
                        delete _this6.unacquiredDevices[pathStr];
                        _this6.disconnectUnacquiredEvent.emit(unacquiredDevice);
                    }
                });

                diff.released.forEach(function (descriptor) {
                    var path = descriptor.path;
                    var device = _this6.unacquiredDevices[path.toString()];

                    if (device != null) {
                        var previous = _this6.unacquiredDevices[path.toString()];
                        delete _this6.unacquiredDevices[path.toString()];
                        _this6._createAndSaveDevice(transport, descriptor, stream, previous);
                    }
                });

                _this6.updateEvent.emit(diff);
            });

            stream.errorEvent.on(function (error) {
                _this6.errorEvent.emit(error);
                stream.stop();
            });

            stream.listen();

            this.streamEvent.emit(stream);
        }
    }, {
        key: 'onUnacquiredConnect',
        value: function onUnacquiredConnect(unacquiredDevice, listener) {
            var path = unacquiredDevice.originalDescriptor.path.toString();
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
    }, {
        key: 'onUnacquiredDisconnect',
        value: function onUnacquiredDisconnect(unacquiredDevice, listener) {
            var path = unacquiredDevice.originalDescriptor.path.toString();
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
    }, {
        key: 'onDisconnect',
        value: function onDisconnect(device, listener) {
            var path = device.originalDescriptor.path.toString();
            if (this.devices[path] == null && this.creatingDevices[path] == null) {
                listener(device);
            } else {
                this.disconnectEvent.on(listener);
            }
        }

        // If there is at least one physical device connected, returns it, steals it if necessary

    }, {
        key: 'stealFirstDevice',
        value: function stealFirstDevice() {
            var devices = this.asArray();
            if (devices.length > 0) {
                return Promise.resolve(devices[0]);
            }
            var unacquiredDevices = this.unacquiredAsArray();
            if (unacquiredDevices.length > 0) {
                return unacquiredDevices[0].steal();
            }
            return Promise.reject(new Error('No device connected'));
        }

        // steals the first devices, acquires it and *never* releases it until the window is closed

    }, {
        key: 'acquireFirstDevice',
        value: function acquireFirstDevice() {
            var _this7 = this;

            return new Promise(function (resolve, reject) {
                _this7.stealFirstDevice().then(function (device) {
                    device.run(function (session) {
                        resolve({ device: device, session: session });
                        // this "inside" promise never resolves or rejects
                        return new Promise(function (resolve, reject) {});
                    });
                }, function (err) {
                    reject(err);
                });
            });
        }
    }, {
        key: 'onbeforeunload',
        value: function onbeforeunload(clearSession) {
            this.asArray().forEach(function (device) {
                return device.onbeforeunload(clearSession);
            });
        }
    }]);

    return DeviceList;
}(_events.EventEmitter);

DeviceList._LowlevelTransport = null;
DeviceList._NodeHidPlugin = null;
DeviceList._fetch = typeof window === 'undefined' ? function () {
    return Promise.reject();
} : window.fetch;
DeviceList._isNode = false;
exports.default = DeviceList;


function objectValues(object) {
    return Object.keys(object).map(function (key) {
        return object[key];
    });
}
module.exports = exports['default'];