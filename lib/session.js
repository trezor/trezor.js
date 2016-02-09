/* @flow */
'use strict';

import randombytes from 'randombytes';
import EventEmitter from 'events';
import {HDNode as BitcoinJsHDNode, ECPair} from 'bitcoinjs-lib';
import * as ecurve from 'ecurve';

// String.normalize
// (not possible in ES6 way)
require('unorm');

type MessageResponse<T> = {
    type: string;
    message: T; // in general, can be anything
}

type DefaultMessageResponse = MessageResponse<Object>;

export type Transport = {
    enumerate: () => Promise<Array<DeviceDescriptor>>;
    acquire: (i: DeviceDescriptor) => Promise<DeviceDescriptor>;
    supportsSync: boolean;
    release: (s: string) => Promise;
    releaseSync: (s: string) => void;
    call: (s: string, type: string, msg: Object) => Promise<DefaultMessageResponse>;
    callSync: (s: string, type: string, msg: Object) => DefaultMessageResponse;
    version: string;
};

export type DeviceDescriptor = {
    path: string;
    session: ?string;
}

type CoinType = {
    coin_name: string;
		coin_shortcut: string;
		address_type: number;
		maxfee_kb: number;
		address_type_p2sh: number;
}

export type Features = {
		vendor: string;
		major_version: number;
		minor_version: number;
		patch_version: number;
		bootloader_mode: boolean;
		device_id: string;
		pin_protection: boolean;
		passphrase_protection: boolean;
		language: string;
		label: string;
		coins: CoinType[];
		initialized: boolean;
		revision: string;
		bootloader_hash: string;
		imported: boolean;
		pin_cached: boolean;
		passphrase_cached: boolean;
}

type ResetDeviceSettings = {
    display_random?: boolean;
		strength?: number;
		passphrase_protection?: boolean;
		pin_protection?: boolean;
		language?: string;
		label?: string;
}

type LoadDeviceSettings = {
		pin?: string;
		passphrase_protection?: boolean;
		language?: string;
		label?: string;
		skip_checksum?: boolean;

		mnemonic: string;
		node: HDNode;
		payload: string; // will be converted
}

type RecoverDeviceSettings = {
		word_count?: number;
		passphrase_protection?: boolean;
		pin_protection?: boolean;
		language?: string;
		label?: string;
		enforce_wordlist?: boolean;
}

type ApplySettings = {
    language?: string;
		label?: string;
		use_passphrase?: boolean;
		homescreen?: string;
}

type MessageSignature = {
    address: string;
    signature: string;
}

type TransactionInput = {
    address_n?: Array<number>;
    prev_index: number;
    sequence?: number;
    prev_hash: string;
    script_sig?: string;
}

type TransactionOutput = {
    address: string;
    amount: number; // in satoshis
    script_type: string;
} | {
    address_n: Array<number>;
    amount: number; // in satoshis
    script_type: string;
}

type TransactionBinOutput = {
    amount: number;
    script_pubkey: string;
}

type RefTransaction = {
    hash: string;
    version: number;
    inputs: Array<TransactionInput>;
    bin_outputs: Array<TransactionBinOutput>;
    lock_time: number;
} | {
    hash: string;
    version: number;
    inputs: Array<TransactionInput>;
    outputs: Array<TransactionOutput>;
    lock_time: number;
};

type RefTransactionInputsOutputs = {
    inputs: Array<TransactionInput>;
    bin_outputs: Array<TransactionBinOutput>;
} | {
    inputs: Array<TransactionInput>;
    outputs: Array<TransactionOutput>;
};

type TxRequestDetails = {
    request_index: number;
    tx_hash?: string;
};

type TxRequestSerialized = {
    signature_index?: number;
    signature?: string;
    serialized_tx?: string;
}

type TxRequest = {
    request_type: 'TXINPUT' | 'TXOUTPUT' | 'TXMETA' | 'TXFINISHED';
    details: TxRequestDetails;
    serialized: TxRequestSerialized;
};

type SignedTx = {
    serialized: {
        signatures: Array<string>;
        serialized_tx: string;
    }
}

type Identity = {
    proto?: string;
    user?: string;
    host?: string;
    port?: string;
    path?: string;
    index?: number;
}

type SignedIdentity = {
    address: string;
    public_key: string;
    signature: string;
}

type PublicKey = {
    node: HDPubNode;
    xpub: string;
}

