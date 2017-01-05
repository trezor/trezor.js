/* @flow */
'use strict';

import 'whatwg-fetch';
import 'unorm';

import link from 'trezor-link';
import DeviceList from './device-list';

const {Bridge, Extension, Lowlevel, WebUsb, Fallback} = link;

export {default as Session} from './session';
export {default as UnacquiredDevice} from './unacquired-device';
export {default as Device} from './device';
export {default as DescriptorStream} from './descriptor-stream';
export {default as DeviceList} from './device-list';

DeviceList._setTransport(() => new Fallback([new Extension(), new Bridge(), new Lowlevel(new WebUsb())]));

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
    CoinType,
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
