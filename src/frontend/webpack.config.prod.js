const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const OfflinePlugin = require('offline-plugin');
const ArchivePlugin = require('webpack-archive-plugin');

module.exports = {
  devtool: 'source-map',
  entry: './src/index.tsx',
  output: {
    path: path.join(__dirname, 'dist'),
    filename: 'bundle.[chunkhash].js',
    publicPath: './'
  },
  plugins: [
    new CleanWebpackPlugin(['dist'], { verbose: false }),
    new CopyWebpackPlugin([
      { from: 'images/', to: 'images/' },
      {
        from: 'favicon.ico'
      },
      { from: 'manifest.json' },
      {
        from: './node_modules/monaco-editor/min/vs',
        to: 'vs',
      },
      { context: './node_modules/seashell-clang-js/bin/',
        from: '*.mem', to: './' },
      { context: './node_modules/seashell-clang-js/bin/',
        from: '*.data', to: './' },
  ]),
/*
    new webpack.optimize.UglifyJsPlugin({
      compress: {
        warnings: false,
      },
      sourceMap: true,
      minimize: true
    }),
*/
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production')
    }),
    new HtmlWebpackPlugin ({
      inject: true,
      template: './src/index.html'
    }),
    new ArchivePlugin(),
    new webpack.DefinePlugin({
      IS_BROWSER: true,
      PRODUCTION: true,
    }),
    new OfflinePlugin({
      ServiceWorker:{
        navigateFallbackURL: '/'
      }
    }),
  ],
  resolve: {
      // Add '.ts' and '.tsx' as resolvable extensions.
      extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js", ".scss"]
  },
  module: {
    rules: [
      { enforce: 'pre', test: /\.js$/, loader: "source-map-loader" },
      { enforce: 'pre', test: /\.tsx?$/, loader: "tslint-loader" },
      { test: /\.tsx?$/, loader: "awesome-typescript-loader" },
      {
        test: /\.scss$/,
        use: [
          'style-loader?sourceMap',
          'css-loader?modules&importLoaders=1&localIdentName=[path]___[name]__[local]___[hash:base64:5]',
          'sass-loader?sourceMap'
          // { loader: "style-loader", query: { sourceMap: true }},
          // { loader: "css-loader", query: {modules: true, importLoaders: 1, localIdentName: "[path]___[name]__[local]___[hash:base64:5]" }},
          // { loader: "sass-loader", query: { sourceMap: true }}
        ]
      }, {
        test: /\.css$/,
        use: ["style-loader", "css-loader"]
      }, {
        test: /\.(woff|woff2|ttf|eot)$/,
        use: ['file-loader']
      },
      {
        test: /\.(jpe?g|png|gif|svg)$/i,
        use: [
          'file-loader?hash=sha512&digest=hex&name=[hash].[ext]',
          'image-webpack-loader?bypassOnDebug&optimizationLevel=7&interlaced=false'
        ]
      }
    ],
  },
};
