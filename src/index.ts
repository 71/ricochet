
// ==============================================================================================
// ==== REACTIVE API ============================================================================
// ==============================================================================================

/**
 * The symbol used to `subscribe` to / `observe` `Observable`s.
 */
export const ObservableSymbol = Symbol.for('observable')

/**
 * Defines an observer.
 */
export type Observer<T> = ((newValue: T, oldValue: T) => void) | {
  next(newValue: T, oldValue: T): void
}

/**
 * Defines an unsubscribable value.
 */
export interface Unsubscribable {
  unsubscribe(): void
}

/**
 * Defines a value whose changes can be subscribed to.
 *
 * This interface defines both `subscribe` and `observe` in order
 * to cover more reactive libraries.
 *
 * @borrows Subscribable#subscribe as observe
 */
export interface Subscribable<T> {
  /**
   * Subscribes to changes to the value.
   */
  subscribe(observer: Observer<T>): Unsubscribable

  /**
   * @see subscribe
   */
  observe(observer: Observer<T>): Unsubscribable
}

/**
 * Defines an observable value.
 *
 * Note that if `T` is a primitive type, `valueOf` may
 * have to be called to access the underlying primitive.
 */
export interface Observable<T> {
  [ObservableSymbol]: Subscribable<T> & { underlying: T }
}

/**
 * Returns the subscribable part of an `Observable` value.
 */
export function $<T>(observable: Observable<T>): Subscribable<T> {
  return observable[ObservableSymbol]
}

function makeObserve<T>(observers: Set<T>) {
  return (observer: T) => {
    if (observer == null)
      throw new Error('The given observer cannot be null.')

    observers.add(observer)

    return {
      unsubscribe: () => {
        observers.delete(observer)
      }
    }
  }
}

/**
 * Returns whether the given value is `Observable`.
 */
export function isObservable<T>(value: any): value is Observable<T> {
  return typeof value[ObservableSymbol] === 'object'
}

/**
 * Returns an observable wrapper around the given value.
 */
export function observable<T>(value: T): T & Observable<T> {
  const observers = new Set<Observer<T>>()
  const observe = makeObserve(observers)

  return Object.assign(value, {
    [ObservableSymbol]: {
      underlying: value,

      subscribe: observe,
      observe,
    }
  })
}

/**
 * Defines a reactive value that can be updated.
 */
export interface Reactive<T> extends Observable<T> {
  /** Returns the underlying value. */
  (): T

  /** Sets the underlying value and notifies all subscribers of a change. */
  (newValue: T): T

  /**
   * Sets the underlying value without notifying observers.
   */
  setUnderlyingValue(newValue: T): void

  map<R>(map: (input: T) => R): Observable<R>
  /**
   * Returns a new `Reactive` value that propagates changes to values both ways.
   */
  map<R>(map: (input: T) => R, unmap: (input: R) => T): Reactive<R>
}

/**
 * Returns whether the given value is reactive.
 */
export function isReactive<T>(value: any): value is Reactive<T> {
  return value && value[ObservableSymbol] && typeof value.setUnderlyingValue === 'function'
}

/**
 * Returns a reactive wrapper around the given value.
 */
export function reactive<T>(value: T): Reactive<T> {
  const observers = new Set<Observer<T>>()
  const observe = makeObserve(observers)

  return Object.assign(function (newValue?: T) {
    if (arguments.length === 0 || value === newValue)
      return value

    const oldValue = value

    value = newValue
    observers.forEach(x => (typeof x === 'function' ? x : x.next)(newValue, oldValue))

    return value
  }, {
    setUnderlyingValue: (newValue: T) => {
      value = newValue
    },

    map: <R>(map: (value: T) => R, unmap?: (value: R) => T) => {
      const obs = reactive(map(value))
      let updating = false

      observe(x => {
        if (updating) return

        updating = true
        obs(map(x))
        updating = false
      })

      obs[ObservableSymbol].subscribe(x => {
        if (updating) return

        if (unmap === undefined)
          throw new Error('Cannot set inverse value in one-way map.')

        updating = true
        value = unmap(x)
        updating = false
      })

      return obs
    },

    [ObservableSymbol]: {
      get underlying() {
        return value
      },

      subscribe: observe,
      observe,
    },
  })
}


