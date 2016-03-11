/* @flow */
'use strict';

import * as bitcoin from 'bitcoinjs-lib';
import * as trezor from '../trezortypes';
import * as hdnodeUtils from './hdnode';

export default function wrapLoadDevice(
    settings: trezor.LoadDeviceSettings,
    network?: bitcoin.Network = bitcoin.networks.bitcoin
): trezor.LoadDeviceSettings {
    if (settings.node == null && settings.mnemonic == null) {
        if (settings.payload == null) {
            throw new Error('Payload, mnemonic or node necessary.');
        }
        try { // try to decode as xprv
            const bjsNode = bitcoin.HDNode.fromBase58(settings.payload, network);
            settings = { ...settings, node: hdnodeUtils.bjsNode2privNode(bjsNode) };
        } catch (e) { // use as mnemonic
            settings = { ...settings, mnemonic: settings.payload };
        }
        delete settings.payload;
    }
    return settings;
}
