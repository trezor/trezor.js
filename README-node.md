trezor.js
=========

[![Build Status](https://travis-ci.org/trezor/trezor.js.svg?branch=master)](https://travis-ci.org/trezor/trezor.js)

Javascript API for Bitcoin TREZOR.

Use this library if you want deeper integration of TREZOR into your node app, including electron.

If you are including the library in web app, try `trezor.js` package.

Install with npm
-----

`npm install --save trezor.js-node`

We are dependent (through trezor-link) on `node-hid`, which is compiled C++ package. If there is some problems, just write us an issue.

#### Examples

Example of usage is on `example-browser/` on github.

#### Flow
trezor.js is annotated with [Flow](https://github.com/facebook/flow) types; if you want to use Flow and use the previous setup, it will use the right types. Note that you might have to set up `.flowconfig` to include all the modules and interface files in [our flowconfig](https://github.com/trezor/trezor.js/blob/master/lib/.flowconfig)

Using trezor.js in a node app
-----
In a node app, trezor.js will first try to contact trezord (see above). If the trezord daemon isn't installed or is not accessible for some reason, trezor.js will use node-hid layer and the app will communicate with TREZOR directly.

Using `trezor.js` in Electron projects
----
In your electron project, add `electron-rebuild` and `electron` to your `devDependencies`.
Then in your package.json `scripts` add:

```
  "postinstall": "electron-rebuild --pre-gyp-fix --force"
```

If you already installed your project, you can run the rebuild yourself

```
   $(npm bin)/electron-rebuild --pre-gyp-fix --force
```

(note: we recommend using `yarn` instead of `npm install` for installation, since it's quicker and with less headache.)

Using `trezor.js` in NW.js projects
----

```
    npm install node-pre-gyp
    ./node_modules/.bin/node-pre-gyp rebuild --runtime=node-webkit --target=0.12.3
```   

You can change 0.12.3 to version nwjs that you want to deploy.

trezor.js API
---
API is explained in [API.md](https://github.com/trezor/trezor.js/blob/master/API.md)
