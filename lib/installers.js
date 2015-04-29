// var BRIDGE_VERSION_URL = '/data/bridge/latest.txt',
//     BRIDGE_INSTALLERS = [{
//         url: '/data/bridge/%version%/trezor-bridge-%version%-win64.msi',
//         label: 'Windows 64-bit',
//         platform: 'win64'
//     }, {
//         url: '/data/bridge/%version%/trezor-bridge-%version%-win32.msi',
//         label: 'Windows 32-bit',
//         platform: 'win32'
//     }, {
//         url: '/data/bridge/%version%/trezor-bridge-%version%.pkg',
//         label: 'Mac OS X',
//         platform: 'mac'
//     }, {
//         url: '/data/bridge/%version%/trezor-bridge_%version%_amd64.deb',
//         label: 'Linux 64-bit (deb)',
//         platform: 'deb64'
//     }, {
//         url: '/data/bridge/%version%/trezor-bridge-%version%-1.x86_64.rpm',
//         label: 'Linux 64-bit (rpm)',
//         platform: 'rpm64'
//     }, {
//         url: '/data/bridge/%version%/trezor-bridge_%version%_i386.deb',
//         label: 'Linux 32-bit (deb)',
//         platform: 'deb32'
//     }, {
//         url: '/data/bridge/%version%/trezor-bridge-%version%-1.i386.rpm',
//         label: 'Linux 32-bit (rpm)',
//         platform: 'rpm32'
//     }];

var DATA_DOMAIN = 'https://mytrezor.s3.eu-central-1.amazonaws.com'

function fillInstallerUrl(installer) {
    installer.url = DATA_DOMAIN + installer.shortUrl;
    return installer;
}

var BRIDGE_VERSION_URL = DATA_DOMAIN + '/plugin/latest.txt',
    BRIDGE_INSTALLERS = [{
        shortUrl: '/plugin/%version%/BitcoinTrezorPlugin-%version%.msi',
        label: 'Windows',
        platform: ['win32', 'win64']
    }, {
        shortUrl: '/plugin/%version%/trezor-plugin-%version%.dmg',
        label: 'Mac OS X',
        platform: 'mac'
    }, {
        shortUrl: '/plugin/%version%/browser-plugin-trezor_%version%_amd64.deb',
        label: 'Linux x86_64 (deb)',
        platform: 'deb64'
    }, {
        shortUrl: '/plugin/%version%/browser-plugin-trezor-%version%.x86_64.rpm',
        label: 'Linux x86_64 (rpm)',
        platform: 'rpm64'
    }, {
        shortUrl: '/plugin/%version%/browser-plugin-trezor_%version%_i386.deb',
        label: 'Linux i386 (deb)',
        platform: 'deb32'
    }, {
        shortUrl: '/plugin/%version%/browser-plugin-trezor-%version%.i386.rpm',
        label: 'Linux i386 (rpm)',
        platform: 'rpm32'
    }].map(fillInstallerUrl);
var UDEV_INSTALLERS =  [{
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

// Returns a list of bridge installers, with download URLs and a mark on
// bridge preferred for the user's platform.
function installers(options) {
    var o = options || {},
        bridgeUrl = o.bridgeUrl || BRIDGE_VERSION_URL,
        version = o.version || requestUri(bridgeUrl).trim(),
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

};
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
module.exports.udevInstallers = udevInstallers;
