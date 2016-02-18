/* @flow */
'use strict';

import randombytes from 'randombytes';
import EventEmitter from 'events';
import {
    HDNode as BitcoinJsHDNode,
    ECPair,
    Transaction as BitcoinJsTransaction,
    networks as BitcoinJsNetworks,
    address as BitcoinJsAddress,
    script as BitcoinJsScript,
} from 'bitcoinjs-lib';

import type {
    Network as BitcoinJsNetwork,
    Input as BitcoinJsInput,
    Output as BitcoinJsOutput,
} from 'bitcoinjs-lib';

import type {
    ApplySettings,
    CoinType,
    DefaultMessageResponse,
    DeviceDescriptor,
    Features,
    HDPrivNode, 
    HDPubNode, 
    Identity,
    InputInfo,
    LoadDeviceSettings,
    MessageResponse, 
    MessageSignature,
    OutputInfo,
    PublicKey, 
    RecoverDeviceSettings,
    RefTransaction, 
    ResetDeviceSettings,
    SignTxInfoToTrezor,
    SignedIdentity,
    SignedTx,
    TransactionInput,
    TransactionOutput,
    Transport,
    TxInfo,
    TxRequest,
    TxRequestSerialized,
} from './flowtypes';

import * as ecurve from 'ecurve';

// String.normalize
// (not possible in ES6 way)
require('unorm');

function convertBitcoinJsHDNodeToHDPrivNode(node: BitcoinJsHDNode): HDPrivNode {
    const d = node.keyPair.d;
    if (!d) {
        throw new Error('Not a private node.');
    }
    const depth = node.depth;
    const fingerprint = node.parentFingerprint;
    const child_num = node.index;
    const private_key = d.toString('hex');
    const chain_code = node.chainCode.toString('hex');
    return {depth, fingerprint, child_num, chain_code, private_key};
}

function convertHDPubNodeToBitcoinJsNode(
    node: HDPubNode,
    network: BitcoinJsNetwork
): BitcoinJsHDNode {
    const chainCode = new Buffer(node.chain_code, 'hex');
    const publicKey = new Buffer(node.public_key, 'hex');

    const Q = ecurve.Point.decodeFrom(ecurve.getCurveByName('secp256k1'), publicKey);
    const res = new BitcoinJsHDNode(new ECPair(null, Q, network), chainCode);

    res.depth = +node.depth;
    res.index = +node.child_num;
    res.parentFingerprint = node.fingerprint;

    return res;
}

