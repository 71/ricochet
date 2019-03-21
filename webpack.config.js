module.exports = {
  mode: 'production',
  entry: {
    'index': './src/index.ts',

    'array'   : './src/array.ts',
    'async'   : './src/async.ts',
    'reactive': './src/reactive.ts',

    'interop/rxjs': './src/interop/rxjs.ts',
    'interop/wc'  : './src/interop/wc.ts',
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ],
  },
  output: {
    path: __dirname,
    filename: '[name].js',
    libraryTarget: 'umd',
    library: 'ricochet',
    umdNamedDefine: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'awesome-typescript-loader',
        exclude: /node_modules/,
      },
    ],
  },
  externals: [
    'rxjs'
  ],
  devtool: 'source-map',
}
