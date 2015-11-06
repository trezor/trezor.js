"use strict";
var trezor = require('trezor.js');

var SingleScenario = trezor.SingleScenario;

var devicePromise = SingleScenario.load();

devicePromise.catch(function (err) {
    console.error(err);
    // err should be one of the following:
    // - trezor.SingleScenario.NO_TRANSPORT - when no transport (plugin, bridge, extension) is installed
    // - trezor.SingleScenario.DEVICE_IS_BOOTLOADER - when device is in bootloader mode
    // - trezor.SingleScenario.DEVICE_IS_EMPTY - device is not initialized
    // - trezor.SingleScenario.ENUMERATE_ERROR - some error when enumerating
    throw err;
})


// We have the device, but we have to define what to do on user interaction
devicePromise.then(function (device) {

    device.on('button', buttonCallback);
    device.on('passphrase', passphraseCallback);
    device.on('pin', pinCallback);
    console.log("Device successfully loaded", device);

    return device;

}).then(function (device) {

    // Now we can play with the device! Let's encrypt!
    return device.cipherKeyValue([47, 0, 0], "Encrypting!", "deadbeeffaceb00cc0ffee00fee1dead", true, true, true);
}).then(function (data) {

    // data is the message from trezor
    console.log("Encrypted data!", data);
}, function (err) {
    // This can happen very often!
    // For example, user pressed "cancel", disconnected the device,
    // entered wrong PIN, ...
    console.error("Received error", err);
});


function buttonCallback(code) {
    console.log("User is now asked for an action on device", code);
    // we can (but don't necessarily have to) show something to the user,
    // such as "look at your device".
    // Code are in the format ButtonRequest_[type]
    // where [type] is one of the types, defined around here
    // https://github.com/trezor/trezor-common/blob/master/protob/types.proto#L78-L89
}

// callback for passphrase
function passphraseCallback(callback) {
    // first parameter is error, second parameter is passphrase
    // we can put empty passphrase if we want, or ask the user for a different one
    callback(null, "");
}

function pinCallback(callback) {
    throw new Error("Nothing defined");
    // We should ask the user for PIN and send it back like this
    // callback("12");
    // where 1 is the top left position, 2 is the top middle position, etc.
}
