module.exports = {
  mode: 'production',
  entry: {
    'dist/index': './src/index.ts',
    'dist/async': './src/async.ts',
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ]
  },
  output: {
    path: __dirname,
    filename: '[name].js',
    libraryTarget: 'umd',
    library: 'ricochet',
    umdNamedDefine: true,
    globalObject: 'this'
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'awesome-typescript-loader',
        exclude: /node_modules/
      }
    ]
  },
  devtool: 'source-map'
}
