/* @flow */
'use strict';

import semvercmp from 'semver-compare';
import * as ChromeMessages from '../chrome-messages';

import type {DefaultMessageResponse} from '../session';
import type {DeviceDescriptor} from '../transport';
import type {ChromeMessage} from '../chrome-messages';

import {
    checkEnumerate,
    checkAcquire,
    checkCall,
    checkInfo,
} from './checks';

const EXTENSION_ID: string = 'jcjjhjgimijdkoamemaghajlhegmoclj';

function checkPing(res: mixed): boolean {
    if (res !== 'pong') {
        throw Error('Response to "ping" should be "pong".');
    }
    return true;
}

function checkUdevStatus(res: mixed): 'display' | 'hide' {
    if (typeof res !== 'string') {
        throw new Error('Wrong result type.');
    }
    if (res === 'display') {
        return res;
    }
    if (res === 'hide') {
        return res;
    }
    throw new Error('Wrong result type.');
}

export default class ChromeExtensionTransport {
    _id: string;
    supportsSync: boolean;
    version: string;

    constructor(id: string) {
        this._id = id || EXTENSION_ID;
        this.supportsSync = false;
        this.version = '';
    }

    static create(id: string = EXTENSION_ID): Promise<ChromeExtensionTransport> {
        console.log('[trezor] Attempting to load Chrome Extension transport at', id);
        return ChromeMessages.exists()
            .then((): ChromeExtensionTransport => new ChromeExtensionTransport(id))
            .then((transport) =>
                transport._ping().then(() =>
                    transport._info().then(
                        (info) => {
                            transport.version = info.version;
                        },
                        () => {
                            transport.version = '1.0.0';
                        }
                    )
                ).then(() => transport)
            )
            .then((transport) => {
                console.log('[trezor] Loaded Chrome Extension transport');
                return transport;
            }, (error) => {
                console.warn('[trezor] Failed to load Chrome Extension transport', error);
                throw error;
            });
    }

    _send(message: ChromeMessage): Promise<mixed> {
        return ChromeMessages.send(this._id, message);
    }

    _ping(): Promise<boolean> {
        return this._send({
            type: 'ping',
        }).then(response => checkPing(response));
    }

    _info(): Promise<{version: string}> {
        return this._send({
            type: 'info',
        }).then(res => checkInfo(res));
    }

    udevStatus(): Promise<'display' | 'hide'> {
        return this._send({
            type: 'udevStatus',
        }).then(res => checkUdevStatus(res));
    }

    configure(config: string): Promise {
        return this._send({
            type: 'configure',
            body: config,
        });
    }

    enumerate(wait?: boolean, previous?: ?Array<DeviceDescriptor>): Promise<Array<DeviceDescriptor>> {
        const type = wait ? 'listen' : 'enumerate';
        // previous can be null and will always be with enumerate
        return this._send({
            type: type,
            body: previous,
        }).then(res => checkEnumerate(res));
    }

    acquire(device: DeviceDescriptor, checkPrevious?: boolean): Promise<{session: string}> {
        if (checkPrevious && (semvercmp(this.version, '1.0.6') >= 0)) {
            return this._send({
                type: 'acquire',
                body: {
                    path: device.path,
                    previous: device.session,
                },
            }).then(res => checkAcquire(res));
        }

        return this._send({
            type: 'acquire',
            body: device.path,
        }).then(res => checkAcquire(res));
    }

    call(sessionId: string, type: string, message: Object): Promise<DefaultMessageResponse> {
        return this._send({
            type: 'call',
            body: {
                id: sessionId,
                type: type,
                message: message,
            },
        })
        .then(res => checkCall(res))
        .catch(err => {
            err.transportError = true;
            throw err;
        });
    }

    release(sessionId: string): Promise {
        return this._send({
            type: 'release',
            body: sessionId,
        });
    }

    callSync(s: string, type: string, msg: Object): DefaultMessageResponse {
        throw new Error('Not supported');
    }

    releaseSync(s: string): void {
        throw new Error('Not supported');
    }
}
