/* @flow weak */
"use strict";

import randombytes from 'randombytes';
import EventEmitter from 'events';
import extend from 'extend';

// String.normalize
// (not possible in ES6 way)
require('unorm');

type MsgResponse = {
    type: string;
    message: FixLaterMsg;
}

// TODO add proper flow typing when it's time
type FixLaterMsg = Object;
type FixLaterSettings = Object;
type FixLaterPayload = Object;
type FixLater = any;

export type Transport = {
    enumerate: () => Promise<Array<DeviceDescriptor>>;
    acquire: (i: DeviceDescriptor) => Promise<DeviceDescriptor>;
    supportsSync: ?boolean;
    release: (s: string) => Promise;
    releaseSync: (s: string) => void;
    call: (s: string, type: string, msg: Object) => Promise<MsgResponse>;
    callSync: (s: string, type: string, msg: Object) => MsgResponse;
};

export type DeviceDescriptor = {
    path: string;
    session: ?string;
}


//
// Trezor device session handle. Acts as a event emitter.
//
// Events:
//
//  send: type, message
//  receive: type, message
//  error: error
//
//  button: code
//  pin: type, callback(error, pin)
//  word: callback(error, word)
//  passphrase: callback(error, passphrase)
//
export default class Session extends EventEmitter {
    _transport: Transport;
    _sessionId: string;
    _descriptor: DeviceDescriptor;
    _emitter: EventEmitter;
    supportsSync: boolean;
  
    constructor(transport: Transport, sessionId: string, descriptor) {
        super();
        this._transport = transport;
        this._sessionId = sessionId;
        this._descriptor = descriptor;
        this._emitter = this;
        this.supportsSync = !!transport.supportsSync;
    }

    getId(): string {
        return this._sessionId;
    }

    getPath(): string {
        return this._descriptor.path;
    }

    isDescriptor(descriptor: DeviceDescriptor): boolean {
        return this._descriptor.path === descriptor.path;
    }

    release(): Promise {
        console.log('[trezor] Releasing session');
        return this._transport.release(this._sessionId);
    }

    /**
     * Blocks the browser thread, be careful.
     */
     releaseSync(): void {

        if (!this.supportsSync) {
            throw new Error('Blocking release is not supported');
        }
        console.log('[trezor] Releasing session synchronously');
        return this._transport.releaseSync(this._sessionId);
    }

    initialize(): Promise<FixLaterMsg> {
        return this._typedCommonCall('Initialize', 'Features');
    }

    getFeatures(): Promise<FixLaterMsg> {
        return this._typedCommonCall('GetFeatures', 'Features');
    }

    getEntropy(size): Promise<{size: number}> {
        return this._typedCommonCall('GetEntropy', 'Entropy', {
            size: size
        });
    }

    getAddress(address_n: Array<number>, coin: {coin_name: string}, show_display: ?boolean): Promise<string> {
        return this._typedCommonCall('GetAddress', 'Address', {
            address_n: address_n,
            coin_name: coin.coin_name,
            show_display: !!show_display
        }).then(res => {
            res.message.path = address_n || [];
            return res;
        });
    }

    getPublicKey(address_n: Array<number>): Promise<FixLaterMsg> {
        return this._typedCommonCall('GetPublicKey', 'PublicKey', {
            address_n: address_n
        }).then(res => {
            res.message.node.path = address_n || [];
            return res;
        });
    }

    wipeDevice(): Promise<void> {
        return this._commonCall('WipeDevice');
    }

    resetDevice(settings: FixLaterSettings): Promise<void> {
        return this._commonCall('ResetDevice', settings);
    }

    loadDevice(settings: FixLaterSettings): Promise<void> {
        return this._commonCall('LoadDevice', settings);
    }

    recoverDevice(settings: FixLaterSettings): Promise<void> {
        return this._commonCall('RecoveryDevice', settings);
    }

    applySettings(settings: FixLaterSettings): Promise<void> {
        return this._commonCall('ApplySettings', settings);
    }

    clearSession(settings: FixLaterSettings): Promise<void> {
        return this._commonCall('ClearSession', settings);
    }

    // Blocks the browser thread, be careful.
    clearSessionSync(settings: FixLaterSettings): Promise<void> {
        return this._callSync('ClearSession', settings);
    }

    changePin(remove: ?boolean): Promise<void> {
        return this._commonCall('ChangePin', {
            remove: remove || false
        });
    }

    eraseFirmware(): Promise<void> {
        return this._commonCall('FirmwareErase');
    }

    uploadFirmware(payload: FixLaterPayload): Promise<void> {
        return this._commonCall('FirmwareUpload', {
            payload: payload
        });
    }

    verifyMessage(address: string, signature: string, message: string): Promise<void> {
        return this._commonCall('VerifyMessage', {
            address: address,
            signature: signature,
            message: message
        });
    }

