var HttpTransport = require('./transport/http');
var PluginTransport = require('./transport/plugin');
var ChromeExtensionTransport = require('./transport/chrome-extension');

var http = require('./http');

var CONFIG_URL = 'https://mytrezor.s3.amazonaws.com/plugin/config_signed.bin';


// Attempts to load any available HW transport layer
function loadTransport() {
    return ChromeExtensionTransport.create().catch(function () {
        return HttpTransport.create().catch(function () {
            return PluginTransport.create();
        });
    });
}

function initTransport(options) {
    options = options == null ? {} : options;
    var configUrl = options.configUrl == null ? CONFIG_URL : options.configUrl;
    var configure = function (transport) {
        var timestamp = new Date().getTime();
        var configUrlTimestamp = CONFIG_URL + '?' + timestamp;

        return http(configUrlTimestamp).then(function (c) {
            return transport.configure(c);
        }).then(function () {
            return transport;
        });
    };

    var result = loadTransport().then(configure);


    return result;
}


module.exports.loadTransport = loadTransport;
module.exports.initTransport = initTransport;
