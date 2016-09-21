'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.CallHelper = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _randombytes = require('randombytes');

var _randombytes2 = _interopRequireDefault(_randombytes);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function assertType(res, resType) {
    if (res.type !== resType) {
        throw new TypeError(`Response of unexpected type: ${ res.type }`);
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
    const blacklist = {
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

class CallHelper {

    constructor(transport, sessionId, session) {
        this.transport = transport;
        this.sessionId = sessionId;
        this.session = session;
    }

    // Sends an async message to the opened device.
    call(type) {
        let msg = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

        const logMessage = filterForLog(type, msg);

        if (this.session.debug) {
            console.log('[trezor.js] [call] Sending', type, logMessage);
        }
        this.session.sendEvent.emit(type, msg);

        return this.transport.call(this.sessionId, type, msg).then(res => {
            const logMessage = filterForLog(res.type, res.message);

            if (this.session.debug) {
                console.log('[trezor.js] [call] Received', res.type, logMessage);
            }
            this.session.receiveEvent.emit(res.type, res.message);
            return res;
        }, err => {
            if (this.session.debug) {
                console.log('[trezor.js] [call] Received error', err);
            }
            this.session.errorEvent.emit(err);
            throw err;
        });
    }

    typedCall(type, resType) {
        let msg = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

        return this._commonCall(type, msg).then(res => {
            assertType(res, resType);
            return res;
        });
    }

    _commonCall(type, msg) {
        return this.call(type, msg).then(res => this._filterCommonTypes(res));
    }

    _filterCommonTypes(res) {
        if (res.type === 'Failure') {
            return Promise.reject(new Error(res.message.message));
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
            return this._promptPin(res.message.type).then(pin => {
                return this._commonCall('PinMatrixAck', { pin: pin });
            }, () => {
                return this._commonCall('Cancel', {});
            });
        }

        if (res.type === 'PassphraseRequest') {
            return this._promptPassphrase().then(passphrase => {
                return this._commonCall('PassphraseAck', { passphrase: passphrase });
            }, err => {
                return this._commonCall('Cancel', {}).catch(e => {
                    throw err || e;
                });
            });
        }

        if (res.type === 'WordRequest') {
            return this._promptWord().then(word => {
                return this._commonCall('WordAck', { word: word });
            }, () => {
                return this._commonCall('Cancel', {});
            });
        }

        return Promise.resolve(res);
    }

    _promptPin(type) {
        return new Promise((resolve, reject) => {
            if (!this.session.pinEvent.emit(type, (err, pin) => {
                if (err || pin == null) {
                    reject(err);
                } else {
                    resolve(pin);
                }
            })) {
                if (this.session.debug) {
                    console.warn('[trezor.js] [call] PIN callback not configured, cancelling request');
                }
                reject(new Error('PIN callback not configured'));
            }
        });
    }

    _promptPassphrase() {
        return new Promise((resolve, reject) => {
            if (!this.session.passphraseEvent.emit((err, passphrase) => {
                if (err || passphrase == null) {
                    reject(err);
                } else {
                    resolve(passphrase.normalize('NFKD'));
                }
            })) {
                if (this.session.debug) {
                    console.warn('[trezor.js] [call] Passphrase callback not configured, cancelling request');
                }
                reject(new Error('Passphrase callback not configured'));
            }
        });
    }

    _promptWord() {
        return new Promise((resolve, reject) => {
            if (!this.session.wordEvent.emit((err, word) => {
                if (err || word == null) {
                    reject(err);
                } else {
                    resolve(word.toLocaleLowerCase());
                }
            })) {
                if (this.session.debug) {
                    console.warn('[trezor.js] [call] Word callback not configured, cancelling request');
                }
                reject(new Error('Word callback not configured'));
            }
        });
    }
}
exports.CallHelper = CallHelper;