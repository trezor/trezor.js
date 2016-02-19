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

export class CallHelper {
    call: (type: string, msg: Object) => Promise<types.DefaultMessageResponse>;
    emitter: EventEmitter;

    constructor(
        call: (type: string, msg: Object) => Promise<types.DefaultMessageResponse>,
        emitter: EventEmitter
    ) {
        this.call = call;
        this.emitter = emitter;
    }

    doCall(type: string, resType: string, msg?: Object = {}): Promise<types.DefaultMessageResponse> {
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
