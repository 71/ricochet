# Ricochet

A small, reactive React-like web framework meant to be simple, light and fast.


## Overview

Ricochet attempts to avoid the cost of rendering components several times per second
by following a simple principle: when a component is rendered (for instance,
by using the syntax `<Foo />`), it is **only rendered once**. This means
that the render method will only be called once.

Then, when the state of the component changes (by updating a reactive stream),
only the parts of the component that depend on the changed stream will be updated.

For instance, let's make a clock.

```tsx
// In React:
const Clock = () => {
  const [date, setDate] = React.useState(new Date())

  setInterval(() => setDate(new Date()), 1000)

  return (
    <span>{date.toString()}</span>
  )
}

// In Ricochet:
const Clock = () => {
  // 'reactive' creates an observable stream with an initial value,
  // whose value can later be updated.
  const date = reactive(new Date())

  // The underlying value of 'date' can be updated by calling
  // it with an argument.
  setInterval(() => date(new Date()), 1000)

  // To access the current value of 'date', one can call it without
  // arguments.
  console.log(date())

  return (
    // Ricochet has first class support for streams. When 'date'
    // will be updated, the content of the span will be as well.
    <span>{date}</span>
  )
}
```

If you're used to React, the above example might have triggered something in
you. Indeed, the `Clock` component uses `console.log` inside of its body,
without `useEffect`.

However, since `Clock` will only be called once, then so will `console.log`.


## Diving deeper

Ricochet attempts to be lightweight, and does not make assumptions on
one's favorite libraries. Therefore, it is designed to work with any
reactive library [that uses `Symbol.observable` to expose its interface](https://github.com/benlesh/symbol-observable#making-an-object-observable):

```ts
interface Unsubscribable {
  unsubscribe(): void
}

interface Observable<T> {
  [Symbol.observable]: () => {
    subscribe(observer: (newValue: T) => void): Unsubscribable
  }
}
```

Then, using your favorite library, observable streams can be freely manipulated.

For instance, in order to combine a user's first and last names into a single string,
using [RxJS](https://github.com/ReactiveX/rxjs):

```tsx
const FullName = ({ firstName, lastName }) => {
  const fullName = merge(firstName, lastName)

  return (
    <span>{fullName}</span>
  )
}
```

Of course, attributes may be reactive as well:

```tsx
<span className={firstName.pipe(map(x => x == '' ? 'nickname' : 'fullname'))}>
  {fullName}
</span>
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
