'use strict';

var util = require('util');
var EventEmitter = require('events');
var Session = require('./session');

//
// Thin wrapper around Session and a Features message.
//
// Forwards events from session and also emits:
//
//  disconnect
//
var Device = function (session, features) {
    EventEmitter.call(this);
    this.session = session;
    this.features = features;

    forward(this.session, this, 'send');
    forward(this.session, this, 'receive');
    forward(this.session, this, 'error');

    forward(this.session, this, 'button');
    forward(this.session, this, 'pin');
    forward(this.session, this, 'word');
    forward(this.session, this, 'passphrase');
};

util.inherits(Device, EventEmitter);

Device.fromDescriptor = function (transport, descriptor) {
    return Device.acquire(transport, descriptor).then(function (session) {
        return Device.fromSession(session);
    });
};

Device.fromSession = function (session) {
    return session.initialize().then(function (result) {
        return new Device(session, result.message);
    });
};

Device.acquire = function (transport, descriptor) {
    return transport.acquire(descriptor).then(function (result) {
        return new Session(transport, result.session, descriptor);
    });
};

Device.prototype.isBootloader = function () {
    return this.features.bootloader_mode;
};

Device.prototype.isInitialized = function () {
    return this.features.initialized;
};

Device.prototype.getVersion = function () {
    return [
        this.features.major_version,
        this.features.minor_version,
        this.features.patch_version
    ].join('.');
};

Device.prototype.atLeast = function (version) {
    return semvercmp(this.getVersion(), version) >= 0;
};

Device.prototype.getCoin = function (name) {
    var coins = this.features.coins;

    for (var i = 0; i < coins.length; i++) {
        if (coins[i].coin_name === name) {
            return coins[i];
        }
    }
    throw new Error('Device does not support given coin type');
};

Device.prototype.reloadFeatures = function () {
    var self = this;

    return this.session.getFeatures().then(function (features) {
        self.features = features;
    });
};

Device.prototype.watchStreamDisconnect = function (stream) {
    var self = this;
    var session = this.session;

    stream.on('disconnect', function onDisconnect(descriptor) {
        if (session.isDescriptor(descriptor)) {
            session.release();
            self.emit('disconnect');
            stream.removeListener('disconnect', onDisconnect);
        }
    });
};

module.exports = Device;

// Forwards events from source to target
function forward(source, target, event) {
    source.on(event, function () {
        if (event === 'error') {
            // don't throw actual errors if there is nothing listening on "error"
            if (EventEmitter.listenerCount(target, 'error') === 0) {
                return;
            }
        }
        var args = [].slice.call(arguments);
        target.emit.apply(target, [event].concat(args));
    });
}

// Taken from https://github.com/substack/semver-compare/blob/master/index.js
function semvercmp(a, b) {
    var pa = a.split('.');
    var pb = b.split('.');

    for (var i = 0; i < 3; i++) {
        var na = Number(pa[i]);
        var nb = Number(pb[i]);
        if (na > nb) return 1;
        if (nb > na) return -1;
        if (!isNaN(na) && isNaN(nb)) return 1;
        if (isNaN(na) && !isNaN(nb)) return -1;
    }

    return 0;
}
