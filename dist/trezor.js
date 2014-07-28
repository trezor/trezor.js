!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.trezor=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
var Promise = _dereq_('promise'),
    request = _dereq_('browser-request');

function promiseRequest(options, payload) {
    return new Promise(function (resolve, reject) {
        request(options, function (err, response, body) {
            if (err) {
                reject(err);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error('Request failed with status '
                                 + response.statusCode));
            }

            resolve(body);
        });
    });
}

module.exports = promiseRequest;

},{"browser-request":8,"promise":29}],2:[function(_dereq_,module,exports){
'use strict';

// interface Transport {
//
//     function configure(String config) -> Promise()
//
//     function enumerate() -> Promise([{
//         String path
//         String vendor
//         String product
//         String serialNumber
//         String session
//     }] devices)
//
//     function acquire(String path) -> Promise(String session)
//
//     function release(String session) -> Promise()
//
//     function call(String session, String name, Object data) -> Promise({
//         String name,
//         Object data,
//     })
//
// }

module.exports = {
    http: _dereq_('./http'),
    HttpTransport: _dereq_('./transport/http'),
    plugin: _dereq_('./plugin'),
    PluginTransport: _dereq_('./transport/plugin'),
    Session: _dereq_('./session'),
    installers: _dereq_('./installers')
};

},{"./http":1,"./installers":3,"./plugin":4,"./session":5,"./transport/http":6,"./transport/plugin":7}],3:[function(_dereq_,module,exports){
var BRIDGE_VERSION_URL = '/data/bridge/latest.txt',
    BRIDGE_INSTALLERS = [{
        url: '/data/bridge/%version%/BitcoinTrezorBridge-%version%.msi',
        label: 'Windows',
        platform: 'win'
    }, {
        url: '/data/bridge/%version%/trezor-bridge-%version%.dmg',
        label: 'Mac OS X',
        platform: 'mac'
    }, {
        url: '/data/bridge/%version%/browser-bridge-trezor_%version%_amd64.deb',
        label: 'Linux x86_64 (deb)',
        platform: 'deb64'
    }, {
        url: '/data/bridge/%version%/browser-bridge-trezor-%version%.x86_64.rpm',
        label: 'Linux x86_64 (rpm)',
        platform: 'rpm64'
    }, {
        url: '/data/bridge/%version%/browser-bridge-trezor_%version%_i386.deb',
        label: 'Linux i386 (deb)',
        platform: 'deb32'
    }, {
        url: '/data/bridge/%version%/browser-bridge-trezor-%version%.i386.rpm',
        label: 'Linux i386 (rpm)',
        platform: 'rpm32'
    }];

// Returns a list of bridge installers, with download URLs and a mark on
// bridge preferred for the user's platform.
function installers(options) {
    var o = options || {},
        bridgeUrl = o.bridgeUrl || BRIDGE_VERSION_URL,
        version = o.version || requestUri(bridgeUrl).trim(),
        platform = o.platform || preferredPlatform();

    return BRIDGE_INSTALLERS.map(function (bridge) {
        return {
            version: version,
            url: bridge.url.replace(/%version%/g, version),
            label: bridge.label,
            platform: bridge.platform,
            preferred: (bridge.platform === platform)
        };
    });
};

function preferredPlatform() {
    var ver = navigator.userAgent;

    if (ver.match(/Win/)) return 'win';
    if (ver.match(/Mac/)) return 'mac';
    if (ver.match(/Linux i[3456]86/))
        return ver.match(/CentOS|Fedora|Mandriva|Mageia|Red Hat|Scientific|SUSE/)
            ? 'rpm32' : 'deb32';
    if (ver.match(/Linux/))
        return ver.match(/CentOS|Fedora|Mandriva|Mageia|Red Hat|Scientific|SUSE/)
            ? 'rpm64' : 'deb64';
}

function requestUri(url) {
    var req = new XMLHttpRequest();

    req.open('get', url, false);
    req.send();

    if (req.status !== 200)
        throw new Error('Failed to GET ' + url);

    return req.responseText;
}

module.exports = installers;

},{}],4:[function(_dereq_,module,exports){
'use strict';

var console = _dereq_('console'),
    extend = _dereq_('extend'),
    Promise = _dereq_('promise');

// Try to load a plugin with given options, returns promise. In case of
// rejection, err contains `installed` property. If not installed, you can get
// download URLs for the latest plugin version with the `installers` method.
module.exports.load = function (options) {
    var o = extend(options, {
        // mimetype of the plugin
        mimetype: 'application/x-bitcointrezorplugin',
        // name of the callback in the global namespace
        fname: '__trezorPluginLoaded',
        // id of the plugin element
        id: '__trezor-plugin',
        // time to wait until timeout, in msec
        timeout: 500
    });

    // if we know for sure that the plugin is installed, never timeout
    var installed = isInstalled(o.mimetype),
        timeout = installed ? 0 : o.timeout;

    // if the plugin is already loaded, use it
    var plugin = document.getElementById(o.id);
    if (plugin)
        return Promise.from(plugin);

    // inject or reject after timeout
    return Promise.race([
        injectPlugin(o.id, o.mimetype, o.fname),
        rejectAfter(timeout, new Error('Loading timeout out'))
    ]).catch(function (err) {
        err.installed = installed;
        throw err;
    }).then(
        function (plugin) {
            console.log('[trezor] Loaded plugin ' + plugin.version);
            return plugin;
        },
        function (err) {
            console.error('[trezor] Failed to load plugin: ' + err.message);
            throw err;
        }
    );
};

// Injects the plugin object into the page and waits until it loads.
function injectPlugin(id, mimetype, fname) {
    return new Promise(function (resolve, reject) {
        var body = document.getElementsByTagName('body')[0],
            elem = document.createElement('div');

        // register load function
        window[fname] = function () {
            var plugin = document.getElementById(id);
            if (plugin)
                resolve(plugin);
            else
                reject(new Error('Plugin not found'));
        };

        // inject object elem
        body.appendChild(elem);
        elem.innerHTML =
            '<object width="1" height="1" id="'+id+'" type="'+mimetype+'">'+
            ' <param name="onload" value="'+fname+'" />'+
            '</object>';
    });
}

// If given timeout, gets rejected after n msec, otherwise never resolves.
function rejectAfter(msec, val) {
    return new Promise(function (resolve, reject) {
        if (msec > 0)
            setTimeout(function () { reject(val); }, msec);
    });
}

// Returns true if plugin with a given mimetype is installed.
function isInstalled(mimetype) {
    navigator.plugins.refresh(false);
    return !!navigator.mimeTypes[mimetype];
}

},{"console":15,"extend":27,"promise":29}],5:[function(_dereq_,module,exports){
'use strict';

var util = _dereq_('util'),
    unorm = _dereq_('unorm'),
    crypto = _dereq_('crypto'),
    Promise = _dereq_('promise'),
    EventEmitter = _dereq_('events').EventEmitter;

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
};

util.inherits(Session, EventEmitter);

Session.prototype.release = function () {
    console.log('[trezor] Releasing session');
    return this._transport.release(this._sessionId);
};

Session.prototype.initialize = function () {
    return this._typedCommonCall('Initialize', 'Features');
};

Session.prototype.getEntropy = function (size) {
    return this._typedCommonCall('GetEntropy', 'Entropy', {
        size: size
    });
};

Session.prototype.getAddress = function (address_n) {
    return this._typedCommonCall('GetAddress', 'Address', {
        address_n: address_n
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
        index[tx.hash] = tx;
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
        reqTx = index[md.tx_hash || ''];

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

Session.prototype._commonCall = function (type, msg) {
    var self = this,
        callpr = this._call(type, msg);

    return callpr.then(function (res) {
        return self._filterCommonTypes(res);
    });
};

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
            function () {
                return self._commonCall('Cancel');
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

Session.prototype._call = function (type, msg) {
    var self = this;

    msg = msg || {};

    console.log('[trezor] Sending', type, msg);
    this._emitter.emit('send', type, msg);

    return this._transport.call(this._sessionId, type, msg)
        .then(function (res) {
            console.log('[trezor] Received', res.type, res.message);
            self._emitter.emit('receive', res.type, res.message);
            return res;
        });
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

},{"crypto":17,"events":22,"promise":29,"unorm":31,"util":26}],6:[function(_dereq_,module,exports){
'use strict';

var extend = _dereq_('extend'),
    http = _dereq_('../http');

//
// HTTP transport.
//
var HttpTransport = function (url) {
    this._url = url;
};

HttpTransport.connect = function (url) {
    return http({
        url: url, json: true
    });
};

HttpTransport.prototype._request = function (options) {
    return http(extend(options, {
        url: this._url + options.url
    }));
};

HttpTransport.prototype.configure = function (config) {
    return this._request({
        method: 'POST', url: '/configure', body: config
    });
};

HttpTransport.prototype.enumerate = function () {
    return this._request({
        method: 'GET', url: '/enumerate', json: true
    });
};

HttpTransport.prototype.acquire = function (device) {
    var path = device.path; // TODO: take just path
    return this._request({
        method: 'POST', url: '/acquire/' + path, json: true
    });
};

HttpTransport.prototype.release = function (sessionId) {
    return this._request({
        method: 'POST', url: '/release/' + sessionId, json: true
    });
};

HttpTransport.prototype.call = function (sessionId, type, message) {
    return this._request({
        method: 'POST', url: '/call/' + sessionId, json: {
            type: type,
            message: message
        }
    });
};

module.exports = HttpTransport;

},{"../http":1,"extend":27}],7:[function(_dereq_,module,exports){
'use strict';

var Promise = _dereq_('promise');

//
// Plugin transport.
//
var PluginTransport = function (plugin) {
    this._plugin = plugin;
};

// Configures the plugin.
PluginTransport.prototype.configure = function (config) {
    var plugin = this._plugin;

    return new Promise(function (resolve, reject) {
        try {
            plugin.configure(config);
            resolve();
        } catch (e) {
            // In most browsers, exceptions from plugin methods are not properly
            // propagated
            reject(new Error(
                'Plugin configuration found, but could not be used. ' +
                    'Make sure it has proper format and a valid signature.'
            ));
        }
    });
};

// Enumerates connected devices.
// Requires configured plugin.
PluginTransport.prototype.enumerate = function () {
    var plugin = this._plugin;

    return new Promise(function (resolve) {
        resolve(plugin.devices());
    });
};

// Opens a device and returns a session object.
PluginTransport.prototype.acquire = function (device) {
    return Promise.resolve({
        session: device
    });
};

//
PluginTransport.prototype.release = function (device) {
    var plugin = this._plugin;

    return new Promise(function (resolve, reject) {
        plugin.close(device);
        resolve();
    });
};

//
PluginTransport.prototype.call = function (device, type, message) {
    var plugin = this._plugin,
        timeout = false;

    return new Promise(function (resolve, reject) {
        plugin.call(device, timeout, type, message, {
            success: function (t, m) {
                resolve({
                    type: t,
                    message: m
                });
            },
            error: function (err) {
                reject(new Error(err));
            }
        });
    });
};

module.exports = PluginTransport;

},{"promise":29}],8:[function(_dereq_,module,exports){
// Browser Request
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var XHR = XMLHttpRequest
if (!XHR) throw new Error('missing XMLHttpRequest')
request.log = {
  'trace': noop, 'debug': noop, 'info': noop, 'warn': noop, 'error': noop
}

var DEFAULT_TIMEOUT = 3 * 60 * 1000 // 3 minutes

//
// request
//

function request(options, callback) {
  // The entry-point to the API: prep the options object and pass the real work to run_xhr.
  if(typeof callback !== 'function')
    throw new Error('Bad callback given: ' + callback)

  if(!options)
    throw new Error('No options given')

  var options_onResponse = options.onResponse; // Save this for later.

  if(typeof options === 'string')
    options = {'uri':options};
  else
    options = JSON.parse(JSON.stringify(options)); // Use a duplicate for mutating.

  options.onResponse = options_onResponse // And put it back.

  if (options.verbose) request.log = getLogger();

  if(options.url) {
    options.uri = options.url;
    delete options.url;
  }

  if(!options.uri && options.uri !== "")
    throw new Error("options.uri is a required argument");

  if(typeof options.uri != "string")
    throw new Error("options.uri must be a string");

  var unsupported_options = ['proxy', '_redirectsFollowed', 'maxRedirects', 'followRedirect']
  for (var i = 0; i < unsupported_options.length; i++)
    if(options[ unsupported_options[i] ])
      throw new Error("options." + unsupported_options[i] + " is not supported")

  options.callback = callback
  options.method = options.method || 'GET';
  options.headers = options.headers || {};
  options.body    = options.body || null
  options.timeout = options.timeout || request.DEFAULT_TIMEOUT

  if(options.headers.host)
    throw new Error("Options.headers.host is not supported");

  if(options.json) {
    options.headers.accept = options.headers.accept || 'application/json'
    if(options.method !== 'GET')
      options.headers['content-type'] = 'application/json'

    if(typeof options.json !== 'boolean')
      options.body = JSON.stringify(options.json)
    else if(typeof options.body !== 'string')
      options.body = JSON.stringify(options.body)
  }
  
  //BEGIN QS Hack
  var serialize = function(obj) {
    var str = [];
    for(var p in obj)
      if (obj.hasOwnProperty(p)) {
        str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
      }
    return str.join("&");
  }
  
  if(options.qs){
    var qs = (typeof options.qs == 'string')? options.qs : serialize(options.qs);
    if(options.uri.indexOf('?') !== -1){ //no get params
        options.uri = options.uri+'&'+qs;
    }else{ //existing get params
        options.uri = options.uri+'?'+qs;
    }
  }
  //END QS Hack
  
  //BEGIN FORM Hack
  var multipart = function(obj) {
    //todo: support file type (useful?)
    var result = {};
    result.boundry = '-------------------------------'+Math.floor(Math.random()*1000000000);
    var lines = [];
    for(var p in obj){
        if (obj.hasOwnProperty(p)) {
            lines.push(
                '--'+result.boundry+"\n"+
                'Content-Disposition: form-data; name="'+p+'"'+"\n"+
                "\n"+
                obj[p]+"\n"
            );
        }
    }
    lines.push( '--'+result.boundry+'--' );
    result.body = lines.join('');
    result.length = result.body.length;
    result.type = 'multipart/form-data; boundary='+result.boundry;
    return result;
  }
  
  if(options.form){
    if(typeof options.form == 'string') throw('form name unsupported');
    if(options.method === 'POST'){
        var encoding = (options.encoding || 'application/x-www-form-urlencoded').toLowerCase();
        options.headers['content-type'] = encoding;
        switch(encoding){
            case 'application/x-www-form-urlencoded':
                options.body = serialize(options.form).replace(/%20/g, "+");
                break;
            case 'multipart/form-data':
                var multi = multipart(options.form);
                //options.headers['content-length'] = multi.length;
                options.body = multi.body;
                options.headers['content-type'] = multi.type;
                break;
            default : throw new Error('unsupported encoding:'+encoding);
        }
    }
  }
  //END FORM Hack

  // If onResponse is boolean true, call back immediately when the response is known,
  // not when the full request is complete.
  options.onResponse = options.onResponse || noop
  if(options.onResponse === true) {
    options.onResponse = callback
    options.callback = noop
  }

  // XXX Browsers do not like this.
  //if(options.body)
  //  options.headers['content-length'] = options.body.length;

  // HTTP basic authentication
  if(!options.headers.authorization && options.auth)
    options.headers.authorization = 'Basic ' + b64_enc(options.auth.username + ':' + options.auth.password);

  return run_xhr(options)
}

var req_seq = 0
function run_xhr(options) {
  var xhr = new XHR
    , timed_out = false
    , is_cors = is_crossDomain(options.uri)
    , supports_cors = ('withCredentials' in xhr)

  req_seq += 1
  xhr.seq_id = req_seq
  xhr.id = req_seq + ': ' + options.method + ' ' + options.uri
  xhr._id = xhr.id // I know I will type "_id" from habit all the time.

  if(is_cors && !supports_cors) {
    var cors_err = new Error('Browser does not support cross-origin request: ' + options.uri)
    cors_err.cors = 'unsupported'
    return options.callback(cors_err, xhr)
  }

  xhr.timeoutTimer = setTimeout(too_late, options.timeout)
  function too_late() {
    timed_out = true
    var er = new Error('ETIMEDOUT')
    er.code = 'ETIMEDOUT'
    er.duration = options.timeout

    request.log.error('Timeout', { 'id':xhr._id, 'milliseconds':options.timeout })
    return options.callback(er, xhr)
  }

  // Some states can be skipped over, so remember what is still incomplete.
  var did = {'response':false, 'loading':false, 'end':false}

  xhr.onreadystatechange = on_state_change
  xhr.open(options.method, options.uri, true) // asynchronous
  if(is_cors)
    xhr.withCredentials = !! options.withCredentials
  xhr.send(options.body)
  return xhr

  function on_state_change(event) {
    if(timed_out)
      return request.log.debug('Ignoring timed out state change', {'state':xhr.readyState, 'id':xhr.id})

    request.log.debug('State change', {'state':xhr.readyState, 'id':xhr.id, 'timed_out':timed_out})

    if(xhr.readyState === XHR.OPENED) {
      request.log.debug('Request started', {'id':xhr.id})
      for (var key in options.headers)
        xhr.setRequestHeader(key, options.headers[key])
    }

    else if(xhr.readyState === XHR.HEADERS_RECEIVED)
      on_response()

    else if(xhr.readyState === XHR.LOADING) {
      on_response()
      on_loading()
    }

    else if(xhr.readyState === XHR.DONE) {
      on_response()
      on_loading()
      on_end()
    }
  }

  function on_response() {
    if(did.response)
      return

    did.response = true
    request.log.debug('Got response', {'id':xhr.id, 'status':xhr.status})
    clearTimeout(xhr.timeoutTimer)
    xhr.statusCode = xhr.status // Node request compatibility

    // Detect failed CORS requests.
    if(is_cors && xhr.statusCode == 0) {
      var cors_err = new Error('CORS request rejected: ' + options.uri)
      cors_err.cors = 'rejected'

      // Do not process this request further.
      did.loading = true
      did.end = true

      return options.callback(cors_err, xhr)
    }

    options.onResponse(null, xhr)
  }

  function on_loading() {
    if(did.loading)
      return

    did.loading = true
    request.log.debug('Response body loading', {'id':xhr.id})
    // TODO: Maybe simulate "data" events by watching xhr.responseText
  }

  function on_end() {
    if(did.end)
      return

    did.end = true
    request.log.debug('Request done', {'id':xhr.id})

    xhr.body = xhr.responseText
    if(options.json) {
      try        { xhr.body = JSON.parse(xhr.responseText) }
      catch (er) { return options.callback(er, xhr)        }
    }

    options.callback(null, xhr, xhr.body)
  }

} // request

request.withCredentials = false;
request.DEFAULT_TIMEOUT = DEFAULT_TIMEOUT;

//
// defaults
//

request.defaults = function(options, requester) {
  var def = function (method) {
    var d = function (params, callback) {
      if(typeof params === 'string')
        params = {'uri': params};
      else {
        params = JSON.parse(JSON.stringify(params));
      }
      for (var i in options) {
        if (params[i] === undefined) params[i] = options[i]
      }
      return method(params, callback)
    }
    return d
  }
  var de = def(request)
  de.get = def(request.get)
  de.post = def(request.post)
  de.put = def(request.put)
  de.head = def(request.head)
  return de
}

//
// HTTP method shortcuts
//

var shortcuts = [ 'get', 'put', 'post', 'head' ];
shortcuts.forEach(function(shortcut) {
  var method = shortcut.toUpperCase();
  var func   = shortcut.toLowerCase();

  request[func] = function(opts) {
    if(typeof opts === 'string')
      opts = {'method':method, 'uri':opts};
    else {
      opts = JSON.parse(JSON.stringify(opts));
      opts.method = method;
    }

    var args = [opts].concat(Array.prototype.slice.apply(arguments, [1]));
    return request.apply(this, args);
  }
})

//
// CouchDB shortcut
//

request.couch = function(options, callback) {
  if(typeof options === 'string')
    options = {'uri':options}

  // Just use the request API to do JSON.
  options.json = true
  if(options.body)
    options.json = options.body
  delete options.body

  callback = callback || noop

  var xhr = request(options, couch_handler)
  return xhr

  function couch_handler(er, resp, body) {
    if(er)
      return callback(er, resp, body)

    if((resp.statusCode < 200 || resp.statusCode > 299) && body.error) {
      // The body is a Couch JSON object indicating the error.
      er = new Error('CouchDB error: ' + (body.error.reason || body.error.error))
      for (var key in body)
        er[key] = body[key]
      return callback(er, resp, body);
    }

    return callback(er, resp, body);
  }
}

//
// Utility
//

function noop() {}

function getLogger() {
  var logger = {}
    , levels = ['trace', 'debug', 'info', 'warn', 'error']
    , level, i

  for(i = 0; i < levels.length; i++) {
    level = levels[i]

    logger[level] = noop
    if(typeof console !== 'undefined' && console && console[level])
      logger[level] = formatted(console, level)
  }

  return logger
}

function formatted(obj, method) {
  return formatted_logger

  function formatted_logger(str, context) {
    if(typeof context === 'object')
      str += ' ' + JSON.stringify(context)

    return obj[method].call(obj, str)
  }
}

// Return whether a URL is a cross-domain request.
function is_crossDomain(url) {
  var rurl = /^([\w\+\.\-]+:)(?:\/\/([^\/?#:]*)(?::(\d+))?)?/

  // jQuery #8138, IE may throw an exception when accessing
  // a field from window.location if document.domain has been set
  var ajaxLocation
  try { ajaxLocation = location.href }
  catch (e) {
    // Use the href attribute of an A element since IE will modify it given document.location
    ajaxLocation = document.createElement( "a" );
    ajaxLocation.href = "";
    ajaxLocation = ajaxLocation.href;
  }

  var ajaxLocParts = rurl.exec(ajaxLocation.toLowerCase()) || []
    , parts = rurl.exec(url.toLowerCase() )

  var result = !!(
    parts &&
    (  parts[1] != ajaxLocParts[1]
    || parts[2] != ajaxLocParts[2]
    || (parts[3] || (parts[1] === "http:" ? 80 : 443)) != (ajaxLocParts[3] || (ajaxLocParts[1] === "http:" ? 80 : 443))
    )
  )

  //console.debug('is_crossDomain('+url+') -> ' + result)
  return result
}

// MIT License from http://phpjs.org/functions/base64_encode:358
function b64_enc (data) {
    // Encodes string using MIME base64 algorithm
    var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var o1, o2, o3, h1, h2, h3, h4, bits, i = 0, ac = 0, enc="", tmp_arr = [];

    if (!data) {
        return data;
    }

    // assume utf8 data
    // data = this.utf8_encode(data+'');

    do { // pack three octets into four hexets
        o1 = data.charCodeAt(i++);
        o2 = data.charCodeAt(i++);
        o3 = data.charCodeAt(i++);

        bits = o1<<16 | o2<<8 | o3;

        h1 = bits>>18 & 0x3f;
        h2 = bits>>12 & 0x3f;
        h3 = bits>>6 & 0x3f;
        h4 = bits & 0x3f;

        // use hexets to index into b64, and append result to encoded string
        tmp_arr[ac++] = b64.charAt(h1) + b64.charAt(h2) + b64.charAt(h3) + b64.charAt(h4);
    } while (i < data.length);

    enc = tmp_arr.join('');

    switch (data.length % 3) {
        case 1:
            enc = enc.slice(0, -2) + '==';
        break;
        case 2:
            enc = enc.slice(0, -1) + '=';
        break;
    }

    return enc;
}
module.exports = request;

},{}],9:[function(_dereq_,module,exports){
// http://wiki.commonjs.org/wiki/Unit_Testing/1.0
//
// THIS IS NOT TESTED NOR LIKELY TO WORK OUTSIDE V8!
//
// Originally from narwhal.js (http://narwhaljs.org)
// Copyright (c) 2009 Thomas Robinson <280north.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// when used in node, this will actually load the util module we depend on
// versus loading the builtin util module as happens otherwise
// this is a bug in node module loading as far as I am concerned
var util = _dereq_('util/');

var pSlice = Array.prototype.slice;
var hasOwn = Object.prototype.hasOwnProperty;

// 1. The assert module provides functions that throw
// AssertionError's when particular conditions are not met. The
// assert module must conform to the following interface.

var assert = module.exports = ok;

// 2. The AssertionError is defined in assert.
// new assert.AssertionError({ message: message,
//                             actual: actual,
//                             expected: expected })

assert.AssertionError = function AssertionError(options) {
  this.name = 'AssertionError';
  this.actual = options.actual;
  this.expected = options.expected;
  this.operator = options.operator;
  if (options.message) {
    this.message = options.message;
    this.generatedMessage = false;
  } else {
    this.message = getMessage(this);
    this.generatedMessage = true;
  }
  var stackStartFunction = options.stackStartFunction || fail;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, stackStartFunction);
  }
  else {
    // non v8 browsers so we can have a stacktrace
    var err = new Error();
    if (err.stack) {
      var out = err.stack;

      // try to strip useless frames
      var fn_name = stackStartFunction.name;
      var idx = out.indexOf('\n' + fn_name);
      if (idx >= 0) {
        // once we have located the function frame
        // we need to strip out everything before it (and its line)
        var next_line = out.indexOf('\n', idx + 1);
        out = out.substring(next_line + 1);
      }

      this.stack = out;
    }
  }
};

// assert.AssertionError instanceof Error
util.inherits(assert.AssertionError, Error);

function replacer(key, value) {
  if (util.isUndefined(value)) {
    return '' + value;
  }
  if (util.isNumber(value) && (isNaN(value) || !isFinite(value))) {
    return value.toString();
  }
  if (util.isFunction(value) || util.isRegExp(value)) {
    return value.toString();
  }
  return value;
}

function truncate(s, n) {
  if (util.isString(s)) {
    return s.length < n ? s : s.slice(0, n);
  } else {
    return s;
  }
}

function getMessage(self) {
  return truncate(JSON.stringify(self.actual, replacer), 128) + ' ' +
         self.operator + ' ' +
         truncate(JSON.stringify(self.expected, replacer), 128);
}

// At present only the three keys mentioned above are used and
// understood by the spec. Implementations or sub modules can pass
// other keys to the AssertionError's constructor - they will be
// ignored.

// 3. All of the following functions must throw an AssertionError
// when a corresponding condition is not met, with a message that
// may be undefined if not provided.  All assertion methods provide
// both the actual and expected values to the assertion error for
// display purposes.

function fail(actual, expected, message, operator, stackStartFunction) {
  throw new assert.AssertionError({
    message: message,
    actual: actual,
    expected: expected,
    operator: operator,
    stackStartFunction: stackStartFunction
  });
}

// EXTENSION! allows for well behaved errors defined elsewhere.
assert.fail = fail;

// 4. Pure assertion tests whether a value is truthy, as determined
// by !!guard.
// assert.ok(guard, message_opt);
// This statement is equivalent to assert.equal(true, !!guard,
// message_opt);. To test strictly for the value true, use
// assert.strictEqual(true, guard, message_opt);.

function ok(value, message) {
  if (!value) fail(value, true, message, '==', assert.ok);
}
assert.ok = ok;

// 5. The equality assertion tests shallow, coercive equality with
// ==.
// assert.equal(actual, expected, message_opt);

assert.equal = function equal(actual, expected, message) {
  if (actual != expected) fail(actual, expected, message, '==', assert.equal);
};

// 6. The non-equality assertion tests for whether two objects are not equal
// with != assert.notEqual(actual, expected, message_opt);

assert.notEqual = function notEqual(actual, expected, message) {
  if (actual == expected) {
    fail(actual, expected, message, '!=', assert.notEqual);
  }
};

// 7. The equivalence assertion tests a deep equality relation.
// assert.deepEqual(actual, expected, message_opt);

assert.deepEqual = function deepEqual(actual, expected, message) {
  if (!_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'deepEqual', assert.deepEqual);
  }
};

function _deepEqual(actual, expected) {
  // 7.1. All identical values are equivalent, as determined by ===.
  if (actual === expected) {
    return true;

  } else if (util.isBuffer(actual) && util.isBuffer(expected)) {
    if (actual.length != expected.length) return false;

    for (var i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) return false;
    }

    return true;

  // 7.2. If the expected value is a Date object, the actual value is
  // equivalent if it is also a Date object that refers to the same time.
  } else if (util.isDate(actual) && util.isDate(expected)) {
    return actual.getTime() === expected.getTime();

  // 7.3 If the expected value is a RegExp object, the actual value is
  // equivalent if it is also a RegExp object with the same source and
  // properties (`global`, `multiline`, `lastIndex`, `ignoreCase`).
  } else if (util.isRegExp(actual) && util.isRegExp(expected)) {
    return actual.source === expected.source &&
           actual.global === expected.global &&
           actual.multiline === expected.multiline &&
           actual.lastIndex === expected.lastIndex &&
           actual.ignoreCase === expected.ignoreCase;

  // 7.4. Other pairs that do not both pass typeof value == 'object',
  // equivalence is determined by ==.
  } else if (!util.isObject(actual) && !util.isObject(expected)) {
    return actual == expected;

  // 7.5 For all other Object pairs, including Array objects, equivalence is
  // determined by having the same number of owned properties (as verified
  // with Object.prototype.hasOwnProperty.call), the same set of keys
  // (although not necessarily the same order), equivalent values for every
  // corresponding key, and an identical 'prototype' property. Note: this
  // accounts for both named and indexed properties on Arrays.
  } else {
    return objEquiv(actual, expected);
  }
}

function isArguments(object) {
  return Object.prototype.toString.call(object) == '[object Arguments]';
}

function objEquiv(a, b) {
  if (util.isNullOrUndefined(a) || util.isNullOrUndefined(b))
    return false;
  // an identical 'prototype' property.
  if (a.prototype !== b.prototype) return false;
  //~~~I've managed to break Object.keys through screwy arguments passing.
  //   Converting to array solves the problem.
  if (isArguments(a)) {
    if (!isArguments(b)) {
      return false;
    }
    a = pSlice.call(a);
    b = pSlice.call(b);
    return _deepEqual(a, b);
  }
  try {
    var ka = objectKeys(a),
        kb = objectKeys(b),
        key, i;
  } catch (e) {//happens when one is a string literal and the other isn't
    return false;
  }
  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length != kb.length)
    return false;
  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();
  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] != kb[i])
      return false;
  }
  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!_deepEqual(a[key], b[key])) return false;
  }
  return true;
}

// 8. The non-equivalence assertion tests for any deep inequality.
// assert.notDeepEqual(actual, expected, message_opt);

assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
  if (_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'notDeepEqual', assert.notDeepEqual);
  }
};

// 9. The strict equality assertion tests strict equality, as determined by ===.
// assert.strictEqual(actual, expected, message_opt);

assert.strictEqual = function strictEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(actual, expected, message, '===', assert.strictEqual);
  }
};

// 10. The strict non-equality assertion tests for strict inequality, as
// determined by !==.  assert.notStrictEqual(actual, expected, message_opt);

assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (actual === expected) {
    fail(actual, expected, message, '!==', assert.notStrictEqual);
  }
};

function expectedException(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  if (Object.prototype.toString.call(expected) == '[object RegExp]') {
    return expected.test(actual);
  } else if (actual instanceof expected) {
    return true;
  } else if (expected.call({}, actual) === true) {
    return true;
  }

  return false;
}

function _throws(shouldThrow, block, expected, message) {
  var actual;

  if (util.isString(expected)) {
    message = expected;
    expected = null;
  }

  try {
    block();
  } catch (e) {
    actual = e;
  }

  message = (expected && expected.name ? ' (' + expected.name + ').' : '.') +
            (message ? ' ' + message : '.');

  if (shouldThrow && !actual) {
    fail(actual, expected, 'Missing expected exception' + message);
  }

  if (!shouldThrow && expectedException(actual, expected)) {
    fail(actual, expected, 'Got unwanted exception' + message);
  }

  if ((shouldThrow && actual && expected &&
      !expectedException(actual, expected)) || (!shouldThrow && actual)) {
    throw actual;
  }
}

// 11. Expected to throw an error:
// assert.throws(block, Error_opt, message_opt);

assert.throws = function(block, /*optional*/error, /*optional*/message) {
  _throws.apply(this, [true].concat(pSlice.call(arguments)));
};

// EXTENSION! This is annoying to write outside this module.
assert.doesNotThrow = function(block, /*optional*/message) {
  _throws.apply(this, [false].concat(pSlice.call(arguments)));
};

assert.ifError = function(err) { if (err) {throw err;}};

var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    if (hasOwn.call(obj, key)) keys.push(key);
  }
  return keys;
};

},{"util/":11}],10:[function(_dereq_,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],11:[function(_dereq_,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = _dereq_('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = _dereq_('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,_dereq_("/Users/jpochyla/Projects/trezor.js/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":10,"/Users/jpochyla/Projects/trezor.js/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js":24,"inherits":23}],12:[function(_dereq_,module,exports){
/**
 * The buffer module from node.js, for the browser.
 *
 * Author:   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * License:  MIT
 *
 * `npm install buffer`
 */

var base64 = _dereq_('base64-js')
var ieee754 = _dereq_('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192

/**
 * If `Buffer._useTypedArrays`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (compatible down to IE6)
 */
Buffer._useTypedArrays = (function () {
   // Detect if browser supports Typed Arrays. Supported browsers are IE 10+,
   // Firefox 4+, Chrome 7+, Safari 5.1+, Opera 11.6+, iOS 4.2+.
  if (typeof Uint8Array === 'undefined' || typeof ArrayBuffer === 'undefined')
    return false

  // Does the browser support adding properties to `Uint8Array` instances? If
  // not, then that's the same as no `Uint8Array` support. We need to be able to
  // add all the node Buffer API methods.
  // Relevant Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=695438
  try {
    var arr = new Uint8Array(0)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() &&
        typeof arr.subarray === 'function' // Chrome 9-10 lack `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Workaround: node's base64 implementation allows for non-padded strings
  // while base64-js does not.
  if (encoding === 'base64' && type === 'string') {
    subject = stringtrim(subject)
    while (subject.length % 4 !== 0) {
      subject = subject + '='
    }
  }

  // Find the length
  var length
  if (type === 'number')
    length = coerce(subject)
  else if (type === 'string')
    length = Buffer.byteLength(subject, encoding)
  else if (type === 'object')
    length = coerce(subject.length) // Assume object is an array
  else
    throw new Error('First argument needs to be a number, array or string.')

  var buf
  if (Buffer._useTypedArrays) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer._useTypedArrays && typeof Uint8Array === 'function' &&
      subject instanceof Uint8Array) {
    // Speed optimization -- use set if we're copying from a Uint8Array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    for (i = 0; i < length; i++) {
      if (Buffer.isBuffer(subject))
        buf[i] = subject.readUInt8(i)
      else
        buf[i] = subject[i]
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer._useTypedArrays && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

// STATIC METHODS
// ==============

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.isBuffer = function (b) {
  return !!(b !== null && b !== undefined && b._isBuffer)
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'hex':
      ret = str.length / 2
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.concat = function (list, totalLength) {
  assert(isArray(list), 'Usage: Buffer.concat(list, [totalLength])\n' +
      'list should be an Array.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (typeof totalLength !== 'number') {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

// BUFFER INSTANCE METHODS
// =======================

function _hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  assert(strLen % 2 === 0, 'Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    assert(!isNaN(byte), 'Invalid hex string')
    buf[offset + i] = byte
  }
  Buffer._charsWritten = i * 2
  return i
}

function _utf8Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf8ToBytes(string), buf, offset, length)
  return charsWritten
}

function _asciiWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function _binaryWrite (buf, string, offset, length) {
  return _asciiWrite(buf, string, offset, length)
}

function _base64Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function _utf16leWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf16leToBytes(string), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = _asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = _binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = _base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leWrite(this, string, offset, length)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toString = function (encoding, start, end) {
  var self = this

  encoding = String(encoding || 'utf8').toLowerCase()
  start = Number(start) || 0
  end = (end !== undefined)
    ? Number(end)
    : end = self.length

  // Fastpath empty strings
  if (end === start)
    return ''

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexSlice(self, start, end)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Slice(self, start, end)
      break
    case 'ascii':
      ret = _asciiSlice(self, start, end)
      break
    case 'binary':
      ret = _binarySlice(self, start, end)
      break
    case 'base64':
      ret = _base64Slice(self, start, end)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leSlice(self, start, end)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  assert(end >= start, 'sourceEnd < sourceStart')
  assert(target_start >= 0 && target_start < target.length,
      'targetStart out of bounds')
  assert(start >= 0 && start < source.length, 'sourceStart out of bounds')
  assert(end >= 0 && end <= source.length, 'sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  // copy!
  for (var i = 0; i < end - start; i++)
    target[i + target_start] = this[i + start]
}

function _base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function _utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function _asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++)
    ret += String.fromCharCode(buf[i])
  return ret
}

function _binarySlice (buf, start, end) {
  return _asciiSlice(buf, start, end)
}

function _hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function _utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i+1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = clamp(start, len, 0)
  end = clamp(end, len, len)

  if (Buffer._useTypedArrays) {
    return augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  return this[offset]
}

function _readUInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    val = buf[offset]
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
  } else {
    val = buf[offset] << 8
    if (offset + 1 < len)
      val |= buf[offset + 1]
  }
  return val
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  return _readUInt16(this, offset, true, noAssert)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  return _readUInt16(this, offset, false, noAssert)
}

function _readUInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    if (offset + 2 < len)
      val = buf[offset + 2] << 16
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
    val |= buf[offset]
    if (offset + 3 < len)
      val = val + (buf[offset + 3] << 24 >>> 0)
  } else {
    if (offset + 1 < len)
      val = buf[offset + 1] << 16
    if (offset + 2 < len)
      val |= buf[offset + 2] << 8
    if (offset + 3 < len)
      val |= buf[offset + 3]
    val = val + (buf[offset] << 24 >>> 0)
  }
  return val
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  return _readUInt32(this, offset, true, noAssert)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  return _readUInt32(this, offset, false, noAssert)
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null,
        'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  var neg = this[offset] & 0x80
  if (neg)
    return (0xff - this[offset] + 1) * -1
  else
    return this[offset]
}

function _readInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt16(buf, offset, littleEndian, true)
  var neg = val & 0x8000
  if (neg)
    return (0xffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  return _readInt16(this, offset, true, noAssert)
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  return _readInt16(this, offset, false, noAssert)
}

function _readInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt32(buf, offset, littleEndian, true)
  var neg = val & 0x80000000
  if (neg)
    return (0xffffffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  return _readInt32(this, offset, true, noAssert)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  return _readInt32(this, offset, false, noAssert)
}

function _readFloat (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 23, 4)
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  return _readFloat(this, offset, true, noAssert)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  return _readFloat(this, offset, false, noAssert)
}

function _readDouble (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 7 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 52, 8)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  return _readDouble(this, offset, true, noAssert)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  return _readDouble(this, offset, false, noAssert)
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'trying to write beyond buffer length')
    verifuint(value, 0xff)
  }

  if (offset >= this.length) return

  this[offset] = value
}

function _writeUInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 2); i < j; i++) {
    buf[offset + i] =
        (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
            (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, false, noAssert)
}

function _writeUInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffffffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 4); i < j; i++) {
    buf[offset + i] =
        (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, false, noAssert)
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7f, -0x80)
  }

  if (offset >= this.length)
    return

  if (value >= 0)
    this.writeUInt8(value, offset, noAssert)
  else
    this.writeUInt8(0xff + value + 1, offset, noAssert)
}

function _writeInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fff, -0x8000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt16(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt16(buf, 0xffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, false, noAssert)
}

function _writeInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fffffff, -0x80000000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt32(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt32(buf, 0xffffffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, false, noAssert)
}

function _writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifIEEE754(value, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 23, 4)
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, false, noAssert)
}

function _writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 7 < buf.length,
        'Trying to write beyond buffer length')
    verifIEEE754(value, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 52, 8)
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, false, noAssert)
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (typeof value === 'string') {
    value = value.charCodeAt(0)
  }

  assert(typeof value === 'number' && !isNaN(value), 'value is not a number')
  assert(end >= start, 'end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  assert(start >= 0 && start < this.length, 'start out of bounds')
  assert(end >= 0 && end <= this.length, 'end out of bounds')

  for (var i = start; i < end; i++) {
    this[i] = value
  }
}

Buffer.prototype.inspect = function () {
  var out = []
  var len = this.length
  for (var i = 0; i < len; i++) {
    out[i] = toHex(this[i])
    if (i === exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...'
      break
    }
  }
  return '<Buffer ' + out.join(' ') + '>'
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array === 'function') {
    if (Buffer._useTypedArrays) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1)
        buf[i] = this[i]
      return buf.buffer
    }
  } else {
    throw new Error('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

var BP = Buffer.prototype

/**
 * Augment the Uint8Array *instance* (not the class!) with Buffer methods
 */
function augment (arr) {
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

// slice(start, end)
function clamp (index, len, defaultValue) {
  if (typeof index !== 'number') return defaultValue
  index = ~~index;  // Coerce to integer.
  if (index >= len) return len
  if (index >= 0) return index
  index += len
  if (index >= 0) return index
  return 0
}

function coerce (length) {
  // Coerce length to a number (possibly NaN), round up
  // in case it's fractional (e.g. 123.456) then do a
  // double negate to coerce a NaN to 0. Easy, right?
  length = ~~Math.ceil(+length)
  return length < 0 ? 0 : length
}

function isArray (subject) {
  return (Array.isArray || function (subject) {
    return Object.prototype.toString.call(subject) === '[object Array]'
  })(subject)
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    var b = str.charCodeAt(i)
    if (b <= 0x7F)
      byteArray.push(str.charCodeAt(i))
    else {
      var start = i
      if (b >= 0xD800 && b <= 0xDFFF) i++
      var h = encodeURIComponent(str.slice(start, i+1)).substr(1).split('%')
      for (var j = 0; j < h.length; j++)
        byteArray.push(parseInt(h[j], 16))
    }
  }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length) {
  var pos
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

/*
 * We have to make sure that the value is a valid integer. This means that it
 * is non-negative. It has no fractional component and that it does not
 * exceed the maximum allowed value.
 */
function verifuint (value, max) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value >= 0,
      'specified a negative value for writing an unsigned value')
  assert(value <= max, 'value is larger than maximum value for type')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifsint (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifIEEE754 (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
}

function assert (test, message) {
  if (!test) throw new Error(message || 'Failed assertion')
}

},{"base64-js":13,"ieee754":14}],13:[function(_dereq_,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var ZERO   = '0'.charCodeAt(0)
	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS)
			return 62 // '+'
		if (code === SLASH)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	module.exports.toByteArray = b64ToByteArray
	module.exports.fromByteArray = uint8ToBase64
}())

},{}],14:[function(_dereq_,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],15:[function(_dereq_,module,exports){
(function (global){
/*global window, global*/
var util = _dereq_("util")
var assert = _dereq_("assert")

var slice = Array.prototype.slice
var console
var times = {}

if (typeof global !== "undefined" && global.console) {
    console = global.console
} else if (typeof window !== "undefined" && window.console) {
    console = window.console
} else {
    console = {}
}

var functions = [
    [log, "log"]
    , [info, "info"]
    , [warn, "warn"]
    , [error, "error"]
    , [time, "time"]
    , [timeEnd, "timeEnd"]
    , [trace, "trace"]
    , [dir, "dir"]
    , [assert, "assert"]
]

for (var i = 0; i < functions.length; i++) {
    var tuple = functions[i]
    var f = tuple[0]
    var name = tuple[1]

    if (!console[name]) {
        console[name] = f
    }
}

module.exports = console

function log() {}

function info() {
    console.log.apply(console, arguments)
}

function warn() {
    console.log.apply(console, arguments)
}

function error() {
    console.warn.apply(console, arguments)
}

function time(label) {
    times[label] = Date.now()
}

function timeEnd(label) {
    var time = times[label]
    if (!time) {
        throw new Error("No such label: " + label)
    }

    var duration = Date.now() - time
    console.log(label + ": " + duration + "ms")
}

function trace() {
    var err = new Error()
    err.name = "Trace"
    err.message = util.format.apply(null, arguments)
    console.error(err.stack)
}

function dir(object) {
    console.log(util.inspect(object) + "\n")
}

function assert(expression) {
    if (!expression) {
        var arr = slice.call(arguments, 1)
        assert.ok(false, util.format.apply(null, arr))
    }
}

}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"assert":9,"util":26}],16:[function(_dereq_,module,exports){
var Buffer = _dereq_('buffer').Buffer;
var intSize = 4;
var zeroBuffer = new Buffer(intSize); zeroBuffer.fill(0);
var chrsz = 8;

function toArray(buf, bigEndian) {
  if ((buf.length % intSize) !== 0) {
    var len = buf.length + (intSize - (buf.length % intSize));
    buf = Buffer.concat([buf, zeroBuffer], len);
  }

  var arr = [];
  var fn = bigEndian ? buf.readInt32BE : buf.readInt32LE;
  for (var i = 0; i < buf.length; i += intSize) {
    arr.push(fn.call(buf, i));
  }
  return arr;
}

function toBuffer(arr, size, bigEndian) {
  var buf = new Buffer(size);
  var fn = bigEndian ? buf.writeInt32BE : buf.writeInt32LE;
  for (var i = 0; i < arr.length; i++) {
    fn.call(buf, arr[i], i * 4, true);
  }
  return buf;
}

function hash(buf, fn, hashSize, bigEndian) {
  if (!Buffer.isBuffer(buf)) buf = new Buffer(buf);
  var arr = fn(toArray(buf, bigEndian), buf.length * chrsz);
  return toBuffer(arr, hashSize, bigEndian);
}

module.exports = { hash: hash };

},{"buffer":12}],17:[function(_dereq_,module,exports){
var Buffer = _dereq_('buffer').Buffer
var sha = _dereq_('./sha')
var sha256 = _dereq_('./sha256')
var rng = _dereq_('./rng')
var md5 = _dereq_('./md5')

var algorithms = {
  sha1: sha,
  sha256: sha256,
  md5: md5
}

var blocksize = 64
var zeroBuffer = new Buffer(blocksize); zeroBuffer.fill(0)
function hmac(fn, key, data) {
  if(!Buffer.isBuffer(key)) key = new Buffer(key)
  if(!Buffer.isBuffer(data)) data = new Buffer(data)

  if(key.length > blocksize) {
    key = fn(key)
  } else if(key.length < blocksize) {
    key = Buffer.concat([key, zeroBuffer], blocksize)
  }

  var ipad = new Buffer(blocksize), opad = new Buffer(blocksize)
  for(var i = 0; i < blocksize; i++) {
    ipad[i] = key[i] ^ 0x36
    opad[i] = key[i] ^ 0x5C
  }

  var hash = fn(Buffer.concat([ipad, data]))
  return fn(Buffer.concat([opad, hash]))
}

function hash(alg, key) {
  alg = alg || 'sha1'
  var fn = algorithms[alg]
  var bufs = []
  var length = 0
  if(!fn) error('algorithm:', alg, 'is not yet supported')
  return {
    update: function (data) {
      if(!Buffer.isBuffer(data)) data = new Buffer(data)
        
      bufs.push(data)
      length += data.length
      return this
    },
    digest: function (enc) {
      var buf = Buffer.concat(bufs)
      var r = key ? hmac(fn, key, buf) : fn(buf)
      bufs = null
      return enc ? r.toString(enc) : r
    }
  }
}

function error () {
  var m = [].slice.call(arguments).join(' ')
  throw new Error([
    m,
    'we accept pull requests',
    'http://github.com/dominictarr/crypto-browserify'
    ].join('\n'))
}

exports.createHash = function (alg) { return hash(alg) }
exports.createHmac = function (alg, key) { return hash(alg, key) }
exports.randomBytes = function(size, callback) {
  if (callback && callback.call) {
    try {
      callback.call(this, undefined, new Buffer(rng(size)))
    } catch (err) { callback(err) }
  } else {
    return new Buffer(rng(size))
  }
}

function each(a, f) {
  for(var i in a)
    f(a[i], i)
}

// the least I can do is make error messages for the rest of the node.js/crypto api.
each(['createCredentials'
, 'createCipher'
, 'createCipheriv'
, 'createDecipher'
, 'createDecipheriv'
, 'createSign'
, 'createVerify'
, 'createDiffieHellman'
, 'pbkdf2'], function (name) {
  exports[name] = function () {
    error('sorry,', name, 'is not implemented yet')
  }
})

},{"./md5":18,"./rng":19,"./sha":20,"./sha256":21,"buffer":12}],18:[function(_dereq_,module,exports){
/*
 * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
 * Digest Algorithm, as defined in RFC 1321.
 * Version 2.1 Copyright (C) Paul Johnston 1999 - 2002.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for more info.
 */

var helpers = _dereq_('./helpers');

/*
 * Perform a simple self-test to see if the VM is working
 */
function md5_vm_test()
{
  return hex_md5("abc") == "900150983cd24fb0d6963f7d28e17f72";
}

/*
 * Calculate the MD5 of an array of little-endian words, and a bit length
 */
function core_md5(x, len)
{
  /* append padding */
  x[len >> 5] |= 0x80 << ((len) % 32);
  x[(((len + 64) >>> 9) << 4) + 14] = len;

  var a =  1732584193;
  var b = -271733879;
  var c = -1732584194;
  var d =  271733878;

  for(var i = 0; i < x.length; i += 16)
  {
    var olda = a;
    var oldb = b;
    var oldc = c;
    var oldd = d;

    a = md5_ff(a, b, c, d, x[i+ 0], 7 , -680876936);
    d = md5_ff(d, a, b, c, x[i+ 1], 12, -389564586);
    c = md5_ff(c, d, a, b, x[i+ 2], 17,  606105819);
    b = md5_ff(b, c, d, a, x[i+ 3], 22, -1044525330);
    a = md5_ff(a, b, c, d, x[i+ 4], 7 , -176418897);
    d = md5_ff(d, a, b, c, x[i+ 5], 12,  1200080426);
    c = md5_ff(c, d, a, b, x[i+ 6], 17, -1473231341);
    b = md5_ff(b, c, d, a, x[i+ 7], 22, -45705983);
    a = md5_ff(a, b, c, d, x[i+ 8], 7 ,  1770035416);
    d = md5_ff(d, a, b, c, x[i+ 9], 12, -1958414417);
    c = md5_ff(c, d, a, b, x[i+10], 17, -42063);
    b = md5_ff(b, c, d, a, x[i+11], 22, -1990404162);
    a = md5_ff(a, b, c, d, x[i+12], 7 ,  1804603682);
    d = md5_ff(d, a, b, c, x[i+13], 12, -40341101);
    c = md5_ff(c, d, a, b, x[i+14], 17, -1502002290);
    b = md5_ff(b, c, d, a, x[i+15], 22,  1236535329);

    a = md5_gg(a, b, c, d, x[i+ 1], 5 , -165796510);
    d = md5_gg(d, a, b, c, x[i+ 6], 9 , -1069501632);
    c = md5_gg(c, d, a, b, x[i+11], 14,  643717713);
    b = md5_gg(b, c, d, a, x[i+ 0], 20, -373897302);
    a = md5_gg(a, b, c, d, x[i+ 5], 5 , -701558691);
    d = md5_gg(d, a, b, c, x[i+10], 9 ,  38016083);
    c = md5_gg(c, d, a, b, x[i+15], 14, -660478335);
    b = md5_gg(b, c, d, a, x[i+ 4], 20, -405537848);
    a = md5_gg(a, b, c, d, x[i+ 9], 5 ,  568446438);
    d = md5_gg(d, a, b, c, x[i+14], 9 , -1019803690);
    c = md5_gg(c, d, a, b, x[i+ 3], 14, -187363961);
    b = md5_gg(b, c, d, a, x[i+ 8], 20,  1163531501);
    a = md5_gg(a, b, c, d, x[i+13], 5 , -1444681467);
    d = md5_gg(d, a, b, c, x[i+ 2], 9 , -51403784);
    c = md5_gg(c, d, a, b, x[i+ 7], 14,  1735328473);
    b = md5_gg(b, c, d, a, x[i+12], 20, -1926607734);

    a = md5_hh(a, b, c, d, x[i+ 5], 4 , -378558);
    d = md5_hh(d, a, b, c, x[i+ 8], 11, -2022574463);
    c = md5_hh(c, d, a, b, x[i+11], 16,  1839030562);
    b = md5_hh(b, c, d, a, x[i+14], 23, -35309556);
    a = md5_hh(a, b, c, d, x[i+ 1], 4 , -1530992060);
    d = md5_hh(d, a, b, c, x[i+ 4], 11,  1272893353);
    c = md5_hh(c, d, a, b, x[i+ 7], 16, -155497632);
    b = md5_hh(b, c, d, a, x[i+10], 23, -1094730640);
    a = md5_hh(a, b, c, d, x[i+13], 4 ,  681279174);
    d = md5_hh(d, a, b, c, x[i+ 0], 11, -358537222);
    c = md5_hh(c, d, a, b, x[i+ 3], 16, -722521979);
    b = md5_hh(b, c, d, a, x[i+ 6], 23,  76029189);
    a = md5_hh(a, b, c, d, x[i+ 9], 4 , -640364487);
    d = md5_hh(d, a, b, c, x[i+12], 11, -421815835);
    c = md5_hh(c, d, a, b, x[i+15], 16,  530742520);
    b = md5_hh(b, c, d, a, x[i+ 2], 23, -995338651);

    a = md5_ii(a, b, c, d, x[i+ 0], 6 , -198630844);
    d = md5_ii(d, a, b, c, x[i+ 7], 10,  1126891415);
    c = md5_ii(c, d, a, b, x[i+14], 15, -1416354905);
    b = md5_ii(b, c, d, a, x[i+ 5], 21, -57434055);
    a = md5_ii(a, b, c, d, x[i+12], 6 ,  1700485571);
    d = md5_ii(d, a, b, c, x[i+ 3], 10, -1894986606);
    c = md5_ii(c, d, a, b, x[i+10], 15, -1051523);
    b = md5_ii(b, c, d, a, x[i+ 1], 21, -2054922799);
    a = md5_ii(a, b, c, d, x[i+ 8], 6 ,  1873313359);
    d = md5_ii(d, a, b, c, x[i+15], 10, -30611744);
    c = md5_ii(c, d, a, b, x[i+ 6], 15, -1560198380);
    b = md5_ii(b, c, d, a, x[i+13], 21,  1309151649);
    a = md5_ii(a, b, c, d, x[i+ 4], 6 , -145523070);
    d = md5_ii(d, a, b, c, x[i+11], 10, -1120210379);
    c = md5_ii(c, d, a, b, x[i+ 2], 15,  718787259);
    b = md5_ii(b, c, d, a, x[i+ 9], 21, -343485551);

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
  }
  return Array(a, b, c, d);

}

/*
 * These functions implement the four basic operations the algorithm uses.
 */
function md5_cmn(q, a, b, x, s, t)
{
  return safe_add(bit_rol(safe_add(safe_add(a, q), safe_add(x, t)), s),b);
}
function md5_ff(a, b, c, d, x, s, t)
{
  return md5_cmn((b & c) | ((~b) & d), a, b, x, s, t);
}
function md5_gg(a, b, c, d, x, s, t)
{
  return md5_cmn((b & d) | (c & (~d)), a, b, x, s, t);
}
function md5_hh(a, b, c, d, x, s, t)
{
  return md5_cmn(b ^ c ^ d, a, b, x, s, t);
}
function md5_ii(a, b, c, d, x, s, t)
{
  return md5_cmn(c ^ (b | (~d)), a, b, x, s, t);
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
function safe_add(x, y)
{
  var lsw = (x & 0xFFFF) + (y & 0xFFFF);
  var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function bit_rol(num, cnt)
{
  return (num << cnt) | (num >>> (32 - cnt));
}

module.exports = function md5(buf) {
  return helpers.hash(buf, core_md5, 16);
};

},{"./helpers":16}],19:[function(_dereq_,module,exports){
// Original code adapted from Robert Kieffer.
// details at https://github.com/broofa/node-uuid
(function() {
  var _global = this;

  var mathRNG, whatwgRNG;

  // NOTE: Math.random() does not guarantee "cryptographic quality"
  mathRNG = function(size) {
    var bytes = new Array(size);
    var r;

    for (var i = 0, r; i < size; i++) {
      if ((i & 0x03) == 0) r = Math.random() * 0x100000000;
      bytes[i] = r >>> ((i & 0x03) << 3) & 0xff;
    }

    return bytes;
  }

  if (_global.crypto && crypto.getRandomValues) {
    whatwgRNG = function(size) {
      var bytes = new Uint8Array(size);
      crypto.getRandomValues(bytes);
      return bytes;
    }
  }

  module.exports = whatwgRNG || mathRNG;

}())

},{}],20:[function(_dereq_,module,exports){
/*
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-1, as defined
 * in FIPS PUB 180-1
 * Version 2.1a Copyright Paul Johnston 2000 - 2002.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for details.
 */

var helpers = _dereq_('./helpers');

/*
 * Calculate the SHA-1 of an array of big-endian words, and a bit length
 */
function core_sha1(x, len)
{
  /* append padding */
  x[len >> 5] |= 0x80 << (24 - len % 32);
  x[((len + 64 >> 9) << 4) + 15] = len;

  var w = Array(80);
  var a =  1732584193;
  var b = -271733879;
  var c = -1732584194;
  var d =  271733878;
  var e = -1009589776;

  for(var i = 0; i < x.length; i += 16)
  {
    var olda = a;
    var oldb = b;
    var oldc = c;
    var oldd = d;
    var olde = e;

    for(var j = 0; j < 80; j++)
    {
      if(j < 16) w[j] = x[i + j];
      else w[j] = rol(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1);
      var t = safe_add(safe_add(rol(a, 5), sha1_ft(j, b, c, d)),
                       safe_add(safe_add(e, w[j]), sha1_kt(j)));
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = t;
    }

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
    e = safe_add(e, olde);
  }
  return Array(a, b, c, d, e);

}

/*
 * Perform the appropriate triplet combination function for the current
 * iteration
 */
function sha1_ft(t, b, c, d)
{
  if(t < 20) return (b & c) | ((~b) & d);
  if(t < 40) return b ^ c ^ d;
  if(t < 60) return (b & c) | (b & d) | (c & d);
  return b ^ c ^ d;
}

/*
 * Determine the appropriate additive constant for the current iteration
 */
function sha1_kt(t)
{
  return (t < 20) ?  1518500249 : (t < 40) ?  1859775393 :
         (t < 60) ? -1894007588 : -899497514;
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
function safe_add(x, y)
{
  var lsw = (x & 0xFFFF) + (y & 0xFFFF);
  var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function rol(num, cnt)
{
  return (num << cnt) | (num >>> (32 - cnt));
}

module.exports = function sha1(buf) {
  return helpers.hash(buf, core_sha1, 20, true);
};

},{"./helpers":16}],21:[function(_dereq_,module,exports){

/**
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-256, as defined
 * in FIPS 180-2
 * Version 2.2-beta Copyright Angel Marin, Paul Johnston 2000 - 2009.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 *
 */

var helpers = _dereq_('./helpers');

var safe_add = function(x, y) {
  var lsw = (x & 0xFFFF) + (y & 0xFFFF);
  var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
};

var S = function(X, n) {
  return (X >>> n) | (X << (32 - n));
};

var R = function(X, n) {
  return (X >>> n);
};

var Ch = function(x, y, z) {
  return ((x & y) ^ ((~x) & z));
};

var Maj = function(x, y, z) {
  return ((x & y) ^ (x & z) ^ (y & z));
};

var Sigma0256 = function(x) {
  return (S(x, 2) ^ S(x, 13) ^ S(x, 22));
};

var Sigma1256 = function(x) {
  return (S(x, 6) ^ S(x, 11) ^ S(x, 25));
};

var Gamma0256 = function(x) {
  return (S(x, 7) ^ S(x, 18) ^ R(x, 3));
};

var Gamma1256 = function(x) {
  return (S(x, 17) ^ S(x, 19) ^ R(x, 10));
};

var core_sha256 = function(m, l) {
  var K = new Array(0x428A2F98,0x71374491,0xB5C0FBCF,0xE9B5DBA5,0x3956C25B,0x59F111F1,0x923F82A4,0xAB1C5ED5,0xD807AA98,0x12835B01,0x243185BE,0x550C7DC3,0x72BE5D74,0x80DEB1FE,0x9BDC06A7,0xC19BF174,0xE49B69C1,0xEFBE4786,0xFC19DC6,0x240CA1CC,0x2DE92C6F,0x4A7484AA,0x5CB0A9DC,0x76F988DA,0x983E5152,0xA831C66D,0xB00327C8,0xBF597FC7,0xC6E00BF3,0xD5A79147,0x6CA6351,0x14292967,0x27B70A85,0x2E1B2138,0x4D2C6DFC,0x53380D13,0x650A7354,0x766A0ABB,0x81C2C92E,0x92722C85,0xA2BFE8A1,0xA81A664B,0xC24B8B70,0xC76C51A3,0xD192E819,0xD6990624,0xF40E3585,0x106AA070,0x19A4C116,0x1E376C08,0x2748774C,0x34B0BCB5,0x391C0CB3,0x4ED8AA4A,0x5B9CCA4F,0x682E6FF3,0x748F82EE,0x78A5636F,0x84C87814,0x8CC70208,0x90BEFFFA,0xA4506CEB,0xBEF9A3F7,0xC67178F2);
  var HASH = new Array(0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19);
    var W = new Array(64);
    var a, b, c, d, e, f, g, h, i, j;
    var T1, T2;
  /* append padding */
  m[l >> 5] |= 0x80 << (24 - l % 32);
  m[((l + 64 >> 9) << 4) + 15] = l;
  for (var i = 0; i < m.length; i += 16) {
    a = HASH[0]; b = HASH[1]; c = HASH[2]; d = HASH[3]; e = HASH[4]; f = HASH[5]; g = HASH[6]; h = HASH[7];
    for (var j = 0; j < 64; j++) {
      if (j < 16) {
        W[j] = m[j + i];
      } else {
        W[j] = safe_add(safe_add(safe_add(Gamma1256(W[j - 2]), W[j - 7]), Gamma0256(W[j - 15])), W[j - 16]);
      }
      T1 = safe_add(safe_add(safe_add(safe_add(h, Sigma1256(e)), Ch(e, f, g)), K[j]), W[j]);
      T2 = safe_add(Sigma0256(a), Maj(a, b, c));
      h = g; g = f; f = e; e = safe_add(d, T1); d = c; c = b; b = a; a = safe_add(T1, T2);
    }
    HASH[0] = safe_add(a, HASH[0]); HASH[1] = safe_add(b, HASH[1]); HASH[2] = safe_add(c, HASH[2]); HASH[3] = safe_add(d, HASH[3]);
    HASH[4] = safe_add(e, HASH[4]); HASH[5] = safe_add(f, HASH[5]); HASH[6] = safe_add(g, HASH[6]); HASH[7] = safe_add(h, HASH[7]);
  }
  return HASH;
};

module.exports = function sha256(buf) {
  return helpers.hash(buf, core_sha256, 32, true);
};

},{"./helpers":16}],22:[function(_dereq_,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        throw TypeError('Uncaught, unspecified "error" event.');
      }
      return false;
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      console.trace();
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],23:[function(_dereq_,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],24:[function(_dereq_,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],25:[function(_dereq_,module,exports){
module.exports=_dereq_(10)
},{}],26:[function(_dereq_,module,exports){
module.exports=_dereq_(11)
},{"./support/isBuffer":25,"/Users/jpochyla/Projects/trezor.js/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js":24,"inherits":23}],27:[function(_dereq_,module,exports){
var hasOwn = Object.prototype.hasOwnProperty;
var toString = Object.prototype.toString;
var undefined;

var isPlainObject = function isPlainObject(obj) {
	"use strict";
	if (!obj || toString.call(obj) !== '[object Object]' || obj.nodeType || obj.setInterval) {
		return false;
	}

	var has_own_constructor = hasOwn.call(obj, 'constructor');
	var has_is_property_of_method = obj.constructor && obj.constructor.prototype && hasOwn.call(obj.constructor.prototype, 'isPrototypeOf');
	// Not own constructor property must be Object
	if (obj.constructor && !has_own_constructor && !has_is_property_of_method) {
		return false;
	}

	// Own properties are enumerated firstly, so to speed up,
	// if last one is own, then all properties are own.
	var key;
	for (key in obj) {}

	return key === undefined || hasOwn.call(obj, key);
};

module.exports = function extend() {
	"use strict";
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[0],
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if (typeof target === "boolean") {
		deep = target;
		target = arguments[1] || {};
		// skip the boolean and the target
		i = 2;
	} else if (typeof target !== "object" && typeof target !== "function" || target == undefined) {
			target = {};
	}

	for (; i < length; ++i) {
		// Only deal with non-null/undefined values
		if ((options = arguments[i]) != null) {
			// Extend the base object
			for (name in options) {
				src = target[name];
				copy = options[name];

				// Prevent never-ending loop
				if (target === copy) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if (deep && copy && (isPlainObject(copy) || (copyIsArray = Array.isArray(copy)))) {
					if (copyIsArray) {
						copyIsArray = false;
						clone = src && Array.isArray(src) ? src : [];
					} else {
						clone = src && isPlainObject(src) ? src : {};
					}

					// Never move original objects, clone them
					target[name] = extend(deep, clone, copy);

				// Don't bring in undefined values
				} else if (copy !== undefined) {
					target[name] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};


},{}],28:[function(_dereq_,module,exports){
'use strict';

var asap = _dereq_('asap')

module.exports = Promise
function Promise(fn) {
  if (typeof this !== 'object') throw new TypeError('Promises must be constructed via new')
  if (typeof fn !== 'function') throw new TypeError('not a function')
  var state = null
  var value = null
  var deferreds = []
  var self = this

  this.then = function(onFulfilled, onRejected) {
    return new Promise(function(resolve, reject) {
      handle(new Handler(onFulfilled, onRejected, resolve, reject))
    })
  }

  function handle(deferred) {
    if (state === null) {
      deferreds.push(deferred)
      return
    }
    asap(function() {
      var cb = state ? deferred.onFulfilled : deferred.onRejected
      if (cb === null) {
        (state ? deferred.resolve : deferred.reject)(value)
        return
      }
      var ret
      try {
        ret = cb(value)
      }
      catch (e) {
        deferred.reject(e)
        return
      }
      deferred.resolve(ret)
    })
  }

  function resolve(newValue) {
    try { //Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
      if (newValue === self) throw new TypeError('A promise cannot be resolved with itself.')
      if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
        var then = newValue.then
        if (typeof then === 'function') {
          doResolve(then.bind(newValue), resolve, reject)
          return
        }
      }
      state = true
      value = newValue
      finale()
    } catch (e) { reject(e) }
  }

  function reject(newValue) {
    state = false
    value = newValue
    finale()
  }

  function finale() {
    for (var i = 0, len = deferreds.length; i < len; i++)
      handle(deferreds[i])
    deferreds = null
  }

  doResolve(fn, resolve, reject)
}


function Handler(onFulfilled, onRejected, resolve, reject){
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null
  this.onRejected = typeof onRejected === 'function' ? onRejected : null
  this.resolve = resolve
  this.reject = reject
}

/**
 * Take a potentially misbehaving resolver function and make sure
 * onFulfilled and onRejected are only called once.
 *
 * Makes no guarantees about asynchrony.
 */
function doResolve(fn, onFulfilled, onRejected) {
  var done = false;
  try {
    fn(function (value) {
      if (done) return
      done = true
      onFulfilled(value)
    }, function (reason) {
      if (done) return
      done = true
      onRejected(reason)
    })
  } catch (ex) {
    if (done) return
    done = true
    onRejected(ex)
  }
}

},{"asap":30}],29:[function(_dereq_,module,exports){
'use strict';

//This file contains then/promise specific extensions to the core promise API

var Promise = _dereq_('./core.js')
var asap = _dereq_('asap')

module.exports = Promise

/* Static Functions */

function ValuePromise(value) {
  this.then = function (onFulfilled) {
    if (typeof onFulfilled !== 'function') return this
    return new Promise(function (resolve, reject) {
      asap(function () {
        try {
          resolve(onFulfilled(value))
        } catch (ex) {
          reject(ex);
        }
      })
    })
  }
}
ValuePromise.prototype = Object.create(Promise.prototype)

var TRUE = new ValuePromise(true)
var FALSE = new ValuePromise(false)
var NULL = new ValuePromise(null)
var UNDEFINED = new ValuePromise(undefined)
var ZERO = new ValuePromise(0)
var EMPTYSTRING = new ValuePromise('')

Promise.resolve = function (value) {
  if (value instanceof Promise) return value

  if (value === null) return NULL
  if (value === undefined) return UNDEFINED
  if (value === true) return TRUE
  if (value === false) return FALSE
  if (value === 0) return ZERO
  if (value === '') return EMPTYSTRING

  if (typeof value === 'object' || typeof value === 'function') {
    try {
      var then = value.then
      if (typeof then === 'function') {
        return new Promise(then.bind(value))
      }
    } catch (ex) {
      return new Promise(function (resolve, reject) {
        reject(ex)
      })
    }
  }

  return new ValuePromise(value)
}

Promise.from = Promise.cast = function (value) {
  var err = new Error('Promise.from and Promise.cast are deprecated, use Promise.resolve instead')
  err.name = 'Warning'
  console.warn(err.stack)
  return Promise.resolve(value)
}

Promise.denodeify = function (fn, argumentCount) {
  argumentCount = argumentCount || Infinity
  return function () {
    var self = this
    var args = Array.prototype.slice.call(arguments)
    return new Promise(function (resolve, reject) {
      while (args.length && args.length > argumentCount) {
        args.pop()
      }
      args.push(function (err, res) {
        if (err) reject(err)
        else resolve(res)
      })
      fn.apply(self, args)
    })
  }
}
Promise.nodeify = function (fn) {
  return function () {
    var args = Array.prototype.slice.call(arguments)
    var callback = typeof args[args.length - 1] === 'function' ? args.pop() : null
    try {
      return fn.apply(this, arguments).nodeify(callback)
    } catch (ex) {
      if (callback === null || typeof callback == 'undefined') {
        return new Promise(function (resolve, reject) { reject(ex) })
      } else {
        asap(function () {
          callback(ex)
        })
      }
    }
  }
}

Promise.all = function () {
  var calledWithArray = arguments.length === 1 && Array.isArray(arguments[0])
  var args = Array.prototype.slice.call(calledWithArray ? arguments[0] : arguments)

  if (!calledWithArray) {
    var err = new Error('Promise.all should be called with a single array, calling it with multiple arguments is deprecated')
    err.name = 'Warning'
    console.warn(err.stack)
  }

  return new Promise(function (resolve, reject) {
    if (args.length === 0) return resolve([])
    var remaining = args.length
    function res(i, val) {
      try {
        if (val && (typeof val === 'object' || typeof val === 'function')) {
          var then = val.then
          if (typeof then === 'function') {
            then.call(val, function (val) { res(i, val) }, reject)
            return
          }
        }
        args[i] = val
        if (--remaining === 0) {
          resolve(args);
        }
      } catch (ex) {
        reject(ex)
      }
    }
    for (var i = 0; i < args.length; i++) {
      res(i, args[i])
    }
  })
}

Promise.reject = function (value) {
  return new Promise(function (resolve, reject) { 
    reject(value);
  });
}

Promise.race = function (values) {
  return new Promise(function (resolve, reject) { 
    values.forEach(function(value){
      Promise.resolve(value).then(resolve, reject);
    })
  });
}

/* Prototype Methods */

Promise.prototype.done = function (onFulfilled, onRejected) {
  var self = arguments.length ? this.then.apply(this, arguments) : this
  self.then(null, function (err) {
    asap(function () {
      throw err
    })
  })
}

Promise.prototype.nodeify = function (callback) {
  if (typeof callback != 'function') return this

  this.then(function (value) {
    asap(function () {
      callback(null, value)
    })
  }, function (err) {
    asap(function () {
      callback(err)
    })
  })
}

Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
}

},{"./core.js":28,"asap":30}],30:[function(_dereq_,module,exports){
(function (process){

// Use the fastest possible means to execute a task in a future turn
// of the event loop.

// linked list of tasks (single, with head node)
var head = {task: void 0, next: null};
var tail = head;
var flushing = false;
var requestFlush = void 0;
var isNodeJS = false;

function flush() {
    /* jshint loopfunc: true */

    while (head.next) {
        head = head.next;
        var task = head.task;
        head.task = void 0;
        var domain = head.domain;

        if (domain) {
            head.domain = void 0;
            domain.enter();
        }

        try {
            task();

        } catch (e) {
            if (isNodeJS) {
                // In node, uncaught exceptions are considered fatal errors.
                // Re-throw them synchronously to interrupt flushing!

                // Ensure continuation if the uncaught exception is suppressed
                // listening "uncaughtException" events (as domains does).
                // Continue in next event to avoid tick recursion.
                if (domain) {
                    domain.exit();
                }
                setTimeout(flush, 0);
                if (domain) {
                    domain.enter();
                }

                throw e;

            } else {
                // In browsers, uncaught exceptions are not fatal.
                // Re-throw them asynchronously to avoid slow-downs.
                setTimeout(function() {
                   throw e;
                }, 0);
            }
        }

        if (domain) {
            domain.exit();
        }
    }

    flushing = false;
}

if (typeof process !== "undefined" && process.nextTick) {
    // Node.js before 0.9. Note that some fake-Node environments, like the
    // Mocha test runner, introduce a `process` global without a `nextTick`.
    isNodeJS = true;

    requestFlush = function () {
        process.nextTick(flush);
    };

} else if (typeof setImmediate === "function") {
    // In IE10, Node.js 0.9+, or https://github.com/NobleJS/setImmediate
    if (typeof window !== "undefined") {
        requestFlush = setImmediate.bind(window, flush);
    } else {
        requestFlush = function () {
            setImmediate(flush);
        };
    }

} else if (typeof MessageChannel !== "undefined") {
    // modern browsers
    // http://www.nonblocking.io/2011/06/windownexttick.html
    var channel = new MessageChannel();
    channel.port1.onmessage = flush;
    requestFlush = function () {
        channel.port2.postMessage(0);
    };

} else {
    // old browsers
    requestFlush = function () {
        setTimeout(flush, 0);
    };
}

function asap(task) {
    tail = tail.next = {
        task: task,
        domain: isNodeJS && process.domain,
        next: null
    };

    if (!flushing) {
        flushing = true;
        requestFlush();
    }
};

module.exports = asap;


}).call(this,_dereq_("/Users/jpochyla/Projects/trezor.js/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js"))
},{"/Users/jpochyla/Projects/trezor.js/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js":24}],31:[function(_dereq_,module,exports){
(function (root) {
   "use strict";

/***** unorm.js *****/

/*
 * UnicodeNormalizer 1.0.0
 * Copyright (c) 2008 Matsuza
 * Dual licensed under the MIT (MIT-LICENSE.txt) and GPL (GPL-LICENSE.txt) licenses.
 * $Date: 2008-06-05 16:44:17 +0200 (Thu, 05 Jun 2008) $
 * $Rev: 13309 $
 */

   var DEFAULT_FEATURE = [null, 0, {}];
   var CACHE_THRESHOLD = 10;
   var SBase = 0xAC00, LBase = 0x1100, VBase = 0x1161, TBase = 0x11A7, LCount = 19, VCount = 21, TCount = 28;
   var NCount = VCount * TCount; // 588
   var SCount = LCount * NCount; // 11172

   var UChar = function(cp, feature){
      this.codepoint = cp;
      this.feature = feature;
   };

   // Strategies
   var cache = {};
   var cacheCounter = [];
   for (var i = 0; i <= 0xFF; ++i){
      cacheCounter[i] = 0;
   }

   function fromCache(next, cp, needFeature){
      var ret = cache[cp];
      if(!ret){
         ret = next(cp, needFeature);
         if(!!ret.feature && ++cacheCounter[(cp >> 8) & 0xFF] > CACHE_THRESHOLD){
            cache[cp] = ret;
         }
      }
      return ret;
   }

   function fromData(next, cp, needFeature){
      var hash = cp & 0xFF00;
      var dunit = UChar.udata[hash] || {};
      var f = dunit[cp];
      return f ? new UChar(cp, f) : new UChar(cp, DEFAULT_FEATURE);
   }
   function fromCpOnly(next, cp, needFeature){
      return !!needFeature ? next(cp, needFeature) : new UChar(cp, null);
   }
   function fromRuleBasedJamo(next, cp, needFeature){
      var j;
      if(cp < LBase || (LBase + LCount <= cp && cp < SBase) || (SBase + SCount < cp)){
         return next(cp, needFeature);
      }
      if(LBase <= cp && cp < LBase + LCount){
         var c = {};
         var base = (cp - LBase) * VCount;
         for (j = 0; j < VCount; ++j){
            c[VBase + j] = SBase + TCount * (j + base);
         }
         return new UChar(cp, [,,c]);
      }

      var SIndex = cp - SBase;
      var TIndex = SIndex % TCount;
      var feature = [];
      if(TIndex !== 0){
         feature[0] = [SBase + SIndex - TIndex, TBase + TIndex];
      } else {
         feature[0] = [LBase + Math.floor(SIndex / NCount), VBase + Math.floor((SIndex % NCount) / TCount)];
         feature[2] = {};
         for (j = 1; j < TCount; ++j){
            feature[2][TBase + j] = cp + j;
         }
      }
      return new UChar(cp, feature);
   }
   function fromCpFilter(next, cp, needFeature){
      return cp < 60 || 13311 < cp && cp < 42607 ? new UChar(cp, DEFAULT_FEATURE) : next(cp, needFeature);
   }

   var strategies = [fromCpFilter, fromCache, fromCpOnly, fromRuleBasedJamo, fromData];

   UChar.fromCharCode = strategies.reduceRight(function (next, strategy) {
      return function (cp, needFeature) {
         return strategy(next, cp, needFeature);
      };
   }, null);

   UChar.isHighSurrogate = function(cp){
      return cp >= 0xD800 && cp <= 0xDBFF;
   };
   UChar.isLowSurrogate = function(cp){
      return cp >= 0xDC00 && cp <= 0xDFFF;
   };

   UChar.prototype.prepFeature = function(){
      if(!this.feature){
         this.feature = UChar.fromCharCode(this.codepoint, true).feature;
      }
   };

   UChar.prototype.toString = function(){
      if(this.codepoint < 0x10000){
         return String.fromCharCode(this.codepoint);
      } else {
         var x = this.codepoint - 0x10000;
         return String.fromCharCode(Math.floor(x / 0x400) + 0xD800, x % 0x400 + 0xDC00);
      }
   };

   UChar.prototype.getDecomp = function(){
      this.prepFeature();
      return this.feature[0] || null;
   };

   UChar.prototype.isCompatibility = function(){
      this.prepFeature();
      return !!this.feature[1] && (this.feature[1] & (1 << 8));
   };
   UChar.prototype.isExclude = function(){
      this.prepFeature();
      return !!this.feature[1] && (this.feature[1] & (1 << 9));
   };
   UChar.prototype.getCanonicalClass = function(){
      this.prepFeature();
      return !!this.feature[1] ? (this.feature[1] & 0xff) : 0;
   };
   UChar.prototype.getComposite = function(following){
      this.prepFeature();
      if(!this.feature[2]){
         return null;
      }
      var cp = this.feature[2][following.codepoint];
      return cp ? UChar.fromCharCode(cp) : null;
   };

   var UCharIterator = function(str){
      this.str = str;
      this.cursor = 0;
   };
   UCharIterator.prototype.next = function(){
      if(!!this.str && this.cursor < this.str.length){
         var cp = this.str.charCodeAt(this.cursor++);
         var d;
         if(UChar.isHighSurrogate(cp) && this.cursor < this.str.length && UChar.isLowSurrogate((d = this.str.charCodeAt(this.cursor)))){
            cp = (cp - 0xD800) * 0x400 + (d -0xDC00) + 0x10000;
            ++this.cursor;
         }
         return UChar.fromCharCode(cp);
      } else {
         this.str = null;
         return null;
      }
   };

   var RecursDecompIterator = function(it, cano){
      this.it = it;
      this.canonical = cano;
      this.resBuf = [];
   };

   RecursDecompIterator.prototype.next = function(){
      function recursiveDecomp(cano, uchar){
         var decomp = uchar.getDecomp();
         if(!!decomp && !(cano && uchar.isCompatibility())){
            var ret = [];
            for(var i = 0; i < decomp.length; ++i){
               var a = recursiveDecomp(cano, UChar.fromCharCode(decomp[i]));
               //ret.concat(a); //<-why does not this work?
               //following block is a workaround.
               for(var j = 0; j < a.length; ++j){
                  ret.push(a[j]);
               }
            }
            return ret;
         } else {
            return [uchar];
         }
      }
      if(this.resBuf.length === 0){
         var uchar = this.it.next();
         if(!uchar){
            return null;
         }
         this.resBuf = recursiveDecomp(this.canonical, uchar);
      }
      return this.resBuf.shift();
   };

   var DecompIterator = function(it){
      this.it = it;
      this.resBuf = [];
   };

   DecompIterator.prototype.next = function(){
      var cc;
      if(this.resBuf.length === 0){
         do{
            var uchar = this.it.next();
            if(!uchar){
               break;
            }
            cc = uchar.getCanonicalClass();
            var inspt = this.resBuf.length;
            if(cc !== 0){
               for(; inspt > 0; --inspt){
                  var uchar2 = this.resBuf[inspt - 1];
                  var cc2 = uchar2.getCanonicalClass();
                  if(cc2 <= cc){
                     break;
                  }
               }
            }
            this.resBuf.splice(inspt, 0, uchar);
         } while(cc !== 0);
      }
      return this.resBuf.shift();
   };

   var CompIterator = function(it){
      this.it = it;
      this.procBuf = [];
      this.resBuf = [];
      this.lastClass = null;
   };

   CompIterator.prototype.next = function(){
      while(this.resBuf.length === 0){
         var uchar = this.it.next();
         if(!uchar){
            this.resBuf = this.procBuf;
            this.procBuf = [];
            break;
         }
         if(this.procBuf.length === 0){
            this.lastClass = uchar.getCanonicalClass();
            this.procBuf.push(uchar);
         } else {
            var starter = this.procBuf[0];
            var composite = starter.getComposite(uchar);
            var cc = uchar.getCanonicalClass();
            if(!!composite && (this.lastClass < cc || this.lastClass === 0)){
               this.procBuf[0] = composite;
            } else {
               if(cc === 0){
                  this.resBuf = this.procBuf;
                  this.procBuf = [];
               }
               this.lastClass = cc;
               this.procBuf.push(uchar);
            }
         }
      }
      return this.resBuf.shift();
   };

   var createIterator = function(mode, str){
      switch(mode){
         case "NFD":
            return new DecompIterator(new RecursDecompIterator(new UCharIterator(str), true));
         case "NFKD":
            return new DecompIterator(new RecursDecompIterator(new UCharIterator(str), false));
         case "NFC":
            return new CompIterator(new DecompIterator(new RecursDecompIterator(new UCharIterator(str), true)));
         case "NFKC":
            return new CompIterator(new DecompIterator(new RecursDecompIterator(new UCharIterator(str), false)));
      }
      throw mode + " is invalid";
   };
   var normalize = function(mode, str){
      var it = createIterator(mode, str);
      var ret = "";
      var uchar;
      while(!!(uchar = it.next())){
         ret += uchar.toString();
      }
      return ret;
   };

   /* API functions */
   function nfd(str){
      return normalize("NFD", str);
   }

   function nfkd(str){
      return normalize("NFKD", str);
   }

   function nfc(str){
      return normalize("NFC", str);
   }

   function nfkc(str){
      return normalize("NFKC", str);
   }

/* Unicode data */
UChar.udata={
0:{60:[,,{824:8814}],61:[,,{824:8800}],62:[,,{824:8815}],65:[,,{768:192,769:193,770:194,771:195,772:256,774:258,775:550,776:196,777:7842,778:197,780:461,783:512,785:514,803:7840,805:7680,808:260}],66:[,,{775:7682,803:7684,817:7686}],67:[,,{769:262,770:264,775:266,780:268,807:199}],68:[,,{775:7690,780:270,803:7692,807:7696,813:7698,817:7694}],69:[,,{768:200,769:201,770:202,771:7868,772:274,774:276,775:278,776:203,777:7866,780:282,783:516,785:518,803:7864,807:552,808:280,813:7704,816:7706}],70:[,,{775:7710}],71:[,,{769:500,770:284,772:7712,774:286,775:288,780:486,807:290}],72:[,,{770:292,775:7714,776:7718,780:542,803:7716,807:7720,814:7722}],73:[,,{768:204,769:205,770:206,771:296,772:298,774:300,775:304,776:207,777:7880,780:463,783:520,785:522,803:7882,808:302,816:7724}],74:[,,{770:308}],75:[,,{769:7728,780:488,803:7730,807:310,817:7732}],76:[,,{769:313,780:317,803:7734,807:315,813:7740,817:7738}],77:[,,{769:7742,775:7744,803:7746}],78:[,,{768:504,769:323,771:209,775:7748,780:327,803:7750,807:325,813:7754,817:7752}],79:[,,{768:210,769:211,770:212,771:213,772:332,774:334,775:558,776:214,777:7886,779:336,780:465,783:524,785:526,795:416,803:7884,808:490}],80:[,,{769:7764,775:7766}],82:[,,{769:340,775:7768,780:344,783:528,785:530,803:7770,807:342,817:7774}],83:[,,{769:346,770:348,775:7776,780:352,803:7778,806:536,807:350}],84:[,,{775:7786,780:356,803:7788,806:538,807:354,813:7792,817:7790}],85:[,,{768:217,769:218,770:219,771:360,772:362,774:364,776:220,777:7910,778:366,779:368,780:467,783:532,785:534,795:431,803:7908,804:7794,808:370,813:7798,816:7796}],86:[,,{771:7804,803:7806}],87:[,,{768:7808,769:7810,770:372,775:7814,776:7812,803:7816}],88:[,,{775:7818,776:7820}],89:[,,{768:7922,769:221,770:374,771:7928,772:562,775:7822,776:376,777:7926,803:7924}],90:[,,{769:377,770:7824,775:379,780:381,803:7826,817:7828}],97:[,,{768:224,769:225,770:226,771:227,772:257,774:259,775:551,776:228,777:7843,778:229,780:462,783:513,785:515,803:7841,805:7681,808:261}],98:[,,{775:7683,803:7685,817:7687}],99:[,,{769:263,770:265,775:267,780:269,807:231}],100:[,,{775:7691,780:271,803:7693,807:7697,813:7699,817:7695}],101:[,,{768:232,769:233,770:234,771:7869,772:275,774:277,775:279,776:235,777:7867,780:283,783:517,785:519,803:7865,807:553,808:281,813:7705,816:7707}],102:[,,{775:7711}],103:[,,{769:501,770:285,772:7713,774:287,775:289,780:487,807:291}],104:[,,{770:293,775:7715,776:7719,780:543,803:7717,807:7721,814:7723,817:7830}],105:[,,{768:236,769:237,770:238,771:297,772:299,774:301,776:239,777:7881,780:464,783:521,785:523,803:7883,808:303,816:7725}],106:[,,{770:309,780:496}],107:[,,{769:7729,780:489,803:7731,807:311,817:7733}],108:[,,{769:314,780:318,803:7735,807:316,813:7741,817:7739}],109:[,,{769:7743,775:7745,803:7747}],110:[,,{768:505,769:324,771:241,775:7749,780:328,803:7751,807:326,813:7755,817:7753}],111:[,,{768:242,769:243,770:244,771:245,772:333,774:335,775:559,776:246,777:7887,779:337,780:466,783:525,785:527,795:417,803:7885,808:491}],112:[,,{769:7765,775:7767}],114:[,,{769:341,775:7769,780:345,783:529,785:531,803:7771,807:343,817:7775}],115:[,,{769:347,770:349,775:7777,780:353,803:7779,806:537,807:351}],116:[,,{775:7787,776:7831,780:357,803:7789,806:539,807:355,813:7793,817:7791}],117:[,,{768:249,769:250,770:251,771:361,772:363,774:365,776:252,777:7911,778:367,779:369,780:468,783:533,785:535,795:432,803:7909,804:7795,808:371,813:7799,816:7797}],118:[,,{771:7805,803:7807}],119:[,,{768:7809,769:7811,770:373,775:7815,776:7813,778:7832,803:7817}],120:[,,{775:7819,776:7821}],121:[,,{768:7923,769:253,770:375,771:7929,772:563,775:7823,776:255,777:7927,778:7833,803:7925}],122:[,,{769:378,770:7825,775:380,780:382,803:7827,817:7829}],160:[[32],256],168:[[32,776],256,{768:8173,769:901,834:8129}],170:[[97],256],175:[[32,772],256],178:[[50],256],179:[[51],256],180:[[32,769],256],181:[[956],256],184:[[32,807],256],185:[[49],256],186:[[111],256],188:[[49,8260,52],256],189:[[49,8260,50],256],190:[[51,8260,52],256],192:[[65,768]],193:[[65,769]],194:[[65,770],,{768:7846,769:7844,771:7850,777:7848}],195:[[65,771]],196:[[65,776],,{772:478}],197:[[65,778],,{769:506}],198:[,,{769:508,772:482}],199:[[67,807],,{769:7688}],200:[[69,768]],201:[[69,769]],202:[[69,770],,{768:7872,769:7870,771:7876,777:7874}],203:[[69,776]],204:[[73,768]],205:[[73,769]],206:[[73,770]],207:[[73,776],,{769:7726}],209:[[78,771]],210:[[79,768]],211:[[79,769]],212:[[79,770],,{768:7890,769:7888,771:7894,777:7892}],213:[[79,771],,{769:7756,772:556,776:7758}],214:[[79,776],,{772:554}],216:[,,{769:510}],217:[[85,768]],218:[[85,769]],219:[[85,770]],220:[[85,776],,{768:475,769:471,772:469,780:473}],221:[[89,769]],224:[[97,768]],225:[[97,769]],226:[[97,770],,{768:7847,769:7845,771:7851,777:7849}],227:[[97,771]],228:[[97,776],,{772:479}],229:[[97,778],,{769:507}],230:[,,{769:509,772:483}],231:[[99,807],,{769:7689}],232:[[101,768]],233:[[101,769]],234:[[101,770],,{768:7873,769:7871,771:7877,777:7875}],235:[[101,776]],236:[[105,768]],237:[[105,769]],238:[[105,770]],239:[[105,776],,{769:7727}],241:[[110,771]],242:[[111,768]],243:[[111,769]],244:[[111,770],,{768:7891,769:7889,771:7895,777:7893}],245:[[111,771],,{769:7757,772:557,776:7759}],246:[[111,776],,{772:555}],248:[,,{769:511}],249:[[117,768]],250:[[117,769]],251:[[117,770]],252:[[117,776],,{768:476,769:472,772:470,780:474}],253:[[121,769]],255:[[121,776]]},
256:{256:[[65,772]],257:[[97,772]],258:[[65,774],,{768:7856,769:7854,771:7860,777:7858}],259:[[97,774],,{768:7857,769:7855,771:7861,777:7859}],260:[[65,808]],261:[[97,808]],262:[[67,769]],263:[[99,769]],264:[[67,770]],265:[[99,770]],266:[[67,775]],267:[[99,775]],268:[[67,780]],269:[[99,780]],270:[[68,780]],271:[[100,780]],274:[[69,772],,{768:7700,769:7702}],275:[[101,772],,{768:7701,769:7703}],276:[[69,774]],277:[[101,774]],278:[[69,775]],279:[[101,775]],280:[[69,808]],281:[[101,808]],282:[[69,780]],283:[[101,780]],284:[[71,770]],285:[[103,770]],286:[[71,774]],287:[[103,774]],288:[[71,775]],289:[[103,775]],290:[[71,807]],291:[[103,807]],292:[[72,770]],293:[[104,770]],296:[[73,771]],297:[[105,771]],298:[[73,772]],299:[[105,772]],300:[[73,774]],301:[[105,774]],302:[[73,808]],303:[[105,808]],304:[[73,775]],306:[[73,74],256],307:[[105,106],256],308:[[74,770]],309:[[106,770]],310:[[75,807]],311:[[107,807]],313:[[76,769]],314:[[108,769]],315:[[76,807]],316:[[108,807]],317:[[76,780]],318:[[108,780]],319:[[76,183],256],320:[[108,183],256],323:[[78,769]],324:[[110,769]],325:[[78,807]],326:[[110,807]],327:[[78,780]],328:[[110,780]],329:[[700,110],256],332:[[79,772],,{768:7760,769:7762}],333:[[111,772],,{768:7761,769:7763}],334:[[79,774]],335:[[111,774]],336:[[79,779]],337:[[111,779]],340:[[82,769]],341:[[114,769]],342:[[82,807]],343:[[114,807]],344:[[82,780]],345:[[114,780]],346:[[83,769],,{775:7780}],347:[[115,769],,{775:7781}],348:[[83,770]],349:[[115,770]],350:[[83,807]],351:[[115,807]],352:[[83,780],,{775:7782}],353:[[115,780],,{775:7783}],354:[[84,807]],355:[[116,807]],356:[[84,780]],357:[[116,780]],360:[[85,771],,{769:7800}],361:[[117,771],,{769:7801}],362:[[85,772],,{776:7802}],363:[[117,772],,{776:7803}],364:[[85,774]],365:[[117,774]],366:[[85,778]],367:[[117,778]],368:[[85,779]],369:[[117,779]],370:[[85,808]],371:[[117,808]],372:[[87,770]],373:[[119,770]],374:[[89,770]],375:[[121,770]],376:[[89,776]],377:[[90,769]],378:[[122,769]],379:[[90,775]],380:[[122,775]],381:[[90,780]],382:[[122,780]],383:[[115],256,{775:7835}],416:[[79,795],,{768:7900,769:7898,771:7904,777:7902,803:7906}],417:[[111,795],,{768:7901,769:7899,771:7905,777:7903,803:7907}],431:[[85,795],,{768:7914,769:7912,771:7918,777:7916,803:7920}],432:[[117,795],,{768:7915,769:7913,771:7919,777:7917,803:7921}],439:[,,{780:494}],452:[[68,381],256],453:[[68,382],256],454:[[100,382],256],455:[[76,74],256],456:[[76,106],256],457:[[108,106],256],458:[[78,74],256],459:[[78,106],256],460:[[110,106],256],461:[[65,780]],462:[[97,780]],463:[[73,780]],464:[[105,780]],465:[[79,780]],466:[[111,780]],467:[[85,780]],468:[[117,780]],469:[[220,772]],470:[[252,772]],471:[[220,769]],472:[[252,769]],473:[[220,780]],474:[[252,780]],475:[[220,768]],476:[[252,768]],478:[[196,772]],479:[[228,772]],480:[[550,772]],481:[[551,772]],482:[[198,772]],483:[[230,772]],486:[[71,780]],487:[[103,780]],488:[[75,780]],489:[[107,780]],490:[[79,808],,{772:492}],491:[[111,808],,{772:493}],492:[[490,772]],493:[[491,772]],494:[[439,780]],495:[[658,780]],496:[[106,780]],497:[[68,90],256],498:[[68,122],256],499:[[100,122],256],500:[[71,769]],501:[[103,769]],504:[[78,768]],505:[[110,768]],506:[[197,769]],507:[[229,769]],508:[[198,769]],509:[[230,769]],510:[[216,769]],511:[[248,769]],66045:[,220]},
512:{512:[[65,783]],513:[[97,783]],514:[[65,785]],515:[[97,785]],516:[[69,783]],517:[[101,783]],518:[[69,785]],519:[[101,785]],520:[[73,783]],521:[[105,783]],522:[[73,785]],523:[[105,785]],524:[[79,783]],525:[[111,783]],526:[[79,785]],527:[[111,785]],528:[[82,783]],529:[[114,783]],530:[[82,785]],531:[[114,785]],532:[[85,783]],533:[[117,783]],534:[[85,785]],535:[[117,785]],536:[[83,806]],537:[[115,806]],538:[[84,806]],539:[[116,806]],542:[[72,780]],543:[[104,780]],550:[[65,775],,{772:480}],551:[[97,775],,{772:481}],552:[[69,807],,{774:7708}],553:[[101,807],,{774:7709}],554:[[214,772]],555:[[246,772]],556:[[213,772]],557:[[245,772]],558:[[79,775],,{772:560}],559:[[111,775],,{772:561}],560:[[558,772]],561:[[559,772]],562:[[89,772]],563:[[121,772]],658:[,,{780:495}],688:[[104],256],689:[[614],256],690:[[106],256],691:[[114],256],692:[[633],256],693:[[635],256],694:[[641],256],695:[[119],256],696:[[121],256],728:[[32,774],256],729:[[32,775],256],730:[[32,778],256],731:[[32,808],256],732:[[32,771],256],733:[[32,779],256],736:[[611],256],737:[[108],256],738:[[115],256],739:[[120],256],740:[[661],256]},
768:{768:[,230],769:[,230],770:[,230],771:[,230],772:[,230],773:[,230],774:[,230],775:[,230],776:[,230,{769:836}],777:[,230],778:[,230],779:[,230],780:[,230],781:[,230],782:[,230],783:[,230],784:[,230],785:[,230],786:[,230],787:[,230],788:[,230],789:[,232],790:[,220],791:[,220],792:[,220],793:[,220],794:[,232],795:[,216],796:[,220],797:[,220],798:[,220],799:[,220],800:[,220],801:[,202],802:[,202],803:[,220],804:[,220],805:[,220],806:[,220],807:[,202],808:[,202],809:[,220],810:[,220],811:[,220],812:[,220],813:[,220],814:[,220],815:[,220],816:[,220],817:[,220],818:[,220],819:[,220],820:[,1],821:[,1],822:[,1],823:[,1],824:[,1],825:[,220],826:[,220],827:[,220],828:[,220],829:[,230],830:[,230],831:[,230],832:[[768],230],833:[[769],230],834:[,230],835:[[787],230],836:[[776,769],230],837:[,240],838:[,230],839:[,220],840:[,220],841:[,220],842:[,230],843:[,230],844:[,230],845:[,220],846:[,220],848:[,230],849:[,230],850:[,230],851:[,220],852:[,220],853:[,220],854:[,220],855:[,230],856:[,232],857:[,220],858:[,220],859:[,230],860:[,233],861:[,234],862:[,234],863:[,233],864:[,234],865:[,234],866:[,233],867:[,230],868:[,230],869:[,230],870:[,230],871:[,230],872:[,230],873:[,230],874:[,230],875:[,230],876:[,230],877:[,230],878:[,230],879:[,230],884:[[697]],890:[[32,837],256],894:[[59]],900:[[32,769],256],901:[[168,769]],902:[[913,769]],903:[[183]],904:[[917,769]],905:[[919,769]],906:[[921,769]],908:[[927,769]],910:[[933,769]],911:[[937,769]],912:[[970,769]],913:[,,{768:8122,769:902,772:8121,774:8120,787:7944,788:7945,837:8124}],917:[,,{768:8136,769:904,787:7960,788:7961}],919:[,,{768:8138,769:905,787:7976,788:7977,837:8140}],921:[,,{768:8154,769:906,772:8153,774:8152,776:938,787:7992,788:7993}],927:[,,{768:8184,769:908,787:8008,788:8009}],929:[,,{788:8172}],933:[,,{768:8170,769:910,772:8169,774:8168,776:939,788:8025}],937:[,,{768:8186,769:911,787:8040,788:8041,837:8188}],938:[[921,776]],939:[[933,776]],940:[[945,769],,{837:8116}],941:[[949,769]],942:[[951,769],,{837:8132}],943:[[953,769]],944:[[971,769]],945:[,,{768:8048,769:940,772:8113,774:8112,787:7936,788:7937,834:8118,837:8115}],949:[,,{768:8050,769:941,787:7952,788:7953}],951:[,,{768:8052,769:942,787:7968,788:7969,834:8134,837:8131}],953:[,,{768:8054,769:943,772:8145,774:8144,776:970,787:7984,788:7985,834:8150}],959:[,,{768:8056,769:972,787:8000,788:8001}],961:[,,{787:8164,788:8165}],965:[,,{768:8058,769:973,772:8161,774:8160,776:971,787:8016,788:8017,834:8166}],969:[,,{768:8060,769:974,787:8032,788:8033,834:8182,837:8179}],970:[[953,776],,{768:8146,769:912,834:8151}],971:[[965,776],,{768:8162,769:944,834:8167}],972:[[959,769]],973:[[965,769]],974:[[969,769],,{837:8180}],976:[[946],256],977:[[952],256],978:[[933],256,{769:979,776:980}],979:[[978,769]],980:[[978,776]],981:[[966],256],982:[[960],256],1008:[[954],256],1009:[[961],256],1010:[[962],256],1012:[[920],256],1013:[[949],256],1017:[[931],256]},
1024:{1024:[[1045,768]],1025:[[1045,776]],1027:[[1043,769]],1030:[,,{776:1031}],1031:[[1030,776]],1036:[[1050,769]],1037:[[1048,768]],1038:[[1059,774]],1040:[,,{774:1232,776:1234}],1043:[,,{769:1027}],1045:[,,{768:1024,774:1238,776:1025}],1046:[,,{774:1217,776:1244}],1047:[,,{776:1246}],1048:[,,{768:1037,772:1250,774:1049,776:1252}],1049:[[1048,774]],1050:[,,{769:1036}],1054:[,,{776:1254}],1059:[,,{772:1262,774:1038,776:1264,779:1266}],1063:[,,{776:1268}],1067:[,,{776:1272}],1069:[,,{776:1260}],1072:[,,{774:1233,776:1235}],1075:[,,{769:1107}],1077:[,,{768:1104,774:1239,776:1105}],1078:[,,{774:1218,776:1245}],1079:[,,{776:1247}],1080:[,,{768:1117,772:1251,774:1081,776:1253}],1081:[[1080,774]],1082:[,,{769:1116}],1086:[,,{776:1255}],1091:[,,{772:1263,774:1118,776:1265,779:1267}],1095:[,,{776:1269}],1099:[,,{776:1273}],1101:[,,{776:1261}],1104:[[1077,768]],1105:[[1077,776]],1107:[[1075,769]],1110:[,,{776:1111}],1111:[[1110,776]],1116:[[1082,769]],1117:[[1080,768]],1118:[[1091,774]],1140:[,,{783:1142}],1141:[,,{783:1143}],1142:[[1140,783]],1143:[[1141,783]],1155:[,230],1156:[,230],1157:[,230],1158:[,230],1159:[,230],1217:[[1046,774]],1218:[[1078,774]],1232:[[1040,774]],1233:[[1072,774]],1234:[[1040,776]],1235:[[1072,776]],1238:[[1045,774]],1239:[[1077,774]],1240:[,,{776:1242}],1241:[,,{776:1243}],1242:[[1240,776]],1243:[[1241,776]],1244:[[1046,776]],1245:[[1078,776]],1246:[[1047,776]],1247:[[1079,776]],1250:[[1048,772]],1251:[[1080,772]],1252:[[1048,776]],1253:[[1080,776]],1254:[[1054,776]],1255:[[1086,776]],1256:[,,{776:1258}],1257:[,,{776:1259}],1258:[[1256,776]],1259:[[1257,776]],1260:[[1069,776]],1261:[[1101,776]],1262:[[1059,772]],1263:[[1091,772]],1264:[[1059,776]],1265:[[1091,776]],1266:[[1059,779]],1267:[[1091,779]],1268:[[1063,776]],1269:[[1095,776]],1272:[[1067,776]],1273:[[1099,776]]},
1280:{1415:[[1381,1410],256],1425:[,220],1426:[,230],1427:[,230],1428:[,230],1429:[,230],1430:[,220],1431:[,230],1432:[,230],1433:[,230],1434:[,222],1435:[,220],1436:[,230],1437:[,230],1438:[,230],1439:[,230],1440:[,230],1441:[,230],1442:[,220],1443:[,220],1444:[,220],1445:[,220],1446:[,220],1447:[,220],1448:[,230],1449:[,230],1450:[,220],1451:[,230],1452:[,230],1453:[,222],1454:[,228],1455:[,230],1456:[,10],1457:[,11],1458:[,12],1459:[,13],1460:[,14],1461:[,15],1462:[,16],1463:[,17],1464:[,18],1465:[,19],1466:[,19],1467:[,20],1468:[,21],1469:[,22],1471:[,23],1473:[,24],1474:[,25],1476:[,230],1477:[,220],1479:[,18]},
1536:{1552:[,230],1553:[,230],1554:[,230],1555:[,230],1556:[,230],1557:[,230],1558:[,230],1559:[,230],1560:[,30],1561:[,31],1562:[,32],1570:[[1575,1619]],1571:[[1575,1620]],1572:[[1608,1620]],1573:[[1575,1621]],1574:[[1610,1620]],1575:[,,{1619:1570,1620:1571,1621:1573}],1608:[,,{1620:1572}],1610:[,,{1620:1574}],1611:[,27],1612:[,28],1613:[,29],1614:[,30],1615:[,31],1616:[,32],1617:[,33],1618:[,34],1619:[,230],1620:[,230],1621:[,220],1622:[,220],1623:[,230],1624:[,230],1625:[,230],1626:[,230],1627:[,230],1628:[,220],1629:[,230],1630:[,230],1631:[,220],1648:[,35],1653:[[1575,1652],256],1654:[[1608,1652],256],1655:[[1735,1652],256],1656:[[1610,1652],256],1728:[[1749,1620]],1729:[,,{1620:1730}],1730:[[1729,1620]],1746:[,,{1620:1747}],1747:[[1746,1620]],1749:[,,{1620:1728}],1750:[,230],1751:[,230],1752:[,230],1753:[,230],1754:[,230],1755:[,230],1756:[,230],1759:[,230],1760:[,230],1761:[,230],1762:[,230],1763:[,220],1764:[,230],1767:[,230],1768:[,230],1770:[,220],1771:[,230],1772:[,230],1773:[,220]},
1792:{1809:[,36],1840:[,230],1841:[,220],1842:[,230],1843:[,230],1844:[,220],1845:[,230],1846:[,230],1847:[,220],1848:[,220],1849:[,220],1850:[,230],1851:[,220],1852:[,220],1853:[,230],1854:[,220],1855:[,230],1856:[,230],1857:[,230],1858:[,220],1859:[,230],1860:[,220],1861:[,230],1862:[,220],1863:[,230],1864:[,220],1865:[,230],1866:[,230],2027:[,230],2028:[,230],2029:[,230],2030:[,230],2031:[,230],2032:[,230],2033:[,230],2034:[,220],2035:[,230]},
2048:{2070:[,230],2071:[,230],2072:[,230],2073:[,230],2075:[,230],2076:[,230],2077:[,230],2078:[,230],2079:[,230],2080:[,230],2081:[,230],2082:[,230],2083:[,230],2085:[,230],2086:[,230],2087:[,230],2089:[,230],2090:[,230],2091:[,230],2092:[,230],2093:[,230],2137:[,220],2138:[,220],2139:[,220],2276:[,230],2277:[,230],2278:[,220],2279:[,230],2280:[,230],2281:[,220],2282:[,230],2283:[,230],2284:[,230],2285:[,220],2286:[,220],2287:[,220],2288:[,27],2289:[,28],2290:[,29],2291:[,230],2292:[,230],2293:[,230],2294:[,220],2295:[,230],2296:[,230],2297:[,220],2298:[,220],2299:[,230],2300:[,230],2301:[,230],2302:[,230]},
2304:{2344:[,,{2364:2345}],2345:[[2344,2364]],2352:[,,{2364:2353}],2353:[[2352,2364]],2355:[,,{2364:2356}],2356:[[2355,2364]],2364:[,7],2381:[,9],2385:[,230],2386:[,220],2387:[,230],2388:[,230],2392:[[2325,2364],512],2393:[[2326,2364],512],2394:[[2327,2364],512],2395:[[2332,2364],512],2396:[[2337,2364],512],2397:[[2338,2364],512],2398:[[2347,2364],512],2399:[[2351,2364],512],2492:[,7],2503:[,,{2494:2507,2519:2508}],2507:[[2503,2494]],2508:[[2503,2519]],2509:[,9],2524:[[2465,2492],512],2525:[[2466,2492],512],2527:[[2479,2492],512]},
2560:{2611:[[2610,2620],512],2614:[[2616,2620],512],2620:[,7],2637:[,9],2649:[[2582,2620],512],2650:[[2583,2620],512],2651:[[2588,2620],512],2654:[[2603,2620],512],2748:[,7],2765:[,9],68109:[,220],68111:[,230],68152:[,230],68153:[,1],68154:[,220],68159:[,9]},
2816:{2876:[,7],2887:[,,{2878:2891,2902:2888,2903:2892}],2888:[[2887,2902]],2891:[[2887,2878]],2892:[[2887,2903]],2893:[,9],2908:[[2849,2876],512],2909:[[2850,2876],512],2962:[,,{3031:2964}],2964:[[2962,3031]],3014:[,,{3006:3018,3031:3020}],3015:[,,{3006:3019}],3018:[[3014,3006]],3019:[[3015,3006]],3020:[[3014,3031]],3021:[,9]},
3072:{3142:[,,{3158:3144}],3144:[[3142,3158]],3149:[,9],3157:[,84],3158:[,91],3260:[,7],3263:[,,{3285:3264}],3264:[[3263,3285]],3270:[,,{3266:3274,3285:3271,3286:3272}],3271:[[3270,3285]],3272:[[3270,3286]],3274:[[3270,3266],,{3285:3275}],3275:[[3274,3285]],3277:[,9]},
3328:{3398:[,,{3390:3402,3415:3404}],3399:[,,{3390:3403}],3402:[[3398,3390]],3403:[[3399,3390]],3404:[[3398,3415]],3405:[,9],3530:[,9],3545:[,,{3530:3546,3535:3548,3551:3550}],3546:[[3545,3530]],3548:[[3545,3535],,{3530:3549}],3549:[[3548,3530]],3550:[[3545,3551]]},
3584:{3635:[[3661,3634],256],3640:[,103],3641:[,103],3642:[,9],3656:[,107],3657:[,107],3658:[,107],3659:[,107],3763:[[3789,3762],256],3768:[,118],3769:[,118],3784:[,122],3785:[,122],3786:[,122],3787:[,122],3804:[[3755,3737],256],3805:[[3755,3745],256]},
3840:{3852:[[3851],256],3864:[,220],3865:[,220],3893:[,220],3895:[,220],3897:[,216],3907:[[3906,4023],512],3917:[[3916,4023],512],3922:[[3921,4023],512],3927:[[3926,4023],512],3932:[[3931,4023],512],3945:[[3904,4021],512],3953:[,129],3954:[,130],3955:[[3953,3954],512],3956:[,132],3957:[[3953,3956],512],3958:[[4018,3968],512],3959:[[4018,3969],256],3960:[[4019,3968],512],3961:[[4019,3969],256],3962:[,130],3963:[,130],3964:[,130],3965:[,130],3968:[,130],3969:[[3953,3968],512],3970:[,230],3971:[,230],3972:[,9],3974:[,230],3975:[,230],3987:[[3986,4023],512],3997:[[3996,4023],512],4002:[[4001,4023],512],4007:[[4006,4023],512],4012:[[4011,4023],512],4025:[[3984,4021],512],4038:[,220]},
4096:{4133:[,,{4142:4134}],4134:[[4133,4142]],4151:[,7],4153:[,9],4154:[,9],4237:[,220],4348:[[4316],256],69702:[,9],69785:[,,{69818:69786}],69786:[[69785,69818]],69787:[,,{69818:69788}],69788:[[69787,69818]],69797:[,,{69818:69803}],69803:[[69797,69818]],69817:[,9],69818:[,7]},
4352:{69888:[,230],69889:[,230],69890:[,230],69934:[[69937,69927]],69935:[[69938,69927]],69937:[,,{69927:69934}],69938:[,,{69927:69935}],69939:[,9],69940:[,9],70080:[,9]},
4864:{4957:[,230],4958:[,230],4959:[,230]},
5632:{71350:[,9],71351:[,7]},
5888:{5908:[,9],5940:[,9],6098:[,9],6109:[,230]},
6144:{6313:[,228]},
6400:{6457:[,222],6458:[,230],6459:[,220]},
6656:{6679:[,230],6680:[,220],6752:[,9],6773:[,230],6774:[,230],6775:[,230],6776:[,230],6777:[,230],6778:[,230],6779:[,230],6780:[,230],6783:[,220]},
6912:{6917:[,,{6965:6918}],6918:[[6917,6965]],6919:[,,{6965:6920}],6920:[[6919,6965]],6921:[,,{6965:6922}],6922:[[6921,6965]],6923:[,,{6965:6924}],6924:[[6923,6965]],6925:[,,{6965:6926}],6926:[[6925,6965]],6929:[,,{6965:6930}],6930:[[6929,6965]],6964:[,7],6970:[,,{6965:6971}],6971:[[6970,6965]],6972:[,,{6965:6973}],6973:[[6972,6965]],6974:[,,{6965:6976}],6975:[,,{6965:6977}],6976:[[6974,6965]],6977:[[6975,6965]],6978:[,,{6965:6979}],6979:[[6978,6965]],6980:[,9],7019:[,230],7020:[,220],7021:[,230],7022:[,230],7023:[,230],7024:[,230],7025:[,230],7026:[,230],7027:[,230],7082:[,9],7083:[,9],7142:[,7],7154:[,9],7155:[,9]},
7168:{7223:[,7],7376:[,230],7377:[,230],7378:[,230],7380:[,1],7381:[,220],7382:[,220],7383:[,220],7384:[,220],7385:[,220],7386:[,230],7387:[,230],7388:[,220],7389:[,220],7390:[,220],7391:[,220],7392:[,230],7394:[,1],7395:[,1],7396:[,1],7397:[,1],7398:[,1],7399:[,1],7400:[,1],7405:[,220],7412:[,230]},
7424:{7468:[[65],256],7469:[[198],256],7470:[[66],256],7472:[[68],256],7473:[[69],256],7474:[[398],256],7475:[[71],256],7476:[[72],256],7477:[[73],256],7478:[[74],256],7479:[[75],256],7480:[[76],256],7481:[[77],256],7482:[[78],256],7484:[[79],256],7485:[[546],256],7486:[[80],256],7487:[[82],256],7488:[[84],256],7489:[[85],256],7490:[[87],256],7491:[[97],256],7492:[[592],256],7493:[[593],256],7494:[[7426],256],7495:[[98],256],7496:[[100],256],7497:[[101],256],7498:[[601],256],7499:[[603],256],7500:[[604],256],7501:[[103],256],7503:[[107],256],7504:[[109],256],7505:[[331],256],7506:[[111],256],7507:[[596],256],7508:[[7446],256],7509:[[7447],256],7510:[[112],256],7511:[[116],256],7512:[[117],256],7513:[[7453],256],7514:[[623],256],7515:[[118],256],7516:[[7461],256],7517:[[946],256],7518:[[947],256],7519:[[948],256],7520:[[966],256],7521:[[967],256],7522:[[105],256],7523:[[114],256],7524:[[117],256],7525:[[118],256],7526:[[946],256],7527:[[947],256],7528:[[961],256],7529:[[966],256],7530:[[967],256],7544:[[1085],256],7579:[[594],256],7580:[[99],256],7581:[[597],256],7582:[[240],256],7583:[[604],256],7584:[[102],256],7585:[[607],256],7586:[[609],256],7587:[[613],256],7588:[[616],256],7589:[[617],256],7590:[[618],256],7591:[[7547],256],7592:[[669],256],7593:[[621],256],7594:[[7557],256],7595:[[671],256],7596:[[625],256],7597:[[624],256],7598:[[626],256],7599:[[627],256],7600:[[628],256],7601:[[629],256],7602:[[632],256],7603:[[642],256],7604:[[643],256],7605:[[427],256],7606:[[649],256],7607:[[650],256],7608:[[7452],256],7609:[[651],256],7610:[[652],256],7611:[[122],256],7612:[[656],256],7613:[[657],256],7614:[[658],256],7615:[[952],256],7616:[,230],7617:[,230],7618:[,220],7619:[,230],7620:[,230],7621:[,230],7622:[,230],7623:[,230],7624:[,230],7625:[,230],7626:[,220],7627:[,230],7628:[,230],7629:[,234],7630:[,214],7631:[,220],7632:[,202],7633:[,230],7634:[,230],7635:[,230],7636:[,230],7637:[,230],7638:[,230],7639:[,230],7640:[,230],7641:[,230],7642:[,230],7643:[,230],7644:[,230],7645:[,230],7646:[,230],7647:[,230],7648:[,230],7649:[,230],7650:[,230],7651:[,230],7652:[,230],7653:[,230],7654:[,230],7676:[,233],7677:[,220],7678:[,230],7679:[,220]},
7680:{7680:[[65,805]],7681:[[97,805]],7682:[[66,775]],7683:[[98,775]],7684:[[66,803]],7685:[[98,803]],7686:[[66,817]],7687:[[98,817]],7688:[[199,769]],7689:[[231,769]],7690:[[68,775]],7691:[[100,775]],7692:[[68,803]],7693:[[100,803]],7694:[[68,817]],7695:[[100,817]],7696:[[68,807]],7697:[[100,807]],7698:[[68,813]],7699:[[100,813]],7700:[[274,768]],7701:[[275,768]],7702:[[274,769]],7703:[[275,769]],7704:[[69,813]],7705:[[101,813]],7706:[[69,816]],7707:[[101,816]],7708:[[552,774]],7709:[[553,774]],7710:[[70,775]],7711:[[102,775]],7712:[[71,772]],7713:[[103,772]],7714:[[72,775]],7715:[[104,775]],7716:[[72,803]],7717:[[104,803]],7718:[[72,776]],7719:[[104,776]],7720:[[72,807]],7721:[[104,807]],7722:[[72,814]],7723:[[104,814]],7724:[[73,816]],7725:[[105,816]],7726:[[207,769]],7727:[[239,769]],7728:[[75,769]],7729:[[107,769]],7730:[[75,803]],7731:[[107,803]],7732:[[75,817]],7733:[[107,817]],7734:[[76,803],,{772:7736}],7735:[[108,803],,{772:7737}],7736:[[7734,772]],7737:[[7735,772]],7738:[[76,817]],7739:[[108,817]],7740:[[76,813]],7741:[[108,813]],7742:[[77,769]],7743:[[109,769]],7744:[[77,775]],7745:[[109,775]],7746:[[77,803]],7747:[[109,803]],7748:[[78,775]],7749:[[110,775]],7750:[[78,803]],7751:[[110,803]],7752:[[78,817]],7753:[[110,817]],7754:[[78,813]],7755:[[110,813]],7756:[[213,769]],7757:[[245,769]],7758:[[213,776]],7759:[[245,776]],7760:[[332,768]],7761:[[333,768]],7762:[[332,769]],7763:[[333,769]],7764:[[80,769]],7765:[[112,769]],7766:[[80,775]],7767:[[112,775]],7768:[[82,775]],7769:[[114,775]],7770:[[82,803],,{772:7772}],7771:[[114,803],,{772:7773}],7772:[[7770,772]],7773:[[7771,772]],7774:[[82,817]],7775:[[114,817]],7776:[[83,775]],7777:[[115,775]],7778:[[83,803],,{775:7784}],7779:[[115,803],,{775:7785}],7780:[[346,775]],7781:[[347,775]],7782:[[352,775]],7783:[[353,775]],7784:[[7778,775]],7785:[[7779,775]],7786:[[84,775]],7787:[[116,775]],7788:[[84,803]],7789:[[116,803]],7790:[[84,817]],7791:[[116,817]],7792:[[84,813]],7793:[[116,813]],7794:[[85,804]],7795:[[117,804]],7796:[[85,816]],7797:[[117,816]],7798:[[85,813]],7799:[[117,813]],7800:[[360,769]],7801:[[361,769]],7802:[[362,776]],7803:[[363,776]],7804:[[86,771]],7805:[[118,771]],7806:[[86,803]],7807:[[118,803]],7808:[[87,768]],7809:[[119,768]],7810:[[87,769]],7811:[[119,769]],7812:[[87,776]],7813:[[119,776]],7814:[[87,775]],7815:[[119,775]],7816:[[87,803]],7817:[[119,803]],7818:[[88,775]],7819:[[120,775]],7820:[[88,776]],7821:[[120,776]],7822:[[89,775]],7823:[[121,775]],7824:[[90,770]],7825:[[122,770]],7826:[[90,803]],7827:[[122,803]],7828:[[90,817]],7829:[[122,817]],7830:[[104,817]],7831:[[116,776]],7832:[[119,778]],7833:[[121,778]],7834:[[97,702],256],7835:[[383,775]],7840:[[65,803],,{770:7852,774:7862}],7841:[[97,803],,{770:7853,774:7863}],7842:[[65,777]],7843:[[97,777]],7844:[[194,769]],7845:[[226,769]],7846:[[194,768]],7847:[[226,768]],7848:[[194,777]],7849:[[226,777]],7850:[[194,771]],7851:[[226,771]],7852:[[7840,770]],7853:[[7841,770]],7854:[[258,769]],7855:[[259,769]],7856:[[258,768]],7857:[[259,768]],7858:[[258,777]],7859:[[259,777]],7860:[[258,771]],7861:[[259,771]],7862:[[7840,774]],7863:[[7841,774]],7864:[[69,803],,{770:7878}],7865:[[101,803],,{770:7879}],7866:[[69,777]],7867:[[101,777]],7868:[[69,771]],7869:[[101,771]],7870:[[202,769]],7871:[[234,769]],7872:[[202,768]],7873:[[234,768]],7874:[[202,777]],7875:[[234,777]],7876:[[202,771]],7877:[[234,771]],7878:[[7864,770]],7879:[[7865,770]],7880:[[73,777]],7881:[[105,777]],7882:[[73,803]],7883:[[105,803]],7884:[[79,803],,{770:7896}],7885:[[111,803],,{770:7897}],7886:[[79,777]],7887:[[111,777]],7888:[[212,769]],7889:[[244,769]],7890:[[212,768]],7891:[[244,768]],7892:[[212,777]],7893:[[244,777]],7894:[[212,771]],7895:[[244,771]],7896:[[7884,770]],7897:[[7885,770]],7898:[[416,769]],7899:[[417,769]],7900:[[416,768]],7901:[[417,768]],7902:[[416,777]],7903:[[417,777]],7904:[[416,771]],7905:[[417,771]],7906:[[416,803]],7907:[[417,803]],7908:[[85,803]],7909:[[117,803]],7910:[[85,777]],7911:[[117,777]],7912:[[431,769]],7913:[[432,769]],7914:[[431,768]],7915:[[432,768]],7916:[[431,777]],7917:[[432,777]],7918:[[431,771]],7919:[[432,771]],7920:[[431,803]],7921:[[432,803]],7922:[[89,768]],7923:[[121,768]],7924:[[89,803]],7925:[[121,803]],7926:[[89,777]],7927:[[121,777]],7928:[[89,771]],7929:[[121,771]]},
7936:{7936:[[945,787],,{768:7938,769:7940,834:7942,837:8064}],7937:[[945,788],,{768:7939,769:7941,834:7943,837:8065}],7938:[[7936,768],,{837:8066}],7939:[[7937,768],,{837:8067}],7940:[[7936,769],,{837:8068}],7941:[[7937,769],,{837:8069}],7942:[[7936,834],,{837:8070}],7943:[[7937,834],,{837:8071}],7944:[[913,787],,{768:7946,769:7948,834:7950,837:8072}],7945:[[913,788],,{768:7947,769:7949,834:7951,837:8073}],7946:[[7944,768],,{837:8074}],7947:[[7945,768],,{837:8075}],7948:[[7944,769],,{837:8076}],7949:[[7945,769],,{837:8077}],7950:[[7944,834],,{837:8078}],7951:[[7945,834],,{837:8079}],7952:[[949,787],,{768:7954,769:7956}],7953:[[949,788],,{768:7955,769:7957}],7954:[[7952,768]],7955:[[7953,768]],7956:[[7952,769]],7957:[[7953,769]],7960:[[917,787],,{768:7962,769:7964}],7961:[[917,788],,{768:7963,769:7965}],7962:[[7960,768]],7963:[[7961,768]],7964:[[7960,769]],7965:[[7961,769]],7968:[[951,787],,{768:7970,769:7972,834:7974,837:8080}],7969:[[951,788],,{768:7971,769:7973,834:7975,837:8081}],7970:[[7968,768],,{837:8082}],7971:[[7969,768],,{837:8083}],7972:[[7968,769],,{837:8084}],7973:[[7969,769],,{837:8085}],7974:[[7968,834],,{837:8086}],7975:[[7969,834],,{837:8087}],7976:[[919,787],,{768:7978,769:7980,834:7982,837:8088}],7977:[[919,788],,{768:7979,769:7981,834:7983,837:8089}],7978:[[7976,768],,{837:8090}],7979:[[7977,768],,{837:8091}],7980:[[7976,769],,{837:8092}],7981:[[7977,769],,{837:8093}],7982:[[7976,834],,{837:8094}],7983:[[7977,834],,{837:8095}],7984:[[953,787],,{768:7986,769:7988,834:7990}],7985:[[953,788],,{768:7987,769:7989,834:7991}],7986:[[7984,768]],7987:[[7985,768]],7988:[[7984,769]],7989:[[7985,769]],7990:[[7984,834]],7991:[[7985,834]],7992:[[921,787],,{768:7994,769:7996,834:7998}],7993:[[921,788],,{768:7995,769:7997,834:7999}],7994:[[7992,768]],7995:[[7993,768]],7996:[[7992,769]],7997:[[7993,769]],7998:[[7992,834]],7999:[[7993,834]],8000:[[959,787],,{768:8002,769:8004}],8001:[[959,788],,{768:8003,769:8005}],8002:[[8000,768]],8003:[[8001,768]],8004:[[8000,769]],8005:[[8001,769]],8008:[[927,787],,{768:8010,769:8012}],8009:[[927,788],,{768:8011,769:8013}],8010:[[8008,768]],8011:[[8009,768]],8012:[[8008,769]],8013:[[8009,769]],8016:[[965,787],,{768:8018,769:8020,834:8022}],8017:[[965,788],,{768:8019,769:8021,834:8023}],8018:[[8016,768]],8019:[[8017,768]],8020:[[8016,769]],8021:[[8017,769]],8022:[[8016,834]],8023:[[8017,834]],8025:[[933,788],,{768:8027,769:8029,834:8031}],8027:[[8025,768]],8029:[[8025,769]],8031:[[8025,834]],8032:[[969,787],,{768:8034,769:8036,834:8038,837:8096}],8033:[[969,788],,{768:8035,769:8037,834:8039,837:8097}],8034:[[8032,768],,{837:8098}],8035:[[8033,768],,{837:8099}],8036:[[8032,769],,{837:8100}],8037:[[8033,769],,{837:8101}],8038:[[8032,834],,{837:8102}],8039:[[8033,834],,{837:8103}],8040:[[937,787],,{768:8042,769:8044,834:8046,837:8104}],8041:[[937,788],,{768:8043,769:8045,834:8047,837:8105}],8042:[[8040,768],,{837:8106}],8043:[[8041,768],,{837:8107}],8044:[[8040,769],,{837:8108}],8045:[[8041,769],,{837:8109}],8046:[[8040,834],,{837:8110}],8047:[[8041,834],,{837:8111}],8048:[[945,768],,{837:8114}],8049:[[940]],8050:[[949,768]],8051:[[941]],8052:[[951,768],,{837:8130}],8053:[[942]],8054:[[953,768]],8055:[[943]],8056:[[959,768]],8057:[[972]],8058:[[965,768]],8059:[[973]],8060:[[969,768],,{837:8178}],8061:[[974]],8064:[[7936,837]],8065:[[7937,837]],8066:[[7938,837]],8067:[[7939,837]],8068:[[7940,837]],8069:[[7941,837]],8070:[[7942,837]],8071:[[7943,837]],8072:[[7944,837]],8073:[[7945,837]],8074:[[7946,837]],8075:[[7947,837]],8076:[[7948,837]],8077:[[7949,837]],8078:[[7950,837]],8079:[[7951,837]],8080:[[7968,837]],8081:[[7969,837]],8082:[[7970,837]],8083:[[7971,837]],8084:[[7972,837]],8085:[[7973,837]],8086:[[7974,837]],8087:[[7975,837]],8088:[[7976,837]],8089:[[7977,837]],8090:[[7978,837]],8091:[[7979,837]],8092:[[7980,837]],8093:[[7981,837]],8094:[[7982,837]],8095:[[7983,837]],8096:[[8032,837]],8097:[[8033,837]],8098:[[8034,837]],8099:[[8035,837]],8100:[[8036,837]],8101:[[8037,837]],8102:[[8038,837]],8103:[[8039,837]],8104:[[8040,837]],8105:[[8041,837]],8106:[[8042,837]],8107:[[8043,837]],8108:[[8044,837]],8109:[[8045,837]],8110:[[8046,837]],8111:[[8047,837]],8112:[[945,774]],8113:[[945,772]],8114:[[8048,837]],8115:[[945,837]],8116:[[940,837]],8118:[[945,834],,{837:8119}],8119:[[8118,837]],8120:[[913,774]],8121:[[913,772]],8122:[[913,768]],8123:[[902]],8124:[[913,837]],8125:[[32,787],256],8126:[[953]],8127:[[32,787],256,{768:8141,769:8142,834:8143}],8128:[[32,834],256],8129:[[168,834]],8130:[[8052,837]],8131:[[951,837]],8132:[[942,837]],8134:[[951,834],,{837:8135}],8135:[[8134,837]],8136:[[917,768]],8137:[[904]],8138:[[919,768]],8139:[[905]],8140:[[919,837]],8141:[[8127,768]],8142:[[8127,769]],8143:[[8127,834]],8144:[[953,774]],8145:[[953,772]],8146:[[970,768]],8147:[[912]],8150:[[953,834]],8151:[[970,834]],8152:[[921,774]],8153:[[921,772]],8154:[[921,768]],8155:[[906]],8157:[[8190,768]],8158:[[8190,769]],8159:[[8190,834]],8160:[[965,774]],8161:[[965,772]],8162:[[971,768]],8163:[[944]],8164:[[961,787]],8165:[[961,788]],8166:[[965,834]],8167:[[971,834]],8168:[[933,774]],8169:[[933,772]],8170:[[933,768]],8171:[[910]],8172:[[929,788]],8173:[[168,768]],8174:[[901]],8175:[[96]],8178:[[8060,837]],8179:[[969,837]],8180:[[974,837]],8182:[[969,834],,{837:8183}],8183:[[8182,837]],8184:[[927,768]],8185:[[908]],8186:[[937,768]],8187:[[911]],8188:[[937,837]],8189:[[180]],8190:[[32,788],256,{768:8157,769:8158,834:8159}]},
8192:{8192:[[8194]],8193:[[8195]],8194:[[32],256],8195:[[32],256],8196:[[32],256],8197:[[32],256],8198:[[32],256],8199:[[32],256],8200:[[32],256],8201:[[32],256],8202:[[32],256],8209:[[8208],256],8215:[[32,819],256],8228:[[46],256],8229:[[46,46],256],8230:[[46,46,46],256],8239:[[32],256],8243:[[8242,8242],256],8244:[[8242,8242,8242],256],8246:[[8245,8245],256],8247:[[8245,8245,8245],256],8252:[[33,33],256],8254:[[32,773],256],8263:[[63,63],256],8264:[[63,33],256],8265:[[33,63],256],8279:[[8242,8242,8242,8242],256],8287:[[32],256],8304:[[48],256],8305:[[105],256],8308:[[52],256],8309:[[53],256],8310:[[54],256],8311:[[55],256],8312:[[56],256],8313:[[57],256],8314:[[43],256],8315:[[8722],256],8316:[[61],256],8317:[[40],256],8318:[[41],256],8319:[[110],256],8320:[[48],256],8321:[[49],256],8322:[[50],256],8323:[[51],256],8324:[[52],256],8325:[[53],256],8326:[[54],256],8327:[[55],256],8328:[[56],256],8329:[[57],256],8330:[[43],256],8331:[[8722],256],8332:[[61],256],8333:[[40],256],8334:[[41],256],8336:[[97],256],8337:[[101],256],8338:[[111],256],8339:[[120],256],8340:[[601],256],8341:[[104],256],8342:[[107],256],8343:[[108],256],8344:[[109],256],8345:[[110],256],8346:[[112],256],8347:[[115],256],8348:[[116],256],8360:[[82,115],256],8400:[,230],8401:[,230],8402:[,1],8403:[,1],8404:[,230],8405:[,230],8406:[,230],8407:[,230],8408:[,1],8409:[,1],8410:[,1],8411:[,230],8412:[,230],8417:[,230],8421:[,1],8422:[,1],8423:[,230],8424:[,220],8425:[,230],8426:[,1],8427:[,1],8428:[,220],8429:[,220],8430:[,220],8431:[,220],8432:[,230]},
8448:{8448:[[97,47,99],256],8449:[[97,47,115],256],8450:[[67],256],8451:[[176,67],256],8453:[[99,47,111],256],8454:[[99,47,117],256],8455:[[400],256],8457:[[176,70],256],8458:[[103],256],8459:[[72],256],8460:[[72],256],8461:[[72],256],8462:[[104],256],8463:[[295],256],8464:[[73],256],8465:[[73],256],8466:[[76],256],8467:[[108],256],8469:[[78],256],8470:[[78,111],256],8473:[[80],256],8474:[[81],256],8475:[[82],256],8476:[[82],256],8477:[[82],256],8480:[[83,77],256],8481:[[84,69,76],256],8482:[[84,77],256],8484:[[90],256],8486:[[937]],8488:[[90],256],8490:[[75]],8491:[[197]],8492:[[66],256],8493:[[67],256],8495:[[101],256],8496:[[69],256],8497:[[70],256],8499:[[77],256],8500:[[111],256],8501:[[1488],256],8502:[[1489],256],8503:[[1490],256],8504:[[1491],256],8505:[[105],256],8507:[[70,65,88],256],8508:[[960],256],8509:[[947],256],8510:[[915],256],8511:[[928],256],8512:[[8721],256],8517:[[68],256],8518:[[100],256],8519:[[101],256],8520:[[105],256],8521:[[106],256],8528:[[49,8260,55],256],8529:[[49,8260,57],256],8530:[[49,8260,49,48],256],8531:[[49,8260,51],256],8532:[[50,8260,51],256],8533:[[49,8260,53],256],8534:[[50,8260,53],256],8535:[[51,8260,53],256],8536:[[52,8260,53],256],8537:[[49,8260,54],256],8538:[[53,8260,54],256],8539:[[49,8260,56],256],8540:[[51,8260,56],256],8541:[[53,8260,56],256],8542:[[55,8260,56],256],8543:[[49,8260],256],8544:[[73],256],8545:[[73,73],256],8546:[[73,73,73],256],8547:[[73,86],256],8548:[[86],256],8549:[[86,73],256],8550:[[86,73,73],256],8551:[[86,73,73,73],256],8552:[[73,88],256],8553:[[88],256],8554:[[88,73],256],8555:[[88,73,73],256],8556:[[76],256],8557:[[67],256],8558:[[68],256],8559:[[77],256],8560:[[105],256],8561:[[105,105],256],8562:[[105,105,105],256],8563:[[105,118],256],8564:[[118],256],8565:[[118,105],256],8566:[[118,105,105],256],8567:[[118,105,105,105],256],8568:[[105,120],256],8569:[[120],256],8570:[[120,105],256],8571:[[120,105,105],256],8572:[[108],256],8573:[[99],256],8574:[[100],256],8575:[[109],256],8585:[[48,8260,51],256],8592:[,,{824:8602}],8594:[,,{824:8603}],8596:[,,{824:8622}],8602:[[8592,824]],8603:[[8594,824]],8622:[[8596,824]],8653:[[8656,824]],8654:[[8660,824]],8655:[[8658,824]],8656:[,,{824:8653}],8658:[,,{824:8655}],8660:[,,{824:8654}]},
8704:{8707:[,,{824:8708}],8708:[[8707,824]],8712:[,,{824:8713}],8713:[[8712,824]],8715:[,,{824:8716}],8716:[[8715,824]],8739:[,,{824:8740}],8740:[[8739,824]],8741:[,,{824:8742}],8742:[[8741,824]],8748:[[8747,8747],256],8749:[[8747,8747,8747],256],8751:[[8750,8750],256],8752:[[8750,8750,8750],256],8764:[,,{824:8769}],8769:[[8764,824]],8771:[,,{824:8772}],8772:[[8771,824]],8773:[,,{824:8775}],8775:[[8773,824]],8776:[,,{824:8777}],8777:[[8776,824]],8781:[,,{824:8813}],8800:[[61,824]],8801:[,,{824:8802}],8802:[[8801,824]],8804:[,,{824:8816}],8805:[,,{824:8817}],8813:[[8781,824]],8814:[[60,824]],8815:[[62,824]],8816:[[8804,824]],8817:[[8805,824]],8818:[,,{824:8820}],8819:[,,{824:8821}],8820:[[8818,824]],8821:[[8819,824]],8822:[,,{824:8824}],8823:[,,{824:8825}],8824:[[8822,824]],8825:[[8823,824]],8826:[,,{824:8832}],8827:[,,{824:8833}],8828:[,,{824:8928}],8829:[,,{824:8929}],8832:[[8826,824]],8833:[[8827,824]],8834:[,,{824:8836}],8835:[,,{824:8837}],8836:[[8834,824]],8837:[[8835,824]],8838:[,,{824:8840}],8839:[,,{824:8841}],8840:[[8838,824]],8841:[[8839,824]],8849:[,,{824:8930}],8850:[,,{824:8931}],8866:[,,{824:8876}],8872:[,,{824:8877}],8873:[,,{824:8878}],8875:[,,{824:8879}],8876:[[8866,824]],8877:[[8872,824]],8878:[[8873,824]],8879:[[8875,824]],8882:[,,{824:8938}],8883:[,,{824:8939}],8884:[,,{824:8940}],8885:[,,{824:8941}],8928:[[8828,824]],8929:[[8829,824]],8930:[[8849,824]],8931:[[8850,824]],8938:[[8882,824]],8939:[[8883,824]],8940:[[8884,824]],8941:[[8885,824]]},
8960:{9001:[[12296]],9002:[[12297]]},
9216:{9312:[[49],256],9313:[[50],256],9314:[[51],256],9315:[[52],256],9316:[[53],256],9317:[[54],256],9318:[[55],256],9319:[[56],256],9320:[[57],256],9321:[[49,48],256],9322:[[49,49],256],9323:[[49,50],256],9324:[[49,51],256],9325:[[49,52],256],9326:[[49,53],256],9327:[[49,54],256],9328:[[49,55],256],9329:[[49,56],256],9330:[[49,57],256],9331:[[50,48],256],9332:[[40,49,41],256],9333:[[40,50,41],256],9334:[[40,51,41],256],9335:[[40,52,41],256],9336:[[40,53,41],256],9337:[[40,54,41],256],9338:[[40,55,41],256],9339:[[40,56,41],256],9340:[[40,57,41],256],9341:[[40,49,48,41],256],9342:[[40,49,49,41],256],9343:[[40,49,50,41],256],9344:[[40,49,51,41],256],9345:[[40,49,52,41],256],9346:[[40,49,53,41],256],9347:[[40,49,54,41],256],9348:[[40,49,55,41],256],9349:[[40,49,56,41],256],9350:[[40,49,57,41],256],9351:[[40,50,48,41],256],9352:[[49,46],256],9353:[[50,46],256],9354:[[51,46],256],9355:[[52,46],256],9356:[[53,46],256],9357:[[54,46],256],9358:[[55,46],256],9359:[[56,46],256],9360:[[57,46],256],9361:[[49,48,46],256],9362:[[49,49,46],256],9363:[[49,50,46],256],9364:[[49,51,46],256],9365:[[49,52,46],256],9366:[[49,53,46],256],9367:[[49,54,46],256],9368:[[49,55,46],256],9369:[[49,56,46],256],9370:[[49,57,46],256],9371:[[50,48,46],256],9372:[[40,97,41],256],9373:[[40,98,41],256],9374:[[40,99,41],256],9375:[[40,100,41],256],9376:[[40,101,41],256],9377:[[40,102,41],256],9378:[[40,103,41],256],9379:[[40,104,41],256],9380:[[40,105,41],256],9381:[[40,106,41],256],9382:[[40,107,41],256],9383:[[40,108,41],256],9384:[[40,109,41],256],9385:[[40,110,41],256],9386:[[40,111,41],256],9387:[[40,112,41],256],9388:[[40,113,41],256],9389:[[40,114,41],256],9390:[[40,115,41],256],9391:[[40,116,41],256],9392:[[40,117,41],256],9393:[[40,118,41],256],9394:[[40,119,41],256],9395:[[40,120,41],256],9396:[[40,121,41],256],9397:[[40,122,41],256],9398:[[65],256],9399:[[66],256],9400:[[67],256],9401:[[68],256],9402:[[69],256],9403:[[70],256],9404:[[71],256],9405:[[72],256],9406:[[73],256],9407:[[74],256],9408:[[75],256],9409:[[76],256],9410:[[77],256],9411:[[78],256],9412:[[79],256],9413:[[80],256],9414:[[81],256],9415:[[82],256],9416:[[83],256],9417:[[84],256],9418:[[85],256],9419:[[86],256],9420:[[87],256],9421:[[88],256],9422:[[89],256],9423:[[90],256],9424:[[97],256],9425:[[98],256],9426:[[99],256],9427:[[100],256],9428:[[101],256],9429:[[102],256],9430:[[103],256],9431:[[104],256],9432:[[105],256],9433:[[106],256],9434:[[107],256],9435:[[108],256],9436:[[109],256],9437:[[110],256],9438:[[111],256],9439:[[112],256],9440:[[113],256],9441:[[114],256],9442:[[115],256],9443:[[116],256],9444:[[117],256],9445:[[118],256],9446:[[119],256],9447:[[120],256],9448:[[121],256],9449:[[122],256],9450:[[48],256]},
10752:{10764:[[8747,8747,8747,8747],256],10868:[[58,58,61],256],10869:[[61,61],256],10870:[[61,61,61],256],10972:[[10973,824],512]},
11264:{11388:[[106],256],11389:[[86],256],11503:[,230],11504:[,230],11505:[,230]},
11520:{11631:[[11617],256],11647:[,9],11744:[,230],11745:[,230],11746:[,230],11747:[,230],11748:[,230],11749:[,230],11750:[,230],11751:[,230],11752:[,230],11753:[,230],11754:[,230],11755:[,230],11756:[,230],11757:[,230],11758:[,230],11759:[,230],11760:[,230],11761:[,230],11762:[,230],11763:[,230],11764:[,230],11765:[,230],11766:[,230],11767:[,230],11768:[,230],11769:[,230],11770:[,230],11771:[,230],11772:[,230],11773:[,230],11774:[,230],11775:[,230]},
11776:{11935:[[27597],256],12019:[[40863],256]},
12032:{12032:[[19968],256],12033:[[20008],256],12034:[[20022],256],12035:[[20031],256],12036:[[20057],256],12037:[[20101],256],12038:[[20108],256],12039:[[20128],256],12040:[[20154],256],12041:[[20799],256],12042:[[20837],256],12043:[[20843],256],12044:[[20866],256],12045:[[20886],256],12046:[[20907],256],12047:[[20960],256],12048:[[20981],256],12049:[[20992],256],12050:[[21147],256],12051:[[21241],256],12052:[[21269],256],12053:[[21274],256],12054:[[21304],256],12055:[[21313],256],12056:[[21340],256],12057:[[21353],256],12058:[[21378],256],12059:[[21430],256],12060:[[21448],256],12061:[[21475],256],12062:[[22231],256],12063:[[22303],256],12064:[[22763],256],12065:[[22786],256],12066:[[22794],256],12067:[[22805],256],12068:[[22823],256],12069:[[22899],256],12070:[[23376],256],12071:[[23424],256],12072:[[23544],256],12073:[[23567],256],12074:[[23586],256],12075:[[23608],256],12076:[[23662],256],12077:[[23665],256],12078:[[24027],256],12079:[[24037],256],12080:[[24049],256],12081:[[24062],256],12082:[[24178],256],12083:[[24186],256],12084:[[24191],256],12085:[[24308],256],12086:[[24318],256],12087:[[24331],256],12088:[[24339],256],12089:[[24400],256],12090:[[24417],256],12091:[[24435],256],12092:[[24515],256],12093:[[25096],256],12094:[[25142],256],12095:[[25163],256],12096:[[25903],256],12097:[[25908],256],12098:[[25991],256],12099:[[26007],256],12100:[[26020],256],12101:[[26041],256],12102:[[26080],256],12103:[[26085],256],12104:[[26352],256],12105:[[26376],256],12106:[[26408],256],12107:[[27424],256],12108:[[27490],256],12109:[[27513],256],12110:[[27571],256],12111:[[27595],256],12112:[[27604],256],12113:[[27611],256],12114:[[27663],256],12115:[[27668],256],12116:[[27700],256],12117:[[28779],256],12118:[[29226],256],12119:[[29238],256],12120:[[29243],256],12121:[[29247],256],12122:[[29255],256],12123:[[29273],256],12124:[[29275],256],12125:[[29356],256],12126:[[29572],256],12127:[[29577],256],12128:[[29916],256],12129:[[29926],256],12130:[[29976],256],12131:[[29983],256],12132:[[29992],256],12133:[[30000],256],12134:[[30091],256],12135:[[30098],256],12136:[[30326],256],12137:[[30333],256],12138:[[30382],256],12139:[[30399],256],12140:[[30446],256],12141:[[30683],256],12142:[[30690],256],12143:[[30707],256],12144:[[31034],256],12145:[[31160],256],12146:[[31166],256],12147:[[31348],256],12148:[[31435],256],12149:[[31481],256],12150:[[31859],256],12151:[[31992],256],12152:[[32566],256],12153:[[32593],256],12154:[[32650],256],12155:[[32701],256],12156:[[32769],256],12157:[[32780],256],12158:[[32786],256],12159:[[32819],256],12160:[[32895],256],12161:[[32905],256],12162:[[33251],256],12163:[[33258],256],12164:[[33267],256],12165:[[33276],256],12166:[[33292],256],12167:[[33307],256],12168:[[33311],256],12169:[[33390],256],12170:[[33394],256],12171:[[33400],256],12172:[[34381],256],12173:[[34411],256],12174:[[34880],256],12175:[[34892],256],12176:[[34915],256],12177:[[35198],256],12178:[[35211],256],12179:[[35282],256],12180:[[35328],256],12181:[[35895],256],12182:[[35910],256],12183:[[35925],256],12184:[[35960],256],12185:[[35997],256],12186:[[36196],256],12187:[[36208],256],12188:[[36275],256],12189:[[36523],256],12190:[[36554],256],12191:[[36763],256],12192:[[36784],256],12193:[[36789],256],12194:[[37009],256],12195:[[37193],256],12196:[[37318],256],12197:[[37324],256],12198:[[37329],256],12199:[[38263],256],12200:[[38272],256],12201:[[38428],256],12202:[[38582],256],12203:[[38585],256],12204:[[38632],256],12205:[[38737],256],12206:[[38750],256],12207:[[38754],256],12208:[[38761],256],12209:[[38859],256],12210:[[38893],256],12211:[[38899],256],12212:[[38913],256],12213:[[39080],256],12214:[[39131],256],12215:[[39135],256],12216:[[39318],256],12217:[[39321],256],12218:[[39340],256],12219:[[39592],256],12220:[[39640],256],12221:[[39647],256],12222:[[39717],256],12223:[[39727],256],12224:[[39730],256],12225:[[39740],256],12226:[[39770],256],12227:[[40165],256],12228:[[40565],256],12229:[[40575],256],12230:[[40613],256],12231:[[40635],256],12232:[[40643],256],12233:[[40653],256],12234:[[40657],256],12235:[[40697],256],12236:[[40701],256],12237:[[40718],256],12238:[[40723],256],12239:[[40736],256],12240:[[40763],256],12241:[[40778],256],12242:[[40786],256],12243:[[40845],256],12244:[[40860],256],12245:[[40864],256]},
12288:{12288:[[32],256],12330:[,218],12331:[,228],12332:[,232],12333:[,222],12334:[,224],12335:[,224],12342:[[12306],256],12344:[[21313],256],12345:[[21316],256],12346:[[21317],256],12358:[,,{12441:12436}],12363:[,,{12441:12364}],12364:[[12363,12441]],12365:[,,{12441:12366}],12366:[[12365,12441]],12367:[,,{12441:12368}],12368:[[12367,12441]],12369:[,,{12441:12370}],12370:[[12369,12441]],12371:[,,{12441:12372}],12372:[[12371,12441]],12373:[,,{12441:12374}],12374:[[12373,12441]],12375:[,,{12441:12376}],12376:[[12375,12441]],12377:[,,{12441:12378}],12378:[[12377,12441]],12379:[,,{12441:12380}],12380:[[12379,12441]],12381:[,,{12441:12382}],12382:[[12381,12441]],12383:[,,{12441:12384}],12384:[[12383,12441]],12385:[,,{12441:12386}],12386:[[12385,12441]],12388:[,,{12441:12389}],12389:[[12388,12441]],12390:[,,{12441:12391}],12391:[[12390,12441]],12392:[,,{12441:12393}],12393:[[12392,12441]],12399:[,,{12441:12400,12442:12401}],12400:[[12399,12441]],12401:[[12399,12442]],12402:[,,{12441:12403,12442:12404}],12403:[[12402,12441]],12404:[[12402,12442]],12405:[,,{12441:12406,12442:12407}],12406:[[12405,12441]],12407:[[12405,12442]],12408:[,,{12441:12409,12442:12410}],12409:[[12408,12441]],12410:[[12408,12442]],12411:[,,{12441:12412,12442:12413}],12412:[[12411,12441]],12413:[[12411,12442]],12436:[[12358,12441]],12441:[,8],12442:[,8],12443:[[32,12441],256],12444:[[32,12442],256],12445:[,,{12441:12446}],12446:[[12445,12441]],12447:[[12424,12426],256],12454:[,,{12441:12532}],12459:[,,{12441:12460}],12460:[[12459,12441]],12461:[,,{12441:12462}],12462:[[12461,12441]],12463:[,,{12441:12464}],12464:[[12463,12441]],12465:[,,{12441:12466}],12466:[[12465,12441]],12467:[,,{12441:12468}],12468:[[12467,12441]],12469:[,,{12441:12470}],12470:[[12469,12441]],12471:[,,{12441:12472}],12472:[[12471,12441]],12473:[,,{12441:12474}],12474:[[12473,12441]],12475:[,,{12441:12476}],12476:[[12475,12441]],12477:[,,{12441:12478}],12478:[[12477,12441]],12479:[,,{12441:12480}],12480:[[12479,12441]],12481:[,,{12441:12482}],12482:[[12481,12441]],12484:[,,{12441:12485}],12485:[[12484,12441]],12486:[,,{12441:12487}],12487:[[12486,12441]],12488:[,,{12441:12489}],12489:[[12488,12441]],12495:[,,{12441:12496,12442:12497}],12496:[[12495,12441]],12497:[[12495,12442]],12498:[,,{12441:12499,12442:12500}],12499:[[12498,12441]],12500:[[12498,12442]],12501:[,,{12441:12502,12442:12503}],12502:[[12501,12441]],12503:[[12501,12442]],12504:[,,{12441:12505,12442:12506}],12505:[[12504,12441]],12506:[[12504,12442]],12507:[,,{12441:12508,12442:12509}],12508:[[12507,12441]],12509:[[12507,12442]],12527:[,,{12441:12535}],12528:[,,{12441:12536}],12529:[,,{12441:12537}],12530:[,,{12441:12538}],12532:[[12454,12441]],12535:[[12527,12441]],12536:[[12528,12441]],12537:[[12529,12441]],12538:[[12530,12441]],12541:[,,{12441:12542}],12542:[[12541,12441]],12543:[[12467,12488],256]},
12544:{12593:[[4352],256],12594:[[4353],256],12595:[[4522],256],12596:[[4354],256],12597:[[4524],256],12598:[[4525],256],12599:[[4355],256],12600:[[4356],256],12601:[[4357],256],12602:[[4528],256],12603:[[4529],256],12604:[[4530],256],12605:[[4531],256],12606:[[4532],256],12607:[[4533],256],12608:[[4378],256],12609:[[4358],256],12610:[[4359],256],12611:[[4360],256],12612:[[4385],256],12613:[[4361],256],12614:[[4362],256],12615:[[4363],256],12616:[[4364],256],12617:[[4365],256],12618:[[4366],256],12619:[[4367],256],12620:[[4368],256],12621:[[4369],256],12622:[[4370],256],12623:[[4449],256],12624:[[4450],256],12625:[[4451],256],12626:[[4452],256],12627:[[4453],256],12628:[[4454],256],12629:[[4455],256],12630:[[4456],256],12631:[[4457],256],12632:[[4458],256],12633:[[4459],256],12634:[[4460],256],12635:[[4461],256],12636:[[4462],256],12637:[[4463],256],12638:[[4464],256],12639:[[4465],256],12640:[[4466],256],12641:[[4467],256],12642:[[4468],256],12643:[[4469],256],12644:[[4448],256],12645:[[4372],256],12646:[[4373],256],12647:[[4551],256],12648:[[4552],256],12649:[[4556],256],12650:[[4558],256],12651:[[4563],256],12652:[[4567],256],12653:[[4569],256],12654:[[4380],256],12655:[[4573],256],12656:[[4575],256],12657:[[4381],256],12658:[[4382],256],12659:[[4384],256],12660:[[4386],256],12661:[[4387],256],12662:[[4391],256],12663:[[4393],256],12664:[[4395],256],12665:[[4396],256],12666:[[4397],256],12667:[[4398],256],12668:[[4399],256],12669:[[4402],256],12670:[[4406],256],12671:[[4416],256],12672:[[4423],256],12673:[[4428],256],12674:[[4593],256],12675:[[4594],256],12676:[[4439],256],12677:[[4440],256],12678:[[4441],256],12679:[[4484],256],12680:[[4485],256],12681:[[4488],256],12682:[[4497],256],12683:[[4498],256],12684:[[4500],256],12685:[[4510],256],12686:[[4513],256],12690:[[19968],256],12691:[[20108],256],12692:[[19977],256],12693:[[22235],256],12694:[[19978],256],12695:[[20013],256],12696:[[19979],256],12697:[[30002],256],12698:[[20057],256],12699:[[19993],256],12700:[[19969],256],12701:[[22825],256],12702:[[22320],256],12703:[[20154],256]},
12800:{12800:[[40,4352,41],256],12801:[[40,4354,41],256],12802:[[40,4355,41],256],12803:[[40,4357,41],256],12804:[[40,4358,41],256],12805:[[40,4359,41],256],12806:[[40,4361,41],256],12807:[[40,4363,41],256],12808:[[40,4364,41],256],12809:[[40,4366,41],256],12810:[[40,4367,41],256],12811:[[40,4368,41],256],12812:[[40,4369,41],256],12813:[[40,4370,41],256],12814:[[40,4352,4449,41],256],12815:[[40,4354,4449,41],256],12816:[[40,4355,4449,41],256],12817:[[40,4357,4449,41],256],12818:[[40,4358,4449,41],256],12819:[[40,4359,4449,41],256],12820:[[40,4361,4449,41],256],12821:[[40,4363,4449,41],256],12822:[[40,4364,4449,41],256],12823:[[40,4366,4449,41],256],12824:[[40,4367,4449,41],256],12825:[[40,4368,4449,41],256],12826:[[40,4369,4449,41],256],12827:[[40,4370,4449,41],256],12828:[[40,4364,4462,41],256],12829:[[40,4363,4457,4364,4453,4523,41],256],12830:[[40,4363,4457,4370,4462,41],256],12832:[[40,19968,41],256],12833:[[40,20108,41],256],12834:[[40,19977,41],256],12835:[[40,22235,41],256],12836:[[40,20116,41],256],12837:[[40,20845,41],256],12838:[[40,19971,41],256],12839:[[40,20843,41],256],12840:[[40,20061,41],256],12841:[[40,21313,41],256],12842:[[40,26376,41],256],12843:[[40,28779,41],256],12844:[[40,27700,41],256],12845:[[40,26408,41],256],12846:[[40,37329,41],256],12847:[[40,22303,41],256],12848:[[40,26085,41],256],12849:[[40,26666,41],256],12850:[[40,26377,41],256],12851:[[40,31038,41],256],12852:[[40,21517,41],256],12853:[[40,29305,41],256],12854:[[40,36001,41],256],12855:[[40,31069,41],256],12856:[[40,21172,41],256],12857:[[40,20195,41],256],12858:[[40,21628,41],256],12859:[[40,23398,41],256],12860:[[40,30435,41],256],12861:[[40,20225,41],256],12862:[[40,36039,41],256],12863:[[40,21332,41],256],12864:[[40,31085,41],256],12865:[[40,20241,41],256],12866:[[40,33258,41],256],12867:[[40,33267,41],256],12868:[[21839],256],12869:[[24188],256],12870:[[25991],256],12871:[[31631],256],12880:[[80,84,69],256],12881:[[50,49],256],12882:[[50,50],256],12883:[[50,51],256],12884:[[50,52],256],12885:[[50,53],256],12886:[[50,54],256],12887:[[50,55],256],12888:[[50,56],256],12889:[[50,57],256],12890:[[51,48],256],12891:[[51,49],256],12892:[[51,50],256],12893:[[51,51],256],12894:[[51,52],256],12895:[[51,53],256],12896:[[4352],256],12897:[[4354],256],12898:[[4355],256],12899:[[4357],256],12900:[[4358],256],12901:[[4359],256],12902:[[4361],256],12903:[[4363],256],12904:[[4364],256],12905:[[4366],256],12906:[[4367],256],12907:[[4368],256],12908:[[4369],256],12909:[[4370],256],12910:[[4352,4449],256],12911:[[4354,4449],256],12912:[[4355,4449],256],12913:[[4357,4449],256],12914:[[4358,4449],256],12915:[[4359,4449],256],12916:[[4361,4449],256],12917:[[4363,4449],256],12918:[[4364,4449],256],12919:[[4366,4449],256],12920:[[4367,4449],256],12921:[[4368,4449],256],12922:[[4369,4449],256],12923:[[4370,4449],256],12924:[[4366,4449,4535,4352,4457],256],12925:[[4364,4462,4363,4468],256],12926:[[4363,4462],256],12928:[[19968],256],12929:[[20108],256],12930:[[19977],256],12931:[[22235],256],12932:[[20116],256],12933:[[20845],256],12934:[[19971],256],12935:[[20843],256],12936:[[20061],256],12937:[[21313],256],12938:[[26376],256],12939:[[28779],256],12940:[[27700],256],12941:[[26408],256],12942:[[37329],256],12943:[[22303],256],12944:[[26085],256],12945:[[26666],256],12946:[[26377],256],12947:[[31038],256],12948:[[21517],256],12949:[[29305],256],12950:[[36001],256],12951:[[31069],256],12952:[[21172],256],12953:[[31192],256],12954:[[30007],256],12955:[[22899],256],12956:[[36969],256],12957:[[20778],256],12958:[[21360],256],12959:[[27880],256],12960:[[38917],256],12961:[[20241],256],12962:[[20889],256],12963:[[27491],256],12964:[[19978],256],12965:[[20013],256],12966:[[19979],256],12967:[[24038],256],12968:[[21491],256],12969:[[21307],256],12970:[[23447],256],12971:[[23398],256],12972:[[30435],256],12973:[[20225],256],12974:[[36039],256],12975:[[21332],256],12976:[[22812],256],12977:[[51,54],256],12978:[[51,55],256],12979:[[51,56],256],12980:[[51,57],256],12981:[[52,48],256],12982:[[52,49],256],12983:[[52,50],256],12984:[[52,51],256],12985:[[52,52],256],12986:[[52,53],256],12987:[[52,54],256],12988:[[52,55],256],12989:[[52,56],256],12990:[[52,57],256],12991:[[53,48],256],12992:[[49,26376],256],12993:[[50,26376],256],12994:[[51,26376],256],12995:[[52,26376],256],12996:[[53,26376],256],12997:[[54,26376],256],12998:[[55,26376],256],12999:[[56,26376],256],13000:[[57,26376],256],13001:[[49,48,26376],256],13002:[[49,49,26376],256],13003:[[49,50,26376],256],13004:[[72,103],256],13005:[[101,114,103],256],13006:[[101,86],256],13007:[[76,84,68],256],13008:[[12450],256],13009:[[12452],256],13010:[[12454],256],13011:[[12456],256],13012:[[12458],256],13013:[[12459],256],13014:[[12461],256],13015:[[12463],256],13016:[[12465],256],13017:[[12467],256],13018:[[12469],256],13019:[[12471],256],13020:[[12473],256],13021:[[12475],256],13022:[[12477],256],13023:[[12479],256],13024:[[12481],256],13025:[[12484],256],13026:[[12486],256],13027:[[12488],256],13028:[[12490],256],13029:[[12491],256],13030:[[12492],256],13031:[[12493],256],13032:[[12494],256],13033:[[12495],256],13034:[[12498],256],13035:[[12501],256],13036:[[12504],256],13037:[[12507],256],13038:[[12510],256],13039:[[12511],256],13040:[[12512],256],13041:[[12513],256],13042:[[12514],256],13043:[[12516],256],13044:[[12518],256],13045:[[12520],256],13046:[[12521],256],13047:[[12522],256],13048:[[12523],256],13049:[[12524],256],13050:[[12525],256],13051:[[12527],256],13052:[[12528],256],13053:[[12529],256],13054:[[12530],256]},
13056:{13056:[[12450,12497,12540,12488],256],13057:[[12450,12523,12501,12449],256],13058:[[12450,12531,12506,12450],256],13059:[[12450,12540,12523],256],13060:[[12452,12491,12531,12464],256],13061:[[12452,12531,12481],256],13062:[[12454,12457,12531],256],13063:[[12456,12473,12463,12540,12489],256],13064:[[12456,12540,12459,12540],256],13065:[[12458,12531,12473],256],13066:[[12458,12540,12512],256],13067:[[12459,12452,12522],256],13068:[[12459,12521,12483,12488],256],13069:[[12459,12525,12522,12540],256],13070:[[12460,12525,12531],256],13071:[[12460,12531,12510],256],13072:[[12462,12460],256],13073:[[12462,12491,12540],256],13074:[[12461,12517,12522,12540],256],13075:[[12462,12523,12480,12540],256],13076:[[12461,12525],256],13077:[[12461,12525,12464,12521,12512],256],13078:[[12461,12525,12513,12540,12488,12523],256],13079:[[12461,12525,12527,12483,12488],256],13080:[[12464,12521,12512],256],13081:[[12464,12521,12512,12488,12531],256],13082:[[12463,12523,12476,12452,12525],256],13083:[[12463,12525,12540,12493],256],13084:[[12465,12540,12473],256],13085:[[12467,12523,12490],256],13086:[[12467,12540,12509],256],13087:[[12469,12452,12463,12523],256],13088:[[12469,12531,12481,12540,12512],256],13089:[[12471,12522,12531,12464],256],13090:[[12475,12531,12481],256],13091:[[12475,12531,12488],256],13092:[[12480,12540,12473],256],13093:[[12487,12471],256],13094:[[12489,12523],256],13095:[[12488,12531],256],13096:[[12490,12494],256],13097:[[12494,12483,12488],256],13098:[[12495,12452,12484],256],13099:[[12497,12540,12475,12531,12488],256],13100:[[12497,12540,12484],256],13101:[[12496,12540,12524,12523],256],13102:[[12500,12450,12473,12488,12523],256],13103:[[12500,12463,12523],256],13104:[[12500,12467],256],13105:[[12499,12523],256],13106:[[12501,12449,12521,12483,12489],256],13107:[[12501,12451,12540,12488],256],13108:[[12502,12483,12471,12455,12523],256],13109:[[12501,12521,12531],256],13110:[[12504,12463,12479,12540,12523],256],13111:[[12506,12477],256],13112:[[12506,12491,12498],256],13113:[[12504,12523,12484],256],13114:[[12506,12531,12473],256],13115:[[12506,12540,12472],256],13116:[[12505,12540,12479],256],13117:[[12509,12452,12531,12488],256],13118:[[12508,12523,12488],256],13119:[[12507,12531],256],13120:[[12509,12531,12489],256],13121:[[12507,12540,12523],256],13122:[[12507,12540,12531],256],13123:[[12510,12452,12463,12525],256],13124:[[12510,12452,12523],256],13125:[[12510,12483,12495],256],13126:[[12510,12523,12463],256],13127:[[12510,12531,12471,12519,12531],256],13128:[[12511,12463,12525,12531],256],13129:[[12511,12522],256],13130:[[12511,12522,12496,12540,12523],256],13131:[[12513,12460],256],13132:[[12513,12460,12488,12531],256],13133:[[12513,12540,12488,12523],256],13134:[[12516,12540,12489],256],13135:[[12516,12540,12523],256],13136:[[12518,12450,12531],256],13137:[[12522,12483,12488,12523],256],13138:[[12522,12521],256],13139:[[12523,12500,12540],256],13140:[[12523,12540,12502,12523],256],13141:[[12524,12512],256],13142:[[12524,12531,12488,12466,12531],256],13143:[[12527,12483,12488],256],13144:[[48,28857],256],13145:[[49,28857],256],13146:[[50,28857],256],13147:[[51,28857],256],13148:[[52,28857],256],13149:[[53,28857],256],13150:[[54,28857],256],13151:[[55,28857],256],13152:[[56,28857],256],13153:[[57,28857],256],13154:[[49,48,28857],256],13155:[[49,49,28857],256],13156:[[49,50,28857],256],13157:[[49,51,28857],256],13158:[[49,52,28857],256],13159:[[49,53,28857],256],13160:[[49,54,28857],256],13161:[[49,55,28857],256],13162:[[49,56,28857],256],13163:[[49,57,28857],256],13164:[[50,48,28857],256],13165:[[50,49,28857],256],13166:[[50,50,28857],256],13167:[[50,51,28857],256],13168:[[50,52,28857],256],13169:[[104,80,97],256],13170:[[100,97],256],13171:[[65,85],256],13172:[[98,97,114],256],13173:[[111,86],256],13174:[[112,99],256],13175:[[100,109],256],13176:[[100,109,178],256],13177:[[100,109,179],256],13178:[[73,85],256],13179:[[24179,25104],256],13180:[[26157,21644],256],13181:[[22823,27491],256],13182:[[26126,27835],256],13183:[[26666,24335,20250,31038],256],13184:[[112,65],256],13185:[[110,65],256],13186:[[956,65],256],13187:[[109,65],256],13188:[[107,65],256],13189:[[75,66],256],13190:[[77,66],256],13191:[[71,66],256],13192:[[99,97,108],256],13193:[[107,99,97,108],256],13194:[[112,70],256],13195:[[110,70],256],13196:[[956,70],256],13197:[[956,103],256],13198:[[109,103],256],13199:[[107,103],256],13200:[[72,122],256],13201:[[107,72,122],256],13202:[[77,72,122],256],13203:[[71,72,122],256],13204:[[84,72,122],256],13205:[[956,8467],256],13206:[[109,8467],256],13207:[[100,8467],256],13208:[[107,8467],256],13209:[[102,109],256],13210:[[110,109],256],13211:[[956,109],256],13212:[[109,109],256],13213:[[99,109],256],13214:[[107,109],256],13215:[[109,109,178],256],13216:[[99,109,178],256],13217:[[109,178],256],13218:[[107,109,178],256],13219:[[109,109,179],256],13220:[[99,109,179],256],13221:[[109,179],256],13222:[[107,109,179],256],13223:[[109,8725,115],256],13224:[[109,8725,115,178],256],13225:[[80,97],256],13226:[[107,80,97],256],13227:[[77,80,97],256],13228:[[71,80,97],256],13229:[[114,97,100],256],13230:[[114,97,100,8725,115],256],13231:[[114,97,100,8725,115,178],256],13232:[[112,115],256],13233:[[110,115],256],13234:[[956,115],256],13235:[[109,115],256],13236:[[112,86],256],13237:[[110,86],256],13238:[[956,86],256],13239:[[109,86],256],13240:[[107,86],256],13241:[[77,86],256],13242:[[112,87],256],13243:[[110,87],256],13244:[[956,87],256],13245:[[109,87],256],13246:[[107,87],256],13247:[[77,87],256],13248:[[107,937],256],13249:[[77,937],256],13250:[[97,46,109,46],256],13251:[[66,113],256],13252:[[99,99],256],13253:[[99,100],256],13254:[[67,8725,107,103],256],13255:[[67,111,46],256],13256:[[100,66],256],13257:[[71,121],256],13258:[[104,97],256],13259:[[72,80],256],13260:[[105,110],256],13261:[[75,75],256],13262:[[75,77],256],13263:[[107,116],256],13264:[[108,109],256],13265:[[108,110],256],13266:[[108,111,103],256],13267:[[108,120],256],13268:[[109,98],256],13269:[[109,105,108],256],13270:[[109,111,108],256],13271:[[80,72],256],13272:[[112,46,109,46],256],13273:[[80,80,77],256],13274:[[80,82],256],13275:[[115,114],256],13276:[[83,118],256],13277:[[87,98],256],13278:[[86,8725,109],256],13279:[[65,8725,109],256],13280:[[49,26085],256],13281:[[50,26085],256],13282:[[51,26085],256],13283:[[52,26085],256],13284:[[53,26085],256],13285:[[54,26085],256],13286:[[55,26085],256],13287:[[56,26085],256],13288:[[57,26085],256],13289:[[49,48,26085],256],13290:[[49,49,26085],256],13291:[[49,50,26085],256],13292:[[49,51,26085],256],13293:[[49,52,26085],256],13294:[[49,53,26085],256],13295:[[49,54,26085],256],13296:[[49,55,26085],256],13297:[[49,56,26085],256],13298:[[49,57,26085],256],13299:[[50,48,26085],256],13300:[[50,49,26085],256],13301:[[50,50,26085],256],13302:[[50,51,26085],256],13303:[[50,52,26085],256],13304:[[50,53,26085],256],13305:[[50,54,26085],256],13306:[[50,55,26085],256],13307:[[50,56,26085],256],13308:[[50,57,26085],256],13309:[[51,48,26085],256],13310:[[51,49,26085],256],13311:[[103,97,108],256]},
42496:{42607:[,230],42612:[,230],42613:[,230],42614:[,230],42615:[,230],42616:[,230],42617:[,230],42618:[,230],42619:[,230],42620:[,230],42621:[,230],42655:[,230],42736:[,230],42737:[,230]},
42752:{42864:[[42863],256],43000:[[294],256],43001:[[339],256]},
43008:{43014:[,9],43204:[,9],43232:[,230],43233:[,230],43234:[,230],43235:[,230],43236:[,230],43237:[,230],43238:[,230],43239:[,230],43240:[,230],43241:[,230],43242:[,230],43243:[,230],43244:[,230],43245:[,230],43246:[,230],43247:[,230],43248:[,230],43249:[,230]},
43264:{43307:[,220],43308:[,220],43309:[,220],43347:[,9],43443:[,7],43456:[,9]},
43520:{43696:[,230],43698:[,230],43699:[,230],43700:[,220],43703:[,230],43704:[,230],43710:[,230],43711:[,230],43713:[,230],43766:[,9]},
43776:{44013:[,9]},
53504:{119134:[[119127,119141],512],119135:[[119128,119141],512],119136:[[119135,119150],512],119137:[[119135,119151],512],119138:[[119135,119152],512],119139:[[119135,119153],512],119140:[[119135,119154],512],119141:[,216],119142:[,216],119143:[,1],119144:[,1],119145:[,1],119149:[,226],119150:[,216],119151:[,216],119152:[,216],119153:[,216],119154:[,216],119163:[,220],119164:[,220],119165:[,220],119166:[,220],119167:[,220],119168:[,220],119169:[,220],119170:[,220],119173:[,230],119174:[,230],119175:[,230],119176:[,230],119177:[,230],119178:[,220],119179:[,220],119210:[,230],119211:[,230],119212:[,230],119213:[,230],119227:[[119225,119141],512],119228:[[119226,119141],512],119229:[[119227,119150],512],119230:[[119228,119150],512],119231:[[119227,119151],512],119232:[[119228,119151],512]},
53760:{119362:[,230],119363:[,230],119364:[,230]},
54272:{119808:[[65],256],119809:[[66],256],119810:[[67],256],119811:[[68],256],119812:[[69],256],119813:[[70],256],119814:[[71],256],119815:[[72],256],119816:[[73],256],119817:[[74],256],119818:[[75],256],119819:[[76],256],119820:[[77],256],119821:[[78],256],119822:[[79],256],119823:[[80],256],119824:[[81],256],119825:[[82],256],119826:[[83],256],119827:[[84],256],119828:[[85],256],119829:[[86],256],119830:[[87],256],119831:[[88],256],119832:[[89],256],119833:[[90],256],119834:[[97],256],119835:[[98],256],119836:[[99],256],119837:[[100],256],119838:[[101],256],119839:[[102],256],119840:[[103],256],119841:[[104],256],119842:[[105],256],119843:[[106],256],119844:[[107],256],119845:[[108],256],119846:[[109],256],119847:[[110],256],119848:[[111],256],119849:[[112],256],119850:[[113],256],119851:[[114],256],119852:[[115],256],119853:[[116],256],119854:[[117],256],119855:[[118],256],119856:[[119],256],119857:[[120],256],119858:[[121],256],119859:[[122],256],119860:[[65],256],119861:[[66],256],119862:[[67],256],119863:[[68],256],119864:[[69],256],119865:[[70],256],119866:[[71],256],119867:[[72],256],119868:[[73],256],119869:[[74],256],119870:[[75],256],119871:[[76],256],119872:[[77],256],119873:[[78],256],119874:[[79],256],119875:[[80],256],119876:[[81],256],119877:[[82],256],119878:[[83],256],119879:[[84],256],119880:[[85],256],119881:[[86],256],119882:[[87],256],119883:[[88],256],119884:[[89],256],119885:[[90],256],119886:[[97],256],119887:[[98],256],119888:[[99],256],119889:[[100],256],119890:[[101],256],119891:[[102],256],119892:[[103],256],119894:[[105],256],119895:[[106],256],119896:[[107],256],119897:[[108],256],119898:[[109],256],119899:[[110],256],119900:[[111],256],119901:[[112],256],119902:[[113],256],119903:[[114],256],119904:[[115],256],119905:[[116],256],119906:[[117],256],119907:[[118],256],119908:[[119],256],119909:[[120],256],119910:[[121],256],119911:[[122],256],119912:[[65],256],119913:[[66],256],119914:[[67],256],119915:[[68],256],119916:[[69],256],119917:[[70],256],119918:[[71],256],119919:[[72],256],119920:[[73],256],119921:[[74],256],119922:[[75],256],119923:[[76],256],119924:[[77],256],119925:[[78],256],119926:[[79],256],119927:[[80],256],119928:[[81],256],119929:[[82],256],119930:[[83],256],119931:[[84],256],119932:[[85],256],119933:[[86],256],119934:[[87],256],119935:[[88],256],119936:[[89],256],119937:[[90],256],119938:[[97],256],119939:[[98],256],119940:[[99],256],119941:[[100],256],119942:[[101],256],119943:[[102],256],119944:[[103],256],119945:[[104],256],119946:[[105],256],119947:[[106],256],119948:[[107],256],119949:[[108],256],119950:[[109],256],119951:[[110],256],119952:[[111],256],119953:[[112],256],119954:[[113],256],119955:[[114],256],119956:[[115],256],119957:[[116],256],119958:[[117],256],119959:[[118],256],119960:[[119],256],119961:[[120],256],119962:[[121],256],119963:[[122],256],119964:[[65],256],119966:[[67],256],119967:[[68],256],119970:[[71],256],119973:[[74],256],119974:[[75],256],119977:[[78],256],119978:[[79],256],119979:[[80],256],119980:[[81],256],119982:[[83],256],119983:[[84],256],119984:[[85],256],119985:[[86],256],119986:[[87],256],119987:[[88],256],119988:[[89],256],119989:[[90],256],119990:[[97],256],119991:[[98],256],119992:[[99],256],119993:[[100],256],119995:[[102],256],119997:[[104],256],119998:[[105],256],119999:[[106],256],120000:[[107],256],120001:[[108],256],120002:[[109],256],120003:[[110],256],120005:[[112],256],120006:[[113],256],120007:[[114],256],120008:[[115],256],120009:[[116],256],120010:[[117],256],120011:[[118],256],120012:[[119],256],120013:[[120],256],120014:[[121],256],120015:[[122],256],120016:[[65],256],120017:[[66],256],120018:[[67],256],120019:[[68],256],120020:[[69],256],120021:[[70],256],120022:[[71],256],120023:[[72],256],120024:[[73],256],120025:[[74],256],120026:[[75],256],120027:[[76],256],120028:[[77],256],120029:[[78],256],120030:[[79],256],120031:[[80],256],120032:[[81],256],120033:[[82],256],120034:[[83],256],120035:[[84],256],120036:[[85],256],120037:[[86],256],120038:[[87],256],120039:[[88],256],120040:[[89],256],120041:[[90],256],120042:[[97],256],120043:[[98],256],120044:[[99],256],120045:[[100],256],120046:[[101],256],120047:[[102],256],120048:[[103],256],120049:[[104],256],120050:[[105],256],120051:[[106],256],120052:[[107],256],120053:[[108],256],120054:[[109],256],120055:[[110],256],120056:[[111],256],120057:[[112],256],120058:[[113],256],120059:[[114],256],120060:[[115],256],120061:[[116],256],120062:[[117],256],120063:[[118],256]},
54528:{120064:[[119],256],120065:[[120],256],120066:[[121],256],120067:[[122],256],120068:[[65],256],120069:[[66],256],120071:[[68],256],120072:[[69],256],120073:[[70],256],120074:[[71],256],120077:[[74],256],120078:[[75],256],120079:[[76],256],120080:[[77],256],120081:[[78],256],120082:[[79],256],120083:[[80],256],120084:[[81],256],120086:[[83],256],120087:[[84],256],120088:[[85],256],120089:[[86],256],120090:[[87],256],120091:[[88],256],120092:[[89],256],120094:[[97],256],120095:[[98],256],120096:[[99],256],120097:[[100],256],120098:[[101],256],120099:[[102],256],120100:[[103],256],120101:[[104],256],120102:[[105],256],120103:[[106],256],120104:[[107],256],120105:[[108],256],120106:[[109],256],120107:[[110],256],120108:[[111],256],120109:[[112],256],120110:[[113],256],120111:[[114],256],120112:[[115],256],120113:[[116],256],120114:[[117],256],120115:[[118],256],120116:[[119],256],120117:[[120],256],120118:[[121],256],120119:[[122],256],120120:[[65],256],120121:[[66],256],120123:[[68],256],120124:[[69],256],120125:[[70],256],120126:[[71],256],120128:[[73],256],120129:[[74],256],120130:[[75],256],120131:[[76],256],120132:[[77],256],120134:[[79],256],120138:[[83],256],120139:[[84],256],120140:[[85],256],120141:[[86],256],120142:[[87],256],120143:[[88],256],120144:[[89],256],120146:[[97],256],120147:[[98],256],120148:[[99],256],120149:[[100],256],120150:[[101],256],120151:[[102],256],120152:[[103],256],120153:[[104],256],120154:[[105],256],120155:[[106],256],120156:[[107],256],120157:[[108],256],120158:[[109],256],120159:[[110],256],120160:[[111],256],120161:[[112],256],120162:[[113],256],120163:[[114],256],120164:[[115],256],120165:[[116],256],120166:[[117],256],120167:[[118],256],120168:[[119],256],120169:[[120],256],120170:[[121],256],120171:[[122],256],120172:[[65],256],120173:[[66],256],120174:[[67],256],120175:[[68],256],120176:[[69],256],120177:[[70],256],120178:[[71],256],120179:[[72],256],120180:[[73],256],120181:[[74],256],120182:[[75],256],120183:[[76],256],120184:[[77],256],120185:[[78],256],120186:[[79],256],120187:[[80],256],120188:[[81],256],120189:[[82],256],120190:[[83],256],120191:[[84],256],120192:[[85],256],120193:[[86],256],120194:[[87],256],120195:[[88],256],120196:[[89],256],120197:[[90],256],120198:[[97],256],120199:[[98],256],120200:[[99],256],120201:[[100],256],120202:[[101],256],120203:[[102],256],120204:[[103],256],120205:[[104],256],120206:[[105],256],120207:[[106],256],120208:[[107],256],120209:[[108],256],120210:[[109],256],120211:[[110],256],120212:[[111],256],120213:[[112],256],120214:[[113],256],120215:[[114],256],120216:[[115],256],120217:[[116],256],120218:[[117],256],120219:[[118],256],120220:[[119],256],120221:[[120],256],120222:[[121],256],120223:[[122],256],120224:[[65],256],120225:[[66],256],120226:[[67],256],120227:[[68],256],120228:[[69],256],120229:[[70],256],120230:[[71],256],120231:[[72],256],120232:[[73],256],120233:[[74],256],120234:[[75],256],120235:[[76],256],120236:[[77],256],120237:[[78],256],120238:[[79],256],120239:[[80],256],120240:[[81],256],120241:[[82],256],120242:[[83],256],120243:[[84],256],120244:[[85],256],120245:[[86],256],120246:[[87],256],120247:[[88],256],120248:[[89],256],120249:[[90],256],120250:[[97],256],120251:[[98],256],120252:[[99],256],120253:[[100],256],120254:[[101],256],120255:[[102],256],120256:[[103],256],120257:[[104],256],120258:[[105],256],120259:[[106],256],120260:[[107],256],120261:[[108],256],120262:[[109],256],120263:[[110],256],120264:[[111],256],120265:[[112],256],120266:[[113],256],120267:[[114],256],120268:[[115],256],120269:[[116],256],120270:[[117],256],120271:[[118],256],120272:[[119],256],120273:[[120],256],120274:[[121],256],120275:[[122],256],120276:[[65],256],120277:[[66],256],120278:[[67],256],120279:[[68],256],120280:[[69],256],120281:[[70],256],120282:[[71],256],120283:[[72],256],120284:[[73],256],120285:[[74],256],120286:[[75],256],120287:[[76],256],120288:[[77],256],120289:[[78],256],120290:[[79],256],120291:[[80],256],120292:[[81],256],120293:[[82],256],120294:[[83],256],120295:[[84],256],120296:[[85],256],120297:[[86],256],120298:[[87],256],120299:[[88],256],120300:[[89],256],120301:[[90],256],120302:[[97],256],120303:[[98],256],120304:[[99],256],120305:[[100],256],120306:[[101],256],120307:[[102],256],120308:[[103],256],120309:[[104],256],120310:[[105],256],120311:[[106],256],120312:[[107],256],120313:[[108],256],120314:[[109],256],120315:[[110],256],120316:[[111],256],120317:[[112],256],120318:[[113],256],120319:[[114],256]},
54784:{120320:[[115],256],120321:[[116],256],120322:[[117],256],120323:[[118],256],120324:[[119],256],120325:[[120],256],120326:[[121],256],120327:[[122],256],120328:[[65],256],120329:[[66],256],120330:[[67],256],120331:[[68],256],120332:[[69],256],120333:[[70],256],120334:[[71],256],120335:[[72],256],120336:[[73],256],120337:[[74],256],120338:[[75],256],120339:[[76],256],120340:[[77],256],120341:[[78],256],120342:[[79],256],120343:[[80],256],120344:[[81],256],120345:[[82],256],120346:[[83],256],120347:[[84],256],120348:[[85],256],120349:[[86],256],120350:[[87],256],120351:[[88],256],120352:[[89],256],120353:[[90],256],120354:[[97],256],120355:[[98],256],120356:[[99],256],120357:[[100],256],120358:[[101],256],120359:[[102],256],120360:[[103],256],120361:[[104],256],120362:[[105],256],120363:[[106],256],120364:[[107],256],120365:[[108],256],120366:[[109],256],120367:[[110],256],120368:[[111],256],120369:[[112],256],120370:[[113],256],120371:[[114],256],120372:[[115],256],120373:[[116],256],120374:[[117],256],120375:[[118],256],120376:[[119],256],120377:[[120],256],120378:[[121],256],120379:[[122],256],120380:[[65],256],120381:[[66],256],120382:[[67],256],120383:[[68],256],120384:[[69],256],120385:[[70],256],120386:[[71],256],120387:[[72],256],120388:[[73],256],120389:[[74],256],120390:[[75],256],120391:[[76],256],120392:[[77],256],120393:[[78],256],120394:[[79],256],120395:[[80],256],120396:[[81],256],120397:[[82],256],120398:[[83],256],120399:[[84],256],120400:[[85],256],120401:[[86],256],120402:[[87],256],120403:[[88],256],120404:[[89],256],120405:[[90],256],120406:[[97],256],120407:[[98],256],120408:[[99],256],120409:[[100],256],120410:[[101],256],120411:[[102],256],120412:[[103],256],120413:[[104],256],120414:[[105],256],120415:[[106],256],120416:[[107],256],120417:[[108],256],120418:[[109],256],120419:[[110],256],120420:[[111],256],120421:[[112],256],120422:[[113],256],120423:[[114],256],120424:[[115],256],120425:[[116],256],120426:[[117],256],120427:[[118],256],120428:[[119],256],120429:[[120],256],120430:[[121],256],120431:[[122],256],120432:[[65],256],120433:[[66],256],120434:[[67],256],120435:[[68],256],120436:[[69],256],120437:[[70],256],120438:[[71],256],120439:[[72],256],120440:[[73],256],120441:[[74],256],120442:[[75],256],120443:[[76],256],120444:[[77],256],120445:[[78],256],120446:[[79],256],120447:[[80],256],120448:[[81],256],120449:[[82],256],120450:[[83],256],120451:[[84],256],120452:[[85],256],120453:[[86],256],120454:[[87],256],120455:[[88],256],120456:[[89],256],120457:[[90],256],120458:[[97],256],120459:[[98],256],120460:[[99],256],120461:[[100],256],120462:[[101],256],120463:[[102],256],120464:[[103],256],120465:[[104],256],120466:[[105],256],120467:[[106],256],120468:[[107],256],120469:[[108],256],120470:[[109],256],120471:[[110],256],120472:[[111],256],120473:[[112],256],120474:[[113],256],120475:[[114],256],120476:[[115],256],120477:[[116],256],120478:[[117],256],120479:[[118],256],120480:[[119],256],120481:[[120],256],120482:[[121],256],120483:[[122],256],120484:[[305],256],120485:[[567],256],120488:[[913],256],120489:[[914],256],120490:[[915],256],120491:[[916],256],120492:[[917],256],120493:[[918],256],120494:[[919],256],120495:[[920],256],120496:[[921],256],120497:[[922],256],120498:[[923],256],120499:[[924],256],120500:[[925],256],120501:[[926],256],120502:[[927],256],120503:[[928],256],120504:[[929],256],120505:[[1012],256],120506:[[931],256],120507:[[932],256],120508:[[933],256],120509:[[934],256],120510:[[935],256],120511:[[936],256],120512:[[937],256],120513:[[8711],256],120514:[[945],256],120515:[[946],256],120516:[[947],256],120517:[[948],256],120518:[[949],256],120519:[[950],256],120520:[[951],256],120521:[[952],256],120522:[[953],256],120523:[[954],256],120524:[[955],256],120525:[[956],256],120526:[[957],256],120527:[[958],256],120528:[[959],256],120529:[[960],256],120530:[[961],256],120531:[[962],256],120532:[[963],256],120533:[[964],256],120534:[[965],256],120535:[[966],256],120536:[[967],256],120537:[[968],256],120538:[[969],256],120539:[[8706],256],120540:[[1013],256],120541:[[977],256],120542:[[1008],256],120543:[[981],256],120544:[[1009],256],120545:[[982],256],120546:[[913],256],120547:[[914],256],120548:[[915],256],120549:[[916],256],120550:[[917],256],120551:[[918],256],120552:[[919],256],120553:[[920],256],120554:[[921],256],120555:[[922],256],120556:[[923],256],120557:[[924],256],120558:[[925],256],120559:[[926],256],120560:[[927],256],120561:[[928],256],120562:[[929],256],120563:[[1012],256],120564:[[931],256],120565:[[932],256],120566:[[933],256],120567:[[934],256],120568:[[935],256],120569:[[936],256],120570:[[937],256],120571:[[8711],256],120572:[[945],256],120573:[[946],256],120574:[[947],256],120575:[[948],256]},
55040:{120576:[[949],256],120577:[[950],256],120578:[[951],256],120579:[[952],256],120580:[[953],256],120581:[[954],256],120582:[[955],256],120583:[[956],256],120584:[[957],256],120585:[[958],256],120586:[[959],256],120587:[[960],256],120588:[[961],256],120589:[[962],256],120590:[[963],256],120591:[[964],256],120592:[[965],256],120593:[[966],256],120594:[[967],256],120595:[[968],256],120596:[[969],256],120597:[[8706],256],120598:[[1013],256],120599:[[977],256],120600:[[1008],256],120601:[[981],256],120602:[[1009],256],120603:[[982],256],120604:[[913],256],120605:[[914],256],120606:[[915],256],120607:[[916],256],120608:[[917],256],120609:[[918],256],120610:[[919],256],120611:[[920],256],120612:[[921],256],120613:[[922],256],120614:[[923],256],120615:[[924],256],120616:[[925],256],120617:[[926],256],120618:[[927],256],120619:[[928],256],120620:[[929],256],120621:[[1012],256],120622:[[931],256],120623:[[932],256],120624:[[933],256],120625:[[934],256],120626:[[935],256],120627:[[936],256],120628:[[937],256],120629:[[8711],256],120630:[[945],256],120631:[[946],256],120632:[[947],256],120633:[[948],256],120634:[[949],256],120635:[[950],256],120636:[[951],256],120637:[[952],256],120638:[[953],256],120639:[[954],256],120640:[[955],256],120641:[[956],256],120642:[[957],256],120643:[[958],256],120644:[[959],256],120645:[[960],256],120646:[[961],256],120647:[[962],256],120648:[[963],256],120649:[[964],256],120650:[[965],256],120651:[[966],256],120652:[[967],256],120653:[[968],256],120654:[[969],256],120655:[[8706],256],120656:[[1013],256],120657:[[977],256],120658:[[1008],256],120659:[[981],256],120660:[[1009],256],120661:[[982],256],120662:[[913],256],120663:[[914],256],120664:[[915],256],120665:[[916],256],120666:[[917],256],120667:[[918],256],120668:[[919],256],120669:[[920],256],120670:[[921],256],120671:[[922],256],120672:[[923],256],120673:[[924],256],120674:[[925],256],120675:[[926],256],120676:[[927],256],120677:[[928],256],120678:[[929],256],120679:[[1012],256],120680:[[931],256],120681:[[932],256],120682:[[933],256],120683:[[934],256],120684:[[935],256],120685:[[936],256],120686:[[937],256],120687:[[8711],256],120688:[[945],256],120689:[[946],256],120690:[[947],256],120691:[[948],256],120692:[[949],256],120693:[[950],256],120694:[[951],256],120695:[[952],256],120696:[[953],256],120697:[[954],256],120698:[[955],256],120699:[[956],256],120700:[[957],256],120701:[[958],256],120702:[[959],256],120703:[[960],256],120704:[[961],256],120705:[[962],256],120706:[[963],256],120707:[[964],256],120708:[[965],256],120709:[[966],256],120710:[[967],256],120711:[[968],256],120712:[[969],256],120713:[[8706],256],120714:[[1013],256],120715:[[977],256],120716:[[1008],256],120717:[[981],256],120718:[[1009],256],120719:[[982],256],120720:[[913],256],120721:[[914],256],120722:[[915],256],120723:[[916],256],120724:[[917],256],120725:[[918],256],120726:[[919],256],120727:[[920],256],120728:[[921],256],120729:[[922],256],120730:[[923],256],120731:[[924],256],120732:[[925],256],120733:[[926],256],120734:[[927],256],120735:[[928],256],120736:[[929],256],120737:[[1012],256],120738:[[931],256],120739:[[932],256],120740:[[933],256],120741:[[934],256],120742:[[935],256],120743:[[936],256],120744:[[937],256],120745:[[8711],256],120746:[[945],256],120747:[[946],256],120748:[[947],256],120749:[[948],256],120750:[[949],256],120751:[[950],256],120752:[[951],256],120753:[[952],256],120754:[[953],256],120755:[[954],256],120756:[[955],256],120757:[[956],256],120758:[[957],256],120759:[[958],256],120760:[[959],256],120761:[[960],256],120762:[[961],256],120763:[[962],256],120764:[[963],256],120765:[[964],256],120766:[[965],256],120767:[[966],256],120768:[[967],256],120769:[[968],256],120770:[[969],256],120771:[[8706],256],120772:[[1013],256],120773:[[977],256],120774:[[1008],256],120775:[[981],256],120776:[[1009],256],120777:[[982],256],120778:[[988],256],120779:[[989],256],120782:[[48],256],120783:[[49],256],120784:[[50],256],120785:[[51],256],120786:[[52],256],120787:[[53],256],120788:[[54],256],120789:[[55],256],120790:[[56],256],120791:[[57],256],120792:[[48],256],120793:[[49],256],120794:[[50],256],120795:[[51],256],120796:[[52],256],120797:[[53],256],120798:[[54],256],120799:[[55],256],120800:[[56],256],120801:[[57],256],120802:[[48],256],120803:[[49],256],120804:[[50],256],120805:[[51],256],120806:[[52],256],120807:[[53],256],120808:[[54],256],120809:[[55],256],120810:[[56],256],120811:[[57],256],120812:[[48],256],120813:[[49],256],120814:[[50],256],120815:[[51],256],120816:[[52],256],120817:[[53],256],120818:[[54],256],120819:[[55],256],120820:[[56],256],120821:[[57],256],120822:[[48],256],120823:[[49],256],120824:[[50],256],120825:[[51],256],120826:[[52],256],120827:[[53],256],120828:[[54],256],120829:[[55],256],120830:[[56],256],120831:[[57],256]},
60928:{126464:[[1575],256],126465:[[1576],256],126466:[[1580],256],126467:[[1583],256],126469:[[1608],256],126470:[[1586],256],126471:[[1581],256],126472:[[1591],256],126473:[[1610],256],126474:[[1603],256],126475:[[1604],256],126476:[[1605],256],126477:[[1606],256],126478:[[1587],256],126479:[[1593],256],126480:[[1601],256],126481:[[1589],256],126482:[[1602],256],126483:[[1585],256],126484:[[1588],256],126485:[[1578],256],126486:[[1579],256],126487:[[1582],256],126488:[[1584],256],126489:[[1590],256],126490:[[1592],256],126491:[[1594],256],126492:[[1646],256],126493:[[1722],256],126494:[[1697],256],126495:[[1647],256],126497:[[1576],256],126498:[[1580],256],126500:[[1607],256],126503:[[1581],256],126505:[[1610],256],126506:[[1603],256],126507:[[1604],256],126508:[[1605],256],126509:[[1606],256],126510:[[1587],256],126511:[[1593],256],126512:[[1601],256],126513:[[1589],256],126514:[[1602],256],126516:[[1588],256],126517:[[1578],256],126518:[[1579],256],126519:[[1582],256],126521:[[1590],256],126523:[[1594],256],126530:[[1580],256],126535:[[1581],256],126537:[[1610],256],126539:[[1604],256],126541:[[1606],256],126542:[[1587],256],126543:[[1593],256],126545:[[1589],256],126546:[[1602],256],126548:[[1588],256],126551:[[1582],256],126553:[[1590],256],126555:[[1594],256],126557:[[1722],256],126559:[[1647],256],126561:[[1576],256],126562:[[1580],256],126564:[[1607],256],126567:[[1581],256],126568:[[1591],256],126569:[[1610],256],126570:[[1603],256],126572:[[1605],256],126573:[[1606],256],126574:[[1587],256],126575:[[1593],256],126576:[[1601],256],126577:[[1589],256],126578:[[1602],256],126580:[[1588],256],126581:[[1578],256],126582:[[1579],256],126583:[[1582],256],126585:[[1590],256],126586:[[1592],256],126587:[[1594],256],126588:[[1646],256],126590:[[1697],256],126592:[[1575],256],126593:[[1576],256],126594:[[1580],256],126595:[[1583],256],126596:[[1607],256],126597:[[1608],256],126598:[[1586],256],126599:[[1581],256],126600:[[1591],256],126601:[[1610],256],126603:[[1604],256],126604:[[1605],256],126605:[[1606],256],126606:[[1587],256],126607:[[1593],256],126608:[[1601],256],126609:[[1589],256],126610:[[1602],256],126611:[[1585],256],126612:[[1588],256],126613:[[1578],256],126614:[[1579],256],126615:[[1582],256],126616:[[1584],256],126617:[[1590],256],126618:[[1592],256],126619:[[1594],256],126625:[[1576],256],126626:[[1580],256],126627:[[1583],256],126629:[[1608],256],126630:[[1586],256],126631:[[1581],256],126632:[[1591],256],126633:[[1610],256],126635:[[1604],256],126636:[[1605],256],126637:[[1606],256],126638:[[1587],256],126639:[[1593],256],126640:[[1601],256],126641:[[1589],256],126642:[[1602],256],126643:[[1585],256],126644:[[1588],256],126645:[[1578],256],126646:[[1579],256],126647:[[1582],256],126648:[[1584],256],126649:[[1590],256],126650:[[1592],256],126651:[[1594],256]},
61696:{127232:[[48,46],256],127233:[[48,44],256],127234:[[49,44],256],127235:[[50,44],256],127236:[[51,44],256],127237:[[52,44],256],127238:[[53,44],256],127239:[[54,44],256],127240:[[55,44],256],127241:[[56,44],256],127242:[[57,44],256],127248:[[40,65,41],256],127249:[[40,66,41],256],127250:[[40,67,41],256],127251:[[40,68,41],256],127252:[[40,69,41],256],127253:[[40,70,41],256],127254:[[40,71,41],256],127255:[[40,72,41],256],127256:[[40,73,41],256],127257:[[40,74,41],256],127258:[[40,75,41],256],127259:[[40,76,41],256],127260:[[40,77,41],256],127261:[[40,78,41],256],127262:[[40,79,41],256],127263:[[40,80,41],256],127264:[[40,81,41],256],127265:[[40,82,41],256],127266:[[40,83,41],256],127267:[[40,84,41],256],127268:[[40,85,41],256],127269:[[40,86,41],256],127270:[[40,87,41],256],127271:[[40,88,41],256],127272:[[40,89,41],256],127273:[[40,90,41],256],127274:[[12308,83,12309],256],127275:[[67],256],127276:[[82],256],127277:[[67,68],256],127278:[[87,90],256],127280:[[65],256],127281:[[66],256],127282:[[67],256],127283:[[68],256],127284:[[69],256],127285:[[70],256],127286:[[71],256],127287:[[72],256],127288:[[73],256],127289:[[74],256],127290:[[75],256],127291:[[76],256],127292:[[77],256],127293:[[78],256],127294:[[79],256],127295:[[80],256],127296:[[81],256],127297:[[82],256],127298:[[83],256],127299:[[84],256],127300:[[85],256],127301:[[86],256],127302:[[87],256],127303:[[88],256],127304:[[89],256],127305:[[90],256],127306:[[72,86],256],127307:[[77,86],256],127308:[[83,68],256],127309:[[83,83],256],127310:[[80,80,86],256],127311:[[87,67],256],127338:[[77,67],256],127339:[[77,68],256],127376:[[68,74],256]},
61952:{127488:[[12411,12363],256],127489:[[12467,12467],256],127490:[[12469],256],127504:[[25163],256],127505:[[23383],256],127506:[[21452],256],127507:[[12487],256],127508:[[20108],256],127509:[[22810],256],127510:[[35299],256],127511:[[22825],256],127512:[[20132],256],127513:[[26144],256],127514:[[28961],256],127515:[[26009],256],127516:[[21069],256],127517:[[24460],256],127518:[[20877],256],127519:[[26032],256],127520:[[21021],256],127521:[[32066],256],127522:[[29983],256],127523:[[36009],256],127524:[[22768],256],127525:[[21561],256],127526:[[28436],256],127527:[[25237],256],127528:[[25429],256],127529:[[19968],256],127530:[[19977],256],127531:[[36938],256],127532:[[24038],256],127533:[[20013],256],127534:[[21491],256],127535:[[25351],256],127536:[[36208],256],127537:[[25171],256],127538:[[31105],256],127539:[[31354],256],127540:[[21512],256],127541:[[28288],256],127542:[[26377],256],127543:[[26376],256],127544:[[30003],256],127545:[[21106],256],127546:[[21942],256],127552:[[12308,26412,12309],256],127553:[[12308,19977,12309],256],127554:[[12308,20108,12309],256],127555:[[12308,23433,12309],256],127556:[[12308,28857,12309],256],127557:[[12308,25171,12309],256],127558:[[12308,30423,12309],256],127559:[[12308,21213,12309],256],127560:[[12308,25943,12309],256],127568:[[24471],256],127569:[[21487],256]},
63488:{194560:[[20029]],194561:[[20024]],194562:[[20033]],194563:[[131362]],194564:[[20320]],194565:[[20398]],194566:[[20411]],194567:[[20482]],194568:[[20602]],194569:[[20633]],194570:[[20711]],194571:[[20687]],194572:[[13470]],194573:[[132666]],194574:[[20813]],194575:[[20820]],194576:[[20836]],194577:[[20855]],194578:[[132380]],194579:[[13497]],194580:[[20839]],194581:[[20877]],194582:[[132427]],194583:[[20887]],194584:[[20900]],194585:[[20172]],194586:[[20908]],194587:[[20917]],194588:[[168415]],194589:[[20981]],194590:[[20995]],194591:[[13535]],194592:[[21051]],194593:[[21062]],194594:[[21106]],194595:[[21111]],194596:[[13589]],194597:[[21191]],194598:[[21193]],194599:[[21220]],194600:[[21242]],194601:[[21253]],194602:[[21254]],194603:[[21271]],194604:[[21321]],194605:[[21329]],194606:[[21338]],194607:[[21363]],194608:[[21373]],194609:[[21375]],194610:[[21375]],194611:[[21375]],194612:[[133676]],194613:[[28784]],194614:[[21450]],194615:[[21471]],194616:[[133987]],194617:[[21483]],194618:[[21489]],194619:[[21510]],194620:[[21662]],194621:[[21560]],194622:[[21576]],194623:[[21608]],194624:[[21666]],194625:[[21750]],194626:[[21776]],194627:[[21843]],194628:[[21859]],194629:[[21892]],194630:[[21892]],194631:[[21913]],194632:[[21931]],194633:[[21939]],194634:[[21954]],194635:[[22294]],194636:[[22022]],194637:[[22295]],194638:[[22097]],194639:[[22132]],194640:[[20999]],194641:[[22766]],194642:[[22478]],194643:[[22516]],194644:[[22541]],194645:[[22411]],194646:[[22578]],194647:[[22577]],194648:[[22700]],194649:[[136420]],194650:[[22770]],194651:[[22775]],194652:[[22790]],194653:[[22810]],194654:[[22818]],194655:[[22882]],194656:[[136872]],194657:[[136938]],194658:[[23020]],194659:[[23067]],194660:[[23079]],194661:[[23000]],194662:[[23142]],194663:[[14062]],194664:[[14076]],194665:[[23304]],194666:[[23358]],194667:[[23358]],194668:[[137672]],194669:[[23491]],194670:[[23512]],194671:[[23527]],194672:[[23539]],194673:[[138008]],194674:[[23551]],194675:[[23558]],194676:[[24403]],194677:[[23586]],194678:[[14209]],194679:[[23648]],194680:[[23662]],194681:[[23744]],194682:[[23693]],194683:[[138724]],194684:[[23875]],194685:[[138726]],194686:[[23918]],194687:[[23915]],194688:[[23932]],194689:[[24033]],194690:[[24034]],194691:[[14383]],194692:[[24061]],194693:[[24104]],194694:[[24125]],194695:[[24169]],194696:[[14434]],194697:[[139651]],194698:[[14460]],194699:[[24240]],194700:[[24243]],194701:[[24246]],194702:[[24266]],194703:[[172946]],194704:[[24318]],194705:[[140081]],194706:[[140081]],194707:[[33281]],194708:[[24354]],194709:[[24354]],194710:[[14535]],194711:[[144056]],194712:[[156122]],194713:[[24418]],194714:[[24427]],194715:[[14563]],194716:[[24474]],194717:[[24525]],194718:[[24535]],194719:[[24569]],194720:[[24705]],194721:[[14650]],194722:[[14620]],194723:[[24724]],194724:[[141012]],194725:[[24775]],194726:[[24904]],194727:[[24908]],194728:[[24910]],194729:[[24908]],194730:[[24954]],194731:[[24974]],194732:[[25010]],194733:[[24996]],194734:[[25007]],194735:[[25054]],194736:[[25074]],194737:[[25078]],194738:[[25104]],194739:[[25115]],194740:[[25181]],194741:[[25265]],194742:[[25300]],194743:[[25424]],194744:[[142092]],194745:[[25405]],194746:[[25340]],194747:[[25448]],194748:[[25475]],194749:[[25572]],194750:[[142321]],194751:[[25634]],194752:[[25541]],194753:[[25513]],194754:[[14894]],194755:[[25705]],194756:[[25726]],194757:[[25757]],194758:[[25719]],194759:[[14956]],194760:[[25935]],194761:[[25964]],194762:[[143370]],194763:[[26083]],194764:[[26360]],194765:[[26185]],194766:[[15129]],194767:[[26257]],194768:[[15112]],194769:[[15076]],194770:[[20882]],194771:[[20885]],194772:[[26368]],194773:[[26268]],194774:[[32941]],194775:[[17369]],194776:[[26391]],194777:[[26395]],194778:[[26401]],194779:[[26462]],194780:[[26451]],194781:[[144323]],194782:[[15177]],194783:[[26618]],194784:[[26501]],194785:[[26706]],194786:[[26757]],194787:[[144493]],194788:[[26766]],194789:[[26655]],194790:[[26900]],194791:[[15261]],194792:[[26946]],194793:[[27043]],194794:[[27114]],194795:[[27304]],194796:[[145059]],194797:[[27355]],194798:[[15384]],194799:[[27425]],194800:[[145575]],194801:[[27476]],194802:[[15438]],194803:[[27506]],194804:[[27551]],194805:[[27578]],194806:[[27579]],194807:[[146061]],194808:[[138507]],194809:[[146170]],194810:[[27726]],194811:[[146620]],194812:[[27839]],194813:[[27853]],194814:[[27751]],194815:[[27926]]},
63744:{63744:[[35912]],63745:[[26356]],63746:[[36554]],63747:[[36040]],63748:[[28369]],63749:[[20018]],63750:[[21477]],63751:[[40860]],63752:[[40860]],63753:[[22865]],63754:[[37329]],63755:[[21895]],63756:[[22856]],63757:[[25078]],63758:[[30313]],63759:[[32645]],63760:[[34367]],63761:[[34746]],63762:[[35064]],63763:[[37007]],63764:[[27138]],63765:[[27931]],63766:[[28889]],63767:[[29662]],63768:[[33853]],63769:[[37226]],63770:[[39409]],63771:[[20098]],63772:[[21365]],63773:[[27396]],63774:[[29211]],63775:[[34349]],63776:[[40478]],63777:[[23888]],63778:[[28651]],63779:[[34253]],63780:[[35172]],63781:[[25289]],63782:[[33240]],63783:[[34847]],63784:[[24266]],63785:[[26391]],63786:[[28010]],63787:[[29436]],63788:[[37070]],63789:[[20358]],63790:[[20919]],63791:[[21214]],63792:[[25796]],63793:[[27347]],63794:[[29200]],63795:[[30439]],63796:[[32769]],63797:[[34310]],63798:[[34396]],63799:[[36335]],63800:[[38706]],63801:[[39791]],63802:[[40442]],63803:[[30860]],63804:[[31103]],63805:[[32160]],63806:[[33737]],63807:[[37636]],63808:[[40575]],63809:[[35542]],63810:[[22751]],63811:[[24324]],63812:[[31840]],63813:[[32894]],63814:[[29282]],63815:[[30922]],63816:[[36034]],63817:[[38647]],63818:[[22744]],63819:[[23650]],63820:[[27155]],63821:[[28122]],63822:[[28431]],63823:[[32047]],63824:[[32311]],63825:[[38475]],63826:[[21202]],63827:[[32907]],63828:[[20956]],63829:[[20940]],63830:[[31260]],63831:[[32190]],63832:[[33777]],63833:[[38517]],63834:[[35712]],63835:[[25295]],63836:[[27138]],63837:[[35582]],63838:[[20025]],63839:[[23527]],63840:[[24594]],63841:[[29575]],63842:[[30064]],63843:[[21271]],63844:[[30971]],63845:[[20415]],63846:[[24489]],63847:[[19981]],63848:[[27852]],63849:[[25976]],63850:[[32034]],63851:[[21443]],63852:[[22622]],63853:[[30465]],63854:[[33865]],63855:[[35498]],63856:[[27578]],63857:[[36784]],63858:[[27784]],63859:[[25342]],63860:[[33509]],63861:[[25504]],63862:[[30053]],63863:[[20142]],63864:[[20841]],63865:[[20937]],63866:[[26753]],63867:[[31975]],63868:[[33391]],63869:[[35538]],63870:[[37327]],63871:[[21237]],63872:[[21570]],63873:[[22899]],63874:[[24300]],63875:[[26053]],63876:[[28670]],63877:[[31018]],63878:[[38317]],63879:[[39530]],63880:[[40599]],63881:[[40654]],63882:[[21147]],63883:[[26310]],63884:[[27511]],63885:[[36706]],63886:[[24180]],63887:[[24976]],63888:[[25088]],63889:[[25754]],63890:[[28451]],63891:[[29001]],63892:[[29833]],63893:[[31178]],63894:[[32244]],63895:[[32879]],63896:[[36646]],63897:[[34030]],63898:[[36899]],63899:[[37706]],63900:[[21015]],63901:[[21155]],63902:[[21693]],63903:[[28872]],63904:[[35010]],63905:[[35498]],63906:[[24265]],63907:[[24565]],63908:[[25467]],63909:[[27566]],63910:[[31806]],63911:[[29557]],63912:[[20196]],63913:[[22265]],63914:[[23527]],63915:[[23994]],63916:[[24604]],63917:[[29618]],63918:[[29801]],63919:[[32666]],63920:[[32838]],63921:[[37428]],63922:[[38646]],63923:[[38728]],63924:[[38936]],63925:[[20363]],63926:[[31150]],63927:[[37300]],63928:[[38584]],63929:[[24801]],63930:[[20102]],63931:[[20698]],63932:[[23534]],63933:[[23615]],63934:[[26009]],63935:[[27138]],63936:[[29134]],63937:[[30274]],63938:[[34044]],63939:[[36988]],63940:[[40845]],63941:[[26248]],63942:[[38446]],63943:[[21129]],63944:[[26491]],63945:[[26611]],63946:[[27969]],63947:[[28316]],63948:[[29705]],63949:[[30041]],63950:[[30827]],63951:[[32016]],63952:[[39006]],63953:[[20845]],63954:[[25134]],63955:[[38520]],63956:[[20523]],63957:[[23833]],63958:[[28138]],63959:[[36650]],63960:[[24459]],63961:[[24900]],63962:[[26647]],63963:[[29575]],63964:[[38534]],63965:[[21033]],63966:[[21519]],63967:[[23653]],63968:[[26131]],63969:[[26446]],63970:[[26792]],63971:[[27877]],63972:[[29702]],63973:[[30178]],63974:[[32633]],63975:[[35023]],63976:[[35041]],63977:[[37324]],63978:[[38626]],63979:[[21311]],63980:[[28346]],63981:[[21533]],63982:[[29136]],63983:[[29848]],63984:[[34298]],63985:[[38563]],63986:[[40023]],63987:[[40607]],63988:[[26519]],63989:[[28107]],63990:[[33256]],63991:[[31435]],63992:[[31520]],63993:[[31890]],63994:[[29376]],63995:[[28825]],63996:[[35672]],63997:[[20160]],63998:[[33590]],63999:[[21050]],194816:[[27966]],194817:[[28023]],194818:[[27969]],194819:[[28009]],194820:[[28024]],194821:[[28037]],194822:[[146718]],194823:[[27956]],194824:[[28207]],194825:[[28270]],194826:[[15667]],194827:[[28363]],194828:[[28359]],194829:[[147153]],194830:[[28153]],194831:[[28526]],194832:[[147294]],194833:[[147342]],194834:[[28614]],194835:[[28729]],194836:[[28702]],194837:[[28699]],194838:[[15766]],194839:[[28746]],194840:[[28797]],194841:[[28791]],194842:[[28845]],194843:[[132389]],194844:[[28997]],194845:[[148067]],194846:[[29084]],194847:[[148395]],194848:[[29224]],194849:[[29237]],194850:[[29264]],194851:[[149000]],194852:[[29312]],194853:[[29333]],194854:[[149301]],194855:[[149524]],194856:[[29562]],194857:[[29579]],194858:[[16044]],194859:[[29605]],194860:[[16056]],194861:[[16056]],194862:[[29767]],194863:[[29788]],194864:[[29809]],194865:[[29829]],194866:[[29898]],194867:[[16155]],194868:[[29988]],194869:[[150582]],194870:[[30014]],194871:[[150674]],194872:[[30064]],194873:[[139679]],194874:[[30224]],194875:[[151457]],194876:[[151480]],194877:[[151620]],194878:[[16380]],194879:[[16392]],194880:[[30452]],194881:[[151795]],194882:[[151794]],194883:[[151833]],194884:[[151859]],194885:[[30494]],194886:[[30495]],194887:[[30495]],194888:[[30538]],194889:[[16441]],194890:[[30603]],194891:[[16454]],194892:[[16534]],194893:[[152605]],194894:[[30798]],194895:[[30860]],194896:[[30924]],194897:[[16611]],194898:[[153126]],194899:[[31062]],194900:[[153242]],194901:[[153285]],194902:[[31119]],194903:[[31211]],194904:[[16687]],194905:[[31296]],194906:[[31306]],194907:[[31311]],194908:[[153980]],194909:[[154279]],194910:[[154279]],194911:[[31470]],194912:[[16898]],194913:[[154539]],194914:[[31686]],194915:[[31689]],194916:[[16935]],194917:[[154752]],194918:[[31954]],194919:[[17056]],194920:[[31976]],194921:[[31971]],194922:[[32000]],194923:[[155526]],194924:[[32099]],194925:[[17153]],194926:[[32199]],194927:[[32258]],194928:[[32325]],194929:[[17204]],194930:[[156200]],194931:[[156231]],194932:[[17241]],194933:[[156377]],194934:[[32634]],194935:[[156478]],194936:[[32661]],194937:[[32762]],194938:[[32773]],194939:[[156890]],194940:[[156963]],194941:[[32864]],194942:[[157096]],194943:[[32880]],194944:[[144223]],194945:[[17365]],194946:[[32946]],194947:[[33027]],194948:[[17419]],194949:[[33086]],194950:[[23221]],194951:[[157607]],194952:[[157621]],194953:[[144275]],194954:[[144284]],194955:[[33281]],194956:[[33284]],194957:[[36766]],194958:[[17515]],194959:[[33425]],194960:[[33419]],194961:[[33437]],194962:[[21171]],194963:[[33457]],194964:[[33459]],194965:[[33469]],194966:[[33510]],194967:[[158524]],194968:[[33509]],194969:[[33565]],194970:[[33635]],194971:[[33709]],194972:[[33571]],194973:[[33725]],194974:[[33767]],194975:[[33879]],194976:[[33619]],194977:[[33738]],194978:[[33740]],194979:[[33756]],194980:[[158774]],194981:[[159083]],194982:[[158933]],194983:[[17707]],194984:[[34033]],194985:[[34035]],194986:[[34070]],194987:[[160714]],194988:[[34148]],194989:[[159532]],194990:[[17757]],194991:[[17761]],194992:[[159665]],194993:[[159954]],194994:[[17771]],194995:[[34384]],194996:[[34396]],194997:[[34407]],194998:[[34409]],194999:[[34473]],195000:[[34440]],195001:[[34574]],195002:[[34530]],195003:[[34681]],195004:[[34600]],195005:[[34667]],195006:[[34694]],195007:[[17879]],195008:[[34785]],195009:[[34817]],195010:[[17913]],195011:[[34912]],195012:[[34915]],195013:[[161383]],195014:[[35031]],195015:[[35038]],195016:[[17973]],195017:[[35066]],195018:[[13499]],195019:[[161966]],195020:[[162150]],195021:[[18110]],195022:[[18119]],195023:[[35488]],195024:[[35565]],195025:[[35722]],195026:[[35925]],195027:[[162984]],195028:[[36011]],195029:[[36033]],195030:[[36123]],195031:[[36215]],195032:[[163631]],195033:[[133124]],195034:[[36299]],195035:[[36284]],195036:[[36336]],195037:[[133342]],195038:[[36564]],195039:[[36664]],195040:[[165330]],195041:[[165357]],195042:[[37012]],195043:[[37105]],195044:[[37137]],195045:[[165678]],195046:[[37147]],195047:[[37432]],195048:[[37591]],195049:[[37592]],195050:[[37500]],195051:[[37881]],195052:[[37909]],195053:[[166906]],195054:[[38283]],195055:[[18837]],195056:[[38327]],195057:[[167287]],195058:[[18918]],195059:[[38595]],195060:[[23986]],195061:[[38691]],195062:[[168261]],195063:[[168474]],195064:[[19054]],195065:[[19062]],195066:[[38880]],195067:[[168970]],195068:[[19122]],195069:[[169110]],195070:[[38923]],195071:[[38923]]},
64000:{64000:[[20999]],64001:[[24230]],64002:[[25299]],64003:[[31958]],64004:[[23429]],64005:[[27934]],64006:[[26292]],64007:[[36667]],64008:[[34892]],64009:[[38477]],64010:[[35211]],64011:[[24275]],64012:[[20800]],64013:[[21952]],64016:[[22618]],64018:[[26228]],64021:[[20958]],64022:[[29482]],64023:[[30410]],64024:[[31036]],64025:[[31070]],64026:[[31077]],64027:[[31119]],64028:[[38742]],64029:[[31934]],64030:[[32701]],64032:[[34322]],64034:[[35576]],64037:[[36920]],64038:[[37117]],64042:[[39151]],64043:[[39164]],64044:[[39208]],64045:[[40372]],64046:[[37086]],64047:[[38583]],64048:[[20398]],64049:[[20711]],64050:[[20813]],64051:[[21193]],64052:[[21220]],64053:[[21329]],64054:[[21917]],64055:[[22022]],64056:[[22120]],64057:[[22592]],64058:[[22696]],64059:[[23652]],64060:[[23662]],64061:[[24724]],64062:[[24936]],64063:[[24974]],64064:[[25074]],64065:[[25935]],64066:[[26082]],64067:[[26257]],64068:[[26757]],64069:[[28023]],64070:[[28186]],64071:[[28450]],64072:[[29038]],64073:[[29227]],64074:[[29730]],64075:[[30865]],64076:[[31038]],64077:[[31049]],64078:[[31048]],64079:[[31056]],64080:[[31062]],64081:[[31069]],64082:[[31117]],64083:[[31118]],64084:[[31296]],64085:[[31361]],64086:[[31680]],64087:[[32244]],64088:[[32265]],64089:[[32321]],64090:[[32626]],64091:[[32773]],64092:[[33261]],64093:[[33401]],64094:[[33401]],64095:[[33879]],64096:[[35088]],64097:[[35222]],64098:[[35585]],64099:[[35641]],64100:[[36051]],64101:[[36104]],64102:[[36790]],64103:[[36920]],64104:[[38627]],64105:[[38911]],64106:[[38971]],64107:[[24693]],64108:[[148206]],64109:[[33304]],64112:[[20006]],64113:[[20917]],64114:[[20840]],64115:[[20352]],64116:[[20805]],64117:[[20864]],64118:[[21191]],64119:[[21242]],64120:[[21917]],64121:[[21845]],64122:[[21913]],64123:[[21986]],64124:[[22618]],64125:[[22707]],64126:[[22852]],64127:[[22868]],64128:[[23138]],64129:[[23336]],64130:[[24274]],64131:[[24281]],64132:[[24425]],64133:[[24493]],64134:[[24792]],64135:[[24910]],64136:[[24840]],64137:[[24974]],64138:[[24928]],64139:[[25074]],64140:[[25140]],64141:[[25540]],64142:[[25628]],64143:[[25682]],64144:[[25942]],64145:[[26228]],64146:[[26391]],64147:[[26395]],64148:[[26454]],64149:[[27513]],64150:[[27578]],64151:[[27969]],64152:[[28379]],64153:[[28363]],64154:[[28450]],64155:[[28702]],64156:[[29038]],64157:[[30631]],64158:[[29237]],64159:[[29359]],64160:[[29482]],64161:[[29809]],64162:[[29958]],64163:[[30011]],64164:[[30237]],64165:[[30239]],64166:[[30410]],64167:[[30427]],64168:[[30452]],64169:[[30538]],64170:[[30528]],64171:[[30924]],64172:[[31409]],64173:[[31680]],64174:[[31867]],64175:[[32091]],64176:[[32244]],64177:[[32574]],64178:[[32773]],64179:[[33618]],64180:[[33775]],64181:[[34681]],64182:[[35137]],64183:[[35206]],64184:[[35222]],64185:[[35519]],64186:[[35576]],64187:[[35531]],64188:[[35585]],64189:[[35582]],64190:[[35565]],64191:[[35641]],64192:[[35722]],64193:[[36104]],64194:[[36664]],64195:[[36978]],64196:[[37273]],64197:[[37494]],64198:[[38524]],64199:[[38627]],64200:[[38742]],64201:[[38875]],64202:[[38911]],64203:[[38923]],64204:[[38971]],64205:[[39698]],64206:[[40860]],64207:[[141386]],64208:[[141380]],64209:[[144341]],64210:[[15261]],64211:[[16408]],64212:[[16441]],64213:[[152137]],64214:[[154832]],64215:[[163539]],64216:[[40771]],64217:[[40846]],195072:[[38953]],195073:[[169398]],195074:[[39138]],195075:[[19251]],195076:[[39209]],195077:[[39335]],195078:[[39362]],195079:[[39422]],195080:[[19406]],195081:[[170800]],195082:[[39698]],195083:[[40000]],195084:[[40189]],195085:[[19662]],195086:[[19693]],195087:[[40295]],195088:[[172238]],195089:[[19704]],195090:[[172293]],195091:[[172558]],195092:[[172689]],195093:[[40635]],195094:[[19798]],195095:[[40697]],195096:[[40702]],195097:[[40709]],195098:[[40719]],195099:[[40726]],195100:[[40763]],195101:[[173568]]},
64256:{64256:[[102,102],256],64257:[[102,105],256],64258:[[102,108],256],64259:[[102,102,105],256],64260:[[102,102,108],256],64261:[[383,116],256],64262:[[115,116],256],64275:[[1396,1398],256],64276:[[1396,1381],256],64277:[[1396,1387],256],64278:[[1406,1398],256],64279:[[1396,1389],256],64285:[[1497,1460],512],64286:[,26],64287:[[1522,1463],512],64288:[[1506],256],64289:[[1488],256],64290:[[1491],256],64291:[[1492],256],64292:[[1499],256],64293:[[1500],256],64294:[[1501],256],64295:[[1512],256],64296:[[1514],256],64297:[[43],256],64298:[[1513,1473],512],64299:[[1513,1474],512],64300:[[64329,1473],512],64301:[[64329,1474],512],64302:[[1488,1463],512],64303:[[1488,1464],512],64304:[[1488,1468],512],64305:[[1489,1468],512],64306:[[1490,1468],512],64307:[[1491,1468],512],64308:[[1492,1468],512],64309:[[1493,1468],512],64310:[[1494,1468],512],64312:[[1496,1468],512],64313:[[1497,1468],512],64314:[[1498,1468],512],64315:[[1499,1468],512],64316:[[1500,1468],512],64318:[[1502,1468],512],64320:[[1504,1468],512],64321:[[1505,1468],512],64323:[[1507,1468],512],64324:[[1508,1468],512],64326:[[1510,1468],512],64327:[[1511,1468],512],64328:[[1512,1468],512],64329:[[1513,1468],512],64330:[[1514,1468],512],64331:[[1493,1465],512],64332:[[1489,1471],512],64333:[[1499,1471],512],64334:[[1508,1471],512],64335:[[1488,1500],256],64336:[[1649],256],64337:[[1649],256],64338:[[1659],256],64339:[[1659],256],64340:[[1659],256],64341:[[1659],256],64342:[[1662],256],64343:[[1662],256],64344:[[1662],256],64345:[[1662],256],64346:[[1664],256],64347:[[1664],256],64348:[[1664],256],64349:[[1664],256],64350:[[1658],256],64351:[[1658],256],64352:[[1658],256],64353:[[1658],256],64354:[[1663],256],64355:[[1663],256],64356:[[1663],256],64357:[[1663],256],64358:[[1657],256],64359:[[1657],256],64360:[[1657],256],64361:[[1657],256],64362:[[1700],256],64363:[[1700],256],64364:[[1700],256],64365:[[1700],256],64366:[[1702],256],64367:[[1702],256],64368:[[1702],256],64369:[[1702],256],64370:[[1668],256],64371:[[1668],256],64372:[[1668],256],64373:[[1668],256],64374:[[1667],256],64375:[[1667],256],64376:[[1667],256],64377:[[1667],256],64378:[[1670],256],64379:[[1670],256],64380:[[1670],256],64381:[[1670],256],64382:[[1671],256],64383:[[1671],256],64384:[[1671],256],64385:[[1671],256],64386:[[1677],256],64387:[[1677],256],64388:[[1676],256],64389:[[1676],256],64390:[[1678],256],64391:[[1678],256],64392:[[1672],256],64393:[[1672],256],64394:[[1688],256],64395:[[1688],256],64396:[[1681],256],64397:[[1681],256],64398:[[1705],256],64399:[[1705],256],64400:[[1705],256],64401:[[1705],256],64402:[[1711],256],64403:[[1711],256],64404:[[1711],256],64405:[[1711],256],64406:[[1715],256],64407:[[1715],256],64408:[[1715],256],64409:[[1715],256],64410:[[1713],256],64411:[[1713],256],64412:[[1713],256],64413:[[1713],256],64414:[[1722],256],64415:[[1722],256],64416:[[1723],256],64417:[[1723],256],64418:[[1723],256],64419:[[1723],256],64420:[[1728],256],64421:[[1728],256],64422:[[1729],256],64423:[[1729],256],64424:[[1729],256],64425:[[1729],256],64426:[[1726],256],64427:[[1726],256],64428:[[1726],256],64429:[[1726],256],64430:[[1746],256],64431:[[1746],256],64432:[[1747],256],64433:[[1747],256],64467:[[1709],256],64468:[[1709],256],64469:[[1709],256],64470:[[1709],256],64471:[[1735],256],64472:[[1735],256],64473:[[1734],256],64474:[[1734],256],64475:[[1736],256],64476:[[1736],256],64477:[[1655],256],64478:[[1739],256],64479:[[1739],256],64480:[[1733],256],64481:[[1733],256],64482:[[1737],256],64483:[[1737],256],64484:[[1744],256],64485:[[1744],256],64486:[[1744],256],64487:[[1744],256],64488:[[1609],256],64489:[[1609],256],64490:[[1574,1575],256],64491:[[1574,1575],256],64492:[[1574,1749],256],64493:[[1574,1749],256],64494:[[1574,1608],256],64495:[[1574,1608],256],64496:[[1574,1735],256],64497:[[1574,1735],256],64498:[[1574,1734],256],64499:[[1574,1734],256],64500:[[1574,1736],256],64501:[[1574,1736],256],64502:[[1574,1744],256],64503:[[1574,1744],256],64504:[[1574,1744],256],64505:[[1574,1609],256],64506:[[1574,1609],256],64507:[[1574,1609],256],64508:[[1740],256],64509:[[1740],256],64510:[[1740],256],64511:[[1740],256]},
64512:{64512:[[1574,1580],256],64513:[[1574,1581],256],64514:[[1574,1605],256],64515:[[1574,1609],256],64516:[[1574,1610],256],64517:[[1576,1580],256],64518:[[1576,1581],256],64519:[[1576,1582],256],64520:[[1576,1605],256],64521:[[1576,1609],256],64522:[[1576,1610],256],64523:[[1578,1580],256],64524:[[1578,1581],256],64525:[[1578,1582],256],64526:[[1578,1605],256],64527:[[1578,1609],256],64528:[[1578,1610],256],64529:[[1579,1580],256],64530:[[1579,1605],256],64531:[[1579,1609],256],64532:[[1579,1610],256],64533:[[1580,1581],256],64534:[[1580,1605],256],64535:[[1581,1580],256],64536:[[1581,1605],256],64537:[[1582,1580],256],64538:[[1582,1581],256],64539:[[1582,1605],256],64540:[[1587,1580],256],64541:[[1587,1581],256],64542:[[1587,1582],256],64543:[[1587,1605],256],64544:[[1589,1581],256],64545:[[1589,1605],256],64546:[[1590,1580],256],64547:[[1590,1581],256],64548:[[1590,1582],256],64549:[[1590,1605],256],64550:[[1591,1581],256],64551:[[1591,1605],256],64552:[[1592,1605],256],64553:[[1593,1580],256],64554:[[1593,1605],256],64555:[[1594,1580],256],64556:[[1594,1605],256],64557:[[1601,1580],256],64558:[[1601,1581],256],64559:[[1601,1582],256],64560:[[1601,1605],256],64561:[[1601,1609],256],64562:[[1601,1610],256],64563:[[1602,1581],256],64564:[[1602,1605],256],64565:[[1602,1609],256],64566:[[1602,1610],256],64567:[[1603,1575],256],64568:[[1603,1580],256],64569:[[1603,1581],256],64570:[[1603,1582],256],64571:[[1603,1604],256],64572:[[1603,1605],256],64573:[[1603,1609],256],64574:[[1603,1610],256],64575:[[1604,1580],256],64576:[[1604,1581],256],64577:[[1604,1582],256],64578:[[1604,1605],256],64579:[[1604,1609],256],64580:[[1604,1610],256],64581:[[1605,1580],256],64582:[[1605,1581],256],64583:[[1605,1582],256],64584:[[1605,1605],256],64585:[[1605,1609],256],64586:[[1605,1610],256],64587:[[1606,1580],256],64588:[[1606,1581],256],64589:[[1606,1582],256],64590:[[1606,1605],256],64591:[[1606,1609],256],64592:[[1606,1610],256],64593:[[1607,1580],256],64594:[[1607,1605],256],64595:[[1607,1609],256],64596:[[1607,1610],256],64597:[[1610,1580],256],64598:[[1610,1581],256],64599:[[1610,1582],256],64600:[[1610,1605],256],64601:[[1610,1609],256],64602:[[1610,1610],256],64603:[[1584,1648],256],64604:[[1585,1648],256],64605:[[1609,1648],256],64606:[[32,1612,1617],256],64607:[[32,1613,1617],256],64608:[[32,1614,1617],256],64609:[[32,1615,1617],256],64610:[[32,1616,1617],256],64611:[[32,1617,1648],256],64612:[[1574,1585],256],64613:[[1574,1586],256],64614:[[1574,1605],256],64615:[[1574,1606],256],64616:[[1574,1609],256],64617:[[1574,1610],256],64618:[[1576,1585],256],64619:[[1576,1586],256],64620:[[1576,1605],256],64621:[[1576,1606],256],64622:[[1576,1609],256],64623:[[1576,1610],256],64624:[[1578,1585],256],64625:[[1578,1586],256],64626:[[1578,1605],256],64627:[[1578,1606],256],64628:[[1578,1609],256],64629:[[1578,1610],256],64630:[[1579,1585],256],64631:[[1579,1586],256],64632:[[1579,1605],256],64633:[[1579,1606],256],64634:[[1579,1609],256],64635:[[1579,1610],256],64636:[[1601,1609],256],64637:[[1601,1610],256],64638:[[1602,1609],256],64639:[[1602,1610],256],64640:[[1603,1575],256],64641:[[1603,1604],256],64642:[[1603,1605],256],64643:[[1603,1609],256],64644:[[1603,1610],256],64645:[[1604,1605],256],64646:[[1604,1609],256],64647:[[1604,1610],256],64648:[[1605,1575],256],64649:[[1605,1605],256],64650:[[1606,1585],256],64651:[[1606,1586],256],64652:[[1606,1605],256],64653:[[1606,1606],256],64654:[[1606,1609],256],64655:[[1606,1610],256],64656:[[1609,1648],256],64657:[[1610,1585],256],64658:[[1610,1586],256],64659:[[1610,1605],256],64660:[[1610,1606],256],64661:[[1610,1609],256],64662:[[1610,1610],256],64663:[[1574,1580],256],64664:[[1574,1581],256],64665:[[1574,1582],256],64666:[[1574,1605],256],64667:[[1574,1607],256],64668:[[1576,1580],256],64669:[[1576,1581],256],64670:[[1576,1582],256],64671:[[1576,1605],256],64672:[[1576,1607],256],64673:[[1578,1580],256],64674:[[1578,1581],256],64675:[[1578,1582],256],64676:[[1578,1605],256],64677:[[1578,1607],256],64678:[[1579,1605],256],64679:[[1580,1581],256],64680:[[1580,1605],256],64681:[[1581,1580],256],64682:[[1581,1605],256],64683:[[1582,1580],256],64684:[[1582,1605],256],64685:[[1587,1580],256],64686:[[1587,1581],256],64687:[[1587,1582],256],64688:[[1587,1605],256],64689:[[1589,1581],256],64690:[[1589,1582],256],64691:[[1589,1605],256],64692:[[1590,1580],256],64693:[[1590,1581],256],64694:[[1590,1582],256],64695:[[1590,1605],256],64696:[[1591,1581],256],64697:[[1592,1605],256],64698:[[1593,1580],256],64699:[[1593,1605],256],64700:[[1594,1580],256],64701:[[1594,1605],256],64702:[[1601,1580],256],64703:[[1601,1581],256],64704:[[1601,1582],256],64705:[[1601,1605],256],64706:[[1602,1581],256],64707:[[1602,1605],256],64708:[[1603,1580],256],64709:[[1603,1581],256],64710:[[1603,1582],256],64711:[[1603,1604],256],64712:[[1603,1605],256],64713:[[1604,1580],256],64714:[[1604,1581],256],64715:[[1604,1582],256],64716:[[1604,1605],256],64717:[[1604,1607],256],64718:[[1605,1580],256],64719:[[1605,1581],256],64720:[[1605,1582],256],64721:[[1605,1605],256],64722:[[1606,1580],256],64723:[[1606,1581],256],64724:[[1606,1582],256],64725:[[1606,1605],256],64726:[[1606,1607],256],64727:[[1607,1580],256],64728:[[1607,1605],256],64729:[[1607,1648],256],64730:[[1610,1580],256],64731:[[1610,1581],256],64732:[[1610,1582],256],64733:[[1610,1605],256],64734:[[1610,1607],256],64735:[[1574,1605],256],64736:[[1574,1607],256],64737:[[1576,1605],256],64738:[[1576,1607],256],64739:[[1578,1605],256],64740:[[1578,1607],256],64741:[[1579,1605],256],64742:[[1579,1607],256],64743:[[1587,1605],256],64744:[[1587,1607],256],64745:[[1588,1605],256],64746:[[1588,1607],256],64747:[[1603,1604],256],64748:[[1603,1605],256],64749:[[1604,1605],256],64750:[[1606,1605],256],64751:[[1606,1607],256],64752:[[1610,1605],256],64753:[[1610,1607],256],64754:[[1600,1614,1617],256],64755:[[1600,1615,1617],256],64756:[[1600,1616,1617],256],64757:[[1591,1609],256],64758:[[1591,1610],256],64759:[[1593,1609],256],64760:[[1593,1610],256],64761:[[1594,1609],256],64762:[[1594,1610],256],64763:[[1587,1609],256],64764:[[1587,1610],256],64765:[[1588,1609],256],64766:[[1588,1610],256],64767:[[1581,1609],256]},
64768:{64768:[[1581,1610],256],64769:[[1580,1609],256],64770:[[1580,1610],256],64771:[[1582,1609],256],64772:[[1582,1610],256],64773:[[1589,1609],256],64774:[[1589,1610],256],64775:[[1590,1609],256],64776:[[1590,1610],256],64777:[[1588,1580],256],64778:[[1588,1581],256],64779:[[1588,1582],256],64780:[[1588,1605],256],64781:[[1588,1585],256],64782:[[1587,1585],256],64783:[[1589,1585],256],64784:[[1590,1585],256],64785:[[1591,1609],256],64786:[[1591,1610],256],64787:[[1593,1609],256],64788:[[1593,1610],256],64789:[[1594,1609],256],64790:[[1594,1610],256],64791:[[1587,1609],256],64792:[[1587,1610],256],64793:[[1588,1609],256],64794:[[1588,1610],256],64795:[[1581,1609],256],64796:[[1581,1610],256],64797:[[1580,1609],256],64798:[[1580,1610],256],64799:[[1582,1609],256],64800:[[1582,1610],256],64801:[[1589,1609],256],64802:[[1589,1610],256],64803:[[1590,1609],256],64804:[[1590,1610],256],64805:[[1588,1580],256],64806:[[1588,1581],256],64807:[[1588,1582],256],64808:[[1588,1605],256],64809:[[1588,1585],256],64810:[[1587,1585],256],64811:[[1589,1585],256],64812:[[1590,1585],256],64813:[[1588,1580],256],64814:[[1588,1581],256],64815:[[1588,1582],256],64816:[[1588,1605],256],64817:[[1587,1607],256],64818:[[1588,1607],256],64819:[[1591,1605],256],64820:[[1587,1580],256],64821:[[1587,1581],256],64822:[[1587,1582],256],64823:[[1588,1580],256],64824:[[1588,1581],256],64825:[[1588,1582],256],64826:[[1591,1605],256],64827:[[1592,1605],256],64828:[[1575,1611],256],64829:[[1575,1611],256],64848:[[1578,1580,1605],256],64849:[[1578,1581,1580],256],64850:[[1578,1581,1580],256],64851:[[1578,1581,1605],256],64852:[[1578,1582,1605],256],64853:[[1578,1605,1580],256],64854:[[1578,1605,1581],256],64855:[[1578,1605,1582],256],64856:[[1580,1605,1581],256],64857:[[1580,1605,1581],256],64858:[[1581,1605,1610],256],64859:[[1581,1605,1609],256],64860:[[1587,1581,1580],256],64861:[[1587,1580,1581],256],64862:[[1587,1580,1609],256],64863:[[1587,1605,1581],256],64864:[[1587,1605,1581],256],64865:[[1587,1605,1580],256],64866:[[1587,1605,1605],256],64867:[[1587,1605,1605],256],64868:[[1589,1581,1581],256],64869:[[1589,1581,1581],256],64870:[[1589,1605,1605],256],64871:[[1588,1581,1605],256],64872:[[1588,1581,1605],256],64873:[[1588,1580,1610],256],64874:[[1588,1605,1582],256],64875:[[1588,1605,1582],256],64876:[[1588,1605,1605],256],64877:[[1588,1605,1605],256],64878:[[1590,1581,1609],256],64879:[[1590,1582,1605],256],64880:[[1590,1582,1605],256],64881:[[1591,1605,1581],256],64882:[[1591,1605,1581],256],64883:[[1591,1605,1605],256],64884:[[1591,1605,1610],256],64885:[[1593,1580,1605],256],64886:[[1593,1605,1605],256],64887:[[1593,1605,1605],256],64888:[[1593,1605,1609],256],64889:[[1594,1605,1605],256],64890:[[1594,1605,1610],256],64891:[[1594,1605,1609],256],64892:[[1601,1582,1605],256],64893:[[1601,1582,1605],256],64894:[[1602,1605,1581],256],64895:[[1602,1605,1605],256],64896:[[1604,1581,1605],256],64897:[[1604,1581,1610],256],64898:[[1604,1581,1609],256],64899:[[1604,1580,1580],256],64900:[[1604,1580,1580],256],64901:[[1604,1582,1605],256],64902:[[1604,1582,1605],256],64903:[[1604,1605,1581],256],64904:[[1604,1605,1581],256],64905:[[1605,1581,1580],256],64906:[[1605,1581,1605],256],64907:[[1605,1581,1610],256],64908:[[1605,1580,1581],256],64909:[[1605,1580,1605],256],64910:[[1605,1582,1580],256],64911:[[1605,1582,1605],256],64914:[[1605,1580,1582],256],64915:[[1607,1605,1580],256],64916:[[1607,1605,1605],256],64917:[[1606,1581,1605],256],64918:[[1606,1581,1609],256],64919:[[1606,1580,1605],256],64920:[[1606,1580,1605],256],64921:[[1606,1580,1609],256],64922:[[1606,1605,1610],256],64923:[[1606,1605,1609],256],64924:[[1610,1605,1605],256],64925:[[1610,1605,1605],256],64926:[[1576,1582,1610],256],64927:[[1578,1580,1610],256],64928:[[1578,1580,1609],256],64929:[[1578,1582,1610],256],64930:[[1578,1582,1609],256],64931:[[1578,1605,1610],256],64932:[[1578,1605,1609],256],64933:[[1580,1605,1610],256],64934:[[1580,1581,1609],256],64935:[[1580,1605,1609],256],64936:[[1587,1582,1609],256],64937:[[1589,1581,1610],256],64938:[[1588,1581,1610],256],64939:[[1590,1581,1610],256],64940:[[1604,1580,1610],256],64941:[[1604,1605,1610],256],64942:[[1610,1581,1610],256],64943:[[1610,1580,1610],256],64944:[[1610,1605,1610],256],64945:[[1605,1605,1610],256],64946:[[1602,1605,1610],256],64947:[[1606,1581,1610],256],64948:[[1602,1605,1581],256],64949:[[1604,1581,1605],256],64950:[[1593,1605,1610],256],64951:[[1603,1605,1610],256],64952:[[1606,1580,1581],256],64953:[[1605,1582,1610],256],64954:[[1604,1580,1605],256],64955:[[1603,1605,1605],256],64956:[[1604,1580,1605],256],64957:[[1606,1580,1581],256],64958:[[1580,1581,1610],256],64959:[[1581,1580,1610],256],64960:[[1605,1580,1610],256],64961:[[1601,1605,1610],256],64962:[[1576,1581,1610],256],64963:[[1603,1605,1605],256],64964:[[1593,1580,1605],256],64965:[[1589,1605,1605],256],64966:[[1587,1582,1610],256],64967:[[1606,1580,1610],256],65008:[[1589,1604,1746],256],65009:[[1602,1604,1746],256],65010:[[1575,1604,1604,1607],256],65011:[[1575,1603,1576,1585],256],65012:[[1605,1581,1605,1583],256],65013:[[1589,1604,1593,1605],256],65014:[[1585,1587,1608,1604],256],65015:[[1593,1604,1610,1607],256],65016:[[1608,1587,1604,1605],256],65017:[[1589,1604,1609],256],65018:[[1589,1604,1609,32,1575,1604,1604,1607,32,1593,1604,1610,1607,32,1608,1587,1604,1605],256],65019:[[1580,1604,32,1580,1604,1575,1604,1607],256],65020:[[1585,1740,1575,1604],256]},
65024:{65040:[[44],256],65041:[[12289],256],65042:[[12290],256],65043:[[58],256],65044:[[59],256],65045:[[33],256],65046:[[63],256],65047:[[12310],256],65048:[[12311],256],65049:[[8230],256],65056:[,230],65057:[,230],65058:[,230],65059:[,230],65060:[,230],65061:[,230],65062:[,230],65072:[[8229],256],65073:[[8212],256],65074:[[8211],256],65075:[[95],256],65076:[[95],256],65077:[[40],256],65078:[[41],256],65079:[[123],256],65080:[[125],256],65081:[[12308],256],65082:[[12309],256],65083:[[12304],256],65084:[[12305],256],65085:[[12298],256],65086:[[12299],256],65087:[[12296],256],65088:[[12297],256],65089:[[12300],256],65090:[[12301],256],65091:[[12302],256],65092:[[12303],256],65095:[[91],256],65096:[[93],256],65097:[[8254],256],65098:[[8254],256],65099:[[8254],256],65100:[[8254],256],65101:[[95],256],65102:[[95],256],65103:[[95],256],65104:[[44],256],65105:[[12289],256],65106:[[46],256],65108:[[59],256],65109:[[58],256],65110:[[63],256],65111:[[33],256],65112:[[8212],256],65113:[[40],256],65114:[[41],256],65115:[[123],256],65116:[[125],256],65117:[[12308],256],65118:[[12309],256],65119:[[35],256],65120:[[38],256],65121:[[42],256],65122:[[43],256],65123:[[45],256],65124:[[60],256],65125:[[62],256],65126:[[61],256],65128:[[92],256],65129:[[36],256],65130:[[37],256],65131:[[64],256],65136:[[32,1611],256],65137:[[1600,1611],256],65138:[[32,1612],256],65140:[[32,1613],256],65142:[[32,1614],256],65143:[[1600,1614],256],65144:[[32,1615],256],65145:[[1600,1615],256],65146:[[32,1616],256],65147:[[1600,1616],256],65148:[[32,1617],256],65149:[[1600,1617],256],65150:[[32,1618],256],65151:[[1600,1618],256],65152:[[1569],256],65153:[[1570],256],65154:[[1570],256],65155:[[1571],256],65156:[[1571],256],65157:[[1572],256],65158:[[1572],256],65159:[[1573],256],65160:[[1573],256],65161:[[1574],256],65162:[[1574],256],65163:[[1574],256],65164:[[1574],256],65165:[[1575],256],65166:[[1575],256],65167:[[1576],256],65168:[[1576],256],65169:[[1576],256],65170:[[1576],256],65171:[[1577],256],65172:[[1577],256],65173:[[1578],256],65174:[[1578],256],65175:[[1578],256],65176:[[1578],256],65177:[[1579],256],65178:[[1579],256],65179:[[1579],256],65180:[[1579],256],65181:[[1580],256],65182:[[1580],256],65183:[[1580],256],65184:[[1580],256],65185:[[1581],256],65186:[[1581],256],65187:[[1581],256],65188:[[1581],256],65189:[[1582],256],65190:[[1582],256],65191:[[1582],256],65192:[[1582],256],65193:[[1583],256],65194:[[1583],256],65195:[[1584],256],65196:[[1584],256],65197:[[1585],256],65198:[[1585],256],65199:[[1586],256],65200:[[1586],256],65201:[[1587],256],65202:[[1587],256],65203:[[1587],256],65204:[[1587],256],65205:[[1588],256],65206:[[1588],256],65207:[[1588],256],65208:[[1588],256],65209:[[1589],256],65210:[[1589],256],65211:[[1589],256],65212:[[1589],256],65213:[[1590],256],65214:[[1590],256],65215:[[1590],256],65216:[[1590],256],65217:[[1591],256],65218:[[1591],256],65219:[[1591],256],65220:[[1591],256],65221:[[1592],256],65222:[[1592],256],65223:[[1592],256],65224:[[1592],256],65225:[[1593],256],65226:[[1593],256],65227:[[1593],256],65228:[[1593],256],65229:[[1594],256],65230:[[1594],256],65231:[[1594],256],65232:[[1594],256],65233:[[1601],256],65234:[[1601],256],65235:[[1601],256],65236:[[1601],256],65237:[[1602],256],65238:[[1602],256],65239:[[1602],256],65240:[[1602],256],65241:[[1603],256],65242:[[1603],256],65243:[[1603],256],65244:[[1603],256],65245:[[1604],256],65246:[[1604],256],65247:[[1604],256],65248:[[1604],256],65249:[[1605],256],65250:[[1605],256],65251:[[1605],256],65252:[[1605],256],65253:[[1606],256],65254:[[1606],256],65255:[[1606],256],65256:[[1606],256],65257:[[1607],256],65258:[[1607],256],65259:[[1607],256],65260:[[1607],256],65261:[[1608],256],65262:[[1608],256],65263:[[1609],256],65264:[[1609],256],65265:[[1610],256],65266:[[1610],256],65267:[[1610],256],65268:[[1610],256],65269:[[1604,1570],256],65270:[[1604,1570],256],65271:[[1604,1571],256],65272:[[1604,1571],256],65273:[[1604,1573],256],65274:[[1604,1573],256],65275:[[1604,1575],256],65276:[[1604,1575],256]},
65280:{65281:[[33],256],65282:[[34],256],65283:[[35],256],65284:[[36],256],65285:[[37],256],65286:[[38],256],65287:[[39],256],65288:[[40],256],65289:[[41],256],65290:[[42],256],65291:[[43],256],65292:[[44],256],65293:[[45],256],65294:[[46],256],65295:[[47],256],65296:[[48],256],65297:[[49],256],65298:[[50],256],65299:[[51],256],65300:[[52],256],65301:[[53],256],65302:[[54],256],65303:[[55],256],65304:[[56],256],65305:[[57],256],65306:[[58],256],65307:[[59],256],65308:[[60],256],65309:[[61],256],65310:[[62],256],65311:[[63],256],65312:[[64],256],65313:[[65],256],65314:[[66],256],65315:[[67],256],65316:[[68],256],65317:[[69],256],65318:[[70],256],65319:[[71],256],65320:[[72],256],65321:[[73],256],65322:[[74],256],65323:[[75],256],65324:[[76],256],65325:[[77],256],65326:[[78],256],65327:[[79],256],65328:[[80],256],65329:[[81],256],65330:[[82],256],65331:[[83],256],65332:[[84],256],65333:[[85],256],65334:[[86],256],65335:[[87],256],65336:[[88],256],65337:[[89],256],65338:[[90],256],65339:[[91],256],65340:[[92],256],65341:[[93],256],65342:[[94],256],65343:[[95],256],65344:[[96],256],65345:[[97],256],65346:[[98],256],65347:[[99],256],65348:[[100],256],65349:[[101],256],65350:[[102],256],65351:[[103],256],65352:[[104],256],65353:[[105],256],65354:[[106],256],65355:[[107],256],65356:[[108],256],65357:[[109],256],65358:[[110],256],65359:[[111],256],65360:[[112],256],65361:[[113],256],65362:[[114],256],65363:[[115],256],65364:[[116],256],65365:[[117],256],65366:[[118],256],65367:[[119],256],65368:[[120],256],65369:[[121],256],65370:[[122],256],65371:[[123],256],65372:[[124],256],65373:[[125],256],65374:[[126],256],65375:[[10629],256],65376:[[10630],256],65377:[[12290],256],65378:[[12300],256],65379:[[12301],256],65380:[[12289],256],65381:[[12539],256],65382:[[12530],256],65383:[[12449],256],65384:[[12451],256],65385:[[12453],256],65386:[[12455],256],65387:[[12457],256],65388:[[12515],256],65389:[[12517],256],65390:[[12519],256],65391:[[12483],256],65392:[[12540],256],65393:[[12450],256],65394:[[12452],256],65395:[[12454],256],65396:[[12456],256],65397:[[12458],256],65398:[[12459],256],65399:[[12461],256],65400:[[12463],256],65401:[[12465],256],65402:[[12467],256],65403:[[12469],256],65404:[[12471],256],65405:[[12473],256],65406:[[12475],256],65407:[[12477],256],65408:[[12479],256],65409:[[12481],256],65410:[[12484],256],65411:[[12486],256],65412:[[12488],256],65413:[[12490],256],65414:[[12491],256],65415:[[12492],256],65416:[[12493],256],65417:[[12494],256],65418:[[12495],256],65419:[[12498],256],65420:[[12501],256],65421:[[12504],256],65422:[[12507],256],65423:[[12510],256],65424:[[12511],256],65425:[[12512],256],65426:[[12513],256],65427:[[12514],256],65428:[[12516],256],65429:[[12518],256],65430:[[12520],256],65431:[[12521],256],65432:[[12522],256],65433:[[12523],256],65434:[[12524],256],65435:[[12525],256],65436:[[12527],256],65437:[[12531],256],65438:[[12441],256],65439:[[12442],256],65440:[[12644],256],65441:[[12593],256],65442:[[12594],256],65443:[[12595],256],65444:[[12596],256],65445:[[12597],256],65446:[[12598],256],65447:[[12599],256],65448:[[12600],256],65449:[[12601],256],65450:[[12602],256],65451:[[12603],256],65452:[[12604],256],65453:[[12605],256],65454:[[12606],256],65455:[[12607],256],65456:[[12608],256],65457:[[12609],256],65458:[[12610],256],65459:[[12611],256],65460:[[12612],256],65461:[[12613],256],65462:[[12614],256],65463:[[12615],256],65464:[[12616],256],65465:[[12617],256],65466:[[12618],256],65467:[[12619],256],65468:[[12620],256],65469:[[12621],256],65470:[[12622],256],65474:[[12623],256],65475:[[12624],256],65476:[[12625],256],65477:[[12626],256],65478:[[12627],256],65479:[[12628],256],65482:[[12629],256],65483:[[12630],256],65484:[[12631],256],65485:[[12632],256],65486:[[12633],256],65487:[[12634],256],65490:[[12635],256],65491:[[12636],256],65492:[[12637],256],65493:[[12638],256],65494:[[12639],256],65495:[[12640],256],65498:[[12641],256],65499:[[12642],256],65500:[[12643],256],65504:[[162],256],65505:[[163],256],65506:[[172],256],65507:[[175],256],65508:[[166],256],65509:[[165],256],65510:[[8361],256],65512:[[9474],256],65513:[[8592],256],65514:[[8593],256],65515:[[8594],256],65516:[[8595],256],65517:[[9632],256],65518:[[9675],256]}

};

   /***** Module to export */
   var unorm = {
      nfc: nfc,
      nfd: nfd,
      nfkc: nfkc,
      nfkd: nfkd,
   };

   /*globals module:true,define:true*/

   // CommonJS
   if (typeof module === "object") {
      module.exports = unorm;

   // AMD
   } else if (typeof define === "function" && define.amd) {
      define("unorm", function () {
         return unorm;
      });

   // Global
   } else {
      root.unorm = unorm;
   }

   /***** Export as shim for String::normalize method *****/
   /*
      http://wiki.ecmascript.org/doku.php?id=harmony:specification_drafts#november_8_2013_draft_rev_21

      21.1.3.12 String.prototype.normalize(form="NFC")
      When the normalize method is called with one argument form, the following steps are taken:

      1. Let O be CheckObjectCoercible(this value).
      2. Let S be ToString(O).
      3. ReturnIfAbrupt(S).
      4. If form is not provided or undefined let form be "NFC".
      5. Let f be ToString(form).
      6. ReturnIfAbrupt(f).
      7. If f is not one of "NFC", "NFD", "NFKC", or "NFKD", then throw a RangeError Exception.
      8. Let ns be the String value is the result of normalizing S into the normalization form named by f as specified in Unicode Standard Annex #15, UnicodeNormalizatoin Forms.
      9. Return ns.

      The length property of the normalize method is 0.

      *NOTE* The normalize function is intentionally generic; it does not require that its this value be a String object. Therefore it can be transferred to other kinds of objects for use as a method.
   */
   if (!String.prototype.normalize) {
      String.prototype.normalize = function(form) {
         var str = "" + this;
         form =  form === undefined ? "NFC" : form;

         if (form === "NFC") {
            return unorm.nfc(str);
         } else if (form === "NFD") {
            return unorm.nfd(str);
         } else if (form === "NFKC") {
            return unorm.nfkc(str);
         } else if (form === "NFKD") {
            return unorm.nfkd(str);
         } else {
            throw new RangeError("Invalid normalization form: " + form);
         }
      };
   }
}(this));

},{}]},{},[2])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlcyI6WyIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL2xpYi9odHRwLmpzIiwiL1VzZXJzL2pwb2NoeWxhL1Byb2plY3RzL3RyZXpvci5qcy9saWIvaW5kZXguanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL2xpYi9pbnN0YWxsZXJzLmpzIiwiL1VzZXJzL2pwb2NoeWxhL1Byb2plY3RzL3RyZXpvci5qcy9saWIvcGx1Z2luLmpzIiwiL1VzZXJzL2pwb2NoeWxhL1Byb2plY3RzL3RyZXpvci5qcy9saWIvc2Vzc2lvbi5qcyIsIi9Vc2Vycy9qcG9jaHlsYS9Qcm9qZWN0cy90cmV6b3IuanMvbGliL3RyYW5zcG9ydC9odHRwLmpzIiwiL1VzZXJzL2pwb2NoeWxhL1Byb2plY3RzL3RyZXpvci5qcy9saWIvdHJhbnNwb3J0L3BsdWdpbi5qcyIsIi9Vc2Vycy9qcG9jaHlsYS9Qcm9qZWN0cy90cmV6b3IuanMvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcmVxdWVzdC9pbmRleC5qcyIsIi9Vc2Vycy9qcG9jaHlsYS9Qcm9qZWN0cy90cmV6b3IuanMvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Fzc2VydC9hc3NlcnQuanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9hc3NlcnQvbm9kZV9tb2R1bGVzL3V0aWwvc3VwcG9ydC9pc0J1ZmZlckJyb3dzZXIuanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9hc3NlcnQvbm9kZV9tb2R1bGVzL3V0aWwvdXRpbC5qcyIsIi9Vc2Vycy9qcG9jaHlsYS9Qcm9qZWN0cy90cmV6b3IuanMvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIi9Vc2Vycy9qcG9jaHlsYS9Qcm9qZWN0cy90cmV6b3IuanMvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9jb25zb2xlLWJyb3dzZXJpZnkvaW5kZXguanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9jcnlwdG8tYnJvd3NlcmlmeS9oZWxwZXJzLmpzIiwiL1VzZXJzL2pwb2NoeWxhL1Byb2plY3RzL3RyZXpvci5qcy9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvY3J5cHRvLWJyb3dzZXJpZnkvaW5kZXguanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9jcnlwdG8tYnJvd3NlcmlmeS9tZDUuanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9jcnlwdG8tYnJvd3NlcmlmeS9ybmcuanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9jcnlwdG8tYnJvd3NlcmlmeS9zaGEuanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9jcnlwdG8tYnJvd3NlcmlmeS9zaGEyNTYuanMiLCIvVXNlcnMvanBvY2h5bGEvUHJvamVjdHMvdHJlem9yLmpzL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9ldmVudHMvZXZlbnRzLmpzIiwiL1VzZXJzL2pwb2NoeWxhL1Byb2plY3RzL3RyZXpvci5qcy9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvaW5oZXJpdHMvaW5oZXJpdHNfYnJvd3Nlci5qcyIsIi9Vc2Vycy9qcG9jaHlsYS9Qcm9qZWN0cy90cmV6b3IuanMvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2luc2VydC1tb2R1bGUtZ2xvYmFscy9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwiL1VzZXJzL2pwb2NoeWxhL1Byb2plY3RzL3RyZXpvci5qcy9ub2RlX21vZHVsZXMvZXh0ZW5kL2luZGV4LmpzIiwiL1VzZXJzL2pwb2NoeWxhL1Byb2plY3RzL3RyZXpvci5qcy9ub2RlX21vZHVsZXMvcHJvbWlzZS9jb3JlLmpzIiwiL1VzZXJzL2pwb2NoeWxhL1Byb2plY3RzL3RyZXpvci5qcy9ub2RlX21vZHVsZXMvcHJvbWlzZS9pbmRleC5qcyIsIi9Vc2Vycy9qcG9jaHlsYS9Qcm9qZWN0cy90cmV6b3IuanMvbm9kZV9tb2R1bGVzL3Byb21pc2Uvbm9kZV9tb2R1bGVzL2FzYXAvYXNhcC5qcyIsIi9Vc2Vycy9qcG9jaHlsYS9Qcm9qZWN0cy90cmV6b3IuanMvbm9kZV9tb2R1bGVzL3Vub3JtL2xpYi91bm9ybS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZZQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1a0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdmxDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9FQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1U0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7OztBQ3JEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3Rocm93IG5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIil9dmFyIGY9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGYuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sZixmLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsInZhciBQcm9taXNlID0gcmVxdWlyZSgncHJvbWlzZScpLFxuICAgIHJlcXVlc3QgPSByZXF1aXJlKCdicm93c2VyLXJlcXVlc3QnKTtcblxuZnVuY3Rpb24gcHJvbWlzZVJlcXVlc3Qob3B0aW9ucywgcGF5bG9hZCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICAgIHJlcXVlc3Qob3B0aW9ucywgZnVuY3Rpb24gKGVyciwgcmVzcG9uc2UsIGJvZHkpIHtcbiAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXNDb2RlICE9PSAyMDApIHtcbiAgICAgICAgICAgICAgICByZWplY3QobmV3IEVycm9yKCdSZXF1ZXN0IGZhaWxlZCB3aXRoIHN0YXR1cyAnXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICArIHJlc3BvbnNlLnN0YXR1c0NvZGUpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmVzb2x2ZShib2R5KTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gcHJvbWlzZVJlcXVlc3Q7XG4iLCIndXNlIHN0cmljdCc7XG5cbi8vIGludGVyZmFjZSBUcmFuc3BvcnQge1xuLy9cbi8vICAgICBmdW5jdGlvbiBjb25maWd1cmUoU3RyaW5nIGNvbmZpZykgLT4gUHJvbWlzZSgpXG4vL1xuLy8gICAgIGZ1bmN0aW9uIGVudW1lcmF0ZSgpIC0+IFByb21pc2UoW3tcbi8vICAgICAgICAgU3RyaW5nIHBhdGhcbi8vICAgICAgICAgU3RyaW5nIHZlbmRvclxuLy8gICAgICAgICBTdHJpbmcgcHJvZHVjdFxuLy8gICAgICAgICBTdHJpbmcgc2VyaWFsTnVtYmVyXG4vLyAgICAgICAgIFN0cmluZyBzZXNzaW9uXG4vLyAgICAgfV0gZGV2aWNlcylcbi8vXG4vLyAgICAgZnVuY3Rpb24gYWNxdWlyZShTdHJpbmcgcGF0aCkgLT4gUHJvbWlzZShTdHJpbmcgc2Vzc2lvbilcbi8vXG4vLyAgICAgZnVuY3Rpb24gcmVsZWFzZShTdHJpbmcgc2Vzc2lvbikgLT4gUHJvbWlzZSgpXG4vL1xuLy8gICAgIGZ1bmN0aW9uIGNhbGwoU3RyaW5nIHNlc3Npb24sIFN0cmluZyBuYW1lLCBPYmplY3QgZGF0YSkgLT4gUHJvbWlzZSh7XG4vLyAgICAgICAgIFN0cmluZyBuYW1lLFxuLy8gICAgICAgICBPYmplY3QgZGF0YSxcbi8vICAgICB9KVxuLy9cbi8vIH1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgaHR0cDogcmVxdWlyZSgnLi9odHRwJyksXG4gICAgSHR0cFRyYW5zcG9ydDogcmVxdWlyZSgnLi90cmFuc3BvcnQvaHR0cCcpLFxuICAgIHBsdWdpbjogcmVxdWlyZSgnLi9wbHVnaW4nKSxcbiAgICBQbHVnaW5UcmFuc3BvcnQ6IHJlcXVpcmUoJy4vdHJhbnNwb3J0L3BsdWdpbicpLFxuICAgIFNlc3Npb246IHJlcXVpcmUoJy4vc2Vzc2lvbicpLFxuICAgIGluc3RhbGxlcnM6IHJlcXVpcmUoJy4vaW5zdGFsbGVycycpXG59O1xuIiwidmFyIEJSSURHRV9WRVJTSU9OX1VSTCA9ICcvZGF0YS9icmlkZ2UvbGF0ZXN0LnR4dCcsXG4gICAgQlJJREdFX0lOU1RBTExFUlMgPSBbe1xuICAgICAgICB1cmw6ICcvZGF0YS9icmlkZ2UvJXZlcnNpb24lL0JpdGNvaW5UcmV6b3JCcmlkZ2UtJXZlcnNpb24lLm1zaScsXG4gICAgICAgIGxhYmVsOiAnV2luZG93cycsXG4gICAgICAgIHBsYXRmb3JtOiAnd2luJ1xuICAgIH0sIHtcbiAgICAgICAgdXJsOiAnL2RhdGEvYnJpZGdlLyV2ZXJzaW9uJS90cmV6b3ItYnJpZGdlLSV2ZXJzaW9uJS5kbWcnLFxuICAgICAgICBsYWJlbDogJ01hYyBPUyBYJyxcbiAgICAgICAgcGxhdGZvcm06ICdtYWMnXG4gICAgfSwge1xuICAgICAgICB1cmw6ICcvZGF0YS9icmlkZ2UvJXZlcnNpb24lL2Jyb3dzZXItYnJpZGdlLXRyZXpvcl8ldmVyc2lvbiVfYW1kNjQuZGViJyxcbiAgICAgICAgbGFiZWw6ICdMaW51eCB4ODZfNjQgKGRlYiknLFxuICAgICAgICBwbGF0Zm9ybTogJ2RlYjY0J1xuICAgIH0sIHtcbiAgICAgICAgdXJsOiAnL2RhdGEvYnJpZGdlLyV2ZXJzaW9uJS9icm93c2VyLWJyaWRnZS10cmV6b3ItJXZlcnNpb24lLng4Nl82NC5ycG0nLFxuICAgICAgICBsYWJlbDogJ0xpbnV4IHg4Nl82NCAocnBtKScsXG4gICAgICAgIHBsYXRmb3JtOiAncnBtNjQnXG4gICAgfSwge1xuICAgICAgICB1cmw6ICcvZGF0YS9icmlkZ2UvJXZlcnNpb24lL2Jyb3dzZXItYnJpZGdlLXRyZXpvcl8ldmVyc2lvbiVfaTM4Ni5kZWInLFxuICAgICAgICBsYWJlbDogJ0xpbnV4IGkzODYgKGRlYiknLFxuICAgICAgICBwbGF0Zm9ybTogJ2RlYjMyJ1xuICAgIH0sIHtcbiAgICAgICAgdXJsOiAnL2RhdGEvYnJpZGdlLyV2ZXJzaW9uJS9icm93c2VyLWJyaWRnZS10cmV6b3ItJXZlcnNpb24lLmkzODYucnBtJyxcbiAgICAgICAgbGFiZWw6ICdMaW51eCBpMzg2IChycG0pJyxcbiAgICAgICAgcGxhdGZvcm06ICdycG0zMidcbiAgICB9XTtcblxuLy8gUmV0dXJucyBhIGxpc3Qgb2YgYnJpZGdlIGluc3RhbGxlcnMsIHdpdGggZG93bmxvYWQgVVJMcyBhbmQgYSBtYXJrIG9uXG4vLyBicmlkZ2UgcHJlZmVycmVkIGZvciB0aGUgdXNlcidzIHBsYXRmb3JtLlxuZnVuY3Rpb24gaW5zdGFsbGVycyhvcHRpb25zKSB7XG4gICAgdmFyIG8gPSBvcHRpb25zIHx8IHt9LFxuICAgICAgICBicmlkZ2VVcmwgPSBvLmJyaWRnZVVybCB8fCBCUklER0VfVkVSU0lPTl9VUkwsXG4gICAgICAgIHZlcnNpb24gPSBvLnZlcnNpb24gfHwgcmVxdWVzdFVyaShicmlkZ2VVcmwpLnRyaW0oKSxcbiAgICAgICAgcGxhdGZvcm0gPSBvLnBsYXRmb3JtIHx8IHByZWZlcnJlZFBsYXRmb3JtKCk7XG5cbiAgICByZXR1cm4gQlJJREdFX0lOU1RBTExFUlMubWFwKGZ1bmN0aW9uIChicmlkZ2UpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZlcnNpb246IHZlcnNpb24sXG4gICAgICAgICAgICB1cmw6IGJyaWRnZS51cmwucmVwbGFjZSgvJXZlcnNpb24lL2csIHZlcnNpb24pLFxuICAgICAgICAgICAgbGFiZWw6IGJyaWRnZS5sYWJlbCxcbiAgICAgICAgICAgIHBsYXRmb3JtOiBicmlkZ2UucGxhdGZvcm0sXG4gICAgICAgICAgICBwcmVmZXJyZWQ6IChicmlkZ2UucGxhdGZvcm0gPT09IHBsYXRmb3JtKVxuICAgICAgICB9O1xuICAgIH0pO1xufTtcblxuZnVuY3Rpb24gcHJlZmVycmVkUGxhdGZvcm0oKSB7XG4gICAgdmFyIHZlciA9IG5hdmlnYXRvci51c2VyQWdlbnQ7XG5cbiAgICBpZiAodmVyLm1hdGNoKC9XaW4vKSkgcmV0dXJuICd3aW4nO1xuICAgIGlmICh2ZXIubWF0Y2goL01hYy8pKSByZXR1cm4gJ21hYyc7XG4gICAgaWYgKHZlci5tYXRjaCgvTGludXggaVszNDU2XTg2LykpXG4gICAgICAgIHJldHVybiB2ZXIubWF0Y2goL0NlbnRPU3xGZWRvcmF8TWFuZHJpdmF8TWFnZWlhfFJlZCBIYXR8U2NpZW50aWZpY3xTVVNFLylcbiAgICAgICAgICAgID8gJ3JwbTMyJyA6ICdkZWIzMic7XG4gICAgaWYgKHZlci5tYXRjaCgvTGludXgvKSlcbiAgICAgICAgcmV0dXJuIHZlci5tYXRjaCgvQ2VudE9TfEZlZG9yYXxNYW5kcml2YXxNYWdlaWF8UmVkIEhhdHxTY2llbnRpZmljfFNVU0UvKVxuICAgICAgICAgICAgPyAncnBtNjQnIDogJ2RlYjY0Jztcbn1cblxuZnVuY3Rpb24gcmVxdWVzdFVyaSh1cmwpIHtcbiAgICB2YXIgcmVxID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG5cbiAgICByZXEub3BlbignZ2V0JywgdXJsLCBmYWxzZSk7XG4gICAgcmVxLnNlbmQoKTtcblxuICAgIGlmIChyZXEuc3RhdHVzICE9PSAyMDApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIEdFVCAnICsgdXJsKTtcblxuICAgIHJldHVybiByZXEucmVzcG9uc2VUZXh0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGluc3RhbGxlcnM7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjb25zb2xlID0gcmVxdWlyZSgnY29uc29sZScpLFxuICAgIGV4dGVuZCA9IHJlcXVpcmUoJ2V4dGVuZCcpLFxuICAgIFByb21pc2UgPSByZXF1aXJlKCdwcm9taXNlJyk7XG5cbi8vIFRyeSB0byBsb2FkIGEgcGx1Z2luIHdpdGggZ2l2ZW4gb3B0aW9ucywgcmV0dXJucyBwcm9taXNlLiBJbiBjYXNlIG9mXG4vLyByZWplY3Rpb24sIGVyciBjb250YWlucyBgaW5zdGFsbGVkYCBwcm9wZXJ0eS4gSWYgbm90IGluc3RhbGxlZCwgeW91IGNhbiBnZXRcbi8vIGRvd25sb2FkIFVSTHMgZm9yIHRoZSBsYXRlc3QgcGx1Z2luIHZlcnNpb24gd2l0aCB0aGUgYGluc3RhbGxlcnNgIG1ldGhvZC5cbm1vZHVsZS5leHBvcnRzLmxvYWQgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgIHZhciBvID0gZXh0ZW5kKG9wdGlvbnMsIHtcbiAgICAgICAgLy8gbWltZXR5cGUgb2YgdGhlIHBsdWdpblxuICAgICAgICBtaW1ldHlwZTogJ2FwcGxpY2F0aW9uL3gtYml0Y29pbnRyZXpvcnBsdWdpbicsXG4gICAgICAgIC8vIG5hbWUgb2YgdGhlIGNhbGxiYWNrIGluIHRoZSBnbG9iYWwgbmFtZXNwYWNlXG4gICAgICAgIGZuYW1lOiAnX190cmV6b3JQbHVnaW5Mb2FkZWQnLFxuICAgICAgICAvLyBpZCBvZiB0aGUgcGx1Z2luIGVsZW1lbnRcbiAgICAgICAgaWQ6ICdfX3RyZXpvci1wbHVnaW4nLFxuICAgICAgICAvLyB0aW1lIHRvIHdhaXQgdW50aWwgdGltZW91dCwgaW4gbXNlY1xuICAgICAgICB0aW1lb3V0OiA1MDBcbiAgICB9KTtcblxuICAgIC8vIGlmIHdlIGtub3cgZm9yIHN1cmUgdGhhdCB0aGUgcGx1Z2luIGlzIGluc3RhbGxlZCwgbmV2ZXIgdGltZW91dFxuICAgIHZhciBpbnN0YWxsZWQgPSBpc0luc3RhbGxlZChvLm1pbWV0eXBlKSxcbiAgICAgICAgdGltZW91dCA9IGluc3RhbGxlZCA/IDAgOiBvLnRpbWVvdXQ7XG5cbiAgICAvLyBpZiB0aGUgcGx1Z2luIGlzIGFscmVhZHkgbG9hZGVkLCB1c2UgaXRcbiAgICB2YXIgcGx1Z2luID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoby5pZCk7XG4gICAgaWYgKHBsdWdpbilcbiAgICAgICAgcmV0dXJuIFByb21pc2UuZnJvbShwbHVnaW4pO1xuXG4gICAgLy8gaW5qZWN0IG9yIHJlamVjdCBhZnRlciB0aW1lb3V0XG4gICAgcmV0dXJuIFByb21pc2UucmFjZShbXG4gICAgICAgIGluamVjdFBsdWdpbihvLmlkLCBvLm1pbWV0eXBlLCBvLmZuYW1lKSxcbiAgICAgICAgcmVqZWN0QWZ0ZXIodGltZW91dCwgbmV3IEVycm9yKCdMb2FkaW5nIHRpbWVvdXQgb3V0JykpXG4gICAgXSkuY2F0Y2goZnVuY3Rpb24gKGVycikge1xuICAgICAgICBlcnIuaW5zdGFsbGVkID0gaW5zdGFsbGVkO1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgfSkudGhlbihcbiAgICAgICAgZnVuY3Rpb24gKHBsdWdpbikge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ1t0cmV6b3JdIExvYWRlZCBwbHVnaW4gJyArIHBsdWdpbi52ZXJzaW9uKTtcbiAgICAgICAgICAgIHJldHVybiBwbHVnaW47XG4gICAgICAgIH0sXG4gICAgICAgIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1t0cmV6b3JdIEZhaWxlZCB0byBsb2FkIHBsdWdpbjogJyArIGVyci5tZXNzYWdlKTtcbiAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfVxuICAgICk7XG59O1xuXG4vLyBJbmplY3RzIHRoZSBwbHVnaW4gb2JqZWN0IGludG8gdGhlIHBhZ2UgYW5kIHdhaXRzIHVudGlsIGl0IGxvYWRzLlxuZnVuY3Rpb24gaW5qZWN0UGx1Z2luKGlkLCBtaW1ldHlwZSwgZm5hbWUpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICB2YXIgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdib2R5JylbMF0sXG4gICAgICAgICAgICBlbGVtID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG5cbiAgICAgICAgLy8gcmVnaXN0ZXIgbG9hZCBmdW5jdGlvblxuICAgICAgICB3aW5kb3dbZm5hbWVdID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHBsdWdpbiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTtcbiAgICAgICAgICAgIGlmIChwbHVnaW4pXG4gICAgICAgICAgICAgICAgcmVzb2x2ZShwbHVnaW4pO1xuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoJ1BsdWdpbiBub3QgZm91bmQnKSk7XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gaW5qZWN0IG9iamVjdCBlbGVtXG4gICAgICAgIGJvZHkuYXBwZW5kQ2hpbGQoZWxlbSk7XG4gICAgICAgIGVsZW0uaW5uZXJIVE1MID1cbiAgICAgICAgICAgICc8b2JqZWN0IHdpZHRoPVwiMVwiIGhlaWdodD1cIjFcIiBpZD1cIicraWQrJ1wiIHR5cGU9XCInK21pbWV0eXBlKydcIj4nK1xuICAgICAgICAgICAgJyA8cGFyYW0gbmFtZT1cIm9ubG9hZFwiIHZhbHVlPVwiJytmbmFtZSsnXCIgLz4nK1xuICAgICAgICAgICAgJzwvb2JqZWN0Pic7XG4gICAgfSk7XG59XG5cbi8vIElmIGdpdmVuIHRpbWVvdXQsIGdldHMgcmVqZWN0ZWQgYWZ0ZXIgbiBtc2VjLCBvdGhlcndpc2UgbmV2ZXIgcmVzb2x2ZXMuXG5mdW5jdGlvbiByZWplY3RBZnRlcihtc2VjLCB2YWwpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICBpZiAobXNlYyA+IDApXG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHsgcmVqZWN0KHZhbCk7IH0sIG1zZWMpO1xuICAgIH0pO1xufVxuXG4vLyBSZXR1cm5zIHRydWUgaWYgcGx1Z2luIHdpdGggYSBnaXZlbiBtaW1ldHlwZSBpcyBpbnN0YWxsZWQuXG5mdW5jdGlvbiBpc0luc3RhbGxlZChtaW1ldHlwZSkge1xuICAgIG5hdmlnYXRvci5wbHVnaW5zLnJlZnJlc2goZmFsc2UpO1xuICAgIHJldHVybiAhIW5hdmlnYXRvci5taW1lVHlwZXNbbWltZXR5cGVdO1xufVxuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbCA9IHJlcXVpcmUoJ3V0aWwnKSxcbiAgICB1bm9ybSA9IHJlcXVpcmUoJ3Vub3JtJyksXG4gICAgY3J5cHRvID0gcmVxdWlyZSgnY3J5cHRvJyksXG4gICAgUHJvbWlzZSA9IHJlcXVpcmUoJ3Byb21pc2UnKSxcbiAgICBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXI7XG5cbi8vXG4vLyBUcmV6b3IgZGV2aWNlIHNlc3Npb24gaGFuZGxlLiBBY3RzIGFzIGEgZXZlbnQgZW1pdHRlci5cbi8vXG4vLyBFdmVudHM6XG4vL1xuLy8gIHNlbmQ6IHR5cGUsIG1lc3NhZ2Vcbi8vICByZWNlaXZlOiB0eXBlLCBtZXNzYWdlXG4vLyAgZXJyb3I6IGVycm9yXG4vL1xuLy8gIGJ1dHRvbjogY29kZVxuLy8gIHBpbjogdHlwZSwgY2FsbGJhY2soZXJyb3IsIHBpbilcbi8vICB3b3JkOiBjYWxsYmFjayhlcnJvciwgd29yZClcbi8vICBwYXNzcGhyYXNlOiBjYWxsYmFjayhlcnJvciwgcGFzc3BocmFzZSlcbi8vXG52YXIgU2Vzc2lvbiA9IGZ1bmN0aW9uICh0cmFuc3BvcnQsIHNlc3Npb25JZCkge1xuICAgIHRoaXMuX3RyYW5zcG9ydCA9IHRyYW5zcG9ydDtcbiAgICB0aGlzLl9zZXNzaW9uSWQgPSBzZXNzaW9uSWQ7XG4gICAgdGhpcy5fZW1pdHRlciA9IHRoaXM7IC8vIFRPRE86IGdldCBlbWl0dGVyIGFzIGEgcGFyYW1cbn07XG5cbnV0aWwuaW5oZXJpdHMoU2Vzc2lvbiwgRXZlbnRFbWl0dGVyKTtcblxuU2Vzc2lvbi5wcm90b3R5cGUucmVsZWFzZSA9IGZ1bmN0aW9uICgpIHtcbiAgICBjb25zb2xlLmxvZygnW3RyZXpvcl0gUmVsZWFzaW5nIHNlc3Npb24nKTtcbiAgICByZXR1cm4gdGhpcy5fdHJhbnNwb3J0LnJlbGVhc2UodGhpcy5fc2Vzc2lvbklkKTtcbn07XG5cblNlc3Npb24ucHJvdG90eXBlLmluaXRpYWxpemUgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3R5cGVkQ29tbW9uQ2FsbCgnSW5pdGlhbGl6ZScsICdGZWF0dXJlcycpO1xufTtcblxuU2Vzc2lvbi5wcm90b3R5cGUuZ2V0RW50cm9weSA9IGZ1bmN0aW9uIChzaXplKSB7XG4gICAgcmV0dXJuIHRoaXMuX3R5cGVkQ29tbW9uQ2FsbCgnR2V0RW50cm9weScsICdFbnRyb3B5Jywge1xuICAgICAgICBzaXplOiBzaXplXG4gICAgfSk7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5nZXRBZGRyZXNzID0gZnVuY3Rpb24gKGFkZHJlc3Nfbikge1xuICAgIHJldHVybiB0aGlzLl90eXBlZENvbW1vbkNhbGwoJ0dldEFkZHJlc3MnLCAnQWRkcmVzcycsIHtcbiAgICAgICAgYWRkcmVzc19uOiBhZGRyZXNzX25cbiAgICB9KS50aGVuKGZ1bmN0aW9uIChyZXMpIHtcbiAgICAgICAgcmVzLm1lc3NhZ2UucGF0aCA9IGFkZHJlc3NfbiB8fCBbXTtcbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICB9KTtcbn07XG5cblNlc3Npb24ucHJvdG90eXBlLmdldFB1YmxpY0tleSA9IGZ1bmN0aW9uIChhZGRyZXNzX24pIHtcbiAgICByZXR1cm4gdGhpcy5fdHlwZWRDb21tb25DYWxsKCdHZXRQdWJsaWNLZXknLCAnUHVibGljS2V5Jywge1xuICAgICAgICBhZGRyZXNzX246IGFkZHJlc3NfblxuICAgIH0pLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgICAgICByZXMubWVzc2FnZS5ub2RlLnBhdGggPSBhZGRyZXNzX24gfHwgW107XG4gICAgICAgIHJldHVybiByZXM7XG4gICAgfSk7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS53aXBlRGV2aWNlID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiB0aGlzLl9jb21tb25DYWxsKCdXaXBlRGV2aWNlJyk7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5yZXNldERldmljZSA9IGZ1bmN0aW9uIChzZXR0aW5ncykge1xuICAgIHJldHVybiB0aGlzLl9jb21tb25DYWxsKCdSZXNldERldmljZScsIHNldHRpbmdzKTtcbn07XG5cblNlc3Npb24ucHJvdG90eXBlLmxvYWREZXZpY2UgPSBmdW5jdGlvbiAoc2V0dGluZ3MpIHtcbiAgICByZXR1cm4gdGhpcy5fY29tbW9uQ2FsbCgnTG9hZERldmljZScsIHNldHRpbmdzKTtcbn07XG5cblNlc3Npb24ucHJvdG90eXBlLnJlY292ZXJEZXZpY2UgPSBmdW5jdGlvbiAoc2V0dGluZ3MpIHtcbiAgICByZXR1cm4gdGhpcy5fY29tbW9uQ2FsbCgnUmVjb3ZlcnlEZXZpY2UnLCBzZXR0aW5ncyk7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5hcHBseVNldHRpbmdzID0gZnVuY3Rpb24gKHNldHRpbmdzKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbW1vbkNhbGwoJ0FwcGx5U2V0dGluZ3MnLCBzZXR0aW5ncyk7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5jaGFuZ2VQaW4gPSBmdW5jdGlvbiAocmVtb3ZlKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbW1vbkNhbGwoJ0NoYW5nZVBpbicsIHtcbiAgICAgICAgcmVtb3ZlOiByZW1vdmUgfHwgZmFsc2VcbiAgICB9KTtcbn07XG5cblNlc3Npb24ucHJvdG90eXBlLmVyYXNlRmlybXdhcmUgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbW1vbkNhbGwoJ0Zpcm13YXJlRXJhc2UnKTtcbn07XG5cblNlc3Npb24ucHJvdG90eXBlLnVwbG9hZEZpcm13YXJlID0gZnVuY3Rpb24gKHBheWxvYWQpIHtcbiAgICByZXR1cm4gdGhpcy5fY29tbW9uQ2FsbCgnRmlybXdhcmVVcGxvYWQnLCB7XG4gICAgICAgIHBheWxvYWQ6IHBheWxvYWRcbiAgICB9KTtcbn07XG5cblNlc3Npb24ucHJvdG90eXBlLnZlcmlmeU1lc3NhZ2UgPSBmdW5jdGlvbiAoYWRkcmVzcywgc2lnbmF0dXJlLCBtZXNzYWdlKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbW1vbkNhbGwoJ1ZlcmlmeU1lc3NhZ2UnLCB7XG4gICAgICAgIGFkZHJlc3M6IGFkZHJlc3MsXG4gICAgICAgIHNpZ25hdHVyZTogc2lnbmF0dXJlLFxuICAgICAgICBtZXNzYWdlOiBtZXNzYWdlXG4gICAgfSk7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5zaWduTWVzc2FnZSA9IGZ1bmN0aW9uIChhZGRyZXNzX24sIG1lc3NhZ2UsIGNvaW4pIHtcbiAgICByZXR1cm4gdGhpcy5fdHlwZWRDb21tb25DYWxsKCdTaWduTWVzc2FnZScsICdNZXNzYWdlU2lnbmF0dXJlJywge1xuICAgICAgICBhZGRyZXNzX246IGFkZHJlc3NfbixcbiAgICAgICAgbWVzc2FnZTogbWVzc2FnZSxcbiAgICAgICAgY29pbl9uYW1lOiBjb2luLmNvaW5fbmFtZVxuICAgIH0pO1xufTtcblxuU2Vzc2lvbi5wcm90b3R5cGUubWVhc3VyZVR4ID0gZnVuY3Rpb24gKGlucHV0cywgb3V0cHV0cywgY29pbikge1xuICAgIHJldHVybiB0aGlzLl90eXBlZENvbW1vbkNhbGwoJ0VzdGltYXRlVHhTaXplJywgJ1R4U2l6ZScsIHtcbiAgICAgICAgaW5wdXRzX2NvdW50OiBpbnB1dHMubGVuZ3RoLFxuICAgICAgICBvdXRwdXRzX2NvdW50OiBvdXRwdXRzLmxlbmd0aCxcbiAgICAgICAgY29pbl9uYW1lOiBjb2luLmNvaW5fbmFtZVxuICAgIH0pO1xufTtcblxuU2Vzc2lvbi5wcm90b3R5cGUuc2ltcGxlU2lnblR4ID0gZnVuY3Rpb24gKGlucHV0cywgb3V0cHV0cywgdHhzLCBjb2luKSB7XG4gICAgcmV0dXJuIHRoaXMuX3R5cGVkQ29tbW9uQ2FsbCgnU2ltcGxlU2lnblR4JywgJ1R4UmVxdWVzdCcsIHtcbiAgICAgICAgaW5wdXRzOiBpbnB1dHMsXG4gICAgICAgIG91dHB1dHM6IG91dHB1dHMsXG4gICAgICAgIGNvaW5fbmFtZTogY29pbi5jb2luX25hbWUsXG4gICAgICAgIHRyYW5zYWN0aW9uczogdHhzXG4gICAgfSk7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5faW5kZXhUeHNGb3JTaWduID0gZnVuY3Rpb24gKGlucHV0cywgb3V0cHV0cywgdHhzKSB7XG4gICAgdmFyIGluZGV4ID0ge307XG5cbiAgICAvLyBUeCBiZWluZyBzaWduZWRcbiAgICBpbmRleFsnJ10gPSB7XG4gICAgICAgIGlucHV0czogaW5wdXRzLFxuICAgICAgICBvdXRwdXRzOiBvdXRwdXRzXG4gICAgfTtcblxuICAgIC8vIFJlZmVyZW5jZWQgdHhzXG4gICAgdHhzLmZvckVhY2goZnVuY3Rpb24gKHR4KSB7XG4gICAgICAgIGluZGV4W3R4Lmhhc2hdID0gdHg7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gaW5kZXg7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5zaWduVHggPSBmdW5jdGlvbiAoaW5wdXRzLCBvdXRwdXRzLCB0eHMsIGNvaW4pIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIGluZGV4ID0gdGhpcy5faW5kZXhUeHNGb3JTaWduKGlucHV0cywgb3V0cHV0cywgdHhzKSxcbiAgICAgICAgc2lnbmF0dXJlcyA9IFtdLFxuICAgICAgICBzZXJpYWxpemVkVHggPSAnJztcblxuICAgIHJldHVybiB0aGlzLl90eXBlZENvbW1vbkNhbGwoJ1NpZ25UeCcsICdUeFJlcXVlc3QnLCB7XG4gICAgICAgIGlucHV0c19jb3VudDogaW5wdXRzLmxlbmd0aCxcbiAgICAgICAgb3V0cHV0c19jb3VudDogb3V0cHV0cy5sZW5ndGgsXG4gICAgICAgIGNvaW5fbmFtZTogY29pbi5jb2luX25hbWVcbiAgICB9KS50aGVuKHByb2Nlc3MpO1xuXG4gICAgZnVuY3Rpb24gcHJvY2VzcyhyZXMpIHtcbiAgICAgICAgdmFyIG0gPSByZXMubWVzc2FnZSxcbiAgICAgICAgICAgIG1zID0gbS5zZXJpYWxpemVkLFxuICAgICAgICAgICAgbWQgPSBtLmRldGFpbHMsXG4gICAgICAgICAgICByZXFUeCwgcmVzVHg7XG5cbiAgICAgICAgaWYgKG1zICYmIG1zLnNlcmlhbGl6ZWRfdHggIT0gbnVsbClcbiAgICAgICAgICAgIHNlcmlhbGl6ZWRUeCArPSBtcy5zZXJpYWxpemVkX3R4O1xuICAgICAgICBpZiAobXMgJiYgbXMuc2lnbmF0dXJlX2luZGV4ICE9IG51bGwpXG4gICAgICAgICAgICBzaWduYXR1cmVzW21zLnNpZ25hdHVyZV9pbmRleF0gPSBtcy5zaWduYXR1cmU7XG5cbiAgICAgICAgaWYgKG0ucmVxdWVzdF90eXBlID09PSAnVFhGSU5JU0hFRCcpXG4gICAgICAgICAgICByZXR1cm4geyAvLyBzYW1lIGZvcm1hdCBhcyBTaW1wbGVTaWduVHhcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiB7XG4gICAgICAgICAgICAgICAgICAgIHNlcmlhbGl6ZWQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpZ25hdHVyZXM6IHNpZ25hdHVyZXMsXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXJpYWxpemVkX3R4OiBzZXJpYWxpemVkVHhcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgcmVzVHggPSB7fTtcbiAgICAgICAgcmVxVHggPSBpbmRleFttZC50eF9oYXNoIHx8ICcnXTtcblxuICAgICAgICBpZiAoIXJlcVR4KVxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1kLnR4X2hhc2hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/ICgnUmVxdWVzdGVkIHVua25vd24gdHg6ICcgKyBtZC50eF9oYXNoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogKCdSZXF1ZXN0ZWQgdHggZm9yIHNpZ25pbmcgbm90IGluZGV4ZWQnKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcblxuICAgICAgICBzd2l0Y2ggKG0ucmVxdWVzdF90eXBlKSB7XG5cbiAgICAgICAgY2FzZSAnVFhJTlBVVCc6XG4gICAgICAgICAgICByZXNUeC5pbnB1dHMgPSBbcmVxVHguaW5wdXRzWyttZC5yZXF1ZXN0X2luZGV4XV07XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICBjYXNlICdUWE9VVFBVVCc6XG4gICAgICAgICAgICBpZiAobWQudHhfaGFzaClcbiAgICAgICAgICAgICAgICByZXNUeC5iaW5fb3V0cHV0cyA9IFtyZXFUeC5iaW5fb3V0cHV0c1srbWQucmVxdWVzdF9pbmRleF1dO1xuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJlc1R4Lm91dHB1dHMgPSBbcmVxVHgub3V0cHV0c1srbWQucmVxdWVzdF9pbmRleF1dO1xuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgY2FzZSAnVFhNRVRBJzpcbiAgICAgICAgICAgIHJlc1R4LnZlcnNpb24gPSByZXFUeC52ZXJzaW9uO1xuICAgICAgICAgICAgcmVzVHgubG9ja190aW1lID0gcmVxVHgubG9ja190aW1lO1xuICAgICAgICAgICAgcmVzVHguaW5wdXRzX2NudCA9IHJlcVR4LmlucHV0cy5sZW5ndGg7XG4gICAgICAgICAgICBpZiAobWQudHhfaGFzaClcbiAgICAgICAgICAgICAgICByZXNUeC5vdXRwdXRzX2NudCA9IHJlcVR4LmJpbl9vdXRwdXRzLmxlbmd0aDtcbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZXNUeC5vdXRwdXRzX2NudCA9IHJlcVR4Lm91dHB1dHMubGVuZ3RoO1xuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biByZXF1ZXN0IHR5cGU6ICcgKyBtLnJlcXVlc3RfdHlwZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2VsZi5fdHlwZWRDb21tb25DYWxsKCdUeEFjaycsICdUeFJlcXVlc3QnLCB7XG4gICAgICAgICAgICB0eDogcmVzVHhcbiAgICAgICAgfSkudGhlbihwcm9jZXNzKTtcbiAgICB9XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5fdHlwZWRDb21tb25DYWxsID0gZnVuY3Rpb24gKHR5cGUsIHJlc1R5cGUsIG1zZykge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHJldHVybiB0aGlzLl9jb21tb25DYWxsKHR5cGUsIG1zZykudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgICAgIHJldHVybiBzZWxmLl9hc3NlcnRUeXBlKHJlcywgcmVzVHlwZSk7XG4gICAgfSk7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5fYXNzZXJ0VHlwZSA9IGZ1bmN0aW9uIChyZXMsIHJlc1R5cGUpIHtcbiAgICBpZiAocmVzLnR5cGUgIT09IHJlc1R5cGUpXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Jlc3BvbnNlIG9mIHVuZXhwZWN0ZWQgdHlwZTogJyArIHJlcy50eXBlKTtcbiAgICByZXR1cm4gcmVzO1xufTtcblxuU2Vzc2lvbi5wcm90b3R5cGUuX2NvbW1vbkNhbGwgPSBmdW5jdGlvbiAodHlwZSwgbXNnKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBjYWxscHIgPSB0aGlzLl9jYWxsKHR5cGUsIG1zZyk7XG5cbiAgICByZXR1cm4gY2FsbHByLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgICAgICByZXR1cm4gc2VsZi5fZmlsdGVyQ29tbW9uVHlwZXMocmVzKTtcbiAgICB9KTtcbn07XG5cblNlc3Npb24ucHJvdG90eXBlLl9maWx0ZXJDb21tb25UeXBlcyA9IGZ1bmN0aW9uIChyZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICBpZiAocmVzLnR5cGUgPT09ICdGYWlsdXJlJylcbiAgICAgICAgdGhyb3cgcmVzLm1lc3NhZ2U7XG5cbiAgICBpZiAocmVzLnR5cGUgPT09ICdCdXR0b25SZXF1ZXN0Jykge1xuICAgICAgICB0aGlzLl9lbWl0dGVyLmVtaXQoJ2J1dHRvbicsIHJlcy5tZXNzYWdlLmNvZGUpO1xuICAgICAgICByZXR1cm4gdGhpcy5fY29tbW9uQ2FsbCgnQnV0dG9uQWNrJyk7XG4gICAgfVxuXG4gICAgaWYgKHJlcy50eXBlID09PSAnRW50cm9weVJlcXVlc3QnKVxuICAgICAgICByZXR1cm4gdGhpcy5fY29tbW9uQ2FsbCgnRW50cm9weUFjaycsIHtcbiAgICAgICAgICAgIGVudHJvcHk6IHN0cmluZ1RvSGV4KHRoaXMuX2dlbmVyYXRlRW50cm9weSgzMikpXG4gICAgICAgIH0pO1xuXG4gICAgaWYgKHJlcy50eXBlID09PSAnUGluTWF0cml4UmVxdWVzdCcpXG4gICAgICAgIHJldHVybiB0aGlzLl9wcm9tcHRQaW4ocmVzLm1lc3NhZ2UudHlwZSkudGhlbihcbiAgICAgICAgICAgIGZ1bmN0aW9uIChwaW4pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc2VsZi5fY29tbW9uQ2FsbCgnUGluTWF0cml4QWNrJywgeyBwaW46IHBpbiB9KTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNlbGYuX2NvbW1vbkNhbGwoJ0NhbmNlbCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICApO1xuXG4gICAgaWYgKHJlcy50eXBlID09PSAnUGFzc3BocmFzZVJlcXVlc3QnKVxuICAgICAgICByZXR1cm4gdGhpcy5fcHJvbXB0UGFzc3BocmFzZSgpLnRoZW4oXG4gICAgICAgICAgICBmdW5jdGlvbiAocGFzc3BocmFzZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzZWxmLl9jb21tb25DYWxsKCdQYXNzcGhyYXNlQWNrJywgeyBwYXNzcGhyYXNlOiBwYXNzcGhyYXNlIH0pO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc2VsZi5fY29tbW9uQ2FsbCgnQ2FuY2VsJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICk7XG5cbiAgICBpZiAocmVzLnR5cGUgPT09ICdXb3JkUmVxdWVzdCcpXG4gICAgICAgIHJldHVybiB0aGlzLl9wcm9tcHRXb3JkKCkudGhlbihcbiAgICAgICAgICAgIGZ1bmN0aW9uICh3b3JkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNlbGYuX2NvbW1vbkNhbGwoJ1dvcmRBY2snLCB7IHdvcmQ6IHdvcmQgfSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzZWxmLl9jb21tb25DYWxsKCdDYW5jZWwnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgKTtcblxuICAgIHJldHVybiByZXM7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5fcHJvbXB0UGluID0gZnVuY3Rpb24gKHR5cGUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICBpZiAoIXNlbGYuX2VtaXR0ZXIuZW1pdCgncGluJywgdHlwZSwgZnVuY3Rpb24gKGVyciwgcGluKSB7XG4gICAgICAgICAgICBpZiAoZXJyIHx8IHBpbiA9PSBudWxsKVxuICAgICAgICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJlc29sdmUocGluKTtcbiAgICAgICAgfSkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybignW3RyZXpvcl0gUElOIGNhbGxiYWNrIG5vdCBjb25maWd1cmVkLCBjYW5jZWxsaW5nIHJlcXVlc3QnKTtcbiAgICAgICAgICAgIHJlamVjdCgpO1xuICAgICAgICB9XG4gICAgfSk7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5fcHJvbXB0UGFzc3BocmFzZSA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICBpZiAoIXNlbGYuX2VtaXR0ZXIuZW1pdCgncGFzc3BocmFzZScsIGZ1bmN0aW9uIChlcnIsIHBhc3NwaHJhc2UpIHtcbiAgICAgICAgICAgIGlmIChlcnIgfHwgcGFzc3BocmFzZSA9PSBudWxsKVxuICAgICAgICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJlc29sdmUocGFzc3BocmFzZS5ub3JtYWxpemUoJ05GS0QnKSk7XG4gICAgICAgIH0pKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oJ1t0cmV6b3JdIFBhc3NwaHJhc2UgY2FsbGJhY2sgbm90IGNvbmZpZ3VyZWQsIGNhbmNlbGxpbmcgcmVxdWVzdCcpO1xuICAgICAgICAgICAgcmVqZWN0KCk7XG4gICAgICAgIH1cbiAgICB9KTtcbn07XG5cblNlc3Npb24ucHJvdG90eXBlLl9wcm9tcHRXb3JkID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICAgIGlmICghc2VsZi5fZW1pdHRlci5lbWl0KCd3b3JkJywgZnVuY3Rpb24gKGVyciwgd29yZCkge1xuICAgICAgICAgICAgaWYgKGVyciB8fCB3b3JkID09IG51bGwpXG4gICAgICAgICAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh3b3JkLnRvTG9jYWxlTG93ZXJDYXNlKCkpO1xuICAgICAgICB9KSkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKCdbdHJlem9yXSBXb3JkIGNhbGxiYWNrIG5vdCBjb25maWd1cmVkLCBjYW5jZWxsaW5nIHJlcXVlc3QnKTtcbiAgICAgICAgICAgIHJlamVjdCgpO1xuICAgICAgICB9XG4gICAgfSk7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5fZ2VuZXJhdGVFbnRyb3B5ID0gZnVuY3Rpb24gKGxlbikge1xuICAgIHJldHVybiBjcnlwdG8ucmFuZG9tQnl0ZXMobGVuKS50b1N0cmluZygnYmluYXJ5Jyk7XG59O1xuXG5TZXNzaW9uLnByb3RvdHlwZS5fY2FsbCA9IGZ1bmN0aW9uICh0eXBlLCBtc2cpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICBtc2cgPSBtc2cgfHwge307XG5cbiAgICBjb25zb2xlLmxvZygnW3RyZXpvcl0gU2VuZGluZycsIHR5cGUsIG1zZyk7XG4gICAgdGhpcy5fZW1pdHRlci5lbWl0KCdzZW5kJywgdHlwZSwgbXNnKTtcblxuICAgIHJldHVybiB0aGlzLl90cmFuc3BvcnQuY2FsbCh0aGlzLl9zZXNzaW9uSWQsIHR5cGUsIG1zZylcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ1t0cmV6b3JdIFJlY2VpdmVkJywgcmVzLnR5cGUsIHJlcy5tZXNzYWdlKTtcbiAgICAgICAgICAgIHNlbGYuX2VtaXR0ZXIuZW1pdCgncmVjZWl2ZScsIHJlcy50eXBlLCByZXMubWVzc2FnZSk7XG4gICAgICAgICAgICByZXR1cm4gcmVzO1xuICAgICAgICB9KTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2Vzc2lvbjtcblxuLy9cbi8vIEhleCBjb2RlY1xuLy9cblxuLy8gRW5jb2RlIGJpbmFyeSBzdHJpbmcgdG8gaGV4IHN0cmluZ1xuZnVuY3Rpb24gc3RyaW5nVG9IZXgoYmluKSB7XG4gICAgdmFyIGksIGNociwgaGV4ID0gJyc7XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgYmluLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNociA9IChiaW4uY2hhckNvZGVBdChpKSAmIDB4RkYpLnRvU3RyaW5nKDE2KTtcbiAgICAgICAgaGV4ICs9IGNoci5sZW5ndGggPCAyID8gJzAnICsgY2hyIDogY2hyO1xuICAgIH1cblxuICAgIHJldHVybiBoZXg7XG59XG5cbi8vIERlY29kZSBoZXggc3RyaW5nIHRvIGJpbmFyeSBzdHJpbmdcbmZ1bmN0aW9uIGhleFRvU3RyaW5nKGhleCkge1xuICAgIHZhciBpLCBieXRlcyA9IFtdO1xuXG4gICAgZm9yIChpID0gMDsgaSA8IGhleC5sZW5ndGggLSAxOyBpICs9IDIpXG4gICAgICAgIGJ5dGVzLnB1c2gocGFyc2VJbnQoaGV4LnN1YnN0cihpLCAyKSwgMTYpKTtcblxuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KFN0cmluZywgYnl0ZXMpO1xufVxuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXh0ZW5kID0gcmVxdWlyZSgnZXh0ZW5kJyksXG4gICAgaHR0cCA9IHJlcXVpcmUoJy4uL2h0dHAnKTtcblxuLy9cbi8vIEhUVFAgdHJhbnNwb3J0LlxuLy9cbnZhciBIdHRwVHJhbnNwb3J0ID0gZnVuY3Rpb24gKHVybCkge1xuICAgIHRoaXMuX3VybCA9IHVybDtcbn07XG5cbkh0dHBUcmFuc3BvcnQuY29ubmVjdCA9IGZ1bmN0aW9uICh1cmwpIHtcbiAgICByZXR1cm4gaHR0cCh7XG4gICAgICAgIHVybDogdXJsLCBqc29uOiB0cnVlXG4gICAgfSk7XG59O1xuXG5IdHRwVHJhbnNwb3J0LnByb3RvdHlwZS5fcmVxdWVzdCA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgcmV0dXJuIGh0dHAoZXh0ZW5kKG9wdGlvbnMsIHtcbiAgICAgICAgdXJsOiB0aGlzLl91cmwgKyBvcHRpb25zLnVybFxuICAgIH0pKTtcbn07XG5cbkh0dHBUcmFuc3BvcnQucHJvdG90eXBlLmNvbmZpZ3VyZSA9IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVxdWVzdCh7XG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLCB1cmw6ICcvY29uZmlndXJlJywgYm9keTogY29uZmlnXG4gICAgfSk7XG59O1xuXG5IdHRwVHJhbnNwb3J0LnByb3RvdHlwZS5lbnVtZXJhdGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlcXVlc3Qoe1xuICAgICAgICBtZXRob2Q6ICdHRVQnLCB1cmw6ICcvZW51bWVyYXRlJywganNvbjogdHJ1ZVxuICAgIH0pO1xufTtcblxuSHR0cFRyYW5zcG9ydC5wcm90b3R5cGUuYWNxdWlyZSA9IGZ1bmN0aW9uIChkZXZpY2UpIHtcbiAgICB2YXIgcGF0aCA9IGRldmljZS5wYXRoOyAvLyBUT0RPOiB0YWtlIGp1c3QgcGF0aFxuICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KHtcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsIHVybDogJy9hY3F1aXJlLycgKyBwYXRoLCBqc29uOiB0cnVlXG4gICAgfSk7XG59O1xuXG5IdHRwVHJhbnNwb3J0LnByb3RvdHlwZS5yZWxlYXNlID0gZnVuY3Rpb24gKHNlc3Npb25JZCkge1xuICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KHtcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsIHVybDogJy9yZWxlYXNlLycgKyBzZXNzaW9uSWQsIGpzb246IHRydWVcbiAgICB9KTtcbn07XG5cbkh0dHBUcmFuc3BvcnQucHJvdG90eXBlLmNhbGwgPSBmdW5jdGlvbiAoc2Vzc2lvbklkLCB0eXBlLCBtZXNzYWdlKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlcXVlc3Qoe1xuICAgICAgICBtZXRob2Q6ICdQT1NUJywgdXJsOiAnL2NhbGwvJyArIHNlc3Npb25JZCwganNvbjoge1xuICAgICAgICAgICAgdHlwZTogdHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2U6IG1lc3NhZ2VcbiAgICAgICAgfVxuICAgIH0pO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBIdHRwVHJhbnNwb3J0O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgUHJvbWlzZSA9IHJlcXVpcmUoJ3Byb21pc2UnKTtcblxuLy9cbi8vIFBsdWdpbiB0cmFuc3BvcnQuXG4vL1xudmFyIFBsdWdpblRyYW5zcG9ydCA9IGZ1bmN0aW9uIChwbHVnaW4pIHtcbiAgICB0aGlzLl9wbHVnaW4gPSBwbHVnaW47XG59O1xuXG4vLyBDb25maWd1cmVzIHRoZSBwbHVnaW4uXG5QbHVnaW5UcmFuc3BvcnQucHJvdG90eXBlLmNvbmZpZ3VyZSA9IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICB2YXIgcGx1Z2luID0gdGhpcy5fcGx1Z2luO1xuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHBsdWdpbi5jb25maWd1cmUoY29uZmlnKTtcbiAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgLy8gSW4gbW9zdCBicm93c2VycywgZXhjZXB0aW9ucyBmcm9tIHBsdWdpbiBtZXRob2RzIGFyZSBub3QgcHJvcGVybHlcbiAgICAgICAgICAgIC8vIHByb3BhZ2F0ZWRcbiAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgJ1BsdWdpbiBjb25maWd1cmF0aW9uIGZvdW5kLCBidXQgY291bGQgbm90IGJlIHVzZWQuICcgK1xuICAgICAgICAgICAgICAgICAgICAnTWFrZSBzdXJlIGl0IGhhcyBwcm9wZXIgZm9ybWF0IGFuZCBhIHZhbGlkIHNpZ25hdHVyZS4nXG4gICAgICAgICAgICApKTtcbiAgICAgICAgfVxuICAgIH0pO1xufTtcblxuLy8gRW51bWVyYXRlcyBjb25uZWN0ZWQgZGV2aWNlcy5cbi8vIFJlcXVpcmVzIGNvbmZpZ3VyZWQgcGx1Z2luLlxuUGx1Z2luVHJhbnNwb3J0LnByb3RvdHlwZS5lbnVtZXJhdGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHBsdWdpbiA9IHRoaXMuX3BsdWdpbjtcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSkge1xuICAgICAgICByZXNvbHZlKHBsdWdpbi5kZXZpY2VzKCkpO1xuICAgIH0pO1xufTtcblxuLy8gT3BlbnMgYSBkZXZpY2UgYW5kIHJldHVybnMgYSBzZXNzaW9uIG9iamVjdC5cblBsdWdpblRyYW5zcG9ydC5wcm90b3R5cGUuYWNxdWlyZSA9IGZ1bmN0aW9uIChkZXZpY2UpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgICAgc2Vzc2lvbjogZGV2aWNlXG4gICAgfSk7XG59O1xuXG4vL1xuUGx1Z2luVHJhbnNwb3J0LnByb3RvdHlwZS5yZWxlYXNlID0gZnVuY3Rpb24gKGRldmljZSkge1xuICAgIHZhciBwbHVnaW4gPSB0aGlzLl9wbHVnaW47XG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICBwbHVnaW4uY2xvc2UoZGV2aWNlKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgIH0pO1xufTtcblxuLy9cblBsdWdpblRyYW5zcG9ydC5wcm90b3R5cGUuY2FsbCA9IGZ1bmN0aW9uIChkZXZpY2UsIHR5cGUsIG1lc3NhZ2UpIHtcbiAgICB2YXIgcGx1Z2luID0gdGhpcy5fcGx1Z2luLFxuICAgICAgICB0aW1lb3V0ID0gZmFsc2U7XG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICBwbHVnaW4uY2FsbChkZXZpY2UsIHRpbWVvdXQsIHR5cGUsIG1lc3NhZ2UsIHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uICh0LCBtKSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IHQsXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IG1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBlcnJvcjogZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoZXJyKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH0pO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBQbHVnaW5UcmFuc3BvcnQ7XG4iLCIvLyBCcm93c2VyIFJlcXVlc3Rcbi8vXG4vLyBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuLy8geW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuLy8gWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4vL1xuLy8gICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuLy9cbi8vIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbi8vIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbi8vIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuLy8gU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuLy8gbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG5cbnZhciBYSFIgPSBYTUxIdHRwUmVxdWVzdFxuaWYgKCFYSFIpIHRocm93IG5ldyBFcnJvcignbWlzc2luZyBYTUxIdHRwUmVxdWVzdCcpXG5yZXF1ZXN0LmxvZyA9IHtcbiAgJ3RyYWNlJzogbm9vcCwgJ2RlYnVnJzogbm9vcCwgJ2luZm8nOiBub29wLCAnd2Fybic6IG5vb3AsICdlcnJvcic6IG5vb3Bcbn1cblxudmFyIERFRkFVTFRfVElNRU9VVCA9IDMgKiA2MCAqIDEwMDAgLy8gMyBtaW51dGVzXG5cbi8vXG4vLyByZXF1ZXN0XG4vL1xuXG5mdW5jdGlvbiByZXF1ZXN0KG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gIC8vIFRoZSBlbnRyeS1wb2ludCB0byB0aGUgQVBJOiBwcmVwIHRoZSBvcHRpb25zIG9iamVjdCBhbmQgcGFzcyB0aGUgcmVhbCB3b3JrIHRvIHJ1bl94aHIuXG4gIGlmKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JhZCBjYWxsYmFjayBnaXZlbjogJyArIGNhbGxiYWNrKVxuXG4gIGlmKCFvcHRpb25zKVxuICAgIHRocm93IG5ldyBFcnJvcignTm8gb3B0aW9ucyBnaXZlbicpXG5cbiAgdmFyIG9wdGlvbnNfb25SZXNwb25zZSA9IG9wdGlvbnMub25SZXNwb25zZTsgLy8gU2F2ZSB0aGlzIGZvciBsYXRlci5cblxuICBpZih0eXBlb2Ygb3B0aW9ucyA9PT0gJ3N0cmluZycpXG4gICAgb3B0aW9ucyA9IHsndXJpJzpvcHRpb25zfTtcbiAgZWxzZVxuICAgIG9wdGlvbnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9wdGlvbnMpKTsgLy8gVXNlIGEgZHVwbGljYXRlIGZvciBtdXRhdGluZy5cblxuICBvcHRpb25zLm9uUmVzcG9uc2UgPSBvcHRpb25zX29uUmVzcG9uc2UgLy8gQW5kIHB1dCBpdCBiYWNrLlxuXG4gIGlmIChvcHRpb25zLnZlcmJvc2UpIHJlcXVlc3QubG9nID0gZ2V0TG9nZ2VyKCk7XG5cbiAgaWYob3B0aW9ucy51cmwpIHtcbiAgICBvcHRpb25zLnVyaSA9IG9wdGlvbnMudXJsO1xuICAgIGRlbGV0ZSBvcHRpb25zLnVybDtcbiAgfVxuXG4gIGlmKCFvcHRpb25zLnVyaSAmJiBvcHRpb25zLnVyaSAhPT0gXCJcIilcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJvcHRpb25zLnVyaSBpcyBhIHJlcXVpcmVkIGFyZ3VtZW50XCIpO1xuXG4gIGlmKHR5cGVvZiBvcHRpb25zLnVyaSAhPSBcInN0cmluZ1wiKVxuICAgIHRocm93IG5ldyBFcnJvcihcIm9wdGlvbnMudXJpIG11c3QgYmUgYSBzdHJpbmdcIik7XG5cbiAgdmFyIHVuc3VwcG9ydGVkX29wdGlvbnMgPSBbJ3Byb3h5JywgJ19yZWRpcmVjdHNGb2xsb3dlZCcsICdtYXhSZWRpcmVjdHMnLCAnZm9sbG93UmVkaXJlY3QnXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHVuc3VwcG9ydGVkX29wdGlvbnMubGVuZ3RoOyBpKyspXG4gICAgaWYob3B0aW9uc1sgdW5zdXBwb3J0ZWRfb3B0aW9uc1tpXSBdKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwib3B0aW9ucy5cIiArIHVuc3VwcG9ydGVkX29wdGlvbnNbaV0gKyBcIiBpcyBub3Qgc3VwcG9ydGVkXCIpXG5cbiAgb3B0aW9ucy5jYWxsYmFjayA9IGNhbGxiYWNrXG4gIG9wdGlvbnMubWV0aG9kID0gb3B0aW9ucy5tZXRob2QgfHwgJ0dFVCc7XG4gIG9wdGlvbnMuaGVhZGVycyA9IG9wdGlvbnMuaGVhZGVycyB8fCB7fTtcbiAgb3B0aW9ucy5ib2R5ICAgID0gb3B0aW9ucy5ib2R5IHx8IG51bGxcbiAgb3B0aW9ucy50aW1lb3V0ID0gb3B0aW9ucy50aW1lb3V0IHx8IHJlcXVlc3QuREVGQVVMVF9USU1FT1VUXG5cbiAgaWYob3B0aW9ucy5oZWFkZXJzLmhvc3QpXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiT3B0aW9ucy5oZWFkZXJzLmhvc3QgaXMgbm90IHN1cHBvcnRlZFwiKTtcblxuICBpZihvcHRpb25zLmpzb24pIHtcbiAgICBvcHRpb25zLmhlYWRlcnMuYWNjZXB0ID0gb3B0aW9ucy5oZWFkZXJzLmFjY2VwdCB8fCAnYXBwbGljYXRpb24vanNvbidcbiAgICBpZihvcHRpb25zLm1ldGhvZCAhPT0gJ0dFVCcpXG4gICAgICBvcHRpb25zLmhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddID0gJ2FwcGxpY2F0aW9uL2pzb24nXG5cbiAgICBpZih0eXBlb2Ygb3B0aW9ucy5qc29uICE9PSAnYm9vbGVhbicpXG4gICAgICBvcHRpb25zLmJvZHkgPSBKU09OLnN0cmluZ2lmeShvcHRpb25zLmpzb24pXG4gICAgZWxzZSBpZih0eXBlb2Ygb3B0aW9ucy5ib2R5ICE9PSAnc3RyaW5nJylcbiAgICAgIG9wdGlvbnMuYm9keSA9IEpTT04uc3RyaW5naWZ5KG9wdGlvbnMuYm9keSlcbiAgfVxuICBcbiAgLy9CRUdJTiBRUyBIYWNrXG4gIHZhciBzZXJpYWxpemUgPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIgc3RyID0gW107XG4gICAgZm9yKHZhciBwIGluIG9iailcbiAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkocCkpIHtcbiAgICAgICAgc3RyLnB1c2goZW5jb2RlVVJJQ29tcG9uZW50KHApICsgXCI9XCIgKyBlbmNvZGVVUklDb21wb25lbnQob2JqW3BdKSk7XG4gICAgICB9XG4gICAgcmV0dXJuIHN0ci5qb2luKFwiJlwiKTtcbiAgfVxuICBcbiAgaWYob3B0aW9ucy5xcyl7XG4gICAgdmFyIHFzID0gKHR5cGVvZiBvcHRpb25zLnFzID09ICdzdHJpbmcnKT8gb3B0aW9ucy5xcyA6IHNlcmlhbGl6ZShvcHRpb25zLnFzKTtcbiAgICBpZihvcHRpb25zLnVyaS5pbmRleE9mKCc/JykgIT09IC0xKXsgLy9ubyBnZXQgcGFyYW1zXG4gICAgICAgIG9wdGlvbnMudXJpID0gb3B0aW9ucy51cmkrJyYnK3FzO1xuICAgIH1lbHNleyAvL2V4aXN0aW5nIGdldCBwYXJhbXNcbiAgICAgICAgb3B0aW9ucy51cmkgPSBvcHRpb25zLnVyaSsnPycrcXM7XG4gICAgfVxuICB9XG4gIC8vRU5EIFFTIEhhY2tcbiAgXG4gIC8vQkVHSU4gRk9STSBIYWNrXG4gIHZhciBtdWx0aXBhcnQgPSBmdW5jdGlvbihvYmopIHtcbiAgICAvL3RvZG86IHN1cHBvcnQgZmlsZSB0eXBlICh1c2VmdWw/KVxuICAgIHZhciByZXN1bHQgPSB7fTtcbiAgICByZXN1bHQuYm91bmRyeSA9ICctLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tJytNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkqMTAwMDAwMDAwMCk7XG4gICAgdmFyIGxpbmVzID0gW107XG4gICAgZm9yKHZhciBwIGluIG9iail7XG4gICAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkocCkpIHtcbiAgICAgICAgICAgIGxpbmVzLnB1c2goXG4gICAgICAgICAgICAgICAgJy0tJytyZXN1bHQuYm91bmRyeStcIlxcblwiK1xuICAgICAgICAgICAgICAgICdDb250ZW50LURpc3Bvc2l0aW9uOiBmb3JtLWRhdGE7IG5hbWU9XCInK3ArJ1wiJytcIlxcblwiK1xuICAgICAgICAgICAgICAgIFwiXFxuXCIrXG4gICAgICAgICAgICAgICAgb2JqW3BdK1wiXFxuXCJcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgbGluZXMucHVzaCggJy0tJytyZXN1bHQuYm91bmRyeSsnLS0nICk7XG4gICAgcmVzdWx0LmJvZHkgPSBsaW5lcy5qb2luKCcnKTtcbiAgICByZXN1bHQubGVuZ3RoID0gcmVzdWx0LmJvZHkubGVuZ3RoO1xuICAgIHJlc3VsdC50eXBlID0gJ211bHRpcGFydC9mb3JtLWRhdGE7IGJvdW5kYXJ5PScrcmVzdWx0LmJvdW5kcnk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuICBcbiAgaWYob3B0aW9ucy5mb3JtKXtcbiAgICBpZih0eXBlb2Ygb3B0aW9ucy5mb3JtID09ICdzdHJpbmcnKSB0aHJvdygnZm9ybSBuYW1lIHVuc3VwcG9ydGVkJyk7XG4gICAgaWYob3B0aW9ucy5tZXRob2QgPT09ICdQT1NUJyl7XG4gICAgICAgIHZhciBlbmNvZGluZyA9IChvcHRpb25zLmVuY29kaW5nIHx8ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBvcHRpb25zLmhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddID0gZW5jb2Rpbmc7XG4gICAgICAgIHN3aXRjaChlbmNvZGluZyl7XG4gICAgICAgICAgICBjYXNlICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnOlxuICAgICAgICAgICAgICAgIG9wdGlvbnMuYm9keSA9IHNlcmlhbGl6ZShvcHRpb25zLmZvcm0pLnJlcGxhY2UoLyUyMC9nLCBcIitcIik7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdtdWx0aXBhcnQvZm9ybS1kYXRhJzpcbiAgICAgICAgICAgICAgICB2YXIgbXVsdGkgPSBtdWx0aXBhcnQob3B0aW9ucy5mb3JtKTtcbiAgICAgICAgICAgICAgICAvL29wdGlvbnMuaGVhZGVyc1snY29udGVudC1sZW5ndGgnXSA9IG11bHRpLmxlbmd0aDtcbiAgICAgICAgICAgICAgICBvcHRpb25zLmJvZHkgPSBtdWx0aS5ib2R5O1xuICAgICAgICAgICAgICAgIG9wdGlvbnMuaGVhZGVyc1snY29udGVudC10eXBlJ10gPSBtdWx0aS50eXBlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgZGVmYXVsdCA6IHRocm93IG5ldyBFcnJvcigndW5zdXBwb3J0ZWQgZW5jb2Rpbmc6JytlbmNvZGluZyk7XG4gICAgICAgIH1cbiAgICB9XG4gIH1cbiAgLy9FTkQgRk9STSBIYWNrXG5cbiAgLy8gSWYgb25SZXNwb25zZSBpcyBib29sZWFuIHRydWUsIGNhbGwgYmFjayBpbW1lZGlhdGVseSB3aGVuIHRoZSByZXNwb25zZSBpcyBrbm93bixcbiAgLy8gbm90IHdoZW4gdGhlIGZ1bGwgcmVxdWVzdCBpcyBjb21wbGV0ZS5cbiAgb3B0aW9ucy5vblJlc3BvbnNlID0gb3B0aW9ucy5vblJlc3BvbnNlIHx8IG5vb3BcbiAgaWYob3B0aW9ucy5vblJlc3BvbnNlID09PSB0cnVlKSB7XG4gICAgb3B0aW9ucy5vblJlc3BvbnNlID0gY2FsbGJhY2tcbiAgICBvcHRpb25zLmNhbGxiYWNrID0gbm9vcFxuICB9XG5cbiAgLy8gWFhYIEJyb3dzZXJzIGRvIG5vdCBsaWtlIHRoaXMuXG4gIC8vaWYob3B0aW9ucy5ib2R5KVxuICAvLyAgb3B0aW9ucy5oZWFkZXJzWydjb250ZW50LWxlbmd0aCddID0gb3B0aW9ucy5ib2R5Lmxlbmd0aDtcblxuICAvLyBIVFRQIGJhc2ljIGF1dGhlbnRpY2F0aW9uXG4gIGlmKCFvcHRpb25zLmhlYWRlcnMuYXV0aG9yaXphdGlvbiAmJiBvcHRpb25zLmF1dGgpXG4gICAgb3B0aW9ucy5oZWFkZXJzLmF1dGhvcml6YXRpb24gPSAnQmFzaWMgJyArIGI2NF9lbmMob3B0aW9ucy5hdXRoLnVzZXJuYW1lICsgJzonICsgb3B0aW9ucy5hdXRoLnBhc3N3b3JkKTtcblxuICByZXR1cm4gcnVuX3hocihvcHRpb25zKVxufVxuXG52YXIgcmVxX3NlcSA9IDBcbmZ1bmN0aW9uIHJ1bl94aHIob3B0aW9ucykge1xuICB2YXIgeGhyID0gbmV3IFhIUlxuICAgICwgdGltZWRfb3V0ID0gZmFsc2VcbiAgICAsIGlzX2NvcnMgPSBpc19jcm9zc0RvbWFpbihvcHRpb25zLnVyaSlcbiAgICAsIHN1cHBvcnRzX2NvcnMgPSAoJ3dpdGhDcmVkZW50aWFscycgaW4geGhyKVxuXG4gIHJlcV9zZXEgKz0gMVxuICB4aHIuc2VxX2lkID0gcmVxX3NlcVxuICB4aHIuaWQgPSByZXFfc2VxICsgJzogJyArIG9wdGlvbnMubWV0aG9kICsgJyAnICsgb3B0aW9ucy51cmlcbiAgeGhyLl9pZCA9IHhoci5pZCAvLyBJIGtub3cgSSB3aWxsIHR5cGUgXCJfaWRcIiBmcm9tIGhhYml0IGFsbCB0aGUgdGltZS5cblxuICBpZihpc19jb3JzICYmICFzdXBwb3J0c19jb3JzKSB7XG4gICAgdmFyIGNvcnNfZXJyID0gbmV3IEVycm9yKCdCcm93c2VyIGRvZXMgbm90IHN1cHBvcnQgY3Jvc3Mtb3JpZ2luIHJlcXVlc3Q6ICcgKyBvcHRpb25zLnVyaSlcbiAgICBjb3JzX2Vyci5jb3JzID0gJ3Vuc3VwcG9ydGVkJ1xuICAgIHJldHVybiBvcHRpb25zLmNhbGxiYWNrKGNvcnNfZXJyLCB4aHIpXG4gIH1cblxuICB4aHIudGltZW91dFRpbWVyID0gc2V0VGltZW91dCh0b29fbGF0ZSwgb3B0aW9ucy50aW1lb3V0KVxuICBmdW5jdGlvbiB0b29fbGF0ZSgpIHtcbiAgICB0aW1lZF9vdXQgPSB0cnVlXG4gICAgdmFyIGVyID0gbmV3IEVycm9yKCdFVElNRURPVVQnKVxuICAgIGVyLmNvZGUgPSAnRVRJTUVET1VUJ1xuICAgIGVyLmR1cmF0aW9uID0gb3B0aW9ucy50aW1lb3V0XG5cbiAgICByZXF1ZXN0LmxvZy5lcnJvcignVGltZW91dCcsIHsgJ2lkJzp4aHIuX2lkLCAnbWlsbGlzZWNvbmRzJzpvcHRpb25zLnRpbWVvdXQgfSlcbiAgICByZXR1cm4gb3B0aW9ucy5jYWxsYmFjayhlciwgeGhyKVxuICB9XG5cbiAgLy8gU29tZSBzdGF0ZXMgY2FuIGJlIHNraXBwZWQgb3Zlciwgc28gcmVtZW1iZXIgd2hhdCBpcyBzdGlsbCBpbmNvbXBsZXRlLlxuICB2YXIgZGlkID0geydyZXNwb25zZSc6ZmFsc2UsICdsb2FkaW5nJzpmYWxzZSwgJ2VuZCc6ZmFsc2V9XG5cbiAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IG9uX3N0YXRlX2NoYW5nZVxuICB4aHIub3BlbihvcHRpb25zLm1ldGhvZCwgb3B0aW9ucy51cmksIHRydWUpIC8vIGFzeW5jaHJvbm91c1xuICBpZihpc19jb3JzKVxuICAgIHhoci53aXRoQ3JlZGVudGlhbHMgPSAhISBvcHRpb25zLndpdGhDcmVkZW50aWFsc1xuICB4aHIuc2VuZChvcHRpb25zLmJvZHkpXG4gIHJldHVybiB4aHJcblxuICBmdW5jdGlvbiBvbl9zdGF0ZV9jaGFuZ2UoZXZlbnQpIHtcbiAgICBpZih0aW1lZF9vdXQpXG4gICAgICByZXR1cm4gcmVxdWVzdC5sb2cuZGVidWcoJ0lnbm9yaW5nIHRpbWVkIG91dCBzdGF0ZSBjaGFuZ2UnLCB7J3N0YXRlJzp4aHIucmVhZHlTdGF0ZSwgJ2lkJzp4aHIuaWR9KVxuXG4gICAgcmVxdWVzdC5sb2cuZGVidWcoJ1N0YXRlIGNoYW5nZScsIHsnc3RhdGUnOnhoci5yZWFkeVN0YXRlLCAnaWQnOnhoci5pZCwgJ3RpbWVkX291dCc6dGltZWRfb3V0fSlcblxuICAgIGlmKHhoci5yZWFkeVN0YXRlID09PSBYSFIuT1BFTkVEKSB7XG4gICAgICByZXF1ZXN0LmxvZy5kZWJ1ZygnUmVxdWVzdCBzdGFydGVkJywgeydpZCc6eGhyLmlkfSlcbiAgICAgIGZvciAodmFyIGtleSBpbiBvcHRpb25zLmhlYWRlcnMpXG4gICAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKGtleSwgb3B0aW9ucy5oZWFkZXJzW2tleV0pXG4gICAgfVxuXG4gICAgZWxzZSBpZih4aHIucmVhZHlTdGF0ZSA9PT0gWEhSLkhFQURFUlNfUkVDRUlWRUQpXG4gICAgICBvbl9yZXNwb25zZSgpXG5cbiAgICBlbHNlIGlmKHhoci5yZWFkeVN0YXRlID09PSBYSFIuTE9BRElORykge1xuICAgICAgb25fcmVzcG9uc2UoKVxuICAgICAgb25fbG9hZGluZygpXG4gICAgfVxuXG4gICAgZWxzZSBpZih4aHIucmVhZHlTdGF0ZSA9PT0gWEhSLkRPTkUpIHtcbiAgICAgIG9uX3Jlc3BvbnNlKClcbiAgICAgIG9uX2xvYWRpbmcoKVxuICAgICAgb25fZW5kKClcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBvbl9yZXNwb25zZSgpIHtcbiAgICBpZihkaWQucmVzcG9uc2UpXG4gICAgICByZXR1cm5cblxuICAgIGRpZC5yZXNwb25zZSA9IHRydWVcbiAgICByZXF1ZXN0LmxvZy5kZWJ1ZygnR290IHJlc3BvbnNlJywgeydpZCc6eGhyLmlkLCAnc3RhdHVzJzp4aHIuc3RhdHVzfSlcbiAgICBjbGVhclRpbWVvdXQoeGhyLnRpbWVvdXRUaW1lcilcbiAgICB4aHIuc3RhdHVzQ29kZSA9IHhoci5zdGF0dXMgLy8gTm9kZSByZXF1ZXN0IGNvbXBhdGliaWxpdHlcblxuICAgIC8vIERldGVjdCBmYWlsZWQgQ09SUyByZXF1ZXN0cy5cbiAgICBpZihpc19jb3JzICYmIHhoci5zdGF0dXNDb2RlID09IDApIHtcbiAgICAgIHZhciBjb3JzX2VyciA9IG5ldyBFcnJvcignQ09SUyByZXF1ZXN0IHJlamVjdGVkOiAnICsgb3B0aW9ucy51cmkpXG4gICAgICBjb3JzX2Vyci5jb3JzID0gJ3JlamVjdGVkJ1xuXG4gICAgICAvLyBEbyBub3QgcHJvY2VzcyB0aGlzIHJlcXVlc3QgZnVydGhlci5cbiAgICAgIGRpZC5sb2FkaW5nID0gdHJ1ZVxuICAgICAgZGlkLmVuZCA9IHRydWVcblxuICAgICAgcmV0dXJuIG9wdGlvbnMuY2FsbGJhY2soY29yc19lcnIsIHhocilcbiAgICB9XG5cbiAgICBvcHRpb25zLm9uUmVzcG9uc2UobnVsbCwgeGhyKVxuICB9XG5cbiAgZnVuY3Rpb24gb25fbG9hZGluZygpIHtcbiAgICBpZihkaWQubG9hZGluZylcbiAgICAgIHJldHVyblxuXG4gICAgZGlkLmxvYWRpbmcgPSB0cnVlXG4gICAgcmVxdWVzdC5sb2cuZGVidWcoJ1Jlc3BvbnNlIGJvZHkgbG9hZGluZycsIHsnaWQnOnhoci5pZH0pXG4gICAgLy8gVE9ETzogTWF5YmUgc2ltdWxhdGUgXCJkYXRhXCIgZXZlbnRzIGJ5IHdhdGNoaW5nIHhoci5yZXNwb25zZVRleHRcbiAgfVxuXG4gIGZ1bmN0aW9uIG9uX2VuZCgpIHtcbiAgICBpZihkaWQuZW5kKVxuICAgICAgcmV0dXJuXG5cbiAgICBkaWQuZW5kID0gdHJ1ZVxuICAgIHJlcXVlc3QubG9nLmRlYnVnKCdSZXF1ZXN0IGRvbmUnLCB7J2lkJzp4aHIuaWR9KVxuXG4gICAgeGhyLmJvZHkgPSB4aHIucmVzcG9uc2VUZXh0XG4gICAgaWYob3B0aW9ucy5qc29uKSB7XG4gICAgICB0cnkgICAgICAgIHsgeGhyLmJvZHkgPSBKU09OLnBhcnNlKHhoci5yZXNwb25zZVRleHQpIH1cbiAgICAgIGNhdGNoIChlcikgeyByZXR1cm4gb3B0aW9ucy5jYWxsYmFjayhlciwgeGhyKSAgICAgICAgfVxuICAgIH1cblxuICAgIG9wdGlvbnMuY2FsbGJhY2sobnVsbCwgeGhyLCB4aHIuYm9keSlcbiAgfVxuXG59IC8vIHJlcXVlc3RcblxucmVxdWVzdC53aXRoQ3JlZGVudGlhbHMgPSBmYWxzZTtcbnJlcXVlc3QuREVGQVVMVF9USU1FT1VUID0gREVGQVVMVF9USU1FT1VUO1xuXG4vL1xuLy8gZGVmYXVsdHNcbi8vXG5cbnJlcXVlc3QuZGVmYXVsdHMgPSBmdW5jdGlvbihvcHRpb25zLCByZXF1ZXN0ZXIpIHtcbiAgdmFyIGRlZiA9IGZ1bmN0aW9uIChtZXRob2QpIHtcbiAgICB2YXIgZCA9IGZ1bmN0aW9uIChwYXJhbXMsIGNhbGxiYWNrKSB7XG4gICAgICBpZih0eXBlb2YgcGFyYW1zID09PSAnc3RyaW5nJylcbiAgICAgICAgcGFyYW1zID0geyd1cmknOiBwYXJhbXN9O1xuICAgICAgZWxzZSB7XG4gICAgICAgIHBhcmFtcyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkocGFyYW1zKSk7XG4gICAgICB9XG4gICAgICBmb3IgKHZhciBpIGluIG9wdGlvbnMpIHtcbiAgICAgICAgaWYgKHBhcmFtc1tpXSA9PT0gdW5kZWZpbmVkKSBwYXJhbXNbaV0gPSBvcHRpb25zW2ldXG4gICAgICB9XG4gICAgICByZXR1cm4gbWV0aG9kKHBhcmFtcywgY2FsbGJhY2spXG4gICAgfVxuICAgIHJldHVybiBkXG4gIH1cbiAgdmFyIGRlID0gZGVmKHJlcXVlc3QpXG4gIGRlLmdldCA9IGRlZihyZXF1ZXN0LmdldClcbiAgZGUucG9zdCA9IGRlZihyZXF1ZXN0LnBvc3QpXG4gIGRlLnB1dCA9IGRlZihyZXF1ZXN0LnB1dClcbiAgZGUuaGVhZCA9IGRlZihyZXF1ZXN0LmhlYWQpXG4gIHJldHVybiBkZVxufVxuXG4vL1xuLy8gSFRUUCBtZXRob2Qgc2hvcnRjdXRzXG4vL1xuXG52YXIgc2hvcnRjdXRzID0gWyAnZ2V0JywgJ3B1dCcsICdwb3N0JywgJ2hlYWQnIF07XG5zaG9ydGN1dHMuZm9yRWFjaChmdW5jdGlvbihzaG9ydGN1dCkge1xuICB2YXIgbWV0aG9kID0gc2hvcnRjdXQudG9VcHBlckNhc2UoKTtcbiAgdmFyIGZ1bmMgICA9IHNob3J0Y3V0LnRvTG93ZXJDYXNlKCk7XG5cbiAgcmVxdWVzdFtmdW5jXSA9IGZ1bmN0aW9uKG9wdHMpIHtcbiAgICBpZih0eXBlb2Ygb3B0cyA9PT0gJ3N0cmluZycpXG4gICAgICBvcHRzID0geydtZXRob2QnOm1ldGhvZCwgJ3VyaSc6b3B0c307XG4gICAgZWxzZSB7XG4gICAgICBvcHRzID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShvcHRzKSk7XG4gICAgICBvcHRzLm1ldGhvZCA9IG1ldGhvZDtcbiAgICB9XG5cbiAgICB2YXIgYXJncyA9IFtvcHRzXS5jb25jYXQoQXJyYXkucHJvdG90eXBlLnNsaWNlLmFwcGx5KGFyZ3VtZW50cywgWzFdKSk7XG4gICAgcmV0dXJuIHJlcXVlc3QuYXBwbHkodGhpcywgYXJncyk7XG4gIH1cbn0pXG5cbi8vXG4vLyBDb3VjaERCIHNob3J0Y3V0XG4vL1xuXG5yZXF1ZXN0LmNvdWNoID0gZnVuY3Rpb24ob3B0aW9ucywgY2FsbGJhY2spIHtcbiAgaWYodHlwZW9mIG9wdGlvbnMgPT09ICdzdHJpbmcnKVxuICAgIG9wdGlvbnMgPSB7J3VyaSc6b3B0aW9uc31cblxuICAvLyBKdXN0IHVzZSB0aGUgcmVxdWVzdCBBUEkgdG8gZG8gSlNPTi5cbiAgb3B0aW9ucy5qc29uID0gdHJ1ZVxuICBpZihvcHRpb25zLmJvZHkpXG4gICAgb3B0aW9ucy5qc29uID0gb3B0aW9ucy5ib2R5XG4gIGRlbGV0ZSBvcHRpb25zLmJvZHlcblxuICBjYWxsYmFjayA9IGNhbGxiYWNrIHx8IG5vb3BcblxuICB2YXIgeGhyID0gcmVxdWVzdChvcHRpb25zLCBjb3VjaF9oYW5kbGVyKVxuICByZXR1cm4geGhyXG5cbiAgZnVuY3Rpb24gY291Y2hfaGFuZGxlcihlciwgcmVzcCwgYm9keSkge1xuICAgIGlmKGVyKVxuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVyLCByZXNwLCBib2R5KVxuXG4gICAgaWYoKHJlc3Auc3RhdHVzQ29kZSA8IDIwMCB8fCByZXNwLnN0YXR1c0NvZGUgPiAyOTkpICYmIGJvZHkuZXJyb3IpIHtcbiAgICAgIC8vIFRoZSBib2R5IGlzIGEgQ291Y2ggSlNPTiBvYmplY3QgaW5kaWNhdGluZyB0aGUgZXJyb3IuXG4gICAgICBlciA9IG5ldyBFcnJvcignQ291Y2hEQiBlcnJvcjogJyArIChib2R5LmVycm9yLnJlYXNvbiB8fCBib2R5LmVycm9yLmVycm9yKSlcbiAgICAgIGZvciAodmFyIGtleSBpbiBib2R5KVxuICAgICAgICBlcltrZXldID0gYm9keVtrZXldXG4gICAgICByZXR1cm4gY2FsbGJhY2soZXIsIHJlc3AsIGJvZHkpO1xuICAgIH1cblxuICAgIHJldHVybiBjYWxsYmFjayhlciwgcmVzcCwgYm9keSk7XG4gIH1cbn1cblxuLy9cbi8vIFV0aWxpdHlcbi8vXG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5mdW5jdGlvbiBnZXRMb2dnZXIoKSB7XG4gIHZhciBsb2dnZXIgPSB7fVxuICAgICwgbGV2ZWxzID0gWyd0cmFjZScsICdkZWJ1ZycsICdpbmZvJywgJ3dhcm4nLCAnZXJyb3InXVxuICAgICwgbGV2ZWwsIGlcblxuICBmb3IoaSA9IDA7IGkgPCBsZXZlbHMubGVuZ3RoOyBpKyspIHtcbiAgICBsZXZlbCA9IGxldmVsc1tpXVxuXG4gICAgbG9nZ2VyW2xldmVsXSA9IG5vb3BcbiAgICBpZih0eXBlb2YgY29uc29sZSAhPT0gJ3VuZGVmaW5lZCcgJiYgY29uc29sZSAmJiBjb25zb2xlW2xldmVsXSlcbiAgICAgIGxvZ2dlcltsZXZlbF0gPSBmb3JtYXR0ZWQoY29uc29sZSwgbGV2ZWwpXG4gIH1cblxuICByZXR1cm4gbG9nZ2VyXG59XG5cbmZ1bmN0aW9uIGZvcm1hdHRlZChvYmosIG1ldGhvZCkge1xuICByZXR1cm4gZm9ybWF0dGVkX2xvZ2dlclxuXG4gIGZ1bmN0aW9uIGZvcm1hdHRlZF9sb2dnZXIoc3RyLCBjb250ZXh0KSB7XG4gICAgaWYodHlwZW9mIGNvbnRleHQgPT09ICdvYmplY3QnKVxuICAgICAgc3RyICs9ICcgJyArIEpTT04uc3RyaW5naWZ5KGNvbnRleHQpXG5cbiAgICByZXR1cm4gb2JqW21ldGhvZF0uY2FsbChvYmosIHN0cilcbiAgfVxufVxuXG4vLyBSZXR1cm4gd2hldGhlciBhIFVSTCBpcyBhIGNyb3NzLWRvbWFpbiByZXF1ZXN0LlxuZnVuY3Rpb24gaXNfY3Jvc3NEb21haW4odXJsKSB7XG4gIHZhciBydXJsID0gL14oW1xcd1xcK1xcLlxcLV0rOikoPzpcXC9cXC8oW15cXC8/IzpdKikoPzo6KFxcZCspKT8pPy9cblxuICAvLyBqUXVlcnkgIzgxMzgsIElFIG1heSB0aHJvdyBhbiBleGNlcHRpb24gd2hlbiBhY2Nlc3NpbmdcbiAgLy8gYSBmaWVsZCBmcm9tIHdpbmRvdy5sb2NhdGlvbiBpZiBkb2N1bWVudC5kb21haW4gaGFzIGJlZW4gc2V0XG4gIHZhciBhamF4TG9jYXRpb25cbiAgdHJ5IHsgYWpheExvY2F0aW9uID0gbG9jYXRpb24uaHJlZiB9XG4gIGNhdGNoIChlKSB7XG4gICAgLy8gVXNlIHRoZSBocmVmIGF0dHJpYnV0ZSBvZiBhbiBBIGVsZW1lbnQgc2luY2UgSUUgd2lsbCBtb2RpZnkgaXQgZ2l2ZW4gZG9jdW1lbnQubG9jYXRpb25cbiAgICBhamF4TG9jYXRpb24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCBcImFcIiApO1xuICAgIGFqYXhMb2NhdGlvbi5ocmVmID0gXCJcIjtcbiAgICBhamF4TG9jYXRpb24gPSBhamF4TG9jYXRpb24uaHJlZjtcbiAgfVxuXG4gIHZhciBhamF4TG9jUGFydHMgPSBydXJsLmV4ZWMoYWpheExvY2F0aW9uLnRvTG93ZXJDYXNlKCkpIHx8IFtdXG4gICAgLCBwYXJ0cyA9IHJ1cmwuZXhlYyh1cmwudG9Mb3dlckNhc2UoKSApXG5cbiAgdmFyIHJlc3VsdCA9ICEhKFxuICAgIHBhcnRzICYmXG4gICAgKCAgcGFydHNbMV0gIT0gYWpheExvY1BhcnRzWzFdXG4gICAgfHwgcGFydHNbMl0gIT0gYWpheExvY1BhcnRzWzJdXG4gICAgfHwgKHBhcnRzWzNdIHx8IChwYXJ0c1sxXSA9PT0gXCJodHRwOlwiID8gODAgOiA0NDMpKSAhPSAoYWpheExvY1BhcnRzWzNdIHx8IChhamF4TG9jUGFydHNbMV0gPT09IFwiaHR0cDpcIiA/IDgwIDogNDQzKSlcbiAgICApXG4gIClcblxuICAvL2NvbnNvbGUuZGVidWcoJ2lzX2Nyb3NzRG9tYWluKCcrdXJsKycpIC0+ICcgKyByZXN1bHQpXG4gIHJldHVybiByZXN1bHRcbn1cblxuLy8gTUlUIExpY2Vuc2UgZnJvbSBodHRwOi8vcGhwanMub3JnL2Z1bmN0aW9ucy9iYXNlNjRfZW5jb2RlOjM1OFxuZnVuY3Rpb24gYjY0X2VuYyAoZGF0YSkge1xuICAgIC8vIEVuY29kZXMgc3RyaW5nIHVzaW5nIE1JTUUgYmFzZTY0IGFsZ29yaXRobVxuICAgIHZhciBiNjQgPSBcIkFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky89XCI7XG4gICAgdmFyIG8xLCBvMiwgbzMsIGgxLCBoMiwgaDMsIGg0LCBiaXRzLCBpID0gMCwgYWMgPSAwLCBlbmM9XCJcIiwgdG1wX2FyciA9IFtdO1xuXG4gICAgaWYgKCFkYXRhKSB7XG4gICAgICAgIHJldHVybiBkYXRhO1xuICAgIH1cblxuICAgIC8vIGFzc3VtZSB1dGY4IGRhdGFcbiAgICAvLyBkYXRhID0gdGhpcy51dGY4X2VuY29kZShkYXRhKycnKTtcblxuICAgIGRvIHsgLy8gcGFjayB0aHJlZSBvY3RldHMgaW50byBmb3VyIGhleGV0c1xuICAgICAgICBvMSA9IGRhdGEuY2hhckNvZGVBdChpKyspO1xuICAgICAgICBvMiA9IGRhdGEuY2hhckNvZGVBdChpKyspO1xuICAgICAgICBvMyA9IGRhdGEuY2hhckNvZGVBdChpKyspO1xuXG4gICAgICAgIGJpdHMgPSBvMTw8MTYgfCBvMjw8OCB8IG8zO1xuXG4gICAgICAgIGgxID0gYml0cz4+MTggJiAweDNmO1xuICAgICAgICBoMiA9IGJpdHM+PjEyICYgMHgzZjtcbiAgICAgICAgaDMgPSBiaXRzPj42ICYgMHgzZjtcbiAgICAgICAgaDQgPSBiaXRzICYgMHgzZjtcblxuICAgICAgICAvLyB1c2UgaGV4ZXRzIHRvIGluZGV4IGludG8gYjY0LCBhbmQgYXBwZW5kIHJlc3VsdCB0byBlbmNvZGVkIHN0cmluZ1xuICAgICAgICB0bXBfYXJyW2FjKytdID0gYjY0LmNoYXJBdChoMSkgKyBiNjQuY2hhckF0KGgyKSArIGI2NC5jaGFyQXQoaDMpICsgYjY0LmNoYXJBdChoNCk7XG4gICAgfSB3aGlsZSAoaSA8IGRhdGEubGVuZ3RoKTtcblxuICAgIGVuYyA9IHRtcF9hcnIuam9pbignJyk7XG5cbiAgICBzd2l0Y2ggKGRhdGEubGVuZ3RoICUgMykge1xuICAgICAgICBjYXNlIDE6XG4gICAgICAgICAgICBlbmMgPSBlbmMuc2xpY2UoMCwgLTIpICsgJz09JztcbiAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMjpcbiAgICAgICAgICAgIGVuYyA9IGVuYy5zbGljZSgwLCAtMSkgKyAnPSc7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIHJldHVybiBlbmM7XG59XG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVlc3Q7XG4iLCIvLyBodHRwOi8vd2lraS5jb21tb25qcy5vcmcvd2lraS9Vbml0X1Rlc3RpbmcvMS4wXG4vL1xuLy8gVEhJUyBJUyBOT1QgVEVTVEVEIE5PUiBMSUtFTFkgVE8gV09SSyBPVVRTSURFIFY4IVxuLy9cbi8vIE9yaWdpbmFsbHkgZnJvbSBuYXJ3aGFsLmpzIChodHRwOi8vbmFyd2hhbGpzLm9yZylcbi8vIENvcHlyaWdodCAoYykgMjAwOSBUaG9tYXMgUm9iaW5zb24gPDI4MG5vcnRoLmNvbT5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4vLyBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSAnU29mdHdhcmUnKSwgdG9cbi8vIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlXG4vLyByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Jcbi8vIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG4vLyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG4vLyBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgJ0FTIElTJywgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuLy8gSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4vLyBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbi8vIEFVVEhPUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOXG4vLyBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OXG4vLyBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuLy8gd2hlbiB1c2VkIGluIG5vZGUsIHRoaXMgd2lsbCBhY3R1YWxseSBsb2FkIHRoZSB1dGlsIG1vZHVsZSB3ZSBkZXBlbmQgb25cbi8vIHZlcnN1cyBsb2FkaW5nIHRoZSBidWlsdGluIHV0aWwgbW9kdWxlIGFzIGhhcHBlbnMgb3RoZXJ3aXNlXG4vLyB0aGlzIGlzIGEgYnVnIGluIG5vZGUgbW9kdWxlIGxvYWRpbmcgYXMgZmFyIGFzIEkgYW0gY29uY2VybmVkXG52YXIgdXRpbCA9IHJlcXVpcmUoJ3V0aWwvJyk7XG5cbnZhciBwU2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG52YXIgaGFzT3duID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eTtcblxuLy8gMS4gVGhlIGFzc2VydCBtb2R1bGUgcHJvdmlkZXMgZnVuY3Rpb25zIHRoYXQgdGhyb3dcbi8vIEFzc2VydGlvbkVycm9yJ3Mgd2hlbiBwYXJ0aWN1bGFyIGNvbmRpdGlvbnMgYXJlIG5vdCBtZXQuIFRoZVxuLy8gYXNzZXJ0IG1vZHVsZSBtdXN0IGNvbmZvcm0gdG8gdGhlIGZvbGxvd2luZyBpbnRlcmZhY2UuXG5cbnZhciBhc3NlcnQgPSBtb2R1bGUuZXhwb3J0cyA9IG9rO1xuXG4vLyAyLiBUaGUgQXNzZXJ0aW9uRXJyb3IgaXMgZGVmaW5lZCBpbiBhc3NlcnQuXG4vLyBuZXcgYXNzZXJ0LkFzc2VydGlvbkVycm9yKHsgbWVzc2FnZTogbWVzc2FnZSxcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3R1YWw6IGFjdHVhbCxcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHBlY3RlZDogZXhwZWN0ZWQgfSlcblxuYXNzZXJ0LkFzc2VydGlvbkVycm9yID0gZnVuY3Rpb24gQXNzZXJ0aW9uRXJyb3Iob3B0aW9ucykge1xuICB0aGlzLm5hbWUgPSAnQXNzZXJ0aW9uRXJyb3InO1xuICB0aGlzLmFjdHVhbCA9IG9wdGlvbnMuYWN0dWFsO1xuICB0aGlzLmV4cGVjdGVkID0gb3B0aW9ucy5leHBlY3RlZDtcbiAgdGhpcy5vcGVyYXRvciA9IG9wdGlvbnMub3BlcmF0b3I7XG4gIGlmIChvcHRpb25zLm1lc3NhZ2UpIHtcbiAgICB0aGlzLm1lc3NhZ2UgPSBvcHRpb25zLm1lc3NhZ2U7XG4gICAgdGhpcy5nZW5lcmF0ZWRNZXNzYWdlID0gZmFsc2U7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5tZXNzYWdlID0gZ2V0TWVzc2FnZSh0aGlzKTtcbiAgICB0aGlzLmdlbmVyYXRlZE1lc3NhZ2UgPSB0cnVlO1xuICB9XG4gIHZhciBzdGFja1N0YXJ0RnVuY3Rpb24gPSBvcHRpb25zLnN0YWNrU3RhcnRGdW5jdGlvbiB8fCBmYWlsO1xuXG4gIGlmIChFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSkge1xuICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHRoaXMsIHN0YWNrU3RhcnRGdW5jdGlvbik7XG4gIH1cbiAgZWxzZSB7XG4gICAgLy8gbm9uIHY4IGJyb3dzZXJzIHNvIHdlIGNhbiBoYXZlIGEgc3RhY2t0cmFjZVxuICAgIHZhciBlcnIgPSBuZXcgRXJyb3IoKTtcbiAgICBpZiAoZXJyLnN0YWNrKSB7XG4gICAgICB2YXIgb3V0ID0gZXJyLnN0YWNrO1xuXG4gICAgICAvLyB0cnkgdG8gc3RyaXAgdXNlbGVzcyBmcmFtZXNcbiAgICAgIHZhciBmbl9uYW1lID0gc3RhY2tTdGFydEZ1bmN0aW9uLm5hbWU7XG4gICAgICB2YXIgaWR4ID0gb3V0LmluZGV4T2YoJ1xcbicgKyBmbl9uYW1lKTtcbiAgICAgIGlmIChpZHggPj0gMCkge1xuICAgICAgICAvLyBvbmNlIHdlIGhhdmUgbG9jYXRlZCB0aGUgZnVuY3Rpb24gZnJhbWVcbiAgICAgICAgLy8gd2UgbmVlZCB0byBzdHJpcCBvdXQgZXZlcnl0aGluZyBiZWZvcmUgaXQgKGFuZCBpdHMgbGluZSlcbiAgICAgICAgdmFyIG5leHRfbGluZSA9IG91dC5pbmRleE9mKCdcXG4nLCBpZHggKyAxKTtcbiAgICAgICAgb3V0ID0gb3V0LnN1YnN0cmluZyhuZXh0X2xpbmUgKyAxKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5zdGFjayA9IG91dDtcbiAgICB9XG4gIH1cbn07XG5cbi8vIGFzc2VydC5Bc3NlcnRpb25FcnJvciBpbnN0YW5jZW9mIEVycm9yXG51dGlsLmluaGVyaXRzKGFzc2VydC5Bc3NlcnRpb25FcnJvciwgRXJyb3IpO1xuXG5mdW5jdGlvbiByZXBsYWNlcihrZXksIHZhbHVlKSB7XG4gIGlmICh1dGlsLmlzVW5kZWZpbmVkKHZhbHVlKSkge1xuICAgIHJldHVybiAnJyArIHZhbHVlO1xuICB9XG4gIGlmICh1dGlsLmlzTnVtYmVyKHZhbHVlKSAmJiAoaXNOYU4odmFsdWUpIHx8ICFpc0Zpbml0ZSh2YWx1ZSkpKSB7XG4gICAgcmV0dXJuIHZhbHVlLnRvU3RyaW5nKCk7XG4gIH1cbiAgaWYgKHV0aWwuaXNGdW5jdGlvbih2YWx1ZSkgfHwgdXRpbC5pc1JlZ0V4cCh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUudG9TdHJpbmcoKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHRydW5jYXRlKHMsIG4pIHtcbiAgaWYgKHV0aWwuaXNTdHJpbmcocykpIHtcbiAgICByZXR1cm4gcy5sZW5ndGggPCBuID8gcyA6IHMuc2xpY2UoMCwgbik7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHM7XG4gIH1cbn1cblxuZnVuY3Rpb24gZ2V0TWVzc2FnZShzZWxmKSB7XG4gIHJldHVybiB0cnVuY2F0ZShKU09OLnN0cmluZ2lmeShzZWxmLmFjdHVhbCwgcmVwbGFjZXIpLCAxMjgpICsgJyAnICtcbiAgICAgICAgIHNlbGYub3BlcmF0b3IgKyAnICcgK1xuICAgICAgICAgdHJ1bmNhdGUoSlNPTi5zdHJpbmdpZnkoc2VsZi5leHBlY3RlZCwgcmVwbGFjZXIpLCAxMjgpO1xufVxuXG4vLyBBdCBwcmVzZW50IG9ubHkgdGhlIHRocmVlIGtleXMgbWVudGlvbmVkIGFib3ZlIGFyZSB1c2VkIGFuZFxuLy8gdW5kZXJzdG9vZCBieSB0aGUgc3BlYy4gSW1wbGVtZW50YXRpb25zIG9yIHN1YiBtb2R1bGVzIGNhbiBwYXNzXG4vLyBvdGhlciBrZXlzIHRvIHRoZSBBc3NlcnRpb25FcnJvcidzIGNvbnN0cnVjdG9yIC0gdGhleSB3aWxsIGJlXG4vLyBpZ25vcmVkLlxuXG4vLyAzLiBBbGwgb2YgdGhlIGZvbGxvd2luZyBmdW5jdGlvbnMgbXVzdCB0aHJvdyBhbiBBc3NlcnRpb25FcnJvclxuLy8gd2hlbiBhIGNvcnJlc3BvbmRpbmcgY29uZGl0aW9uIGlzIG5vdCBtZXQsIHdpdGggYSBtZXNzYWdlIHRoYXRcbi8vIG1heSBiZSB1bmRlZmluZWQgaWYgbm90IHByb3ZpZGVkLiAgQWxsIGFzc2VydGlvbiBtZXRob2RzIHByb3ZpZGVcbi8vIGJvdGggdGhlIGFjdHVhbCBhbmQgZXhwZWN0ZWQgdmFsdWVzIHRvIHRoZSBhc3NlcnRpb24gZXJyb3IgZm9yXG4vLyBkaXNwbGF5IHB1cnBvc2VzLlxuXG5mdW5jdGlvbiBmYWlsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UsIG9wZXJhdG9yLCBzdGFja1N0YXJ0RnVuY3Rpb24pIHtcbiAgdGhyb3cgbmV3IGFzc2VydC5Bc3NlcnRpb25FcnJvcih7XG4gICAgbWVzc2FnZTogbWVzc2FnZSxcbiAgICBhY3R1YWw6IGFjdHVhbCxcbiAgICBleHBlY3RlZDogZXhwZWN0ZWQsXG4gICAgb3BlcmF0b3I6IG9wZXJhdG9yLFxuICAgIHN0YWNrU3RhcnRGdW5jdGlvbjogc3RhY2tTdGFydEZ1bmN0aW9uXG4gIH0pO1xufVxuXG4vLyBFWFRFTlNJT04hIGFsbG93cyBmb3Igd2VsbCBiZWhhdmVkIGVycm9ycyBkZWZpbmVkIGVsc2V3aGVyZS5cbmFzc2VydC5mYWlsID0gZmFpbDtcblxuLy8gNC4gUHVyZSBhc3NlcnRpb24gdGVzdHMgd2hldGhlciBhIHZhbHVlIGlzIHRydXRoeSwgYXMgZGV0ZXJtaW5lZFxuLy8gYnkgISFndWFyZC5cbi8vIGFzc2VydC5vayhndWFyZCwgbWVzc2FnZV9vcHQpO1xuLy8gVGhpcyBzdGF0ZW1lbnQgaXMgZXF1aXZhbGVudCB0byBhc3NlcnQuZXF1YWwodHJ1ZSwgISFndWFyZCxcbi8vIG1lc3NhZ2Vfb3B0KTsuIFRvIHRlc3Qgc3RyaWN0bHkgZm9yIHRoZSB2YWx1ZSB0cnVlLCB1c2Vcbi8vIGFzc2VydC5zdHJpY3RFcXVhbCh0cnVlLCBndWFyZCwgbWVzc2FnZV9vcHQpOy5cblxuZnVuY3Rpb24gb2sodmFsdWUsIG1lc3NhZ2UpIHtcbiAgaWYgKCF2YWx1ZSkgZmFpbCh2YWx1ZSwgdHJ1ZSwgbWVzc2FnZSwgJz09JywgYXNzZXJ0Lm9rKTtcbn1cbmFzc2VydC5vayA9IG9rO1xuXG4vLyA1LiBUaGUgZXF1YWxpdHkgYXNzZXJ0aW9uIHRlc3RzIHNoYWxsb3csIGNvZXJjaXZlIGVxdWFsaXR5IHdpdGhcbi8vID09LlxuLy8gYXNzZXJ0LmVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2Vfb3B0KTtcblxuYXNzZXJ0LmVxdWFsID0gZnVuY3Rpb24gZXF1YWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSkge1xuICBpZiAoYWN0dWFsICE9IGV4cGVjdGVkKSBmYWlsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UsICc9PScsIGFzc2VydC5lcXVhbCk7XG59O1xuXG4vLyA2LiBUaGUgbm9uLWVxdWFsaXR5IGFzc2VydGlvbiB0ZXN0cyBmb3Igd2hldGhlciB0d28gb2JqZWN0cyBhcmUgbm90IGVxdWFsXG4vLyB3aXRoICE9IGFzc2VydC5ub3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlX29wdCk7XG5cbmFzc2VydC5ub3RFcXVhbCA9IGZ1bmN0aW9uIG5vdEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UpIHtcbiAgaWYgKGFjdHVhbCA9PSBleHBlY3RlZCkge1xuICAgIGZhaWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSwgJyE9JywgYXNzZXJ0Lm5vdEVxdWFsKTtcbiAgfVxufTtcblxuLy8gNy4gVGhlIGVxdWl2YWxlbmNlIGFzc2VydGlvbiB0ZXN0cyBhIGRlZXAgZXF1YWxpdHkgcmVsYXRpb24uXG4vLyBhc3NlcnQuZGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2Vfb3B0KTtcblxuYXNzZXJ0LmRlZXBFcXVhbCA9IGZ1bmN0aW9uIGRlZXBFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlKSB7XG4gIGlmICghX2RlZXBFcXVhbChhY3R1YWwsIGV4cGVjdGVkKSkge1xuICAgIGZhaWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSwgJ2RlZXBFcXVhbCcsIGFzc2VydC5kZWVwRXF1YWwpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBfZGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQpIHtcbiAgLy8gNy4xLiBBbGwgaWRlbnRpY2FsIHZhbHVlcyBhcmUgZXF1aXZhbGVudCwgYXMgZGV0ZXJtaW5lZCBieSA9PT0uXG4gIGlmIChhY3R1YWwgPT09IGV4cGVjdGVkKSB7XG4gICAgcmV0dXJuIHRydWU7XG5cbiAgfSBlbHNlIGlmICh1dGlsLmlzQnVmZmVyKGFjdHVhbCkgJiYgdXRpbC5pc0J1ZmZlcihleHBlY3RlZCkpIHtcbiAgICBpZiAoYWN0dWFsLmxlbmd0aCAhPSBleHBlY3RlZC5sZW5ndGgpIHJldHVybiBmYWxzZTtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYWN0dWFsLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYWN0dWFsW2ldICE9PSBleHBlY3RlZFtpXSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xuXG4gIC8vIDcuMi4gSWYgdGhlIGV4cGVjdGVkIHZhbHVlIGlzIGEgRGF0ZSBvYmplY3QsIHRoZSBhY3R1YWwgdmFsdWUgaXNcbiAgLy8gZXF1aXZhbGVudCBpZiBpdCBpcyBhbHNvIGEgRGF0ZSBvYmplY3QgdGhhdCByZWZlcnMgdG8gdGhlIHNhbWUgdGltZS5cbiAgfSBlbHNlIGlmICh1dGlsLmlzRGF0ZShhY3R1YWwpICYmIHV0aWwuaXNEYXRlKGV4cGVjdGVkKSkge1xuICAgIHJldHVybiBhY3R1YWwuZ2V0VGltZSgpID09PSBleHBlY3RlZC5nZXRUaW1lKCk7XG5cbiAgLy8gNy4zIElmIHRoZSBleHBlY3RlZCB2YWx1ZSBpcyBhIFJlZ0V4cCBvYmplY3QsIHRoZSBhY3R1YWwgdmFsdWUgaXNcbiAgLy8gZXF1aXZhbGVudCBpZiBpdCBpcyBhbHNvIGEgUmVnRXhwIG9iamVjdCB3aXRoIHRoZSBzYW1lIHNvdXJjZSBhbmRcbiAgLy8gcHJvcGVydGllcyAoYGdsb2JhbGAsIGBtdWx0aWxpbmVgLCBgbGFzdEluZGV4YCwgYGlnbm9yZUNhc2VgKS5cbiAgfSBlbHNlIGlmICh1dGlsLmlzUmVnRXhwKGFjdHVhbCkgJiYgdXRpbC5pc1JlZ0V4cChleHBlY3RlZCkpIHtcbiAgICByZXR1cm4gYWN0dWFsLnNvdXJjZSA9PT0gZXhwZWN0ZWQuc291cmNlICYmXG4gICAgICAgICAgIGFjdHVhbC5nbG9iYWwgPT09IGV4cGVjdGVkLmdsb2JhbCAmJlxuICAgICAgICAgICBhY3R1YWwubXVsdGlsaW5lID09PSBleHBlY3RlZC5tdWx0aWxpbmUgJiZcbiAgICAgICAgICAgYWN0dWFsLmxhc3RJbmRleCA9PT0gZXhwZWN0ZWQubGFzdEluZGV4ICYmXG4gICAgICAgICAgIGFjdHVhbC5pZ25vcmVDYXNlID09PSBleHBlY3RlZC5pZ25vcmVDYXNlO1xuXG4gIC8vIDcuNC4gT3RoZXIgcGFpcnMgdGhhdCBkbyBub3QgYm90aCBwYXNzIHR5cGVvZiB2YWx1ZSA9PSAnb2JqZWN0JyxcbiAgLy8gZXF1aXZhbGVuY2UgaXMgZGV0ZXJtaW5lZCBieSA9PS5cbiAgfSBlbHNlIGlmICghdXRpbC5pc09iamVjdChhY3R1YWwpICYmICF1dGlsLmlzT2JqZWN0KGV4cGVjdGVkKSkge1xuICAgIHJldHVybiBhY3R1YWwgPT0gZXhwZWN0ZWQ7XG5cbiAgLy8gNy41IEZvciBhbGwgb3RoZXIgT2JqZWN0IHBhaXJzLCBpbmNsdWRpbmcgQXJyYXkgb2JqZWN0cywgZXF1aXZhbGVuY2UgaXNcbiAgLy8gZGV0ZXJtaW5lZCBieSBoYXZpbmcgdGhlIHNhbWUgbnVtYmVyIG9mIG93bmVkIHByb3BlcnRpZXMgKGFzIHZlcmlmaWVkXG4gIC8vIHdpdGggT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKSwgdGhlIHNhbWUgc2V0IG9mIGtleXNcbiAgLy8gKGFsdGhvdWdoIG5vdCBuZWNlc3NhcmlseSB0aGUgc2FtZSBvcmRlciksIGVxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeVxuICAvLyBjb3JyZXNwb25kaW5nIGtleSwgYW5kIGFuIGlkZW50aWNhbCAncHJvdG90eXBlJyBwcm9wZXJ0eS4gTm90ZTogdGhpc1xuICAvLyBhY2NvdW50cyBmb3IgYm90aCBuYW1lZCBhbmQgaW5kZXhlZCBwcm9wZXJ0aWVzIG9uIEFycmF5cy5cbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gb2JqRXF1aXYoYWN0dWFsLCBleHBlY3RlZCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNBcmd1bWVudHMob2JqZWN0KSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqZWN0KSA9PSAnW29iamVjdCBBcmd1bWVudHNdJztcbn1cblxuZnVuY3Rpb24gb2JqRXF1aXYoYSwgYikge1xuICBpZiAodXRpbC5pc051bGxPclVuZGVmaW5lZChhKSB8fCB1dGlsLmlzTnVsbE9yVW5kZWZpbmVkKGIpKVxuICAgIHJldHVybiBmYWxzZTtcbiAgLy8gYW4gaWRlbnRpY2FsICdwcm90b3R5cGUnIHByb3BlcnR5LlxuICBpZiAoYS5wcm90b3R5cGUgIT09IGIucHJvdG90eXBlKSByZXR1cm4gZmFsc2U7XG4gIC8vfn5+SSd2ZSBtYW5hZ2VkIHRvIGJyZWFrIE9iamVjdC5rZXlzIHRocm91Z2ggc2NyZXd5IGFyZ3VtZW50cyBwYXNzaW5nLlxuICAvLyAgIENvbnZlcnRpbmcgdG8gYXJyYXkgc29sdmVzIHRoZSBwcm9ibGVtLlxuICBpZiAoaXNBcmd1bWVudHMoYSkpIHtcbiAgICBpZiAoIWlzQXJndW1lbnRzKGIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGEgPSBwU2xpY2UuY2FsbChhKTtcbiAgICBiID0gcFNsaWNlLmNhbGwoYik7XG4gICAgcmV0dXJuIF9kZWVwRXF1YWwoYSwgYik7XG4gIH1cbiAgdHJ5IHtcbiAgICB2YXIga2EgPSBvYmplY3RLZXlzKGEpLFxuICAgICAgICBrYiA9IG9iamVjdEtleXMoYiksXG4gICAgICAgIGtleSwgaTtcbiAgfSBjYXRjaCAoZSkgey8vaGFwcGVucyB3aGVuIG9uZSBpcyBhIHN0cmluZyBsaXRlcmFsIGFuZCB0aGUgb3RoZXIgaXNuJ3RcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy8gaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChrZXlzIGluY29ycG9yYXRlc1xuICAvLyBoYXNPd25Qcm9wZXJ0eSlcbiAgaWYgKGthLmxlbmd0aCAhPSBrYi5sZW5ndGgpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvL3RoZSBzYW1lIHNldCBvZiBrZXlzIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLFxuICBrYS5zb3J0KCk7XG4gIGtiLnNvcnQoKTtcbiAgLy9+fn5jaGVhcCBrZXkgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmIChrYVtpXSAhPSBrYltpXSlcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvL2VxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeSBjb3JyZXNwb25kaW5nIGtleSwgYW5kXG4gIC8vfn5+cG9zc2libHkgZXhwZW5zaXZlIGRlZXAgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGtleSA9IGthW2ldO1xuICAgIGlmICghX2RlZXBFcXVhbChhW2tleV0sIGJba2V5XSkpIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gOC4gVGhlIG5vbi1lcXVpdmFsZW5jZSBhc3NlcnRpb24gdGVzdHMgZm9yIGFueSBkZWVwIGluZXF1YWxpdHkuXG4vLyBhc3NlcnQubm90RGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2Vfb3B0KTtcblxuYXNzZXJ0Lm5vdERlZXBFcXVhbCA9IGZ1bmN0aW9uIG5vdERlZXBFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlKSB7XG4gIGlmIChfZGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQpKSB7XG4gICAgZmFpbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlLCAnbm90RGVlcEVxdWFsJywgYXNzZXJ0Lm5vdERlZXBFcXVhbCk7XG4gIH1cbn07XG5cbi8vIDkuIFRoZSBzdHJpY3QgZXF1YWxpdHkgYXNzZXJ0aW9uIHRlc3RzIHN0cmljdCBlcXVhbGl0eSwgYXMgZGV0ZXJtaW5lZCBieSA9PT0uXG4vLyBhc3NlcnQuc3RyaWN0RXF1YWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZV9vcHQpO1xuXG5hc3NlcnQuc3RyaWN0RXF1YWwgPSBmdW5jdGlvbiBzdHJpY3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlKSB7XG4gIGlmIChhY3R1YWwgIT09IGV4cGVjdGVkKSB7XG4gICAgZmFpbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlLCAnPT09JywgYXNzZXJ0LnN0cmljdEVxdWFsKTtcbiAgfVxufTtcblxuLy8gMTAuIFRoZSBzdHJpY3Qgbm9uLWVxdWFsaXR5IGFzc2VydGlvbiB0ZXN0cyBmb3Igc3RyaWN0IGluZXF1YWxpdHksIGFzXG4vLyBkZXRlcm1pbmVkIGJ5ICE9PS4gIGFzc2VydC5ub3RTdHJpY3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlX29wdCk7XG5cbmFzc2VydC5ub3RTdHJpY3RFcXVhbCA9IGZ1bmN0aW9uIG5vdFN0cmljdEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UpIHtcbiAgaWYgKGFjdHVhbCA9PT0gZXhwZWN0ZWQpIHtcbiAgICBmYWlsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UsICchPT0nLCBhc3NlcnQubm90U3RyaWN0RXF1YWwpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBleHBlY3RlZEV4Y2VwdGlvbihhY3R1YWwsIGV4cGVjdGVkKSB7XG4gIGlmICghYWN0dWFsIHx8ICFleHBlY3RlZCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoZXhwZWN0ZWQpID09ICdbb2JqZWN0IFJlZ0V4cF0nKSB7XG4gICAgcmV0dXJuIGV4cGVjdGVkLnRlc3QoYWN0dWFsKTtcbiAgfSBlbHNlIGlmIChhY3R1YWwgaW5zdGFuY2VvZiBleHBlY3RlZCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9IGVsc2UgaWYgKGV4cGVjdGVkLmNhbGwoe30sIGFjdHVhbCkgPT09IHRydWUpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gX3Rocm93cyhzaG91bGRUaHJvdywgYmxvY2ssIGV4cGVjdGVkLCBtZXNzYWdlKSB7XG4gIHZhciBhY3R1YWw7XG5cbiAgaWYgKHV0aWwuaXNTdHJpbmcoZXhwZWN0ZWQpKSB7XG4gICAgbWVzc2FnZSA9IGV4cGVjdGVkO1xuICAgIGV4cGVjdGVkID0gbnVsbDtcbiAgfVxuXG4gIHRyeSB7XG4gICAgYmxvY2soKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFjdHVhbCA9IGU7XG4gIH1cblxuICBtZXNzYWdlID0gKGV4cGVjdGVkICYmIGV4cGVjdGVkLm5hbWUgPyAnICgnICsgZXhwZWN0ZWQubmFtZSArICcpLicgOiAnLicpICtcbiAgICAgICAgICAgIChtZXNzYWdlID8gJyAnICsgbWVzc2FnZSA6ICcuJyk7XG5cbiAgaWYgKHNob3VsZFRocm93ICYmICFhY3R1YWwpIHtcbiAgICBmYWlsKGFjdHVhbCwgZXhwZWN0ZWQsICdNaXNzaW5nIGV4cGVjdGVkIGV4Y2VwdGlvbicgKyBtZXNzYWdlKTtcbiAgfVxuXG4gIGlmICghc2hvdWxkVGhyb3cgJiYgZXhwZWN0ZWRFeGNlcHRpb24oYWN0dWFsLCBleHBlY3RlZCkpIHtcbiAgICBmYWlsKGFjdHVhbCwgZXhwZWN0ZWQsICdHb3QgdW53YW50ZWQgZXhjZXB0aW9uJyArIG1lc3NhZ2UpO1xuICB9XG5cbiAgaWYgKChzaG91bGRUaHJvdyAmJiBhY3R1YWwgJiYgZXhwZWN0ZWQgJiZcbiAgICAgICFleHBlY3RlZEV4Y2VwdGlvbihhY3R1YWwsIGV4cGVjdGVkKSkgfHwgKCFzaG91bGRUaHJvdyAmJiBhY3R1YWwpKSB7XG4gICAgdGhyb3cgYWN0dWFsO1xuICB9XG59XG5cbi8vIDExLiBFeHBlY3RlZCB0byB0aHJvdyBhbiBlcnJvcjpcbi8vIGFzc2VydC50aHJvd3MoYmxvY2ssIEVycm9yX29wdCwgbWVzc2FnZV9vcHQpO1xuXG5hc3NlcnQudGhyb3dzID0gZnVuY3Rpb24oYmxvY2ssIC8qb3B0aW9uYWwqL2Vycm9yLCAvKm9wdGlvbmFsKi9tZXNzYWdlKSB7XG4gIF90aHJvd3MuYXBwbHkodGhpcywgW3RydWVdLmNvbmNhdChwU2xpY2UuY2FsbChhcmd1bWVudHMpKSk7XG59O1xuXG4vLyBFWFRFTlNJT04hIFRoaXMgaXMgYW5ub3lpbmcgdG8gd3JpdGUgb3V0c2lkZSB0aGlzIG1vZHVsZS5cbmFzc2VydC5kb2VzTm90VGhyb3cgPSBmdW5jdGlvbihibG9jaywgLypvcHRpb25hbCovbWVzc2FnZSkge1xuICBfdGhyb3dzLmFwcGx5KHRoaXMsIFtmYWxzZV0uY29uY2F0KHBTbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbn07XG5cbmFzc2VydC5pZkVycm9yID0gZnVuY3Rpb24oZXJyKSB7IGlmIChlcnIpIHt0aHJvdyBlcnI7fX07XG5cbnZhciBvYmplY3RLZXlzID0gT2JqZWN0LmtleXMgfHwgZnVuY3Rpb24gKG9iaikge1xuICB2YXIga2V5cyA9IFtdO1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgaWYgKGhhc093bi5jYWxsKG9iaiwga2V5KSkga2V5cy5wdXNoKGtleSk7XG4gIH1cbiAgcmV0dXJuIGtleXM7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpc0J1ZmZlcihhcmcpIHtcbiAgcmV0dXJuIGFyZyAmJiB0eXBlb2YgYXJnID09PSAnb2JqZWN0J1xuICAgICYmIHR5cGVvZiBhcmcuY29weSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICYmIHR5cGVvZiBhcmcuZmlsbCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICYmIHR5cGVvZiBhcmcucmVhZFVJbnQ4ID09PSAnZnVuY3Rpb24nO1xufSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwpe1xuLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbnZhciBmb3JtYXRSZWdFeHAgPSAvJVtzZGolXS9nO1xuZXhwb3J0cy5mb3JtYXQgPSBmdW5jdGlvbihmKSB7XG4gIGlmICghaXNTdHJpbmcoZikpIHtcbiAgICB2YXIgb2JqZWN0cyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBvYmplY3RzLnB1c2goaW5zcGVjdChhcmd1bWVudHNbaV0pKTtcbiAgICB9XG4gICAgcmV0dXJuIG9iamVjdHMuam9pbignICcpO1xuICB9XG5cbiAgdmFyIGkgPSAxO1xuICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgdmFyIGxlbiA9IGFyZ3MubGVuZ3RoO1xuICB2YXIgc3RyID0gU3RyaW5nKGYpLnJlcGxhY2UoZm9ybWF0UmVnRXhwLCBmdW5jdGlvbih4KSB7XG4gICAgaWYgKHggPT09ICclJScpIHJldHVybiAnJSc7XG4gICAgaWYgKGkgPj0gbGVuKSByZXR1cm4geDtcbiAgICBzd2l0Y2ggKHgpIHtcbiAgICAgIGNhc2UgJyVzJzogcmV0dXJuIFN0cmluZyhhcmdzW2krK10pO1xuICAgICAgY2FzZSAnJWQnOiByZXR1cm4gTnVtYmVyKGFyZ3NbaSsrXSk7XG4gICAgICBjYXNlICclaic6XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGFyZ3NbaSsrXSk7XG4gICAgICAgIH0gY2F0Y2ggKF8pIHtcbiAgICAgICAgICByZXR1cm4gJ1tDaXJjdWxhcl0nO1xuICAgICAgICB9XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4geDtcbiAgICB9XG4gIH0pO1xuICBmb3IgKHZhciB4ID0gYXJnc1tpXTsgaSA8IGxlbjsgeCA9IGFyZ3NbKytpXSkge1xuICAgIGlmIChpc051bGwoeCkgfHwgIWlzT2JqZWN0KHgpKSB7XG4gICAgICBzdHIgKz0gJyAnICsgeDtcbiAgICB9IGVsc2Uge1xuICAgICAgc3RyICs9ICcgJyArIGluc3BlY3QoeCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBzdHI7XG59O1xuXG5cbi8vIE1hcmsgdGhhdCBhIG1ldGhvZCBzaG91bGQgbm90IGJlIHVzZWQuXG4vLyBSZXR1cm5zIGEgbW9kaWZpZWQgZnVuY3Rpb24gd2hpY2ggd2FybnMgb25jZSBieSBkZWZhdWx0LlxuLy8gSWYgLS1uby1kZXByZWNhdGlvbiBpcyBzZXQsIHRoZW4gaXQgaXMgYSBuby1vcC5cbmV4cG9ydHMuZGVwcmVjYXRlID0gZnVuY3Rpb24oZm4sIG1zZykge1xuICAvLyBBbGxvdyBmb3IgZGVwcmVjYXRpbmcgdGhpbmdzIGluIHRoZSBwcm9jZXNzIG9mIHN0YXJ0aW5nIHVwLlxuICBpZiAoaXNVbmRlZmluZWQoZ2xvYmFsLnByb2Nlc3MpKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIGV4cG9ydHMuZGVwcmVjYXRlKGZuLCBtc2cpLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfVxuXG4gIGlmIChwcm9jZXNzLm5vRGVwcmVjYXRpb24gPT09IHRydWUpIHtcbiAgICByZXR1cm4gZm47XG4gIH1cblxuICB2YXIgd2FybmVkID0gZmFsc2U7XG4gIGZ1bmN0aW9uIGRlcHJlY2F0ZWQoKSB7XG4gICAgaWYgKCF3YXJuZWQpIHtcbiAgICAgIGlmIChwcm9jZXNzLnRocm93RGVwcmVjYXRpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MudHJhY2VEZXByZWNhdGlvbikge1xuICAgICAgICBjb25zb2xlLnRyYWNlKG1zZyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgICB9XG4gICAgICB3YXJuZWQgPSB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfVxuXG4gIHJldHVybiBkZXByZWNhdGVkO1xufTtcblxuXG52YXIgZGVidWdzID0ge307XG52YXIgZGVidWdFbnZpcm9uO1xuZXhwb3J0cy5kZWJ1Z2xvZyA9IGZ1bmN0aW9uKHNldCkge1xuICBpZiAoaXNVbmRlZmluZWQoZGVidWdFbnZpcm9uKSlcbiAgICBkZWJ1Z0Vudmlyb24gPSBwcm9jZXNzLmVudi5OT0RFX0RFQlVHIHx8ICcnO1xuICBzZXQgPSBzZXQudG9VcHBlckNhc2UoKTtcbiAgaWYgKCFkZWJ1Z3Nbc2V0XSkge1xuICAgIGlmIChuZXcgUmVnRXhwKCdcXFxcYicgKyBzZXQgKyAnXFxcXGInLCAnaScpLnRlc3QoZGVidWdFbnZpcm9uKSkge1xuICAgICAgdmFyIHBpZCA9IHByb2Nlc3MucGlkO1xuICAgICAgZGVidWdzW3NldF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIG1zZyA9IGV4cG9ydHMuZm9ybWF0LmFwcGx5KGV4cG9ydHMsIGFyZ3VtZW50cyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJyVzICVkOiAlcycsIHNldCwgcGlkLCBtc2cpO1xuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgZGVidWdzW3NldF0gPSBmdW5jdGlvbigpIHt9O1xuICAgIH1cbiAgfVxuICByZXR1cm4gZGVidWdzW3NldF07XG59O1xuXG5cbi8qKlxuICogRWNob3MgdGhlIHZhbHVlIG9mIGEgdmFsdWUuIFRyeXMgdG8gcHJpbnQgdGhlIHZhbHVlIG91dFxuICogaW4gdGhlIGJlc3Qgd2F5IHBvc3NpYmxlIGdpdmVuIHRoZSBkaWZmZXJlbnQgdHlwZXMuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9iaiBUaGUgb2JqZWN0IHRvIHByaW50IG91dC5cbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRzIE9wdGlvbmFsIG9wdGlvbnMgb2JqZWN0IHRoYXQgYWx0ZXJzIHRoZSBvdXRwdXQuXG4gKi9cbi8qIGxlZ2FjeTogb2JqLCBzaG93SGlkZGVuLCBkZXB0aCwgY29sb3JzKi9cbmZ1bmN0aW9uIGluc3BlY3Qob2JqLCBvcHRzKSB7XG4gIC8vIGRlZmF1bHQgb3B0aW9uc1xuICB2YXIgY3R4ID0ge1xuICAgIHNlZW46IFtdLFxuICAgIHN0eWxpemU6IHN0eWxpemVOb0NvbG9yXG4gIH07XG4gIC8vIGxlZ2FjeS4uLlxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+PSAzKSBjdHguZGVwdGggPSBhcmd1bWVudHNbMl07XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID49IDQpIGN0eC5jb2xvcnMgPSBhcmd1bWVudHNbM107XG4gIGlmIChpc0Jvb2xlYW4ob3B0cykpIHtcbiAgICAvLyBsZWdhY3kuLi5cbiAgICBjdHguc2hvd0hpZGRlbiA9IG9wdHM7XG4gIH0gZWxzZSBpZiAob3B0cykge1xuICAgIC8vIGdvdCBhbiBcIm9wdGlvbnNcIiBvYmplY3RcbiAgICBleHBvcnRzLl9leHRlbmQoY3R4LCBvcHRzKTtcbiAgfVxuICAvLyBzZXQgZGVmYXVsdCBvcHRpb25zXG4gIGlmIChpc1VuZGVmaW5lZChjdHguc2hvd0hpZGRlbikpIGN0eC5zaG93SGlkZGVuID0gZmFsc2U7XG4gIGlmIChpc1VuZGVmaW5lZChjdHguZGVwdGgpKSBjdHguZGVwdGggPSAyO1xuICBpZiAoaXNVbmRlZmluZWQoY3R4LmNvbG9ycykpIGN0eC5jb2xvcnMgPSBmYWxzZTtcbiAgaWYgKGlzVW5kZWZpbmVkKGN0eC5jdXN0b21JbnNwZWN0KSkgY3R4LmN1c3RvbUluc3BlY3QgPSB0cnVlO1xuICBpZiAoY3R4LmNvbG9ycykgY3R4LnN0eWxpemUgPSBzdHlsaXplV2l0aENvbG9yO1xuICByZXR1cm4gZm9ybWF0VmFsdWUoY3R4LCBvYmosIGN0eC5kZXB0aCk7XG59XG5leHBvcnRzLmluc3BlY3QgPSBpbnNwZWN0O1xuXG5cbi8vIGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvQU5TSV9lc2NhcGVfY29kZSNncmFwaGljc1xuaW5zcGVjdC5jb2xvcnMgPSB7XG4gICdib2xkJyA6IFsxLCAyMl0sXG4gICdpdGFsaWMnIDogWzMsIDIzXSxcbiAgJ3VuZGVybGluZScgOiBbNCwgMjRdLFxuICAnaW52ZXJzZScgOiBbNywgMjddLFxuICAnd2hpdGUnIDogWzM3LCAzOV0sXG4gICdncmV5JyA6IFs5MCwgMzldLFxuICAnYmxhY2snIDogWzMwLCAzOV0sXG4gICdibHVlJyA6IFszNCwgMzldLFxuICAnY3lhbicgOiBbMzYsIDM5XSxcbiAgJ2dyZWVuJyA6IFszMiwgMzldLFxuICAnbWFnZW50YScgOiBbMzUsIDM5XSxcbiAgJ3JlZCcgOiBbMzEsIDM5XSxcbiAgJ3llbGxvdycgOiBbMzMsIDM5XVxufTtcblxuLy8gRG9uJ3QgdXNlICdibHVlJyBub3QgdmlzaWJsZSBvbiBjbWQuZXhlXG5pbnNwZWN0LnN0eWxlcyA9IHtcbiAgJ3NwZWNpYWwnOiAnY3lhbicsXG4gICdudW1iZXInOiAneWVsbG93JyxcbiAgJ2Jvb2xlYW4nOiAneWVsbG93JyxcbiAgJ3VuZGVmaW5lZCc6ICdncmV5JyxcbiAgJ251bGwnOiAnYm9sZCcsXG4gICdzdHJpbmcnOiAnZ3JlZW4nLFxuICAnZGF0ZSc6ICdtYWdlbnRhJyxcbiAgLy8gXCJuYW1lXCI6IGludGVudGlvbmFsbHkgbm90IHN0eWxpbmdcbiAgJ3JlZ2V4cCc6ICdyZWQnXG59O1xuXG5cbmZ1bmN0aW9uIHN0eWxpemVXaXRoQ29sb3Ioc3RyLCBzdHlsZVR5cGUpIHtcbiAgdmFyIHN0eWxlID0gaW5zcGVjdC5zdHlsZXNbc3R5bGVUeXBlXTtcblxuICBpZiAoc3R5bGUpIHtcbiAgICByZXR1cm4gJ1xcdTAwMWJbJyArIGluc3BlY3QuY29sb3JzW3N0eWxlXVswXSArICdtJyArIHN0ciArXG4gICAgICAgICAgICdcXHUwMDFiWycgKyBpbnNwZWN0LmNvbG9yc1tzdHlsZV1bMV0gKyAnbSc7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHN0cjtcbiAgfVxufVxuXG5cbmZ1bmN0aW9uIHN0eWxpemVOb0NvbG9yKHN0ciwgc3R5bGVUeXBlKSB7XG4gIHJldHVybiBzdHI7XG59XG5cblxuZnVuY3Rpb24gYXJyYXlUb0hhc2goYXJyYXkpIHtcbiAgdmFyIGhhc2ggPSB7fTtcblxuICBhcnJheS5mb3JFYWNoKGZ1bmN0aW9uKHZhbCwgaWR4KSB7XG4gICAgaGFzaFt2YWxdID0gdHJ1ZTtcbiAgfSk7XG5cbiAgcmV0dXJuIGhhc2g7XG59XG5cblxuZnVuY3Rpb24gZm9ybWF0VmFsdWUoY3R4LCB2YWx1ZSwgcmVjdXJzZVRpbWVzKSB7XG4gIC8vIFByb3ZpZGUgYSBob29rIGZvciB1c2VyLXNwZWNpZmllZCBpbnNwZWN0IGZ1bmN0aW9ucy5cbiAgLy8gQ2hlY2sgdGhhdCB2YWx1ZSBpcyBhbiBvYmplY3Qgd2l0aCBhbiBpbnNwZWN0IGZ1bmN0aW9uIG9uIGl0XG4gIGlmIChjdHguY3VzdG9tSW5zcGVjdCAmJlxuICAgICAgdmFsdWUgJiZcbiAgICAgIGlzRnVuY3Rpb24odmFsdWUuaW5zcGVjdCkgJiZcbiAgICAgIC8vIEZpbHRlciBvdXQgdGhlIHV0aWwgbW9kdWxlLCBpdCdzIGluc3BlY3QgZnVuY3Rpb24gaXMgc3BlY2lhbFxuICAgICAgdmFsdWUuaW5zcGVjdCAhPT0gZXhwb3J0cy5pbnNwZWN0ICYmXG4gICAgICAvLyBBbHNvIGZpbHRlciBvdXQgYW55IHByb3RvdHlwZSBvYmplY3RzIHVzaW5nIHRoZSBjaXJjdWxhciBjaGVjay5cbiAgICAgICEodmFsdWUuY29uc3RydWN0b3IgJiYgdmFsdWUuY29uc3RydWN0b3IucHJvdG90eXBlID09PSB2YWx1ZSkpIHtcbiAgICB2YXIgcmV0ID0gdmFsdWUuaW5zcGVjdChyZWN1cnNlVGltZXMsIGN0eCk7XG4gICAgaWYgKCFpc1N0cmluZyhyZXQpKSB7XG4gICAgICByZXQgPSBmb3JtYXRWYWx1ZShjdHgsIHJldCwgcmVjdXJzZVRpbWVzKTtcbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbiAgfVxuXG4gIC8vIFByaW1pdGl2ZSB0eXBlcyBjYW5ub3QgaGF2ZSBwcm9wZXJ0aWVzXG4gIHZhciBwcmltaXRpdmUgPSBmb3JtYXRQcmltaXRpdmUoY3R4LCB2YWx1ZSk7XG4gIGlmIChwcmltaXRpdmUpIHtcbiAgICByZXR1cm4gcHJpbWl0aXZlO1xuICB9XG5cbiAgLy8gTG9vayB1cCB0aGUga2V5cyBvZiB0aGUgb2JqZWN0LlxuICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKHZhbHVlKTtcbiAgdmFyIHZpc2libGVLZXlzID0gYXJyYXlUb0hhc2goa2V5cyk7XG5cbiAgaWYgKGN0eC5zaG93SGlkZGVuKSB7XG4gICAga2V5cyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHZhbHVlKTtcbiAgfVxuXG4gIC8vIElFIGRvZXNuJ3QgbWFrZSBlcnJvciBmaWVsZHMgbm9uLWVudW1lcmFibGVcbiAgLy8gaHR0cDovL21zZG4ubWljcm9zb2Z0LmNvbS9lbi11cy9saWJyYXJ5L2llL2R3dzUyc2J0KHY9dnMuOTQpLmFzcHhcbiAgaWYgKGlzRXJyb3IodmFsdWUpXG4gICAgICAmJiAoa2V5cy5pbmRleE9mKCdtZXNzYWdlJykgPj0gMCB8fCBrZXlzLmluZGV4T2YoJ2Rlc2NyaXB0aW9uJykgPj0gMCkpIHtcbiAgICByZXR1cm4gZm9ybWF0RXJyb3IodmFsdWUpO1xuICB9XG5cbiAgLy8gU29tZSB0eXBlIG9mIG9iamVjdCB3aXRob3V0IHByb3BlcnRpZXMgY2FuIGJlIHNob3J0Y3V0dGVkLlxuICBpZiAoa2V5cy5sZW5ndGggPT09IDApIHtcbiAgICBpZiAoaXNGdW5jdGlvbih2YWx1ZSkpIHtcbiAgICAgIHZhciBuYW1lID0gdmFsdWUubmFtZSA/ICc6ICcgKyB2YWx1ZS5uYW1lIDogJyc7XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoJ1tGdW5jdGlvbicgKyBuYW1lICsgJ10nLCAnc3BlY2lhbCcpO1xuICAgIH1cbiAgICBpZiAoaXNSZWdFeHAodmFsdWUpKSB7XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoUmVnRXhwLnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHZhbHVlKSwgJ3JlZ2V4cCcpO1xuICAgIH1cbiAgICBpZiAoaXNEYXRlKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIGN0eC5zdHlsaXplKERhdGUucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwodmFsdWUpLCAnZGF0ZScpO1xuICAgIH1cbiAgICBpZiAoaXNFcnJvcih2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBmb3JtYXRFcnJvcih2YWx1ZSk7XG4gICAgfVxuICB9XG5cbiAgdmFyIGJhc2UgPSAnJywgYXJyYXkgPSBmYWxzZSwgYnJhY2VzID0gWyd7JywgJ30nXTtcblxuICAvLyBNYWtlIEFycmF5IHNheSB0aGF0IHRoZXkgYXJlIEFycmF5XG4gIGlmIChpc0FycmF5KHZhbHVlKSkge1xuICAgIGFycmF5ID0gdHJ1ZTtcbiAgICBicmFjZXMgPSBbJ1snLCAnXSddO1xuICB9XG5cbiAgLy8gTWFrZSBmdW5jdGlvbnMgc2F5IHRoYXQgdGhleSBhcmUgZnVuY3Rpb25zXG4gIGlmIChpc0Z1bmN0aW9uKHZhbHVlKSkge1xuICAgIHZhciBuID0gdmFsdWUubmFtZSA/ICc6ICcgKyB2YWx1ZS5uYW1lIDogJyc7XG4gICAgYmFzZSA9ICcgW0Z1bmN0aW9uJyArIG4gKyAnXSc7XG4gIH1cblxuICAvLyBNYWtlIFJlZ0V4cHMgc2F5IHRoYXQgdGhleSBhcmUgUmVnRXhwc1xuICBpZiAoaXNSZWdFeHAodmFsdWUpKSB7XG4gICAgYmFzZSA9ICcgJyArIFJlZ0V4cC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSk7XG4gIH1cblxuICAvLyBNYWtlIGRhdGVzIHdpdGggcHJvcGVydGllcyBmaXJzdCBzYXkgdGhlIGRhdGVcbiAgaWYgKGlzRGF0ZSh2YWx1ZSkpIHtcbiAgICBiYXNlID0gJyAnICsgRGF0ZS5wcm90b3R5cGUudG9VVENTdHJpbmcuY2FsbCh2YWx1ZSk7XG4gIH1cblxuICAvLyBNYWtlIGVycm9yIHdpdGggbWVzc2FnZSBmaXJzdCBzYXkgdGhlIGVycm9yXG4gIGlmIChpc0Vycm9yKHZhbHVlKSkge1xuICAgIGJhc2UgPSAnICcgKyBmb3JtYXRFcnJvcih2YWx1ZSk7XG4gIH1cblxuICBpZiAoa2V5cy5sZW5ndGggPT09IDAgJiYgKCFhcnJheSB8fCB2YWx1ZS5sZW5ndGggPT0gMCkpIHtcbiAgICByZXR1cm4gYnJhY2VzWzBdICsgYmFzZSArIGJyYWNlc1sxXTtcbiAgfVxuXG4gIGlmIChyZWN1cnNlVGltZXMgPCAwKSB7XG4gICAgaWYgKGlzUmVnRXhwKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIGN0eC5zdHlsaXplKFJlZ0V4cC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSksICdyZWdleHAnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGN0eC5zdHlsaXplKCdbT2JqZWN0XScsICdzcGVjaWFsJyk7XG4gICAgfVxuICB9XG5cbiAgY3R4LnNlZW4ucHVzaCh2YWx1ZSk7XG5cbiAgdmFyIG91dHB1dDtcbiAgaWYgKGFycmF5KSB7XG4gICAgb3V0cHV0ID0gZm9ybWF0QXJyYXkoY3R4LCB2YWx1ZSwgcmVjdXJzZVRpbWVzLCB2aXNpYmxlS2V5cywga2V5cyk7XG4gIH0gZWxzZSB7XG4gICAgb3V0cHV0ID0ga2V5cy5tYXAoZnVuY3Rpb24oa2V5KSB7XG4gICAgICByZXR1cm4gZm9ybWF0UHJvcGVydHkoY3R4LCB2YWx1ZSwgcmVjdXJzZVRpbWVzLCB2aXNpYmxlS2V5cywga2V5LCBhcnJheSk7XG4gICAgfSk7XG4gIH1cblxuICBjdHguc2Vlbi5wb3AoKTtcblxuICByZXR1cm4gcmVkdWNlVG9TaW5nbGVTdHJpbmcob3V0cHV0LCBiYXNlLCBicmFjZXMpO1xufVxuXG5cbmZ1bmN0aW9uIGZvcm1hdFByaW1pdGl2ZShjdHgsIHZhbHVlKSB7XG4gIGlmIChpc1VuZGVmaW5lZCh2YWx1ZSkpXG4gICAgcmV0dXJuIGN0eC5zdHlsaXplKCd1bmRlZmluZWQnLCAndW5kZWZpbmVkJyk7XG4gIGlmIChpc1N0cmluZyh2YWx1ZSkpIHtcbiAgICB2YXIgc2ltcGxlID0gJ1xcJycgKyBKU09OLnN0cmluZ2lmeSh2YWx1ZSkucmVwbGFjZSgvXlwifFwiJC9nLCAnJylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8nL2csIFwiXFxcXCdcIilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC9cXFxcXCIvZywgJ1wiJykgKyAnXFwnJztcbiAgICByZXR1cm4gY3R4LnN0eWxpemUoc2ltcGxlLCAnc3RyaW5nJyk7XG4gIH1cbiAgaWYgKGlzTnVtYmVyKHZhbHVlKSlcbiAgICByZXR1cm4gY3R4LnN0eWxpemUoJycgKyB2YWx1ZSwgJ251bWJlcicpO1xuICBpZiAoaXNCb29sZWFuKHZhbHVlKSlcbiAgICByZXR1cm4gY3R4LnN0eWxpemUoJycgKyB2YWx1ZSwgJ2Jvb2xlYW4nKTtcbiAgLy8gRm9yIHNvbWUgcmVhc29uIHR5cGVvZiBudWxsIGlzIFwib2JqZWN0XCIsIHNvIHNwZWNpYWwgY2FzZSBoZXJlLlxuICBpZiAoaXNOdWxsKHZhbHVlKSlcbiAgICByZXR1cm4gY3R4LnN0eWxpemUoJ251bGwnLCAnbnVsbCcpO1xufVxuXG5cbmZ1bmN0aW9uIGZvcm1hdEVycm9yKHZhbHVlKSB7XG4gIHJldHVybiAnWycgKyBFcnJvci5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSkgKyAnXSc7XG59XG5cblxuZnVuY3Rpb24gZm9ybWF0QXJyYXkoY3R4LCB2YWx1ZSwgcmVjdXJzZVRpbWVzLCB2aXNpYmxlS2V5cywga2V5cykge1xuICB2YXIgb3V0cHV0ID0gW107XG4gIGZvciAodmFyIGkgPSAwLCBsID0gdmFsdWUubGVuZ3RoOyBpIDwgbDsgKytpKSB7XG4gICAgaWYgKGhhc093blByb3BlcnR5KHZhbHVlLCBTdHJpbmcoaSkpKSB7XG4gICAgICBvdXRwdXQucHVzaChmb3JtYXRQcm9wZXJ0eShjdHgsIHZhbHVlLCByZWN1cnNlVGltZXMsIHZpc2libGVLZXlzLFxuICAgICAgICAgIFN0cmluZyhpKSwgdHJ1ZSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBvdXRwdXQucHVzaCgnJyk7XG4gICAgfVxuICB9XG4gIGtleXMuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICBpZiAoIWtleS5tYXRjaCgvXlxcZCskLykpIHtcbiAgICAgIG91dHB1dC5wdXNoKGZvcm1hdFByb3BlcnR5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsXG4gICAgICAgICAga2V5LCB0cnVlKSk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIG91dHB1dDtcbn1cblxuXG5mdW5jdGlvbiBmb3JtYXRQcm9wZXJ0eShjdHgsIHZhbHVlLCByZWN1cnNlVGltZXMsIHZpc2libGVLZXlzLCBrZXksIGFycmF5KSB7XG4gIHZhciBuYW1lLCBzdHIsIGRlc2M7XG4gIGRlc2MgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHZhbHVlLCBrZXkpIHx8IHsgdmFsdWU6IHZhbHVlW2tleV0gfTtcbiAgaWYgKGRlc2MuZ2V0KSB7XG4gICAgaWYgKGRlc2Muc2V0KSB7XG4gICAgICBzdHIgPSBjdHguc3R5bGl6ZSgnW0dldHRlci9TZXR0ZXJdJywgJ3NwZWNpYWwnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3RyID0gY3R4LnN0eWxpemUoJ1tHZXR0ZXJdJywgJ3NwZWNpYWwnKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgaWYgKGRlc2Muc2V0KSB7XG4gICAgICBzdHIgPSBjdHguc3R5bGl6ZSgnW1NldHRlcl0nLCAnc3BlY2lhbCcpO1xuICAgIH1cbiAgfVxuICBpZiAoIWhhc093blByb3BlcnR5KHZpc2libGVLZXlzLCBrZXkpKSB7XG4gICAgbmFtZSA9ICdbJyArIGtleSArICddJztcbiAgfVxuICBpZiAoIXN0cikge1xuICAgIGlmIChjdHguc2Vlbi5pbmRleE9mKGRlc2MudmFsdWUpIDwgMCkge1xuICAgICAgaWYgKGlzTnVsbChyZWN1cnNlVGltZXMpKSB7XG4gICAgICAgIHN0ciA9IGZvcm1hdFZhbHVlKGN0eCwgZGVzYy52YWx1ZSwgbnVsbCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzdHIgPSBmb3JtYXRWYWx1ZShjdHgsIGRlc2MudmFsdWUsIHJlY3Vyc2VUaW1lcyAtIDEpO1xuICAgICAgfVxuICAgICAgaWYgKHN0ci5pbmRleE9mKCdcXG4nKSA+IC0xKSB7XG4gICAgICAgIGlmIChhcnJheSkge1xuICAgICAgICAgIHN0ciA9IHN0ci5zcGxpdCgnXFxuJykubWFwKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICAgIHJldHVybiAnICAnICsgbGluZTtcbiAgICAgICAgICB9KS5qb2luKCdcXG4nKS5zdWJzdHIoMik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc3RyID0gJ1xcbicgKyBzdHIuc3BsaXQoJ1xcbicpLm1hcChmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgICAgICByZXR1cm4gJyAgICcgKyBsaW5lO1xuICAgICAgICAgIH0pLmpvaW4oJ1xcbicpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHN0ciA9IGN0eC5zdHlsaXplKCdbQ2lyY3VsYXJdJywgJ3NwZWNpYWwnKTtcbiAgICB9XG4gIH1cbiAgaWYgKGlzVW5kZWZpbmVkKG5hbWUpKSB7XG4gICAgaWYgKGFycmF5ICYmIGtleS5tYXRjaCgvXlxcZCskLykpIHtcbiAgICAgIHJldHVybiBzdHI7XG4gICAgfVxuICAgIG5hbWUgPSBKU09OLnN0cmluZ2lmeSgnJyArIGtleSk7XG4gICAgaWYgKG5hbWUubWF0Y2goL15cIihbYS16QS1aX11bYS16QS1aXzAtOV0qKVwiJC8pKSB7XG4gICAgICBuYW1lID0gbmFtZS5zdWJzdHIoMSwgbmFtZS5sZW5ndGggLSAyKTtcbiAgICAgIG5hbWUgPSBjdHguc3R5bGl6ZShuYW1lLCAnbmFtZScpO1xuICAgIH0gZWxzZSB7XG4gICAgICBuYW1lID0gbmFtZS5yZXBsYWNlKC8nL2csIFwiXFxcXCdcIilcbiAgICAgICAgICAgICAgICAgLnJlcGxhY2UoL1xcXFxcIi9nLCAnXCInKVxuICAgICAgICAgICAgICAgICAucmVwbGFjZSgvKF5cInxcIiQpL2csIFwiJ1wiKTtcbiAgICAgIG5hbWUgPSBjdHguc3R5bGl6ZShuYW1lLCAnc3RyaW5nJyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5hbWUgKyAnOiAnICsgc3RyO1xufVxuXG5cbmZ1bmN0aW9uIHJlZHVjZVRvU2luZ2xlU3RyaW5nKG91dHB1dCwgYmFzZSwgYnJhY2VzKSB7XG4gIHZhciBudW1MaW5lc0VzdCA9IDA7XG4gIHZhciBsZW5ndGggPSBvdXRwdXQucmVkdWNlKGZ1bmN0aW9uKHByZXYsIGN1cikge1xuICAgIG51bUxpbmVzRXN0Kys7XG4gICAgaWYgKGN1ci5pbmRleE9mKCdcXG4nKSA+PSAwKSBudW1MaW5lc0VzdCsrO1xuICAgIHJldHVybiBwcmV2ICsgY3VyLnJlcGxhY2UoL1xcdTAwMWJcXFtcXGRcXGQ/bS9nLCAnJykubGVuZ3RoICsgMTtcbiAgfSwgMCk7XG5cbiAgaWYgKGxlbmd0aCA+IDYwKSB7XG4gICAgcmV0dXJuIGJyYWNlc1swXSArXG4gICAgICAgICAgIChiYXNlID09PSAnJyA/ICcnIDogYmFzZSArICdcXG4gJykgK1xuICAgICAgICAgICAnICcgK1xuICAgICAgICAgICBvdXRwdXQuam9pbignLFxcbiAgJykgK1xuICAgICAgICAgICAnICcgK1xuICAgICAgICAgICBicmFjZXNbMV07XG4gIH1cblxuICByZXR1cm4gYnJhY2VzWzBdICsgYmFzZSArICcgJyArIG91dHB1dC5qb2luKCcsICcpICsgJyAnICsgYnJhY2VzWzFdO1xufVxuXG5cbi8vIE5PVEU6IFRoZXNlIHR5cGUgY2hlY2tpbmcgZnVuY3Rpb25zIGludGVudGlvbmFsbHkgZG9uJ3QgdXNlIGBpbnN0YW5jZW9mYFxuLy8gYmVjYXVzZSBpdCBpcyBmcmFnaWxlIGFuZCBjYW4gYmUgZWFzaWx5IGZha2VkIHdpdGggYE9iamVjdC5jcmVhdGUoKWAuXG5mdW5jdGlvbiBpc0FycmF5KGFyKSB7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGFyKTtcbn1cbmV4cG9ydHMuaXNBcnJheSA9IGlzQXJyYXk7XG5cbmZ1bmN0aW9uIGlzQm9vbGVhbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdib29sZWFuJztcbn1cbmV4cG9ydHMuaXNCb29sZWFuID0gaXNCb29sZWFuO1xuXG5mdW5jdGlvbiBpc051bGwoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IG51bGw7XG59XG5leHBvcnRzLmlzTnVsbCA9IGlzTnVsbDtcblxuZnVuY3Rpb24gaXNOdWxsT3JVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT0gbnVsbDtcbn1cbmV4cG9ydHMuaXNOdWxsT3JVbmRlZmluZWQgPSBpc051bGxPclVuZGVmaW5lZDtcblxuZnVuY3Rpb24gaXNOdW1iZXIoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJztcbn1cbmV4cG9ydHMuaXNOdW1iZXIgPSBpc051bWJlcjtcblxuZnVuY3Rpb24gaXNTdHJpbmcoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnc3RyaW5nJztcbn1cbmV4cG9ydHMuaXNTdHJpbmcgPSBpc1N0cmluZztcblxuZnVuY3Rpb24gaXNTeW1ib2woYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnc3ltYm9sJztcbn1cbmV4cG9ydHMuaXNTeW1ib2wgPSBpc1N5bWJvbDtcblxuZnVuY3Rpb24gaXNVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IHZvaWQgMDtcbn1cbmV4cG9ydHMuaXNVbmRlZmluZWQgPSBpc1VuZGVmaW5lZDtcblxuZnVuY3Rpb24gaXNSZWdFeHAocmUpIHtcbiAgcmV0dXJuIGlzT2JqZWN0KHJlKSAmJiBvYmplY3RUb1N0cmluZyhyZSkgPT09ICdbb2JqZWN0IFJlZ0V4cF0nO1xufVxuZXhwb3J0cy5pc1JlZ0V4cCA9IGlzUmVnRXhwO1xuXG5mdW5jdGlvbiBpc09iamVjdChhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyAhPT0gbnVsbDtcbn1cbmV4cG9ydHMuaXNPYmplY3QgPSBpc09iamVjdDtcblxuZnVuY3Rpb24gaXNEYXRlKGQpIHtcbiAgcmV0dXJuIGlzT2JqZWN0KGQpICYmIG9iamVjdFRvU3RyaW5nKGQpID09PSAnW29iamVjdCBEYXRlXSc7XG59XG5leHBvcnRzLmlzRGF0ZSA9IGlzRGF0ZTtcblxuZnVuY3Rpb24gaXNFcnJvcihlKSB7XG4gIHJldHVybiBpc09iamVjdChlKSAmJlxuICAgICAgKG9iamVjdFRvU3RyaW5nKGUpID09PSAnW29iamVjdCBFcnJvcl0nIHx8IGUgaW5zdGFuY2VvZiBFcnJvcik7XG59XG5leHBvcnRzLmlzRXJyb3IgPSBpc0Vycm9yO1xuXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJztcbn1cbmV4cG9ydHMuaXNGdW5jdGlvbiA9IGlzRnVuY3Rpb247XG5cbmZ1bmN0aW9uIGlzUHJpbWl0aXZlKGFyZykge1xuICByZXR1cm4gYXJnID09PSBudWxsIHx8XG4gICAgICAgICB0eXBlb2YgYXJnID09PSAnYm9vbGVhbicgfHxcbiAgICAgICAgIHR5cGVvZiBhcmcgPT09ICdudW1iZXInIHx8XG4gICAgICAgICB0eXBlb2YgYXJnID09PSAnc3RyaW5nJyB8fFxuICAgICAgICAgdHlwZW9mIGFyZyA9PT0gJ3N5bWJvbCcgfHwgIC8vIEVTNiBzeW1ib2xcbiAgICAgICAgIHR5cGVvZiBhcmcgPT09ICd1bmRlZmluZWQnO1xufVxuZXhwb3J0cy5pc1ByaW1pdGl2ZSA9IGlzUHJpbWl0aXZlO1xuXG5leHBvcnRzLmlzQnVmZmVyID0gcmVxdWlyZSgnLi9zdXBwb3J0L2lzQnVmZmVyJyk7XG5cbmZ1bmN0aW9uIG9iamVjdFRvU3RyaW5nKG8pIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvKTtcbn1cblxuXG5mdW5jdGlvbiBwYWQobikge1xuICByZXR1cm4gbiA8IDEwID8gJzAnICsgbi50b1N0cmluZygxMCkgOiBuLnRvU3RyaW5nKDEwKTtcbn1cblxuXG52YXIgbW9udGhzID0gWydKYW4nLCAnRmViJywgJ01hcicsICdBcHInLCAnTWF5JywgJ0p1bicsICdKdWwnLCAnQXVnJywgJ1NlcCcsXG4gICAgICAgICAgICAgICdPY3QnLCAnTm92JywgJ0RlYyddO1xuXG4vLyAyNiBGZWIgMTY6MTk6MzRcbmZ1bmN0aW9uIHRpbWVzdGFtcCgpIHtcbiAgdmFyIGQgPSBuZXcgRGF0ZSgpO1xuICB2YXIgdGltZSA9IFtwYWQoZC5nZXRIb3VycygpKSxcbiAgICAgICAgICAgICAgcGFkKGQuZ2V0TWludXRlcygpKSxcbiAgICAgICAgICAgICAgcGFkKGQuZ2V0U2Vjb25kcygpKV0uam9pbignOicpO1xuICByZXR1cm4gW2QuZ2V0RGF0ZSgpLCBtb250aHNbZC5nZXRNb250aCgpXSwgdGltZV0uam9pbignICcpO1xufVxuXG5cbi8vIGxvZyBpcyBqdXN0IGEgdGhpbiB3cmFwcGVyIHRvIGNvbnNvbGUubG9nIHRoYXQgcHJlcGVuZHMgYSB0aW1lc3RhbXBcbmV4cG9ydHMubG9nID0gZnVuY3Rpb24oKSB7XG4gIGNvbnNvbGUubG9nKCclcyAtICVzJywgdGltZXN0YW1wKCksIGV4cG9ydHMuZm9ybWF0LmFwcGx5KGV4cG9ydHMsIGFyZ3VtZW50cykpO1xufTtcblxuXG4vKipcbiAqIEluaGVyaXQgdGhlIHByb3RvdHlwZSBtZXRob2RzIGZyb20gb25lIGNvbnN0cnVjdG9yIGludG8gYW5vdGhlci5cbiAqXG4gKiBUaGUgRnVuY3Rpb24ucHJvdG90eXBlLmluaGVyaXRzIGZyb20gbGFuZy5qcyByZXdyaXR0ZW4gYXMgYSBzdGFuZGFsb25lXG4gKiBmdW5jdGlvbiAobm90IG9uIEZ1bmN0aW9uLnByb3RvdHlwZSkuIE5PVEU6IElmIHRoaXMgZmlsZSBpcyB0byBiZSBsb2FkZWRcbiAqIGR1cmluZyBib290c3RyYXBwaW5nIHRoaXMgZnVuY3Rpb24gbmVlZHMgdG8gYmUgcmV3cml0dGVuIHVzaW5nIHNvbWUgbmF0aXZlXG4gKiBmdW5jdGlvbnMgYXMgcHJvdG90eXBlIHNldHVwIHVzaW5nIG5vcm1hbCBKYXZhU2NyaXB0IGRvZXMgbm90IHdvcmsgYXNcbiAqIGV4cGVjdGVkIGR1cmluZyBib290c3RyYXBwaW5nIChzZWUgbWlycm9yLmpzIGluIHIxMTQ5MDMpLlxuICpcbiAqIEBwYXJhbSB7ZnVuY3Rpb259IGN0b3IgQ29uc3RydWN0b3IgZnVuY3Rpb24gd2hpY2ggbmVlZHMgdG8gaW5oZXJpdCB0aGVcbiAqICAgICBwcm90b3R5cGUuXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBzdXBlckN0b3IgQ29uc3RydWN0b3IgZnVuY3Rpb24gdG8gaW5oZXJpdCBwcm90b3R5cGUgZnJvbS5cbiAqL1xuZXhwb3J0cy5pbmhlcml0cyA9IHJlcXVpcmUoJ2luaGVyaXRzJyk7XG5cbmV4cG9ydHMuX2V4dGVuZCA9IGZ1bmN0aW9uKG9yaWdpbiwgYWRkKSB7XG4gIC8vIERvbid0IGRvIGFueXRoaW5nIGlmIGFkZCBpc24ndCBhbiBvYmplY3RcbiAgaWYgKCFhZGQgfHwgIWlzT2JqZWN0KGFkZCkpIHJldHVybiBvcmlnaW47XG5cbiAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhhZGQpO1xuICB2YXIgaSA9IGtleXMubGVuZ3RoO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgb3JpZ2luW2tleXNbaV1dID0gYWRkW2tleXNbaV1dO1xuICB9XG4gIHJldHVybiBvcmlnaW47XG59O1xuXG5mdW5jdGlvbiBoYXNPd25Qcm9wZXJ0eShvYmosIHByb3ApIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIHByb3ApO1xufVxuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIi9Vc2Vycy9qcG9jaHlsYS9Qcm9qZWN0cy90cmV6b3IuanMvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2luc2VydC1tb2R1bGUtZ2xvYmFscy9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSkiLCIvKipcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEF1dGhvcjogICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogTGljZW5zZTogIE1JVFxuICpcbiAqIGBucG0gaW5zdGFsbCBidWZmZXJgXG4gKi9cblxudmFyIGJhc2U2NCA9IHJlcXVpcmUoJ2Jhc2U2NC1qcycpXG52YXIgaWVlZTc1NCA9IHJlcXVpcmUoJ2llZWU3NTQnKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTID0gNTBcbkJ1ZmZlci5wb29sU2l6ZSA9IDgxOTJcblxuLyoqXG4gKiBJZiBgQnVmZmVyLl91c2VUeXBlZEFycmF5c2A6XG4gKiAgID09PSB0cnVlICAgIFVzZSBVaW50OEFycmF5IGltcGxlbWVudGF0aW9uIChmYXN0ZXN0KVxuICogICA9PT0gZmFsc2UgICBVc2UgT2JqZWN0IGltcGxlbWVudGF0aW9uIChjb21wYXRpYmxlIGRvd24gdG8gSUU2KVxuICovXG5CdWZmZXIuX3VzZVR5cGVkQXJyYXlzID0gKGZ1bmN0aW9uICgpIHtcbiAgIC8vIERldGVjdCBpZiBicm93c2VyIHN1cHBvcnRzIFR5cGVkIEFycmF5cy4gU3VwcG9ydGVkIGJyb3dzZXJzIGFyZSBJRSAxMCssXG4gICAvLyBGaXJlZm94IDQrLCBDaHJvbWUgNyssIFNhZmFyaSA1LjErLCBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gIGlmICh0eXBlb2YgVWludDhBcnJheSA9PT0gJ3VuZGVmaW5lZCcgfHwgdHlwZW9mIEFycmF5QnVmZmVyID09PSAndW5kZWZpbmVkJylcbiAgICByZXR1cm4gZmFsc2VcblxuICAvLyBEb2VzIHRoZSBicm93c2VyIHN1cHBvcnQgYWRkaW5nIHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgIGluc3RhbmNlcz8gSWZcbiAgLy8gbm90LCB0aGVuIHRoYXQncyB0aGUgc2FtZSBhcyBubyBgVWludDhBcnJheWAgc3VwcG9ydC4gV2UgbmVlZCB0byBiZSBhYmxlIHRvXG4gIC8vIGFkZCBhbGwgdGhlIG5vZGUgQnVmZmVyIEFQSSBtZXRob2RzLlxuICAvLyBSZWxldmFudCBGaXJlZm94IGJ1ZzogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Njk1NDM4XG4gIHRyeSB7XG4gICAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KDApXG4gICAgYXJyLmZvbyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIDQyIH1cbiAgICByZXR1cm4gNDIgPT09IGFyci5mb28oKSAmJlxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nIC8vIENocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn0pKClcblxuLyoqXG4gKiBDbGFzczogQnVmZmVyXG4gKiA9PT09PT09PT09PT09XG4gKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBhcmUgYXVnbWVudGVkXG4gKiB3aXRoIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBBUEkgZnVuY3Rpb25zLiBXZSB1c2VcbiAqIGBVaW50OEFycmF5YCBzbyB0aGF0IHNxdWFyZSBicmFja2V0IG5vdGF0aW9uIHdvcmtzIGFzIGV4cGVjdGVkIC0tIGl0IHJldHVybnNcbiAqIGEgc2luZ2xlIG9jdGV0LlxuICpcbiAqIEJ5IGF1Z21lbnRpbmcgdGhlIGluc3RhbmNlcywgd2UgY2FuIGF2b2lkIG1vZGlmeWluZyB0aGUgYFVpbnQ4QXJyYXlgXG4gKiBwcm90b3R5cGUuXG4gKi9cbmZ1bmN0aW9uIEJ1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcsIG5vWmVybykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSlcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKVxuXG4gIHZhciB0eXBlID0gdHlwZW9mIHN1YmplY3RcblxuICAvLyBXb3JrYXJvdW5kOiBub2RlJ3MgYmFzZTY0IGltcGxlbWVudGF0aW9uIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBzdHJpbmdzXG4gIC8vIHdoaWxlIGJhc2U2NC1qcyBkb2VzIG5vdC5cbiAgaWYgKGVuY29kaW5nID09PSAnYmFzZTY0JyAmJiB0eXBlID09PSAnc3RyaW5nJykge1xuICAgIHN1YmplY3QgPSBzdHJpbmd0cmltKHN1YmplY3QpXG4gICAgd2hpbGUgKHN1YmplY3QubGVuZ3RoICUgNCAhPT0gMCkge1xuICAgICAgc3ViamVjdCA9IHN1YmplY3QgKyAnPSdcbiAgICB9XG4gIH1cblxuICAvLyBGaW5kIHRoZSBsZW5ndGhcbiAgdmFyIGxlbmd0aFxuICBpZiAodHlwZSA9PT0gJ251bWJlcicpXG4gICAgbGVuZ3RoID0gY29lcmNlKHN1YmplY3QpXG4gIGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKVxuICAgIGxlbmd0aCA9IEJ1ZmZlci5ieXRlTGVuZ3RoKHN1YmplY3QsIGVuY29kaW5nKVxuICBlbHNlIGlmICh0eXBlID09PSAnb2JqZWN0JylcbiAgICBsZW5ndGggPSBjb2VyY2Uoc3ViamVjdC5sZW5ndGgpIC8vIEFzc3VtZSBvYmplY3QgaXMgYW4gYXJyYXlcbiAgZWxzZVxuICAgIHRocm93IG5ldyBFcnJvcignRmlyc3QgYXJndW1lbnQgbmVlZHMgdG8gYmUgYSBudW1iZXIsIGFycmF5IG9yIHN0cmluZy4nKVxuXG4gIHZhciBidWZcbiAgaWYgKEJ1ZmZlci5fdXNlVHlwZWRBcnJheXMpIHtcbiAgICAvLyBQcmVmZXJyZWQ6IFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgYnVmID0gYXVnbWVudChuZXcgVWludDhBcnJheShsZW5ndGgpKVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gVEhJUyBpbnN0YW5jZSBvZiBCdWZmZXIgKGNyZWF0ZWQgYnkgYG5ld2ApXG4gICAgYnVmID0gdGhpc1xuICAgIGJ1Zi5sZW5ndGggPSBsZW5ndGhcbiAgICBidWYuX2lzQnVmZmVyID0gdHJ1ZVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKEJ1ZmZlci5fdXNlVHlwZWRBcnJheXMgJiYgdHlwZW9mIFVpbnQ4QXJyYXkgPT09ICdmdW5jdGlvbicgJiZcbiAgICAgIHN1YmplY3QgaW5zdGFuY2VvZiBVaW50OEFycmF5KSB7XG4gICAgLy8gU3BlZWQgb3B0aW1pemF0aW9uIC0tIHVzZSBzZXQgaWYgd2UncmUgY29weWluZyBmcm9tIGEgVWludDhBcnJheVxuICAgIGJ1Zi5fc2V0KHN1YmplY3QpXG4gIH0gZWxzZSBpZiAoaXNBcnJheWlzaChzdWJqZWN0KSkge1xuICAgIC8vIFRyZWF0IGFycmF5LWlzaCBvYmplY3RzIGFzIGEgYnl0ZSBhcnJheVxuICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSlcbiAgICAgICAgYnVmW2ldID0gc3ViamVjdC5yZWFkVUludDgoaSlcbiAgICAgIGVsc2VcbiAgICAgICAgYnVmW2ldID0gc3ViamVjdFtpXVxuICAgIH1cbiAgfSBlbHNlIGlmICh0eXBlID09PSAnc3RyaW5nJykge1xuICAgIGJ1Zi53cml0ZShzdWJqZWN0LCAwLCBlbmNvZGluZylcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnbnVtYmVyJyAmJiAhQnVmZmVyLl91c2VUeXBlZEFycmF5cyAmJiAhbm9aZXJvKSB7XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBidWZbaV0gPSAwXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ1ZlxufVxuXG4vLyBTVEFUSUMgTUVUSE9EU1xuLy8gPT09PT09PT09PT09PT1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiAoZW5jb2RpbmcpIHtcbiAgc3dpdGNoIChTdHJpbmcoZW5jb2RpbmcpLnRvTG93ZXJDYXNlKCkpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldHVybiB0cnVlXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbkJ1ZmZlci5pc0J1ZmZlciA9IGZ1bmN0aW9uIChiKSB7XG4gIHJldHVybiAhIShiICE9PSBudWxsICYmIGIgIT09IHVuZGVmaW5lZCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmJ5dGVMZW5ndGggPSBmdW5jdGlvbiAoc3RyLCBlbmNvZGluZykge1xuICB2YXIgcmV0XG4gIHN0ciA9IHN0ciArICcnXG4gIHN3aXRjaCAoZW5jb2RpbmcgfHwgJ3V0ZjgnKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGggLyAyXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIHJldCA9IHV0ZjhUb0J5dGVzKHN0cikubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBiYXNlNjRUb0J5dGVzKHN0cikubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoICogMlxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nJylcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbkJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiAobGlzdCwgdG90YWxMZW5ndGgpIHtcbiAgYXNzZXJ0KGlzQXJyYXkobGlzdCksICdVc2FnZTogQnVmZmVyLmNvbmNhdChsaXN0LCBbdG90YWxMZW5ndGhdKVxcbicgK1xuICAgICAgJ2xpc3Qgc2hvdWxkIGJlIGFuIEFycmF5LicpXG5cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoMClcbiAgfSBlbHNlIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiBsaXN0WzBdXG4gIH1cblxuICB2YXIgaVxuICBpZiAodHlwZW9mIHRvdGFsTGVuZ3RoICE9PSAnbnVtYmVyJykge1xuICAgIHRvdGFsTGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICB0b3RhbExlbmd0aCArPSBsaXN0W2ldLmxlbmd0aFxuICAgIH1cbiAgfVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKHRvdGFsTGVuZ3RoKVxuICB2YXIgcG9zID0gMFxuICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBpdGVtID0gbGlzdFtpXVxuICAgIGl0ZW0uY29weShidWYsIHBvcylcbiAgICBwb3MgKz0gaXRlbS5sZW5ndGhcbiAgfVxuICByZXR1cm4gYnVmXG59XG5cbi8vIEJVRkZFUiBJTlNUQU5DRSBNRVRIT0RTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PVxuXG5mdW5jdGlvbiBfaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBhc3NlcnQoc3RyTGVuICUgMiA9PT0gMCwgJ0ludmFsaWQgaGV4IHN0cmluZycpXG5cbiAgaWYgKGxlbmd0aCA+IHN0ckxlbiAvIDIpIHtcbiAgICBsZW5ndGggPSBzdHJMZW4gLyAyXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHZhciBieXRlID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGFzc2VydCghaXNOYU4oYnl0ZSksICdJbnZhbGlkIGhleCBzdHJpbmcnKVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IGJ5dGVcbiAgfVxuICBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9IGkgKiAyXG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIF91dGY4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gQnVmZmVyLl9jaGFyc1dyaXR0ZW4gPVxuICAgIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBfYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9XG4gICAgYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBfYmluYXJ5V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gX2FzY2lpV3JpdGUoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBfYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gQnVmZmVyLl9jaGFyc1dyaXR0ZW4gPVxuICAgIGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIF91dGYxNmxlV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gQnVmZmVyLl9jaGFyc1dyaXR0ZW4gPVxuICAgIGJsaXRCdWZmZXIodXRmMTZsZVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIFN1cHBvcnQgYm90aCAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpXG4gIC8vIGFuZCB0aGUgbGVnYWN5IChzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBpZiAoIWlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoXG4gICAgICBsZW5ndGggPSB1bmRlZmluZWRcbiAgICB9XG4gIH0gZWxzZSB7ICAvLyBsZWdhY3lcbiAgICB2YXIgc3dhcCA9IGVuY29kaW5nXG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBvZmZzZXQgPSBsZW5ndGhcbiAgICBsZW5ndGggPSBzd2FwXG4gIH1cblxuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG4gIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nIHx8ICd1dGY4JykudG9Mb3dlckNhc2UoKVxuXG4gIHZhciByZXRcbiAgc3dpdGNoIChlbmNvZGluZykge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXQgPSBfaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gX3V0ZjhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgICByZXQgPSBfYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiaW5hcnknOlxuICAgICAgcmV0ID0gX2JpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBfYmFzZTY0V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IF91dGYxNmxlV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBlbmNvZGluZycpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBzZWxmID0gdGhpc1xuXG4gIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nIHx8ICd1dGY4JykudG9Mb3dlckNhc2UoKVxuICBzdGFydCA9IE51bWJlcihzdGFydCkgfHwgMFxuICBlbmQgPSAoZW5kICE9PSB1bmRlZmluZWQpXG4gICAgPyBOdW1iZXIoZW5kKVxuICAgIDogZW5kID0gc2VsZi5sZW5ndGhcblxuICAvLyBGYXN0cGF0aCBlbXB0eSBzdHJpbmdzXG4gIGlmIChlbmQgPT09IHN0YXJ0KVxuICAgIHJldHVybiAnJ1xuXG4gIHZhciByZXRcbiAgc3dpdGNoIChlbmNvZGluZykge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXQgPSBfaGV4U2xpY2Uoc2VsZiwgc3RhcnQsIGVuZClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gX3V0ZjhTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgICByZXQgPSBfYXNjaWlTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiaW5hcnknOlxuICAgICAgcmV0ID0gX2JpbmFyeVNsaWNlKHNlbGYsIHN0YXJ0LCBlbmQpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBfYmFzZTY0U2xpY2Uoc2VsZiwgc3RhcnQsIGVuZClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IF91dGYxNmxlU2xpY2Uoc2VsZiwgc3RhcnQsIGVuZClcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBlbmNvZGluZycpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiAodGFyZ2V0LCB0YXJnZXRfc3RhcnQsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHNvdXJjZSA9IHRoaXNcblxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAoIXRhcmdldF9zdGFydCkgdGFyZ2V0X3N0YXJ0ID0gMFxuXG4gIC8vIENvcHkgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHNvdXJjZS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgYXNzZXJ0KGVuZCA+PSBzdGFydCwgJ3NvdXJjZUVuZCA8IHNvdXJjZVN0YXJ0JylcbiAgYXNzZXJ0KHRhcmdldF9zdGFydCA+PSAwICYmIHRhcmdldF9zdGFydCA8IHRhcmdldC5sZW5ndGgsXG4gICAgICAndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGFzc2VydChzdGFydCA+PSAwICYmIHN0YXJ0IDwgc291cmNlLmxlbmd0aCwgJ3NvdXJjZVN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBhc3NlcnQoZW5kID49IDAgJiYgZW5kIDw9IHNvdXJjZS5sZW5ndGgsICdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKVxuICAgIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0IDwgZW5kIC0gc3RhcnQpXG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldF9zdGFydCArIHN0YXJ0XG5cbiAgLy8gY29weSFcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBlbmQgLSBzdGFydDsgaSsrKVxuICAgIHRhcmdldFtpICsgdGFyZ2V0X3N0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxufVxuXG5mdW5jdGlvbiBfYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIF91dGY4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmVzID0gJydcbiAgdmFyIHRtcCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIGlmIChidWZbaV0gPD0gMHg3Rikge1xuICAgICAgcmVzICs9IGRlY29kZVV0ZjhDaGFyKHRtcCkgKyBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgICAgIHRtcCA9ICcnXG4gICAgfSBlbHNlIHtcbiAgICAgIHRtcCArPSAnJScgKyBidWZbaV0udG9TdHJpbmcoMTYpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlcyArIGRlY29kZVV0ZjhDaGFyKHRtcClcbn1cblxuZnVuY3Rpb24gX2FzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKVxuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBfYmluYXJ5U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICByZXR1cm4gX2FzY2lpU2xpY2UoYnVmLCBzdGFydCwgZW5kKVxufVxuXG5mdW5jdGlvbiBfaGV4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuXG4gIGlmICghc3RhcnQgfHwgc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgfHwgZW5kIDwgMCB8fCBlbmQgPiBsZW4pIGVuZCA9IGxlblxuXG4gIHZhciBvdXQgPSAnJ1xuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIG91dCArPSB0b0hleChidWZbaV0pXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiBfdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpKzFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IGNsYW1wKHN0YXJ0LCBsZW4sIDApXG4gIGVuZCA9IGNsYW1wKGVuZCwgbGVuLCBsZW4pXG5cbiAgaWYgKEJ1ZmZlci5fdXNlVHlwZWRBcnJheXMpIHtcbiAgICByZXR1cm4gYXVnbWVudCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBlbmQpKVxuICB9IGVsc2Uge1xuICAgIHZhciBzbGljZUxlbiA9IGVuZCAtIHN0YXJ0XG4gICAgdmFyIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZCwgdHJ1ZSlcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgICByZXR1cm4gbmV3QnVmXG4gIH1cbn1cblxuLy8gYGdldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gKG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLmdldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMucmVhZFVJbnQ4KG9mZnNldClcbn1cblxuLy8gYHNldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gKHYsIG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLnNldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMud3JpdGVVSW50OCh2LCBvZmZzZXQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQ4ID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCA8IHRoaXMubGVuZ3RoLCAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICB9XG5cbiAgaWYgKG9mZnNldCA+PSB0aGlzLmxlbmd0aClcbiAgICByZXR1cm5cblxuICByZXR1cm4gdGhpc1tvZmZzZXRdXG59XG5cbmZ1bmN0aW9uIF9yZWFkVUludDE2IChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDEgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgdmFyIHZhbFxuICBpZiAobGl0dGxlRW5kaWFuKSB7XG4gICAgdmFsID0gYnVmW29mZnNldF1cbiAgICBpZiAob2Zmc2V0ICsgMSA8IGxlbilcbiAgICAgIHZhbCB8PSBidWZbb2Zmc2V0ICsgMV0gPDwgOFxuICB9IGVsc2Uge1xuICAgIHZhbCA9IGJ1ZltvZmZzZXRdIDw8IDhcbiAgICBpZiAob2Zmc2V0ICsgMSA8IGxlbilcbiAgICAgIHZhbCB8PSBidWZbb2Zmc2V0ICsgMV1cbiAgfVxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkVUludDE2KHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkVUludDE2KHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfcmVhZFVJbnQzMiAoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAzIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIHZhciB2YWxcbiAgaWYgKGxpdHRsZUVuZGlhbikge1xuICAgIGlmIChvZmZzZXQgKyAyIDwgbGVuKVxuICAgICAgdmFsID0gYnVmW29mZnNldCArIDJdIDw8IDE2XG4gICAgaWYgKG9mZnNldCArIDEgPCBsZW4pXG4gICAgICB2YWwgfD0gYnVmW29mZnNldCArIDFdIDw8IDhcbiAgICB2YWwgfD0gYnVmW29mZnNldF1cbiAgICBpZiAob2Zmc2V0ICsgMyA8IGxlbilcbiAgICAgIHZhbCA9IHZhbCArIChidWZbb2Zmc2V0ICsgM10gPDwgMjQgPj4+IDApXG4gIH0gZWxzZSB7XG4gICAgaWYgKG9mZnNldCArIDEgPCBsZW4pXG4gICAgICB2YWwgPSBidWZbb2Zmc2V0ICsgMV0gPDwgMTZcbiAgICBpZiAob2Zmc2V0ICsgMiA8IGxlbilcbiAgICAgIHZhbCB8PSBidWZbb2Zmc2V0ICsgMl0gPDwgOFxuICAgIGlmIChvZmZzZXQgKyAzIDwgbGVuKVxuICAgICAgdmFsIHw9IGJ1ZltvZmZzZXQgKyAzXVxuICAgIHZhbCA9IHZhbCArIChidWZbb2Zmc2V0XSA8PCAyNCA+Pj4gMClcbiAgfVxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkVUludDMyKHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkVUludDMyKHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQ4ID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCA8IHRoaXMubGVuZ3RoLCAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICB9XG5cbiAgaWYgKG9mZnNldCA+PSB0aGlzLmxlbmd0aClcbiAgICByZXR1cm5cblxuICB2YXIgbmVnID0gdGhpc1tvZmZzZXRdICYgMHg4MFxuICBpZiAobmVnKVxuICAgIHJldHVybiAoMHhmZiAtIHRoaXNbb2Zmc2V0XSArIDEpICogLTFcbiAgZWxzZVxuICAgIHJldHVybiB0aGlzW29mZnNldF1cbn1cblxuZnVuY3Rpb24gX3JlYWRJbnQxNiAoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAxIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIHZhciB2YWwgPSBfcmVhZFVJbnQxNihidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCB0cnVlKVxuICB2YXIgbmVnID0gdmFsICYgMHg4MDAwXG4gIGlmIChuZWcpXG4gICAgcmV0dXJuICgweGZmZmYgLSB2YWwgKyAxKSAqIC0xXG4gIGVsc2VcbiAgICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRJbnQxNih0aGlzLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkSW50MTYodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF9yZWFkSW50MzIgKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMyA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICB2YXIgdmFsID0gX3JlYWRVSW50MzIoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgdHJ1ZSlcbiAgdmFyIG5lZyA9IHZhbCAmIDB4ODAwMDAwMDBcbiAgaWYgKG5lZylcbiAgICByZXR1cm4gKDB4ZmZmZmZmZmYgLSB2YWwgKyAxKSAqIC0xXG4gIGVsc2VcbiAgICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRJbnQzMih0aGlzLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkSW50MzIodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF9yZWFkRmxvYXQgKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCArIDMgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICB9XG5cbiAgcmV0dXJuIGllZWU3NTQucmVhZChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZEZsb2F0KHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRGbG9hdCh0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3JlYWREb3VibGUgKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCArIDcgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICB9XG5cbiAgcmV0dXJuIGllZWU3NTQucmVhZChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWREb3VibGUodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWREb3VibGUodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50OCA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgPCB0aGlzLmxlbmd0aCwgJ3RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZ1aW50KHZhbHVlLCAweGZmKVxuICB9XG5cbiAgaWYgKG9mZnNldCA+PSB0aGlzLmxlbmd0aCkgcmV0dXJuXG5cbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbn1cblxuZnVuY3Rpb24gX3dyaXRlVUludDE2IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDEgPCBidWYubGVuZ3RoLCAndHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZnVpbnQodmFsdWUsIDB4ZmZmZilcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4obGVuIC0gb2Zmc2V0LCAyKTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9XG4gICAgICAgICh2YWx1ZSAmICgweGZmIDw8ICg4ICogKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkpKSkgPj4+XG4gICAgICAgICAgICAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSAqIDhcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3dyaXRlVUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDMgPCBidWYubGVuZ3RoLCAndHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZnVpbnQodmFsdWUsIDB4ZmZmZmZmZmYpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGxlbiAtIG9mZnNldCwgNCk7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPVxuICAgICAgICAodmFsdWUgPj4+IChsaXR0bGVFbmRpYW4gPyBpIDogMyAtIGkpICogOCkgJiAweGZmXG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQ4ID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCA8IHRoaXMubGVuZ3RoLCAnVHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZnNpbnQodmFsdWUsIDB4N2YsIC0weDgwKVxuICB9XG5cbiAgaWYgKG9mZnNldCA+PSB0aGlzLmxlbmd0aClcbiAgICByZXR1cm5cblxuICBpZiAodmFsdWUgPj0gMClcbiAgICB0aGlzLndyaXRlVUludDgodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpXG4gIGVsc2VcbiAgICB0aGlzLndyaXRlVUludDgoMHhmZiArIHZhbHVlICsgMSwgb2Zmc2V0LCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3dyaXRlSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMSA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmc2ludCh2YWx1ZSwgMHg3ZmZmLCAtMHg4MDAwKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgaWYgKHZhbHVlID49IDApXG4gICAgX3dyaXRlVUludDE2KGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydClcbiAgZWxzZVxuICAgIF93cml0ZVVJbnQxNihidWYsIDB4ZmZmZiArIHZhbHVlICsgMSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfd3JpdGVJbnQzMiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAzIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZzaW50KHZhbHVlLCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIGlmICh2YWx1ZSA+PSAwKVxuICAgIF93cml0ZVVJbnQzMihidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpXG4gIGVsc2VcbiAgICBfd3JpdGVVSW50MzIoYnVmLCAweGZmZmZmZmZmICsgdmFsdWUgKyAxLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF93cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDMgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZklFRUU3NTQodmFsdWUsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF93cml0ZURvdWJsZSAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyA3IDwgYnVmLmxlbmd0aCxcbiAgICAgICAgJ1RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZJRUVFNzU0KHZhbHVlLCAxLjc5NzY5MzEzNDg2MjMxNTdFKzMwOCwgLTEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4KVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG4vLyBmaWxsKHZhbHVlLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuZmlsbCA9IGZ1bmN0aW9uICh2YWx1ZSwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXZhbHVlKSB2YWx1ZSA9IDBcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kKSBlbmQgPSB0aGlzLmxlbmd0aFxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdmFsdWUgPSB2YWx1ZS5jaGFyQ29kZUF0KDApXG4gIH1cblxuICBhc3NlcnQodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyAmJiAhaXNOYU4odmFsdWUpLCAndmFsdWUgaXMgbm90IGEgbnVtYmVyJylcbiAgYXNzZXJ0KGVuZCA+PSBzdGFydCwgJ2VuZCA8IHN0YXJ0JylcblxuICAvLyBGaWxsIDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVyblxuICBpZiAodGhpcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIGFzc2VydChzdGFydCA+PSAwICYmIHN0YXJ0IDwgdGhpcy5sZW5ndGgsICdzdGFydCBvdXQgb2YgYm91bmRzJylcbiAgYXNzZXJ0KGVuZCA+PSAwICYmIGVuZCA8PSB0aGlzLmxlbmd0aCwgJ2VuZCBvdXQgb2YgYm91bmRzJylcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHRoaXNbaV0gPSB2YWx1ZVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5zcGVjdCA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIG91dCA9IFtdXG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgb3V0W2ldID0gdG9IZXgodGhpc1tpXSlcbiAgICBpZiAoaSA9PT0gZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUykge1xuICAgICAgb3V0W2kgKyAxXSA9ICcuLi4nXG4gICAgICBicmVha1xuICAgIH1cbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIG91dC5qb2luKCcgJykgKyAnPidcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGBBcnJheUJ1ZmZlcmAgd2l0aCB0aGUgKmNvcGllZCogbWVtb3J5IG9mIHRoZSBidWZmZXIgaW5zdGFuY2UuXG4gKiBBZGRlZCBpbiBOb2RlIDAuMTIuIE9ubHkgYXZhaWxhYmxlIGluIGJyb3dzZXJzIHRoYXQgc3VwcG9ydCBBcnJheUJ1ZmZlci5cbiAqL1xuQnVmZmVyLnByb3RvdHlwZS50b0FycmF5QnVmZmVyID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgPT09ICdmdW5jdGlvbicpIHtcbiAgICBpZiAoQnVmZmVyLl91c2VUeXBlZEFycmF5cykge1xuICAgICAgcmV0dXJuIChuZXcgQnVmZmVyKHRoaXMpKS5idWZmZXJcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGJ1ZiA9IG5ldyBVaW50OEFycmF5KHRoaXMubGVuZ3RoKVxuICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGJ1Zi5sZW5ndGg7IGkgPCBsZW47IGkgKz0gMSlcbiAgICAgICAgYnVmW2ldID0gdGhpc1tpXVxuICAgICAgcmV0dXJuIGJ1Zi5idWZmZXJcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdCdWZmZXIudG9BcnJheUJ1ZmZlciBub3Qgc3VwcG9ydGVkIGluIHRoaXMgYnJvd3NlcicpXG4gIH1cbn1cblxuLy8gSEVMUEVSIEZVTkNUSU9OU1xuLy8gPT09PT09PT09PT09PT09PVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG52YXIgQlAgPSBCdWZmZXIucHJvdG90eXBlXG5cbi8qKlxuICogQXVnbWVudCB0aGUgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIGNsYXNzISkgd2l0aCBCdWZmZXIgbWV0aG9kc1xuICovXG5mdW5jdGlvbiBhdWdtZW50IChhcnIpIHtcbiAgYXJyLl9pc0J1ZmZlciA9IHRydWVcblxuICAvLyBzYXZlIHJlZmVyZW5jZSB0byBvcmlnaW5hbCBVaW50OEFycmF5IGdldC9zZXQgbWV0aG9kcyBiZWZvcmUgb3ZlcndyaXRpbmdcbiAgYXJyLl9nZXQgPSBhcnIuZ2V0XG4gIGFyci5fc2V0ID0gYXJyLnNldFxuXG4gIC8vIGRlcHJlY2F0ZWQsIHdpbGwgYmUgcmVtb3ZlZCBpbiBub2RlIDAuMTMrXG4gIGFyci5nZXQgPSBCUC5nZXRcbiAgYXJyLnNldCA9IEJQLnNldFxuXG4gIGFyci53cml0ZSA9IEJQLndyaXRlXG4gIGFyci50b1N0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0xvY2FsZVN0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0pTT04gPSBCUC50b0pTT05cbiAgYXJyLmNvcHkgPSBCUC5jb3B5XG4gIGFyci5zbGljZSA9IEJQLnNsaWNlXG4gIGFyci5yZWFkVUludDggPSBCUC5yZWFkVUludDhcbiAgYXJyLnJlYWRVSW50MTZMRSA9IEJQLnJlYWRVSW50MTZMRVxuICBhcnIucmVhZFVJbnQxNkJFID0gQlAucmVhZFVJbnQxNkJFXG4gIGFyci5yZWFkVUludDMyTEUgPSBCUC5yZWFkVUludDMyTEVcbiAgYXJyLnJlYWRVSW50MzJCRSA9IEJQLnJlYWRVSW50MzJCRVxuICBhcnIucmVhZEludDggPSBCUC5yZWFkSW50OFxuICBhcnIucmVhZEludDE2TEUgPSBCUC5yZWFkSW50MTZMRVxuICBhcnIucmVhZEludDE2QkUgPSBCUC5yZWFkSW50MTZCRVxuICBhcnIucmVhZEludDMyTEUgPSBCUC5yZWFkSW50MzJMRVxuICBhcnIucmVhZEludDMyQkUgPSBCUC5yZWFkSW50MzJCRVxuICBhcnIucmVhZEZsb2F0TEUgPSBCUC5yZWFkRmxvYXRMRVxuICBhcnIucmVhZEZsb2F0QkUgPSBCUC5yZWFkRmxvYXRCRVxuICBhcnIucmVhZERvdWJsZUxFID0gQlAucmVhZERvdWJsZUxFXG4gIGFyci5yZWFkRG91YmxlQkUgPSBCUC5yZWFkRG91YmxlQkVcbiAgYXJyLndyaXRlVUludDggPSBCUC53cml0ZVVJbnQ4XG4gIGFyci53cml0ZVVJbnQxNkxFID0gQlAud3JpdGVVSW50MTZMRVxuICBhcnIud3JpdGVVSW50MTZCRSA9IEJQLndyaXRlVUludDE2QkVcbiAgYXJyLndyaXRlVUludDMyTEUgPSBCUC53cml0ZVVJbnQzMkxFXG4gIGFyci53cml0ZVVJbnQzMkJFID0gQlAud3JpdGVVSW50MzJCRVxuICBhcnIud3JpdGVJbnQ4ID0gQlAud3JpdGVJbnQ4XG4gIGFyci53cml0ZUludDE2TEUgPSBCUC53cml0ZUludDE2TEVcbiAgYXJyLndyaXRlSW50MTZCRSA9IEJQLndyaXRlSW50MTZCRVxuICBhcnIud3JpdGVJbnQzMkxFID0gQlAud3JpdGVJbnQzMkxFXG4gIGFyci53cml0ZUludDMyQkUgPSBCUC53cml0ZUludDMyQkVcbiAgYXJyLndyaXRlRmxvYXRMRSA9IEJQLndyaXRlRmxvYXRMRVxuICBhcnIud3JpdGVGbG9hdEJFID0gQlAud3JpdGVGbG9hdEJFXG4gIGFyci53cml0ZURvdWJsZUxFID0gQlAud3JpdGVEb3VibGVMRVxuICBhcnIud3JpdGVEb3VibGVCRSA9IEJQLndyaXRlRG91YmxlQkVcbiAgYXJyLmZpbGwgPSBCUC5maWxsXG4gIGFyci5pbnNwZWN0ID0gQlAuaW5zcGVjdFxuICBhcnIudG9BcnJheUJ1ZmZlciA9IEJQLnRvQXJyYXlCdWZmZXJcblxuICByZXR1cm4gYXJyXG59XG5cbi8vIHNsaWNlKHN0YXJ0LCBlbmQpXG5mdW5jdGlvbiBjbGFtcCAoaW5kZXgsIGxlbiwgZGVmYXVsdFZhbHVlKSB7XG4gIGlmICh0eXBlb2YgaW5kZXggIT09ICdudW1iZXInKSByZXR1cm4gZGVmYXVsdFZhbHVlXG4gIGluZGV4ID0gfn5pbmRleDsgIC8vIENvZXJjZSB0byBpbnRlZ2VyLlxuICBpZiAoaW5kZXggPj0gbGVuKSByZXR1cm4gbGVuXG4gIGlmIChpbmRleCA+PSAwKSByZXR1cm4gaW5kZXhcbiAgaW5kZXggKz0gbGVuXG4gIGlmIChpbmRleCA+PSAwKSByZXR1cm4gaW5kZXhcbiAgcmV0dXJuIDBcbn1cblxuZnVuY3Rpb24gY29lcmNlIChsZW5ndGgpIHtcbiAgLy8gQ29lcmNlIGxlbmd0aCB0byBhIG51bWJlciAocG9zc2libHkgTmFOKSwgcm91bmQgdXBcbiAgLy8gaW4gY2FzZSBpdCdzIGZyYWN0aW9uYWwgKGUuZy4gMTIzLjQ1NikgdGhlbiBkbyBhXG4gIC8vIGRvdWJsZSBuZWdhdGUgdG8gY29lcmNlIGEgTmFOIHRvIDAuIEVhc3ksIHJpZ2h0P1xuICBsZW5ndGggPSB+fk1hdGguY2VpbCgrbGVuZ3RoKVxuICByZXR1cm4gbGVuZ3RoIDwgMCA/IDAgOiBsZW5ndGhcbn1cblxuZnVuY3Rpb24gaXNBcnJheSAoc3ViamVjdCkge1xuICByZXR1cm4gKEFycmF5LmlzQXJyYXkgfHwgZnVuY3Rpb24gKHN1YmplY3QpIHtcbiAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHN1YmplY3QpID09PSAnW29iamVjdCBBcnJheV0nXG4gIH0pKHN1YmplY3QpXG59XG5cbmZ1bmN0aW9uIGlzQXJyYXlpc2ggKHN1YmplY3QpIHtcbiAgcmV0dXJuIGlzQXJyYXkoc3ViamVjdCkgfHwgQnVmZmVyLmlzQnVmZmVyKHN1YmplY3QpIHx8XG4gICAgICBzdWJqZWN0ICYmIHR5cGVvZiBzdWJqZWN0ID09PSAnb2JqZWN0JyAmJlxuICAgICAgdHlwZW9mIHN1YmplY3QubGVuZ3RoID09PSAnbnVtYmVyJ1xufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGIgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGlmIChiIDw9IDB4N0YpXG4gICAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSlcbiAgICBlbHNlIHtcbiAgICAgIHZhciBzdGFydCA9IGlcbiAgICAgIGlmIChiID49IDB4RDgwMCAmJiBiIDw9IDB4REZGRikgaSsrXG4gICAgICB2YXIgaCA9IGVuY29kZVVSSUNvbXBvbmVudChzdHIuc2xpY2Uoc3RhcnQsIGkrMSkpLnN1YnN0cigxKS5zcGxpdCgnJScpXG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGgubGVuZ3RoOyBqKyspXG4gICAgICAgIGJ5dGVBcnJheS5wdXNoKHBhcnNlSW50KGhbal0sIDE2KSlcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSAmIDB4RkYpXG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiB1dGYxNmxlVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyAoc3RyKSB7XG4gIHJldHVybiBiYXNlNjQudG9CeXRlQXJyYXkoc3RyKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIHBvc1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKVxuICAgICAgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiBkZWNvZGVVdGY4Q2hhciAoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzdHIpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4RkZGRCkgLy8gVVRGIDggaW52YWxpZCBjaGFyXG4gIH1cbn1cblxuLypcbiAqIFdlIGhhdmUgdG8gbWFrZSBzdXJlIHRoYXQgdGhlIHZhbHVlIGlzIGEgdmFsaWQgaW50ZWdlci4gVGhpcyBtZWFucyB0aGF0IGl0XG4gKiBpcyBub24tbmVnYXRpdmUuIEl0IGhhcyBubyBmcmFjdGlvbmFsIGNvbXBvbmVudCBhbmQgdGhhdCBpdCBkb2VzIG5vdFxuICogZXhjZWVkIHRoZSBtYXhpbXVtIGFsbG93ZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHZlcmlmdWludCAodmFsdWUsIG1heCkge1xuICBhc3NlcnQodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJywgJ2Nhbm5vdCB3cml0ZSBhIG5vbi1udW1iZXIgYXMgYSBudW1iZXInKVxuICBhc3NlcnQodmFsdWUgPj0gMCxcbiAgICAgICdzcGVjaWZpZWQgYSBuZWdhdGl2ZSB2YWx1ZSBmb3Igd3JpdGluZyBhbiB1bnNpZ25lZCB2YWx1ZScpXG4gIGFzc2VydCh2YWx1ZSA8PSBtYXgsICd2YWx1ZSBpcyBsYXJnZXIgdGhhbiBtYXhpbXVtIHZhbHVlIGZvciB0eXBlJylcbiAgYXNzZXJ0KE1hdGguZmxvb3IodmFsdWUpID09PSB2YWx1ZSwgJ3ZhbHVlIGhhcyBhIGZyYWN0aW9uYWwgY29tcG9uZW50Jylcbn1cblxuZnVuY3Rpb24gdmVyaWZzaW50ICh2YWx1ZSwgbWF4LCBtaW4pIHtcbiAgYXNzZXJ0KHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicsICdjYW5ub3Qgd3JpdGUgYSBub24tbnVtYmVyIGFzIGEgbnVtYmVyJylcbiAgYXNzZXJ0KHZhbHVlIDw9IG1heCwgJ3ZhbHVlIGxhcmdlciB0aGFuIG1heGltdW0gYWxsb3dlZCB2YWx1ZScpXG4gIGFzc2VydCh2YWx1ZSA+PSBtaW4sICd2YWx1ZSBzbWFsbGVyIHRoYW4gbWluaW11bSBhbGxvd2VkIHZhbHVlJylcbiAgYXNzZXJ0KE1hdGguZmxvb3IodmFsdWUpID09PSB2YWx1ZSwgJ3ZhbHVlIGhhcyBhIGZyYWN0aW9uYWwgY29tcG9uZW50Jylcbn1cblxuZnVuY3Rpb24gdmVyaWZJRUVFNzU0ICh2YWx1ZSwgbWF4LCBtaW4pIHtcbiAgYXNzZXJ0KHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicsICdjYW5ub3Qgd3JpdGUgYSBub24tbnVtYmVyIGFzIGEgbnVtYmVyJylcbiAgYXNzZXJ0KHZhbHVlIDw9IG1heCwgJ3ZhbHVlIGxhcmdlciB0aGFuIG1heGltdW0gYWxsb3dlZCB2YWx1ZScpXG4gIGFzc2VydCh2YWx1ZSA+PSBtaW4sICd2YWx1ZSBzbWFsbGVyIHRoYW4gbWluaW11bSBhbGxvd2VkIHZhbHVlJylcbn1cblxuZnVuY3Rpb24gYXNzZXJ0ICh0ZXN0LCBtZXNzYWdlKSB7XG4gIGlmICghdGVzdCkgdGhyb3cgbmV3IEVycm9yKG1lc3NhZ2UgfHwgJ0ZhaWxlZCBhc3NlcnRpb24nKVxufVxuIiwidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBaRVJPICAgPSAnMCcuY2hhckNvZGVBdCgwKVxuXHR2YXIgUExVUyAgID0gJysnLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIICA9ICcvJy5jaGFyQ29kZUF0KDApXG5cdHZhciBOVU1CRVIgPSAnMCcuY2hhckNvZGVBdCgwKVxuXHR2YXIgTE9XRVIgID0gJ2EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFVQUEVSICA9ICdBJy5jaGFyQ29kZUF0KDApXG5cblx0ZnVuY3Rpb24gZGVjb2RlIChlbHQpIHtcblx0XHR2YXIgY29kZSA9IGVsdC5jaGFyQ29kZUF0KDApXG5cdFx0aWYgKGNvZGUgPT09IFBMVVMpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdG1vZHVsZS5leHBvcnRzLnRvQnl0ZUFycmF5ID0gYjY0VG9CeXRlQXJyYXlcblx0bW9kdWxlLmV4cG9ydHMuZnJvbUJ5dGVBcnJheSA9IHVpbnQ4VG9CYXNlNjRcbn0oKSlcbiIsImV4cG9ydHMucmVhZCA9IGZ1bmN0aW9uKGJ1ZmZlciwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sXG4gICAgICBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxLFxuICAgICAgZU1heCA9ICgxIDw8IGVMZW4pIC0gMSxcbiAgICAgIGVCaWFzID0gZU1heCA+PiAxLFxuICAgICAgbkJpdHMgPSAtNyxcbiAgICAgIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMCxcbiAgICAgIGQgPSBpc0xFID8gLTEgOiAxLFxuICAgICAgcyA9IGJ1ZmZlcltvZmZzZXQgKyBpXTtcblxuICBpICs9IGQ7XG5cbiAgZSA9IHMgJiAoKDEgPDwgKC1uQml0cykpIC0gMSk7XG4gIHMgPj49ICgtbkJpdHMpO1xuICBuQml0cyArPSBlTGVuO1xuICBmb3IgKDsgbkJpdHMgPiAwOyBlID0gZSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KTtcblxuICBtID0gZSAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKTtcbiAgZSA+Pj0gKC1uQml0cyk7XG4gIG5CaXRzICs9IG1MZW47XG4gIGZvciAoOyBuQml0cyA+IDA7IG0gPSBtICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpO1xuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhcztcbiAgfSBlbHNlIGlmIChlID09PSBlTWF4KSB7XG4gICAgcmV0dXJuIG0gPyBOYU4gOiAoKHMgPyAtMSA6IDEpICogSW5maW5pdHkpO1xuICB9IGVsc2Uge1xuICAgIG0gPSBtICsgTWF0aC5wb3coMiwgbUxlbik7XG4gICAgZSA9IGUgLSBlQmlhcztcbiAgfVxuICByZXR1cm4gKHMgPyAtMSA6IDEpICogbSAqIE1hdGgucG93KDIsIGUgLSBtTGVuKTtcbn07XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbihidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSwgYyxcbiAgICAgIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDEsXG4gICAgICBlTWF4ID0gKDEgPDwgZUxlbikgLSAxLFxuICAgICAgZUJpYXMgPSBlTWF4ID4+IDEsXG4gICAgICBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMCksXG4gICAgICBpID0gaXNMRSA/IDAgOiAobkJ5dGVzIC0gMSksXG4gICAgICBkID0gaXNMRSA/IDEgOiAtMSxcbiAgICAgIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDA7XG5cbiAgdmFsdWUgPSBNYXRoLmFicyh2YWx1ZSk7XG5cbiAgaWYgKGlzTmFOKHZhbHVlKSB8fCB2YWx1ZSA9PT0gSW5maW5pdHkpIHtcbiAgICBtID0gaXNOYU4odmFsdWUpID8gMSA6IDA7XG4gICAgZSA9IGVNYXg7XG4gIH0gZWxzZSB7XG4gICAgZSA9IE1hdGguZmxvb3IoTWF0aC5sb2codmFsdWUpIC8gTWF0aC5MTjIpO1xuICAgIGlmICh2YWx1ZSAqIChjID0gTWF0aC5wb3coMiwgLWUpKSA8IDEpIHtcbiAgICAgIGUtLTtcbiAgICAgIGMgKj0gMjtcbiAgICB9XG4gICAgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICB2YWx1ZSArPSBydCAvIGM7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbHVlICs9IHJ0ICogTWF0aC5wb3coMiwgMSAtIGVCaWFzKTtcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKys7XG4gICAgICBjIC89IDI7XG4gICAgfVxuXG4gICAgaWYgKGUgKyBlQmlhcyA+PSBlTWF4KSB7XG4gICAgICBtID0gMDtcbiAgICAgIGUgPSBlTWF4O1xuICAgIH0gZWxzZSBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIG0gPSAodmFsdWUgKiBjIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICAgIGUgPSBlICsgZUJpYXM7XG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICAgIGUgPSAwO1xuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBtTGVuID49IDg7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IG0gJiAweGZmLCBpICs9IGQsIG0gLz0gMjU2LCBtTGVuIC09IDgpO1xuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG07XG4gIGVMZW4gKz0gbUxlbjtcbiAgZm9yICg7IGVMZW4gPiAwOyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBlICYgMHhmZiwgaSArPSBkLCBlIC89IDI1NiwgZUxlbiAtPSA4KTtcblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjg7XG59O1xuIiwiKGZ1bmN0aW9uIChnbG9iYWwpe1xuLypnbG9iYWwgd2luZG93LCBnbG9iYWwqL1xudmFyIHV0aWwgPSByZXF1aXJlKFwidXRpbFwiKVxudmFyIGFzc2VydCA9IHJlcXVpcmUoXCJhc3NlcnRcIilcblxudmFyIHNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlXG52YXIgY29uc29sZVxudmFyIHRpbWVzID0ge31cblxuaWYgKHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgJiYgZ2xvYmFsLmNvbnNvbGUpIHtcbiAgICBjb25zb2xlID0gZ2xvYmFsLmNvbnNvbGVcbn0gZWxzZSBpZiAodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiAmJiB3aW5kb3cuY29uc29sZSkge1xuICAgIGNvbnNvbGUgPSB3aW5kb3cuY29uc29sZVxufSBlbHNlIHtcbiAgICBjb25zb2xlID0ge31cbn1cblxudmFyIGZ1bmN0aW9ucyA9IFtcbiAgICBbbG9nLCBcImxvZ1wiXVxuICAgICwgW2luZm8sIFwiaW5mb1wiXVxuICAgICwgW3dhcm4sIFwid2FyblwiXVxuICAgICwgW2Vycm9yLCBcImVycm9yXCJdXG4gICAgLCBbdGltZSwgXCJ0aW1lXCJdXG4gICAgLCBbdGltZUVuZCwgXCJ0aW1lRW5kXCJdXG4gICAgLCBbdHJhY2UsIFwidHJhY2VcIl1cbiAgICAsIFtkaXIsIFwiZGlyXCJdXG4gICAgLCBbYXNzZXJ0LCBcImFzc2VydFwiXVxuXVxuXG5mb3IgKHZhciBpID0gMDsgaSA8IGZ1bmN0aW9ucy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB0dXBsZSA9IGZ1bmN0aW9uc1tpXVxuICAgIHZhciBmID0gdHVwbGVbMF1cbiAgICB2YXIgbmFtZSA9IHR1cGxlWzFdXG5cbiAgICBpZiAoIWNvbnNvbGVbbmFtZV0pIHtcbiAgICAgICAgY29uc29sZVtuYW1lXSA9IGZcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gY29uc29sZVxuXG5mdW5jdGlvbiBsb2coKSB7fVxuXG5mdW5jdGlvbiBpbmZvKCkge1xuICAgIGNvbnNvbGUubG9nLmFwcGx5KGNvbnNvbGUsIGFyZ3VtZW50cylcbn1cblxuZnVuY3Rpb24gd2FybigpIHtcbiAgICBjb25zb2xlLmxvZy5hcHBseShjb25zb2xlLCBhcmd1bWVudHMpXG59XG5cbmZ1bmN0aW9uIGVycm9yKCkge1xuICAgIGNvbnNvbGUud2Fybi5hcHBseShjb25zb2xlLCBhcmd1bWVudHMpXG59XG5cbmZ1bmN0aW9uIHRpbWUobGFiZWwpIHtcbiAgICB0aW1lc1tsYWJlbF0gPSBEYXRlLm5vdygpXG59XG5cbmZ1bmN0aW9uIHRpbWVFbmQobGFiZWwpIHtcbiAgICB2YXIgdGltZSA9IHRpbWVzW2xhYmVsXVxuICAgIGlmICghdGltZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBzdWNoIGxhYmVsOiBcIiArIGxhYmVsKVxuICAgIH1cblxuICAgIHZhciBkdXJhdGlvbiA9IERhdGUubm93KCkgLSB0aW1lXG4gICAgY29uc29sZS5sb2cobGFiZWwgKyBcIjogXCIgKyBkdXJhdGlvbiArIFwibXNcIilcbn1cblxuZnVuY3Rpb24gdHJhY2UoKSB7XG4gICAgdmFyIGVyciA9IG5ldyBFcnJvcigpXG4gICAgZXJyLm5hbWUgPSBcIlRyYWNlXCJcbiAgICBlcnIubWVzc2FnZSA9IHV0aWwuZm9ybWF0LmFwcGx5KG51bGwsIGFyZ3VtZW50cylcbiAgICBjb25zb2xlLmVycm9yKGVyci5zdGFjaylcbn1cblxuZnVuY3Rpb24gZGlyKG9iamVjdCkge1xuICAgIGNvbnNvbGUubG9nKHV0aWwuaW5zcGVjdChvYmplY3QpICsgXCJcXG5cIilcbn1cblxuZnVuY3Rpb24gYXNzZXJ0KGV4cHJlc3Npb24pIHtcbiAgICBpZiAoIWV4cHJlc3Npb24pIHtcbiAgICAgICAgdmFyIGFyciA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKVxuICAgICAgICBhc3NlcnQub2soZmFsc2UsIHV0aWwuZm9ybWF0LmFwcGx5KG51bGwsIGFycikpXG4gICAgfVxufVxuXG59KS5jYWxsKHRoaXMsdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9KSIsInZhciBCdWZmZXIgPSByZXF1aXJlKCdidWZmZXInKS5CdWZmZXI7XG52YXIgaW50U2l6ZSA9IDQ7XG52YXIgemVyb0J1ZmZlciA9IG5ldyBCdWZmZXIoaW50U2l6ZSk7IHplcm9CdWZmZXIuZmlsbCgwKTtcbnZhciBjaHJzeiA9IDg7XG5cbmZ1bmN0aW9uIHRvQXJyYXkoYnVmLCBiaWdFbmRpYW4pIHtcbiAgaWYgKChidWYubGVuZ3RoICUgaW50U2l6ZSkgIT09IDApIHtcbiAgICB2YXIgbGVuID0gYnVmLmxlbmd0aCArIChpbnRTaXplIC0gKGJ1Zi5sZW5ndGggJSBpbnRTaXplKSk7XG4gICAgYnVmID0gQnVmZmVyLmNvbmNhdChbYnVmLCB6ZXJvQnVmZmVyXSwgbGVuKTtcbiAgfVxuXG4gIHZhciBhcnIgPSBbXTtcbiAgdmFyIGZuID0gYmlnRW5kaWFuID8gYnVmLnJlYWRJbnQzMkJFIDogYnVmLnJlYWRJbnQzMkxFO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ1Zi5sZW5ndGg7IGkgKz0gaW50U2l6ZSkge1xuICAgIGFyci5wdXNoKGZuLmNhbGwoYnVmLCBpKSk7XG4gIH1cbiAgcmV0dXJuIGFycjtcbn1cblxuZnVuY3Rpb24gdG9CdWZmZXIoYXJyLCBzaXplLCBiaWdFbmRpYW4pIHtcbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIoc2l6ZSk7XG4gIHZhciBmbiA9IGJpZ0VuZGlhbiA/IGJ1Zi53cml0ZUludDMyQkUgOiBidWYud3JpdGVJbnQzMkxFO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7IGkrKykge1xuICAgIGZuLmNhbGwoYnVmLCBhcnJbaV0sIGkgKiA0LCB0cnVlKTtcbiAgfVxuICByZXR1cm4gYnVmO1xufVxuXG5mdW5jdGlvbiBoYXNoKGJ1ZiwgZm4sIGhhc2hTaXplLCBiaWdFbmRpYW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgYnVmID0gbmV3IEJ1ZmZlcihidWYpO1xuICB2YXIgYXJyID0gZm4odG9BcnJheShidWYsIGJpZ0VuZGlhbiksIGJ1Zi5sZW5ndGggKiBjaHJzeik7XG4gIHJldHVybiB0b0J1ZmZlcihhcnIsIGhhc2hTaXplLCBiaWdFbmRpYW4pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgaGFzaDogaGFzaCB9O1xuIiwidmFyIEJ1ZmZlciA9IHJlcXVpcmUoJ2J1ZmZlcicpLkJ1ZmZlclxudmFyIHNoYSA9IHJlcXVpcmUoJy4vc2hhJylcbnZhciBzaGEyNTYgPSByZXF1aXJlKCcuL3NoYTI1NicpXG52YXIgcm5nID0gcmVxdWlyZSgnLi9ybmcnKVxudmFyIG1kNSA9IHJlcXVpcmUoJy4vbWQ1JylcblxudmFyIGFsZ29yaXRobXMgPSB7XG4gIHNoYTE6IHNoYSxcbiAgc2hhMjU2OiBzaGEyNTYsXG4gIG1kNTogbWQ1XG59XG5cbnZhciBibG9ja3NpemUgPSA2NFxudmFyIHplcm9CdWZmZXIgPSBuZXcgQnVmZmVyKGJsb2Nrc2l6ZSk7IHplcm9CdWZmZXIuZmlsbCgwKVxuZnVuY3Rpb24gaG1hYyhmbiwga2V5LCBkYXRhKSB7XG4gIGlmKCFCdWZmZXIuaXNCdWZmZXIoa2V5KSkga2V5ID0gbmV3IEJ1ZmZlcihrZXkpXG4gIGlmKCFCdWZmZXIuaXNCdWZmZXIoZGF0YSkpIGRhdGEgPSBuZXcgQnVmZmVyKGRhdGEpXG5cbiAgaWYoa2V5Lmxlbmd0aCA+IGJsb2Nrc2l6ZSkge1xuICAgIGtleSA9IGZuKGtleSlcbiAgfSBlbHNlIGlmKGtleS5sZW5ndGggPCBibG9ja3NpemUpIHtcbiAgICBrZXkgPSBCdWZmZXIuY29uY2F0KFtrZXksIHplcm9CdWZmZXJdLCBibG9ja3NpemUpXG4gIH1cblxuICB2YXIgaXBhZCA9IG5ldyBCdWZmZXIoYmxvY2tzaXplKSwgb3BhZCA9IG5ldyBCdWZmZXIoYmxvY2tzaXplKVxuICBmb3IodmFyIGkgPSAwOyBpIDwgYmxvY2tzaXplOyBpKyspIHtcbiAgICBpcGFkW2ldID0ga2V5W2ldIF4gMHgzNlxuICAgIG9wYWRbaV0gPSBrZXlbaV0gXiAweDVDXG4gIH1cblxuICB2YXIgaGFzaCA9IGZuKEJ1ZmZlci5jb25jYXQoW2lwYWQsIGRhdGFdKSlcbiAgcmV0dXJuIGZuKEJ1ZmZlci5jb25jYXQoW29wYWQsIGhhc2hdKSlcbn1cblxuZnVuY3Rpb24gaGFzaChhbGcsIGtleSkge1xuICBhbGcgPSBhbGcgfHwgJ3NoYTEnXG4gIHZhciBmbiA9IGFsZ29yaXRobXNbYWxnXVxuICB2YXIgYnVmcyA9IFtdXG4gIHZhciBsZW5ndGggPSAwXG4gIGlmKCFmbikgZXJyb3IoJ2FsZ29yaXRobTonLCBhbGcsICdpcyBub3QgeWV0IHN1cHBvcnRlZCcpXG4gIHJldHVybiB7XG4gICAgdXBkYXRlOiBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgaWYoIUJ1ZmZlci5pc0J1ZmZlcihkYXRhKSkgZGF0YSA9IG5ldyBCdWZmZXIoZGF0YSlcbiAgICAgICAgXG4gICAgICBidWZzLnB1c2goZGF0YSlcbiAgICAgIGxlbmd0aCArPSBkYXRhLmxlbmd0aFxuICAgICAgcmV0dXJuIHRoaXNcbiAgICB9LFxuICAgIGRpZ2VzdDogZnVuY3Rpb24gKGVuYykge1xuICAgICAgdmFyIGJ1ZiA9IEJ1ZmZlci5jb25jYXQoYnVmcylcbiAgICAgIHZhciByID0ga2V5ID8gaG1hYyhmbiwga2V5LCBidWYpIDogZm4oYnVmKVxuICAgICAgYnVmcyA9IG51bGxcbiAgICAgIHJldHVybiBlbmMgPyByLnRvU3RyaW5nKGVuYykgOiByXG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGVycm9yICgpIHtcbiAgdmFyIG0gPSBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cykuam9pbignICcpXG4gIHRocm93IG5ldyBFcnJvcihbXG4gICAgbSxcbiAgICAnd2UgYWNjZXB0IHB1bGwgcmVxdWVzdHMnLFxuICAgICdodHRwOi8vZ2l0aHViLmNvbS9kb21pbmljdGFyci9jcnlwdG8tYnJvd3NlcmlmeSdcbiAgICBdLmpvaW4oJ1xcbicpKVxufVxuXG5leHBvcnRzLmNyZWF0ZUhhc2ggPSBmdW5jdGlvbiAoYWxnKSB7IHJldHVybiBoYXNoKGFsZykgfVxuZXhwb3J0cy5jcmVhdGVIbWFjID0gZnVuY3Rpb24gKGFsZywga2V5KSB7IHJldHVybiBoYXNoKGFsZywga2V5KSB9XG5leHBvcnRzLnJhbmRvbUJ5dGVzID0gZnVuY3Rpb24oc2l6ZSwgY2FsbGJhY2spIHtcbiAgaWYgKGNhbGxiYWNrICYmIGNhbGxiYWNrLmNhbGwpIHtcbiAgICB0cnkge1xuICAgICAgY2FsbGJhY2suY2FsbCh0aGlzLCB1bmRlZmluZWQsIG5ldyBCdWZmZXIocm5nKHNpemUpKSlcbiAgICB9IGNhdGNoIChlcnIpIHsgY2FsbGJhY2soZXJyKSB9XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIG5ldyBCdWZmZXIocm5nKHNpemUpKVxuICB9XG59XG5cbmZ1bmN0aW9uIGVhY2goYSwgZikge1xuICBmb3IodmFyIGkgaW4gYSlcbiAgICBmKGFbaV0sIGkpXG59XG5cbi8vIHRoZSBsZWFzdCBJIGNhbiBkbyBpcyBtYWtlIGVycm9yIG1lc3NhZ2VzIGZvciB0aGUgcmVzdCBvZiB0aGUgbm9kZS5qcy9jcnlwdG8gYXBpLlxuZWFjaChbJ2NyZWF0ZUNyZWRlbnRpYWxzJ1xuLCAnY3JlYXRlQ2lwaGVyJ1xuLCAnY3JlYXRlQ2lwaGVyaXYnXG4sICdjcmVhdGVEZWNpcGhlcidcbiwgJ2NyZWF0ZURlY2lwaGVyaXYnXG4sICdjcmVhdGVTaWduJ1xuLCAnY3JlYXRlVmVyaWZ5J1xuLCAnY3JlYXRlRGlmZmllSGVsbG1hbidcbiwgJ3Bia2RmMiddLCBmdW5jdGlvbiAobmFtZSkge1xuICBleHBvcnRzW25hbWVdID0gZnVuY3Rpb24gKCkge1xuICAgIGVycm9yKCdzb3JyeSwnLCBuYW1lLCAnaXMgbm90IGltcGxlbWVudGVkIHlldCcpXG4gIH1cbn0pXG4iLCIvKlxyXG4gKiBBIEphdmFTY3JpcHQgaW1wbGVtZW50YXRpb24gb2YgdGhlIFJTQSBEYXRhIFNlY3VyaXR5LCBJbmMuIE1ENSBNZXNzYWdlXHJcbiAqIERpZ2VzdCBBbGdvcml0aG0sIGFzIGRlZmluZWQgaW4gUkZDIDEzMjEuXHJcbiAqIFZlcnNpb24gMi4xIENvcHlyaWdodCAoQykgUGF1bCBKb2huc3RvbiAxOTk5IC0gMjAwMi5cclxuICogT3RoZXIgY29udHJpYnV0b3JzOiBHcmVnIEhvbHQsIEFuZHJldyBLZXBlcnQsIFlkbmFyLCBMb3N0aW5ldFxyXG4gKiBEaXN0cmlidXRlZCB1bmRlciB0aGUgQlNEIExpY2Vuc2VcclxuICogU2VlIGh0dHA6Ly9wYWpob21lLm9yZy51ay9jcnlwdC9tZDUgZm9yIG1vcmUgaW5mby5cclxuICovXHJcblxyXG52YXIgaGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpO1xyXG5cclxuLypcclxuICogUGVyZm9ybSBhIHNpbXBsZSBzZWxmLXRlc3QgdG8gc2VlIGlmIHRoZSBWTSBpcyB3b3JraW5nXHJcbiAqL1xyXG5mdW5jdGlvbiBtZDVfdm1fdGVzdCgpXHJcbntcclxuICByZXR1cm4gaGV4X21kNShcImFiY1wiKSA9PSBcIjkwMDE1MDk4M2NkMjRmYjBkNjk2M2Y3ZDI4ZTE3ZjcyXCI7XHJcbn1cclxuXHJcbi8qXHJcbiAqIENhbGN1bGF0ZSB0aGUgTUQ1IG9mIGFuIGFycmF5IG9mIGxpdHRsZS1lbmRpYW4gd29yZHMsIGFuZCBhIGJpdCBsZW5ndGhcclxuICovXHJcbmZ1bmN0aW9uIGNvcmVfbWQ1KHgsIGxlbilcclxue1xyXG4gIC8qIGFwcGVuZCBwYWRkaW5nICovXHJcbiAgeFtsZW4gPj4gNV0gfD0gMHg4MCA8PCAoKGxlbikgJSAzMik7XHJcbiAgeFsoKChsZW4gKyA2NCkgPj4+IDkpIDw8IDQpICsgMTRdID0gbGVuO1xyXG5cclxuICB2YXIgYSA9ICAxNzMyNTg0MTkzO1xyXG4gIHZhciBiID0gLTI3MTczMzg3OTtcclxuICB2YXIgYyA9IC0xNzMyNTg0MTk0O1xyXG4gIHZhciBkID0gIDI3MTczMzg3ODtcclxuXHJcbiAgZm9yKHZhciBpID0gMDsgaSA8IHgubGVuZ3RoOyBpICs9IDE2KVxyXG4gIHtcclxuICAgIHZhciBvbGRhID0gYTtcclxuICAgIHZhciBvbGRiID0gYjtcclxuICAgIHZhciBvbGRjID0gYztcclxuICAgIHZhciBvbGRkID0gZDtcclxuXHJcbiAgICBhID0gbWQ1X2ZmKGEsIGIsIGMsIGQsIHhbaSsgMF0sIDcgLCAtNjgwODc2OTM2KTtcclxuICAgIGQgPSBtZDVfZmYoZCwgYSwgYiwgYywgeFtpKyAxXSwgMTIsIC0zODk1NjQ1ODYpO1xyXG4gICAgYyA9IG1kNV9mZihjLCBkLCBhLCBiLCB4W2krIDJdLCAxNywgIDYwNjEwNTgxOSk7XHJcbiAgICBiID0gbWQ1X2ZmKGIsIGMsIGQsIGEsIHhbaSsgM10sIDIyLCAtMTA0NDUyNTMzMCk7XHJcbiAgICBhID0gbWQ1X2ZmKGEsIGIsIGMsIGQsIHhbaSsgNF0sIDcgLCAtMTc2NDE4ODk3KTtcclxuICAgIGQgPSBtZDVfZmYoZCwgYSwgYiwgYywgeFtpKyA1XSwgMTIsICAxMjAwMDgwNDI2KTtcclxuICAgIGMgPSBtZDVfZmYoYywgZCwgYSwgYiwgeFtpKyA2XSwgMTcsIC0xNDczMjMxMzQxKTtcclxuICAgIGIgPSBtZDVfZmYoYiwgYywgZCwgYSwgeFtpKyA3XSwgMjIsIC00NTcwNTk4Myk7XHJcbiAgICBhID0gbWQ1X2ZmKGEsIGIsIGMsIGQsIHhbaSsgOF0sIDcgLCAgMTc3MDAzNTQxNik7XHJcbiAgICBkID0gbWQ1X2ZmKGQsIGEsIGIsIGMsIHhbaSsgOV0sIDEyLCAtMTk1ODQxNDQxNyk7XHJcbiAgICBjID0gbWQ1X2ZmKGMsIGQsIGEsIGIsIHhbaSsxMF0sIDE3LCAtNDIwNjMpO1xyXG4gICAgYiA9IG1kNV9mZihiLCBjLCBkLCBhLCB4W2krMTFdLCAyMiwgLTE5OTA0MDQxNjIpO1xyXG4gICAgYSA9IG1kNV9mZihhLCBiLCBjLCBkLCB4W2krMTJdLCA3ICwgIDE4MDQ2MDM2ODIpO1xyXG4gICAgZCA9IG1kNV9mZihkLCBhLCBiLCBjLCB4W2krMTNdLCAxMiwgLTQwMzQxMTAxKTtcclxuICAgIGMgPSBtZDVfZmYoYywgZCwgYSwgYiwgeFtpKzE0XSwgMTcsIC0xNTAyMDAyMjkwKTtcclxuICAgIGIgPSBtZDVfZmYoYiwgYywgZCwgYSwgeFtpKzE1XSwgMjIsICAxMjM2NTM1MzI5KTtcclxuXHJcbiAgICBhID0gbWQ1X2dnKGEsIGIsIGMsIGQsIHhbaSsgMV0sIDUgLCAtMTY1Nzk2NTEwKTtcclxuICAgIGQgPSBtZDVfZ2coZCwgYSwgYiwgYywgeFtpKyA2XSwgOSAsIC0xMDY5NTAxNjMyKTtcclxuICAgIGMgPSBtZDVfZ2coYywgZCwgYSwgYiwgeFtpKzExXSwgMTQsICA2NDM3MTc3MTMpO1xyXG4gICAgYiA9IG1kNV9nZyhiLCBjLCBkLCBhLCB4W2krIDBdLCAyMCwgLTM3Mzg5NzMwMik7XHJcbiAgICBhID0gbWQ1X2dnKGEsIGIsIGMsIGQsIHhbaSsgNV0sIDUgLCAtNzAxNTU4NjkxKTtcclxuICAgIGQgPSBtZDVfZ2coZCwgYSwgYiwgYywgeFtpKzEwXSwgOSAsICAzODAxNjA4Myk7XHJcbiAgICBjID0gbWQ1X2dnKGMsIGQsIGEsIGIsIHhbaSsxNV0sIDE0LCAtNjYwNDc4MzM1KTtcclxuICAgIGIgPSBtZDVfZ2coYiwgYywgZCwgYSwgeFtpKyA0XSwgMjAsIC00MDU1Mzc4NDgpO1xyXG4gICAgYSA9IG1kNV9nZyhhLCBiLCBjLCBkLCB4W2krIDldLCA1ICwgIDU2ODQ0NjQzOCk7XHJcbiAgICBkID0gbWQ1X2dnKGQsIGEsIGIsIGMsIHhbaSsxNF0sIDkgLCAtMTAxOTgwMzY5MCk7XHJcbiAgICBjID0gbWQ1X2dnKGMsIGQsIGEsIGIsIHhbaSsgM10sIDE0LCAtMTg3MzYzOTYxKTtcclxuICAgIGIgPSBtZDVfZ2coYiwgYywgZCwgYSwgeFtpKyA4XSwgMjAsICAxMTYzNTMxNTAxKTtcclxuICAgIGEgPSBtZDVfZ2coYSwgYiwgYywgZCwgeFtpKzEzXSwgNSAsIC0xNDQ0NjgxNDY3KTtcclxuICAgIGQgPSBtZDVfZ2coZCwgYSwgYiwgYywgeFtpKyAyXSwgOSAsIC01MTQwMzc4NCk7XHJcbiAgICBjID0gbWQ1X2dnKGMsIGQsIGEsIGIsIHhbaSsgN10sIDE0LCAgMTczNTMyODQ3Myk7XHJcbiAgICBiID0gbWQ1X2dnKGIsIGMsIGQsIGEsIHhbaSsxMl0sIDIwLCAtMTkyNjYwNzczNCk7XHJcblxyXG4gICAgYSA9IG1kNV9oaChhLCBiLCBjLCBkLCB4W2krIDVdLCA0ICwgLTM3ODU1OCk7XHJcbiAgICBkID0gbWQ1X2hoKGQsIGEsIGIsIGMsIHhbaSsgOF0sIDExLCAtMjAyMjU3NDQ2Myk7XHJcbiAgICBjID0gbWQ1X2hoKGMsIGQsIGEsIGIsIHhbaSsxMV0sIDE2LCAgMTgzOTAzMDU2Mik7XHJcbiAgICBiID0gbWQ1X2hoKGIsIGMsIGQsIGEsIHhbaSsxNF0sIDIzLCAtMzUzMDk1NTYpO1xyXG4gICAgYSA9IG1kNV9oaChhLCBiLCBjLCBkLCB4W2krIDFdLCA0ICwgLTE1MzA5OTIwNjApO1xyXG4gICAgZCA9IG1kNV9oaChkLCBhLCBiLCBjLCB4W2krIDRdLCAxMSwgIDEyNzI4OTMzNTMpO1xyXG4gICAgYyA9IG1kNV9oaChjLCBkLCBhLCBiLCB4W2krIDddLCAxNiwgLTE1NTQ5NzYzMik7XHJcbiAgICBiID0gbWQ1X2hoKGIsIGMsIGQsIGEsIHhbaSsxMF0sIDIzLCAtMTA5NDczMDY0MCk7XHJcbiAgICBhID0gbWQ1X2hoKGEsIGIsIGMsIGQsIHhbaSsxM10sIDQgLCAgNjgxMjc5MTc0KTtcclxuICAgIGQgPSBtZDVfaGgoZCwgYSwgYiwgYywgeFtpKyAwXSwgMTEsIC0zNTg1MzcyMjIpO1xyXG4gICAgYyA9IG1kNV9oaChjLCBkLCBhLCBiLCB4W2krIDNdLCAxNiwgLTcyMjUyMTk3OSk7XHJcbiAgICBiID0gbWQ1X2hoKGIsIGMsIGQsIGEsIHhbaSsgNl0sIDIzLCAgNzYwMjkxODkpO1xyXG4gICAgYSA9IG1kNV9oaChhLCBiLCBjLCBkLCB4W2krIDldLCA0ICwgLTY0MDM2NDQ4Nyk7XHJcbiAgICBkID0gbWQ1X2hoKGQsIGEsIGIsIGMsIHhbaSsxMl0sIDExLCAtNDIxODE1ODM1KTtcclxuICAgIGMgPSBtZDVfaGgoYywgZCwgYSwgYiwgeFtpKzE1XSwgMTYsICA1MzA3NDI1MjApO1xyXG4gICAgYiA9IG1kNV9oaChiLCBjLCBkLCBhLCB4W2krIDJdLCAyMywgLTk5NTMzODY1MSk7XHJcblxyXG4gICAgYSA9IG1kNV9paShhLCBiLCBjLCBkLCB4W2krIDBdLCA2ICwgLTE5ODYzMDg0NCk7XHJcbiAgICBkID0gbWQ1X2lpKGQsIGEsIGIsIGMsIHhbaSsgN10sIDEwLCAgMTEyNjg5MTQxNSk7XHJcbiAgICBjID0gbWQ1X2lpKGMsIGQsIGEsIGIsIHhbaSsxNF0sIDE1LCAtMTQxNjM1NDkwNSk7XHJcbiAgICBiID0gbWQ1X2lpKGIsIGMsIGQsIGEsIHhbaSsgNV0sIDIxLCAtNTc0MzQwNTUpO1xyXG4gICAgYSA9IG1kNV9paShhLCBiLCBjLCBkLCB4W2krMTJdLCA2ICwgIDE3MDA0ODU1NzEpO1xyXG4gICAgZCA9IG1kNV9paShkLCBhLCBiLCBjLCB4W2krIDNdLCAxMCwgLTE4OTQ5ODY2MDYpO1xyXG4gICAgYyA9IG1kNV9paShjLCBkLCBhLCBiLCB4W2krMTBdLCAxNSwgLTEwNTE1MjMpO1xyXG4gICAgYiA9IG1kNV9paShiLCBjLCBkLCBhLCB4W2krIDFdLCAyMSwgLTIwNTQ5MjI3OTkpO1xyXG4gICAgYSA9IG1kNV9paShhLCBiLCBjLCBkLCB4W2krIDhdLCA2ICwgIDE4NzMzMTMzNTkpO1xyXG4gICAgZCA9IG1kNV9paShkLCBhLCBiLCBjLCB4W2krMTVdLCAxMCwgLTMwNjExNzQ0KTtcclxuICAgIGMgPSBtZDVfaWkoYywgZCwgYSwgYiwgeFtpKyA2XSwgMTUsIC0xNTYwMTk4MzgwKTtcclxuICAgIGIgPSBtZDVfaWkoYiwgYywgZCwgYSwgeFtpKzEzXSwgMjEsICAxMzA5MTUxNjQ5KTtcclxuICAgIGEgPSBtZDVfaWkoYSwgYiwgYywgZCwgeFtpKyA0XSwgNiAsIC0xNDU1MjMwNzApO1xyXG4gICAgZCA9IG1kNV9paShkLCBhLCBiLCBjLCB4W2krMTFdLCAxMCwgLTExMjAyMTAzNzkpO1xyXG4gICAgYyA9IG1kNV9paShjLCBkLCBhLCBiLCB4W2krIDJdLCAxNSwgIDcxODc4NzI1OSk7XHJcbiAgICBiID0gbWQ1X2lpKGIsIGMsIGQsIGEsIHhbaSsgOV0sIDIxLCAtMzQzNDg1NTUxKTtcclxuXHJcbiAgICBhID0gc2FmZV9hZGQoYSwgb2xkYSk7XHJcbiAgICBiID0gc2FmZV9hZGQoYiwgb2xkYik7XHJcbiAgICBjID0gc2FmZV9hZGQoYywgb2xkYyk7XHJcbiAgICBkID0gc2FmZV9hZGQoZCwgb2xkZCk7XHJcbiAgfVxyXG4gIHJldHVybiBBcnJheShhLCBiLCBjLCBkKTtcclxuXHJcbn1cclxuXHJcbi8qXHJcbiAqIFRoZXNlIGZ1bmN0aW9ucyBpbXBsZW1lbnQgdGhlIGZvdXIgYmFzaWMgb3BlcmF0aW9ucyB0aGUgYWxnb3JpdGhtIHVzZXMuXHJcbiAqL1xyXG5mdW5jdGlvbiBtZDVfY21uKHEsIGEsIGIsIHgsIHMsIHQpXHJcbntcclxuICByZXR1cm4gc2FmZV9hZGQoYml0X3JvbChzYWZlX2FkZChzYWZlX2FkZChhLCBxKSwgc2FmZV9hZGQoeCwgdCkpLCBzKSxiKTtcclxufVxyXG5mdW5jdGlvbiBtZDVfZmYoYSwgYiwgYywgZCwgeCwgcywgdClcclxue1xyXG4gIHJldHVybiBtZDVfY21uKChiICYgYykgfCAoKH5iKSAmIGQpLCBhLCBiLCB4LCBzLCB0KTtcclxufVxyXG5mdW5jdGlvbiBtZDVfZ2coYSwgYiwgYywgZCwgeCwgcywgdClcclxue1xyXG4gIHJldHVybiBtZDVfY21uKChiICYgZCkgfCAoYyAmICh+ZCkpLCBhLCBiLCB4LCBzLCB0KTtcclxufVxyXG5mdW5jdGlvbiBtZDVfaGgoYSwgYiwgYywgZCwgeCwgcywgdClcclxue1xyXG4gIHJldHVybiBtZDVfY21uKGIgXiBjIF4gZCwgYSwgYiwgeCwgcywgdCk7XHJcbn1cclxuZnVuY3Rpb24gbWQ1X2lpKGEsIGIsIGMsIGQsIHgsIHMsIHQpXHJcbntcclxuICByZXR1cm4gbWQ1X2NtbihjIF4gKGIgfCAofmQpKSwgYSwgYiwgeCwgcywgdCk7XHJcbn1cclxuXHJcbi8qXHJcbiAqIEFkZCBpbnRlZ2Vycywgd3JhcHBpbmcgYXQgMl4zMi4gVGhpcyB1c2VzIDE2LWJpdCBvcGVyYXRpb25zIGludGVybmFsbHlcclxuICogdG8gd29yayBhcm91bmQgYnVncyBpbiBzb21lIEpTIGludGVycHJldGVycy5cclxuICovXHJcbmZ1bmN0aW9uIHNhZmVfYWRkKHgsIHkpXHJcbntcclxuICB2YXIgbHN3ID0gKHggJiAweEZGRkYpICsgKHkgJiAweEZGRkYpO1xyXG4gIHZhciBtc3cgPSAoeCA+PiAxNikgKyAoeSA+PiAxNikgKyAobHN3ID4+IDE2KTtcclxuICByZXR1cm4gKG1zdyA8PCAxNikgfCAobHN3ICYgMHhGRkZGKTtcclxufVxyXG5cclxuLypcclxuICogQml0d2lzZSByb3RhdGUgYSAzMi1iaXQgbnVtYmVyIHRvIHRoZSBsZWZ0LlxyXG4gKi9cclxuZnVuY3Rpb24gYml0X3JvbChudW0sIGNudClcclxue1xyXG4gIHJldHVybiAobnVtIDw8IGNudCkgfCAobnVtID4+PiAoMzIgLSBjbnQpKTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBtZDUoYnVmKSB7XHJcbiAgcmV0dXJuIGhlbHBlcnMuaGFzaChidWYsIGNvcmVfbWQ1LCAxNik7XHJcbn07XHJcbiIsIi8vIE9yaWdpbmFsIGNvZGUgYWRhcHRlZCBmcm9tIFJvYmVydCBLaWVmZmVyLlxuLy8gZGV0YWlscyBhdCBodHRwczovL2dpdGh1Yi5jb20vYnJvb2ZhL25vZGUtdXVpZFxuKGZ1bmN0aW9uKCkge1xuICB2YXIgX2dsb2JhbCA9IHRoaXM7XG5cbiAgdmFyIG1hdGhSTkcsIHdoYXR3Z1JORztcblxuICAvLyBOT1RFOiBNYXRoLnJhbmRvbSgpIGRvZXMgbm90IGd1YXJhbnRlZSBcImNyeXB0b2dyYXBoaWMgcXVhbGl0eVwiXG4gIG1hdGhSTkcgPSBmdW5jdGlvbihzaXplKSB7XG4gICAgdmFyIGJ5dGVzID0gbmV3IEFycmF5KHNpemUpO1xuICAgIHZhciByO1xuXG4gICAgZm9yICh2YXIgaSA9IDAsIHI7IGkgPCBzaXplOyBpKyspIHtcbiAgICAgIGlmICgoaSAmIDB4MDMpID09IDApIHIgPSBNYXRoLnJhbmRvbSgpICogMHgxMDAwMDAwMDA7XG4gICAgICBieXRlc1tpXSA9IHIgPj4+ICgoaSAmIDB4MDMpIDw8IDMpICYgMHhmZjtcbiAgICB9XG5cbiAgICByZXR1cm4gYnl0ZXM7XG4gIH1cblxuICBpZiAoX2dsb2JhbC5jcnlwdG8gJiYgY3J5cHRvLmdldFJhbmRvbVZhbHVlcykge1xuICAgIHdoYXR3Z1JORyA9IGZ1bmN0aW9uKHNpemUpIHtcbiAgICAgIHZhciBieXRlcyA9IG5ldyBVaW50OEFycmF5KHNpemUpO1xuICAgICAgY3J5cHRvLmdldFJhbmRvbVZhbHVlcyhieXRlcyk7XG4gICAgICByZXR1cm4gYnl0ZXM7XG4gICAgfVxuICB9XG5cbiAgbW9kdWxlLmV4cG9ydHMgPSB3aGF0d2dSTkcgfHwgbWF0aFJORztcblxufSgpKVxuIiwiLypcbiAqIEEgSmF2YVNjcmlwdCBpbXBsZW1lbnRhdGlvbiBvZiB0aGUgU2VjdXJlIEhhc2ggQWxnb3JpdGhtLCBTSEEtMSwgYXMgZGVmaW5lZFxuICogaW4gRklQUyBQVUIgMTgwLTFcbiAqIFZlcnNpb24gMi4xYSBDb3B5cmlnaHQgUGF1bCBKb2huc3RvbiAyMDAwIC0gMjAwMi5cbiAqIE90aGVyIGNvbnRyaWJ1dG9yczogR3JlZyBIb2x0LCBBbmRyZXcgS2VwZXJ0LCBZZG5hciwgTG9zdGluZXRcbiAqIERpc3RyaWJ1dGVkIHVuZGVyIHRoZSBCU0QgTGljZW5zZVxuICogU2VlIGh0dHA6Ly9wYWpob21lLm9yZy51ay9jcnlwdC9tZDUgZm9yIGRldGFpbHMuXG4gKi9cblxudmFyIGhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKTtcblxuLypcbiAqIENhbGN1bGF0ZSB0aGUgU0hBLTEgb2YgYW4gYXJyYXkgb2YgYmlnLWVuZGlhbiB3b3JkcywgYW5kIGEgYml0IGxlbmd0aFxuICovXG5mdW5jdGlvbiBjb3JlX3NoYTEoeCwgbGVuKVxue1xuICAvKiBhcHBlbmQgcGFkZGluZyAqL1xuICB4W2xlbiA+PiA1XSB8PSAweDgwIDw8ICgyNCAtIGxlbiAlIDMyKTtcbiAgeFsoKGxlbiArIDY0ID4+IDkpIDw8IDQpICsgMTVdID0gbGVuO1xuXG4gIHZhciB3ID0gQXJyYXkoODApO1xuICB2YXIgYSA9ICAxNzMyNTg0MTkzO1xuICB2YXIgYiA9IC0yNzE3MzM4Nzk7XG4gIHZhciBjID0gLTE3MzI1ODQxOTQ7XG4gIHZhciBkID0gIDI3MTczMzg3ODtcbiAgdmFyIGUgPSAtMTAwOTU4OTc3NjtcblxuICBmb3IodmFyIGkgPSAwOyBpIDwgeC5sZW5ndGg7IGkgKz0gMTYpXG4gIHtcbiAgICB2YXIgb2xkYSA9IGE7XG4gICAgdmFyIG9sZGIgPSBiO1xuICAgIHZhciBvbGRjID0gYztcbiAgICB2YXIgb2xkZCA9IGQ7XG4gICAgdmFyIG9sZGUgPSBlO1xuXG4gICAgZm9yKHZhciBqID0gMDsgaiA8IDgwOyBqKyspXG4gICAge1xuICAgICAgaWYoaiA8IDE2KSB3W2pdID0geFtpICsgal07XG4gICAgICBlbHNlIHdbal0gPSByb2wod1tqLTNdIF4gd1tqLThdIF4gd1tqLTE0XSBeIHdbai0xNl0sIDEpO1xuICAgICAgdmFyIHQgPSBzYWZlX2FkZChzYWZlX2FkZChyb2woYSwgNSksIHNoYTFfZnQoaiwgYiwgYywgZCkpLFxuICAgICAgICAgICAgICAgICAgICAgICBzYWZlX2FkZChzYWZlX2FkZChlLCB3W2pdKSwgc2hhMV9rdChqKSkpO1xuICAgICAgZSA9IGQ7XG4gICAgICBkID0gYztcbiAgICAgIGMgPSByb2woYiwgMzApO1xuICAgICAgYiA9IGE7XG4gICAgICBhID0gdDtcbiAgICB9XG5cbiAgICBhID0gc2FmZV9hZGQoYSwgb2xkYSk7XG4gICAgYiA9IHNhZmVfYWRkKGIsIG9sZGIpO1xuICAgIGMgPSBzYWZlX2FkZChjLCBvbGRjKTtcbiAgICBkID0gc2FmZV9hZGQoZCwgb2xkZCk7XG4gICAgZSA9IHNhZmVfYWRkKGUsIG9sZGUpO1xuICB9XG4gIHJldHVybiBBcnJheShhLCBiLCBjLCBkLCBlKTtcblxufVxuXG4vKlxuICogUGVyZm9ybSB0aGUgYXBwcm9wcmlhdGUgdHJpcGxldCBjb21iaW5hdGlvbiBmdW5jdGlvbiBmb3IgdGhlIGN1cnJlbnRcbiAqIGl0ZXJhdGlvblxuICovXG5mdW5jdGlvbiBzaGExX2Z0KHQsIGIsIGMsIGQpXG57XG4gIGlmKHQgPCAyMCkgcmV0dXJuIChiICYgYykgfCAoKH5iKSAmIGQpO1xuICBpZih0IDwgNDApIHJldHVybiBiIF4gYyBeIGQ7XG4gIGlmKHQgPCA2MCkgcmV0dXJuIChiICYgYykgfCAoYiAmIGQpIHwgKGMgJiBkKTtcbiAgcmV0dXJuIGIgXiBjIF4gZDtcbn1cblxuLypcbiAqIERldGVybWluZSB0aGUgYXBwcm9wcmlhdGUgYWRkaXRpdmUgY29uc3RhbnQgZm9yIHRoZSBjdXJyZW50IGl0ZXJhdGlvblxuICovXG5mdW5jdGlvbiBzaGExX2t0KHQpXG57XG4gIHJldHVybiAodCA8IDIwKSA/ICAxNTE4NTAwMjQ5IDogKHQgPCA0MCkgPyAgMTg1OTc3NTM5MyA6XG4gICAgICAgICAodCA8IDYwKSA/IC0xODk0MDA3NTg4IDogLTg5OTQ5NzUxNDtcbn1cblxuLypcbiAqIEFkZCBpbnRlZ2Vycywgd3JhcHBpbmcgYXQgMl4zMi4gVGhpcyB1c2VzIDE2LWJpdCBvcGVyYXRpb25zIGludGVybmFsbHlcbiAqIHRvIHdvcmsgYXJvdW5kIGJ1Z3MgaW4gc29tZSBKUyBpbnRlcnByZXRlcnMuXG4gKi9cbmZ1bmN0aW9uIHNhZmVfYWRkKHgsIHkpXG57XG4gIHZhciBsc3cgPSAoeCAmIDB4RkZGRikgKyAoeSAmIDB4RkZGRik7XG4gIHZhciBtc3cgPSAoeCA+PiAxNikgKyAoeSA+PiAxNikgKyAobHN3ID4+IDE2KTtcbiAgcmV0dXJuIChtc3cgPDwgMTYpIHwgKGxzdyAmIDB4RkZGRik7XG59XG5cbi8qXG4gKiBCaXR3aXNlIHJvdGF0ZSBhIDMyLWJpdCBudW1iZXIgdG8gdGhlIGxlZnQuXG4gKi9cbmZ1bmN0aW9uIHJvbChudW0sIGNudClcbntcbiAgcmV0dXJuIChudW0gPDwgY250KSB8IChudW0gPj4+ICgzMiAtIGNudCkpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIHNoYTEoYnVmKSB7XG4gIHJldHVybiBoZWxwZXJzLmhhc2goYnVmLCBjb3JlX3NoYTEsIDIwLCB0cnVlKTtcbn07XG4iLCJcbi8qKlxuICogQSBKYXZhU2NyaXB0IGltcGxlbWVudGF0aW9uIG9mIHRoZSBTZWN1cmUgSGFzaCBBbGdvcml0aG0sIFNIQS0yNTYsIGFzIGRlZmluZWRcbiAqIGluIEZJUFMgMTgwLTJcbiAqIFZlcnNpb24gMi4yLWJldGEgQ29weXJpZ2h0IEFuZ2VsIE1hcmluLCBQYXVsIEpvaG5zdG9uIDIwMDAgLSAyMDA5LlxuICogT3RoZXIgY29udHJpYnV0b3JzOiBHcmVnIEhvbHQsIEFuZHJldyBLZXBlcnQsIFlkbmFyLCBMb3N0aW5ldFxuICpcbiAqL1xuXG52YXIgaGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpO1xuXG52YXIgc2FmZV9hZGQgPSBmdW5jdGlvbih4LCB5KSB7XG4gIHZhciBsc3cgPSAoeCAmIDB4RkZGRikgKyAoeSAmIDB4RkZGRik7XG4gIHZhciBtc3cgPSAoeCA+PiAxNikgKyAoeSA+PiAxNikgKyAobHN3ID4+IDE2KTtcbiAgcmV0dXJuIChtc3cgPDwgMTYpIHwgKGxzdyAmIDB4RkZGRik7XG59O1xuXG52YXIgUyA9IGZ1bmN0aW9uKFgsIG4pIHtcbiAgcmV0dXJuIChYID4+PiBuKSB8IChYIDw8ICgzMiAtIG4pKTtcbn07XG5cbnZhciBSID0gZnVuY3Rpb24oWCwgbikge1xuICByZXR1cm4gKFggPj4+IG4pO1xufTtcblxudmFyIENoID0gZnVuY3Rpb24oeCwgeSwgeikge1xuICByZXR1cm4gKCh4ICYgeSkgXiAoKH54KSAmIHopKTtcbn07XG5cbnZhciBNYWogPSBmdW5jdGlvbih4LCB5LCB6KSB7XG4gIHJldHVybiAoKHggJiB5KSBeICh4ICYgeikgXiAoeSAmIHopKTtcbn07XG5cbnZhciBTaWdtYTAyNTYgPSBmdW5jdGlvbih4KSB7XG4gIHJldHVybiAoUyh4LCAyKSBeIFMoeCwgMTMpIF4gUyh4LCAyMikpO1xufTtcblxudmFyIFNpZ21hMTI1NiA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIChTKHgsIDYpIF4gUyh4LCAxMSkgXiBTKHgsIDI1KSk7XG59O1xuXG52YXIgR2FtbWEwMjU2ID0gZnVuY3Rpb24oeCkge1xuICByZXR1cm4gKFMoeCwgNykgXiBTKHgsIDE4KSBeIFIoeCwgMykpO1xufTtcblxudmFyIEdhbW1hMTI1NiA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIChTKHgsIDE3KSBeIFMoeCwgMTkpIF4gUih4LCAxMCkpO1xufTtcblxudmFyIGNvcmVfc2hhMjU2ID0gZnVuY3Rpb24obSwgbCkge1xuICB2YXIgSyA9IG5ldyBBcnJheSgweDQyOEEyRjk4LDB4NzEzNzQ0OTEsMHhCNUMwRkJDRiwweEU5QjVEQkE1LDB4Mzk1NkMyNUIsMHg1OUYxMTFGMSwweDkyM0Y4MkE0LDB4QUIxQzVFRDUsMHhEODA3QUE5OCwweDEyODM1QjAxLDB4MjQzMTg1QkUsMHg1NTBDN0RDMywweDcyQkU1RDc0LDB4ODBERUIxRkUsMHg5QkRDMDZBNywweEMxOUJGMTc0LDB4RTQ5QjY5QzEsMHhFRkJFNDc4NiwweEZDMTlEQzYsMHgyNDBDQTFDQywweDJERTkyQzZGLDB4NEE3NDg0QUEsMHg1Q0IwQTlEQywweDc2Rjk4OERBLDB4OTgzRTUxNTIsMHhBODMxQzY2RCwweEIwMDMyN0M4LDB4QkY1OTdGQzcsMHhDNkUwMEJGMywweEQ1QTc5MTQ3LDB4NkNBNjM1MSwweDE0MjkyOTY3LDB4MjdCNzBBODUsMHgyRTFCMjEzOCwweDREMkM2REZDLDB4NTMzODBEMTMsMHg2NTBBNzM1NCwweDc2NkEwQUJCLDB4ODFDMkM5MkUsMHg5MjcyMkM4NSwweEEyQkZFOEExLDB4QTgxQTY2NEIsMHhDMjRCOEI3MCwweEM3NkM1MUEzLDB4RDE5MkU4MTksMHhENjk5MDYyNCwweEY0MEUzNTg1LDB4MTA2QUEwNzAsMHgxOUE0QzExNiwweDFFMzc2QzA4LDB4Mjc0ODc3NEMsMHgzNEIwQkNCNSwweDM5MUMwQ0IzLDB4NEVEOEFBNEEsMHg1QjlDQ0E0RiwweDY4MkU2RkYzLDB4NzQ4RjgyRUUsMHg3OEE1NjM2RiwweDg0Qzg3ODE0LDB4OENDNzAyMDgsMHg5MEJFRkZGQSwweEE0NTA2Q0VCLDB4QkVGOUEzRjcsMHhDNjcxNzhGMik7XG4gIHZhciBIQVNIID0gbmV3IEFycmF5KDB4NkEwOUU2NjcsIDB4QkI2N0FFODUsIDB4M0M2RUYzNzIsIDB4QTU0RkY1M0EsIDB4NTEwRTUyN0YsIDB4OUIwNTY4OEMsIDB4MUY4M0Q5QUIsIDB4NUJFMENEMTkpO1xuICAgIHZhciBXID0gbmV3IEFycmF5KDY0KTtcbiAgICB2YXIgYSwgYiwgYywgZCwgZSwgZiwgZywgaCwgaSwgajtcbiAgICB2YXIgVDEsIFQyO1xuICAvKiBhcHBlbmQgcGFkZGluZyAqL1xuICBtW2wgPj4gNV0gfD0gMHg4MCA8PCAoMjQgLSBsICUgMzIpO1xuICBtWygobCArIDY0ID4+IDkpIDw8IDQpICsgMTVdID0gbDtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBtLmxlbmd0aDsgaSArPSAxNikge1xuICAgIGEgPSBIQVNIWzBdOyBiID0gSEFTSFsxXTsgYyA9IEhBU0hbMl07IGQgPSBIQVNIWzNdOyBlID0gSEFTSFs0XTsgZiA9IEhBU0hbNV07IGcgPSBIQVNIWzZdOyBoID0gSEFTSFs3XTtcbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IDY0OyBqKyspIHtcbiAgICAgIGlmIChqIDwgMTYpIHtcbiAgICAgICAgV1tqXSA9IG1baiArIGldO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgV1tqXSA9IHNhZmVfYWRkKHNhZmVfYWRkKHNhZmVfYWRkKEdhbW1hMTI1NihXW2ogLSAyXSksIFdbaiAtIDddKSwgR2FtbWEwMjU2KFdbaiAtIDE1XSkpLCBXW2ogLSAxNl0pO1xuICAgICAgfVxuICAgICAgVDEgPSBzYWZlX2FkZChzYWZlX2FkZChzYWZlX2FkZChzYWZlX2FkZChoLCBTaWdtYTEyNTYoZSkpLCBDaChlLCBmLCBnKSksIEtbal0pLCBXW2pdKTtcbiAgICAgIFQyID0gc2FmZV9hZGQoU2lnbWEwMjU2KGEpLCBNYWooYSwgYiwgYykpO1xuICAgICAgaCA9IGc7IGcgPSBmOyBmID0gZTsgZSA9IHNhZmVfYWRkKGQsIFQxKTsgZCA9IGM7IGMgPSBiOyBiID0gYTsgYSA9IHNhZmVfYWRkKFQxLCBUMik7XG4gICAgfVxuICAgIEhBU0hbMF0gPSBzYWZlX2FkZChhLCBIQVNIWzBdKTsgSEFTSFsxXSA9IHNhZmVfYWRkKGIsIEhBU0hbMV0pOyBIQVNIWzJdID0gc2FmZV9hZGQoYywgSEFTSFsyXSk7IEhBU0hbM10gPSBzYWZlX2FkZChkLCBIQVNIWzNdKTtcbiAgICBIQVNIWzRdID0gc2FmZV9hZGQoZSwgSEFTSFs0XSk7IEhBU0hbNV0gPSBzYWZlX2FkZChmLCBIQVNIWzVdKTsgSEFTSFs2XSA9IHNhZmVfYWRkKGcsIEhBU0hbNl0pOyBIQVNIWzddID0gc2FmZV9hZGQoaCwgSEFTSFs3XSk7XG4gIH1cbiAgcmV0dXJuIEhBU0g7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIHNoYTI1NihidWYpIHtcbiAgcmV0dXJuIGhlbHBlcnMuaGFzaChidWYsIGNvcmVfc2hhMjU2LCAzMiwgdHJ1ZSk7XG59O1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbmZ1bmN0aW9uIEV2ZW50RW1pdHRlcigpIHtcbiAgdGhpcy5fZXZlbnRzID0gdGhpcy5fZXZlbnRzIHx8IHt9O1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSB0aGlzLl9tYXhMaXN0ZW5lcnMgfHwgdW5kZWZpbmVkO1xufVxubW9kdWxlLmV4cG9ydHMgPSBFdmVudEVtaXR0ZXI7XG5cbi8vIEJhY2t3YXJkcy1jb21wYXQgd2l0aCBub2RlIDAuMTAueFxuRXZlbnRFbWl0dGVyLkV2ZW50RW1pdHRlciA9IEV2ZW50RW1pdHRlcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fZXZlbnRzID0gdW5kZWZpbmVkO1xuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fbWF4TGlzdGVuZXJzID0gdW5kZWZpbmVkO1xuXG4vLyBCeSBkZWZhdWx0IEV2ZW50RW1pdHRlcnMgd2lsbCBwcmludCBhIHdhcm5pbmcgaWYgbW9yZSB0aGFuIDEwIGxpc3RlbmVycyBhcmVcbi8vIGFkZGVkIHRvIGl0LiBUaGlzIGlzIGEgdXNlZnVsIGRlZmF1bHQgd2hpY2ggaGVscHMgZmluZGluZyBtZW1vcnkgbGVha3MuXG5FdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycyA9IDEwO1xuXG4vLyBPYnZpb3VzbHkgbm90IGFsbCBFbWl0dGVycyBzaG91bGQgYmUgbGltaXRlZCB0byAxMC4gVGhpcyBmdW5jdGlvbiBhbGxvd3Ncbi8vIHRoYXQgdG8gYmUgaW5jcmVhc2VkLiBTZXQgdG8gemVybyBmb3IgdW5saW1pdGVkLlxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5zZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbihuKSB7XG4gIGlmICghaXNOdW1iZXIobikgfHwgbiA8IDAgfHwgaXNOYU4obikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCduIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBlciwgaGFuZGxlciwgbGVuLCBhcmdzLCBpLCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gSWYgdGhlcmUgaXMgbm8gJ2Vycm9yJyBldmVudCBsaXN0ZW5lciB0aGVuIHRocm93LlxuICBpZiAodHlwZSA9PT0gJ2Vycm9yJykge1xuICAgIGlmICghdGhpcy5fZXZlbnRzLmVycm9yIHx8XG4gICAgICAgIChpc09iamVjdCh0aGlzLl9ldmVudHMuZXJyb3IpICYmICF0aGlzLl9ldmVudHMuZXJyb3IubGVuZ3RoKSkge1xuICAgICAgZXIgPSBhcmd1bWVudHNbMV07XG4gICAgICBpZiAoZXIgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBlcjsgLy8gVW5oYW5kbGVkICdlcnJvcicgZXZlbnRcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IFR5cGVFcnJvcignVW5jYXVnaHQsIHVuc3BlY2lmaWVkIFwiZXJyb3JcIiBldmVudC4nKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBoYW5kbGVyID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc1VuZGVmaW5lZChoYW5kbGVyKSlcbiAgICByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKGlzRnVuY3Rpb24oaGFuZGxlcikpIHtcbiAgICBzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgIC8vIGZhc3QgY2FzZXNcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAzOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0pO1xuICAgICAgICBicmVhaztcbiAgICAgIC8vIHNsb3dlclxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICAgICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICAgICAgZm9yIChpID0gMTsgaSA8IGxlbjsgaSsrKVxuICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICBoYW5kbGVyLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH1cbiAgfSBlbHNlIGlmIChpc09iamVjdChoYW5kbGVyKSkge1xuICAgIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICBmb3IgKGkgPSAxOyBpIDwgbGVuOyBpKyspXG4gICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcblxuICAgIGxpc3RlbmVycyA9IGhhbmRsZXIuc2xpY2UoKTtcbiAgICBsZW4gPSBsaXN0ZW5lcnMubGVuZ3RoO1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKylcbiAgICAgIGxpc3RlbmVyc1tpXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBtO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBUbyBhdm9pZCByZWN1cnNpb24gaW4gdGhlIGNhc2UgdGhhdCB0eXBlID09PSBcIm5ld0xpc3RlbmVyXCIhIEJlZm9yZVxuICAvLyBhZGRpbmcgaXQgdG8gdGhlIGxpc3RlbmVycywgZmlyc3QgZW1pdCBcIm5ld0xpc3RlbmVyXCIuXG4gIGlmICh0aGlzLl9ldmVudHMubmV3TGlzdGVuZXIpXG4gICAgdGhpcy5lbWl0KCduZXdMaXN0ZW5lcicsIHR5cGUsXG4gICAgICAgICAgICAgIGlzRnVuY3Rpb24obGlzdGVuZXIubGlzdGVuZXIpID9cbiAgICAgICAgICAgICAgbGlzdGVuZXIubGlzdGVuZXIgOiBsaXN0ZW5lcik7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgLy8gT3B0aW1pemUgdGhlIGNhc2Ugb2Ygb25lIGxpc3RlbmVyLiBEb24ndCBuZWVkIHRoZSBleHRyYSBhcnJheSBvYmplY3QuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gbGlzdGVuZXI7XG4gIGVsc2UgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgLy8gSWYgd2UndmUgYWxyZWFkeSBnb3QgYW4gYXJyYXksIGp1c3QgYXBwZW5kLlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5wdXNoKGxpc3RlbmVyKTtcbiAgZWxzZVxuICAgIC8vIEFkZGluZyB0aGUgc2Vjb25kIGVsZW1lbnQsIG5lZWQgdG8gY2hhbmdlIHRvIGFycmF5LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IFt0aGlzLl9ldmVudHNbdHlwZV0sIGxpc3RlbmVyXTtcblxuICAvLyBDaGVjayBmb3IgbGlzdGVuZXIgbGVha1xuICBpZiAoaXNPYmplY3QodGhpcy5fZXZlbnRzW3R5cGVdKSAmJiAhdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCkge1xuICAgIHZhciBtO1xuICAgIGlmICghaXNVbmRlZmluZWQodGhpcy5fbWF4TGlzdGVuZXJzKSkge1xuICAgICAgbSA9IHRoaXMuX21heExpc3RlbmVycztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IEV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzO1xuICAgIH1cblxuICAgIGlmIChtICYmIG0gPiAwICYmIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGggPiBtKSB7XG4gICAgICB0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkID0gdHJ1ZTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJyhub2RlKSB3YXJuaW5nOiBwb3NzaWJsZSBFdmVudEVtaXR0ZXIgbWVtb3J5ICcgK1xuICAgICAgICAgICAgICAgICAgICAnbGVhayBkZXRlY3RlZC4gJWQgbGlzdGVuZXJzIGFkZGVkLiAnICtcbiAgICAgICAgICAgICAgICAgICAgJ1VzZSBlbWl0dGVyLnNldE1heExpc3RlbmVycygpIHRvIGluY3JlYXNlIGxpbWl0LicsXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGgpO1xuICAgICAgY29uc29sZS50cmFjZSgpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbiA9IEV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICB2YXIgZmlyZWQgPSBmYWxzZTtcblxuICBmdW5jdGlvbiBnKCkge1xuICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgZyk7XG5cbiAgICBpZiAoIWZpcmVkKSB7XG4gICAgICBmaXJlZCA9IHRydWU7XG4gICAgICBsaXN0ZW5lci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgfVxuXG4gIGcubGlzdGVuZXIgPSBsaXN0ZW5lcjtcbiAgdGhpcy5vbih0eXBlLCBnKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8vIGVtaXRzIGEgJ3JlbW92ZUxpc3RlbmVyJyBldmVudCBpZmYgdGhlIGxpc3RlbmVyIHdhcyByZW1vdmVkXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIGxpc3QsIHBvc2l0aW9uLCBsZW5ndGgsIGk7XG5cbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgbGlzdCA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgbGVuZ3RoID0gbGlzdC5sZW5ndGg7XG4gIHBvc2l0aW9uID0gLTE7XG5cbiAgaWYgKGxpc3QgPT09IGxpc3RlbmVyIHx8XG4gICAgICAoaXNGdW5jdGlvbihsaXN0Lmxpc3RlbmVyKSAmJiBsaXN0Lmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIGlmICh0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuXG4gIH0gZWxzZSBpZiAoaXNPYmplY3QobGlzdCkpIHtcbiAgICBmb3IgKGkgPSBsZW5ndGg7IGktLSA+IDA7KSB7XG4gICAgICBpZiAobGlzdFtpXSA9PT0gbGlzdGVuZXIgfHxcbiAgICAgICAgICAobGlzdFtpXS5saXN0ZW5lciAmJiBsaXN0W2ldLmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICAgICAgcG9zaXRpb24gPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocG9zaXRpb24gPCAwKVxuICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICAgIGxpc3QubGVuZ3RoID0gMDtcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpc3Quc3BsaWNlKHBvc2l0aW9uLCAxKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBrZXksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICByZXR1cm4gdGhpcztcblxuICAvLyBub3QgbGlzdGVuaW5nIGZvciByZW1vdmVMaXN0ZW5lciwgbm8gbmVlZCB0byBlbWl0XG4gIGlmICghdGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKSB7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApXG4gICAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICBlbHNlIGlmICh0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gZW1pdCByZW1vdmVMaXN0ZW5lciBmb3IgYWxsIGxpc3RlbmVycyBvbiBhbGwgZXZlbnRzXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgZm9yIChrZXkgaW4gdGhpcy5fZXZlbnRzKSB7XG4gICAgICBpZiAoa2V5ID09PSAncmVtb3ZlTGlzdGVuZXInKSBjb250aW51ZTtcbiAgICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKGtleSk7XG4gICAgfVxuICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKCdyZW1vdmVMaXN0ZW5lcicpO1xuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc0Z1bmN0aW9uKGxpc3RlbmVycykpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVycyk7XG4gIH0gZWxzZSB7XG4gICAgLy8gTElGTyBvcmRlclxuICAgIHdoaWxlIChsaXN0ZW5lcnMubGVuZ3RoKVxuICAgICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnNbbGlzdGVuZXJzLmxlbmd0aCAtIDFdKTtcbiAgfVxuICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gW107XG4gIGVsc2UgaWYgKGlzRnVuY3Rpb24odGhpcy5fZXZlbnRzW3R5cGVdKSlcbiAgICByZXQgPSBbdGhpcy5fZXZlbnRzW3R5cGVdXTtcbiAgZWxzZVxuICAgIHJldCA9IHRoaXMuX2V2ZW50c1t0eXBlXS5zbGljZSgpO1xuICByZXR1cm4gcmV0O1xufTtcblxuRXZlbnRFbWl0dGVyLmxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbihlbWl0dGVyLCB0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghZW1pdHRlci5fZXZlbnRzIHx8ICFlbWl0dGVyLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gMDtcbiAgZWxzZSBpZiAoaXNGdW5jdGlvbihlbWl0dGVyLl9ldmVudHNbdHlwZV0pKVxuICAgIHJldCA9IDE7XG4gIGVsc2VcbiAgICByZXQgPSBlbWl0dGVyLl9ldmVudHNbdHlwZV0ubGVuZ3RoO1xuICByZXR1cm4gcmV0O1xufTtcblxuZnVuY3Rpb24gaXNGdW5jdGlvbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIGlzTnVtYmVyKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ251bWJlcic7XG59XG5cbmZ1bmN0aW9uIGlzT2JqZWN0KGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsO1xufVxuXG5mdW5jdGlvbiBpc1VuZGVmaW5lZChhcmcpIHtcbiAgcmV0dXJuIGFyZyA9PT0gdm9pZCAwO1xufVxuIiwiaWYgKHR5cGVvZiBPYmplY3QuY3JlYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gIC8vIGltcGxlbWVudGF0aW9uIGZyb20gc3RhbmRhcmQgbm9kZS5qcyAndXRpbCcgbW9kdWxlXG4gIG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaW5oZXJpdHMoY3Rvciwgc3VwZXJDdG9yKSB7XG4gICAgY3Rvci5zdXBlcl8gPSBzdXBlckN0b3JcbiAgICBjdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoc3VwZXJDdG9yLnByb3RvdHlwZSwge1xuICAgICAgY29uc3RydWN0b3I6IHtcbiAgICAgICAgdmFsdWU6IGN0b3IsXG4gICAgICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgICB9XG4gICAgfSk7XG4gIH07XG59IGVsc2Uge1xuICAvLyBvbGQgc2Nob29sIHNoaW0gZm9yIG9sZCBicm93c2Vyc1xuICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGluaGVyaXRzKGN0b3IsIHN1cGVyQ3Rvcikge1xuICAgIGN0b3Iuc3VwZXJfID0gc3VwZXJDdG9yXG4gICAgdmFyIFRlbXBDdG9yID0gZnVuY3Rpb24gKCkge31cbiAgICBUZW1wQ3Rvci5wcm90b3R5cGUgPSBzdXBlckN0b3IucHJvdG90eXBlXG4gICAgY3Rvci5wcm90b3R5cGUgPSBuZXcgVGVtcEN0b3IoKVxuICAgIGN0b3IucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gY3RvclxuICB9XG59XG4iLCIvLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcblxudmFyIHByb2Nlc3MgPSBtb2R1bGUuZXhwb3J0cyA9IHt9O1xuXG5wcm9jZXNzLm5leHRUaWNrID0gKGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgY2FuU2V0SW1tZWRpYXRlID0gdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAmJiB3aW5kb3cuc2V0SW1tZWRpYXRlO1xuICAgIHZhciBjYW5Qb3N0ID0gdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAmJiB3aW5kb3cucG9zdE1lc3NhZ2UgJiYgd2luZG93LmFkZEV2ZW50TGlzdGVuZXJcbiAgICA7XG5cbiAgICBpZiAoY2FuU2V0SW1tZWRpYXRlKSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoZikgeyByZXR1cm4gd2luZG93LnNldEltbWVkaWF0ZShmKSB9O1xuICAgIH1cblxuICAgIGlmIChjYW5Qb3N0KSB7XG4gICAgICAgIHZhciBxdWV1ZSA9IFtdO1xuICAgICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uIChldikge1xuICAgICAgICAgICAgdmFyIHNvdXJjZSA9IGV2LnNvdXJjZTtcbiAgICAgICAgICAgIGlmICgoc291cmNlID09PSB3aW5kb3cgfHwgc291cmNlID09PSBudWxsKSAmJiBldi5kYXRhID09PSAncHJvY2Vzcy10aWNrJykge1xuICAgICAgICAgICAgICAgIGV2LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgIGlmIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBmbiA9IHF1ZXVlLnNoaWZ0KCk7XG4gICAgICAgICAgICAgICAgICAgIGZuKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LCB0cnVlKTtcblxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gbmV4dFRpY2soZm4pIHtcbiAgICAgICAgICAgIHF1ZXVlLnB1c2goZm4pO1xuICAgICAgICAgICAgd2luZG93LnBvc3RNZXNzYWdlKCdwcm9jZXNzLXRpY2snLCAnKicpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiBmdW5jdGlvbiBuZXh0VGljayhmbikge1xuICAgICAgICBzZXRUaW1lb3V0KGZuLCAwKTtcbiAgICB9O1xufSkoKTtcblxucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5cbnByb2Nlc3MuYmluZGluZyA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmJpbmRpbmcgaXMgbm90IHN1cHBvcnRlZCcpO1xufVxuXG4vLyBUT0RPKHNodHlsbWFuKVxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG4iLCJ2YXIgaGFzT3duID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eTtcbnZhciB0b1N0cmluZyA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG52YXIgdW5kZWZpbmVkO1xuXG52YXIgaXNQbGFpbk9iamVjdCA9IGZ1bmN0aW9uIGlzUGxhaW5PYmplY3Qob2JqKSB7XG5cdFwidXNlIHN0cmljdFwiO1xuXHRpZiAoIW9iaiB8fCB0b1N0cmluZy5jYWxsKG9iaikgIT09ICdbb2JqZWN0IE9iamVjdF0nIHx8IG9iai5ub2RlVHlwZSB8fCBvYmouc2V0SW50ZXJ2YWwpIHtcblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblxuXHR2YXIgaGFzX293bl9jb25zdHJ1Y3RvciA9IGhhc093bi5jYWxsKG9iaiwgJ2NvbnN0cnVjdG9yJyk7XG5cdHZhciBoYXNfaXNfcHJvcGVydHlfb2ZfbWV0aG9kID0gb2JqLmNvbnN0cnVjdG9yICYmIG9iai5jb25zdHJ1Y3Rvci5wcm90b3R5cGUgJiYgaGFzT3duLmNhbGwob2JqLmNvbnN0cnVjdG9yLnByb3RvdHlwZSwgJ2lzUHJvdG90eXBlT2YnKTtcblx0Ly8gTm90IG93biBjb25zdHJ1Y3RvciBwcm9wZXJ0eSBtdXN0IGJlIE9iamVjdFxuXHRpZiAob2JqLmNvbnN0cnVjdG9yICYmICFoYXNfb3duX2NvbnN0cnVjdG9yICYmICFoYXNfaXNfcHJvcGVydHlfb2ZfbWV0aG9kKSB7XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0Ly8gT3duIHByb3BlcnRpZXMgYXJlIGVudW1lcmF0ZWQgZmlyc3RseSwgc28gdG8gc3BlZWQgdXAsXG5cdC8vIGlmIGxhc3Qgb25lIGlzIG93biwgdGhlbiBhbGwgcHJvcGVydGllcyBhcmUgb3duLlxuXHR2YXIga2V5O1xuXHRmb3IgKGtleSBpbiBvYmopIHt9XG5cblx0cmV0dXJuIGtleSA9PT0gdW5kZWZpbmVkIHx8IGhhc093bi5jYWxsKG9iaiwga2V5KTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZXh0ZW5kKCkge1xuXHRcInVzZSBzdHJpY3RcIjtcblx0dmFyIG9wdGlvbnMsIG5hbWUsIHNyYywgY29weSwgY29weUlzQXJyYXksIGNsb25lLFxuXHRcdHRhcmdldCA9IGFyZ3VtZW50c1swXSxcblx0XHRpID0gMSxcblx0XHRsZW5ndGggPSBhcmd1bWVudHMubGVuZ3RoLFxuXHRcdGRlZXAgPSBmYWxzZTtcblxuXHQvLyBIYW5kbGUgYSBkZWVwIGNvcHkgc2l0dWF0aW9uXG5cdGlmICh0eXBlb2YgdGFyZ2V0ID09PSBcImJvb2xlYW5cIikge1xuXHRcdGRlZXAgPSB0YXJnZXQ7XG5cdFx0dGFyZ2V0ID0gYXJndW1lbnRzWzFdIHx8IHt9O1xuXHRcdC8vIHNraXAgdGhlIGJvb2xlYW4gYW5kIHRoZSB0YXJnZXRcblx0XHRpID0gMjtcblx0fSBlbHNlIGlmICh0eXBlb2YgdGFyZ2V0ICE9PSBcIm9iamVjdFwiICYmIHR5cGVvZiB0YXJnZXQgIT09IFwiZnVuY3Rpb25cIiB8fCB0YXJnZXQgPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHR0YXJnZXQgPSB7fTtcblx0fVxuXG5cdGZvciAoOyBpIDwgbGVuZ3RoOyArK2kpIHtcblx0XHQvLyBPbmx5IGRlYWwgd2l0aCBub24tbnVsbC91bmRlZmluZWQgdmFsdWVzXG5cdFx0aWYgKChvcHRpb25zID0gYXJndW1lbnRzW2ldKSAhPSBudWxsKSB7XG5cdFx0XHQvLyBFeHRlbmQgdGhlIGJhc2Ugb2JqZWN0XG5cdFx0XHRmb3IgKG5hbWUgaW4gb3B0aW9ucykge1xuXHRcdFx0XHRzcmMgPSB0YXJnZXRbbmFtZV07XG5cdFx0XHRcdGNvcHkgPSBvcHRpb25zW25hbWVdO1xuXG5cdFx0XHRcdC8vIFByZXZlbnQgbmV2ZXItZW5kaW5nIGxvb3Bcblx0XHRcdFx0aWYgKHRhcmdldCA9PT0gY29weSkge1xuXHRcdFx0XHRcdGNvbnRpbnVlO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0Ly8gUmVjdXJzZSBpZiB3ZSdyZSBtZXJnaW5nIHBsYWluIG9iamVjdHMgb3IgYXJyYXlzXG5cdFx0XHRcdGlmIChkZWVwICYmIGNvcHkgJiYgKGlzUGxhaW5PYmplY3QoY29weSkgfHwgKGNvcHlJc0FycmF5ID0gQXJyYXkuaXNBcnJheShjb3B5KSkpKSB7XG5cdFx0XHRcdFx0aWYgKGNvcHlJc0FycmF5KSB7XG5cdFx0XHRcdFx0XHRjb3B5SXNBcnJheSA9IGZhbHNlO1xuXHRcdFx0XHRcdFx0Y2xvbmUgPSBzcmMgJiYgQXJyYXkuaXNBcnJheShzcmMpID8gc3JjIDogW107XG5cdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdGNsb25lID0gc3JjICYmIGlzUGxhaW5PYmplY3Qoc3JjKSA/IHNyYyA6IHt9O1xuXHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdC8vIE5ldmVyIG1vdmUgb3JpZ2luYWwgb2JqZWN0cywgY2xvbmUgdGhlbVxuXHRcdFx0XHRcdHRhcmdldFtuYW1lXSA9IGV4dGVuZChkZWVwLCBjbG9uZSwgY29weSk7XG5cblx0XHRcdFx0Ly8gRG9uJ3QgYnJpbmcgaW4gdW5kZWZpbmVkIHZhbHVlc1xuXHRcdFx0XHR9IGVsc2UgaWYgKGNvcHkgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0XHRcdHRhcmdldFtuYW1lXSA9IGNvcHk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHQvLyBSZXR1cm4gdGhlIG1vZGlmaWVkIG9iamVjdFxuXHRyZXR1cm4gdGFyZ2V0O1xufTtcblxuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgYXNhcCA9IHJlcXVpcmUoJ2FzYXAnKVxuXG5tb2R1bGUuZXhwb3J0cyA9IFByb21pc2VcbmZ1bmN0aW9uIFByb21pc2UoZm4pIHtcbiAgaWYgKHR5cGVvZiB0aGlzICE9PSAnb2JqZWN0JykgdGhyb3cgbmV3IFR5cGVFcnJvcignUHJvbWlzZXMgbXVzdCBiZSBjb25zdHJ1Y3RlZCB2aWEgbmV3JylcbiAgaWYgKHR5cGVvZiBmbiAhPT0gJ2Z1bmN0aW9uJykgdGhyb3cgbmV3IFR5cGVFcnJvcignbm90IGEgZnVuY3Rpb24nKVxuICB2YXIgc3RhdGUgPSBudWxsXG4gIHZhciB2YWx1ZSA9IG51bGxcbiAgdmFyIGRlZmVycmVkcyA9IFtdXG4gIHZhciBzZWxmID0gdGhpc1xuXG4gIHRoaXMudGhlbiA9IGZ1bmN0aW9uKG9uRnVsZmlsbGVkLCBvblJlamVjdGVkKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgaGFuZGxlKG5ldyBIYW5kbGVyKG9uRnVsZmlsbGVkLCBvblJlamVjdGVkLCByZXNvbHZlLCByZWplY3QpKVxuICAgIH0pXG4gIH1cblxuICBmdW5jdGlvbiBoYW5kbGUoZGVmZXJyZWQpIHtcbiAgICBpZiAoc3RhdGUgPT09IG51bGwpIHtcbiAgICAgIGRlZmVycmVkcy5wdXNoKGRlZmVycmVkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGFzYXAoZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgY2IgPSBzdGF0ZSA/IGRlZmVycmVkLm9uRnVsZmlsbGVkIDogZGVmZXJyZWQub25SZWplY3RlZFxuICAgICAgaWYgKGNiID09PSBudWxsKSB7XG4gICAgICAgIChzdGF0ZSA/IGRlZmVycmVkLnJlc29sdmUgOiBkZWZlcnJlZC5yZWplY3QpKHZhbHVlKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICAgIHZhciByZXRcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldCA9IGNiKHZhbHVlKVxuICAgICAgfVxuICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgZGVmZXJyZWQucmVqZWN0KGUpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgICAgZGVmZXJyZWQucmVzb2x2ZShyZXQpXG4gICAgfSlcbiAgfVxuXG4gIGZ1bmN0aW9uIHJlc29sdmUobmV3VmFsdWUpIHtcbiAgICB0cnkgeyAvL1Byb21pc2UgUmVzb2x1dGlvbiBQcm9jZWR1cmU6IGh0dHBzOi8vZ2l0aHViLmNvbS9wcm9taXNlcy1hcGx1cy9wcm9taXNlcy1zcGVjI3RoZS1wcm9taXNlLXJlc29sdXRpb24tcHJvY2VkdXJlXG4gICAgICBpZiAobmV3VmFsdWUgPT09IHNlbGYpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0EgcHJvbWlzZSBjYW5ub3QgYmUgcmVzb2x2ZWQgd2l0aCBpdHNlbGYuJylcbiAgICAgIGlmIChuZXdWYWx1ZSAmJiAodHlwZW9mIG5ld1ZhbHVlID09PSAnb2JqZWN0JyB8fCB0eXBlb2YgbmV3VmFsdWUgPT09ICdmdW5jdGlvbicpKSB7XG4gICAgICAgIHZhciB0aGVuID0gbmV3VmFsdWUudGhlblxuICAgICAgICBpZiAodHlwZW9mIHRoZW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBkb1Jlc29sdmUodGhlbi5iaW5kKG5ld1ZhbHVlKSwgcmVzb2x2ZSwgcmVqZWN0KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBzdGF0ZSA9IHRydWVcbiAgICAgIHZhbHVlID0gbmV3VmFsdWVcbiAgICAgIGZpbmFsZSgpXG4gICAgfSBjYXRjaCAoZSkgeyByZWplY3QoZSkgfVxuICB9XG5cbiAgZnVuY3Rpb24gcmVqZWN0KG5ld1ZhbHVlKSB7XG4gICAgc3RhdGUgPSBmYWxzZVxuICAgIHZhbHVlID0gbmV3VmFsdWVcbiAgICBmaW5hbGUoKVxuICB9XG5cbiAgZnVuY3Rpb24gZmluYWxlKCkge1xuICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBkZWZlcnJlZHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspXG4gICAgICBoYW5kbGUoZGVmZXJyZWRzW2ldKVxuICAgIGRlZmVycmVkcyA9IG51bGxcbiAgfVxuXG4gIGRvUmVzb2x2ZShmbiwgcmVzb2x2ZSwgcmVqZWN0KVxufVxuXG5cbmZ1bmN0aW9uIEhhbmRsZXIob25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQsIHJlc29sdmUsIHJlamVjdCl7XG4gIHRoaXMub25GdWxmaWxsZWQgPSB0eXBlb2Ygb25GdWxmaWxsZWQgPT09ICdmdW5jdGlvbicgPyBvbkZ1bGZpbGxlZCA6IG51bGxcbiAgdGhpcy5vblJlamVjdGVkID0gdHlwZW9mIG9uUmVqZWN0ZWQgPT09ICdmdW5jdGlvbicgPyBvblJlamVjdGVkIDogbnVsbFxuICB0aGlzLnJlc29sdmUgPSByZXNvbHZlXG4gIHRoaXMucmVqZWN0ID0gcmVqZWN0XG59XG5cbi8qKlxuICogVGFrZSBhIHBvdGVudGlhbGx5IG1pc2JlaGF2aW5nIHJlc29sdmVyIGZ1bmN0aW9uIGFuZCBtYWtlIHN1cmVcbiAqIG9uRnVsZmlsbGVkIGFuZCBvblJlamVjdGVkIGFyZSBvbmx5IGNhbGxlZCBvbmNlLlxuICpcbiAqIE1ha2VzIG5vIGd1YXJhbnRlZXMgYWJvdXQgYXN5bmNocm9ueS5cbiAqL1xuZnVuY3Rpb24gZG9SZXNvbHZlKGZuLCBvbkZ1bGZpbGxlZCwgb25SZWplY3RlZCkge1xuICB2YXIgZG9uZSA9IGZhbHNlO1xuICB0cnkge1xuICAgIGZuKGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgaWYgKGRvbmUpIHJldHVyblxuICAgICAgZG9uZSA9IHRydWVcbiAgICAgIG9uRnVsZmlsbGVkKHZhbHVlKVxuICAgIH0sIGZ1bmN0aW9uIChyZWFzb24pIHtcbiAgICAgIGlmIChkb25lKSByZXR1cm5cbiAgICAgIGRvbmUgPSB0cnVlXG4gICAgICBvblJlamVjdGVkKHJlYXNvbilcbiAgICB9KVxuICB9IGNhdGNoIChleCkge1xuICAgIGlmIChkb25lKSByZXR1cm5cbiAgICBkb25lID0gdHJ1ZVxuICAgIG9uUmVqZWN0ZWQoZXgpXG4gIH1cbn1cbiIsIid1c2Ugc3RyaWN0JztcblxuLy9UaGlzIGZpbGUgY29udGFpbnMgdGhlbi9wcm9taXNlIHNwZWNpZmljIGV4dGVuc2lvbnMgdG8gdGhlIGNvcmUgcHJvbWlzZSBBUElcblxudmFyIFByb21pc2UgPSByZXF1aXJlKCcuL2NvcmUuanMnKVxudmFyIGFzYXAgPSByZXF1aXJlKCdhc2FwJylcblxubW9kdWxlLmV4cG9ydHMgPSBQcm9taXNlXG5cbi8qIFN0YXRpYyBGdW5jdGlvbnMgKi9cblxuZnVuY3Rpb24gVmFsdWVQcm9taXNlKHZhbHVlKSB7XG4gIHRoaXMudGhlbiA9IGZ1bmN0aW9uIChvbkZ1bGZpbGxlZCkge1xuICAgIGlmICh0eXBlb2Ygb25GdWxmaWxsZWQgIT09ICdmdW5jdGlvbicpIHJldHVybiB0aGlzXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGFzYXAoZnVuY3Rpb24gKCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJlc29sdmUob25GdWxmaWxsZWQodmFsdWUpKVxuICAgICAgICB9IGNhdGNoIChleCkge1xuICAgICAgICAgIHJlamVjdChleCk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgfVxufVxuVmFsdWVQcm9taXNlLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoUHJvbWlzZS5wcm90b3R5cGUpXG5cbnZhciBUUlVFID0gbmV3IFZhbHVlUHJvbWlzZSh0cnVlKVxudmFyIEZBTFNFID0gbmV3IFZhbHVlUHJvbWlzZShmYWxzZSlcbnZhciBOVUxMID0gbmV3IFZhbHVlUHJvbWlzZShudWxsKVxudmFyIFVOREVGSU5FRCA9IG5ldyBWYWx1ZVByb21pc2UodW5kZWZpbmVkKVxudmFyIFpFUk8gPSBuZXcgVmFsdWVQcm9taXNlKDApXG52YXIgRU1QVFlTVFJJTkcgPSBuZXcgVmFsdWVQcm9taXNlKCcnKVxuXG5Qcm9taXNlLnJlc29sdmUgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgUHJvbWlzZSkgcmV0dXJuIHZhbHVlXG5cbiAgaWYgKHZhbHVlID09PSBudWxsKSByZXR1cm4gTlVMTFxuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFVOREVGSU5FRFxuICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiBUUlVFXG4gIGlmICh2YWx1ZSA9PT0gZmFsc2UpIHJldHVybiBGQUxTRVxuICBpZiAodmFsdWUgPT09IDApIHJldHVybiBaRVJPXG4gIGlmICh2YWx1ZSA9PT0gJycpIHJldHVybiBFTVBUWVNUUklOR1xuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnIHx8IHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRyeSB7XG4gICAgICB2YXIgdGhlbiA9IHZhbHVlLnRoZW5cbiAgICAgIGlmICh0eXBlb2YgdGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UodGhlbi5iaW5kKHZhbHVlKSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChleCkge1xuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgICAgcmVqZWN0KGV4KVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFZhbHVlUHJvbWlzZSh2YWx1ZSlcbn1cblxuUHJvbWlzZS5mcm9tID0gUHJvbWlzZS5jYXN0ID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gIHZhciBlcnIgPSBuZXcgRXJyb3IoJ1Byb21pc2UuZnJvbSBhbmQgUHJvbWlzZS5jYXN0IGFyZSBkZXByZWNhdGVkLCB1c2UgUHJvbWlzZS5yZXNvbHZlIGluc3RlYWQnKVxuICBlcnIubmFtZSA9ICdXYXJuaW5nJ1xuICBjb25zb2xlLndhcm4oZXJyLnN0YWNrKVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHZhbHVlKVxufVxuXG5Qcm9taXNlLmRlbm9kZWlmeSA9IGZ1bmN0aW9uIChmbiwgYXJndW1lbnRDb3VudCkge1xuICBhcmd1bWVudENvdW50ID0gYXJndW1lbnRDb3VudCB8fCBJbmZpbml0eVxuICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpc1xuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKVxuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICB3aGlsZSAoYXJncy5sZW5ndGggJiYgYXJncy5sZW5ndGggPiBhcmd1bWVudENvdW50KSB7XG4gICAgICAgIGFyZ3MucG9wKClcbiAgICAgIH1cbiAgICAgIGFyZ3MucHVzaChmdW5jdGlvbiAoZXJyLCByZXMpIHtcbiAgICAgICAgaWYgKGVycikgcmVqZWN0KGVycilcbiAgICAgICAgZWxzZSByZXNvbHZlKHJlcylcbiAgICAgIH0pXG4gICAgICBmbi5hcHBseShzZWxmLCBhcmdzKVxuICAgIH0pXG4gIH1cbn1cblByb21pc2Uubm9kZWlmeSA9IGZ1bmN0aW9uIChmbikge1xuICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKVxuICAgIHZhciBjYWxsYmFjayA9IHR5cGVvZiBhcmdzW2FyZ3MubGVuZ3RoIC0gMV0gPT09ICdmdW5jdGlvbicgPyBhcmdzLnBvcCgpIDogbnVsbFxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKS5ub2RlaWZ5KGNhbGxiYWNrKVxuICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICBpZiAoY2FsbGJhY2sgPT09IG51bGwgfHwgdHlwZW9mIGNhbGxiYWNrID09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7IHJlamVjdChleCkgfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFzYXAoZnVuY3Rpb24gKCkge1xuICAgICAgICAgIGNhbGxiYWNrKGV4KVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5Qcm9taXNlLmFsbCA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIGNhbGxlZFdpdGhBcnJheSA9IGFyZ3VtZW50cy5sZW5ndGggPT09IDEgJiYgQXJyYXkuaXNBcnJheShhcmd1bWVudHNbMF0pXG4gIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoY2FsbGVkV2l0aEFycmF5ID8gYXJndW1lbnRzWzBdIDogYXJndW1lbnRzKVxuXG4gIGlmICghY2FsbGVkV2l0aEFycmF5KSB7XG4gICAgdmFyIGVyciA9IG5ldyBFcnJvcignUHJvbWlzZS5hbGwgc2hvdWxkIGJlIGNhbGxlZCB3aXRoIGEgc2luZ2xlIGFycmF5LCBjYWxsaW5nIGl0IHdpdGggbXVsdGlwbGUgYXJndW1lbnRzIGlzIGRlcHJlY2F0ZWQnKVxuICAgIGVyci5uYW1lID0gJ1dhcm5pbmcnXG4gICAgY29uc29sZS53YXJuKGVyci5zdGFjaylcbiAgfVxuXG4gIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgaWYgKGFyZ3MubGVuZ3RoID09PSAwKSByZXR1cm4gcmVzb2x2ZShbXSlcbiAgICB2YXIgcmVtYWluaW5nID0gYXJncy5sZW5ndGhcbiAgICBmdW5jdGlvbiByZXMoaSwgdmFsKSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAodmFsICYmICh0eXBlb2YgdmFsID09PSAnb2JqZWN0JyB8fCB0eXBlb2YgdmFsID09PSAnZnVuY3Rpb24nKSkge1xuICAgICAgICAgIHZhciB0aGVuID0gdmFsLnRoZW5cbiAgICAgICAgICBpZiAodHlwZW9mIHRoZW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHRoZW4uY2FsbCh2YWwsIGZ1bmN0aW9uICh2YWwpIHsgcmVzKGksIHZhbCkgfSwgcmVqZWN0KVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGFyZ3NbaV0gPSB2YWxcbiAgICAgICAgaWYgKC0tcmVtYWluaW5nID09PSAwKSB7XG4gICAgICAgICAgcmVzb2x2ZShhcmdzKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgICAgcmVqZWN0KGV4KVxuICAgICAgfVxuICAgIH1cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIHJlcyhpLCBhcmdzW2ldKVxuICAgIH1cbiAgfSlcbn1cblxuUHJvbWlzZS5yZWplY3QgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHsgXG4gICAgcmVqZWN0KHZhbHVlKTtcbiAgfSk7XG59XG5cblByb21pc2UucmFjZSA9IGZ1bmN0aW9uICh2YWx1ZXMpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHsgXG4gICAgdmFsdWVzLmZvckVhY2goZnVuY3Rpb24odmFsdWUpe1xuICAgICAgUHJvbWlzZS5yZXNvbHZlKHZhbHVlKS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG4gICAgfSlcbiAgfSk7XG59XG5cbi8qIFByb3RvdHlwZSBNZXRob2RzICovXG5cblByb21pc2UucHJvdG90eXBlLmRvbmUgPSBmdW5jdGlvbiAob25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQpIHtcbiAgdmFyIHNlbGYgPSBhcmd1bWVudHMubGVuZ3RoID8gdGhpcy50aGVuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB0aGlzXG4gIHNlbGYudGhlbihudWxsLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgYXNhcChmdW5jdGlvbiAoKSB7XG4gICAgICB0aHJvdyBlcnJcbiAgICB9KVxuICB9KVxufVxuXG5Qcm9taXNlLnByb3RvdHlwZS5ub2RlaWZ5ID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgIT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHRoaXNcblxuICB0aGlzLnRoZW4oZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgYXNhcChmdW5jdGlvbiAoKSB7XG4gICAgICBjYWxsYmFjayhudWxsLCB2YWx1ZSlcbiAgICB9KVxuICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgYXNhcChmdW5jdGlvbiAoKSB7XG4gICAgICBjYWxsYmFjayhlcnIpXG4gICAgfSlcbiAgfSlcbn1cblxuUHJvbWlzZS5wcm90b3R5cGVbJ2NhdGNoJ10gPSBmdW5jdGlvbiAob25SZWplY3RlZCkge1xuICByZXR1cm4gdGhpcy50aGVuKG51bGwsIG9uUmVqZWN0ZWQpO1xufVxuIiwiKGZ1bmN0aW9uIChwcm9jZXNzKXtcblxuLy8gVXNlIHRoZSBmYXN0ZXN0IHBvc3NpYmxlIG1lYW5zIHRvIGV4ZWN1dGUgYSB0YXNrIGluIGEgZnV0dXJlIHR1cm5cbi8vIG9mIHRoZSBldmVudCBsb29wLlxuXG4vLyBsaW5rZWQgbGlzdCBvZiB0YXNrcyAoc2luZ2xlLCB3aXRoIGhlYWQgbm9kZSlcbnZhciBoZWFkID0ge3Rhc2s6IHZvaWQgMCwgbmV4dDogbnVsbH07XG52YXIgdGFpbCA9IGhlYWQ7XG52YXIgZmx1c2hpbmcgPSBmYWxzZTtcbnZhciByZXF1ZXN0Rmx1c2ggPSB2b2lkIDA7XG52YXIgaXNOb2RlSlMgPSBmYWxzZTtcblxuZnVuY3Rpb24gZmx1c2goKSB7XG4gICAgLyoganNoaW50IGxvb3BmdW5jOiB0cnVlICovXG5cbiAgICB3aGlsZSAoaGVhZC5uZXh0KSB7XG4gICAgICAgIGhlYWQgPSBoZWFkLm5leHQ7XG4gICAgICAgIHZhciB0YXNrID0gaGVhZC50YXNrO1xuICAgICAgICBoZWFkLnRhc2sgPSB2b2lkIDA7XG4gICAgICAgIHZhciBkb21haW4gPSBoZWFkLmRvbWFpbjtcblxuICAgICAgICBpZiAoZG9tYWluKSB7XG4gICAgICAgICAgICBoZWFkLmRvbWFpbiA9IHZvaWQgMDtcbiAgICAgICAgICAgIGRvbWFpbi5lbnRlcigpO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRhc2soKTtcblxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBpZiAoaXNOb2RlSlMpIHtcbiAgICAgICAgICAgICAgICAvLyBJbiBub2RlLCB1bmNhdWdodCBleGNlcHRpb25zIGFyZSBjb25zaWRlcmVkIGZhdGFsIGVycm9ycy5cbiAgICAgICAgICAgICAgICAvLyBSZS10aHJvdyB0aGVtIHN5bmNocm9ub3VzbHkgdG8gaW50ZXJydXB0IGZsdXNoaW5nIVxuXG4gICAgICAgICAgICAgICAgLy8gRW5zdXJlIGNvbnRpbnVhdGlvbiBpZiB0aGUgdW5jYXVnaHQgZXhjZXB0aW9uIGlzIHN1cHByZXNzZWRcbiAgICAgICAgICAgICAgICAvLyBsaXN0ZW5pbmcgXCJ1bmNhdWdodEV4Y2VwdGlvblwiIGV2ZW50cyAoYXMgZG9tYWlucyBkb2VzKS5cbiAgICAgICAgICAgICAgICAvLyBDb250aW51ZSBpbiBuZXh0IGV2ZW50IHRvIGF2b2lkIHRpY2sgcmVjdXJzaW9uLlxuICAgICAgICAgICAgICAgIGlmIChkb21haW4pIHtcbiAgICAgICAgICAgICAgICAgICAgZG9tYWluLmV4aXQoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dChmbHVzaCwgMCk7XG4gICAgICAgICAgICAgICAgaWYgKGRvbWFpbikge1xuICAgICAgICAgICAgICAgICAgICBkb21haW4uZW50ZXIoKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIEluIGJyb3dzZXJzLCB1bmNhdWdodCBleGNlcHRpb25zIGFyZSBub3QgZmF0YWwuXG4gICAgICAgICAgICAgICAgLy8gUmUtdGhyb3cgdGhlbSBhc3luY2hyb25vdXNseSB0byBhdm9pZCBzbG93LWRvd25zLlxuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChkb21haW4pIHtcbiAgICAgICAgICAgIGRvbWFpbi5leGl0KCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmbHVzaGluZyA9IGZhbHNlO1xufVxuXG5pZiAodHlwZW9mIHByb2Nlc3MgIT09IFwidW5kZWZpbmVkXCIgJiYgcHJvY2Vzcy5uZXh0VGljaykge1xuICAgIC8vIE5vZGUuanMgYmVmb3JlIDAuOS4gTm90ZSB0aGF0IHNvbWUgZmFrZS1Ob2RlIGVudmlyb25tZW50cywgbGlrZSB0aGVcbiAgICAvLyBNb2NoYSB0ZXN0IHJ1bm5lciwgaW50cm9kdWNlIGEgYHByb2Nlc3NgIGdsb2JhbCB3aXRob3V0IGEgYG5leHRUaWNrYC5cbiAgICBpc05vZGVKUyA9IHRydWU7XG5cbiAgICByZXF1ZXN0Rmx1c2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHByb2Nlc3MubmV4dFRpY2soZmx1c2gpO1xuICAgIH07XG5cbn0gZWxzZSBpZiAodHlwZW9mIHNldEltbWVkaWF0ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgLy8gSW4gSUUxMCwgTm9kZS5qcyAwLjkrLCBvciBodHRwczovL2dpdGh1Yi5jb20vTm9ibGVKUy9zZXRJbW1lZGlhdGVcbiAgICBpZiAodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICByZXF1ZXN0Rmx1c2ggPSBzZXRJbW1lZGlhdGUuYmluZCh3aW5kb3csIGZsdXNoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXF1ZXN0Rmx1c2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzZXRJbW1lZGlhdGUoZmx1c2gpO1xuICAgICAgICB9O1xuICAgIH1cblxufSBlbHNlIGlmICh0eXBlb2YgTWVzc2FnZUNoYW5uZWwgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAvLyBtb2Rlcm4gYnJvd3NlcnNcbiAgICAvLyBodHRwOi8vd3d3Lm5vbmJsb2NraW5nLmlvLzIwMTEvMDYvd2luZG93bmV4dHRpY2suaHRtbFxuICAgIHZhciBjaGFubmVsID0gbmV3IE1lc3NhZ2VDaGFubmVsKCk7XG4gICAgY2hhbm5lbC5wb3J0MS5vbm1lc3NhZ2UgPSBmbHVzaDtcbiAgICByZXF1ZXN0Rmx1c2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGNoYW5uZWwucG9ydDIucG9zdE1lc3NhZ2UoMCk7XG4gICAgfTtcblxufSBlbHNlIHtcbiAgICAvLyBvbGQgYnJvd3NlcnNcbiAgICByZXF1ZXN0Rmx1c2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZmx1c2gsIDApO1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIGFzYXAodGFzaykge1xuICAgIHRhaWwgPSB0YWlsLm5leHQgPSB7XG4gICAgICAgIHRhc2s6IHRhc2ssXG4gICAgICAgIGRvbWFpbjogaXNOb2RlSlMgJiYgcHJvY2Vzcy5kb21haW4sXG4gICAgICAgIG5leHQ6IG51bGxcbiAgICB9O1xuXG4gICAgaWYgKCFmbHVzaGluZykge1xuICAgICAgICBmbHVzaGluZyA9IHRydWU7XG4gICAgICAgIHJlcXVlc3RGbHVzaCgpO1xuICAgIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gYXNhcDtcblxuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIi9Vc2Vycy9qcG9jaHlsYS9Qcm9qZWN0cy90cmV6b3IuanMvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2luc2VydC1tb2R1bGUtZ2xvYmFscy9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzXCIpKSIsIihmdW5jdGlvbiAocm9vdCkge1xuICAgXCJ1c2Ugc3RyaWN0XCI7XG5cbi8qKioqKiB1bm9ybS5qcyAqKioqKi9cblxuLypcbiAqIFVuaWNvZGVOb3JtYWxpemVyIDEuMC4wXG4gKiBDb3B5cmlnaHQgKGMpIDIwMDggTWF0c3V6YVxuICogRHVhbCBsaWNlbnNlZCB1bmRlciB0aGUgTUlUIChNSVQtTElDRU5TRS50eHQpIGFuZCBHUEwgKEdQTC1MSUNFTlNFLnR4dCkgbGljZW5zZXMuXG4gKiAkRGF0ZTogMjAwOC0wNi0wNSAxNjo0NDoxNyArMDIwMCAoVGh1LCAwNSBKdW4gMjAwOCkgJFxuICogJFJldjogMTMzMDkgJFxuICovXG5cbiAgIHZhciBERUZBVUxUX0ZFQVRVUkUgPSBbbnVsbCwgMCwge31dO1xuICAgdmFyIENBQ0hFX1RIUkVTSE9MRCA9IDEwO1xuICAgdmFyIFNCYXNlID0gMHhBQzAwLCBMQmFzZSA9IDB4MTEwMCwgVkJhc2UgPSAweDExNjEsIFRCYXNlID0gMHgxMUE3LCBMQ291bnQgPSAxOSwgVkNvdW50ID0gMjEsIFRDb3VudCA9IDI4O1xuICAgdmFyIE5Db3VudCA9IFZDb3VudCAqIFRDb3VudDsgLy8gNTg4XG4gICB2YXIgU0NvdW50ID0gTENvdW50ICogTkNvdW50OyAvLyAxMTE3MlxuXG4gICB2YXIgVUNoYXIgPSBmdW5jdGlvbihjcCwgZmVhdHVyZSl7XG4gICAgICB0aGlzLmNvZGVwb2ludCA9IGNwO1xuICAgICAgdGhpcy5mZWF0dXJlID0gZmVhdHVyZTtcbiAgIH07XG5cbiAgIC8vIFN0cmF0ZWdpZXNcbiAgIHZhciBjYWNoZSA9IHt9O1xuICAgdmFyIGNhY2hlQ291bnRlciA9IFtdO1xuICAgZm9yICh2YXIgaSA9IDA7IGkgPD0gMHhGRjsgKytpKXtcbiAgICAgIGNhY2hlQ291bnRlcltpXSA9IDA7XG4gICB9XG5cbiAgIGZ1bmN0aW9uIGZyb21DYWNoZShuZXh0LCBjcCwgbmVlZEZlYXR1cmUpe1xuICAgICAgdmFyIHJldCA9IGNhY2hlW2NwXTtcbiAgICAgIGlmKCFyZXQpe1xuICAgICAgICAgcmV0ID0gbmV4dChjcCwgbmVlZEZlYXR1cmUpO1xuICAgICAgICAgaWYoISFyZXQuZmVhdHVyZSAmJiArK2NhY2hlQ291bnRlclsoY3AgPj4gOCkgJiAweEZGXSA+IENBQ0hFX1RIUkVTSE9MRCl7XG4gICAgICAgICAgICBjYWNoZVtjcF0gPSByZXQ7XG4gICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcmV0O1xuICAgfVxuXG4gICBmdW5jdGlvbiBmcm9tRGF0YShuZXh0LCBjcCwgbmVlZEZlYXR1cmUpe1xuICAgICAgdmFyIGhhc2ggPSBjcCAmIDB4RkYwMDtcbiAgICAgIHZhciBkdW5pdCA9IFVDaGFyLnVkYXRhW2hhc2hdIHx8IHt9O1xuICAgICAgdmFyIGYgPSBkdW5pdFtjcF07XG4gICAgICByZXR1cm4gZiA/IG5ldyBVQ2hhcihjcCwgZikgOiBuZXcgVUNoYXIoY3AsIERFRkFVTFRfRkVBVFVSRSk7XG4gICB9XG4gICBmdW5jdGlvbiBmcm9tQ3BPbmx5KG5leHQsIGNwLCBuZWVkRmVhdHVyZSl7XG4gICAgICByZXR1cm4gISFuZWVkRmVhdHVyZSA/IG5leHQoY3AsIG5lZWRGZWF0dXJlKSA6IG5ldyBVQ2hhcihjcCwgbnVsbCk7XG4gICB9XG4gICBmdW5jdGlvbiBmcm9tUnVsZUJhc2VkSmFtbyhuZXh0LCBjcCwgbmVlZEZlYXR1cmUpe1xuICAgICAgdmFyIGo7XG4gICAgICBpZihjcCA8IExCYXNlIHx8IChMQmFzZSArIExDb3VudCA8PSBjcCAmJiBjcCA8IFNCYXNlKSB8fCAoU0Jhc2UgKyBTQ291bnQgPCBjcCkpe1xuICAgICAgICAgcmV0dXJuIG5leHQoY3AsIG5lZWRGZWF0dXJlKTtcbiAgICAgIH1cbiAgICAgIGlmKExCYXNlIDw9IGNwICYmIGNwIDwgTEJhc2UgKyBMQ291bnQpe1xuICAgICAgICAgdmFyIGMgPSB7fTtcbiAgICAgICAgIHZhciBiYXNlID0gKGNwIC0gTEJhc2UpICogVkNvdW50O1xuICAgICAgICAgZm9yIChqID0gMDsgaiA8IFZDb3VudDsgKytqKXtcbiAgICAgICAgICAgIGNbVkJhc2UgKyBqXSA9IFNCYXNlICsgVENvdW50ICogKGogKyBiYXNlKTtcbiAgICAgICAgIH1cbiAgICAgICAgIHJldHVybiBuZXcgVUNoYXIoY3AsIFssLGNdKTtcbiAgICAgIH1cblxuICAgICAgdmFyIFNJbmRleCA9IGNwIC0gU0Jhc2U7XG4gICAgICB2YXIgVEluZGV4ID0gU0luZGV4ICUgVENvdW50O1xuICAgICAgdmFyIGZlYXR1cmUgPSBbXTtcbiAgICAgIGlmKFRJbmRleCAhPT0gMCl7XG4gICAgICAgICBmZWF0dXJlWzBdID0gW1NCYXNlICsgU0luZGV4IC0gVEluZGV4LCBUQmFzZSArIFRJbmRleF07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAgZmVhdHVyZVswXSA9IFtMQmFzZSArIE1hdGguZmxvb3IoU0luZGV4IC8gTkNvdW50KSwgVkJhc2UgKyBNYXRoLmZsb29yKChTSW5kZXggJSBOQ291bnQpIC8gVENvdW50KV07XG4gICAgICAgICBmZWF0dXJlWzJdID0ge307XG4gICAgICAgICBmb3IgKGogPSAxOyBqIDwgVENvdW50OyArK2ope1xuICAgICAgICAgICAgZmVhdHVyZVsyXVtUQmFzZSArIGpdID0gY3AgKyBqO1xuICAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBVQ2hhcihjcCwgZmVhdHVyZSk7XG4gICB9XG4gICBmdW5jdGlvbiBmcm9tQ3BGaWx0ZXIobmV4dCwgY3AsIG5lZWRGZWF0dXJlKXtcbiAgICAgIHJldHVybiBjcCA8IDYwIHx8IDEzMzExIDwgY3AgJiYgY3AgPCA0MjYwNyA/IG5ldyBVQ2hhcihjcCwgREVGQVVMVF9GRUFUVVJFKSA6IG5leHQoY3AsIG5lZWRGZWF0dXJlKTtcbiAgIH1cblxuICAgdmFyIHN0cmF0ZWdpZXMgPSBbZnJvbUNwRmlsdGVyLCBmcm9tQ2FjaGUsIGZyb21DcE9ubHksIGZyb21SdWxlQmFzZWRKYW1vLCBmcm9tRGF0YV07XG5cbiAgIFVDaGFyLmZyb21DaGFyQ29kZSA9IHN0cmF0ZWdpZXMucmVkdWNlUmlnaHQoZnVuY3Rpb24gKG5leHQsIHN0cmF0ZWd5KSB7XG4gICAgICByZXR1cm4gZnVuY3Rpb24gKGNwLCBuZWVkRmVhdHVyZSkge1xuICAgICAgICAgcmV0dXJuIHN0cmF0ZWd5KG5leHQsIGNwLCBuZWVkRmVhdHVyZSk7XG4gICAgICB9O1xuICAgfSwgbnVsbCk7XG5cbiAgIFVDaGFyLmlzSGlnaFN1cnJvZ2F0ZSA9IGZ1bmN0aW9uKGNwKXtcbiAgICAgIHJldHVybiBjcCA+PSAweEQ4MDAgJiYgY3AgPD0gMHhEQkZGO1xuICAgfTtcbiAgIFVDaGFyLmlzTG93U3Vycm9nYXRlID0gZnVuY3Rpb24oY3Ape1xuICAgICAgcmV0dXJuIGNwID49IDB4REMwMCAmJiBjcCA8PSAweERGRkY7XG4gICB9O1xuXG4gICBVQ2hhci5wcm90b3R5cGUucHJlcEZlYXR1cmUgPSBmdW5jdGlvbigpe1xuICAgICAgaWYoIXRoaXMuZmVhdHVyZSl7XG4gICAgICAgICB0aGlzLmZlYXR1cmUgPSBVQ2hhci5mcm9tQ2hhckNvZGUodGhpcy5jb2RlcG9pbnQsIHRydWUpLmZlYXR1cmU7XG4gICAgICB9XG4gICB9O1xuXG4gICBVQ2hhci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpe1xuICAgICAgaWYodGhpcy5jb2RlcG9pbnQgPCAweDEwMDAwKXtcbiAgICAgICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKHRoaXMuY29kZXBvaW50KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgICB2YXIgeCA9IHRoaXMuY29kZXBvaW50IC0gMHgxMDAwMDtcbiAgICAgICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKE1hdGguZmxvb3IoeCAvIDB4NDAwKSArIDB4RDgwMCwgeCAlIDB4NDAwICsgMHhEQzAwKTtcbiAgICAgIH1cbiAgIH07XG5cbiAgIFVDaGFyLnByb3RvdHlwZS5nZXREZWNvbXAgPSBmdW5jdGlvbigpe1xuICAgICAgdGhpcy5wcmVwRmVhdHVyZSgpO1xuICAgICAgcmV0dXJuIHRoaXMuZmVhdHVyZVswXSB8fCBudWxsO1xuICAgfTtcblxuICAgVUNoYXIucHJvdG90eXBlLmlzQ29tcGF0aWJpbGl0eSA9IGZ1bmN0aW9uKCl7XG4gICAgICB0aGlzLnByZXBGZWF0dXJlKCk7XG4gICAgICByZXR1cm4gISF0aGlzLmZlYXR1cmVbMV0gJiYgKHRoaXMuZmVhdHVyZVsxXSAmICgxIDw8IDgpKTtcbiAgIH07XG4gICBVQ2hhci5wcm90b3R5cGUuaXNFeGNsdWRlID0gZnVuY3Rpb24oKXtcbiAgICAgIHRoaXMucHJlcEZlYXR1cmUoKTtcbiAgICAgIHJldHVybiAhIXRoaXMuZmVhdHVyZVsxXSAmJiAodGhpcy5mZWF0dXJlWzFdICYgKDEgPDwgOSkpO1xuICAgfTtcbiAgIFVDaGFyLnByb3RvdHlwZS5nZXRDYW5vbmljYWxDbGFzcyA9IGZ1bmN0aW9uKCl7XG4gICAgICB0aGlzLnByZXBGZWF0dXJlKCk7XG4gICAgICByZXR1cm4gISF0aGlzLmZlYXR1cmVbMV0gPyAodGhpcy5mZWF0dXJlWzFdICYgMHhmZikgOiAwO1xuICAgfTtcbiAgIFVDaGFyLnByb3RvdHlwZS5nZXRDb21wb3NpdGUgPSBmdW5jdGlvbihmb2xsb3dpbmcpe1xuICAgICAgdGhpcy5wcmVwRmVhdHVyZSgpO1xuICAgICAgaWYoIXRoaXMuZmVhdHVyZVsyXSl7XG4gICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICAgIHZhciBjcCA9IHRoaXMuZmVhdHVyZVsyXVtmb2xsb3dpbmcuY29kZXBvaW50XTtcbiAgICAgIHJldHVybiBjcCA/IFVDaGFyLmZyb21DaGFyQ29kZShjcCkgOiBudWxsO1xuICAgfTtcblxuICAgdmFyIFVDaGFySXRlcmF0b3IgPSBmdW5jdGlvbihzdHIpe1xuICAgICAgdGhpcy5zdHIgPSBzdHI7XG4gICAgICB0aGlzLmN1cnNvciA9IDA7XG4gICB9O1xuICAgVUNoYXJJdGVyYXRvci5wcm90b3R5cGUubmV4dCA9IGZ1bmN0aW9uKCl7XG4gICAgICBpZighIXRoaXMuc3RyICYmIHRoaXMuY3Vyc29yIDwgdGhpcy5zdHIubGVuZ3RoKXtcbiAgICAgICAgIHZhciBjcCA9IHRoaXMuc3RyLmNoYXJDb2RlQXQodGhpcy5jdXJzb3IrKyk7XG4gICAgICAgICB2YXIgZDtcbiAgICAgICAgIGlmKFVDaGFyLmlzSGlnaFN1cnJvZ2F0ZShjcCkgJiYgdGhpcy5jdXJzb3IgPCB0aGlzLnN0ci5sZW5ndGggJiYgVUNoYXIuaXNMb3dTdXJyb2dhdGUoKGQgPSB0aGlzLnN0ci5jaGFyQ29kZUF0KHRoaXMuY3Vyc29yKSkpKXtcbiAgICAgICAgICAgIGNwID0gKGNwIC0gMHhEODAwKSAqIDB4NDAwICsgKGQgLTB4REMwMCkgKyAweDEwMDAwO1xuICAgICAgICAgICAgKyt0aGlzLmN1cnNvcjtcbiAgICAgICAgIH1cbiAgICAgICAgIHJldHVybiBVQ2hhci5mcm9tQ2hhckNvZGUoY3ApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgIHRoaXMuc3RyID0gbnVsbDtcbiAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgfTtcblxuICAgdmFyIFJlY3Vyc0RlY29tcEl0ZXJhdG9yID0gZnVuY3Rpb24oaXQsIGNhbm8pe1xuICAgICAgdGhpcy5pdCA9IGl0O1xuICAgICAgdGhpcy5jYW5vbmljYWwgPSBjYW5vO1xuICAgICAgdGhpcy5yZXNCdWYgPSBbXTtcbiAgIH07XG5cbiAgIFJlY3Vyc0RlY29tcEl0ZXJhdG9yLnByb3RvdHlwZS5uZXh0ID0gZnVuY3Rpb24oKXtcbiAgICAgIGZ1bmN0aW9uIHJlY3Vyc2l2ZURlY29tcChjYW5vLCB1Y2hhcil7XG4gICAgICAgICB2YXIgZGVjb21wID0gdWNoYXIuZ2V0RGVjb21wKCk7XG4gICAgICAgICBpZighIWRlY29tcCAmJiAhKGNhbm8gJiYgdWNoYXIuaXNDb21wYXRpYmlsaXR5KCkpKXtcbiAgICAgICAgICAgIHZhciByZXQgPSBbXTtcbiAgICAgICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBkZWNvbXAubGVuZ3RoOyArK2kpe1xuICAgICAgICAgICAgICAgdmFyIGEgPSByZWN1cnNpdmVEZWNvbXAoY2FubywgVUNoYXIuZnJvbUNoYXJDb2RlKGRlY29tcFtpXSkpO1xuICAgICAgICAgICAgICAgLy9yZXQuY29uY2F0KGEpOyAvLzwtd2h5IGRvZXMgbm90IHRoaXMgd29yaz9cbiAgICAgICAgICAgICAgIC8vZm9sbG93aW5nIGJsb2NrIGlzIGEgd29ya2Fyb3VuZC5cbiAgICAgICAgICAgICAgIGZvcih2YXIgaiA9IDA7IGogPCBhLmxlbmd0aDsgKytqKXtcbiAgICAgICAgICAgICAgICAgIHJldC5wdXNoKGFbal0pO1xuICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHJldDtcbiAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gW3VjaGFyXTtcbiAgICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmKHRoaXMucmVzQnVmLmxlbmd0aCA9PT0gMCl7XG4gICAgICAgICB2YXIgdWNoYXIgPSB0aGlzLml0Lm5leHQoKTtcbiAgICAgICAgIGlmKCF1Y2hhcil7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgIH1cbiAgICAgICAgIHRoaXMucmVzQnVmID0gcmVjdXJzaXZlRGVjb21wKHRoaXMuY2Fub25pY2FsLCB1Y2hhcik7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5yZXNCdWYuc2hpZnQoKTtcbiAgIH07XG5cbiAgIHZhciBEZWNvbXBJdGVyYXRvciA9IGZ1bmN0aW9uKGl0KXtcbiAgICAgIHRoaXMuaXQgPSBpdDtcbiAgICAgIHRoaXMucmVzQnVmID0gW107XG4gICB9O1xuXG4gICBEZWNvbXBJdGVyYXRvci5wcm90b3R5cGUubmV4dCA9IGZ1bmN0aW9uKCl7XG4gICAgICB2YXIgY2M7XG4gICAgICBpZih0aGlzLnJlc0J1Zi5sZW5ndGggPT09IDApe1xuICAgICAgICAgZG97XG4gICAgICAgICAgICB2YXIgdWNoYXIgPSB0aGlzLml0Lm5leHQoKTtcbiAgICAgICAgICAgIGlmKCF1Y2hhcil7XG4gICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNjID0gdWNoYXIuZ2V0Q2Fub25pY2FsQ2xhc3MoKTtcbiAgICAgICAgICAgIHZhciBpbnNwdCA9IHRoaXMucmVzQnVmLmxlbmd0aDtcbiAgICAgICAgICAgIGlmKGNjICE9PSAwKXtcbiAgICAgICAgICAgICAgIGZvcig7IGluc3B0ID4gMDsgLS1pbnNwdCl7XG4gICAgICAgICAgICAgICAgICB2YXIgdWNoYXIyID0gdGhpcy5yZXNCdWZbaW5zcHQgLSAxXTtcbiAgICAgICAgICAgICAgICAgIHZhciBjYzIgPSB1Y2hhcjIuZ2V0Q2Fub25pY2FsQ2xhc3MoKTtcbiAgICAgICAgICAgICAgICAgIGlmKGNjMiA8PSBjYyl7XG4gICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMucmVzQnVmLnNwbGljZShpbnNwdCwgMCwgdWNoYXIpO1xuICAgICAgICAgfSB3aGlsZShjYyAhPT0gMCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5yZXNCdWYuc2hpZnQoKTtcbiAgIH07XG5cbiAgIHZhciBDb21wSXRlcmF0b3IgPSBmdW5jdGlvbihpdCl7XG4gICAgICB0aGlzLml0ID0gaXQ7XG4gICAgICB0aGlzLnByb2NCdWYgPSBbXTtcbiAgICAgIHRoaXMucmVzQnVmID0gW107XG4gICAgICB0aGlzLmxhc3RDbGFzcyA9IG51bGw7XG4gICB9O1xuXG4gICBDb21wSXRlcmF0b3IucHJvdG90eXBlLm5leHQgPSBmdW5jdGlvbigpe1xuICAgICAgd2hpbGUodGhpcy5yZXNCdWYubGVuZ3RoID09PSAwKXtcbiAgICAgICAgIHZhciB1Y2hhciA9IHRoaXMuaXQubmV4dCgpO1xuICAgICAgICAgaWYoIXVjaGFyKXtcbiAgICAgICAgICAgIHRoaXMucmVzQnVmID0gdGhpcy5wcm9jQnVmO1xuICAgICAgICAgICAgdGhpcy5wcm9jQnVmID0gW107XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgIH1cbiAgICAgICAgIGlmKHRoaXMucHJvY0J1Zi5sZW5ndGggPT09IDApe1xuICAgICAgICAgICAgdGhpcy5sYXN0Q2xhc3MgPSB1Y2hhci5nZXRDYW5vbmljYWxDbGFzcygpO1xuICAgICAgICAgICAgdGhpcy5wcm9jQnVmLnB1c2godWNoYXIpO1xuICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhciBzdGFydGVyID0gdGhpcy5wcm9jQnVmWzBdO1xuICAgICAgICAgICAgdmFyIGNvbXBvc2l0ZSA9IHN0YXJ0ZXIuZ2V0Q29tcG9zaXRlKHVjaGFyKTtcbiAgICAgICAgICAgIHZhciBjYyA9IHVjaGFyLmdldENhbm9uaWNhbENsYXNzKCk7XG4gICAgICAgICAgICBpZighIWNvbXBvc2l0ZSAmJiAodGhpcy5sYXN0Q2xhc3MgPCBjYyB8fCB0aGlzLmxhc3RDbGFzcyA9PT0gMCkpe1xuICAgICAgICAgICAgICAgdGhpcy5wcm9jQnVmWzBdID0gY29tcG9zaXRlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgIGlmKGNjID09PSAwKXtcbiAgICAgICAgICAgICAgICAgIHRoaXMucmVzQnVmID0gdGhpcy5wcm9jQnVmO1xuICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jQnVmID0gW107XG4gICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICB0aGlzLmxhc3RDbGFzcyA9IGNjO1xuICAgICAgICAgICAgICAgdGhpcy5wcm9jQnVmLnB1c2godWNoYXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMucmVzQnVmLnNoaWZ0KCk7XG4gICB9O1xuXG4gICB2YXIgY3JlYXRlSXRlcmF0b3IgPSBmdW5jdGlvbihtb2RlLCBzdHIpe1xuICAgICAgc3dpdGNoKG1vZGUpe1xuICAgICAgICAgY2FzZSBcIk5GRFwiOlxuICAgICAgICAgICAgcmV0dXJuIG5ldyBEZWNvbXBJdGVyYXRvcihuZXcgUmVjdXJzRGVjb21wSXRlcmF0b3IobmV3IFVDaGFySXRlcmF0b3Ioc3RyKSwgdHJ1ZSkpO1xuICAgICAgICAgY2FzZSBcIk5GS0RcIjpcbiAgICAgICAgICAgIHJldHVybiBuZXcgRGVjb21wSXRlcmF0b3IobmV3IFJlY3Vyc0RlY29tcEl0ZXJhdG9yKG5ldyBVQ2hhckl0ZXJhdG9yKHN0ciksIGZhbHNlKSk7XG4gICAgICAgICBjYXNlIFwiTkZDXCI6XG4gICAgICAgICAgICByZXR1cm4gbmV3IENvbXBJdGVyYXRvcihuZXcgRGVjb21wSXRlcmF0b3IobmV3IFJlY3Vyc0RlY29tcEl0ZXJhdG9yKG5ldyBVQ2hhckl0ZXJhdG9yKHN0ciksIHRydWUpKSk7XG4gICAgICAgICBjYXNlIFwiTkZLQ1wiOlxuICAgICAgICAgICAgcmV0dXJuIG5ldyBDb21wSXRlcmF0b3IobmV3IERlY29tcEl0ZXJhdG9yKG5ldyBSZWN1cnNEZWNvbXBJdGVyYXRvcihuZXcgVUNoYXJJdGVyYXRvcihzdHIpLCBmYWxzZSkpKTtcbiAgICAgIH1cbiAgICAgIHRocm93IG1vZGUgKyBcIiBpcyBpbnZhbGlkXCI7XG4gICB9O1xuICAgdmFyIG5vcm1hbGl6ZSA9IGZ1bmN0aW9uKG1vZGUsIHN0cil7XG4gICAgICB2YXIgaXQgPSBjcmVhdGVJdGVyYXRvcihtb2RlLCBzdHIpO1xuICAgICAgdmFyIHJldCA9IFwiXCI7XG4gICAgICB2YXIgdWNoYXI7XG4gICAgICB3aGlsZSghISh1Y2hhciA9IGl0Lm5leHQoKSkpe1xuICAgICAgICAgcmV0ICs9IHVjaGFyLnRvU3RyaW5nKCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmV0O1xuICAgfTtcblxuICAgLyogQVBJIGZ1bmN0aW9ucyAqL1xuICAgZnVuY3Rpb24gbmZkKHN0cil7XG4gICAgICByZXR1cm4gbm9ybWFsaXplKFwiTkZEXCIsIHN0cik7XG4gICB9XG5cbiAgIGZ1bmN0aW9uIG5ma2Qoc3RyKXtcbiAgICAgIHJldHVybiBub3JtYWxpemUoXCJORktEXCIsIHN0cik7XG4gICB9XG5cbiAgIGZ1bmN0aW9uIG5mYyhzdHIpe1xuICAgICAgcmV0dXJuIG5vcm1hbGl6ZShcIk5GQ1wiLCBzdHIpO1xuICAgfVxuXG4gICBmdW5jdGlvbiBuZmtjKHN0cil7XG4gICAgICByZXR1cm4gbm9ybWFsaXplKFwiTkZLQ1wiLCBzdHIpO1xuICAgfVxuXG4vKiBVbmljb2RlIGRhdGEgKi9cblVDaGFyLnVkYXRhPXtcbjA6ezYwOlssLHs4MjQ6ODgxNH1dLDYxOlssLHs4MjQ6ODgwMH1dLDYyOlssLHs4MjQ6ODgxNX1dLDY1OlssLHs3Njg6MTkyLDc2OToxOTMsNzcwOjE5NCw3NzE6MTk1LDc3MjoyNTYsNzc0OjI1OCw3NzU6NTUwLDc3NjoxOTYsNzc3Ojc4NDIsNzc4OjE5Nyw3ODA6NDYxLDc4Mzo1MTIsNzg1OjUxNCw4MDM6Nzg0MCw4MDU6NzY4MCw4MDg6MjYwfV0sNjY6Wywsezc3NTo3NjgyLDgwMzo3Njg0LDgxNzo3Njg2fV0sNjc6Wywsezc2OToyNjIsNzcwOjI2NCw3NzU6MjY2LDc4MDoyNjgsODA3OjE5OX1dLDY4OlssLHs3NzU6NzY5MCw3ODA6MjcwLDgwMzo3NjkyLDgwNzo3Njk2LDgxMzo3Njk4LDgxNzo3Njk0fV0sNjk6Wywsezc2ODoyMDAsNzY5OjIwMSw3NzA6MjAyLDc3MTo3ODY4LDc3MjoyNzQsNzc0OjI3Niw3NzU6Mjc4LDc3NjoyMDMsNzc3Ojc4NjYsNzgwOjI4Miw3ODM6NTE2LDc4NTo1MTgsODAzOjc4NjQsODA3OjU1Miw4MDg6MjgwLDgxMzo3NzA0LDgxNjo3NzA2fV0sNzA6Wywsezc3NTo3NzEwfV0sNzE6Wywsezc2OTo1MDAsNzcwOjI4NCw3NzI6NzcxMiw3NzQ6Mjg2LDc3NToyODgsNzgwOjQ4Niw4MDc6MjkwfV0sNzI6Wywsezc3MDoyOTIsNzc1Ojc3MTQsNzc2Ojc3MTgsNzgwOjU0Miw4MDM6NzcxNiw4MDc6NzcyMCw4MTQ6NzcyMn1dLDczOlssLHs3Njg6MjA0LDc2OToyMDUsNzcwOjIwNiw3NzE6Mjk2LDc3MjoyOTgsNzc0OjMwMCw3NzU6MzA0LDc3NjoyMDcsNzc3Ojc4ODAsNzgwOjQ2Myw3ODM6NTIwLDc4NTo1MjIsODAzOjc4ODIsODA4OjMwMiw4MTY6NzcyNH1dLDc0OlssLHs3NzA6MzA4fV0sNzU6Wywsezc2OTo3NzI4LDc4MDo0ODgsODAzOjc3MzAsODA3OjMxMCw4MTc6NzczMn1dLDc2OlssLHs3Njk6MzEzLDc4MDozMTcsODAzOjc3MzQsODA3OjMxNSw4MTM6Nzc0MCw4MTc6NzczOH1dLDc3OlssLHs3Njk6Nzc0Miw3NzU6Nzc0NCw4MDM6Nzc0Nn1dLDc4OlssLHs3Njg6NTA0LDc2OTozMjMsNzcxOjIwOSw3NzU6Nzc0OCw3ODA6MzI3LDgwMzo3NzUwLDgwNzozMjUsODEzOjc3NTQsODE3Ojc3NTJ9XSw3OTpbLCx7NzY4OjIxMCw3Njk6MjExLDc3MDoyMTIsNzcxOjIxMyw3NzI6MzMyLDc3NDozMzQsNzc1OjU1OCw3NzY6MjE0LDc3Nzo3ODg2LDc3OTozMzYsNzgwOjQ2NSw3ODM6NTI0LDc4NTo1MjYsNzk1OjQxNiw4MDM6Nzg4NCw4MDg6NDkwfV0sODA6Wywsezc2OTo3NzY0LDc3NTo3NzY2fV0sODI6Wywsezc2OTozNDAsNzc1Ojc3NjgsNzgwOjM0NCw3ODM6NTI4LDc4NTo1MzAsODAzOjc3NzAsODA3OjM0Miw4MTc6Nzc3NH1dLDgzOlssLHs3Njk6MzQ2LDc3MDozNDgsNzc1Ojc3NzYsNzgwOjM1Miw4MDM6Nzc3OCw4MDY6NTM2LDgwNzozNTB9XSw4NDpbLCx7Nzc1Ojc3ODYsNzgwOjM1Niw4MDM6Nzc4OCw4MDY6NTM4LDgwNzozNTQsODEzOjc3OTIsODE3Ojc3OTB9XSw4NTpbLCx7NzY4OjIxNyw3Njk6MjE4LDc3MDoyMTksNzcxOjM2MCw3NzI6MzYyLDc3NDozNjQsNzc2OjIyMCw3Nzc6NzkxMCw3Nzg6MzY2LDc3OTozNjgsNzgwOjQ2Nyw3ODM6NTMyLDc4NTo1MzQsNzk1OjQzMSw4MDM6NzkwOCw4MDQ6Nzc5NCw4MDg6MzcwLDgxMzo3Nzk4LDgxNjo3Nzk2fV0sODY6Wywsezc3MTo3ODA0LDgwMzo3ODA2fV0sODc6Wywsezc2ODo3ODA4LDc2OTo3ODEwLDc3MDozNzIsNzc1Ojc4MTQsNzc2Ojc4MTIsODAzOjc4MTZ9XSw4ODpbLCx7Nzc1Ojc4MTgsNzc2Ojc4MjB9XSw4OTpbLCx7NzY4Ojc5MjIsNzY5OjIyMSw3NzA6Mzc0LDc3MTo3OTI4LDc3Mjo1NjIsNzc1Ojc4MjIsNzc2OjM3Niw3Nzc6NzkyNiw4MDM6NzkyNH1dLDkwOlssLHs3Njk6Mzc3LDc3MDo3ODI0LDc3NTozNzksNzgwOjM4MSw4MDM6NzgyNiw4MTc6NzgyOH1dLDk3OlssLHs3Njg6MjI0LDc2OToyMjUsNzcwOjIyNiw3NzE6MjI3LDc3MjoyNTcsNzc0OjI1OSw3NzU6NTUxLDc3NjoyMjgsNzc3Ojc4NDMsNzc4OjIyOSw3ODA6NDYyLDc4Mzo1MTMsNzg1OjUxNSw4MDM6Nzg0MSw4MDU6NzY4MSw4MDg6MjYxfV0sOTg6Wywsezc3NTo3NjgzLDgwMzo3Njg1LDgxNzo3Njg3fV0sOTk6Wywsezc2OToyNjMsNzcwOjI2NSw3NzU6MjY3LDc4MDoyNjksODA3OjIzMX1dLDEwMDpbLCx7Nzc1Ojc2OTEsNzgwOjI3MSw4MDM6NzY5Myw4MDc6NzY5Nyw4MTM6NzY5OSw4MTc6NzY5NX1dLDEwMTpbLCx7NzY4OjIzMiw3Njk6MjMzLDc3MDoyMzQsNzcxOjc4NjksNzcyOjI3NSw3NzQ6Mjc3LDc3NToyNzksNzc2OjIzNSw3Nzc6Nzg2Nyw3ODA6MjgzLDc4Mzo1MTcsNzg1OjUxOSw4MDM6Nzg2NSw4MDc6NTUzLDgwODoyODEsODEzOjc3MDUsODE2Ojc3MDd9XSwxMDI6Wywsezc3NTo3NzExfV0sMTAzOlssLHs3Njk6NTAxLDc3MDoyODUsNzcyOjc3MTMsNzc0OjI4Nyw3NzU6Mjg5LDc4MDo0ODcsODA3OjI5MX1dLDEwNDpbLCx7NzcwOjI5Myw3NzU6NzcxNSw3NzY6NzcxOSw3ODA6NTQzLDgwMzo3NzE3LDgwNzo3NzIxLDgxNDo3NzIzLDgxNzo3ODMwfV0sMTA1OlssLHs3Njg6MjM2LDc2OToyMzcsNzcwOjIzOCw3NzE6Mjk3LDc3MjoyOTksNzc0OjMwMSw3NzY6MjM5LDc3Nzo3ODgxLDc4MDo0NjQsNzgzOjUyMSw3ODU6NTIzLDgwMzo3ODgzLDgwODozMDMsODE2Ojc3MjV9XSwxMDY6Wywsezc3MDozMDksNzgwOjQ5Nn1dLDEwNzpbLCx7NzY5Ojc3MjksNzgwOjQ4OSw4MDM6NzczMSw4MDc6MzExLDgxNzo3NzMzfV0sMTA4OlssLHs3Njk6MzE0LDc4MDozMTgsODAzOjc3MzUsODA3OjMxNiw4MTM6Nzc0MSw4MTc6NzczOX1dLDEwOTpbLCx7NzY5Ojc3NDMsNzc1Ojc3NDUsODAzOjc3NDd9XSwxMTA6Wywsezc2ODo1MDUsNzY5OjMyNCw3NzE6MjQxLDc3NTo3NzQ5LDc4MDozMjgsODAzOjc3NTEsODA3OjMyNiw4MTM6Nzc1NSw4MTc6Nzc1M31dLDExMTpbLCx7NzY4OjI0Miw3Njk6MjQzLDc3MDoyNDQsNzcxOjI0NSw3NzI6MzMzLDc3NDozMzUsNzc1OjU1OSw3NzY6MjQ2LDc3Nzo3ODg3LDc3OTozMzcsNzgwOjQ2Niw3ODM6NTI1LDc4NTo1MjcsNzk1OjQxNyw4MDM6Nzg4NSw4MDg6NDkxfV0sMTEyOlssLHs3Njk6Nzc2NSw3NzU6Nzc2N31dLDExNDpbLCx7NzY5OjM0MSw3NzU6Nzc2OSw3ODA6MzQ1LDc4Mzo1MjksNzg1OjUzMSw4MDM6Nzc3MSw4MDc6MzQzLDgxNzo3Nzc1fV0sMTE1OlssLHs3Njk6MzQ3LDc3MDozNDksNzc1Ojc3NzcsNzgwOjM1Myw4MDM6Nzc3OSw4MDY6NTM3LDgwNzozNTF9XSwxMTY6Wywsezc3NTo3Nzg3LDc3Njo3ODMxLDc4MDozNTcsODAzOjc3ODksODA2OjUzOSw4MDc6MzU1LDgxMzo3NzkzLDgxNzo3NzkxfV0sMTE3OlssLHs3Njg6MjQ5LDc2OToyNTAsNzcwOjI1MSw3NzE6MzYxLDc3MjozNjMsNzc0OjM2NSw3NzY6MjUyLDc3Nzo3OTExLDc3ODozNjcsNzc5OjM2OSw3ODA6NDY4LDc4Mzo1MzMsNzg1OjUzNSw3OTU6NDMyLDgwMzo3OTA5LDgwNDo3Nzk1LDgwODozNzEsODEzOjc3OTksODE2Ojc3OTd9XSwxMTg6Wywsezc3MTo3ODA1LDgwMzo3ODA3fV0sMTE5OlssLHs3Njg6NzgwOSw3Njk6NzgxMSw3NzA6MzczLDc3NTo3ODE1LDc3Njo3ODEzLDc3ODo3ODMyLDgwMzo3ODE3fV0sMTIwOlssLHs3NzU6NzgxOSw3NzY6NzgyMX1dLDEyMTpbLCx7NzY4Ojc5MjMsNzY5OjI1Myw3NzA6Mzc1LDc3MTo3OTI5LDc3Mjo1NjMsNzc1Ojc4MjMsNzc2OjI1NSw3Nzc6NzkyNyw3Nzg6NzgzMyw4MDM6NzkyNX1dLDEyMjpbLCx7NzY5OjM3OCw3NzA6NzgyNSw3NzU6MzgwLDc4MDozODIsODAzOjc4MjcsODE3Ojc4Mjl9XSwxNjA6W1szMl0sMjU2XSwxNjg6W1szMiw3NzZdLDI1Nix7NzY4OjgxNzMsNzY5OjkwMSw4MzQ6ODEyOX1dLDE3MDpbWzk3XSwyNTZdLDE3NTpbWzMyLDc3Ml0sMjU2XSwxNzg6W1s1MF0sMjU2XSwxNzk6W1s1MV0sMjU2XSwxODA6W1szMiw3NjldLDI1Nl0sMTgxOltbOTU2XSwyNTZdLDE4NDpbWzMyLDgwN10sMjU2XSwxODU6W1s0OV0sMjU2XSwxODY6W1sxMTFdLDI1Nl0sMTg4OltbNDksODI2MCw1Ml0sMjU2XSwxODk6W1s0OSw4MjYwLDUwXSwyNTZdLDE5MDpbWzUxLDgyNjAsNTJdLDI1Nl0sMTkyOltbNjUsNzY4XV0sMTkzOltbNjUsNzY5XV0sMTk0OltbNjUsNzcwXSwsezc2ODo3ODQ2LDc2OTo3ODQ0LDc3MTo3ODUwLDc3Nzo3ODQ4fV0sMTk1OltbNjUsNzcxXV0sMTk2OltbNjUsNzc2XSwsezc3Mjo0Nzh9XSwxOTc6W1s2NSw3NzhdLCx7NzY5OjUwNn1dLDE5ODpbLCx7NzY5OjUwOCw3NzI6NDgyfV0sMTk5OltbNjcsODA3XSwsezc2OTo3Njg4fV0sMjAwOltbNjksNzY4XV0sMjAxOltbNjksNzY5XV0sMjAyOltbNjksNzcwXSwsezc2ODo3ODcyLDc2OTo3ODcwLDc3MTo3ODc2LDc3Nzo3ODc0fV0sMjAzOltbNjksNzc2XV0sMjA0OltbNzMsNzY4XV0sMjA1OltbNzMsNzY5XV0sMjA2OltbNzMsNzcwXV0sMjA3OltbNzMsNzc2XSwsezc2OTo3NzI2fV0sMjA5OltbNzgsNzcxXV0sMjEwOltbNzksNzY4XV0sMjExOltbNzksNzY5XV0sMjEyOltbNzksNzcwXSwsezc2ODo3ODkwLDc2OTo3ODg4LDc3MTo3ODk0LDc3Nzo3ODkyfV0sMjEzOltbNzksNzcxXSwsezc2OTo3NzU2LDc3Mjo1NTYsNzc2Ojc3NTh9XSwyMTQ6W1s3OSw3NzZdLCx7NzcyOjU1NH1dLDIxNjpbLCx7NzY5OjUxMH1dLDIxNzpbWzg1LDc2OF1dLDIxODpbWzg1LDc2OV1dLDIxOTpbWzg1LDc3MF1dLDIyMDpbWzg1LDc3Nl0sLHs3Njg6NDc1LDc2OTo0NzEsNzcyOjQ2OSw3ODA6NDczfV0sMjIxOltbODksNzY5XV0sMjI0OltbOTcsNzY4XV0sMjI1OltbOTcsNzY5XV0sMjI2OltbOTcsNzcwXSwsezc2ODo3ODQ3LDc2OTo3ODQ1LDc3MTo3ODUxLDc3Nzo3ODQ5fV0sMjI3OltbOTcsNzcxXV0sMjI4OltbOTcsNzc2XSwsezc3Mjo0Nzl9XSwyMjk6W1s5Nyw3NzhdLCx7NzY5OjUwN31dLDIzMDpbLCx7NzY5OjUwOSw3NzI6NDgzfV0sMjMxOltbOTksODA3XSwsezc2OTo3Njg5fV0sMjMyOltbMTAxLDc2OF1dLDIzMzpbWzEwMSw3NjldXSwyMzQ6W1sxMDEsNzcwXSwsezc2ODo3ODczLDc2OTo3ODcxLDc3MTo3ODc3LDc3Nzo3ODc1fV0sMjM1OltbMTAxLDc3Nl1dLDIzNjpbWzEwNSw3NjhdXSwyMzc6W1sxMDUsNzY5XV0sMjM4OltbMTA1LDc3MF1dLDIzOTpbWzEwNSw3NzZdLCx7NzY5Ojc3Mjd9XSwyNDE6W1sxMTAsNzcxXV0sMjQyOltbMTExLDc2OF1dLDI0MzpbWzExMSw3NjldXSwyNDQ6W1sxMTEsNzcwXSwsezc2ODo3ODkxLDc2OTo3ODg5LDc3MTo3ODk1LDc3Nzo3ODkzfV0sMjQ1OltbMTExLDc3MV0sLHs3Njk6Nzc1Nyw3NzI6NTU3LDc3Njo3NzU5fV0sMjQ2OltbMTExLDc3Nl0sLHs3NzI6NTU1fV0sMjQ4OlssLHs3Njk6NTExfV0sMjQ5OltbMTE3LDc2OF1dLDI1MDpbWzExNyw3NjldXSwyNTE6W1sxMTcsNzcwXV0sMjUyOltbMTE3LDc3Nl0sLHs3Njg6NDc2LDc2OTo0NzIsNzcyOjQ3MCw3ODA6NDc0fV0sMjUzOltbMTIxLDc2OV1dLDI1NTpbWzEyMSw3NzZdXX0sXG4yNTY6ezI1NjpbWzY1LDc3Ml1dLDI1NzpbWzk3LDc3Ml1dLDI1ODpbWzY1LDc3NF0sLHs3Njg6Nzg1Niw3Njk6Nzg1NCw3NzE6Nzg2MCw3Nzc6Nzg1OH1dLDI1OTpbWzk3LDc3NF0sLHs3Njg6Nzg1Nyw3Njk6Nzg1NSw3NzE6Nzg2MSw3Nzc6Nzg1OX1dLDI2MDpbWzY1LDgwOF1dLDI2MTpbWzk3LDgwOF1dLDI2MjpbWzY3LDc2OV1dLDI2MzpbWzk5LDc2OV1dLDI2NDpbWzY3LDc3MF1dLDI2NTpbWzk5LDc3MF1dLDI2NjpbWzY3LDc3NV1dLDI2NzpbWzk5LDc3NV1dLDI2ODpbWzY3LDc4MF1dLDI2OTpbWzk5LDc4MF1dLDI3MDpbWzY4LDc4MF1dLDI3MTpbWzEwMCw3ODBdXSwyNzQ6W1s2OSw3NzJdLCx7NzY4Ojc3MDAsNzY5Ojc3MDJ9XSwyNzU6W1sxMDEsNzcyXSwsezc2ODo3NzAxLDc2OTo3NzAzfV0sMjc2OltbNjksNzc0XV0sMjc3OltbMTAxLDc3NF1dLDI3ODpbWzY5LDc3NV1dLDI3OTpbWzEwMSw3NzVdXSwyODA6W1s2OSw4MDhdXSwyODE6W1sxMDEsODA4XV0sMjgyOltbNjksNzgwXV0sMjgzOltbMTAxLDc4MF1dLDI4NDpbWzcxLDc3MF1dLDI4NTpbWzEwMyw3NzBdXSwyODY6W1s3MSw3NzRdXSwyODc6W1sxMDMsNzc0XV0sMjg4OltbNzEsNzc1XV0sMjg5OltbMTAzLDc3NV1dLDI5MDpbWzcxLDgwN11dLDI5MTpbWzEwMyw4MDddXSwyOTI6W1s3Miw3NzBdXSwyOTM6W1sxMDQsNzcwXV0sMjk2OltbNzMsNzcxXV0sMjk3OltbMTA1LDc3MV1dLDI5ODpbWzczLDc3Ml1dLDI5OTpbWzEwNSw3NzJdXSwzMDA6W1s3Myw3NzRdXSwzMDE6W1sxMDUsNzc0XV0sMzAyOltbNzMsODA4XV0sMzAzOltbMTA1LDgwOF1dLDMwNDpbWzczLDc3NV1dLDMwNjpbWzczLDc0XSwyNTZdLDMwNzpbWzEwNSwxMDZdLDI1Nl0sMzA4OltbNzQsNzcwXV0sMzA5OltbMTA2LDc3MF1dLDMxMDpbWzc1LDgwN11dLDMxMTpbWzEwNyw4MDddXSwzMTM6W1s3Niw3NjldXSwzMTQ6W1sxMDgsNzY5XV0sMzE1OltbNzYsODA3XV0sMzE2OltbMTA4LDgwN11dLDMxNzpbWzc2LDc4MF1dLDMxODpbWzEwOCw3ODBdXSwzMTk6W1s3NiwxODNdLDI1Nl0sMzIwOltbMTA4LDE4M10sMjU2XSwzMjM6W1s3OCw3NjldXSwzMjQ6W1sxMTAsNzY5XV0sMzI1OltbNzgsODA3XV0sMzI2OltbMTEwLDgwN11dLDMyNzpbWzc4LDc4MF1dLDMyODpbWzExMCw3ODBdXSwzMjk6W1s3MDAsMTEwXSwyNTZdLDMzMjpbWzc5LDc3Ml0sLHs3Njg6Nzc2MCw3Njk6Nzc2Mn1dLDMzMzpbWzExMSw3NzJdLCx7NzY4Ojc3NjEsNzY5Ojc3NjN9XSwzMzQ6W1s3OSw3NzRdXSwzMzU6W1sxMTEsNzc0XV0sMzM2OltbNzksNzc5XV0sMzM3OltbMTExLDc3OV1dLDM0MDpbWzgyLDc2OV1dLDM0MTpbWzExNCw3NjldXSwzNDI6W1s4Miw4MDddXSwzNDM6W1sxMTQsODA3XV0sMzQ0OltbODIsNzgwXV0sMzQ1OltbMTE0LDc4MF1dLDM0NjpbWzgzLDc2OV0sLHs3NzU6Nzc4MH1dLDM0NzpbWzExNSw3NjldLCx7Nzc1Ojc3ODF9XSwzNDg6W1s4Myw3NzBdXSwzNDk6W1sxMTUsNzcwXV0sMzUwOltbODMsODA3XV0sMzUxOltbMTE1LDgwN11dLDM1MjpbWzgzLDc4MF0sLHs3NzU6Nzc4Mn1dLDM1MzpbWzExNSw3ODBdLCx7Nzc1Ojc3ODN9XSwzNTQ6W1s4NCw4MDddXSwzNTU6W1sxMTYsODA3XV0sMzU2OltbODQsNzgwXV0sMzU3OltbMTE2LDc4MF1dLDM2MDpbWzg1LDc3MV0sLHs3Njk6NzgwMH1dLDM2MTpbWzExNyw3NzFdLCx7NzY5Ojc4MDF9XSwzNjI6W1s4NSw3NzJdLCx7Nzc2Ojc4MDJ9XSwzNjM6W1sxMTcsNzcyXSwsezc3Njo3ODAzfV0sMzY0OltbODUsNzc0XV0sMzY1OltbMTE3LDc3NF1dLDM2NjpbWzg1LDc3OF1dLDM2NzpbWzExNyw3NzhdXSwzNjg6W1s4NSw3NzldXSwzNjk6W1sxMTcsNzc5XV0sMzcwOltbODUsODA4XV0sMzcxOltbMTE3LDgwOF1dLDM3MjpbWzg3LDc3MF1dLDM3MzpbWzExOSw3NzBdXSwzNzQ6W1s4OSw3NzBdXSwzNzU6W1sxMjEsNzcwXV0sMzc2OltbODksNzc2XV0sMzc3OltbOTAsNzY5XV0sMzc4OltbMTIyLDc2OV1dLDM3OTpbWzkwLDc3NV1dLDM4MDpbWzEyMiw3NzVdXSwzODE6W1s5MCw3ODBdXSwzODI6W1sxMjIsNzgwXV0sMzgzOltbMTE1XSwyNTYsezc3NTo3ODM1fV0sNDE2OltbNzksNzk1XSwsezc2ODo3OTAwLDc2OTo3ODk4LDc3MTo3OTA0LDc3Nzo3OTAyLDgwMzo3OTA2fV0sNDE3OltbMTExLDc5NV0sLHs3Njg6NzkwMSw3Njk6Nzg5OSw3NzE6NzkwNSw3Nzc6NzkwMyw4MDM6NzkwN31dLDQzMTpbWzg1LDc5NV0sLHs3Njg6NzkxNCw3Njk6NzkxMiw3NzE6NzkxOCw3Nzc6NzkxNiw4MDM6NzkyMH1dLDQzMjpbWzExNyw3OTVdLCx7NzY4Ojc5MTUsNzY5Ojc5MTMsNzcxOjc5MTksNzc3Ojc5MTcsODAzOjc5MjF9XSw0Mzk6Wywsezc4MDo0OTR9XSw0NTI6W1s2OCwzODFdLDI1Nl0sNDUzOltbNjgsMzgyXSwyNTZdLDQ1NDpbWzEwMCwzODJdLDI1Nl0sNDU1OltbNzYsNzRdLDI1Nl0sNDU2OltbNzYsMTA2XSwyNTZdLDQ1NzpbWzEwOCwxMDZdLDI1Nl0sNDU4OltbNzgsNzRdLDI1Nl0sNDU5OltbNzgsMTA2XSwyNTZdLDQ2MDpbWzExMCwxMDZdLDI1Nl0sNDYxOltbNjUsNzgwXV0sNDYyOltbOTcsNzgwXV0sNDYzOltbNzMsNzgwXV0sNDY0OltbMTA1LDc4MF1dLDQ2NTpbWzc5LDc4MF1dLDQ2NjpbWzExMSw3ODBdXSw0Njc6W1s4NSw3ODBdXSw0Njg6W1sxMTcsNzgwXV0sNDY5OltbMjIwLDc3Ml1dLDQ3MDpbWzI1Miw3NzJdXSw0NzE6W1syMjAsNzY5XV0sNDcyOltbMjUyLDc2OV1dLDQ3MzpbWzIyMCw3ODBdXSw0NzQ6W1syNTIsNzgwXV0sNDc1OltbMjIwLDc2OF1dLDQ3NjpbWzI1Miw3NjhdXSw0Nzg6W1sxOTYsNzcyXV0sNDc5OltbMjI4LDc3Ml1dLDQ4MDpbWzU1MCw3NzJdXSw0ODE6W1s1NTEsNzcyXV0sNDgyOltbMTk4LDc3Ml1dLDQ4MzpbWzIzMCw3NzJdXSw0ODY6W1s3MSw3ODBdXSw0ODc6W1sxMDMsNzgwXV0sNDg4OltbNzUsNzgwXV0sNDg5OltbMTA3LDc4MF1dLDQ5MDpbWzc5LDgwOF0sLHs3NzI6NDkyfV0sNDkxOltbMTExLDgwOF0sLHs3NzI6NDkzfV0sNDkyOltbNDkwLDc3Ml1dLDQ5MzpbWzQ5MSw3NzJdXSw0OTQ6W1s0MzksNzgwXV0sNDk1OltbNjU4LDc4MF1dLDQ5NjpbWzEwNiw3ODBdXSw0OTc6W1s2OCw5MF0sMjU2XSw0OTg6W1s2OCwxMjJdLDI1Nl0sNDk5OltbMTAwLDEyMl0sMjU2XSw1MDA6W1s3MSw3NjldXSw1MDE6W1sxMDMsNzY5XV0sNTA0OltbNzgsNzY4XV0sNTA1OltbMTEwLDc2OF1dLDUwNjpbWzE5Nyw3NjldXSw1MDc6W1syMjksNzY5XV0sNTA4OltbMTk4LDc2OV1dLDUwOTpbWzIzMCw3NjldXSw1MTA6W1syMTYsNzY5XV0sNTExOltbMjQ4LDc2OV1dLDY2MDQ1OlssMjIwXX0sXG41MTI6ezUxMjpbWzY1LDc4M11dLDUxMzpbWzk3LDc4M11dLDUxNDpbWzY1LDc4NV1dLDUxNTpbWzk3LDc4NV1dLDUxNjpbWzY5LDc4M11dLDUxNzpbWzEwMSw3ODNdXSw1MTg6W1s2OSw3ODVdXSw1MTk6W1sxMDEsNzg1XV0sNTIwOltbNzMsNzgzXV0sNTIxOltbMTA1LDc4M11dLDUyMjpbWzczLDc4NV1dLDUyMzpbWzEwNSw3ODVdXSw1MjQ6W1s3OSw3ODNdXSw1MjU6W1sxMTEsNzgzXV0sNTI2OltbNzksNzg1XV0sNTI3OltbMTExLDc4NV1dLDUyODpbWzgyLDc4M11dLDUyOTpbWzExNCw3ODNdXSw1MzA6W1s4Miw3ODVdXSw1MzE6W1sxMTQsNzg1XV0sNTMyOltbODUsNzgzXV0sNTMzOltbMTE3LDc4M11dLDUzNDpbWzg1LDc4NV1dLDUzNTpbWzExNyw3ODVdXSw1MzY6W1s4Myw4MDZdXSw1Mzc6W1sxMTUsODA2XV0sNTM4OltbODQsODA2XV0sNTM5OltbMTE2LDgwNl1dLDU0MjpbWzcyLDc4MF1dLDU0MzpbWzEwNCw3ODBdXSw1NTA6W1s2NSw3NzVdLCx7NzcyOjQ4MH1dLDU1MTpbWzk3LDc3NV0sLHs3NzI6NDgxfV0sNTUyOltbNjksODA3XSwsezc3NDo3NzA4fV0sNTUzOltbMTAxLDgwN10sLHs3NzQ6NzcwOX1dLDU1NDpbWzIxNCw3NzJdXSw1NTU6W1syNDYsNzcyXV0sNTU2OltbMjEzLDc3Ml1dLDU1NzpbWzI0NSw3NzJdXSw1NTg6W1s3OSw3NzVdLCx7NzcyOjU2MH1dLDU1OTpbWzExMSw3NzVdLCx7NzcyOjU2MX1dLDU2MDpbWzU1OCw3NzJdXSw1NjE6W1s1NTksNzcyXV0sNTYyOltbODksNzcyXV0sNTYzOltbMTIxLDc3Ml1dLDY1ODpbLCx7NzgwOjQ5NX1dLDY4ODpbWzEwNF0sMjU2XSw2ODk6W1s2MTRdLDI1Nl0sNjkwOltbMTA2XSwyNTZdLDY5MTpbWzExNF0sMjU2XSw2OTI6W1s2MzNdLDI1Nl0sNjkzOltbNjM1XSwyNTZdLDY5NDpbWzY0MV0sMjU2XSw2OTU6W1sxMTldLDI1Nl0sNjk2OltbMTIxXSwyNTZdLDcyODpbWzMyLDc3NF0sMjU2XSw3Mjk6W1szMiw3NzVdLDI1Nl0sNzMwOltbMzIsNzc4XSwyNTZdLDczMTpbWzMyLDgwOF0sMjU2XSw3MzI6W1szMiw3NzFdLDI1Nl0sNzMzOltbMzIsNzc5XSwyNTZdLDczNjpbWzYxMV0sMjU2XSw3Mzc6W1sxMDhdLDI1Nl0sNzM4OltbMTE1XSwyNTZdLDczOTpbWzEyMF0sMjU2XSw3NDA6W1s2NjFdLDI1Nl19LFxuNzY4Ons3Njg6WywyMzBdLDc2OTpbLDIzMF0sNzcwOlssMjMwXSw3NzE6WywyMzBdLDc3MjpbLDIzMF0sNzczOlssMjMwXSw3NzQ6WywyMzBdLDc3NTpbLDIzMF0sNzc2OlssMjMwLHs3Njk6ODM2fV0sNzc3OlssMjMwXSw3Nzg6WywyMzBdLDc3OTpbLDIzMF0sNzgwOlssMjMwXSw3ODE6WywyMzBdLDc4MjpbLDIzMF0sNzgzOlssMjMwXSw3ODQ6WywyMzBdLDc4NTpbLDIzMF0sNzg2OlssMjMwXSw3ODc6WywyMzBdLDc4ODpbLDIzMF0sNzg5OlssMjMyXSw3OTA6WywyMjBdLDc5MTpbLDIyMF0sNzkyOlssMjIwXSw3OTM6WywyMjBdLDc5NDpbLDIzMl0sNzk1OlssMjE2XSw3OTY6WywyMjBdLDc5NzpbLDIyMF0sNzk4OlssMjIwXSw3OTk6WywyMjBdLDgwMDpbLDIyMF0sODAxOlssMjAyXSw4MDI6WywyMDJdLDgwMzpbLDIyMF0sODA0OlssMjIwXSw4MDU6WywyMjBdLDgwNjpbLDIyMF0sODA3OlssMjAyXSw4MDg6WywyMDJdLDgwOTpbLDIyMF0sODEwOlssMjIwXSw4MTE6WywyMjBdLDgxMjpbLDIyMF0sODEzOlssMjIwXSw4MTQ6WywyMjBdLDgxNTpbLDIyMF0sODE2OlssMjIwXSw4MTc6WywyMjBdLDgxODpbLDIyMF0sODE5OlssMjIwXSw4MjA6WywxXSw4MjE6WywxXSw4MjI6WywxXSw4MjM6WywxXSw4MjQ6WywxXSw4MjU6WywyMjBdLDgyNjpbLDIyMF0sODI3OlssMjIwXSw4Mjg6WywyMjBdLDgyOTpbLDIzMF0sODMwOlssMjMwXSw4MzE6WywyMzBdLDgzMjpbWzc2OF0sMjMwXSw4MzM6W1s3NjldLDIzMF0sODM0OlssMjMwXSw4MzU6W1s3ODddLDIzMF0sODM2OltbNzc2LDc2OV0sMjMwXSw4Mzc6WywyNDBdLDgzODpbLDIzMF0sODM5OlssMjIwXSw4NDA6WywyMjBdLDg0MTpbLDIyMF0sODQyOlssMjMwXSw4NDM6WywyMzBdLDg0NDpbLDIzMF0sODQ1OlssMjIwXSw4NDY6WywyMjBdLDg0ODpbLDIzMF0sODQ5OlssMjMwXSw4NTA6WywyMzBdLDg1MTpbLDIyMF0sODUyOlssMjIwXSw4NTM6WywyMjBdLDg1NDpbLDIyMF0sODU1OlssMjMwXSw4NTY6WywyMzJdLDg1NzpbLDIyMF0sODU4OlssMjIwXSw4NTk6WywyMzBdLDg2MDpbLDIzM10sODYxOlssMjM0XSw4NjI6WywyMzRdLDg2MzpbLDIzM10sODY0OlssMjM0XSw4NjU6WywyMzRdLDg2NjpbLDIzM10sODY3OlssMjMwXSw4Njg6WywyMzBdLDg2OTpbLDIzMF0sODcwOlssMjMwXSw4NzE6WywyMzBdLDg3MjpbLDIzMF0sODczOlssMjMwXSw4NzQ6WywyMzBdLDg3NTpbLDIzMF0sODc2OlssMjMwXSw4Nzc6WywyMzBdLDg3ODpbLDIzMF0sODc5OlssMjMwXSw4ODQ6W1s2OTddXSw4OTA6W1szMiw4MzddLDI1Nl0sODk0OltbNTldXSw5MDA6W1szMiw3NjldLDI1Nl0sOTAxOltbMTY4LDc2OV1dLDkwMjpbWzkxMyw3NjldXSw5MDM6W1sxODNdXSw5MDQ6W1s5MTcsNzY5XV0sOTA1OltbOTE5LDc2OV1dLDkwNjpbWzkyMSw3NjldXSw5MDg6W1s5MjcsNzY5XV0sOTEwOltbOTMzLDc2OV1dLDkxMTpbWzkzNyw3NjldXSw5MTI6W1s5NzAsNzY5XV0sOTEzOlssLHs3Njg6ODEyMiw3Njk6OTAyLDc3Mjo4MTIxLDc3NDo4MTIwLDc4Nzo3OTQ0LDc4ODo3OTQ1LDgzNzo4MTI0fV0sOTE3OlssLHs3Njg6ODEzNiw3Njk6OTA0LDc4Nzo3OTYwLDc4ODo3OTYxfV0sOTE5OlssLHs3Njg6ODEzOCw3Njk6OTA1LDc4Nzo3OTc2LDc4ODo3OTc3LDgzNzo4MTQwfV0sOTIxOlssLHs3Njg6ODE1NCw3Njk6OTA2LDc3Mjo4MTUzLDc3NDo4MTUyLDc3Njo5MzgsNzg3Ojc5OTIsNzg4Ojc5OTN9XSw5Mjc6Wywsezc2ODo4MTg0LDc2OTo5MDgsNzg3OjgwMDgsNzg4OjgwMDl9XSw5Mjk6Wywsezc4ODo4MTcyfV0sOTMzOlssLHs3Njg6ODE3MCw3Njk6OTEwLDc3Mjo4MTY5LDc3NDo4MTY4LDc3Njo5MzksNzg4OjgwMjV9XSw5Mzc6Wywsezc2ODo4MTg2LDc2OTo5MTEsNzg3OjgwNDAsNzg4OjgwNDEsODM3OjgxODh9XSw5Mzg6W1s5MjEsNzc2XV0sOTM5OltbOTMzLDc3Nl1dLDk0MDpbWzk0NSw3NjldLCx7ODM3OjgxMTZ9XSw5NDE6W1s5NDksNzY5XV0sOTQyOltbOTUxLDc2OV0sLHs4Mzc6ODEzMn1dLDk0MzpbWzk1Myw3NjldXSw5NDQ6W1s5NzEsNzY5XV0sOTQ1OlssLHs3Njg6ODA0OCw3Njk6OTQwLDc3Mjo4MTEzLDc3NDo4MTEyLDc4Nzo3OTM2LDc4ODo3OTM3LDgzNDo4MTE4LDgzNzo4MTE1fV0sOTQ5OlssLHs3Njg6ODA1MCw3Njk6OTQxLDc4Nzo3OTUyLDc4ODo3OTUzfV0sOTUxOlssLHs3Njg6ODA1Miw3Njk6OTQyLDc4Nzo3OTY4LDc4ODo3OTY5LDgzNDo4MTM0LDgzNzo4MTMxfV0sOTUzOlssLHs3Njg6ODA1NCw3Njk6OTQzLDc3Mjo4MTQ1LDc3NDo4MTQ0LDc3Njo5NzAsNzg3Ojc5ODQsNzg4Ojc5ODUsODM0OjgxNTB9XSw5NTk6Wywsezc2ODo4MDU2LDc2OTo5NzIsNzg3OjgwMDAsNzg4OjgwMDF9XSw5NjE6Wywsezc4Nzo4MTY0LDc4ODo4MTY1fV0sOTY1OlssLHs3Njg6ODA1OCw3Njk6OTczLDc3Mjo4MTYxLDc3NDo4MTYwLDc3Njo5NzEsNzg3OjgwMTYsNzg4OjgwMTcsODM0OjgxNjZ9XSw5Njk6Wywsezc2ODo4MDYwLDc2OTo5NzQsNzg3OjgwMzIsNzg4OjgwMzMsODM0OjgxODIsODM3OjgxNzl9XSw5NzA6W1s5NTMsNzc2XSwsezc2ODo4MTQ2LDc2OTo5MTIsODM0OjgxNTF9XSw5NzE6W1s5NjUsNzc2XSwsezc2ODo4MTYyLDc2OTo5NDQsODM0OjgxNjd9XSw5NzI6W1s5NTksNzY5XV0sOTczOltbOTY1LDc2OV1dLDk3NDpbWzk2OSw3NjldLCx7ODM3OjgxODB9XSw5NzY6W1s5NDZdLDI1Nl0sOTc3OltbOTUyXSwyNTZdLDk3ODpbWzkzM10sMjU2LHs3Njk6OTc5LDc3Njo5ODB9XSw5Nzk6W1s5NzgsNzY5XV0sOTgwOltbOTc4LDc3Nl1dLDk4MTpbWzk2Nl0sMjU2XSw5ODI6W1s5NjBdLDI1Nl0sMTAwODpbWzk1NF0sMjU2XSwxMDA5OltbOTYxXSwyNTZdLDEwMTA6W1s5NjJdLDI1Nl0sMTAxMjpbWzkyMF0sMjU2XSwxMDEzOltbOTQ5XSwyNTZdLDEwMTc6W1s5MzFdLDI1Nl19LFxuMTAyNDp7MTAyNDpbWzEwNDUsNzY4XV0sMTAyNTpbWzEwNDUsNzc2XV0sMTAyNzpbWzEwNDMsNzY5XV0sMTAzMDpbLCx7Nzc2OjEwMzF9XSwxMDMxOltbMTAzMCw3NzZdXSwxMDM2OltbMTA1MCw3NjldXSwxMDM3OltbMTA0OCw3NjhdXSwxMDM4OltbMTA1OSw3NzRdXSwxMDQwOlssLHs3NzQ6MTIzMiw3NzY6MTIzNH1dLDEwNDM6Wywsezc2OToxMDI3fV0sMTA0NTpbLCx7NzY4OjEwMjQsNzc0OjEyMzgsNzc2OjEwMjV9XSwxMDQ2OlssLHs3NzQ6MTIxNyw3NzY6MTI0NH1dLDEwNDc6Wywsezc3NjoxMjQ2fV0sMTA0ODpbLCx7NzY4OjEwMzcsNzcyOjEyNTAsNzc0OjEwNDksNzc2OjEyNTJ9XSwxMDQ5OltbMTA0OCw3NzRdXSwxMDUwOlssLHs3Njk6MTAzNn1dLDEwNTQ6Wywsezc3NjoxMjU0fV0sMTA1OTpbLCx7NzcyOjEyNjIsNzc0OjEwMzgsNzc2OjEyNjQsNzc5OjEyNjZ9XSwxMDYzOlssLHs3NzY6MTI2OH1dLDEwNjc6Wywsezc3NjoxMjcyfV0sMTA2OTpbLCx7Nzc2OjEyNjB9XSwxMDcyOlssLHs3NzQ6MTIzMyw3NzY6MTIzNX1dLDEwNzU6Wywsezc2OToxMTA3fV0sMTA3NzpbLCx7NzY4OjExMDQsNzc0OjEyMzksNzc2OjExMDV9XSwxMDc4OlssLHs3NzQ6MTIxOCw3NzY6MTI0NX1dLDEwNzk6Wywsezc3NjoxMjQ3fV0sMTA4MDpbLCx7NzY4OjExMTcsNzcyOjEyNTEsNzc0OjEwODEsNzc2OjEyNTN9XSwxMDgxOltbMTA4MCw3NzRdXSwxMDgyOlssLHs3Njk6MTExNn1dLDEwODY6Wywsezc3NjoxMjU1fV0sMTA5MTpbLCx7NzcyOjEyNjMsNzc0OjExMTgsNzc2OjEyNjUsNzc5OjEyNjd9XSwxMDk1OlssLHs3NzY6MTI2OX1dLDEwOTk6Wywsezc3NjoxMjczfV0sMTEwMTpbLCx7Nzc2OjEyNjF9XSwxMTA0OltbMTA3Nyw3NjhdXSwxMTA1OltbMTA3Nyw3NzZdXSwxMTA3OltbMTA3NSw3NjldXSwxMTEwOlssLHs3NzY6MTExMX1dLDExMTE6W1sxMTEwLDc3Nl1dLDExMTY6W1sxMDgyLDc2OV1dLDExMTc6W1sxMDgwLDc2OF1dLDExMTg6W1sxMDkxLDc3NF1dLDExNDA6Wywsezc4MzoxMTQyfV0sMTE0MTpbLCx7NzgzOjExNDN9XSwxMTQyOltbMTE0MCw3ODNdXSwxMTQzOltbMTE0MSw3ODNdXSwxMTU1OlssMjMwXSwxMTU2OlssMjMwXSwxMTU3OlssMjMwXSwxMTU4OlssMjMwXSwxMTU5OlssMjMwXSwxMjE3OltbMTA0Niw3NzRdXSwxMjE4OltbMTA3OCw3NzRdXSwxMjMyOltbMTA0MCw3NzRdXSwxMjMzOltbMTA3Miw3NzRdXSwxMjM0OltbMTA0MCw3NzZdXSwxMjM1OltbMTA3Miw3NzZdXSwxMjM4OltbMTA0NSw3NzRdXSwxMjM5OltbMTA3Nyw3NzRdXSwxMjQwOlssLHs3NzY6MTI0Mn1dLDEyNDE6Wywsezc3NjoxMjQzfV0sMTI0MjpbWzEyNDAsNzc2XV0sMTI0MzpbWzEyNDEsNzc2XV0sMTI0NDpbWzEwNDYsNzc2XV0sMTI0NTpbWzEwNzgsNzc2XV0sMTI0NjpbWzEwNDcsNzc2XV0sMTI0NzpbWzEwNzksNzc2XV0sMTI1MDpbWzEwNDgsNzcyXV0sMTI1MTpbWzEwODAsNzcyXV0sMTI1MjpbWzEwNDgsNzc2XV0sMTI1MzpbWzEwODAsNzc2XV0sMTI1NDpbWzEwNTQsNzc2XV0sMTI1NTpbWzEwODYsNzc2XV0sMTI1NjpbLCx7Nzc2OjEyNTh9XSwxMjU3OlssLHs3NzY6MTI1OX1dLDEyNTg6W1sxMjU2LDc3Nl1dLDEyNTk6W1sxMjU3LDc3Nl1dLDEyNjA6W1sxMDY5LDc3Nl1dLDEyNjE6W1sxMTAxLDc3Nl1dLDEyNjI6W1sxMDU5LDc3Ml1dLDEyNjM6W1sxMDkxLDc3Ml1dLDEyNjQ6W1sxMDU5LDc3Nl1dLDEyNjU6W1sxMDkxLDc3Nl1dLDEyNjY6W1sxMDU5LDc3OV1dLDEyNjc6W1sxMDkxLDc3OV1dLDEyNjg6W1sxMDYzLDc3Nl1dLDEyNjk6W1sxMDk1LDc3Nl1dLDEyNzI6W1sxMDY3LDc3Nl1dLDEyNzM6W1sxMDk5LDc3Nl1dfSxcbjEyODA6ezE0MTU6W1sxMzgxLDE0MTBdLDI1Nl0sMTQyNTpbLDIyMF0sMTQyNjpbLDIzMF0sMTQyNzpbLDIzMF0sMTQyODpbLDIzMF0sMTQyOTpbLDIzMF0sMTQzMDpbLDIyMF0sMTQzMTpbLDIzMF0sMTQzMjpbLDIzMF0sMTQzMzpbLDIzMF0sMTQzNDpbLDIyMl0sMTQzNTpbLDIyMF0sMTQzNjpbLDIzMF0sMTQzNzpbLDIzMF0sMTQzODpbLDIzMF0sMTQzOTpbLDIzMF0sMTQ0MDpbLDIzMF0sMTQ0MTpbLDIzMF0sMTQ0MjpbLDIyMF0sMTQ0MzpbLDIyMF0sMTQ0NDpbLDIyMF0sMTQ0NTpbLDIyMF0sMTQ0NjpbLDIyMF0sMTQ0NzpbLDIyMF0sMTQ0ODpbLDIzMF0sMTQ0OTpbLDIzMF0sMTQ1MDpbLDIyMF0sMTQ1MTpbLDIzMF0sMTQ1MjpbLDIzMF0sMTQ1MzpbLDIyMl0sMTQ1NDpbLDIyOF0sMTQ1NTpbLDIzMF0sMTQ1NjpbLDEwXSwxNDU3OlssMTFdLDE0NTg6WywxMl0sMTQ1OTpbLDEzXSwxNDYwOlssMTRdLDE0NjE6WywxNV0sMTQ2MjpbLDE2XSwxNDYzOlssMTddLDE0NjQ6WywxOF0sMTQ2NTpbLDE5XSwxNDY2OlssMTldLDE0Njc6WywyMF0sMTQ2ODpbLDIxXSwxNDY5OlssMjJdLDE0NzE6WywyM10sMTQ3MzpbLDI0XSwxNDc0OlssMjVdLDE0NzY6WywyMzBdLDE0Nzc6WywyMjBdLDE0Nzk6WywxOF19LFxuMTUzNjp7MTU1MjpbLDIzMF0sMTU1MzpbLDIzMF0sMTU1NDpbLDIzMF0sMTU1NTpbLDIzMF0sMTU1NjpbLDIzMF0sMTU1NzpbLDIzMF0sMTU1ODpbLDIzMF0sMTU1OTpbLDIzMF0sMTU2MDpbLDMwXSwxNTYxOlssMzFdLDE1NjI6WywzMl0sMTU3MDpbWzE1NzUsMTYxOV1dLDE1NzE6W1sxNTc1LDE2MjBdXSwxNTcyOltbMTYwOCwxNjIwXV0sMTU3MzpbWzE1NzUsMTYyMV1dLDE1NzQ6W1sxNjEwLDE2MjBdXSwxNTc1OlssLHsxNjE5OjE1NzAsMTYyMDoxNTcxLDE2MjE6MTU3M31dLDE2MDg6WywsezE2MjA6MTU3Mn1dLDE2MTA6WywsezE2MjA6MTU3NH1dLDE2MTE6WywyN10sMTYxMjpbLDI4XSwxNjEzOlssMjldLDE2MTQ6WywzMF0sMTYxNTpbLDMxXSwxNjE2OlssMzJdLDE2MTc6WywzM10sMTYxODpbLDM0XSwxNjE5OlssMjMwXSwxNjIwOlssMjMwXSwxNjIxOlssMjIwXSwxNjIyOlssMjIwXSwxNjIzOlssMjMwXSwxNjI0OlssMjMwXSwxNjI1OlssMjMwXSwxNjI2OlssMjMwXSwxNjI3OlssMjMwXSwxNjI4OlssMjIwXSwxNjI5OlssMjMwXSwxNjMwOlssMjMwXSwxNjMxOlssMjIwXSwxNjQ4OlssMzVdLDE2NTM6W1sxNTc1LDE2NTJdLDI1Nl0sMTY1NDpbWzE2MDgsMTY1Ml0sMjU2XSwxNjU1OltbMTczNSwxNjUyXSwyNTZdLDE2NTY6W1sxNjEwLDE2NTJdLDI1Nl0sMTcyODpbWzE3NDksMTYyMF1dLDE3Mjk6WywsezE2MjA6MTczMH1dLDE3MzA6W1sxNzI5LDE2MjBdXSwxNzQ2OlssLHsxNjIwOjE3NDd9XSwxNzQ3OltbMTc0NiwxNjIwXV0sMTc0OTpbLCx7MTYyMDoxNzI4fV0sMTc1MDpbLDIzMF0sMTc1MTpbLDIzMF0sMTc1MjpbLDIzMF0sMTc1MzpbLDIzMF0sMTc1NDpbLDIzMF0sMTc1NTpbLDIzMF0sMTc1NjpbLDIzMF0sMTc1OTpbLDIzMF0sMTc2MDpbLDIzMF0sMTc2MTpbLDIzMF0sMTc2MjpbLDIzMF0sMTc2MzpbLDIyMF0sMTc2NDpbLDIzMF0sMTc2NzpbLDIzMF0sMTc2ODpbLDIzMF0sMTc3MDpbLDIyMF0sMTc3MTpbLDIzMF0sMTc3MjpbLDIzMF0sMTc3MzpbLDIyMF19LFxuMTc5Mjp7MTgwOTpbLDM2XSwxODQwOlssMjMwXSwxODQxOlssMjIwXSwxODQyOlssMjMwXSwxODQzOlssMjMwXSwxODQ0OlssMjIwXSwxODQ1OlssMjMwXSwxODQ2OlssMjMwXSwxODQ3OlssMjIwXSwxODQ4OlssMjIwXSwxODQ5OlssMjIwXSwxODUwOlssMjMwXSwxODUxOlssMjIwXSwxODUyOlssMjIwXSwxODUzOlssMjMwXSwxODU0OlssMjIwXSwxODU1OlssMjMwXSwxODU2OlssMjMwXSwxODU3OlssMjMwXSwxODU4OlssMjIwXSwxODU5OlssMjMwXSwxODYwOlssMjIwXSwxODYxOlssMjMwXSwxODYyOlssMjIwXSwxODYzOlssMjMwXSwxODY0OlssMjIwXSwxODY1OlssMjMwXSwxODY2OlssMjMwXSwyMDI3OlssMjMwXSwyMDI4OlssMjMwXSwyMDI5OlssMjMwXSwyMDMwOlssMjMwXSwyMDMxOlssMjMwXSwyMDMyOlssMjMwXSwyMDMzOlssMjMwXSwyMDM0OlssMjIwXSwyMDM1OlssMjMwXX0sXG4yMDQ4OnsyMDcwOlssMjMwXSwyMDcxOlssMjMwXSwyMDcyOlssMjMwXSwyMDczOlssMjMwXSwyMDc1OlssMjMwXSwyMDc2OlssMjMwXSwyMDc3OlssMjMwXSwyMDc4OlssMjMwXSwyMDc5OlssMjMwXSwyMDgwOlssMjMwXSwyMDgxOlssMjMwXSwyMDgyOlssMjMwXSwyMDgzOlssMjMwXSwyMDg1OlssMjMwXSwyMDg2OlssMjMwXSwyMDg3OlssMjMwXSwyMDg5OlssMjMwXSwyMDkwOlssMjMwXSwyMDkxOlssMjMwXSwyMDkyOlssMjMwXSwyMDkzOlssMjMwXSwyMTM3OlssMjIwXSwyMTM4OlssMjIwXSwyMTM5OlssMjIwXSwyMjc2OlssMjMwXSwyMjc3OlssMjMwXSwyMjc4OlssMjIwXSwyMjc5OlssMjMwXSwyMjgwOlssMjMwXSwyMjgxOlssMjIwXSwyMjgyOlssMjMwXSwyMjgzOlssMjMwXSwyMjg0OlssMjMwXSwyMjg1OlssMjIwXSwyMjg2OlssMjIwXSwyMjg3OlssMjIwXSwyMjg4OlssMjddLDIyODk6WywyOF0sMjI5MDpbLDI5XSwyMjkxOlssMjMwXSwyMjkyOlssMjMwXSwyMjkzOlssMjMwXSwyMjk0OlssMjIwXSwyMjk1OlssMjMwXSwyMjk2OlssMjMwXSwyMjk3OlssMjIwXSwyMjk4OlssMjIwXSwyMjk5OlssMjMwXSwyMzAwOlssMjMwXSwyMzAxOlssMjMwXSwyMzAyOlssMjMwXX0sXG4yMzA0OnsyMzQ0OlssLHsyMzY0OjIzNDV9XSwyMzQ1OltbMjM0NCwyMzY0XV0sMjM1MjpbLCx7MjM2NDoyMzUzfV0sMjM1MzpbWzIzNTIsMjM2NF1dLDIzNTU6WywsezIzNjQ6MjM1Nn1dLDIzNTY6W1syMzU1LDIzNjRdXSwyMzY0OlssN10sMjM4MTpbLDldLDIzODU6WywyMzBdLDIzODY6WywyMjBdLDIzODc6WywyMzBdLDIzODg6WywyMzBdLDIzOTI6W1syMzI1LDIzNjRdLDUxMl0sMjM5MzpbWzIzMjYsMjM2NF0sNTEyXSwyMzk0OltbMjMyNywyMzY0XSw1MTJdLDIzOTU6W1syMzMyLDIzNjRdLDUxMl0sMjM5NjpbWzIzMzcsMjM2NF0sNTEyXSwyMzk3OltbMjMzOCwyMzY0XSw1MTJdLDIzOTg6W1syMzQ3LDIzNjRdLDUxMl0sMjM5OTpbWzIzNTEsMjM2NF0sNTEyXSwyNDkyOlssN10sMjUwMzpbLCx7MjQ5NDoyNTA3LDI1MTk6MjUwOH1dLDI1MDc6W1syNTAzLDI0OTRdXSwyNTA4OltbMjUwMywyNTE5XV0sMjUwOTpbLDldLDI1MjQ6W1syNDY1LDI0OTJdLDUxMl0sMjUyNTpbWzI0NjYsMjQ5Ml0sNTEyXSwyNTI3OltbMjQ3OSwyNDkyXSw1MTJdfSxcbjI1NjA6ezI2MTE6W1syNjEwLDI2MjBdLDUxMl0sMjYxNDpbWzI2MTYsMjYyMF0sNTEyXSwyNjIwOlssN10sMjYzNzpbLDldLDI2NDk6W1syNTgyLDI2MjBdLDUxMl0sMjY1MDpbWzI1ODMsMjYyMF0sNTEyXSwyNjUxOltbMjU4OCwyNjIwXSw1MTJdLDI2NTQ6W1syNjAzLDI2MjBdLDUxMl0sMjc0ODpbLDddLDI3NjU6Wyw5XSw2ODEwOTpbLDIyMF0sNjgxMTE6WywyMzBdLDY4MTUyOlssMjMwXSw2ODE1MzpbLDFdLDY4MTU0OlssMjIwXSw2ODE1OTpbLDldfSxcbjI4MTY6ezI4NzY6Wyw3XSwyODg3OlssLHsyODc4OjI4OTEsMjkwMjoyODg4LDI5MDM6Mjg5Mn1dLDI4ODg6W1syODg3LDI5MDJdXSwyODkxOltbMjg4NywyODc4XV0sMjg5MjpbWzI4ODcsMjkwM11dLDI4OTM6Wyw5XSwyOTA4OltbMjg0OSwyODc2XSw1MTJdLDI5MDk6W1syODUwLDI4NzZdLDUxMl0sMjk2MjpbLCx7MzAzMToyOTY0fV0sMjk2NDpbWzI5NjIsMzAzMV1dLDMwMTQ6WywsezMwMDY6MzAxOCwzMDMxOjMwMjB9XSwzMDE1OlssLHszMDA2OjMwMTl9XSwzMDE4OltbMzAxNCwzMDA2XV0sMzAxOTpbWzMwMTUsMzAwNl1dLDMwMjA6W1szMDE0LDMwMzFdXSwzMDIxOlssOV19LFxuMzA3Mjp7MzE0MjpbLCx7MzE1ODozMTQ0fV0sMzE0NDpbWzMxNDIsMzE1OF1dLDMxNDk6Wyw5XSwzMTU3OlssODRdLDMxNTg6Wyw5MV0sMzI2MDpbLDddLDMyNjM6WywsezMyODU6MzI2NH1dLDMyNjQ6W1szMjYzLDMyODVdXSwzMjcwOlssLHszMjY2OjMyNzQsMzI4NTozMjcxLDMyODY6MzI3Mn1dLDMyNzE6W1szMjcwLDMyODVdXSwzMjcyOltbMzI3MCwzMjg2XV0sMzI3NDpbWzMyNzAsMzI2Nl0sLHszMjg1OjMyNzV9XSwzMjc1OltbMzI3NCwzMjg1XV0sMzI3NzpbLDldfSxcbjMzMjg6ezMzOTg6WywsezMzOTA6MzQwMiwzNDE1OjM0MDR9XSwzMzk5OlssLHszMzkwOjM0MDN9XSwzNDAyOltbMzM5OCwzMzkwXV0sMzQwMzpbWzMzOTksMzM5MF1dLDM0MDQ6W1szMzk4LDM0MTVdXSwzNDA1OlssOV0sMzUzMDpbLDldLDM1NDU6WywsezM1MzA6MzU0NiwzNTM1OjM1NDgsMzU1MTozNTUwfV0sMzU0NjpbWzM1NDUsMzUzMF1dLDM1NDg6W1szNTQ1LDM1MzVdLCx7MzUzMDozNTQ5fV0sMzU0OTpbWzM1NDgsMzUzMF1dLDM1NTA6W1szNTQ1LDM1NTFdXX0sXG4zNTg0OnszNjM1OltbMzY2MSwzNjM0XSwyNTZdLDM2NDA6WywxMDNdLDM2NDE6WywxMDNdLDM2NDI6Wyw5XSwzNjU2OlssMTA3XSwzNjU3OlssMTA3XSwzNjU4OlssMTA3XSwzNjU5OlssMTA3XSwzNzYzOltbMzc4OSwzNzYyXSwyNTZdLDM3Njg6WywxMThdLDM3Njk6WywxMThdLDM3ODQ6WywxMjJdLDM3ODU6WywxMjJdLDM3ODY6WywxMjJdLDM3ODc6WywxMjJdLDM4MDQ6W1szNzU1LDM3MzddLDI1Nl0sMzgwNTpbWzM3NTUsMzc0NV0sMjU2XX0sXG4zODQwOnszODUyOltbMzg1MV0sMjU2XSwzODY0OlssMjIwXSwzODY1OlssMjIwXSwzODkzOlssMjIwXSwzODk1OlssMjIwXSwzODk3OlssMjE2XSwzOTA3OltbMzkwNiw0MDIzXSw1MTJdLDM5MTc6W1szOTE2LDQwMjNdLDUxMl0sMzkyMjpbWzM5MjEsNDAyM10sNTEyXSwzOTI3OltbMzkyNiw0MDIzXSw1MTJdLDM5MzI6W1szOTMxLDQwMjNdLDUxMl0sMzk0NTpbWzM5MDQsNDAyMV0sNTEyXSwzOTUzOlssMTI5XSwzOTU0OlssMTMwXSwzOTU1OltbMzk1MywzOTU0XSw1MTJdLDM5NTY6WywxMzJdLDM5NTc6W1szOTUzLDM5NTZdLDUxMl0sMzk1ODpbWzQwMTgsMzk2OF0sNTEyXSwzOTU5OltbNDAxOCwzOTY5XSwyNTZdLDM5NjA6W1s0MDE5LDM5NjhdLDUxMl0sMzk2MTpbWzQwMTksMzk2OV0sMjU2XSwzOTYyOlssMTMwXSwzOTYzOlssMTMwXSwzOTY0OlssMTMwXSwzOTY1OlssMTMwXSwzOTY4OlssMTMwXSwzOTY5OltbMzk1MywzOTY4XSw1MTJdLDM5NzA6WywyMzBdLDM5NzE6WywyMzBdLDM5NzI6Wyw5XSwzOTc0OlssMjMwXSwzOTc1OlssMjMwXSwzOTg3OltbMzk4Niw0MDIzXSw1MTJdLDM5OTc6W1szOTk2LDQwMjNdLDUxMl0sNDAwMjpbWzQwMDEsNDAyM10sNTEyXSw0MDA3OltbNDAwNiw0MDIzXSw1MTJdLDQwMTI6W1s0MDExLDQwMjNdLDUxMl0sNDAyNTpbWzM5ODQsNDAyMV0sNTEyXSw0MDM4OlssMjIwXX0sXG40MDk2Ons0MTMzOlssLHs0MTQyOjQxMzR9XSw0MTM0OltbNDEzMyw0MTQyXV0sNDE1MTpbLDddLDQxNTM6Wyw5XSw0MTU0OlssOV0sNDIzNzpbLDIyMF0sNDM0ODpbWzQzMTZdLDI1Nl0sNjk3MDI6Wyw5XSw2OTc4NTpbLCx7Njk4MTg6Njk3ODZ9XSw2OTc4NjpbWzY5Nzg1LDY5ODE4XV0sNjk3ODc6WywsezY5ODE4OjY5Nzg4fV0sNjk3ODg6W1s2OTc4Nyw2OTgxOF1dLDY5Nzk3OlssLHs2OTgxODo2OTgwM31dLDY5ODAzOltbNjk3OTcsNjk4MThdXSw2OTgxNzpbLDldLDY5ODE4OlssN119LFxuNDM1Mjp7Njk4ODg6WywyMzBdLDY5ODg5OlssMjMwXSw2OTg5MDpbLDIzMF0sNjk5MzQ6W1s2OTkzNyw2OTkyN11dLDY5OTM1OltbNjk5MzgsNjk5MjddXSw2OTkzNzpbLCx7Njk5Mjc6Njk5MzR9XSw2OTkzODpbLCx7Njk5Mjc6Njk5MzV9XSw2OTkzOTpbLDldLDY5OTQwOlssOV0sNzAwODA6Wyw5XX0sXG40ODY0Ons0OTU3OlssMjMwXSw0OTU4OlssMjMwXSw0OTU5OlssMjMwXX0sXG41NjMyOns3MTM1MDpbLDldLDcxMzUxOlssN119LFxuNTg4ODp7NTkwODpbLDldLDU5NDA6Wyw5XSw2MDk4OlssOV0sNjEwOTpbLDIzMF19LFxuNjE0NDp7NjMxMzpbLDIyOF19LFxuNjQwMDp7NjQ1NzpbLDIyMl0sNjQ1ODpbLDIzMF0sNjQ1OTpbLDIyMF19LFxuNjY1Njp7NjY3OTpbLDIzMF0sNjY4MDpbLDIyMF0sNjc1MjpbLDldLDY3NzM6WywyMzBdLDY3NzQ6WywyMzBdLDY3NzU6WywyMzBdLDY3NzY6WywyMzBdLDY3Nzc6WywyMzBdLDY3Nzg6WywyMzBdLDY3Nzk6WywyMzBdLDY3ODA6WywyMzBdLDY3ODM6WywyMjBdfSxcbjY5MTI6ezY5MTc6WywsezY5NjU6NjkxOH1dLDY5MTg6W1s2OTE3LDY5NjVdXSw2OTE5OlssLHs2OTY1OjY5MjB9XSw2OTIwOltbNjkxOSw2OTY1XV0sNjkyMTpbLCx7Njk2NTo2OTIyfV0sNjkyMjpbWzY5MjEsNjk2NV1dLDY5MjM6WywsezY5NjU6NjkyNH1dLDY5MjQ6W1s2OTIzLDY5NjVdXSw2OTI1OlssLHs2OTY1OjY5MjZ9XSw2OTI2OltbNjkyNSw2OTY1XV0sNjkyOTpbLCx7Njk2NTo2OTMwfV0sNjkzMDpbWzY5MjksNjk2NV1dLDY5NjQ6Wyw3XSw2OTcwOlssLHs2OTY1OjY5NzF9XSw2OTcxOltbNjk3MCw2OTY1XV0sNjk3MjpbLCx7Njk2NTo2OTczfV0sNjk3MzpbWzY5NzIsNjk2NV1dLDY5NzQ6WywsezY5NjU6Njk3Nn1dLDY5NzU6WywsezY5NjU6Njk3N31dLDY5NzY6W1s2OTc0LDY5NjVdXSw2OTc3OltbNjk3NSw2OTY1XV0sNjk3ODpbLCx7Njk2NTo2OTc5fV0sNjk3OTpbWzY5NzgsNjk2NV1dLDY5ODA6Wyw5XSw3MDE5OlssMjMwXSw3MDIwOlssMjIwXSw3MDIxOlssMjMwXSw3MDIyOlssMjMwXSw3MDIzOlssMjMwXSw3MDI0OlssMjMwXSw3MDI1OlssMjMwXSw3MDI2OlssMjMwXSw3MDI3OlssMjMwXSw3MDgyOlssOV0sNzA4MzpbLDldLDcxNDI6Wyw3XSw3MTU0OlssOV0sNzE1NTpbLDldfSxcbjcxNjg6ezcyMjM6Wyw3XSw3Mzc2OlssMjMwXSw3Mzc3OlssMjMwXSw3Mzc4OlssMjMwXSw3MzgwOlssMV0sNzM4MTpbLDIyMF0sNzM4MjpbLDIyMF0sNzM4MzpbLDIyMF0sNzM4NDpbLDIyMF0sNzM4NTpbLDIyMF0sNzM4NjpbLDIzMF0sNzM4NzpbLDIzMF0sNzM4ODpbLDIyMF0sNzM4OTpbLDIyMF0sNzM5MDpbLDIyMF0sNzM5MTpbLDIyMF0sNzM5MjpbLDIzMF0sNzM5NDpbLDFdLDczOTU6WywxXSw3Mzk2OlssMV0sNzM5NzpbLDFdLDczOTg6WywxXSw3Mzk5OlssMV0sNzQwMDpbLDFdLDc0MDU6WywyMjBdLDc0MTI6WywyMzBdfSxcbjc0MjQ6ezc0Njg6W1s2NV0sMjU2XSw3NDY5OltbMTk4XSwyNTZdLDc0NzA6W1s2Nl0sMjU2XSw3NDcyOltbNjhdLDI1Nl0sNzQ3MzpbWzY5XSwyNTZdLDc0NzQ6W1szOThdLDI1Nl0sNzQ3NTpbWzcxXSwyNTZdLDc0NzY6W1s3Ml0sMjU2XSw3NDc3OltbNzNdLDI1Nl0sNzQ3ODpbWzc0XSwyNTZdLDc0Nzk6W1s3NV0sMjU2XSw3NDgwOltbNzZdLDI1Nl0sNzQ4MTpbWzc3XSwyNTZdLDc0ODI6W1s3OF0sMjU2XSw3NDg0OltbNzldLDI1Nl0sNzQ4NTpbWzU0Nl0sMjU2XSw3NDg2OltbODBdLDI1Nl0sNzQ4NzpbWzgyXSwyNTZdLDc0ODg6W1s4NF0sMjU2XSw3NDg5OltbODVdLDI1Nl0sNzQ5MDpbWzg3XSwyNTZdLDc0OTE6W1s5N10sMjU2XSw3NDkyOltbNTkyXSwyNTZdLDc0OTM6W1s1OTNdLDI1Nl0sNzQ5NDpbWzc0MjZdLDI1Nl0sNzQ5NTpbWzk4XSwyNTZdLDc0OTY6W1sxMDBdLDI1Nl0sNzQ5NzpbWzEwMV0sMjU2XSw3NDk4OltbNjAxXSwyNTZdLDc0OTk6W1s2MDNdLDI1Nl0sNzUwMDpbWzYwNF0sMjU2XSw3NTAxOltbMTAzXSwyNTZdLDc1MDM6W1sxMDddLDI1Nl0sNzUwNDpbWzEwOV0sMjU2XSw3NTA1OltbMzMxXSwyNTZdLDc1MDY6W1sxMTFdLDI1Nl0sNzUwNzpbWzU5Nl0sMjU2XSw3NTA4OltbNzQ0Nl0sMjU2XSw3NTA5OltbNzQ0N10sMjU2XSw3NTEwOltbMTEyXSwyNTZdLDc1MTE6W1sxMTZdLDI1Nl0sNzUxMjpbWzExN10sMjU2XSw3NTEzOltbNzQ1M10sMjU2XSw3NTE0OltbNjIzXSwyNTZdLDc1MTU6W1sxMThdLDI1Nl0sNzUxNjpbWzc0NjFdLDI1Nl0sNzUxNzpbWzk0Nl0sMjU2XSw3NTE4OltbOTQ3XSwyNTZdLDc1MTk6W1s5NDhdLDI1Nl0sNzUyMDpbWzk2Nl0sMjU2XSw3NTIxOltbOTY3XSwyNTZdLDc1MjI6W1sxMDVdLDI1Nl0sNzUyMzpbWzExNF0sMjU2XSw3NTI0OltbMTE3XSwyNTZdLDc1MjU6W1sxMThdLDI1Nl0sNzUyNjpbWzk0Nl0sMjU2XSw3NTI3OltbOTQ3XSwyNTZdLDc1Mjg6W1s5NjFdLDI1Nl0sNzUyOTpbWzk2Nl0sMjU2XSw3NTMwOltbOTY3XSwyNTZdLDc1NDQ6W1sxMDg1XSwyNTZdLDc1Nzk6W1s1OTRdLDI1Nl0sNzU4MDpbWzk5XSwyNTZdLDc1ODE6W1s1OTddLDI1Nl0sNzU4MjpbWzI0MF0sMjU2XSw3NTgzOltbNjA0XSwyNTZdLDc1ODQ6W1sxMDJdLDI1Nl0sNzU4NTpbWzYwN10sMjU2XSw3NTg2OltbNjA5XSwyNTZdLDc1ODc6W1s2MTNdLDI1Nl0sNzU4ODpbWzYxNl0sMjU2XSw3NTg5OltbNjE3XSwyNTZdLDc1OTA6W1s2MThdLDI1Nl0sNzU5MTpbWzc1NDddLDI1Nl0sNzU5MjpbWzY2OV0sMjU2XSw3NTkzOltbNjIxXSwyNTZdLDc1OTQ6W1s3NTU3XSwyNTZdLDc1OTU6W1s2NzFdLDI1Nl0sNzU5NjpbWzYyNV0sMjU2XSw3NTk3OltbNjI0XSwyNTZdLDc1OTg6W1s2MjZdLDI1Nl0sNzU5OTpbWzYyN10sMjU2XSw3NjAwOltbNjI4XSwyNTZdLDc2MDE6W1s2MjldLDI1Nl0sNzYwMjpbWzYzMl0sMjU2XSw3NjAzOltbNjQyXSwyNTZdLDc2MDQ6W1s2NDNdLDI1Nl0sNzYwNTpbWzQyN10sMjU2XSw3NjA2OltbNjQ5XSwyNTZdLDc2MDc6W1s2NTBdLDI1Nl0sNzYwODpbWzc0NTJdLDI1Nl0sNzYwOTpbWzY1MV0sMjU2XSw3NjEwOltbNjUyXSwyNTZdLDc2MTE6W1sxMjJdLDI1Nl0sNzYxMjpbWzY1Nl0sMjU2XSw3NjEzOltbNjU3XSwyNTZdLDc2MTQ6W1s2NThdLDI1Nl0sNzYxNTpbWzk1Ml0sMjU2XSw3NjE2OlssMjMwXSw3NjE3OlssMjMwXSw3NjE4OlssMjIwXSw3NjE5OlssMjMwXSw3NjIwOlssMjMwXSw3NjIxOlssMjMwXSw3NjIyOlssMjMwXSw3NjIzOlssMjMwXSw3NjI0OlssMjMwXSw3NjI1OlssMjMwXSw3NjI2OlssMjIwXSw3NjI3OlssMjMwXSw3NjI4OlssMjMwXSw3NjI5OlssMjM0XSw3NjMwOlssMjE0XSw3NjMxOlssMjIwXSw3NjMyOlssMjAyXSw3NjMzOlssMjMwXSw3NjM0OlssMjMwXSw3NjM1OlssMjMwXSw3NjM2OlssMjMwXSw3NjM3OlssMjMwXSw3NjM4OlssMjMwXSw3NjM5OlssMjMwXSw3NjQwOlssMjMwXSw3NjQxOlssMjMwXSw3NjQyOlssMjMwXSw3NjQzOlssMjMwXSw3NjQ0OlssMjMwXSw3NjQ1OlssMjMwXSw3NjQ2OlssMjMwXSw3NjQ3OlssMjMwXSw3NjQ4OlssMjMwXSw3NjQ5OlssMjMwXSw3NjUwOlssMjMwXSw3NjUxOlssMjMwXSw3NjUyOlssMjMwXSw3NjUzOlssMjMwXSw3NjU0OlssMjMwXSw3Njc2OlssMjMzXSw3Njc3OlssMjIwXSw3Njc4OlssMjMwXSw3Njc5OlssMjIwXX0sXG43NjgwOns3NjgwOltbNjUsODA1XV0sNzY4MTpbWzk3LDgwNV1dLDc2ODI6W1s2Niw3NzVdXSw3NjgzOltbOTgsNzc1XV0sNzY4NDpbWzY2LDgwM11dLDc2ODU6W1s5OCw4MDNdXSw3Njg2OltbNjYsODE3XV0sNzY4NzpbWzk4LDgxN11dLDc2ODg6W1sxOTksNzY5XV0sNzY4OTpbWzIzMSw3NjldXSw3NjkwOltbNjgsNzc1XV0sNzY5MTpbWzEwMCw3NzVdXSw3NjkyOltbNjgsODAzXV0sNzY5MzpbWzEwMCw4MDNdXSw3Njk0OltbNjgsODE3XV0sNzY5NTpbWzEwMCw4MTddXSw3Njk2OltbNjgsODA3XV0sNzY5NzpbWzEwMCw4MDddXSw3Njk4OltbNjgsODEzXV0sNzY5OTpbWzEwMCw4MTNdXSw3NzAwOltbMjc0LDc2OF1dLDc3MDE6W1syNzUsNzY4XV0sNzcwMjpbWzI3NCw3NjldXSw3NzAzOltbMjc1LDc2OV1dLDc3MDQ6W1s2OSw4MTNdXSw3NzA1OltbMTAxLDgxM11dLDc3MDY6W1s2OSw4MTZdXSw3NzA3OltbMTAxLDgxNl1dLDc3MDg6W1s1NTIsNzc0XV0sNzcwOTpbWzU1Myw3NzRdXSw3NzEwOltbNzAsNzc1XV0sNzcxMTpbWzEwMiw3NzVdXSw3NzEyOltbNzEsNzcyXV0sNzcxMzpbWzEwMyw3NzJdXSw3NzE0OltbNzIsNzc1XV0sNzcxNTpbWzEwNCw3NzVdXSw3NzE2OltbNzIsODAzXV0sNzcxNzpbWzEwNCw4MDNdXSw3NzE4OltbNzIsNzc2XV0sNzcxOTpbWzEwNCw3NzZdXSw3NzIwOltbNzIsODA3XV0sNzcyMTpbWzEwNCw4MDddXSw3NzIyOltbNzIsODE0XV0sNzcyMzpbWzEwNCw4MTRdXSw3NzI0OltbNzMsODE2XV0sNzcyNTpbWzEwNSw4MTZdXSw3NzI2OltbMjA3LDc2OV1dLDc3Mjc6W1syMzksNzY5XV0sNzcyODpbWzc1LDc2OV1dLDc3Mjk6W1sxMDcsNzY5XV0sNzczMDpbWzc1LDgwM11dLDc3MzE6W1sxMDcsODAzXV0sNzczMjpbWzc1LDgxN11dLDc3MzM6W1sxMDcsODE3XV0sNzczNDpbWzc2LDgwM10sLHs3NzI6NzczNn1dLDc3MzU6W1sxMDgsODAzXSwsezc3Mjo3NzM3fV0sNzczNjpbWzc3MzQsNzcyXV0sNzczNzpbWzc3MzUsNzcyXV0sNzczODpbWzc2LDgxN11dLDc3Mzk6W1sxMDgsODE3XV0sNzc0MDpbWzc2LDgxM11dLDc3NDE6W1sxMDgsODEzXV0sNzc0MjpbWzc3LDc2OV1dLDc3NDM6W1sxMDksNzY5XV0sNzc0NDpbWzc3LDc3NV1dLDc3NDU6W1sxMDksNzc1XV0sNzc0NjpbWzc3LDgwM11dLDc3NDc6W1sxMDksODAzXV0sNzc0ODpbWzc4LDc3NV1dLDc3NDk6W1sxMTAsNzc1XV0sNzc1MDpbWzc4LDgwM11dLDc3NTE6W1sxMTAsODAzXV0sNzc1MjpbWzc4LDgxN11dLDc3NTM6W1sxMTAsODE3XV0sNzc1NDpbWzc4LDgxM11dLDc3NTU6W1sxMTAsODEzXV0sNzc1NjpbWzIxMyw3NjldXSw3NzU3OltbMjQ1LDc2OV1dLDc3NTg6W1syMTMsNzc2XV0sNzc1OTpbWzI0NSw3NzZdXSw3NzYwOltbMzMyLDc2OF1dLDc3NjE6W1szMzMsNzY4XV0sNzc2MjpbWzMzMiw3NjldXSw3NzYzOltbMzMzLDc2OV1dLDc3NjQ6W1s4MCw3NjldXSw3NzY1OltbMTEyLDc2OV1dLDc3NjY6W1s4MCw3NzVdXSw3NzY3OltbMTEyLDc3NV1dLDc3Njg6W1s4Miw3NzVdXSw3NzY5OltbMTE0LDc3NV1dLDc3NzA6W1s4Miw4MDNdLCx7NzcyOjc3NzJ9XSw3NzcxOltbMTE0LDgwM10sLHs3NzI6Nzc3M31dLDc3NzI6W1s3NzcwLDc3Ml1dLDc3NzM6W1s3NzcxLDc3Ml1dLDc3NzQ6W1s4Miw4MTddXSw3Nzc1OltbMTE0LDgxN11dLDc3NzY6W1s4Myw3NzVdXSw3Nzc3OltbMTE1LDc3NV1dLDc3Nzg6W1s4Myw4MDNdLCx7Nzc1Ojc3ODR9XSw3Nzc5OltbMTE1LDgwM10sLHs3NzU6Nzc4NX1dLDc3ODA6W1szNDYsNzc1XV0sNzc4MTpbWzM0Nyw3NzVdXSw3NzgyOltbMzUyLDc3NV1dLDc3ODM6W1szNTMsNzc1XV0sNzc4NDpbWzc3NzgsNzc1XV0sNzc4NTpbWzc3NzksNzc1XV0sNzc4NjpbWzg0LDc3NV1dLDc3ODc6W1sxMTYsNzc1XV0sNzc4ODpbWzg0LDgwM11dLDc3ODk6W1sxMTYsODAzXV0sNzc5MDpbWzg0LDgxN11dLDc3OTE6W1sxMTYsODE3XV0sNzc5MjpbWzg0LDgxM11dLDc3OTM6W1sxMTYsODEzXV0sNzc5NDpbWzg1LDgwNF1dLDc3OTU6W1sxMTcsODA0XV0sNzc5NjpbWzg1LDgxNl1dLDc3OTc6W1sxMTcsODE2XV0sNzc5ODpbWzg1LDgxM11dLDc3OTk6W1sxMTcsODEzXV0sNzgwMDpbWzM2MCw3NjldXSw3ODAxOltbMzYxLDc2OV1dLDc4MDI6W1szNjIsNzc2XV0sNzgwMzpbWzM2Myw3NzZdXSw3ODA0OltbODYsNzcxXV0sNzgwNTpbWzExOCw3NzFdXSw3ODA2OltbODYsODAzXV0sNzgwNzpbWzExOCw4MDNdXSw3ODA4OltbODcsNzY4XV0sNzgwOTpbWzExOSw3NjhdXSw3ODEwOltbODcsNzY5XV0sNzgxMTpbWzExOSw3NjldXSw3ODEyOltbODcsNzc2XV0sNzgxMzpbWzExOSw3NzZdXSw3ODE0OltbODcsNzc1XV0sNzgxNTpbWzExOSw3NzVdXSw3ODE2OltbODcsODAzXV0sNzgxNzpbWzExOSw4MDNdXSw3ODE4OltbODgsNzc1XV0sNzgxOTpbWzEyMCw3NzVdXSw3ODIwOltbODgsNzc2XV0sNzgyMTpbWzEyMCw3NzZdXSw3ODIyOltbODksNzc1XV0sNzgyMzpbWzEyMSw3NzVdXSw3ODI0OltbOTAsNzcwXV0sNzgyNTpbWzEyMiw3NzBdXSw3ODI2OltbOTAsODAzXV0sNzgyNzpbWzEyMiw4MDNdXSw3ODI4OltbOTAsODE3XV0sNzgyOTpbWzEyMiw4MTddXSw3ODMwOltbMTA0LDgxN11dLDc4MzE6W1sxMTYsNzc2XV0sNzgzMjpbWzExOSw3NzhdXSw3ODMzOltbMTIxLDc3OF1dLDc4MzQ6W1s5Nyw3MDJdLDI1Nl0sNzgzNTpbWzM4Myw3NzVdXSw3ODQwOltbNjUsODAzXSwsezc3MDo3ODUyLDc3NDo3ODYyfV0sNzg0MTpbWzk3LDgwM10sLHs3NzA6Nzg1Myw3NzQ6Nzg2M31dLDc4NDI6W1s2NSw3NzddXSw3ODQzOltbOTcsNzc3XV0sNzg0NDpbWzE5NCw3NjldXSw3ODQ1OltbMjI2LDc2OV1dLDc4NDY6W1sxOTQsNzY4XV0sNzg0NzpbWzIyNiw3NjhdXSw3ODQ4OltbMTk0LDc3N11dLDc4NDk6W1syMjYsNzc3XV0sNzg1MDpbWzE5NCw3NzFdXSw3ODUxOltbMjI2LDc3MV1dLDc4NTI6W1s3ODQwLDc3MF1dLDc4NTM6W1s3ODQxLDc3MF1dLDc4NTQ6W1syNTgsNzY5XV0sNzg1NTpbWzI1OSw3NjldXSw3ODU2OltbMjU4LDc2OF1dLDc4NTc6W1syNTksNzY4XV0sNzg1ODpbWzI1OCw3NzddXSw3ODU5OltbMjU5LDc3N11dLDc4NjA6W1syNTgsNzcxXV0sNzg2MTpbWzI1OSw3NzFdXSw3ODYyOltbNzg0MCw3NzRdXSw3ODYzOltbNzg0MSw3NzRdXSw3ODY0OltbNjksODAzXSwsezc3MDo3ODc4fV0sNzg2NTpbWzEwMSw4MDNdLCx7NzcwOjc4Nzl9XSw3ODY2OltbNjksNzc3XV0sNzg2NzpbWzEwMSw3NzddXSw3ODY4OltbNjksNzcxXV0sNzg2OTpbWzEwMSw3NzFdXSw3ODcwOltbMjAyLDc2OV1dLDc4NzE6W1syMzQsNzY5XV0sNzg3MjpbWzIwMiw3NjhdXSw3ODczOltbMjM0LDc2OF1dLDc4NzQ6W1syMDIsNzc3XV0sNzg3NTpbWzIzNCw3NzddXSw3ODc2OltbMjAyLDc3MV1dLDc4Nzc6W1syMzQsNzcxXV0sNzg3ODpbWzc4NjQsNzcwXV0sNzg3OTpbWzc4NjUsNzcwXV0sNzg4MDpbWzczLDc3N11dLDc4ODE6W1sxMDUsNzc3XV0sNzg4MjpbWzczLDgwM11dLDc4ODM6W1sxMDUsODAzXV0sNzg4NDpbWzc5LDgwM10sLHs3NzA6Nzg5Nn1dLDc4ODU6W1sxMTEsODAzXSwsezc3MDo3ODk3fV0sNzg4NjpbWzc5LDc3N11dLDc4ODc6W1sxMTEsNzc3XV0sNzg4ODpbWzIxMiw3NjldXSw3ODg5OltbMjQ0LDc2OV1dLDc4OTA6W1syMTIsNzY4XV0sNzg5MTpbWzI0NCw3NjhdXSw3ODkyOltbMjEyLDc3N11dLDc4OTM6W1syNDQsNzc3XV0sNzg5NDpbWzIxMiw3NzFdXSw3ODk1OltbMjQ0LDc3MV1dLDc4OTY6W1s3ODg0LDc3MF1dLDc4OTc6W1s3ODg1LDc3MF1dLDc4OTg6W1s0MTYsNzY5XV0sNzg5OTpbWzQxNyw3NjldXSw3OTAwOltbNDE2LDc2OF1dLDc5MDE6W1s0MTcsNzY4XV0sNzkwMjpbWzQxNiw3NzddXSw3OTAzOltbNDE3LDc3N11dLDc5MDQ6W1s0MTYsNzcxXV0sNzkwNTpbWzQxNyw3NzFdXSw3OTA2OltbNDE2LDgwM11dLDc5MDc6W1s0MTcsODAzXV0sNzkwODpbWzg1LDgwM11dLDc5MDk6W1sxMTcsODAzXV0sNzkxMDpbWzg1LDc3N11dLDc5MTE6W1sxMTcsNzc3XV0sNzkxMjpbWzQzMSw3NjldXSw3OTEzOltbNDMyLDc2OV1dLDc5MTQ6W1s0MzEsNzY4XV0sNzkxNTpbWzQzMiw3NjhdXSw3OTE2OltbNDMxLDc3N11dLDc5MTc6W1s0MzIsNzc3XV0sNzkxODpbWzQzMSw3NzFdXSw3OTE5OltbNDMyLDc3MV1dLDc5MjA6W1s0MzEsODAzXV0sNzkyMTpbWzQzMiw4MDNdXSw3OTIyOltbODksNzY4XV0sNzkyMzpbWzEyMSw3NjhdXSw3OTI0OltbODksODAzXV0sNzkyNTpbWzEyMSw4MDNdXSw3OTI2OltbODksNzc3XV0sNzkyNzpbWzEyMSw3NzddXSw3OTI4OltbODksNzcxXV0sNzkyOTpbWzEyMSw3NzFdXX0sXG43OTM2Ons3OTM2OltbOTQ1LDc4N10sLHs3Njg6NzkzOCw3Njk6Nzk0MCw4MzQ6Nzk0Miw4Mzc6ODA2NH1dLDc5Mzc6W1s5NDUsNzg4XSwsezc2ODo3OTM5LDc2OTo3OTQxLDgzNDo3OTQzLDgzNzo4MDY1fV0sNzkzODpbWzc5MzYsNzY4XSwsezgzNzo4MDY2fV0sNzkzOTpbWzc5MzcsNzY4XSwsezgzNzo4MDY3fV0sNzk0MDpbWzc5MzYsNzY5XSwsezgzNzo4MDY4fV0sNzk0MTpbWzc5MzcsNzY5XSwsezgzNzo4MDY5fV0sNzk0MjpbWzc5MzYsODM0XSwsezgzNzo4MDcwfV0sNzk0MzpbWzc5MzcsODM0XSwsezgzNzo4MDcxfV0sNzk0NDpbWzkxMyw3ODddLCx7NzY4Ojc5NDYsNzY5Ojc5NDgsODM0Ojc5NTAsODM3OjgwNzJ9XSw3OTQ1OltbOTEzLDc4OF0sLHs3Njg6Nzk0Nyw3Njk6Nzk0OSw4MzQ6Nzk1MSw4Mzc6ODA3M31dLDc5NDY6W1s3OTQ0LDc2OF0sLHs4Mzc6ODA3NH1dLDc5NDc6W1s3OTQ1LDc2OF0sLHs4Mzc6ODA3NX1dLDc5NDg6W1s3OTQ0LDc2OV0sLHs4Mzc6ODA3Nn1dLDc5NDk6W1s3OTQ1LDc2OV0sLHs4Mzc6ODA3N31dLDc5NTA6W1s3OTQ0LDgzNF0sLHs4Mzc6ODA3OH1dLDc5NTE6W1s3OTQ1LDgzNF0sLHs4Mzc6ODA3OX1dLDc5NTI6W1s5NDksNzg3XSwsezc2ODo3OTU0LDc2OTo3OTU2fV0sNzk1MzpbWzk0OSw3ODhdLCx7NzY4Ojc5NTUsNzY5Ojc5NTd9XSw3OTU0OltbNzk1Miw3NjhdXSw3OTU1OltbNzk1Myw3NjhdXSw3OTU2OltbNzk1Miw3NjldXSw3OTU3OltbNzk1Myw3NjldXSw3OTYwOltbOTE3LDc4N10sLHs3Njg6Nzk2Miw3Njk6Nzk2NH1dLDc5NjE6W1s5MTcsNzg4XSwsezc2ODo3OTYzLDc2OTo3OTY1fV0sNzk2MjpbWzc5NjAsNzY4XV0sNzk2MzpbWzc5NjEsNzY4XV0sNzk2NDpbWzc5NjAsNzY5XV0sNzk2NTpbWzc5NjEsNzY5XV0sNzk2ODpbWzk1MSw3ODddLCx7NzY4Ojc5NzAsNzY5Ojc5NzIsODM0Ojc5NzQsODM3OjgwODB9XSw3OTY5OltbOTUxLDc4OF0sLHs3Njg6Nzk3MSw3Njk6Nzk3Myw4MzQ6Nzk3NSw4Mzc6ODA4MX1dLDc5NzA6W1s3OTY4LDc2OF0sLHs4Mzc6ODA4Mn1dLDc5NzE6W1s3OTY5LDc2OF0sLHs4Mzc6ODA4M31dLDc5NzI6W1s3OTY4LDc2OV0sLHs4Mzc6ODA4NH1dLDc5NzM6W1s3OTY5LDc2OV0sLHs4Mzc6ODA4NX1dLDc5NzQ6W1s3OTY4LDgzNF0sLHs4Mzc6ODA4Nn1dLDc5NzU6W1s3OTY5LDgzNF0sLHs4Mzc6ODA4N31dLDc5NzY6W1s5MTksNzg3XSwsezc2ODo3OTc4LDc2OTo3OTgwLDgzNDo3OTgyLDgzNzo4MDg4fV0sNzk3NzpbWzkxOSw3ODhdLCx7NzY4Ojc5NzksNzY5Ojc5ODEsODM0Ojc5ODMsODM3OjgwODl9XSw3OTc4OltbNzk3Niw3NjhdLCx7ODM3OjgwOTB9XSw3OTc5OltbNzk3Nyw3NjhdLCx7ODM3OjgwOTF9XSw3OTgwOltbNzk3Niw3NjldLCx7ODM3OjgwOTJ9XSw3OTgxOltbNzk3Nyw3NjldLCx7ODM3OjgwOTN9XSw3OTgyOltbNzk3Niw4MzRdLCx7ODM3OjgwOTR9XSw3OTgzOltbNzk3Nyw4MzRdLCx7ODM3OjgwOTV9XSw3OTg0OltbOTUzLDc4N10sLHs3Njg6Nzk4Niw3Njk6Nzk4OCw4MzQ6Nzk5MH1dLDc5ODU6W1s5NTMsNzg4XSwsezc2ODo3OTg3LDc2OTo3OTg5LDgzNDo3OTkxfV0sNzk4NjpbWzc5ODQsNzY4XV0sNzk4NzpbWzc5ODUsNzY4XV0sNzk4ODpbWzc5ODQsNzY5XV0sNzk4OTpbWzc5ODUsNzY5XV0sNzk5MDpbWzc5ODQsODM0XV0sNzk5MTpbWzc5ODUsODM0XV0sNzk5MjpbWzkyMSw3ODddLCx7NzY4Ojc5OTQsNzY5Ojc5OTYsODM0Ojc5OTh9XSw3OTkzOltbOTIxLDc4OF0sLHs3Njg6Nzk5NSw3Njk6Nzk5Nyw4MzQ6Nzk5OX1dLDc5OTQ6W1s3OTkyLDc2OF1dLDc5OTU6W1s3OTkzLDc2OF1dLDc5OTY6W1s3OTkyLDc2OV1dLDc5OTc6W1s3OTkzLDc2OV1dLDc5OTg6W1s3OTkyLDgzNF1dLDc5OTk6W1s3OTkzLDgzNF1dLDgwMDA6W1s5NTksNzg3XSwsezc2ODo4MDAyLDc2OTo4MDA0fV0sODAwMTpbWzk1OSw3ODhdLCx7NzY4OjgwMDMsNzY5OjgwMDV9XSw4MDAyOltbODAwMCw3NjhdXSw4MDAzOltbODAwMSw3NjhdXSw4MDA0OltbODAwMCw3NjldXSw4MDA1OltbODAwMSw3NjldXSw4MDA4OltbOTI3LDc4N10sLHs3Njg6ODAxMCw3Njk6ODAxMn1dLDgwMDk6W1s5MjcsNzg4XSwsezc2ODo4MDExLDc2OTo4MDEzfV0sODAxMDpbWzgwMDgsNzY4XV0sODAxMTpbWzgwMDksNzY4XV0sODAxMjpbWzgwMDgsNzY5XV0sODAxMzpbWzgwMDksNzY5XV0sODAxNjpbWzk2NSw3ODddLCx7NzY4OjgwMTgsNzY5OjgwMjAsODM0OjgwMjJ9XSw4MDE3OltbOTY1LDc4OF0sLHs3Njg6ODAxOSw3Njk6ODAyMSw4MzQ6ODAyM31dLDgwMTg6W1s4MDE2LDc2OF1dLDgwMTk6W1s4MDE3LDc2OF1dLDgwMjA6W1s4MDE2LDc2OV1dLDgwMjE6W1s4MDE3LDc2OV1dLDgwMjI6W1s4MDE2LDgzNF1dLDgwMjM6W1s4MDE3LDgzNF1dLDgwMjU6W1s5MzMsNzg4XSwsezc2ODo4MDI3LDc2OTo4MDI5LDgzNDo4MDMxfV0sODAyNzpbWzgwMjUsNzY4XV0sODAyOTpbWzgwMjUsNzY5XV0sODAzMTpbWzgwMjUsODM0XV0sODAzMjpbWzk2OSw3ODddLCx7NzY4OjgwMzQsNzY5OjgwMzYsODM0OjgwMzgsODM3OjgwOTZ9XSw4MDMzOltbOTY5LDc4OF0sLHs3Njg6ODAzNSw3Njk6ODAzNyw4MzQ6ODAzOSw4Mzc6ODA5N31dLDgwMzQ6W1s4MDMyLDc2OF0sLHs4Mzc6ODA5OH1dLDgwMzU6W1s4MDMzLDc2OF0sLHs4Mzc6ODA5OX1dLDgwMzY6W1s4MDMyLDc2OV0sLHs4Mzc6ODEwMH1dLDgwMzc6W1s4MDMzLDc2OV0sLHs4Mzc6ODEwMX1dLDgwMzg6W1s4MDMyLDgzNF0sLHs4Mzc6ODEwMn1dLDgwMzk6W1s4MDMzLDgzNF0sLHs4Mzc6ODEwM31dLDgwNDA6W1s5MzcsNzg3XSwsezc2ODo4MDQyLDc2OTo4MDQ0LDgzNDo4MDQ2LDgzNzo4MTA0fV0sODA0MTpbWzkzNyw3ODhdLCx7NzY4OjgwNDMsNzY5OjgwNDUsODM0OjgwNDcsODM3OjgxMDV9XSw4MDQyOltbODA0MCw3NjhdLCx7ODM3OjgxMDZ9XSw4MDQzOltbODA0MSw3NjhdLCx7ODM3OjgxMDd9XSw4MDQ0OltbODA0MCw3NjldLCx7ODM3OjgxMDh9XSw4MDQ1OltbODA0MSw3NjldLCx7ODM3OjgxMDl9XSw4MDQ2OltbODA0MCw4MzRdLCx7ODM3OjgxMTB9XSw4MDQ3OltbODA0MSw4MzRdLCx7ODM3OjgxMTF9XSw4MDQ4OltbOTQ1LDc2OF0sLHs4Mzc6ODExNH1dLDgwNDk6W1s5NDBdXSw4MDUwOltbOTQ5LDc2OF1dLDgwNTE6W1s5NDFdXSw4MDUyOltbOTUxLDc2OF0sLHs4Mzc6ODEzMH1dLDgwNTM6W1s5NDJdXSw4MDU0OltbOTUzLDc2OF1dLDgwNTU6W1s5NDNdXSw4MDU2OltbOTU5LDc2OF1dLDgwNTc6W1s5NzJdXSw4MDU4OltbOTY1LDc2OF1dLDgwNTk6W1s5NzNdXSw4MDYwOltbOTY5LDc2OF0sLHs4Mzc6ODE3OH1dLDgwNjE6W1s5NzRdXSw4MDY0OltbNzkzNiw4MzddXSw4MDY1OltbNzkzNyw4MzddXSw4MDY2OltbNzkzOCw4MzddXSw4MDY3OltbNzkzOSw4MzddXSw4MDY4OltbNzk0MCw4MzddXSw4MDY5OltbNzk0MSw4MzddXSw4MDcwOltbNzk0Miw4MzddXSw4MDcxOltbNzk0Myw4MzddXSw4MDcyOltbNzk0NCw4MzddXSw4MDczOltbNzk0NSw4MzddXSw4MDc0OltbNzk0Niw4MzddXSw4MDc1OltbNzk0Nyw4MzddXSw4MDc2OltbNzk0OCw4MzddXSw4MDc3OltbNzk0OSw4MzddXSw4MDc4OltbNzk1MCw4MzddXSw4MDc5OltbNzk1MSw4MzddXSw4MDgwOltbNzk2OCw4MzddXSw4MDgxOltbNzk2OSw4MzddXSw4MDgyOltbNzk3MCw4MzddXSw4MDgzOltbNzk3MSw4MzddXSw4MDg0OltbNzk3Miw4MzddXSw4MDg1OltbNzk3Myw4MzddXSw4MDg2OltbNzk3NCw4MzddXSw4MDg3OltbNzk3NSw4MzddXSw4MDg4OltbNzk3Niw4MzddXSw4MDg5OltbNzk3Nyw4MzddXSw4MDkwOltbNzk3OCw4MzddXSw4MDkxOltbNzk3OSw4MzddXSw4MDkyOltbNzk4MCw4MzddXSw4MDkzOltbNzk4MSw4MzddXSw4MDk0OltbNzk4Miw4MzddXSw4MDk1OltbNzk4Myw4MzddXSw4MDk2OltbODAzMiw4MzddXSw4MDk3OltbODAzMyw4MzddXSw4MDk4OltbODAzNCw4MzddXSw4MDk5OltbODAzNSw4MzddXSw4MTAwOltbODAzNiw4MzddXSw4MTAxOltbODAzNyw4MzddXSw4MTAyOltbODAzOCw4MzddXSw4MTAzOltbODAzOSw4MzddXSw4MTA0OltbODA0MCw4MzddXSw4MTA1OltbODA0MSw4MzddXSw4MTA2OltbODA0Miw4MzddXSw4MTA3OltbODA0Myw4MzddXSw4MTA4OltbODA0NCw4MzddXSw4MTA5OltbODA0NSw4MzddXSw4MTEwOltbODA0Niw4MzddXSw4MTExOltbODA0Nyw4MzddXSw4MTEyOltbOTQ1LDc3NF1dLDgxMTM6W1s5NDUsNzcyXV0sODExNDpbWzgwNDgsODM3XV0sODExNTpbWzk0NSw4MzddXSw4MTE2OltbOTQwLDgzN11dLDgxMTg6W1s5NDUsODM0XSwsezgzNzo4MTE5fV0sODExOTpbWzgxMTgsODM3XV0sODEyMDpbWzkxMyw3NzRdXSw4MTIxOltbOTEzLDc3Ml1dLDgxMjI6W1s5MTMsNzY4XV0sODEyMzpbWzkwMl1dLDgxMjQ6W1s5MTMsODM3XV0sODEyNTpbWzMyLDc4N10sMjU2XSw4MTI2OltbOTUzXV0sODEyNzpbWzMyLDc4N10sMjU2LHs3Njg6ODE0MSw3Njk6ODE0Miw4MzQ6ODE0M31dLDgxMjg6W1szMiw4MzRdLDI1Nl0sODEyOTpbWzE2OCw4MzRdXSw4MTMwOltbODA1Miw4MzddXSw4MTMxOltbOTUxLDgzN11dLDgxMzI6W1s5NDIsODM3XV0sODEzNDpbWzk1MSw4MzRdLCx7ODM3OjgxMzV9XSw4MTM1OltbODEzNCw4MzddXSw4MTM2OltbOTE3LDc2OF1dLDgxMzc6W1s5MDRdXSw4MTM4OltbOTE5LDc2OF1dLDgxMzk6W1s5MDVdXSw4MTQwOltbOTE5LDgzN11dLDgxNDE6W1s4MTI3LDc2OF1dLDgxNDI6W1s4MTI3LDc2OV1dLDgxNDM6W1s4MTI3LDgzNF1dLDgxNDQ6W1s5NTMsNzc0XV0sODE0NTpbWzk1Myw3NzJdXSw4MTQ2OltbOTcwLDc2OF1dLDgxNDc6W1s5MTJdXSw4MTUwOltbOTUzLDgzNF1dLDgxNTE6W1s5NzAsODM0XV0sODE1MjpbWzkyMSw3NzRdXSw4MTUzOltbOTIxLDc3Ml1dLDgxNTQ6W1s5MjEsNzY4XV0sODE1NTpbWzkwNl1dLDgxNTc6W1s4MTkwLDc2OF1dLDgxNTg6W1s4MTkwLDc2OV1dLDgxNTk6W1s4MTkwLDgzNF1dLDgxNjA6W1s5NjUsNzc0XV0sODE2MTpbWzk2NSw3NzJdXSw4MTYyOltbOTcxLDc2OF1dLDgxNjM6W1s5NDRdXSw4MTY0OltbOTYxLDc4N11dLDgxNjU6W1s5NjEsNzg4XV0sODE2NjpbWzk2NSw4MzRdXSw4MTY3OltbOTcxLDgzNF1dLDgxNjg6W1s5MzMsNzc0XV0sODE2OTpbWzkzMyw3NzJdXSw4MTcwOltbOTMzLDc2OF1dLDgxNzE6W1s5MTBdXSw4MTcyOltbOTI5LDc4OF1dLDgxNzM6W1sxNjgsNzY4XV0sODE3NDpbWzkwMV1dLDgxNzU6W1s5Nl1dLDgxNzg6W1s4MDYwLDgzN11dLDgxNzk6W1s5NjksODM3XV0sODE4MDpbWzk3NCw4MzddXSw4MTgyOltbOTY5LDgzNF0sLHs4Mzc6ODE4M31dLDgxODM6W1s4MTgyLDgzN11dLDgxODQ6W1s5MjcsNzY4XV0sODE4NTpbWzkwOF1dLDgxODY6W1s5MzcsNzY4XV0sODE4NzpbWzkxMV1dLDgxODg6W1s5MzcsODM3XV0sODE4OTpbWzE4MF1dLDgxOTA6W1szMiw3ODhdLDI1Nix7NzY4OjgxNTcsNzY5OjgxNTgsODM0OjgxNTl9XX0sXG44MTkyOns4MTkyOltbODE5NF1dLDgxOTM6W1s4MTk1XV0sODE5NDpbWzMyXSwyNTZdLDgxOTU6W1szMl0sMjU2XSw4MTk2OltbMzJdLDI1Nl0sODE5NzpbWzMyXSwyNTZdLDgxOTg6W1szMl0sMjU2XSw4MTk5OltbMzJdLDI1Nl0sODIwMDpbWzMyXSwyNTZdLDgyMDE6W1szMl0sMjU2XSw4MjAyOltbMzJdLDI1Nl0sODIwOTpbWzgyMDhdLDI1Nl0sODIxNTpbWzMyLDgxOV0sMjU2XSw4MjI4OltbNDZdLDI1Nl0sODIyOTpbWzQ2LDQ2XSwyNTZdLDgyMzA6W1s0Niw0Niw0Nl0sMjU2XSw4MjM5OltbMzJdLDI1Nl0sODI0MzpbWzgyNDIsODI0Ml0sMjU2XSw4MjQ0OltbODI0Miw4MjQyLDgyNDJdLDI1Nl0sODI0NjpbWzgyNDUsODI0NV0sMjU2XSw4MjQ3OltbODI0NSw4MjQ1LDgyNDVdLDI1Nl0sODI1MjpbWzMzLDMzXSwyNTZdLDgyNTQ6W1szMiw3NzNdLDI1Nl0sODI2MzpbWzYzLDYzXSwyNTZdLDgyNjQ6W1s2MywzM10sMjU2XSw4MjY1OltbMzMsNjNdLDI1Nl0sODI3OTpbWzgyNDIsODI0Miw4MjQyLDgyNDJdLDI1Nl0sODI4NzpbWzMyXSwyNTZdLDgzMDQ6W1s0OF0sMjU2XSw4MzA1OltbMTA1XSwyNTZdLDgzMDg6W1s1Ml0sMjU2XSw4MzA5OltbNTNdLDI1Nl0sODMxMDpbWzU0XSwyNTZdLDgzMTE6W1s1NV0sMjU2XSw4MzEyOltbNTZdLDI1Nl0sODMxMzpbWzU3XSwyNTZdLDgzMTQ6W1s0M10sMjU2XSw4MzE1OltbODcyMl0sMjU2XSw4MzE2OltbNjFdLDI1Nl0sODMxNzpbWzQwXSwyNTZdLDgzMTg6W1s0MV0sMjU2XSw4MzE5OltbMTEwXSwyNTZdLDgzMjA6W1s0OF0sMjU2XSw4MzIxOltbNDldLDI1Nl0sODMyMjpbWzUwXSwyNTZdLDgzMjM6W1s1MV0sMjU2XSw4MzI0OltbNTJdLDI1Nl0sODMyNTpbWzUzXSwyNTZdLDgzMjY6W1s1NF0sMjU2XSw4MzI3OltbNTVdLDI1Nl0sODMyODpbWzU2XSwyNTZdLDgzMjk6W1s1N10sMjU2XSw4MzMwOltbNDNdLDI1Nl0sODMzMTpbWzg3MjJdLDI1Nl0sODMzMjpbWzYxXSwyNTZdLDgzMzM6W1s0MF0sMjU2XSw4MzM0OltbNDFdLDI1Nl0sODMzNjpbWzk3XSwyNTZdLDgzMzc6W1sxMDFdLDI1Nl0sODMzODpbWzExMV0sMjU2XSw4MzM5OltbMTIwXSwyNTZdLDgzNDA6W1s2MDFdLDI1Nl0sODM0MTpbWzEwNF0sMjU2XSw4MzQyOltbMTA3XSwyNTZdLDgzNDM6W1sxMDhdLDI1Nl0sODM0NDpbWzEwOV0sMjU2XSw4MzQ1OltbMTEwXSwyNTZdLDgzNDY6W1sxMTJdLDI1Nl0sODM0NzpbWzExNV0sMjU2XSw4MzQ4OltbMTE2XSwyNTZdLDgzNjA6W1s4MiwxMTVdLDI1Nl0sODQwMDpbLDIzMF0sODQwMTpbLDIzMF0sODQwMjpbLDFdLDg0MDM6WywxXSw4NDA0OlssMjMwXSw4NDA1OlssMjMwXSw4NDA2OlssMjMwXSw4NDA3OlssMjMwXSw4NDA4OlssMV0sODQwOTpbLDFdLDg0MTA6WywxXSw4NDExOlssMjMwXSw4NDEyOlssMjMwXSw4NDE3OlssMjMwXSw4NDIxOlssMV0sODQyMjpbLDFdLDg0MjM6WywyMzBdLDg0MjQ6WywyMjBdLDg0MjU6WywyMzBdLDg0MjY6WywxXSw4NDI3OlssMV0sODQyODpbLDIyMF0sODQyOTpbLDIyMF0sODQzMDpbLDIyMF0sODQzMTpbLDIyMF0sODQzMjpbLDIzMF19LFxuODQ0ODp7ODQ0ODpbWzk3LDQ3LDk5XSwyNTZdLDg0NDk6W1s5Nyw0NywxMTVdLDI1Nl0sODQ1MDpbWzY3XSwyNTZdLDg0NTE6W1sxNzYsNjddLDI1Nl0sODQ1MzpbWzk5LDQ3LDExMV0sMjU2XSw4NDU0OltbOTksNDcsMTE3XSwyNTZdLDg0NTU6W1s0MDBdLDI1Nl0sODQ1NzpbWzE3Niw3MF0sMjU2XSw4NDU4OltbMTAzXSwyNTZdLDg0NTk6W1s3Ml0sMjU2XSw4NDYwOltbNzJdLDI1Nl0sODQ2MTpbWzcyXSwyNTZdLDg0NjI6W1sxMDRdLDI1Nl0sODQ2MzpbWzI5NV0sMjU2XSw4NDY0OltbNzNdLDI1Nl0sODQ2NTpbWzczXSwyNTZdLDg0NjY6W1s3Nl0sMjU2XSw4NDY3OltbMTA4XSwyNTZdLDg0Njk6W1s3OF0sMjU2XSw4NDcwOltbNzgsMTExXSwyNTZdLDg0NzM6W1s4MF0sMjU2XSw4NDc0OltbODFdLDI1Nl0sODQ3NTpbWzgyXSwyNTZdLDg0NzY6W1s4Ml0sMjU2XSw4NDc3OltbODJdLDI1Nl0sODQ4MDpbWzgzLDc3XSwyNTZdLDg0ODE6W1s4NCw2OSw3Nl0sMjU2XSw4NDgyOltbODQsNzddLDI1Nl0sODQ4NDpbWzkwXSwyNTZdLDg0ODY6W1s5MzddXSw4NDg4OltbOTBdLDI1Nl0sODQ5MDpbWzc1XV0sODQ5MTpbWzE5N11dLDg0OTI6W1s2Nl0sMjU2XSw4NDkzOltbNjddLDI1Nl0sODQ5NTpbWzEwMV0sMjU2XSw4NDk2OltbNjldLDI1Nl0sODQ5NzpbWzcwXSwyNTZdLDg0OTk6W1s3N10sMjU2XSw4NTAwOltbMTExXSwyNTZdLDg1MDE6W1sxNDg4XSwyNTZdLDg1MDI6W1sxNDg5XSwyNTZdLDg1MDM6W1sxNDkwXSwyNTZdLDg1MDQ6W1sxNDkxXSwyNTZdLDg1MDU6W1sxMDVdLDI1Nl0sODUwNzpbWzcwLDY1LDg4XSwyNTZdLDg1MDg6W1s5NjBdLDI1Nl0sODUwOTpbWzk0N10sMjU2XSw4NTEwOltbOTE1XSwyNTZdLDg1MTE6W1s5MjhdLDI1Nl0sODUxMjpbWzg3MjFdLDI1Nl0sODUxNzpbWzY4XSwyNTZdLDg1MTg6W1sxMDBdLDI1Nl0sODUxOTpbWzEwMV0sMjU2XSw4NTIwOltbMTA1XSwyNTZdLDg1MjE6W1sxMDZdLDI1Nl0sODUyODpbWzQ5LDgyNjAsNTVdLDI1Nl0sODUyOTpbWzQ5LDgyNjAsNTddLDI1Nl0sODUzMDpbWzQ5LDgyNjAsNDksNDhdLDI1Nl0sODUzMTpbWzQ5LDgyNjAsNTFdLDI1Nl0sODUzMjpbWzUwLDgyNjAsNTFdLDI1Nl0sODUzMzpbWzQ5LDgyNjAsNTNdLDI1Nl0sODUzNDpbWzUwLDgyNjAsNTNdLDI1Nl0sODUzNTpbWzUxLDgyNjAsNTNdLDI1Nl0sODUzNjpbWzUyLDgyNjAsNTNdLDI1Nl0sODUzNzpbWzQ5LDgyNjAsNTRdLDI1Nl0sODUzODpbWzUzLDgyNjAsNTRdLDI1Nl0sODUzOTpbWzQ5LDgyNjAsNTZdLDI1Nl0sODU0MDpbWzUxLDgyNjAsNTZdLDI1Nl0sODU0MTpbWzUzLDgyNjAsNTZdLDI1Nl0sODU0MjpbWzU1LDgyNjAsNTZdLDI1Nl0sODU0MzpbWzQ5LDgyNjBdLDI1Nl0sODU0NDpbWzczXSwyNTZdLDg1NDU6W1s3Myw3M10sMjU2XSw4NTQ2OltbNzMsNzMsNzNdLDI1Nl0sODU0NzpbWzczLDg2XSwyNTZdLDg1NDg6W1s4Nl0sMjU2XSw4NTQ5OltbODYsNzNdLDI1Nl0sODU1MDpbWzg2LDczLDczXSwyNTZdLDg1NTE6W1s4Niw3Myw3Myw3M10sMjU2XSw4NTUyOltbNzMsODhdLDI1Nl0sODU1MzpbWzg4XSwyNTZdLDg1NTQ6W1s4OCw3M10sMjU2XSw4NTU1OltbODgsNzMsNzNdLDI1Nl0sODU1NjpbWzc2XSwyNTZdLDg1NTc6W1s2N10sMjU2XSw4NTU4OltbNjhdLDI1Nl0sODU1OTpbWzc3XSwyNTZdLDg1NjA6W1sxMDVdLDI1Nl0sODU2MTpbWzEwNSwxMDVdLDI1Nl0sODU2MjpbWzEwNSwxMDUsMTA1XSwyNTZdLDg1NjM6W1sxMDUsMTE4XSwyNTZdLDg1NjQ6W1sxMThdLDI1Nl0sODU2NTpbWzExOCwxMDVdLDI1Nl0sODU2NjpbWzExOCwxMDUsMTA1XSwyNTZdLDg1Njc6W1sxMTgsMTA1LDEwNSwxMDVdLDI1Nl0sODU2ODpbWzEwNSwxMjBdLDI1Nl0sODU2OTpbWzEyMF0sMjU2XSw4NTcwOltbMTIwLDEwNV0sMjU2XSw4NTcxOltbMTIwLDEwNSwxMDVdLDI1Nl0sODU3MjpbWzEwOF0sMjU2XSw4NTczOltbOTldLDI1Nl0sODU3NDpbWzEwMF0sMjU2XSw4NTc1OltbMTA5XSwyNTZdLDg1ODU6W1s0OCw4MjYwLDUxXSwyNTZdLDg1OTI6WywsezgyNDo4NjAyfV0sODU5NDpbLCx7ODI0Ojg2MDN9XSw4NTk2OlssLHs4MjQ6ODYyMn1dLDg2MDI6W1s4NTkyLDgyNF1dLDg2MDM6W1s4NTk0LDgyNF1dLDg2MjI6W1s4NTk2LDgyNF1dLDg2NTM6W1s4NjU2LDgyNF1dLDg2NTQ6W1s4NjYwLDgyNF1dLDg2NTU6W1s4NjU4LDgyNF1dLDg2NTY6WywsezgyNDo4NjUzfV0sODY1ODpbLCx7ODI0Ojg2NTV9XSw4NjYwOlssLHs4MjQ6ODY1NH1dfSxcbjg3MDQ6ezg3MDc6WywsezgyNDo4NzA4fV0sODcwODpbWzg3MDcsODI0XV0sODcxMjpbLCx7ODI0Ojg3MTN9XSw4NzEzOltbODcxMiw4MjRdXSw4NzE1OlssLHs4MjQ6ODcxNn1dLDg3MTY6W1s4NzE1LDgyNF1dLDg3Mzk6WywsezgyNDo4NzQwfV0sODc0MDpbWzg3MzksODI0XV0sODc0MTpbLCx7ODI0Ojg3NDJ9XSw4NzQyOltbODc0MSw4MjRdXSw4NzQ4OltbODc0Nyw4NzQ3XSwyNTZdLDg3NDk6W1s4NzQ3LDg3NDcsODc0N10sMjU2XSw4NzUxOltbODc1MCw4NzUwXSwyNTZdLDg3NTI6W1s4NzUwLDg3NTAsODc1MF0sMjU2XSw4NzY0OlssLHs4MjQ6ODc2OX1dLDg3Njk6W1s4NzY0LDgyNF1dLDg3NzE6WywsezgyNDo4NzcyfV0sODc3MjpbWzg3NzEsODI0XV0sODc3MzpbLCx7ODI0Ojg3NzV9XSw4Nzc1OltbODc3Myw4MjRdXSw4Nzc2OlssLHs4MjQ6ODc3N31dLDg3Nzc6W1s4Nzc2LDgyNF1dLDg3ODE6WywsezgyNDo4ODEzfV0sODgwMDpbWzYxLDgyNF1dLDg4MDE6WywsezgyNDo4ODAyfV0sODgwMjpbWzg4MDEsODI0XV0sODgwNDpbLCx7ODI0Ojg4MTZ9XSw4ODA1OlssLHs4MjQ6ODgxN31dLDg4MTM6W1s4NzgxLDgyNF1dLDg4MTQ6W1s2MCw4MjRdXSw4ODE1OltbNjIsODI0XV0sODgxNjpbWzg4MDQsODI0XV0sODgxNzpbWzg4MDUsODI0XV0sODgxODpbLCx7ODI0Ojg4MjB9XSw4ODE5OlssLHs4MjQ6ODgyMX1dLDg4MjA6W1s4ODE4LDgyNF1dLDg4MjE6W1s4ODE5LDgyNF1dLDg4MjI6WywsezgyNDo4ODI0fV0sODgyMzpbLCx7ODI0Ojg4MjV9XSw4ODI0OltbODgyMiw4MjRdXSw4ODI1OltbODgyMyw4MjRdXSw4ODI2OlssLHs4MjQ6ODgzMn1dLDg4Mjc6WywsezgyNDo4ODMzfV0sODgyODpbLCx7ODI0Ojg5Mjh9XSw4ODI5OlssLHs4MjQ6ODkyOX1dLDg4MzI6W1s4ODI2LDgyNF1dLDg4MzM6W1s4ODI3LDgyNF1dLDg4MzQ6WywsezgyNDo4ODM2fV0sODgzNTpbLCx7ODI0Ojg4Mzd9XSw4ODM2OltbODgzNCw4MjRdXSw4ODM3OltbODgzNSw4MjRdXSw4ODM4OlssLHs4MjQ6ODg0MH1dLDg4Mzk6WywsezgyNDo4ODQxfV0sODg0MDpbWzg4MzgsODI0XV0sODg0MTpbWzg4MzksODI0XV0sODg0OTpbLCx7ODI0Ojg5MzB9XSw4ODUwOlssLHs4MjQ6ODkzMX1dLDg4NjY6WywsezgyNDo4ODc2fV0sODg3MjpbLCx7ODI0Ojg4Nzd9XSw4ODczOlssLHs4MjQ6ODg3OH1dLDg4NzU6WywsezgyNDo4ODc5fV0sODg3NjpbWzg4NjYsODI0XV0sODg3NzpbWzg4NzIsODI0XV0sODg3ODpbWzg4NzMsODI0XV0sODg3OTpbWzg4NzUsODI0XV0sODg4MjpbLCx7ODI0Ojg5Mzh9XSw4ODgzOlssLHs4MjQ6ODkzOX1dLDg4ODQ6WywsezgyNDo4OTQwfV0sODg4NTpbLCx7ODI0Ojg5NDF9XSw4OTI4OltbODgyOCw4MjRdXSw4OTI5OltbODgyOSw4MjRdXSw4OTMwOltbODg0OSw4MjRdXSw4OTMxOltbODg1MCw4MjRdXSw4OTM4OltbODg4Miw4MjRdXSw4OTM5OltbODg4Myw4MjRdXSw4OTQwOltbODg4NCw4MjRdXSw4OTQxOltbODg4NSw4MjRdXX0sXG44OTYwOns5MDAxOltbMTIyOTZdXSw5MDAyOltbMTIyOTddXX0sXG45MjE2Ons5MzEyOltbNDldLDI1Nl0sOTMxMzpbWzUwXSwyNTZdLDkzMTQ6W1s1MV0sMjU2XSw5MzE1OltbNTJdLDI1Nl0sOTMxNjpbWzUzXSwyNTZdLDkzMTc6W1s1NF0sMjU2XSw5MzE4OltbNTVdLDI1Nl0sOTMxOTpbWzU2XSwyNTZdLDkzMjA6W1s1N10sMjU2XSw5MzIxOltbNDksNDhdLDI1Nl0sOTMyMjpbWzQ5LDQ5XSwyNTZdLDkzMjM6W1s0OSw1MF0sMjU2XSw5MzI0OltbNDksNTFdLDI1Nl0sOTMyNTpbWzQ5LDUyXSwyNTZdLDkzMjY6W1s0OSw1M10sMjU2XSw5MzI3OltbNDksNTRdLDI1Nl0sOTMyODpbWzQ5LDU1XSwyNTZdLDkzMjk6W1s0OSw1Nl0sMjU2XSw5MzMwOltbNDksNTddLDI1Nl0sOTMzMTpbWzUwLDQ4XSwyNTZdLDkzMzI6W1s0MCw0OSw0MV0sMjU2XSw5MzMzOltbNDAsNTAsNDFdLDI1Nl0sOTMzNDpbWzQwLDUxLDQxXSwyNTZdLDkzMzU6W1s0MCw1Miw0MV0sMjU2XSw5MzM2OltbNDAsNTMsNDFdLDI1Nl0sOTMzNzpbWzQwLDU0LDQxXSwyNTZdLDkzMzg6W1s0MCw1NSw0MV0sMjU2XSw5MzM5OltbNDAsNTYsNDFdLDI1Nl0sOTM0MDpbWzQwLDU3LDQxXSwyNTZdLDkzNDE6W1s0MCw0OSw0OCw0MV0sMjU2XSw5MzQyOltbNDAsNDksNDksNDFdLDI1Nl0sOTM0MzpbWzQwLDQ5LDUwLDQxXSwyNTZdLDkzNDQ6W1s0MCw0OSw1MSw0MV0sMjU2XSw5MzQ1OltbNDAsNDksNTIsNDFdLDI1Nl0sOTM0NjpbWzQwLDQ5LDUzLDQxXSwyNTZdLDkzNDc6W1s0MCw0OSw1NCw0MV0sMjU2XSw5MzQ4OltbNDAsNDksNTUsNDFdLDI1Nl0sOTM0OTpbWzQwLDQ5LDU2LDQxXSwyNTZdLDkzNTA6W1s0MCw0OSw1Nyw0MV0sMjU2XSw5MzUxOltbNDAsNTAsNDgsNDFdLDI1Nl0sOTM1MjpbWzQ5LDQ2XSwyNTZdLDkzNTM6W1s1MCw0Nl0sMjU2XSw5MzU0OltbNTEsNDZdLDI1Nl0sOTM1NTpbWzUyLDQ2XSwyNTZdLDkzNTY6W1s1Myw0Nl0sMjU2XSw5MzU3OltbNTQsNDZdLDI1Nl0sOTM1ODpbWzU1LDQ2XSwyNTZdLDkzNTk6W1s1Niw0Nl0sMjU2XSw5MzYwOltbNTcsNDZdLDI1Nl0sOTM2MTpbWzQ5LDQ4LDQ2XSwyNTZdLDkzNjI6W1s0OSw0OSw0Nl0sMjU2XSw5MzYzOltbNDksNTAsNDZdLDI1Nl0sOTM2NDpbWzQ5LDUxLDQ2XSwyNTZdLDkzNjU6W1s0OSw1Miw0Nl0sMjU2XSw5MzY2OltbNDksNTMsNDZdLDI1Nl0sOTM2NzpbWzQ5LDU0LDQ2XSwyNTZdLDkzNjg6W1s0OSw1NSw0Nl0sMjU2XSw5MzY5OltbNDksNTYsNDZdLDI1Nl0sOTM3MDpbWzQ5LDU3LDQ2XSwyNTZdLDkzNzE6W1s1MCw0OCw0Nl0sMjU2XSw5MzcyOltbNDAsOTcsNDFdLDI1Nl0sOTM3MzpbWzQwLDk4LDQxXSwyNTZdLDkzNzQ6W1s0MCw5OSw0MV0sMjU2XSw5Mzc1OltbNDAsMTAwLDQxXSwyNTZdLDkzNzY6W1s0MCwxMDEsNDFdLDI1Nl0sOTM3NzpbWzQwLDEwMiw0MV0sMjU2XSw5Mzc4OltbNDAsMTAzLDQxXSwyNTZdLDkzNzk6W1s0MCwxMDQsNDFdLDI1Nl0sOTM4MDpbWzQwLDEwNSw0MV0sMjU2XSw5MzgxOltbNDAsMTA2LDQxXSwyNTZdLDkzODI6W1s0MCwxMDcsNDFdLDI1Nl0sOTM4MzpbWzQwLDEwOCw0MV0sMjU2XSw5Mzg0OltbNDAsMTA5LDQxXSwyNTZdLDkzODU6W1s0MCwxMTAsNDFdLDI1Nl0sOTM4NjpbWzQwLDExMSw0MV0sMjU2XSw5Mzg3OltbNDAsMTEyLDQxXSwyNTZdLDkzODg6W1s0MCwxMTMsNDFdLDI1Nl0sOTM4OTpbWzQwLDExNCw0MV0sMjU2XSw5MzkwOltbNDAsMTE1LDQxXSwyNTZdLDkzOTE6W1s0MCwxMTYsNDFdLDI1Nl0sOTM5MjpbWzQwLDExNyw0MV0sMjU2XSw5MzkzOltbNDAsMTE4LDQxXSwyNTZdLDkzOTQ6W1s0MCwxMTksNDFdLDI1Nl0sOTM5NTpbWzQwLDEyMCw0MV0sMjU2XSw5Mzk2OltbNDAsMTIxLDQxXSwyNTZdLDkzOTc6W1s0MCwxMjIsNDFdLDI1Nl0sOTM5ODpbWzY1XSwyNTZdLDkzOTk6W1s2Nl0sMjU2XSw5NDAwOltbNjddLDI1Nl0sOTQwMTpbWzY4XSwyNTZdLDk0MDI6W1s2OV0sMjU2XSw5NDAzOltbNzBdLDI1Nl0sOTQwNDpbWzcxXSwyNTZdLDk0MDU6W1s3Ml0sMjU2XSw5NDA2OltbNzNdLDI1Nl0sOTQwNzpbWzc0XSwyNTZdLDk0MDg6W1s3NV0sMjU2XSw5NDA5OltbNzZdLDI1Nl0sOTQxMDpbWzc3XSwyNTZdLDk0MTE6W1s3OF0sMjU2XSw5NDEyOltbNzldLDI1Nl0sOTQxMzpbWzgwXSwyNTZdLDk0MTQ6W1s4MV0sMjU2XSw5NDE1OltbODJdLDI1Nl0sOTQxNjpbWzgzXSwyNTZdLDk0MTc6W1s4NF0sMjU2XSw5NDE4OltbODVdLDI1Nl0sOTQxOTpbWzg2XSwyNTZdLDk0MjA6W1s4N10sMjU2XSw5NDIxOltbODhdLDI1Nl0sOTQyMjpbWzg5XSwyNTZdLDk0MjM6W1s5MF0sMjU2XSw5NDI0OltbOTddLDI1Nl0sOTQyNTpbWzk4XSwyNTZdLDk0MjY6W1s5OV0sMjU2XSw5NDI3OltbMTAwXSwyNTZdLDk0Mjg6W1sxMDFdLDI1Nl0sOTQyOTpbWzEwMl0sMjU2XSw5NDMwOltbMTAzXSwyNTZdLDk0MzE6W1sxMDRdLDI1Nl0sOTQzMjpbWzEwNV0sMjU2XSw5NDMzOltbMTA2XSwyNTZdLDk0MzQ6W1sxMDddLDI1Nl0sOTQzNTpbWzEwOF0sMjU2XSw5NDM2OltbMTA5XSwyNTZdLDk0Mzc6W1sxMTBdLDI1Nl0sOTQzODpbWzExMV0sMjU2XSw5NDM5OltbMTEyXSwyNTZdLDk0NDA6W1sxMTNdLDI1Nl0sOTQ0MTpbWzExNF0sMjU2XSw5NDQyOltbMTE1XSwyNTZdLDk0NDM6W1sxMTZdLDI1Nl0sOTQ0NDpbWzExN10sMjU2XSw5NDQ1OltbMTE4XSwyNTZdLDk0NDY6W1sxMTldLDI1Nl0sOTQ0NzpbWzEyMF0sMjU2XSw5NDQ4OltbMTIxXSwyNTZdLDk0NDk6W1sxMjJdLDI1Nl0sOTQ1MDpbWzQ4XSwyNTZdfSxcbjEwNzUyOnsxMDc2NDpbWzg3NDcsODc0Nyw4NzQ3LDg3NDddLDI1Nl0sMTA4Njg6W1s1OCw1OCw2MV0sMjU2XSwxMDg2OTpbWzYxLDYxXSwyNTZdLDEwODcwOltbNjEsNjEsNjFdLDI1Nl0sMTA5NzI6W1sxMDk3Myw4MjRdLDUxMl19LFxuMTEyNjQ6ezExMzg4OltbMTA2XSwyNTZdLDExMzg5OltbODZdLDI1Nl0sMTE1MDM6WywyMzBdLDExNTA0OlssMjMwXSwxMTUwNTpbLDIzMF19LFxuMTE1MjA6ezExNjMxOltbMTE2MTddLDI1Nl0sMTE2NDc6Wyw5XSwxMTc0NDpbLDIzMF0sMTE3NDU6WywyMzBdLDExNzQ2OlssMjMwXSwxMTc0NzpbLDIzMF0sMTE3NDg6WywyMzBdLDExNzQ5OlssMjMwXSwxMTc1MDpbLDIzMF0sMTE3NTE6WywyMzBdLDExNzUyOlssMjMwXSwxMTc1MzpbLDIzMF0sMTE3NTQ6WywyMzBdLDExNzU1OlssMjMwXSwxMTc1NjpbLDIzMF0sMTE3NTc6WywyMzBdLDExNzU4OlssMjMwXSwxMTc1OTpbLDIzMF0sMTE3NjA6WywyMzBdLDExNzYxOlssMjMwXSwxMTc2MjpbLDIzMF0sMTE3NjM6WywyMzBdLDExNzY0OlssMjMwXSwxMTc2NTpbLDIzMF0sMTE3NjY6WywyMzBdLDExNzY3OlssMjMwXSwxMTc2ODpbLDIzMF0sMTE3Njk6WywyMzBdLDExNzcwOlssMjMwXSwxMTc3MTpbLDIzMF0sMTE3NzI6WywyMzBdLDExNzczOlssMjMwXSwxMTc3NDpbLDIzMF0sMTE3NzU6WywyMzBdfSxcbjExNzc2OnsxMTkzNTpbWzI3NTk3XSwyNTZdLDEyMDE5OltbNDA4NjNdLDI1Nl19LFxuMTIwMzI6ezEyMDMyOltbMTk5NjhdLDI1Nl0sMTIwMzM6W1syMDAwOF0sMjU2XSwxMjAzNDpbWzIwMDIyXSwyNTZdLDEyMDM1OltbMjAwMzFdLDI1Nl0sMTIwMzY6W1syMDA1N10sMjU2XSwxMjAzNzpbWzIwMTAxXSwyNTZdLDEyMDM4OltbMjAxMDhdLDI1Nl0sMTIwMzk6W1syMDEyOF0sMjU2XSwxMjA0MDpbWzIwMTU0XSwyNTZdLDEyMDQxOltbMjA3OTldLDI1Nl0sMTIwNDI6W1syMDgzN10sMjU2XSwxMjA0MzpbWzIwODQzXSwyNTZdLDEyMDQ0OltbMjA4NjZdLDI1Nl0sMTIwNDU6W1syMDg4Nl0sMjU2XSwxMjA0NjpbWzIwOTA3XSwyNTZdLDEyMDQ3OltbMjA5NjBdLDI1Nl0sMTIwNDg6W1syMDk4MV0sMjU2XSwxMjA0OTpbWzIwOTkyXSwyNTZdLDEyMDUwOltbMjExNDddLDI1Nl0sMTIwNTE6W1syMTI0MV0sMjU2XSwxMjA1MjpbWzIxMjY5XSwyNTZdLDEyMDUzOltbMjEyNzRdLDI1Nl0sMTIwNTQ6W1syMTMwNF0sMjU2XSwxMjA1NTpbWzIxMzEzXSwyNTZdLDEyMDU2OltbMjEzNDBdLDI1Nl0sMTIwNTc6W1syMTM1M10sMjU2XSwxMjA1ODpbWzIxMzc4XSwyNTZdLDEyMDU5OltbMjE0MzBdLDI1Nl0sMTIwNjA6W1syMTQ0OF0sMjU2XSwxMjA2MTpbWzIxNDc1XSwyNTZdLDEyMDYyOltbMjIyMzFdLDI1Nl0sMTIwNjM6W1syMjMwM10sMjU2XSwxMjA2NDpbWzIyNzYzXSwyNTZdLDEyMDY1OltbMjI3ODZdLDI1Nl0sMTIwNjY6W1syMjc5NF0sMjU2XSwxMjA2NzpbWzIyODA1XSwyNTZdLDEyMDY4OltbMjI4MjNdLDI1Nl0sMTIwNjk6W1syMjg5OV0sMjU2XSwxMjA3MDpbWzIzMzc2XSwyNTZdLDEyMDcxOltbMjM0MjRdLDI1Nl0sMTIwNzI6W1syMzU0NF0sMjU2XSwxMjA3MzpbWzIzNTY3XSwyNTZdLDEyMDc0OltbMjM1ODZdLDI1Nl0sMTIwNzU6W1syMzYwOF0sMjU2XSwxMjA3NjpbWzIzNjYyXSwyNTZdLDEyMDc3OltbMjM2NjVdLDI1Nl0sMTIwNzg6W1syNDAyN10sMjU2XSwxMjA3OTpbWzI0MDM3XSwyNTZdLDEyMDgwOltbMjQwNDldLDI1Nl0sMTIwODE6W1syNDA2Ml0sMjU2XSwxMjA4MjpbWzI0MTc4XSwyNTZdLDEyMDgzOltbMjQxODZdLDI1Nl0sMTIwODQ6W1syNDE5MV0sMjU2XSwxMjA4NTpbWzI0MzA4XSwyNTZdLDEyMDg2OltbMjQzMThdLDI1Nl0sMTIwODc6W1syNDMzMV0sMjU2XSwxMjA4ODpbWzI0MzM5XSwyNTZdLDEyMDg5OltbMjQ0MDBdLDI1Nl0sMTIwOTA6W1syNDQxN10sMjU2XSwxMjA5MTpbWzI0NDM1XSwyNTZdLDEyMDkyOltbMjQ1MTVdLDI1Nl0sMTIwOTM6W1syNTA5Nl0sMjU2XSwxMjA5NDpbWzI1MTQyXSwyNTZdLDEyMDk1OltbMjUxNjNdLDI1Nl0sMTIwOTY6W1syNTkwM10sMjU2XSwxMjA5NzpbWzI1OTA4XSwyNTZdLDEyMDk4OltbMjU5OTFdLDI1Nl0sMTIwOTk6W1syNjAwN10sMjU2XSwxMjEwMDpbWzI2MDIwXSwyNTZdLDEyMTAxOltbMjYwNDFdLDI1Nl0sMTIxMDI6W1syNjA4MF0sMjU2XSwxMjEwMzpbWzI2MDg1XSwyNTZdLDEyMTA0OltbMjYzNTJdLDI1Nl0sMTIxMDU6W1syNjM3Nl0sMjU2XSwxMjEwNjpbWzI2NDA4XSwyNTZdLDEyMTA3OltbMjc0MjRdLDI1Nl0sMTIxMDg6W1syNzQ5MF0sMjU2XSwxMjEwOTpbWzI3NTEzXSwyNTZdLDEyMTEwOltbMjc1NzFdLDI1Nl0sMTIxMTE6W1syNzU5NV0sMjU2XSwxMjExMjpbWzI3NjA0XSwyNTZdLDEyMTEzOltbMjc2MTFdLDI1Nl0sMTIxMTQ6W1syNzY2M10sMjU2XSwxMjExNTpbWzI3NjY4XSwyNTZdLDEyMTE2OltbMjc3MDBdLDI1Nl0sMTIxMTc6W1syODc3OV0sMjU2XSwxMjExODpbWzI5MjI2XSwyNTZdLDEyMTE5OltbMjkyMzhdLDI1Nl0sMTIxMjA6W1syOTI0M10sMjU2XSwxMjEyMTpbWzI5MjQ3XSwyNTZdLDEyMTIyOltbMjkyNTVdLDI1Nl0sMTIxMjM6W1syOTI3M10sMjU2XSwxMjEyNDpbWzI5Mjc1XSwyNTZdLDEyMTI1OltbMjkzNTZdLDI1Nl0sMTIxMjY6W1syOTU3Ml0sMjU2XSwxMjEyNzpbWzI5NTc3XSwyNTZdLDEyMTI4OltbMjk5MTZdLDI1Nl0sMTIxMjk6W1syOTkyNl0sMjU2XSwxMjEzMDpbWzI5OTc2XSwyNTZdLDEyMTMxOltbMjk5ODNdLDI1Nl0sMTIxMzI6W1syOTk5Ml0sMjU2XSwxMjEzMzpbWzMwMDAwXSwyNTZdLDEyMTM0OltbMzAwOTFdLDI1Nl0sMTIxMzU6W1szMDA5OF0sMjU2XSwxMjEzNjpbWzMwMzI2XSwyNTZdLDEyMTM3OltbMzAzMzNdLDI1Nl0sMTIxMzg6W1szMDM4Ml0sMjU2XSwxMjEzOTpbWzMwMzk5XSwyNTZdLDEyMTQwOltbMzA0NDZdLDI1Nl0sMTIxNDE6W1szMDY4M10sMjU2XSwxMjE0MjpbWzMwNjkwXSwyNTZdLDEyMTQzOltbMzA3MDddLDI1Nl0sMTIxNDQ6W1szMTAzNF0sMjU2XSwxMjE0NTpbWzMxMTYwXSwyNTZdLDEyMTQ2OltbMzExNjZdLDI1Nl0sMTIxNDc6W1szMTM0OF0sMjU2XSwxMjE0ODpbWzMxNDM1XSwyNTZdLDEyMTQ5OltbMzE0ODFdLDI1Nl0sMTIxNTA6W1szMTg1OV0sMjU2XSwxMjE1MTpbWzMxOTkyXSwyNTZdLDEyMTUyOltbMzI1NjZdLDI1Nl0sMTIxNTM6W1szMjU5M10sMjU2XSwxMjE1NDpbWzMyNjUwXSwyNTZdLDEyMTU1OltbMzI3MDFdLDI1Nl0sMTIxNTY6W1szMjc2OV0sMjU2XSwxMjE1NzpbWzMyNzgwXSwyNTZdLDEyMTU4OltbMzI3ODZdLDI1Nl0sMTIxNTk6W1szMjgxOV0sMjU2XSwxMjE2MDpbWzMyODk1XSwyNTZdLDEyMTYxOltbMzI5MDVdLDI1Nl0sMTIxNjI6W1szMzI1MV0sMjU2XSwxMjE2MzpbWzMzMjU4XSwyNTZdLDEyMTY0OltbMzMyNjddLDI1Nl0sMTIxNjU6W1szMzI3Nl0sMjU2XSwxMjE2NjpbWzMzMjkyXSwyNTZdLDEyMTY3OltbMzMzMDddLDI1Nl0sMTIxNjg6W1szMzMxMV0sMjU2XSwxMjE2OTpbWzMzMzkwXSwyNTZdLDEyMTcwOltbMzMzOTRdLDI1Nl0sMTIxNzE6W1szMzQwMF0sMjU2XSwxMjE3MjpbWzM0MzgxXSwyNTZdLDEyMTczOltbMzQ0MTFdLDI1Nl0sMTIxNzQ6W1szNDg4MF0sMjU2XSwxMjE3NTpbWzM0ODkyXSwyNTZdLDEyMTc2OltbMzQ5MTVdLDI1Nl0sMTIxNzc6W1szNTE5OF0sMjU2XSwxMjE3ODpbWzM1MjExXSwyNTZdLDEyMTc5OltbMzUyODJdLDI1Nl0sMTIxODA6W1szNTMyOF0sMjU2XSwxMjE4MTpbWzM1ODk1XSwyNTZdLDEyMTgyOltbMzU5MTBdLDI1Nl0sMTIxODM6W1szNTkyNV0sMjU2XSwxMjE4NDpbWzM1OTYwXSwyNTZdLDEyMTg1OltbMzU5OTddLDI1Nl0sMTIxODY6W1szNjE5Nl0sMjU2XSwxMjE4NzpbWzM2MjA4XSwyNTZdLDEyMTg4OltbMzYyNzVdLDI1Nl0sMTIxODk6W1szNjUyM10sMjU2XSwxMjE5MDpbWzM2NTU0XSwyNTZdLDEyMTkxOltbMzY3NjNdLDI1Nl0sMTIxOTI6W1szNjc4NF0sMjU2XSwxMjE5MzpbWzM2Nzg5XSwyNTZdLDEyMTk0OltbMzcwMDldLDI1Nl0sMTIxOTU6W1szNzE5M10sMjU2XSwxMjE5NjpbWzM3MzE4XSwyNTZdLDEyMTk3OltbMzczMjRdLDI1Nl0sMTIxOTg6W1szNzMyOV0sMjU2XSwxMjE5OTpbWzM4MjYzXSwyNTZdLDEyMjAwOltbMzgyNzJdLDI1Nl0sMTIyMDE6W1szODQyOF0sMjU2XSwxMjIwMjpbWzM4NTgyXSwyNTZdLDEyMjAzOltbMzg1ODVdLDI1Nl0sMTIyMDQ6W1szODYzMl0sMjU2XSwxMjIwNTpbWzM4NzM3XSwyNTZdLDEyMjA2OltbMzg3NTBdLDI1Nl0sMTIyMDc6W1szODc1NF0sMjU2XSwxMjIwODpbWzM4NzYxXSwyNTZdLDEyMjA5OltbMzg4NTldLDI1Nl0sMTIyMTA6W1szODg5M10sMjU2XSwxMjIxMTpbWzM4ODk5XSwyNTZdLDEyMjEyOltbMzg5MTNdLDI1Nl0sMTIyMTM6W1szOTA4MF0sMjU2XSwxMjIxNDpbWzM5MTMxXSwyNTZdLDEyMjE1OltbMzkxMzVdLDI1Nl0sMTIyMTY6W1szOTMxOF0sMjU2XSwxMjIxNzpbWzM5MzIxXSwyNTZdLDEyMjE4OltbMzkzNDBdLDI1Nl0sMTIyMTk6W1szOTU5Ml0sMjU2XSwxMjIyMDpbWzM5NjQwXSwyNTZdLDEyMjIxOltbMzk2NDddLDI1Nl0sMTIyMjI6W1szOTcxN10sMjU2XSwxMjIyMzpbWzM5NzI3XSwyNTZdLDEyMjI0OltbMzk3MzBdLDI1Nl0sMTIyMjU6W1szOTc0MF0sMjU2XSwxMjIyNjpbWzM5NzcwXSwyNTZdLDEyMjI3OltbNDAxNjVdLDI1Nl0sMTIyMjg6W1s0MDU2NV0sMjU2XSwxMjIyOTpbWzQwNTc1XSwyNTZdLDEyMjMwOltbNDA2MTNdLDI1Nl0sMTIyMzE6W1s0MDYzNV0sMjU2XSwxMjIzMjpbWzQwNjQzXSwyNTZdLDEyMjMzOltbNDA2NTNdLDI1Nl0sMTIyMzQ6W1s0MDY1N10sMjU2XSwxMjIzNTpbWzQwNjk3XSwyNTZdLDEyMjM2OltbNDA3MDFdLDI1Nl0sMTIyMzc6W1s0MDcxOF0sMjU2XSwxMjIzODpbWzQwNzIzXSwyNTZdLDEyMjM5OltbNDA3MzZdLDI1Nl0sMTIyNDA6W1s0MDc2M10sMjU2XSwxMjI0MTpbWzQwNzc4XSwyNTZdLDEyMjQyOltbNDA3ODZdLDI1Nl0sMTIyNDM6W1s0MDg0NV0sMjU2XSwxMjI0NDpbWzQwODYwXSwyNTZdLDEyMjQ1OltbNDA4NjRdLDI1Nl19LFxuMTIyODg6ezEyMjg4OltbMzJdLDI1Nl0sMTIzMzA6WywyMThdLDEyMzMxOlssMjI4XSwxMjMzMjpbLDIzMl0sMTIzMzM6WywyMjJdLDEyMzM0OlssMjI0XSwxMjMzNTpbLDIyNF0sMTIzNDI6W1sxMjMwNl0sMjU2XSwxMjM0NDpbWzIxMzEzXSwyNTZdLDEyMzQ1OltbMjEzMTZdLDI1Nl0sMTIzNDY6W1syMTMxN10sMjU2XSwxMjM1ODpbLCx7MTI0NDE6MTI0MzZ9XSwxMjM2MzpbLCx7MTI0NDE6MTIzNjR9XSwxMjM2NDpbWzEyMzYzLDEyNDQxXV0sMTIzNjU6WywsezEyNDQxOjEyMzY2fV0sMTIzNjY6W1sxMjM2NSwxMjQ0MV1dLDEyMzY3OlssLHsxMjQ0MToxMjM2OH1dLDEyMzY4OltbMTIzNjcsMTI0NDFdXSwxMjM2OTpbLCx7MTI0NDE6MTIzNzB9XSwxMjM3MDpbWzEyMzY5LDEyNDQxXV0sMTIzNzE6WywsezEyNDQxOjEyMzcyfV0sMTIzNzI6W1sxMjM3MSwxMjQ0MV1dLDEyMzczOlssLHsxMjQ0MToxMjM3NH1dLDEyMzc0OltbMTIzNzMsMTI0NDFdXSwxMjM3NTpbLCx7MTI0NDE6MTIzNzZ9XSwxMjM3NjpbWzEyMzc1LDEyNDQxXV0sMTIzNzc6WywsezEyNDQxOjEyMzc4fV0sMTIzNzg6W1sxMjM3NywxMjQ0MV1dLDEyMzc5OlssLHsxMjQ0MToxMjM4MH1dLDEyMzgwOltbMTIzNzksMTI0NDFdXSwxMjM4MTpbLCx7MTI0NDE6MTIzODJ9XSwxMjM4MjpbWzEyMzgxLDEyNDQxXV0sMTIzODM6WywsezEyNDQxOjEyMzg0fV0sMTIzODQ6W1sxMjM4MywxMjQ0MV1dLDEyMzg1OlssLHsxMjQ0MToxMjM4Nn1dLDEyMzg2OltbMTIzODUsMTI0NDFdXSwxMjM4ODpbLCx7MTI0NDE6MTIzODl9XSwxMjM4OTpbWzEyMzg4LDEyNDQxXV0sMTIzOTA6WywsezEyNDQxOjEyMzkxfV0sMTIzOTE6W1sxMjM5MCwxMjQ0MV1dLDEyMzkyOlssLHsxMjQ0MToxMjM5M31dLDEyMzkzOltbMTIzOTIsMTI0NDFdXSwxMjM5OTpbLCx7MTI0NDE6MTI0MDAsMTI0NDI6MTI0MDF9XSwxMjQwMDpbWzEyMzk5LDEyNDQxXV0sMTI0MDE6W1sxMjM5OSwxMjQ0Ml1dLDEyNDAyOlssLHsxMjQ0MToxMjQwMywxMjQ0MjoxMjQwNH1dLDEyNDAzOltbMTI0MDIsMTI0NDFdXSwxMjQwNDpbWzEyNDAyLDEyNDQyXV0sMTI0MDU6WywsezEyNDQxOjEyNDA2LDEyNDQyOjEyNDA3fV0sMTI0MDY6W1sxMjQwNSwxMjQ0MV1dLDEyNDA3OltbMTI0MDUsMTI0NDJdXSwxMjQwODpbLCx7MTI0NDE6MTI0MDksMTI0NDI6MTI0MTB9XSwxMjQwOTpbWzEyNDA4LDEyNDQxXV0sMTI0MTA6W1sxMjQwOCwxMjQ0Ml1dLDEyNDExOlssLHsxMjQ0MToxMjQxMiwxMjQ0MjoxMjQxM31dLDEyNDEyOltbMTI0MTEsMTI0NDFdXSwxMjQxMzpbWzEyNDExLDEyNDQyXV0sMTI0MzY6W1sxMjM1OCwxMjQ0MV1dLDEyNDQxOlssOF0sMTI0NDI6Wyw4XSwxMjQ0MzpbWzMyLDEyNDQxXSwyNTZdLDEyNDQ0OltbMzIsMTI0NDJdLDI1Nl0sMTI0NDU6WywsezEyNDQxOjEyNDQ2fV0sMTI0NDY6W1sxMjQ0NSwxMjQ0MV1dLDEyNDQ3OltbMTI0MjQsMTI0MjZdLDI1Nl0sMTI0NTQ6WywsezEyNDQxOjEyNTMyfV0sMTI0NTk6WywsezEyNDQxOjEyNDYwfV0sMTI0NjA6W1sxMjQ1OSwxMjQ0MV1dLDEyNDYxOlssLHsxMjQ0MToxMjQ2Mn1dLDEyNDYyOltbMTI0NjEsMTI0NDFdXSwxMjQ2MzpbLCx7MTI0NDE6MTI0NjR9XSwxMjQ2NDpbWzEyNDYzLDEyNDQxXV0sMTI0NjU6WywsezEyNDQxOjEyNDY2fV0sMTI0NjY6W1sxMjQ2NSwxMjQ0MV1dLDEyNDY3OlssLHsxMjQ0MToxMjQ2OH1dLDEyNDY4OltbMTI0NjcsMTI0NDFdXSwxMjQ2OTpbLCx7MTI0NDE6MTI0NzB9XSwxMjQ3MDpbWzEyNDY5LDEyNDQxXV0sMTI0NzE6WywsezEyNDQxOjEyNDcyfV0sMTI0NzI6W1sxMjQ3MSwxMjQ0MV1dLDEyNDczOlssLHsxMjQ0MToxMjQ3NH1dLDEyNDc0OltbMTI0NzMsMTI0NDFdXSwxMjQ3NTpbLCx7MTI0NDE6MTI0NzZ9XSwxMjQ3NjpbWzEyNDc1LDEyNDQxXV0sMTI0Nzc6WywsezEyNDQxOjEyNDc4fV0sMTI0Nzg6W1sxMjQ3NywxMjQ0MV1dLDEyNDc5OlssLHsxMjQ0MToxMjQ4MH1dLDEyNDgwOltbMTI0NzksMTI0NDFdXSwxMjQ4MTpbLCx7MTI0NDE6MTI0ODJ9XSwxMjQ4MjpbWzEyNDgxLDEyNDQxXV0sMTI0ODQ6WywsezEyNDQxOjEyNDg1fV0sMTI0ODU6W1sxMjQ4NCwxMjQ0MV1dLDEyNDg2OlssLHsxMjQ0MToxMjQ4N31dLDEyNDg3OltbMTI0ODYsMTI0NDFdXSwxMjQ4ODpbLCx7MTI0NDE6MTI0ODl9XSwxMjQ4OTpbWzEyNDg4LDEyNDQxXV0sMTI0OTU6WywsezEyNDQxOjEyNDk2LDEyNDQyOjEyNDk3fV0sMTI0OTY6W1sxMjQ5NSwxMjQ0MV1dLDEyNDk3OltbMTI0OTUsMTI0NDJdXSwxMjQ5ODpbLCx7MTI0NDE6MTI0OTksMTI0NDI6MTI1MDB9XSwxMjQ5OTpbWzEyNDk4LDEyNDQxXV0sMTI1MDA6W1sxMjQ5OCwxMjQ0Ml1dLDEyNTAxOlssLHsxMjQ0MToxMjUwMiwxMjQ0MjoxMjUwM31dLDEyNTAyOltbMTI1MDEsMTI0NDFdXSwxMjUwMzpbWzEyNTAxLDEyNDQyXV0sMTI1MDQ6WywsezEyNDQxOjEyNTA1LDEyNDQyOjEyNTA2fV0sMTI1MDU6W1sxMjUwNCwxMjQ0MV1dLDEyNTA2OltbMTI1MDQsMTI0NDJdXSwxMjUwNzpbLCx7MTI0NDE6MTI1MDgsMTI0NDI6MTI1MDl9XSwxMjUwODpbWzEyNTA3LDEyNDQxXV0sMTI1MDk6W1sxMjUwNywxMjQ0Ml1dLDEyNTI3OlssLHsxMjQ0MToxMjUzNX1dLDEyNTI4OlssLHsxMjQ0MToxMjUzNn1dLDEyNTI5OlssLHsxMjQ0MToxMjUzN31dLDEyNTMwOlssLHsxMjQ0MToxMjUzOH1dLDEyNTMyOltbMTI0NTQsMTI0NDFdXSwxMjUzNTpbWzEyNTI3LDEyNDQxXV0sMTI1MzY6W1sxMjUyOCwxMjQ0MV1dLDEyNTM3OltbMTI1MjksMTI0NDFdXSwxMjUzODpbWzEyNTMwLDEyNDQxXV0sMTI1NDE6WywsezEyNDQxOjEyNTQyfV0sMTI1NDI6W1sxMjU0MSwxMjQ0MV1dLDEyNTQzOltbMTI0NjcsMTI0ODhdLDI1Nl19LFxuMTI1NDQ6ezEyNTkzOltbNDM1Ml0sMjU2XSwxMjU5NDpbWzQzNTNdLDI1Nl0sMTI1OTU6W1s0NTIyXSwyNTZdLDEyNTk2OltbNDM1NF0sMjU2XSwxMjU5NzpbWzQ1MjRdLDI1Nl0sMTI1OTg6W1s0NTI1XSwyNTZdLDEyNTk5OltbNDM1NV0sMjU2XSwxMjYwMDpbWzQzNTZdLDI1Nl0sMTI2MDE6W1s0MzU3XSwyNTZdLDEyNjAyOltbNDUyOF0sMjU2XSwxMjYwMzpbWzQ1MjldLDI1Nl0sMTI2MDQ6W1s0NTMwXSwyNTZdLDEyNjA1OltbNDUzMV0sMjU2XSwxMjYwNjpbWzQ1MzJdLDI1Nl0sMTI2MDc6W1s0NTMzXSwyNTZdLDEyNjA4OltbNDM3OF0sMjU2XSwxMjYwOTpbWzQzNThdLDI1Nl0sMTI2MTA6W1s0MzU5XSwyNTZdLDEyNjExOltbNDM2MF0sMjU2XSwxMjYxMjpbWzQzODVdLDI1Nl0sMTI2MTM6W1s0MzYxXSwyNTZdLDEyNjE0OltbNDM2Ml0sMjU2XSwxMjYxNTpbWzQzNjNdLDI1Nl0sMTI2MTY6W1s0MzY0XSwyNTZdLDEyNjE3OltbNDM2NV0sMjU2XSwxMjYxODpbWzQzNjZdLDI1Nl0sMTI2MTk6W1s0MzY3XSwyNTZdLDEyNjIwOltbNDM2OF0sMjU2XSwxMjYyMTpbWzQzNjldLDI1Nl0sMTI2MjI6W1s0MzcwXSwyNTZdLDEyNjIzOltbNDQ0OV0sMjU2XSwxMjYyNDpbWzQ0NTBdLDI1Nl0sMTI2MjU6W1s0NDUxXSwyNTZdLDEyNjI2OltbNDQ1Ml0sMjU2XSwxMjYyNzpbWzQ0NTNdLDI1Nl0sMTI2Mjg6W1s0NDU0XSwyNTZdLDEyNjI5OltbNDQ1NV0sMjU2XSwxMjYzMDpbWzQ0NTZdLDI1Nl0sMTI2MzE6W1s0NDU3XSwyNTZdLDEyNjMyOltbNDQ1OF0sMjU2XSwxMjYzMzpbWzQ0NTldLDI1Nl0sMTI2MzQ6W1s0NDYwXSwyNTZdLDEyNjM1OltbNDQ2MV0sMjU2XSwxMjYzNjpbWzQ0NjJdLDI1Nl0sMTI2Mzc6W1s0NDYzXSwyNTZdLDEyNjM4OltbNDQ2NF0sMjU2XSwxMjYzOTpbWzQ0NjVdLDI1Nl0sMTI2NDA6W1s0NDY2XSwyNTZdLDEyNjQxOltbNDQ2N10sMjU2XSwxMjY0MjpbWzQ0NjhdLDI1Nl0sMTI2NDM6W1s0NDY5XSwyNTZdLDEyNjQ0OltbNDQ0OF0sMjU2XSwxMjY0NTpbWzQzNzJdLDI1Nl0sMTI2NDY6W1s0MzczXSwyNTZdLDEyNjQ3OltbNDU1MV0sMjU2XSwxMjY0ODpbWzQ1NTJdLDI1Nl0sMTI2NDk6W1s0NTU2XSwyNTZdLDEyNjUwOltbNDU1OF0sMjU2XSwxMjY1MTpbWzQ1NjNdLDI1Nl0sMTI2NTI6W1s0NTY3XSwyNTZdLDEyNjUzOltbNDU2OV0sMjU2XSwxMjY1NDpbWzQzODBdLDI1Nl0sMTI2NTU6W1s0NTczXSwyNTZdLDEyNjU2OltbNDU3NV0sMjU2XSwxMjY1NzpbWzQzODFdLDI1Nl0sMTI2NTg6W1s0MzgyXSwyNTZdLDEyNjU5OltbNDM4NF0sMjU2XSwxMjY2MDpbWzQzODZdLDI1Nl0sMTI2NjE6W1s0Mzg3XSwyNTZdLDEyNjYyOltbNDM5MV0sMjU2XSwxMjY2MzpbWzQzOTNdLDI1Nl0sMTI2NjQ6W1s0Mzk1XSwyNTZdLDEyNjY1OltbNDM5Nl0sMjU2XSwxMjY2NjpbWzQzOTddLDI1Nl0sMTI2Njc6W1s0Mzk4XSwyNTZdLDEyNjY4OltbNDM5OV0sMjU2XSwxMjY2OTpbWzQ0MDJdLDI1Nl0sMTI2NzA6W1s0NDA2XSwyNTZdLDEyNjcxOltbNDQxNl0sMjU2XSwxMjY3MjpbWzQ0MjNdLDI1Nl0sMTI2NzM6W1s0NDI4XSwyNTZdLDEyNjc0OltbNDU5M10sMjU2XSwxMjY3NTpbWzQ1OTRdLDI1Nl0sMTI2NzY6W1s0NDM5XSwyNTZdLDEyNjc3OltbNDQ0MF0sMjU2XSwxMjY3ODpbWzQ0NDFdLDI1Nl0sMTI2Nzk6W1s0NDg0XSwyNTZdLDEyNjgwOltbNDQ4NV0sMjU2XSwxMjY4MTpbWzQ0ODhdLDI1Nl0sMTI2ODI6W1s0NDk3XSwyNTZdLDEyNjgzOltbNDQ5OF0sMjU2XSwxMjY4NDpbWzQ1MDBdLDI1Nl0sMTI2ODU6W1s0NTEwXSwyNTZdLDEyNjg2OltbNDUxM10sMjU2XSwxMjY5MDpbWzE5OTY4XSwyNTZdLDEyNjkxOltbMjAxMDhdLDI1Nl0sMTI2OTI6W1sxOTk3N10sMjU2XSwxMjY5MzpbWzIyMjM1XSwyNTZdLDEyNjk0OltbMTk5NzhdLDI1Nl0sMTI2OTU6W1syMDAxM10sMjU2XSwxMjY5NjpbWzE5OTc5XSwyNTZdLDEyNjk3OltbMzAwMDJdLDI1Nl0sMTI2OTg6W1syMDA1N10sMjU2XSwxMjY5OTpbWzE5OTkzXSwyNTZdLDEyNzAwOltbMTk5NjldLDI1Nl0sMTI3MDE6W1syMjgyNV0sMjU2XSwxMjcwMjpbWzIyMzIwXSwyNTZdLDEyNzAzOltbMjAxNTRdLDI1Nl19LFxuMTI4MDA6ezEyODAwOltbNDAsNDM1Miw0MV0sMjU2XSwxMjgwMTpbWzQwLDQzNTQsNDFdLDI1Nl0sMTI4MDI6W1s0MCw0MzU1LDQxXSwyNTZdLDEyODAzOltbNDAsNDM1Nyw0MV0sMjU2XSwxMjgwNDpbWzQwLDQzNTgsNDFdLDI1Nl0sMTI4MDU6W1s0MCw0MzU5LDQxXSwyNTZdLDEyODA2OltbNDAsNDM2MSw0MV0sMjU2XSwxMjgwNzpbWzQwLDQzNjMsNDFdLDI1Nl0sMTI4MDg6W1s0MCw0MzY0LDQxXSwyNTZdLDEyODA5OltbNDAsNDM2Niw0MV0sMjU2XSwxMjgxMDpbWzQwLDQzNjcsNDFdLDI1Nl0sMTI4MTE6W1s0MCw0MzY4LDQxXSwyNTZdLDEyODEyOltbNDAsNDM2OSw0MV0sMjU2XSwxMjgxMzpbWzQwLDQzNzAsNDFdLDI1Nl0sMTI4MTQ6W1s0MCw0MzUyLDQ0NDksNDFdLDI1Nl0sMTI4MTU6W1s0MCw0MzU0LDQ0NDksNDFdLDI1Nl0sMTI4MTY6W1s0MCw0MzU1LDQ0NDksNDFdLDI1Nl0sMTI4MTc6W1s0MCw0MzU3LDQ0NDksNDFdLDI1Nl0sMTI4MTg6W1s0MCw0MzU4LDQ0NDksNDFdLDI1Nl0sMTI4MTk6W1s0MCw0MzU5LDQ0NDksNDFdLDI1Nl0sMTI4MjA6W1s0MCw0MzYxLDQ0NDksNDFdLDI1Nl0sMTI4MjE6W1s0MCw0MzYzLDQ0NDksNDFdLDI1Nl0sMTI4MjI6W1s0MCw0MzY0LDQ0NDksNDFdLDI1Nl0sMTI4MjM6W1s0MCw0MzY2LDQ0NDksNDFdLDI1Nl0sMTI4MjQ6W1s0MCw0MzY3LDQ0NDksNDFdLDI1Nl0sMTI4MjU6W1s0MCw0MzY4LDQ0NDksNDFdLDI1Nl0sMTI4MjY6W1s0MCw0MzY5LDQ0NDksNDFdLDI1Nl0sMTI4Mjc6W1s0MCw0MzcwLDQ0NDksNDFdLDI1Nl0sMTI4Mjg6W1s0MCw0MzY0LDQ0NjIsNDFdLDI1Nl0sMTI4Mjk6W1s0MCw0MzYzLDQ0NTcsNDM2NCw0NDUzLDQ1MjMsNDFdLDI1Nl0sMTI4MzA6W1s0MCw0MzYzLDQ0NTcsNDM3MCw0NDYyLDQxXSwyNTZdLDEyODMyOltbNDAsMTk5NjgsNDFdLDI1Nl0sMTI4MzM6W1s0MCwyMDEwOCw0MV0sMjU2XSwxMjgzNDpbWzQwLDE5OTc3LDQxXSwyNTZdLDEyODM1OltbNDAsMjIyMzUsNDFdLDI1Nl0sMTI4MzY6W1s0MCwyMDExNiw0MV0sMjU2XSwxMjgzNzpbWzQwLDIwODQ1LDQxXSwyNTZdLDEyODM4OltbNDAsMTk5NzEsNDFdLDI1Nl0sMTI4Mzk6W1s0MCwyMDg0Myw0MV0sMjU2XSwxMjg0MDpbWzQwLDIwMDYxLDQxXSwyNTZdLDEyODQxOltbNDAsMjEzMTMsNDFdLDI1Nl0sMTI4NDI6W1s0MCwyNjM3Niw0MV0sMjU2XSwxMjg0MzpbWzQwLDI4Nzc5LDQxXSwyNTZdLDEyODQ0OltbNDAsMjc3MDAsNDFdLDI1Nl0sMTI4NDU6W1s0MCwyNjQwOCw0MV0sMjU2XSwxMjg0NjpbWzQwLDM3MzI5LDQxXSwyNTZdLDEyODQ3OltbNDAsMjIzMDMsNDFdLDI1Nl0sMTI4NDg6W1s0MCwyNjA4NSw0MV0sMjU2XSwxMjg0OTpbWzQwLDI2NjY2LDQxXSwyNTZdLDEyODUwOltbNDAsMjYzNzcsNDFdLDI1Nl0sMTI4NTE6W1s0MCwzMTAzOCw0MV0sMjU2XSwxMjg1MjpbWzQwLDIxNTE3LDQxXSwyNTZdLDEyODUzOltbNDAsMjkzMDUsNDFdLDI1Nl0sMTI4NTQ6W1s0MCwzNjAwMSw0MV0sMjU2XSwxMjg1NTpbWzQwLDMxMDY5LDQxXSwyNTZdLDEyODU2OltbNDAsMjExNzIsNDFdLDI1Nl0sMTI4NTc6W1s0MCwyMDE5NSw0MV0sMjU2XSwxMjg1ODpbWzQwLDIxNjI4LDQxXSwyNTZdLDEyODU5OltbNDAsMjMzOTgsNDFdLDI1Nl0sMTI4NjA6W1s0MCwzMDQzNSw0MV0sMjU2XSwxMjg2MTpbWzQwLDIwMjI1LDQxXSwyNTZdLDEyODYyOltbNDAsMzYwMzksNDFdLDI1Nl0sMTI4NjM6W1s0MCwyMTMzMiw0MV0sMjU2XSwxMjg2NDpbWzQwLDMxMDg1LDQxXSwyNTZdLDEyODY1OltbNDAsMjAyNDEsNDFdLDI1Nl0sMTI4NjY6W1s0MCwzMzI1OCw0MV0sMjU2XSwxMjg2NzpbWzQwLDMzMjY3LDQxXSwyNTZdLDEyODY4OltbMjE4MzldLDI1Nl0sMTI4Njk6W1syNDE4OF0sMjU2XSwxMjg3MDpbWzI1OTkxXSwyNTZdLDEyODcxOltbMzE2MzFdLDI1Nl0sMTI4ODA6W1s4MCw4NCw2OV0sMjU2XSwxMjg4MTpbWzUwLDQ5XSwyNTZdLDEyODgyOltbNTAsNTBdLDI1Nl0sMTI4ODM6W1s1MCw1MV0sMjU2XSwxMjg4NDpbWzUwLDUyXSwyNTZdLDEyODg1OltbNTAsNTNdLDI1Nl0sMTI4ODY6W1s1MCw1NF0sMjU2XSwxMjg4NzpbWzUwLDU1XSwyNTZdLDEyODg4OltbNTAsNTZdLDI1Nl0sMTI4ODk6W1s1MCw1N10sMjU2XSwxMjg5MDpbWzUxLDQ4XSwyNTZdLDEyODkxOltbNTEsNDldLDI1Nl0sMTI4OTI6W1s1MSw1MF0sMjU2XSwxMjg5MzpbWzUxLDUxXSwyNTZdLDEyODk0OltbNTEsNTJdLDI1Nl0sMTI4OTU6W1s1MSw1M10sMjU2XSwxMjg5NjpbWzQzNTJdLDI1Nl0sMTI4OTc6W1s0MzU0XSwyNTZdLDEyODk4OltbNDM1NV0sMjU2XSwxMjg5OTpbWzQzNTddLDI1Nl0sMTI5MDA6W1s0MzU4XSwyNTZdLDEyOTAxOltbNDM1OV0sMjU2XSwxMjkwMjpbWzQzNjFdLDI1Nl0sMTI5MDM6W1s0MzYzXSwyNTZdLDEyOTA0OltbNDM2NF0sMjU2XSwxMjkwNTpbWzQzNjZdLDI1Nl0sMTI5MDY6W1s0MzY3XSwyNTZdLDEyOTA3OltbNDM2OF0sMjU2XSwxMjkwODpbWzQzNjldLDI1Nl0sMTI5MDk6W1s0MzcwXSwyNTZdLDEyOTEwOltbNDM1Miw0NDQ5XSwyNTZdLDEyOTExOltbNDM1NCw0NDQ5XSwyNTZdLDEyOTEyOltbNDM1NSw0NDQ5XSwyNTZdLDEyOTEzOltbNDM1Nyw0NDQ5XSwyNTZdLDEyOTE0OltbNDM1OCw0NDQ5XSwyNTZdLDEyOTE1OltbNDM1OSw0NDQ5XSwyNTZdLDEyOTE2OltbNDM2MSw0NDQ5XSwyNTZdLDEyOTE3OltbNDM2Myw0NDQ5XSwyNTZdLDEyOTE4OltbNDM2NCw0NDQ5XSwyNTZdLDEyOTE5OltbNDM2Niw0NDQ5XSwyNTZdLDEyOTIwOltbNDM2Nyw0NDQ5XSwyNTZdLDEyOTIxOltbNDM2OCw0NDQ5XSwyNTZdLDEyOTIyOltbNDM2OSw0NDQ5XSwyNTZdLDEyOTIzOltbNDM3MCw0NDQ5XSwyNTZdLDEyOTI0OltbNDM2Niw0NDQ5LDQ1MzUsNDM1Miw0NDU3XSwyNTZdLDEyOTI1OltbNDM2NCw0NDYyLDQzNjMsNDQ2OF0sMjU2XSwxMjkyNjpbWzQzNjMsNDQ2Ml0sMjU2XSwxMjkyODpbWzE5OTY4XSwyNTZdLDEyOTI5OltbMjAxMDhdLDI1Nl0sMTI5MzA6W1sxOTk3N10sMjU2XSwxMjkzMTpbWzIyMjM1XSwyNTZdLDEyOTMyOltbMjAxMTZdLDI1Nl0sMTI5MzM6W1syMDg0NV0sMjU2XSwxMjkzNDpbWzE5OTcxXSwyNTZdLDEyOTM1OltbMjA4NDNdLDI1Nl0sMTI5MzY6W1syMDA2MV0sMjU2XSwxMjkzNzpbWzIxMzEzXSwyNTZdLDEyOTM4OltbMjYzNzZdLDI1Nl0sMTI5Mzk6W1syODc3OV0sMjU2XSwxMjk0MDpbWzI3NzAwXSwyNTZdLDEyOTQxOltbMjY0MDhdLDI1Nl0sMTI5NDI6W1szNzMyOV0sMjU2XSwxMjk0MzpbWzIyMzAzXSwyNTZdLDEyOTQ0OltbMjYwODVdLDI1Nl0sMTI5NDU6W1syNjY2Nl0sMjU2XSwxMjk0NjpbWzI2Mzc3XSwyNTZdLDEyOTQ3OltbMzEwMzhdLDI1Nl0sMTI5NDg6W1syMTUxN10sMjU2XSwxMjk0OTpbWzI5MzA1XSwyNTZdLDEyOTUwOltbMzYwMDFdLDI1Nl0sMTI5NTE6W1szMTA2OV0sMjU2XSwxMjk1MjpbWzIxMTcyXSwyNTZdLDEyOTUzOltbMzExOTJdLDI1Nl0sMTI5NTQ6W1szMDAwN10sMjU2XSwxMjk1NTpbWzIyODk5XSwyNTZdLDEyOTU2OltbMzY5NjldLDI1Nl0sMTI5NTc6W1syMDc3OF0sMjU2XSwxMjk1ODpbWzIxMzYwXSwyNTZdLDEyOTU5OltbMjc4ODBdLDI1Nl0sMTI5NjA6W1szODkxN10sMjU2XSwxMjk2MTpbWzIwMjQxXSwyNTZdLDEyOTYyOltbMjA4ODldLDI1Nl0sMTI5NjM6W1syNzQ5MV0sMjU2XSwxMjk2NDpbWzE5OTc4XSwyNTZdLDEyOTY1OltbMjAwMTNdLDI1Nl0sMTI5NjY6W1sxOTk3OV0sMjU2XSwxMjk2NzpbWzI0MDM4XSwyNTZdLDEyOTY4OltbMjE0OTFdLDI1Nl0sMTI5Njk6W1syMTMwN10sMjU2XSwxMjk3MDpbWzIzNDQ3XSwyNTZdLDEyOTcxOltbMjMzOThdLDI1Nl0sMTI5NzI6W1szMDQzNV0sMjU2XSwxMjk3MzpbWzIwMjI1XSwyNTZdLDEyOTc0OltbMzYwMzldLDI1Nl0sMTI5NzU6W1syMTMzMl0sMjU2XSwxMjk3NjpbWzIyODEyXSwyNTZdLDEyOTc3OltbNTEsNTRdLDI1Nl0sMTI5Nzg6W1s1MSw1NV0sMjU2XSwxMjk3OTpbWzUxLDU2XSwyNTZdLDEyOTgwOltbNTEsNTddLDI1Nl0sMTI5ODE6W1s1Miw0OF0sMjU2XSwxMjk4MjpbWzUyLDQ5XSwyNTZdLDEyOTgzOltbNTIsNTBdLDI1Nl0sMTI5ODQ6W1s1Miw1MV0sMjU2XSwxMjk4NTpbWzUyLDUyXSwyNTZdLDEyOTg2OltbNTIsNTNdLDI1Nl0sMTI5ODc6W1s1Miw1NF0sMjU2XSwxMjk4ODpbWzUyLDU1XSwyNTZdLDEyOTg5OltbNTIsNTZdLDI1Nl0sMTI5OTA6W1s1Miw1N10sMjU2XSwxMjk5MTpbWzUzLDQ4XSwyNTZdLDEyOTkyOltbNDksMjYzNzZdLDI1Nl0sMTI5OTM6W1s1MCwyNjM3Nl0sMjU2XSwxMjk5NDpbWzUxLDI2Mzc2XSwyNTZdLDEyOTk1OltbNTIsMjYzNzZdLDI1Nl0sMTI5OTY6W1s1MywyNjM3Nl0sMjU2XSwxMjk5NzpbWzU0LDI2Mzc2XSwyNTZdLDEyOTk4OltbNTUsMjYzNzZdLDI1Nl0sMTI5OTk6W1s1NiwyNjM3Nl0sMjU2XSwxMzAwMDpbWzU3LDI2Mzc2XSwyNTZdLDEzMDAxOltbNDksNDgsMjYzNzZdLDI1Nl0sMTMwMDI6W1s0OSw0OSwyNjM3Nl0sMjU2XSwxMzAwMzpbWzQ5LDUwLDI2Mzc2XSwyNTZdLDEzMDA0OltbNzIsMTAzXSwyNTZdLDEzMDA1OltbMTAxLDExNCwxMDNdLDI1Nl0sMTMwMDY6W1sxMDEsODZdLDI1Nl0sMTMwMDc6W1s3Niw4NCw2OF0sMjU2XSwxMzAwODpbWzEyNDUwXSwyNTZdLDEzMDA5OltbMTI0NTJdLDI1Nl0sMTMwMTA6W1sxMjQ1NF0sMjU2XSwxMzAxMTpbWzEyNDU2XSwyNTZdLDEzMDEyOltbMTI0NThdLDI1Nl0sMTMwMTM6W1sxMjQ1OV0sMjU2XSwxMzAxNDpbWzEyNDYxXSwyNTZdLDEzMDE1OltbMTI0NjNdLDI1Nl0sMTMwMTY6W1sxMjQ2NV0sMjU2XSwxMzAxNzpbWzEyNDY3XSwyNTZdLDEzMDE4OltbMTI0NjldLDI1Nl0sMTMwMTk6W1sxMjQ3MV0sMjU2XSwxMzAyMDpbWzEyNDczXSwyNTZdLDEzMDIxOltbMTI0NzVdLDI1Nl0sMTMwMjI6W1sxMjQ3N10sMjU2XSwxMzAyMzpbWzEyNDc5XSwyNTZdLDEzMDI0OltbMTI0ODFdLDI1Nl0sMTMwMjU6W1sxMjQ4NF0sMjU2XSwxMzAyNjpbWzEyNDg2XSwyNTZdLDEzMDI3OltbMTI0ODhdLDI1Nl0sMTMwMjg6W1sxMjQ5MF0sMjU2XSwxMzAyOTpbWzEyNDkxXSwyNTZdLDEzMDMwOltbMTI0OTJdLDI1Nl0sMTMwMzE6W1sxMjQ5M10sMjU2XSwxMzAzMjpbWzEyNDk0XSwyNTZdLDEzMDMzOltbMTI0OTVdLDI1Nl0sMTMwMzQ6W1sxMjQ5OF0sMjU2XSwxMzAzNTpbWzEyNTAxXSwyNTZdLDEzMDM2OltbMTI1MDRdLDI1Nl0sMTMwMzc6W1sxMjUwN10sMjU2XSwxMzAzODpbWzEyNTEwXSwyNTZdLDEzMDM5OltbMTI1MTFdLDI1Nl0sMTMwNDA6W1sxMjUxMl0sMjU2XSwxMzA0MTpbWzEyNTEzXSwyNTZdLDEzMDQyOltbMTI1MTRdLDI1Nl0sMTMwNDM6W1sxMjUxNl0sMjU2XSwxMzA0NDpbWzEyNTE4XSwyNTZdLDEzMDQ1OltbMTI1MjBdLDI1Nl0sMTMwNDY6W1sxMjUyMV0sMjU2XSwxMzA0NzpbWzEyNTIyXSwyNTZdLDEzMDQ4OltbMTI1MjNdLDI1Nl0sMTMwNDk6W1sxMjUyNF0sMjU2XSwxMzA1MDpbWzEyNTI1XSwyNTZdLDEzMDUxOltbMTI1MjddLDI1Nl0sMTMwNTI6W1sxMjUyOF0sMjU2XSwxMzA1MzpbWzEyNTI5XSwyNTZdLDEzMDU0OltbMTI1MzBdLDI1Nl19LFxuMTMwNTY6ezEzMDU2OltbMTI0NTAsMTI0OTcsMTI1NDAsMTI0ODhdLDI1Nl0sMTMwNTc6W1sxMjQ1MCwxMjUyMywxMjUwMSwxMjQ0OV0sMjU2XSwxMzA1ODpbWzEyNDUwLDEyNTMxLDEyNTA2LDEyNDUwXSwyNTZdLDEzMDU5OltbMTI0NTAsMTI1NDAsMTI1MjNdLDI1Nl0sMTMwNjA6W1sxMjQ1MiwxMjQ5MSwxMjUzMSwxMjQ2NF0sMjU2XSwxMzA2MTpbWzEyNDUyLDEyNTMxLDEyNDgxXSwyNTZdLDEzMDYyOltbMTI0NTQsMTI0NTcsMTI1MzFdLDI1Nl0sMTMwNjM6W1sxMjQ1NiwxMjQ3MywxMjQ2MywxMjU0MCwxMjQ4OV0sMjU2XSwxMzA2NDpbWzEyNDU2LDEyNTQwLDEyNDU5LDEyNTQwXSwyNTZdLDEzMDY1OltbMTI0NTgsMTI1MzEsMTI0NzNdLDI1Nl0sMTMwNjY6W1sxMjQ1OCwxMjU0MCwxMjUxMl0sMjU2XSwxMzA2NzpbWzEyNDU5LDEyNDUyLDEyNTIyXSwyNTZdLDEzMDY4OltbMTI0NTksMTI1MjEsMTI0ODMsMTI0ODhdLDI1Nl0sMTMwNjk6W1sxMjQ1OSwxMjUyNSwxMjUyMiwxMjU0MF0sMjU2XSwxMzA3MDpbWzEyNDYwLDEyNTI1LDEyNTMxXSwyNTZdLDEzMDcxOltbMTI0NjAsMTI1MzEsMTI1MTBdLDI1Nl0sMTMwNzI6W1sxMjQ2MiwxMjQ2MF0sMjU2XSwxMzA3MzpbWzEyNDYyLDEyNDkxLDEyNTQwXSwyNTZdLDEzMDc0OltbMTI0NjEsMTI1MTcsMTI1MjIsMTI1NDBdLDI1Nl0sMTMwNzU6W1sxMjQ2MiwxMjUyMywxMjQ4MCwxMjU0MF0sMjU2XSwxMzA3NjpbWzEyNDYxLDEyNTI1XSwyNTZdLDEzMDc3OltbMTI0NjEsMTI1MjUsMTI0NjQsMTI1MjEsMTI1MTJdLDI1Nl0sMTMwNzg6W1sxMjQ2MSwxMjUyNSwxMjUxMywxMjU0MCwxMjQ4OCwxMjUyM10sMjU2XSwxMzA3OTpbWzEyNDYxLDEyNTI1LDEyNTI3LDEyNDgzLDEyNDg4XSwyNTZdLDEzMDgwOltbMTI0NjQsMTI1MjEsMTI1MTJdLDI1Nl0sMTMwODE6W1sxMjQ2NCwxMjUyMSwxMjUxMiwxMjQ4OCwxMjUzMV0sMjU2XSwxMzA4MjpbWzEyNDYzLDEyNTIzLDEyNDc2LDEyNDUyLDEyNTI1XSwyNTZdLDEzMDgzOltbMTI0NjMsMTI1MjUsMTI1NDAsMTI0OTNdLDI1Nl0sMTMwODQ6W1sxMjQ2NSwxMjU0MCwxMjQ3M10sMjU2XSwxMzA4NTpbWzEyNDY3LDEyNTIzLDEyNDkwXSwyNTZdLDEzMDg2OltbMTI0NjcsMTI1NDAsMTI1MDldLDI1Nl0sMTMwODc6W1sxMjQ2OSwxMjQ1MiwxMjQ2MywxMjUyM10sMjU2XSwxMzA4ODpbWzEyNDY5LDEyNTMxLDEyNDgxLDEyNTQwLDEyNTEyXSwyNTZdLDEzMDg5OltbMTI0NzEsMTI1MjIsMTI1MzEsMTI0NjRdLDI1Nl0sMTMwOTA6W1sxMjQ3NSwxMjUzMSwxMjQ4MV0sMjU2XSwxMzA5MTpbWzEyNDc1LDEyNTMxLDEyNDg4XSwyNTZdLDEzMDkyOltbMTI0ODAsMTI1NDAsMTI0NzNdLDI1Nl0sMTMwOTM6W1sxMjQ4NywxMjQ3MV0sMjU2XSwxMzA5NDpbWzEyNDg5LDEyNTIzXSwyNTZdLDEzMDk1OltbMTI0ODgsMTI1MzFdLDI1Nl0sMTMwOTY6W1sxMjQ5MCwxMjQ5NF0sMjU2XSwxMzA5NzpbWzEyNDk0LDEyNDgzLDEyNDg4XSwyNTZdLDEzMDk4OltbMTI0OTUsMTI0NTIsMTI0ODRdLDI1Nl0sMTMwOTk6W1sxMjQ5NywxMjU0MCwxMjQ3NSwxMjUzMSwxMjQ4OF0sMjU2XSwxMzEwMDpbWzEyNDk3LDEyNTQwLDEyNDg0XSwyNTZdLDEzMTAxOltbMTI0OTYsMTI1NDAsMTI1MjQsMTI1MjNdLDI1Nl0sMTMxMDI6W1sxMjUwMCwxMjQ1MCwxMjQ3MywxMjQ4OCwxMjUyM10sMjU2XSwxMzEwMzpbWzEyNTAwLDEyNDYzLDEyNTIzXSwyNTZdLDEzMTA0OltbMTI1MDAsMTI0NjddLDI1Nl0sMTMxMDU6W1sxMjQ5OSwxMjUyM10sMjU2XSwxMzEwNjpbWzEyNTAxLDEyNDQ5LDEyNTIxLDEyNDgzLDEyNDg5XSwyNTZdLDEzMTA3OltbMTI1MDEsMTI0NTEsMTI1NDAsMTI0ODhdLDI1Nl0sMTMxMDg6W1sxMjUwMiwxMjQ4MywxMjQ3MSwxMjQ1NSwxMjUyM10sMjU2XSwxMzEwOTpbWzEyNTAxLDEyNTIxLDEyNTMxXSwyNTZdLDEzMTEwOltbMTI1MDQsMTI0NjMsMTI0NzksMTI1NDAsMTI1MjNdLDI1Nl0sMTMxMTE6W1sxMjUwNiwxMjQ3N10sMjU2XSwxMzExMjpbWzEyNTA2LDEyNDkxLDEyNDk4XSwyNTZdLDEzMTEzOltbMTI1MDQsMTI1MjMsMTI0ODRdLDI1Nl0sMTMxMTQ6W1sxMjUwNiwxMjUzMSwxMjQ3M10sMjU2XSwxMzExNTpbWzEyNTA2LDEyNTQwLDEyNDcyXSwyNTZdLDEzMTE2OltbMTI1MDUsMTI1NDAsMTI0NzldLDI1Nl0sMTMxMTc6W1sxMjUwOSwxMjQ1MiwxMjUzMSwxMjQ4OF0sMjU2XSwxMzExODpbWzEyNTA4LDEyNTIzLDEyNDg4XSwyNTZdLDEzMTE5OltbMTI1MDcsMTI1MzFdLDI1Nl0sMTMxMjA6W1sxMjUwOSwxMjUzMSwxMjQ4OV0sMjU2XSwxMzEyMTpbWzEyNTA3LDEyNTQwLDEyNTIzXSwyNTZdLDEzMTIyOltbMTI1MDcsMTI1NDAsMTI1MzFdLDI1Nl0sMTMxMjM6W1sxMjUxMCwxMjQ1MiwxMjQ2MywxMjUyNV0sMjU2XSwxMzEyNDpbWzEyNTEwLDEyNDUyLDEyNTIzXSwyNTZdLDEzMTI1OltbMTI1MTAsMTI0ODMsMTI0OTVdLDI1Nl0sMTMxMjY6W1sxMjUxMCwxMjUyMywxMjQ2M10sMjU2XSwxMzEyNzpbWzEyNTEwLDEyNTMxLDEyNDcxLDEyNTE5LDEyNTMxXSwyNTZdLDEzMTI4OltbMTI1MTEsMTI0NjMsMTI1MjUsMTI1MzFdLDI1Nl0sMTMxMjk6W1sxMjUxMSwxMjUyMl0sMjU2XSwxMzEzMDpbWzEyNTExLDEyNTIyLDEyNDk2LDEyNTQwLDEyNTIzXSwyNTZdLDEzMTMxOltbMTI1MTMsMTI0NjBdLDI1Nl0sMTMxMzI6W1sxMjUxMywxMjQ2MCwxMjQ4OCwxMjUzMV0sMjU2XSwxMzEzMzpbWzEyNTEzLDEyNTQwLDEyNDg4LDEyNTIzXSwyNTZdLDEzMTM0OltbMTI1MTYsMTI1NDAsMTI0ODldLDI1Nl0sMTMxMzU6W1sxMjUxNiwxMjU0MCwxMjUyM10sMjU2XSwxMzEzNjpbWzEyNTE4LDEyNDUwLDEyNTMxXSwyNTZdLDEzMTM3OltbMTI1MjIsMTI0ODMsMTI0ODgsMTI1MjNdLDI1Nl0sMTMxMzg6W1sxMjUyMiwxMjUyMV0sMjU2XSwxMzEzOTpbWzEyNTIzLDEyNTAwLDEyNTQwXSwyNTZdLDEzMTQwOltbMTI1MjMsMTI1NDAsMTI1MDIsMTI1MjNdLDI1Nl0sMTMxNDE6W1sxMjUyNCwxMjUxMl0sMjU2XSwxMzE0MjpbWzEyNTI0LDEyNTMxLDEyNDg4LDEyNDY2LDEyNTMxXSwyNTZdLDEzMTQzOltbMTI1MjcsMTI0ODMsMTI0ODhdLDI1Nl0sMTMxNDQ6W1s0OCwyODg1N10sMjU2XSwxMzE0NTpbWzQ5LDI4ODU3XSwyNTZdLDEzMTQ2OltbNTAsMjg4NTddLDI1Nl0sMTMxNDc6W1s1MSwyODg1N10sMjU2XSwxMzE0ODpbWzUyLDI4ODU3XSwyNTZdLDEzMTQ5OltbNTMsMjg4NTddLDI1Nl0sMTMxNTA6W1s1NCwyODg1N10sMjU2XSwxMzE1MTpbWzU1LDI4ODU3XSwyNTZdLDEzMTUyOltbNTYsMjg4NTddLDI1Nl0sMTMxNTM6W1s1NywyODg1N10sMjU2XSwxMzE1NDpbWzQ5LDQ4LDI4ODU3XSwyNTZdLDEzMTU1OltbNDksNDksMjg4NTddLDI1Nl0sMTMxNTY6W1s0OSw1MCwyODg1N10sMjU2XSwxMzE1NzpbWzQ5LDUxLDI4ODU3XSwyNTZdLDEzMTU4OltbNDksNTIsMjg4NTddLDI1Nl0sMTMxNTk6W1s0OSw1MywyODg1N10sMjU2XSwxMzE2MDpbWzQ5LDU0LDI4ODU3XSwyNTZdLDEzMTYxOltbNDksNTUsMjg4NTddLDI1Nl0sMTMxNjI6W1s0OSw1NiwyODg1N10sMjU2XSwxMzE2MzpbWzQ5LDU3LDI4ODU3XSwyNTZdLDEzMTY0OltbNTAsNDgsMjg4NTddLDI1Nl0sMTMxNjU6W1s1MCw0OSwyODg1N10sMjU2XSwxMzE2NjpbWzUwLDUwLDI4ODU3XSwyNTZdLDEzMTY3OltbNTAsNTEsMjg4NTddLDI1Nl0sMTMxNjg6W1s1MCw1MiwyODg1N10sMjU2XSwxMzE2OTpbWzEwNCw4MCw5N10sMjU2XSwxMzE3MDpbWzEwMCw5N10sMjU2XSwxMzE3MTpbWzY1LDg1XSwyNTZdLDEzMTcyOltbOTgsOTcsMTE0XSwyNTZdLDEzMTczOltbMTExLDg2XSwyNTZdLDEzMTc0OltbMTEyLDk5XSwyNTZdLDEzMTc1OltbMTAwLDEwOV0sMjU2XSwxMzE3NjpbWzEwMCwxMDksMTc4XSwyNTZdLDEzMTc3OltbMTAwLDEwOSwxNzldLDI1Nl0sMTMxNzg6W1s3Myw4NV0sMjU2XSwxMzE3OTpbWzI0MTc5LDI1MTA0XSwyNTZdLDEzMTgwOltbMjYxNTcsMjE2NDRdLDI1Nl0sMTMxODE6W1syMjgyMywyNzQ5MV0sMjU2XSwxMzE4MjpbWzI2MTI2LDI3ODM1XSwyNTZdLDEzMTgzOltbMjY2NjYsMjQzMzUsMjAyNTAsMzEwMzhdLDI1Nl0sMTMxODQ6W1sxMTIsNjVdLDI1Nl0sMTMxODU6W1sxMTAsNjVdLDI1Nl0sMTMxODY6W1s5NTYsNjVdLDI1Nl0sMTMxODc6W1sxMDksNjVdLDI1Nl0sMTMxODg6W1sxMDcsNjVdLDI1Nl0sMTMxODk6W1s3NSw2Nl0sMjU2XSwxMzE5MDpbWzc3LDY2XSwyNTZdLDEzMTkxOltbNzEsNjZdLDI1Nl0sMTMxOTI6W1s5OSw5NywxMDhdLDI1Nl0sMTMxOTM6W1sxMDcsOTksOTcsMTA4XSwyNTZdLDEzMTk0OltbMTEyLDcwXSwyNTZdLDEzMTk1OltbMTEwLDcwXSwyNTZdLDEzMTk2OltbOTU2LDcwXSwyNTZdLDEzMTk3OltbOTU2LDEwM10sMjU2XSwxMzE5ODpbWzEwOSwxMDNdLDI1Nl0sMTMxOTk6W1sxMDcsMTAzXSwyNTZdLDEzMjAwOltbNzIsMTIyXSwyNTZdLDEzMjAxOltbMTA3LDcyLDEyMl0sMjU2XSwxMzIwMjpbWzc3LDcyLDEyMl0sMjU2XSwxMzIwMzpbWzcxLDcyLDEyMl0sMjU2XSwxMzIwNDpbWzg0LDcyLDEyMl0sMjU2XSwxMzIwNTpbWzk1Niw4NDY3XSwyNTZdLDEzMjA2OltbMTA5LDg0NjddLDI1Nl0sMTMyMDc6W1sxMDAsODQ2N10sMjU2XSwxMzIwODpbWzEwNyw4NDY3XSwyNTZdLDEzMjA5OltbMTAyLDEwOV0sMjU2XSwxMzIxMDpbWzExMCwxMDldLDI1Nl0sMTMyMTE6W1s5NTYsMTA5XSwyNTZdLDEzMjEyOltbMTA5LDEwOV0sMjU2XSwxMzIxMzpbWzk5LDEwOV0sMjU2XSwxMzIxNDpbWzEwNywxMDldLDI1Nl0sMTMyMTU6W1sxMDksMTA5LDE3OF0sMjU2XSwxMzIxNjpbWzk5LDEwOSwxNzhdLDI1Nl0sMTMyMTc6W1sxMDksMTc4XSwyNTZdLDEzMjE4OltbMTA3LDEwOSwxNzhdLDI1Nl0sMTMyMTk6W1sxMDksMTA5LDE3OV0sMjU2XSwxMzIyMDpbWzk5LDEwOSwxNzldLDI1Nl0sMTMyMjE6W1sxMDksMTc5XSwyNTZdLDEzMjIyOltbMTA3LDEwOSwxNzldLDI1Nl0sMTMyMjM6W1sxMDksODcyNSwxMTVdLDI1Nl0sMTMyMjQ6W1sxMDksODcyNSwxMTUsMTc4XSwyNTZdLDEzMjI1OltbODAsOTddLDI1Nl0sMTMyMjY6W1sxMDcsODAsOTddLDI1Nl0sMTMyMjc6W1s3Nyw4MCw5N10sMjU2XSwxMzIyODpbWzcxLDgwLDk3XSwyNTZdLDEzMjI5OltbMTE0LDk3LDEwMF0sMjU2XSwxMzIzMDpbWzExNCw5NywxMDAsODcyNSwxMTVdLDI1Nl0sMTMyMzE6W1sxMTQsOTcsMTAwLDg3MjUsMTE1LDE3OF0sMjU2XSwxMzIzMjpbWzExMiwxMTVdLDI1Nl0sMTMyMzM6W1sxMTAsMTE1XSwyNTZdLDEzMjM0OltbOTU2LDExNV0sMjU2XSwxMzIzNTpbWzEwOSwxMTVdLDI1Nl0sMTMyMzY6W1sxMTIsODZdLDI1Nl0sMTMyMzc6W1sxMTAsODZdLDI1Nl0sMTMyMzg6W1s5NTYsODZdLDI1Nl0sMTMyMzk6W1sxMDksODZdLDI1Nl0sMTMyNDA6W1sxMDcsODZdLDI1Nl0sMTMyNDE6W1s3Nyw4Nl0sMjU2XSwxMzI0MjpbWzExMiw4N10sMjU2XSwxMzI0MzpbWzExMCw4N10sMjU2XSwxMzI0NDpbWzk1Niw4N10sMjU2XSwxMzI0NTpbWzEwOSw4N10sMjU2XSwxMzI0NjpbWzEwNyw4N10sMjU2XSwxMzI0NzpbWzc3LDg3XSwyNTZdLDEzMjQ4OltbMTA3LDkzN10sMjU2XSwxMzI0OTpbWzc3LDkzN10sMjU2XSwxMzI1MDpbWzk3LDQ2LDEwOSw0Nl0sMjU2XSwxMzI1MTpbWzY2LDExM10sMjU2XSwxMzI1MjpbWzk5LDk5XSwyNTZdLDEzMjUzOltbOTksMTAwXSwyNTZdLDEzMjU0OltbNjcsODcyNSwxMDcsMTAzXSwyNTZdLDEzMjU1OltbNjcsMTExLDQ2XSwyNTZdLDEzMjU2OltbMTAwLDY2XSwyNTZdLDEzMjU3OltbNzEsMTIxXSwyNTZdLDEzMjU4OltbMTA0LDk3XSwyNTZdLDEzMjU5OltbNzIsODBdLDI1Nl0sMTMyNjA6W1sxMDUsMTEwXSwyNTZdLDEzMjYxOltbNzUsNzVdLDI1Nl0sMTMyNjI6W1s3NSw3N10sMjU2XSwxMzI2MzpbWzEwNywxMTZdLDI1Nl0sMTMyNjQ6W1sxMDgsMTA5XSwyNTZdLDEzMjY1OltbMTA4LDExMF0sMjU2XSwxMzI2NjpbWzEwOCwxMTEsMTAzXSwyNTZdLDEzMjY3OltbMTA4LDEyMF0sMjU2XSwxMzI2ODpbWzEwOSw5OF0sMjU2XSwxMzI2OTpbWzEwOSwxMDUsMTA4XSwyNTZdLDEzMjcwOltbMTA5LDExMSwxMDhdLDI1Nl0sMTMyNzE6W1s4MCw3Ml0sMjU2XSwxMzI3MjpbWzExMiw0NiwxMDksNDZdLDI1Nl0sMTMyNzM6W1s4MCw4MCw3N10sMjU2XSwxMzI3NDpbWzgwLDgyXSwyNTZdLDEzMjc1OltbMTE1LDExNF0sMjU2XSwxMzI3NjpbWzgzLDExOF0sMjU2XSwxMzI3NzpbWzg3LDk4XSwyNTZdLDEzMjc4OltbODYsODcyNSwxMDldLDI1Nl0sMTMyNzk6W1s2NSw4NzI1LDEwOV0sMjU2XSwxMzI4MDpbWzQ5LDI2MDg1XSwyNTZdLDEzMjgxOltbNTAsMjYwODVdLDI1Nl0sMTMyODI6W1s1MSwyNjA4NV0sMjU2XSwxMzI4MzpbWzUyLDI2MDg1XSwyNTZdLDEzMjg0OltbNTMsMjYwODVdLDI1Nl0sMTMyODU6W1s1NCwyNjA4NV0sMjU2XSwxMzI4NjpbWzU1LDI2MDg1XSwyNTZdLDEzMjg3OltbNTYsMjYwODVdLDI1Nl0sMTMyODg6W1s1NywyNjA4NV0sMjU2XSwxMzI4OTpbWzQ5LDQ4LDI2MDg1XSwyNTZdLDEzMjkwOltbNDksNDksMjYwODVdLDI1Nl0sMTMyOTE6W1s0OSw1MCwyNjA4NV0sMjU2XSwxMzI5MjpbWzQ5LDUxLDI2MDg1XSwyNTZdLDEzMjkzOltbNDksNTIsMjYwODVdLDI1Nl0sMTMyOTQ6W1s0OSw1MywyNjA4NV0sMjU2XSwxMzI5NTpbWzQ5LDU0LDI2MDg1XSwyNTZdLDEzMjk2OltbNDksNTUsMjYwODVdLDI1Nl0sMTMyOTc6W1s0OSw1NiwyNjA4NV0sMjU2XSwxMzI5ODpbWzQ5LDU3LDI2MDg1XSwyNTZdLDEzMjk5OltbNTAsNDgsMjYwODVdLDI1Nl0sMTMzMDA6W1s1MCw0OSwyNjA4NV0sMjU2XSwxMzMwMTpbWzUwLDUwLDI2MDg1XSwyNTZdLDEzMzAyOltbNTAsNTEsMjYwODVdLDI1Nl0sMTMzMDM6W1s1MCw1MiwyNjA4NV0sMjU2XSwxMzMwNDpbWzUwLDUzLDI2MDg1XSwyNTZdLDEzMzA1OltbNTAsNTQsMjYwODVdLDI1Nl0sMTMzMDY6W1s1MCw1NSwyNjA4NV0sMjU2XSwxMzMwNzpbWzUwLDU2LDI2MDg1XSwyNTZdLDEzMzA4OltbNTAsNTcsMjYwODVdLDI1Nl0sMTMzMDk6W1s1MSw0OCwyNjA4NV0sMjU2XSwxMzMxMDpbWzUxLDQ5LDI2MDg1XSwyNTZdLDEzMzExOltbMTAzLDk3LDEwOF0sMjU2XX0sXG40MjQ5Njp7NDI2MDc6WywyMzBdLDQyNjEyOlssMjMwXSw0MjYxMzpbLDIzMF0sNDI2MTQ6WywyMzBdLDQyNjE1OlssMjMwXSw0MjYxNjpbLDIzMF0sNDI2MTc6WywyMzBdLDQyNjE4OlssMjMwXSw0MjYxOTpbLDIzMF0sNDI2MjA6WywyMzBdLDQyNjIxOlssMjMwXSw0MjY1NTpbLDIzMF0sNDI3MzY6WywyMzBdLDQyNzM3OlssMjMwXX0sXG40Mjc1Mjp7NDI4NjQ6W1s0Mjg2M10sMjU2XSw0MzAwMDpbWzI5NF0sMjU2XSw0MzAwMTpbWzMzOV0sMjU2XX0sXG40MzAwODp7NDMwMTQ6Wyw5XSw0MzIwNDpbLDldLDQzMjMyOlssMjMwXSw0MzIzMzpbLDIzMF0sNDMyMzQ6WywyMzBdLDQzMjM1OlssMjMwXSw0MzIzNjpbLDIzMF0sNDMyMzc6WywyMzBdLDQzMjM4OlssMjMwXSw0MzIzOTpbLDIzMF0sNDMyNDA6WywyMzBdLDQzMjQxOlssMjMwXSw0MzI0MjpbLDIzMF0sNDMyNDM6WywyMzBdLDQzMjQ0OlssMjMwXSw0MzI0NTpbLDIzMF0sNDMyNDY6WywyMzBdLDQzMjQ3OlssMjMwXSw0MzI0ODpbLDIzMF0sNDMyNDk6WywyMzBdfSxcbjQzMjY0Ons0MzMwNzpbLDIyMF0sNDMzMDg6WywyMjBdLDQzMzA5OlssMjIwXSw0MzM0NzpbLDldLDQzNDQzOlssN10sNDM0NTY6Wyw5XX0sXG40MzUyMDp7NDM2OTY6WywyMzBdLDQzNjk4OlssMjMwXSw0MzY5OTpbLDIzMF0sNDM3MDA6WywyMjBdLDQzNzAzOlssMjMwXSw0MzcwNDpbLDIzMF0sNDM3MTA6WywyMzBdLDQzNzExOlssMjMwXSw0MzcxMzpbLDIzMF0sNDM3NjY6Wyw5XX0sXG40Mzc3Njp7NDQwMTM6Wyw5XX0sXG41MzUwNDp7MTE5MTM0OltbMTE5MTI3LDExOTE0MV0sNTEyXSwxMTkxMzU6W1sxMTkxMjgsMTE5MTQxXSw1MTJdLDExOTEzNjpbWzExOTEzNSwxMTkxNTBdLDUxMl0sMTE5MTM3OltbMTE5MTM1LDExOTE1MV0sNTEyXSwxMTkxMzg6W1sxMTkxMzUsMTE5MTUyXSw1MTJdLDExOTEzOTpbWzExOTEzNSwxMTkxNTNdLDUxMl0sMTE5MTQwOltbMTE5MTM1LDExOTE1NF0sNTEyXSwxMTkxNDE6WywyMTZdLDExOTE0MjpbLDIxNl0sMTE5MTQzOlssMV0sMTE5MTQ0OlssMV0sMTE5MTQ1OlssMV0sMTE5MTQ5OlssMjI2XSwxMTkxNTA6WywyMTZdLDExOTE1MTpbLDIxNl0sMTE5MTUyOlssMjE2XSwxMTkxNTM6WywyMTZdLDExOTE1NDpbLDIxNl0sMTE5MTYzOlssMjIwXSwxMTkxNjQ6WywyMjBdLDExOTE2NTpbLDIyMF0sMTE5MTY2OlssMjIwXSwxMTkxNjc6WywyMjBdLDExOTE2ODpbLDIyMF0sMTE5MTY5OlssMjIwXSwxMTkxNzA6WywyMjBdLDExOTE3MzpbLDIzMF0sMTE5MTc0OlssMjMwXSwxMTkxNzU6WywyMzBdLDExOTE3NjpbLDIzMF0sMTE5MTc3OlssMjMwXSwxMTkxNzg6WywyMjBdLDExOTE3OTpbLDIyMF0sMTE5MjEwOlssMjMwXSwxMTkyMTE6WywyMzBdLDExOTIxMjpbLDIzMF0sMTE5MjEzOlssMjMwXSwxMTkyMjc6W1sxMTkyMjUsMTE5MTQxXSw1MTJdLDExOTIyODpbWzExOTIyNiwxMTkxNDFdLDUxMl0sMTE5MjI5OltbMTE5MjI3LDExOTE1MF0sNTEyXSwxMTkyMzA6W1sxMTkyMjgsMTE5MTUwXSw1MTJdLDExOTIzMTpbWzExOTIyNywxMTkxNTFdLDUxMl0sMTE5MjMyOltbMTE5MjI4LDExOTE1MV0sNTEyXX0sXG41Mzc2MDp7MTE5MzYyOlssMjMwXSwxMTkzNjM6WywyMzBdLDExOTM2NDpbLDIzMF19LFxuNTQyNzI6ezExOTgwODpbWzY1XSwyNTZdLDExOTgwOTpbWzY2XSwyNTZdLDExOTgxMDpbWzY3XSwyNTZdLDExOTgxMTpbWzY4XSwyNTZdLDExOTgxMjpbWzY5XSwyNTZdLDExOTgxMzpbWzcwXSwyNTZdLDExOTgxNDpbWzcxXSwyNTZdLDExOTgxNTpbWzcyXSwyNTZdLDExOTgxNjpbWzczXSwyNTZdLDExOTgxNzpbWzc0XSwyNTZdLDExOTgxODpbWzc1XSwyNTZdLDExOTgxOTpbWzc2XSwyNTZdLDExOTgyMDpbWzc3XSwyNTZdLDExOTgyMTpbWzc4XSwyNTZdLDExOTgyMjpbWzc5XSwyNTZdLDExOTgyMzpbWzgwXSwyNTZdLDExOTgyNDpbWzgxXSwyNTZdLDExOTgyNTpbWzgyXSwyNTZdLDExOTgyNjpbWzgzXSwyNTZdLDExOTgyNzpbWzg0XSwyNTZdLDExOTgyODpbWzg1XSwyNTZdLDExOTgyOTpbWzg2XSwyNTZdLDExOTgzMDpbWzg3XSwyNTZdLDExOTgzMTpbWzg4XSwyNTZdLDExOTgzMjpbWzg5XSwyNTZdLDExOTgzMzpbWzkwXSwyNTZdLDExOTgzNDpbWzk3XSwyNTZdLDExOTgzNTpbWzk4XSwyNTZdLDExOTgzNjpbWzk5XSwyNTZdLDExOTgzNzpbWzEwMF0sMjU2XSwxMTk4Mzg6W1sxMDFdLDI1Nl0sMTE5ODM5OltbMTAyXSwyNTZdLDExOTg0MDpbWzEwM10sMjU2XSwxMTk4NDE6W1sxMDRdLDI1Nl0sMTE5ODQyOltbMTA1XSwyNTZdLDExOTg0MzpbWzEwNl0sMjU2XSwxMTk4NDQ6W1sxMDddLDI1Nl0sMTE5ODQ1OltbMTA4XSwyNTZdLDExOTg0NjpbWzEwOV0sMjU2XSwxMTk4NDc6W1sxMTBdLDI1Nl0sMTE5ODQ4OltbMTExXSwyNTZdLDExOTg0OTpbWzExMl0sMjU2XSwxMTk4NTA6W1sxMTNdLDI1Nl0sMTE5ODUxOltbMTE0XSwyNTZdLDExOTg1MjpbWzExNV0sMjU2XSwxMTk4NTM6W1sxMTZdLDI1Nl0sMTE5ODU0OltbMTE3XSwyNTZdLDExOTg1NTpbWzExOF0sMjU2XSwxMTk4NTY6W1sxMTldLDI1Nl0sMTE5ODU3OltbMTIwXSwyNTZdLDExOTg1ODpbWzEyMV0sMjU2XSwxMTk4NTk6W1sxMjJdLDI1Nl0sMTE5ODYwOltbNjVdLDI1Nl0sMTE5ODYxOltbNjZdLDI1Nl0sMTE5ODYyOltbNjddLDI1Nl0sMTE5ODYzOltbNjhdLDI1Nl0sMTE5ODY0OltbNjldLDI1Nl0sMTE5ODY1OltbNzBdLDI1Nl0sMTE5ODY2OltbNzFdLDI1Nl0sMTE5ODY3OltbNzJdLDI1Nl0sMTE5ODY4OltbNzNdLDI1Nl0sMTE5ODY5OltbNzRdLDI1Nl0sMTE5ODcwOltbNzVdLDI1Nl0sMTE5ODcxOltbNzZdLDI1Nl0sMTE5ODcyOltbNzddLDI1Nl0sMTE5ODczOltbNzhdLDI1Nl0sMTE5ODc0OltbNzldLDI1Nl0sMTE5ODc1OltbODBdLDI1Nl0sMTE5ODc2OltbODFdLDI1Nl0sMTE5ODc3OltbODJdLDI1Nl0sMTE5ODc4OltbODNdLDI1Nl0sMTE5ODc5OltbODRdLDI1Nl0sMTE5ODgwOltbODVdLDI1Nl0sMTE5ODgxOltbODZdLDI1Nl0sMTE5ODgyOltbODddLDI1Nl0sMTE5ODgzOltbODhdLDI1Nl0sMTE5ODg0OltbODldLDI1Nl0sMTE5ODg1OltbOTBdLDI1Nl0sMTE5ODg2OltbOTddLDI1Nl0sMTE5ODg3OltbOThdLDI1Nl0sMTE5ODg4OltbOTldLDI1Nl0sMTE5ODg5OltbMTAwXSwyNTZdLDExOTg5MDpbWzEwMV0sMjU2XSwxMTk4OTE6W1sxMDJdLDI1Nl0sMTE5ODkyOltbMTAzXSwyNTZdLDExOTg5NDpbWzEwNV0sMjU2XSwxMTk4OTU6W1sxMDZdLDI1Nl0sMTE5ODk2OltbMTA3XSwyNTZdLDExOTg5NzpbWzEwOF0sMjU2XSwxMTk4OTg6W1sxMDldLDI1Nl0sMTE5ODk5OltbMTEwXSwyNTZdLDExOTkwMDpbWzExMV0sMjU2XSwxMTk5MDE6W1sxMTJdLDI1Nl0sMTE5OTAyOltbMTEzXSwyNTZdLDExOTkwMzpbWzExNF0sMjU2XSwxMTk5MDQ6W1sxMTVdLDI1Nl0sMTE5OTA1OltbMTE2XSwyNTZdLDExOTkwNjpbWzExN10sMjU2XSwxMTk5MDc6W1sxMThdLDI1Nl0sMTE5OTA4OltbMTE5XSwyNTZdLDExOTkwOTpbWzEyMF0sMjU2XSwxMTk5MTA6W1sxMjFdLDI1Nl0sMTE5OTExOltbMTIyXSwyNTZdLDExOTkxMjpbWzY1XSwyNTZdLDExOTkxMzpbWzY2XSwyNTZdLDExOTkxNDpbWzY3XSwyNTZdLDExOTkxNTpbWzY4XSwyNTZdLDExOTkxNjpbWzY5XSwyNTZdLDExOTkxNzpbWzcwXSwyNTZdLDExOTkxODpbWzcxXSwyNTZdLDExOTkxOTpbWzcyXSwyNTZdLDExOTkyMDpbWzczXSwyNTZdLDExOTkyMTpbWzc0XSwyNTZdLDExOTkyMjpbWzc1XSwyNTZdLDExOTkyMzpbWzc2XSwyNTZdLDExOTkyNDpbWzc3XSwyNTZdLDExOTkyNTpbWzc4XSwyNTZdLDExOTkyNjpbWzc5XSwyNTZdLDExOTkyNzpbWzgwXSwyNTZdLDExOTkyODpbWzgxXSwyNTZdLDExOTkyOTpbWzgyXSwyNTZdLDExOTkzMDpbWzgzXSwyNTZdLDExOTkzMTpbWzg0XSwyNTZdLDExOTkzMjpbWzg1XSwyNTZdLDExOTkzMzpbWzg2XSwyNTZdLDExOTkzNDpbWzg3XSwyNTZdLDExOTkzNTpbWzg4XSwyNTZdLDExOTkzNjpbWzg5XSwyNTZdLDExOTkzNzpbWzkwXSwyNTZdLDExOTkzODpbWzk3XSwyNTZdLDExOTkzOTpbWzk4XSwyNTZdLDExOTk0MDpbWzk5XSwyNTZdLDExOTk0MTpbWzEwMF0sMjU2XSwxMTk5NDI6W1sxMDFdLDI1Nl0sMTE5OTQzOltbMTAyXSwyNTZdLDExOTk0NDpbWzEwM10sMjU2XSwxMTk5NDU6W1sxMDRdLDI1Nl0sMTE5OTQ2OltbMTA1XSwyNTZdLDExOTk0NzpbWzEwNl0sMjU2XSwxMTk5NDg6W1sxMDddLDI1Nl0sMTE5OTQ5OltbMTA4XSwyNTZdLDExOTk1MDpbWzEwOV0sMjU2XSwxMTk5NTE6W1sxMTBdLDI1Nl0sMTE5OTUyOltbMTExXSwyNTZdLDExOTk1MzpbWzExMl0sMjU2XSwxMTk5NTQ6W1sxMTNdLDI1Nl0sMTE5OTU1OltbMTE0XSwyNTZdLDExOTk1NjpbWzExNV0sMjU2XSwxMTk5NTc6W1sxMTZdLDI1Nl0sMTE5OTU4OltbMTE3XSwyNTZdLDExOTk1OTpbWzExOF0sMjU2XSwxMTk5NjA6W1sxMTldLDI1Nl0sMTE5OTYxOltbMTIwXSwyNTZdLDExOTk2MjpbWzEyMV0sMjU2XSwxMTk5NjM6W1sxMjJdLDI1Nl0sMTE5OTY0OltbNjVdLDI1Nl0sMTE5OTY2OltbNjddLDI1Nl0sMTE5OTY3OltbNjhdLDI1Nl0sMTE5OTcwOltbNzFdLDI1Nl0sMTE5OTczOltbNzRdLDI1Nl0sMTE5OTc0OltbNzVdLDI1Nl0sMTE5OTc3OltbNzhdLDI1Nl0sMTE5OTc4OltbNzldLDI1Nl0sMTE5OTc5OltbODBdLDI1Nl0sMTE5OTgwOltbODFdLDI1Nl0sMTE5OTgyOltbODNdLDI1Nl0sMTE5OTgzOltbODRdLDI1Nl0sMTE5OTg0OltbODVdLDI1Nl0sMTE5OTg1OltbODZdLDI1Nl0sMTE5OTg2OltbODddLDI1Nl0sMTE5OTg3OltbODhdLDI1Nl0sMTE5OTg4OltbODldLDI1Nl0sMTE5OTg5OltbOTBdLDI1Nl0sMTE5OTkwOltbOTddLDI1Nl0sMTE5OTkxOltbOThdLDI1Nl0sMTE5OTkyOltbOTldLDI1Nl0sMTE5OTkzOltbMTAwXSwyNTZdLDExOTk5NTpbWzEwMl0sMjU2XSwxMTk5OTc6W1sxMDRdLDI1Nl0sMTE5OTk4OltbMTA1XSwyNTZdLDExOTk5OTpbWzEwNl0sMjU2XSwxMjAwMDA6W1sxMDddLDI1Nl0sMTIwMDAxOltbMTA4XSwyNTZdLDEyMDAwMjpbWzEwOV0sMjU2XSwxMjAwMDM6W1sxMTBdLDI1Nl0sMTIwMDA1OltbMTEyXSwyNTZdLDEyMDAwNjpbWzExM10sMjU2XSwxMjAwMDc6W1sxMTRdLDI1Nl0sMTIwMDA4OltbMTE1XSwyNTZdLDEyMDAwOTpbWzExNl0sMjU2XSwxMjAwMTA6W1sxMTddLDI1Nl0sMTIwMDExOltbMTE4XSwyNTZdLDEyMDAxMjpbWzExOV0sMjU2XSwxMjAwMTM6W1sxMjBdLDI1Nl0sMTIwMDE0OltbMTIxXSwyNTZdLDEyMDAxNTpbWzEyMl0sMjU2XSwxMjAwMTY6W1s2NV0sMjU2XSwxMjAwMTc6W1s2Nl0sMjU2XSwxMjAwMTg6W1s2N10sMjU2XSwxMjAwMTk6W1s2OF0sMjU2XSwxMjAwMjA6W1s2OV0sMjU2XSwxMjAwMjE6W1s3MF0sMjU2XSwxMjAwMjI6W1s3MV0sMjU2XSwxMjAwMjM6W1s3Ml0sMjU2XSwxMjAwMjQ6W1s3M10sMjU2XSwxMjAwMjU6W1s3NF0sMjU2XSwxMjAwMjY6W1s3NV0sMjU2XSwxMjAwMjc6W1s3Nl0sMjU2XSwxMjAwMjg6W1s3N10sMjU2XSwxMjAwMjk6W1s3OF0sMjU2XSwxMjAwMzA6W1s3OV0sMjU2XSwxMjAwMzE6W1s4MF0sMjU2XSwxMjAwMzI6W1s4MV0sMjU2XSwxMjAwMzM6W1s4Ml0sMjU2XSwxMjAwMzQ6W1s4M10sMjU2XSwxMjAwMzU6W1s4NF0sMjU2XSwxMjAwMzY6W1s4NV0sMjU2XSwxMjAwMzc6W1s4Nl0sMjU2XSwxMjAwMzg6W1s4N10sMjU2XSwxMjAwMzk6W1s4OF0sMjU2XSwxMjAwNDA6W1s4OV0sMjU2XSwxMjAwNDE6W1s5MF0sMjU2XSwxMjAwNDI6W1s5N10sMjU2XSwxMjAwNDM6W1s5OF0sMjU2XSwxMjAwNDQ6W1s5OV0sMjU2XSwxMjAwNDU6W1sxMDBdLDI1Nl0sMTIwMDQ2OltbMTAxXSwyNTZdLDEyMDA0NzpbWzEwMl0sMjU2XSwxMjAwNDg6W1sxMDNdLDI1Nl0sMTIwMDQ5OltbMTA0XSwyNTZdLDEyMDA1MDpbWzEwNV0sMjU2XSwxMjAwNTE6W1sxMDZdLDI1Nl0sMTIwMDUyOltbMTA3XSwyNTZdLDEyMDA1MzpbWzEwOF0sMjU2XSwxMjAwNTQ6W1sxMDldLDI1Nl0sMTIwMDU1OltbMTEwXSwyNTZdLDEyMDA1NjpbWzExMV0sMjU2XSwxMjAwNTc6W1sxMTJdLDI1Nl0sMTIwMDU4OltbMTEzXSwyNTZdLDEyMDA1OTpbWzExNF0sMjU2XSwxMjAwNjA6W1sxMTVdLDI1Nl0sMTIwMDYxOltbMTE2XSwyNTZdLDEyMDA2MjpbWzExN10sMjU2XSwxMjAwNjM6W1sxMThdLDI1Nl19LFxuNTQ1Mjg6ezEyMDA2NDpbWzExOV0sMjU2XSwxMjAwNjU6W1sxMjBdLDI1Nl0sMTIwMDY2OltbMTIxXSwyNTZdLDEyMDA2NzpbWzEyMl0sMjU2XSwxMjAwNjg6W1s2NV0sMjU2XSwxMjAwNjk6W1s2Nl0sMjU2XSwxMjAwNzE6W1s2OF0sMjU2XSwxMjAwNzI6W1s2OV0sMjU2XSwxMjAwNzM6W1s3MF0sMjU2XSwxMjAwNzQ6W1s3MV0sMjU2XSwxMjAwNzc6W1s3NF0sMjU2XSwxMjAwNzg6W1s3NV0sMjU2XSwxMjAwNzk6W1s3Nl0sMjU2XSwxMjAwODA6W1s3N10sMjU2XSwxMjAwODE6W1s3OF0sMjU2XSwxMjAwODI6W1s3OV0sMjU2XSwxMjAwODM6W1s4MF0sMjU2XSwxMjAwODQ6W1s4MV0sMjU2XSwxMjAwODY6W1s4M10sMjU2XSwxMjAwODc6W1s4NF0sMjU2XSwxMjAwODg6W1s4NV0sMjU2XSwxMjAwODk6W1s4Nl0sMjU2XSwxMjAwOTA6W1s4N10sMjU2XSwxMjAwOTE6W1s4OF0sMjU2XSwxMjAwOTI6W1s4OV0sMjU2XSwxMjAwOTQ6W1s5N10sMjU2XSwxMjAwOTU6W1s5OF0sMjU2XSwxMjAwOTY6W1s5OV0sMjU2XSwxMjAwOTc6W1sxMDBdLDI1Nl0sMTIwMDk4OltbMTAxXSwyNTZdLDEyMDA5OTpbWzEwMl0sMjU2XSwxMjAxMDA6W1sxMDNdLDI1Nl0sMTIwMTAxOltbMTA0XSwyNTZdLDEyMDEwMjpbWzEwNV0sMjU2XSwxMjAxMDM6W1sxMDZdLDI1Nl0sMTIwMTA0OltbMTA3XSwyNTZdLDEyMDEwNTpbWzEwOF0sMjU2XSwxMjAxMDY6W1sxMDldLDI1Nl0sMTIwMTA3OltbMTEwXSwyNTZdLDEyMDEwODpbWzExMV0sMjU2XSwxMjAxMDk6W1sxMTJdLDI1Nl0sMTIwMTEwOltbMTEzXSwyNTZdLDEyMDExMTpbWzExNF0sMjU2XSwxMjAxMTI6W1sxMTVdLDI1Nl0sMTIwMTEzOltbMTE2XSwyNTZdLDEyMDExNDpbWzExN10sMjU2XSwxMjAxMTU6W1sxMThdLDI1Nl0sMTIwMTE2OltbMTE5XSwyNTZdLDEyMDExNzpbWzEyMF0sMjU2XSwxMjAxMTg6W1sxMjFdLDI1Nl0sMTIwMTE5OltbMTIyXSwyNTZdLDEyMDEyMDpbWzY1XSwyNTZdLDEyMDEyMTpbWzY2XSwyNTZdLDEyMDEyMzpbWzY4XSwyNTZdLDEyMDEyNDpbWzY5XSwyNTZdLDEyMDEyNTpbWzcwXSwyNTZdLDEyMDEyNjpbWzcxXSwyNTZdLDEyMDEyODpbWzczXSwyNTZdLDEyMDEyOTpbWzc0XSwyNTZdLDEyMDEzMDpbWzc1XSwyNTZdLDEyMDEzMTpbWzc2XSwyNTZdLDEyMDEzMjpbWzc3XSwyNTZdLDEyMDEzNDpbWzc5XSwyNTZdLDEyMDEzODpbWzgzXSwyNTZdLDEyMDEzOTpbWzg0XSwyNTZdLDEyMDE0MDpbWzg1XSwyNTZdLDEyMDE0MTpbWzg2XSwyNTZdLDEyMDE0MjpbWzg3XSwyNTZdLDEyMDE0MzpbWzg4XSwyNTZdLDEyMDE0NDpbWzg5XSwyNTZdLDEyMDE0NjpbWzk3XSwyNTZdLDEyMDE0NzpbWzk4XSwyNTZdLDEyMDE0ODpbWzk5XSwyNTZdLDEyMDE0OTpbWzEwMF0sMjU2XSwxMjAxNTA6W1sxMDFdLDI1Nl0sMTIwMTUxOltbMTAyXSwyNTZdLDEyMDE1MjpbWzEwM10sMjU2XSwxMjAxNTM6W1sxMDRdLDI1Nl0sMTIwMTU0OltbMTA1XSwyNTZdLDEyMDE1NTpbWzEwNl0sMjU2XSwxMjAxNTY6W1sxMDddLDI1Nl0sMTIwMTU3OltbMTA4XSwyNTZdLDEyMDE1ODpbWzEwOV0sMjU2XSwxMjAxNTk6W1sxMTBdLDI1Nl0sMTIwMTYwOltbMTExXSwyNTZdLDEyMDE2MTpbWzExMl0sMjU2XSwxMjAxNjI6W1sxMTNdLDI1Nl0sMTIwMTYzOltbMTE0XSwyNTZdLDEyMDE2NDpbWzExNV0sMjU2XSwxMjAxNjU6W1sxMTZdLDI1Nl0sMTIwMTY2OltbMTE3XSwyNTZdLDEyMDE2NzpbWzExOF0sMjU2XSwxMjAxNjg6W1sxMTldLDI1Nl0sMTIwMTY5OltbMTIwXSwyNTZdLDEyMDE3MDpbWzEyMV0sMjU2XSwxMjAxNzE6W1sxMjJdLDI1Nl0sMTIwMTcyOltbNjVdLDI1Nl0sMTIwMTczOltbNjZdLDI1Nl0sMTIwMTc0OltbNjddLDI1Nl0sMTIwMTc1OltbNjhdLDI1Nl0sMTIwMTc2OltbNjldLDI1Nl0sMTIwMTc3OltbNzBdLDI1Nl0sMTIwMTc4OltbNzFdLDI1Nl0sMTIwMTc5OltbNzJdLDI1Nl0sMTIwMTgwOltbNzNdLDI1Nl0sMTIwMTgxOltbNzRdLDI1Nl0sMTIwMTgyOltbNzVdLDI1Nl0sMTIwMTgzOltbNzZdLDI1Nl0sMTIwMTg0OltbNzddLDI1Nl0sMTIwMTg1OltbNzhdLDI1Nl0sMTIwMTg2OltbNzldLDI1Nl0sMTIwMTg3OltbODBdLDI1Nl0sMTIwMTg4OltbODFdLDI1Nl0sMTIwMTg5OltbODJdLDI1Nl0sMTIwMTkwOltbODNdLDI1Nl0sMTIwMTkxOltbODRdLDI1Nl0sMTIwMTkyOltbODVdLDI1Nl0sMTIwMTkzOltbODZdLDI1Nl0sMTIwMTk0OltbODddLDI1Nl0sMTIwMTk1OltbODhdLDI1Nl0sMTIwMTk2OltbODldLDI1Nl0sMTIwMTk3OltbOTBdLDI1Nl0sMTIwMTk4OltbOTddLDI1Nl0sMTIwMTk5OltbOThdLDI1Nl0sMTIwMjAwOltbOTldLDI1Nl0sMTIwMjAxOltbMTAwXSwyNTZdLDEyMDIwMjpbWzEwMV0sMjU2XSwxMjAyMDM6W1sxMDJdLDI1Nl0sMTIwMjA0OltbMTAzXSwyNTZdLDEyMDIwNTpbWzEwNF0sMjU2XSwxMjAyMDY6W1sxMDVdLDI1Nl0sMTIwMjA3OltbMTA2XSwyNTZdLDEyMDIwODpbWzEwN10sMjU2XSwxMjAyMDk6W1sxMDhdLDI1Nl0sMTIwMjEwOltbMTA5XSwyNTZdLDEyMDIxMTpbWzExMF0sMjU2XSwxMjAyMTI6W1sxMTFdLDI1Nl0sMTIwMjEzOltbMTEyXSwyNTZdLDEyMDIxNDpbWzExM10sMjU2XSwxMjAyMTU6W1sxMTRdLDI1Nl0sMTIwMjE2OltbMTE1XSwyNTZdLDEyMDIxNzpbWzExNl0sMjU2XSwxMjAyMTg6W1sxMTddLDI1Nl0sMTIwMjE5OltbMTE4XSwyNTZdLDEyMDIyMDpbWzExOV0sMjU2XSwxMjAyMjE6W1sxMjBdLDI1Nl0sMTIwMjIyOltbMTIxXSwyNTZdLDEyMDIyMzpbWzEyMl0sMjU2XSwxMjAyMjQ6W1s2NV0sMjU2XSwxMjAyMjU6W1s2Nl0sMjU2XSwxMjAyMjY6W1s2N10sMjU2XSwxMjAyMjc6W1s2OF0sMjU2XSwxMjAyMjg6W1s2OV0sMjU2XSwxMjAyMjk6W1s3MF0sMjU2XSwxMjAyMzA6W1s3MV0sMjU2XSwxMjAyMzE6W1s3Ml0sMjU2XSwxMjAyMzI6W1s3M10sMjU2XSwxMjAyMzM6W1s3NF0sMjU2XSwxMjAyMzQ6W1s3NV0sMjU2XSwxMjAyMzU6W1s3Nl0sMjU2XSwxMjAyMzY6W1s3N10sMjU2XSwxMjAyMzc6W1s3OF0sMjU2XSwxMjAyMzg6W1s3OV0sMjU2XSwxMjAyMzk6W1s4MF0sMjU2XSwxMjAyNDA6W1s4MV0sMjU2XSwxMjAyNDE6W1s4Ml0sMjU2XSwxMjAyNDI6W1s4M10sMjU2XSwxMjAyNDM6W1s4NF0sMjU2XSwxMjAyNDQ6W1s4NV0sMjU2XSwxMjAyNDU6W1s4Nl0sMjU2XSwxMjAyNDY6W1s4N10sMjU2XSwxMjAyNDc6W1s4OF0sMjU2XSwxMjAyNDg6W1s4OV0sMjU2XSwxMjAyNDk6W1s5MF0sMjU2XSwxMjAyNTA6W1s5N10sMjU2XSwxMjAyNTE6W1s5OF0sMjU2XSwxMjAyNTI6W1s5OV0sMjU2XSwxMjAyNTM6W1sxMDBdLDI1Nl0sMTIwMjU0OltbMTAxXSwyNTZdLDEyMDI1NTpbWzEwMl0sMjU2XSwxMjAyNTY6W1sxMDNdLDI1Nl0sMTIwMjU3OltbMTA0XSwyNTZdLDEyMDI1ODpbWzEwNV0sMjU2XSwxMjAyNTk6W1sxMDZdLDI1Nl0sMTIwMjYwOltbMTA3XSwyNTZdLDEyMDI2MTpbWzEwOF0sMjU2XSwxMjAyNjI6W1sxMDldLDI1Nl0sMTIwMjYzOltbMTEwXSwyNTZdLDEyMDI2NDpbWzExMV0sMjU2XSwxMjAyNjU6W1sxMTJdLDI1Nl0sMTIwMjY2OltbMTEzXSwyNTZdLDEyMDI2NzpbWzExNF0sMjU2XSwxMjAyNjg6W1sxMTVdLDI1Nl0sMTIwMjY5OltbMTE2XSwyNTZdLDEyMDI3MDpbWzExN10sMjU2XSwxMjAyNzE6W1sxMThdLDI1Nl0sMTIwMjcyOltbMTE5XSwyNTZdLDEyMDI3MzpbWzEyMF0sMjU2XSwxMjAyNzQ6W1sxMjFdLDI1Nl0sMTIwMjc1OltbMTIyXSwyNTZdLDEyMDI3NjpbWzY1XSwyNTZdLDEyMDI3NzpbWzY2XSwyNTZdLDEyMDI3ODpbWzY3XSwyNTZdLDEyMDI3OTpbWzY4XSwyNTZdLDEyMDI4MDpbWzY5XSwyNTZdLDEyMDI4MTpbWzcwXSwyNTZdLDEyMDI4MjpbWzcxXSwyNTZdLDEyMDI4MzpbWzcyXSwyNTZdLDEyMDI4NDpbWzczXSwyNTZdLDEyMDI4NTpbWzc0XSwyNTZdLDEyMDI4NjpbWzc1XSwyNTZdLDEyMDI4NzpbWzc2XSwyNTZdLDEyMDI4ODpbWzc3XSwyNTZdLDEyMDI4OTpbWzc4XSwyNTZdLDEyMDI5MDpbWzc5XSwyNTZdLDEyMDI5MTpbWzgwXSwyNTZdLDEyMDI5MjpbWzgxXSwyNTZdLDEyMDI5MzpbWzgyXSwyNTZdLDEyMDI5NDpbWzgzXSwyNTZdLDEyMDI5NTpbWzg0XSwyNTZdLDEyMDI5NjpbWzg1XSwyNTZdLDEyMDI5NzpbWzg2XSwyNTZdLDEyMDI5ODpbWzg3XSwyNTZdLDEyMDI5OTpbWzg4XSwyNTZdLDEyMDMwMDpbWzg5XSwyNTZdLDEyMDMwMTpbWzkwXSwyNTZdLDEyMDMwMjpbWzk3XSwyNTZdLDEyMDMwMzpbWzk4XSwyNTZdLDEyMDMwNDpbWzk5XSwyNTZdLDEyMDMwNTpbWzEwMF0sMjU2XSwxMjAzMDY6W1sxMDFdLDI1Nl0sMTIwMzA3OltbMTAyXSwyNTZdLDEyMDMwODpbWzEwM10sMjU2XSwxMjAzMDk6W1sxMDRdLDI1Nl0sMTIwMzEwOltbMTA1XSwyNTZdLDEyMDMxMTpbWzEwNl0sMjU2XSwxMjAzMTI6W1sxMDddLDI1Nl0sMTIwMzEzOltbMTA4XSwyNTZdLDEyMDMxNDpbWzEwOV0sMjU2XSwxMjAzMTU6W1sxMTBdLDI1Nl0sMTIwMzE2OltbMTExXSwyNTZdLDEyMDMxNzpbWzExMl0sMjU2XSwxMjAzMTg6W1sxMTNdLDI1Nl0sMTIwMzE5OltbMTE0XSwyNTZdfSxcbjU0Nzg0OnsxMjAzMjA6W1sxMTVdLDI1Nl0sMTIwMzIxOltbMTE2XSwyNTZdLDEyMDMyMjpbWzExN10sMjU2XSwxMjAzMjM6W1sxMThdLDI1Nl0sMTIwMzI0OltbMTE5XSwyNTZdLDEyMDMyNTpbWzEyMF0sMjU2XSwxMjAzMjY6W1sxMjFdLDI1Nl0sMTIwMzI3OltbMTIyXSwyNTZdLDEyMDMyODpbWzY1XSwyNTZdLDEyMDMyOTpbWzY2XSwyNTZdLDEyMDMzMDpbWzY3XSwyNTZdLDEyMDMzMTpbWzY4XSwyNTZdLDEyMDMzMjpbWzY5XSwyNTZdLDEyMDMzMzpbWzcwXSwyNTZdLDEyMDMzNDpbWzcxXSwyNTZdLDEyMDMzNTpbWzcyXSwyNTZdLDEyMDMzNjpbWzczXSwyNTZdLDEyMDMzNzpbWzc0XSwyNTZdLDEyMDMzODpbWzc1XSwyNTZdLDEyMDMzOTpbWzc2XSwyNTZdLDEyMDM0MDpbWzc3XSwyNTZdLDEyMDM0MTpbWzc4XSwyNTZdLDEyMDM0MjpbWzc5XSwyNTZdLDEyMDM0MzpbWzgwXSwyNTZdLDEyMDM0NDpbWzgxXSwyNTZdLDEyMDM0NTpbWzgyXSwyNTZdLDEyMDM0NjpbWzgzXSwyNTZdLDEyMDM0NzpbWzg0XSwyNTZdLDEyMDM0ODpbWzg1XSwyNTZdLDEyMDM0OTpbWzg2XSwyNTZdLDEyMDM1MDpbWzg3XSwyNTZdLDEyMDM1MTpbWzg4XSwyNTZdLDEyMDM1MjpbWzg5XSwyNTZdLDEyMDM1MzpbWzkwXSwyNTZdLDEyMDM1NDpbWzk3XSwyNTZdLDEyMDM1NTpbWzk4XSwyNTZdLDEyMDM1NjpbWzk5XSwyNTZdLDEyMDM1NzpbWzEwMF0sMjU2XSwxMjAzNTg6W1sxMDFdLDI1Nl0sMTIwMzU5OltbMTAyXSwyNTZdLDEyMDM2MDpbWzEwM10sMjU2XSwxMjAzNjE6W1sxMDRdLDI1Nl0sMTIwMzYyOltbMTA1XSwyNTZdLDEyMDM2MzpbWzEwNl0sMjU2XSwxMjAzNjQ6W1sxMDddLDI1Nl0sMTIwMzY1OltbMTA4XSwyNTZdLDEyMDM2NjpbWzEwOV0sMjU2XSwxMjAzNjc6W1sxMTBdLDI1Nl0sMTIwMzY4OltbMTExXSwyNTZdLDEyMDM2OTpbWzExMl0sMjU2XSwxMjAzNzA6W1sxMTNdLDI1Nl0sMTIwMzcxOltbMTE0XSwyNTZdLDEyMDM3MjpbWzExNV0sMjU2XSwxMjAzNzM6W1sxMTZdLDI1Nl0sMTIwMzc0OltbMTE3XSwyNTZdLDEyMDM3NTpbWzExOF0sMjU2XSwxMjAzNzY6W1sxMTldLDI1Nl0sMTIwMzc3OltbMTIwXSwyNTZdLDEyMDM3ODpbWzEyMV0sMjU2XSwxMjAzNzk6W1sxMjJdLDI1Nl0sMTIwMzgwOltbNjVdLDI1Nl0sMTIwMzgxOltbNjZdLDI1Nl0sMTIwMzgyOltbNjddLDI1Nl0sMTIwMzgzOltbNjhdLDI1Nl0sMTIwMzg0OltbNjldLDI1Nl0sMTIwMzg1OltbNzBdLDI1Nl0sMTIwMzg2OltbNzFdLDI1Nl0sMTIwMzg3OltbNzJdLDI1Nl0sMTIwMzg4OltbNzNdLDI1Nl0sMTIwMzg5OltbNzRdLDI1Nl0sMTIwMzkwOltbNzVdLDI1Nl0sMTIwMzkxOltbNzZdLDI1Nl0sMTIwMzkyOltbNzddLDI1Nl0sMTIwMzkzOltbNzhdLDI1Nl0sMTIwMzk0OltbNzldLDI1Nl0sMTIwMzk1OltbODBdLDI1Nl0sMTIwMzk2OltbODFdLDI1Nl0sMTIwMzk3OltbODJdLDI1Nl0sMTIwMzk4OltbODNdLDI1Nl0sMTIwMzk5OltbODRdLDI1Nl0sMTIwNDAwOltbODVdLDI1Nl0sMTIwNDAxOltbODZdLDI1Nl0sMTIwNDAyOltbODddLDI1Nl0sMTIwNDAzOltbODhdLDI1Nl0sMTIwNDA0OltbODldLDI1Nl0sMTIwNDA1OltbOTBdLDI1Nl0sMTIwNDA2OltbOTddLDI1Nl0sMTIwNDA3OltbOThdLDI1Nl0sMTIwNDA4OltbOTldLDI1Nl0sMTIwNDA5OltbMTAwXSwyNTZdLDEyMDQxMDpbWzEwMV0sMjU2XSwxMjA0MTE6W1sxMDJdLDI1Nl0sMTIwNDEyOltbMTAzXSwyNTZdLDEyMDQxMzpbWzEwNF0sMjU2XSwxMjA0MTQ6W1sxMDVdLDI1Nl0sMTIwNDE1OltbMTA2XSwyNTZdLDEyMDQxNjpbWzEwN10sMjU2XSwxMjA0MTc6W1sxMDhdLDI1Nl0sMTIwNDE4OltbMTA5XSwyNTZdLDEyMDQxOTpbWzExMF0sMjU2XSwxMjA0MjA6W1sxMTFdLDI1Nl0sMTIwNDIxOltbMTEyXSwyNTZdLDEyMDQyMjpbWzExM10sMjU2XSwxMjA0MjM6W1sxMTRdLDI1Nl0sMTIwNDI0OltbMTE1XSwyNTZdLDEyMDQyNTpbWzExNl0sMjU2XSwxMjA0MjY6W1sxMTddLDI1Nl0sMTIwNDI3OltbMTE4XSwyNTZdLDEyMDQyODpbWzExOV0sMjU2XSwxMjA0Mjk6W1sxMjBdLDI1Nl0sMTIwNDMwOltbMTIxXSwyNTZdLDEyMDQzMTpbWzEyMl0sMjU2XSwxMjA0MzI6W1s2NV0sMjU2XSwxMjA0MzM6W1s2Nl0sMjU2XSwxMjA0MzQ6W1s2N10sMjU2XSwxMjA0MzU6W1s2OF0sMjU2XSwxMjA0MzY6W1s2OV0sMjU2XSwxMjA0Mzc6W1s3MF0sMjU2XSwxMjA0Mzg6W1s3MV0sMjU2XSwxMjA0Mzk6W1s3Ml0sMjU2XSwxMjA0NDA6W1s3M10sMjU2XSwxMjA0NDE6W1s3NF0sMjU2XSwxMjA0NDI6W1s3NV0sMjU2XSwxMjA0NDM6W1s3Nl0sMjU2XSwxMjA0NDQ6W1s3N10sMjU2XSwxMjA0NDU6W1s3OF0sMjU2XSwxMjA0NDY6W1s3OV0sMjU2XSwxMjA0NDc6W1s4MF0sMjU2XSwxMjA0NDg6W1s4MV0sMjU2XSwxMjA0NDk6W1s4Ml0sMjU2XSwxMjA0NTA6W1s4M10sMjU2XSwxMjA0NTE6W1s4NF0sMjU2XSwxMjA0NTI6W1s4NV0sMjU2XSwxMjA0NTM6W1s4Nl0sMjU2XSwxMjA0NTQ6W1s4N10sMjU2XSwxMjA0NTU6W1s4OF0sMjU2XSwxMjA0NTY6W1s4OV0sMjU2XSwxMjA0NTc6W1s5MF0sMjU2XSwxMjA0NTg6W1s5N10sMjU2XSwxMjA0NTk6W1s5OF0sMjU2XSwxMjA0NjA6W1s5OV0sMjU2XSwxMjA0NjE6W1sxMDBdLDI1Nl0sMTIwNDYyOltbMTAxXSwyNTZdLDEyMDQ2MzpbWzEwMl0sMjU2XSwxMjA0NjQ6W1sxMDNdLDI1Nl0sMTIwNDY1OltbMTA0XSwyNTZdLDEyMDQ2NjpbWzEwNV0sMjU2XSwxMjA0Njc6W1sxMDZdLDI1Nl0sMTIwNDY4OltbMTA3XSwyNTZdLDEyMDQ2OTpbWzEwOF0sMjU2XSwxMjA0NzA6W1sxMDldLDI1Nl0sMTIwNDcxOltbMTEwXSwyNTZdLDEyMDQ3MjpbWzExMV0sMjU2XSwxMjA0NzM6W1sxMTJdLDI1Nl0sMTIwNDc0OltbMTEzXSwyNTZdLDEyMDQ3NTpbWzExNF0sMjU2XSwxMjA0NzY6W1sxMTVdLDI1Nl0sMTIwNDc3OltbMTE2XSwyNTZdLDEyMDQ3ODpbWzExN10sMjU2XSwxMjA0Nzk6W1sxMThdLDI1Nl0sMTIwNDgwOltbMTE5XSwyNTZdLDEyMDQ4MTpbWzEyMF0sMjU2XSwxMjA0ODI6W1sxMjFdLDI1Nl0sMTIwNDgzOltbMTIyXSwyNTZdLDEyMDQ4NDpbWzMwNV0sMjU2XSwxMjA0ODU6W1s1NjddLDI1Nl0sMTIwNDg4OltbOTEzXSwyNTZdLDEyMDQ4OTpbWzkxNF0sMjU2XSwxMjA0OTA6W1s5MTVdLDI1Nl0sMTIwNDkxOltbOTE2XSwyNTZdLDEyMDQ5MjpbWzkxN10sMjU2XSwxMjA0OTM6W1s5MThdLDI1Nl0sMTIwNDk0OltbOTE5XSwyNTZdLDEyMDQ5NTpbWzkyMF0sMjU2XSwxMjA0OTY6W1s5MjFdLDI1Nl0sMTIwNDk3OltbOTIyXSwyNTZdLDEyMDQ5ODpbWzkyM10sMjU2XSwxMjA0OTk6W1s5MjRdLDI1Nl0sMTIwNTAwOltbOTI1XSwyNTZdLDEyMDUwMTpbWzkyNl0sMjU2XSwxMjA1MDI6W1s5MjddLDI1Nl0sMTIwNTAzOltbOTI4XSwyNTZdLDEyMDUwNDpbWzkyOV0sMjU2XSwxMjA1MDU6W1sxMDEyXSwyNTZdLDEyMDUwNjpbWzkzMV0sMjU2XSwxMjA1MDc6W1s5MzJdLDI1Nl0sMTIwNTA4OltbOTMzXSwyNTZdLDEyMDUwOTpbWzkzNF0sMjU2XSwxMjA1MTA6W1s5MzVdLDI1Nl0sMTIwNTExOltbOTM2XSwyNTZdLDEyMDUxMjpbWzkzN10sMjU2XSwxMjA1MTM6W1s4NzExXSwyNTZdLDEyMDUxNDpbWzk0NV0sMjU2XSwxMjA1MTU6W1s5NDZdLDI1Nl0sMTIwNTE2OltbOTQ3XSwyNTZdLDEyMDUxNzpbWzk0OF0sMjU2XSwxMjA1MTg6W1s5NDldLDI1Nl0sMTIwNTE5OltbOTUwXSwyNTZdLDEyMDUyMDpbWzk1MV0sMjU2XSwxMjA1MjE6W1s5NTJdLDI1Nl0sMTIwNTIyOltbOTUzXSwyNTZdLDEyMDUyMzpbWzk1NF0sMjU2XSwxMjA1MjQ6W1s5NTVdLDI1Nl0sMTIwNTI1OltbOTU2XSwyNTZdLDEyMDUyNjpbWzk1N10sMjU2XSwxMjA1Mjc6W1s5NThdLDI1Nl0sMTIwNTI4OltbOTU5XSwyNTZdLDEyMDUyOTpbWzk2MF0sMjU2XSwxMjA1MzA6W1s5NjFdLDI1Nl0sMTIwNTMxOltbOTYyXSwyNTZdLDEyMDUzMjpbWzk2M10sMjU2XSwxMjA1MzM6W1s5NjRdLDI1Nl0sMTIwNTM0OltbOTY1XSwyNTZdLDEyMDUzNTpbWzk2Nl0sMjU2XSwxMjA1MzY6W1s5NjddLDI1Nl0sMTIwNTM3OltbOTY4XSwyNTZdLDEyMDUzODpbWzk2OV0sMjU2XSwxMjA1Mzk6W1s4NzA2XSwyNTZdLDEyMDU0MDpbWzEwMTNdLDI1Nl0sMTIwNTQxOltbOTc3XSwyNTZdLDEyMDU0MjpbWzEwMDhdLDI1Nl0sMTIwNTQzOltbOTgxXSwyNTZdLDEyMDU0NDpbWzEwMDldLDI1Nl0sMTIwNTQ1OltbOTgyXSwyNTZdLDEyMDU0NjpbWzkxM10sMjU2XSwxMjA1NDc6W1s5MTRdLDI1Nl0sMTIwNTQ4OltbOTE1XSwyNTZdLDEyMDU0OTpbWzkxNl0sMjU2XSwxMjA1NTA6W1s5MTddLDI1Nl0sMTIwNTUxOltbOTE4XSwyNTZdLDEyMDU1MjpbWzkxOV0sMjU2XSwxMjA1NTM6W1s5MjBdLDI1Nl0sMTIwNTU0OltbOTIxXSwyNTZdLDEyMDU1NTpbWzkyMl0sMjU2XSwxMjA1NTY6W1s5MjNdLDI1Nl0sMTIwNTU3OltbOTI0XSwyNTZdLDEyMDU1ODpbWzkyNV0sMjU2XSwxMjA1NTk6W1s5MjZdLDI1Nl0sMTIwNTYwOltbOTI3XSwyNTZdLDEyMDU2MTpbWzkyOF0sMjU2XSwxMjA1NjI6W1s5MjldLDI1Nl0sMTIwNTYzOltbMTAxMl0sMjU2XSwxMjA1NjQ6W1s5MzFdLDI1Nl0sMTIwNTY1OltbOTMyXSwyNTZdLDEyMDU2NjpbWzkzM10sMjU2XSwxMjA1Njc6W1s5MzRdLDI1Nl0sMTIwNTY4OltbOTM1XSwyNTZdLDEyMDU2OTpbWzkzNl0sMjU2XSwxMjA1NzA6W1s5MzddLDI1Nl0sMTIwNTcxOltbODcxMV0sMjU2XSwxMjA1NzI6W1s5NDVdLDI1Nl0sMTIwNTczOltbOTQ2XSwyNTZdLDEyMDU3NDpbWzk0N10sMjU2XSwxMjA1NzU6W1s5NDhdLDI1Nl19LFxuNTUwNDA6ezEyMDU3NjpbWzk0OV0sMjU2XSwxMjA1Nzc6W1s5NTBdLDI1Nl0sMTIwNTc4OltbOTUxXSwyNTZdLDEyMDU3OTpbWzk1Ml0sMjU2XSwxMjA1ODA6W1s5NTNdLDI1Nl0sMTIwNTgxOltbOTU0XSwyNTZdLDEyMDU4MjpbWzk1NV0sMjU2XSwxMjA1ODM6W1s5NTZdLDI1Nl0sMTIwNTg0OltbOTU3XSwyNTZdLDEyMDU4NTpbWzk1OF0sMjU2XSwxMjA1ODY6W1s5NTldLDI1Nl0sMTIwNTg3OltbOTYwXSwyNTZdLDEyMDU4ODpbWzk2MV0sMjU2XSwxMjA1ODk6W1s5NjJdLDI1Nl0sMTIwNTkwOltbOTYzXSwyNTZdLDEyMDU5MTpbWzk2NF0sMjU2XSwxMjA1OTI6W1s5NjVdLDI1Nl0sMTIwNTkzOltbOTY2XSwyNTZdLDEyMDU5NDpbWzk2N10sMjU2XSwxMjA1OTU6W1s5NjhdLDI1Nl0sMTIwNTk2OltbOTY5XSwyNTZdLDEyMDU5NzpbWzg3MDZdLDI1Nl0sMTIwNTk4OltbMTAxM10sMjU2XSwxMjA1OTk6W1s5NzddLDI1Nl0sMTIwNjAwOltbMTAwOF0sMjU2XSwxMjA2MDE6W1s5ODFdLDI1Nl0sMTIwNjAyOltbMTAwOV0sMjU2XSwxMjA2MDM6W1s5ODJdLDI1Nl0sMTIwNjA0OltbOTEzXSwyNTZdLDEyMDYwNTpbWzkxNF0sMjU2XSwxMjA2MDY6W1s5MTVdLDI1Nl0sMTIwNjA3OltbOTE2XSwyNTZdLDEyMDYwODpbWzkxN10sMjU2XSwxMjA2MDk6W1s5MThdLDI1Nl0sMTIwNjEwOltbOTE5XSwyNTZdLDEyMDYxMTpbWzkyMF0sMjU2XSwxMjA2MTI6W1s5MjFdLDI1Nl0sMTIwNjEzOltbOTIyXSwyNTZdLDEyMDYxNDpbWzkyM10sMjU2XSwxMjA2MTU6W1s5MjRdLDI1Nl0sMTIwNjE2OltbOTI1XSwyNTZdLDEyMDYxNzpbWzkyNl0sMjU2XSwxMjA2MTg6W1s5MjddLDI1Nl0sMTIwNjE5OltbOTI4XSwyNTZdLDEyMDYyMDpbWzkyOV0sMjU2XSwxMjA2MjE6W1sxMDEyXSwyNTZdLDEyMDYyMjpbWzkzMV0sMjU2XSwxMjA2MjM6W1s5MzJdLDI1Nl0sMTIwNjI0OltbOTMzXSwyNTZdLDEyMDYyNTpbWzkzNF0sMjU2XSwxMjA2MjY6W1s5MzVdLDI1Nl0sMTIwNjI3OltbOTM2XSwyNTZdLDEyMDYyODpbWzkzN10sMjU2XSwxMjA2Mjk6W1s4NzExXSwyNTZdLDEyMDYzMDpbWzk0NV0sMjU2XSwxMjA2MzE6W1s5NDZdLDI1Nl0sMTIwNjMyOltbOTQ3XSwyNTZdLDEyMDYzMzpbWzk0OF0sMjU2XSwxMjA2MzQ6W1s5NDldLDI1Nl0sMTIwNjM1OltbOTUwXSwyNTZdLDEyMDYzNjpbWzk1MV0sMjU2XSwxMjA2Mzc6W1s5NTJdLDI1Nl0sMTIwNjM4OltbOTUzXSwyNTZdLDEyMDYzOTpbWzk1NF0sMjU2XSwxMjA2NDA6W1s5NTVdLDI1Nl0sMTIwNjQxOltbOTU2XSwyNTZdLDEyMDY0MjpbWzk1N10sMjU2XSwxMjA2NDM6W1s5NThdLDI1Nl0sMTIwNjQ0OltbOTU5XSwyNTZdLDEyMDY0NTpbWzk2MF0sMjU2XSwxMjA2NDY6W1s5NjFdLDI1Nl0sMTIwNjQ3OltbOTYyXSwyNTZdLDEyMDY0ODpbWzk2M10sMjU2XSwxMjA2NDk6W1s5NjRdLDI1Nl0sMTIwNjUwOltbOTY1XSwyNTZdLDEyMDY1MTpbWzk2Nl0sMjU2XSwxMjA2NTI6W1s5NjddLDI1Nl0sMTIwNjUzOltbOTY4XSwyNTZdLDEyMDY1NDpbWzk2OV0sMjU2XSwxMjA2NTU6W1s4NzA2XSwyNTZdLDEyMDY1NjpbWzEwMTNdLDI1Nl0sMTIwNjU3OltbOTc3XSwyNTZdLDEyMDY1ODpbWzEwMDhdLDI1Nl0sMTIwNjU5OltbOTgxXSwyNTZdLDEyMDY2MDpbWzEwMDldLDI1Nl0sMTIwNjYxOltbOTgyXSwyNTZdLDEyMDY2MjpbWzkxM10sMjU2XSwxMjA2NjM6W1s5MTRdLDI1Nl0sMTIwNjY0OltbOTE1XSwyNTZdLDEyMDY2NTpbWzkxNl0sMjU2XSwxMjA2NjY6W1s5MTddLDI1Nl0sMTIwNjY3OltbOTE4XSwyNTZdLDEyMDY2ODpbWzkxOV0sMjU2XSwxMjA2Njk6W1s5MjBdLDI1Nl0sMTIwNjcwOltbOTIxXSwyNTZdLDEyMDY3MTpbWzkyMl0sMjU2XSwxMjA2NzI6W1s5MjNdLDI1Nl0sMTIwNjczOltbOTI0XSwyNTZdLDEyMDY3NDpbWzkyNV0sMjU2XSwxMjA2NzU6W1s5MjZdLDI1Nl0sMTIwNjc2OltbOTI3XSwyNTZdLDEyMDY3NzpbWzkyOF0sMjU2XSwxMjA2Nzg6W1s5MjldLDI1Nl0sMTIwNjc5OltbMTAxMl0sMjU2XSwxMjA2ODA6W1s5MzFdLDI1Nl0sMTIwNjgxOltbOTMyXSwyNTZdLDEyMDY4MjpbWzkzM10sMjU2XSwxMjA2ODM6W1s5MzRdLDI1Nl0sMTIwNjg0OltbOTM1XSwyNTZdLDEyMDY4NTpbWzkzNl0sMjU2XSwxMjA2ODY6W1s5MzddLDI1Nl0sMTIwNjg3OltbODcxMV0sMjU2XSwxMjA2ODg6W1s5NDVdLDI1Nl0sMTIwNjg5OltbOTQ2XSwyNTZdLDEyMDY5MDpbWzk0N10sMjU2XSwxMjA2OTE6W1s5NDhdLDI1Nl0sMTIwNjkyOltbOTQ5XSwyNTZdLDEyMDY5MzpbWzk1MF0sMjU2XSwxMjA2OTQ6W1s5NTFdLDI1Nl0sMTIwNjk1OltbOTUyXSwyNTZdLDEyMDY5NjpbWzk1M10sMjU2XSwxMjA2OTc6W1s5NTRdLDI1Nl0sMTIwNjk4OltbOTU1XSwyNTZdLDEyMDY5OTpbWzk1Nl0sMjU2XSwxMjA3MDA6W1s5NTddLDI1Nl0sMTIwNzAxOltbOTU4XSwyNTZdLDEyMDcwMjpbWzk1OV0sMjU2XSwxMjA3MDM6W1s5NjBdLDI1Nl0sMTIwNzA0OltbOTYxXSwyNTZdLDEyMDcwNTpbWzk2Ml0sMjU2XSwxMjA3MDY6W1s5NjNdLDI1Nl0sMTIwNzA3OltbOTY0XSwyNTZdLDEyMDcwODpbWzk2NV0sMjU2XSwxMjA3MDk6W1s5NjZdLDI1Nl0sMTIwNzEwOltbOTY3XSwyNTZdLDEyMDcxMTpbWzk2OF0sMjU2XSwxMjA3MTI6W1s5NjldLDI1Nl0sMTIwNzEzOltbODcwNl0sMjU2XSwxMjA3MTQ6W1sxMDEzXSwyNTZdLDEyMDcxNTpbWzk3N10sMjU2XSwxMjA3MTY6W1sxMDA4XSwyNTZdLDEyMDcxNzpbWzk4MV0sMjU2XSwxMjA3MTg6W1sxMDA5XSwyNTZdLDEyMDcxOTpbWzk4Ml0sMjU2XSwxMjA3MjA6W1s5MTNdLDI1Nl0sMTIwNzIxOltbOTE0XSwyNTZdLDEyMDcyMjpbWzkxNV0sMjU2XSwxMjA3MjM6W1s5MTZdLDI1Nl0sMTIwNzI0OltbOTE3XSwyNTZdLDEyMDcyNTpbWzkxOF0sMjU2XSwxMjA3MjY6W1s5MTldLDI1Nl0sMTIwNzI3OltbOTIwXSwyNTZdLDEyMDcyODpbWzkyMV0sMjU2XSwxMjA3Mjk6W1s5MjJdLDI1Nl0sMTIwNzMwOltbOTIzXSwyNTZdLDEyMDczMTpbWzkyNF0sMjU2XSwxMjA3MzI6W1s5MjVdLDI1Nl0sMTIwNzMzOltbOTI2XSwyNTZdLDEyMDczNDpbWzkyN10sMjU2XSwxMjA3MzU6W1s5MjhdLDI1Nl0sMTIwNzM2OltbOTI5XSwyNTZdLDEyMDczNzpbWzEwMTJdLDI1Nl0sMTIwNzM4OltbOTMxXSwyNTZdLDEyMDczOTpbWzkzMl0sMjU2XSwxMjA3NDA6W1s5MzNdLDI1Nl0sMTIwNzQxOltbOTM0XSwyNTZdLDEyMDc0MjpbWzkzNV0sMjU2XSwxMjA3NDM6W1s5MzZdLDI1Nl0sMTIwNzQ0OltbOTM3XSwyNTZdLDEyMDc0NTpbWzg3MTFdLDI1Nl0sMTIwNzQ2OltbOTQ1XSwyNTZdLDEyMDc0NzpbWzk0Nl0sMjU2XSwxMjA3NDg6W1s5NDddLDI1Nl0sMTIwNzQ5OltbOTQ4XSwyNTZdLDEyMDc1MDpbWzk0OV0sMjU2XSwxMjA3NTE6W1s5NTBdLDI1Nl0sMTIwNzUyOltbOTUxXSwyNTZdLDEyMDc1MzpbWzk1Ml0sMjU2XSwxMjA3NTQ6W1s5NTNdLDI1Nl0sMTIwNzU1OltbOTU0XSwyNTZdLDEyMDc1NjpbWzk1NV0sMjU2XSwxMjA3NTc6W1s5NTZdLDI1Nl0sMTIwNzU4OltbOTU3XSwyNTZdLDEyMDc1OTpbWzk1OF0sMjU2XSwxMjA3NjA6W1s5NTldLDI1Nl0sMTIwNzYxOltbOTYwXSwyNTZdLDEyMDc2MjpbWzk2MV0sMjU2XSwxMjA3NjM6W1s5NjJdLDI1Nl0sMTIwNzY0OltbOTYzXSwyNTZdLDEyMDc2NTpbWzk2NF0sMjU2XSwxMjA3NjY6W1s5NjVdLDI1Nl0sMTIwNzY3OltbOTY2XSwyNTZdLDEyMDc2ODpbWzk2N10sMjU2XSwxMjA3Njk6W1s5NjhdLDI1Nl0sMTIwNzcwOltbOTY5XSwyNTZdLDEyMDc3MTpbWzg3MDZdLDI1Nl0sMTIwNzcyOltbMTAxM10sMjU2XSwxMjA3NzM6W1s5NzddLDI1Nl0sMTIwNzc0OltbMTAwOF0sMjU2XSwxMjA3NzU6W1s5ODFdLDI1Nl0sMTIwNzc2OltbMTAwOV0sMjU2XSwxMjA3Nzc6W1s5ODJdLDI1Nl0sMTIwNzc4OltbOTg4XSwyNTZdLDEyMDc3OTpbWzk4OV0sMjU2XSwxMjA3ODI6W1s0OF0sMjU2XSwxMjA3ODM6W1s0OV0sMjU2XSwxMjA3ODQ6W1s1MF0sMjU2XSwxMjA3ODU6W1s1MV0sMjU2XSwxMjA3ODY6W1s1Ml0sMjU2XSwxMjA3ODc6W1s1M10sMjU2XSwxMjA3ODg6W1s1NF0sMjU2XSwxMjA3ODk6W1s1NV0sMjU2XSwxMjA3OTA6W1s1Nl0sMjU2XSwxMjA3OTE6W1s1N10sMjU2XSwxMjA3OTI6W1s0OF0sMjU2XSwxMjA3OTM6W1s0OV0sMjU2XSwxMjA3OTQ6W1s1MF0sMjU2XSwxMjA3OTU6W1s1MV0sMjU2XSwxMjA3OTY6W1s1Ml0sMjU2XSwxMjA3OTc6W1s1M10sMjU2XSwxMjA3OTg6W1s1NF0sMjU2XSwxMjA3OTk6W1s1NV0sMjU2XSwxMjA4MDA6W1s1Nl0sMjU2XSwxMjA4MDE6W1s1N10sMjU2XSwxMjA4MDI6W1s0OF0sMjU2XSwxMjA4MDM6W1s0OV0sMjU2XSwxMjA4MDQ6W1s1MF0sMjU2XSwxMjA4MDU6W1s1MV0sMjU2XSwxMjA4MDY6W1s1Ml0sMjU2XSwxMjA4MDc6W1s1M10sMjU2XSwxMjA4MDg6W1s1NF0sMjU2XSwxMjA4MDk6W1s1NV0sMjU2XSwxMjA4MTA6W1s1Nl0sMjU2XSwxMjA4MTE6W1s1N10sMjU2XSwxMjA4MTI6W1s0OF0sMjU2XSwxMjA4MTM6W1s0OV0sMjU2XSwxMjA4MTQ6W1s1MF0sMjU2XSwxMjA4MTU6W1s1MV0sMjU2XSwxMjA4MTY6W1s1Ml0sMjU2XSwxMjA4MTc6W1s1M10sMjU2XSwxMjA4MTg6W1s1NF0sMjU2XSwxMjA4MTk6W1s1NV0sMjU2XSwxMjA4MjA6W1s1Nl0sMjU2XSwxMjA4MjE6W1s1N10sMjU2XSwxMjA4MjI6W1s0OF0sMjU2XSwxMjA4MjM6W1s0OV0sMjU2XSwxMjA4MjQ6W1s1MF0sMjU2XSwxMjA4MjU6W1s1MV0sMjU2XSwxMjA4MjY6W1s1Ml0sMjU2XSwxMjA4Mjc6W1s1M10sMjU2XSwxMjA4Mjg6W1s1NF0sMjU2XSwxMjA4Mjk6W1s1NV0sMjU2XSwxMjA4MzA6W1s1Nl0sMjU2XSwxMjA4MzE6W1s1N10sMjU2XX0sXG42MDkyODp7MTI2NDY0OltbMTU3NV0sMjU2XSwxMjY0NjU6W1sxNTc2XSwyNTZdLDEyNjQ2NjpbWzE1ODBdLDI1Nl0sMTI2NDY3OltbMTU4M10sMjU2XSwxMjY0Njk6W1sxNjA4XSwyNTZdLDEyNjQ3MDpbWzE1ODZdLDI1Nl0sMTI2NDcxOltbMTU4MV0sMjU2XSwxMjY0NzI6W1sxNTkxXSwyNTZdLDEyNjQ3MzpbWzE2MTBdLDI1Nl0sMTI2NDc0OltbMTYwM10sMjU2XSwxMjY0NzU6W1sxNjA0XSwyNTZdLDEyNjQ3NjpbWzE2MDVdLDI1Nl0sMTI2NDc3OltbMTYwNl0sMjU2XSwxMjY0Nzg6W1sxNTg3XSwyNTZdLDEyNjQ3OTpbWzE1OTNdLDI1Nl0sMTI2NDgwOltbMTYwMV0sMjU2XSwxMjY0ODE6W1sxNTg5XSwyNTZdLDEyNjQ4MjpbWzE2MDJdLDI1Nl0sMTI2NDgzOltbMTU4NV0sMjU2XSwxMjY0ODQ6W1sxNTg4XSwyNTZdLDEyNjQ4NTpbWzE1NzhdLDI1Nl0sMTI2NDg2OltbMTU3OV0sMjU2XSwxMjY0ODc6W1sxNTgyXSwyNTZdLDEyNjQ4ODpbWzE1ODRdLDI1Nl0sMTI2NDg5OltbMTU5MF0sMjU2XSwxMjY0OTA6W1sxNTkyXSwyNTZdLDEyNjQ5MTpbWzE1OTRdLDI1Nl0sMTI2NDkyOltbMTY0Nl0sMjU2XSwxMjY0OTM6W1sxNzIyXSwyNTZdLDEyNjQ5NDpbWzE2OTddLDI1Nl0sMTI2NDk1OltbMTY0N10sMjU2XSwxMjY0OTc6W1sxNTc2XSwyNTZdLDEyNjQ5ODpbWzE1ODBdLDI1Nl0sMTI2NTAwOltbMTYwN10sMjU2XSwxMjY1MDM6W1sxNTgxXSwyNTZdLDEyNjUwNTpbWzE2MTBdLDI1Nl0sMTI2NTA2OltbMTYwM10sMjU2XSwxMjY1MDc6W1sxNjA0XSwyNTZdLDEyNjUwODpbWzE2MDVdLDI1Nl0sMTI2NTA5OltbMTYwNl0sMjU2XSwxMjY1MTA6W1sxNTg3XSwyNTZdLDEyNjUxMTpbWzE1OTNdLDI1Nl0sMTI2NTEyOltbMTYwMV0sMjU2XSwxMjY1MTM6W1sxNTg5XSwyNTZdLDEyNjUxNDpbWzE2MDJdLDI1Nl0sMTI2NTE2OltbMTU4OF0sMjU2XSwxMjY1MTc6W1sxNTc4XSwyNTZdLDEyNjUxODpbWzE1NzldLDI1Nl0sMTI2NTE5OltbMTU4Ml0sMjU2XSwxMjY1MjE6W1sxNTkwXSwyNTZdLDEyNjUyMzpbWzE1OTRdLDI1Nl0sMTI2NTMwOltbMTU4MF0sMjU2XSwxMjY1MzU6W1sxNTgxXSwyNTZdLDEyNjUzNzpbWzE2MTBdLDI1Nl0sMTI2NTM5OltbMTYwNF0sMjU2XSwxMjY1NDE6W1sxNjA2XSwyNTZdLDEyNjU0MjpbWzE1ODddLDI1Nl0sMTI2NTQzOltbMTU5M10sMjU2XSwxMjY1NDU6W1sxNTg5XSwyNTZdLDEyNjU0NjpbWzE2MDJdLDI1Nl0sMTI2NTQ4OltbMTU4OF0sMjU2XSwxMjY1NTE6W1sxNTgyXSwyNTZdLDEyNjU1MzpbWzE1OTBdLDI1Nl0sMTI2NTU1OltbMTU5NF0sMjU2XSwxMjY1NTc6W1sxNzIyXSwyNTZdLDEyNjU1OTpbWzE2NDddLDI1Nl0sMTI2NTYxOltbMTU3Nl0sMjU2XSwxMjY1NjI6W1sxNTgwXSwyNTZdLDEyNjU2NDpbWzE2MDddLDI1Nl0sMTI2NTY3OltbMTU4MV0sMjU2XSwxMjY1Njg6W1sxNTkxXSwyNTZdLDEyNjU2OTpbWzE2MTBdLDI1Nl0sMTI2NTcwOltbMTYwM10sMjU2XSwxMjY1NzI6W1sxNjA1XSwyNTZdLDEyNjU3MzpbWzE2MDZdLDI1Nl0sMTI2NTc0OltbMTU4N10sMjU2XSwxMjY1NzU6W1sxNTkzXSwyNTZdLDEyNjU3NjpbWzE2MDFdLDI1Nl0sMTI2NTc3OltbMTU4OV0sMjU2XSwxMjY1Nzg6W1sxNjAyXSwyNTZdLDEyNjU4MDpbWzE1ODhdLDI1Nl0sMTI2NTgxOltbMTU3OF0sMjU2XSwxMjY1ODI6W1sxNTc5XSwyNTZdLDEyNjU4MzpbWzE1ODJdLDI1Nl0sMTI2NTg1OltbMTU5MF0sMjU2XSwxMjY1ODY6W1sxNTkyXSwyNTZdLDEyNjU4NzpbWzE1OTRdLDI1Nl0sMTI2NTg4OltbMTY0Nl0sMjU2XSwxMjY1OTA6W1sxNjk3XSwyNTZdLDEyNjU5MjpbWzE1NzVdLDI1Nl0sMTI2NTkzOltbMTU3Nl0sMjU2XSwxMjY1OTQ6W1sxNTgwXSwyNTZdLDEyNjU5NTpbWzE1ODNdLDI1Nl0sMTI2NTk2OltbMTYwN10sMjU2XSwxMjY1OTc6W1sxNjA4XSwyNTZdLDEyNjU5ODpbWzE1ODZdLDI1Nl0sMTI2NTk5OltbMTU4MV0sMjU2XSwxMjY2MDA6W1sxNTkxXSwyNTZdLDEyNjYwMTpbWzE2MTBdLDI1Nl0sMTI2NjAzOltbMTYwNF0sMjU2XSwxMjY2MDQ6W1sxNjA1XSwyNTZdLDEyNjYwNTpbWzE2MDZdLDI1Nl0sMTI2NjA2OltbMTU4N10sMjU2XSwxMjY2MDc6W1sxNTkzXSwyNTZdLDEyNjYwODpbWzE2MDFdLDI1Nl0sMTI2NjA5OltbMTU4OV0sMjU2XSwxMjY2MTA6W1sxNjAyXSwyNTZdLDEyNjYxMTpbWzE1ODVdLDI1Nl0sMTI2NjEyOltbMTU4OF0sMjU2XSwxMjY2MTM6W1sxNTc4XSwyNTZdLDEyNjYxNDpbWzE1NzldLDI1Nl0sMTI2NjE1OltbMTU4Ml0sMjU2XSwxMjY2MTY6W1sxNTg0XSwyNTZdLDEyNjYxNzpbWzE1OTBdLDI1Nl0sMTI2NjE4OltbMTU5Ml0sMjU2XSwxMjY2MTk6W1sxNTk0XSwyNTZdLDEyNjYyNTpbWzE1NzZdLDI1Nl0sMTI2NjI2OltbMTU4MF0sMjU2XSwxMjY2Mjc6W1sxNTgzXSwyNTZdLDEyNjYyOTpbWzE2MDhdLDI1Nl0sMTI2NjMwOltbMTU4Nl0sMjU2XSwxMjY2MzE6W1sxNTgxXSwyNTZdLDEyNjYzMjpbWzE1OTFdLDI1Nl0sMTI2NjMzOltbMTYxMF0sMjU2XSwxMjY2MzU6W1sxNjA0XSwyNTZdLDEyNjYzNjpbWzE2MDVdLDI1Nl0sMTI2NjM3OltbMTYwNl0sMjU2XSwxMjY2Mzg6W1sxNTg3XSwyNTZdLDEyNjYzOTpbWzE1OTNdLDI1Nl0sMTI2NjQwOltbMTYwMV0sMjU2XSwxMjY2NDE6W1sxNTg5XSwyNTZdLDEyNjY0MjpbWzE2MDJdLDI1Nl0sMTI2NjQzOltbMTU4NV0sMjU2XSwxMjY2NDQ6W1sxNTg4XSwyNTZdLDEyNjY0NTpbWzE1NzhdLDI1Nl0sMTI2NjQ2OltbMTU3OV0sMjU2XSwxMjY2NDc6W1sxNTgyXSwyNTZdLDEyNjY0ODpbWzE1ODRdLDI1Nl0sMTI2NjQ5OltbMTU5MF0sMjU2XSwxMjY2NTA6W1sxNTkyXSwyNTZdLDEyNjY1MTpbWzE1OTRdLDI1Nl19LFxuNjE2OTY6ezEyNzIzMjpbWzQ4LDQ2XSwyNTZdLDEyNzIzMzpbWzQ4LDQ0XSwyNTZdLDEyNzIzNDpbWzQ5LDQ0XSwyNTZdLDEyNzIzNTpbWzUwLDQ0XSwyNTZdLDEyNzIzNjpbWzUxLDQ0XSwyNTZdLDEyNzIzNzpbWzUyLDQ0XSwyNTZdLDEyNzIzODpbWzUzLDQ0XSwyNTZdLDEyNzIzOTpbWzU0LDQ0XSwyNTZdLDEyNzI0MDpbWzU1LDQ0XSwyNTZdLDEyNzI0MTpbWzU2LDQ0XSwyNTZdLDEyNzI0MjpbWzU3LDQ0XSwyNTZdLDEyNzI0ODpbWzQwLDY1LDQxXSwyNTZdLDEyNzI0OTpbWzQwLDY2LDQxXSwyNTZdLDEyNzI1MDpbWzQwLDY3LDQxXSwyNTZdLDEyNzI1MTpbWzQwLDY4LDQxXSwyNTZdLDEyNzI1MjpbWzQwLDY5LDQxXSwyNTZdLDEyNzI1MzpbWzQwLDcwLDQxXSwyNTZdLDEyNzI1NDpbWzQwLDcxLDQxXSwyNTZdLDEyNzI1NTpbWzQwLDcyLDQxXSwyNTZdLDEyNzI1NjpbWzQwLDczLDQxXSwyNTZdLDEyNzI1NzpbWzQwLDc0LDQxXSwyNTZdLDEyNzI1ODpbWzQwLDc1LDQxXSwyNTZdLDEyNzI1OTpbWzQwLDc2LDQxXSwyNTZdLDEyNzI2MDpbWzQwLDc3LDQxXSwyNTZdLDEyNzI2MTpbWzQwLDc4LDQxXSwyNTZdLDEyNzI2MjpbWzQwLDc5LDQxXSwyNTZdLDEyNzI2MzpbWzQwLDgwLDQxXSwyNTZdLDEyNzI2NDpbWzQwLDgxLDQxXSwyNTZdLDEyNzI2NTpbWzQwLDgyLDQxXSwyNTZdLDEyNzI2NjpbWzQwLDgzLDQxXSwyNTZdLDEyNzI2NzpbWzQwLDg0LDQxXSwyNTZdLDEyNzI2ODpbWzQwLDg1LDQxXSwyNTZdLDEyNzI2OTpbWzQwLDg2LDQxXSwyNTZdLDEyNzI3MDpbWzQwLDg3LDQxXSwyNTZdLDEyNzI3MTpbWzQwLDg4LDQxXSwyNTZdLDEyNzI3MjpbWzQwLDg5LDQxXSwyNTZdLDEyNzI3MzpbWzQwLDkwLDQxXSwyNTZdLDEyNzI3NDpbWzEyMzA4LDgzLDEyMzA5XSwyNTZdLDEyNzI3NTpbWzY3XSwyNTZdLDEyNzI3NjpbWzgyXSwyNTZdLDEyNzI3NzpbWzY3LDY4XSwyNTZdLDEyNzI3ODpbWzg3LDkwXSwyNTZdLDEyNzI4MDpbWzY1XSwyNTZdLDEyNzI4MTpbWzY2XSwyNTZdLDEyNzI4MjpbWzY3XSwyNTZdLDEyNzI4MzpbWzY4XSwyNTZdLDEyNzI4NDpbWzY5XSwyNTZdLDEyNzI4NTpbWzcwXSwyNTZdLDEyNzI4NjpbWzcxXSwyNTZdLDEyNzI4NzpbWzcyXSwyNTZdLDEyNzI4ODpbWzczXSwyNTZdLDEyNzI4OTpbWzc0XSwyNTZdLDEyNzI5MDpbWzc1XSwyNTZdLDEyNzI5MTpbWzc2XSwyNTZdLDEyNzI5MjpbWzc3XSwyNTZdLDEyNzI5MzpbWzc4XSwyNTZdLDEyNzI5NDpbWzc5XSwyNTZdLDEyNzI5NTpbWzgwXSwyNTZdLDEyNzI5NjpbWzgxXSwyNTZdLDEyNzI5NzpbWzgyXSwyNTZdLDEyNzI5ODpbWzgzXSwyNTZdLDEyNzI5OTpbWzg0XSwyNTZdLDEyNzMwMDpbWzg1XSwyNTZdLDEyNzMwMTpbWzg2XSwyNTZdLDEyNzMwMjpbWzg3XSwyNTZdLDEyNzMwMzpbWzg4XSwyNTZdLDEyNzMwNDpbWzg5XSwyNTZdLDEyNzMwNTpbWzkwXSwyNTZdLDEyNzMwNjpbWzcyLDg2XSwyNTZdLDEyNzMwNzpbWzc3LDg2XSwyNTZdLDEyNzMwODpbWzgzLDY4XSwyNTZdLDEyNzMwOTpbWzgzLDgzXSwyNTZdLDEyNzMxMDpbWzgwLDgwLDg2XSwyNTZdLDEyNzMxMTpbWzg3LDY3XSwyNTZdLDEyNzMzODpbWzc3LDY3XSwyNTZdLDEyNzMzOTpbWzc3LDY4XSwyNTZdLDEyNzM3NjpbWzY4LDc0XSwyNTZdfSxcbjYxOTUyOnsxMjc0ODg6W1sxMjQxMSwxMjM2M10sMjU2XSwxMjc0ODk6W1sxMjQ2NywxMjQ2N10sMjU2XSwxMjc0OTA6W1sxMjQ2OV0sMjU2XSwxMjc1MDQ6W1syNTE2M10sMjU2XSwxMjc1MDU6W1syMzM4M10sMjU2XSwxMjc1MDY6W1syMTQ1Ml0sMjU2XSwxMjc1MDc6W1sxMjQ4N10sMjU2XSwxMjc1MDg6W1syMDEwOF0sMjU2XSwxMjc1MDk6W1syMjgxMF0sMjU2XSwxMjc1MTA6W1szNTI5OV0sMjU2XSwxMjc1MTE6W1syMjgyNV0sMjU2XSwxMjc1MTI6W1syMDEzMl0sMjU2XSwxMjc1MTM6W1syNjE0NF0sMjU2XSwxMjc1MTQ6W1syODk2MV0sMjU2XSwxMjc1MTU6W1syNjAwOV0sMjU2XSwxMjc1MTY6W1syMTA2OV0sMjU2XSwxMjc1MTc6W1syNDQ2MF0sMjU2XSwxMjc1MTg6W1syMDg3N10sMjU2XSwxMjc1MTk6W1syNjAzMl0sMjU2XSwxMjc1MjA6W1syMTAyMV0sMjU2XSwxMjc1MjE6W1szMjA2Nl0sMjU2XSwxMjc1MjI6W1syOTk4M10sMjU2XSwxMjc1MjM6W1szNjAwOV0sMjU2XSwxMjc1MjQ6W1syMjc2OF0sMjU2XSwxMjc1MjU6W1syMTU2MV0sMjU2XSwxMjc1MjY6W1syODQzNl0sMjU2XSwxMjc1Mjc6W1syNTIzN10sMjU2XSwxMjc1Mjg6W1syNTQyOV0sMjU2XSwxMjc1Mjk6W1sxOTk2OF0sMjU2XSwxMjc1MzA6W1sxOTk3N10sMjU2XSwxMjc1MzE6W1szNjkzOF0sMjU2XSwxMjc1MzI6W1syNDAzOF0sMjU2XSwxMjc1MzM6W1syMDAxM10sMjU2XSwxMjc1MzQ6W1syMTQ5MV0sMjU2XSwxMjc1MzU6W1syNTM1MV0sMjU2XSwxMjc1MzY6W1szNjIwOF0sMjU2XSwxMjc1Mzc6W1syNTE3MV0sMjU2XSwxMjc1Mzg6W1szMTEwNV0sMjU2XSwxMjc1Mzk6W1szMTM1NF0sMjU2XSwxMjc1NDA6W1syMTUxMl0sMjU2XSwxMjc1NDE6W1syODI4OF0sMjU2XSwxMjc1NDI6W1syNjM3N10sMjU2XSwxMjc1NDM6W1syNjM3Nl0sMjU2XSwxMjc1NDQ6W1szMDAwM10sMjU2XSwxMjc1NDU6W1syMTEwNl0sMjU2XSwxMjc1NDY6W1syMTk0Ml0sMjU2XSwxMjc1NTI6W1sxMjMwOCwyNjQxMiwxMjMwOV0sMjU2XSwxMjc1NTM6W1sxMjMwOCwxOTk3NywxMjMwOV0sMjU2XSwxMjc1NTQ6W1sxMjMwOCwyMDEwOCwxMjMwOV0sMjU2XSwxMjc1NTU6W1sxMjMwOCwyMzQzMywxMjMwOV0sMjU2XSwxMjc1NTY6W1sxMjMwOCwyODg1NywxMjMwOV0sMjU2XSwxMjc1NTc6W1sxMjMwOCwyNTE3MSwxMjMwOV0sMjU2XSwxMjc1NTg6W1sxMjMwOCwzMDQyMywxMjMwOV0sMjU2XSwxMjc1NTk6W1sxMjMwOCwyMTIxMywxMjMwOV0sMjU2XSwxMjc1NjA6W1sxMjMwOCwyNTk0MywxMjMwOV0sMjU2XSwxMjc1Njg6W1syNDQ3MV0sMjU2XSwxMjc1Njk6W1syMTQ4N10sMjU2XX0sXG42MzQ4ODp7MTk0NTYwOltbMjAwMjldXSwxOTQ1NjE6W1syMDAyNF1dLDE5NDU2MjpbWzIwMDMzXV0sMTk0NTYzOltbMTMxMzYyXV0sMTk0NTY0OltbMjAzMjBdXSwxOTQ1NjU6W1syMDM5OF1dLDE5NDU2NjpbWzIwNDExXV0sMTk0NTY3OltbMjA0ODJdXSwxOTQ1Njg6W1syMDYwMl1dLDE5NDU2OTpbWzIwNjMzXV0sMTk0NTcwOltbMjA3MTFdXSwxOTQ1NzE6W1syMDY4N11dLDE5NDU3MjpbWzEzNDcwXV0sMTk0NTczOltbMTMyNjY2XV0sMTk0NTc0OltbMjA4MTNdXSwxOTQ1NzU6W1syMDgyMF1dLDE5NDU3NjpbWzIwODM2XV0sMTk0NTc3OltbMjA4NTVdXSwxOTQ1Nzg6W1sxMzIzODBdXSwxOTQ1Nzk6W1sxMzQ5N11dLDE5NDU4MDpbWzIwODM5XV0sMTk0NTgxOltbMjA4NzddXSwxOTQ1ODI6W1sxMzI0MjddXSwxOTQ1ODM6W1syMDg4N11dLDE5NDU4NDpbWzIwOTAwXV0sMTk0NTg1OltbMjAxNzJdXSwxOTQ1ODY6W1syMDkwOF1dLDE5NDU4NzpbWzIwOTE3XV0sMTk0NTg4OltbMTY4NDE1XV0sMTk0NTg5OltbMjA5ODFdXSwxOTQ1OTA6W1syMDk5NV1dLDE5NDU5MTpbWzEzNTM1XV0sMTk0NTkyOltbMjEwNTFdXSwxOTQ1OTM6W1syMTA2Ml1dLDE5NDU5NDpbWzIxMTA2XV0sMTk0NTk1OltbMjExMTFdXSwxOTQ1OTY6W1sxMzU4OV1dLDE5NDU5NzpbWzIxMTkxXV0sMTk0NTk4OltbMjExOTNdXSwxOTQ1OTk6W1syMTIyMF1dLDE5NDYwMDpbWzIxMjQyXV0sMTk0NjAxOltbMjEyNTNdXSwxOTQ2MDI6W1syMTI1NF1dLDE5NDYwMzpbWzIxMjcxXV0sMTk0NjA0OltbMjEzMjFdXSwxOTQ2MDU6W1syMTMyOV1dLDE5NDYwNjpbWzIxMzM4XV0sMTk0NjA3OltbMjEzNjNdXSwxOTQ2MDg6W1syMTM3M11dLDE5NDYwOTpbWzIxMzc1XV0sMTk0NjEwOltbMjEzNzVdXSwxOTQ2MTE6W1syMTM3NV1dLDE5NDYxMjpbWzEzMzY3Nl1dLDE5NDYxMzpbWzI4Nzg0XV0sMTk0NjE0OltbMjE0NTBdXSwxOTQ2MTU6W1syMTQ3MV1dLDE5NDYxNjpbWzEzMzk4N11dLDE5NDYxNzpbWzIxNDgzXV0sMTk0NjE4OltbMjE0ODldXSwxOTQ2MTk6W1syMTUxMF1dLDE5NDYyMDpbWzIxNjYyXV0sMTk0NjIxOltbMjE1NjBdXSwxOTQ2MjI6W1syMTU3Nl1dLDE5NDYyMzpbWzIxNjA4XV0sMTk0NjI0OltbMjE2NjZdXSwxOTQ2MjU6W1syMTc1MF1dLDE5NDYyNjpbWzIxNzc2XV0sMTk0NjI3OltbMjE4NDNdXSwxOTQ2Mjg6W1syMTg1OV1dLDE5NDYyOTpbWzIxODkyXV0sMTk0NjMwOltbMjE4OTJdXSwxOTQ2MzE6W1syMTkxM11dLDE5NDYzMjpbWzIxOTMxXV0sMTk0NjMzOltbMjE5MzldXSwxOTQ2MzQ6W1syMTk1NF1dLDE5NDYzNTpbWzIyMjk0XV0sMTk0NjM2OltbMjIwMjJdXSwxOTQ2Mzc6W1syMjI5NV1dLDE5NDYzODpbWzIyMDk3XV0sMTk0NjM5OltbMjIxMzJdXSwxOTQ2NDA6W1syMDk5OV1dLDE5NDY0MTpbWzIyNzY2XV0sMTk0NjQyOltbMjI0NzhdXSwxOTQ2NDM6W1syMjUxNl1dLDE5NDY0NDpbWzIyNTQxXV0sMTk0NjQ1OltbMjI0MTFdXSwxOTQ2NDY6W1syMjU3OF1dLDE5NDY0NzpbWzIyNTc3XV0sMTk0NjQ4OltbMjI3MDBdXSwxOTQ2NDk6W1sxMzY0MjBdXSwxOTQ2NTA6W1syMjc3MF1dLDE5NDY1MTpbWzIyNzc1XV0sMTk0NjUyOltbMjI3OTBdXSwxOTQ2NTM6W1syMjgxMF1dLDE5NDY1NDpbWzIyODE4XV0sMTk0NjU1OltbMjI4ODJdXSwxOTQ2NTY6W1sxMzY4NzJdXSwxOTQ2NTc6W1sxMzY5MzhdXSwxOTQ2NTg6W1syMzAyMF1dLDE5NDY1OTpbWzIzMDY3XV0sMTk0NjYwOltbMjMwNzldXSwxOTQ2NjE6W1syMzAwMF1dLDE5NDY2MjpbWzIzMTQyXV0sMTk0NjYzOltbMTQwNjJdXSwxOTQ2NjQ6W1sxNDA3Nl1dLDE5NDY2NTpbWzIzMzA0XV0sMTk0NjY2OltbMjMzNThdXSwxOTQ2Njc6W1syMzM1OF1dLDE5NDY2ODpbWzEzNzY3Ml1dLDE5NDY2OTpbWzIzNDkxXV0sMTk0NjcwOltbMjM1MTJdXSwxOTQ2NzE6W1syMzUyN11dLDE5NDY3MjpbWzIzNTM5XV0sMTk0NjczOltbMTM4MDA4XV0sMTk0Njc0OltbMjM1NTFdXSwxOTQ2NzU6W1syMzU1OF1dLDE5NDY3NjpbWzI0NDAzXV0sMTk0Njc3OltbMjM1ODZdXSwxOTQ2Nzg6W1sxNDIwOV1dLDE5NDY3OTpbWzIzNjQ4XV0sMTk0NjgwOltbMjM2NjJdXSwxOTQ2ODE6W1syMzc0NF1dLDE5NDY4MjpbWzIzNjkzXV0sMTk0NjgzOltbMTM4NzI0XV0sMTk0Njg0OltbMjM4NzVdXSwxOTQ2ODU6W1sxMzg3MjZdXSwxOTQ2ODY6W1syMzkxOF1dLDE5NDY4NzpbWzIzOTE1XV0sMTk0Njg4OltbMjM5MzJdXSwxOTQ2ODk6W1syNDAzM11dLDE5NDY5MDpbWzI0MDM0XV0sMTk0NjkxOltbMTQzODNdXSwxOTQ2OTI6W1syNDA2MV1dLDE5NDY5MzpbWzI0MTA0XV0sMTk0Njk0OltbMjQxMjVdXSwxOTQ2OTU6W1syNDE2OV1dLDE5NDY5NjpbWzE0NDM0XV0sMTk0Njk3OltbMTM5NjUxXV0sMTk0Njk4OltbMTQ0NjBdXSwxOTQ2OTk6W1syNDI0MF1dLDE5NDcwMDpbWzI0MjQzXV0sMTk0NzAxOltbMjQyNDZdXSwxOTQ3MDI6W1syNDI2Nl1dLDE5NDcwMzpbWzE3Mjk0Nl1dLDE5NDcwNDpbWzI0MzE4XV0sMTk0NzA1OltbMTQwMDgxXV0sMTk0NzA2OltbMTQwMDgxXV0sMTk0NzA3OltbMzMyODFdXSwxOTQ3MDg6W1syNDM1NF1dLDE5NDcwOTpbWzI0MzU0XV0sMTk0NzEwOltbMTQ1MzVdXSwxOTQ3MTE6W1sxNDQwNTZdXSwxOTQ3MTI6W1sxNTYxMjJdXSwxOTQ3MTM6W1syNDQxOF1dLDE5NDcxNDpbWzI0NDI3XV0sMTk0NzE1OltbMTQ1NjNdXSwxOTQ3MTY6W1syNDQ3NF1dLDE5NDcxNzpbWzI0NTI1XV0sMTk0NzE4OltbMjQ1MzVdXSwxOTQ3MTk6W1syNDU2OV1dLDE5NDcyMDpbWzI0NzA1XV0sMTk0NzIxOltbMTQ2NTBdXSwxOTQ3MjI6W1sxNDYyMF1dLDE5NDcyMzpbWzI0NzI0XV0sMTk0NzI0OltbMTQxMDEyXV0sMTk0NzI1OltbMjQ3NzVdXSwxOTQ3MjY6W1syNDkwNF1dLDE5NDcyNzpbWzI0OTA4XV0sMTk0NzI4OltbMjQ5MTBdXSwxOTQ3Mjk6W1syNDkwOF1dLDE5NDczMDpbWzI0OTU0XV0sMTk0NzMxOltbMjQ5NzRdXSwxOTQ3MzI6W1syNTAxMF1dLDE5NDczMzpbWzI0OTk2XV0sMTk0NzM0OltbMjUwMDddXSwxOTQ3MzU6W1syNTA1NF1dLDE5NDczNjpbWzI1MDc0XV0sMTk0NzM3OltbMjUwNzhdXSwxOTQ3Mzg6W1syNTEwNF1dLDE5NDczOTpbWzI1MTE1XV0sMTk0NzQwOltbMjUxODFdXSwxOTQ3NDE6W1syNTI2NV1dLDE5NDc0MjpbWzI1MzAwXV0sMTk0NzQzOltbMjU0MjRdXSwxOTQ3NDQ6W1sxNDIwOTJdXSwxOTQ3NDU6W1syNTQwNV1dLDE5NDc0NjpbWzI1MzQwXV0sMTk0NzQ3OltbMjU0NDhdXSwxOTQ3NDg6W1syNTQ3NV1dLDE5NDc0OTpbWzI1NTcyXV0sMTk0NzUwOltbMTQyMzIxXV0sMTk0NzUxOltbMjU2MzRdXSwxOTQ3NTI6W1syNTU0MV1dLDE5NDc1MzpbWzI1NTEzXV0sMTk0NzU0OltbMTQ4OTRdXSwxOTQ3NTU6W1syNTcwNV1dLDE5NDc1NjpbWzI1NzI2XV0sMTk0NzU3OltbMjU3NTddXSwxOTQ3NTg6W1syNTcxOV1dLDE5NDc1OTpbWzE0OTU2XV0sMTk0NzYwOltbMjU5MzVdXSwxOTQ3NjE6W1syNTk2NF1dLDE5NDc2MjpbWzE0MzM3MF1dLDE5NDc2MzpbWzI2MDgzXV0sMTk0NzY0OltbMjYzNjBdXSwxOTQ3NjU6W1syNjE4NV1dLDE5NDc2NjpbWzE1MTI5XV0sMTk0NzY3OltbMjYyNTddXSwxOTQ3Njg6W1sxNTExMl1dLDE5NDc2OTpbWzE1MDc2XV0sMTk0NzcwOltbMjA4ODJdXSwxOTQ3NzE6W1syMDg4NV1dLDE5NDc3MjpbWzI2MzY4XV0sMTk0NzczOltbMjYyNjhdXSwxOTQ3NzQ6W1szMjk0MV1dLDE5NDc3NTpbWzE3MzY5XV0sMTk0Nzc2OltbMjYzOTFdXSwxOTQ3Nzc6W1syNjM5NV1dLDE5NDc3ODpbWzI2NDAxXV0sMTk0Nzc5OltbMjY0NjJdXSwxOTQ3ODA6W1syNjQ1MV1dLDE5NDc4MTpbWzE0NDMyM11dLDE5NDc4MjpbWzE1MTc3XV0sMTk0NzgzOltbMjY2MThdXSwxOTQ3ODQ6W1syNjUwMV1dLDE5NDc4NTpbWzI2NzA2XV0sMTk0Nzg2OltbMjY3NTddXSwxOTQ3ODc6W1sxNDQ0OTNdXSwxOTQ3ODg6W1syNjc2Nl1dLDE5NDc4OTpbWzI2NjU1XV0sMTk0NzkwOltbMjY5MDBdXSwxOTQ3OTE6W1sxNTI2MV1dLDE5NDc5MjpbWzI2OTQ2XV0sMTk0NzkzOltbMjcwNDNdXSwxOTQ3OTQ6W1syNzExNF1dLDE5NDc5NTpbWzI3MzA0XV0sMTk0Nzk2OltbMTQ1MDU5XV0sMTk0Nzk3OltbMjczNTVdXSwxOTQ3OTg6W1sxNTM4NF1dLDE5NDc5OTpbWzI3NDI1XV0sMTk0ODAwOltbMTQ1NTc1XV0sMTk0ODAxOltbMjc0NzZdXSwxOTQ4MDI6W1sxNTQzOF1dLDE5NDgwMzpbWzI3NTA2XV0sMTk0ODA0OltbMjc1NTFdXSwxOTQ4MDU6W1syNzU3OF1dLDE5NDgwNjpbWzI3NTc5XV0sMTk0ODA3OltbMTQ2MDYxXV0sMTk0ODA4OltbMTM4NTA3XV0sMTk0ODA5OltbMTQ2MTcwXV0sMTk0ODEwOltbMjc3MjZdXSwxOTQ4MTE6W1sxNDY2MjBdXSwxOTQ4MTI6W1syNzgzOV1dLDE5NDgxMzpbWzI3ODUzXV0sMTk0ODE0OltbMjc3NTFdXSwxOTQ4MTU6W1syNzkyNl1dfSxcbjYzNzQ0Ons2Mzc0NDpbWzM1OTEyXV0sNjM3NDU6W1syNjM1Nl1dLDYzNzQ2OltbMzY1NTRdXSw2Mzc0NzpbWzM2MDQwXV0sNjM3NDg6W1syODM2OV1dLDYzNzQ5OltbMjAwMThdXSw2Mzc1MDpbWzIxNDc3XV0sNjM3NTE6W1s0MDg2MF1dLDYzNzUyOltbNDA4NjBdXSw2Mzc1MzpbWzIyODY1XV0sNjM3NTQ6W1szNzMyOV1dLDYzNzU1OltbMjE4OTVdXSw2Mzc1NjpbWzIyODU2XV0sNjM3NTc6W1syNTA3OF1dLDYzNzU4OltbMzAzMTNdXSw2Mzc1OTpbWzMyNjQ1XV0sNjM3NjA6W1szNDM2N11dLDYzNzYxOltbMzQ3NDZdXSw2Mzc2MjpbWzM1MDY0XV0sNjM3NjM6W1szNzAwN11dLDYzNzY0OltbMjcxMzhdXSw2Mzc2NTpbWzI3OTMxXV0sNjM3NjY6W1syODg4OV1dLDYzNzY3OltbMjk2NjJdXSw2Mzc2ODpbWzMzODUzXV0sNjM3Njk6W1szNzIyNl1dLDYzNzcwOltbMzk0MDldXSw2Mzc3MTpbWzIwMDk4XV0sNjM3NzI6W1syMTM2NV1dLDYzNzczOltbMjczOTZdXSw2Mzc3NDpbWzI5MjExXV0sNjM3NzU6W1szNDM0OV1dLDYzNzc2OltbNDA0NzhdXSw2Mzc3NzpbWzIzODg4XV0sNjM3Nzg6W1syODY1MV1dLDYzNzc5OltbMzQyNTNdXSw2Mzc4MDpbWzM1MTcyXV0sNjM3ODE6W1syNTI4OV1dLDYzNzgyOltbMzMyNDBdXSw2Mzc4MzpbWzM0ODQ3XV0sNjM3ODQ6W1syNDI2Nl1dLDYzNzg1OltbMjYzOTFdXSw2Mzc4NjpbWzI4MDEwXV0sNjM3ODc6W1syOTQzNl1dLDYzNzg4OltbMzcwNzBdXSw2Mzc4OTpbWzIwMzU4XV0sNjM3OTA6W1syMDkxOV1dLDYzNzkxOltbMjEyMTRdXSw2Mzc5MjpbWzI1Nzk2XV0sNjM3OTM6W1syNzM0N11dLDYzNzk0OltbMjkyMDBdXSw2Mzc5NTpbWzMwNDM5XV0sNjM3OTY6W1szMjc2OV1dLDYzNzk3OltbMzQzMTBdXSw2Mzc5ODpbWzM0Mzk2XV0sNjM3OTk6W1szNjMzNV1dLDYzODAwOltbMzg3MDZdXSw2MzgwMTpbWzM5NzkxXV0sNjM4MDI6W1s0MDQ0Ml1dLDYzODAzOltbMzA4NjBdXSw2MzgwNDpbWzMxMTAzXV0sNjM4MDU6W1szMjE2MF1dLDYzODA2OltbMzM3MzddXSw2MzgwNzpbWzM3NjM2XV0sNjM4MDg6W1s0MDU3NV1dLDYzODA5OltbMzU1NDJdXSw2MzgxMDpbWzIyNzUxXV0sNjM4MTE6W1syNDMyNF1dLDYzODEyOltbMzE4NDBdXSw2MzgxMzpbWzMyODk0XV0sNjM4MTQ6W1syOTI4Ml1dLDYzODE1OltbMzA5MjJdXSw2MzgxNjpbWzM2MDM0XV0sNjM4MTc6W1szODY0N11dLDYzODE4OltbMjI3NDRdXSw2MzgxOTpbWzIzNjUwXV0sNjM4MjA6W1syNzE1NV1dLDYzODIxOltbMjgxMjJdXSw2MzgyMjpbWzI4NDMxXV0sNjM4MjM6W1szMjA0N11dLDYzODI0OltbMzIzMTFdXSw2MzgyNTpbWzM4NDc1XV0sNjM4MjY6W1syMTIwMl1dLDYzODI3OltbMzI5MDddXSw2MzgyODpbWzIwOTU2XV0sNjM4Mjk6W1syMDk0MF1dLDYzODMwOltbMzEyNjBdXSw2MzgzMTpbWzMyMTkwXV0sNjM4MzI6W1szMzc3N11dLDYzODMzOltbMzg1MTddXSw2MzgzNDpbWzM1NzEyXV0sNjM4MzU6W1syNTI5NV1dLDYzODM2OltbMjcxMzhdXSw2MzgzNzpbWzM1NTgyXV0sNjM4Mzg6W1syMDAyNV1dLDYzODM5OltbMjM1MjddXSw2Mzg0MDpbWzI0NTk0XV0sNjM4NDE6W1syOTU3NV1dLDYzODQyOltbMzAwNjRdXSw2Mzg0MzpbWzIxMjcxXV0sNjM4NDQ6W1szMDk3MV1dLDYzODQ1OltbMjA0MTVdXSw2Mzg0NjpbWzI0NDg5XV0sNjM4NDc6W1sxOTk4MV1dLDYzODQ4OltbMjc4NTJdXSw2Mzg0OTpbWzI1OTc2XV0sNjM4NTA6W1szMjAzNF1dLDYzODUxOltbMjE0NDNdXSw2Mzg1MjpbWzIyNjIyXV0sNjM4NTM6W1szMDQ2NV1dLDYzODU0OltbMzM4NjVdXSw2Mzg1NTpbWzM1NDk4XV0sNjM4NTY6W1syNzU3OF1dLDYzODU3OltbMzY3ODRdXSw2Mzg1ODpbWzI3Nzg0XV0sNjM4NTk6W1syNTM0Ml1dLDYzODYwOltbMzM1MDldXSw2Mzg2MTpbWzI1NTA0XV0sNjM4NjI6W1szMDA1M11dLDYzODYzOltbMjAxNDJdXSw2Mzg2NDpbWzIwODQxXV0sNjM4NjU6W1syMDkzN11dLDYzODY2OltbMjY3NTNdXSw2Mzg2NzpbWzMxOTc1XV0sNjM4Njg6W1szMzM5MV1dLDYzODY5OltbMzU1MzhdXSw2Mzg3MDpbWzM3MzI3XV0sNjM4NzE6W1syMTIzN11dLDYzODcyOltbMjE1NzBdXSw2Mzg3MzpbWzIyODk5XV0sNjM4NzQ6W1syNDMwMF1dLDYzODc1OltbMjYwNTNdXSw2Mzg3NjpbWzI4NjcwXV0sNjM4Nzc6W1szMTAxOF1dLDYzODc4OltbMzgzMTddXSw2Mzg3OTpbWzM5NTMwXV0sNjM4ODA6W1s0MDU5OV1dLDYzODgxOltbNDA2NTRdXSw2Mzg4MjpbWzIxMTQ3XV0sNjM4ODM6W1syNjMxMF1dLDYzODg0OltbMjc1MTFdXSw2Mzg4NTpbWzM2NzA2XV0sNjM4ODY6W1syNDE4MF1dLDYzODg3OltbMjQ5NzZdXSw2Mzg4ODpbWzI1MDg4XV0sNjM4ODk6W1syNTc1NF1dLDYzODkwOltbMjg0NTFdXSw2Mzg5MTpbWzI5MDAxXV0sNjM4OTI6W1syOTgzM11dLDYzODkzOltbMzExNzhdXSw2Mzg5NDpbWzMyMjQ0XV0sNjM4OTU6W1szMjg3OV1dLDYzODk2OltbMzY2NDZdXSw2Mzg5NzpbWzM0MDMwXV0sNjM4OTg6W1szNjg5OV1dLDYzODk5OltbMzc3MDZdXSw2MzkwMDpbWzIxMDE1XV0sNjM5MDE6W1syMTE1NV1dLDYzOTAyOltbMjE2OTNdXSw2MzkwMzpbWzI4ODcyXV0sNjM5MDQ6W1szNTAxMF1dLDYzOTA1OltbMzU0OThdXSw2MzkwNjpbWzI0MjY1XV0sNjM5MDc6W1syNDU2NV1dLDYzOTA4OltbMjU0NjddXSw2MzkwOTpbWzI3NTY2XV0sNjM5MTA6W1szMTgwNl1dLDYzOTExOltbMjk1NTddXSw2MzkxMjpbWzIwMTk2XV0sNjM5MTM6W1syMjI2NV1dLDYzOTE0OltbMjM1MjddXSw2MzkxNTpbWzIzOTk0XV0sNjM5MTY6W1syNDYwNF1dLDYzOTE3OltbMjk2MThdXSw2MzkxODpbWzI5ODAxXV0sNjM5MTk6W1szMjY2Nl1dLDYzOTIwOltbMzI4MzhdXSw2MzkyMTpbWzM3NDI4XV0sNjM5MjI6W1szODY0Nl1dLDYzOTIzOltbMzg3MjhdXSw2MzkyNDpbWzM4OTM2XV0sNjM5MjU6W1syMDM2M11dLDYzOTI2OltbMzExNTBdXSw2MzkyNzpbWzM3MzAwXV0sNjM5Mjg6W1szODU4NF1dLDYzOTI5OltbMjQ4MDFdXSw2MzkzMDpbWzIwMTAyXV0sNjM5MzE6W1syMDY5OF1dLDYzOTMyOltbMjM1MzRdXSw2MzkzMzpbWzIzNjE1XV0sNjM5MzQ6W1syNjAwOV1dLDYzOTM1OltbMjcxMzhdXSw2MzkzNjpbWzI5MTM0XV0sNjM5Mzc6W1szMDI3NF1dLDYzOTM4OltbMzQwNDRdXSw2MzkzOTpbWzM2OTg4XV0sNjM5NDA6W1s0MDg0NV1dLDYzOTQxOltbMjYyNDhdXSw2Mzk0MjpbWzM4NDQ2XV0sNjM5NDM6W1syMTEyOV1dLDYzOTQ0OltbMjY0OTFdXSw2Mzk0NTpbWzI2NjExXV0sNjM5NDY6W1syNzk2OV1dLDYzOTQ3OltbMjgzMTZdXSw2Mzk0ODpbWzI5NzA1XV0sNjM5NDk6W1szMDA0MV1dLDYzOTUwOltbMzA4MjddXSw2Mzk1MTpbWzMyMDE2XV0sNjM5NTI6W1szOTAwNl1dLDYzOTUzOltbMjA4NDVdXSw2Mzk1NDpbWzI1MTM0XV0sNjM5NTU6W1szODUyMF1dLDYzOTU2OltbMjA1MjNdXSw2Mzk1NzpbWzIzODMzXV0sNjM5NTg6W1syODEzOF1dLDYzOTU5OltbMzY2NTBdXSw2Mzk2MDpbWzI0NDU5XV0sNjM5NjE6W1syNDkwMF1dLDYzOTYyOltbMjY2NDddXSw2Mzk2MzpbWzI5NTc1XV0sNjM5NjQ6W1szODUzNF1dLDYzOTY1OltbMjEwMzNdXSw2Mzk2NjpbWzIxNTE5XV0sNjM5Njc6W1syMzY1M11dLDYzOTY4OltbMjYxMzFdXSw2Mzk2OTpbWzI2NDQ2XV0sNjM5NzA6W1syNjc5Ml1dLDYzOTcxOltbMjc4NzddXSw2Mzk3MjpbWzI5NzAyXV0sNjM5NzM6W1szMDE3OF1dLDYzOTc0OltbMzI2MzNdXSw2Mzk3NTpbWzM1MDIzXV0sNjM5NzY6W1szNTA0MV1dLDYzOTc3OltbMzczMjRdXSw2Mzk3ODpbWzM4NjI2XV0sNjM5Nzk6W1syMTMxMV1dLDYzOTgwOltbMjgzNDZdXSw2Mzk4MTpbWzIxNTMzXV0sNjM5ODI6W1syOTEzNl1dLDYzOTgzOltbMjk4NDhdXSw2Mzk4NDpbWzM0Mjk4XV0sNjM5ODU6W1szODU2M11dLDYzOTg2OltbNDAwMjNdXSw2Mzk4NzpbWzQwNjA3XV0sNjM5ODg6W1syNjUxOV1dLDYzOTg5OltbMjgxMDddXSw2Mzk5MDpbWzMzMjU2XV0sNjM5OTE6W1szMTQzNV1dLDYzOTkyOltbMzE1MjBdXSw2Mzk5MzpbWzMxODkwXV0sNjM5OTQ6W1syOTM3Nl1dLDYzOTk1OltbMjg4MjVdXSw2Mzk5NjpbWzM1NjcyXV0sNjM5OTc6W1syMDE2MF1dLDYzOTk4OltbMzM1OTBdXSw2Mzk5OTpbWzIxMDUwXV0sMTk0ODE2OltbMjc5NjZdXSwxOTQ4MTc6W1syODAyM11dLDE5NDgxODpbWzI3OTY5XV0sMTk0ODE5OltbMjgwMDldXSwxOTQ4MjA6W1syODAyNF1dLDE5NDgyMTpbWzI4MDM3XV0sMTk0ODIyOltbMTQ2NzE4XV0sMTk0ODIzOltbMjc5NTZdXSwxOTQ4MjQ6W1syODIwN11dLDE5NDgyNTpbWzI4MjcwXV0sMTk0ODI2OltbMTU2NjddXSwxOTQ4Mjc6W1syODM2M11dLDE5NDgyODpbWzI4MzU5XV0sMTk0ODI5OltbMTQ3MTUzXV0sMTk0ODMwOltbMjgxNTNdXSwxOTQ4MzE6W1syODUyNl1dLDE5NDgzMjpbWzE0NzI5NF1dLDE5NDgzMzpbWzE0NzM0Ml1dLDE5NDgzNDpbWzI4NjE0XV0sMTk0ODM1OltbMjg3MjldXSwxOTQ4MzY6W1syODcwMl1dLDE5NDgzNzpbWzI4Njk5XV0sMTk0ODM4OltbMTU3NjZdXSwxOTQ4Mzk6W1syODc0Nl1dLDE5NDg0MDpbWzI4Nzk3XV0sMTk0ODQxOltbMjg3OTFdXSwxOTQ4NDI6W1syODg0NV1dLDE5NDg0MzpbWzEzMjM4OV1dLDE5NDg0NDpbWzI4OTk3XV0sMTk0ODQ1OltbMTQ4MDY3XV0sMTk0ODQ2OltbMjkwODRdXSwxOTQ4NDc6W1sxNDgzOTVdXSwxOTQ4NDg6W1syOTIyNF1dLDE5NDg0OTpbWzI5MjM3XV0sMTk0ODUwOltbMjkyNjRdXSwxOTQ4NTE6W1sxNDkwMDBdXSwxOTQ4NTI6W1syOTMxMl1dLDE5NDg1MzpbWzI5MzMzXV0sMTk0ODU0OltbMTQ5MzAxXV0sMTk0ODU1OltbMTQ5NTI0XV0sMTk0ODU2OltbMjk1NjJdXSwxOTQ4NTc6W1syOTU3OV1dLDE5NDg1ODpbWzE2MDQ0XV0sMTk0ODU5OltbMjk2MDVdXSwxOTQ4NjA6W1sxNjA1Nl1dLDE5NDg2MTpbWzE2MDU2XV0sMTk0ODYyOltbMjk3NjddXSwxOTQ4NjM6W1syOTc4OF1dLDE5NDg2NDpbWzI5ODA5XV0sMTk0ODY1OltbMjk4MjldXSwxOTQ4NjY6W1syOTg5OF1dLDE5NDg2NzpbWzE2MTU1XV0sMTk0ODY4OltbMjk5ODhdXSwxOTQ4Njk6W1sxNTA1ODJdXSwxOTQ4NzA6W1szMDAxNF1dLDE5NDg3MTpbWzE1MDY3NF1dLDE5NDg3MjpbWzMwMDY0XV0sMTk0ODczOltbMTM5Njc5XV0sMTk0ODc0OltbMzAyMjRdXSwxOTQ4NzU6W1sxNTE0NTddXSwxOTQ4NzY6W1sxNTE0ODBdXSwxOTQ4Nzc6W1sxNTE2MjBdXSwxOTQ4Nzg6W1sxNjM4MF1dLDE5NDg3OTpbWzE2MzkyXV0sMTk0ODgwOltbMzA0NTJdXSwxOTQ4ODE6W1sxNTE3OTVdXSwxOTQ4ODI6W1sxNTE3OTRdXSwxOTQ4ODM6W1sxNTE4MzNdXSwxOTQ4ODQ6W1sxNTE4NTldXSwxOTQ4ODU6W1szMDQ5NF1dLDE5NDg4NjpbWzMwNDk1XV0sMTk0ODg3OltbMzA0OTVdXSwxOTQ4ODg6W1szMDUzOF1dLDE5NDg4OTpbWzE2NDQxXV0sMTk0ODkwOltbMzA2MDNdXSwxOTQ4OTE6W1sxNjQ1NF1dLDE5NDg5MjpbWzE2NTM0XV0sMTk0ODkzOltbMTUyNjA1XV0sMTk0ODk0OltbMzA3OThdXSwxOTQ4OTU6W1szMDg2MF1dLDE5NDg5NjpbWzMwOTI0XV0sMTk0ODk3OltbMTY2MTFdXSwxOTQ4OTg6W1sxNTMxMjZdXSwxOTQ4OTk6W1szMTA2Ml1dLDE5NDkwMDpbWzE1MzI0Ml1dLDE5NDkwMTpbWzE1MzI4NV1dLDE5NDkwMjpbWzMxMTE5XV0sMTk0OTAzOltbMzEyMTFdXSwxOTQ5MDQ6W1sxNjY4N11dLDE5NDkwNTpbWzMxMjk2XV0sMTk0OTA2OltbMzEzMDZdXSwxOTQ5MDc6W1szMTMxMV1dLDE5NDkwODpbWzE1Mzk4MF1dLDE5NDkwOTpbWzE1NDI3OV1dLDE5NDkxMDpbWzE1NDI3OV1dLDE5NDkxMTpbWzMxNDcwXV0sMTk0OTEyOltbMTY4OThdXSwxOTQ5MTM6W1sxNTQ1MzldXSwxOTQ5MTQ6W1szMTY4Nl1dLDE5NDkxNTpbWzMxNjg5XV0sMTk0OTE2OltbMTY5MzVdXSwxOTQ5MTc6W1sxNTQ3NTJdXSwxOTQ5MTg6W1szMTk1NF1dLDE5NDkxOTpbWzE3MDU2XV0sMTk0OTIwOltbMzE5NzZdXSwxOTQ5MjE6W1szMTk3MV1dLDE5NDkyMjpbWzMyMDAwXV0sMTk0OTIzOltbMTU1NTI2XV0sMTk0OTI0OltbMzIwOTldXSwxOTQ5MjU6W1sxNzE1M11dLDE5NDkyNjpbWzMyMTk5XV0sMTk0OTI3OltbMzIyNThdXSwxOTQ5Mjg6W1szMjMyNV1dLDE5NDkyOTpbWzE3MjA0XV0sMTk0OTMwOltbMTU2MjAwXV0sMTk0OTMxOltbMTU2MjMxXV0sMTk0OTMyOltbMTcyNDFdXSwxOTQ5MzM6W1sxNTYzNzddXSwxOTQ5MzQ6W1szMjYzNF1dLDE5NDkzNTpbWzE1NjQ3OF1dLDE5NDkzNjpbWzMyNjYxXV0sMTk0OTM3OltbMzI3NjJdXSwxOTQ5Mzg6W1szMjc3M11dLDE5NDkzOTpbWzE1Njg5MF1dLDE5NDk0MDpbWzE1Njk2M11dLDE5NDk0MTpbWzMyODY0XV0sMTk0OTQyOltbMTU3MDk2XV0sMTk0OTQzOltbMzI4ODBdXSwxOTQ5NDQ6W1sxNDQyMjNdXSwxOTQ5NDU6W1sxNzM2NV1dLDE5NDk0NjpbWzMyOTQ2XV0sMTk0OTQ3OltbMzMwMjddXSwxOTQ5NDg6W1sxNzQxOV1dLDE5NDk0OTpbWzMzMDg2XV0sMTk0OTUwOltbMjMyMjFdXSwxOTQ5NTE6W1sxNTc2MDddXSwxOTQ5NTI6W1sxNTc2MjFdXSwxOTQ5NTM6W1sxNDQyNzVdXSwxOTQ5NTQ6W1sxNDQyODRdXSwxOTQ5NTU6W1szMzI4MV1dLDE5NDk1NjpbWzMzMjg0XV0sMTk0OTU3OltbMzY3NjZdXSwxOTQ5NTg6W1sxNzUxNV1dLDE5NDk1OTpbWzMzNDI1XV0sMTk0OTYwOltbMzM0MTldXSwxOTQ5NjE6W1szMzQzN11dLDE5NDk2MjpbWzIxMTcxXV0sMTk0OTYzOltbMzM0NTddXSwxOTQ5NjQ6W1szMzQ1OV1dLDE5NDk2NTpbWzMzNDY5XV0sMTk0OTY2OltbMzM1MTBdXSwxOTQ5Njc6W1sxNTg1MjRdXSwxOTQ5Njg6W1szMzUwOV1dLDE5NDk2OTpbWzMzNTY1XV0sMTk0OTcwOltbMzM2MzVdXSwxOTQ5NzE6W1szMzcwOV1dLDE5NDk3MjpbWzMzNTcxXV0sMTk0OTczOltbMzM3MjVdXSwxOTQ5NzQ6W1szMzc2N11dLDE5NDk3NTpbWzMzODc5XV0sMTk0OTc2OltbMzM2MTldXSwxOTQ5Nzc6W1szMzczOF1dLDE5NDk3ODpbWzMzNzQwXV0sMTk0OTc5OltbMzM3NTZdXSwxOTQ5ODA6W1sxNTg3NzRdXSwxOTQ5ODE6W1sxNTkwODNdXSwxOTQ5ODI6W1sxNTg5MzNdXSwxOTQ5ODM6W1sxNzcwN11dLDE5NDk4NDpbWzM0MDMzXV0sMTk0OTg1OltbMzQwMzVdXSwxOTQ5ODY6W1szNDA3MF1dLDE5NDk4NzpbWzE2MDcxNF1dLDE5NDk4ODpbWzM0MTQ4XV0sMTk0OTg5OltbMTU5NTMyXV0sMTk0OTkwOltbMTc3NTddXSwxOTQ5OTE6W1sxNzc2MV1dLDE5NDk5MjpbWzE1OTY2NV1dLDE5NDk5MzpbWzE1OTk1NF1dLDE5NDk5NDpbWzE3NzcxXV0sMTk0OTk1OltbMzQzODRdXSwxOTQ5OTY6W1szNDM5Nl1dLDE5NDk5NzpbWzM0NDA3XV0sMTk0OTk4OltbMzQ0MDldXSwxOTQ5OTk6W1szNDQ3M11dLDE5NTAwMDpbWzM0NDQwXV0sMTk1MDAxOltbMzQ1NzRdXSwxOTUwMDI6W1szNDUzMF1dLDE5NTAwMzpbWzM0NjgxXV0sMTk1MDA0OltbMzQ2MDBdXSwxOTUwMDU6W1szNDY2N11dLDE5NTAwNjpbWzM0Njk0XV0sMTk1MDA3OltbMTc4NzldXSwxOTUwMDg6W1szNDc4NV1dLDE5NTAwOTpbWzM0ODE3XV0sMTk1MDEwOltbMTc5MTNdXSwxOTUwMTE6W1szNDkxMl1dLDE5NTAxMjpbWzM0OTE1XV0sMTk1MDEzOltbMTYxMzgzXV0sMTk1MDE0OltbMzUwMzFdXSwxOTUwMTU6W1szNTAzOF1dLDE5NTAxNjpbWzE3OTczXV0sMTk1MDE3OltbMzUwNjZdXSwxOTUwMTg6W1sxMzQ5OV1dLDE5NTAxOTpbWzE2MTk2Nl1dLDE5NTAyMDpbWzE2MjE1MF1dLDE5NTAyMTpbWzE4MTEwXV0sMTk1MDIyOltbMTgxMTldXSwxOTUwMjM6W1szNTQ4OF1dLDE5NTAyNDpbWzM1NTY1XV0sMTk1MDI1OltbMzU3MjJdXSwxOTUwMjY6W1szNTkyNV1dLDE5NTAyNzpbWzE2Mjk4NF1dLDE5NTAyODpbWzM2MDExXV0sMTk1MDI5OltbMzYwMzNdXSwxOTUwMzA6W1szNjEyM11dLDE5NTAzMTpbWzM2MjE1XV0sMTk1MDMyOltbMTYzNjMxXV0sMTk1MDMzOltbMTMzMTI0XV0sMTk1MDM0OltbMzYyOTldXSwxOTUwMzU6W1szNjI4NF1dLDE5NTAzNjpbWzM2MzM2XV0sMTk1MDM3OltbMTMzMzQyXV0sMTk1MDM4OltbMzY1NjRdXSwxOTUwMzk6W1szNjY2NF1dLDE5NTA0MDpbWzE2NTMzMF1dLDE5NTA0MTpbWzE2NTM1N11dLDE5NTA0MjpbWzM3MDEyXV0sMTk1MDQzOltbMzcxMDVdXSwxOTUwNDQ6W1szNzEzN11dLDE5NTA0NTpbWzE2NTY3OF1dLDE5NTA0NjpbWzM3MTQ3XV0sMTk1MDQ3OltbMzc0MzJdXSwxOTUwNDg6W1szNzU5MV1dLDE5NTA0OTpbWzM3NTkyXV0sMTk1MDUwOltbMzc1MDBdXSwxOTUwNTE6W1szNzg4MV1dLDE5NTA1MjpbWzM3OTA5XV0sMTk1MDUzOltbMTY2OTA2XV0sMTk1MDU0OltbMzgyODNdXSwxOTUwNTU6W1sxODgzN11dLDE5NTA1NjpbWzM4MzI3XV0sMTk1MDU3OltbMTY3Mjg3XV0sMTk1MDU4OltbMTg5MThdXSwxOTUwNTk6W1szODU5NV1dLDE5NTA2MDpbWzIzOTg2XV0sMTk1MDYxOltbMzg2OTFdXSwxOTUwNjI6W1sxNjgyNjFdXSwxOTUwNjM6W1sxNjg0NzRdXSwxOTUwNjQ6W1sxOTA1NF1dLDE5NTA2NTpbWzE5MDYyXV0sMTk1MDY2OltbMzg4ODBdXSwxOTUwNjc6W1sxNjg5NzBdXSwxOTUwNjg6W1sxOTEyMl1dLDE5NTA2OTpbWzE2OTExMF1dLDE5NTA3MDpbWzM4OTIzXV0sMTk1MDcxOltbMzg5MjNdXX0sXG42NDAwMDp7NjQwMDA6W1syMDk5OV1dLDY0MDAxOltbMjQyMzBdXSw2NDAwMjpbWzI1Mjk5XV0sNjQwMDM6W1szMTk1OF1dLDY0MDA0OltbMjM0MjldXSw2NDAwNTpbWzI3OTM0XV0sNjQwMDY6W1syNjI5Ml1dLDY0MDA3OltbMzY2NjddXSw2NDAwODpbWzM0ODkyXV0sNjQwMDk6W1szODQ3N11dLDY0MDEwOltbMzUyMTFdXSw2NDAxMTpbWzI0Mjc1XV0sNjQwMTI6W1syMDgwMF1dLDY0MDEzOltbMjE5NTJdXSw2NDAxNjpbWzIyNjE4XV0sNjQwMTg6W1syNjIyOF1dLDY0MDIxOltbMjA5NThdXSw2NDAyMjpbWzI5NDgyXV0sNjQwMjM6W1szMDQxMF1dLDY0MDI0OltbMzEwMzZdXSw2NDAyNTpbWzMxMDcwXV0sNjQwMjY6W1szMTA3N11dLDY0MDI3OltbMzExMTldXSw2NDAyODpbWzM4NzQyXV0sNjQwMjk6W1szMTkzNF1dLDY0MDMwOltbMzI3MDFdXSw2NDAzMjpbWzM0MzIyXV0sNjQwMzQ6W1szNTU3Nl1dLDY0MDM3OltbMzY5MjBdXSw2NDAzODpbWzM3MTE3XV0sNjQwNDI6W1szOTE1MV1dLDY0MDQzOltbMzkxNjRdXSw2NDA0NDpbWzM5MjA4XV0sNjQwNDU6W1s0MDM3Ml1dLDY0MDQ2OltbMzcwODZdXSw2NDA0NzpbWzM4NTgzXV0sNjQwNDg6W1syMDM5OF1dLDY0MDQ5OltbMjA3MTFdXSw2NDA1MDpbWzIwODEzXV0sNjQwNTE6W1syMTE5M11dLDY0MDUyOltbMjEyMjBdXSw2NDA1MzpbWzIxMzI5XV0sNjQwNTQ6W1syMTkxN11dLDY0MDU1OltbMjIwMjJdXSw2NDA1NjpbWzIyMTIwXV0sNjQwNTc6W1syMjU5Ml1dLDY0MDU4OltbMjI2OTZdXSw2NDA1OTpbWzIzNjUyXV0sNjQwNjA6W1syMzY2Ml1dLDY0MDYxOltbMjQ3MjRdXSw2NDA2MjpbWzI0OTM2XV0sNjQwNjM6W1syNDk3NF1dLDY0MDY0OltbMjUwNzRdXSw2NDA2NTpbWzI1OTM1XV0sNjQwNjY6W1syNjA4Ml1dLDY0MDY3OltbMjYyNTddXSw2NDA2ODpbWzI2NzU3XV0sNjQwNjk6W1syODAyM11dLDY0MDcwOltbMjgxODZdXSw2NDA3MTpbWzI4NDUwXV0sNjQwNzI6W1syOTAzOF1dLDY0MDczOltbMjkyMjddXSw2NDA3NDpbWzI5NzMwXV0sNjQwNzU6W1szMDg2NV1dLDY0MDc2OltbMzEwMzhdXSw2NDA3NzpbWzMxMDQ5XV0sNjQwNzg6W1szMTA0OF1dLDY0MDc5OltbMzEwNTZdXSw2NDA4MDpbWzMxMDYyXV0sNjQwODE6W1szMTA2OV1dLDY0MDgyOltbMzExMTddXSw2NDA4MzpbWzMxMTE4XV0sNjQwODQ6W1szMTI5Nl1dLDY0MDg1OltbMzEzNjFdXSw2NDA4NjpbWzMxNjgwXV0sNjQwODc6W1szMjI0NF1dLDY0MDg4OltbMzIyNjVdXSw2NDA4OTpbWzMyMzIxXV0sNjQwOTA6W1szMjYyNl1dLDY0MDkxOltbMzI3NzNdXSw2NDA5MjpbWzMzMjYxXV0sNjQwOTM6W1szMzQwMV1dLDY0MDk0OltbMzM0MDFdXSw2NDA5NTpbWzMzODc5XV0sNjQwOTY6W1szNTA4OF1dLDY0MDk3OltbMzUyMjJdXSw2NDA5ODpbWzM1NTg1XV0sNjQwOTk6W1szNTY0MV1dLDY0MTAwOltbMzYwNTFdXSw2NDEwMTpbWzM2MTA0XV0sNjQxMDI6W1szNjc5MF1dLDY0MTAzOltbMzY5MjBdXSw2NDEwNDpbWzM4NjI3XV0sNjQxMDU6W1szODkxMV1dLDY0MTA2OltbMzg5NzFdXSw2NDEwNzpbWzI0NjkzXV0sNjQxMDg6W1sxNDgyMDZdXSw2NDEwOTpbWzMzMzA0XV0sNjQxMTI6W1syMDAwNl1dLDY0MTEzOltbMjA5MTddXSw2NDExNDpbWzIwODQwXV0sNjQxMTU6W1syMDM1Ml1dLDY0MTE2OltbMjA4MDVdXSw2NDExNzpbWzIwODY0XV0sNjQxMTg6W1syMTE5MV1dLDY0MTE5OltbMjEyNDJdXSw2NDEyMDpbWzIxOTE3XV0sNjQxMjE6W1syMTg0NV1dLDY0MTIyOltbMjE5MTNdXSw2NDEyMzpbWzIxOTg2XV0sNjQxMjQ6W1syMjYxOF1dLDY0MTI1OltbMjI3MDddXSw2NDEyNjpbWzIyODUyXV0sNjQxMjc6W1syMjg2OF1dLDY0MTI4OltbMjMxMzhdXSw2NDEyOTpbWzIzMzM2XV0sNjQxMzA6W1syNDI3NF1dLDY0MTMxOltbMjQyODFdXSw2NDEzMjpbWzI0NDI1XV0sNjQxMzM6W1syNDQ5M11dLDY0MTM0OltbMjQ3OTJdXSw2NDEzNTpbWzI0OTEwXV0sNjQxMzY6W1syNDg0MF1dLDY0MTM3OltbMjQ5NzRdXSw2NDEzODpbWzI0OTI4XV0sNjQxMzk6W1syNTA3NF1dLDY0MTQwOltbMjUxNDBdXSw2NDE0MTpbWzI1NTQwXV0sNjQxNDI6W1syNTYyOF1dLDY0MTQzOltbMjU2ODJdXSw2NDE0NDpbWzI1OTQyXV0sNjQxNDU6W1syNjIyOF1dLDY0MTQ2OltbMjYzOTFdXSw2NDE0NzpbWzI2Mzk1XV0sNjQxNDg6W1syNjQ1NF1dLDY0MTQ5OltbMjc1MTNdXSw2NDE1MDpbWzI3NTc4XV0sNjQxNTE6W1syNzk2OV1dLDY0MTUyOltbMjgzNzldXSw2NDE1MzpbWzI4MzYzXV0sNjQxNTQ6W1syODQ1MF1dLDY0MTU1OltbMjg3MDJdXSw2NDE1NjpbWzI5MDM4XV0sNjQxNTc6W1szMDYzMV1dLDY0MTU4OltbMjkyMzddXSw2NDE1OTpbWzI5MzU5XV0sNjQxNjA6W1syOTQ4Ml1dLDY0MTYxOltbMjk4MDldXSw2NDE2MjpbWzI5OTU4XV0sNjQxNjM6W1szMDAxMV1dLDY0MTY0OltbMzAyMzddXSw2NDE2NTpbWzMwMjM5XV0sNjQxNjY6W1szMDQxMF1dLDY0MTY3OltbMzA0MjddXSw2NDE2ODpbWzMwNDUyXV0sNjQxNjk6W1szMDUzOF1dLDY0MTcwOltbMzA1MjhdXSw2NDE3MTpbWzMwOTI0XV0sNjQxNzI6W1szMTQwOV1dLDY0MTczOltbMzE2ODBdXSw2NDE3NDpbWzMxODY3XV0sNjQxNzU6W1szMjA5MV1dLDY0MTc2OltbMzIyNDRdXSw2NDE3NzpbWzMyNTc0XV0sNjQxNzg6W1szMjc3M11dLDY0MTc5OltbMzM2MThdXSw2NDE4MDpbWzMzNzc1XV0sNjQxODE6W1szNDY4MV1dLDY0MTgyOltbMzUxMzddXSw2NDE4MzpbWzM1MjA2XV0sNjQxODQ6W1szNTIyMl1dLDY0MTg1OltbMzU1MTldXSw2NDE4NjpbWzM1NTc2XV0sNjQxODc6W1szNTUzMV1dLDY0MTg4OltbMzU1ODVdXSw2NDE4OTpbWzM1NTgyXV0sNjQxOTA6W1szNTU2NV1dLDY0MTkxOltbMzU2NDFdXSw2NDE5MjpbWzM1NzIyXV0sNjQxOTM6W1szNjEwNF1dLDY0MTk0OltbMzY2NjRdXSw2NDE5NTpbWzM2OTc4XV0sNjQxOTY6W1szNzI3M11dLDY0MTk3OltbMzc0OTRdXSw2NDE5ODpbWzM4NTI0XV0sNjQxOTk6W1szODYyN11dLDY0MjAwOltbMzg3NDJdXSw2NDIwMTpbWzM4ODc1XV0sNjQyMDI6W1szODkxMV1dLDY0MjAzOltbMzg5MjNdXSw2NDIwNDpbWzM4OTcxXV0sNjQyMDU6W1szOTY5OF1dLDY0MjA2OltbNDA4NjBdXSw2NDIwNzpbWzE0MTM4Nl1dLDY0MjA4OltbMTQxMzgwXV0sNjQyMDk6W1sxNDQzNDFdXSw2NDIxMDpbWzE1MjYxXV0sNjQyMTE6W1sxNjQwOF1dLDY0MjEyOltbMTY0NDFdXSw2NDIxMzpbWzE1MjEzN11dLDY0MjE0OltbMTU0ODMyXV0sNjQyMTU6W1sxNjM1MzldXSw2NDIxNjpbWzQwNzcxXV0sNjQyMTc6W1s0MDg0Nl1dLDE5NTA3MjpbWzM4OTUzXV0sMTk1MDczOltbMTY5Mzk4XV0sMTk1MDc0OltbMzkxMzhdXSwxOTUwNzU6W1sxOTI1MV1dLDE5NTA3NjpbWzM5MjA5XV0sMTk1MDc3OltbMzkzMzVdXSwxOTUwNzg6W1szOTM2Ml1dLDE5NTA3OTpbWzM5NDIyXV0sMTk1MDgwOltbMTk0MDZdXSwxOTUwODE6W1sxNzA4MDBdXSwxOTUwODI6W1szOTY5OF1dLDE5NTA4MzpbWzQwMDAwXV0sMTk1MDg0OltbNDAxODldXSwxOTUwODU6W1sxOTY2Ml1dLDE5NTA4NjpbWzE5NjkzXV0sMTk1MDg3OltbNDAyOTVdXSwxOTUwODg6W1sxNzIyMzhdXSwxOTUwODk6W1sxOTcwNF1dLDE5NTA5MDpbWzE3MjI5M11dLDE5NTA5MTpbWzE3MjU1OF1dLDE5NTA5MjpbWzE3MjY4OV1dLDE5NTA5MzpbWzQwNjM1XV0sMTk1MDk0OltbMTk3OThdXSwxOTUwOTU6W1s0MDY5N11dLDE5NTA5NjpbWzQwNzAyXV0sMTk1MDk3OltbNDA3MDldXSwxOTUwOTg6W1s0MDcxOV1dLDE5NTA5OTpbWzQwNzI2XV0sMTk1MTAwOltbNDA3NjNdXSwxOTUxMDE6W1sxNzM1NjhdXX0sXG42NDI1Njp7NjQyNTY6W1sxMDIsMTAyXSwyNTZdLDY0MjU3OltbMTAyLDEwNV0sMjU2XSw2NDI1ODpbWzEwMiwxMDhdLDI1Nl0sNjQyNTk6W1sxMDIsMTAyLDEwNV0sMjU2XSw2NDI2MDpbWzEwMiwxMDIsMTA4XSwyNTZdLDY0MjYxOltbMzgzLDExNl0sMjU2XSw2NDI2MjpbWzExNSwxMTZdLDI1Nl0sNjQyNzU6W1sxMzk2LDEzOThdLDI1Nl0sNjQyNzY6W1sxMzk2LDEzODFdLDI1Nl0sNjQyNzc6W1sxMzk2LDEzODddLDI1Nl0sNjQyNzg6W1sxNDA2LDEzOThdLDI1Nl0sNjQyNzk6W1sxMzk2LDEzODldLDI1Nl0sNjQyODU6W1sxNDk3LDE0NjBdLDUxMl0sNjQyODY6WywyNl0sNjQyODc6W1sxNTIyLDE0NjNdLDUxMl0sNjQyODg6W1sxNTA2XSwyNTZdLDY0Mjg5OltbMTQ4OF0sMjU2XSw2NDI5MDpbWzE0OTFdLDI1Nl0sNjQyOTE6W1sxNDkyXSwyNTZdLDY0MjkyOltbMTQ5OV0sMjU2XSw2NDI5MzpbWzE1MDBdLDI1Nl0sNjQyOTQ6W1sxNTAxXSwyNTZdLDY0Mjk1OltbMTUxMl0sMjU2XSw2NDI5NjpbWzE1MTRdLDI1Nl0sNjQyOTc6W1s0M10sMjU2XSw2NDI5ODpbWzE1MTMsMTQ3M10sNTEyXSw2NDI5OTpbWzE1MTMsMTQ3NF0sNTEyXSw2NDMwMDpbWzY0MzI5LDE0NzNdLDUxMl0sNjQzMDE6W1s2NDMyOSwxNDc0XSw1MTJdLDY0MzAyOltbMTQ4OCwxNDYzXSw1MTJdLDY0MzAzOltbMTQ4OCwxNDY0XSw1MTJdLDY0MzA0OltbMTQ4OCwxNDY4XSw1MTJdLDY0MzA1OltbMTQ4OSwxNDY4XSw1MTJdLDY0MzA2OltbMTQ5MCwxNDY4XSw1MTJdLDY0MzA3OltbMTQ5MSwxNDY4XSw1MTJdLDY0MzA4OltbMTQ5MiwxNDY4XSw1MTJdLDY0MzA5OltbMTQ5MywxNDY4XSw1MTJdLDY0MzEwOltbMTQ5NCwxNDY4XSw1MTJdLDY0MzEyOltbMTQ5NiwxNDY4XSw1MTJdLDY0MzEzOltbMTQ5NywxNDY4XSw1MTJdLDY0MzE0OltbMTQ5OCwxNDY4XSw1MTJdLDY0MzE1OltbMTQ5OSwxNDY4XSw1MTJdLDY0MzE2OltbMTUwMCwxNDY4XSw1MTJdLDY0MzE4OltbMTUwMiwxNDY4XSw1MTJdLDY0MzIwOltbMTUwNCwxNDY4XSw1MTJdLDY0MzIxOltbMTUwNSwxNDY4XSw1MTJdLDY0MzIzOltbMTUwNywxNDY4XSw1MTJdLDY0MzI0OltbMTUwOCwxNDY4XSw1MTJdLDY0MzI2OltbMTUxMCwxNDY4XSw1MTJdLDY0MzI3OltbMTUxMSwxNDY4XSw1MTJdLDY0MzI4OltbMTUxMiwxNDY4XSw1MTJdLDY0MzI5OltbMTUxMywxNDY4XSw1MTJdLDY0MzMwOltbMTUxNCwxNDY4XSw1MTJdLDY0MzMxOltbMTQ5MywxNDY1XSw1MTJdLDY0MzMyOltbMTQ4OSwxNDcxXSw1MTJdLDY0MzMzOltbMTQ5OSwxNDcxXSw1MTJdLDY0MzM0OltbMTUwOCwxNDcxXSw1MTJdLDY0MzM1OltbMTQ4OCwxNTAwXSwyNTZdLDY0MzM2OltbMTY0OV0sMjU2XSw2NDMzNzpbWzE2NDldLDI1Nl0sNjQzMzg6W1sxNjU5XSwyNTZdLDY0MzM5OltbMTY1OV0sMjU2XSw2NDM0MDpbWzE2NTldLDI1Nl0sNjQzNDE6W1sxNjU5XSwyNTZdLDY0MzQyOltbMTY2Ml0sMjU2XSw2NDM0MzpbWzE2NjJdLDI1Nl0sNjQzNDQ6W1sxNjYyXSwyNTZdLDY0MzQ1OltbMTY2Ml0sMjU2XSw2NDM0NjpbWzE2NjRdLDI1Nl0sNjQzNDc6W1sxNjY0XSwyNTZdLDY0MzQ4OltbMTY2NF0sMjU2XSw2NDM0OTpbWzE2NjRdLDI1Nl0sNjQzNTA6W1sxNjU4XSwyNTZdLDY0MzUxOltbMTY1OF0sMjU2XSw2NDM1MjpbWzE2NThdLDI1Nl0sNjQzNTM6W1sxNjU4XSwyNTZdLDY0MzU0OltbMTY2M10sMjU2XSw2NDM1NTpbWzE2NjNdLDI1Nl0sNjQzNTY6W1sxNjYzXSwyNTZdLDY0MzU3OltbMTY2M10sMjU2XSw2NDM1ODpbWzE2NTddLDI1Nl0sNjQzNTk6W1sxNjU3XSwyNTZdLDY0MzYwOltbMTY1N10sMjU2XSw2NDM2MTpbWzE2NTddLDI1Nl0sNjQzNjI6W1sxNzAwXSwyNTZdLDY0MzYzOltbMTcwMF0sMjU2XSw2NDM2NDpbWzE3MDBdLDI1Nl0sNjQzNjU6W1sxNzAwXSwyNTZdLDY0MzY2OltbMTcwMl0sMjU2XSw2NDM2NzpbWzE3MDJdLDI1Nl0sNjQzNjg6W1sxNzAyXSwyNTZdLDY0MzY5OltbMTcwMl0sMjU2XSw2NDM3MDpbWzE2NjhdLDI1Nl0sNjQzNzE6W1sxNjY4XSwyNTZdLDY0MzcyOltbMTY2OF0sMjU2XSw2NDM3MzpbWzE2NjhdLDI1Nl0sNjQzNzQ6W1sxNjY3XSwyNTZdLDY0Mzc1OltbMTY2N10sMjU2XSw2NDM3NjpbWzE2NjddLDI1Nl0sNjQzNzc6W1sxNjY3XSwyNTZdLDY0Mzc4OltbMTY3MF0sMjU2XSw2NDM3OTpbWzE2NzBdLDI1Nl0sNjQzODA6W1sxNjcwXSwyNTZdLDY0MzgxOltbMTY3MF0sMjU2XSw2NDM4MjpbWzE2NzFdLDI1Nl0sNjQzODM6W1sxNjcxXSwyNTZdLDY0Mzg0OltbMTY3MV0sMjU2XSw2NDM4NTpbWzE2NzFdLDI1Nl0sNjQzODY6W1sxNjc3XSwyNTZdLDY0Mzg3OltbMTY3N10sMjU2XSw2NDM4ODpbWzE2NzZdLDI1Nl0sNjQzODk6W1sxNjc2XSwyNTZdLDY0MzkwOltbMTY3OF0sMjU2XSw2NDM5MTpbWzE2NzhdLDI1Nl0sNjQzOTI6W1sxNjcyXSwyNTZdLDY0MzkzOltbMTY3Ml0sMjU2XSw2NDM5NDpbWzE2ODhdLDI1Nl0sNjQzOTU6W1sxNjg4XSwyNTZdLDY0Mzk2OltbMTY4MV0sMjU2XSw2NDM5NzpbWzE2ODFdLDI1Nl0sNjQzOTg6W1sxNzA1XSwyNTZdLDY0Mzk5OltbMTcwNV0sMjU2XSw2NDQwMDpbWzE3MDVdLDI1Nl0sNjQ0MDE6W1sxNzA1XSwyNTZdLDY0NDAyOltbMTcxMV0sMjU2XSw2NDQwMzpbWzE3MTFdLDI1Nl0sNjQ0MDQ6W1sxNzExXSwyNTZdLDY0NDA1OltbMTcxMV0sMjU2XSw2NDQwNjpbWzE3MTVdLDI1Nl0sNjQ0MDc6W1sxNzE1XSwyNTZdLDY0NDA4OltbMTcxNV0sMjU2XSw2NDQwOTpbWzE3MTVdLDI1Nl0sNjQ0MTA6W1sxNzEzXSwyNTZdLDY0NDExOltbMTcxM10sMjU2XSw2NDQxMjpbWzE3MTNdLDI1Nl0sNjQ0MTM6W1sxNzEzXSwyNTZdLDY0NDE0OltbMTcyMl0sMjU2XSw2NDQxNTpbWzE3MjJdLDI1Nl0sNjQ0MTY6W1sxNzIzXSwyNTZdLDY0NDE3OltbMTcyM10sMjU2XSw2NDQxODpbWzE3MjNdLDI1Nl0sNjQ0MTk6W1sxNzIzXSwyNTZdLDY0NDIwOltbMTcyOF0sMjU2XSw2NDQyMTpbWzE3MjhdLDI1Nl0sNjQ0MjI6W1sxNzI5XSwyNTZdLDY0NDIzOltbMTcyOV0sMjU2XSw2NDQyNDpbWzE3MjldLDI1Nl0sNjQ0MjU6W1sxNzI5XSwyNTZdLDY0NDI2OltbMTcyNl0sMjU2XSw2NDQyNzpbWzE3MjZdLDI1Nl0sNjQ0Mjg6W1sxNzI2XSwyNTZdLDY0NDI5OltbMTcyNl0sMjU2XSw2NDQzMDpbWzE3NDZdLDI1Nl0sNjQ0MzE6W1sxNzQ2XSwyNTZdLDY0NDMyOltbMTc0N10sMjU2XSw2NDQzMzpbWzE3NDddLDI1Nl0sNjQ0Njc6W1sxNzA5XSwyNTZdLDY0NDY4OltbMTcwOV0sMjU2XSw2NDQ2OTpbWzE3MDldLDI1Nl0sNjQ0NzA6W1sxNzA5XSwyNTZdLDY0NDcxOltbMTczNV0sMjU2XSw2NDQ3MjpbWzE3MzVdLDI1Nl0sNjQ0NzM6W1sxNzM0XSwyNTZdLDY0NDc0OltbMTczNF0sMjU2XSw2NDQ3NTpbWzE3MzZdLDI1Nl0sNjQ0NzY6W1sxNzM2XSwyNTZdLDY0NDc3OltbMTY1NV0sMjU2XSw2NDQ3ODpbWzE3MzldLDI1Nl0sNjQ0Nzk6W1sxNzM5XSwyNTZdLDY0NDgwOltbMTczM10sMjU2XSw2NDQ4MTpbWzE3MzNdLDI1Nl0sNjQ0ODI6W1sxNzM3XSwyNTZdLDY0NDgzOltbMTczN10sMjU2XSw2NDQ4NDpbWzE3NDRdLDI1Nl0sNjQ0ODU6W1sxNzQ0XSwyNTZdLDY0NDg2OltbMTc0NF0sMjU2XSw2NDQ4NzpbWzE3NDRdLDI1Nl0sNjQ0ODg6W1sxNjA5XSwyNTZdLDY0NDg5OltbMTYwOV0sMjU2XSw2NDQ5MDpbWzE1NzQsMTU3NV0sMjU2XSw2NDQ5MTpbWzE1NzQsMTU3NV0sMjU2XSw2NDQ5MjpbWzE1NzQsMTc0OV0sMjU2XSw2NDQ5MzpbWzE1NzQsMTc0OV0sMjU2XSw2NDQ5NDpbWzE1NzQsMTYwOF0sMjU2XSw2NDQ5NTpbWzE1NzQsMTYwOF0sMjU2XSw2NDQ5NjpbWzE1NzQsMTczNV0sMjU2XSw2NDQ5NzpbWzE1NzQsMTczNV0sMjU2XSw2NDQ5ODpbWzE1NzQsMTczNF0sMjU2XSw2NDQ5OTpbWzE1NzQsMTczNF0sMjU2XSw2NDUwMDpbWzE1NzQsMTczNl0sMjU2XSw2NDUwMTpbWzE1NzQsMTczNl0sMjU2XSw2NDUwMjpbWzE1NzQsMTc0NF0sMjU2XSw2NDUwMzpbWzE1NzQsMTc0NF0sMjU2XSw2NDUwNDpbWzE1NzQsMTc0NF0sMjU2XSw2NDUwNTpbWzE1NzQsMTYwOV0sMjU2XSw2NDUwNjpbWzE1NzQsMTYwOV0sMjU2XSw2NDUwNzpbWzE1NzQsMTYwOV0sMjU2XSw2NDUwODpbWzE3NDBdLDI1Nl0sNjQ1MDk6W1sxNzQwXSwyNTZdLDY0NTEwOltbMTc0MF0sMjU2XSw2NDUxMTpbWzE3NDBdLDI1Nl19LFxuNjQ1MTI6ezY0NTEyOltbMTU3NCwxNTgwXSwyNTZdLDY0NTEzOltbMTU3NCwxNTgxXSwyNTZdLDY0NTE0OltbMTU3NCwxNjA1XSwyNTZdLDY0NTE1OltbMTU3NCwxNjA5XSwyNTZdLDY0NTE2OltbMTU3NCwxNjEwXSwyNTZdLDY0NTE3OltbMTU3NiwxNTgwXSwyNTZdLDY0NTE4OltbMTU3NiwxNTgxXSwyNTZdLDY0NTE5OltbMTU3NiwxNTgyXSwyNTZdLDY0NTIwOltbMTU3NiwxNjA1XSwyNTZdLDY0NTIxOltbMTU3NiwxNjA5XSwyNTZdLDY0NTIyOltbMTU3NiwxNjEwXSwyNTZdLDY0NTIzOltbMTU3OCwxNTgwXSwyNTZdLDY0NTI0OltbMTU3OCwxNTgxXSwyNTZdLDY0NTI1OltbMTU3OCwxNTgyXSwyNTZdLDY0NTI2OltbMTU3OCwxNjA1XSwyNTZdLDY0NTI3OltbMTU3OCwxNjA5XSwyNTZdLDY0NTI4OltbMTU3OCwxNjEwXSwyNTZdLDY0NTI5OltbMTU3OSwxNTgwXSwyNTZdLDY0NTMwOltbMTU3OSwxNjA1XSwyNTZdLDY0NTMxOltbMTU3OSwxNjA5XSwyNTZdLDY0NTMyOltbMTU3OSwxNjEwXSwyNTZdLDY0NTMzOltbMTU4MCwxNTgxXSwyNTZdLDY0NTM0OltbMTU4MCwxNjA1XSwyNTZdLDY0NTM1OltbMTU4MSwxNTgwXSwyNTZdLDY0NTM2OltbMTU4MSwxNjA1XSwyNTZdLDY0NTM3OltbMTU4MiwxNTgwXSwyNTZdLDY0NTM4OltbMTU4MiwxNTgxXSwyNTZdLDY0NTM5OltbMTU4MiwxNjA1XSwyNTZdLDY0NTQwOltbMTU4NywxNTgwXSwyNTZdLDY0NTQxOltbMTU4NywxNTgxXSwyNTZdLDY0NTQyOltbMTU4NywxNTgyXSwyNTZdLDY0NTQzOltbMTU4NywxNjA1XSwyNTZdLDY0NTQ0OltbMTU4OSwxNTgxXSwyNTZdLDY0NTQ1OltbMTU4OSwxNjA1XSwyNTZdLDY0NTQ2OltbMTU5MCwxNTgwXSwyNTZdLDY0NTQ3OltbMTU5MCwxNTgxXSwyNTZdLDY0NTQ4OltbMTU5MCwxNTgyXSwyNTZdLDY0NTQ5OltbMTU5MCwxNjA1XSwyNTZdLDY0NTUwOltbMTU5MSwxNTgxXSwyNTZdLDY0NTUxOltbMTU5MSwxNjA1XSwyNTZdLDY0NTUyOltbMTU5MiwxNjA1XSwyNTZdLDY0NTUzOltbMTU5MywxNTgwXSwyNTZdLDY0NTU0OltbMTU5MywxNjA1XSwyNTZdLDY0NTU1OltbMTU5NCwxNTgwXSwyNTZdLDY0NTU2OltbMTU5NCwxNjA1XSwyNTZdLDY0NTU3OltbMTYwMSwxNTgwXSwyNTZdLDY0NTU4OltbMTYwMSwxNTgxXSwyNTZdLDY0NTU5OltbMTYwMSwxNTgyXSwyNTZdLDY0NTYwOltbMTYwMSwxNjA1XSwyNTZdLDY0NTYxOltbMTYwMSwxNjA5XSwyNTZdLDY0NTYyOltbMTYwMSwxNjEwXSwyNTZdLDY0NTYzOltbMTYwMiwxNTgxXSwyNTZdLDY0NTY0OltbMTYwMiwxNjA1XSwyNTZdLDY0NTY1OltbMTYwMiwxNjA5XSwyNTZdLDY0NTY2OltbMTYwMiwxNjEwXSwyNTZdLDY0NTY3OltbMTYwMywxNTc1XSwyNTZdLDY0NTY4OltbMTYwMywxNTgwXSwyNTZdLDY0NTY5OltbMTYwMywxNTgxXSwyNTZdLDY0NTcwOltbMTYwMywxNTgyXSwyNTZdLDY0NTcxOltbMTYwMywxNjA0XSwyNTZdLDY0NTcyOltbMTYwMywxNjA1XSwyNTZdLDY0NTczOltbMTYwMywxNjA5XSwyNTZdLDY0NTc0OltbMTYwMywxNjEwXSwyNTZdLDY0NTc1OltbMTYwNCwxNTgwXSwyNTZdLDY0NTc2OltbMTYwNCwxNTgxXSwyNTZdLDY0NTc3OltbMTYwNCwxNTgyXSwyNTZdLDY0NTc4OltbMTYwNCwxNjA1XSwyNTZdLDY0NTc5OltbMTYwNCwxNjA5XSwyNTZdLDY0NTgwOltbMTYwNCwxNjEwXSwyNTZdLDY0NTgxOltbMTYwNSwxNTgwXSwyNTZdLDY0NTgyOltbMTYwNSwxNTgxXSwyNTZdLDY0NTgzOltbMTYwNSwxNTgyXSwyNTZdLDY0NTg0OltbMTYwNSwxNjA1XSwyNTZdLDY0NTg1OltbMTYwNSwxNjA5XSwyNTZdLDY0NTg2OltbMTYwNSwxNjEwXSwyNTZdLDY0NTg3OltbMTYwNiwxNTgwXSwyNTZdLDY0NTg4OltbMTYwNiwxNTgxXSwyNTZdLDY0NTg5OltbMTYwNiwxNTgyXSwyNTZdLDY0NTkwOltbMTYwNiwxNjA1XSwyNTZdLDY0NTkxOltbMTYwNiwxNjA5XSwyNTZdLDY0NTkyOltbMTYwNiwxNjEwXSwyNTZdLDY0NTkzOltbMTYwNywxNTgwXSwyNTZdLDY0NTk0OltbMTYwNywxNjA1XSwyNTZdLDY0NTk1OltbMTYwNywxNjA5XSwyNTZdLDY0NTk2OltbMTYwNywxNjEwXSwyNTZdLDY0NTk3OltbMTYxMCwxNTgwXSwyNTZdLDY0NTk4OltbMTYxMCwxNTgxXSwyNTZdLDY0NTk5OltbMTYxMCwxNTgyXSwyNTZdLDY0NjAwOltbMTYxMCwxNjA1XSwyNTZdLDY0NjAxOltbMTYxMCwxNjA5XSwyNTZdLDY0NjAyOltbMTYxMCwxNjEwXSwyNTZdLDY0NjAzOltbMTU4NCwxNjQ4XSwyNTZdLDY0NjA0OltbMTU4NSwxNjQ4XSwyNTZdLDY0NjA1OltbMTYwOSwxNjQ4XSwyNTZdLDY0NjA2OltbMzIsMTYxMiwxNjE3XSwyNTZdLDY0NjA3OltbMzIsMTYxMywxNjE3XSwyNTZdLDY0NjA4OltbMzIsMTYxNCwxNjE3XSwyNTZdLDY0NjA5OltbMzIsMTYxNSwxNjE3XSwyNTZdLDY0NjEwOltbMzIsMTYxNiwxNjE3XSwyNTZdLDY0NjExOltbMzIsMTYxNywxNjQ4XSwyNTZdLDY0NjEyOltbMTU3NCwxNTg1XSwyNTZdLDY0NjEzOltbMTU3NCwxNTg2XSwyNTZdLDY0NjE0OltbMTU3NCwxNjA1XSwyNTZdLDY0NjE1OltbMTU3NCwxNjA2XSwyNTZdLDY0NjE2OltbMTU3NCwxNjA5XSwyNTZdLDY0NjE3OltbMTU3NCwxNjEwXSwyNTZdLDY0NjE4OltbMTU3NiwxNTg1XSwyNTZdLDY0NjE5OltbMTU3NiwxNTg2XSwyNTZdLDY0NjIwOltbMTU3NiwxNjA1XSwyNTZdLDY0NjIxOltbMTU3NiwxNjA2XSwyNTZdLDY0NjIyOltbMTU3NiwxNjA5XSwyNTZdLDY0NjIzOltbMTU3NiwxNjEwXSwyNTZdLDY0NjI0OltbMTU3OCwxNTg1XSwyNTZdLDY0NjI1OltbMTU3OCwxNTg2XSwyNTZdLDY0NjI2OltbMTU3OCwxNjA1XSwyNTZdLDY0NjI3OltbMTU3OCwxNjA2XSwyNTZdLDY0NjI4OltbMTU3OCwxNjA5XSwyNTZdLDY0NjI5OltbMTU3OCwxNjEwXSwyNTZdLDY0NjMwOltbMTU3OSwxNTg1XSwyNTZdLDY0NjMxOltbMTU3OSwxNTg2XSwyNTZdLDY0NjMyOltbMTU3OSwxNjA1XSwyNTZdLDY0NjMzOltbMTU3OSwxNjA2XSwyNTZdLDY0NjM0OltbMTU3OSwxNjA5XSwyNTZdLDY0NjM1OltbMTU3OSwxNjEwXSwyNTZdLDY0NjM2OltbMTYwMSwxNjA5XSwyNTZdLDY0NjM3OltbMTYwMSwxNjEwXSwyNTZdLDY0NjM4OltbMTYwMiwxNjA5XSwyNTZdLDY0NjM5OltbMTYwMiwxNjEwXSwyNTZdLDY0NjQwOltbMTYwMywxNTc1XSwyNTZdLDY0NjQxOltbMTYwMywxNjA0XSwyNTZdLDY0NjQyOltbMTYwMywxNjA1XSwyNTZdLDY0NjQzOltbMTYwMywxNjA5XSwyNTZdLDY0NjQ0OltbMTYwMywxNjEwXSwyNTZdLDY0NjQ1OltbMTYwNCwxNjA1XSwyNTZdLDY0NjQ2OltbMTYwNCwxNjA5XSwyNTZdLDY0NjQ3OltbMTYwNCwxNjEwXSwyNTZdLDY0NjQ4OltbMTYwNSwxNTc1XSwyNTZdLDY0NjQ5OltbMTYwNSwxNjA1XSwyNTZdLDY0NjUwOltbMTYwNiwxNTg1XSwyNTZdLDY0NjUxOltbMTYwNiwxNTg2XSwyNTZdLDY0NjUyOltbMTYwNiwxNjA1XSwyNTZdLDY0NjUzOltbMTYwNiwxNjA2XSwyNTZdLDY0NjU0OltbMTYwNiwxNjA5XSwyNTZdLDY0NjU1OltbMTYwNiwxNjEwXSwyNTZdLDY0NjU2OltbMTYwOSwxNjQ4XSwyNTZdLDY0NjU3OltbMTYxMCwxNTg1XSwyNTZdLDY0NjU4OltbMTYxMCwxNTg2XSwyNTZdLDY0NjU5OltbMTYxMCwxNjA1XSwyNTZdLDY0NjYwOltbMTYxMCwxNjA2XSwyNTZdLDY0NjYxOltbMTYxMCwxNjA5XSwyNTZdLDY0NjYyOltbMTYxMCwxNjEwXSwyNTZdLDY0NjYzOltbMTU3NCwxNTgwXSwyNTZdLDY0NjY0OltbMTU3NCwxNTgxXSwyNTZdLDY0NjY1OltbMTU3NCwxNTgyXSwyNTZdLDY0NjY2OltbMTU3NCwxNjA1XSwyNTZdLDY0NjY3OltbMTU3NCwxNjA3XSwyNTZdLDY0NjY4OltbMTU3NiwxNTgwXSwyNTZdLDY0NjY5OltbMTU3NiwxNTgxXSwyNTZdLDY0NjcwOltbMTU3NiwxNTgyXSwyNTZdLDY0NjcxOltbMTU3NiwxNjA1XSwyNTZdLDY0NjcyOltbMTU3NiwxNjA3XSwyNTZdLDY0NjczOltbMTU3OCwxNTgwXSwyNTZdLDY0Njc0OltbMTU3OCwxNTgxXSwyNTZdLDY0Njc1OltbMTU3OCwxNTgyXSwyNTZdLDY0Njc2OltbMTU3OCwxNjA1XSwyNTZdLDY0Njc3OltbMTU3OCwxNjA3XSwyNTZdLDY0Njc4OltbMTU3OSwxNjA1XSwyNTZdLDY0Njc5OltbMTU4MCwxNTgxXSwyNTZdLDY0NjgwOltbMTU4MCwxNjA1XSwyNTZdLDY0NjgxOltbMTU4MSwxNTgwXSwyNTZdLDY0NjgyOltbMTU4MSwxNjA1XSwyNTZdLDY0NjgzOltbMTU4MiwxNTgwXSwyNTZdLDY0Njg0OltbMTU4MiwxNjA1XSwyNTZdLDY0Njg1OltbMTU4NywxNTgwXSwyNTZdLDY0Njg2OltbMTU4NywxNTgxXSwyNTZdLDY0Njg3OltbMTU4NywxNTgyXSwyNTZdLDY0Njg4OltbMTU4NywxNjA1XSwyNTZdLDY0Njg5OltbMTU4OSwxNTgxXSwyNTZdLDY0NjkwOltbMTU4OSwxNTgyXSwyNTZdLDY0NjkxOltbMTU4OSwxNjA1XSwyNTZdLDY0NjkyOltbMTU5MCwxNTgwXSwyNTZdLDY0NjkzOltbMTU5MCwxNTgxXSwyNTZdLDY0Njk0OltbMTU5MCwxNTgyXSwyNTZdLDY0Njk1OltbMTU5MCwxNjA1XSwyNTZdLDY0Njk2OltbMTU5MSwxNTgxXSwyNTZdLDY0Njk3OltbMTU5MiwxNjA1XSwyNTZdLDY0Njk4OltbMTU5MywxNTgwXSwyNTZdLDY0Njk5OltbMTU5MywxNjA1XSwyNTZdLDY0NzAwOltbMTU5NCwxNTgwXSwyNTZdLDY0NzAxOltbMTU5NCwxNjA1XSwyNTZdLDY0NzAyOltbMTYwMSwxNTgwXSwyNTZdLDY0NzAzOltbMTYwMSwxNTgxXSwyNTZdLDY0NzA0OltbMTYwMSwxNTgyXSwyNTZdLDY0NzA1OltbMTYwMSwxNjA1XSwyNTZdLDY0NzA2OltbMTYwMiwxNTgxXSwyNTZdLDY0NzA3OltbMTYwMiwxNjA1XSwyNTZdLDY0NzA4OltbMTYwMywxNTgwXSwyNTZdLDY0NzA5OltbMTYwMywxNTgxXSwyNTZdLDY0NzEwOltbMTYwMywxNTgyXSwyNTZdLDY0NzExOltbMTYwMywxNjA0XSwyNTZdLDY0NzEyOltbMTYwMywxNjA1XSwyNTZdLDY0NzEzOltbMTYwNCwxNTgwXSwyNTZdLDY0NzE0OltbMTYwNCwxNTgxXSwyNTZdLDY0NzE1OltbMTYwNCwxNTgyXSwyNTZdLDY0NzE2OltbMTYwNCwxNjA1XSwyNTZdLDY0NzE3OltbMTYwNCwxNjA3XSwyNTZdLDY0NzE4OltbMTYwNSwxNTgwXSwyNTZdLDY0NzE5OltbMTYwNSwxNTgxXSwyNTZdLDY0NzIwOltbMTYwNSwxNTgyXSwyNTZdLDY0NzIxOltbMTYwNSwxNjA1XSwyNTZdLDY0NzIyOltbMTYwNiwxNTgwXSwyNTZdLDY0NzIzOltbMTYwNiwxNTgxXSwyNTZdLDY0NzI0OltbMTYwNiwxNTgyXSwyNTZdLDY0NzI1OltbMTYwNiwxNjA1XSwyNTZdLDY0NzI2OltbMTYwNiwxNjA3XSwyNTZdLDY0NzI3OltbMTYwNywxNTgwXSwyNTZdLDY0NzI4OltbMTYwNywxNjA1XSwyNTZdLDY0NzI5OltbMTYwNywxNjQ4XSwyNTZdLDY0NzMwOltbMTYxMCwxNTgwXSwyNTZdLDY0NzMxOltbMTYxMCwxNTgxXSwyNTZdLDY0NzMyOltbMTYxMCwxNTgyXSwyNTZdLDY0NzMzOltbMTYxMCwxNjA1XSwyNTZdLDY0NzM0OltbMTYxMCwxNjA3XSwyNTZdLDY0NzM1OltbMTU3NCwxNjA1XSwyNTZdLDY0NzM2OltbMTU3NCwxNjA3XSwyNTZdLDY0NzM3OltbMTU3NiwxNjA1XSwyNTZdLDY0NzM4OltbMTU3NiwxNjA3XSwyNTZdLDY0NzM5OltbMTU3OCwxNjA1XSwyNTZdLDY0NzQwOltbMTU3OCwxNjA3XSwyNTZdLDY0NzQxOltbMTU3OSwxNjA1XSwyNTZdLDY0NzQyOltbMTU3OSwxNjA3XSwyNTZdLDY0NzQzOltbMTU4NywxNjA1XSwyNTZdLDY0NzQ0OltbMTU4NywxNjA3XSwyNTZdLDY0NzQ1OltbMTU4OCwxNjA1XSwyNTZdLDY0NzQ2OltbMTU4OCwxNjA3XSwyNTZdLDY0NzQ3OltbMTYwMywxNjA0XSwyNTZdLDY0NzQ4OltbMTYwMywxNjA1XSwyNTZdLDY0NzQ5OltbMTYwNCwxNjA1XSwyNTZdLDY0NzUwOltbMTYwNiwxNjA1XSwyNTZdLDY0NzUxOltbMTYwNiwxNjA3XSwyNTZdLDY0NzUyOltbMTYxMCwxNjA1XSwyNTZdLDY0NzUzOltbMTYxMCwxNjA3XSwyNTZdLDY0NzU0OltbMTYwMCwxNjE0LDE2MTddLDI1Nl0sNjQ3NTU6W1sxNjAwLDE2MTUsMTYxN10sMjU2XSw2NDc1NjpbWzE2MDAsMTYxNiwxNjE3XSwyNTZdLDY0NzU3OltbMTU5MSwxNjA5XSwyNTZdLDY0NzU4OltbMTU5MSwxNjEwXSwyNTZdLDY0NzU5OltbMTU5MywxNjA5XSwyNTZdLDY0NzYwOltbMTU5MywxNjEwXSwyNTZdLDY0NzYxOltbMTU5NCwxNjA5XSwyNTZdLDY0NzYyOltbMTU5NCwxNjEwXSwyNTZdLDY0NzYzOltbMTU4NywxNjA5XSwyNTZdLDY0NzY0OltbMTU4NywxNjEwXSwyNTZdLDY0NzY1OltbMTU4OCwxNjA5XSwyNTZdLDY0NzY2OltbMTU4OCwxNjEwXSwyNTZdLDY0NzY3OltbMTU4MSwxNjA5XSwyNTZdfSxcbjY0NzY4Ons2NDc2ODpbWzE1ODEsMTYxMF0sMjU2XSw2NDc2OTpbWzE1ODAsMTYwOV0sMjU2XSw2NDc3MDpbWzE1ODAsMTYxMF0sMjU2XSw2NDc3MTpbWzE1ODIsMTYwOV0sMjU2XSw2NDc3MjpbWzE1ODIsMTYxMF0sMjU2XSw2NDc3MzpbWzE1ODksMTYwOV0sMjU2XSw2NDc3NDpbWzE1ODksMTYxMF0sMjU2XSw2NDc3NTpbWzE1OTAsMTYwOV0sMjU2XSw2NDc3NjpbWzE1OTAsMTYxMF0sMjU2XSw2NDc3NzpbWzE1ODgsMTU4MF0sMjU2XSw2NDc3ODpbWzE1ODgsMTU4MV0sMjU2XSw2NDc3OTpbWzE1ODgsMTU4Ml0sMjU2XSw2NDc4MDpbWzE1ODgsMTYwNV0sMjU2XSw2NDc4MTpbWzE1ODgsMTU4NV0sMjU2XSw2NDc4MjpbWzE1ODcsMTU4NV0sMjU2XSw2NDc4MzpbWzE1ODksMTU4NV0sMjU2XSw2NDc4NDpbWzE1OTAsMTU4NV0sMjU2XSw2NDc4NTpbWzE1OTEsMTYwOV0sMjU2XSw2NDc4NjpbWzE1OTEsMTYxMF0sMjU2XSw2NDc4NzpbWzE1OTMsMTYwOV0sMjU2XSw2NDc4ODpbWzE1OTMsMTYxMF0sMjU2XSw2NDc4OTpbWzE1OTQsMTYwOV0sMjU2XSw2NDc5MDpbWzE1OTQsMTYxMF0sMjU2XSw2NDc5MTpbWzE1ODcsMTYwOV0sMjU2XSw2NDc5MjpbWzE1ODcsMTYxMF0sMjU2XSw2NDc5MzpbWzE1ODgsMTYwOV0sMjU2XSw2NDc5NDpbWzE1ODgsMTYxMF0sMjU2XSw2NDc5NTpbWzE1ODEsMTYwOV0sMjU2XSw2NDc5NjpbWzE1ODEsMTYxMF0sMjU2XSw2NDc5NzpbWzE1ODAsMTYwOV0sMjU2XSw2NDc5ODpbWzE1ODAsMTYxMF0sMjU2XSw2NDc5OTpbWzE1ODIsMTYwOV0sMjU2XSw2NDgwMDpbWzE1ODIsMTYxMF0sMjU2XSw2NDgwMTpbWzE1ODksMTYwOV0sMjU2XSw2NDgwMjpbWzE1ODksMTYxMF0sMjU2XSw2NDgwMzpbWzE1OTAsMTYwOV0sMjU2XSw2NDgwNDpbWzE1OTAsMTYxMF0sMjU2XSw2NDgwNTpbWzE1ODgsMTU4MF0sMjU2XSw2NDgwNjpbWzE1ODgsMTU4MV0sMjU2XSw2NDgwNzpbWzE1ODgsMTU4Ml0sMjU2XSw2NDgwODpbWzE1ODgsMTYwNV0sMjU2XSw2NDgwOTpbWzE1ODgsMTU4NV0sMjU2XSw2NDgxMDpbWzE1ODcsMTU4NV0sMjU2XSw2NDgxMTpbWzE1ODksMTU4NV0sMjU2XSw2NDgxMjpbWzE1OTAsMTU4NV0sMjU2XSw2NDgxMzpbWzE1ODgsMTU4MF0sMjU2XSw2NDgxNDpbWzE1ODgsMTU4MV0sMjU2XSw2NDgxNTpbWzE1ODgsMTU4Ml0sMjU2XSw2NDgxNjpbWzE1ODgsMTYwNV0sMjU2XSw2NDgxNzpbWzE1ODcsMTYwN10sMjU2XSw2NDgxODpbWzE1ODgsMTYwN10sMjU2XSw2NDgxOTpbWzE1OTEsMTYwNV0sMjU2XSw2NDgyMDpbWzE1ODcsMTU4MF0sMjU2XSw2NDgyMTpbWzE1ODcsMTU4MV0sMjU2XSw2NDgyMjpbWzE1ODcsMTU4Ml0sMjU2XSw2NDgyMzpbWzE1ODgsMTU4MF0sMjU2XSw2NDgyNDpbWzE1ODgsMTU4MV0sMjU2XSw2NDgyNTpbWzE1ODgsMTU4Ml0sMjU2XSw2NDgyNjpbWzE1OTEsMTYwNV0sMjU2XSw2NDgyNzpbWzE1OTIsMTYwNV0sMjU2XSw2NDgyODpbWzE1NzUsMTYxMV0sMjU2XSw2NDgyOTpbWzE1NzUsMTYxMV0sMjU2XSw2NDg0ODpbWzE1NzgsMTU4MCwxNjA1XSwyNTZdLDY0ODQ5OltbMTU3OCwxNTgxLDE1ODBdLDI1Nl0sNjQ4NTA6W1sxNTc4LDE1ODEsMTU4MF0sMjU2XSw2NDg1MTpbWzE1NzgsMTU4MSwxNjA1XSwyNTZdLDY0ODUyOltbMTU3OCwxNTgyLDE2MDVdLDI1Nl0sNjQ4NTM6W1sxNTc4LDE2MDUsMTU4MF0sMjU2XSw2NDg1NDpbWzE1NzgsMTYwNSwxNTgxXSwyNTZdLDY0ODU1OltbMTU3OCwxNjA1LDE1ODJdLDI1Nl0sNjQ4NTY6W1sxNTgwLDE2MDUsMTU4MV0sMjU2XSw2NDg1NzpbWzE1ODAsMTYwNSwxNTgxXSwyNTZdLDY0ODU4OltbMTU4MSwxNjA1LDE2MTBdLDI1Nl0sNjQ4NTk6W1sxNTgxLDE2MDUsMTYwOV0sMjU2XSw2NDg2MDpbWzE1ODcsMTU4MSwxNTgwXSwyNTZdLDY0ODYxOltbMTU4NywxNTgwLDE1ODFdLDI1Nl0sNjQ4NjI6W1sxNTg3LDE1ODAsMTYwOV0sMjU2XSw2NDg2MzpbWzE1ODcsMTYwNSwxNTgxXSwyNTZdLDY0ODY0OltbMTU4NywxNjA1LDE1ODFdLDI1Nl0sNjQ4NjU6W1sxNTg3LDE2MDUsMTU4MF0sMjU2XSw2NDg2NjpbWzE1ODcsMTYwNSwxNjA1XSwyNTZdLDY0ODY3OltbMTU4NywxNjA1LDE2MDVdLDI1Nl0sNjQ4Njg6W1sxNTg5LDE1ODEsMTU4MV0sMjU2XSw2NDg2OTpbWzE1ODksMTU4MSwxNTgxXSwyNTZdLDY0ODcwOltbMTU4OSwxNjA1LDE2MDVdLDI1Nl0sNjQ4NzE6W1sxNTg4LDE1ODEsMTYwNV0sMjU2XSw2NDg3MjpbWzE1ODgsMTU4MSwxNjA1XSwyNTZdLDY0ODczOltbMTU4OCwxNTgwLDE2MTBdLDI1Nl0sNjQ4NzQ6W1sxNTg4LDE2MDUsMTU4Ml0sMjU2XSw2NDg3NTpbWzE1ODgsMTYwNSwxNTgyXSwyNTZdLDY0ODc2OltbMTU4OCwxNjA1LDE2MDVdLDI1Nl0sNjQ4Nzc6W1sxNTg4LDE2MDUsMTYwNV0sMjU2XSw2NDg3ODpbWzE1OTAsMTU4MSwxNjA5XSwyNTZdLDY0ODc5OltbMTU5MCwxNTgyLDE2MDVdLDI1Nl0sNjQ4ODA6W1sxNTkwLDE1ODIsMTYwNV0sMjU2XSw2NDg4MTpbWzE1OTEsMTYwNSwxNTgxXSwyNTZdLDY0ODgyOltbMTU5MSwxNjA1LDE1ODFdLDI1Nl0sNjQ4ODM6W1sxNTkxLDE2MDUsMTYwNV0sMjU2XSw2NDg4NDpbWzE1OTEsMTYwNSwxNjEwXSwyNTZdLDY0ODg1OltbMTU5MywxNTgwLDE2MDVdLDI1Nl0sNjQ4ODY6W1sxNTkzLDE2MDUsMTYwNV0sMjU2XSw2NDg4NzpbWzE1OTMsMTYwNSwxNjA1XSwyNTZdLDY0ODg4OltbMTU5MywxNjA1LDE2MDldLDI1Nl0sNjQ4ODk6W1sxNTk0LDE2MDUsMTYwNV0sMjU2XSw2NDg5MDpbWzE1OTQsMTYwNSwxNjEwXSwyNTZdLDY0ODkxOltbMTU5NCwxNjA1LDE2MDldLDI1Nl0sNjQ4OTI6W1sxNjAxLDE1ODIsMTYwNV0sMjU2XSw2NDg5MzpbWzE2MDEsMTU4MiwxNjA1XSwyNTZdLDY0ODk0OltbMTYwMiwxNjA1LDE1ODFdLDI1Nl0sNjQ4OTU6W1sxNjAyLDE2MDUsMTYwNV0sMjU2XSw2NDg5NjpbWzE2MDQsMTU4MSwxNjA1XSwyNTZdLDY0ODk3OltbMTYwNCwxNTgxLDE2MTBdLDI1Nl0sNjQ4OTg6W1sxNjA0LDE1ODEsMTYwOV0sMjU2XSw2NDg5OTpbWzE2MDQsMTU4MCwxNTgwXSwyNTZdLDY0OTAwOltbMTYwNCwxNTgwLDE1ODBdLDI1Nl0sNjQ5MDE6W1sxNjA0LDE1ODIsMTYwNV0sMjU2XSw2NDkwMjpbWzE2MDQsMTU4MiwxNjA1XSwyNTZdLDY0OTAzOltbMTYwNCwxNjA1LDE1ODFdLDI1Nl0sNjQ5MDQ6W1sxNjA0LDE2MDUsMTU4MV0sMjU2XSw2NDkwNTpbWzE2MDUsMTU4MSwxNTgwXSwyNTZdLDY0OTA2OltbMTYwNSwxNTgxLDE2MDVdLDI1Nl0sNjQ5MDc6W1sxNjA1LDE1ODEsMTYxMF0sMjU2XSw2NDkwODpbWzE2MDUsMTU4MCwxNTgxXSwyNTZdLDY0OTA5OltbMTYwNSwxNTgwLDE2MDVdLDI1Nl0sNjQ5MTA6W1sxNjA1LDE1ODIsMTU4MF0sMjU2XSw2NDkxMTpbWzE2MDUsMTU4MiwxNjA1XSwyNTZdLDY0OTE0OltbMTYwNSwxNTgwLDE1ODJdLDI1Nl0sNjQ5MTU6W1sxNjA3LDE2MDUsMTU4MF0sMjU2XSw2NDkxNjpbWzE2MDcsMTYwNSwxNjA1XSwyNTZdLDY0OTE3OltbMTYwNiwxNTgxLDE2MDVdLDI1Nl0sNjQ5MTg6W1sxNjA2LDE1ODEsMTYwOV0sMjU2XSw2NDkxOTpbWzE2MDYsMTU4MCwxNjA1XSwyNTZdLDY0OTIwOltbMTYwNiwxNTgwLDE2MDVdLDI1Nl0sNjQ5MjE6W1sxNjA2LDE1ODAsMTYwOV0sMjU2XSw2NDkyMjpbWzE2MDYsMTYwNSwxNjEwXSwyNTZdLDY0OTIzOltbMTYwNiwxNjA1LDE2MDldLDI1Nl0sNjQ5MjQ6W1sxNjEwLDE2MDUsMTYwNV0sMjU2XSw2NDkyNTpbWzE2MTAsMTYwNSwxNjA1XSwyNTZdLDY0OTI2OltbMTU3NiwxNTgyLDE2MTBdLDI1Nl0sNjQ5Mjc6W1sxNTc4LDE1ODAsMTYxMF0sMjU2XSw2NDkyODpbWzE1NzgsMTU4MCwxNjA5XSwyNTZdLDY0OTI5OltbMTU3OCwxNTgyLDE2MTBdLDI1Nl0sNjQ5MzA6W1sxNTc4LDE1ODIsMTYwOV0sMjU2XSw2NDkzMTpbWzE1NzgsMTYwNSwxNjEwXSwyNTZdLDY0OTMyOltbMTU3OCwxNjA1LDE2MDldLDI1Nl0sNjQ5MzM6W1sxNTgwLDE2MDUsMTYxMF0sMjU2XSw2NDkzNDpbWzE1ODAsMTU4MSwxNjA5XSwyNTZdLDY0OTM1OltbMTU4MCwxNjA1LDE2MDldLDI1Nl0sNjQ5MzY6W1sxNTg3LDE1ODIsMTYwOV0sMjU2XSw2NDkzNzpbWzE1ODksMTU4MSwxNjEwXSwyNTZdLDY0OTM4OltbMTU4OCwxNTgxLDE2MTBdLDI1Nl0sNjQ5Mzk6W1sxNTkwLDE1ODEsMTYxMF0sMjU2XSw2NDk0MDpbWzE2MDQsMTU4MCwxNjEwXSwyNTZdLDY0OTQxOltbMTYwNCwxNjA1LDE2MTBdLDI1Nl0sNjQ5NDI6W1sxNjEwLDE1ODEsMTYxMF0sMjU2XSw2NDk0MzpbWzE2MTAsMTU4MCwxNjEwXSwyNTZdLDY0OTQ0OltbMTYxMCwxNjA1LDE2MTBdLDI1Nl0sNjQ5NDU6W1sxNjA1LDE2MDUsMTYxMF0sMjU2XSw2NDk0NjpbWzE2MDIsMTYwNSwxNjEwXSwyNTZdLDY0OTQ3OltbMTYwNiwxNTgxLDE2MTBdLDI1Nl0sNjQ5NDg6W1sxNjAyLDE2MDUsMTU4MV0sMjU2XSw2NDk0OTpbWzE2MDQsMTU4MSwxNjA1XSwyNTZdLDY0OTUwOltbMTU5MywxNjA1LDE2MTBdLDI1Nl0sNjQ5NTE6W1sxNjAzLDE2MDUsMTYxMF0sMjU2XSw2NDk1MjpbWzE2MDYsMTU4MCwxNTgxXSwyNTZdLDY0OTUzOltbMTYwNSwxNTgyLDE2MTBdLDI1Nl0sNjQ5NTQ6W1sxNjA0LDE1ODAsMTYwNV0sMjU2XSw2NDk1NTpbWzE2MDMsMTYwNSwxNjA1XSwyNTZdLDY0OTU2OltbMTYwNCwxNTgwLDE2MDVdLDI1Nl0sNjQ5NTc6W1sxNjA2LDE1ODAsMTU4MV0sMjU2XSw2NDk1ODpbWzE1ODAsMTU4MSwxNjEwXSwyNTZdLDY0OTU5OltbMTU4MSwxNTgwLDE2MTBdLDI1Nl0sNjQ5NjA6W1sxNjA1LDE1ODAsMTYxMF0sMjU2XSw2NDk2MTpbWzE2MDEsMTYwNSwxNjEwXSwyNTZdLDY0OTYyOltbMTU3NiwxNTgxLDE2MTBdLDI1Nl0sNjQ5NjM6W1sxNjAzLDE2MDUsMTYwNV0sMjU2XSw2NDk2NDpbWzE1OTMsMTU4MCwxNjA1XSwyNTZdLDY0OTY1OltbMTU4OSwxNjA1LDE2MDVdLDI1Nl0sNjQ5NjY6W1sxNTg3LDE1ODIsMTYxMF0sMjU2XSw2NDk2NzpbWzE2MDYsMTU4MCwxNjEwXSwyNTZdLDY1MDA4OltbMTU4OSwxNjA0LDE3NDZdLDI1Nl0sNjUwMDk6W1sxNjAyLDE2MDQsMTc0Nl0sMjU2XSw2NTAxMDpbWzE1NzUsMTYwNCwxNjA0LDE2MDddLDI1Nl0sNjUwMTE6W1sxNTc1LDE2MDMsMTU3NiwxNTg1XSwyNTZdLDY1MDEyOltbMTYwNSwxNTgxLDE2MDUsMTU4M10sMjU2XSw2NTAxMzpbWzE1ODksMTYwNCwxNTkzLDE2MDVdLDI1Nl0sNjUwMTQ6W1sxNTg1LDE1ODcsMTYwOCwxNjA0XSwyNTZdLDY1MDE1OltbMTU5MywxNjA0LDE2MTAsMTYwN10sMjU2XSw2NTAxNjpbWzE2MDgsMTU4NywxNjA0LDE2MDVdLDI1Nl0sNjUwMTc6W1sxNTg5LDE2MDQsMTYwOV0sMjU2XSw2NTAxODpbWzE1ODksMTYwNCwxNjA5LDMyLDE1NzUsMTYwNCwxNjA0LDE2MDcsMzIsMTU5MywxNjA0LDE2MTAsMTYwNywzMiwxNjA4LDE1ODcsMTYwNCwxNjA1XSwyNTZdLDY1MDE5OltbMTU4MCwxNjA0LDMyLDE1ODAsMTYwNCwxNTc1LDE2MDQsMTYwN10sMjU2XSw2NTAyMDpbWzE1ODUsMTc0MCwxNTc1LDE2MDRdLDI1Nl19LFxuNjUwMjQ6ezY1MDQwOltbNDRdLDI1Nl0sNjUwNDE6W1sxMjI4OV0sMjU2XSw2NTA0MjpbWzEyMjkwXSwyNTZdLDY1MDQzOltbNThdLDI1Nl0sNjUwNDQ6W1s1OV0sMjU2XSw2NTA0NTpbWzMzXSwyNTZdLDY1MDQ2OltbNjNdLDI1Nl0sNjUwNDc6W1sxMjMxMF0sMjU2XSw2NTA0ODpbWzEyMzExXSwyNTZdLDY1MDQ5OltbODIzMF0sMjU2XSw2NTA1NjpbLDIzMF0sNjUwNTc6WywyMzBdLDY1MDU4OlssMjMwXSw2NTA1OTpbLDIzMF0sNjUwNjA6WywyMzBdLDY1MDYxOlssMjMwXSw2NTA2MjpbLDIzMF0sNjUwNzI6W1s4MjI5XSwyNTZdLDY1MDczOltbODIxMl0sMjU2XSw2NTA3NDpbWzgyMTFdLDI1Nl0sNjUwNzU6W1s5NV0sMjU2XSw2NTA3NjpbWzk1XSwyNTZdLDY1MDc3OltbNDBdLDI1Nl0sNjUwNzg6W1s0MV0sMjU2XSw2NTA3OTpbWzEyM10sMjU2XSw2NTA4MDpbWzEyNV0sMjU2XSw2NTA4MTpbWzEyMzA4XSwyNTZdLDY1MDgyOltbMTIzMDldLDI1Nl0sNjUwODM6W1sxMjMwNF0sMjU2XSw2NTA4NDpbWzEyMzA1XSwyNTZdLDY1MDg1OltbMTIyOThdLDI1Nl0sNjUwODY6W1sxMjI5OV0sMjU2XSw2NTA4NzpbWzEyMjk2XSwyNTZdLDY1MDg4OltbMTIyOTddLDI1Nl0sNjUwODk6W1sxMjMwMF0sMjU2XSw2NTA5MDpbWzEyMzAxXSwyNTZdLDY1MDkxOltbMTIzMDJdLDI1Nl0sNjUwOTI6W1sxMjMwM10sMjU2XSw2NTA5NTpbWzkxXSwyNTZdLDY1MDk2OltbOTNdLDI1Nl0sNjUwOTc6W1s4MjU0XSwyNTZdLDY1MDk4OltbODI1NF0sMjU2XSw2NTA5OTpbWzgyNTRdLDI1Nl0sNjUxMDA6W1s4MjU0XSwyNTZdLDY1MTAxOltbOTVdLDI1Nl0sNjUxMDI6W1s5NV0sMjU2XSw2NTEwMzpbWzk1XSwyNTZdLDY1MTA0OltbNDRdLDI1Nl0sNjUxMDU6W1sxMjI4OV0sMjU2XSw2NTEwNjpbWzQ2XSwyNTZdLDY1MTA4OltbNTldLDI1Nl0sNjUxMDk6W1s1OF0sMjU2XSw2NTExMDpbWzYzXSwyNTZdLDY1MTExOltbMzNdLDI1Nl0sNjUxMTI6W1s4MjEyXSwyNTZdLDY1MTEzOltbNDBdLDI1Nl0sNjUxMTQ6W1s0MV0sMjU2XSw2NTExNTpbWzEyM10sMjU2XSw2NTExNjpbWzEyNV0sMjU2XSw2NTExNzpbWzEyMzA4XSwyNTZdLDY1MTE4OltbMTIzMDldLDI1Nl0sNjUxMTk6W1szNV0sMjU2XSw2NTEyMDpbWzM4XSwyNTZdLDY1MTIxOltbNDJdLDI1Nl0sNjUxMjI6W1s0M10sMjU2XSw2NTEyMzpbWzQ1XSwyNTZdLDY1MTI0OltbNjBdLDI1Nl0sNjUxMjU6W1s2Ml0sMjU2XSw2NTEyNjpbWzYxXSwyNTZdLDY1MTI4OltbOTJdLDI1Nl0sNjUxMjk6W1szNl0sMjU2XSw2NTEzMDpbWzM3XSwyNTZdLDY1MTMxOltbNjRdLDI1Nl0sNjUxMzY6W1szMiwxNjExXSwyNTZdLDY1MTM3OltbMTYwMCwxNjExXSwyNTZdLDY1MTM4OltbMzIsMTYxMl0sMjU2XSw2NTE0MDpbWzMyLDE2MTNdLDI1Nl0sNjUxNDI6W1szMiwxNjE0XSwyNTZdLDY1MTQzOltbMTYwMCwxNjE0XSwyNTZdLDY1MTQ0OltbMzIsMTYxNV0sMjU2XSw2NTE0NTpbWzE2MDAsMTYxNV0sMjU2XSw2NTE0NjpbWzMyLDE2MTZdLDI1Nl0sNjUxNDc6W1sxNjAwLDE2MTZdLDI1Nl0sNjUxNDg6W1szMiwxNjE3XSwyNTZdLDY1MTQ5OltbMTYwMCwxNjE3XSwyNTZdLDY1MTUwOltbMzIsMTYxOF0sMjU2XSw2NTE1MTpbWzE2MDAsMTYxOF0sMjU2XSw2NTE1MjpbWzE1NjldLDI1Nl0sNjUxNTM6W1sxNTcwXSwyNTZdLDY1MTU0OltbMTU3MF0sMjU2XSw2NTE1NTpbWzE1NzFdLDI1Nl0sNjUxNTY6W1sxNTcxXSwyNTZdLDY1MTU3OltbMTU3Ml0sMjU2XSw2NTE1ODpbWzE1NzJdLDI1Nl0sNjUxNTk6W1sxNTczXSwyNTZdLDY1MTYwOltbMTU3M10sMjU2XSw2NTE2MTpbWzE1NzRdLDI1Nl0sNjUxNjI6W1sxNTc0XSwyNTZdLDY1MTYzOltbMTU3NF0sMjU2XSw2NTE2NDpbWzE1NzRdLDI1Nl0sNjUxNjU6W1sxNTc1XSwyNTZdLDY1MTY2OltbMTU3NV0sMjU2XSw2NTE2NzpbWzE1NzZdLDI1Nl0sNjUxNjg6W1sxNTc2XSwyNTZdLDY1MTY5OltbMTU3Nl0sMjU2XSw2NTE3MDpbWzE1NzZdLDI1Nl0sNjUxNzE6W1sxNTc3XSwyNTZdLDY1MTcyOltbMTU3N10sMjU2XSw2NTE3MzpbWzE1NzhdLDI1Nl0sNjUxNzQ6W1sxNTc4XSwyNTZdLDY1MTc1OltbMTU3OF0sMjU2XSw2NTE3NjpbWzE1NzhdLDI1Nl0sNjUxNzc6W1sxNTc5XSwyNTZdLDY1MTc4OltbMTU3OV0sMjU2XSw2NTE3OTpbWzE1NzldLDI1Nl0sNjUxODA6W1sxNTc5XSwyNTZdLDY1MTgxOltbMTU4MF0sMjU2XSw2NTE4MjpbWzE1ODBdLDI1Nl0sNjUxODM6W1sxNTgwXSwyNTZdLDY1MTg0OltbMTU4MF0sMjU2XSw2NTE4NTpbWzE1ODFdLDI1Nl0sNjUxODY6W1sxNTgxXSwyNTZdLDY1MTg3OltbMTU4MV0sMjU2XSw2NTE4ODpbWzE1ODFdLDI1Nl0sNjUxODk6W1sxNTgyXSwyNTZdLDY1MTkwOltbMTU4Ml0sMjU2XSw2NTE5MTpbWzE1ODJdLDI1Nl0sNjUxOTI6W1sxNTgyXSwyNTZdLDY1MTkzOltbMTU4M10sMjU2XSw2NTE5NDpbWzE1ODNdLDI1Nl0sNjUxOTU6W1sxNTg0XSwyNTZdLDY1MTk2OltbMTU4NF0sMjU2XSw2NTE5NzpbWzE1ODVdLDI1Nl0sNjUxOTg6W1sxNTg1XSwyNTZdLDY1MTk5OltbMTU4Nl0sMjU2XSw2NTIwMDpbWzE1ODZdLDI1Nl0sNjUyMDE6W1sxNTg3XSwyNTZdLDY1MjAyOltbMTU4N10sMjU2XSw2NTIwMzpbWzE1ODddLDI1Nl0sNjUyMDQ6W1sxNTg3XSwyNTZdLDY1MjA1OltbMTU4OF0sMjU2XSw2NTIwNjpbWzE1ODhdLDI1Nl0sNjUyMDc6W1sxNTg4XSwyNTZdLDY1MjA4OltbMTU4OF0sMjU2XSw2NTIwOTpbWzE1ODldLDI1Nl0sNjUyMTA6W1sxNTg5XSwyNTZdLDY1MjExOltbMTU4OV0sMjU2XSw2NTIxMjpbWzE1ODldLDI1Nl0sNjUyMTM6W1sxNTkwXSwyNTZdLDY1MjE0OltbMTU5MF0sMjU2XSw2NTIxNTpbWzE1OTBdLDI1Nl0sNjUyMTY6W1sxNTkwXSwyNTZdLDY1MjE3OltbMTU5MV0sMjU2XSw2NTIxODpbWzE1OTFdLDI1Nl0sNjUyMTk6W1sxNTkxXSwyNTZdLDY1MjIwOltbMTU5MV0sMjU2XSw2NTIyMTpbWzE1OTJdLDI1Nl0sNjUyMjI6W1sxNTkyXSwyNTZdLDY1MjIzOltbMTU5Ml0sMjU2XSw2NTIyNDpbWzE1OTJdLDI1Nl0sNjUyMjU6W1sxNTkzXSwyNTZdLDY1MjI2OltbMTU5M10sMjU2XSw2NTIyNzpbWzE1OTNdLDI1Nl0sNjUyMjg6W1sxNTkzXSwyNTZdLDY1MjI5OltbMTU5NF0sMjU2XSw2NTIzMDpbWzE1OTRdLDI1Nl0sNjUyMzE6W1sxNTk0XSwyNTZdLDY1MjMyOltbMTU5NF0sMjU2XSw2NTIzMzpbWzE2MDFdLDI1Nl0sNjUyMzQ6W1sxNjAxXSwyNTZdLDY1MjM1OltbMTYwMV0sMjU2XSw2NTIzNjpbWzE2MDFdLDI1Nl0sNjUyMzc6W1sxNjAyXSwyNTZdLDY1MjM4OltbMTYwMl0sMjU2XSw2NTIzOTpbWzE2MDJdLDI1Nl0sNjUyNDA6W1sxNjAyXSwyNTZdLDY1MjQxOltbMTYwM10sMjU2XSw2NTI0MjpbWzE2MDNdLDI1Nl0sNjUyNDM6W1sxNjAzXSwyNTZdLDY1MjQ0OltbMTYwM10sMjU2XSw2NTI0NTpbWzE2MDRdLDI1Nl0sNjUyNDY6W1sxNjA0XSwyNTZdLDY1MjQ3OltbMTYwNF0sMjU2XSw2NTI0ODpbWzE2MDRdLDI1Nl0sNjUyNDk6W1sxNjA1XSwyNTZdLDY1MjUwOltbMTYwNV0sMjU2XSw2NTI1MTpbWzE2MDVdLDI1Nl0sNjUyNTI6W1sxNjA1XSwyNTZdLDY1MjUzOltbMTYwNl0sMjU2XSw2NTI1NDpbWzE2MDZdLDI1Nl0sNjUyNTU6W1sxNjA2XSwyNTZdLDY1MjU2OltbMTYwNl0sMjU2XSw2NTI1NzpbWzE2MDddLDI1Nl0sNjUyNTg6W1sxNjA3XSwyNTZdLDY1MjU5OltbMTYwN10sMjU2XSw2NTI2MDpbWzE2MDddLDI1Nl0sNjUyNjE6W1sxNjA4XSwyNTZdLDY1MjYyOltbMTYwOF0sMjU2XSw2NTI2MzpbWzE2MDldLDI1Nl0sNjUyNjQ6W1sxNjA5XSwyNTZdLDY1MjY1OltbMTYxMF0sMjU2XSw2NTI2NjpbWzE2MTBdLDI1Nl0sNjUyNjc6W1sxNjEwXSwyNTZdLDY1MjY4OltbMTYxMF0sMjU2XSw2NTI2OTpbWzE2MDQsMTU3MF0sMjU2XSw2NTI3MDpbWzE2MDQsMTU3MF0sMjU2XSw2NTI3MTpbWzE2MDQsMTU3MV0sMjU2XSw2NTI3MjpbWzE2MDQsMTU3MV0sMjU2XSw2NTI3MzpbWzE2MDQsMTU3M10sMjU2XSw2NTI3NDpbWzE2MDQsMTU3M10sMjU2XSw2NTI3NTpbWzE2MDQsMTU3NV0sMjU2XSw2NTI3NjpbWzE2MDQsMTU3NV0sMjU2XX0sXG42NTI4MDp7NjUyODE6W1szM10sMjU2XSw2NTI4MjpbWzM0XSwyNTZdLDY1MjgzOltbMzVdLDI1Nl0sNjUyODQ6W1szNl0sMjU2XSw2NTI4NTpbWzM3XSwyNTZdLDY1Mjg2OltbMzhdLDI1Nl0sNjUyODc6W1szOV0sMjU2XSw2NTI4ODpbWzQwXSwyNTZdLDY1Mjg5OltbNDFdLDI1Nl0sNjUyOTA6W1s0Ml0sMjU2XSw2NTI5MTpbWzQzXSwyNTZdLDY1MjkyOltbNDRdLDI1Nl0sNjUyOTM6W1s0NV0sMjU2XSw2NTI5NDpbWzQ2XSwyNTZdLDY1Mjk1OltbNDddLDI1Nl0sNjUyOTY6W1s0OF0sMjU2XSw2NTI5NzpbWzQ5XSwyNTZdLDY1Mjk4OltbNTBdLDI1Nl0sNjUyOTk6W1s1MV0sMjU2XSw2NTMwMDpbWzUyXSwyNTZdLDY1MzAxOltbNTNdLDI1Nl0sNjUzMDI6W1s1NF0sMjU2XSw2NTMwMzpbWzU1XSwyNTZdLDY1MzA0OltbNTZdLDI1Nl0sNjUzMDU6W1s1N10sMjU2XSw2NTMwNjpbWzU4XSwyNTZdLDY1MzA3OltbNTldLDI1Nl0sNjUzMDg6W1s2MF0sMjU2XSw2NTMwOTpbWzYxXSwyNTZdLDY1MzEwOltbNjJdLDI1Nl0sNjUzMTE6W1s2M10sMjU2XSw2NTMxMjpbWzY0XSwyNTZdLDY1MzEzOltbNjVdLDI1Nl0sNjUzMTQ6W1s2Nl0sMjU2XSw2NTMxNTpbWzY3XSwyNTZdLDY1MzE2OltbNjhdLDI1Nl0sNjUzMTc6W1s2OV0sMjU2XSw2NTMxODpbWzcwXSwyNTZdLDY1MzE5OltbNzFdLDI1Nl0sNjUzMjA6W1s3Ml0sMjU2XSw2NTMyMTpbWzczXSwyNTZdLDY1MzIyOltbNzRdLDI1Nl0sNjUzMjM6W1s3NV0sMjU2XSw2NTMyNDpbWzc2XSwyNTZdLDY1MzI1OltbNzddLDI1Nl0sNjUzMjY6W1s3OF0sMjU2XSw2NTMyNzpbWzc5XSwyNTZdLDY1MzI4OltbODBdLDI1Nl0sNjUzMjk6W1s4MV0sMjU2XSw2NTMzMDpbWzgyXSwyNTZdLDY1MzMxOltbODNdLDI1Nl0sNjUzMzI6W1s4NF0sMjU2XSw2NTMzMzpbWzg1XSwyNTZdLDY1MzM0OltbODZdLDI1Nl0sNjUzMzU6W1s4N10sMjU2XSw2NTMzNjpbWzg4XSwyNTZdLDY1MzM3OltbODldLDI1Nl0sNjUzMzg6W1s5MF0sMjU2XSw2NTMzOTpbWzkxXSwyNTZdLDY1MzQwOltbOTJdLDI1Nl0sNjUzNDE6W1s5M10sMjU2XSw2NTM0MjpbWzk0XSwyNTZdLDY1MzQzOltbOTVdLDI1Nl0sNjUzNDQ6W1s5Nl0sMjU2XSw2NTM0NTpbWzk3XSwyNTZdLDY1MzQ2OltbOThdLDI1Nl0sNjUzNDc6W1s5OV0sMjU2XSw2NTM0ODpbWzEwMF0sMjU2XSw2NTM0OTpbWzEwMV0sMjU2XSw2NTM1MDpbWzEwMl0sMjU2XSw2NTM1MTpbWzEwM10sMjU2XSw2NTM1MjpbWzEwNF0sMjU2XSw2NTM1MzpbWzEwNV0sMjU2XSw2NTM1NDpbWzEwNl0sMjU2XSw2NTM1NTpbWzEwN10sMjU2XSw2NTM1NjpbWzEwOF0sMjU2XSw2NTM1NzpbWzEwOV0sMjU2XSw2NTM1ODpbWzExMF0sMjU2XSw2NTM1OTpbWzExMV0sMjU2XSw2NTM2MDpbWzExMl0sMjU2XSw2NTM2MTpbWzExM10sMjU2XSw2NTM2MjpbWzExNF0sMjU2XSw2NTM2MzpbWzExNV0sMjU2XSw2NTM2NDpbWzExNl0sMjU2XSw2NTM2NTpbWzExN10sMjU2XSw2NTM2NjpbWzExOF0sMjU2XSw2NTM2NzpbWzExOV0sMjU2XSw2NTM2ODpbWzEyMF0sMjU2XSw2NTM2OTpbWzEyMV0sMjU2XSw2NTM3MDpbWzEyMl0sMjU2XSw2NTM3MTpbWzEyM10sMjU2XSw2NTM3MjpbWzEyNF0sMjU2XSw2NTM3MzpbWzEyNV0sMjU2XSw2NTM3NDpbWzEyNl0sMjU2XSw2NTM3NTpbWzEwNjI5XSwyNTZdLDY1Mzc2OltbMTA2MzBdLDI1Nl0sNjUzNzc6W1sxMjI5MF0sMjU2XSw2NTM3ODpbWzEyMzAwXSwyNTZdLDY1Mzc5OltbMTIzMDFdLDI1Nl0sNjUzODA6W1sxMjI4OV0sMjU2XSw2NTM4MTpbWzEyNTM5XSwyNTZdLDY1MzgyOltbMTI1MzBdLDI1Nl0sNjUzODM6W1sxMjQ0OV0sMjU2XSw2NTM4NDpbWzEyNDUxXSwyNTZdLDY1Mzg1OltbMTI0NTNdLDI1Nl0sNjUzODY6W1sxMjQ1NV0sMjU2XSw2NTM4NzpbWzEyNDU3XSwyNTZdLDY1Mzg4OltbMTI1MTVdLDI1Nl0sNjUzODk6W1sxMjUxN10sMjU2XSw2NTM5MDpbWzEyNTE5XSwyNTZdLDY1MzkxOltbMTI0ODNdLDI1Nl0sNjUzOTI6W1sxMjU0MF0sMjU2XSw2NTM5MzpbWzEyNDUwXSwyNTZdLDY1Mzk0OltbMTI0NTJdLDI1Nl0sNjUzOTU6W1sxMjQ1NF0sMjU2XSw2NTM5NjpbWzEyNDU2XSwyNTZdLDY1Mzk3OltbMTI0NThdLDI1Nl0sNjUzOTg6W1sxMjQ1OV0sMjU2XSw2NTM5OTpbWzEyNDYxXSwyNTZdLDY1NDAwOltbMTI0NjNdLDI1Nl0sNjU0MDE6W1sxMjQ2NV0sMjU2XSw2NTQwMjpbWzEyNDY3XSwyNTZdLDY1NDAzOltbMTI0NjldLDI1Nl0sNjU0MDQ6W1sxMjQ3MV0sMjU2XSw2NTQwNTpbWzEyNDczXSwyNTZdLDY1NDA2OltbMTI0NzVdLDI1Nl0sNjU0MDc6W1sxMjQ3N10sMjU2XSw2NTQwODpbWzEyNDc5XSwyNTZdLDY1NDA5OltbMTI0ODFdLDI1Nl0sNjU0MTA6W1sxMjQ4NF0sMjU2XSw2NTQxMTpbWzEyNDg2XSwyNTZdLDY1NDEyOltbMTI0ODhdLDI1Nl0sNjU0MTM6W1sxMjQ5MF0sMjU2XSw2NTQxNDpbWzEyNDkxXSwyNTZdLDY1NDE1OltbMTI0OTJdLDI1Nl0sNjU0MTY6W1sxMjQ5M10sMjU2XSw2NTQxNzpbWzEyNDk0XSwyNTZdLDY1NDE4OltbMTI0OTVdLDI1Nl0sNjU0MTk6W1sxMjQ5OF0sMjU2XSw2NTQyMDpbWzEyNTAxXSwyNTZdLDY1NDIxOltbMTI1MDRdLDI1Nl0sNjU0MjI6W1sxMjUwN10sMjU2XSw2NTQyMzpbWzEyNTEwXSwyNTZdLDY1NDI0OltbMTI1MTFdLDI1Nl0sNjU0MjU6W1sxMjUxMl0sMjU2XSw2NTQyNjpbWzEyNTEzXSwyNTZdLDY1NDI3OltbMTI1MTRdLDI1Nl0sNjU0Mjg6W1sxMjUxNl0sMjU2XSw2NTQyOTpbWzEyNTE4XSwyNTZdLDY1NDMwOltbMTI1MjBdLDI1Nl0sNjU0MzE6W1sxMjUyMV0sMjU2XSw2NTQzMjpbWzEyNTIyXSwyNTZdLDY1NDMzOltbMTI1MjNdLDI1Nl0sNjU0MzQ6W1sxMjUyNF0sMjU2XSw2NTQzNTpbWzEyNTI1XSwyNTZdLDY1NDM2OltbMTI1MjddLDI1Nl0sNjU0Mzc6W1sxMjUzMV0sMjU2XSw2NTQzODpbWzEyNDQxXSwyNTZdLDY1NDM5OltbMTI0NDJdLDI1Nl0sNjU0NDA6W1sxMjY0NF0sMjU2XSw2NTQ0MTpbWzEyNTkzXSwyNTZdLDY1NDQyOltbMTI1OTRdLDI1Nl0sNjU0NDM6W1sxMjU5NV0sMjU2XSw2NTQ0NDpbWzEyNTk2XSwyNTZdLDY1NDQ1OltbMTI1OTddLDI1Nl0sNjU0NDY6W1sxMjU5OF0sMjU2XSw2NTQ0NzpbWzEyNTk5XSwyNTZdLDY1NDQ4OltbMTI2MDBdLDI1Nl0sNjU0NDk6W1sxMjYwMV0sMjU2XSw2NTQ1MDpbWzEyNjAyXSwyNTZdLDY1NDUxOltbMTI2MDNdLDI1Nl0sNjU0NTI6W1sxMjYwNF0sMjU2XSw2NTQ1MzpbWzEyNjA1XSwyNTZdLDY1NDU0OltbMTI2MDZdLDI1Nl0sNjU0NTU6W1sxMjYwN10sMjU2XSw2NTQ1NjpbWzEyNjA4XSwyNTZdLDY1NDU3OltbMTI2MDldLDI1Nl0sNjU0NTg6W1sxMjYxMF0sMjU2XSw2NTQ1OTpbWzEyNjExXSwyNTZdLDY1NDYwOltbMTI2MTJdLDI1Nl0sNjU0NjE6W1sxMjYxM10sMjU2XSw2NTQ2MjpbWzEyNjE0XSwyNTZdLDY1NDYzOltbMTI2MTVdLDI1Nl0sNjU0NjQ6W1sxMjYxNl0sMjU2XSw2NTQ2NTpbWzEyNjE3XSwyNTZdLDY1NDY2OltbMTI2MThdLDI1Nl0sNjU0Njc6W1sxMjYxOV0sMjU2XSw2NTQ2ODpbWzEyNjIwXSwyNTZdLDY1NDY5OltbMTI2MjFdLDI1Nl0sNjU0NzA6W1sxMjYyMl0sMjU2XSw2NTQ3NDpbWzEyNjIzXSwyNTZdLDY1NDc1OltbMTI2MjRdLDI1Nl0sNjU0NzY6W1sxMjYyNV0sMjU2XSw2NTQ3NzpbWzEyNjI2XSwyNTZdLDY1NDc4OltbMTI2MjddLDI1Nl0sNjU0Nzk6W1sxMjYyOF0sMjU2XSw2NTQ4MjpbWzEyNjI5XSwyNTZdLDY1NDgzOltbMTI2MzBdLDI1Nl0sNjU0ODQ6W1sxMjYzMV0sMjU2XSw2NTQ4NTpbWzEyNjMyXSwyNTZdLDY1NDg2OltbMTI2MzNdLDI1Nl0sNjU0ODc6W1sxMjYzNF0sMjU2XSw2NTQ5MDpbWzEyNjM1XSwyNTZdLDY1NDkxOltbMTI2MzZdLDI1Nl0sNjU0OTI6W1sxMjYzN10sMjU2XSw2NTQ5MzpbWzEyNjM4XSwyNTZdLDY1NDk0OltbMTI2MzldLDI1Nl0sNjU0OTU6W1sxMjY0MF0sMjU2XSw2NTQ5ODpbWzEyNjQxXSwyNTZdLDY1NDk5OltbMTI2NDJdLDI1Nl0sNjU1MDA6W1sxMjY0M10sMjU2XSw2NTUwNDpbWzE2Ml0sMjU2XSw2NTUwNTpbWzE2M10sMjU2XSw2NTUwNjpbWzE3Ml0sMjU2XSw2NTUwNzpbWzE3NV0sMjU2XSw2NTUwODpbWzE2Nl0sMjU2XSw2NTUwOTpbWzE2NV0sMjU2XSw2NTUxMDpbWzgzNjFdLDI1Nl0sNjU1MTI6W1s5NDc0XSwyNTZdLDY1NTEzOltbODU5Ml0sMjU2XSw2NTUxNDpbWzg1OTNdLDI1Nl0sNjU1MTU6W1s4NTk0XSwyNTZdLDY1NTE2OltbODU5NV0sMjU2XSw2NTUxNzpbWzk2MzJdLDI1Nl0sNjU1MTg6W1s5Njc1XSwyNTZdfVxuXG59O1xuXG4gICAvKioqKiogTW9kdWxlIHRvIGV4cG9ydCAqL1xuICAgdmFyIHVub3JtID0ge1xuICAgICAgbmZjOiBuZmMsXG4gICAgICBuZmQ6IG5mZCxcbiAgICAgIG5ma2M6IG5ma2MsXG4gICAgICBuZmtkOiBuZmtkLFxuICAgfTtcblxuICAgLypnbG9iYWxzIG1vZHVsZTp0cnVlLGRlZmluZTp0cnVlKi9cblxuICAgLy8gQ29tbW9uSlNcbiAgIGlmICh0eXBlb2YgbW9kdWxlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBtb2R1bGUuZXhwb3J0cyA9IHVub3JtO1xuXG4gICAvLyBBTURcbiAgIH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gXCJmdW5jdGlvblwiICYmIGRlZmluZS5hbWQpIHtcbiAgICAgIGRlZmluZShcInVub3JtXCIsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgIHJldHVybiB1bm9ybTtcbiAgICAgIH0pO1xuXG4gICAvLyBHbG9iYWxcbiAgIH0gZWxzZSB7XG4gICAgICByb290LnVub3JtID0gdW5vcm07XG4gICB9XG5cbiAgIC8qKioqKiBFeHBvcnQgYXMgc2hpbSBmb3IgU3RyaW5nOjpub3JtYWxpemUgbWV0aG9kICoqKioqL1xuICAgLypcbiAgICAgIGh0dHA6Ly93aWtpLmVjbWFzY3JpcHQub3JnL2Rva3UucGhwP2lkPWhhcm1vbnk6c3BlY2lmaWNhdGlvbl9kcmFmdHMjbm92ZW1iZXJfOF8yMDEzX2RyYWZ0X3Jldl8yMVxuXG4gICAgICAyMS4xLjMuMTIgU3RyaW5nLnByb3RvdHlwZS5ub3JtYWxpemUoZm9ybT1cIk5GQ1wiKVxuICAgICAgV2hlbiB0aGUgbm9ybWFsaXplIG1ldGhvZCBpcyBjYWxsZWQgd2l0aCBvbmUgYXJndW1lbnQgZm9ybSwgdGhlIGZvbGxvd2luZyBzdGVwcyBhcmUgdGFrZW46XG5cbiAgICAgIDEuIExldCBPIGJlIENoZWNrT2JqZWN0Q29lcmNpYmxlKHRoaXMgdmFsdWUpLlxuICAgICAgMi4gTGV0IFMgYmUgVG9TdHJpbmcoTykuXG4gICAgICAzLiBSZXR1cm5JZkFicnVwdChTKS5cbiAgICAgIDQuIElmIGZvcm0gaXMgbm90IHByb3ZpZGVkIG9yIHVuZGVmaW5lZCBsZXQgZm9ybSBiZSBcIk5GQ1wiLlxuICAgICAgNS4gTGV0IGYgYmUgVG9TdHJpbmcoZm9ybSkuXG4gICAgICA2LiBSZXR1cm5JZkFicnVwdChmKS5cbiAgICAgIDcuIElmIGYgaXMgbm90IG9uZSBvZiBcIk5GQ1wiLCBcIk5GRFwiLCBcIk5GS0NcIiwgb3IgXCJORktEXCIsIHRoZW4gdGhyb3cgYSBSYW5nZUVycm9yIEV4Y2VwdGlvbi5cbiAgICAgIDguIExldCBucyBiZSB0aGUgU3RyaW5nIHZhbHVlIGlzIHRoZSByZXN1bHQgb2Ygbm9ybWFsaXppbmcgUyBpbnRvIHRoZSBub3JtYWxpemF0aW9uIGZvcm0gbmFtZWQgYnkgZiBhcyBzcGVjaWZpZWQgaW4gVW5pY29kZSBTdGFuZGFyZCBBbm5leCAjMTUsIFVuaWNvZGVOb3JtYWxpemF0b2luIEZvcm1zLlxuICAgICAgOS4gUmV0dXJuIG5zLlxuXG4gICAgICBUaGUgbGVuZ3RoIHByb3BlcnR5IG9mIHRoZSBub3JtYWxpemUgbWV0aG9kIGlzIDAuXG5cbiAgICAgICpOT1RFKiBUaGUgbm9ybWFsaXplIGZ1bmN0aW9uIGlzIGludGVudGlvbmFsbHkgZ2VuZXJpYzsgaXQgZG9lcyBub3QgcmVxdWlyZSB0aGF0IGl0cyB0aGlzIHZhbHVlIGJlIGEgU3RyaW5nIG9iamVjdC4gVGhlcmVmb3JlIGl0IGNhbiBiZSB0cmFuc2ZlcnJlZCB0byBvdGhlciBraW5kcyBvZiBvYmplY3RzIGZvciB1c2UgYXMgYSBtZXRob2QuXG4gICAqL1xuICAgaWYgKCFTdHJpbmcucHJvdG90eXBlLm5vcm1hbGl6ZSkge1xuICAgICAgU3RyaW5nLnByb3RvdHlwZS5ub3JtYWxpemUgPSBmdW5jdGlvbihmb3JtKSB7XG4gICAgICAgICB2YXIgc3RyID0gXCJcIiArIHRoaXM7XG4gICAgICAgICBmb3JtID0gIGZvcm0gPT09IHVuZGVmaW5lZCA/IFwiTkZDXCIgOiBmb3JtO1xuXG4gICAgICAgICBpZiAoZm9ybSA9PT0gXCJORkNcIikge1xuICAgICAgICAgICAgcmV0dXJuIHVub3JtLm5mYyhzdHIpO1xuICAgICAgICAgfSBlbHNlIGlmIChmb3JtID09PSBcIk5GRFwiKSB7XG4gICAgICAgICAgICByZXR1cm4gdW5vcm0ubmZkKHN0cik7XG4gICAgICAgICB9IGVsc2UgaWYgKGZvcm0gPT09IFwiTkZLQ1wiKSB7XG4gICAgICAgICAgICByZXR1cm4gdW5vcm0ubmZrYyhzdHIpO1xuICAgICAgICAgfSBlbHNlIGlmIChmb3JtID09PSBcIk5GS0RcIikge1xuICAgICAgICAgICAgcmV0dXJuIHVub3JtLm5ma2Qoc3RyKTtcbiAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcihcIkludmFsaWQgbm9ybWFsaXphdGlvbiBmb3JtOiBcIiArIGZvcm0pO1xuICAgICAgICAgfVxuICAgICAgfTtcbiAgIH1cbn0odGhpcykpO1xuIl19
(2)
});
