import { RenderFunction, Subscription, NodeRef, NestedNode, Observable, Observer, Subscribable, ObservableSymbol, CustomNode, attach } from '.'
import { destroyRange, BuiltinObservable } from './internal'
import { BuiltinSubject }                  from './reactive'


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
 * Interfaces which exports all members implemented by `ReadonlyObservableArray<T>`,
 * but not `ReadonlyArray<T>`. Required by TypeScript.
 */
export interface ReadonlyObservableArrayMembers<T> {
  /**
   * Returns an observable sequence that emits whenever the length of this array changes.
   */
  readonly length$: Subscribable<number>

  /**
   * Returns an observable sequence that emits whenever an item is modified.
   */
  readonly change$: Subscribable<[number, T]>

  /**
   * Observes changes made to the array.
   *
   * @param init - If `true`, `push` will be called on initialization
   * with the content of the array.
   */
  observe(observer: ArrayObserver<T>, init?: boolean): Subscription

  /**
   * Returns an observable sequence that gets updated everytime this array
   * changes.
   */
  mapArray<R>(f: (array: ReadonlyArray<T>) => R, thisArg?: any): Observable<R>

  /**
   * Propagates changes to the items of the given list to items of a new list,
   * according to a `map` function.
   */
  sync<R>(f: (value: T, index: number) => R): ReadonlyObservableArray<R>
}

/**
 * Defines a readonly array whose changes can be observed.
 */
export interface ReadonlyObservableArray<T> extends ReadonlyArray<T>, ReadonlyObservableArrayMembers<T> { }

/**
 * Defines an array whose changes can be observed.
 */
export interface ObservableArray<T> extends Array<T>, ReadonlyObservableArrayMembers<T> {
  /**
   * Propagates changes to the items of the given list to items of a new list,
   * and back again.
   */
  sync<R>(f: (value: T, index: number) => R, g?: (value: R, index: number) => T): ObservableArray<R>

  /**
   * Swaps the values at the two given indices.
   */
  swap(a: number, b: number): T extends NestedNode ? void : never
}

function isPureOperation(functionName: string): functionName is string & keyof ReadonlyArray<any> {
  return [
    'concat'  , 'entries'    , 'every', 'filter', 'find'          , 'findIndex', 'forEach',
    'includes', 'indexOf'    , 'join' , 'keys'  , 'lastIndexOf'   , 'length'   , 'map'    ,
    'reduce'  , 'reduceRight', 'slice', 'some'  , 'toLocaleString', 'toString' , 'values' ,
  ].includes(functionName)
}

function getReadonlyView<T>(array: T[]): T[] {
  return new Proxy(array, { set() { throw new Error('Cannot update readonly view.') } })
}

class MutualRecursionLock {
  private locked = false

  lock() {
    return this.locked ? false : this.locked = true
  }

  unlock() {
    this.locked = false
  }
}

class ObservableArrayImpl<T> extends Array<T> implements Partial<ObservableArray<T>>, CustomNode {
  private readonly observers = new Set<ArrayObserver<T>>()
  private readonly changeObservers = new Set<Observer<[number, T]>>()

  private readonly isReadOnly: boolean
  private readonly length$$: BuiltinSubject<number>

  readonly proxy: ObservableArray<T>

  readonly change$: Subscribable<[number, T]>
  readonly length$: Subscribable<number>

  readonly impl: ObservableArrayImpl<T>

  constructor(
    private readonly data   : T[],
    private readonly source?: ObservableArrayImpl<any>,
    mapTo  ?: (value: any, index: number) => T,
    mapFrom?: (value:   T, index: number) => any,
  ) {
    super(...data)

    this.impl = this
    this.isReadOnly = source !== undefined && mapFrom === undefined

    if (source && source.impl)
      source = source.impl

    this.length$$ = new BuiltinSubject(data.length)
    this.length$  = this.length$$.map(x => x)

    this.change$ = {
      [ObservableSymbol]: () => {
        return this.change$
      },

      subscribe: observer => {
        this.changeObservers.add(observer)

        return {
          unsubscribe: () => {
            this.changeObservers.delete(observer)
          }
        }
      }
    }

    this.proxy = new Proxy(this, {
      get(self, p) {
        return self.getProperty(p as any, self.isReadOnly)
      },

      set(self, p, value) {
        return self.setProperty(p as any, value)
      },
    })

    // We use a lock to avoid having arrays recursively updating
    // themselves
    const lock = new MutualRecursionLock()

    if (mapTo !== undefined)
      ObservableArrayImpl.mirror(source, this, mapTo, lock)

    if (mapFrom !== undefined)
      ObservableArrayImpl.mirror(this, source, mapFrom, lock)
  }

  private getProperty<P extends keyof this>(property: P, readonly: boolean): this[P] {
    const p = property as number | symbol | string

    if (typeof p !== 'string')
      return this.data[p] as any
    if (p === 'length')
      return this.data.length as any
    if (Number.isInteger(+p))
      return this.data[+p] as any

    let prop = this[p]

    if (typeof prop !== 'function' || ObservableArrayImpl.prototype.hasOwnProperty(p))
      return prop

    if (isPureOperation(p))
      // @ts-ignore
      return Array.prototype[p].bind(this.data)

    if (readonly) {
      // We have a source, therefore we are immutable. Create a proxy to reflect this.
      return ((...args) => {
        return Array.prototype[p].apply(getReadonlyView(this.data), args)
      }) as any
    }

    return function(this: ObservableArrayImpl<T>) {
      // Some observers may not define a direct implementation of the
      // function that was called. Therefore, we want to use the 'set' function
      // for all accesses, which is how arrays work at their lowest level.
      const fallbackObservers = [] as ArrayObserver<T>[]

      for (const observer of this.observers) {
        const cb = observer[p]

        if (cb === undefined)
          fallbackObservers.push(observer)
        else
          cb(...arguments)
      }

      if (fallbackObservers.length === 0 && this.changeObservers.size === 0) {
        const result = Array.prototype[p].apply(this.data, arguments)

        if (this.data.length !== this.length$$.value)
          this.length$$.next(this.data.length)

        return result
      }

      const passthrough = new Proxy(this.data, {
        set: (data, p, v) => {
          if (p === 'length') {
            this.length$$.next(v)
          } else if (typeof p === 'number' || typeof p === 'string' && Number.isInteger(+p)) {
            const pp = +p

            fallbackObservers.forEach(x => x.set(pp, v))
            this.changeObservers.forEach(x => (typeof x === 'function' ? x : x.next)([pp, v]))
          }

          data[p] = v

          return true
        }
      })

      return Array.prototype[p].apply(passthrough, arguments)
    }.bind(this) as any
  }

