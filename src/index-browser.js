/* @flow */
'use strict';

import 'whatwg-fetch';
import 'unorm';

import link from 'trezor-link';
import DeviceList from './device-list';

const {BridgeV2, Lowlevel, WebUsb, Fallback} = link;

export {default as Session} from './session';
export {default as UnacquiredDevice} from './unacquired-device';
export {default as Device} from './device';
export {default as DescriptorStream} from './descriptor-stream';
export {default as DeviceList} from './device-list';

let sharedWorkerFactory: ?() => ?SharedWorker = null;
export function setSharedWorkerFactory(swf: ?() => ?SharedWorker) {
    sharedWorkerFactory = swf;
}

function sharedWorkerFactoryWrap() {
    if (sharedWorkerFactory == null) {
        return null;
    } else {
        return sharedWorkerFactory();
    }
}

DeviceList._setNode(false);

DeviceList._setTransport(() => new Fallback([
    new BridgeV2(),
    new Lowlevel(
        new WebUsb(),
        () => sharedWorkerFactoryWrap()
    ),
]));

import {setFetch as installersSetFetch} from './installers';
DeviceList._setFetch(window.fetch);
installersSetFetch(window.fetch);

export {
    installers,
    latestVersion,
    udevInstallers,
} from './installers';

export type {
    Features,
    LoadDeviceSettings,
    ResetDeviceSettings,
    RecoverDeviceSettings,
} from './trezortypes';

export type {
    BridgeInstaller,
    UdevInstaller,
} from './installers';

export type {
    TxInfo as TransactionToSign,
    OutputInfo as OutputToSign,
    InputInfo as InputToSign,
} from './utils/signbjstx';

export type {
    RunOptions,
} from './device';
