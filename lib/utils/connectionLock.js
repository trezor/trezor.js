"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.lock = lock;
let currentP = Promise.resolve();

function lock(fn) {
    const res = currentP.then(() => fn());
    currentP = res.catch(() => true);
    return res;
}