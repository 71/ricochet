# Ricochet

A small React-like web framework meant to be simple, light and fast.

## Changes
- Use basic `React.createElement` / `h` function call.
- Everything is explicit.
- When giving properties, both observable and non-observable values are accepted.
- When receiving properties, everything is a "transparent" observable value; that is,
  the value is `Object.assign(value, { subscribe, ... })`. `valueOf` must be used for primitives.
	(Can be done internally though).

## Syntax

The following examples show the (simplified) output of some input JSX
expressions. Note that some information is left out for the sake of readability.

#### Intrinsic elements
```jsx
// Input:
<div value={value} label='foo' { ... props } />

// Output:
const div = renderIntrinsicElement('div', { value: value, label: 'foo', ... props })
```

#### Child elements
```jsx
// Input:
<div { ... props }>
	{before}
	<a href=''>Hello {name || firstName}</a>
</div>

// Output:
const a = renderIntrinsicElement('a', { href: '' }, [
	'Hello ',
	combine([name, firstName], () => name || firstName)
])

const div = renderIntrinsicElement('div', { ... props }, [ before, a ])
```

#### Components
```jsx
// Input:
<div>
	<Link to='' { ... props }>Bar</Link>
</div>

// Output:
const link = renderComponent(Link, { to: '', ...props }, [ 'Bar' ])
const div = renderIntrinsicElement('div', [ link ])
```


## Reactivity

Ricochet uses the concept of observable (or reactive) values to update
attributes when needed.

For instance, let's consider the following element:

```jsx
<a href='https://github.com' class={({ active })}>GitHub</a>
```

Here, the value of `active` may change at any time, which is why
the class attribute won't receive the value `{ active }`, but instead
`combine([active], () => active)`.

The `combine` function takes a list of values, as well as an expression,
and returns an observable value that changes anytime one of the given
values change. If none of the given values is an observable itself, then
the value is simply returned, without creating an additional observable wrapper.

Internally, `active` is called a `dependency` of the `<a />` component.


### Dependency resolution

Since Ricochet does not lookup information in its environment,
it assumes that **any** expression may change at any time,
triggering an update.

However, this means that every single expression we encounter needs
to be watched, which is not very convenient.

Therefore, the following algorithm is used:
- If an expression is encountered somewhere (for instance, `foo.bar`),
  it is replaced by an watched access (here, `_.foo_bar`). The `_` object
	keeps track of all variables in scope, and allows one to subscribe to changes
	to them.
- If an expression appears on the left-hand side of an assignment (`foo.baz = 42`), it
	is both replaced by a watched assignment (`_.foo_baz = 42`), and the expression
	is automatically transformed into an observable value.

In practice, this means that if any expression is encountered, it will not be considered
reactive, and will be saved normally. If, however, it is assigned to at some point,
it will be considered reactive, and will be wrapped in an observable wrapper.

This is far from ideal, but other solutions would be:
- Be explicit, and require compile-time annotations (such as `_.observe(foo, bar.baz)`, `_.exclude(meow)`).
- Do not watch values, in which case updates would no longer be automatic.
- Use a different syntax for values that might change and values that may not. This
  would be fine if not for the fact that requiring that all expressions typecheck
	correctly in TypeScript means that a lot of "dynamic" stuff can't happen.
