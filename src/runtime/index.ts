import * as Rx from 'rxjs'


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
export function h<Tag extends string>(
  tag  : Tag,
  attrs: ElementProperties<Tag>,
  subscriptions: Unsubscribable[]
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

  if (attrs.children)
    render(el, attrs.children, subscriptions)

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
export function hh<P extends object, E extends HTMLElement, K extends Component<P, E>>(
  component: K,
  props    : P & Partial<E>,
  subscriptions: Unsubscribable[]
): E {
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
export function hhh<E extends HTMLElement>(
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
export function destroy(this: JSX.Element) {
  let node = this || arguments[0]

  node.remove()

  if (node.subscriptions == null)
    return

  node.subscriptions.splice(0).forEach(sub => sub.unsubscribe)

  if (node.ondestroy != null)
    node.ondestroy()
}


/**
 * A node used to track nested node trees during rendering.
 */
interface RenderNode {

}

/**
 * Creates a hidden node that can be used to delimit groups of nodes.
 */
function createInsertionPoint(): Node {
  return new Text('')
}

/**
 * Renders the given node and all of its nested elements into the given parent,
 * and subscribes for future changes in order to re-render the needed parts.
 */
function render(parent: Element, node: NestedNode, subscriptions: Rx.Unsubscribable[]) {
  function r(node: NestedNode, insertionPoint: Node): Node {
    if (node == null)
      return undefined

    if (isObservable(node)) {
      // We've got ourselves an observable value, so we add elements recursively,
      // subscribe for changes to repeat this operation, and create a new insertion
      // point for the previous sibling.

      const childInsertionPoint = parent.insertBefore(createInsertionPoint(), insertionPoint)
      const insertedChildren = []

      renderObservable(parent, node)

      const renderChild = () => {
        insertedChildren.forEach(destroy)
        map(parent, node, )
        r(v, insertionPoint)
      }

      subscriptions.push(node.subscribe(renderChild))
      r(node.value, insertionPoint)

      return childInsertionPoint
    }

    if (Array.isArray(node)) {
      if (node.length == 0)
        return undefined

      // Insert nodes in reverse order before the insertion point.
      // This allows us to start at the insertion point, and update the insertion
      // point for the previous node when finishing a loop.

      for (let i = node.length - 1; i != 0; i--) {
        insertionPoint = r(node[i], insertionPoint) || insertionPoint

        // If the recursive call returned 'null', then no new elements have been inserted,
        // so we can just re-use the previous insertion point. Otherwise we use the one
        // provided by the recursive call.
      }

      return insertionPoint
    }

    // The next element is constant, so there is no need to generate an insertion point;
    // instead we'll just pass the element itself to the previous sibling, since it is
    // guaranteed the current element won't move.

    return parent.insertBefore(node instanceof Node ? node : new Text(node), insertionPoint)
  }

  r(node, undefined)
}


/**
 *
 */
class ReactiveItem<T> {
  constructor(
    public value: Obs<T>,
    public index: Observable<number>,
    public node : NestedNode
  ) {}
}

/**
 * Creates a `Proxy` around an array that can listen to changes to said array,
 * and update elements in a reactive list without unnecessary processing.
 *
 * `T` is the type of the source array.
 * `R` is the type of the destination array.
 */
function createArrayProxy<T, R = T>(
  values: T[],
  traps : Partial<(T | R)[]> & { get: (i: number) => R, set: (i: number, v: T) => void }
): R[] {
  return new Proxy(values, {
    get: (values, p) => {
      if (p === 'underlying')
        return values

      if (typeof p == 'number')
        return traps.get(p)

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

        traps.set(p, value)
        return true
      }

      if (typeof p == 'string' && traps[p] != null)
        return false

      values[p] = value
      return true
    }
  }) as unknown[] as R[]
}

/**
 * Given a parent element, a source list, and a way to render each element
 * of the list, sets up a reactive component that only re-renders children
 * when needed, and wraps each list call into an efficient render-update method.
 */
function renderObservable<T>(
  parent: Element,
  list  : NestedNode
) {
  let totalLength = 0

  const values: Obs<T>[] = []
  const reactiveItems: ReactiveItem<T>[] = []

  const parent = insertionPoint.parentElement
  const vals = isObservable(list) ? list.value : list

  if (vals) {
    for (let i = 0; i < vals.length; i++) {
      const obs = observable(vals[i])
      const index = new Observable(i)

      // @ts-ignore
      const elements = flatten(computeElements(obs.value, index.value, obs, index))

      const localInsertionPoint = createInsertionPoint()

      parent.appendChild(localInsertionPoint)

      values.push(obs)
      reactiveItems.push(new ReactiveItem(obs, index, elements, localInsertionPoint))

      elements.forEach(parent.appendChild.bind(parent))
      totalLength += elements.length
    }
  }

  parent.append(insertionPoint)

  function splice(
    reactiveItems: ReactiveItem<T>[],
    values       : Obs<T>[],
    start        : number,
    deleteCount  : number,
    ...items     : Obs<T>[]
  ): Obs<T>[] {
    if (start < 0)
      throw new Error('Invalid start number.')

    // Find next sibling for insertion
    let nextSibling = insertionPoint

    if (items.length > 0) {
      for (let i = start; i < reactiveItems.length; i++) {
        const elts = reactiveItems[i].elts

        if (elts.length == 0)
          continue

        nextSibling = elts[0]
        break
      }
    }

    // Transform each item into a reactive element
    const reactiveToInsert: ReactiveItem<T>[] = []

    for (let i = 0; i < items.length; i++) {
      const insertionPoint = createInsertionPoint()

      parent.insertBefore(insertionPoint, nextSibling)

      let item = items[i]

      if (!isObservable(item))
        // @ts-ignore
        item = items[i] = new Observable<T>(item)

      const index = new Observable(start++)
      // @ts-ignore
      const elements = flatten(computeElements(item.value, index.value, item, index))

      reactiveToInsert.push(new ReactiveItem(item, index, elements, insertionPoint))

      elements.forEach(x => nextSibling.parentElement.insertBefore(x, insertionPoint))
      totalLength += elements.length
    }

    for (const reactiveItem of reactiveItems.splice(start, deleteCount, ...reactiveToInsert)) {
      reactiveItem.destroy()
      totalLength -= reactiveItem.elts.length
    }

    return values.splice(start, deleteCount, ...items)
  }

  const proxy = createArrayProxy<NestedNode>(values, {
    get: (i) => ,
    set: (i, v) => ,

    splice(start: number, deleteCount: number, ...items: Obs<T>[]): Obs<T>[] {
      return splice(this, values, start, deleteCount, ...items)
    },

    pop(): Obs<T> | undefined {
      if (this.length == 0)
        return

      this.pop().destroy()

      return values.pop()
    },
    shift(): Obs<T> | undefined {
      if (this.length == 0)
        return

      this.shift().destroy()

      return values.shift()
    },

    push(...items: Obs<T>[]): number {
      splice(this, values, values.length, 0, ...items)

      return this.length
    },
    unshift(...items: Obs<T>[]): number {
      splice(this, values, 0, 0, ...items)

      return this.length
    },

    reverse(): Obs<T>[] {
      const len = this.length / 2
      const nextNode = insertionPoint.nextSibling

      for (let i = 0; i < len; i++) {
        const a = this[i],
              b = this[this.length - 1 - i]

        // Swap elements
        const afterA = a.insertionPoint
        const afterB = b.insertionPoint
        const parent = insertionPoint.parentElement

        a.elts.forEach(x => parent.insertBefore(x, afterB))
        b.elts.forEach(x => parent.insertBefore(x, afterA))

        // Swap insertion points
        a.insertionPoint = afterB
        b.insertionPoint = afterA

        // Swap in source arrays
        this[i] = b
        this[this.length - 1 - i] = a

        values[i] = b.value
        values[this.length - 1 - i] = a.value

        // Update indices
        a.index.value = this.length - 1 - i
        b.index.value = i
      }

      if (nextNode != insertionPoint)
        parent.insertBefore(insertionPoint, nextNode)

      return values
    },

    sort(compareFn?: (a: Obs<T>, b: Obs<T>) => number): Obs<T>[] {
      // The default implementation is likely faster than something I can
      // come up quickly, so we use it, and then substitue values
      if (this.length == 0)
        return []

      // @ts-ignore
      this.sort(compareFn != null ? (a, b) => compareFn(a.value.value, b.value.value) : undefined)

      const parent = insertionPoint.parentElement

      for (let i = 0; i < this.length; i++) {
        // Update reactive item
        const item = this[i]

        item.index.value = i

        // Push element to end of children
        // Since every element is pushed to end in order,
        // this will put them all in their place
        item.elts.forEach(x => parent.insertBefore(x, insertionPoint))
        parent.insertBefore(item.insertionPoint, insertionPoint)

        // Update item
        values[i] = item.value
      }

      return values
    },

    fill(value: T | Obs<T>, start?: number, end?: number): Obs<T>[] {
      if (start == null)
        start = 0
      if (end == null)
        end = this.length

      if (isObservable(value))
        value = value.value as T

      for (let i = start; i < end; i++)
        this[i].value.value = value

      return values
    },

    indexOf(obs: Obs<T>) {
      if (isObservable(obs))
        return values.indexOf(obs)

      return values.findIndex(x => x.value === obs)
    },

    copyWithin(target: number, start: number, end?: number): Obs<T>[] {
      throw new Error('Cannot copy within a reactive list.')
    }
  })

  if (isObservable(list)) {
    // @ts-ignore
    list.setUnderlyingValue(proxy)

    list.subscribe(x => {
      // Maybe we could try doing a diff between the two lists and update
      // accordingly, but right now we don't.
      proxy.splice(0, proxy.length, x as any)
    })
  }
}



/**
 * Returns an observable node that gets updated when the given list gets updated,
 * according to a `map` function.
 */
export function map<T, R>(list: ObservableLike<T[]>, map: (item: T) => R): ObservableLike<R> {
  const src: T[] = value(list)
  const dst: R[] = []

  const proxy = createArrayProxy<T, R>(src, {
    get: (i   ) => dst[i],
    set: (i, v) => dst[i] = map(v),

    splice: (start: number, deleteCount: number, ...items: T[]): R[] => {
      src.splice(start, deleteCount, ...items)

      return dst.splice(start, deleteCount, ...items.map(map))
    },

    pop: (): R | undefined => {
      if (src.length == 0)
        return

      src.pop()

      return dst.pop()
    },
    shift: (): R | undefined => {
      if (src.length == 0)
        return

      src.shift()

      return dst.shift()
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

    reverse: (): R[] => {
      src.reverse()

      return dst.reverse()
    },

    sort: (compareFn?: (a: T, b: T) => number): R[] => {
      // The default implementation is likely faster than something I can
      // come up quickly, so I use it, and then substitue values
      if (src.length == 0)
        return []

      src.sort(compareFn)

      // FIXME
      return dst.sort(compareFn === undefined ? undefined : (a, b) => compareFn(map(a), map(b)))

      // const parent = this[0].elt.parentElement!!

      // for (let i = 0; i < this.length; i++) {
      //   // Update reactive item
      //   const item = this[i]

      //   item.index.value = i

      //   // Push element to end of children
      //   // Since every element is pushed to end in order,
      //   // this will put them all in their place
      //   parent.insertBefore(item.elt, nextMarker)

      //   // Update item
      //   values[i] = item.value
      // }

      // return values
    },

    fill: (value: T, start?: number, end?: number): R[] => {
      src.fill(value, start, end)

      return dst.fill(map(value), start, end)
    },

    copyWithin: () => {
      throw new Error('Cannot copy withing a reactive list.')
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

  return proxy
}


/**
 * Defines an observable stream that notifies subscribers of a change of a value.
 */
export class Observable<T> implements Rx.Subscribable<T> {
  private val: T
  private readonly observers: Rx.PartialObserver<T>[]

  constructor(value: T) {
    this.observers = []

    this.setUnderlyingValue(value)
  }

  /**
   * Sets the underlying value without notifying subscribers of the change.
   */
  setUnderlyingValue(value: T) {
    this.val = value
  }

  /** Gets or sets the underlying value.
   *
   * - When getting the value, only the last version is returned.
   * - When setting the value, also notifies all subscribers of the change.
   */
  get value() {
    return this.val
  }

  set value(value: T) {
    this.setUnderlyingValue(value)

    for (let i = 0; i < this.observers.length; i++)
      this.observers[i].next(value)
  }

  /**
   * Returns the string representation of the underlying value.
   */
  toString() {
    return this.val ? this.val.toString() : undefined
  }

  /**
   * Subcribes to this reactive value.
   */
  subscribe(
    next    ?: Rx.PartialObserver<T> | ((value: T) => void),
    error   ?: (error: any) => void,
    complete?: () => void,
  ): Rx.Unsubscribable {
    const observer: Rx.PartialObserver<T> = typeof next == 'function'
      ? { next, error, complete }
      : next

    this.observers.push(observer)

    return {
      unsubscribe: () => {
        this.observers.splice(this.observers.indexOf(observer), 1)
      }
    }
  }

  /**
   * @see subscribe
   */
  observe(
    next    ?: Rx.PartialObserver<T> | ((value: T) => void),
    error   ?: (error: any) => void,
    complete?: () => void,
  ): Rx.Unsubscribable {
    return this.subscribe(next, error, complete)
  }

  /**
   * Returns a new `Observable` that gets updated when the source (`this`) observable
   * changes.
   *
   * If the `unmap` parameter is given, then changes will be propagated both ways.
   */
  map<R>(map: (input: T) => R, unmap?: (input: R) => T): Observable<R> {
    const obs = new Observable<R>(map(this.val))
    let updating = false

    if (unmap != null) {
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
    } else {
      this.subscribe(x => {
        updating = true
        obs.value = map(x)
        updating = false
      })

      obs.subscribe(() => {
        if (!updating)
          throw new Error('Cannot set value of map-created observable.')
      })
    }

    return obs
  }
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
export function isObservable<T>(value: ObservableLike<T>): value is Observable<T> {
  // @ts-ignore
  return value != null && typeof value.subscribe == 'function'
}

/**
 * Returns an `Observable` stream that wraps the given value.
 *
 * If the given value is already an `Observable` stream, it is returned.
 */
export function observable<T>(value: ObservableLike<T>): Obs<T> {
  // @ts-ignore
  return isObservable(value) ? value : new Observable<T>(value)
}

/**
 * Returns the underlying value of the given observable.
 *
 * If the given observable is, in fact, not an observable, it is directly returned.
 */
export function value<T>(value: ObservableLike<T>): T extends Observable<infer V> ? V : T {
  // @ts-ignore
  return isObservable(value) ? value.value : value
}

/**
 * Returns a computed value that is updated every time of one of the given
 * dependencies changes.
 */
export function computed<T>(dependencies: Observable<any>[], computation: () => T): Observable<T> {
  const obs = new Observable<T>(computation())

  if (dependencies.length > 0)
    merge(...dependencies).subscribe(() => obs.value = computation())

  return obs
}

/**
 * Merges multiple observable sequences together.
 */
export function merge(...observables: Rx.Subscribable<any>[]): Rx.Subscribable<any> {
  if (observables.length == 1)
    return observables[0]

  const observers: Rx.PartialObserver<any>[] = []
  const subscriptions: Rx.Unsubscribable[] = []

  for (let i = 0; i < observables.length; i++) {
    subscriptions.push(observables[i].subscribe(v => {
      for (const observer of observers)
        observer.next(v)
    }))
  }

  return {
    subscribe: (
      next    ?: Rx.PartialObserver<any> | ((value: any) => void),
      error   ?: (error: any) => void,
      complete?: () => void
    ): Rx.Unsubscribable => {
      const observer = typeof next == 'function' ? { next, error, complete } : next

      observers.push(observer)

      return {
        unsubscribe: () => {
          observers.splice(observers.indexOf(observer), 1)
        }
      }
    }
  }
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