const observableArraySymbol = Symbol.for('observablearray')

export type ArrayObserver<T> = {
  [key in string & keyof Array<T>]?: Array<T>[key] extends (...args: infer Args) => any ? (...args: Args) => void : never
} & {
  set?: (index: number, value: T) => void
}

export interface ObservableArray<T> extends Array<T> {
  /**
   * Observes changes made to the array.
   *
   * @param init If `true`, `push` will be called on initialization
   * with the content of the array.
   */
  observe(observer: ArrayObserver<T>, init?: boolean): Unsubscribable

  /**
   * Propagates changes to the items of the given list to items of a new list,
   * according to a `map` function.
   */
  map<R>(f: (value: T, index: number, array: Array<T>) => R, thisArg?: any): ObservableArray<R>
}

export function isObservableArray<T>(array: any): array is ObservableArray<T> {
  return array != null && array[observableArraySymbol] !== undefined
}

export function observableArray<T>(array: T[]): ObservableArray<T> {
  const observers = new Set<ArrayObserver<T>>()
  const observeInternal = makeObserve(observers)

  const map = <R>(f: (value: T, index: number, array: Array<T>) => R, thisArg?: any) => {
    const arr = observableArray(array.map(f, thisArg))
    const subscription = observeInternal({
      set: (i, v) => arr[i] = f(v, i, array),

      splice: (start: number, deleteCount: number, ...items: T[]) => {
        arr.splice(start, deleteCount, ...items.map(f, thisArg))
      },
      pop: () => {
        arr.pop()
      },
      shift: () => {
        arr.shift()
      },
      push: (...items: T[]) => {
        arr.push(...items.map(f, thisArg))
      },
      unshift: (...items: T[]) => {
        arr.unshift(...items.map(f, thisArg))
      },
      reverse: () => {
        arr.reverse()
      },

      fill: (value: T, start?: number, end?: number) => {
        if (start === undefined)
          start = 0
        if (end === undefined)
          end = arr.length

        for (let i = start; i < end; i++)
          arr[i] = f.call(thisArg, value, i, array)
      },
    })

    return arr
  }

  const observe = (observer: ArrayObserver<T>, init = false) => {
    const subscription = observeInternal(observer)

    if (init) {
      if (typeof observer.push === 'function')
        observer.push(...array)
      else
        array.forEach((v, i) => observer.set(i, v))
    }

    return subscription
  }

  const proxy = new Proxy(Object.assign({
      __traps: { observe, map },
      __observers: observers,
      __values: array,

      observe,
      map,

      [observableArraySymbol]: observableArraySymbol,
    }, array), {
    get: ({ __traps: traps, __observers: observers, __values: values }, p) => {
      if (p === 'observe')             return observe
      if (p === 'map')                 return map
      if (p === observableArraySymbol) return observableArraySymbol

      if (typeof p == 'number')
        return values[p]

      if (traps[p] !== undefined)
        return traps[p]

      const prop = values[p]

      if (typeof prop === 'function') {
        return traps[p] = (...args) => {
          const prevValues = [...values]
          const r = prop.apply(values, args)

          observers.forEach(x => {
            const cb = x[p]

            const passthrough = new Proxy([...prevValues], {
              get: (t, p) => t[p],
              set: (t, p, v) => {
                if (typeof p === 'string' && Number.isInteger(+p))
                  x.set(+p, v)
                else if (typeof p === 'number')
                  x.set(p, v)

                t[p] = v

                return true
              }
            })

            if (cb != null)
              cb(...args)
            else
              Array.prototype[p].call(passthrough, ...args)
          })

          return r
        }
      }

      return prop
    },

    set: ({ __observers: observers, __values: values }, p, value) => {
      if (typeof p === 'string' && Number.isInteger(+p))
        p = +p

      if (typeof p === 'number') {
        if (p < 0 || p > values.length)
          return false

        observers.forEach(x => x.set(p as number, value))
        return true
      }

      return false
    },
  })

  return proxy
}


// ==============================================================================================
// ==== REACT API ===============================================================================
// ==============================================================================================

