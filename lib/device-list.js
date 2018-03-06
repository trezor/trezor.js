'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _class, _temp;

var _bitcoinjsLibZcash = require('bitcoinjs-lib-zcash');

var bitcoin = _interopRequireWildcard(_bitcoinjsLibZcash);

var _events = require('./events');

var _flowEvents = require('./flow-events');

var _descriptorStream = require('./descriptor-stream');

var _descriptorStream2 = _interopRequireDefault(_descriptorStream);

var _device = require('./device');

var _device2 = _interopRequireDefault(_device);

var _unacquiredDevice = require('./unacquired-device');

var _unacquiredDevice2 = _interopRequireDefault(_unacquiredDevice);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var CONFIG_URL = 'https://wallet.trezor.io/data/config_signed.bin';

// a slight hack
// this error string is hard-coded
// in both bridge and extension
var WRONG_PREVIOUS_SESSION_ERROR_MESSAGE = 'wrong previous session';

var WEBUSB_ERROR_TOSTRING = 'NetworkError: Unable to claim interface.';

//
// Events:
//
//  connect: Device
//  disconnect: Device
//  transport: Transport
//  stream: DescriptorStream
//
var DeviceList = (_temp = _class = function (_EventEmitter) {
    _inherits(DeviceList, _EventEmitter);

    _createClass(DeviceList, null, [{
        key: '_setFetch',
        value: function _setFetch(fetch) {
            DeviceList._fetch = fetch;
        }
    }, {
        key: '_setTransport',
        value: function _setTransport(t) {
            DeviceList.defaultTransport = t;
        }
    }, {
        key: '_setNode',
        value: function _setNode(node) {
            DeviceList.node = node;
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
        _this.unreadableHidDeviceChange = new _flowEvents.Event0('unreadableHidDevice', _this);


        _this.options = options || {};
        _this.requestNeeded = false;

        _this.transportEvent.on(function (transport) {
            _this.transport = transport;
            _this.transportLoading = false;
            _this.requestNeeded = transport.requestNeeded;

            _this._initStream(transport);
            _this._setUnreadableHidDeviceChange();
        });

        _this.streamEvent.on(function (stream) {
            _this.stream = stream;
        });

        // using setTimeout to emit 'transport' in next tick,
        // so people from outside can add listener after constructor finishes
        setTimeout(function () {
            return _this._initTransport();
        }, 0);

        _this.xpubDerive = _this.options.xpubDerive != null ? _this.options.xpubDerive : function (xpub, network, index) {
            return Promise.resolve(bitcoin.HDNode.fromBase58(xpub, network, false).derive(index).toBase58());
        };
        return _this;
    }

    _createClass(DeviceList, [{
        key: 'requestDevice',
        value: function requestDevice() {
            if (this.transport == null) {
                return Promise.reject();
            }
            return this.transport.requestDevice();
        }
    }, {
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

        // for mytrezor - returns "bridge" or "extension", or something else :)

    }, {
        key: 'transportType',
        value: function transportType() {
            if (this.transport == null) {
                return '';
            }
            if (this.transport.activeName) {
                // $FlowIssue
                var activeName = this.transport.activeName;
                if (activeName === 'BridgeTransport') {
                    return 'bridge';
                }
                if (activeName === 'ExtensionTransport') {
                    return 'extension';
                }
                return activeName;
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
                var _configUrl = this.options.configUrl == null ? CONFIG_URL + '?' + Date.now() : this.options.configUrl;
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

            var transport = this.options.transport ? this.options.transport : DeviceList.defaultTransport();
            if (this.options.bridgeVersionUrl != null) {
                transport.setBridgeLatestUrl(this.options.bridgeVersionUrl);
            }
            if (this.options.debugInfo) {
                console.log('[trezor.js] [device list] Initializing transports');
            }
            transport.init(this.options.debug).then(function () {
                if (_this2.options.debugInfo) {
                    console.log('[trezor.js] [device list] Configuring transports');
                }
                _this2._configTransport(transport).then(function () {
                    if (_this2.options.debugInfo) {
                        console.log('[trezor.js] [device list] Configuring transports done');
                    }
                    _this2.transportEvent.emit(transport);
                });
            }, function (error) {
                if (_this2.options.debugInfo) {
                    console.error('[trezor.js] [device list] Error in transport', error);
                }
                _this2.errorEvent.emit(error);
            });
        }
    }, {
        key: '_createAndSaveDevice',
        value: function _createAndSaveDevice(transport, descriptor, stream, previous) {
            var _this3 = this;

            if (this.options.debugInfo) {
                console.log('[trezor.js] [device list] Creating Device', descriptor, previous);
            }

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
                if (error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE || error.toString() === WEBUSB_ERROR_TOSTRING) {
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

            if (this.options.debugInfo) {
                console.log('[trezor.js] [device list] Creating Unacquired Device', descriptor);
            }

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
                    var d = _ref.d,
                        e = _ref.e;

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
        value: function stealFirstDevice(rejectOnEmpty) {
            var _this7 = this;

            var devices = this.asArray();
            if (devices.length > 0) {
                return Promise.resolve(devices[0]);
            }
            var unacquiredDevices = this.unacquiredAsArray();
            if (unacquiredDevices.length > 0) {
                return unacquiredDevices[0].steal();
            }
            if (rejectOnEmpty) {
                return Promise.reject(new Error('No device connected'));
            } else {
                return new Promise(function (resolve, reject) {
                    _this7.connectEvent.once(function () {
                        _this7.stealFirstDevice().then(function (d) {
                            return resolve(d);
                        }, function (e) {
                            return reject(e);
                        });
                    });
                });
            }
        }

        // steals the first devices, acquires it and *never* releases it until the window is closed

    }, {
        key: 'acquireFirstDevice',
        value: function acquireFirstDevice(rejectOnEmpty) {
            var _this8 = this;

            var timeoutPromiseFn = function timeoutPromiseFn(t) {
                return new Promise(function (resolve) {
                    setTimeout(function () {
                        return resolve();
                    }, t);
                });
            };

            return new Promise(function (resolve, reject) {
                _this8.stealFirstDevice(rejectOnEmpty).then(function (device) {
                    device.run(function (session) {
                        resolve({ device: device, session: session });
                        // this "inside" promise never resolves or rejects
                        return new Promise(function (resolve, reject) {});
                    });
                }, function (err) {
                    reject(err);
                });
            }).catch(function (err) {
                if (err.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE) {
                    return timeoutPromiseFn(1000).then(function () {
                        return _this8.acquireFirstDevice(rejectOnEmpty);
                    });
                }
                throw err;
            });
        }
    }, {
        key: '_setUnreadableHidDeviceChange',
        value: function _setUnreadableHidDeviceChange() {
            var _this9 = this;

            if (DeviceList.node) {
                return;
            }
            try {
                var _transport = this.transport;
                if (_transport == null) {
                    return;
                }
                // $FlowIssue - this all is going around Flow :/
                var activeTransport = _transport.activeTransport;
                if (activeTransport == null || activeTransport.name !== 'ParallelTransport') {
                    return;
                }
                var webusbTransport = activeTransport.workingTransports['webusb'];
                if (webusbTransport == null) {
                    return;
                }
                // one of the HID fallbacks are working -> do not display the message
                var hidTransport = activeTransport.workingTransports['hid'];
                if (hidTransport != null) {
                    return;
                }
                return webusbTransport.plugin.unreadableHidDeviceChange.on('change', function () {
                    return _this9.unreadableHidDeviceChange.emit('change');
                });
            } catch (e) {
                return;
            }
        }
    }, {
        key: 'unreadableHidDevice',
        value: function unreadableHidDevice() {
            if (DeviceList.node) {
                return false;
            }
            try {
                var _transport2 = this.transport;
                if (_transport2 == null) {
                    return false;
                }
                // $FlowIssue - this all is going around Flow :/
                var activeTransport = _transport2.activeTransport;
                if (activeTransport == null || activeTransport.name !== 'ParallelTransport') {
                    return false;
                }
                var webusbTransport = activeTransport.workingTransports['webusb'];
                if (webusbTransport == null) {
                    return false;
                }
                // one of the HID fallbacks are working -> do not display the message
                var hidTransport = activeTransport.workingTransports['hid'];
                if (hidTransport != null) {
                    return false;
                }
                return webusbTransport.plugin.unreadableHidDevice;
            } catch (e) {
                return false;
            }
        }
    }, {
        key: 'onbeforeunload',
        value: function onbeforeunload(clearSession) {
            this.asArray().forEach(function (device) {
                return device.onbeforeunload(clearSession);
            });
            // some weird issue on chrome on mac makes the window alive
            // even after closing
            // we need to stop the stream
            if (this.stream != null) {
                this.stream.stop();
            }
        }
    }]);

    return DeviceList;
}(_events.EventEmitter), _class._fetch = function () {
    return Promise.reject(new Error('No fetch defined'));
}, _temp);
exports.default = DeviceList;


function objectValues(object) {
    return Object.keys(object).map(function (key) {
        return object[key];
    });
}
module.exports = exports['default'];