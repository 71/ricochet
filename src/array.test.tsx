import { h }                                from '.'
import { ObservableArray, observableArray } from './array'

describe('Observable array utilities', () => {
  it('Proxies functions correctly', () => {

  })

  it('Keeps mapped arrays in sync', () => {
    const a = observableArray(1, 3)
    const b = a.sync(x => x * 2)

    expect(a[0]).toBe(1)
    expect(b[0]).toBe(2)

    expect(a[1]).toBe(3)
    expect(b[1]).toBe(6)

    expect(a.push(5)).toBe(3)
    expect(a.length).toBe(3)

    expect(b.length).toBe(3)
    expect(a[2]).toBe(5)
    expect(b[2]).toBe(10)

    const c = a.sync(x => ''+x, x => +x)

    expect(c[0]).toBe('1')
    expect(c[1]).toBe('3')
    expect(c[2]).toBe('5')

    a[2] = 42

    expect(a[2]).toBe(42)
    expect(b[2]).toBe(84)
    expect(c[2]).toBe('42')

    c[1] = '9'

    expect(a[1]).toBe(9)
    expect(b[1]).toBe(18)
    expect(c[1]).toBe('9')
  })

  it('Keeps mapped arrays in sync (other operations)', () => {
    const a = observableArray(1, 2, 3)
    const b = a.sync(x => x * 2)
    const c = a.sync(x => ''+x, x => +x)

    function check() {
      for (let i = 0; i < a.length; i++) {
        expect(b[i]).toBe(a[i] * 2)
        expect(c[i]).toBe(''+ a[i])
      }
    }

    check()

    a.reverse()
    check()

    c.reverse()
    check()
  })

  const NumberList = ({ numbers }: { numbers: ObservableArray<number> }) => (
    <ul>
      { numbers.sync((n, i) => <li className={'number-'+i}>{n}</li>) }
    </ul>
  )

  it('Keeps the DOM in sync with the array', () => {
    const numbers = observableArray(1, 2, 3)
    const dom = <NumberList numbers={numbers} />

    expect(dom.childElementCount).toBe(3)

    function check() {
      for (let i = 0; i < numbers.length; i++) {
        expect(dom.children[i].className).toBe('number-' + i)
        expect(dom.children[i].textContent).toBe(numbers[i].toString())
      }
    }

    check()
  })
})
