/* @flow */
import HttpTransport from './http';
import ChromeExtensionTransport from './chrome-extension';
import PluginTransport from './plugin';

import http from '../http';

import type {Transport} from '../flowtypes';

// Attempts to load any available HW transport layer.
export function loadTransport(): Promise<Transport> {
    const ch: Promise<Transport> = ChromeExtensionTransport.create();
    const h: Promise<Transport> = ch.catch(() => {
        return HttpTransport.create();
    });
    const p: Promise<Transport> = h.catch(() => {
        return PluginTransport.create();
    });
    return p;
}

// Configures transport with config downloaded from url.
export function configureTransport(transport: Transport, url: string): Promise {
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
export function initTransport(options: {configUrl?: string} = {}): Promise<Transport> {
    const configUrl: string = options.configUrl == null ? CONFIG_URL : options.configUrl;

    return loadTransport().then((t) =>
        configureTransport(t, configUrl)
    );
}

function withTimestamp(url: string): string {
    return url + '?' + new Date().getTime();
}
