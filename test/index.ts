import * as babel from '@babel/core'
import plugin     from '../src'

import { readFileSync } from 'fs'


const options = {
  presets: [
    '@babel/preset-env'
  ],

  plugins: [
    ['@babel/plugin-transform-typescript', {
      isTSX: true
    }],
    [plugin, {
      runtime: true,
      runtimeImport: 'runtime'
    }]
  ]
}

it('works', () => {
  const source = readFileSync(__dirname + '/../examples/todo/index.tsx', 'utf8')
  const { code } = babel.transformSync(source, options)

  console.log(code)
})
