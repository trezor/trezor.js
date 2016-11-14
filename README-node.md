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

Example of usage is on `example-browser/`, `example-node/` and `example-electron-webpack/` on github.

#### Flow
trezor.js is annotated with [Flow](https://github.com/facebook/flow) types; if you want to use Flow and use the previous setup, it will use the right types. Note that you might have to set up `.flowconfig` to include all the modules and interface files in [our flowconfig](https://github.com/trezor/trezor.js/blob/master/lib/.flowconfig)

Using trezor.js in a node app
-----
In a node app, trezor.js will first try to contact trezord (see above). If the trezord daemon isn't installed or is not accessible for some reason, trezor.js will use node-hid layer and the app will communicate with TREZOR directly.

Using `trezor.js` in Electron projects
----
Unfortunately, it's a little work to make trezor.js work in Electron. Three steps.

### 1. Rebuild electron

In your electron project, add `electron-rebuild` and `electron` to your `devDependencies`.
Then in your package.json `scripts` add:

```
  "postinstall": "electron-rebuild --pre-gyp-fix --force"
```

This will be run on `npm install` and will rebuild electron to support `node-hid` (the library we use). You can also run the postinstall script yourself (`npm run postinstall`).

If you are using `yarn` (as we do), make sure you have 0.16.1 or newer. If you have an older version, you will have to run the postinstall script yourself.

### 2. Set up webpack

If you use webpack inside electron (in the renderer window), you will have to add `'trezor.js-node': 'require("trezor.js-node")'` to externals; see the example.

### Removing origin: null for bridge

Because we default to `trezord` if it's installed, but there is an [issue](https://github.com/electron/electron/issues/7931) with electron and origins, you will need to add a similar code to your code after you open electron window:

```javascript
session.webRequest.onBeforeSendHeaders((details, callback) => {
  let url = details.url
  if (url.startsWith('https://localback.net:21324')) {
    if (details.requestHeaders.Origin === 'null') {
      delete details.requestHeaders.Origin;
    }
  }
  callback({cancel: false, requestHeaders: details.requestHeaders});
})
```

Using `trezor.js` in NW.js projects
----

```bash
npm install node-pre-gyp
./node_modules/.bin/node-pre-gyp rebuild --runtime=node-webkit --target=0.12.3
```   

You can change 0.12.3 to version nwjs that you want to deploy.

trezor.js API
---
API is explained in [API.md](https://github.com/trezor/trezor.js/blob/master/API.md)
