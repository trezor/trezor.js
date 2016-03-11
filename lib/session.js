/* @flow */
'use strict';

import {EventEmitter} from './events';
import * as bitcoin from 'bitcoinjs-lib';

import * as hdnodeUtils from './utils/hdnode';
import * as signTxHelper from './utils/signtx';
import * as signBjsTxHelper from './utils/signbjstx';
import {CallHelper} from './utils/call';

import * as trezor from './trezortypes';
import type {TxInfo} from './utils/signbjstx';
import type {
    Transport,
    DeviceDescriptor,
} from './transport';

export type MessageResponse<T> = {
    type: string;
    message: T; // in general, can be anything
};

export type DefaultMessageResponse = MessageResponse<Object>;

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
    supportsSync: boolean;
    callHelper: CallHelper;

    static LABEL_MAX_LENGTH: number = 16;

    constructor(transport: Transport, sessionId: string, descriptor: DeviceDescriptor) {
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

    isDescriptor(descriptor: DeviceDescriptor): boolean {
        return this._descriptor.path === descriptor.path;
    }

    release(): Promise {
        console.log('[trezor] Releasing session');
        return this._transport.release(this._sessionId);
    }

    // blocks the browser thread, be careful
    releaseSync(): void {
        if (!this.supportsSync) {
            throw new Error('Blocking release is not supported');
        }
        console.log('[trezor] Releasing session synchronously');
        return this._transport.releaseSync(this._sessionId);
    }

    initialize(): Promise<MessageResponse<trezor.Features>> {
        return this.typedCall('Initialize', 'Features');
    }

    getFeatures(): Promise<MessageResponse<trezor.Features>> {
        return this.typedCall('GetFeatures', 'Features');
    }

    getEntropy(size: number): Promise<MessageResponse<{bytes: string}>> {
        return this.typedCall('GetEntropy', 'Entropy', {
            size: size,
        });
    }

    getAddress(
        address_n: Array<number>,
        coin: trezor.CoinType | string,
        show_display: ?boolean
    ): Promise<MessageResponse<{
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

    getPublicKey(address_n: Array<number>): Promise<MessageResponse<trezor.PublicKey>> {
        return this.typedCall('GetPublicKey', 'PublicKey', {
            address_n: address_n,
        }).then(res => {
            res.message.node.path = address_n || [];
            return res;
        });
    }

    wipeDevice(): Promise<MessageResponse<trezor.Success>> {
        return this.typedCall('WipeDevice', 'Success');
    }

    resetDevice(settings: trezor.ResetDeviceSettings): Promise<MessageResponse<trezor.Success>> {
        return this.typedCall('ResetDevice', 'Success', settings);
    }

    loadDevice(
        settings: trezor.LoadDeviceSettings,
        network: trezor.CoinType | string | bitcoin.Network
    ): Promise<MessageResponse<trezor.Success>> {
        return this.typedCall(
            'LoadDevice',
            'Success',
            wrapLoadDevice(settings, coinNetwork(network))
        );
    }

    recoverDevice(settings: trezor.RecoverDeviceSettings): Promise<MessageResponse<trezor.Success>> {
        return this.typedCall('RecoveryDevice', 'Success', {
            ...settings,
            enforce_wordlist: true,
        });
    }

    applySettings(settings: trezor.ApplySettings): Promise<MessageResponse<trezor.Success>> {
        return this.typedCall('ApplySettings', 'Success', settings);
    }

    clearSession(settings?: {}): Promise<MessageResponse<trezor.Success>> {
        return this.typedCall('ClearSession', 'Success', settings);
    }

    // blocks the browser thread, be careful
    clearSessionSync(settings?: {}): MessageResponse<trezor.Success> {
        return this._callSync('ClearSession', settings);
    }

    changePin(remove: ?boolean): Promise<MessageResponse<trezor.Success>> {
        return this.typedCall('ChangePin', 'Success', {
            remove: remove || false,
        });
    }

    eraseFirmware(): Promise<MessageResponse<trezor.Success>> {
        return this.typedCall('FirmwareErase', 'Success');
    }

    // payload is in hexa
    uploadFirmware(payload: string): Promise<MessageResponse<trezor.Success>> {
        return this.typedCall('FirmwareUpload', 'Success', {
            payload: payload,
        });
    }

    updateFirmware(payload: string): Promise<MessageResponse<trezor.Success>> {
        return this.eraseFirmware().then(() => this.uploadFirmware(payload));
    }

    // failure to verify rejects returned promise
    verifyMessage(
        address: string,
        signature: string,
        message: string
    ): Promise<MessageResponse<trezor.Success>> {
        return this.typedCall('VerifyMessage', 'Success', {
            address: address,
            signature: signature,
            message: message,
        });
    }

    signMessage(
        address_n: Array<number>,
        message: string,
        coin: trezor.CoinType | string
    ): Promise<MessageResponse<trezor.MessageSignature>> {
        return this.typedCall('SignMessage', 'MessageSignature', {
            address_n: address_n,
            message: message,
            coin_name: coinName(coin),
        });
    }

    signIdentity(
        identity: trezor.Identity,
        challenge_hidden: string,
        challenge_visual: string
    ): Promise<MessageResponse<trezor.SignedIdentity>> {
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
    ): Promise<MessageResponse<{value: string}>> {
        const valueString = value.toString('hex');
        const ivString = iv == null ? null : iv.toString('hex');

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
        inputs: Array<trezor.TransactionInput>,
        outputs: Array<trezor.TransactionInput>,
        coin: string | trezor.CoinType
    ): Promise<MessageResponse<{tx_size: number}>> {
        return this.typedCall('EstimateTxSize', 'TxSize', {
            inputs_count: inputs.length,
            outputs_count: outputs.length,
            coin_name: coinName(coin),
        });
    }

    signTx(
        inputs: Array<trezor.TransactionInput>,
        outputs: Array<trezor.TransactionOutput>,
        txs: Array<trezor.RefTransaction>,
        coin: trezor.CoinType | string
    ): Promise<MessageResponse<trezor.SignedTx>> {
        return signTxHelper.signTx(this, inputs, outputs, txs, coin);
    }

    signBjsTx(
        info: TxInfo,
        refTxs: Array<bitcoin.Transaction>,
        nodes: Array<bitcoin.HDNode>,
        coinName: string
    ): Promise<bitcoin.Transaction> {
        return signBjsTxHelper.signBjsTx(this, info, refTxs, nodes, coinName);
    }

    typedCall(type: string, resType: string, msg: Object = {}): Promise<DefaultMessageResponse> {
        return this.callHelper.typedCall(type, resType, msg);
    }

    _call(type: string, msg: Object = {}): Promise<DefaultMessageResponse> {
        return this.callHelper.call(type, msg);
    }

    // sends a blocking message to an opened device. be careful, the whole
    // tab thread gets blocked and does not respond. also, we don't do any
    // timeouts here.
    _callSync(type: string, msg: Object = {}): DefaultMessageResponse {
        return this.callHelper.callSync(type, msg);
    }

    verifyAddress(path: Array<number>, address: string, coin: string | trezor.CoinType): Promise<boolean> {
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

    getHDNode(
        path: Array<number>,
        network: trezor.CoinType | string | bitcoin.Network
    ): Promise<bitcoin.HDNode> {
        return hdnodeUtils.getHDNode(this, path, coinNetwork(network));
    }
}

export function coinName(coin: trezor.CoinType | string): string {
    if (typeof coin === 'string') {
        return coin.charAt(0).toUpperCase() + coin.slice(1);
    } else {
        return coin.coin_name;
    }
}

export function coinNetwork(
    coin: trezor.CoinType | string | bitcoin.Network
): bitcoin.Network {
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

function wrapLoadDevice(
    settings: trezor.LoadDeviceSettings,
    network?: bitcoin.Network = bitcoin.networks.bitcoin
): trezor.LoadDeviceSettings {
    if (settings.node == null && settings.mnemonic == null) {
        if (settings.payload == null) {
            throw new Error('Payload, mnemonic or node necessary.');
        }
        try { // try to decode as xprv
            const bjsNode = bitcoin.HDNode.fromBase58(settings.payload, network);
            settings = { ...settings, node: hdnodeUtils.bjsNode2privNode(bjsNode) };
        } catch (e) { // use as mnemonic
            settings = { ...settings, mnemonic: settings.payload };
        }
        delete settings.payload;
    }
    return settings;
}
