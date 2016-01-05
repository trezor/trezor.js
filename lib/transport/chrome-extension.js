'use strict';

var Promise = require('promise');
var ChromeMessages = require('../chrome-messages');
var semvercmp = require('./semvercmp');

var EXTENSION_ID = 'jcjjhjgimijdkoamemaghajlhegmoclj';

var ChromeExtensionTransport = function (id) {
    id = id || EXTENSION_ID;
    this._id = id;
};

ChromeExtensionTransport.prototype.supportsSync = false;

ChromeExtensionTransport.create = function (id) {
    id = id || EXTENSION_ID;
    console.log('[trezor] Attempting to load Chrome Extension transport at', id);
    return ChromeMessages.exists()
        .then(function () {
            return new ChromeExtensionTransport(id);
        })
        .then(function (transport) {
            return transport._ping().then(function () {
                return transport._info().then(function (info) {
                    transport.version = info.version;
                }, function(error) {
                    // maybe old version with no "version" message
                    transport.version = "1.0.0";
                }).then(function(){
                    console.log('[trezor] Loaded Chrome Extension transport');
                    return transport;
                });
            });
        }).catch(function (error) {
            console.warn('[trezor] Failed to load Chrome Extension transport', error);
            throw error;
        });
};

ChromeExtensionTransport.prototype._send = function (message) {
    return ChromeMessages.send(this._id, message);
};

ChromeExtensionTransport.prototype._ping = function () {
    return this._send({
        type: 'ping'
    }).then(function (response) {
        if (response !== 'pong') {
            throw Error('Response to "ping" should be "pong".');
        }
        return true;
    });
};

ChromeExtensionTransport.prototype._info = function () {
    return this._send({
        type: 'info'
    })
};

ChromeExtensionTransport.prototype.udevStatus = function () {
    return this._send({type:'udevStatus'});
};

ChromeExtensionTransport.prototype.configure = function (config) {
    return this._send({
        type: 'configure',
        body: config
    });
};

ChromeExtensionTransport.prototype.enumerate = function (wait, previous) {
    var type = wait ? 'listen' : 'enumerate';
    // previous can be null and will always be with enumerate
    return this._send({
        type: type,
        body: previous 
    });
};

ChromeExtensionTransport.prototype.acquire = function (device, checkPrevious) {
    if (checkPrevious && (semvercmp(this.version, "1.0.6") >= 0)) {
        return this._send({
            type: 'acquire',
            body: {
              path: device.path,
              previous: device.session
            }
        });
    }

    return this._send({
        type: 'acquire',
        body: device.path
    });
};

ChromeExtensionTransport.prototype.call = function (sessionId, type, message) {
    return this._send({
        type: 'call',
        body: {
            id: sessionId,
            type: type,
            message: message
        }
    });
};

ChromeExtensionTransport.prototype.release = function (sessionId) {
    return this._send({
        type: 'release',
        body: sessionId
    });
};

module.exports = ChromeExtensionTransport;
