'use strict';

var DATA_DOMAIN = 'https://mytrezor.s3.amazonaws.com'

function fillInstallerUrl(installer) {
    installer.url = DATA_DOMAIN + installer.shortUrl;
    return installer;
}

var BRIDGE_VERSION_URL = DATA_DOMAIN + '/bridge/latest.txt';

var BRIDGE_INSTALLERS = [{
    shortUrl: '/bridge/%version%/trezor-bridge-%version%-win32-install.exe',
    label: 'Windows',
    platform: ['win32', 'win64']
}, {
    shortUrl: '/bridge/%version%/trezor-bridge-%version%.pkg',
    label: 'Mac OS X',
    platform: 'mac'
}, {
    shortUrl: '/bridge/%version%/trezor-bridge_%version%_amd64.deb',
    label: 'Linux 64-bit (deb)',
    platform: 'deb64'
}, {
    shortUrl: '/bridge/%version%/trezor-bridge-%version%-1.x86_64.rpm',
    label: 'Linux 64-bit (rpm)',
    platform: 'rpm64'
}, {
    shortUrl: '/bridge/%version%/trezor-bridge_%version%_i386.deb',
    label: 'Linux 32-bit (deb)',
    platform: 'deb32'
}, {
    shortUrl: '/bridge/%version%/trezor-bridge-%version%-1.i386.rpm',
    label: 'Linux 32-bit (rpm)',
    platform: 'rpm32'
}].map(fillInstallerUrl);

var UDEV_INSTALLERS = [{
    shortUrl: '/udev/trezor-udev-1-1.noarch.rpm',
    label: 'RPM package',
    platform: ['rpm32', 'rpm64']
}, {
    shortUrl: '/udev/trezor-udev_1_all.deb',
    label: 'DEB package',
    platform: ['deb32', 'deb64']
}].map(fillInstallerUrl);

function udevInstallers(options) {
    var o = options || {},
        platform = o.platform || preferredPlatform();

    return UDEV_INSTALLERS.map(function (udev) {
        return {
            url: udev.url,
            label: udev.label,
            platform: udev.platform,
            preferred: isPreferred(udev.platform, platform)
        }
    });
}

// Note: this blocks because request blocks
function latestVersion(options) {
    var o = options || {},
        bridgeUrl = o.bridgeUrl || BRIDGE_VERSION_URL,
        version = requestUri(bridgeUrl).trim();
    return version;
}

// Returns a list of bridge installers, with download URLs and a mark on
// bridge preferred for the user's platform.
function installers(options) {
    var o = options || {},
        version = o.version || latestVersion(options),
        platform = o.platform || preferredPlatform();

    return BRIDGE_INSTALLERS.map(function (bridge) {
        return {
            version: version,
            url: bridge.url.replace(/%version%/g, version),
            label: bridge.label,
            platform: bridge.platform,
            preferred: isPreferred(bridge.platform, platform)
        };
    });

}

function isPreferred(installer, platform) {
    if (typeof installer === 'string') { // single platform
        return installer === platform;
    } else { // any of multiple platforms
        for (var i = 0; i < installer.length; i++) {
            if (installer[i] === platform) {
                return true
            }
        }
        return false;
    }
}

function preferredPlatform() {
    var ver = navigator.userAgent;

    if (ver.match(/Win64|WOW64/)) return 'win64';
    if (ver.match(/Win/)) return 'win32';
    if (ver.match(/Mac/)) return 'mac';
    if (ver.match(/Linux i[3456]86/))
        return ver.match(/CentOS|Fedora|Mandriva|Mageia|Red Hat|Scientific|SUSE/)
            ? 'rpm32' : 'deb32';
    if (ver.match(/Linux/))
        return ver.match(/CentOS|Fedora|Mandriva|Mageia|Red Hat|Scientific|SUSE/)
            ? 'rpm64' : 'deb64';
}

function requestUri(url) {
    var req = new XMLHttpRequest();

    req.open('get', url, false);
    req.send();

    if (req.status !== 200)
        throw new Error('Failed to GET ' + url);

    return req.responseText;
}

module.exports.installers = installers;
module.exports.installers.latestVersion = latestVersion;
module.exports.udevInstallers = udevInstallers;
