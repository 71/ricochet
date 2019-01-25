const plugins = [
  ['@babel/plugin-transform-typescript', {
    isTSX: true
  }]
]

if (process.env.IN_EXAMPLES) {
  plugins.push([require('./dist/index.js').default, {
    runtimeImport: 'runtime'
  }])
}

module.exports = {
  plugins: plugins
}
