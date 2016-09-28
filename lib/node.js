'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _index = require('./index.js');

Object.keys(_index).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _index[key];
    }
  });
});

var _lowlevel = require('trezor-link/lib/lowlevel');

var _lowlevel2 = _interopRequireDefault(_lowlevel);

var _nodeHid = require('trezor-link/lib/lowlevel/node-hid');

var _nodeHid2 = _interopRequireDefault(_nodeHid);

var _installers = require('./installers');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var fetch = require('node-fetch');

_index.DeviceList._setNode(_lowlevel2.default, _nodeHid2.default, fetch);

(0, _installers.setFetch)(fetch);