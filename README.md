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
  const date = subject(new Date())

  // Once again, there is no need to wrap this logic at all.
  const interval = setInterval(() => date.next(new Date()), 1000)

  // Resources are bound to elements and can be disposed of by
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
impact large parts of the DOM, which will lead to a slower redraw. In these
cases, performances may still be tuned easily in different ways.


### Exploiting observables

[`Observable`](#interface-observablet) streams are very powerful abstractions, and
can be manipulated to optimize their performances.

For instance, [RxJS](https://github.com/ReactiveX/rxjs) provides the following features
for improving how streams are processed:
- [Schedulers](https://rxjs-dev.firebaseapp.com/guide/scheduler), which can be used to
  batch stream updates together, or perform them at the right time.
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

  render(parent: Element, prev: { value: Node }, next: { value: Node }, r: RenderFunction) {
    if (!this.predicate(this.node))
      return

    r(this.node, prev, next)
  }
}
```


### Built-in optimizations

Ricochet provides several utilities designed to make things faster, which are listed below. Other
utilities may be added later on, such as keyed lists, memoization, and batch rendering.

##### Efficient list rendering

The [`ricochet/array`](#ricochetarray) module provides the
[`observableArray<T>`](#function-observablearraytarray-observablearrayt) function, which takes an array
and returns an [`ObservableArray<T>`](#interface-observablearrayt-extends-arrayt). This specialized
array provides the same interface as a regular array, but is able to efficiently
map changes to its underlying data to the DOM by implementing [`CustomNode`](#interface-customnode).

```tsx
const numbers = observableArray<number>()

return (
  <div>
    {/* 'push' is specialized to directly add new nodes to the DOM,
        without updating the rest of the elements. */}
    <button onclick={() => numbers.push(numbers.length)}>Add number</button>

    {/* 'map' is specialized to return another `ObservableArray`. */}
    {numbers.map(x => <h2>{x}</h2>)}
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


# API

### `ricochet`
The core Ricochet API, used to render JSX nodes.

#### `type Observer<T>`

Defines an observer.


Defined as:
```typescript
type Observer<T> = ((newValue: T) => void) | { next(newValue: T): void; complete?(): void }
```


#### `interface Subscription`
Defines a subscription, which can be unsubscribed of.



##### `unsubscribe(): void`
Cancels the subscription, disposing of resources and cancelling pending operations.



#### `interface Subscribable<T> extends Observable<T>`
Defines a value whose changes can be subscribed to.



##### `subscribe(observer): Subscription`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| observer | `Observer<T>` | None |

Subscribes to changes to the value.



#### `interface Observable<T>`
Defines an observable value.



This interface defines the bare minimum for Ricochet
to interface with reactive libraries that implement this
[ECMAScript Observable proposal](https://github.com/tc39/proposal-observable#api),
such as [RxJS](https://github.com/ReactiveX/rxjs).



#### `type MaybeObservable<T>`

Defines a value that may be `Observable`.


Defined as:
```typescript
type MaybeObservable<T> = Observable<T> | T
```


#### `type NestedNode`

An arbitrarily nested DOM `Node`.


Defined as:
```typescript
type NestedNode = Node | CustomNode | string | number | NodeArray | ObservableNode
```


#### `interface ObservableNode extends Observable<NestedNode>`
An observable `NestedNode`.



#### `interface NodeArray extends Array<NestedNode>`
A list of `NestedNode`s.



#### `interface RenderFunction`
The function used to render a `NestedNode`.



#### `interface CustomNode`
A custom-rendered node.



##### `render(parent, previous, next, r): void`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| parent | `Element` | None |
| previous | `{ value: Node; }` | None |
| next | `{ value: Node; }` | None |
| r | `RenderFunction` | None |

Renders the node in the DOM, as a child of the given parent.



In Ricochet, nodes must be rendered between other nodes. Since a single `CustomNode`
may be rendered as several DOM nodes, these DOM nodes should be inserted **before**
`next`, and `previous.value` must be set to the **first** node that was inserted.



#### `type Component<Props, ReturnType>`
 - `Props`: `object`
 - `ReturnType`: `Node | Observable<Node>`

Defines a function that takes properties and returns a self-updating element.


Defined as:
```typescript
type Component<Props extends object, ReturnType extends Node | Observable<Node>> = (props: Props) => ReturnType
```


#### `function h<Tag>(tag, attrs, ...children): JSX.IntrinsicElements[Tag]`
 - `Tag`: `keyof JSX.IntrinsicElements`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| tag | `Tag` | None |
| attrs | `JSX.IntrinsicAttributes & WritablePart<JSX.IntrinsicElements[Tag]>` | None |
| children | `NodeArray` | None |

Renders an intrinsic element.



#### `function h(tag, attrs, ...children): JSX.Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| tag | `string` | None |
| attrs | `JSX.IntrinsicAttributes & WritablePart<Element>` | None |
| children | `NodeArray` | None |

Renders an unknown intrinsic element.



#### `function h<P, E, K, E>>(component, props, ...children): E`
 - `P`: `object`
 - `E`: `JSX.Element`
 - `K`: `Component<P`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `K` | None |
| props | `JSX.IntrinsicAttributes & P & WritablePart<E>` | None |
| children | `NodeArray` | None |

Renders a component.



#### `function attach(...subscriptions): void`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| subscriptions | `Subscription[]` | None |

Attaches the given subscriptions to the element that is currently being initialized.



#### `function mount(node): Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| node | `ObservableNode` | None |

Mounts an observable node as a simple element.



#### `function mount(node, el): Subscription`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| node | `NestedNode` | None |
| el | `Element` | None |

Mounts the given observable node as a child of the given element.




### `ricochet/array`
Utilities for rendering lists efficiently with the `ObservableArray` type.

#### `type ArrayObserver<T>`

Defines an object that can listen to changes to an `ObservableArray`.


Defined as:
```typescript
type ArrayObserver<T> = { [key in string & keyof Array<T>]?: Array<T>[key] extends (...args: infer Args) => any ? (...args: Args) => void : never
```


#### `interface ObservableArray<T> extends Array<T>`
Defines an array whose changes can be observed.



##### `observe(observer, init): Subscription`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| observer | `ArrayObserver<T>` | None |
| init | `boolean` | If `true`, `push` will be called on initialization with the content of the array.  |

Observes changes made to the array.




##### `map<R>(f, thisArg): ObservableArray<R>`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| f | `(value: T, index: number, array: Array<T>) => R` | None |
| thisArg | `any` | None |

Propagates changes to the items of the given list to items of a new list,
according to a `map` function.



#### `function isObservableArray<T>(array): array is ObservableArray<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| array | `any` | None |

Returns whether the given array is an `ObservableArray`.



#### `function observableArray<T>(...array): ObservableArray<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| array | `T[]` | None |

Returns an observable array.




### `ricochet/async`
Utilities for rendering with promises.

#### `function async<E>(component): E`
 - `E`: `Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `Promise<E>` | None |

Returns an element that will be replaced by the result of the given
promise when it resolves.



#### `function async<P, E>(component): Component<P, E>`
 - `P`: `{}`
 - `E`: `Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `(props: P) => Promise<E>` | None |

Wraps a component that asynchronously resolves as a regular component
whose element will be replaced once the promise resolves.



#### `function Async<P, E, K>({ component, props }): E`
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



#### `function Async<P, E>({ component, ...props }): E`
 - `P`: `{}`
 - `E`: `Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `Promise<Component<P, E>>` | None |
| props | `P` | None |

Given a promise that resolves to a component and its properties, returns
an element that will be replaced by the resolved element when the promise finishes.




### `ricochet/reactive`
Utilities for creating and combining observable streams and subjects.

#### `interface Subject<T> extends Subscribable<T>`
Defines a reactive value that can be updated.



#### `interface ExtendedSubject<T> extends Subject<T>`
Returns the underlying value.



##### `value: T`
Gets or sets the underlying value.



##### `setUnderlyingValue(newValue): void`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| newValue | `T` | None |

Sets the underlying value without notifying observers.



##### `map<R>(map): Observable<R>`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| map | `(input: T) => R` | None |

Returns a new `Observable` that gets updated when this subject changes.



##### `map<R>(map, unmap): ExtendedSubject<R>`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| map | `(input: T) => R` | None |
| unmap | `(input: R) => T` | None |

Returns a new `Subject` value that propagates changes to values both ways.



#### `function isSubject<T>(value): value is ExtendedSubject<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| value | `any` | None |

Returns whether the given value is a subject created with `subject`.



#### `function subject<T>(initialValue): ExtendedSubject<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| initialValue | `T` | None |

Returns a reactive wrapper around the given value.



#### `function constant<T>(value): Subscribable<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| value | `T` | None |

Returns an observable value that emits a single value,
and then immediately completes.



This function should be used when an observable stream
is expected somewhere, but a single constant value can be provided.



#### `function compute<T>(computation): Subscribable<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| computation | `($: <U>(observable: Observable<U>, defaultValue?: U) => U) => T` | None |

Returns an observable that will be updated when any of the given observables
changes.



See [S.js](https://github.com/adamhaile/S) for the inspiration for this function.



#### `function combine<O>(...observables): Subscribable<{ [K in keyof O]: O[K] extends Observable<infer T> ? T : never`
 - `O`: `Observable<any>[]`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| observables | `O` | None |

Returns an observable that gets updated when any of the given
observables gets updated as well.




### `ricochet/interop/rxjs`
Interop helpers for [RxJS](https://github.com/ReactiveX/rxjs).


### `ricochet/interop/wc`
Utilities for defining Web Components.

#### `function makeCustomElement<P, E>(component, translateProperties): typeof HTMLElement`
 - `P`: `object`
 - `E`: `JSX.Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `Component<P, E>` | None |
| translateProperties | `object & { [K in keyof P]: (value?: string) => P[K] }` | None |

Creates a custom element (or web component) out of a JSX component.



