'use strict';

var Promise = require('promise'),
    request = require('superagent'),
    legacyIESupport = require('./superagent-legacyIESupport'),
    _syncRequest = require('sync-request/browser.js');

function contentType(body) {
    if (typeof body === 'object') {
        return 'application/json';
    } else {
        // by default, superagent puts application/x-www-form-urlencoded for strings
        return 'application/octet-stream';
    }
}

function wrapOptions(options) {
    if (typeof options === 'string') {
        return {
            method: 'GET',
            url: options
        };
    }
    return options;
}

// type RequestOptions = {
//   url :: String
//   method :: String
//   body :: Optional (Object | String)
// }

/**
 * @param {RequestOptions} options
 * @return {Promise} resolves with the superagent response body
 */
function promiseRequest(options) {
    options = wrapOptions(options);

    return new Promise(function (resolve, reject) {
        request(options.method, options.url)
            .use(legacyIESupport)
            .type(contentType(options.body || ''))
            .send(options.body || '')
            .end(function (err, res) {
                if (!err && !res.ok) {
                    if (res.body && res.body.error) {
                        err = new Error(res.body.error);
                    } else {
                        err = new Error('Request failed');
                    }
                }
                if (err) {
                    reject(err);
                } else {
                    resolve(res.body || res.text);
                }
            });
    });
}

/**
 * Send a blocking request. Throws errors if request returns status >= 300.
 *
 * @param {RequestOptions} options
 * @return {Object} JSON-parsed body of the response
 * @throws {Error} on any request error
 */
function syncRequest(options) {
    options = wrapOptions(options);

    var res = _syncRequest(options.method, options.url, {
        json: options.body
    });

    var body = res.getBody();   // throws error
    var json;
    try {
        json = JSON.parse(body);
    } catch (e) {
        json = body;
    }

    return json;
}

module.exports = promiseRequest;
module.exports.sync = syncRequest;
