'use strict';

var Session = require('./session');
var http = require('./http');
var EventEmitter = require("events");
var util = require("util");

var Device = function (session, features, descriptorStream) {
    EventEmitter.call(this);
    var self = this;
    this.session = session;
    this.features = features;
    this.session.on('passphrase', function (callback) {
        self.emit('passphrase', callback);
    });
    this.session.on('pin', function (type, callback) {
        self.emit('pin', type, callback);
    });
    this.session.on('button', function (code) {
        self.emit('button', code);
    });
}

util.inherits(Device, EventEmitter);

Device.prototype.watchStreamDisconnect = function (descriptorStream) {
    var self = this;
    var onDisconnect = function (descriptor) {
        if (descriptor.path === self.session.path) {
            self.session.release();
            self.emit('disconnect');
            descriptorStream.removeListener('disconnect', onDisconnect);
        }
    }
    descriptorStream.on('disconnect', onDisconnect);
}

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
        return new Session(transport, result.session, descriptor.path);
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
    return this.session.getFeatures().then(function (features) {
        this.features = features;
    })
}

var functions = [
    "getEntropy",
    "getAddress",
    "getPublicKey",
    "wipeDevice",
    "resetDevice",
    "loadDevice",
    "recoverDevice",
    "applySettings",
    "clearSession",
    "changePin",
    "eraseFirmware",
    "uploadFirmware",
    "verifyMessage",
    "signMessage",
    "signIdentity",
    "cipherKeyValue",
    "measureTx",
    "signTx",
]

functions.forEach(function (name) {
    Device.prototype[name] = function () {
        return this.session[name].apply(this.session, arguments);
    }
});

module.exports = Device;

// taken from https://github.com/substack/semver-compare/blob/master/index.js
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
