trezor.js
=========

[![Build Status](https://travis-ci.org/trezor/trezor.js.svg?branch=master)](https://travis-ci.org/trezor/trezor.js)

Javascript API for Bitcoin TREZOR.

Use this library if you want deeper integration of TREZOR into your web app.

You should first look at [TREZOR Connect](https://github.com/trezor/connect) - a very simple and high-level API - if it's not enough. The upside of using Connect is that you don't need to deal with device management and message sending; however, the amount of things you can do through Connect is limited and you cannot customize the UI. With trezor.js, you can do everything that's possible with TREZOR. (We use trezor.js for myTREZOR itself.)

We have two versions - one for node, one for browser.

`npm install trezor.js` for the browser version.

`npm install trezor.js-node` for the node version.

Read more in [README-node.md](https://github.com/trezor/trezor.js/blob/master/README-node.md), [README-browser.md](https://github.com/trezor/trezor.js/blob/master/README-browser.md), [API.md](https://github.com/trezor/trezor.js/blob/master/API.md)

