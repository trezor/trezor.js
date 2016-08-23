/* @flow */

export * from './index.js';

import {DeviceList} from './index.js';

import LowlevelTransport from 'trezor-link/lib/lowlevel';
import NodeHidPlugin from 'trezor-link/lib/lowlevel/node-hid';
const fetch = require('node-fetch');

DeviceList._setNode(LowlevelTransport, NodeHidPlugin, fetch);

import {setFetch} from './installers';
setFetch(fetch);
