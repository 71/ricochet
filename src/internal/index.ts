
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
    console.error('Bug detected: attempting to destory a null node.')

  if (node === undefined)
    node = this

  if (remove)
    node.remove()

  if (node.subscriptions == null)
    return

  const subscriptions = [...node.subscriptions]

  node.subscriptions.clear()
  subscriptions.forEach(x => x.unsubscribe())

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

    while (parent.lastChild != prevIncluded)
      destroy(parent.lastChild)
  } else {
    while (nextExcluded.previousSibling != prevIncluded)
      destroy(nextExcluded.previousSibling)
  }

  destroy(prevIncluded)
}
