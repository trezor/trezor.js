'use strict';

var util = require('util'),
    extend = require('extend'),
    unorm = require('unorm'),
    crypto = require('crypto'),
    Promise = require('promise'),
    EventEmitter = require('events').EventEmitter;

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
var Session = function (transport, sessionId) {
    this._transport = transport;
    this._sessionId = sessionId;
    this._emitter = this; // TODO: get emitter as a param
    this.supportsSync = transport.supportsSync;
};

util.inherits(Session, EventEmitter);

Session.prototype.getId = function () {
    return this._sessionId;
};

Session.prototype.release = function () {
    console.log('[trezor] Releasing session');
    return this._transport.release(this._sessionId);
};

Session.prototype.releaseSync = function () {
    if (this.supportsSync) {
        console.log('[trezor] Releasing session synchronously');
        return this._transport.releaseSync(this._sessionId);
    }
};

Session.prototype.initialize = function () {
    return this._typedCommonCall('Initialize', 'Features');
};

Session.prototype.getEntropy = function (size) {
    return this._typedCommonCall('GetEntropy', 'Entropy', {
        size: size
    });
};

Session.prototype.getAddress = function (address_n, coin, show_display) {
    return this._typedCommonCall('GetAddress', 'Address', {
        address_n: address_n,
        coin_name: coin.coin_name,
        show_display: !!show_display
    }).then(function (res) {
        res.message.path = address_n || [];
        return res;
    });
};

Session.prototype.getPublicKey = function (address_n) {
    return this._typedCommonCall('GetPublicKey', 'PublicKey', {
        address_n: address_n
    }).then(function (res) {
        res.message.node.path = address_n || [];
        return res;
    });
};

Session.prototype.wipeDevice = function () {
    return this._commonCall('WipeDevice');
};

Session.prototype.resetDevice = function (settings) {
    return this._commonCall('ResetDevice', settings);
};

Session.prototype.loadDevice = function (settings) {
    return this._commonCall('LoadDevice', settings);
};

Session.prototype.recoverDevice = function (settings) {
    return this._commonCall('RecoveryDevice', settings);
};

Session.prototype.applySettings = function (settings) {
    return this._commonCall('ApplySettings', settings);
};

/**
 * Note: blocking!
 */
Session.prototype.clearSessionSync = function (settings) {
    return this._callSync('ClearSession', settings);
};

Session.prototype.changePin = function (remove) {
    return this._commonCall('ChangePin', {
        remove: remove || false
    });
};

Session.prototype.eraseFirmware = function () {
    return this._commonCall('FirmwareErase');
};

Session.prototype.uploadFirmware = function (payload) {
    return this._commonCall('FirmwareUpload', {
        payload: payload
    });
};

Session.prototype.verifyMessage = function (address, signature, message) {
    return this._commonCall('VerifyMessage', {
        address: address,
        signature: signature,
        message: message
    });
};

Session.prototype.signMessage = function (address_n, message, coin) {
    return this._typedCommonCall('SignMessage', 'MessageSignature', {
        address_n: address_n,
        message: message,
        coin_name: coin.coin_name
    });
};

Session.prototype.signIdentity = function (identity, challenge_hidden, challenge_visual) {
    return this._typedCommonCall('SignIdentity', 'SignedIdentity', {
        identity: identity,
        challenge_hidden: challenge_hidden,
        challenge_visual: challenge_visual
    });
};

Session.prototype.measureTx = function (inputs, outputs, coin) {
    return this._typedCommonCall('EstimateTxSize', 'TxSize', {
        inputs_count: inputs.length,
        outputs_count: outputs.length,
        coin_name: coin.coin_name
    });
};

Session.prototype.simpleSignTx = function (inputs, outputs, txs, coin) {
    return this._typedCommonCall('SimpleSignTx', 'TxRequest', {
        inputs: inputs,
        outputs: outputs,
        coin_name: coin.coin_name,
        transactions: txs
    });
};

Session.prototype._indexTxsForSign = function (inputs, outputs, txs) {
    var index = {};

    // Tx being signed
    index[''] = {
        inputs: inputs,
        outputs: outputs
    };

    // Referenced txs
    txs.forEach(function (tx) {
        index[tx.hash.toLowerCase()] = tx;
    });

    return index;
};

Session.prototype.signTx = function (inputs, outputs, txs, coin) {
    var self = this,
        index = this._indexTxsForSign(inputs, outputs, txs),
        signatures = [],
        serializedTx = '';

    return this._typedCommonCall('SignTx', 'TxRequest', {
        inputs_count: inputs.length,
        outputs_count: outputs.length,
        coin_name: coin.coin_name
    }).then(process);

    function process(res) {
        var m = res.message,
            ms = m.serialized,
            md = m.details,
            reqTx, resTx;

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

        resTx = {};
        reqTx = index[(md.tx_hash || '').toLowerCase()];

        if (!reqTx)
            throw new Error(md.tx_hash
                            ? ('Requested unknown tx: ' + md.tx_hash)
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
            throw new Error('Unknown request type: ' + m.request_type);
        }

        return self._typedCommonCall('TxAck', 'TxRequest', {
            tx: resTx
        }).then(process);
    }
};

Session.prototype._typedCommonCall = function (type, resType, msg) {
    var self = this;

    return this._commonCall(type, msg).then(function (res) {
        return self._assertType(res, resType);
    });
};

Session.prototype._assertType = function (res, resType) {
    if (res.type !== resType)
        throw new TypeError('Response of unexpected type: ' + res.type);
    return res;
};

