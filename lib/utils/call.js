/* @flow */
'use strict';
import * as types from '../flowtypes';
import randombytes from 'randombytes';
import type {EventEmitter} from '../events-flowtype-bug';

function assertType(res: types.DefaultMessageResponse, resType: string) {
    if (res.type !== resType) {
        throw new TypeError(`Response of unexpected type: ${res.type}`);
    }
}

function generateEntropy(len: number): Buffer {
    if (global.crypto || global.msCrypto) {
        return randombytes(len);
    } else {
        return generatePseudoEntropy(len);
    }
}

// this is not secure, but it doesn't really need to be,
// since the entropy is mixed with Trezor's own one
function generatePseudoEntropy(len: number): Buffer {
    const len_ = +len;
    const bytes = new Buffer(len_);

    console.warn('[trezor] Using pseudo entropy');

    for (let i = 0; i < len_; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
    }

    return bytes;
}

function filterForLog(type: string, msg: Object): Object {
    const blacklist = {
        PassphraseAck: {
            passphrase: '(redacted...)',
        },
        CipheredKeyValue: {
            value: '(redacted...)',
        },
        DecryptedMessage: {
            message: '(redacted...)',
            address: '(redacted...)',
        },
    };

    if (type in blacklist) {
        return Object.assign({}, msg, blacklist[type]);
    } else {
        return msg;
    }
}

export class CallHelper {
    emitter: EventEmitter;
    transport: types.Transport;
    sessionId: string;
    supportsSync: boolean;

    constructor(
        transport: types.Transport,
        emitter: EventEmitter,
        sessionId: string,
        supportsSync: boolean
    ) {
        this.transport = transport;
        this.emitter = emitter;
        this.sessionId = sessionId;
        this.supportsSync = supportsSync;
    }

    // Sends an async message to the opened device.
    call(type: string, msg_: ?Object): Promise<types.DefaultMessageResponse> {
        const msg = msg_ == null ? {} : msg;
        const logMessage: Object = filterForLog(type, msg);

        console.log('[trezor] Sending', type, logMessage);
        this.emitter.emit('send', type, msg);

        return this.transport.call(this.sessionId, type, msg).then(
            (res: types.DefaultMessageResponse) => {
                const logMessage = filterForLog(res.type, res.message);

                console.log('[trezor] Received', res.type, logMessage);
                this.emitter.emit('receive', res.type, res.message);
                return res;
            },
            err => {
                console.log('[trezord] Received error', err);
                this.emitter.emit('error', err);
                throw err;
            }
        );
    }

    callSync(type: string, msg_: ?Object): types.DefaultMessageResponse {
        const msg = msg_ == null ? {} : msg;
        if (!this.supportsSync) {
            throw new Error('Blocking calls are not supported');
        }

        let logMessage = filterForLog(type, msg);
        console.log('[trezor] Sending', type, logMessage);

        this.emitter.emit('send', type, msg);

        try {
            const res = this.transport.callSync(this.sessionId, type, msg);

            logMessage = filterForLog(res.type, res.message);
            console.log('[trezor] Received', res.type, logMessage);

            this.emitter.emit('receive', res.type, res.message);

            return res;
        } catch (err) {
            console.log('[trezord] Received error', err);
            this.emitter.emit('error', err);
            throw err;
        }
    }

    typedCall(type: string, resType: string, msg_: ?Object): Promise<types.DefaultMessageResponse> {
        const msg = msg_ == null ? {} : msg;
        return this._commonCall(type, msg).then(res => {
            assertType(res, resType);
            return res;
        });
    }

    _commonCall(type: string, msg: Object): Promise<types.DefaultMessageResponse> {
        return this.call(type, msg).then(res =>
            this._filterCommonTypes(res)
        );
    }

    _filterCommonTypes(res: types.DefaultMessageResponse): Promise<types.DefaultMessageResponse> {
        if (res.type === 'Failure') {
            return Promise.reject(new Error(res.message.code + ':' + res.message.message));
        }

        if (res.type === 'ButtonRequest') {
            this.emitter.emit('button', res.message.code);
            return this._commonCall('ButtonAck', {});
        }

        if (res.type === 'EntropyRequest') {
            return this._commonCall('EntropyAck', {
                entropy: generateEntropy(32).toString('hex'),
            });
        }

        if (res.type === 'PinMatrixRequest') {
            return this._promptPin(res.message.type).then(
                pin => {
                    return this._commonCall('PinMatrixAck', { pin: pin });
                },
                () => {
                    return this._commonCall('Cancel', {});
                }
            );
        }

        if (res.type === 'PassphraseRequest') {
            return this._promptPassphrase().then(
                passphrase => {
                    return this._commonCall('PassphraseAck', { passphrase: passphrase });
                },
                err => {
                    return this._commonCall('Cancel', {}).catch(e => {
                        throw err || e;
                    });
                }
            );
        }

        if (res.type === 'WordRequest') {
            return this._promptWord().then(
                word => {
                    return this._commonCall('WordAck', { word: word });
                },
                () => {
                    return this._commonCall('Cancel', {});
                }
            );
        }

        return Promise.resolve(res);
    }

    _promptPin(type: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.emitter.emit('pin', type, (err, pin) => {
                if (err || pin == null) {
                    reject(err);
                } else {
                    resolve(pin);
                }
            })) {
                console.warn('[trezor] PIN callback not configured, cancelling request');
                reject();
            }
        });
    }

    _promptPassphrase(): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.emitter.emit('passphrase', (err, passphrase) => {
                if (err || passphrase == null) {
                    reject(err);
                } else {
                    resolve(passphrase.normalize('NFKD'));
                }
            })) {
                console.warn('[trezor] Passphrase callback not configured, cancelling request');
                reject();
            }
        });
    }

    _promptWord(): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.emitter.emit('word', (err, word) => {
                if (err || word == null) {
                    reject(err);
                } else {
                    resolve(word.toLocaleLowerCase());
                }
            })) {
                console.warn('[trezor] Word callback not configured, cancelling request');
                reject();
            }
        });
    }
}