// Define various elements to help TypeScript resolve types.
declare global {
  // See https://www.typescriptlang.org/docs/handbook/jsx.html
  namespace JSX {
    type Element = HTMLElement & {
      ondestroy?: () => void

      destroy(): void

      readonly subscriptions: Unsubscribable[]
    }

    // Unfortunately, this does not work:
    // type IntrinsicAttributes<T> = {
    //   [attr in keyof T]?: T[attr] | Observable<T[attr]>
    // }

    type IntrinsicAttributes = {
      children?: NodeArray
    }

    type IntrinsicElements = {
      [key in keyof HTMLElementTagNameMap]: {
        class?: string
        ref  ?: (el: HTMLElementTagNameMap[key]) => void
      } & {
        [attr in keyof HTMLElementTagNameMap[key]]?:
          HTMLElementTagNameMap[key][attr] | Observable<HTMLElementTagNameMap[key][attr]>
      }
    }
  }
}


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
 * Properties that can be given to an element during its creation.
 */
export type ElementProperties<Tag extends keyof JSX.IntrinsicElements> =
  Partial<WritablePart<JSX.IntrinsicElements[Tag]>> &
  {
    class?: string
    ref  ?: JSX.IntrinsicElements[Tag]
    children?: NestedNode
  }

/**
 * Defines a function that takes properties and returns a self-updating element.
 */
export type Component<Props extends object, ReturnType extends Node> = (props: Props) => ReturnType


/**
 * Renders an intrinsic element.
 */
export function h<Tag extends keyof JSX.IntrinsicElements>(
  tag        : Tag,
  attrs      : JSX.IntrinsicAttributes & ElementProperties<Tag>,
  ...children: NodeArray
): JSX.IntrinsicElements[Tag]

/**
 * Renders an unknown intrinsic element.
 */
export function h(
  tag        : string,
  attrs      : JSX.IntrinsicAttributes,
  ...children: NodeArray
): JSX.Element

/**
 * Renders a component.
 */
export function h<P extends object, E extends JSX.Element, K extends Component<P, E>>(
  component  : K,
  props      : P & Partial<E>,
  ...children: NodeArray
): E

export function h(
  tag        : string | Component<any, any>,
  props      : JSX.IntrinsicAttributes,
  ...children: NodeArray
) {
  let element: HTMLElement
  let callback: (el: HTMLElement) => void

  const subscriptions: Unsubscribable[] = []
  const otherProperties = {
    subscriptions,

    destroy: () => destroy(element)
  }

  if (typeof tag === 'string') {
    const el = document.createElement(tag) as JSX.Element
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
          subscriptions.push($.subscribe(setValue))
          setValue($.underlying)
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
      unsubscribe: () => (el.subscriptions || dummyArray).slice(0).forEach(x => x.unsubscribe())
    })

    element = el
  }

  Object.assign(element, otherProperties)

  if (callback != null)
    callback(element)

  return element
}

/** Dummy array used for conditional accessed to arrays. */
const dummyArray = []


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
  if (prevIncluded == null || prevIncluded == nextExcluded)
    return

  destroyRecursively(prevIncluded.nextSibling, nextExcluded)
  destroy(prevIncluded)
}


/**
 * Renders the given node and all of its nested nodes into the given parent,
 * and subscribes for future changes in order to automatically re-render its observable parts.
 */
