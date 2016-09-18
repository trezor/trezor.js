

// Simple wrapper for typechecking events
// see: https://github.com/runn1ng/flow-events
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
const events = require('events');
const EventEmitter = events.EventEmitter;

class Event0 {
    constructor(type, parent) {
        this.type = type;
        this.parent = parent;
    }
    on(listener) {
        this.parent.on(this.type, listener);
    }
    once(listener) {
        this.parent.once(this.type, listener);
    }
    removeListener(listener) {
        this.parent.removeListener(this.type, listener);
    }
    removeAllListeners() {
        this.parent.removeAllListeners(this.type);
    }
    emit() {
        return this.parent.emit(this.type);
    }
    listenerCount() {
        return this.parent.listenerCount(this.type);
    }
}

exports.Event0 = Event0;
class Event1 {
    constructor(type, parent) {
        this.type = type;
        this.parent = parent;
    }
    on(listener) {
        this.parent.on(this.type, listener);
    }
    once(listener) {
        this.parent.once(this.type, listener);
    }
    removeListener(listener) {
        this.parent.removeListener(this.type, listener);
    }
    removeAllListeners() {
        this.parent.removeAllListeners(this.type);
    }
    emit(arg1) {
        return this.parent.emit(this.type, arg1);
    }
    listenerCount() {
        return this.parent.listenerCount(this.type);
    }
}

exports.Event1 = Event1;
class Event2 {
    constructor(type, parent) {
        this.type = type;
        this.parent = parent;
    }
    on(listener) {
        this.parent.on(this.type, listener);
    }
    once(listener) {
        this.parent.once(this.type, listener);
    }
    removeListener(listener) {
        this.parent.removeListener(this.type, listener);
    }
    removeAllListeners() {
        this.parent.removeAllListeners(this.type);
    }
    emit(arg1, arg2) {
        return this.parent.emit(this.type, arg1, arg2);
    }
    listenerCount() {
        return this.parent.listenerCount(this.type);
    }
}
exports.Event2 = Event2;