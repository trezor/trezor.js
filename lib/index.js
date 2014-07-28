'use strict';

// interface Transport {
//
//     function configure(String config) -> Promise()
//
//     function enumerate() -> Promise([{
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

module.exports = {
    http: require('./http'),
    HttpTransport: require('./transport/http'),
    plugin: require('./plugin'),
    PluginTransport: require('./transport/plugin'),
    Session: require('./session'),
    installers: require('./installers')
};
