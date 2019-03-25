import { combineLatest, BehaviorSubject, Observable } from 'rxjs'
import { map }                                        from 'rxjs/operators'

import { makeCustomElement }   from './wc'
import { h, ObservableSymbol } from '..'
import { html }                from '../internal/test-utils'

describe('Web Components interop', () => {
  const NameDisplay = ({ firstName, lastName, fullName }: Record<string, Observable<string>>) => (
    <div>
      { combineLatest(firstName, lastName, fullName).pipe(
          map(([first, last, full]) => {
            return full
              ? <b className='full-name'>{full}</b>
              : <i>{first} {last}</i>
          })
      ) }
    </div>
  )

  const BiggerDisplay = ({ children }: { children: any }) => (
    <div style={{ transform: 'scale: 1.5' }}>{children}</div>
  )

  const toSubject = v => v && v[ObservableSymbol] ? v[ObservableSymbol]() : new BehaviorSubject(v)

  customElements.define('name-display', makeCustomElement(NameDisplay, {
    firstName: toSubject,
    lastName : toSubject,
    fullName : toSubject,
  }))

  customElements.define('bigger-display', makeCustomElement(BiggerDisplay, {
    children: v => undefined
  }))

  it('Creates valid web components', () => {
    const fullName = new BehaviorSubject(null as string)

    const foo = html`
      <div>
        <name-display firstName='John' lastName='Mulaney' />
      </div>
    `

    expect(foo.childElementCount).toBe(1)

    foo.firstElementChild['fullName'] = fullName

    // Force call to connectedCallback:
    document.body.appendChild(foo)

    const fooRoot = foo.firstElementChild.shadowRoot

    expect(fooRoot.innerHTML).toBe('<div><i>John Mulaney</i></div>')

    fullName.next('The Comeback Kid')

    expect(fooRoot.innerHTML).toBe('<div><b class="full-name">The Comeback Kid</b></div>')

    foo.remove()
  })

  it('Copies slots to children', () => {
    const el = html`<bigger-display><i>Hello</i> world</bigger-display>`

    document.body.appendChild(el)

    const root = el.shadowRoot.firstElementChild
    const slot = root.firstElementChild as HTMLSlotElement

    expect(slot.tagName).toBe('SLOT')
    expect(slot.assignedElements()[0].outerHTML).toBe('<i>Hello</i>')
    expect(slot.assignedNodes()[1].textContent).toBe(' world')

    el.remove()
  })

  it('Manages resources correctly', () => {
    const el = html`<name-display firstName='Greg' />`

    document.body.appendChild(el)

    const root = el.shadowRoot.firstElementChild as JSX.Element

    expect(root).not.toBe(null)
    expect(root.subscriptions.length).toBeGreaterThan(0)

    el.remove()

    expect(root.subscriptions.length).toBe(0)
  })
})
