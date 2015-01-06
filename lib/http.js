var Promise = require('promise'),
    request = require('superagent');

function contentType(body) {
    if (typeof body === 'object') {
        return 'application/json';
    } else {
        // by default, superagent puts application/x-www-form-urlencoded for strings
        return 'application/octet-stream';
    }
}

function promiseRequest(options) {
    if (typeof options === 'string') {
        options = {
            method: 'GET',
            url: options
        }
    };
    return new Promise(function (resolve, reject) {
        request(options.method, options.url)
            .type(contentType(options.body || ''))
            .send(options.body || '')
            .end(function (res) {
                if (res.ok) {
                    resolve(res.body || res.text);
                } else {
                    if (res.body && res.body.error) {
                        reject(new Error(res.body.error));
                    } else {
                        reject(new Error('Request failed'));
                    }
                }
            });
    });
}

module.exports = promiseRequest;