    signMessage(address_n: Array<number>, message: string, coin: {coin_name: string}): Promise<FixLaterMsg> {
        return this._typedCommonCall('SignMessage', 'MessageSignature', {
            address_n: address_n,
            message: message,
            coin_name: coin.coin_name
        });
    }

    signIdentity(identity: FixLater, challenge_hidden: FixLater, challenge_visual: FixLater): Promise<FixLater> {
        return this._typedCommonCall('SignIdentity', 'SignedIdentity', {
            identity: identity,
            challenge_hidden: challenge_hidden,
            challenge_visual: challenge_visual
        });
    }

    cipherKeyValue(
        address_n: Array<number>, 
        key: string,
        value: string, 
        encrypt: boolean, 
        ask_on_encrypt: boolean,
        ask_on_decrypt: boolean, 
        iv: FixLater
    ) {
        return this._typedCommonCall('CipherKeyValue', 'CipheredKeyValue', {
            address_n: address_n,
            key: key,
            value: value,
            encrypt: encrypt,
            ask_on_encrypt: ask_on_encrypt,
            ask_on_decrypt: ask_on_decrypt,
            iv: iv
        });
    }

    measureTx(inputs: FixLater, outputs: FixLater, coin: {coin_name: string}) {
        return this._typedCommonCall('EstimateTxSize', 'TxSize', {
            inputs_count: inputs.length,
            outputs_count: outputs.length,
            coin_name: coin.coin_name
        });
    }

    _indexTxsForSign(inputs: FixLater, outputs: FixLater, txs: FixLater): FixLater {
        const index = {};

        // Tx being signed
        index[''] = {
            inputs: inputs,
            outputs: outputs
        };

        // Referenced txs
        txs.forEach(tx => {
            index[tx.hash.toLowerCase()] = tx;
        });

        return index;
    }

    signTx(inputs: FixLater, outputs: FixLater, txs: FixLater, coin: {coin_name: string}) {
        let index = this._indexTxsForSign(inputs, outputs, txs);
        let signatures = [];
        let serializedTx = '';

        return this._typedCommonCall('SignTx', 'TxRequest', {
            inputs_count: inputs.length,
            outputs_count: outputs.length,
            coin_name: coin.coin_name
        }).then((res) => process(res));

        function process(res) {
            const m = res.message;
            const ms = m.serialized;
            const md = m.details;

            if (ms && ms.serialized_tx != null)
                serializedTx += ms.serialized_tx;
            if (ms && ms.signature_index != null)
                signatures[ms.signature_index] = ms.signature;

            if (m.request_type === 'TXFINISHED')
                return { // same format as SimpleSignTx
                    message: {
                        serialized: {
                            signatures: signatures,
                            serialized_tx: serializedTx
                        }
                    }
                };

            let resTx = {};
            let reqTx = index[(md.tx_hash || '').toLowerCase()];

            if (!reqTx)
                throw new Error(md.tx_hash
                                ? (`Requested unknown tx: ${md.tx_hash}`)
                                : ('Requested tx for signing not indexed')
                               );

            switch (m.request_type) {

            case 'TXINPUT':
                resTx.inputs = [reqTx.inputs[+md.request_index]];
                break;

            case 'TXOUTPUT':
                if (md.tx_hash)
                    resTx.bin_outputs = [reqTx.bin_outputs[+md.request_index]];
                else
                    resTx.outputs = [reqTx.outputs[+md.request_index]];
                break;

            case 'TXMETA':
                resTx.version = reqTx.version;
                resTx.lock_time = reqTx.lock_time;
                resTx.inputs_cnt = reqTx.inputs.length;
                if (md.tx_hash)
                    resTx.outputs_cnt = reqTx.bin_outputs.length;
                else
                    resTx.outputs_cnt = reqTx.outputs.length;
                break;

            default:
                throw new Error(`Unknown request type: ${m.request_type}`);
            }

            return this._typedCommonCall('TxAck', 'TxRequest', {
                tx: resTx
            }).then(process);
        }
    }

    _typedCommonCall(type, resType, msg) {

        return this._commonCall(type, msg).then(res => {
            return this._assertType(res, resType);
        });
    }

    _assertType(res, resType) {
        if (res.type !== resType)
            throw new TypeError(`Response of unexpected type: ${res.type}`);
        return res;
    }

    _commonCall(type, msg) {
        const callpr = this._call(type, msg);

        return callpr.then(res => {
            return this._filterCommonTypes(res);
        });
    }
    
