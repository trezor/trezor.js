/* @flow */
'use strict';

import semvercmp from 'semver-compare';

import http from '../http';
import * as installers from '../installers';
import {
    checkAcquire,
    checkEnumerate,
    checkCall,
    checkInfo,
} from './checks';

import type {DefaultMessageResponse} from '../session';
import type {RequestOptions} from '../http';
import type {DeviceDescriptor} from '../transport';

const DEFAULT_URL = 'https://localback.net:21324';

//
// HTTP transport.
//

export default class HttpTransport {
    url: string;
    version: string;
    configured: boolean;
    supportsSync: boolean = true;
    isOutdated: boolean;

    constructor(url?: string = DEFAULT_URL, info: { version: string, configured: boolean }) {
        this.url = url;
        this.version = info.version;
        this.configured = info.configured;
    }

    static create(url?: string = DEFAULT_URL, bridgeVersionUrl?: string): Promise<HttpTransport> {
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
        ).then(transport => {
            return installers.latestVersionAsync({bridgeUrl: bridgeVersionUrl}).then(version => {
                const isOutdated = semvercmp(transport.version, version) < 0;
                transport.isOutdated = isOutdated;
                return transport;
            }, () => {
                // latest.txt CORS error shouldn't bring trezor.js down :/
                return transport;
            });
        });
    }

    // deprecated
    static connect(url?: string = DEFAULT_URL): Promise<mixed> {
        return HttpTransport.status(url);
    }

    static status(url?: string = DEFAULT_URL): Promise<mixed> {
        return http({ method: 'GET', url });
    }

    _request(options: RequestOptions): Promise<mixed> {
        return http({ ...options, url: this.url + options.url });
    }

    _requestSync(options: RequestOptions): mixed {
        return http.sync({ ...options, url: this.url + options.url });
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

    acquire(device: DeviceDescriptor, checkPrevious?: boolean): Promise<{session: (string | number)}> {
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

    release(sessionId: string|number): Promise {
        return this._request(releaseOptions(sessionId));
    }

    releaseSync(sessionId: string|number): void {
        this._requestSync(releaseOptions(sessionId));
    }

    call(sessionId: string|number, type: string, message: Object): Promise<DefaultMessageResponse> {
        return this._request(callOptions(sessionId, type, message))
            .then(r => checkCall(r))
            .catch(err => {
                err.transportError = true;
                throw err;
            });
    }

    // Be careful! Blocks the browser thread.
    callSync(sessionId: string|number, type: string, message: Object): DefaultMessageResponse {
        return checkCall(this._requestSync(callOptions(sessionId, type, message)));
    }
}

function releaseOptions(sessionId: string|number): RequestOptions {
    return {
        method: 'POST',
        url: '/release/' + sessionId,
    };
}

function callOptions(sessionId: string|number, type: string, message: Object): RequestOptions {
    return {
        method: 'POST',
        url: '/call/' + sessionId,
        body: {
            type: type,
            message: message,
        },
    };
}
