/* @flow weak*/
'use strict';

var _syncRequest = require('sync-request/browser.js');

function contentType(body) {
    if (typeof body === 'object') {
        return 'application/json';
    } else {
        // by default, superagent puts application/x-www-form-urlencoded for strings
        return 'application/octet-stream';
    }
}

function wrapBody(body) {
    if (typeof body === 'object') {
        return JSON.stringify(body);
    } else {
        return body;
    }
}

function wrapOptions(options) {
    if (typeof options === 'string') {
        return {
            method: 'GET',
            url: options,
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
export default function request(options) {
    options = wrapOptions(options);

    return fetch(options.url, {
        method: options.method,
        headers: {
            'Content-Type': contentType(options.body || ''),
        },
        body: wrapBody(options.body),
    }).then(res => res.text());
}

/**
 * Send a blocking request. Throws errors if request returns status >= 300.
 *
 * @param {RequestOptions} options
 * @return {Object} JSON-parsed body of the response
 * @throws {Error} on any request error
 */
request.sync = function (options) {
    options = wrapOptions(options);

    var res = _syncRequest(options.method, options.url, {
        json: options.body,
    });

    var body = res.getBody();   // throws error
    var json;
    try {
        json = JSON.parse(body);
    } catch (e) {
        json = body;
    }

    return json;
};
