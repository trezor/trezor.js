/* @flow */
'use strict';

import semvercmp from 'semver-compare';

import http from '../http';
import {
    checkAcquire,
    checkEnumerate,
    checkCall,
    checkInfo,
} from './checks';

import type {
  RequestOptions,
  DeviceDescriptor,
  DefaultMessageResponse,
} from '../flowtypes';

const DEFAULT_URL = 'https://localback.net:21324';

//
// HTTP transport.
//

export default class HttpTransport {
    _url: string;
    version: string;
    supportsSync: boolean;

    constructor(url: ?string, info: {version: string}) {
        this._url = url || DEFAULT_URL;
        this.version = info.version;

        this.supportsSync = true;
    }

    static create(url_?: string): Promise<HttpTransport> {
        const url: string = url_ || DEFAULT_URL;
        console.log('[trezor] Attempting to load HTTP transport at', url);
        return HttpTransport.status(url).then(
            (info) => {
                console.log('[trezor] Loaded HTTP transport', info);
                return new HttpTransport(url, checkInfo(info));
            },
            (error) => {
                console.warn('[trezor] Failed to load HTTP transport', error);
                throw error;
            }
        );
    }

    // just does GET with the given URL
    static status(url_?: string): Promise<mixed> {
        const url: string = url_ || DEFAULT_URL;
        return http({
            method: 'GET',
            url: url,
        });
    }

    // deprecated
    static connect(url?: string): Promise<mixed> {
        return HttpTransport.status(url);
    }

    _extendOptions(options: RequestOptions): RequestOptions {
        const url = this._url + options.url;
        return { ...options, url };
    }

    _request(options: RequestOptions): Promise<mixed> {
        return http(this._extendOptions(options));
    }

    _requestSync(options: RequestOptions): mixed {
        return http.sync(this._extendOptions(options));
    }

    configure(config: string): Promise {
        return this._request({
            method: 'POST',
            url: '/configure',
            body: config,
        });
    }

    enumerate(wait?: boolean, previous?: ?Array<DeviceDescriptor>): Promise<Array<DeviceDescriptor>> {
        if (wait && (previous != null) && (semvercmp(this.version, '1.1.3') >= 0)) {
            return this._request({
                method: 'POST',
                url: '/listen',
                body: previous,
            }).then(r => checkEnumerate(r));
        }

        return this._request({
            method: 'GET',
            url: wait ? '/listen' : '/enumerate',
        }).then(r => checkEnumerate(r));
    }

    acquire(device: DeviceDescriptor, checkPrevious?: boolean): Promise<{session: string}> {
        if (checkPrevious && (semvercmp(this.version, '1.1.3') >= 0)) {
            const previousStr = device.session == null ? 'null' : device.session;
            const url = '/acquire/' + device.path + '/' + previousStr;
            return this._request({
                method: 'POST',
                url: url,
            }).then(r => checkAcquire(r));
        }

        return this._request({
            method: 'POST',
            url: '/acquire/' + device.path,
        }).then(r => checkAcquire(r));
    }

    release(sessionId: string): Promise {
        return this._request(releaseOptions(sessionId));
    }

    releaseSync(sessionId: string): void {
        this._requestSync(releaseOptions(sessionId));
    }

    call(sessionId: string, type: string, message: Object): Promise<DefaultMessageResponse> {
        return this._request(callOptions(sessionId, type, message)).then(r => checkCall(r));
    }

    // Be careful! Blocks the browser thread.
    callSync(sessionId: string, type: string, message: Object): DefaultMessageResponse {
        return checkCall(this._requestSync(callOptions(sessionId, type, message)));
    }
}

function releaseOptions(sessionId: string): RequestOptions {
    return {
        method: 'POST',
        url: '/release/' + sessionId,
    };
}

function callOptions(sessionId: string, type: string, message: Object): RequestOptions {
    return {
        method: 'POST',
        url: '/call/' + sessionId,
        body: {
            type: type,
            message: message,
        },
    };
}
