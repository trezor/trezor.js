/* @flow */
'use strict';

import randombytes from 'randombytes';

import type {DefaultMessageResponse} from '../session';
import type {Transport} from '../transport';
import type Session from '../session';

function assertType(res: DefaultMessageResponse, resType: string) {
    if (res.type !== resType) {
        throw new TypeError(`Response of unexpected type: ${res.type}`);
    }
}

function generateEntropy(len: number): Buffer {
    if (global.crypto || global.msCrypto) {
        return randombytes(len);
    } else {
        throw new Error('Browser does not support crypto random');
    }
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
        return { ...msg, ...blacklist[type] };
    } else {
        return msg;
    }
}

export class CallHelper {
    transport: Transport;
    sessionId: number|string;
    supportsSync: boolean;
    session: Session;

    constructor(
        transport: Transport,
        sessionId: number | string,
        supportsSync: boolean,
        session: Session
    ) {
        this.transport = transport;
        this.sessionId = sessionId;
        this.supportsSync = supportsSync;
        this.session = session;
    }

    // Sends an async message to the opened device.
    call(type: string, msg: Object = {}): Promise<DefaultMessageResponse> {
        const logMessage: Object = filterForLog(type, msg);

        console.log('[trezor] Sending', type, logMessage);
        this.session.sendEvent.emit(type, msg);

        return this.transport.call(this.sessionId, type, msg).then(
            (res: DefaultMessageResponse) => {
                const logMessage = filterForLog(res.type, res.message);

                console.log('[trezor] Received', res.type, logMessage);
                this.session.receiveEvent.emit(res.type, res.message);
                return res;
            },
            err => {
                console.log('[trezord] Received error', err);
                this.session.errorEvent.emit(err);
                throw err;
            }
        );
    }

    callSync(type: string, msg: Object = {}): DefaultMessageResponse {
        if (!this.supportsSync) {
            throw new Error('Blocking calls are not supported');
        }

        let logMessage = filterForLog(type, msg);
        console.log('[trezor] Sending', type, logMessage);

        this.session.sendEvent.emit(type, msg);

        try {
            const res = this.transport.callSync(this.sessionId, type, msg);

            logMessage = filterForLog(res.type, res.message);
            console.log('[trezor] Received', res.type, logMessage);

            this.session.receiveEvent.emit(res.type, res.message);

            return res;
        } catch (err) {
            console.log('[trezord] Received error', err);
            this.session.errorEvent.emit(err);
            throw err;
        }
    }

    typedCall(type: string, resType: string, msg: Object = {}): Promise<DefaultMessageResponse> {
        return this._commonCall(type, msg).then(res => {
            assertType(res, resType);
            return res;
        });
    }

    _commonCall(type: string, msg: Object): Promise<DefaultMessageResponse> {
        return this.call(type, msg).then(res =>
            this._filterCommonTypes(res)
        );
    }

    _filterCommonTypes(res: DefaultMessageResponse): Promise<DefaultMessageResponse> {
        if (res.type === 'Failure') {
            return Promise.reject(new Error(res.message.message));
        }

        if (res.type === 'ButtonRequest') {
            this.session.buttonEvent.emit(res.message.code);
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
            if (!this.session.pinEvent.emit(type, (err, pin) => {
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
            if (!this.session.passphraseEvent.emit((err, passphrase) => {
                if (err || passphrase == null) {
                    reject(err);
                } else {
                    /* $FlowIssue - https://github.com/facebook/flow/pull/1562 */
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
            if (!this.session.wordEvent.emit((err, word) => {
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
