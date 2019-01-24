import * as Rx from 'rxjs'
import { ObjectExpression } from '@babel/types';


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
 * Defines an unsubscribable value.
 */
type Unsubscribable = Rx.Unsubscribable


// ==============================================================================================
// ==== DOM MANIPULATION ========================================================================
// ==============================================================================================

/**
 * An arbitrarily nested DOM `Node`.
 */
export type NestedNode = Node | NodeArray | ObservableNode

/**
 * An observable `NestedNode`.
 */
export interface ObservableNode extends Observable<NestedNode> {}

/**
 * A list of `NestedNode`s.
 */
export interface NodeArray extends Array<NestedNode> {}

/**
 * Defines an HTML element based on its tag, and fallbacks on the specified
 * type if the given tag is unknown.
 */
export type AnyElement<Tag extends string, Fallback = Node> =
  Tag extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[Tag] : Fallback


/**
 * Properties that can be given to an element during its creation.
 */
export type ElementProperties<Tag extends string> =
  Partial<(Tag extends keyof HTMLElementTagNameMap ? WritablePart<HTMLElementTagNameMap[Tag]> : Node)> &
  {
    class?: string
    ref  ?: AnyElement<Tag>
    children?: NestedNode
  }

/**
 * Renders an intrinsic element.
 *
 * Not intended for direct use.
 */
export function rie<Tag extends string>(
  tag  : Tag,
  attrs: ElementProperties<Tag>,
  children     : NodeArray,
  subscriptions: Unsubscribable[],
): AnyElement<Tag, HTMLElement> {
  const el = document.createElement(tag) as any as AnyElement<Tag, HTMLElement>

  if (attrs == null)
    return el

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
      }

      el[attr] = '' + value
    }

    const value = attrs[attr]

    if (isObservable(value)) {
      subscriptions.push(value.subscribe(setValue))
      setValue(value.value)
    } else {
      setValue(value)
    }
  }

  if (children.length > 0) {
    if (attrs.children)
      // @ts-ignore
      attrs.children.push(...children)
    else
      // @ts-ignore
      attrs.children = children

    render(el, attrs.children, subscriptions)
  } else if (attrs.children) {
    render(el, attrs.children, subscriptions)
  }

  return el
}


/**
 * Defines a function that takes properties and returns a self-updating element.
 */
export type Component<Props extends object, ReturnType extends Node> = (props: Props) => ReturnType

/**
 * Renders a component into an intrinsic element.
 *
 * Not intended for direct use.
 */
export function rc<P extends object, E extends HTMLElement, K extends Component<P, E>>(
  component: K,
  props    : P & Partial<E>,
  children     : NodeArray,
  subscriptions: Unsubscribable[]
): E {
  if (children.length > 0) {
    if (props.children)
      // @ts-ignore
      props.children.push(...children)
    else
      // @ts-ignore
      props.children = children
  }

  const el = component(props) as RenderedElement<E>

  subscriptions.push({ unsubscribe: () => el.subscriptions.slice(0).forEach(x => x.unsubscribe()) })

  return el
}


/**
 * Defines an element that has been rendered by `h`.
 */
export type RenderedElement<E extends HTMLElement> =
  E &
  {
    subscriptions: Unsubscribable[]
    destroy(): void
  }

/**
 * Renders the top-level element of a component, and sets all of its additional properties.
 *
 * Not intended for direct use.
 */
export function rtl<E extends HTMLElement>(
  root         : E,
  subscriptions: Unsubscribable[]
): RenderedElement<E> {
  return Object.assign(root, {
    subscriptions,
    destroy: () => {
      subscriptions.forEach(x => x.unsubscribe())
    }
  })
}


/**
 * Destroys the given element, unsubscribing to all of its `subscriptions`.
 *
 * Not intended for direct use.
 */
export function destroy(node?: Node & Partial<JSX.Element>) {
  if (node === undefined)
    node = this

  node.remove()

  if (node.subscriptions == null)
    return

  node.subscriptions.splice(0).forEach(sub => sub.unsubscribe())

  if (node.ondestroy != null)
    node.ondestroy()
}