type HDPrivNode = {
    depth: number;
    fingerprint: number;
    child_num: number;
    chain_code: string;
    private_key: string;
};

type HDPubNode = {
    depth: number;
    fingerprint: number;
    child_num: number;
    chain_code: string;
    public_key: string;
};

type HDNode = HDPubNode | HDPrivNode;

function convertBitcoinJsHDNodeToHDPrivNode(node: BitcoinJsHDNode): HDPrivNode {
    const d = node.keyPair.d;
    if (!d) {
        throw new Error('Not a private node.');
    }
    const depth = node.depth;
    const fingerprint = node.fingerprint;
    const child_num = node.index;
    const private_key = d.toString('hex');
    const chain_code = node.chainCode.toString('hex');
    return {depth, fingerprint, child_num, chain_code, private_key};
}

function convertHDPubNodeToBitcoinJsNode(node: HDPubNode): BitcoinJsHDNode {
    const chainCode = new Buffer(node.chain_code, 'hex');
    const publicKey = new Buffer(node.public_key, 'hex');

    const Q = ecurve.Point.decodeFrom(ecurve.getCurveByName('secp256k1'), publicKey);
    const res = new BitcoinJsHDNode(new ECPair(null, Q), chainCode);

    res.depth = +node.depth;
    res.index = +node.child_num;
    res.parentFingerprint = node.fingerprint;

    return res;
}

// throws error on wrong xpub
function convertAndCheckPrivateKeyToBitcoinJsNode(key: MessageResponse<PublicKey>): BitcoinJsHDNode {
    const keyNode: HDPubNode = key.message.node;
    const bjsNode: BitcoinJsHDNode = convertHDPubNodeToBitcoinJsNode(keyNode);

    const bjsXpub: string = bjsNode.toBase58();
    const keyXpub: string = key.message.xpub;

    if (bjsXpub !== keyXpub) {
        throw new Error('Invalid public key transmission detected - ' +
                    'invalid xpub check. ' +
                    'Key: ' + bjsXpub + ', ' +
                    'Received: ' + keyXpub);
    }

    return bjsNode;
}

