// Jest has inconsistent behavior with the actual browser,
// so we use this script to run all tests manually.
//
// ... Sorry.

window['expect'] = function (a: any) {
  function assert(condition: () => boolean, values: object) {
    let cond = condition.toString()

    cond = cond.replace(/^function \(\) {\s*return\s*|\s*;\s*}\s*$/g, '')
    cond = cond.replace(new RegExp('\\b(?:' + Object.keys(values).join('|') + ')\\b', 'g'), substring => JSON.stringify(values[substring]))

    if (condition())
      return

    console.error(cond, values)
    throw 'ASSERT'
  }

  return {
    toBe: (b: any) => assert(() => a == b, { a, b }),
    toBeGreaterThan: (b: any) => assert(() => a > b, { a, b }),
    toBeUndefined: () => assert(() => a === undefined, { a }),

    not: {
      toBe: (b: any) => assert(() => a != b, { a, b }),
    },
  }
}

window['it'] = function (name: string, test: () => void) {
  try {
    test()

    console.log('%c✔ %c' + name, 'color: green;', 'font-weight: bold;')
  } catch (err) {
    if (err === 'ASSERT')
      console.log('%c✘ %c' + name, 'color: red;', 'font-weight: bold;')
    else
      throw err
  }
}

window['describe'] = function (name: string, suite: () => void) {
  console.log('\n%c' + name + '%c:', 'font-weight: bold;', '')

  suite()
}

import '../src/array.test'
import '../src/async.test'
import '../src/index.test'
import '../src/reactive.test'

import '../src/internal/index.test'
import '../src/internal/test-utils.test'

import '../src/interop/rxjs.test'
import '../src/interop/wc.test'
