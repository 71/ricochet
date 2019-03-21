import { Observable, ObservableSymbol, Observer, Subscribable, Subscription } from '.'
import { SetRemovalSubscription, DisposingSubscription } from './internal'


/**
 * Defines a value that is both observable and observer.
 */
export interface Subject<T> extends Subscribable<T> {
  /** Updates the underlying value, notifying all observers of a change. */
  next(newValue: T): void
}


const extendedSubjectSymbol = Symbol('extendedSubject')

/**
 * Returns whether the given value is a subject created with `subject`.
 */
export function isSubject<T>(value: any): value is BuiltinSubject<T> {
  return value && value[extendedSubjectSymbol]
}

/**
 * `Subject` augmented with some specialized operations, returned by `subject`.
 */
export class BuiltinSubject<T> implements Subject<T> {
  private readonly observers = new Set<Observer<T>>()
  private v: T

  constructor(initialValue: T) {
    this.v = initialValue
  }

  [extendedSubjectSymbol]() {
    return this
  }

  [ObservableSymbol]() {
    return this
  }

  /**
   * Gets or sets the underlying value.
   */
  get value() {
    return this.v
  }

  set value(v: T) {
    if (this.v === v)
      return

    this.v = v

    for (const observer of this.observers)
      (typeof observer === 'function' ? observer : observer.next)(v)
  }

  /**
   * Sets the underlying value without notifying observers.
   */
  setUnderlyingValue(v: T) {
    this.v = v
  }

  next(v: T) {
    this.value = v
  }

  subscribe(observer: Observer<T>) {
    (typeof observer === 'function' ? observer : observer.next)(this.value)

    return new SetRemovalSubscription(this.observers, observer)
  }

  /**
   * Returns a new `Observable` that gets updated when this subject changes.
   */
  map<R>(map: (input: T) => R): Observable<R>

  /**
   * Returns a new `Subject` value that propagates changes to values both ways.
   */
  map<R>(map: (input: T) => R, unmap: (input: R) => T): BuiltinSubject<R>

  map<R>(map: (value: T) => R, unmap?: (value: R) => T) {
    const obs = new BuiltinSubject(map(this.v))
    let updating = true

    this.subscribe(x => {
      if (updating) return

      updating = true
      obs.next(map(x))
      updating = false
    })

    if (unmap !== undefined)
      obs.subscribe(x => {
        if (updating) return

        updating = true
        this.value = unmap(x)
        updating = false
      })

    updating = false

    return obs
  }
}

/**
 * Returns a reactive wrapper around the given value.
 */
export function subject<T>(initialValue: T): BuiltinSubject<T> {
  return new BuiltinSubject(initialValue)
}


/**
 * `Subscrible` that represents a constant value, returned by `constant`.
 */
export class Constant<T> implements Subscribable<T> {
  constructor(public readonly value: T) {}

  [ObservableSymbol]() {
    return this
  }

  subscribe(observer: Observer<T>) {
    if (typeof observer === 'function') {
      observer(this.value)
    } else {
      observer.next(this.value)

      if (typeof observer.complete === 'function')
        observer.complete()
    }

    return {
      unsubscribe: () => {}
    }
  }
}

/**
 * Returns an observable value that emits a single value,
 * and then immediately completes.
 *
 * This function should be used when an observable stream
 * is expected somewhere, but a single constant value can be provided.
 */
export function constant<T>(value: T): Constant<T> {
  return new Constant<T>(value)
}


/**
 * An `Observable` that computes its values based on an arbitrary computation,
 * which may itself depend on other observable sequences; returned by `compute`.
 */
export class ComputeObservable<T> implements Subscribable<T> {
  private readonly observers = new Set<Observer<any>>()
  private readonly subscriptions = new Set<Subscription>()

  private value: T = undefined

  constructor(
    initialValue: T,
    private readonly dependencies: Map<Subscribable<any>, any>,
    private readonly computation: ($: <U>(observable: Observable<U>, defaultValue?: U) => U) => T,
  ) {
    this.value = initialValue
  }

  private subscribeToDependencies() {
    for (const dep of this.dependencies.keys()) {
      this.subscriptions.add(dep.subscribe(v => {
        if (v === this.dependencies.get(dep))
          return

        this.dependencies.set(dep, v)
        this.value = this.computation(dep => this.dependencies.get(dep[ObservableSymbol]()))

        for (const observer of this.observers)
          (typeof observer === 'function' ? observer : observer.next)(this.value)
      }))
    }
  }

  private unsubscribeFromDependencies() {
    for (const subscription of this.subscriptions)
      subscription.unsubscribe()

    this.subscriptions.clear()
  }

  [ObservableSymbol]() {
    return this
  }

  subscribe(observer: Observer<T>) {
    (typeof observer === 'function' ? observer : observer.next)(this.value)

    return new DisposingSubscription(this as any, observer)
  }
}


const UNTOUCHED = {}

/**
 * Returns an observable that will be updated when any of the given observables
 * changes.
 *
 * See [S.js](https://github.com/adamhaile/S) for the inspiration for this function. Please note
 * that unlike S, changes are propagated immediately, without waiting for the next time unit.
 *
 * ##### Example
 *
 * ```typescript
 * const a = subject(1)
 * const b = subject(1)
 *
 * const c = compute($ => $(a) + $(b))
 *
 * c.subscribe(console.log).unsubscribe() // Prints '2'
 *
 * a.next(10)
 *
 * c.subscribe(console.log) // Prints '11'
 *
 * b.next(20) // Prints '30'
 * ```
 */
