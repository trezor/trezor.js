/* @flow weak*/
'use strict';

var extend = require('extend');
import http from '../http';
var semvercmp = require('../semvercmp');

var DEFAULT_URL = 'https://localback.net:21324';

//
// HTTP transport.
//
export default function HttpTransport(url, info) {
    url = url || DEFAULT_URL;
    this._url = url;
    this.version = info.version;
};

HttpTransport.prototype.supportsSync = true;

HttpTransport.create = function (url) {
    url = url || DEFAULT_URL;
    console.log('[trezor] Attempting to load HTTP transport at', url);
    return HttpTransport.status(url).then(
        function (info) {
            console.log('[trezor] Loaded HTTP transport', info);
            return new HttpTransport(url, info);
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

/**
 * @deprecated
 */
HttpTransport.connect = HttpTransport.status;

HttpTransport.prototype._extendOptions = function (options) {
    return extend(options, {
        url: this._url + options.url
    });
};

/**
 * @see http()
 */
HttpTransport.prototype._request = function (options) {
    return http(this._extendOptions(options));
};

/**
 * @see http.sync()
 */
HttpTransport.prototype._requestSync = function (options) {
    return http.sync(this._extendOptions(options));
};

HttpTransport.prototype.configure = function (config) {
    return this._request({
        method: 'POST',
        url: '/configure',
        body: config
    });
};

HttpTransport.prototype.enumerate = function (wait, previous) {

    if (wait && (previous != null) && (semvercmp(this.version, '1.1.3') >= 0)) {
        return this._request({
            method: 'POST',
            url: '/listen',
            body: previous
        });
    }

    return this._request({
        method: 'GET',
        url: wait ? '/listen' : '/enumerate'
    });
};

HttpTransport.prototype.acquire = function (device, checkPrevious) {
    if (checkPrevious && (semvercmp(this.version, '1.1.3') >= 0)) {
        var previousStr = device.session == null ? 'null' : device.session;
        var url = '/acquire/' + device.path + '/' + previousStr;
        return this._request({
            method: 'POST',
            url: url
        });
    }

    return this._request({
        method: 'POST',
        url: '/acquire/' + device.path
    });
};

function releaseOptions(sessionId) {
    return {
        method: 'POST',
        url: '/release/' + sessionId
    };
}

HttpTransport.prototype.release = function (sessionId) {
    return this._request(releaseOptions(sessionId));
};

HttpTransport.prototype.releaseSync = function (sessionId) {
    return this._requestSync(releaseOptions(sessionId));
};

function callOptions(sessionId, type, message) {
    return {
        method: 'POST',
        url: '/call/' + sessionId,
        body: {
            type: type,
            message: message
        }
    };
}

HttpTransport.prototype.call = function (sessionId, type, message) {
    return this._request(callOptions(sessionId, type, message));
};

// Be careful! Blocks the browser thread.
HttpTransport.prototype.callSync = function (sessionId, type, message) {
    return this._requestSync(callOptions(sessionId, type, message));
};

