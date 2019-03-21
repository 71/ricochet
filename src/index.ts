import UntypedObservableSymbol from 'symbol-observable'

import { destroy, destroyRange } from './internal'
import { Subject }               from './reactive'


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
export interface Subscribable<T> extends Observable<T> {
  /**
   * Subscribes to changes to the value.
   */
  subscribe(observer: Observer<T>): Subscription
}

/**
 * Defines an observable value.
 *
 * This interface defines the bare minimum for Ricochet
 * to interface with reactive libraries that implement this
 * [ECMAScript Observable proposal](https://github.com/tc39/proposal-observable#api),
 * such as [RxJS](https://github.com/ReactiveX/rxjs).
 */
export interface Observable<T> {
  [ObservableSymbol](): Subscribable<T>
}

/**
 * Defines a value that may be `Observable`.
 */
export type MaybeObservable<T> = Observable<T> | T


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

      readonly subscriptions: Set<Subscription>
    }

    // Unfortunately, this does not work:
    // type IntrinsicAttributes<T> = {
    //   [attr in keyof T]?: T[attr] | Observable<T[attr]>
    // }

    type IntrinsicAttributes = {
      children?: NestedNode
      connect ?: Connectable<any> | Connectable<any>[]
    }

    type IntrinsicElements = {
      [key in keyof HTMLElementTagNameMap]: {
        class   ?: string
        children?: NestedNode
        ref     ?: (el: HTMLElementTagNameMap[key]) => void
        style   ?: Partial<CSSStyleDeclaration>
      } & {
        [attr in Exclude<keyof HTMLElementTagNameMap[key], 'style' | 'children'>]?:
          MaybeObservable<HTMLElementTagNameMap[key][attr]>
      }
    }
  }
}


/**
 * An arbitrarily nested DOM `Node`.
 */
export type NestedNode = Node | CustomNode | string | number | NodeArray | ObservableNode

/**
 * An observable `NestedNode`.
 */
export interface ObservableNode extends Observable<NestedNode> {}

/**
 * A list of `NestedNode`s.
 */
export interface NodeArray extends Array<NestedNode> {}

/**
 * A mutable reference to a `Node`.
 */
export type NodeRef = [Node]

/**
 * The function used to render a `NestedNode`.
 */
export type RenderFunction = (value: NestedNode, previous: NodeRef, next: NodeRef) => void

/**
 * A custom-rendered node.
 */
export interface CustomNode {
  /**
   * Renders the node in the DOM, as a child of the given parent.
   *
   * In Ricochet, nodes must be rendered between other nodes. Since a single `CustomNode`
   * may be rendered as several DOM nodes, these DOM nodes should be inserted **before**
   * `next`, and `previous` must be set to the **first** node that was inserted.
   */
  render(parent: Element, previous: NodeRef, next: NodeRef, r: RenderFunction): void
}

/**
 * Defines an element that can be connected to a node.
 */
export type Connectable<T extends Node> =
    ((element: T, attachSubscriptions: (...subscriptions: Subscription[]) => void) => void)
  | { connect: (element: T, attachSubscriptions: (...subscriptions: Subscription[]) => void) => void }


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

/** @ignore */
export function h(
  tag        : string | Component<any, any>,
  props      : JSX.IntrinsicAttributes,
  ...children: NodeArray
) {
  let element: HTMLElement
  let callback: (el: HTMLElement) => void

  const subscriptions = new Set<Subscription>()
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
          const $ = value != null && value[ObservableSymbol] !== undefined ? value[ObservableSymbol]() : undefined

          if ($ !== undefined) {
            subscriptions.add($.subscribe(setValue))
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

      subscriptions.add({
        unsubscribe: () => el.destroy && el.destroy()
      })

      element = el
    }

    Object.assign(element, otherProperties)

    if (props && props.connect) {
      const addSubscription = (function (this: Set<Subscription>, ...subs: Subscription[]) {
        for (const subscription of subs)
          subscriptions.add(subscription)
      }).bind(subscriptions)

      if (Array.isArray(props.connect))
        for (const c of props.connect)
          (typeof c === 'function' ? c : c.connect)(element, addSubscription)
      else
        (typeof props.connect === 'function' ? props.connect : props.connect.connect)(element, addSubscription)
    }

    if (callback != null)
      callback(element)
  } finally {
    initSubscriptions.pop()
  }

  return element as any
}

const initSubscriptions = [] as Set<Subscription>[]

/**
 * Attaches the given subscriptions to the element that is currently being initialized.
 */
