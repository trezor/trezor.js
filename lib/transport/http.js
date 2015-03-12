'use strict';

var extend = require('extend');
var http = require('../http');

var DEFAULT_URL = 'https://localback.net:21324';

//
// HTTP transport.
//
var HttpTransport = function (url) {
    url = url || DEFAULT_URL;
    this._url = url;
};

HttpTransport.prototype.supportsSync = true;

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

HttpTransport.prototype._extendOptions = function (options) {
    return extend(options, {
        url: this._url + options.url
    });
}

/**
 * Input:
 *  - options: info about URL, body, etc, in object form
 *      - more exactly should have method, url, body
 * Output:
 *  - promise, that resolves with the JSON-parsed result of the request, and rejects with error
 */
HttpTransport.prototype._request = function (options) {
    return http(this._extendOptions(options));
};


/**
 * Input:
 *  - options: info about URL, body, etc, in object form
 *      - more exactly should have method, url, body
 * Output:
 *  - JSON-parsed result of the request (error is not returned, it is thrown)
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

/**
 * Input:
 *  - sessionId is a number of session
 *  - type: string with type of message (for example, "PassphraseAck")
 *  - message: object with some more options (for example, {passphrase: MY_SECRET_PASSPHRASE}
 * Output:
 *  - promise, that resolves with the JSON-parsed result of the request, and rejects with error
 */
HttpTransport.prototype.call = function (sessionId, type, message) {
    return this._request(callOptions(sessionId, type, message));
};


/**
 * Input:
 *  - sessionId is a number of session
 *  - type: string with type of message (for example, "PassphraseAck")
 *  - message: object with some more options (for example, {passphrase: MY_SECRET_PASSPHRASE}
 * Output:
 *  - JSON-parsed result of the request (error is not returned, it is thrown)
 */
HttpTransport.prototype.callSync = function (sessionId, type, message) {
    return this._requestSync(callOptions(sessionId, type, message));
};

module.exports = HttpTransport;
