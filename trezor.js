var trezor = (function () {

//
// Bare-bones promise implementation
//
// License: MIT
// Copyright (c) 2013 Forbes Lindesay
// https://github.com/then/promise
//

var Promise = (function () {

    'use strict'

    // var asap = require('asap')
    var asap = function(fn) { setTimeout(fn, 0) }

    function Promise(fn) {
      if (!(this instanceof Promise)) return new Promise(fn)
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

    return Promise;

}());

//
// Hex codec
//
var Hex = (function () {

    'use strict';

    // Encode binary string to hex string
    function encode(bin) {
        var i, chr, hex = '';

        for (i = 0; i < bin.length; i++) {
            chr = (bin.charCodeAt(i) & 0xFF).toString(16);
            hex += chr.length < 2 ? '0' + chr : chr;
        }

        return hex;
    }

    // Decode hex string to binary string
    function decode(hex) {
        var i, bytes = [];

        for (i = 0; i < hex.length - 1; i += 2)
            bytes.push(parseInt(hex.substr(i, 2), 16));

        return String.fromCharCode.apply(String, bytes);
    }

    return {
        encode: encode,
        decode: decode
    };

}());

//
// Takes care of injecting the trezor plugin into the webpage.
//
var BrowserPlugin = (function () {

    'use strict';

    var PLUGIN_ID = '__trezor-plugin',
        PLUGIN_CALLBACK = '__trezorPluginLoaded',
        PLUGIN_MIMETYPE = 'application/x-bitcointrezorplugin';

    var PLUGIN_DOWNLOAD_URLS = {
        win: 'https://mytrezor.com/data/plugin/BitcoinTrezorPlugin-latest.msi',
        mac: 'https://mytrezor.com/data/plugin/BitcoinTrezorPlugin-latest.dmg',
        deb: 'https://mytrezor.com/data/plugin/BitcoinTrezorPlugin-latest.deb',
        rpm: 'https://mytrezor.com/data/plugin/BitcoinTrezorPlugin-latest.rpm'
    };

    var loaded = null,
        waiting, timer;

    // Load trezor browser plugin, optionally with a timeout.
    // In case plugin is not found, calls errback with an err and
    // the install fn.
    function load(callback, errback, timeout){

        if (loaded)
            return callback(loaded);

        if (waiting)
            return errback(new Error('Already being loaded'));

        waiting = { // register callbacks
            callback: callback,
            errback: errback
        };
        inject(PLUGIN_ID, PLUGIN_MIMETYPE, PLUGIN_CALLBACK, timeout);
    }

    // Injects browser plugin into the webpage, using provided params.
    // callback is a _global_ function name!
    function inject(id, mimetype, callback, timeout) {

        var loadFn = function () {
                resolve(null, document.getElementById(id));
            },
            timeoutFn = function () {
                var err = new Error('Loading timed out');
                err.install = install;
                resolve(err);
            };

        var body = document.getElementsByTagName('body')[0],
            elem = document.createElement('div');

        navigator.plugins.refresh(false); // refresh installed plugins

        // register load cb, inject <object>
        window[callback] = loadFn;
        body.appendChild(elem);
        elem.innerHTML =
            '<object width="1" height="1" id="'+id+'" type="'+mimetype+'">'+
            ' <param name="onload" value="'+callback+'" />'+
            '</object>';

        if (timeout && !installed(PLUGIN_MIMETYPE)) // register timeout cb
            timer = setTimeout(timeoutFn, timeout);
    }

    // Resolves the plugin loading process, either with an error
    // or a plugin object.
    function resolve(err, plugin) {

        if (!waiting) return;

        var callback = waiting.callback,
            errback = waiting.errback;

        if (timer) clearTimeout(timer);
        timer = waiting = null;

        if (err || !plugin || !plugin.version)
            if (errback)
                return errback(err);

        loaded = plugin;
        if (callback)
            callback(plugin);
    }

    // Returns true if plugin with a given mimetype is installed.
    function installed(mimetype) {
        return !!navigator.mimeTypes[mimetype];
    }

    // Promps a download dialog for the user.
    function install() {
        var body = document.getElementsByTagName('body')[0],
            elem = document.createElement('div');

        body.appendChild(elem);
        elem.innerHTML =
            '<div id="__trezor-install" style="'+
            '   width: 440px;'+
            '   position: absolute; top: 50%; right: 50%;'+
            '   margin: -125px -220px 0 0; padding: 10px 30px 30px;'+
            '   box-shadow: 3px 3px 0 3px rgba(0, 0, 0, 0.2);'+
            '   background: #f6f6f6; color: #222;'+
            '   font-family: Helvetica, Arial, sans-serif; font-size: 16px;'+
            '   ">'+
            ' <h1 style="'+
            '   margin: 20px 0;'+
            '   font-size: 28px; letter-spacing: 0px;'+
            '   color: #444; font-weight: 100;'+
            '   ">Bitcoin Trezor Plugin</h1>'+
            ' <p style="margin-bottom: 20px; line-height: 1.55">To use the Web Wallet, please download and install the Bitcoin Trezor Plugin.</p>'+
            ' <a href="" id="__trezor-install-button" style="'+
            '   display: inline-block;'+
            '   padding: 13px 23px; margin-right: 20px;'+
            '   text-decoration: none;'+
            '   background: #97bf0f; color: #fff;'+
            '   font-weight: bold;'+
            '   box-shadow: 2px 2px 0 1px rgba(0, 0, 0, 0.1)'+
            '   ">Download</a>'+
            ' <select id="__trezor-install-select" style="'+
            '   font-size: 16px;'+
            '   ">'+
            '  <option value="win"'+(sys==='win'?' selected':'')+'>for Windows</option>'+
            '  <option value="mac"'+(sys==='mac'?' selected':'')+'>for Mac OS X</option>'+
            '  <option value="deb"'+(sys==='linux'?' selected':'')+'>for Linux (deb)</option>'+
            '  <option value="rpm">for Linux (rpm)</option>'+
            ' </select>'+
            '</div>';

        var button = document.getElementById('__trezor-install-button'),
            select = document.getElementById('__trezor-install-select');

        var assign_ = bind(select, 'change', assign);

        var opts = ['win', 'mac', 'deb', 'rpm'],
            sys = system();

        if (sys) {
            select.selectedIndex = opts.indexOf(sys);
            assign();
        }

        function assign() {
            var opt = select.options[select.selectedIndex];
            button.href = PLUGIN_DOWNLOAD_URLS[opt.value];
        }

        // Binds the event handler. Returns a thunk for unbinding.
        function bind(el, ev, fn) {
            if (el.addEventListener)
                el.addEventListener(ev, fn, false);
            else
                el.attachEvent('on' + ev, fn);

            return function () { unbind(el, ev, fn); };
        }

        // Unbinds the event handler.
        function unbind(el, ev, fn) {
            if (el.removeEventListener)
                el.removeEventListener(ev, fn, false);
            else
                el.detachEvent('on' + ev, fn);
        }
    }

    // Detects the OS.
    function system() {
        var ver = navigator.appVersion;

        if (ver.match(/Win/)) return 'win';
        if (ver.match(/Mac/)) return 'mac';
        if (ver.match(/Linux/)) return 'linux';
    }

    return {
        load: load,
        install: install
    };

}());

//
// Trezor API module
//
var TrezorApi = function(Promise) {

    'use strict';

    var DEFAULT_URL = 'https://mytrezor.com/plugin/config_signed.bin';

    //
    // Trezor
    //
    var Trezor = function (plugin, url) {
        this._plugin = plugin;
        this._configure(url || DEFAULT_URL);
    };

    // Downloads configuration from given url in blocking way and
    // configures the plugin.
    // Throws on error.
    Trezor.prototype._configure = function (url) {
        var req = new XMLHttpRequest(),
            time = new Date().getTime();

        req.open('get', url + '?' + time, false);
        req.send();

        if (req.status !== 200)
            throw Error('Failed to load configuration');

        this._plugin.configure(req.responseText);
    };

    // Returns the plugin version.
    Trezor.prototype.version = function () {
        return this._plugin.version;
    };

    // Returns the list of connected Trezor devices.
    Trezor.prototype.devices = function () {
        return this._plugin.devices();
    };

    // BIP32 CKD
    Trezor.prototype.deriveChildNode = function (node, n) {
        var child = this._plugin.deriveChildNode(node, n);
        child.path = node.path.concat([n]);
        return child;
    };

    // Opens a given device and returns a Session object.
    Trezor.prototype.open = function (device, on) {
        return new Session(this._plugin, device, on);
    };

    //
    // Trezor device session handle.
    //
    // Handlers:
    //  receive: function (type, message)
    //  error: function (error)
    //  button: function (code)
    //  pin: function (message, callback)
    //  passphrase: function (callback)
    //  word: function (callback)
    //
    var Session = function (plugin, device, on) {
        this._plugin = plugin;
        this._device = device;
        this._on = on || {};
    };

    // Closes the session and the HID device.
    Session.prototype.close = function () {
        var self = this;

        return new Promise(function (resolve, reject) {
            self._log('Closing');
            self._plugin.close(self._device, {
                success: resolve,
                error: reject
            });
        });
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
        });
    };

    Session.prototype.getPublicKey = function (address_n) {
        return this._typedCommonCall('GetPublicKey', 'PublicKey', {
            address_n: address_n
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

    Session.prototype.eraseFirmware = function () {
        return this._commonCall('FirmwareErase');
    };

    Session.prototype.uploadFirmware = function (payload) {
        return this._commonCall('FirmwareUpload', {
            payload: payload
        });
    };

    Session.prototype.measureTx = function (inputs, outputs, coin) {
        return this._typedCommonCall('EstimateTxSize', 'TxSize', {
            inputs_count: inputs.length,
            outputs_count: outputs.length,
            coin_name: coin.coin_name
        });
    };

    Session.prototype.simpleSignTx = function (inputs, outputs, coin, transactions) {
        return this._typedCommonCall('SimpleSignTx', 'TxRequest', {
            inputs: inputs,
            outputs: outputs,
            coin_name: coin.coin_name,
            transactions: transactions
        });
    };

    Session.prototype.signTx = function (inputs, outputs, coin) {
        var self = this,
            signatures = [],
            serializedTx = '',
            signTx = {
                inputs_count: inputs.length,
                outputs_count: outputs.length,
                coin_name: coin.coin_name
            };

        return this._typedCommonCall('SignTx', 'TxRequest', signTx).then(process);

        function process(res) {
            var m = res.message;

            if (m.serialized_tx)
                serializedTx += m.serialized_tx;

            if (m.signature && m.signed_index >= 0)
                signatures[m.signed_index] = m.signature;

            if (m.request_index < 0)
                return {
                    signatures: signatures,
                    serializedTx: serializedTx
                };

            if (m.request_type == 'TXINPUT')
                return self._typedCommonCall('TxInput', 'TxRequest', {
                    input: inputs[m.request_index]
                }).then(process);
            else
                return self._typedCommonCall('TxOutput', 'TxRequest', {
                    output: outputs[m.request_index]
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
            if (this._on.button)
                this._on.button(res.message.code);
            return this._commonCall('ButtonAck');
        }

        if (res.type === 'EntropyRequest')
            return this._commonCall('EntropyAck', {
                entropy: Hex.encode(this._generateEntropy(256))
            });

        if (res.type === 'PinMatrixRequest')
            return this._promptPin(res.message.message).then(
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
                    passphrase = unescape(encodeURIComponent(passphrase)); // encode to UTF-8
                    return self._commonCall('PassphraseAck', {
                        passphrase: Hex.encode(passphrase)
                    });
                },
                function () {
                    return self._commonCall('Cancel');
                }
            );

        if (res.type === 'WordRequest')
            return this._promptWord().then(
                function (word) {
                    word = unescape(encodeURIComponent(word)); // encode to UTF-8
                    return self._commonCall('WordAck', {
                        word: Hex.encode(word)
                    });
                },
                function () {
                    return self._commonCall('Cancel');
                }
            );

        return res;
    };

    Session.prototype._promptPin = function (message) {
        var self = this;

        return new Promise(function (resolve, reject) {
            var fn = self._on.pin || function (message, callback) {
                self._log('PIN callback not configured, cancelling request');
                callback(null);
            };
            fn(message, function (pin) {
                if (pin)
                    resolve(pin);
                else
                    reject();
            });
        });
    };

    Session.prototype._promptPassphrase = function () {
        var self = this;

        return new Promise(function (resolve, reject) {
            var fn = self._on.passphrase || function (callback) {
                self._log('Passphrase callback not configured, cancelling request');
                callback(null);
            };
            fn(function (passphrase) {
                if (passphrase)
                    resolve(passphrase);
                else
                    reject();
            });
        });
    };

    Session.prototype._promptWord = function () {
        var self = this;

        return new Promise(function (resolve, reject) {
            var fn = self._on.word || function (callback) {
                self._log('Word callback not configured, cancelling request');
                callback(null);
            };
            fn(function (word) {
                if (word)
                    resolve(word);
                else
                    reject();
            });
        });
    };

    Session.prototype._generateEntropy = function (len) {
        if (window.crypto)
            return this._generateCryptoEntropy(len);
        else
            return this._generatePseudoEntropy(len);
    };

    Session.prototype._generateCryptoEntropy = function (len) {
        var arr = new Uint8Array(len);

        window.crypto.getRandomValues(arr);

        return String.fromCharCode.apply(String, arr);
    };

    Session.prototype._generatePseudoEntropy = function (len) {
        var arr = [],
            i;

        for (i = 0; i < len; i++)
            arr[i] = Math.floor(Math.random() * 255);

        return String.fromCharCode.apply(String, arr);
    };

    Session.prototype._call = function (type, msg) {
        var self = this,
            timeout = this._timeoutForType(type);

        msg = msg || {};

        return new Promise(function (resolve, reject) {
            self._log('Sending:', type, msg);
            self._plugin.call(self._device, timeout, type, msg, {
                success: function (t, m) {
                    self._log('Received:', t, m);
                    if (self._on.receive)
                        self._on.receive(t, m);
                    resolve({
                        type: t,
                        message: m
                    });
                },
                error: function (err) {
                    self._log('Received error:', err);
                    if (self._on.error)
                        self._on.error(err);
                    reject(new Error(err));
                }
            });
        });
    };

    Session.prototype._timeoutForType = function (type) {
        var noTimeoutTypes = ['PinMatrixAck', 'PassphraseAck', 'ButtonAck'];
        return noTimeoutTypes.indexOf(type) < 0;
    };

    Session.prototype._log = function () {
        if (!console || !console.log)
            return;
        [].unshift.call(arguments, '[trezor]');
        if (console.log.apply)
            console.log.apply(console, arguments);
        else
            console.log(arguments);
    };

    return {
        Trezor: Trezor
    };

}(Promise);

// Loads the plugin.
// options = { timeout, configUrl }
function load(options) {
    'use strict';

    options = options || {};
    return new Promise(function (resolve, reject) {
        BrowserPlugin.load(resolve, reject, options.timeout || 500);
    }).then(function (plugin) {
        return new TrezorApi.Trezor(plugin, options.configUrl);
    });
}

return {
    Hex: Hex,
    TrezorApi: TrezorApi,
    BrowserPlugin: BrowserPlugin,
    load: load
};

}({}));