  private setProperty<K extends keyof this>(property: K, propertyValue: this[K]) {
    let p = property as number | symbol | string
    let value = propertyValue as any

    if (p === 'length') {
      this.data.length = value
      this.length$$.next(value)

      return true
    }

    if (typeof p === 'symbol') {
      this.data[p] = value

      return true
    }

    if (typeof p === 'string')
      p = +p
    if (!Number.isInteger(p) || p < 0 || p > this.data.length)
      return false

    for (const observer of this.changeObservers)
      (typeof observer === 'function' ? observer : observer.next)([p, value])

    for (const observer of this.observers)
      observer.set(p, value)

    this.data[p] = value

    return true
  }

  sync<R>(f: (value: T, index: number) => R, g?: (value: R, index: number) => T): ObservableArray<R> {
    return new ObservableArrayImpl(this.data.map(f), this, f, g).proxy
  }

  mapArray<R>(f: (array: ReadonlyArray<T>) => R): Observable<R> {
    return new class extends BuiltinObservable<R> {
      private subscription: Subscription

      constructor(readonly array: ObservableArrayImpl<T>, readonly f: (array: ReadonlyArray<T>) => R) {
        super()
      }

      [ObservableSymbol]() {
        return this
      }

      protected subscribeToDependencies(): void {
        this.subscription = this.array.change$.subscribe(() => this.next(f(this.array.data)))
      }

      protected unsubscribeFromDependencies(): void {
        this.subscription.unsubscribe()
      }
    }(this, f)
  }

  swap(a: number, b: number): T extends NestedNode ? void : never {
    const tmp = this.data[a]

    this.proxy[a] = this.data[b]
    this.proxy[b] = tmp

    return undefined
  }

  observe(observer: ArrayObserver<T>, init?: boolean): Subscription {
    this.observers.add(observer)

    if (init) {
      if (typeof observer.push === 'function') {
        observer.push(...this.data)
      } else {
        this.data.forEach((v, i) => observer.set(i, v))
      }
    }

    return {
      unsubscribe: () => {
        this.observers.delete(observer)
      }
    }
  }

  render(_: Element, prev: NodeRef, next: NodeRef, r: RenderFunction) {
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
      }

      if (items.length === 0)
        return

      // And create some more
      const generated = new Array<NodeRef>(items.length)

      for (let i = items.length - 1; i > 0; i--) {
        const newPrev = [undefined] as NodeRef

        r(items[i], newPrev, next)

        generated[i] = next = newPrev
      }

      r(items[0], prev, next)

      generated[0] = prev

      // And update the arrays
      renderedNodes.splice(start, deleteCount, ...generated)
    }

    attach(this.observe({
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
    }, true))
  }

  private static mirror<T, R>(
    source: ObservableArrayImpl<T>,
    target: ObservableArrayImpl<R>,
    transform: (value: T, index: number) => R,
    lock: MutualRecursionLock,
  ) {
    return source.observe({
      set(i, v) {
        if (!lock.lock())
          return

        target.setProperty(i, transform(v, i))
        lock.unlock()
      },

      splice(start: number, deleteCount: number, ...items: T[]) {
        if (!lock.lock())
          return

        target.getProperty('splice', false)(start, deleteCount, ...items.map(transform))
        lock.unlock()
      },

      pop() {
        if (!lock.lock())
          return

        target.getProperty('pop', false)()
        lock.unlock()
      },
      shift() {
        if (!lock.lock())
          return

        target.getProperty('shift', false)()
        lock.unlock()
      },

      push(...items: T[]) {
        if (!lock.lock())
          return

        target.getProperty('push', false)(...items.map(transform))
        lock.unlock()
      },
      unshift(...items: T[]) {
        if (!lock.lock())
          return

        target.getProperty('unshift', false)(...items.map(transform))
        lock.unlock()
      },

      reverse() {
        if (!lock.lock())
          return

        target.getProperty('reverse', false)()
        lock.unlock()
      },

      // @ts-ignore
      swap(a: number, b: number) {
        if (!lock.lock())
          return

        target.getProperty('swap', false)(a, b)
        lock.unlock()
      },

      fill(value: T, start?: number, end?: number) {
        if (!lock.lock())
          return

        if (start === undefined)
          start = 0
        if (end === undefined)
          end = target.length

        for (let i = start; i < end; i++)
          target.setProperty(i, transform(value, i))

        lock.unlock()
      },
    })
  }
}

/**
 * Returns whether the given array is an `ObservableArray`.
 */
export function isObservableArray<T>(array: any): array is ObservableArray<T> {
  return array instanceof ObservableArrayImpl
}

/**
 * Returns an observable array.
 */
export function observableArray<T>(...array: T[]): ObservableArray<T> {
  return new ObservableArrayImpl(array).proxy
}
