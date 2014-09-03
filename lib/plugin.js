'use strict';

var console = require('console'),
    extend = require('extend'),
    Promise = require('promise');

// Try to load a plugin with given options, returns promise. In case of
// rejection, err contains `installed` property.
module.exports.load = function (options) {
    var o = extend(options, {
        // mimetype of the plugin
        mimetype: 'application/x-bitcointrezorplugin',
        // name of the callback in the global namespace
        fname: '__trezorPluginLoaded',
        // id of the plugin element
        id: '__trezor-plugin',
        // time to wait until timeout, in msec
        timeout: 500
    });

    // if we know for sure that the plugin is installed, timeout after
    // 10 seconds
    var installed = isInstalled(o.mimetype),
        timeout = installed ? 10000 : o.timeout;

    // if the plugin is already loaded, use it
    var plugin = document.getElementById(o.id);
    if (plugin)
        return Promise.from(plugin);

    // inject or reject after timeout
    return Promise.race([
        injectPlugin(o.id, o.mimetype, o.fname),
        rejectAfter(timeout, new Error('Loading timed out'))
    ]).catch(function (err) {
        err.installed = installed;
        throw err;
    }).then(
        function (plugin) {
            console.log('[trezor] Loaded plugin ' + plugin.version);
            return plugin;
        },
        function (err) {
            console.error('[trezor] Failed to load plugin: ' + err.message);
            throw err;
        }
    );
};

// Injects the plugin object into the page and waits until it loads.
function injectPlugin(id, mimetype, fname) {
    return new Promise(function (resolve, reject) {
        var body = document.getElementsByTagName('body')[0],
            elem = document.createElement('div');

        // register load function
        window[fname] = function () {
            var plugin = document.getElementById(id);
            if (plugin)
                resolve(plugin);
            else
                reject(new Error('Plugin not found'));
        };

        // inject object elem
        body.appendChild(elem);
        elem.innerHTML =
            '<object width="1" height="1" id="'+id+'" type="'+mimetype+'">'+
            ' <param name="onload" value="'+fname+'" />'+
            '</object>';
    });
}

// If given timeout, gets rejected after n msec, otherwise never resolves.
function rejectAfter(msec, val) {
    return new Promise(function (resolve, reject) {
        if (msec > 0)
            setTimeout(function () { reject(val); }, msec);
    });
}

// Returns true if plugin with a given mimetype is installed.
function isInstalled(mimetype) {
    navigator.plugins.refresh(false);
    return !!navigator.mimeTypes[mimetype];
}
