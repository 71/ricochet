# Ricochet

A small React-like web framework meant to be simple, light and fast.

## Syntax

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
const div = createElement(null, 'div', { ... props }, { })

const before = createDynamic(div, before, { })

const a = createElement(div, 'a', { href: '' }, {
	href: ['constant']
})

const lit = createText(a, 'Hello ')
const name = createDynamic(a, computed([name, firstName], () => name || firstName), { })
```

#### Components
```jsx
// Input:
<div>
	<Link to='' { ... props }>Bar</Link>
</div>

// Output:
const div = createElement(null, 'div')

const linkChildren = []
const link = createComponent(div, Link, { to: '', children: linkChildren, ...props })

const bar = createText(linkChildren, 'Bar')
```


## API

All the following functions accept a `parent`. If it is provided, they will automatically
be added to it.

If the
```ts
/**
 * A parent node.
 */
type Parent = Node[] | Node

/**
 * A virtual node.
 */
type VNode = Node | VNode[] | Reactive<VNode>

/**
 * An extended node.
 */
type ENode = Node & { destroy(): void }

/**
 * A component.
 */
type Component<T> = (props: T) => Node


/**
 * Creates a new intrinsic element, assigning it the given attributes.
 *
 * If the value of an attribute changes, its change will be reflected on the DOM.
 */
function createElement(parent: Parent, tag: string, attrs: object): ENode

/**
 * Instantiates a new component, passing it the given attributes.
 */
function createComponent(parent: Parent, component: Component, props: object): ENode

/**
 * Creates a new constant text node.
 */
function createText(parent: Parent, text: string): ENode

/**
 * Creates a new dynamic node, whose content may change at any moment.
 *
 * When the given value changes, it will be re-rendered.
 *
 * A tree is used to ensure changes to 
 */
function createDynamic(parent, Parent, value: VNode): ENode
```

Most important thing is being able to render a `VNode` to an `ENode`.

Best thing would be able to take any sort of data, and to map it to a `VNode`, and then to an `ENode`.

A list of children has several nested lists of nodes, but only a linear number of nodes (we flatten everything).

```jsx
<div>
	<Thing val={value} { ... props }>Hello {name || firstName}</Thing>
</div>

[ HTMLDivElement ]
  ^
  [ ThingElement(val=value, ...props) ]
	^
	[ Text('Hello '),
	  Reactive([name, firstName], () => NestedNode) ]

<div>
	Hello
	{ children.length > 0 && children }
	<br />
</div>

[ HTMLDivElement ]
  ^
  [ Text('Hello'),
    Reactive([name, firstName], () => NestedNode),
    HTMLBrElement ]                         ^
										    [ Text('<result of expression>') ]

function render(parent: Element, data: VNode): void {
	// Handle
}
```
