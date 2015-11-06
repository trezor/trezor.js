'use strict';

var DescriptorStream = require('../descriptor-stream');
var Device = require('../device');
var initTransport = require('../transport.js').initTransport;
var Promise = require('promise');

var NO_TRANSPORT = new Error('No trezor.js transport is available');
var ENUMERATE_ERROR = new Error('Error when enumerating.');
var DEVICE_IS_BOOTLOADER = new Error('Connected device is in bootloader mode');
var DEVICE_IS_EMPTY = new Error('Connected device is not initialized');

function _createTransport(options) {
    if (options.transport) {
        return Promise.resolve(options.transport);
    } else {
        return initTransport(options).catch(function () {
            throw NO_TRANSPORT;
        });
    }
}

function _waitForDescriptor(descriptorStream) {
    return new Promise(function (resolve, reject) {
        descriptorStream.once('error', function (error) {
            //reject(error);
            reject(ENUMERATE_ERROR);
        });
        descriptorStream.once('connect', function (desc) {
            resolve(desc);
        });
    })
}

function _deviceFromDescriptor(transport, descriptor, descriptorStream) {
    return Device.fromDescriptor(transport, descriptor).then(function (device) {
        device.watchStreamDisconnect(descriptorStream);
        return device;
    })
}

function _waitForDevice(transport) {
    var descriptorStream = new DescriptorStream(transport).listen();
    return _waitForDescriptor(descriptorStream).then(function (descriptor) {
        return _deviceFromDescriptor(transport, descriptor, descriptorStream);
    });
}

function _checkDevice(device) {
    if (device.isBootloader()) {
        throw DEVICE_IS_BOOTLOADER;
    }
    if (!device.isInitialized()) {
        throw DEVICE_IS_EMPTY;
    }
    return device;
}

function load(_options) {
    var options = _options == null ? {} : _options;

    return _createTransport(options).then(_waitForDevice).then(_checkDevice);
}

module.exports.load = load;
module.exports.NO_TRANSPORT = NO_TRANSPORT;
module.exports.DEVICE_IS_BOOTLOADER = DEVICE_IS_BOOTLOADER;
module.exports.DEVICE_IS_EMPTY = DEVICE_IS_EMPTY;
module.exports.ENUMERATE_ERROR = ENUMERATE_ERROR;
