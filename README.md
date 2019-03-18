# Ricochet

A small and unopinionated web framework meant to be simple, fast and lightweight.


## Overview

Ricochet has similar goals to [Surplus](https://github.com/adamhaile/surplus), but it
achieves them differently. Ricochet's main feature is to render `NestedNode`s into
the DOM efficiently, where a `NestedNode` is either a DOM node, a list of DOM nodes,
an observable stream of `NestedNode`, or a `NestedNode` list.

Therefore, the only thing that Ricochet needs to work is an observable stream,
as defined by this [ECMAScript Observable proposal](https://github.com/tc39/proposal-observable#api).  
Since [RxJS](https://github.com/ReactiveX/rxjs) and other libraries already implement this
proposal, it is possible to immediately plug Ricochet with them.

Furthermore, Ricochet does not batch operations by default, and instead
expects the user to handle this themselves. Thanks to the nature of observable streams, though,
this can be easily achieved using [Schedulers](https://rxjs-dev.firebaseapp.com/guide/scheduler) in RxJS,
for instance.


## Getting started

Ricochet components are only rendered once (when they are instantiated),
and updated when a reactive stream they depend on changes.

For instance, we can compare a clock in React and Ricochet.

```tsx
const Clock = () => {
  // State is introduced explicitely using 'useState'.
  //
  // The 'Clock' function will be called several times per second,
  // but 'date' will be persisted thanks to 'useState'.
  const [date, setDate] = React.useState(new Date())

  // Effects are introduced using 'useEffect'.
  React.useEffect(() => {
    const interval = setInterval(() => setDate(new Date()), 1000)

    return () => {
      clearInterval(interval)
    }
  })

  return (
    <span>{date.toString()}</span>
  )
}
```

Now here it is in Ricochet. Please note that `subject` (defined in
[`ricochet/reactive`](./src/reactive.ts)), creates a stream similar to a
[BehaviorSubject](https://rxjs-dev.firebaseapp.com/guide/subject#behaviorsubject).

```tsx
const Clock = () => {
  // Since 'Clock' is only called once, there is no need for a
  // tool such as 'useState'.
  const date = subject(new Date())

  // Once again, there is no need to wrap this logic at all.
  const interval = setInterval(() => date.next(new Date()), 1000)

  // Resources are bound to elements and can be disposed of
  // using `element.destroy()`. To give ownership of a subscription
  // to an element, we can use the 'attach' function.
  attach({
    unsubscribe: () => clearInterval(interval)
  })

  return (
    // Ricochet has first class support for streams. When 'date'
    // will be updated, the content of the span will be as well.
    <span>{date}</span>
  )
}
```


## Performances

Ricochet's goal is to avoid using a VDOM, and instead to create redraws, virtual
or real, as rarely as possible. Since only the parts of the DOM that depend on a stream
will be recomputed when the stream changes, allocations should be less common,
and changes to the DOM should be as rare as if a diffing algorithm had been used.

**However**, in some cases a simple change to a reactive stream may
impact large parts of the DOM. For instance, when a list changes. In those cases,
a few utilities are provided.

#### `observableArray`

The `observableArray<T>(T[]): ObservableArray<T>` function takes an array,
and returns another array, augmented with two functions:
```tsx
interface ObservableArray<T> extends Array<T> {
  map<R>(f: (value: T) => R): ObservableArray<R>
  observe(observer: ArrayObserver<T>): Unsubscribable
}
```

An `ArrayObserver<T>` must define the `set(i: number, v: T)` method, and may also
observe calls to other methods, such as `push`, `pop`, etc.

Internally, any part of the DOM that is rendered as an `ObservableArray<T>` will
be efficiently mapped into DOM nodes. All array operations will directly
manipulate the DOM nodes corresponding to each element, instead of redrawing the
entire list on every change.

Using `observableArray` is very simple: when an array may change after being
drawn, it should be wrapped in an `ObservableArray`.

```tsx
- const numbers = []
+ const numbers = observableArray([])

return (
  <div>
    <button onclick={() => numbers.push(numbers.length)}>Add number</button>

    {numbers.map(x => <h2>{x}</h2>)}
  </div>
)
```
