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
    supportsSync: boolean = false;
    version: string = '';
    configured: boolean = false;
    lastUdevStatus: string = 'hide';

    constructor(id: string = EXTENSION_ID) {
        this._id = id;
    }

    static create(id: string = EXTENSION_ID): Promise<ChromeExtensionTransport> {
        console.log('[trezor.js] [chrome-extension] Attempting to load Chrome Extension transport at', id);
        return ChromeMessages.exists()
            .then((): ChromeExtensionTransport => new ChromeExtensionTransport(id))
            .then((transport) =>
                transport._ping().then(() =>
                    transport._info().then(
                        (info) => {
                            transport.version = info.version;
                            transport.configured = info.configured;
                        },
                        () => {
                            transport.version = '1.0.0';
                            transport.configured = false;
                        }
                    )
                ).then(() => transport)
            )
            .then((transport) => {
                console.log('[trezor.js] [chrome-extension] Loaded Chrome Extension transport');
                return transport;
            }, (error) => {
                console.warn('[trezor.js] [chrome-extension] Failed to load Chrome Extension transport', error);
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

    _info(): Promise<{version: string, configured: boolean}> {
        return this._send({
            type: 'info',
        }).then(res => checkInfo(res));
    }

    udevStatus(): Promise<'display' | 'hide'> {
        return this._send({
            type: 'udevStatus',
        }).then(res => checkUdevStatus(res)).then(res => {
            this.lastUdevStatus = res;
            return res;
        });
    }

    configure(config: string): Promise<void> {
        return this._send({
            type: 'configure',
            body: config,
        }).then(() => {return;});
    }

    enumerate(wait?: boolean, previous?: ?Array<DeviceDescriptor>): Promise<Array<DeviceDescriptor>> {
        const type = wait ? 'listen' : 'enumerate';
        // previous can be null and will always be with enumerate
        return this._send({
            type: type,
            body: previous,
        }).then(res => checkEnumerate(res));
    }

    acquire(device: DeviceDescriptor, checkPrevious?: boolean): Promise<{session: (string|number)}> {
        let resP = Promise.resolve();

        if (checkPrevious && (semvercmp(this.version, '1.0.6') >= 0)) {
            resP = this._send({
                type: 'acquire',
                body: {
                    path: device.path,
                    previous: device.session,
                },
            });
        } else {
            resP = this._send({
                type: 'acquire',
                body: device.path,
            });
        }

        return resP.then(res => {
            return checkAcquire(res);
        }).then(r => {
            return this.udevStatus().then(() => {
                return r;
            });
        }, err => {
            return this.udevStatus().then(() => {
                throw err;
            });
        });
    }

    call(sessionId: string|number, type: string, message: Object): Promise<DefaultMessageResponse> {
        return this._send({
            type: 'call',
            body: {
                id: sessionId,
                type: type,
                message: message,
            },
        })
        .then(res => checkCall(res))
        .then(r => {
            return this.udevStatus().then(() => r);
        }, err => {
            return this.udevStatus().then(() => {
                throw err;
            });
        });
    }

    release(sessionId: string|number): Promise<void> {
        return this._send({
            type: 'release',
            body: sessionId,
        }).then(() => {return;});
    }

    callSync(s: string|number, type: string, msg: Object): DefaultMessageResponse {
        throw new Error('Not supported');
    }

    releaseSync(s: string|number): void {
        throw new Error('Not supported');
    }
}
