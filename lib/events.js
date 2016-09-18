'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


// avoids a bug in flowtype: https://github.com/facebook/flow/issues/545

const events = require('events');
const EventEmitterOut = events.EventEmitter;

class EventEmitter extends EventEmitterOut {}
exports.EventEmitter = EventEmitter;