'use strict';

// interface Transport {
//
//     Boolean supportsSync
//
//     static function create() -> Promise(Self)
//
//     function configure(String config) -> Promise()
//
//     function enumerate(Boolean wait) -> Promise([{
//         String path
//         String vendor
//         String product
//         String serialNumber
//         String session
//     }] devices)
//
//     function acquire(String path) -> Promise(String session)
//
//     function release(String session) -> Promise()
//
//     function call(String session, String name, Object data) -> Promise({
//         String name,
//         Object data,
//     })
//
// }

var HttpTransport = require('./transport/http');
var PluginTransport = require('./transport/plugin');

// Attempts to load any available HW transport layer
function loadTransport() {
    return HttpTransport.create().catch(function () {
        return PluginTransport.create();
    });
}

module.exports = {
    loadTransport: loadTransport,
    HttpTransport: HttpTransport,
    PluginTransport: PluginTransport,
    Session: require('./session'),
    installers: require('./installers'),
    plugin: require('./plugin'),
    http: require('./http')
};
