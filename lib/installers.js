var BRIDGE_VERSION_URL = '/data/bridge/latest.txt',
    BRIDGE_INSTALLERS = [{
        url: '/data/bridge/%version%/trezor-bridge-%version%-win64.msi',
        label: 'Windows 64-bit',
        platform: 'win64'
    }, {
        url: '/data/bridge/%version%/trezor-bridge-%version%-win32.msi',
        label: 'Windows 32-bit',
        platform: 'win32'
    }, {
        url: '/data/bridge/%version%/trezor-bridge-%version%.pkg',
        label: 'Mac OS X',
        platform: 'mac'
    }, {
        url: '/data/bridge/%version%/trezor-bridge_%version%_amd64.deb',
        label: 'Linux 64-bit (deb)',
        platform: 'deb64'
    }, {
        url: '/data/bridge/%version%/trezor-bridge-%version%-1.x86_64.rpm',
        label: 'Linux 64-bit (rpm)',
        platform: 'rpm64'
    }, {
        url: '/data/bridge/%version%/trezor-bridge_%version%_i386.deb',
        label: 'Linux 32-bit (deb)',
        platform: 'deb32'
    }, {
        url: '/data/bridge/%version%/trezor-bridge-%version%-1.i386.rpm',
        label: 'Linux 32-bit (rpm)',
        platform: 'rpm32'
    }];

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
            preferred: (bridge.platform === platform)
        };
    });
};

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

module.exports = installers;
