import { h, eventListener, valueBinder } from '.'
import { subject }                       from './reactive'

describe('Core JSX rendering', () => {
  it('Renders intrinsic elements', () => {

  })

  it('Renders components', () => {

  })
})

describe('Element mounting', () => {
  it('Mounts observable elements', () => {

  })

  it('Creates valid self-updating elements', () => {

  })
})

describe('Connectors', () => {
  it('Can listen to events', () => {
    const click$ = eventListener<Element, MouseEvent>('click')
    const element = <div connect={click$} /> as any as HTMLDivElement

    let clicked = false
    let sub = click$.subscribe(() => clicked = true)

    expect(clicked).toBe(false);

    (element as any as HTMLDivElement).click()

    expect(clicked).toBe(true);

    clicked = false

    sub.unsubscribe();

    (element as any as HTMLDivElement).click()

    expect(clicked).toBe(false);
  })

  it('Can bind values both ways', () => {
    const value$ = subject('hello')
    const element = <input connect={valueBinder(value$)} /> as any as HTMLInputElement

    expect(element.value).toBe('hello')

    value$.next('world')

    expect(element.value).toBe('world')

    let value = null
    let sub = value$.subscribe(x => value = x)

    expect(value).toBe('world')

    element.value = 'foo'
    element.dispatchEvent(new Event('change'))

    expect(value).toBe('foo')

    sub.unsubscribe()

    element.value = 'bar'
    element.dispatchEvent(new Event('change'))

    expect(value).toBe('foo')
  })
})
