trezor.js
=========

[![Build Status](https://travis-ci.org/trezor/trezor.js.svg?branch=master)](https://travis-ci.org/trezor/trezor.js)

Javascript API for Bitcoin TREZOR.

Use this library if you want deeper integration of TREZOR into your node app, including electron.

If you are including the library in web app, try `trezor.js` package.

Install with npm
-----

`npm install --save trezor.js`

We use some ES6 methods (Array.find etc), that aren't in all browsers as of now, so if you are targetting older browsers/mobile browsers, you have to add babel polyfill. See https://www.npmjs.com/package/babel-polyfill and https://babeljs.io/docs/usage/polyfill/

#### Examples

Example of usage is on `example-browser/`, `example-node/` and `example-electron-webpack/` on github.

#### Flow
trezor.js is annotated with [Flow](https://github.com/facebook/flow) types; if you want to use Flow and use the previous setup, it will use the right types. Note that you might have to set up `.flowconfig` to include all the modules and interface files in [our flowconfig](https://github.com/trezor/trezor.js/blob/master/lib/.flowconfig)

Install by copying
-----
Just download and copy `dist/trezor.js` or `dist/trezor.min.js` from the repo. 

You might have to add polyfill, see above.

Using trezor.js in a web app
----
If you are using trezor.js in a web app, the *end user* has to install one of our transport layers. Also, the web app's URL has to be whitelisted specifically by SatoshiLabs.

#### Transport layers
We have two transport layers. The user needs to install one of them.

One is [TREZOR Chrome extension](https://github.com/trezor/trezor-chrome-extension) for the users that have Chrome and want an easier, one-click installation.

Other is [TREZOR bridge](https://github.com/trezor/trezord) (or `trezord`) that works cross-browser.

#### Whitelisting

You cannot connect to transport layers from anywhere on the internet. Your URL needs to be specifically whitelisted by SatoshiLabs.

`localhost` is specifically whitelisted, so you can experiment on `http://localhost/*`. If you want to add your url in order to make a TREZOR web application, [make a pull request to this file](https://github.com/trezor/trezor-common/blob/master/signer/config.json).

trezor.js API
-----

API is explained in [API.md](https://github.com/trezor/trezor.js/blob/master/API.md)
