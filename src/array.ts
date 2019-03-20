import { RenderFunction, Subscription, NodeRef, NestedNode } from '.'
import { destroyRange, makeObserve }    from './internal'


const observableArraySymbol = Symbol('observableArray')

/**
 * Defines an object that can listen to changes to an `ObservableArray`.
 */
export type ArrayObserver<T> = {
  [key in string & keyof Array<T>]?:
    Array<T>[key] extends (...args: infer Args) => any
      ? (...args: Args) => void
      : never
} & {
  set: (index: number, value: T) => void
}

/**
 * Defines an array whose changes can be observed.
 */
export interface ObservableArray<T> extends Array<T> {
  /**
   * Observes changes made to the array.
   *
   * @param init - If `true`, `push` will be called on initialization
   * with the content of the array.
   */
  observe(observer: ArrayObserver<T>, init?: boolean): Subscription

  /**
   * Propagates changes to the items of the given list to items of a new list,
   * according to a `map` function.
   */
  map<R>(f: (value: T, index: number, array: Array<T>) => R, thisArg?: any): ObservableArray<R>

  /**
   * Swaps the values at the two given indices in the DOM.
   */
  swap(a: number, b: number): T extends NestedNode ? void : never
}

/**
 * Returns whether the given array is an `ObservableArray`.
 */
export function isObservableArray<T>(array: any): array is ObservableArray<T> {
  return array != null && array[observableArraySymbol] !== undefined
}

/**
 * Returns an observable array.
 */
