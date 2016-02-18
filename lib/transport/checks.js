/* @flow */
'use strict';

import type {
    DefaultMessageResponse,
    DeviceDescriptor,
} from '../flowtypes';

export function checkEnumerate(res: mixed): Array<DeviceDescriptor> {
    if (typeof res !== 'object') {
        throw new Error('Wrong result type.');
    }
    if (!(res instanceof Array)) {
        throw new Error('Wrong result type.');
    }
    return res.map(o => {
        return {path: o.path, session: o.session};
    });
}

export function checkAcquire(res: mixed): {session: string} {
    if (typeof res !== 'object' || res == null) {
        throw new Error('Wrong result type.');
    }
    return {session: res.session};
}

export function checkCall(res: mixed): DefaultMessageResponse {
    if (typeof res !== 'object' || res == null) {
        throw new Error('Wrong result type.');
    }
    const type = res.type;
    if (typeof type !== 'string') {
        throw new Error('Wrong result type.');
    }
    const message = res.message;
    if (typeof message !== 'object') {
        throw new Error('Wrong result type.');
    }
    return {type, message};
}

export function checkInfo(res: mixed): {version: string} {
    if (typeof res !== 'object' || res == null) {
        throw new Error('Wrong result type.');
    }
    if (res.version == null) {
        throw new Error('Wrong result type.');
    }
    return {version: res.version};
}

