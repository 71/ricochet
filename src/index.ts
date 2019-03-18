import UntypedObservableSymbol from 'symbol-observable'

import { destroy, destroyRecursively } from './internal'


// ==============================================================================================
// ==== REACTIVE API ============================================================================
// ==============================================================================================

/**
 * Observable symbol.
 */
// @ts-ignore
export const ObservableSymbol: unique symbol = UntypedObservableSymbol

/**
 * Defines an observer.
 */
export type Observer<T> = ((newValue: T) => void) | {
  next(newValue: T): void
  complete?(): void
}

/**
 * Defines a subscription, which can be unsubscribed of.
 */
export interface Subscription {
  /**
   * Cancels the subscription, disposing of resources and cancelling pending operations.
   */
  unsubscribe(): void
}

/**
 * Defines a value whose changes can be subscribed to.
 */
export interface Subscribable<T> {
  /**
   * Subscribes to changes to the value.
   */
  subscribe(observer: Observer<T>): Subscription
}

/**
 * Defines an observable value.
 */
export interface Observable<T> {
  [ObservableSymbol](): Subscribable<T>
}


// ==============================================================================================
// ==== JSX API =================================================================================
// ==============================================================================================

// Define various elements to help TypeScript resolve types.
declare global {
  type BaseElement = Element

  // See https://www.typescriptlang.org/docs/handbook/jsx.html
  namespace JSX {
    type Element = BaseElement & {
      ondestroy?: () => void

      destroy(): void

      readonly subscriptions: Subscription[]
    }

    // Unfortunately, this does not work:
    // type IntrinsicAttributes<T> = {
    //   [attr in keyof T]?: T[attr] | Observable<T[attr]>
    // }

    type IntrinsicAttributes = {
      children?: NestedNode
    }

    type IntrinsicElements = {
      [key in keyof HTMLElementTagNameMap]: {
        class?: string
        ref  ?: (el: HTMLElementTagNameMap[key]) => void
      } & {
        [attr in Exclude<keyof HTMLElementTagNameMap[key], 'style'>]?:
          HTMLElementTagNameMap[key][attr] | Observable<HTMLElementTagNameMap[key][attr]>
      } & {
        style?: Partial<CSSStyleDeclaration>
      }
    }
  }
}


/**
 * An arbitrarily nested DOM `Node`.
 */
export type NestedNode = Node | CustomNode | string | NodeArray | ObservableNode

/**
 * An observable `NestedNode`.
 */
export interface ObservableNode extends Observable<NestedNode> {}

/**
 * A list of `NestedNode`s.
 */
export interface NodeArray extends Array<NestedNode> {}

/**
 * The function used to render a `NestedNode`.
 */
export interface RenderFunction {
  (value: NestedNode, previous: { value: Node }, next: { value: Node }): void
}

/**
 * A custom-rendered node.
 */
export interface CustomNode {
  /**
   * Renders the node in the DOM, as a child of the given parent.
   */
  render(parent: Element, previous: { value: Node }, next: { value: Node }, r: RenderFunction): void
}


// See: https://stackoverflow.com/a/52473108
type IfEquals<X, Y, A=X, B=never> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2) ? A : B;

/**
 * Returns an union that contains all the writable keys of `T`.
 */
type WritableKeys<T> = {
  [P in keyof T]-?: IfEquals<{ [Q in P]: T[P] }, { -readonly [Q in P]: T[P] }, P>
}[keyof T]

/**
 * Returns the part of `T` that only contains writable properties.
 */
type WritablePart<T> = Pick<T, WritableKeys<T>>

/**
 * Defines a function that takes properties and returns a self-updating element.
 */
export type Component<Props extends object, ReturnType extends Node | Observable<Node>> = (props: Props) => ReturnType


/**
 * Renders an intrinsic element.
 */
export function h<Tag extends keyof JSX.IntrinsicElements>(
  tag        : Tag,
  attrs      : JSX.IntrinsicAttributes & WritablePart<JSX.IntrinsicElements[Tag]>,
  ...children: NodeArray
): JSX.IntrinsicElements[Tag]

/**
 * Renders an unknown intrinsic element.
 */
export function h(
  tag        : string,
  attrs      : JSX.IntrinsicAttributes & WritablePart<Element>,
  ...children: NodeArray
): JSX.Element

/**
 * Renders a component.
 */
export function h<P extends object, E extends JSX.Element, K extends Component<P, E>>(
  component  : K,
  props      : JSX.IntrinsicAttributes & P & WritablePart<E>,
  ...children: NodeArray
): E

