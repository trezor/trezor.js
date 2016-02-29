/* @flow */
'use strict';

// This file basically reimplements fetch
// It should go away, but it stays here for backwards compatibility

const _syncRequest = require('sync-request/browser.js');

import type {RequestOptions} from './flowtypes';

function contentType(body: any): string {
    if (typeof body === 'string') {
        // by default, superagent puts application/x-www-form-urlencoded for strings
        return 'application/octet-stream';
    } else {
        return 'application/json';
    }
}

function wrapBody(body: any): ?string {
    if (typeof body === 'string') {
        return body;
    } else {
        return JSON.stringify(body);
    }
}

function wrapOptions(options: RequestOptions | string): RequestOptions {
    if (typeof options === 'string') {
        return {
            method: 'GET',
            url: options,
        };
    }
    return options;
}

function parseResult(text: string): mixed {
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

export default function request(options_: RequestOptions | string): Promise<mixed> {
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
request.sync = function (options: RequestOptions | string): mixed {
    options = wrapOptions(options);

    const res = _syncRequest(options.method, options.url, {
        json: options.body,
    });

    return parseResult(res.getBody());   // throws error
};
