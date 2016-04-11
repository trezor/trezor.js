/* @flow */
'use strict';

import {EventEmitter} from './events';
import {Event1} from './flow-events';
import PluginTransport from './transport/plugin';

import type {Transport, DeviceDescriptor} from './transport';

export type DeviceDescriptorDiff = {
    connected: Array<DeviceDescriptor>,
    disconnected: Array<DeviceDescriptor>,
    changedSessions: Array<DeviceDescriptor>,
    acquired: Array<DeviceDescriptor>,
    released: Array<DeviceDescriptor>,
    didUpdate: boolean,
    descriptors: Array<DeviceDescriptor>
};

export default class DescriptorStream extends EventEmitter {

    transport: Transport;
    listening: boolean = false;
    previous: ?Array<DeviceDescriptor> = null;

    errorEvent: Event1<Error> = new Event1('error', this);
    connectEvent: Event1<DeviceDescriptor> = new Event1('connect', this);
    disconnectEvent: Event1<DeviceDescriptor> = new Event1('disconnect', this);
    acquiredEvent: Event1<DeviceDescriptor> = new Event1('acquired', this);
    releasedEvent: Event1<DeviceDescriptor> = new Event1('released', this);
    changedSessionsEvent: Event1<DeviceDescriptor> = new Event1('changedSessions', this);
    updateEvent: Event1<DeviceDescriptorDiff> = new Event1('update', this);

    constructor(transport: Transport) {
        super('descriptor-stream');
        this.transport = transport;
    }

    listen() {
        // if we are not enumerating for the first time, we can let
        // the transport to block until something happens
        const supportsWaiting = !(this.transport instanceof PluginTransport);
        const waitForEvent = supportsWaiting && this.previous !== null;

        this.listening = true;
        const previous = this.previous || [];
        this.transport.enumerate(waitForEvent, previous).then(descriptors => {
            if (!this.listening) {  // do not continue if stop() was called
                return;
            }

            this._reportChanges(this._diff(descriptors));
            this.previous = descriptors;

            if (this.listening) {   // handlers might have called stop()
                this.listen();
            }
            return;
        }).catch(error => {
            this.errorEvent.emit(error);
        });
    }

    stop() {
        this.listening = false;
    }

    _diff(descriptors: Array<DeviceDescriptor>): DeviceDescriptorDiff {
        const previous = this.previous || [];
        console.log('[trezor.js descriptor-stream] _diff', descriptors, previous);
        const connected = descriptors.filter(d => {
            return previous.find(x => {
                return x.path === d.path;
            }) === undefined;
        });
        const disconnected = previous.filter(d => {
            return descriptors.find(x => {
                return x.path === d.path;
            }) === undefined;
        });
        const changedSessions = descriptors.filter(d => {
            const previousDescriptor = previous.find(x => {
                return x.path === d.path;
            });
            if (previousDescriptor !== undefined) {
                return (previousDescriptor.session !== d.session);
            } else {
                return false;
            }
        });
        const acquired = changedSessions.filter(descriptor => {
            return descriptor.session != null;
        });
        const released = changedSessions.filter(descriptor => {
            return descriptor.session == null;
        });
        console.log('[trezor.js descriptor-stream] _diff changedSessions ', changedSessions, acquired, released);

        const didUpdate = (connected.length + disconnected.length + changedSessions.length) > 0;

        return {
            connected: connected,
            disconnected: disconnected,
            changedSessions: changedSessions,
            acquired: acquired,
            released: released,
            didUpdate: didUpdate,
            descriptors: descriptors,
        };
    }

    _reportChanges(diff: DeviceDescriptorDiff) {
        this.previous = diff.descriptors;

        if (diff.didUpdate) {
            diff.connected.forEach(d => {
                this.connectEvent.emit(d);
            });
            diff.disconnected.forEach(d => {
                this.disconnectEvent.emit(d);
            });
            diff.acquired.forEach(d => {
                this.acquiredEvent.emit(d);
            });
            diff.released.forEach(d => {
                this.releasedEvent.emit(d);
            });
            diff.changedSessions.forEach(d => {
                this.changedSessionsEvent.emit(d);
            });
            this.updateEvent.emit(diff);
        }
    }
}
