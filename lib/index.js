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
    HttpTransport: require('./transport/http'),
    PluginTransport: require('./transport/plugin'),
    Session: require('./session'),
    installers: require('./installers'),
    plugin: require('./plugin'),
    http: require('./http')
};