// throws error on wrong xpub
function convertAndCheckPrivateKeyToBitcoinJsNode(
    key: MessageResponse<PublicKey>,
    network: BitcoinJsNetwork
): BitcoinJsHDNode {
    const keyNode: HDPubNode = key.message.node;
    const bjsNode: BitcoinJsHDNode = convertHDPubNodeToBitcoinJsNode(keyNode, network);

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


function indexTxsForSign(
    txs: Array<RefTransaction>
): {[key: string]: RefTransaction} {
    const index = {};

    // Tx being signed
    // index[''] = {
    //     inputs: inputs,
    //     outputs: outputs,
    // };

    // Referenced txs
    txs.forEach(tx => {
        index[tx.hash.toLowerCase()] = tx;
    });

    return index;
}

// requests information about a transaction
// can be either signed transaction iteslf of prev transaction
function requestTxInfo(
    m: TxRequest,
    index: {[key: string]: RefTransaction},
    inputs: Array<TransactionInput>,
    outputs: Array<TransactionOutput>
): SignTxInfoToTrezor {
    const md = m.details;
    if (md.tx_hash) {
        const reqTx: ?RefTransaction = index[(md.tx_hash).toLowerCase()];
        if (!reqTx) {
            throw new Error((`Requested unknown tx: ${md.tx_hash}`));
        }
        return requestPrevTxInfo(
            reqTx,
            m.request_type,
            md.request_index
        );
    } else {
        return requestSignedTxInfo(inputs, outputs, m.request_type, md.request_index);
    }
}

function requestPrevTxInfo(
    reqTx: RefTransaction,
    requestType: string,
    requestIndex: string | number
): SignTxInfoToTrezor {
    const i = +requestIndex;
    if (requestType === 'TXINPUT') {
        return {inputs: [reqTx.inputs[i]]};
    }
    if (requestType === 'TXOUTPUT') {
        return {bin_outputs: [reqTx.bin_outputs[i]]};
    }
    if (requestType === 'TXMETA') {
        const outputCount = reqTx.bin_outputs.length;
        return {
            version: reqTx.version,
            lock_time: reqTx.lock_time,
            inputs_cnt: reqTx.inputs.length,
            outputs_cnt: outputCount,
        };
    }
    throw new Error(`Unknown request type: ${requestType}`);
}

function requestSignedTxInfo(
    inputs: Array<TransactionInput>,
    outputs: Array<TransactionOutput>,
    requestType: string,
    requestIndex: string | number
): SignTxInfoToTrezor {
    const i = +requestIndex;
    if (requestType === 'TXINPUT') {
        return {inputs: [inputs[i]]};
    }
    if (requestType === 'TXOUTPUT') {
        return {outputs: [outputs[i]]};
    }
    if (requestType === 'TXMETA') {
        throw new Error('Cannot read TXMETA from signed transaction');
    }
    throw new Error(`Unknown request type: ${requestType}`);
}

function saveTxSignatures(
    ms: TxRequestSerialized,
    serializedTx: {serialized: string},
    signatures: Array<string>
) {
    if (ms) {
        const _signatureIndex: ?number = ms.signature_index;
        const _signature: ?string = ms.signature;
        const _serializedTx: ?string = ms.serialized_tx;
        if (_serializedTx != null) {
            serializedTx.serialized += _serializedTx;
        }
        if (_signatureIndex != null) {
            if (_signature == null) {
                throw new Error('Unexpected null in TxRequestSerialized signature.');
            }
            signatures[_signatureIndex] = _signature;
        }
    }
}

function derivePubKeyHash(
    externalNode: BitcoinJsHDNode,
    changeNode: BitcoinJsHDNode,
    path: Array<number>
): Buffer {
    const nodes = [externalNode, changeNode];
    const nodeIx = path[path.length - 2];
    const addressIx = path[path.length - 1];
    const node = nodes[nodeIx].derive(addressIx);
    const pkh: Buffer = node.getIdentifier();
    return pkh;
}

function deriveOutputScript(
    pathOrAddress: string | Array<number>,
    externalNode: BitcoinJsHDNode,
    changeNode: BitcoinJsHDNode,
    network: BitcoinJsNetwork
): Buffer {
    
    const scriptType = typeof pathOrAddress === 'string' ?
                        getAddressScriptType(pathOrAddress, network) : 'PAYTOADDRESS';

    const pkh: Buffer = typeof pathOrAddress === 'string'
                                ? BitcoinJsAddress.fromBase58Check(pathOrAddress).hash
                                : derivePubKeyHash(externalNode, changeNode, pathOrAddress);

    if (scriptType === 'PAYTOADDRESS') {
        return BitcoinJsScript.pubKeyHashOutput(pkh);
    }
    if (scriptType === 'PAYTOSCRIPTHASH') {
        return BitcoinJsScript.scriptHashOutput(pkh);
    }
    throw new Error('Unknown script type ' + scriptType);
}

function verifyBjsTx(
    inputs: Array<InputInfo>,
    outputs: Array<OutputInfo>,
    externalNode: BitcoinJsHDNode,
    changeNode: BitcoinJsHDNode,
    resTx: BitcoinJsTransaction,
    network: BitcoinJsNetwork
) {
    if (inputs.length !== resTx.ins.length) {
        throw new Error('Signed transaction has wrong length.');
    }
    if (outputs.length !== resTx.outs.length) {
        throw new Error('Signed transaction has wrong length.');
    }
    outputs.map((output, i) => {
        if (output.value !== resTx.outs[i].value) {
            throw new Error('Signed transaction has wrong output value.');
        }

        const addressOrPath_: ?(string | Array<number>) =
            output.address == null ? (output.path == null ? null : output.path) : output.address;

        if (addressOrPath_ == null) {
            throw new Error('Both path and address cannot be null.');
        }

        const addressOrPath: (string | Array<number>) = addressOrPath_;
        const scriptA: Buffer =
            deriveOutputScript(addressOrPath, externalNode, changeNode, network);
        const scriptB: Buffer = resTx.outs[i].script;
        if (scriptA.compare(scriptB) !== 0) {
            throw new Error('Scripts differ');
        }
    });
}

function getAddressScriptType(address: string, network: BitcoinJsNetwork): string {
    const decoded = BitcoinJsAddress.fromBase58Check(address);

    if (decoded.version === network.pubKeyHash) {
        return 'PAYTOADDRESS';
    }

    if (decoded.version === network.scriptHash) {
        return 'PAYTOSCRIPTHASH';
    }

    throw new Error("Unknown address type.");
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

    loadDevice(
        settings: LoadDeviceSettings,
        network_?: BitcoinJsNetwork    
    ): Promise<DefaultMessageResponse> {
        const sett: LoadDeviceSettings = Object.assign({}, settings);
        const network: BitcoinJsNetwork = network_ == null ? BitcoinJsNetworks.bitcoin : network_;

        if (sett.node == null && sett.mnemonic == null) {
            const payload = sett.payload;
            if (payload == null) {
                return Promise.reject(new Error('Payload, mnemonic or node necessary.'));
            }

            try { // try to decode as xprv
                const bjsNode: BitcoinJsHDNode = BitcoinJsHDNode.fromBase58(payload, network);
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

    // ------- helper functions for transaction signing ------

    _processTxRequest(
        m: TxRequest,
        serializedTx: {serialized: string},
        signatures: Array<string>,
        index: {[key: string]: RefTransaction},
        ins: Array<TransactionInput>,
        outs: Array<TransactionOutput>
    ): Promise<MessageResponse<SignedTx>> {
        saveTxSignatures(m.serialized, serializedTx, signatures);

        if (m.request_type === 'TXFINISHED') {
            return Promise.resolve({
                message: {
                    serialized: {
                        signatures: signatures,
                        serialized_tx: serializedTx.serialized,
                    },
                },
                type: 'SignedTx',
            });
        }

        const resTx = requestTxInfo(m, index, ins, outs);
        return this._typedCommonCall('TxAck', 'TxRequest', {
            tx: resTx,
        }).then(response => this._processTxRequest(response.message, serializedTx, signatures, index, ins, outs));
    }

    signTx(
        inputs: Array<TransactionInput>,
        outputs: Array<TransactionOutput>,
        txs: Array<RefTransaction>,
        coin: CoinType | string
    ): Promise<MessageResponse<SignedTx>> {
        const index: {[key: string]: RefTransaction} = indexTxsForSign(txs);
        const signatures: Array<string> = [];
        const serializedTx: {serialized: string} = {serialized: ''};

        const coinName = (typeof coin === 'string') ? coin : coin.coin_name;
        const coinNameCapitalized = coinName.charAt(0).toUpperCase() + coinName.slice(1);
        return this._typedCommonCall('SignTx', 'TxRequest', {
            inputs_count: inputs.length,
            outputs_count: outputs.length,
            coin_name: coinNameCapitalized,
        }).then((res) => this._processTxRequest(res.message, serializedTx, signatures, index, inputs, outputs));
    }

    signBjsTx(
        info: TxInfo,        
        refTxs: Array<BitcoinJsTransaction>,
        externalNode: BitcoinJsHDNode,
        changeNode: BitcoinJsHDNode,
        coinName: string
    ): Promise<BitcoinJsTransaction> {
        const inputs = info.inputs;
        const outputs = info.outputs;
        const network: BitcoinJsNetwork = BitcoinJsNetworks[coinName.toLowerCase()];
        if (network == null) {
            return Promise.reject(new Error("No network " + coinName));
        }

        const trezorInputs: Array<TransactionInput> = inputs.map(({hash, index, path}) => {
            return {
                prev_index: index,
                prev_hash: reverseBuffer(hash).toString('hex'),
                address_n: path,
            };
        });

        const trezorOutputs: Array<TransactionOutput> = outputs.map(output => {
            if (output.address == null) {
                if (output.path == null) {
                    throw new Error('Both address and path of an output cannot be null.');
                }
                return {
                    address_n: output.path,
                    amount: output.value,
                    script_type: 'PAYTOADDRESS'
                };
            }
            const address: string = output.address;
            const scriptType = getAddressScriptType(address, network);

            return {
                address: address,
                amount: output.value,
                script_type: scriptType
            };
        });

        const trezorRefTxs: Array<RefTransaction> = refTxs.map((tx: BitcoinJsTransaction) => {
            return {
                lock_time: tx.locktime,
                version: tx.version,
                hash: tx.getId(),
                inputs: tx.ins.map((input: BitcoinJsInput) => {
                    const copyHash = new Buffer(input.hash.length);
                    input.hash.copy(copyHash);
                    return {
                        prev_index: input.index,
                        sequence: input.sequence,
                        prev_hash: reverseBuffer(copyHash).toString('hex'),
                        script_sig: input.script.toString('hex'),
                    };
                }),
                bin_outputs: tx.outs.map((output: BitcoinJsOutput) => {
                    return {
                        amount: output.value,
                        script_pubkey: output.script.toString('hex'),
                    };
                }),
            };
        });
        return this.signTx(
            trezorInputs,
            trezorOutputs,
            trezorRefTxs,
            coinName
        ).then((signedTx: MessageResponse<SignedTx>) => {
            const res = BitcoinJsTransaction.fromHex(signedTx.message.serialized.serialized_tx);
            verifyBjsTx(inputs, outputs, externalNode, changeNode, res, network);
            return res;
        });
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
            return Promise.reject(new Error(res.message.code + ':' + res.message.message));
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

    getHDNode(path: Array<number>, network_?: BitcoinJsNetwork): Promise<BitcoinJsHDNode> {
        const suffix = 0;
        const childPath: Array<number> = path.concat([suffix]);
        const network: BitcoinJsNetwork = network_ == null ? BitcoinJsNetworks.bitcoin : network_;

        return this.getPublicKey(path).then((resKey: MessageResponse<PublicKey>) => {
            const resNode: BitcoinJsHDNode = convertAndCheckPrivateKeyToBitcoinJsNode(resKey, network);
            return this.getPublicKey(childPath).then((childKey: MessageResponse<PublicKey>) => {
                const childNode: BitcoinJsHDNode = convertAndCheckPrivateKeyToBitcoinJsNode(childKey, network);
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

function reverseBuffer(buf: Buffer): Buffer {
    const copy = new Buffer(buf.length);
    buf.copy(copy);
    [].reverse.call(copy);
    return copy;
}
