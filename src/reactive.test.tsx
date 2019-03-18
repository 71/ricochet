import { ObservableSymbol }          from '.'
import { subject, combine, compute } from './reactive'

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

  it('Creates valid computation observables', () => {
    const a = subject(1)
    const b = subject(2)

    const computation = compute($ => $(a) + $(b))
    let lastResult = a.value + b.value

    computation[ObservableSymbol]().subscribe(x => {
      expect(lastResult = x).toBe(a.value + b.value)
    })

    expect(lastResult).toBe(3)

    a.next(10)
    expect(lastResult).toBe(12)

    b.next(42)
    expect(lastResult).toBe(52)
  })

  it('Combines observable streams correctly', () => {
    const foo = subject(1)
    const bar = subject('')

    const foobar = combine(foo, bar)

    let sum = ''

    foobar.subscribe(([vFoo, vBar]) => {
      expect(vFoo).toBe(foo.value)
      expect(vBar).toBe(bar.value)

      sum = vFoo + vBar
    })

    foo.next(2)
    bar.next('baz')

    expect(sum).toBe('2baz')
  })
})
