/* @flow */
'use strict';

// Taken from https://github.com/substack/semver-compare/blob/master/index.js
export default function semvercmp(a: string, b: string): number {
    const pa = a.split('.');
    const pb = b.split('.');

    for (let i = 0; i < 3; i++) {
        const na = Number(pa[i]);
        const nb = Number(pb[i]);
        if (na > nb) return 1;
        if (nb > na) return -1;
        if (!isNaN(na) && isNaN(nb)) return 1;
        if (isNaN(na) && !isNaN(nb)) return -1;
    }

    return 0;
}
