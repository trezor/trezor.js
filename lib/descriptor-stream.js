'use strict';

var util = require("util");
var EventEmitter = require("events");
var PluginTransport = require('./transport/plugin');


function DescriptorStream(transport) {
    EventEmitter.call(this);
    this.transport = transport;
    this.listening = false;
    this.previous = null;
}

util.inherits(DescriptorStream, EventEmitter);

DescriptorStream.prototype.listen = function () {

    var self = this;

    // if we are not enumerating for the first time, we can let
    // the transport to block until something happens
    var supportsWaiting = !(this.transport instanceof PluginTransport);
    var waitForEvent = supportsWaiting && this.previous !== null;

    this.listening = true;
    this.transport.enumerate(waitForEvent).then(function (descriptors) {
        if (!self.listening) {
            // do not continue if stop() was called
            return;
        }

        self._handleDiff(self._diff(descriptors));

        if (self.listening) {
            // handlers might have called stop()
            self.listen();
        }
    }).catch(function (error) {
        self.emit('error', error);
    });
    return this;
};

DescriptorStream.prototype._diff = function (descriptors) {
    var previous = this.previous || [];
    var connected = descriptors.filter(function (d) {
        return previous.find(function (x) {
            return x.path === d.path;
        }) === undefined;
    });
    var disconnected = previous.filter(function (d) {
        return descriptors.find(function (x) {
            return x.path === d.path;
        }) === undefined;
    });

    var didUpdate = connected.length > 0 || disconnected.length > 0;

    return {
        connected: connected,
        disconnected: disconnected,
        didUpdate: didUpdate,
        descriptors: descriptors
    };
}

DescriptorStream.prototype._handleDiff = function (diff) {
    var self = this;
    if (diff.didUpdate) {
        diff.connected.forEach(function (d) {
            self.emit('connect', d);
        });
        diff.disconnected.forEach(function (d) {
            self.emit('disconnect', d);
        });
        self.emit('update', diff.descriptors);

        self.previous = diff.descriptors;
    }
}

DescriptorStream.prototype.stop = function () {
    this.listening = false;
}

module.exports = DescriptorStream;
