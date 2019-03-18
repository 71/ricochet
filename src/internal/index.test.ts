import { destroy, destroyRecursively, makeObserve } from '.'
import { html } from './test-utils'

describe('Internal utilities', () => {
  it('Destroys nodes recursively properly', () => {
    const el = html`
      <div>
        <li>0</li>
        <li>1</li>
        <li>2</li>
        <li>3</li>
      </div>
    `

    expect(el.childElementCount).toBe(4)
    expect(el.children[0].outerHTML).toBe('<li>0</li>')
    expect(el.children[1].outerHTML).toBe('<li>1</li>')
    expect(el.children[2].outerHTML).toBe('<li>2</li>')
    expect(el.children[3].outerHTML).toBe('<li>3</li>')

    // Remove nodes [1, 2].
    destroyRecursively(el.children[1], el.children[3])

    expect(el.childElementCount).toBe(2)
    expect(el.children[0].outerHTML).toBe('<li>0</li>')
    expect(el.children[1].outerHTML).toBe('<li>3</li>')
    expect(el.children[2]).toBeUndefined()
  })
})