/**
 * Destroys the nodes in the range [prev, next[.
 */
function destroyRecursively(prevIncluded: Node, nextExcluded: Node): void {
  if (prevIncluded == nextExcluded)
    return

  destroyRecursively(prevIncluded.nextSibling, nextExcluded)
  destroy(prevIncluded)
}


/**
 * Renders the given node and all of its nested nodes into the given parent,
 * and subscribes for future changes in order to automatically re-render its observable parts.
 */
function render(parent: Element, node: NestedNode, subscriptions: Rx.Unsubscribable[]) {
  // The `r` function renders a node recursively between `prev` and `next`.
  //
  // Nodes are **always** inserted before `next`, and the `prev` node
  // **must** be updated when a new nodes are added somewhere. It represents
  // the current node.

  function r(node: NestedNode, prev: { value: Node }, next: { value: Node }): void {
    if (node == null)
      return

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
        // r(node[-1], childNext, next)

        const childPrev = { value: undefined }

        r(node[i], childPrev, next)

        next = childPrev

        // If the recursive call returned 'null', then no new elements have been inserted,
        // so we can just re-use the previous insertion point. Otherwise we use the one
        // provided by the recursive call.
      }

      r(node[0], prev, next)

      return
    }

    if (isObservable(node)) {
      // We've got ourselves an observable value, so we add elements recursively,
      // subscribe for changes to repeat this operation, and create a new insertion
      // point for the previous sibling.

      if (Array.isArray(node.value)) {
        const firstPrev = prev
        const lastNext = next

        const src = node.value

        // Stores the node that comes after the node at index src[i]
        // Therefore the node that comes before src[i] is src[i - 1] || childInsertionPoint
        const renderedNodes: { value: Node }[] = []

        const proxy = createArrayProxy<NestedNode>(src, {
          get: (i   ) => src[i],
          set: (i, v) => {
            let prev = renderedNodes[i - 1] || firstPrev
            let next = renderedNodes[i]

            destroyRecursively(prev.value, next.value)

            src[i] = v

            r(v, prev, next)
          }
        },
        // @ts-ignore (TypeScript ignores 'Partial' for some reason)
        {
          splice: (start: number, deleteCount: number, ...items: NestedNode[]) => {
            let next = renderedNodes[start + deleteCount]

            // Delete some items
            if (deleteCount > 0) {
              const prev = renderedNodes[start - 1] || firstPrev

              destroyRecursively(prev.value, next.value)

              if (start > 0)
                renderedNodes[start - 1] = next
            }

            // And create some more
            const generated = []

            for (let i = items.length - 1; i >= 0; i--) {

              r(items[i], next, next)

              generated.push(next)
            }

            // And update the arrays
            renderedNodes.splice(start, deleteCount, ...generated)

            return src.splice(start, deleteCount, ...items)
          },

          pop: () => {
            if (src.length == 0)
              return

            const prev = renderedNodes[renderedNodes.length - 2] || firstPrev
            const next = renderedNodes.pop()

            destroyRecursively(prev.value, next.value)

            prev.value = next.value

            return src.pop()
          },
          shift: () => {
            if (src.length == 0)
              return

            const prev = firstPrev
            const next = renderedNodes.shift()

            destroyRecursively(prev.value, next.value)

            prev.value = next.value

            return src.shift()
          },

          push: (...items: NestedNode[]): number => {
            let next = renderedNodes[renderedNodes.length - 1] || lastNext
            let prev = renderedNodes[renderedNodes.length - 2] || firstPrev
            let generated = []

            for (let i = items.length - 1; i > 0; i--) {
              const childPrev = { value: undefined }

              r(node[i], childPrev, next)

              generated.unshift(next)
              next = childPrev
            }

            r(items[0], prev, next)

            renderedNodes.push(prev, ...generated)

            return src.push(...items)
          },
          unshift: (...items: NestedNode[]): number => {
            let next = renderedNodes[0] || lastNext
            let prev = firstPrev
            let generated = []

            for (let i = items.length - 1; i > 0; i--) {
              const childPrev = { value: undefined }

              r(node[i], childPrev, next)

              generated.unshift(next)
              next = childPrev
            }

            r(items[0], prev, next)

            renderedNodes.push(prev, ...generated)

            return src.push(...items)
          },

          reverse: () => {
            return Array.prototype.reverse.call(proxy)
          },

          sort: (compareFn?: (a: NestedNode, b: NestedNode) => number) => {
            return Array.prototype.sort.call(proxy, compareFn)
          },

          fill: (value: NestedNode, start?: number, end?: number) => {
            return Array.prototype.fill.call(proxy, value, start, end)
          },

          copyWithin: () => {
            throw new Error('Cannot copy withing an observable list.')
          }
        })

        node.setUnderlyingValue(proxy)

        subscriptions.push({ unsubscribe: () => node.setUnderlyingValue(src) })

        return
      }

      const renderChild = () => {
        // When we render the child, we simply remove the previously
        // rendered children, and replace them by the new ones.
        // The inserted children are the ones inserted after the child insertion point,
        // but before the insertion point given to us.
        destroyRecursively(prev.value, next.value)

        r(node.value, prev, next)
      }

      subscriptions.push(node.subscribe(renderChild))
      r(node.value, prev, next)

      return
    }

    // The next element is constant, so there is no need to generate an insertion point;
    // instead we'll just pass the element itself to the previous sibling, since it is
    // guaranteed the current element won't move.

    prev.value = parent.insertBefore(node instanceof Node ? node : new Text(node), next.value)
  }

  r(node, { value: undefined }, { value: undefined })
}


