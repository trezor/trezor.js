"use strict";
var trezor = require('trezor.js');

var DeviceList = trezor.ListScenario.DeviceList;

// DeviceList automatically handles the logic of acquiring and disconnecting devices
// and emits messages after acquiring
var list = new DeviceList();

list.on("connect", function (device) {
    console.log("Connected a device ", device);
    console.log("Devices: ", list.asArray());

    // What to do on user interactions
    device.on('button', buttonCallback);
    device.on('passphrase', passphraseCallback);
    device.on('pin', pinCallback);

    // Example what to do with the devices - ask them for public keys
    Promise.all(list.asArray().map(function (device) {
        return device.getPublicKey([44, 0, 0]);
    })).then(function (publicKeys) {
        console.log("Keys:", publicKeys);
    }).catch(function (error) {
        // Errors can happen easily, when device is disconnected etc
        console.error("Error: ", error);
    });
});

// What to do on device disconnection
list.on("disconnect", function (device) {
    console.log("Disonnected a device ", device);
    console.log("Devices: ", list.asArray());
});


// What to do on general error
// error should be only one of the following:
// trezor.ListScenario.NO_TRANSPORT - badly initialized transport
// trezor.ListScenario.ENUMERATE_ERROR - some problem with enumerating
// trezor.ListScenario.CONNECT_ERROR - some problem with connecting device (disconnected while initializing)
list.on("error", function (error, originalError) {
    console.error("Error", error);
})

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
