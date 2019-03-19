import { Observable, ObservableSymbol, Observer, Subscribable, Subscription } from '.'
import { makeObserve } from './internal'


/**
 * Defines a reactive value that can be updated.
 */
export interface Subject<T> extends Subscribable<T> {
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
 * Returns an observable value that emits a single value,
 * and then immediately completes.
 *
 * This function should be used when an observable stream
 * is expected somewhere, but a single constant value can be provided.
 */
export function constant<T>(value: T): Subscribable<T> {
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
 * Returns an observable that will be updated when any of the given observables
 * changes.
 *
 * See [S.js](https://github.com/adamhaile/S) for the inspiration for this function.
 */
export function compute<T>(
  computation: ($: <U>(observable: Observable<U>, defaultValue?: U) => U) => T
): Subscribable<T> {
  const dependencies = new Map<Subscribable<any>, any>()
  const subscriptions = new Set<Subscription>()

  const initialValue = computation(function (dependency, defaultValue) {
    const obs = dependency[ObservableSymbol] && dependency[ObservableSymbol]()

    if (obs === undefined)
      return dependency

    if (dependencies.has(obs))
      return dependencies.get(obs)

    const subscription = obs.subscribe({
      next: v => {
        if (v === dependencies.get(obs))
          return

        dependencies.set(obs, v)

        if (value !== undefined)
          value.next(computation(dep => dependencies.get(dep[ObservableSymbol]())))
      },
      complete: () => {
        subscriptions.delete(subscription)
      },
    })

    if (dependencies.has(obs))
      return dependencies.get(obs)

    // The dependency was NOT registered in the subscription call,
    // which is unexpected (unless a default value was provided).
    if (arguments.length === 1)
      throw new Error('The given observable stream did not provide a value in time for the computation.')

    dependencies.set(obs, defaultValue)
    return defaultValue
  })

  if (subscriptions.size === 0)
    // No subscriptions <=> the computation will never change <=> constant
    return constant(initialValue)

  const value = subject(initialValue)

  // We return a wrapper around the subject to:
  // - Make sure the value cannot be updated by someone else.
  // - Unsubscribe from all dependencies.
  const observable = {
    [ObservableSymbol]: () => observable,

    subscribe: (observer: Observer<T>) => {
      const subscription = value.subscribe(observer)

      return {
        unsubscribe: () => {
          // FIXME: Only unsubscribe if we have to
          // subscriptions.forEach(x => x.unsubscribe())
          subscription.unsubscribe()
        }
      }
    }
  }

  return observable
}


/**
 * Returns an observable that gets updated when any of the given
 * observables gets updated as well.
 */
export function combine<O extends Observable<any>[]>(
  ...observables: O
): Subscribable<{ [K in keyof O]: O[K] extends Observable<infer T> ? T : never }> {
  const observers = new Set<Observer<any>>()
  const observe = makeObserve(observers)

  const values = new Array<any>(observables.length)

  for (let i = 0; i < observables.length; i++) {
    const j = i

    const obs = observables[i][ObservableSymbol]

    if (obs === undefined) {
      // Not an observable, we simply add it to the array and move along
      values[i] = observables[i]
    } else {
      obs().subscribe(v => {
        values[j] = v
        observers.forEach(observer => (typeof observer === 'function' ? observer : observer.next)(values))
      })
    }
  }

  const observable = {
    [ObservableSymbol]: () => observable,

    subscribe: observe,
  }

  return observable
}
