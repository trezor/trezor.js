import {DeviceList} from 'trezor.js-node';

const list = new DeviceList({debug: true});
import {inspect} from 'util';

function printOut(...args) {
    document.getElementById('trezor').innerHTML = 
        document.getElementById('trezor').innerHTML + 
        '<br>' +
        args.map(a => typeof a === 'string' ? a : inspect(a)).join(", ");
}

document.addEventListener('DOMContentLoaded', () => {
    printOut('Application started');
});

list.on('connect', function (device) {
    printOut('Connected a device:', device);
    printOut('Devices:', list.asArray());

    // What to do on user interactions:
    device.on('button', buttonCallback);
    device.on('passphrase', passphraseCallback);
    device.on('pin', pinCallback);

    // For convenience, device emits 'disconnect' event on disconnection.
    device.on('disconnect', function () {
        printOut('Disconnected an opened device');
    });

    // You generally want to filter out devices connected in bootloader mode:
    if (device.isBootloader()) {
       printOut('Device is in bootloader mode, re-connected it');
       throw new Error('Device is in bootloader mode, re-connected it');
    }

    var hardeningConstant = 0x80000000;

    // low level API
    device.waitForSessionAndRun(function (session) {
        printOut("I will call now.");

        return session.typedCall("GetEntropy", "Entropy", {size: 10}).then(entropy => {
            printOut("I have called now.");
            printOut("Random hex-string is ", entropy.message.entropy);
        });
    }).then(function() {

        // high level API
        // Ask the device to show first address of first account on display and return it
        device.waitForSessionAndRun(function (session) {
            return session.getAddress([
                (44 | hardeningConstant) >>> 0,
                (0 | hardeningConstant) >>> 0,
                (0 | hardeningConstant) >>> 0,
                0,
                0
            ], 'bitcoin', true)
        })
        .then(function (result) {
            printOut('Address:', result.message.address);
        })
    })
    .catch(function (error) {
        // Errors can happen easily, i.e. when device is disconnected or request rejected
        // Note: if there is general error handler, that listens on device.on('error'),
        // both this and the general error handler gets called
        printOut('Call rejected:', error);
    });
});

// Note that this is a bit duplicate to device.on('disconnect')
list.on('disconnect', function (device) {
    printOut('Disconnected a device:', device);
    printOut('Devices:', list.asArray());
});

// This gets called on general error of the devicelist (no transport, etc)
list.on('error', function (error) {
    printOut('List error:', error);
});

// On connecting unacquired device
list.on('connectUnacquired', function (device) {
    askUserForceAcquire(function() {
        device.steal().then(function() {
            printOut("steal done. now wait for another connect");
        });
    });
});

// an example function, that asks user for acquiring and
// calls callback if use agrees
// (in here, we will call agree always, since it's just an example)
function askUserForceAcquire(callback) {
    return setTimeout(callback, 1000);
}

/**
 * @param {string}
 */
function buttonCallback(code) {
    printOut('User is now asked for an action on device', code);
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
    printOut(null, '');
}

/**
 * @param {string} type
 * @param {Function<Error, string>} callback
 */
function pinCallback(type, callback) {
    // We should ask the user for PIN and send back number positions encoded as string '1234'.
    // Where 1 is the bottom left position, 7 is the top left position, etc.
    // 7 8 9
    // 4 5 6
    // 1 2 3
    printOut('Nothing defined for PIN callback, throwing error');
    throw new Error('Nothing defined');
}

// you should do this to release devices on reload
window.onbeforeunload = function() {
    list.onbeforeunload();
}
