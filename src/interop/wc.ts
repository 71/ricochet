import { h, Component } from '..'
import { destroy }      from '../internal'


/**
 * Creates a custom element (or web component) out of a JSX component.
 */
export function makeCustomElement<P extends object, E extends JSX.Element>(
  component: Component<P, E>,
  translateProperties: object & { [K in keyof P]: (value?: string) => P[K] },
): typeof HTMLElement {
  return class extends HTMLElement {
    element: E

    constructor() {
      super()

      this.attachShadow({ mode: 'open' })
    }

    connectedCallback() {
      const childrenSlot = document.createElement('slot')
      const props = {}

      for (const prop in translateProperties) {
        const stringValue = (this as any as Record<string, string>)[prop] || this.getAttribute(prop)
        const value = translateProperties[prop](stringValue)

        // @ts-ignore
        props[prop] = value
      }

      this.element = h(component, props as any, childrenSlot)
      this.shadowRoot.appendChild(this.element)
    }

    disconnectedCallback() {
      destroy(this.element)
    }
  }
}
