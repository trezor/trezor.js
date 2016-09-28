'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.CallHelper = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _randombytes = require('randombytes');

var _randombytes2 = _interopRequireDefault(_randombytes);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function assertType(res, resType) {
    if (res.type !== resType) {
        throw new TypeError('Response of unexpected type: ' + res.type);
    }
}

function generateEntropy(len) {
    if (global.crypto || global.msCrypto) {
        return (0, _randombytes2.default)(len);
    } else {
        throw new Error('Browser does not support crypto random');
    }
}

function filterForLog(type, msg) {
    var blacklist = {
        PassphraseAck: {
            passphrase: '(redacted...)'
        },
        CipheredKeyValue: {
            value: '(redacted...)'
        },
        GetPublicKey: {
            address_n: '(redacted...)'
        },
        PublicKey: {
            node: '(redacted...)',
            xpub: '(redacted...)'
        },
        DecryptedMessage: {
            message: '(redacted...)',
            address: '(redacted...)'
        }
    };

    if (type in blacklist) {
        return _extends({}, msg, blacklist[type]);
    } else {
        return msg;
    }
}

var CallHelper = exports.CallHelper = function () {
    function CallHelper(transport, sessionId, session) {
        _classCallCheck(this, CallHelper);

        this.transport = transport;
        this.sessionId = sessionId;
        this.session = session;
    }

    // Sends an async message to the opened device.


    _createClass(CallHelper, [{
        key: 'call',
        value: function call(type) {
            var _this = this;

            var msg = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

            var logMessage = filterForLog(type, msg);

            if (this.session.debug) {
                console.log('[trezor.js] [call] Sending', type, logMessage);
            }
            this.session.sendEvent.emit(type, msg);

            return this.transport.call(this.sessionId, type, msg).then(function (res) {
                var logMessage = filterForLog(res.type, res.message);

                if (_this.session.debug) {
                    console.log('[trezor.js] [call] Received', res.type, logMessage);
                }
                _this.session.receiveEvent.emit(res.type, res.message);
                return res;
            }, function (err) {
                if (_this.session.debug) {
                    console.log('[trezor.js] [call] Received error', err);
                }
                _this.session.errorEvent.emit(err);
                throw err;
            });
        }
    }, {
        key: 'typedCall',
        value: function typedCall(type, resType) {
            var msg = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

            return this._commonCall(type, msg).then(function (res) {
                assertType(res, resType);
                return res;
            });
        }
    }, {
        key: '_commonCall',
        value: function _commonCall(type, msg) {
            var _this2 = this;

            return this.call(type, msg).then(function (res) {
                return _this2._filterCommonTypes(res);
            });
        }
    }, {
        key: '_filterCommonTypes',
        value: function _filterCommonTypes(res) {
            var _this3 = this;

            if (res.type === 'Failure') {
                var e = new Error(res.message.message);
                // $FlowIssue extending errors in ES6 "correctly" is a PITA
                e.code = res.message.code;
                return Promise.reject(e);
            }

            if (res.type === 'ButtonRequest') {
                this.session.buttonEvent.emit(res.message.code);
                return this._commonCall('ButtonAck', {});
            }

            if (res.type === 'EntropyRequest') {
                return this._commonCall('EntropyAck', {
                    entropy: generateEntropy(32).toString('hex')
                });
            }

            if (res.type === 'PinMatrixRequest') {
                return this._promptPin(res.message.type).then(function (pin) {
                    return _this3._commonCall('PinMatrixAck', { pin: pin });
                }, function () {
                    return _this3._commonCall('Cancel', {});
                });
            }

            if (res.type === 'PassphraseRequest') {
                return this._promptPassphrase().then(function (passphrase) {
                    return _this3._commonCall('PassphraseAck', { passphrase: passphrase });
                }, function (err) {
                    return _this3._commonCall('Cancel', {}).catch(function (e) {
                        throw err || e;
                    });
                });
            }

            if (res.type === 'WordRequest') {
                return this._promptWord().then(function (word) {
                    return _this3._commonCall('WordAck', { word: word });
                }, function () {
                    return _this3._commonCall('Cancel', {});
                });
            }

            return Promise.resolve(res);
        }
    }, {
        key: '_promptPin',
        value: function _promptPin(type) {
            var _this4 = this;

            return new Promise(function (resolve, reject) {
                if (!_this4.session.pinEvent.emit(type, function (err, pin) {
                    if (err || pin == null) {
                        reject(err);
                    } else {
                        resolve(pin);
                    }
                })) {
                    if (_this4.session.debug) {
                        console.warn('[trezor.js] [call] PIN callback not configured, cancelling request');
                    }
                    reject(new Error('PIN callback not configured'));
                }
            });
        }
    }, {
        key: '_promptPassphrase',
        value: function _promptPassphrase() {
            var _this5 = this;

            return new Promise(function (resolve, reject) {
                if (!_this5.session.passphraseEvent.emit(function (err, passphrase) {
                    if (err || passphrase == null) {
                        reject(err);
                    } else {
                        resolve(passphrase.normalize('NFKD'));
                    }
                })) {
                    if (_this5.session.debug) {
                        console.warn('[trezor.js] [call] Passphrase callback not configured, cancelling request');
                    }
                    reject(new Error('Passphrase callback not configured'));
                }
            });
        }
    }, {
        key: '_promptWord',
        value: function _promptWord() {
            var _this6 = this;

            return new Promise(function (resolve, reject) {
                if (!_this6.session.wordEvent.emit(function (err, word) {
                    if (err || word == null) {
                        reject(err);
                    } else {
                        resolve(word.toLocaleLowerCase());
                    }
                })) {
                    if (_this6.session.debug) {
                        console.warn('[trezor.js] [call] Word callback not configured, cancelling request');
                    }
                    reject(new Error('Word callback not configured'));
                }
            });
        }
    }]);

    return CallHelper;
}();