/**
 * Creates a `Proxy` around an array that can listen to changes to said array,
 * and update elements in a reactive list without unnecessary processing.
 */
function createArrayProxy<T>(
  values: T[],
  getset: { get: (i: number) => T,
            set: (i: number, v: T) => void },
  traps : Partial<T[]>,
): T[] {
  return new Proxy(values, {
    get: (values, p) => {
      if (p === 'underlying')
        return values

      if (typeof p == 'number')
        return getset.get(p)

      if (typeof p == 'string') {
        const trap = traps[p] as unknown as Function

        if (typeof trap == 'function')
          return trap
      }

      return values[p as any]
    },

    set: (values, p, value) => {
      if (typeof p == 'number') {
        if (p < 0 || p > values.length)
          return false

        getset.set(p, value)
        return true
      }

      if (typeof p == 'string' && traps[p] != null)
        return false

      values[p] = value
      return true
    }
  })
}


/**
 * Propagates changes to the items of the given list to items of a new list,
 * according to a `map` function.
 */
export function map<T, R>(list: ReadonlyObservable<T[]>, map: (item: T) => R): Observable<R[]> {
  const src: T[] = value(list)
  const dst: R[] = src.map(map)

  const proxy = createArrayProxy<T>(src, {
    get: (i   ) => src[i],
    set: (i, v) => {
      src[i] = v
      dst[i] = map(v)
    },
  },
  // @ts-ignore (TypeScript ignores 'Partial' for some reason)
  {
    splice: (start: number, deleteCount: number, ...items: T[]): T[] => {
      dst.splice(start, deleteCount, ...items.map(map))

      return src.splice(start, deleteCount, ...items)
    },

    pop: (): T | undefined => {
      if (src.length == 0)
        return

      dst.pop()

      return src.pop()
    },
    shift: (): T | undefined => {
      if (src.length == 0)
        return

      dst.shift()

      return src.shift()
    },

    push: (...items: T[]): number => {
      src.push(...items)
      dst.push(...items.map(map))

      return src.length
    },
    unshift: (...items: T[]): number => {
      src.unshift(...items)
      dst.unshift(...items.map(map))

      return src.length
    },

    reverse: (): T[] => {
      dst.reverse()
      src.reverse()

      return proxy
    },

    sort: (compareFn?: (a: T, b: T) => number): T[] => {
      // The default implementation is likely faster than something I can
      // come up quickly, so I use it, and then substitue values
      if (src.length == 0)
        return []

      // If I understand correctly, Array.sort calls `get` and `set` defined above,
      // so sorting the source array will also sort the destination array.
      Array.prototype.sort.call(proxy, compareFn)

      return proxy
    },

    fill: (value: T, start?: number, end?: number): T[] => {
      dst.fill(map(value), start, end)
      src.fill(value, start, end)

      return proxy
    },

    copyWithin: () => {
      throw new Error('Cannot copy withing an observable list.')
    }
  })

  if (isObservable(list)) {
    // @ts-ignore
    list.setUnderlyingValue(proxy)

    list.subscribe(x => {
      // Maybe we could try doing a diff between the two lists and update
      // accordingly, but right now we don't.
      proxy.splice(0, proxy.length, ...x)
    })
  }

  return new Observable(dst)
}


