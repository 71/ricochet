import { html } from "./test-utils";

describe('Test utilities', () => {
  it('Can create HTML elements', () => {
    const element = html`
      <div>
        <h1>Foo</h1>
        <h2></h2>
      </div>
    `

    expect(element.childElementCount).toBe(2)
    expect(element.tagName).toBe('DIV')
    expect(element.firstElementChild.outerHTML).toBe('<h1>Foo</h1>')
    expect(element.lastElementChild.outerHTML).toBe('<h2></h2>')
  })
})