export function observableArray<T>(...array: T[]): ObservableArray<T> {
  const observers = new Set<ArrayObserver<T>>()
  const observeInternal = makeObserve(observers)

  const map = <R>(f: (value: T, index: number, array: Array<T>) => R, thisArg?: any) => {
    const arr = observableArray(...array.map(f, thisArg))
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

  const render = (_: Element, prev: NodeRef, next: NodeRef, r: RenderFunction) => {
    const firstPrev = prev
    const lastNext = next

    // Stores all rendered nodes. The first node that was rendered at index [i]
    // is in renderedNodes[i].
    const renderedNodes: NodeRef[] = []

    const splice = (start: number, deleteCount?: number, ...items: any[]) => {
      if (start < 0)
        throw new Error()

      if (deleteCount === undefined)
        deleteCount = renderedNodes.length - start

      let prev = renderedNodes[start] || firstPrev
      let next = renderedNodes[start + deleteCount] || lastNext

      // Delete some items
      if (deleteCount > 0) {
        destroyRange(prev[0], next[0])

        if (start > 0)
          renderedNodes[start] = next
      }

      // And create some more
      const generated = new Array<NodeRef>(items.length)

      for (let i = items.length - 1; i >= 0; i--) {
        const newPrev = [undefined] as NodeRef

        r(items[i], newPrev, next)

        generated[i] = next = newPrev
      }

      if (items.length > 0) {
        r(items[0], prev, next)

        generated[0] = prev
      }

      // And update the arrays
      renderedNodes.splice(start, deleteCount, ...generated)
    }

    const subscription = observe({
      set: (i, v) => {
        if (renderedNodes[i] === undefined) {
          // Pushing a new node
          const prev = i === 0 ? firstPrev : [undefined] as NodeRef

          renderedNodes[i] = prev

          r(v as any, prev, lastNext)

          return
        }

        // Replacing an existing node
        const prev = renderedNodes[i]
        const next = renderedNodes[i + 1] || lastNext

        destroyRange(prev[0], next[0])

        if (v === undefined)
          renderedNodes[i] = next
        else
          r(v as any, prev, next)

        // In some cases, nodes may be duplicated in the array (for instance,
        // during a `reverse` operation).
        // In such cases, startBatchOperation should be used, but we make sure
        // the user doesn't make mistakes in debug builds anyway
        if (process.env.NODE_ENV !== 'production') {
          for (let j = 0; j < renderedNodes.length; j++) {
            if (j === i || renderedNodes[j][0] !== prev[0])
              continue

            console.error('Error: duplicate item found in render DOM array.')
          }
        }
      },

      splice,

      pop: () => {
        const prev = renderedNodes[renderedNodes.length - 2] || firstPrev
        const next = renderedNodes.pop()

        prev[0] = next[0]

        destroyRange(next[0], undefined)
      },

      shift: () => {
        const prev = firstPrev
        const next = renderedNodes.shift()

        destroyRange(prev[0], next[0])

        prev[0] = next[0]
      },

      push: (...items: any[]) => {
        splice(renderedNodes.length, 0, ...items)
      },

      unshift: (...items: any[]) => {
        splice(0, 0, ...items)
      },

      reverse: () => {
        if (renderedNodes.length < 2)
          return

        // Reverse nodes in array
        renderedNodes.reverse()

        // Now insert all groups of nodes to the end, in the (now reverse) order of the array
        //
        // For instance, 12 34 56 reversed is 56 34 12.
        //
        // Start with array [ [1, 2], [3, 4], [5, 6] ]; (in renderedNodes)
        //  then reverse it [ [5, 6], [3, 4], [1, 2] ]. (in renderedNodes)
        //
        // Now in the reverse order, insert groups at the end:
        // [ [5, 6] ] -> [ [5, 6], [3, 4] ] -> [ [5, 6], [3, 4], [1, 2] ] (in DOM)
        for (let i = 0; i < renderedNodes.length - 1; i++) {
          let a = renderedNodes[i][0]
          let b = renderedNodes[i + 1][0]

          while (a != b) {
            const n = a

            a = a.previousSibling
            n.parentElement.insertBefore(n, undefined)
          }
        }

        let last = renderedNodes[renderedNodes.length - 1][0]

        while (last != null) {
          const n = last

          last = last.previousSibling
          n.parentElement.insertBefore(n, undefined)
        }
      },

      find: () => {},
      findIndex: () => {},
      forEach: () => {},

      // @ts-ignore
      swap: (ai: number, bi: number) => {
        if (ai === bi)
          return

        const a = renderedNodes[ai]
        const b = renderedNodes[bi]

        // Insert 'b' before 'a', and 'a' before 'b''s next sibling
        let ae = a[0]
        let be = b[0]

        const anext = (renderedNodes[ai + 1] || lastNext)[0]
        const bnext = (renderedNodes[bi + 1] || lastNext)[0]

        while (ae != anext) {
          const n = ae

          ae = ae.nextSibling
          n.parentElement.insertBefore(n, bnext)
        }

        while (be != a[0]) {
          const n = be

          be = be.nextSibling
          n.parentElement.insertBefore(n, anext)
        }

        // Update indices
        const tmp = a[0]

        a[0] = b[0]
        b[0] = tmp
      },
    }, true)
  }

  const proxy = new Proxy({
    __observers: observers,
    __values   : array,

    observe,
    map,
    render,
  }, {
    get: (t, p) => {
      const { __observers: observers, __values: values } = t

      if (typeof p == 'number')
        return values[p]

      const trap = t[p]

      if (trap !== undefined)
        return trap

      const prop = values[p]

      if (typeof prop === 'function') {
        // The 'value' is in fact an array prototype function, so we
        // return a wrapper around it

        return t[p] = function() {
          // Some observers may not define a direct implementation of the
          // function that was called. Therefore, we want to use the 'set' function
          // for all accesses, which is how arrays work at their lowest level.
          const fallbackObservers = [] as ArrayObserver<T>[]

          for (const observer of observers) {
            const cb = observer[p]

            if (cb === undefined)
              fallbackObservers.push(observer)
            else
              cb(...arguments)
          }

          if (fallbackObservers.length === 0)
            return prop.apply(values, arguments)

          const passthrough = new Proxy(values, {
            get: (t, p) => t[p],
            set: (t, p, v) => {
              if (typeof p === 'string' && Number.isInteger(+p))
                fallbackObservers.forEach(x => x.set(+p, v))
              else if (typeof p === 'number')
                fallbackObservers.forEach(x => x.set(p, v))

              t[p] = v

              return true
            }
          })

          return Array.prototype[p].apply(passthrough, arguments)
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

        values[p] = value

        for (const observer of observers)
          observer.set(p, value)

        return true
      }

      return false
    },
  })

  return proxy as any
}
