import { Subscription, Observer, Observable, Subscribable } from "..";

/**
 * Generates a `subscribe` method that uses the given set as a backing store.
 */
export function makeObserve<T>(observers: Set<T>): (observer: T) => { unsubscribe: () => void } {
  return (function(this: Set<T>, observer: T) {
    if (observer == null)
      throw new Error('The given observer cannot be null.')

    observers.add(observer)

    return {
      unsubscribe: () => {
        observers.delete(observer)
      }
    }
  }).bind(observers)
}


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
      while (parent.lastChild != prevIncluded)
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
    while (nextExcluded.previousSibling != prevIncluded)
      destroy(nextExcluded.previousSibling)
  }

  destroy(prevIncluded)
}


/**
 * Defines an `Observable<T>` sequence that stores all of its observers
 * in a set `observers: Set<Observer<T>>`, and that may need to execute
 * custom methods when it starts or stops being observed.
 */
export interface BuiltinObservable<T> extends Subscribable<T> {
  /** The observers of the observable. */
  readonly observers: Set<Observer<T>>

  /** A method used to subscribe to dependencies of the observable when it is activated. */
  subscribeToDependencies(): void
  /** A method used to unsubscribe from the dependencies of the observable when it is deactivated. */
  unsubscribeFromDependencies(): void
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
 * A `Subscription` that automatically manages observers to a `BuiltinObservable<T>`,
 * ensuring that all resources are disposed when the observable is deactivated.
 */
export class DisposingSubscription<T> implements Subscription {
  /** Creates the subscription, performing all necesarry steps. */
  constructor(readonly obs: BuiltinObservable<T>, readonly observer: Observer<T>) {
    if (obs.observers.size === 0)
      obs.subscribeToDependencies()

    obs.observers.add(observer)
  }

  unsubscribe() {
    const obs = this.obs

    if (obs.observers.delete(this.observer) && obs.observers.size === 0)
      obs.unsubscribeFromDependencies()
  }
}
