'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

exports.coinName = coinName;
exports.coinNetwork = coinNetwork;

var _events = require('./events');

var _flowEvents = require('./flow-events');

var _bitcoinjsLib = require('bitcoinjs-lib');

var bitcoin = _interopRequireWildcard(_bitcoinjsLib);

var _hdnode = require('./utils/hdnode');

var hdnodeUtils = _interopRequireWildcard(_hdnode);

var _signtx = require('./utils/signtx');

var signTxHelper = _interopRequireWildcard(_signtx);

var _signbjstx = require('./utils/signbjstx');

var signBjsTxHelper = _interopRequireWildcard(_signbjstx);

var _call = require('./utils/call');

var _trezortypes = require('./trezortypes');

var trezor = _interopRequireWildcard(_trezortypes);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

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
class Session extends _events.EventEmitter {

    constructor(transport, sessionId, descriptor, debug) {
        super();
        this.sendEvent = new _flowEvents.Event2('send', this);
        this.receiveEvent = new _flowEvents.Event2('receive', this);
        this.errorEvent = new _flowEvents.Event1('error', this);
        this.buttonEvent = new _flowEvents.Event1('button', this);
        this.pinEvent = new _flowEvents.Event2('pin', this);
        this.passphraseEvent = new _flowEvents.Event1('passphrase', this);
        this.wordEvent = new _flowEvents.Event1('word', this);
        this._transport = transport;
        this._sessionId = sessionId;
        this._descriptor = descriptor;
        this.callHelper = new _call.CallHelper(transport, sessionId, this);
        this.debug = debug;
    }

    deactivateEvents() {
        const events = [this.sendEvent, this.receiveEvent, this.errorEvent, this.buttonEvent, this.pinEvent, this.passphraseEvent, this.wordEvent];
        events.forEach(ev => ev.removeAllListeners());
    }

    getId() {
        return this._sessionId;
    }

    getPath() {
        return this._descriptor.path;
    }

    isDescriptor(descriptor) {
        return this._descriptor.path === descriptor.path;
    }

    release() {
        if (this.debug) {
            console.log('[trezor.js] [session] releasing');
        }
        return this._transport.release(this._sessionId);
    }

    initialize() {
        return this.typedCall('Initialize', 'Features');
    }

    getFeatures() {
        return this.typedCall('GetFeatures', 'Features');
    }

    getEntropy(size) {
        return this.typedCall('GetEntropy', 'Entropy', {
            size: size
        });
    }

    getAddress(address_n, coin, show_display) {
        const coin_name = coinName(coin);
        return this.typedCall('GetAddress', 'Address', {
            address_n: address_n,
            coin_name: coin_name,
            show_display: !!show_display
        }).then(res => {
            res.message.path = address_n || [];
            return res;
        });
    }

    getPublicKey(address_n) {
        return this.typedCall('GetPublicKey', 'PublicKey', {
            address_n: address_n
        }).then(res => {
            res.message.node.path = address_n || [];
            return res;
        });
    }

    wipeDevice() {
        return this.typedCall('WipeDevice', 'Success');
    }

    resetDevice(settings) {
        return this.typedCall('ResetDevice', 'Success', settings);
    }

    loadDevice(settings, network) {
        const convertedNetwork = network == null ? null : coinNetwork(network);
        return this.typedCall('LoadDevice', 'Success', wrapLoadDevice(settings, convertedNetwork));
    }

    recoverDevice(settings) {
        return this.typedCall('RecoveryDevice', 'Success', _extends({}, settings, {
            enforce_wordlist: true
        }));
    }

    applySettings(settings) {
        return this.typedCall('ApplySettings', 'Success', settings);
    }

    clearSession(settings) {
        return this.typedCall('ClearSession', 'Success', settings);
    }

    changePin(remove) {
        return this.typedCall('ChangePin', 'Success', {
            remove: remove || false
        });
    }

    eraseFirmware() {
        return this.typedCall('FirmwareErase', 'Success');
    }

    // payload is in hexa
    uploadFirmware(payload) {
        return this.typedCall('FirmwareUpload', 'Success', {
            payload: payload
        });
    }

    updateFirmware(payload) {
        return this.eraseFirmware().then(() => this.uploadFirmware(payload));
    }

    // failure to verify rejects returned promise
    verifyMessage(address, signature, message) {
        return this.typedCall('VerifyMessage', 'Success', {
            address: address,
            signature: signature,
            message: message
        });
    }

