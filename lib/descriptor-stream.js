/* @flow */
'use strict';

import {EventEmitter} from './events';
import PluginTransport from './transport/plugin';

import type {Transport, DeviceDescriptor, DeviceDescriptorDiff} from './flowtypes';

export default class DescriptorStream extends EventEmitter {

    transport: Transport;
    listening: boolean;
    previous: ?Array<DeviceDescriptor>;

    constructor(transport: Transport) {
        super();
        this.transport = transport;
        this.listening = false;
        this.previous = null;
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
            this.emit('error', error);
        });
    }

    stop() {
        this.listening = false;
    }

    _diff(descriptors: Array<DeviceDescriptor>): DeviceDescriptorDiff {
        const previous = this.previous || [];
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
                this.emit('connect', d);
            });
            diff.disconnected.forEach(d => {
                this.emit('disconnect', d);
            });
            diff.acquired.forEach(d => {
                this.emit('acquired', d);
            });
            diff.released.forEach(d => {
                this.emit('released', d);
            });
            diff.changedSessions.forEach(d => {
                this.emit('changedSessions', d);
            });
            this.emit('update', diff);
        }
    }
}
