/* @flow weak */

'use strict';

var Transport = require('./transport');

module.exports = {
    loadTransport: Transport.loadTransport,
    initTransport: Transport.initTransport,
    HttpTransport: require('./transport/http'),
    ChromeExtensionTransport: require('./transport/chrome-extension'),
    PluginTransport: require('./transport/plugin'),

    Session: require('./session'),
    Device: require('./device'),
    DescriptorStream: require('./descriptor-stream'),
    DeviceList: require('./device-list'),

    installers: require('./installers').installers,
    udevInstallers: require('./installers').udevInstallers,
    plugin: require('./plugin'),
    http: require('./http')
};
