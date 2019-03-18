import { subject, combine } from './reactive'

describe('Built-in reactive utilities', () => {
  it('Creates valid subjects', () => {
    const foo = subject(1)

    expect(foo.value).toBe(1)

    foo.subscribe(v => expect(v).toBe(1)).unsubscribe()
    foo.subscribe(v => expect(v).toBe(1)).unsubscribe()

    foo.next(2)

    expect(foo.value).toBe(2)

    foo.subscribe(v => expect(v).toBe(2)).unsubscribe()
    foo.subscribe(v => expect(v).toBe(2)).unsubscribe()

    let expected = 2

    foo.subscribe(v => expect(v).toBe(expected++))

    foo.next(foo.value + 1)
    foo.next(foo.value + 1)
  })

  it('Combines observable streams correctly', () => {
    const foo = subject(1)
    const bar = subject('')

    const foobar = combine(foo, bar)

    foobar.subscribe(([vFoo, vBar]) => {
      expect(vFoo).toBe(foo.value)
      expect(vBar).toBe(bar.value)
    })

    foo.next(2)
    bar.next('baz')
  })
})
