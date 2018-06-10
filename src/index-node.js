/* @flow */
'use strict';

import 'unorm';

import link from 'trezor-link';
import DeviceList from './device-list';

const {BridgeV1, BridgeV2, Fallback} = link;

export {default as Session} from './session';
export {default as UnacquiredDevice} from './unacquired-device';
export {default as Device} from './device';
export {default as DescriptorStream} from './descriptor-stream';
export {default as DeviceList} from './device-list';

const fetch = require('node-fetch');
DeviceList._setTransport(() => new Fallback([new BridgeV2(), new BridgeV1()]));
DeviceList._setNode(true);

import {setFetch as installersSetFetch} from './installers';
const myFetch = typeof window === 'undefined' ? fetch : window.fetch;
DeviceList._setFetch(myFetch);
installersSetFetch(myFetch);

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

// exporting only for correct Flow checks
export function setSharedWorkerFactory(swf: ?() => ?SharedWorker) {}