export function attach(...subscriptions: Subscription[]): void {
  if (initSubscriptions.length === 0)
    throw new Error('`attach` can only be called in a component initializer.')

  for (const sub of subscriptions)
    initSubscriptions[initSubscriptions.length - 1].add(sub)
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

/** @ignore */
export function mount(node: NestedNode, el?: Element) {
  if (el === undefined) {
    const subscriptions = new Set<Subscription>()

    render(el, node, subscriptions)

    return {
      unsubscribe: () => {
        subscriptions.forEach(x => x.unsubscribe())
        subscriptions.clear()
      }
    }
  }

  let rendered = null as Element

  node[ObservableSymbol]().subscribe(x => {
    const parent = document.createElement('div')
    const subscriptions = new Set<Subscription>()

    render(parent, x, subscriptions)

    if (parent.childElementCount !== 1)
      throw new Error('A mounted node must render exactly one element.')

    if (rendered != null)
      rendered.replaceWith(parent.firstElementChild)

    rendered = parent.firstElementChild

    subscriptions.forEach(x => x.unsubscribe())
    subscriptions.clear()
  })

  if (rendered == null)
    throw new Error('A mounted node must render exactly one element when it is subscribed to.')

  return rendered
}


/**
 * Renders the given node and all of its nested nodes into the given parent,
 * and subscribes for future changes in order to automatically re-render its observable parts.
 */
function render(parent: Element, node: NestedNode, subscriptions: Set<Subscription>) {
  // The `r` function renders a node recursively between `prev` and `next`.
  //
  // Nodes are **always** inserted before `next`, and the `prev` node
  // **must** be updated when a new nodes are added somewhere. It represents
  // the current node.

  function r(node: NestedNode, prev: NodeRef, next: NodeRef, observe = true): void {
    if (node == null || node as any === false)
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
            destroyRange(prev[0], next[0])

          r(newValue, prev, next, false)
          hadValue = prev[0] !== undefined

          if (prev[0] === undefined)
            prev[0] = next[0]
        }

        let addSubscription = true

        const observer = {
          next: renderChild,
          complete: () => {
            if (subscription === undefined)
              // Completing before the end of the subscription
              addSubscription = false
            else
              subscriptions.delete(subscription)
          },
        }

        const subscription = obs.subscribe(observer)

        if (addSubscription)
          subscriptions.add(subscription)
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

        const childPrev = [undefined] as NodeRef

        r(node[i], childPrev, next)

        if (childPrev[0] !== undefined)
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

    prev[0] = parent.insertBefore(node instanceof Node ? node : new Text(node.toString()), next[0])
  }

  r(node, [undefined], [undefined], true)
}


// ==============================================================================================
// ==== CONNECTORS ==============================================================================
// ==============================================================================================

class EventListener<N extends Node, E extends Event> implements Subscribable<E> {
  private readonly elements = new Set<N>()
  private readonly observers = new Set<Observer<E>>()

  private readonly eventListener: (this: N, _: E) => void

  constructor(readonly type: string, readonly opts: boolean | AddEventListenerOptions) {
    const observers = this.observers

    this.eventListener = function(e) {
      for (const observer of observers)
        (typeof observer === 'function' ? observer : observer.next)(e)
    }

    this[ObservableSymbol] = this[ObservableSymbol].bind(this)
    this.subscribe = this.subscribe.bind(this)
    this.connect = this.connect.bind(this)
  }

  [ObservableSymbol]() {
    return this
  }

  subscribe(observer: Observer<E>) {
    if (this.observers.size === 0) {
      for (const element of this.elements)
        element.addEventListener(this.type, this.eventListener, this.opts)
    }

    this.observers.add(observer)

    return {
      unsubscribe: () => {
        if (this.observers.delete(observer) && this.observers.size === 0) {
          for (const element of this.elements)
            element.removeEventListener(this.type, this.eventListener, this.opts)
        }
      }
    }
  }

  connect(element: N, addSubscriptions: (...s: Subscription[]) => void) {
    this.elements.add(element)

    element.addEventListener(this.type, this.eventListener, this.opts)

    addSubscriptions({
      unsubscribe: () => {
        this.elements.delete(element)

        element.removeEventListener(this.type, this.eventListener, this.opts)
      }
    })
  }
}

/**
 * Returns a `Connectable<T>` that can be used to register to events on one
 * or more elements.
 */
export function eventListener<N extends Node, E extends Event>(
  type : string,
  opts?: boolean | AddEventListenerOptions,
): Connectable<N> & Subscribable<E> {
  return new EventListener(type, opts)
}


class ValueBinder<T, E extends HTMLInputElement | HTMLTextAreaElement> {
  private readonly eventListener: (this: E, _: Event) => void

  constructor(readonly input: Subject<T>) {
    this.eventListener = function () { input.next(this.value as any) }
    this.connect = this.connect.bind(this)
  }

  connect(element: E, addSubscriptions: (...s: Subscription[]) => void) {
    element.addEventListener('change', this.eventListener)

    addSubscriptions(this.input[ObservableSymbol]().subscribe(x => element.value = x as any), {
      unsubscribe: () => element.removeEventListener('change', this.eventListener)
    })
  }
}

/**
 * Returns a `Connectable<T>` that can be used to bind an input's `value` both ways.
 */
export function valueBinder<T extends string | number | boolean>(
  input: Subject<T>,
): Connectable<HTMLInputElement | HTMLTextAreaElement> {
  return new ValueBinder(input)
}
