const path = require('path');
const webpack = require('webpack');

//const Visualizer = require('webpack-visualizer-plugin');

module.exports = {
  entry: './src/index.ts',
  mode: 'production',

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                outDir: '.'
              }
            }
          }
        ],
        exclude: /node_modules/
      }
    ]
  },

  resolve: {
    extensions: ['.tsx', '.ts', '.js']
  },

  output: {
    filename: 'moleculer-ws-client.js',
    path: path.resolve(__dirname, 'dist'),
    library: 'MoleculerWs',
    libraryTarget: 'umd'
  },

  plugins: [
    new webpack.IgnorePlugin(/^ws$/) // If you are using this for web.
    //new Visualizer()
  ]
};
