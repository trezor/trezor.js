/* @flow */

// Simple wrapper for typechecking events
// see: https://github.com/runn1ng/flow-events
'use strict';

const events = require('events');
const EventEmitter = events.EventEmitter;

export class Event0 {
    type: string;
    parent: EventEmitter;
    constructor(type: string, parent: EventEmitter) {
        this.type = type;
        this.parent = parent;
    }
    on(listener: () => any) {
        this.parent.on(this.type, listener);
    }
    once(listener: () => any) {
        this.parent.once(this.type, listener);
    }
    removeListener(listener: () => any) {
        this.parent.removeListener(this.type, listener);
    }
    removeAllListeners() {
        this.parent.removeAllListeners(this.type);
    }
    emit(): boolean {
        return this.parent.emit(this.type);
    }
    listenerCount(): number {
        return this.parent.listenerCount(this.type);
    }
}

export class Event1<T1> {
    type: string;
    parent: EventEmitter;
    constructor(type: string, parent: EventEmitter) {
        this.type = type;
        this.parent = parent;
    }
    on(listener: (arg1: T1) => any) {
        this.parent.on(this.type, listener);
    }
    once(listener: (arg1: T1) => any) {
        this.parent.once(this.type, listener);
    }
    removeListener(listener: (arg1: T1) => any) {
        this.parent.removeListener(this.type, listener);
    }
    removeAllListeners() {
        this.parent.removeAllListeners(this.type);
    }
    emit(arg1: T1): boolean {
        return this.parent.emit(this.type, arg1);
    }
    listenerCount(): number {
        return this.parent.listenerCount(this.type);
    }
}

export class Event2<T1, T2> {
    type: string;
    parent: EventEmitter;
    constructor(type: string, parent: EventEmitter) {
        this.type = type;
        this.parent = parent;
    }
    on(listener: (arg1: T1, arg2: T2) => any) {
        this.parent.on(this.type, listener);
    }
    once(listener: (arg1: T1, arg2: T2) => any) {
        this.parent.once(this.type, listener);
    }
    removeListener(listener: (arg1: T1, arg2: T2) => any) {
        this.parent.removeListener(this.type, listener);
    }
    removeAllListeners() {
        this.parent.removeAllListeners(this.type);
    }
    emit(arg1: T1, arg2: T2): boolean {
        return this.parent.emit(this.type, arg1, arg2);
    }
    listenerCount(): number {
        return this.parent.listenerCount(this.type);
    }
}
