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
        }
    };
    return options;
}


/**
 * Input:
 *  - options: info about URL, body, etc, in object form
 *      - more exactly should have method, url, body
 * Output:
 *  - promise, that resolves with the JSON-parsed result of the request, and rejects with error
 *                  - parsing is done by super-agent
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
 * Request in a synchronized way
 *
 * Use only when *really* needed - blocks browser
 *
 * In myTREZOR it is used only on onbeforeunload
 *
 * Returns text of response. Throws errors if request returns status >= 300
 *
 * Input:
 *  - options: info about URL, body, etc, in object form
 *      - more exactly should have method, url, body
 * Output:
 *  - JSON-parsed result of the request (error is not returned, it is thrown)
 */
function syncRequest(options) {
    options = wrapOptions(options);
    var res = _syncRequest(options.method, options.url, {
        json: options.body
    });

    //this can throw error but we don't catch it
    var body = res.getBody();
    var res;
    try {
        res = JSON.parse(body);
    } catch(e) {
        res = body;
    }
    return res;
}


module.exports = promiseRequest;
module.exports.sync = syncRequest;
