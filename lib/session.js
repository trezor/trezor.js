/* @flow */
'use strict';

import {EventEmitter} from './events';
import * as bitcoin from 'bitcoinjs-lib';
import * as types from './flowtypes';

import * as hdnodeUtils from './utils/hdnode';
import * as signTxHelper from './utils/signtx';
import * as signBjsTxHelper from './utils/signbjstx';
import {CallHelper} from './utils/call';

import wrapLoadDevice from './utils/wrapLoadDevice';

// String.normalize
// (not possible in ES6 way)
require('unorm');

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
    _transport: types.Transport;
    _sessionId: string;
    _descriptor: types.DeviceDescriptor;
    supportsSync: boolean;
    callHelper: CallHelper;

    constructor(transport: types.Transport, sessionId: string, descriptor: types.DeviceDescriptor) {
        super();
        this._transport = transport;
        this._sessionId = sessionId;
        this._descriptor = descriptor;
        this.supportsSync = !!transport.supportsSync;
        this.callHelper = new CallHelper(transport, this, sessionId, this.supportsSync);
    }

    getId(): string {
        return this._sessionId;
    }

    getPath(): string {
        return this._descriptor.path;
    }

    isDescriptor(descriptor: types.DeviceDescriptor): boolean {
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

    initialize(): Promise<types.MessageResponse<types.Features>> {
        return this.typedCall('Initialize', 'Features');
    }

    getFeatures(): Promise<types.MessageResponse<types.Features>> {
        return this.typedCall('GetFeatures', 'Features');
    }

    getEntropy(size: number): Promise<types.MessageResponse<{bytes: string}>> {
        return this.typedCall('GetEntropy', 'Entropy', {
            size: size,
        });
    }

    getAddress(address_n: Array<number>, coin: types.CoinType | string, show_display: ?boolean): Promise<types.MessageResponse<{
        address: string;
        path: Array<number>;
    }>> {
        const coin_name = coinName(coin);
        return this.typedCall('GetAddress', 'Address', {
            address_n: address_n,
            coin_name: coin_name,
            show_display: !!show_display,
        }).then(res => {
            res.message.path = address_n || [];
            return res;
        });
    }

    getPublicKey(address_n: Array<number>): Promise<types.MessageResponse<types.PublicKey>> {
        return this.typedCall('GetPublicKey', 'PublicKey', {
            address_n: address_n,
        }).then(res => {
            res.message.node.path = address_n || [];
            return res;
        });
    }

    wipeDevice(): Promise<types.DefaultMessageResponse> {
        return this.typedCall('WipeDevice', 'Success');
    }

    resetDevice(settings: types.ResetDeviceSettings): Promise<types.DefaultMessageResponse> {
        return this.typedCall('ResetDevice', 'Success', settings);
    }

    loadDevice(
        settings: types.LoadDeviceSettings,
        network: types.CoinType | string | bitcoin.Network
    ): Promise<types.DefaultMessageResponse> {
        return this.typedCall('LoadDevice', 'Success', wrapLoadDevice(settings, coinNetwork(network)));
    }

    recoverDevice(settings: types.RecoverDeviceSettings): Promise<types.DefaultMessageResponse> {
        return this.typedCall('RecoveryDevice', 'Success', {
            ...settings,
            enforce_wordlist: true,
        });
    }

    applySettings(settings: types.ApplySettings): Promise<types.DefaultMessageResponse> {
        return this.typedCall('ApplySettings', 'Success', settings);
    }

    clearSession(settings?: {}): Promise<types.DefaultMessageResponse> {
        return this.typedCall('ClearSession', 'Success', settings);
    }

    // Blocks the browser thread, be careful.
    clearSessionSync(settings?: {}): types.DefaultMessageResponse {
        return this._callSync('ClearSession', settings);
    }

    changePin(remove: ?boolean): Promise<types.DefaultMessageResponse> {
        return this.typedCall('ChangePin', 'Success', {
            remove: remove || false,
        });
    }

    eraseFirmware(): Promise<types.DefaultMessageResponse> {
        return this.typedCall('FirmwareErase', 'Success');
    }

    // payload is in hexa
    uploadFirmware(payload: string): Promise<types.DefaultMessageResponse> {
        return this.typedCall('FirmwareUpload', 'Success', {
            payload: payload,
        });
    }

    updateFirmware(payload: string): Promise<types.DefaultMessageResponse> {
        return this.eraseFirmware().then(() => this.uploadFirmware(payload));
    }

    // failure to verify returns rejecting promise
    verifyMessage(address: string, signature: string, message: string): Promise<types.DefaultMessageResponse> {
        return this.typedCall('VerifyMessage', 'Success', {
            address: address,
            signature: signature,
            message: message,
        });
    }

    signMessage(address_n: Array<number>, message: string, coin: types.CoinType | string): Promise<types.MessageResponse<types.MessageSignature>> {
        return this.typedCall('SignMessage', 'MessageSignature', {
            address_n: address_n,
            message: message,
            coin_name: coinName(coin),
        });
    }

    signIdentity(
        identity: types.Identity,
        challenge_hidden: string,
        challenge_visual: string
    ): Promise<types.MessageResponse<types.SignedIdentity>> {
        return this.typedCall('SignIdentity', 'SignedIdentity', {
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
    ): Promise<types.MessageResponse<{value: string}>> {
        const valueString: string = (typeof value === 'string') ? value : value.toString('hex');
        const ivString: ?string = iv == null ? null : ((typeof iv === 'string') ? iv : iv.toString('hex'));

        return this.typedCall('CipherKeyValue', 'CipheredKeyValue', {
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
        inputs: Array<types.TransactionInput>,
        outputs: Array<types.TransactionInput>,
        coin: string | types.CoinType
    ): Promise<types.MessageResponse<{tx_size: number}>> {
        return this.typedCall('EstimateTxSize', 'TxSize', {
            inputs_count: inputs.length,
            outputs_count: outputs.length,
            coin_name: coinName(coin),
        });
    }

    signTx(
        inputs: Array<types.TransactionInput>,
        outputs: Array<types.TransactionOutput>,
        txs: Array<types.RefTransaction>,
        coin: types.CoinType | string
    ): Promise<types.MessageResponse<types.SignedTx>> {
        return signTxHelper.signTx(this, inputs, outputs, txs, coin);
    }

    signBjsTx(
        info: types.TxInfo,
        refTxs: Array<bitcoin.Transaction>,
        nodes: Array<bitcoin.HDNode>,
        coinName: string
    ): Promise<bitcoin.Transaction> {
        return signBjsTxHelper.signBjsTx(info, refTxs, nodes, coinName);
    }

    typedCall(type: string, resType: string, msg: Object = {}): Promise<types.DefaultMessageResponse> {
        return this.callHelper.typedCall(type, resType, msg);
    }

    _call(type: string, msg: ?Object): Promise<types.DefaultMessageResponse> {
        return this.callHelper.call(type, msg);
    }

    // Sends a blocking message to an opened device. Be careful, the whole
    // tab thread gets blocked and does not respond. Also, we don't do any
    // timeouts here.
    _callSync(type: string, msg: ?Object): types.DefaultMessageResponse {
        return this.callHelper.callSync(type, msg);
    }

    // --------- some helper functions for advanced TREZOR usage

    verifyAddress(path: Array<number>, address: string, coin: string | types.CoinType): Promise<boolean> {
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

    changeLabel(label: string): Promise<types.DefaultMessageResponse> {
        if (label.length > Session.LABEL_MAX_LENGTH) {
            label = label.slice(0, Session.LABEL_MAX_LENGTH);
        }

        return this.applySettings({
            label: label,
        });
    }

    togglePassphrase(enable: boolean): Promise<types.DefaultMessageResponse> {
        return this.applySettings({
            use_passphrase: enable,
        });
    }

    changeHomescreen(hex: string): Promise<types.DefaultMessageResponse> {
        return this.applySettings({
            homescreen: hex,
        });
    }

    getHDNode(path: Array<number>, network: types.CoinType | string | bitcoin.Network): Promise<bitcoin.HDNode> {
        return hdnodeUtils.getHDNode(this, path, coinNetwork(network));
    }

    static LABEL_MAX_LENGTH: number;
}

Session.LABEL_MAX_LENGTH = 16;

export function coinName(coin: types.CoinType | string): string {
    if (typeof coin === 'string') {
        return coin.charAt(0).toUpperCase() + coin.slice(1);
    } else {
        return coin.coin_name;
    }
}

export function coinNetwork(coin: types.CoinType | string | bitcoin.Network): bitcoin.Network {
    const r: any = coin;
    if (typeof coin.messagePrefix === 'string') {
        return r;
    }

    const name: string = coinName(r).toLowerCase();
    const network = bitcoin.networks[name];
    if (network == null) {
        throw new Error(`No network with the name ${name}.`);
    }
    return network;
}