function render(parent: Element, node: NestedNode, subscriptions: Unsubscribable[]) {
  // The `r` function renders a node recursively between `prev` and `next`.
  //
  // Nodes are **always** inserted before `next`, and the `prev` node
  // **must** be updated when a new nodes are added somewhere. It represents
  // the current node.

  function r(node: NestedNode, prev: { value: Node }, next: { value: Node }, observe = true): void {
    // @ts-ignore
    if (node == null || node === false)
      return

    const obs = node[ObservableSymbol]

    if (obs !== undefined) {
      if (observe) {
        let hadValue = true

        // We've got ourselves an observable value, so we add elements recursively,
        // subscribe for changes to repeat this operation, and create a new insertion
        // point for the previous sibling.
        const renderChild = () => {
          // When we render the child, we simply remove the previously
          // rendered children, and replace them by the new ones.
          // The inserted children are the ones inserted after the child insertion point,
          // but before the insertion point given to us.
          if (hadValue)
            destroyRecursively(prev.value, next.value)

          r(obs.underlying, prev, next, false)
          hadValue = prev.value !== undefined

          if (!hadValue)
            prev.value = next.value
        }

        subscriptions.push(obs.subscribe(renderChild))
      }

      node = obs.underlying

      // @ts-ignore
      if (node == null || node === false)
        return
    }

    // TODO: Remove that first check, and ensure that Array.isArray(node) is true instead
    if (isObservableArray(node) || Array.isArray(node)) {
      if (isObservableArray(node)) {
        const firstPrev = prev
        const lastNext = next

        // Stores all rendered nodes. The first node that was rendered at index [i]
        // is in renderedNodes[i].
        const renderedNodes: { value: Node }[] = []

        const subscription = node.observe({
          set: (i, v) => {
            if (renderedNodes[i] === undefined) {
              // Pushing a new node
              const prev = i === 0 ? firstPrev : { value: undefined }

              renderedNodes[i] = prev

              r(v as NestedNode, prev, lastNext)

              return
            }

            // Replacing an existing node
            const prev = renderedNodes[i]
            const next = renderedNodes[i + 1] || lastNext

            destroyRecursively(prev.value, next.value)

            if (v === undefined)
              renderedNodes[i] = next
            else
              r(v as NestedNode, prev, next)

            // In some cases, nodes may be duplicated in the array (for instance,
            // during a `reverse` operation).
            // Therefore, we always have to go through the array to fix relationships
            // between all nodes.
            for (let j = 0; j < renderedNodes.length; j++) {
              if (j === i || renderedNodes[j].value !== prev.value)
                continue

              if (renderedNodes[j + 1] != undefined)
                renderedNodes[j].value = renderedNodes[j + 1].value
              else
                renderedNodes[j].value = lastNext.value
            }
          },

          // splice: (start: number, deleteCount: number, ...items: NestedNode[]) => {
          //   let next = renderedNodes[start + deleteCount]

          //   // Delete some items
          //   if (deleteCount > 0) {
          //     const prev = renderedNodes[start - 1] || firstPrev

          //     destroyRecursively(prev.value, next.value)

          //     if (start > 0)
          //       renderedNodes[start - 1] = next
          //   }

          //   // And create some more
          //   const generated = []

          //   for (let i = items.length - 1; i >= 0; i--) {

          //     r(items[i], next, next)

          //     generated.push(next)
          //   }

          //   // And update the arrays
          //   renderedNodes.splice(start, deleteCount, ...generated)
          // },

          // pop: () => {
          //   const prev = renderedNodes[renderedNodes.length - 2] || firstPrev
          //   const next = renderedNodes.pop()

          //   destroyRecursively(prev.value, next.value)

          //   prev.value = next.value
          // },

          // shift: () => {
          //   const prev = firstPrev
          //   const next = renderedNodes.shift()

          //   destroyRecursively(prev.value, next.value)

          //   prev.value = next.value
          // },

          // push: (...items: NestedNode[]) => {
          //   let next = lastNext
          //   let prev = renderedNodes[renderedNodes.length - 1] || firstPrev
          //   let generated = []

          //   for (let i = items.length - 1; i > 0; i--) {
          //     const childPrev = { value: undefined }

          //     r(node[i], childPrev, next)

          //     generated.unshift(next)
          //     next = childPrev
          //   }

          //   r(items[0], prev, next)

          //   renderedNodes.push(prev, ...generated)
          // },

          // unshift: (...items: NestedNode[]) => {
          //   let next = renderedNodes[0] || lastNext
          //   let prev = firstPrev
          //   let generated = []

          //   for (let i = items.length - 1; i > 0; i--) {
          //     const childPrev = { value: undefined }

          //     r(node[i], childPrev, next)

          //     generated.unshift(next)
          //     next = childPrev
          //   }

          //   r(items[0], prev, next)

          //   renderedNodes.push(prev, ...generated)
          // },
        }, true)

        return
      }

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


// ==============================================================================================
// ==== HELPERS =================================================================================
// ==============================================================================================

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
    get: (_, p) => p === '_' ? watched : obj[p],
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
