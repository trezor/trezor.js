'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _device = require('./device');

var _device2 = _interopRequireDefault(_device);

var _events = require('./events');

var _flowEvents = require('./flow-events');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var UnacquiredDevice = function (_EventEmitter) {
    _inherits(UnacquiredDevice, _EventEmitter);

    // note - if the device is changed to Device, this is also false

    function UnacquiredDevice(transport, descriptor, deviceList) {
        _classCallCheck(this, UnacquiredDevice);

        var _this = _possibleConstructorReturn(this, (UnacquiredDevice.__proto__ || Object.getPrototypeOf(UnacquiredDevice)).call(this));

        _this.connected = true;
        _this.connectEvent = new _flowEvents.Event1('connect', _this);
        _this.disconnectEvent = new _flowEvents.Event0('disconnect', _this);

        _this.transport = transport;
        _this.originalDescriptor = descriptor;
        _this.deviceList = deviceList;
        _this._watch();
        return _this;
    }

    _createClass(UnacquiredDevice, [{
        key: '_watchConnectDisconnect',
        value: function _watchConnectDisconnect(onConnect, onDisconnect) {
            var _this2 = this;

            var _disconnectListener = function disconnectListener(dev) {};
            var connectListener = function connectListener(device, unacquiredDevice) {
                if (_this2 === unacquiredDevice) {
                    _this2.deviceList.connectEvent.removeListener(connectListener);
                    _this2.deviceList.disconnectUnacquiredEvent.removeListener(_disconnectListener);
                    onConnect(device);
                }
            };
            _disconnectListener = function disconnectListener(unacquiredDevice) {
                if (_this2 === unacquiredDevice) {
                    _this2.deviceList.connectEvent.removeListener(connectListener);
                    _this2.deviceList.disconnectUnacquiredEvent.removeListener(_disconnectListener);
                    onDisconnect();
                }
            };
            this.deviceList.onUnacquiredConnect(this, connectListener);
            this.deviceList.onUnacquiredDisconnect(this, _disconnectListener);
        }

        // returns Promise just to be similar to Device.fromPath

    }, {
        key: 'steal',


        // what steal() does is that it does not actually keep the session for itself
        // because it immediately releases it again;
        // however, it might stop some other process in another app,
        // so the device will become "usable".
        // This function actually returns the new Device object
        value: function steal() {
            var _this3 = this;

            // I will simultaniously run initialization and wait for devicelist to return device to me
            var result = new Promise(function (resolve, reject) {
                _this3._watchConnectDisconnect(function (device) {
                    return resolve(device);
                }, function () {
                    return reject(new Error('Device disconnected before grabbing'));
                });
            });
            var currentSession = this.deviceList.getSession(this.originalDescriptor.path);
            var descriptor = _extends({}, this.originalDescriptor, { session: currentSession });

            // if the run fails, I want to return that error, I guess
            var aggressiveRunResult = _device2.default._run(function () {
                return true;
            }, this.transport, descriptor, this.deviceList);
            return aggressiveRunResult.then(function () {
                return result;
            });
        }
    }, {
        key: '_watch',
        value: function _watch() {
            var _this4 = this;

            this._watchConnectDisconnect(function (device) {
                _this4.connected = false;
                _this4.connectEvent.emit(device);
            }, function () {
                _this4.connected = false;
                _this4.disconnectEvent.emit();
            });
        }
    }], [{
        key: 'fromDescriptor',
        value: function fromDescriptor(transport, descriptor, deviceList) {
            return Promise.resolve(new UnacquiredDevice(transport, descriptor, deviceList));
        }
    }]);

    return UnacquiredDevice;
}(_events.EventEmitter);

exports.default = UnacquiredDevice;
module.exports = exports['default'];