    /**
     * @param {Object} res {type, message}
     * @return {Object|Promise} either a message response or a promise resolving to one
     */
    _filterCommonTypes(res) {
    

        if (res.type === 'Failure')
            throw res.message;

        if (res.type === 'ButtonRequest') {
            this._emitter.emit('button', res.message.code);
            return this._commonCall('ButtonAck');
        }

        if (res.type === 'EntropyRequest')
            return this._commonCall('EntropyAck', {
                entropy: stringToHex(this._generateEntropy(32))
            });

        if (res.type === 'PinMatrixRequest')
            return this._promptPin(res.message.type).then(
                pin => {
                    return this._commonCall('PinMatrixAck', { pin: pin });
                },
                () => {
                    return this._commonCall('Cancel');
                }
            );

        if (res.type === 'PassphraseRequest')
            return this._promptPassphrase().then(
                passphrase => {
                    return this._commonCall('PassphraseAck', { passphrase: passphrase });
                },
                err => {
                    return this._commonCall('Cancel').then(null, e => {
                        throw err || e;
                    });
                }
            );

        if (res.type === 'WordRequest')
            return this._promptWord().then(
                word => {
                    return this._commonCall('WordAck', { word: word });
                },
                () => {
                    return this._commonCall('Cancel');
                }
            );

        return res;
    }

    _promptPin(type) {

        return new Promise((resolve, reject) => {
            if (!this._emitter.emit('pin', type, (err, pin) => {
                if (err || pin == null)
                    reject(err);
                else
                    resolve(pin);
            })) {
                console.warn('[trezor] PIN callback not configured, cancelling request');
                reject();
            }
        });
    }

    _promptPassphrase() {

        return new Promise((resolve, reject) => {
            if (!this._emitter.emit('passphrase', (err, passphrase) => {
                if (err || passphrase == null)
                    reject(err);
                else
                    resolve(passphrase.normalize('NFKD'));
            })) {
                // TODO can this happen at all?
                console.warn('[trezor] Passphrase callback not configured, cancelling request');
                reject();
            }
        });
    }

    _promptWord() {
        return new Promise((resolve, reject) => {
            if (!this._emitter.emit('word', (err, word) => {
                if (err || word == null)
                    reject(err);
                else
                    resolve(word.toLocaleLowerCase());
            })) {
                // TODO can this happen at all?
                console.warn('[trezor] Word callback not configured, cancelling request');
                reject();
            }
        });
    }

    _generateEntropy(len) {
        if (global.crypto || global.msCrypto) {
            return randombytes(len).toString('binary');
        } else {
            return this._generatePseudoEntropy(len);
        }
    }

    _generatePseudoEntropy(len) {
        const len_ = +len;
        const bytes = new Buffer(len_);

        console.warn('[trezor] Using pseudo entropy');

        for (let i = 0; i < len_; i++)
            bytes[i] = Math.floor(Math.random() * 256);

        return bytes.toString('binary');
    }

    // Sends an async message to the opened device.
    _call(type, msg={}) {
            
        const logMessage = this._filterForLog(type, msg);

        console.log('[trezor] Sending', type, logMessage);
        this._emitter.emit('send', type, msg);

        return this._transport.call(this._sessionId, type, msg).then(
            res => {
                const logMessage = this._filterForLog(res.type, res.message);

                console.log('[trezor] Received', res.type, logMessage);
                this._emitter.emit('receive', res.type, res.message);
                return res;
            },
            err => {
                console.log('[trezord] Received error', err);
                this._emitter.emit('error', err);
                throw err;
            }
        );
    }

    // Sends a blocking message to an opened device. Be careful, the whole
    // tab thread gets blocked and does not respond. Also, we don't do any
    // timeouts here.
    _callSync(type, msg={}) {

        if (!this.supportsSync) {
            throw new Error('Blocking calls are not supported');
        }

        let logMessage = this._filterForLog(type, msg);
        console.log('[trezor] Sending', type, logMessage);

        this._emitter.emit('send', type, msg);

        try {
            const res = this._transport.callSync(this._sessionId, type, msg);

            logMessage = this._filterForLog(res.type, res.message);
            console.log('[trezor] Received', res.type, logMessage);

            this._emitter.emit('receive', res.type, res.message);

            return res;

        } catch (err) {
            console.log('[trezord] Received error', err);
            this._emitter.emit('error', err);
            throw err;
        }
    }

    _filterForLog(type, msg) {
        const redacted = {},
              blacklist = {
                  PassphraseAck: {
                      passphrase: '(redacted...)'
                  }
              };

        if (type in blacklist) {
            return extend(redacted, msg, blacklist[type]);
        } else {
            return msg;
        }
    }
}


//
// Hex codec
//

// Encode binary string to hex string
function stringToHex(bin) {
    let i, chr, hex = '';

    for (i = 0; i < bin.length; i++) {
        chr = (bin.charCodeAt(i) & 0xFF).toString(16);
        hex += chr.length < 2 ? `0${chr}` : chr;
    }

    return hex;
}

// Decode hex string to binary string
function hexToString(hex) {
    let i, bytes = [];

    for (i = 0; i < hex.length - 1; i += 2)
        bytes.push(parseInt(hex.substr(i, 2), 16));

    return String.fromCharCode.apply(String, bytes);
}
