/* @flow */
'use strict';

// Taken from https://github.com/substack/semver-compare/blob/master/index.js
export default function semvercmp(a: string, b: string): number {
    var pa = a.split('.');
    var pb = b.split('.');

    for (var i = 0; i < 3; i++) {
        var na = Number(pa[i]);
        var nb = Number(pb[i]);
        if (na > nb) return 1;
        if (nb > na) return -1;
        if (!isNaN(na) && isNaN(nb)) return 1;
        if (isNaN(na) && !isNaN(nb)) return -1;
    }

    return 0;
}