    signMessage(address_n, message, coin) {
        return this.typedCall('SignMessage', 'MessageSignature', {
            address_n: address_n,
            message: message,
            coin_name: coinName(coin)
        });
    }

    signIdentity(identity, challenge_hidden, challenge_visual) {
        return this.typedCall('SignIdentity', 'SignedIdentity', {
            identity: identity,
            challenge_hidden: challenge_hidden,
            challenge_visual: challenge_visual
        });
    }

    cipherKeyValue(address_n, key, value, encrypt, ask_on_encrypt, ask_on_decrypt, iv // in hexadecimal
    ) {
        const valueString = value.toString('hex');
        const ivString = iv == null ? null : iv.toString('hex');

        return this.typedCall('CipherKeyValue', 'CipheredKeyValue', {
            address_n: address_n,
            key: key,
            value: valueString,
            encrypt: encrypt,
            ask_on_encrypt: ask_on_encrypt,
            ask_on_decrypt: ask_on_decrypt,
            iv: ivString
        });
    }

    cipherKeyValueBuffer(address_n, key, value, encrypt, ask_on_encrypt, ask_on_decrypt, iv // in hexadecimal
    ) {
        return this.cipherKeyValue(address_n, key, value, encrypt, ask_on_encrypt, ask_on_decrypt, iv).then(r => {
            const val = r.message.value;
            return new Buffer(val, 'hex');
        });
    }

    measureTx(inputs, outputs, coin) {
        return this.typedCall('EstimateTxSize', 'TxSize', {
            inputs_count: inputs.length,
            outputs_count: outputs.length,
            coin_name: coinName(coin)
        });
    }

    signTx(inputs, outputs, txs, coin) {
        return signTxHelper.signTx(this, inputs, outputs, txs, coin);
    }

    signBjsTx(info, refTxs, nodes, coinName) {
        return signBjsTxHelper.signBjsTx(this, info, refTxs, nodes, coinName);
    }

    typedCall(type, resType) {
        let msg = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

        return this.callHelper.typedCall(type, resType, msg);
    }

    verifyAddress(path, address, coin) {
        return this.getAddress(path, coin, true).then(res => {
            const verified = res.message.address === address;

            if (!verified) {
                if (this.debug) {
                    console.warn('[trezor.js] [session] Address verification failed', {
                        path: path,
                        jsAddress: address,
                        trezorAddress: res.message.address
                    });
                }
            }

            return verified;
        });
    }

    changeLabel(label) {
        if (label.length > Session.LABEL_MAX_LENGTH) {
            label = label.slice(0, Session.LABEL_MAX_LENGTH);
        }

        return this.applySettings({
            label: label
        });
    }

    togglePassphrase(enable) {
        return this.applySettings({
            use_passphrase: enable
        });
    }

    changeHomescreen(hex) {
        return this.applySettings({
            homescreen: hex
        });
    }

    getHDNode(path, network) {
        return hdnodeUtils.getHDNode(this, path, coinNetwork(network));
    }
}

exports.default = Session;
Session.LABEL_MAX_LENGTH = 16;
function coinName(coin) {
    if (typeof coin === 'string') {
        return coin.charAt(0).toUpperCase() + coin.slice(1);
    } else {
        return coin.coin_name;
    }
}

function coinNetwork(coin) {
    const r = coin;
    if (typeof coin.messagePrefix === 'string') {
        return r;
    }

    const name = coinName(r).toLowerCase();
    const network = bitcoin.networks[name];
    if (network == null) {
        throw new Error(`No network with the name ${ name }.`);
    }
    return network;
}

function wrapLoadDevice(settings, network_) {
    const network = network_ == null ? bitcoin.networks.bitcoin : network_;
    if (settings.node == null && settings.mnemonic == null) {
        if (settings.payload == null) {
            throw new Error('Payload, mnemonic or node necessary.');
        }
        try {
            // try to decode as xprv
            const bjsNode = bitcoin.HDNode.fromBase58(settings.payload, network);
            settings = _extends({}, settings, { node: hdnodeUtils.bjsNode2privNode(bjsNode) });
        } catch (e) {
            // use as mnemonic
            settings = _extends({}, settings, { mnemonic: settings.payload });
        }
        delete settings.payload;
    }
    return settings;
}