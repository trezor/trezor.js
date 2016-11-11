const webpack = require('webpack')
const path = require('path')
const webpackTargetElectronRenderer = require('webpack-target-electron-renderer')

const config = {
	entry: [
		path.join(__dirname, '/app/index.js')
	],
	output: {
		path: path.join(__dirname, '/dist'),
		filename: 'bundle.js'
	},
	module: {
		loaders: [
			{
				test: /\.js$/,
				exclude: /node_modules/,
				loaders: ['babel']
			},
			{
				test: /\.html$/,
				loaders: ['html']
			},
		]
	},
	plugins: [new webpack.HotModuleReplacementPlugin()],
  
  // Needed! Otherwise, webpack tries to package the native libraries and fails
  externals: {
    'trezor.js-node': 'require("trezor.js-node")'
  },

  publicPath: 'http://localhost:4000/dist/',
  entry:  [
    'webpack-hot-middleware/client?path=http://localhost:4000/__webpack_hmr&reload=true',
    path.join(__dirname, '/app/index.js')
  ]
}


config.target = webpackTargetElectronRenderer(config)

module.exports = config
