'use strict';

// in case of browserify
//var trezor = require('trezor.js');

// in case of just including trezor.js
 var trezor = window.trezor;

// DeviceList encapsulates transports, sessions, device enumeration and other
// low-level things, and provides easy-to-use event interface.
var list = new trezor.DeviceList();

list.on('connect', function (device) {
    console.log('Connected a device:', device);
    console.log('Devices:', list.asArray());

    // What to do on user interactions:
    device.on('button', buttonCallback);
    device.on('passphrase', passphraseCallback);
    device.on('pin', pinCallback);

    // For convenience, device emits 'disconnect' event on disconnection.
    device.on('disconnect', function () {
        console.log('Disconnected an opened device');
    });

    // You generally want to filter out devices connected in bootloader mode:
    if (device.isBootloader()) {
        throw new Error('Device is in bootloader mode, re-connected it');
    }

    var hardeningConstant = 0x80000000;

    // Ask the device to show first address of first account on display and return it
    device.waitForSessionAndRun(function (session) {
        return session.getAddress([
            (44 | hardeningConstant) >>> 0,
            (0 | hardeningConstant) >>> 0,
            (0 | hardeningConstant) >>> 0,
            0,
            0
        ], {coin_name: "Bitcoin"}, true)
    })
    .then(function (result) {
        console.log('Address:', result.message.address);
    })
    .catch(function (error) {
        // Errors can happen easily, i.e. when device is disconnected or request rejected
        // Note: if there is general error handler, that listens on device.on('error'),
        // both this and the general error handler gets called
        console.error('Call rejected:', error);
    });
});

// Note that this is a bit duplicate to device.on('disconnect')
list.on('disconnect', function (device) {
    console.log('Disconnected a device:', device);
    console.log('Devices:', list.asArray());
});

// This gets called on general error of the devicelist (no transport, etc)
list.on('error', function (error) {
    console.error('List error:', error);
});


/**
 * @param {string}
 */
function buttonCallback(code) {
    console.log('User is now asked for an action on device', code);
    // We can (but don't necessarily have to) show something to the user, such
    // as 'look at your device'.
    // Codes are in the format ButtonRequest_[type] where [type] is one of the
    // types, defined here:
    // https://github.com/trezor/trezor-common/blob/master/protob/types.proto#L78-L89
}

/**
 * @param {Function<Error, string>} callback
 */
function passphraseCallback(callback) {
    // We can respond with empty passphrase if we want, or ask the user.
    callback(null, '');
}

/**
 * @param {string} type
 * @param {Function<Error, string>} callback
 */
function pinCallback(type, callback) {
    // We should ask the user for PIN and send it back as '1234', where 1 is the
    // top left position, 2 is the top middle position, etc.
    throw new Error('Nothing defined');
}