// ==============================================================================================
// ==== REACTIVE API ============================================================================
// ==============================================================================================

function subscribe<T>(
  observers: Rx.PartialObserver<T>[],
  next    ?: Rx.PartialObserver<T> | ((value: T) => void),
  error   ?: (error: any) => void,
  complete?: () => void,
): Unsubscribable {
  const observer: Rx.PartialObserver<T> = typeof next == 'function'
    ? { next, error, complete }
    : next

  observers.push(observer)

  return {
    unsubscribe: () => {
      observers.splice(observers.indexOf(observer), 1)
    }
  }
}

/**
 * Defines an observable stream that notifies subscribers of a change of its underlying value.
 */
export class ReadonlyObservable<T> implements Rx.Subscribable<T> {
  protected readonly observers: Rx.PartialObserver<T>[] = []

  constructor(protected val: T) {}

  /**
   * Gets the underlying value.
   */
  get value() {
    return this.val
  }

  /**
   * Notifies observers of a value change.
   */
  protected updateValue(value: T) {
    if (value === this.val)
      return

    this.val = value

    for (let i = 0; i < this.observers.length; i++)
      this.observers[i].next(this.val)
  }

  /**
   * Subcribes to this reactive value.
   */
  subscribe(
    next    ?: Rx.PartialObserver<T> | ((value: T) => void),
    error   ?: (error: any) => void,
    complete?: () => void,
  ): Rx.Unsubscribable {
    return subscribe(this.observers, next, error, complete)
  }

  /**
   * @see subscribe
   */
  observe(
    next    ?: Rx.PartialObserver<T> | ((value: T) => void),
    error   ?: (error: any) => void,
    complete?: () => void,
  ): Rx.Unsubscribable {
    return subscribe(this.observers, next, error, complete)
  }

  /**
   * Returns the string representation of the underlying value.
   */
  toString() {
    return this.val ? this.val.toString() : undefined
  }

  /**
   * Returns a new `ReadonlyObservable` that gets updated when the source (`this`) observable
   * changes.
   */
  map<R>(map: (input: T) => R): ReadonlyObservable<R> {
    const self = this

    return new class extends ReadonlyObservable<R> {
      constructor(value: R) {
        super(value)

        self.subscribe(v => this.updateValue(map(v)))
      }
    }(map(this.val))
  }
}

/**
 * Defines an observable stream that notifies subscribers of a change of its underlying value,
 * and allows said value to be changed at any time.
 */
export class Observable<T> extends ReadonlyObservable<T> {
  constructor(value: T) {
    super(value)
  }

  /**
   * Sets the underlying value without notifying subscribers of the change.
   */
  setUnderlyingValue(value: T) {
    this.val = value
  }

  /**
   * Gets or sets the underlying value.
   *
   * - When getting the value, only the last version is returned.
   * - When setting the value, also notifies all subscribers of the change.
   */
  set value(value: T) {
    this.updateValue(value)
  }

  /**
   * @inheritdoc
   */
  map<R>(map: (input: T) => R): ReadonlyObservable<R>