/**
 * Input:
 *  - type: string with type of message (for example, "PassphraseAck")
 *  - msg: object with some more options (for example, {passphrase: MY_SECRET_PASSPHRASE}
 * Output:
 *  - promise, that resolves with the JSON-parsed result of the request
 *          - if there are further "linked" calls, the promise resolves only with the latest one
 */
Session.prototype._commonCall = function (type, msg) {
    var self = this,
        callpr = this._call(type, msg);

    return callpr.then(function (res) {
        return self._filterCommonTypes(res);
    });
};


/**
 * Input:
 *  - res: JSON-parsed result of the request
 * Output:
 *  - either JSON-parsed result of the request (the same as input)
 *      or a promise that resolves with some further calls
 */
Session.prototype._filterCommonTypes = function (res) {
    var self = this;

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
            function (pin) {
                return self._commonCall('PinMatrixAck', { pin: pin });
            },
            function () {
                return self._commonCall('Cancel');
            }
        );

    if (res.type === 'PassphraseRequest')
        return this._promptPassphrase().then(
            function (passphrase) {
                return self._commonCall('PassphraseAck', { passphrase: passphrase });
            },
            function (err) {
                return self._commonCall('Cancel').then(null, function (e) {
                    throw err || e;
                });
            }
        );

    if (res.type === 'WordRequest')
        return this._promptWord().then(
            function (word) {
                return self._commonCall('WordAck', { word: word });
            },
            function () {
                return self._commonCall('Cancel');
            }
        );

    return res;
};

Session.prototype._promptPin = function (type) {
    var self = this;

    return new Promise(function (resolve, reject) {
        if (!self._emitter.emit('pin', type, function (err, pin) {
            if (err || pin == null)
                reject(err);
            else
                resolve(pin);
        })) {
            console.warn('[trezor] PIN callback not configured, cancelling request');
            reject();
        }
    });
};

Session.prototype._promptPassphrase = function () {
    var self = this;

    return new Promise(function (resolve, reject) {
        if (!self._emitter.emit('passphrase', function (err, passphrase) {
            if (err || passphrase == null)
                reject(err);
            else
                resolve(passphrase.normalize('NFKD'));
        })) {
            console.warn('[trezor] Passphrase callback not configured, cancelling request');
            reject();
        }
    });
};

Session.prototype._promptWord = function () {
    var self = this;

    return new Promise(function (resolve, reject) {
        if (!self._emitter.emit('word', function (err, word) {
            if (err || word == null)
                reject(err);
            else
                resolve(word.toLocaleLowerCase());
        })) {
            console.warn('[trezor] Word callback not configured, cancelling request');
            reject();
        }
    });
};

Session.prototype._generateEntropy = function (len) {
    return crypto.randomBytes(len).toString('binary');
};

/**
 * Input:
 *  - type: string with type of message (for example, "PassphraseAck")
 *  - msg: object with some more options (for example, {passphrase: MY_SECRET_PASSPHRASE}
 * Output:
 *  - promise, that resolves with the JSON-parsed result of the request, and rejects with error
 */
Session.prototype._call = function (type, msg) {
    var self = this,
        logMessage;

    msg = msg || {};
    logMessage = this._filterForLog(type, msg);

    console.log('[trezor] Sending', type, logMessage);
    this._emitter.emit('send', type, msg);

    return this._transport.call(this._sessionId, type, msg).then(
        function (res) {
            var logMessage = self._filterForLog(res.type, res.message);

            console.log('[trezor] Received', res.type, logMessage);
            self._emitter.emit('receive', res.type, res.message);
            return res;
        },
        function (err) {
            console.log('[trezord] Received error', err);
            self._emitter.emit('error', err);
            throw err;
        }
    );
};


/**
 * Input:
 *  - type: string with type of message (for example, "PassphraseAck")
 *  - msg: object with some more options (for example, {passphrase: MY_SECRET_PASSPHRASE}
 * Output:
 *  - JSON-parsed result of the request (error is not returned, it is thrown)
 */
Session.prototype._callSync = function (type, msg) {
    if (!this.supportsSync) {
        return;
    }
    var self = this,
        logMessage;

    msg = msg || {};
    logMessage = this._filterForLog(type, msg);

    console.log('[trezor] Sending', type, logMessage);
    this._emitter.emit('send', type, msg);

    try {
        var res = this._transport.callSync(this._sessionId, type, msg);
        var logMessage = self._filterForLog(res.type, res.message);

        console.log('[trezor] Received', res.type, logMessage);
        self._emitter.emit('receive', res.type, res.message);

        return res;

    } catch (err) {
        console.log('[trezord] Received error', err);
        self._emitter.emit('error', err);
        throw err;
    }

};

Session.prototype._filterForLog = function (type, msg) {
    var redacted = {},
        blacklist = {
            PassphraseAck: {
                passphrase: '(redacted...)'
            }
        };

    return extend(redacted, msg, blacklist[type] || {});
};

module.exports = Session;

//
// Hex codec
//

// Encode binary string to hex string
function stringToHex(bin) {
    var i, chr, hex = '';

    for (i = 0; i < bin.length; i++) {
        chr = (bin.charCodeAt(i) & 0xFF).toString(16);
        hex += chr.length < 2 ? '0' + chr : chr;
    }

    return hex;
}

// Decode hex string to binary string
function hexToString(hex) {
    var i, bytes = [];

    for (i = 0; i < hex.length - 1; i += 2)
        bytes.push(parseInt(hex.substr(i, 2), 16));

    return String.fromCharCode.apply(String, bytes);
}
