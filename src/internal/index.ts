
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
export function destroyRecursively(prevIncluded: Node, nextExcluded: Node): void {
  if (prevIncluded == null || prevIncluded == nextExcluded)
    return

  destroyRecursively(prevIncluded.nextSibling, nextExcluded)
  destroy(prevIncluded)
}