export function h(
  tag        : string | Component<any, any>,
  props      : JSX.IntrinsicAttributes,
  ...children: NodeArray
) {
  let element: HTMLElement
  let callback: (el: HTMLElement) => void

  const subscriptions: Subscription[] = []
  const otherProperties = {
    subscriptions,

    destroy: () => destroy(element),
  }

  try {
    initSubscriptions.push(subscriptions)

    if (typeof tag === 'string') {
      const el = document.createElement(tag)
      const attrs = props

      if (attrs != null) {
        for (let attr in attrs) {
          const setValue = (value: any) => {
            if (value == null)
              return

            if (attr == 'class' || attr == 'className') {
              attr = 'className'

              if (Array.isArray(value))
                value = value.join(' ')
              else if (typeof value == 'object')
                value = Object.keys(value).filter(x => value[x]).map(x => value[x].toString()).join(' ')
            } else if (attr == 'style') {
              if (typeof value == 'object') {
                Object.assign(el.style, value)
              } else {
                el.setAttribute('style', '' + value)
              }

              return
            } else if (attr == 'ref') {
              callback = value

              return
            }

            el[attr] = value
          }

          const value = attrs[attr]
          const $ = value != null ? value[ObservableSymbol] : undefined

          if ($ !== undefined) {
            subscriptions.push($().subscribe(setValue))
          } else {
            setValue(value)
          }
        }

        if (attrs.children != null)
          (children || (children = [])).unshift(attrs.children)
      }

      if (children != null && children.length > 0)
        render(el, children, subscriptions)

      element = el
    } else {
      if (children != null && children.length > 0) {
        if (props == null)
          // @ts-ignore
          props = { children }
        else if (props.children == null)
          // @ts-ignore
          props.children = children
        else
          // @ts-ignore
          props.children.push(...children)
      }

      if ('ref' in props) {
        callback = props['ref']

        delete props['ref']
      }

      const el = tag(props)

      subscriptions.push({
        unsubscribe: () => el.destroy && el.destroy()
      })

      element = el
    }

    Object.assign(element, otherProperties)

    if (callback != null)
      callback(element)
  } finally {
    initSubscriptions.pop()
  }

  return element as any
}

const initSubscriptions = [] as Subscription[][]

/**
 * Attaches the given subscriptions to the element that is currently being initialized.
 */
export function attach(...subscriptions: Subscription[]) {
  if (initSubscriptions.length === 0)
    throw new Error('`attach` can only be called in a component initializer.')

  initSubscriptions[initSubscriptions.length - 1].push(...subscriptions)
}


// ==============================================================================================
// ==== RENDERING ===============================================================================
// ==============================================================================================

/**
 * Mounts an observable node as a simple element.
 */
export function mount(node: ObservableNode): Element

/**
 * Mounts the given observable node as a child of the given element.
 */
export function mount(node: NestedNode, el: Element): Subscription

export function mount(node: NestedNode, el?: Element) {
  if (el === undefined) {
    const subscriptions = [] as Subscription[]

    render(el, node, subscriptions)

    return {
      unsubscribe: () => {
        subscriptions.splice(0).forEach(x => x.unsubscribe())
      }
    }
  }

  let rendered = null as Element

  node[ObservableSymbol]().subscribe(x => {
    const parent = document.createElement('div')
    const subscriptions = [] as Subscription[]

    render(parent, x, subscriptions)

    if (parent.childElementCount !== 1)
      throw new Error('A mounted node must render exactly one element.')

    if (rendered != null)
      rendered.replaceWith(parent.firstElementChild)

    rendered = parent.firstElementChild

    subscriptions.splice(0).forEach(x => x.unsubscribe())
  })

  if (rendered == null)
    throw new Error('A mounted node must render exactly one element when it is subscribed to.')

  return rendered
}


/**
 * Renders the given node and all of its nested nodes into the given parent,
 * and subscribes for future changes in order to automatically re-render its observable parts.
 */
function render(parent: Element, node: NestedNode, subscriptions: Subscription[]) {
  // The `r` function renders a node recursively between `prev` and `next`.
  //
  // Nodes are **always** inserted before `next`, and the `prev` node
  // **must** be updated when a new nodes are added somewhere. It represents
  // the current node.

  function r(node: NestedNode, prev: { value: Node }, next: { value: Node }, observe = true): void {
    // @ts-ignore
    if (node == null || node === false)
      return

    const obs: Subscribable<NestedNode> =
      node[ObservableSymbol]
        ? node[ObservableSymbol]()
        : typeof node['subscribe'] === 'function'
          ? node
          : undefined

    if (obs !== undefined) {
      if (observe) {
        let hadValue = true

        // We've got ourselves an observable value, so we add elements recursively,
        // subscribe for changes to repeat this operation, and create a new insertion
        // point for the previous sibling.
        const renderChild = (newValue: NestedNode) => {
          // When we render the child, we simply remove the previously
          // rendered children, and replace them by the new ones.
          // The inserted children are the ones inserted after the child insertion point,
          // but before the insertion point given to us.
          if (hadValue)
            destroyRecursively(prev.value, next.value)

          r(newValue, prev, next, false)
          hadValue = prev.value !== undefined

          if (prev.value === undefined)
            prev.value = next.value
        }

        const observer = {
          next: renderChild,
        }

        subscriptions.push(obs.subscribe(observer))
      }

      return
    }

    if (typeof (node as CustomNode).render === 'function') {
      (node as CustomNode).render(parent, prev, next, r)

      return
    }

    if (Array.isArray(node)) {
      if (node.length == 0)
        return

      // Insert nodes in reverse order before the insertion point.
      // This allows us to start at the insertion point, and update the insertion
      // point for the previous node when finishing a loop.

      for (let i = node.length - 1; i > 0; i--) {
        // First:
        // r(node[0] , prev, childPrev)

        // Last:
        // r(node[^1], childNext, next)

        const childPrev = { value: undefined }

        r(node[i], childPrev, next)

        if (childPrev.value !== undefined)
          // A node was rendered, so we can update our pointer so that
          // the next node will be inserted before the one we just inserted.
          next = childPrev
      }

      r(node[0], prev, next)

      return
    }

    // The next element is constant, so there is no need to generate an insertion point;
    // instead we'll just pass the element itself to the previous sibling, since it is
    // guaranteed the current element won't move.

    prev.value = parent.insertBefore(node instanceof Node ? node : new Text(node.toString()), next.value)
  }

  r(node, { value: undefined }, { value: undefined }, true)
}
