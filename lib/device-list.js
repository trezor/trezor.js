'use strict';

var util = require('util');
var EventEmitter = require('events');

var initTransport = require('./transport').initTransport;
var DescriptorStream = require('./descriptor-stream');
var Device = require('./device');

//
// Events:
//
//  connect: Device
//  disconnect: Device
//  transport: Transport
//  stream: DescriptorStream
//
var DeviceList = function (options) {
    EventEmitter.call(this);

    this.options = options;
    this.transport = null;
    this.stream = null;
    this.devices = {};

    var self = this;

    this.on('transport', function (transport) {
        self.transport = transport;
        self._initStream();
    });

    this.on('stream', function (stream) {
        self.stream = stream;
    });

    this._initTransport();
};

util.inherits(DeviceList, EventEmitter);

DeviceList.prototype.asArray = function () {
    var array = [];
    for (var key in this.devices) {
        if (this.devices.hasOwnProperty(key)) {
            array.push(this.devices[key]);
        }
    }
    return array;
};

DeviceList.prototype._initTransport = function () {
    var self = this;

    if (this.options.transport) {
        this.emit('transport', this.options.transport);

    } else {
        initTransport(this.options)
            .then(function (transport) {
                self.emit('transport', transport);
            })
            .catch(function (error) {
                self.emit('error', error);
            });
    }
};

DeviceList.prototype._initStream = function () {
    var self = this;
    var stream = new DescriptorStream(this.transport);

    stream.on('connect', function (descriptor) {
        var path = descriptor.path;
        var transport = self.transport;

        Device.fromDescriptor(transport, descriptor)
            .then(function (device) {
                device.watchStreamDisconnect(stream);
                self.devices[path] = device;
                self.emit('connect', device);
            })
            .catch(function (error) {
                self.emit('error', error);
            });
    });

    stream.on('disconnect', function (descriptor) {
        var path = descriptor.path;
        var device = self.devices[path];

        delete self.devices[path];

        self.emit('disconnect', device);
    });

    stream.on('error', function (error) {
        self.emit('error', error);
        stream.stop();
    });

    stream.listen();

    this.emit('stream', stream);
};

module.exports.DeviceList = DeviceList;
