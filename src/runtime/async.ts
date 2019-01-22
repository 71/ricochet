import { value, Component } from './index'


function replace(placeholder: Text, element: Element) {
  const children = placeholder.childNodes

  for (let i = 0; i < children.length; i++)
    element.append(children[i])

  placeholder.replaceWith(element)
}


/**
 * Returns an element that will be replaced by the result of the given
 * promise when it resolves.
 */
export function async<E extends Element>(component: Promise<E>): E

/**
 * Wraps a component that asynchronously resolves as a regular component
 * whose element will be replaced once the promise resolves.
 */
export function async<P extends {}, E extends Element>(component: (props: P) => Promise<E>): Component<P, E>

export function async<P extends {}, E extends Element>(component: Promise<E> | ((props: P) => Promise<E>)): E | Component<P, E> {
  if (typeof component == 'function') {
    return props => {
      const placeholder = document.createTextNode('')

      component(props).then(component => replace(placeholder, component))

      return placeholder as any as E
    }
  } else {
    const placeholder = document.createTextNode('')

    component.then(component => replace(placeholder, component))

    return placeholder as any as E
  }
}


/**
 * Given a component, some of its properties, and a promise that resolves
 * to the rest of its properties, returns an element that will be replaced
 * by the resolved element when the promise finishes.
 */
export function Async<P extends {}, E extends Element, K extends {}>({ component, props }: P & { component: Component<P & K, E>, props: Promise<K> }): E

/**
 * Given a promise that resolves to a component and its properties, returns
 * an element that will be replaced by the resolved element when the promise finishes.
 */
export function Async<P extends {}, E extends Element>({ component, ...props }: P & { component: Promise<Component<P, E>> }): E

export function Async<P extends {}, E extends Element, K extends {}>(
  { component: _component, ..._props }:
    (P & { component: Promise<Component<P, E>> }) |
    (P & { component: Component<P & K, E>, props: Promise<K> })
): E {
  const placeholder = document.createTextNode(''),
        component = value(_component),
        props = value((_props as any)['props'] as Promise<P>)

  if (typeof component == 'function')
    props.then(rest => replace(placeholder, component({ ... rest, ... _props } as any as P & K)))
  else
    component.then(component => replace(placeholder, component(_props as any as P)))

  return placeholder as any as E
}