function checkDerivation(
    parBjsNode: BitcoinJsHDNode,
    childBjsNode: BitcoinJsHDNode,
    suffix: number
): void {
    const derivedChildBjsNode = parBjsNode.derive(suffix);

    const derivedXpub = derivedChildBjsNode.toBase58();
    const compXpub = childBjsNode.toBase58();

    if (derivedXpub !== compXpub) {
        throw new Error('Invalid public key transmission detected - ' +
                    'invalid child cross-check. ' +
                    'Computed derived: ' + derivedXpub + ', ' +
                    'Computed received: ' + compXpub);
    }
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

    constructor(transport: Transport, sessionId: string, descriptor: DeviceDescriptor) {
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

    initialize(): Promise<MessageResponse<Features>> {
        return this._typedCommonCall('Initialize', 'Features');
    }

    getFeatures(): Promise<MessageResponse<Features>> {
        return this._typedCommonCall('GetFeatures', 'Features');
    }

    getEntropy(size: number): Promise<MessageResponse<{bytes: string}>> {
        return this._typedCommonCall('GetEntropy', 'Entropy', {
            size: size,
        });
    }

    getAddress(address_n: Array<number>, coin: CoinType, show_display: ?boolean): Promise<MessageResponse<{
        address: string;
        path: Array<number>;
    }>> {
        return this._typedCommonCall('GetAddress', 'Address', {
            address_n: address_n,
            coin_name: coin.coin_name,
            show_display: !!show_display,
        }).then(res => {
            res.message.path = address_n || [];
            return res;
        });
    }

    getPublicKey(address_n: Array<number>): Promise<MessageResponse<PublicKey>> {
        return this._typedCommonCall('GetPublicKey', 'PublicKey', {
            address_n: address_n,
        }).then(res => {
            res.message.node.path = address_n || [];
            return res;
        });
    }

    wipeDevice(): Promise<DefaultMessageResponse> {
        return this._commonCall('WipeDevice');
    }

    resetDevice(settings: ResetDeviceSettings): Promise<DefaultMessageResponse> {
        return this._commonCall('ResetDevice', settings);
    }

    loadDevice(settings: LoadDeviceSettings): Promise<DefaultMessageResponse> {
        const sett: LoadDeviceSettings = Object.assign({}, settings);

        if (sett.node == null && sett.mnemonic == null) {
            const payload = sett.payload;
            if (payload == null) {
                return Promise.reject(new Error('Payload, mnemonic or node necessary.'));
            }

            try { // try to decode as xprv
                const bjsNode: BitcoinJsHDNode = BitcoinJsHDNode.fromBase58(payload);
                sett.node = convertBitcoinJsHDNodeToHDPrivNode(bjsNode);
            } catch (e) {
                sett.mnemonic = sett.payload;
            }
            delete sett.payload;
        }

        return this._commonCall('LoadDevice', sett);
    }

    recoverDevice(settings: RecoverDeviceSettings): Promise<DefaultMessageResponse> {
        const sett = Object.assign({}, settings);
        sett.enforce_wordlist = true;

        return this._commonCall('RecoveryDevice', settings);
    }

    applySettings(settings: ApplySettings): Promise<DefaultMessageResponse> {
        return this._commonCall('ApplySettings', settings);
    }

    clearSession(settings?: {}): Promise<DefaultMessageResponse> {
        return this._commonCall('ClearSession', settings);
    }

    // Blocks the browser thread, be careful.
    clearSessionSync(settings?: {}): DefaultMessageResponse {
        return this._callSync('ClearSession', settings);
    }

    changePin(remove: ?boolean): Promise<DefaultMessageResponse> {
        return this._commonCall('ChangePin', {
            remove: remove || false,
        });
    }

    eraseFirmware(): Promise<DefaultMessageResponse> {
        return this._commonCall('FirmwareErase');
    }

    // payload is in hexa
    uploadFirmware(payload: string): Promise<DefaultMessageResponse> {
        return this._commonCall('FirmwareUpload', {
            payload: payload,
        });
    }

    // failure to verify returns rejecting promise
    verifyMessage(address: string, signature: string, message: string): Promise<DefaultMessageResponse> {
        return this._commonCall('VerifyMessage', {
            address: address,
            signature: signature,
            message: message,
        });
    }

    signMessage(address_n: Array<number>, message: string, coin: CoinType): Promise<MessageResponse<MessageSignature>> {
        return this._typedCommonCall('SignMessage', 'MessageSignature', {
            address_n: address_n,
            message: message,
            coin_name: coin.coin_name,
        });
    }

    signIdentity(
        identity: Identity,
        challenge_hidden: string,
        challenge_visual: string
    ): Promise<MessageResponse<SignedIdentity>> {
        return this._typedCommonCall('SignIdentity', 'SignedIdentity', {
            identity: identity,
            challenge_hidden: challenge_hidden,
            challenge_visual: challenge_visual,
        });
    }

    cipherKeyValue(
        address_n: Array<number>,
        key: string,
        value: string | Buffer,
        encrypt: ?boolean,
        ask_on_encrypt: ?boolean,
        ask_on_decrypt: ?boolean,
        iv: ?(string | Buffer) // in hexadecimal
    ): Promise<MessageResponse<{value: string}>> {
        const valueString: string = (typeof value === 'string') ? value : value.toString('hex');
        const ivString: ?string = iv == null ? null : ((typeof iv === 'string') ? iv : iv.toString('hex'));

        return this._typedCommonCall('CipherKeyValue', 'CipheredKeyValue', {
            address_n: address_n,
            key: key,
            value: valueString,
            encrypt: encrypt,
            ask_on_encrypt: ask_on_encrypt,
            ask_on_decrypt: ask_on_decrypt,
            iv: ivString,
        });
    }

    measureTx(
        inputs: Array<TransactionInput>,
        outputs: Array<TransactionInput>,
        coin: CoinType
    ): Promise<MessageResponse<{tx_size: number}>> {
        return this._typedCommonCall('EstimateTxSize', 'TxSize', {
            inputs_count: inputs.length,
            outputs_count: outputs.length,
            coin_name: coin.coin_name,
        });
    }

    _indexTxsForSign(
        inputs: Array<TransactionInput>,
        outputs: Array<TransactionOutput>,
        txs: Array<RefTransaction>
    ): {[key: string]: RefTransactionInputsOutputs | RefTransaction} {
        const index = {};

        // Tx being signed
        index[''] = {
            inputs: inputs,
            outputs: outputs,
        };

        // Referenced txs
        txs.forEach(tx => {
            index[tx.hash.toLowerCase()] = tx;
        });

        return index;
    }

    signTx(
        inputs: Array<TransactionInput>,
        outputs: Array<TransactionOutput>,
        txs: Array<RefTransaction>,
        coin: CoinType
    ): Promise<MessageResponse<SignedTx>> {
        const index: {[key: string]: RefTransactionInputsOutputs} = this._indexTxsForSign(inputs, outputs, txs);
        const signatures: Array<string> = [];
        let serializedTx: string = '';

        const process = (res: MessageResponse<TxRequest>): MessageResponse<SignedTx> => {
            const m: TxRequest = res.message;
            const ms: TxRequestSerialized = m.serialized;
            const md: TxRequestDetails = m.details;

            {
                const _signatureIndex: ?number = ms.signature_index;
                const _signature: ?string = ms.signature;
                const _serializedTx: ?string = ms.serialized_tx;
                if (ms && _serializedTx != null) {
                    serializedTx += _serializedTx;
                }
                if (ms && _signatureIndex != null) {
                    if (_signature == null) {
                        throw new Error('Unexpected null in TxRequestSerialized signature.');
                    }
                    signatures[_signatureIndex] = _signature;
                }
            }

            if (m.request_type === 'TXFINISHED') {
                return {
                    message: {
                        serialized: {
                            signatures: signatures,
                            serialized_tx: serializedTx,
                        },
                    },
                    type: 'SignedTx',
                };
            }

            const _reqTx: ?(RefTransactionInputsOutputs | RefTransaction) =
                index[(md.tx_hash || '').toLowerCase()];

            if (!_reqTx) {
                const _txHash = md.tx_hash;
                throw new Error(_txHash
                                ? (`Requested unknown tx: ${_txHash}`)
                                : ('Requested tx for signing not indexed')
                               );
            }

            const reqTx: RefTransactionInputsOutputs | RefTransaction = _reqTx;

            const requestResult = (): {
                inputs: Array<TransactionInput>
            } | {
                bin_outputs: Array<TransactionBinOutput>
            } | {
                outputs: Array<TransactionOutput>
            } | {
                version: number;
                lock_time: number;
                inputs_cnt: number;
                outputs_cnt: number;
            } => {
                if (m.request_type === 'TXINPUT') {
                    return {inputs: [reqTx.inputs[+md.request_index]]};
                }
                if (m.request_type === 'TXOUTPUT') {
                    if (md.tx_hash) {
                        return {bin_outputs: [reqTx.bin_outputs[+md.request_index]]};
                    } else {
                        return {outputs: [reqTx.outputs[+md.request_index]]};
                    }
                }
                if (m.request_type === 'TXMETA') {
                    const outputCount = (md.tx_hash) ? reqTx.bin_outputs.length : reqTx.outputs.length;
                    return {
                        version: reqTx.version,
                        lock_time: reqTx.lock_time,
                        inputs_cnt: reqTx.inputs.length,
                        outputs_cnt: outputCount,
                    };
                }
                throw new Error(`Unknown request type: ${m.request_type}`);
            };

            const resTx = requestResult();

            return this._typedCommonCall('TxAck', 'TxRequest', {
                tx: resTx,
            }).then(process);
        };

        return this._typedCommonCall('SignTx', 'TxRequest', {
            inputs_count: inputs.length,
            outputs_count: outputs.length,
            coin_name: coin.coin_name,
        }).then((res) => process(res));
    }

    _typedCommonCall(type: string, resType: string, msg: Object = {}): Promise<DefaultMessageResponse> {
        return this._commonCall(type, msg).then(res =>
            this._assertType(res, resType)
        );
    }

    _assertType(res: MessageResponse, resType: string): DefaultMessageResponse {
        if (res.type !== resType) {
            throw new TypeError(`Response of unexpected type: ${res.type}`);
        }
        return res;
    }

    _commonCall(type: string, msg: Object = {}): Promise<DefaultMessageResponse> {
        return this._call(type, msg).then(res =>
            this._filterCommonTypes(res)
        );
    }

    _filterCommonTypes(res: DefaultMessageResponse): Promise<DefaultMessageResponse> {
        if (res.type === 'Failure') {
            return Promise.reject(new Error(res.message));
        }

        if (res.type === 'ButtonRequest') {
            this._emitter.emit('button', res.message.code);
            return this._commonCall('ButtonAck');
        }

        if (res.type === 'EntropyRequest') {
            return this._commonCall('EntropyAck', {
                entropy: stringToHex(this._generateEntropy(32)),
            });
        }

        if (res.type === 'PinMatrixRequest') {
            return this._promptPin(res.message.type).then(
                pin => {
                    return this._commonCall('PinMatrixAck', { pin: pin });
                },
                () => {
                    return this._commonCall('Cancel');
                }
            );
        }

        if (res.type === 'PassphraseRequest') {
            return this._promptPassphrase().then(
                passphrase => {
                    return this._commonCall('PassphraseAck', { passphrase: passphrase });
                },
                err => {
                    return this._commonCall('Cancel').catch(e => {
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
                    return this._commonCall('Cancel');
                }
            );
        }

        return Promise.resolve(res);
    }

    _promptPin(type: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this._emitter.emit('pin', type, (err, pin) => {
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
            if (!this._emitter.emit('passphrase', (err, passphrase) => {
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
            if (!this._emitter.emit('word', (err, word) => {
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

    _generateEntropy(len: number): string {
        if (global.crypto || global.msCrypto) {
            return randombytes(len).toString('binary');
        } else {
            return this._generatePseudoEntropy(len);
        }
    }

    // this is not secure, but it doesn't really need to be,
    // since the entropy is mixed with Trezor's own one
    _generatePseudoEntropy(len: number): string {
        const len_ = +len;
        const bytes = new Buffer(len_);

        console.warn('[trezor] Using pseudo entropy');

        for (let i = 0; i < len_; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }

        return bytes.toString('binary');
    }

    // Sends an async message to the opened device.
    _call(type: string, msg: Object = {}): Promise<DefaultMessageResponse> {
        const logMessage: Object = this._filterForLog(type, msg);

        console.log('[trezor] Sending', type, logMessage);
        this._emitter.emit('send', type, msg);

        return this._transport.call(this._sessionId, type, msg).then(
            (res: DefaultMessageResponse) => {
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
    _callSync(type: string, msg: Object = {}): DefaultMessageResponse {
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

    _filterForLog(type: string, msg: Object): Object {
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

    // --------- some helper functions for advanced TREZOR usage

    verifyAddress(path: Array<number>, address:string, coin: CoinType): Promise<boolean> {
        return this.getAddress(path, coin, true).then((res) => {
            const verified = res.message.address === address;

            if (!verified) {
                console.error('Address verification failed', {
                    path: path,
                    jsAddress: address,
                    trezorAddress: res.message.address,
                });
            }

            return verified;
        });
    }

    changeLabel(label: string): Promise<DefaultMessageResponse> {
        if (label.length > Session.LABEL_MAX_LENGTH) {
            label = label.slice(0, Session.LABEL_MAX_LENGTH);
        }

        return this.applySettings({
            label: label,
        });
    }

    togglePassphrase(enable: boolean): Promise<DefaultMessageResponse> {
        return this.applySettings({
            use_passphrase: enable,
        });
    }

    changeHomescreen(hex: string): Promise<DefaultMessageResponse> {
        return this.applySettings({
            homescreen: hex,
        });
    }

    getHDNode(path: Array<number>): Promise<BitcoinJsHDNode> {
        const suffix = 0;
        const childPath: Array<number> = path.concat([suffix]);

        return this.getPublicKey(path).then((resKey: MessageResponse<PublicKey>) => {
            const resNode: BitcoinJsHDNode = convertAndCheckPrivateKeyToBitcoinJsNode(resKey);
            return this.getPublicKey(childPath).then((childKey: MessageResponse<PublicKey>) => {
                const childNode: BitcoinJsHDNode = convertAndCheckPrivateKeyToBitcoinJsNode(childKey);
                checkDerivation(resNode, childNode, suffix);
                return resNode;
            });
        });
    }

    static LABEL_MAX_LENGTH: number;
}

Session.LABEL_MAX_LENGTH = 16;

//
// Hex codec
//

// Encode binary string to hex string
function stringToHex(bin) {
    let hex = '';

    for (let i = 0; i < bin.length; i++) {
        const chr = (bin.charCodeAt(i) & 0xFF).toString(16);
        hex += chr.length < 2 ? `0${chr}` : chr;
    }

    return hex;
}

// Decode hex string to binary string
// function hexToString(hex) {
//     let i, bytes = [];
//
//     for (i = 0; i < hex.length - 1; i += 2)
//         bytes.push(parseInt(hex.substr(i, 2), 16));
//
//     return String.fromCharCode.apply(String, bytes);
// }
