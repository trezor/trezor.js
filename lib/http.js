var Promise = require('promise'),
    request = require('browser-request');

function promiseRequest(options, payload) {
    return new Promise(function (resolve, reject) {
        request(options, function (err, response, body) {
            if (err) {
                reject(err);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error('Request failed with status '
                                 + response.statusCode));
            }

            resolve(body);
        });
    });
}

module.exports = promiseRequest;
