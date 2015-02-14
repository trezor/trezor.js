var trezor = require('trezor.js');

getTransport() // Construct the transport object to lookup and talk to devices.

    .then(configureTransport) // Configure it with the signed configuration file.
    .then(getSession) // Open a session with a connected device.
    .then(initialize) // Initialize the device to clean state and select a coin data type.

    // Challenge-response authentication examples:
    .then(registrationExample)
    .then(authenticationExample)

    .catch(function (error) {
        console.error(error);
    });

function getTransport() {
    return trezor.PluginTransport.create(); // Plugin transport.
    // return trezor.HttpTransport.create(); // HTTP (trezord) transport.
}

function configureTransport(transport) {
    // URL of the signed configuration file for trezord/plugin
    var CONFIG_URL = 'https://mytrezor.com/data/plugin/config_signed.bin';

    // Note: trezor.js exposes the internal AJAX API, but you can, of
    // course, retrieve the config file in any way you want.
    return trezor
        .http(CONFIG_URL)
        .then(function (config) {
            return transport.configure(config);
        })
        .then(function () {
            return transport;
        })
}

function getSession(transport) {
    return transport.enumerate() // List connected devices.
        .then(function (devices) {
            if (!devices.length) {
                throw new Error('No connected devices.');
            }
            return transport.acquire(devices[0]); // Acquire session ID with the first device.
        })
        .then(function (result) {
            var id = result.session;
            return new trezor.Session(transport, id); // Construct the session object.
        });
}

function initialize(session) {
    return session.initialize() // Initialize the device to clean state.
        .then(function (result) {
            var features = result.message;
            var coin = features.coins[0]; // Should be the "Bitcoin" entry.

            return {
                session: session,
                coin: coin
            };
        });
}

// BIP32 path of the first address from the first BIP44 account. For
// real-world use you might want to pick a different path.
var ADDRESS_PATH = [
    ((0x80000000) | 44) >>> 0,
    ((0x80000000) | 0)  >>> 0,
    ((0x80000000) | 0)  >>> 0,
    0,
    0
];

function registrationExample(device) {
    var session = device.session;
    var coin = device.coin;

    return session.getAddress(ADDRESS_PATH, coin).then(function (result) {
        var address = result.message.address;

        // Register the address on the server...

        return device;
    });
}

function authenticationExample(device) {
    var session = device.session;
    var coin = device.coin;

    var nonce = getRandomNonce(); // Server provides a random nonce value to prevent replay attacks.

    var message = 'Login to example.com? ' + nonce;

    return session.signMessage(ADDRESS_PATH, message, coin).then(function (result) {
        var address = result.message.address;
        var signature = result.message.signature; // In hex

        // Send to server for verification...

        return device;
    });
}
