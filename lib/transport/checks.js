/* @flow */
'use strict';

import type {DeviceDescriptor} from '../transport';
import type {DefaultMessageResponse} from '../session';

export function checkEnumerate(res: mixed): Array<DeviceDescriptor> {
    if (typeof res !== 'object') {
        throw new Error('Wrong result type.');
    }
    if (!(res instanceof Array)) {
        throw new Error('Wrong result type.');
    }
    return res.map((o: Object): DeviceDescriptor => {
        return {
            path: o.path,
            session: o.session,
            product: o.product,
            serialNumber: o.serialNumber,
            vendor: o.vendor,
        };
    });
}

export function checkAcquire(res: mixed): {session: string} {
    if (typeof res !== 'object' || res == null) {
        throw new Error('Wrong result type.');
    }
    const session = res.session;
    if (typeof session !== 'string' && typeof session !== 'number') {
        throw new Error('Wrong result type.');
    }
    return {session: session.toString()};
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
    if (typeof message !== 'object' || message == null) {
        throw new Error('Wrong result type.');
    }
    return {type, message};
}

export function checkInfo(res: mixed): {version: string} {
    if (typeof res !== 'object' || res == null) {
        throw new Error('Wrong result type.');
    }
    const version = res.version;
    if (typeof version !== 'string') {
        throw new Error('Wrong result type.');
    }
    return {version};
}

