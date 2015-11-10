'use strict';

var trezor = require('trezor.js');

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

    // Ask the device for public key:
    device.session.getPublicKey([44, 0, 0])
        .then(function (result) {
            console.log('Keys:', result);
        })
        .catch(function (error) {
            // Errors can happen easily, i.e. when device is disconnected.
            console.error('Error:', error);
        });
});

list.on('disconnect', function (device) {
    console.log('Disconnected a device:', device);
    console.log('Devices:', list.asArray());
});

list.on('error', function (error) {
    console.error('Error:', error);
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
