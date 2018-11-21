'use strict';

// installed from npm
var trezor = require('../src/index-node.js');

var list = new trezor.DeviceList();

// note that this works in both browser and node
// and also in webusb; however, if with webusb,
// user first need to "claim" the device (not demonstrated here)
function debugPushYes(device) {
    device.waitForSessionAndRun(function (session) {
        // post does not wait for answer
        // rawPost, rawRead, rawCall does not add any logic
        return session.rawPost("DebugLinkDecision", {yes_no: true})
    }, {debugLink: true}); // <- to mark debug link
}

list.on('connect', device => {

    device.on('button', async (code) => debugPushYes(device));

    device.waitForSessionAndRun(async (session) => {
        const e = await session.typedCall("GetEntropy", "Entropy", {size: 10});
        console.log("First random hex-string is " + e.message.entropy);
        const f = await session.typedCall("GetEntropy", "Entropy", {size: 10});
        console.log("Second random hex-string is " + f.message.entropy);
    });
});
