/* @flow */
'use strict';

import {EventEmitter} from './events';
import {Event0, Event1, Event2} from './flow-events';
import * as bitcoin from 'bitcoinjs-lib-zcash';

import * as hdnodeUtils from './utils/hdnode';
import * as signTxHelper from './utils/signtx';
import * as signBjsTxHelper from './utils/signbjstx';
import * as signEthTxHelper from './utils/signethtx';
import {CallHelper} from './utils/call';

import * as trezor from './trezortypes';
import type {TxInfo} from './utils/signbjstx';
import type {EthereumSignature} from './utils/signethtx';
import type {Transport, TrezorDeviceInfoWithSession as DeviceDescriptor} from 'trezor-link';

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
    callHelper: CallHelper;
    debug: boolean;

    sendEvent: Event2<string, Object> = new Event2('send', this);
    receiveEvent: Event2<string, Object> = new Event2('receive', this);
    errorEvent: Event1<Error> = new Event1('error', this);
    buttonEvent: Event1<string> = new Event1('button', this);
    pinEvent: Event2<string, (e: ?Error, pin?: ?string) => void> = new Event2('pin', this);
    passphraseEvent: Event1<(e: ?Error, passphrase?: ?string) => void> = new Event1('passphrase', this);
    wordEvent: Event1<(e: ?Error, word?: ?string) => void> = new Event1('word', this);

    static LABEL_MAX_LENGTH: number = 16;

    constructor(transport: Transport, sessionId: string, descriptor: DeviceDescriptor, debug: boolean) {
        super();
        this._transport = transport;
        this._sessionId = sessionId;
        this._descriptor = descriptor;
        this.callHelper = new CallHelper(transport, sessionId, this);
        this.debug = debug;
    }

    deactivateEvents() {
        const events: Array<Event0 | Event1<any> | Event2<any, any>> = [
            this.sendEvent,
            this.receiveEvent,
            this.errorEvent,
            this.buttonEvent,
            this.pinEvent,
            this.passphraseEvent,
            this.wordEvent,
        ];
        events.forEach(ev => ev.removeAllListeners());
    }

    getId(): (string) {
        return this._sessionId;
    }

    getPath(): (string) {
        return this._descriptor.path;
    }

    isDescriptor(descriptor: DeviceDescriptor): boolean {
        return this._descriptor.path === descriptor.path;
    }

    release(): Promise<void> {
        if (this.debug) {
            console.log('[trezor.js] [session] releasing');
        }
        return this._transport.release(this._sessionId);
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

    ethereumGetAddress(
        address_n: Array<number>,
        show_display: ?boolean
    ): Promise<MessageResponse<{
        address: string;
        path: Array<number>;
    }>> {
        return this.typedCall('EthereumGetAddress', 'EthereumAddress', {
            address_n: address_n,
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
        network: ?(trezor.CoinType | string | bitcoin.Network)
    ): Promise<MessageResponse<trezor.Success>> {
        const convertedNetwork = network == null ? null : coinNetwork(network);
        return this.typedCall(
            'LoadDevice',
            'Success',
            wrapLoadDevice(settings, convertedNetwork)
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
        message: string,
        coin: trezor.CoinType | string
    ): Promise<MessageResponse<trezor.Success>> {
        return this.typedCall('VerifyMessage', 'Success', {
            address: address,
            signature: signature,
            message: message,
            coin_name: coinName(coin),
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
        encrypt: boolean,
        ask_on_encrypt: boolean,
        ask_on_decrypt: boolean,
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

    cipherKeyValueBuffer(
        address_n: Array<number>,
        key: string,
        value: string | Buffer,
        encrypt: boolean,
        ask_on_encrypt: boolean,
        ask_on_decrypt: boolean,
        iv: ?(string | Buffer) // in hexadecimal
    ): Promise<Buffer> {
        return this.cipherKeyValue(address_n, key, value, encrypt, ask_on_encrypt, ask_on_decrypt, iv).then(r => {
            const val = r.message.value;
            return new Buffer(val, 'hex');
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
        coinName: string,
        network: ?bitcoin.Network
    ): Promise<bitcoin.Transaction> {
        return signBjsTxHelper.signBjsTx(this, info, refTxs, nodes, coinName, network);
    }

    signEthTx(
        address_n: Array<number>,
        nonce: string,
        gas_price: string,
        gas_limit: string,
        to: string,
        value: string,
        data?: string,
        chain_id?: number
    ): Promise<EthereumSignature> {
        return signEthTxHelper.signEthTx(this, address_n, nonce, gas_price, gas_limit, to, value, data, chain_id);
    }

    typedCall(type: string, resType: string, msg: Object = {}): Promise<DefaultMessageResponse> {
        return this.callHelper.typedCall(type, resType, msg);
    }

    verifyAddress(path: Array<number>, address: string, coin: string | trezor.CoinType): Promise<boolean> {
        return this.getAddress(path, coin, true).then((res) => {
            const verified = res.message.address === address;

            if (!verified) {
                if (this.debug) {
                    console.warn('[trezor.js] [session] Address verification failed', {
                        path: path,
                        jsAddress: address,
                        trezorAddress: res.message.address,
                    });
                }
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

    setU2FCounter(
        counter: number
    ): Promise<DefaultMessageResponse> {
        return this.typedCall('SetU2FCounter', 'Success', {
            u2f_counter: counter,
        });
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
    network_?: ?bitcoin.Network
): trezor.LoadDeviceSettings {
    const network = network_ == null ? bitcoin.networks.bitcoin : network_;
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
