'use strict';

var extend = require('extend'),
    http = require('../http');

var DEFAULT_URL = 'https://localback.net:21324';

//
// HTTP transport.
//
var HttpTransport = function (url) {
    url = url || DEFAULT_URL;
    this._url = url;
};

HttpTransport.create = function (url) {
    url = url || DEFAULT_URL;
    console.log('[trezor] Attempting to load HTTP transport at', url);
    return HttpTransport.status(url).then(
        function (info) {
            console.log('[trezor] Loaded HTTP transport', info);
            return new HttpTransport(url);
        },
        function (error) {
            console.warn('[trezor] Failed to load HTTP transport', error);
            throw error;
        }
    );
};

HttpTransport.status = function (url) {
    url = url || DEFAULT_URL;
    return http({
        method: 'GET',
        url: url
    });
};

// @deprecated
HttpTransport.connect = HttpTransport.status;

HttpTransport.prototype._request = function (options) {
    return http(extend(options, {
        url: this._url + options.url
    }));
};

HttpTransport.prototype.configure = function (config) {
    return this._request({
        method: 'POST',
        url: '/configure',
        body: config
    });
};

HttpTransport.prototype.enumerate = function (wait) {
    return this._request({
        method: 'GET',
        url: wait ? '/listen' : '/enumerate'
    });
};

HttpTransport.prototype.acquire = function (device) {
    return this._request({
        method: 'POST',
        url: '/acquire/' + device.path
    });
};

HttpTransport.prototype.release = function (sessionId) {
    return this._request({
        method: 'POST',
        url: '/release/' + sessionId
    });
};

HttpTransport.prototype.call = function (sessionId, type, message) {
    return this._request({
        method: 'POST',
        url: '/call/' + sessionId,
        body: {
            type: type,
            message: message
        }
    });
};

module.exports = HttpTransport;
