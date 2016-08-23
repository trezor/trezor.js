'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.EventEmitter = undefined;

var _events = require('events');

class EventEmitter extends _events.EventEmitter {}
exports.EventEmitter = EventEmitter;

// avoids a bug in flowtype: https://github.com/facebook/flow/issues/545