/* @flow */
'use strict';

import {EventEmitter} from './events';
import {Event1} from './flow-events';

import {lock} from './utils/connectionLock';

import type {Transport, TrezorDeviceInfoWithSession as DeviceDescriptor} from 'trezor-link';

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
    current: Array<DeviceDescriptor> = [];

    errorEvent: Event1<Error> = new Event1('error', this);
    connectEvent: Event1<DeviceDescriptor> = new Event1('connect', this);
    disconnectEvent: Event1<DeviceDescriptor> = new Event1('disconnect', this);
    acquiredEvent: Event1<DeviceDescriptor> = new Event1('acquired', this);
    releasedEvent: Event1<DeviceDescriptor> = new Event1('released', this);
    changedSessionsEvent: Event1<DeviceDescriptor> = new Event1('changedSessions', this);
    updateEvent: Event1<DeviceDescriptorDiff> = new Event1('update', this);

    constructor(transport: Transport) {
        super();
        this.transport = transport;
    }

    setHard(path: string, session: ?string) {
        if (this.previous != null) {
            const copy = this.previous.map(d => {
                if (d.path === path) {
                    return {...d, session};
                } else {
                    return d;
                }
            });
            this.current = copy;
            this._reportChanges();
        }
    }

    listen() {
        // if we are not enumerating for the first time, we can let
        // the transport to block until something happens
        const waitForEvent = this.previous !== null;

        this.listening = true;
        const previous = this.previous || [];
        const promise = waitForEvent ? this.transport.listen(previous) : this.transport.enumerate();
        promise.then(descriptors => {
            if (!this.listening) { // do not continue if stop() was called
                return;
            }

            this.current = descriptors;
            this._reportChanges();

            if (this.listening) { // handlers might have called stop()
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

    _diff(previousN: ?Array<DeviceDescriptor>, descriptors: Array<DeviceDescriptor>): DeviceDescriptorDiff {
        const previous = previousN || [];
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

    _reportChanges() {
        lock(() => {
            const diff = this._diff(this.previous, this.current);
            this.previous = this.current;

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
            return Promise.resolve();
        });
    }
}
