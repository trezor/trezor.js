/* @flow weak */
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

var Transport = require('./transport');

module.exports = {
    loadTransport: Transport.loadTransport,
    initTransport: Transport.initTransport,
    HttpTransport: require('./transport/http'),
    ChromeExtensionTransport: require('./transport/chrome-extension'),
    PluginTransport: require('./transport/plugin'),
    Session: require('./session'),
    installers: require('./installers').installers,
    udevInstallers: require('./installers').udevInstallers,
    plugin: require('./plugin'),
    http: require('./http'),
    Device: require('./device'),
    DescriptorStream: require('./descriptor-stream'),
    SingleScenario: require('./scenarios/single'),
    ListScenario: require('./scenarios/list'),
};
