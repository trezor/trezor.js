trezor.js
=========

[![Build Status](https://travis-ci.org/trezor/trezor.js.svg?branch=master)](https://travis-ci.org/trezor/trezor.js)

High-level Javascript API for Bitcoin Trezor

Usage
-----

Compile with:

	npm install
	npm run build

See `doc/example.js` for API usage.

Compilation output in `dist/trezor.js` is expected as up to date in
the latest master commit, to support installation with Bower.

Note: you need to import `babel-polyfill` or core.js shim for this library to work properly
