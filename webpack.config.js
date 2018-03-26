const path = require('path');
const webpack = require('webpack');

// const version = require("./package.json").version;
// const banner = "/**\n" + " * moleculer-ws-client v" + version + "\n" + " * https://github.com/ColonelBundy/moleculer-ws-client\n" + " * Released under the MIT License.\n" + " */\n";

const Visualizer = require('webpack-visualizer-plugin');

module.exports = {
	entry: './src/index.ts',
	mode: 'production',

	module: {
		rules: [{
			test: /\.tsx?$/,
			use: 'ts-loader',
			exclude: /node_modules/
		}]
	},

	resolve: {
		extensions: ['.tsx', '.ts', '.js']
	},

	output: {
		filename: 'moleculer-ws-client.js',
		path: path.resolve(__dirname, 'dist'),
		library: "MoleculerWs",
		libraryTarget: "umd"
	},

	plugins: [
		new webpack.IgnorePlugin(/^ws$/),
		// new webpack.BannerPlugin({
		// 	banner,
		// 	raw: true
		// }),

		new Visualizer()
	]
};