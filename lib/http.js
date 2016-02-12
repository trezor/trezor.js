/* @flow */
'use strict';

// This file basically reimplements fetch
// It should go away, but it stays here for backwards compatibility

var _syncRequest = require('sync-request/browser.js');

function contentType(body: Object | string): string {
    if (typeof body === 'object') {
        return 'application/json';
    } else {
        // by default, superagent puts application/x-www-form-urlencoded for strings
        return 'application/octet-stream';
    }
}

function wrapBody(body: ?(Object | string)): ?string {
    if (typeof body === 'object') {
        return JSON.stringify(body);
    } else {
        return body;
    }
}

type RequestOptions = {
    body?: Object | string;
    url: string;
    method?: 'POST' | 'GET';
};

function wrapOptions(options: RequestOptions | string): RequestOptions {
    if (typeof options === 'string') {
        return {
            method: 'GET',
            url: options,
        };
    }
    return options;
}

function parseResult(text: string): Object | string {
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

export default function request(options_: RequestOptions | string): Promise<Object | string> {
    const options = wrapOptions(options_);

    return fetch(options.url, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': contentType(options.body || ''),
        },
        body: wrapBody(options.body),
    })
    .then(res => res.text())
    .then(res => parseResult(res));
}

// Send a blocking request. Throws errors if request returns status >= 300.
request.sync = function (options: RequestOptions | string): Object | string {
    options = wrapOptions(options);

    var res = _syncRequest(options.method, options.url, {
        json: options.body,
    });

    return parseResult(res.getBody());   // throws error
};
