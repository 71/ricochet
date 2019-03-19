import { RenderFunction, Subscription } from '.'
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

  const render = (parent: Element, prev: { value: Node }, next: { value: Node }, r: RenderFunction) => {
    const firstPrev = prev
    const lastNext = next

    // Stores all rendered nodes. The first node that was rendered at index [i]
    // is in renderedNodes[i].
    const renderedNodes: { value: Node }[] = []

    const splice = (start: number, deleteCount?: number, ...items: any[]) => {
      if (start < 0)
        throw new Error()

      if (deleteCount === undefined)
        deleteCount = renderedNodes.length - start

      let prev = renderedNodes[start] || firstPrev
      let next = renderedNodes[start + deleteCount] || lastNext

      // Delete some items
      if (deleteCount > 0) {
        destroyRange(prev.value, next.value)

        if (start > 0)
          renderedNodes[start] = next
      }

      // And create some more
      const generated = new Array<{ value: Node }>(items.length)

      for (let i = items.length - 1; i >= 0; i--) {
        const newPrev = { value: undefined }

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
          const prev = i === 0 ? firstPrev : { value: undefined }

          renderedNodes[i] = prev

          r(v as any, prev, lastNext)

          return
        }

        // Replacing an existing node
        const prev = renderedNodes[i]
        const next = renderedNodes[i + 1] || lastNext

        destroyRange(prev.value, next.value)

        if (v === undefined)
          renderedNodes[i] = next
        else
          r(v as any, prev, next)

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

      splice,

      pop: () => {
        const prev = renderedNodes[renderedNodes.length - 2] || firstPrev
        const next = renderedNodes.pop()

        prev.value = next.value

        destroyRange(next.value, undefined)
      },

      shift: () => {
        const prev = firstPrev
        const next = renderedNodes.shift()

        destroyRange(prev.value, next.value)

        prev.value = next.value
      },

      push: (...items: any[]) => {
        splice(renderedNodes.length, 0, ...items)
      },

      unshift: (...items: any[]) => {
        splice(0, 0, ...items)
      },

      find: () => {},
      findIndex: () => {},
      forEach: () => {}
    }, true)
  }

  const proxy = new Proxy(Object.assign({
      __traps: { observe, map, render },
      __observers: observers,
      __values: array,

      observe,
      map,

      [observableArraySymbol]: observableArraySymbol,
    }, array), {
    get: ({ __traps: traps, __observers: observers, __values: values }, p) => {
      if (p === 'observe')             return observe
      if (p === 'map')                 return map
      if (p === 'render')              return render
      if (p === observableArraySymbol) return observableArraySymbol

      if (typeof p == 'number')
        return values[p]

      if (traps[p] !== undefined)
        return traps[p]

      const prop = values[p]

      if (typeof prop === 'function') {
        return traps[p] = (...args) => {
          // Some observers may not define a direct implementation of the
          // function that was called. Therefore, we want to use the 'set' function
          // for all accesses, which is how arrays work at their lowest level.
          const fallbackObservers = [] as ArrayObserver<T>[]

          for (const observer of observers) {
            const cb = observer[p]

            if (cb === undefined)
              fallbackObservers.push(observer)
            else
              cb(...args)
          }

          if (fallbackObservers.length === 0)
            return prop.apply(values, args)

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

          return Array.prototype[p].apply(passthrough, args)
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
        observers.forEach(x => x.set(p as number, value))

        return true
      }

      return false
    },
  })

  return proxy
}
