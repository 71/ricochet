Ricochet
========

A small and unopinionated web framework meant to be simple, fast and lightweight.


## Overview

Ricochet is a small web framework which uses the [JSX](https://reactjs.org/docs/introducing-jsx.html)
syntax and [observable sequences](http://reactivex.io/documentation/observable.html) to define layouts.
Its main ability is to render [`NestedNode`](#type-nestednode)s into the DOM efficiently, where
a [`NestedNode`](#type-nestednode) is defined as follows:

```typescript
// A nested node can be...
type NestedNode =
  // ... a DOM element,
  | Element
  // ... a primitive,
  | number | string
  // ... a list of nested nodes,
  | ReadonlyArray<NestedNode>
  // ... or an observable sequence of nested nodes.
  | Observable<NestedNode>
```

Therefore, Ricochet can render any array, [observable sequence](#interface-observablet)
or node into the DOM, and make sure the rendered node stays in sync with the
value that was rendered, without rendering the node multiple times.

Ricochet does not optimize its operations by default, but [makes it extremely easy to add
features such as memoization, update batching and efficient list rendering](#performances).


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

Now here it is in Ricochet. Please note that [`subject`](#function-subjecttinitialvalue-extendedsubjectt)
(defined in [`ricochet/reactive`](./src/reactive.ts)), creates an observable similar to a
[BehaviorSubject](https://rxjs-dev.firebaseapp.com/guide/subject#behaviorsubject).

```tsx
const Clock = () => {
  // Since 'Clock' is only called once, there is no need for a
  // tool such as 'useState'.
  const date$ = subject(new Date())

  // Once again, there is no need to wrap this logic at all.
  const interval = setInterval(() => date$.next(new Date()), 1000)

  // Resources are bound to elements and can be disposed of by
  // using `element.destroy()`. To give ownership of a subscription
  // to an element, we can use the 'attach' function.
  attach({
    unsubscribe() {
      clearInterval(interval)
    }
  })

  return (
    // Ricochet has first class support for streams. When 'date'
    // will be updated, the content of the span will be as well.
    <span>{date$}</span>
  )
}
```


## Event handlers and data binding

Two different ways are provided to subscribe to event handlers on rendered elements.

The first way is to simply set an element's `on*` property on creation, ie.

```tsx
const onClickHandler = () => {
  alert('Clicked!')
}

<button onclick={onClickHandler} />
```

The second way, unique to Ricochet, is to create a `Connectable`, which can be
attached to an element during its creation. This provides an easy way to convert
an event handler into an observable sequence, while playing nicely with the
declarative JSX syntax.

```tsx
const click$ = eventListener('click')

attach(
  click$.subscribe(() => {
    alert('Clicked!')
  })
)

<button connect={click$} />
```

Another `Connectable` is provided for data binding.

```tsx
const name$ = subject('John')
const nameBinding$ = valueBinder(name$)

// Any change to 'name$' will update the value of the input, and any
// change to the input's value will update 'name$'.
<input type='text' connect={nameBinding$} />
```


## Performances

Ricochet's goal is to avoid using a VDOM, and instead to create redraws, virtual
or real, as rarely as possible. Since only the parts of the DOM that depend on a stream
will be recomputed when the stream changes, allocations should be less common,
and changes to the DOM should be as rare as if a diffing algorithm had been used.

**However**, in some cases a simple change to a reactive stream may
impact large parts of the DOM, which will lead to a slower redraw. In these
cases, performances may still be tuned easily in different ways.


### Exploiting observables

[`Observable`](#interface-observablet) streams are very powerful abstractions, and
can be manipulated to optimize their performances.

For instance, [RxJS](https://github.com/ReactiveX/rxjs) provides the following features
for improving how streams are processed:
- [Schedulers](https://rxjs-dev.firebaseapp.com/guide/scheduler), which can be used to
  batch updates together, or to perform them [at the right time](https://rxjs-dev.firebaseapp.com/api/index/const/animationFrameScheduler).
- Operators such as [`throttle`](https://rxjs-dev.firebaseapp.com/api/operators/throttle) and
  [`debounce`](https://rxjs-dev.firebaseapp.com/api/operators/debounce).


### Customizing the rendering process

As stated in the [overview](#overview), Ricochet can render many kinds of nodes. However, a supported type
of node that wasn't mentioned before is the [`CustomNode`](#interface-customnode).

Nodes that implement this interface are given full control over how they and their children are rendered,
making operations such as batch processing and node caching extremely easy to implement.

For instance, here is how you would implement a node that only updates if a condition is respected:

```typescript
class PredicateNode implements CustomNode {
  constructor(
    readonly node: NestedNode,
    readonly predicate: (node: NestedNode) => boolean
  ) {}

  render(parent: Element, prev: NodeRef, next: NodeRef, r: RenderFunction) {
    // NodeRef is equivalent to [Node]; it is used to override variables accross function bodies.
    if (!this.predicate(this.node))
      return

    r(this.node, prev, next)
  }
}
```


### Caching elements

Since all Ricochet elements are regular DOM elements, we may want to cache elements that
we know we may have to reuse.

```tsx
const App = ({ dialogProps, ...props }) => {
  const dialogOpen$ = subject(false)
  
  // Keep a reference to the dialog here, so that it is only rendered once
  const dialog = <Dialog { ...dialogProps } />

  return (
    <div class='app'>
      <Content { ...props } />

      { dialogOpen$.map(dialogOpen => dialogOpen && dialog) }
    </div>
  )
}
```

This is unfortunately not that simple. Here, as soon as `dialog` gets rendered for the first time,
some resources will be attached to it via `attach`. Then, as soon as `dialogOpen$` becomes `false`,
all these resources will be disposed of, and `dialog`, while still existing, will be invalid.

Therefore, we must tell Ricochet that `dialog` is owned by `App`, and that it should
only be disposed when `App` itself is disposed of.

```tsx
// This line:
const dialog = <Dialog { ...dialogProps } />

// Becomes this line:
const dialog = <Dialog noimplicitdispose { ...dialogProps } />
```

Now, when dialog is removed by its parent element, it will not be disposed automatically.  
In order to remove it, `element.destroy(true)` must be called, `true` precising that it
the element will be both destroyed (removed from the DOM) and disposed.

A common pattern is to cache an element in a component, and to dispose it when the parent
component itself is disposed, rather than when the element is hidden. This can be easily
accomplished by calling `attach` with an element rather than with a subscription.

```tsx
const TodoList = ({ todos }: { todos: Todo[] }) => {
  const cache: Record<number, TodoItem> = {}

  for (const todo of todos) {
    const todoItem = <TodoItem text={todo.text} done={todo.done} noimplicitdispose />

    attach(cache[todo.id] = todoItem)
  }

  const query$: Subject<string> = subject('')

  return (
    <div>
      <input connect={valueBinder(query$)} />

      <ul>
        { query$.map(query =>
            todos
              .filter(todo => todo.text.includes(query))
              .map(todo => cache[todo.id])
        ) }
      </ul>
    </div>
  )
}
```

In the above example, if `noimplicitdispose` had not been used, each `TodoItem` would have been
disposed as soon as it was filtered out by the query, making subsequent renders invalid.

Thanks to `noimplicitdispose`, `TodoItem`s will only be disposed when `TodoList` itself is disposed.


### Built-in optimizations

Ricochet provides several utilities designed to make things faster, which are listed below. Other
utilities may be added later on, such as keyed lists, memoization, and batch rendering.

##### Efficient list rendering

The [`ricochet/array`](#ricochetarray) module provides the
[`observableArray<T>`](#function-observablearraytarray-observablearrayt) function, which takes an array
and returns an [`ObservableArray<T>`](#interface-observablearrayt-extends-arrayt-readonlyobservablearraymemberst).
This specialized array provides the same interface as a regular array, but is able to efficiently
map changes to its underlying data to the DOM by implementing [`CustomNode`](#interface-customnode).

```tsx
const numbers = observableArray<number>()

return (
  <div>
    {/* 'push' is specialized to directly add new nodes to the DOM,
        without updating the rest of the elements. */}
    <button onclick={() => numbers.push(numbers.length)}>Add number</button>

    {/* 'sync' returns a `ReadonlyObservableArray` that is synced with its source. */}
    { numbers.sync(x => <h2>{x}</h2>) }
  </div>
)
```


## Examples, unit tests and benchmarks

[Jest](https://jestjs.io) unit tests are available in the [src](./src) directory,
and [benchmarks](https://github.com/krausest/js-framework-benchmark) will be added
shortly.

**Notice**: Due to Jest (or rather [jsdom](https://github.com/jsdom/jsdom))
not supporting Web Components and behaving differently from the browser,
tests currently fail if ran via Jest. While waiting for these bugs to be fixed,
the [`examples`](./examples) page currently runs all tests in the browser,
ensuring that Ricochet keeps working as intended.


## Tips

- Sometimes, a component may want to receive either an observable value or a regular
  value, depending on what the caller needs. However, in most cases `T` and `Observable<T>`
  have very different interfaces, which makes it hard to manipulate one or the other
  via a single API. In cases where an `Observable<T>` *could* be accepted, it is best to
  always accept an `Observable<T>` sequence, since such sequences can be made to emit
  a single element before completing, therefore acting exactly like a regular function (see:
  [`constant`](#function-constanttvalue-constantt),
  [`of`](https://rxjs-dev.firebaseapp.com/api/index/function/of)).  
  Since these observable sequences complete right after emitting an item, their
  resources will be disposed of quickly, and it will be as if a non-observable value
  had been used.

  Additionally, the built-in functions
  [`combine`](#function-combineoobservables-subscribable-k-in-keyof-o-ok-extends-observableinfer-t--t--never)
  and
  [`compute`](#function-computetcomputation-computeobservablet--constantt) both accept observable sequences as
  inputs, but may receive non-observable values, avoiding a useless subscription / unsubscription
  operation.

- Ricochet was designed with [RxJS](https://github.com/ReactiveX/rxjs)'s API in mind, but works
  with many different reactive libraries. In fact, it only requires of observable
  values to define a way to subscribe to them; therefore the
  [`constant`](#function-constanttvalue-constantt) /
  [`of`](https://rxjs-dev.firebaseapp.com/api/index/function/of) observable
  may be implement as follows:

  ```typescript
  function of<T>(value: T): Subscribable<T> & Observable<T> {
    const observable = {
      [Symbol.observable]() {
        return observable
      },

      subscribe(observer: Observer<T>) {
        observer.next(value)
        observer.complete()
      }
    }

    return observable
  })
  ```



# API

### [`ricochet`](src/index.ts)
The core Ricochet API, used to render JSX nodes.

#### [`type Observer<T>`](src/index.ts#L17-L24)

Defines an observer.


Defined as:
```typescript
type Observer<T> = ((newValue: T) => void) | {
  next(newValue: T): void
  complete?(): void
}
```


#### [`interface Subscription`](src/index.ts#L25-L28)
Defines a subscription, which can be unsubscribed of.



##### [`unsubscribe(): void`](src/index.ts#L29-L34)
Cancels the subscription, disposing of resources and cancelling pending operations.



#### [`interface Subscribable<T> extends Observable<T>`](src/index.ts#L35-L38)
Defines a value whose changes can be subscribed to.



##### [`subscribe(observer): Subscription`](src/index.ts#L39-L44)
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| observer | `Observer<T>` | None |

Subscribes to changes to the value.



#### [`interface Observable<T>`](src/index.ts#L45-L56)
Defines an observable value.



This interface defines the bare minimum for Ricochet
to interface with reactive libraries that implement this
[ECMAScript Observable proposal](https://github.com/tc39/proposal-observable#api),
such as [RxJS](https://github.com/ReactiveX/rxjs).



#### [`type MaybeObservable<T>`](src/index.ts#L57-L62)

Defines a value that may be `Observable`.


Defined as:
```typescript
type MaybeObservable<T> = Observable<T> | T
```


#### [`type NestedNode`](src/index.ts#L63-L67)

An arbitrarily nested DOM `Node`.


Defined as:
```typescript
type NestedNode = Node | CustomNode | string | number | NodeArray | ObservableNode
```


#### [`interface ObservableNode extends Observable<NestedNode>`](src/index.ts#L68-L72)
An observable `NestedNode`.



#### [`interface NodeArray extends Array<NestedNode>`](src/index.ts#L73-L77)
A list of `NestedNode`s.



#### [`type NodeRef`](src/index.ts#L78-L82)

A mutable reference to a `Node`.


Defined as:
```typescript
type NodeRef = [Node]
```


#### [`type RenderFunction`](src/index.ts#L83-L87)

The function used to render a `NestedNode`.


Defined as:
```typescript
type RenderFunction = (value: NestedNode, previous: NodeRef, next: NodeRef) => void
```


#### [`interface CustomNode`](src/index.ts#L88-L91)
A custom-rendered node.



##### [`render(parent, previous, next, r): void`](src/index.ts#L92-L101)
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| parent | `Element` | None |
| previous | `NodeRef` | None |
| next | `NodeRef` | None |
| r | `RenderFunction` | None |

Renders the node in the DOM, as a child of the given parent.



In Ricochet, nodes must be rendered between other nodes. Since a single `CustomNode`
may be rendered as several DOM nodes, these DOM nodes should be inserted **before**
`next`, and `previous` must be set to the **first** node that was inserted.



#### [`type Connectable<T>`](src/index.ts#L102-L109)
 - `T`: `Node`

Defines an element that can be connected to a node.


Defined as:
```typescript
type Connectable<T extends Node> =
    ((element: T, attachSubscriptions: (...subscriptions: Subscription[]) => void) => void)
  | { connect: (element: T, attachSubscriptions: (...subscriptions: Subscription[]) => void) => void }
```


#### [`type Component<Props, ReturnType>`](src/index.ts#L122-L127)
 - `Props`: `object`
 - `ReturnType`: `Node | Observable<Node>`

Defines a function that takes properties and returns a self-updating element.


Defined as:
```typescript
type Component<Props extends object, ReturnType extends Node | Observable<Node>> = (props: Props) => ReturnType
```


#### [`function h<Tag>(tag, attrs, ...children): JSX.IntrinsicElements[Tag]`](src/index.ts#L128-L136)
 - `Tag`: `keyof JSX.IntrinsicElements`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| tag | `Tag` | None |
| attrs | `JSX.IntrinsicAttributes & WritablePart<JSX.IntrinsicElements[Tag]>` | None |
| children | `NodeArray` | None |

Renders an intrinsic element.



#### [`function h(tag, attrs, ...children): JSX.Element`](src/index.ts#L137-L145)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| tag | `string` | None |
| attrs | `JSX.IntrinsicAttributes & WritablePart<Element>` | None |
| children | `NodeArray` | None |

Renders an unknown intrinsic element.



#### [`function h<P, E, K>(component, props, ...children): E`](src/index.ts#L146-L154)
 - `P`: `object`
 - `E`: `JSX.Element`
 - `K`: `Component<P, E>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `K` | None |
| props | `JSX.IntrinsicAttributes & P & WritablePart<E>` | None |
| children | `NodeArray` | None |

Renders a component.



#### [`function attach(...subscriptions): typeof attach`](src/index.ts#L168-L179)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| subscriptions | `(Subscription | Element)[]` | None |

Attaches the given subscriptions or explicitly-disposed elements
to the element that is currently being initialized.



#### [`function mount(node): Element`](src/index.ts#L180-L184)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| node | `ObservableNode` | None |

Mounts an observable node as a simple element.



#### [`function mount(node, el): Subscription`](src/index.ts#L185-L189)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| node | `NestedNode` | None |
| el | `Element` | None |

Mounts the given observable node as a child of the given element.



#### [`function eventListener<N, E>(type, opts): Connectable<N> & Subscribable<E>`](src/index.ts#L419-L447)
 - `N`: `Node`
 - `E`: `Event`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| type | `string` | None |
| opts | `boolean | AddEventListenerOptions` | None |

Returns a `Connectable<T>` that can be used to register to events on one
or more elements.




### [`ricochet/array`](src/array.ts)
Utilities for rendering lists efficiently with the `ObservableArray` type.

#### [`type ArrayObserver<T>`](src/array.ts#L6-L17)

Defines an object that can listen to changes to an `ObservableArray`.


Defined as:
```typescript
type ArrayObserver<T> = {
  [key in string & keyof Array<T>]?:
    Array<T>[key] extends (...args: infer Args) => any
      ? (...args: Args) => void
      : never
} & {
  set: (index: number, value: T) => void
}
```


#### [`interface ReadonlyObservableArrayMembers<T>`](src/array.ts#L18-L22)
Interfaces which exports all members implemented by `ReadonlyObservableArray<T>`,
but not `ReadonlyArray<T>`. Required by TypeScript.



##### [`readonly length$: Subscribable<number>`](src/array.ts#L23-L27)
Returns an observable sequence that emits whenever the length of this array changes.



##### [`readonly change$: Subscribable<[number, T]>`](src/array.ts#L28-L32)
Returns an observable sequence that emits whenever an item is modified.



##### [`observe(observer, init): Subscription`](src/array.ts#L33-L40)
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| observer | `ArrayObserver<T>` | None |
| init | `boolean` | If `true`, `push` will be called on initialization with the content of the array.  |

Observes changes made to the array.




##### [`mapArray<R>(f, thisArg): Observable<R>`](src/array.ts#L41-L46)
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| f | `(array: ReadonlyArray<T>) => R` | None |
| thisArg | `any` | None |

Returns an observable sequence that gets updated everytime this array
changes.



##### [`sync<R>(f): ReadonlyObservableArray<R>`](src/array.ts#L47-L53)
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| f | `(value: T, index: number) => R` | None |

Propagates changes to the items of the given list to items of a new list,
according to a `map` function.



#### [`interface ReadonlyObservableArray<T> extends ReadonlyArray<T>, ReadonlyObservableArrayMembers<T>`](src/array.ts#L54-L58)
Defines a readonly array whose changes can be observed.



#### [`interface ObservableArray<T> extends Array<T>, ReadonlyObservableArrayMembers<T>`](src/array.ts#L59-L62)
Defines an array whose changes can be observed.



##### [`sync<R>(f, g): ObservableArray<R>`](src/array.ts#L63-L68)
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| f | `(value: T, index: number) => R` | None |
| g | `(value: R, index: number) => T` | None |

Propagates changes to the items of the given list to items of a new list,
and back again.



##### [`swap(a, b): T extends NestedNode ? void : never`](src/array.ts#L69-L155)
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| a | `number` | None |
| b | `number` | None |

Swaps the values at the two given indices.



#### [`function isObservableArray<T>(array): array is ObservableArray<T>`](src/array.ts#L156-L162)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| array | `any` | None |

Returns whether the given array is an `ObservableArray`.




### [`ricochet/async`](src/async.ts)
Utilities for rendering with promises.

#### [`function async<E>(component): E`](src/async.ts#L14-L19)
 - `E`: `Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `Promise<E>` | None |

Returns an element that will be replaced by the result of the given
promise when it resolves.



#### [`function async<P, E>(component): Component<P, E>`](src/async.ts#L20-L25)
 - `P`: `{}`
 - `E`: `Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `(props: P) => Promise<E>` | None |

Wraps a component that asynchronously resolves as a regular component
whose element will be replaced once the promise resolves.



#### [`function Async<P, E, K>({ component, props }): E`](src/async.ts#L46-L52)
 - `P`: `{}`
 - `E`: `Element`
 - `K`: `{}`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `Component<P & K, E>` | None |
| props | `Promise<K>` | None |

Given a component, some of its properties, and a promise that resolves
to the rest of its properties, returns an element that will be replaced
by the resolved element when the promise finishes.



#### [`function Async<P, E>({ component, ...props }): E`](src/async.ts#L53-L58)
 - `P`: `{}`
 - `E`: `Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `Promise<Component<P, E>>` | None |
| props | `P` | None |

Given a promise that resolves to a component and its properties, returns
an element that will be replaced by the resolved element when the promise finishes.




### [`ricochet/reactive`](src/reactive.ts)
Utilities for creating and combining observable streams and subjects.

#### [`interface Subject<T> extends Subscribable<T>`](src/reactive.ts#L5-L8)
Defines a value that is both observable and observer.



##### [`next(newValue): void`](src/reactive.ts#L9-L13)
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| newValue | `T` | None |

Updates the underlying value, notifying all observers of a change.



#### [`function isSubject<T>(value): value is BuiltinSubject<T>`](src/reactive.ts#L14-L20)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| value | `any` | None |

Returns whether the given value is a subject created with `subject`.



#### [`class BuiltinSubject<T> implements Subject<T>`](src/reactive.ts#L21-L37)
`Subject` augmented with some specialized operations, returned by `subject`.



##### [`value: T`](src/reactive.ts#L38-L56)
Gets or sets the underlying value.



##### [`setUnderlyingValue(value)`](src/reactive.ts#L57-L76)
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| value | `T` | None |

Sets the underlying value without notifying observers.



##### [`map<R>(map): Subscribable<R>`](src/reactive.ts#L77-L81)
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| map | `(input: T) => R` | None |

Returns a new `Observable` that gets updated when this subject changes.



##### [`map<R>(map, unmap): BuiltinSubject<R>`](src/reactive.ts#L82-L116)
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| map | `(input: T) => R` | None |
| unmap | `(input: R) => T` | None |

Returns a new `Subject` value that propagates changes to values both ways.



#### [`function subject<T>(initialValue): BuiltinSubject<T>`](src/reactive.ts#L117-L124)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| initialValue | `T` | None |

Returns a reactive wrapper around the given value.



#### [`class Constant<T> implements Subscribable<T>`](src/reactive.ts#L125-L150)
`Subscrible` that represents a constant value, returned by `constant`.



#### [`function constant<T>(value): Constant<T>`](src/reactive.ts#L151-L162)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| value | `T` | None |

Returns an observable value that emits a single value,
and then immediately completes.



This function should be used when an observable stream
is expected somewhere, but a single constant value can be provided.



#### [`class ComputeObservable<T> extends BuiltinObservable<T>`](src/reactive.ts#L163-L215)
An `Observable` that computes its values based on an arbitrary computation,
which may itself depend on other observable sequences; returned by `compute`.



#### [`function compute<T>(computation): ComputeObservable<T> | Constant<T>`](src/reactive.ts#L216-L244)

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| computation | `($: <U>(observable: Observable<U>, defaultValue?: U) => U) => T` | None |

Returns an observable that will be updated when any of the given observables
changes.



See [S.js](https://github.com/adamhaile/S) for the inspiration for this function. Please note
that unlike S, changes are propagated immediately, without waiting for the next time unit.



##### Example



```typescript
const a = subject(1)
const b = subject(1)

const c = compute($ => $(a) + $(b))

c.subscribe(console.log).unsubscribe() // Prints '2'

a.next(10)

c.subscribe(console.log) // Prints '11'

b.next(20) // Prints '30'

```

#### [`type ObservableValueTypes<O>`](src/reactive.ts#L245-L251)

Maps `Observable<T>` properties of an object to `T`.


Defined as:
```typescript
type ObservableValueTypes<O> = {
  [K in keyof O]: O[K] extends Observable<infer T> ? T : O[K]
}
```


#### [`class CombineObservable<O extends any[]> extends BuiltinObservable<ObservableValueTypes<O>>`](src/reactive.ts#L252-L278)
An `Observable` sequence that emits values when any of its dependencies
is updated; returned by `combine`.




### [`ricochet/interop/rxjs`](src/interop/rxjs.ts)
Interop helpers for [RxJS](https://github.com/ReactiveX/rxjs).


### [`ricochet/interop/wc`](src/interop/wc.ts)
Utilities for defining Web Components.

#### [`function makeCustomElement<P, E>(component, translateProperties): typeof HTMLElement`](src/interop/wc.ts#L5-L28)
 - `P`: `object`
 - `E`: `JSX.Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `Component<P, E>` | None |
| translateProperties | `object & { [K in keyof P]: (value?: string) => P[K] }` | None |

Creates a custom element (or web component) out of a JSX component.



