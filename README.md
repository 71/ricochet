Ricochet
========

A small and unopinionated web framework meant to be simple, fast and lightweight.


## Overview

Ricochet has similar goals to [Surplus](https://github.com/adamhaile/surplus), but it
achieves them differently. Ricochet's main feature is to render `NestedNode`s into
the DOM efficiently, where a `NestedNode` is defined as follows:

```typescript
type NestedNode = string | Element | Observable<NestedNode> | NestedNode[]
```

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
+ const numbers = observableArray()

return (
  <div>
    <button onclick={() => numbers.push(numbers.length)}>Add number</button>

    {numbers.map(x => <h2>{x}</h2>)}
  </div>
)
```

---

## API

### `ricochet`
The core Ricochet API, used to render JSX nodes.

#### `type Observer<T>`

Defines an observer.


Defined as:
```typescript
type Observer<T> = ((newValue: T) => void) | { next(newValue: T): void
```


#### `interface Subscription`
Defines a subscription, which can be unsubscribed of.



##### `unsubscribe(): void`
| Parameter | Type | Description |
| --------- | ---- | ----------- |

Cancels the subscription, disposing of resources and cancelling pending operations.



#### `interface Subscribable<T> extends Observable<T>`
Defines a value whose changes can be subscribed to.



##### `subscribe(observer: Observer<T>): Subscription`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| observer | `Observer<T>` | None |

Subscribes to changes to the value.



#### `interface Observable<T>`
Defines an observable value.



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



##### `render(parent: Element, previous: {
        value: Node`
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


#### `function h<Tag>(tag: Tag, attrs: JSX.IntrinsicAttributes & WritablePart<JSX.IntrinsicElements[Tag]>, ...children: NodeArray): JSX.IntrinsicElements[Tag]`
 - `Tag`: `keyof JSX.IntrinsicElements`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| tag | `Tag` | None |
| attrs | `JSX.IntrinsicAttributes & WritablePart<JSX.IntrinsicElements[Tag]>` | None |
| children | `NodeArray` | None |

Renders an intrinsic element.



#### `function h(tag: string, attrs: JSX.IntrinsicAttributes & WritablePart<Element>, ...children: NodeArray): JSX.Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| tag | `string` | None |
| attrs | `JSX.IntrinsicAttributes & WritablePart<Element>` | None |
| children | `NodeArray` | None |

Renders an unknown intrinsic element.



#### `function h<P, E, K, E>>(component: K, props: JSX.IntrinsicAttributes & P & WritablePart<E>, ...children: NodeArray): E`
 - `P`: `object`
 - `E`: `JSX.Element`
 - `K`: `Component<P`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `K` | None |
| props | `JSX.IntrinsicAttributes & P & WritablePart<E>` | None |
| children | `NodeArray` | None |

Renders a component.



#### `function attach(...subscriptions: Subscription[]): void`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| subscriptions | `Subscription[]` | None |

Attaches the given subscriptions to the element that is currently being initialized.



#### `function mount(node: ObservableNode): Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| node | `ObservableNode` | None |

Mounts an observable node as a simple element.



#### `function mount(node: NestedNode, el: Element): Subscription`

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



##### `observe(observer: ArrayObserver<T>, init?: boolean): Subscription`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| observer | `ArrayObserver<T>` | None |
| init | `boolean` | None |

Observes changes made to the array.




##### `map<R>(f: (value: T, index: number, array: Array<T>) => R, thisArg?: any): ObservableArray<R>`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| f | `(value: T, index: number, array: Array<T>) => R` | None |
| thisArg | `any` | None |

Propagates changes to the items of the given list to items of a new list,
according to a `map` function.



#### `function isObservableArray<T>(array: any): array is ObservableArray<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| array | `any` | None |

Returns whether the given array is an `ObservableArray`.



#### `function observableArray<T>(...array: T[]): ObservableArray<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| array | `T[]` | None |

Returns an observable array.




### `ricochet/async`
Utilities for rendering with promises.

#### `function async<E>(component: Promise<E>): E`
 - `E`: `Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `Promise<E>` | None |

Returns an element that will be replaced by the result of the given
promise when it resolves.



#### `function async<P, E>(component: (props: P) => Promise<E>): Component<P, E>`
 - `P`: `{}`
 - `E`: `Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `(props: P) => Promise<E>` | None |

Wraps a component that asynchronously resolves as a regular component
whose element will be replaced once the promise resolves.



#### `function Async<P, E, K>({ component, props }: P & { component: Component<P & K, E>; props: Promise<K>;}): E`
 - `P`: `{}`
 - `E`: `Element`
 - `K`: `{}`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `{ component, props }` | `P & { component: Component<P & K` | None |
| props | `Promise<K>;}` | None |

Given a component, some of its properties, and a promise that resolves
to the rest of its properties, returns an element that will be replaced
by the resolved element when the promise finishes.



#### `function Async<P, E>({ component, ...props }: P & { component: Promise<Component<P, E>>;}): E`
 - `P`: `{}`
 - `E`: `Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `{ component, ...props }` | `P & { component: Promise<Component<P` | None |

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



##### `setUnderlyingValue(newValue: T): void`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| newValue | `T` | None |

Sets the underlying value without notifying observers.



##### `map<R>(map: (input: T) => R): Observable<R>`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| map | `(input: T) => R` | None |

Returns a new `Observable` that gets updated when this subject changes.



##### `map<R>(map: (input: T) => R, unmap: (input: R) => T): ExtendedSubject<R>`
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| map | `(input: T) => R` | None |
| unmap | `(input: R) => T` | None |

Returns a new `Subject` value that propagates changes to values both ways.



#### `function isSubject<T>(value: any): value is ExtendedSubject<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| value | `any` | None |

Returns whether the given value is a subject created with `subject`.



#### `function subject<T>(initialValue: T): ExtendedSubject<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| initialValue | `T` | None |

Returns a reactive wrapper around the given value.



#### `function constant<T>(value: T): Subscribable<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| value | `T` | None |

Returns an observable value that emits a single value,
and then immediately completes.



This function should be used when an observable stream
is expected somewhere, but a single constant value can be provided.



#### `function compute<T>(computation: ($: <U>(observable: Observable<U>, defaultValue?: U) => U) => T): Subscribable<T>`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| computation | `($: <U>(observable: Observable<U>, defaultValue?: U) => U) => T` | None |

Returns an observable that will be updated when any of the given observables
changes.



@see
 https://github.com/adamhaile/S for the inspiration for this function.



#### `function combine<O>(...observables: O): Subscribable<{ [K in keyof O]: O[K] extends Observable<infer T> ? T : never`
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

#### `function makeCustomElement<P, E>(component: Component<P, E>, translateProperties: object & { [K in keyof P]: (value?: string) => P[K];}): typeof HTMLElement`
 - `P`: `object`
 - `E`: `JSX.Element`

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| component | `Component<P` | None |
| translateProperties | `object & { [K in keyof P]: (value?: string) => P[K];}` | None |

Creates a custom element (or web component) out of a JSX component.



