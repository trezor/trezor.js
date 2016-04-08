/* @flow */
import HttpTransport from './http';
import ChromeExtensionTransport from './chrome-extension';
import PluginTransport from './plugin';
import http from '../http';

import type {DefaultMessageResponse} from '../session';

export type DeviceDescriptor = {
    path: (string | number);
    session: ?(string|number);
    product: number;
    serialNumber: number;
    vendor: number;
};

export type Transport = {
    enumerate: (wait?: boolean, previous?: ?Array<DeviceDescriptor>) => Promise<Array<DeviceDescriptor>>;
    acquire: (i: DeviceDescriptor, checkPrevious?: boolean) => Promise<{session: (string|number)}>;
    supportsSync: boolean;
    release: (s: (string|number)) => Promise;
    releaseSync: (s: (string|number)) => void;
    configure: (s: string) => Promise;
    call: (s: (string|number), type: string, msg: Object) => Promise<DefaultMessageResponse>;
    callSync: (s: (string|number), type: string, msg: Object) => DefaultMessageResponse;
    version: string;
    configured: boolean;
};

// Attempts to load any available HW transport layer.
export function loadTransport(bridgeUrl?: string, bridgeVersionUrl?: string): Promise<Transport> {
    const ch: Promise<Transport> = ChromeExtensionTransport.create();
    const h: Promise<Transport> = ch.catch(() => {
        return HttpTransport.create(bridgeUrl, bridgeVersionUrl);
    });
    const p: Promise<Transport> = h.catch(() => {
        return PluginTransport.create();
    });
    return p.catch(() => { throw new Error('No transport installed.'); });
}

// Configures transport with config downloaded from url.
export function configureTransport(transport: Transport, url: string): Promise<mixed> {
    return http(withTimestamp(url))
        .then((c) => {
            if (typeof c === 'string') {
                return transport.configure(c);
            } else {
                throw new Error('JSON object on URL ' + url);
            }
        });
}

const CONFIG_URL = 'https://mytrezor.s3.amazonaws.com/plugin/config_signed.bin';

// Loads and configures the HW transport layer.
export function initTransport(options: {configUrl?: string, config?: string, bridgeVersionUrl?: string} = {}): Promise<Transport> {
    // const configUrl: string = options.configUrl == null ? CONFIG_URL : options.configUrl;

    return loadTransport(null, options.bridgeVersionUrl).then((t) => {
        if (options.config != null) {
            return t.configure(options.config);
        } else {
            const configUrl: string = options.configUrl == null ? CONFIG_URL : options.configUrl;
            return configureTransport(t, configUrl).then(() => t);
        }
    });
}

function withTimestamp(url: string): string {
    return url + '?' + new Date().getTime();
}