  /**
   * Returns a new `Observable` that propagates changes to values both ways.
   */
  map<R>(map: (input: T) => R, unmap: (input: R) => T): Observable<R>

  map<R>(map: (input: T) => R, unmap?: (input: R) => T) {
    if (unmap == undefined)
      return super.map(map)

    const obs = new Observable<R>(map(this.val))
    let updating = false

    this.subscribe(x => {
      if (updating) return

      updating = true
      obs.value = map(x)
      updating = false
    })

    obs.subscribe(x => {
      if (updating) return

      updating = true
      this.value = unmap(x)
      updating = false
    })

    return obs
  }
}


/**
 * A copy of an object of type `T`, where every property is an observable property.
 */
export type ObservedObject<T extends object> = {
  [key in keyof T]: Observable<T[key]>
}

/**
 * Returns a wrapper around the given object that watches property of said object.
 */
export function watchProperties<T extends object>(obj: T): T & { _: ObservedObject<T> } {
  const watched: any = {}

  for (let prop in obj)
    watched[prop] = observable(obj[prop])

  return new Proxy<T & { _: ObservedObject<T> }>(watched as any, {
    get: (_, p) => p === '_' ? watched : watched[p].value,
    set: (_, p, v) => {
      if (typeof p !== 'string')
        return false

      if (p in watched)
        watched[p].value = v
      else
        watched[p] = observable(v)

      return true
    }
  })
}


/**
 * {T} if {T} is {Observable}, and {Observable<T>} otherwise.
 */
export type Obs<T> = T extends Observable<infer _> ? T : Observable<T>

/**
 * {T} or {Observable<T>}.
 */
export type ObservableLike<T> = T | Observable<T>


/**
 * Returns whether the given value is an `Observable` stream.
 */
export function isObservable<T>(value: ReadonlyObservable<T> | T): value is ReadonlyObservable<T> {
  // @ts-ignore
  return value != null && typeof value.subscribe == 'function' && 'value' in value
}

/**
 * Returns an `Observable` stream that wraps the given value.
 *
 * If the given value is already an `Observable` stream, it is returned.
 */
export function observable<T>(value: Observable<T> | T): T extends Observable<any> ? T : Observable<T> {
  // @ts-ignore
  return isObservable(value) ? value : new Observable<T>(value)
}

/**
 * Returns the underlying value of the given observable.
 *
 * If the given observable is, in fact, not an observable, it is directly returned.
 */
export function value<T>(value: ReadonlyObservable<T> | T): T extends ReadonlyObservable<infer V> ? V : T {
  // @ts-ignore
  return isObservable(value) ? value.value : value
}

/**
 * Returns a computed value that is updated every time of one of the given
 * dependencies changes.
 */
export function combine<T, D extends ObservableLike<any>[]>(
  dependencies: D,
  computation : () => T
): D extends [] ? T : ReadonlyObservable<T> {
  // Filter out non-reactive dependencies
  for (let i = dependencies.length - 1; i >= 0;) {
    // Note that we're going from the end to the start, since
    // splicing at the end is more efficient that splicing inside.
    if (isObservable(dependencies[i]))
      i--
    else
      dependencies.splice(i, 1)
  }

  if (dependencies.length == 0)
    // @ts-ignore
    return computation()

  // @ts-ignore
  return new class extends ReadonlyObservable<T> {
    constructor(value: T) {
      super(value)

      for (let i = 0; i < dependencies.length; i++)
        dependencies[i].subscribe(() => this.updateValue(computation()))
    }
  }(computation())
}


// Define various elements to help TypeScript resolve types.
declare global {
  // See https://www.typescriptlang.org/docs/handbook/jsx.html
  namespace JSX {
    type Element = HTMLElement & {
      ondestroy?: () => void

      destroy(): void

      readonly subscriptions: Unsubscribable[]
    }

    type IntrinsicElements = {
      [key in keyof HTMLElementTagNameMap]: Partial<HTMLElementTagNameMap[key]> & {
        class?: string
        slot ?: string
        ref  ?: HTMLElementTagNameMap[key]
      }
    }
  }
}
