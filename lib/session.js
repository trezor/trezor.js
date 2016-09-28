'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

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

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

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
var Session = function (_EventEmitter) {
    _inherits(Session, _EventEmitter);

    function Session(transport, sessionId, descriptor, debug) {
        _classCallCheck(this, Session);

        var _this = _possibleConstructorReturn(this, (Session.__proto__ || Object.getPrototypeOf(Session)).call(this));

        _this.sendEvent = new _flowEvents.Event2('send', _this);
        _this.receiveEvent = new _flowEvents.Event2('receive', _this);
        _this.errorEvent = new _flowEvents.Event1('error', _this);
        _this.buttonEvent = new _flowEvents.Event1('button', _this);
        _this.pinEvent = new _flowEvents.Event2('pin', _this);
        _this.passphraseEvent = new _flowEvents.Event1('passphrase', _this);
        _this.wordEvent = new _flowEvents.Event1('word', _this);

        _this._transport = transport;
        _this._sessionId = sessionId;
        _this._descriptor = descriptor;
        _this.callHelper = new _call.CallHelper(transport, sessionId, _this);
        _this.debug = debug;
        return _this;
    }

    _createClass(Session, [{
        key: 'deactivateEvents',
        value: function deactivateEvents() {
            var events = [this.sendEvent, this.receiveEvent, this.errorEvent, this.buttonEvent, this.pinEvent, this.passphraseEvent, this.wordEvent];
            events.forEach(function (ev) {
                return ev.removeAllListeners();
            });
        }
    }, {
        key: 'getId',
        value: function getId() {
            return this._sessionId;
        }
    }, {
        key: 'getPath',
        value: function getPath() {
            return this._descriptor.path;
        }
    }, {
        key: 'isDescriptor',
        value: function isDescriptor(descriptor) {
            return this._descriptor.path === descriptor.path;
        }
    }, {
        key: 'release',
        value: function release() {
            if (this.debug) {
                console.log('[trezor.js] [session] releasing');
            }
            return this._transport.release(this._sessionId);
        }
    }, {
        key: 'initialize',
        value: function initialize() {
            return this.typedCall('Initialize', 'Features');
        }
    }, {
        key: 'getFeatures',
        value: function getFeatures() {
            return this.typedCall('GetFeatures', 'Features');
        }
    }, {
        key: 'getEntropy',
        value: function getEntropy(size) {
            return this.typedCall('GetEntropy', 'Entropy', {
                size: size
            });
        }
    }, {
        key: 'getAddress',
        value: function getAddress(address_n, coin, show_display) {
            var coin_name = coinName(coin);
            return this.typedCall('GetAddress', 'Address', {
                address_n: address_n,
                coin_name: coin_name,
                show_display: !!show_display
            }).then(function (res) {
                res.message.path = address_n || [];
                return res;
            });
        }
    }, {
        key: 'getPublicKey',
        value: function getPublicKey(address_n) {
            return this.typedCall('GetPublicKey', 'PublicKey', {
                address_n: address_n
            }).then(function (res) {
                res.message.node.path = address_n || [];
                return res;
            });
        }
    }, {
        key: 'wipeDevice',
        value: function wipeDevice() {
            return this.typedCall('WipeDevice', 'Success');
        }
    }, {
        key: 'resetDevice',
        value: function resetDevice(settings) {
            return this.typedCall('ResetDevice', 'Success', settings);
        }
    }, {
        key: 'loadDevice',
        value: function loadDevice(settings, network) {
            var convertedNetwork = network == null ? null : coinNetwork(network);
            return this.typedCall('LoadDevice', 'Success', wrapLoadDevice(settings, convertedNetwork));
        }
    }, {
        key: 'recoverDevice',
        value: function recoverDevice(settings) {
            return this.typedCall('RecoveryDevice', 'Success', _extends({}, settings, {
                enforce_wordlist: true
            }));
        }
    }, {
        key: 'applySettings',
        value: function applySettings(settings) {
            return this.typedCall('ApplySettings', 'Success', settings);
        }
    }, {
        key: 'clearSession',
        value: function clearSession(settings) {
            return this.typedCall('ClearSession', 'Success', settings);
        }
    }, {
        key: 'changePin',
        value: function changePin(remove) {
            return this.typedCall('ChangePin', 'Success', {
                remove: remove || false
            });
        }
    }, {
        key: 'eraseFirmware',
        value: function eraseFirmware() {
            return this.typedCall('FirmwareErase', 'Success');
        }

        // payload is in hexa

    }, {
        key: 'uploadFirmware',
        value: function uploadFirmware(payload) {
            return this.typedCall('FirmwareUpload', 'Success', {
                payload: payload
            });
        }
    }, {
        key: 'updateFirmware',
        value: function updateFirmware(payload) {
            var _this2 = this;

            return this.eraseFirmware().then(function () {
                return _this2.uploadFirmware(payload);
            });
        }

        // failure to verify rejects returned promise

    }, {
        key: 'verifyMessage',
        value: function verifyMessage(address, signature, message, coin) {
            return this.typedCall('VerifyMessage', 'Success', {
                address: address,
                signature: signature,
                message: message,
                coin_name: coinName(coin)
            });
        }
    }, {
        key: 'signMessage',
        value: function signMessage(address_n, message, coin) {
            return this.typedCall('SignMessage', 'MessageSignature', {
                address_n: address_n,
                message: message,
                coin_name: coinName(coin)
            });
        }
    }, {
        key: 'signIdentity',
        value: function signIdentity(identity, challenge_hidden, challenge_visual) {
            return this.typedCall('SignIdentity', 'SignedIdentity', {
                identity: identity,
                challenge_hidden: challenge_hidden,
                challenge_visual: challenge_visual
            });
        }
    }, {
        key: 'cipherKeyValue',
        value: function cipherKeyValue(address_n, key, value, encrypt, ask_on_encrypt, ask_on_decrypt, iv // in hexadecimal
        ) {
            var valueString = value.toString('hex');
            var ivString = iv == null ? null : iv.toString('hex');

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
    }, {
        key: 'cipherKeyValueBuffer',
        value: function cipherKeyValueBuffer(address_n, key, value, encrypt, ask_on_encrypt, ask_on_decrypt, iv // in hexadecimal
        ) {
            return this.cipherKeyValue(address_n, key, value, encrypt, ask_on_encrypt, ask_on_decrypt, iv).then(function (r) {
                var val = r.message.value;
                return new Buffer(val, 'hex');
            });
        }
    }, {
        key: 'measureTx',
        value: function measureTx(inputs, outputs, coin) {
            return this.typedCall('EstimateTxSize', 'TxSize', {
                inputs_count: inputs.length,
                outputs_count: outputs.length,
                coin_name: coinName(coin)
            });
        }
    }, {
        key: 'signTx',
        value: function signTx(inputs, outputs, txs, coin) {
            return signTxHelper.signTx(this, inputs, outputs, txs, coin);
        }
    }, {
        key: 'signBjsTx',
        value: function signBjsTx(info, refTxs, nodes, coinName) {
            return signBjsTxHelper.signBjsTx(this, info, refTxs, nodes, coinName);
        }
    }, {
        key: 'typedCall',
        value: function typedCall(type, resType) {
            var msg = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

            return this.callHelper.typedCall(type, resType, msg);
        }
    }, {
        key: 'verifyAddress',
        value: function verifyAddress(path, address, coin) {
            var _this3 = this;

            return this.getAddress(path, coin, true).then(function (res) {
                var verified = res.message.address === address;

                if (!verified) {
                    if (_this3.debug) {
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
    }, {
        key: 'changeLabel',
        value: function changeLabel(label) {
            if (label.length > Session.LABEL_MAX_LENGTH) {
                label = label.slice(0, Session.LABEL_MAX_LENGTH);
            }

            return this.applySettings({
                label: label
            });
        }
    }, {
        key: 'togglePassphrase',
        value: function togglePassphrase(enable) {
            return this.applySettings({
                use_passphrase: enable
            });
        }
    }, {
        key: 'changeHomescreen',
        value: function changeHomescreen(hex) {
            return this.applySettings({
                homescreen: hex
            });
        }
    }, {
        key: 'getHDNode',
        value: function getHDNode(path, network) {
            return hdnodeUtils.getHDNode(this, path, coinNetwork(network));
        }
    }]);

    return Session;
}(_events.EventEmitter);

Session.LABEL_MAX_LENGTH = 16;
exports.default = Session;
function coinName(coin) {
    if (typeof coin === 'string') {
        return coin.charAt(0).toUpperCase() + coin.slice(1);
    } else {
        return coin.coin_name;
    }
}

function coinNetwork(coin) {
    var r = coin;
    if (typeof coin.messagePrefix === 'string') {
        return r;
    }

    var name = coinName(r).toLowerCase();
    var network = bitcoin.networks[name];
    if (network == null) {
        throw new Error('No network with the name ' + name + '.');
    }
    return network;
}

function wrapLoadDevice(settings, network_) {
    var network = network_ == null ? bitcoin.networks.bitcoin : network_;
    if (settings.node == null && settings.mnemonic == null) {
        if (settings.payload == null) {
            throw new Error('Payload, mnemonic or node necessary.');
        }
        try {
            // try to decode as xprv
            var bjsNode = bitcoin.HDNode.fromBase58(settings.payload, network);
            settings = _extends({}, settings, { node: hdnodeUtils.bjsNode2privNode(bjsNode) });
        } catch (e) {
            // use as mnemonic
            settings = _extends({}, settings, { mnemonic: settings.payload });
        }
        delete settings.payload;
    }
    return settings;
}