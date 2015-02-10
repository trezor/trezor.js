var trezor = require('trezor.js');

getTransport()
    .then(getSession)
    .then(sessionExample)
    .catch(console.error);

function getTransport() {
    // Initialize HTTP (trezord) transport
    var transportUrl = 'https://localback.net:21324',
        transportP = trezor.HttpTransport
            .connect(transportUrl)
            .then(function (info) {
                console.log('Loaded HTTP transport', info.version);
                return new trezor.HttpTransport(transportUrl);
            });

    // Initialize plugin transport
    // var transportP = trezor.plugin.load()
    //        .then(function (plugin) {
    //            console.log('Loaded plugin transport:', plugin.version);
    //            return new trezor.PluginTransport(plugin);
    //        });

    return transportP;
}

function configureTransport(transport) {
    var configUrl = 'https://localhost:8000/config_signed.bin',
        configurationP = trezor
            .http(configUrl)
            .then(function (config) { return transport.configure(config); })
            .then(function () { return transport; })

    return configurationP;
}

function getSession(transport) {

    // List connected devices
    return transport.enumerate()
        .then(function (devices) {
            if (!devices.length) {
                throw new Error('No connected devices.');
            }
            // Acquire session ID with the first device
            return transport.acquire(devices[0]);
        })
        .then(function (result) {
            var id = result.session;
            // Construct the session object
            return new trezor.Session(transport, id);
        });
}

function sessionExample(session) {

    // Initialize TREZOR device to clean state
    return session.initialize()
        .then(function (result) {
            var features = result.message;
            console.log(features);
        })
        .then(function () {
            // Get the first address of first BIP44 account
            return session.getAddress([
                ((0x80000000) | 44) >>> 0,
                ((0x80000000) | 0)  >>> 0,
                ((0x80000000) | 0)  >>> 0,
                0,
                0
            ])
        })
        .then(function (result) {
            var address = result.message.address;
            console.log(address);
        });
}
