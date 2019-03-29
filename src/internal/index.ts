import { Subscription, Observer, Subscribable, ObservableSymbol } from '..'


/**
 * Destroys the given element, unsubscribing to all of its `subscriptions`.
 *
 * Not intended for direct use.
 */
export function destroy(node?: Node & Partial<JSX.Element>, remove = true) {
  if (node === null)
    console.error('Bug detected: attempting to destroy a null node.')

  if (node === undefined)
    node = this

  if (remove)
    node.remove()

  if (node.subscriptions == null)
    return

  const subscriptions = node.subscriptions.splice(0)

  for (let i = 0; i < subscriptions.length; i++)
    subscriptions[i].unsubscribe()

  node.dispatchEvent(new Event('destroy'))

  if (node.ondestroy != null)
    node.ondestroy()
}

/**
 * Destroys all the nodes in the range [prev, next[.
 */
export function destroyRange(prevIncluded: Node, nextExcluded: Node): void {
  if (prevIncluded == null || nextExcluded === prevIncluded)
    return

  if (nextExcluded == null) {
    const parent = prevIncluded.parentElement

    if (parent != null) {
      while (parent.lastChild !== prevIncluded)
        destroy(parent.lastChild)
    } else {
      while (prevIncluded != null) {
        const next = prevIncluded.nextSibling
        destroy(prevIncluded)
        prevIncluded = next
      }

      return
    }
  } else {
    while (nextExcluded.previousSibling !== prevIncluded)
      destroy(nextExcluded.previousSibling)
  }

  destroy(prevIncluded)
}


/**
 * Defines an `Observable<T>` sequence that stores all of its observers
 * in a set `observers: Set<Observer<T>>`, and that may need to execute
 * custom methods when it starts or stops being observed.
 */
export abstract class BuiltinObservable<T> implements Subscribable<T> {
  abstract [ObservableSymbol](): BuiltinObservable<T>

  /** The observers of the observable. */
  private readonly observers = new Set<Observer<T>>()

  /** Whether we closed via complete(). */
  private isClosed = false

  /** Returns whether this observable completed. */
  get closed() {
    return this.isClosed
  }

  subscribe(observer: Observer<T>): Subscription {
    if (this.isClosed)
      return undefined

    /**
     * A `Subscription` that automatically manages observers to a `BuiltinObservable<T>`,
     * ensuring that all resources are disposed when the observable is deactivated.
     */
    class DisposingSubscription<T> implements Subscription {
      /** Creates the subscription, performing all necesarry steps. */
      constructor(readonly obs: BuiltinObservable<T>, readonly observer: Observer<T>) {}

      unsubscribe() {
        const obs = this.obs

        if (obs.observers.delete(this.observer) && obs.observers.size === 0)
          obs.unsubscribeFromDependencies()
      }
    }

    this.observers.add(observer)

    if (this.observers.size === 1)
      this.subscribeToDependencies()

    return new DisposingSubscription(this as any, observer)
  }

  /** Notify observers of the update of the observable sequence. */
  protected next(value: T) {
    this.observers.forEach(function(x) { typeof x === 'object' ? x.next(this) : x(this) }, value)
  }

  /** Notify observers of the completion of the observable sequence. */
  protected complete() {
    if (this.observers.size === 0)
      return

    this.isClosed = true

    this.observers.forEach(x => typeof x === 'object' && x.complete())
    this.observers.clear()
    this.unsubscribeFromDependencies()
  }

  /** A method used to subscribe to dependencies of the observable when it is activated. */
  protected abstract subscribeToDependencies(): void

  /** A method used to unsubscribe from the dependencies of the observable when it is deactivated. */
  protected abstract unsubscribeFromDependencies(): void
}

/**
 * A `Subscription` that automatically removes an `Observer<T>` from a `Set<Observer<T>>`
 * when unsubscribed from.
 */
export class SetRemovalSubscription<T> implements Subscription {
  /** Creates the subscription, adding the `observer` to the given `set` at the same time. */
  constructor(readonly set: Set<Observer<T>>, readonly observer: Observer<T>) {
    set.add(observer)
  }

  unsubscribe() {
    this.set.delete(this.observer)
  }
}

/**
 * A subscription to an element created with `h`, which can be destroyed.
 */
export class DestroyableElementSubscription implements Subscription {
  /** Creates the subscription. */
  constructor(readonly element: Node) {}

  unsubscribe() {
    destroy(this.element)
  }

  /**
   * Attaches a `DestroyableElementSubscription` to the given `subscriptions`
   * if the given element is destroyable.
   */
  static attach(element: Node, subscriptions: Subscription[]) {
    if (typeof (element as JSX.Element).subscriptions === 'object')
      subscriptions.push(new DestroyableElementSubscription(element))
  }
}
