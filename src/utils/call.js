/* @flow */
'use strict';

import randombytes from 'randombytes';

import type {DefaultMessageResponse} from '../session';
import type {Transport} from 'trezor-link';
import type Session from '../session';

function assertType(res: DefaultMessageResponse, resTypes: string) {
    const splitResTypes = resTypes.split('|');
    if (!(splitResTypes.includes(res.type))) {
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
        // PassphraseAck: {
        //     passphrase: '(redacted...)',
        //     on_device: msg.on_device,
        // },
        CipheredKeyValue: {
            value: '(redacted...)',
        },
        GetPublicKey: '',
        // GetPublicKey: {
        //     address_n: '(redacted...)',
        // },
        PublicKey: '',
        // PublicKey: {
        //     node: '(redacted...)',
        //     xpub: '(redacted...)',
        // },
        DecryptedMessage: {
            message: '(redacted...)',
            address: '(redacted...)',
        },
        FirmwareUpload: {
            payload: '...',
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
    sessionId: string;
    session: Session;

    constructor(
        transport: Transport,
        sessionId: string,
        session: Session
    ) {
        this.transport = transport;
        this.sessionId = sessionId;
        this.session = session;
    }

    read(): Promise<DefaultMessageResponse> {
        return this.transport.read(this.sessionId, this.session.debugLink).then(
            (res: DefaultMessageResponse) => {
                const logMessage = filterForLog(res.type, res.message);

                if (this.session.debug) {
                    console.log('[trezor.js] [call] Received', res.type, logMessage);
                }
                this.session.receiveEvent.emit(res.type, res.message);
                return res;
            },
            err => {
                if (this.session.debug) {
                    console.log('[trezor.js] [call] Received error', err);
                }
                this.session.errorEvent.emit(err);
                throw err;
            }
        );
    }

    post(type: string, msg: Object): Promise<void> {
        const logMessage: Object = filterForLog(type, msg);

        if (this.session.debug) {
            console.log('[trezor.js] [call] Sending', type, logMessage);
        }
        this.session.sendEvent.emit(type, msg);

        return this.transport.post(this.sessionId, type, msg, this.session.debugLink).catch(err => {
            if (this.session.debug) {
                console.log('[trezor.js] [call] Received error', err);
            }
            this.session.errorEvent.emit(err);
            throw err;
        }
        );
    }

    // Sends an async message to the opened device.
    call(type: string, msg: Object): Promise<DefaultMessageResponse> {
        const logMessage: Object = filterForLog(type, msg);

        if (this.session.debug) {
            console.log('[trezor.js] [call] Sending', type, logMessage);
        }
        this.session.sendEvent.emit(type, msg);

        return this.transport.call(this.sessionId, type, msg, this.session.debugLink).then(
            (res: DefaultMessageResponse) => {
                const logMessage = filterForLog(res.type, res.message);

                if (this.session.debug) {
                    console.log('[trezor.js] [call] Received', res.type, logMessage);
                }
                this.session.receiveEvent.emit(res.type, res.message);
                return res;
            },
            err => {
                if (this.session.debug) {
                    console.log('[trezor.js] [call] Received error', err);
                }
                this.session.errorEvent.emit(err);
                throw err;
            }
        );
    }

    typedCall(type: string, resType: string, msg: Object): Promise<DefaultMessageResponse> {
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
            const e = new Error(res.message.message);
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

        if (res.type === 'Deprecated_PassphraseStateRequest') {
            if (this.session.device) {
                const currentState = this.session.device.passphraseState;
                const receivedState = res.message.state;
                if (currentState != null && currentState !== receivedState) {
                    // when cached passphrase is different than entered passphrase
                    // cancel current request and emit error
                    return this._commonCall('Cancel', {}).catch(() => {
                        console.warn('tjs. Invalid passphrase');
                        this.session.errorEvent.emit(new Error('Invalid passphrase'));
                    });
                }
                this.session.device.passphraseState = receivedState;
                return this._commonCall('Deprecated_PassphraseStateAck', { });
            }
            // ??? nowhere to save the state, throwing error
            return Promise.reject(new Error('Nowhere to save passphrase state.'));
        }

        if (res.type === 'PassphraseRequest') {
            console.warn('PassphraseRequest', res);
            if (res.message._on_device) {
                // "fake" button event
                this.session.buttonEvent.emit('PassphraseOnDevice');
                if (this.session.device && this.session.device.passphraseState) {
                    return this._commonCall('PassphraseAck', { _state: this.session.device.passphraseState });
                }
                return this._commonCall('PassphraseAck', { });
            }
            console.warn('we have PassphraseRequest, returning Promise');
            return this._promptPassphrase().then(
                (res: Object) => {
                    const { passphrase, onDevice } = res;
                    const session_id = this.session.device && this.session.device.features.session_id;
                    const passphraseState = this.session.device && this.session.device.passphraseState;
                    // todo: what if is userInput undefined!???
                    console.warn('PassphraseRequest promise resolved with', passphrase, onDevice);
                    if (session_id) {
                        console.warn('sessionId');
                        return this._commonCall(
                            'PassphraseAck',
                            onDevice ? { on_device: true } : { passphrase: passphrase }
                        );
                    } else if (passphraseState) {
                        console.warn('legacy');

                        return this._commonCall(
                            'PassphraseAck', {
                                passphrase: passphrase,
                                _state: passphraseState,
                            });
                    } else {
                        console.warn('legacy legacy');
                        return this._commonCall('PassphraseAck', { passphrase: passphrase });
                    }
                },
                err => {
                    console.warn('tjs._promptPassphrase().err1', err);
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
                if (this.session.debug) {
                    console.warn('[trezor.js] [call] PIN callback not configured, cancelling request');
                }
                reject(new Error('PIN callback not configured'));
            }
        });
    }

    _promptPassphrase(): Promise<Object> {
        return new Promise((resolve, reject) => {
            if (!this.session.passphraseEvent.emit((err, passphrase, onDevice) => {
                console.warn('tjs this.session.passphraseEvent.emit', err, passphrase, onDevice);
                if (err || (!onDevice && passphrase == null)) {
                    return reject(err);
                }
                console.warn('_promptPassphrase() resolving with', passphrase, onDevice);
                return resolve({ passphrase, onDevice });

                // return resolve(passphrase ? passphrase.normalize('NFKD'): undefined, onDevice);
            })) {
                if (this.session.debug) {
                    console.warn('[trezor.js] [call] Passphrase callback not configured, cancelling request');
                }
                reject(new Error('Passphrase callback not configured'));
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
                if (this.session.debug) {
                    console.warn('[trezor.js] [call] Word callback not configured, cancelling request');
                }
                reject(new Error('Word callback not configured'));
            }
        });
    }
}
