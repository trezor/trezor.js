'use strict';

var Promise = require('promise');
var ChromeMessages = require('../chrome-messages');

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
                console.log('[trezor] Loaded Chrome Extension transport');
                return transport;
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

ChromeExtensionTransport.prototype.udevStatus = function () {
    return this._send({type:'udevStatus'});
};

ChromeExtensionTransport.prototype.configure = function (config) {
    return this._send({
        type: 'configure',
        body: config
    });
};

ChromeExtensionTransport.prototype.enumerate = function (wait) {
    var type = wait ? 'listen' : 'enumerate';
    return this._send({
        type: type
    });
};

ChromeExtensionTransport.prototype.acquire = function (device) {
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
