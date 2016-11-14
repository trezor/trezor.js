'use strict'

// Import modules
const electron = require('electron')

const app = electron.app
const BrowserWindow = electron.BrowserWindow

let hotReloadServer = require('hot-reload-server')
let webpackConfig = require('./webpack.config')
hotReloadServer(webpackConfig, {
  publicPath: '/dist'
}).start()

// Create a variable to hold the window
let mainWindow = null

app.on('ready', function() {

  // creates a new browser window
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
  })

  setHeaders(mainWindow)

  // load the file
  mainWindow.loadURL('file://' + __dirname + '/index.html')

  // Register window events
  mainWindow.on('closed', function() {
    mainWindow = null
  })
})

function setHeaders(mainWindow) {
  let session = mainWindow.webContents.session
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    let url = details.url
    if (url.startsWith('https://localback.net:21324')) {
      if (details.requestHeaders.Origin === 'null') {
        delete details.requestHeaders.Origin
      }
    }
    callback({cancel: false, requestHeaders: details.requestHeaders});
  })
}
