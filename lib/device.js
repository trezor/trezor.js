'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _semverCompare = require('semver-compare');

var _semverCompare2 = _interopRequireDefault(_semverCompare);

var _events = require('./events');

var _flowEvents = require('./flow-events');

var _session = require('./session');

var _session2 = _interopRequireDefault(_session);

var _connectionLock = require('./utils/connectionLock');

var _hdnode = require('./utils/hdnode');

var _trezortypes = require('./trezortypes');

var trezor = _interopRequireWildcard(_trezortypes);

var _bitcoinjsLibZcash = require('bitcoinjs-lib-zcash');

var bitcoin = _interopRequireWildcard(_bitcoinjsLibZcash);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

// a slight hack
// this error string is hard-coded
// in both bridge and extension
var WRONG_PREVIOUS_SESSION_ERROR_MESSAGE = 'wrong previous session';

var Device = function (_EventEmitter) {
    _inherits(Device, _EventEmitter);

    // First of two "advanced" integrity checks
    // We check whether the xpub that we get from the trezor is
    // the same that *the application* remembers.
    // *The application* sets this based on what it remembers.
    // Then, before some actions (see @integrityCheck in session.js)
    // we first look for xpub with this path and compare.
    // If the application doesn't set this, we are still at least
    // comparing different calls with each other, since this is set on first call.
    function Device(transport, descriptor, features, deviceList) {
        _classCallCheck(this, Device);

        // === immutable properties
        var _this = _possibleConstructorReturn(this, (Device.__proto__ || Object.getPrototypeOf(Device)).call(this));

        _this.activityInProgress = false;
        _this.connected = true;
        _this.clearSession = false;
        _this.clearSessionTime = 10 * 60 * 1000;
        _this.clearSessionTimeout = null;
        _this.clearSessionFuture = 0;
        _this.rememberPlaintextPassphrase = false;
        _this.rememberedPlaintextPasshprase = null;
        _this.passphraseState = null;
        _this.integrityCheckingXpubPath = [(0, _hdnode.harden)(49), (0, _hdnode.harden)(0), (0, _hdnode.harden)(0)];
        _this.integrityCheckingXpubNetwork = 'bitcoin';
        _this.disconnectEvent = new _flowEvents.Event0('disconnect', _this);
        _this.buttonEvent = new _flowEvents.Event1('button', _this);
        _this.errorEvent = new _flowEvents.Event1('error', _this);
        _this.passphraseEvent = new _flowEvents.Event1('passphrase', _this);
        _this.wordEvent = new _flowEvents.Event1('word', _this);
        _this.changedSessionsEvent = new _flowEvents.Event2('changedSessions', _this);
        _this.pinEvent = new _flowEvents.Event2('pin', _this);
        _this.receiveEvent = new _flowEvents.Event2('receive', _this);
        _this.sendEvent = new _flowEvents.Event2('send', _this);
        _this._stolenEvent = new _flowEvents.Event0('stolen', _this);
        _this.transport = transport;
        _this.originalDescriptor = descriptor;
        _this.deviceList = deviceList;

        if (_this.deviceList.options.clearSession) {
            _this.clearSession = true;
            if (_this.deviceList.options.clearSessionTime) {
                _this.clearSessionTime = _this.deviceList.options.clearSessionTime;
            }
        }
        if (_this.deviceList.options.rememberDevicePassphrase) {
            _this.rememberPlaintextPassphrase = true;
        }

        // === mutable properties
        // features get reloaded after every initialization
        _this.features = features;
        _this.connected = true;

        _this._watch();
        return _this;
    }

    // Initializes device with the given descriptor,
    // runs a given function and then releases the session.
    // Return promise with the result of the function.
    // First parameter is a function that has two parameters
    // - first the session and second the fresh device features.
    // Note - when descriptor.path != null, this will steal the device from someone else
    // in miliseconds


    _createClass(Device, [{
        key: 'waitForSessionAndRun',
        value: function waitForSessionAndRun(fn, options) {
            var options_ = options == null ? {} : options;
            return this.run(fn, _extends({}, options_, { waiting: true }));
        }
    }, {
        key: 'runAggressive',
        value: function runAggressive(fn, options) {
            var options_ = options == null ? {} : options;
            return this.run(fn, _extends({}, options_, { aggressive: true }));
        }

        // Initializes device with the given descriptor,
        // runs a given function and then releases the session.
        // Return promise with the result of the function.
        // First parameter is a function that has session as a parameter

    }, {
        key: 'run',
        value: function run(fn, options) {
            var _this2 = this;

            if (!this.connected) {
                return Promise.reject(new Error('Device disconnected.'));
            }
            var options_ = options == null ? {} : options;
            var aggressive = !!options_.aggressive;
            var skipFinalReload = !!options_.skipFinalReload;
            var waiting = !!options_.waiting;

            var onlyOneActivity = !!options_.onlyOneActivity;
            if (onlyOneActivity && this.activityInProgress) {
                return Promise.reject(new Error('One activity already running.'));
            }

            this.activityInProgress = true;
            this._stopClearSessionTimeout();

            var currentSession = this.deviceList.getSession(this.originalDescriptor.path);
            if (!aggressive && !waiting && currentSession != null) {
                return Promise.reject(new Error('Device used in another window.'));
            }
            if (aggressive && waiting) {
                return Promise.reject(new Error('Combination of aggressive and waiting doesn\'t make sense.'));
            }

            var waitingPromise = Promise.resolve(currentSession);
            if (waiting && currentSession != null) {
                waitingPromise = this._waitForNullSession();
            }

            var runFinal = function runFinal(res, error) {
                if (!(error && error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE && waiting)) {
                    if (_this2.clearSession) {
                        _this2._startClearSessionTimeout();
                    }
                }
                return Promise.resolve();
            };

            return waitingPromise.then(function (resolvedSession) {
                var descriptor = _extends({}, _this2.originalDescriptor, { session: resolvedSession });

                // This is a bit overengineered, but I am not sure how to do it otherwise
                // I want the action to stop when the device is stolen,
                // but I don't want to add listener events that are never removed...
                // So I combine emitters and promises
                var e = new _events.EventEmitter();
                var stolenP = new Promise(function (resolve, reject) {
                    var onceStolen = function onceStolen() {
                        e.removeAllListeners();
                        reject(new Error('The action was interrupted by another application.'));
                    };
                    _this2._stolenEvent.once(onceStolen);
                    e.once('done', function () {
                        _this2._stolenEvent.removeListener(onceStolen);
                        resolve();
                    });
                });

                var res = Device._run(function (session, features) {
                    return _this2._runInside(fn, session, features, skipFinalReload);
                }, _this2.transport, descriptor, _this2.deviceList, function (session) {
                    _this2.currentSessionObject = session;
                }, function (error) {
                    _this2.currentSessionObject = null;
                    _this2.activityInProgress = false;
                    if (error != null && _this2.connected) {
                        if (error.message === 'Action was interrupted.') {
                            _this2._stolenEvent.emit();
                            return Promise.resolve();
                        } else {
                            return new Promise(function (resolve, reject) {
                                var onDisconnect = function onDisconnect() {};
                                var onChanged = function onChanged() {
                                    if (_this2.isStolen()) {
                                        _this2._stolenEvent.emit();
                                    }
                                    _this2.disconnectEvent.removeListener(onDisconnect);
                                    resolve();
                                };
                                onDisconnect = function onDisconnect() {
                                    _this2.changedSessionsEvent.removeListener(onChanged);
                                    resolve();
                                };
                                _this2.changedSessionsEvent.once(onChanged);
                                _this2.disconnectEvent.once(onDisconnect);
                            });
                        }
                    } else {
                        return Promise.resolve();
                    }
                }, _this2);

                return promiseFinally(Promise.all([promiseFinally(res, function (ok, err) {
                    e.emit('done');
                    return Promise.resolve();
                }), stolenP]).then(function () {
                    return res;
                }), function (res, error) {
                    return runFinal(res, error);
                }).catch(function (error) {
                    if (!_this2.connected) {
                        throw new Error('Device was disconnected during action.');
                    }
                    if (error.message === WRONG_PREVIOUS_SESSION_ERROR_MESSAGE && waiting) {
                        // trying again!!!
                        return _this2._waitForNullSession().then(function () {
                            return _this2.run(fn, options);
                        });
                    } else {
                        throw error;
                    }
                });
            });
        }

        // See the comment on top on integrityCheckingXpub.
        // This sets the xpub that we will re-check when possible (before important actions, and
        // after all action when it makes sense)

    }, {
        key: 'setCheckingXpub',
        value: function setCheckingXpub(integrityCheckingXpubPath, integrityCheckingXpub, integrityCheckingXpubNetwork) {
            this.integrityCheckingXpubPath = integrityCheckingXpubPath;
            this.integrityCheckingXpub = integrityCheckingXpub;
            this.integrityCheckingXpubNetwork = integrityCheckingXpubNetwork;
            this.integrityCheckingPassphrase = this.rememberedPlaintextPasshprase;
        }

        // When we are doing integrity checking AFTER functions, we do it only when we can

    }, {
        key: 'canSayXpub',
        value: function canSayXpub() {
            if (this.features.bootloader_mode) {
                return false;
            }
            if (!this.features.initialized) {
                return false;
            }
            var noPassphrase = this.features.passphrase_protection ? this.features.passphrase_cached || this.rememberedPlaintextPasshprase != null : true;
            var samePasshprase = this.features.passphrase_protection === false && this.integrityCheckingPassphrase == null || this.features.passphrase_protection === true && this.rememberedPlaintextPasshprase != null && this.rememberedPlaintextPasshprase === this.integrityCheckingPassphrase;
            var noPin = this.features.pin_protection ? this.features.pin_cached : true;
            return noPassphrase && samePasshprase && noPin;
        }

        // See the comment on top on integrityCheckingXpub.

    }, {
        key: 'xpubIntegrityCheck',
        value: function () {
            var _ref = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee(session) {
                var hdnode, xpub;
                return regeneratorRuntime.wrap(function _callee$(_context) {
                    while (1) {
                        switch (_context.prev = _context.next) {
                            case 0:
                                _context.next = 2;
                                return session._getHDNodeInternal(this.integrityCheckingXpubPath, this.integrityCheckingXpubNetwork);

                            case 2:
                                hdnode = _context.sent;
                                xpub = hdnode.toBase58();

                                if (!(this.integrityCheckingXpub == null)) {
                                    _context.next = 9;
                                    break;
                                }

                                this.integrityCheckingXpub = xpub;
                                this.integrityCheckingPassphrase = this.rememberedPlaintextPasshprase;
                                _context.next = 11;
                                break;

                            case 9:
                                if (!(xpub !== this.integrityCheckingXpub)) {
                                    _context.next = 11;
                                    break;
                                }

                                throw new Error('Inconsistent state');

                            case 11:
                            case 'end':
                                return _context.stop();
                        }
                    }
                }, _callee, this);
            }));

            function xpubIntegrityCheck(_x) {
                return _ref.apply(this, arguments);
            }

            return xpubIntegrityCheck;
        }()
    }, {
        key: '_reloadFeaturesOrInitialize',
        value: function _reloadFeaturesOrInitialize(session) {
            var _this3 = this;

            var featuresPromise = void 0;
            if (this.atLeast('1.3.3')) {
                featuresPromise = session.getFeatures();
            } else {
                featuresPromise = session.initialize();
            }
            return featuresPromise.then(function (res) {
                _this3.features = res.message;
                return;
            });
        }
    }, {
        key: '_startClearSessionTimeout',
        value: function _startClearSessionTimeout() {
            var _this4 = this;

            if (this.features.bootloader_mode) {
                return;
            }
            this.clearSessionTimeout = window.setTimeout(function () {
                var options = { onlyOneActivity: true };
                _this4.run(function (session) {
                    return session.clearSession();
                }, options);

                _this4.clearSessionTimeout = null;
            }, this.clearSessionTime);
            this.clearSessionFuture = Date.now() + this.clearSessionTime;
        }
    }, {
        key: 'clearSessionRest',
        value: function clearSessionRest() {
            if (this.clearSessionTimeout == null) {
                return 0;
            } else {
                return this.clearSessionFuture - Date.now();
            }
        }
    }, {
        key: '_stopClearSessionTimeout',
        value: function _stopClearSessionTimeout() {
            if (this.clearSessionTimeout != null) {
                window.clearTimeout(this.clearSessionTimeout);
                this.clearSessionTimeout = null;
            }
        }

        // See comment on device-list option getPassphraseHash

    }, {
        key: 'checkPassphraseHash',
        value: function checkPassphraseHash(passphrase) {
            if (this.deviceList.options.getPassphraseHash != null) {
                var websiteHash = this.deviceList.options.getPassphraseHash(this);
                if (websiteHash == null) {
                    return true;
                }
                var id = this.features.device_id;
                var secret = 'TREZOR#' + id + '#' + passphrase;
                var hashed = sha256x2(secret);
                return JSON.stringify([].concat(_toConsumableArray(hashed))) === JSON.stringify([].concat(_toConsumableArray(websiteHash)));
            }
            return true;
        }

        // See comment on device-list option getPassphraseHash

    }, {
        key: 'forwardPassphrase',
        value: function forwardPassphrase(source) {
            var _this5 = this;

            source.on(function (arg) {
                if (_this5.rememberedPlaintextPasshprase != null) {
                    var p = _this5.rememberedPlaintextPasshprase;

                    var checkPasshprase = _this5.checkPassphraseHash(p);
                    if (checkPasshprase) {
                        arg(null, p);
                    } else {
                        arg(new Error('Inconsistent state'));
                    }
                    return;
                }

                var argAndRemember = function argAndRemember(e, passphrase) {
                    if (_this5.rememberPlaintextPassphrase) {
                        if (passphrase != null) {
                            var _checkPasshprase = _this5.checkPassphraseHash(passphrase);
                            if (!_checkPasshprase) {
                                arg(new Error('Inconsistent state'));
                                return;
                            }
                        }

                        _this5.rememberedPlaintextPasshprase = passphrase;
                    }
                    arg(e, passphrase);
                };
                _this5.passphraseEvent.emit(argAndRemember);
            });
        }
    }, {
        key: '_runInside',
        value: function () {
            var _ref2 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee2(fn, activeSession, features, skipFinalReload) {
                var res;
                return regeneratorRuntime.wrap(function _callee2$(_context2) {
                    while (1) {
                        switch (_context2.prev = _context2.next) {
                            case 0:
                                this.features = features;

                                forward2(activeSession.sendEvent, this.sendEvent);
                                forward2(activeSession.receiveEvent, this.receiveEvent);
                                forwardError(activeSession.errorEvent, this.errorEvent);

                                forward1(activeSession.buttonEvent, this.buttonEvent);
                                forwardCallback2(activeSession.pinEvent, this.pinEvent);
                                forwardCallback1(activeSession.wordEvent, this.wordEvent);
                                this.forwardPassphrase(activeSession.passphraseEvent);

                                _context2.next = 10;
                                return fn(activeSession);

                            case 10:
                                res = _context2.sent;
                                _context2.prev = 11;

                                if (skipFinalReload) {
                                    _context2.next = 18;
                                    break;
                                }

                                _context2.next = 15;
                                return this._reloadFeaturesOrInitialize(activeSession);

                            case 15:
                                if (!this.canSayXpub()) {
                                    _context2.next = 18;
                                    break;
                                }

                                _context2.next = 18;
                                return this.xpubIntegrityCheck(activeSession);

                            case 18:
                                _context2.prev = 18;

                                activeSession.deactivateEvents();
                                return _context2.finish(18);

                            case 21:
                                return _context2.abrupt('return', res);

                            case 22:
                            case 'end':
                                return _context2.stop();
                        }
                    }
                }, _callee2, this, [[11,, 18, 21]]);
            }));

            function _runInside(_x2, _x3, _x4, _x5) {
                return _ref2.apply(this, arguments);
            }

            return _runInside;
        }()
    }, {
        key: '_waitForNullSession',
        value: function _waitForNullSession() {
            var _this6 = this;

            return new Promise(function (resolve, reject) {
                var _onDisconnect = function onDisconnect() {};
                var onUpdate = function onUpdate() {
                    var updatedSession = _this6.deviceList.getSession(_this6.originalDescriptor.path);
                    var device = _this6.deviceList.devices[_this6.originalDescriptor.path.toString()];
                    if (updatedSession == null && device != null) {
                        _this6.deviceList.disconnectEvent.removeListener(_onDisconnect);
                        _this6.deviceList.updateEvent.removeListener(onUpdate);
                        resolve(updatedSession);
                    }
                };
                _onDisconnect = function onDisconnect(device) {
                    if (device === _this6) {
                        _this6.deviceList.disconnectEvent.removeListener(_onDisconnect);
                        _this6.deviceList.updateEvent.removeListener(onUpdate);
                        reject(new Error('Device disconnected'));
                    }
                };
                onUpdate();
                _this6.deviceList.updateEvent.on(onUpdate);
                _this6.deviceList.onDisconnect(_this6, _onDisconnect);
            });
        }
    }, {
        key: 'reloadFeatures',
        value: function reloadFeatures() {
            return this.run(function () {
                return true;
            });
        }

        // what steal() does is that it does not actually keep the session for itself
        // because it immediately releases it again;
        // however, it might stop some other process in another app,
        // so the device will become "usable"

    }, {
        key: 'steal',
        value: function steal() {
            return this.run(function () {
                return true;
            }, { aggressive: true });
        }
    }, {
        key: 'isBootloader',
        value: function isBootloader() {
            return this.features.bootloader_mode;
        }
    }, {
        key: 'isInitialized',
        value: function isInitialized() {
            return this.features.initialized;
        }
    }, {
        key: 'getVersion',
        value: function getVersion() {
            return [this.features.major_version, this.features.minor_version, this.features.patch_version].join('.');
        }
    }, {
        key: 'atLeast',
        value: function atLeast(version) {
            return (0, _semverCompare2.default)(this.getVersion(), version) >= 0;
        }
    }, {
        key: 'getCoin',
        value: function getCoin(name) {
            var coins = this.features.coins;

            for (var i = 0; i < coins.length; i++) {
                if (coins[i].coin_name === name) {
                    return coins[i];
                }
            }
            throw new Error('Device does not support given coin type');
        }
    }, {
        key: '_watch',
        value: function _watch() {
            var _this7 = this;

            var onChangedSessions = function onChangedSessions(device) {
                if (device === _this7) {
                    _this7.changedSessionsEvent.emit(_this7.isUsed(), _this7.isUsedHere());
                    if (_this7.isStolen() && _this7.currentSessionObject != null) {
                        _this7._stolenEvent.emit();
                    }
                }
            };
            var onDisconnect = function onDisconnect(device) {
                if (device === _this7) {
                    _this7.disconnectEvent.emit();
                    _this7.deviceList.disconnectEvent.removeListener(onDisconnect);
                    _this7.deviceList.changedSessionsEvent.removeListener(onChangedSessions);
                    _this7.connected = false;

                    var events = [_this7.changedSessionsEvent, _this7.sendEvent, _this7.receiveEvent, _this7.errorEvent, _this7.buttonEvent, _this7.pinEvent, _this7.wordEvent];
                    events.forEach(function (ev) {
                        return ev.removeAllListeners();
                    });
                }
            };
            onChangedSessions(this);
            this.deviceList.changedSessionsEvent.on(onChangedSessions);
            this.deviceList.onDisconnect(this, onDisconnect);
        }
    }, {
        key: 'isUsed',
        value: function isUsed() {
            var session = this.deviceList.getSession(this.originalDescriptor.path);
            return session != null;
        }
    }, {
        key: 'isUsedHere',
        value: function isUsedHere() {
            var session = this.deviceList.getSession(this.originalDescriptor.path);
            var mySession = this.currentSessionObject != null ? this.currentSessionObject.getId() : null;
            return session != null && mySession === session;
        }
    }, {
        key: 'isUsedElsewhere',
        value: function isUsedElsewhere() {
            return this.isUsed() && !this.isUsedHere();
        }
    }, {
        key: 'isStolen',
        value: function isStolen() {
            var shouldBeUsedHere = this.currentSessionObject != null;

            if (this.isUsed()) {
                if (shouldBeUsedHere) {
                    // is used and should be used here => returns true if it's used elsewhere
                    return this.isUsedElsewhere();
                } else {
                    // is used and should not be used => returns true
                    return true;
                }
            } else {
                if (shouldBeUsedHere) {
                    // isn't used and should be used => stolen (??)
                    return true;
                } else {
                    // isn't used and shouldn't be used => nothing
                    return false;
                }
            }
        }
    }, {
        key: 'onbeforeunload',
        value: function onbeforeunload() {
            var currentSession = this.currentSessionObject;
            if (currentSession != null) {
                // cannot run .then() in browser; so let's just fire and hope for the best
                if (this.clearSession) {
                    var model = this.features.model;
                    if (model == null || model !== 'T') {
                        currentSession.clearSession();
                    }
                }
                currentSession.release(true);
            }
        }
    }], [{
        key: '_run',
        value: function () {
            var _ref3 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee3(fn, transport, descriptor, deviceList, onAcquire, onRelease, device) {
                var session, _features;

                return regeneratorRuntime.wrap(function _callee3$(_context3) {
                    while (1) {
                        switch (_context3.prev = _context3.next) {
                            case 0:
                                _context3.next = 2;
                                return Device._acquire(transport, descriptor, deviceList, onAcquire, device);

                            case 2:
                                session = _context3.sent;
                                _context3.prev = 3;
                                _context3.next = 6;
                                return session.initialize();

                            case 6:
                                _features = _context3.sent;
                                _context3.next = 9;
                                return fn(session, _features.message);

                            case 9:
                                return _context3.abrupt('return', _context3.sent);

                            case 10:
                                _context3.prev = 10;
                                _context3.next = 13;
                                return Device._release(descriptor, session, deviceList, onRelease);

                            case 13:
                                return _context3.finish(10);

                            case 14:
                            case 'end':
                                return _context3.stop();
                        }
                    }
                }, _callee3, this, [[3,, 10, 14]]);
            }));

            function _run(_x6, _x7, _x8, _x9, _x10, _x11, _x12) {
                return _ref3.apply(this, arguments);
            }

            return _run;
        }()

        // Release and acquire are quite complex,
        // because we have to deal with various race conditions
        // for multitasking

    }, {
        key: '_release',
        value: function _release(originalDescriptor, session, deviceList, onRelease) {
            var released = (0, _connectionLock.lock)(function () {
                return promiseFinally(session.release(false), function (res, error) {
                    if (error == null) {
                        deviceList.setHard(originalDescriptor.path, null);
                    }
                    return Promise.resolve();
                });
            });
            return promiseFinally(released, function (res, error) {
                if (onRelease != null) {
                    return onRelease(error);
                }
                return Promise.resolve();
            });
        }
    }, {
        key: '_acquire',
        value: function _acquire(transport, descriptor, deviceList, onAcquire, device) {
            return (0, _connectionLock.lock)(function () {
                return transport.acquire({
                    path: descriptor.path,
                    previous: descriptor.session,
                    checkPrevious: true
                }).then(function (res) {
                    deviceList.setHard(descriptor.path, res);
                    return res;
                });
            }).then(function (result) {
                var session = new _session2.default(transport, result, descriptor, !!deviceList.options.debugInfo, device, deviceList.xpubDerive);
                if (onAcquire != null) {
                    onAcquire(session);
                }
                return session;
            });
        }
    }, {
        key: 'fromDescriptor',
        value: function fromDescriptor(transport, originalDescriptor, deviceList) {
            // at this point I am assuming nobody else has the device
            var descriptor = _extends({}, originalDescriptor, { session: null });
            return Device._run(function (session, features) {
                return new Device(transport, descriptor, features, deviceList);
            }, transport, descriptor, deviceList);
        }
    }]);

    return Device;
}(_events.EventEmitter);

// Forwards events from source to target

exports.default = Device;
function forwardError(source, target) {
    source.on(function (arg) {
        if (target.listenerCount() === 0) {
            return;
        }
        target.emit(arg);
    });
}

function forwardCallback1(source, target) {
    source.on(function (arg) {
        target.emit(arg);
    });
}

function forwardCallback2(source, target) {
    source.on(function (arg, arg2) {
        target.emit(arg, arg2);
    });
}

function forward1(source, target) {
    source.on(function (arg) {
        target.emit(arg);
    });
}

function forward2(source, target) {
    source.on(function (arg1, arg2) {
        target.emit(arg1, arg2);
    });
}

function promiseFinally(p, fun) {
    return p.then(function (res) {
        return fun(res, null).then(function () {
            return res;
        });
    }, function (err) {
        return fun(null, err).then(function () {
            throw err;
        }, function () {
            throw err;
        });
    });
}

function sha256x2(value) {
    var realBuffer = typeof value === 'string' ? new Buffer(value, 'binary') : value;
    return bitcoin.crypto.hash256(realBuffer);
}
module.exports = exports['default'];