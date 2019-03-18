import { h }                                from '.'
import { ObservableArray, observableArray } from './array'

describe('Observable array utilities', () => {
  it('Proxies functions correctly', () => {

  })

  it('Keeps mapped arrays in sync', () => {

  })

  const NumberList = ({ numbers }: { numbers: ObservableArray<number> }) => (
    <ul>
      { numbers.map((n, i) => <li className={'number-'+i}>{n}</li>) }
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
