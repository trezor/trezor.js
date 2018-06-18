
trezor.js
=========

[![Build Status](https://travis-ci.org/trezor/trezor.js.svg?branch=master)](https://travis-ci.org/trezor/trezor.js)

Javascript API for Trezor.

We are currently migrating from this library to Trezor Connect. When Trezor Connect is done and tested, this library will be deprecated.

Right now, you can use this library for integrating into node js apps. 

Install with npm
-----

`npm install --save trezor.js`

#### Flow
trezor.js is annotated with [Flow](https://github.com/facebook/flow) types; if you want to use Flow and use the previous setup, it will use the right types. Note that you might have to set up `.flowconfig` to include all the modules and interface files in [our flowconfig](https://github.com/trezor/trezor.js/blob/master/lib/.flowconfig)

to run flow use `make flow` 

#### Build 
to build production bundle run `make build`

#### eslint
`make eslint`

Using trezor.js in a web app
----
We are winding down trezor.js for web apps. Please use TREZOR Connect.

Using trezor.js in a node app
----
Trezor.js should be possible to use from node.js if the user has Trezor Bridge installed, because origin URLs are spoofed.

Trezor used to work with node HID API directly, but the binary API and the various node versions got too hard to manage, so we removed them.

trezor.js API
-----

API is explained in [API.md](https://github.com/trezor/trezor.js/blob/master/API.md)