export function compute<T>(
  computation: ($: <U>(observable: Observable<U>, defaultValue?: U) => U) => T
): ComputeObservable<T> | Constant<T> {
  const dependencies = new Map<Subscribable<any>, any>()

  // Perform the computation a first time, setting up all dependencies,
  // as well as saving initial values.
  const initialValue = computation(function<U>(dependency: Observable<U>, defaultValue: U) {
    const obs = dependency[ObservableSymbol] && dependency[ObservableSymbol]()

    if (obs === undefined)
      // Given dependency is not observable, so we return it directly
      return dependency

    if (dependencies.has(obs))
      // Dependency has already been registered, so we return it directly
      // Q: Should we ensure the value stays the same between different calls, though?
      return dependencies.get(obs)

    // Compute initial value by subscribing to the observable,
    // and immediately unsubcribing to it; hopefully, it will send a value in the
    // subscribe() call.
    let initialValue = UNTOUCHED as any as U

    obs.subscribe(value => initialValue = value).unsubscribe()

    if (initialValue === UNTOUCHED) {
      // The dependency was NOT registered in the subscription call,
      // which is unexpected (unless a default value was provided).
      if (arguments.length === 1)
        throw new Error('The given observable stream did not provide a value in time for the computation.')

      initialValue = defaultValue
    }

    dependencies.set(obs, initialValue)

    return initialValue
  })

  if (dependencies.size === 0)
    // No dependencies <=> the computation will never change <=> constant
    return constant(initialValue)

  return new ComputeObservable(initialValue, dependencies, computation)
}


/**
 * Maps `Observable<T>` properties of an object to `T`.
 */
export type ObservableValueTypes<O> = {
  [K in keyof O]: O[K] extends Observable<infer T> ? T : O[K]
}

/**
 * An `Observable` sequence that emits values when any of its dependencies
 * is updated; returned by `combine`.
 */
export class CombineObservable<O extends any[]> implements Subscribable<ObservableValueTypes<O>> {
  private readonly observers = new Set<Observer<any>>()
  private readonly subscriptions = new Set<Subscription>()

  private readonly values: ObservableValueTypes<O>

  constructor(readonly observables: O) {
    this.values = new Array(observables.length) as any
  }

  private subscribeToDependencies() {
    const observables = this.observables

    for (let i = 0; i < observables.length; i++) {
      const j = i
      const obs = observables[j]

      if (obs[ObservableSymbol] === undefined) {
        // Not an observable, we simply add it to the array and move along
        this.values[j] = obs
      } else {
        this.subscriptions.add(obs[ObservableSymbol]().subscribe(v => {
          this.values[j] = v

          for (const observer of this.observers)
            (typeof observer === 'function' ? observer : observer.next)(this.values)
        }))
      }
    }
  }

  private unsubscribeFromDependencies() {
    for (const subscription of this.subscriptions)
      subscription.unsubscribe()

    this.subscriptions.clear()
  }

  [ObservableSymbol]() {
    return this
  }

  subscribe(observer: Observer<ObservableValueTypes<O>>) {
    const subscription = new DisposingSubscription(this as any, observer)

    if (this.values.indexOf(undefined) === -1)
      (typeof observer === 'function' ? observer : observer.next)(this.values)

    return subscription
  }
}

/**
 * Returns an observable that gets updated when any of the given
 * observables gets updated as well.
 */
export function combine<O extends any[]>(...observables: O): CombineObservable<O> {
  return new CombineObservable(observables)
}



export class Mapper<T, U> implements Subscribable<U> {
  private readonly observers = new Set<Observer<U>>()

  private subscription: Subscription | undefined
  private value: U | undefined
  private closed: boolean

  constructor(readonly source: Observable<T>, readonly map: (value: T) => U) {
    this.closed = false
  }

  [ObservableSymbol]() {
    return this
  }

  private subscribeToDependencies() {
    if (this.closed)
      return

    this.subscription = this.source[ObservableSymbol]().subscribe({
      next: v => {
        this.value = this.map(v)

        for (const observer of this.observers)
          (typeof observer === 'function' ? observer : observer.next)(this.value)
      },

      complete: () => {
        this.closed = true

        for (const observer of this.observers)
          (typeof observer === 'function' ? observer : observer.next)(this.value)
      }
    })
  }

  private unsubscribeFromDependencies() {
    if (this.subscription === undefined)
      return

    this.subscription.unsubscribe()
    this.subscription = undefined
  }

  subscribe(observer: Observer<U>) {
    const subscription = new DisposingSubscription(this as any, observer)

    if (this.value !== undefined)
      (typeof observer === 'function' ? observer : observer.next)(this.value)
    if (this.closed && typeof observer === 'object' && typeof observer.complete === 'function')
      observer.complete()

    return subscription
  }
}

export function map<T, U>(observable: Observable<T>, map: (value: T) => U): Subscribable<U> {
  return new Mapper(observable, map)
}
