'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require('./events');

var _flowEvents = require('./flow-events');

var _connectionLock = require('./utils/connectionLock');

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var DescriptorStream = function (_EventEmitter) {
    _inherits(DescriptorStream, _EventEmitter);

    function DescriptorStream(transport) {
        _classCallCheck(this, DescriptorStream);

        var _this = _possibleConstructorReturn(this, (DescriptorStream.__proto__ || Object.getPrototypeOf(DescriptorStream)).call(this));

        _this.listening = false;
        _this.previous = null;
        _this.current = [];
        _this.errorEvent = new _flowEvents.Event1('error', _this);
        _this.connectEvent = new _flowEvents.Event1('connect', _this);
        _this.disconnectEvent = new _flowEvents.Event1('disconnect', _this);
        _this.acquiredEvent = new _flowEvents.Event1('acquired', _this);
        _this.releasedEvent = new _flowEvents.Event1('released', _this);
        _this.changedSessionsEvent = new _flowEvents.Event1('changedSessions', _this);
        _this.updateEvent = new _flowEvents.Event1('update', _this);

        _this.transport = transport;
        return _this;
    }

    _createClass(DescriptorStream, [{
        key: 'setHard',
        value: function setHard(path, session) {
            if (this.previous != null) {
                var copy = this.previous.map(function (d) {
                    if (d.path === path) {
                        return _extends({}, d, { session: session });
                    } else {
                        return d;
                    }
                });
                this.current = copy;
                this._reportChanges();
            }
        }
    }, {
        key: 'listen',
        value: function listen() {
            var _this2 = this;

            // if we are not enumerating for the first time, we can let
            // the transport to block until something happens
            var waitForEvent = this.previous !== null;

            this.listening = true;
            var previous = this.previous || [];
            var promise = waitForEvent ? this.transport.listen(previous) : this.transport.enumerate();
            promise.then(function (descriptors) {
                if (!_this2.listening) {
                    // do not continue if stop() was called
                    return;
                }

                _this2.current = descriptors;
                _this2._reportChanges();

                if (_this2.listening) {
                    // handlers might have called stop()
                    _this2.listen();
                }
                return;
            }).catch(function (error) {
                _this2.errorEvent.emit(error);
            });
        }
    }, {
        key: 'stop',
        value: function stop() {
            this.listening = false;
        }
    }, {
        key: '_diff',
        value: function _diff(previousN, descriptors) {
            var previous = previousN || [];
            var connected = descriptors.filter(function (d) {
                return previous.find(function (x) {
                    return x.path === d.path;
                }) === undefined;
            });
            var disconnected = previous.filter(function (d) {
                return descriptors.find(function (x) {
                    return x.path === d.path;
                }) === undefined;
            });
            var changedSessions = descriptors.filter(function (d) {
                var previousDescriptor = previous.find(function (x) {
                    return x.path === d.path;
                });
                if (previousDescriptor !== undefined) {
                    return previousDescriptor.session !== d.session;
                } else {
                    return false;
                }
            });
            var acquired = changedSessions.filter(function (descriptor) {
                return descriptor.session != null;
            });
            var released = changedSessions.filter(function (descriptor) {
                return descriptor.session == null;
            });

            var didUpdate = connected.length + disconnected.length + changedSessions.length > 0;

            return {
                connected: connected,
                disconnected: disconnected,
                changedSessions: changedSessions,
                acquired: acquired,
                released: released,
                didUpdate: didUpdate,
                descriptors: descriptors
            };
        }
    }, {
        key: '_reportChanges',
        value: function _reportChanges() {
            var _this3 = this;

            (0, _connectionLock.lock)(function () {
                var diff = _this3._diff(_this3.previous, _this3.current);
                _this3.previous = _this3.current;

                if (diff.didUpdate) {
                    diff.connected.forEach(function (d) {
                        _this3.connectEvent.emit(d);
                    });
                    diff.disconnected.forEach(function (d) {
                        _this3.disconnectEvent.emit(d);
                    });
                    diff.acquired.forEach(function (d) {
                        _this3.acquiredEvent.emit(d);
                    });
                    diff.released.forEach(function (d) {
                        _this3.releasedEvent.emit(d);
                    });
                    diff.changedSessions.forEach(function (d) {
                        _this3.changedSessionsEvent.emit(d);
                    });
                    _this3.updateEvent.emit(diff);
                }
                return Promise.resolve();
            });
        }
    }]);

    return DescriptorStream;
}(_events.EventEmitter);

exports.default = DescriptorStream;
module.exports = exports['default'];