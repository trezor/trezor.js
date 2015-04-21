var trezor = require('trezor.js');

/* To communicate with a TREZOR devices, we first need to load a
 * transport layer. Right now we have two options, a browser plugin or
 * a HTTP bridge server. trezor.js provides an easy loadTransport()
 * function, that attempts to load the transports in the preferred
 * order. */
trezor.loadTransport()

/* Both transport leayers need to be initialized with a signed
 * configuration file that specifies the communication protocol, ACL
 * permissions and other things. */
    .then(configureTransport)

/* Now we can enumerate the connected devices, acquire a session ID
 * and construct a Session object. */
    .then(getSession)

/* To get a clean state and a basic information about the device, send
 * the Initialize message. We also pick a preferred coin type from
 * the list. */
    .then(initialize)

/* Shows how to do a basic challenge-response authentication.
 *
 * Registration:
 *  1. Server sends the path of the signing address. Path is most
 *     probably a constant.
 *  2. Client computes the address with the GetAddress message.
 *  3. Client sends the address, server stores it.
 *
 * Authentication:
 *  1. Server constructs a signing message by combining user-friendly
 *     text ("Login to example.com?") with a random nonce. Nonce is
 *     needed to prevent replay attacks.
 *  2. Server sends the message and the signing address path.
 *  3. Client signs the message with the SignMessage workflow.
 *  4. Client sends the signature.
 *  5. Server validates the signature against the message and the
 *     stored address.
 */
    .then(registrationExample)
    .then(authenticationExample)

    .catch(function (error) {
        console.error(error);
    });

function configureTransport(transport) {
    var CONFIG_URL = 'https://mytrezor.com/data/config_signed.bin';

    // Note: trezor.js exposes the internal AJAX API, but you can, of
    // course, retrieve the config file in any way you want.
    return trezor
        .http(CONFIG_URL)
        .then(function (config) {
            return transport.configure(config);
        })
        .then(function () {
            return transport;
        });
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

// BIP32 path of some example address. Please pick a different path
// for real-world usage.
var ADDRESS_PATH = [
    ((0x80000000) | 1337) >>> 0,
    ((0x80000000) | 1337)  >>> 0,
    ((0x80000000) | 1337)  >>> 0,
    1337,
    1337
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
