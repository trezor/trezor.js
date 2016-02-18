/* @flow */
'use strict';

import * as bitcoin from 'bitcoinjs-lib';
import * as types from '../flowtypes';
import * as hdnodeUtils from './hdnode';

export default function wrapLoadDevice(
    settings: types.LoadDeviceSettings,
    network_?: bitcoin.Network
): types.LoadDeviceSettings {
    const sett: types.LoadDeviceSettings = Object.assign({}, settings);
    const network: bitcoin.Network = network_ == null ? bitcoin.networks.bitcoin : network_;

    if (sett.node == null && sett.mnemonic == null) {
        const payload = sett.payload;
        if (payload == null) {
            throw new Error('Payload, mnemonic or node necessary.');
        }

        try { // try to decode as xprv
            const bjsNode: bitcoin.HDNode = bitcoin.HDNode.fromBase58(payload, network);
            sett.node = hdnodeUtils.bjsNode2privNode(bjsNode);
        } catch (e) {
            sett.mnemonic = sett.payload;
        }
        delete sett.payload;
    }
    return sett;
}

