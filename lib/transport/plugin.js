/* @flow weak */
// DEPRECATED - DO NOT USE
'use strict';

const plugin_ = require('../plugin');
const traverse = require('traverse');

//
// Plugin transport.
//
export default function PluginTransport(plugin) {
    this._plugin = plugin;
    // Cache with NPAPI objects representing devices
    this._NPDeviceCache = {};
    // We have to pause enumeration on calls
    this._currentCall = Promise.resolve();
}

PluginTransport.prototype.supportsSync = false;
PluginTransport.prototype.version = '1.0.5';
PluginTransport.prototype.configured = true;

// Injects the plugin and returns a PluginTransport.
PluginTransport.create = function () {
    console.log('[trezor] Attempting to load plugin transport');
    return PluginTransport.loadPlugin().then(
        function (plugin) {
            console.log('[trezor] Loaded plugin transport');
            return new PluginTransport(plugin);
        },
        function (error) {
            console.warn('[trezor] Failed to load plugin transport', error);
            throw error;
        }
    );
};

// Injects the plugin object into the document.
PluginTransport.loadPlugin = function () {
    return plugin_.load();
};

// BIP32 CKD derivation of the given index
PluginTransport.prototype.deriveChildNode = function (node, index) {
    const child = this._plugin.deriveChildNode(node, index);

    if (node.path) {
        child.path = node.path.concat([index]);
    }

    return child;
};

// Configures the plugin.
PluginTransport.prototype.configure = function (config) {
    const plugin = this._plugin;

    return new Promise(function (resolve, reject) {
        try {
            plugin.configure(config);
            resolve();
        } catch (e) {
            // In most browsers, exceptions from plugin methods are not properly
            // propagated
            reject(new Error(
                'Plugin configuration found, but could not be used. ' +
                    'Make sure it has proper format and a valid signature.'
            ));
        }
    });
};

// Configures the plugin.
PluginTransport.prototype.configure = function (config) {
    const plugin = this._plugin;

    return new Promise(function (resolve, reject) {
        try {
            plugin.configure(config);
            resolve();
        } catch (e) {
            // In most browsers, exceptions from plugin methods are not properly
            // propagated
            reject(new Error(
                'Plugin configuration found, but could not be used. ' +
                    'Make sure it has proper format and a valid signature.'
            ));
        }
    });
};

function deviceToKey(device) {
    const id = device.id ? device.id : '';
    const path = device.path ? device.path.toString() : '';
    return 'id:' + id + '; path:' + path;
}

function deviceToDescriptor(device) {
    return { id: device.id, path: device.path };
}

PluginTransport.prototype._saveDevices = function (devices) {
    devices.forEach((device) => {
        const key = deviceToKey(device);
        this._NPDeviceCache[key] = device;
    });
};

PluginTransport.prototype._findDevice = function (deviceDescriptor) {
    const key = deviceToKey(deviceDescriptor);
    return this._NPDeviceCache[key];
};

function timeoutPromise(time) {
    return new Promise(function (resolve) {
        window.setTimeout(function () {
            resolve();
        }, time);
    });
}

// Enumerates connected devices.
// Requires configured plugin.
PluginTransport.prototype.enumerate = function (wait) {
    const plugin = this._plugin;

    const waitPromise = wait ? timeoutPromise(1000) : Promise.resolve();

    return waitPromise
    .then(() => {
        return this._currentCall;
    })
    .then(() => {
        const pluginDevices = plugin.devices();
        this._saveDevices(pluginDevices);

        // We don't want to export ugly NPAPI objects
        const descriptors = pluginDevices.map(function (device) {
            return deviceToDescriptor(device);
        });
        return descriptors;
    });
};

// Opens a device and returns a session object.
// (Plugin doesn't actually acquire, so we return the same thing)
PluginTransport.prototype.acquire = function (deviceDescriptor) {
    return Promise.resolve({
        session: deviceDescriptor,
    });
};

// Releases the device handle.
PluginTransport.prototype.release = function (deviceDescriptor) {
    const plugin = this._plugin;
    const device = this._findDevice(deviceDescriptor);

    return new Promise(function (resolve, reject) {
        plugin.close(device, {
            success: resolve,
            error: reject,
        });
    });
};

// Does a request-response call to the device.
PluginTransport.prototype.call = function (deviceDescriptor, type, message) {
    const plugin = this._plugin;
    const timeout = false;
    const device = this._findDevice(deviceDescriptor);

    // BitcoinTrezorPlugin has a bug, causing different treatment of
    // undefined fields in messages. We need to find all undefined fields
    // and remove them from the message object. `traverse` will delete
    // object fields and splice out array items properly.
    traverse(message).forEach(function (value) {
        if (value == null) {
            this.remove();
        }
    });

    // Prevents call and enumerate at the same time
    this._currentCall = new Promise(function (resolve, reject) {
        plugin.call(device, timeout, type, message, {
            success: function (t, m) {
                resolve({
                    type: t,
                    message: m,
                });
            },
            error: function (err) {
                reject(new Error(err));
            },
        });
    });

    return this._currentCall;
};
