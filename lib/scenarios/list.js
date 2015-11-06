'use strict';

var DescriptorStream = require('../descriptor-stream');
var Device = require('../device');
var initTransport = require('../transport.js').initTransport;
var EventEmitter = require("events");
var util = require("util");
var Promise = require('promise');

var NO_TRANSPORT = new Error('No trezor.js transport is available');
var ENUMERATE_ERROR = new Error('Error when enumerating.');
var CONNECT_ERROR = new Error('Error when connecting.');

var DeviceList = function (_options) {
    EventEmitter.call(this);

    var options = _options == null ? {} : _options;

    this.devices = {};
    var self = this;

    this._createTransport(options).then(this._watchDescriptors.bind(this));
}

util.inherits(DeviceList, EventEmitter);

DeviceList.prototype._createTransport = function (options) {
    var self = this;
    if (options.transport) {
        return Promise.resolve(options.transport);
    } else {
        return initTransport(options).catch(function (error) {
            self.emit('error', NO_TRANSPORT, error);
            throw error;
        })
    }
}

DeviceList.prototype._watchDescriptors = function (transport) {
    var self = this;
    var stream = new DescriptorStream(transport);

    stream.on('error', function (error) {
        self.emit('error', ENUMERATE_ERROR, error);
        stream.stop();
    });

    stream.on('connect', function (descriptor) {
        Device.fromDescriptor(transport, descriptor).then(function (device) {
            self.devices[device.session.path] = device;
            device.watchStreamDisconnect(stream);
            self.emit('connect', device);
        }).catch(function (error) {
            self.emit('error', CONNECT_ERROR, error);
        });
    });

    stream.on('disconnect', function (descriptor) {
        var device = self.devices[descriptor.path];
        delete self.devices[descriptor.path];
        self.emit('disconnect', device);
    });

    stream.listen();
}

DeviceList.prototype.asArray = function () {
    var res = [];
    for (var path in this.devices) {
        res.push(this.devices[path]);
    }
    return res;
}

module.exports.DeviceList = DeviceList;

module.exports.NO_TRANSPORT = NO_TRANSPORT;
module.exports.ENUMERATE_ERROR = ENUMERATE_ERROR;
module.exports.CONNECT_ERROR = CONNECT_ERROR;
