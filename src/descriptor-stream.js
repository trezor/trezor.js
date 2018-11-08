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
    debugChangedSessions: Array<DeviceDescriptor>,
    debugAcquired: Array<DeviceDescriptor>,
    debugReleased: Array<DeviceDescriptor>,
    didUpdate: boolean,
    descriptors: Array<DeviceDescriptor>
};

export default class DescriptorStream extends EventEmitter {
    transport: Transport;
    listening: boolean = false;
    failedToFetchTimestamp: number = 0;
    previous: ?Array<DeviceDescriptor> = null;
    current: Array<DeviceDescriptor> = [];

    errorEvent: Event1<Error> = new Event1('error', this);
    connectEvent: Event1<DeviceDescriptor> = new Event1('connect', this);
    disconnectEvent: Event1<DeviceDescriptor> = new Event1('disconnect', this);
    acquiredEvent: Event1<DeviceDescriptor> = new Event1('acquired', this);
    releasedEvent: Event1<DeviceDescriptor> = new Event1('released', this);
    changedSessionsEvent: Event1<DeviceDescriptor> = new Event1('changedSessions', this);
    updateEvent: Event1<DeviceDescriptorDiff> = new Event1('update', this);

    debugAcquiredEvent: Event1<DeviceDescriptor> = new Event1('debugAcquired', this);
    debugReleasedEvent: Event1<DeviceDescriptor> = new Event1('debugReleased', this);
    debugChangedSessionsEvent: Event1<DeviceDescriptor> = new Event1('debugChangedSessions', this);

    constructor(transport: Transport) {
        super();
        this.transport = transport;
    }

    setHard(path: string, session: ?string, debug: boolean) {
        if (this.previous != null) {
            const copy = this.previous.map(d => {
                if (d.path === path) {
                    if (debug) {
                        const debugSession = session;
                        return {...d, debugSession};
                    }
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

            this.failedToFetchTimestamp = 0;

            this.current = descriptors;
            this._reportChanges().then(() => {
                if (this.listening) { // handlers might have called stop()
                    this.listen();
                }
            });
        }).catch(error => {
            const ts: number = new Date().getTime();
            if (error && error.message === 'Failed to fetch' && ts - this.failedToFetchTimestamp > 500) {
                // Try again. This error could be thrown by fetch API when computer goes to sleep and pending request is cancelled
                this.failedToFetchTimestamp = ts;
                if (this.listening) {
                    this.listen();
                }
            } else {
                this.errorEvent.emit(error);
            }
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

        const debugChangedSessions = descriptors.filter(d => {
            const previousDescriptor = previous.find(x => {
                return x.path === d.path;
            });
            if (previousDescriptor !== undefined) {
                return (previousDescriptor.debugSession !== d.debugSession);
            } else {
                return false;
            }
        });
        const debugAcquired = debugChangedSessions.filter(descriptor => {
            return descriptor.debugSession != null;
        });
        const debugReleased = debugChangedSessions.filter(descriptor => {
            return descriptor.debugSession == null;
        });

        const didUpdate = (connected.length + disconnected.length + changedSessions.length + debugChangedSessions.length) > 0;

        return {
            connected: connected,
            disconnected: disconnected,
            changedSessions: changedSessions,
            acquired: acquired,
            released: released,
            didUpdate: didUpdate,
            descriptors: descriptors,
            debugChangedSessions,
            debugAcquired,
            debugReleased,
        };
    }

    _reportChanges() {
        return lock(() => {
            const diff = this._diff(this.previous, this.current);
            this.previous = this.current;

            if (diff.didUpdate && this.listening) {
                diff.connected.forEach(d => {
                    this.connectEvent.emit(d);
                });
                diff.disconnected.forEach(d => {
                    this.disconnectEvent.emit(d);
                });
                diff.debugAcquired.forEach(d => {
                    this.debugAcquiredEvent.emit(d);
                });
                diff.debugReleased.forEach(d => {
                    this.debugReleasedEvent.emit(d);
                });
                diff.debugChangedSessions.forEach(d => {
                    this.debugChangedSessionsEvent.emit(d);
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
