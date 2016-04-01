/* @flow */
'use strict';

const _syncRequest = require('sync-request/browser.js');

export type RequestOptions = {
    body?: any; // should be Object | string; but in flow, Array is not Object
    url: string;
    method?: 'POST' | 'GET';
};

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
    .then(res => res.text().then(resText => {
        if (res.ok) {
            return parseResult(resText);
        } else {
            const resJson = parseResult(resText);
            if (resJson.error) {
                throw new Error(resJson.error);
            } else {
                throw new Error(resText);
            }
        }
    }));
}

// Send a blocking request. Throws errors if request returns status >= 300.
request.sync = function (options: RequestOptions | string): mixed {
    options = wrapOptions(options);

    const res = _syncRequest(options.method, options.url, {
        json: options.body,
    });

    return parseResult(res.getBody());   // throws error
};
