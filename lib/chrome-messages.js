/* @flow weak */
'use strict';

export function exists() {
    if (typeof chrome === 'undefined') {
        return Promise.reject(new Error('Global chrome does not exist; probably not running chrome'));
    }
    if (typeof chrome.runtime === 'undefined') {
        return Promise.reject(new Error('Global chrome.runtime does not exist; probably not running chrome'));
    }
    if (typeof chrome.runtime.sendMessage === 'undefined') {
        return Promise.reject(new Error('Global chrome.runtime.sendMessage does not exist; probably not whitelisted website in extension manifest'));
    }
    return Promise.resolve();
};

export function send(extensionId, message) {
    // console.log('Sending a message to ID', message, extensionId);
    return new Promise(function (resolve, reject) {

        var callback = function (response) {
            if (response) {
                if (response.type === 'response') {
                    // console.log('Response was', response);
                    resolve(response.body);
                } else if (response.type === 'error') {
                    console.error('[trezor] Error received', response);
                    reject(new Error(response.message));
                } else {
                    console.error('[trezor] Unknown response type ', response.type);
                    reject(new Error('Unknown response type ' + response.type));
                }
            } else {
                console.error('[trezor] Chrome runtime error', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            }
        };

        if (chrome.runtime.id === extensionId) {
            // extension sending to itself
            // (only for including trezor.js in the management part of the extension)
            chrome.runtime.sendMessage(message, {}, callback);
        } else {
            // either another extension, or not sent from extension at all
            // (this will be run most probably)
            chrome.runtime.sendMessage(extensionId, message, {}, callback);
        }
    });
};
