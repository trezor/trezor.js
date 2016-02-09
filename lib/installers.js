/* @flow */
'use strict';

export type BridgeInstaller = {
    version: string;
    url: string;
    label: string;
    platform: string | Array<string>;
    preferred: boolean;
}

export type UdevInstaller = {
    url: string;
    label: string;
    platform: string | Array<string>;
    preferred: boolean;
}

const DATA_DOMAIN = 'https://mytrezor.s3.amazonaws.com';

type ProtoInstallerShort = {
    shortUrl: string;
    label: string;
    platform: string | Array<string>;
}

type ProtoInstaller = {
    url: string;
    label: string;
    platform: string | Array<string>;
}

function fillInstallerUrl(installer: ProtoInstallerShort): ProtoInstaller {
    return {
        url: DATA_DOMAIN + installer.shortUrl,
        label: installer.label,
        platform: installer.platform,
    };
}

const BRIDGE_VERSION_URL: string = DATA_DOMAIN + '/bridge/latest.txt';

const BRIDGE_INSTALLERS: Array<ProtoInstaller> = [{
    shortUrl: '/bridge/%version%/trezor-bridge-%version%-win32-install.exe',
    label: 'Windows',
    platform: ['win32', 'win64'],
}, {
    shortUrl: '/bridge/%version%/trezor-bridge-%version%.pkg',
    label: 'Mac OS X',
    platform: 'mac',
}, {
    shortUrl: '/bridge/%version%/trezor-bridge_%version%_amd64.deb',
    label: 'Linux 64-bit (deb)',
    platform: 'deb64',
}, {
    shortUrl: '/bridge/%version%/trezor-bridge-%version%-1.x86_64.rpm',
    label: 'Linux 64-bit (rpm)',
    platform: 'rpm64',
}, {
    shortUrl: '/bridge/%version%/trezor-bridge_%version%_i386.deb',
    label: 'Linux 32-bit (deb)',
    platform: 'deb32',
}, {
    shortUrl: '/bridge/%version%/trezor-bridge-%version%-1.i386.rpm',
    label: 'Linux 32-bit (rpm)',
    platform: 'rpm32',
}].map(fillInstallerUrl);

const UDEV_INSTALLERS: Array<ProtoInstaller> = [{
    shortUrl: '/udev/trezor-udev-1-1.noarch.rpm',
    label: 'RPM package',
    platform: ['rpm32', 'rpm64'],
}, {
    shortUrl: '/udev/trezor-udev_1_all.deb',
    label: 'DEB package',
    platform: ['deb32', 'deb64'],
}].map(fillInstallerUrl);

type UdevOptions = {
    platform?: string;
};

export function udevInstallers(options: ?UdevOptions): Array<UdevInstaller> {
    const o: UdevOptions = options || {};
    const platform: string = o.platform || preferredPlatform();

    return UDEV_INSTALLERS.map(function (udev: ProtoInstaller): UdevInstaller {
        return {
            url: udev.url,
            label: udev.label,
            platform: udev.platform,
            preferred: isPreferred(udev.platform, platform),
        };
    });
}

type VersionOptions = {
    bridgeUrl?: string;
}

// Note: this blocks because request blocks
export function latestVersion(options: ?VersionOptions): string {
    const o: VersionOptions = options || {};
    const bridgeUrl: string = o.bridgeUrl || BRIDGE_VERSION_URL;
    const version: string = requestUri(bridgeUrl).trim();
    return version;
}

type BridgeOptions = {
    platform?: string;
    version?: string;
    bridgeUrl?: string;
};

// Returns a list of bridge installers, with download URLs and a mark on
// bridge preferred for the user's platform.
export function installers(options: ?BridgeOptions): Array<BridgeInstaller> {
    const o: BridgeOptions = options || {};
    const version: string = o.version || latestVersion(options);
    const platform: string = o.platform || preferredPlatform();

    return BRIDGE_INSTALLERS.map(function (bridge: ProtoInstaller): BridgeInstaller {
        return {
            version: version,
            url: bridge.url.replace(/%version%/g, version),
            label: bridge.label,
            platform: bridge.platform,
            preferred: isPreferred(bridge.platform, platform),
        };
    });
}

// legacy API :-(
installers.latestVersion = latestVersion;

function isPreferred(installer: string | Array<string>, platform: string): boolean {
    if (typeof installer === 'string') { // single platform
        return installer === platform;
    } else { // any of multiple platforms
        for (let i = 0; i < installer.length; i++) {
            if (installer[i] === platform) {
                return true;
            }
        }
        return false;
    }
}

function preferredPlatform(): string {
    const ver = navigator.userAgent;

    if (ver.match(/Win64|WOW64/)) return 'win64';
    if (ver.match(/Win/)) return 'win32';
    if (ver.match(/Mac/)) return 'mac';
    if (ver.match(/Linux i[3456]86/)) {
        return ver.match(/CentOS|Fedora|Mandriva|Mageia|Red Hat|Scientific|SUSE/)
            ? 'rpm32' : 'deb32';
    }
    if (ver.match(/Linux/)) {
        return ver.match(/CentOS|Fedora|Mandriva|Mageia|Red Hat|Scientific|SUSE/)
            ? 'rpm64' : 'deb64';
    }

    // fallback - weird OS
    // most likely windows, let's say 32 bit
    return 'win32';
}

function requestUri(url: string): string {
    const req = new XMLHttpRequest();

    req.open('get', url, false);
    req.send();

    if (req.status !== 200) {
        throw new Error('Failed to GET ' + url);
    }

    return req.responseText;
}
