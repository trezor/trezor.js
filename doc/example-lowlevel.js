//var trezor = require('trezor.js');
var trezor = window.trezor;

/* In order to communicate with TREZOR devices we first need to load a
 * transport layer. Right now we have three options: generic browser
 * plugin, Google Chrome Extension, and HTTPS bridge server. trezor.js
 * provides loadTransport() function that attempts to load the
 * transports in the preferred order. */
trezor.loadTransport()

/* All transport leayers need to be initialized with a signed
 * configuration file that specifies the communication protocol, ACL
 * permissions and other parameters. */
    .then(configureTransport)

/* Now we can enumerate the connected devices, acquire a session ID
 * and construct a Session object. */
    .then(getSession)

/* To get a clean state and a basic information about the device, send
 * the Initialize message. We also pick a preferred coin type from
 * the list. */
    .then(initialize)

    .then(signMessageExample)

    .catch(function (error) {
        console.error(error);
    });

function configureTransport(transport) {
    var CONFIG_URL = 'https://mytrezor.s3.eu-central-1.amazonaws.com/config_signed.bin';

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

function signMessageExample(device) {
    var session = device.session;
    var coin = device.coin;


    var message = 'Sign me!';

    return session.signMessage(ADDRESS_PATH, stringToHex(message), coin).then(function (result) {
        var address = result.message.address;
        var signature = result.message.signature; // In hex

        // do something with the signature....
        console.debug("Signature: ", signature);

        return device;
    });
}

function bytesToHex(bytes) {
    return new Buffer(bytes).toString('hex')
}
function d2h(d) {
    return d.toString(16);
}

function stringToHex (tmp) {
    var str = '',
        i = 0,
        tmp_len = tmp.length,
        c;
 
    for (; i < tmp_len; i += 1) {
        c = tmp.charCodeAt(i);
        str += d2h(c);
    }
    return str;
}

