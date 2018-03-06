'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _desc, _value, _class, _class2, _temp;

exports.coinName = coinName;
exports.coinNetwork = coinNetwork;

var _events = require('./events');

var _flowEvents = require('./flow-events');

var _bitcoinjsLibZcash = require('bitcoinjs-lib-zcash');

var bitcoin = _interopRequireWildcard(_bitcoinjsLibZcash);

var _hdnode = require('./utils/hdnode');

var hdnodeUtils = _interopRequireWildcard(_hdnode);

var _signtx = require('./utils/signtx');

var signTxHelper = _interopRequireWildcard(_signtx);

var _signbjstx = require('./utils/signbjstx');

var signBjsTxHelper = _interopRequireWildcard(_signbjstx);

var _signethtx = require('./utils/signethtx');

var signEthTxHelper = _interopRequireWildcard(_signethtx);

var _call = require('./utils/call');

var _trezortypes = require('./trezortypes');

var trezor = _interopRequireWildcard(_trezortypes);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) {
    var desc = {};
    Object['ke' + 'ys'](descriptor).forEach(function (key) {
        desc[key] = descriptor[key];
    });
    desc.enumerable = !!desc.enumerable;
    desc.configurable = !!desc.configurable;

    if ('value' in desc || desc.initializer) {
        desc.writable = true;
    }

    desc = decorators.slice().reverse().reduce(function (desc, decorator) {
        return decorator(target, property, desc) || desc;
    }, desc);

    if (context && desc.initializer !== void 0) {
        desc.value = desc.initializer ? desc.initializer.call(context) : void 0;
        desc.initializer = undefined;
    }

    if (desc.initializer === void 0) {
        Object['define' + 'Property'](target, property, desc);
        desc = null;
    }

    return desc;
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
var Session = (_class = (_temp = _class2 = function (_EventEmitter) {
    _inherits(Session, _EventEmitter);

    function Session(transport, sessionId, descriptor, debug, device, xpubDerive) {
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
        _this.device = device;
        _this.callHelper = new _call.CallHelper(transport, sessionId, _this);
        _this.debug = debug;
        _this.xpubDerive = xpubDerive;
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
        value: function release(onclose) {
            if (this.debug) {
                console.log('[trezor.js] [session] releasing', onclose);
            }
            return this._transport.release(this._sessionId, onclose);
        }
    }, {
        key: 'initialize',
        value: function initialize() {
            if (this.device && this.device.passphraseState) {
                return this.typedCall('Initialize', 'Features', { state: this.device.passphraseState });
            }
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
        value: function getAddress(address_n, coin, show_display, segwit) {
            var coin_name = coinName(coin);
            return this.typedCall('GetAddress', 'Address', {
                address_n: address_n,
                coin_name: coin_name,
                show_display: !!show_display,
                script_type: segwit ? 'SPENDP2SHWITNESS' : 'SPENDADDRESS'
            }).then(function (res) {
                res.message.path = address_n || [];
                return res;
            });
        }
    }, {
        key: 'ethereumGetAddress',
        value: function ethereumGetAddress(address_n, show_display) {
            return this.typedCall('EthereumGetAddress', 'EthereumAddress', {
                address_n: address_n,
                show_display: !!show_display
            }).then(function (res) {
                res.message.path = address_n || [];
                return res;
            });
        }
    }, {
        key: 'getPublicKey',
        value: function getPublicKey(address_n, coin) {
            return this._getPublicKeyInternal(address_n, coin);
        }
    }, {
        key: '_getPublicKeyInternal',
        value: function _getPublicKeyInternal(address_n, coin) {
            var coin_name = coin ? coinName(coin) : 'Bitcoin';
            return this.typedCall('GetPublicKey', 'PublicKey', {
                address_n: address_n,
                coin_name: coin_name
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
        key: 'applyFlags',
        value: function applyFlags(flags) {
            return this.typedCall('ApplyFlags', 'Success', { flags: flags });
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

        // payload is in hexa

    }, {
        key: 'updateFirmware',
        value: function updateFirmware(payload) {
            var device = this.device;
            if (device == null) {
                return Promise.reject(new Error('Cannot determine bootloader version.'));
            }
            if (!device.features.bootloader_mode) {
                return Promise.reject(new Error('Device is not in bootloader mode.'));
            }
            if (device.features.major_version === 2) {
                return this._updateFirmwareV2(payload);
            } else {
                return this._updateFirmwareV1(payload);
            }
        }
    }, {
        key: '_updateFirmwareV1',
        value: function () {
            var _ref = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee(payload) {
                return regeneratorRuntime.wrap(function _callee$(_context) {
                    while (1) {
                        switch (_context.prev = _context.next) {
                            case 0:
                                _context.next = 2;
                                return this.typedCall('FirmwareErase', 'Success');

                            case 2:
                                _context.next = 4;
                                return this.typedCall('FirmwareUpload', 'Success', {
                                    payload: payload
                                });

                            case 4:
                                return _context.abrupt('return', _context.sent);

                            case 5:
                            case 'end':
                                return _context.stop();
                        }
                    }
                }, _callee, this);
            }));

            function _updateFirmwareV1(_x) {
                return _ref.apply(this, arguments);
            }

            return _updateFirmwareV1;
        }()
    }, {
        key: '_updateFirmwareV2',
        value: function () {
            var _ref2 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee2(payload) {
                var request, start, end, substring;
                return regeneratorRuntime.wrap(function _callee2$(_context2) {
                    while (1) {
                        switch (_context2.prev = _context2.next) {
                            case 0:
                                _context2.next = 2;
                                return this.typedCall('FirmwareErase', 'FirmwareRequest', { length: payload.length / 2 });

                            case 2:
                                request = _context2.sent;

                            case 3:
                                if (!(request.type !== 'Success')) {
                                    _context2.next = 12;
                                    break;
                                }

                                start = request.message.offset * 2;
                                end = request.message.offset * 2 + request.message.length * 2;
                                substring = payload.substring(start, end);
                                _context2.next = 9;
                                return this.typedCall('FirmwareUpload', 'FirmwareRequest|Success', {
                                    payload: substring
                                });

                            case 9:
                                request = _context2.sent;
                                _context2.next = 3;
                                break;

                            case 12:
                                return _context2.abrupt('return', request);

                            case 13:
                            case 'end':
                                return _context2.stop();
                        }
                    }
                }, _callee2, this);
            }));

            function _updateFirmwareV2(_x2) {
                return _ref2.apply(this, arguments);
            }

            return _updateFirmwareV2;
        }()

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
        key: 'verifyEthMessage',
        value: function verifyEthMessage(address, signature, message) {
            return this.typedCall('EthereumVerifyMessage', 'Success', {
                address: address,
                signature: signature,
                message: message
            });
        }
    }, {
        key: 'signMessage',
        value: function signMessage(address_n, message, coin, segwit) {
            return this.typedCall('SignMessage', 'MessageSignature', {
                address_n: address_n,
                message: message,
                coin_name: coinName(coin),
                script_type: segwit ? 'SPENDP2SHWITNESS' : undefined
            });
        }
    }, {
        key: 'signEthMessage',
        value: function signEthMessage(address_n, message) {
            return this.typedCall('EthereumSignMessage', 'EthereumMessageSignature', {
                address_n: address_n,
                message: message
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
        value: function signTx(inputs, outputs, txs, coin, locktime) {
            return signTxHelper.signTx(this, inputs, outputs, txs, coin, locktime);
        }
    }, {
        key: 'signBjsTx',
        value: function signBjsTx(info, refTxs, nodes, coinName, network, locktime) {
            return signBjsTxHelper.signBjsTx(this, info, refTxs, nodes, coinName, network, locktime);
        }
    }, {
        key: 'signEthTx',
        value: function signEthTx(address_n, nonce, gas_price, gas_limit, to, value, data, chain_id) {
            return signEthTxHelper.signEthTx(this, address_n, nonce, gas_price, gas_limit, to, value, data, chain_id);
        }
    }, {
        key: 'typedCall',
        value: function typedCall(type, resType) {
            var msg = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

            return this.callHelper.typedCall(type, resType, msg);
        }
    }, {
        key: 'verifyAddress',
        value: function verifyAddress(path, address, coin, segwit) {
            var _this2 = this;

            return this.getAddress(path, coin, true, segwit).then(function (res) {
                var verified = res.message.address === address;

                if (!verified) {
                    if (_this2.debug) {
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
        key: '_getHDNodeInternal',
        value: function _getHDNodeInternal(path, network) {
            return hdnodeUtils.getHDNode(this, path, coinNetwork(network), this.xpubDerive);
        }
    }, {
        key: 'getHDNode',
        value: function getHDNode(path, network) {
            return this._getHDNodeInternal(path, network);
        }
    }, {
        key: 'setU2FCounter',
        value: function setU2FCounter(counter) {
            return this.typedCall('SetU2FCounter', 'Success', {
                u2f_counter: counter
            });
        }
    }, {
        key: 'backupDevice',
        value: function backupDevice() {
            return this.typedCall('BackupDevice', 'Success');
        }
    }, {
        key: 'nemGetAddress',
        value: function nemGetAddress(address_n, network, show_display) {
            return this.typedCall('NEMGetAddress', 'NEMAddress', {
                address_n: address_n,
                network: network,
                show_display: !!show_display
            });
        }
    }, {
        key: 'nemSignTx',
        value: function nemSignTx(transaction) {
            return this.typedCall('NEMSignTx', 'NEMSignedTx', transaction);
        }
    }, {
        key: 'nemDecryptMessage',
        value: function nemDecryptMessage(address_n, network, public_key, payload) {
            return this.typedCall('NEMDecryptMessage', 'NEMDecryptedMessage', {
                address_n: address_n,
                network: network,
                public_key: public_key,
                payload: payload
            });
        }
    }]);

    return Session;
}(_events.EventEmitter), _class2.LABEL_MAX_LENGTH = 16, _temp), (_applyDecoratedDescriptor(_class.prototype, 'getAddress', [integrityCheck], Object.getOwnPropertyDescriptor(_class.prototype, 'getAddress'), _class.prototype), _applyDecoratedDescriptor(_class.prototype, 'ethereumGetAddress', [integrityCheck], Object.getOwnPropertyDescriptor(_class.prototype, 'ethereumGetAddress'), _class.prototype), _applyDecoratedDescriptor(_class.prototype, 'getPublicKey', [integrityCheck], Object.getOwnPropertyDescriptor(_class.prototype, 'getPublicKey'), _class.prototype), _applyDecoratedDescriptor(_class.prototype, 'signTx', [integrityCheck], Object.getOwnPropertyDescriptor(_class.prototype, 'signTx'), _class.prototype), _applyDecoratedDescriptor(_class.prototype, 'signBjsTx', [integrityCheck], Object.getOwnPropertyDescriptor(_class.prototype, 'signBjsTx'), _class.prototype), _applyDecoratedDescriptor(_class.prototype, 'signEthTx', [integrityCheck], Object.getOwnPropertyDescriptor(_class.prototype, 'signEthTx'), _class.prototype), _applyDecoratedDescriptor(_class.prototype, 'verifyAddress', [integrityCheck], Object.getOwnPropertyDescriptor(_class.prototype, 'verifyAddress'), _class.prototype), _applyDecoratedDescriptor(_class.prototype, 'getHDNode', [integrityCheck], Object.getOwnPropertyDescriptor(_class.prototype, 'getHDNode'), _class.prototype), _applyDecoratedDescriptor(_class.prototype, 'nemSignTx', [integrityCheck], Object.getOwnPropertyDescriptor(_class.prototype, 'nemSignTx'), _class.prototype)), _class);
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

// See the comment in device.js on integrityCheckingXpub.
// The check is not done here but on device.js, since Session object
// disappears and doesn't remember the xpubs
function integrityCheck(target, name, descriptor) {
    var original = descriptor.value;
    descriptor.value = function () {
        var _this3 = this,
            _arguments = arguments;

        var checkPromise = Promise.resolve();
        if (this.device != null) {
            checkPromise = this.device.xpubIntegrityCheck(this);
        }

        return checkPromise.then(function () {
            return original.apply(_this3, _arguments);
        });
    };

    return descriptor;
}