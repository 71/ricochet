import { Observable, Observer, ObservableSymbol, Subscribable } from '.'
import { makeObserve } from './internal'


/**
 * Defines a reactive value that can be updated.
 */
export interface Subject<T> extends Observable<T>, Subscribable<T> {
  /** Returns the underlying value. */
  readonly value: T

  /** Updates the underlying value, setting its  */
  next(newValue: T): void
}


const extendedSubjectSymbol = Symbol('extendedSubject')

/**
 * Defines the full set of operations supported by the `Subject`
 * returned by `subject`.
 */
export interface ExtendedSubject<T> extends Subject<T> {
  /**
   * Gets or sets the underlying value.
   */
  value: T

  /**
   * Sets the underlying value without notifying observers.
   */
  setUnderlyingValue(newValue: T): void

  /**
   * Returns a new `Observable` that gets updated when this subject changes.
   */
  map<R>(map: (input: T) => R): Observable<R>

  /**
   * Returns a new `Subject` value that propagates changes to values both ways.
   */
  map<R>(map: (input: T) => R, unmap: (input: R) => T): ExtendedSubject<R>
}


/**
 * Returns whether the given value is a subject created with `subject`.
 */
export function isSubject<T>(value: any): value is ExtendedSubject<T> {
  return value && value[extendedSubjectSymbol]
}

/**
 * Returns a reactive wrapper around the given value.
 */
export function subject<T>(initialValue: T): ExtendedSubject<T> {
  let value = initialValue

  const observers = new Set<Observer<T>>()
  const observe = makeObserve(observers)

  const subscribe = (observer: Observer<T>) => {
    if (typeof observer === 'function')
      observer(value)
    else
      observer.next(value)

    return observe(observer)
  }

  const sub = {
    get value() {
      return value
    },

    set value(newValue: T) {
      if (value === newValue)
        return

      value = newValue
      observers.forEach(x => (typeof x === 'function' ? x : x.next)(newValue))
    },

    next(newValue: T) {
      value = newValue
      observers.forEach(x => (typeof x === 'function' ? x : x.next)(newValue))
    },

    setUnderlyingValue(newValue: T) {
      value = newValue
    },

    map<R>(map: (value: T) => R, unmap?: (value: R) => T) {
      const obs = subject(map(value))
      let updating = true

      subscribe(x => {
        if (updating) return

        updating = true
        obs.next(map(x))
        updating = false
      })

      obs.subscribe(x => {
        if (updating) return

        if (unmap === undefined)
          throw new Error('Cannot set inverse value in one-way map.')

        updating = true
        value = unmap(x)
        updating = false
      })

      updating = false

      return obs
    },

    subscribe,

    [ObservableSymbol]: () => sub,
  }

  return sub
}


/**
 * 
 */
export function constant<T>(value: T): Observable<T> {
  const observable: Observable<T> & Subscribable<T> = {
    [ObservableSymbol]: () => observable,

    subscribe: (observer: Observer<T>) => {
      if (typeof observer === 'function') {
        observer(value)
      } else {
        observer.next(value)

        if (typeof observer.complete === 'function')
          observer.complete()
      }

      return {
        unsubscribe: () => {}
      }
    }
  }

  return observable
}


/**
 * 
 */
export function combine<O extends Observable<any>[]>(
  ...observables: O
): Subscribable<{ [K in keyof O]: O[K] extends Observable<infer T> ? T : never }> {
  const observers = new Set<Observer<any>>()
  const observe = makeObserve(observers)

  const values = []

  for (let i = 0; i < observables.length; i++) {
    const j = i

    values.push(undefined)

    observables[i][ObservableSymbol]().subscribe(v => {
      values[j] = v
      observers.forEach(observer => (typeof observer === 'function' ? observer : observer.next)(values))
    })
  }

  const observable = {
    subscribe: observe,

    [ObservableSymbol]: () => observable
  }

  return observable
}
