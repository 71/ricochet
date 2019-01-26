import babel, { types as t, PluginObj, Visitor } from '@babel/core'
import { parseExpression } from '@babel/parser'
import * as tpl            from '@babel/template'
import { NodePath, Scope } from '@babel/traverse'

import * as runtime from './runtime/index'


/**
 * Initialize the plugin.
 */
export default ({ types: t, template: tpl }: typeof babel) => {
  /**
   * State of the entire plugin.
   */
  class PluginState {
    opts: {
      pragma: string

      runtime: boolean
      runtimeImport: string
    }

    /**
     * The prefix used when importing members from the runtime, such as `createElement`
     * and `watch`.
     *
     * When the runtime is disabled, this member is `document`.
     */
    runtimeMemberPrefix: t.Expression | null

    /**
     * The prefix used when importing members from the runtime extras, such as
     * `map`.
     *
     * When the runtime is disabled, this member is `null`.
     */
    extrasMemberPrefix: t.Expression | null

     /**
     * A cache of templates used with @babel/template.
     */
    readonly templateCache: Record<string, [string[], (r: tpl.PublicReplacements) => any]> = {}

    constructor(opts: object) {
      this.opts = {
        pragma    : 'React.createElement',

        runtime: true,
        runtimeImport: 'require("ricochet/runtime")',
        ... opts
      }

      this.isPragma = this.opts.pragma.match(/[^0-9a-z]/i)
        ? path => path.matchesPattern(this.opts.pragma)
        : path => path.node.type == 'Identifier' && path.node.name == this.opts.pragma

      if (!this.opts.runtimeImport)
        this.runtimeMemberPrefix = null
      else
        this.runtimeMemberPrefix = parseExpression(this.opts.runtimeImport)
    }

    /**
     * Returns whether the given node matches the pragma specified by the user.
     */
    isPragma: (path: NodePath) => boolean
  }

  /**
   * Defines a dependency to an unknown external value.
   */
  class Dependency {
    private id: t.Identifier
    private anyPath: NodePath

    constructor(
      /**
       * The object to which the dependency belongs.
       */
      public readonly object: t.Identifier,

      /**
       * A list of the assignments to the dependency.
       */
      public readonly assignments: NodePath<t.AssignmentExpression>[],

      /**
       * A list of the usages of the dependency.
       */
      public readonly usages: NodePath<t.Expression>[],

      /**
       * A list of the usages of the dependency where we expect an observable.
       */
      public readonly observableUsages: NodePath<t.Expression>[]
    ) {
      this.anyPath = usages.length      > 0 ? usages[0]
                   : assignments.length > 0 ? assignments[0]
                   :                          observableUsages[0]
    }

    /**
     * Returns a unique identifier that can be used to refer to this expression.
     */
    get identifier() {
      return this.id || (this.id = this.anyPath.scope.generateUidIdentifierBasedOnNode(this.usages[0].node, 'dep'))
    }

    /**
     * Returns the expression used to refer to this dependency.
     */
    get stateExpression() {
      return t.memberExpression(this.object, this.identifier)
    }

    /**
     * Returns the expression used to refer to the Observable that refers to this dependency.
     */
    get subscribableExpression() {
      return t.memberExpression(t.memberExpression(this.object, t.identifier('_')), this.identifier)
    }

    /**
     * Returns whether the expression of the dependency and the given expression
     * match.
     */
    matches(expr: t.Expression): boolean {
      function matchRecursively(a: t.Node, b: t.Node) {
        if (a == null)
          return b == null
        if (b == null)
          return false

        if (a.type != b.type)
          return false

        // @ts-ignore
        const fields: Record<string, any> = t.NODE_FIELDS[a.type]
        // @ts-ignore
        const visitorKeys: string[] = t.VISITOR_KEYS[a.type]

        for (const field in fields) {
          if (visitorKeys.includes(field) || ['optional', 'typeAnnotation', 'decorators'].includes(field))
            continue

          if (a[field] != b[field])
            return false
        }

        for (let i = 0; i < visitorKeys.length; i++) {
          const field = visitorKeys[i]

          if (!matchRecursively(a[field], b[field]))
            return false
        }

        return true
      }

      return matchRecursively(this.usages[0].node, expr)
    }
  }

  class ExternalDependency {
    constructor(
      public id: t.Identifier,
      public scope: Scope,
      public createVar: boolean = true,
    ) {}

    inherit() {
      return new ExternalDependency(this.id, this.scope, false)
    }
  }


  /**
   * State of the plugin for a single element.
   */
  class State {
    /**
     * A mapping from a `string` that represents the name of a external variable
     * refered to within the call expression, and an identifier that represents
     * the name of the reactive replacement of the variable.
     */
    private readonly externalDependencies: Record<string, ExternalDependency>

    /**
     * A list of all the dependencies referenced within the element being analyzed.
     */
    private readonly dependencies: Dependency[]

    /**
     * The identifier of the variable in which the local state is stored.
     */
    private stateObjectVar: t.Identifier

    /**
     * Root call expression that is being processed.
     */
    private rootPath: NodePath<t.CallExpression>

    constructor(public plugin: PluginState, parent?: State) {
      this.externalDependencies = {}
      this.dependencies = []

      if (!parent)
        return

      for (const dep in parent.externalDependencies)
        this.externalDependencies[dep] = parent.externalDependencies[dep].inherit()
    }

    /**
     * Create a child state that inherits some attributes from the current state.
     */
    createChildState() {
      return new State(this.plugin, this)
    }

    /**
     * Gets the dependency that corresponds to the given expression, or creates
     * it if it does not exist.
     */
    private getDependency(path: NodePath<t.Expression>) {
      const expr = path.isAssignmentExpression() ? path.node.left as t.Expression : path.node

      for (let i = 0; i < this.dependencies.length; i++) {
        const dep = this.dependencies[i]

        if (!dep.matches(expr))
          continue

        // Yay, we have a match
        if (path.isAssignmentExpression()) {
          dep.assignments.push(path)
          dep.usages.push(path.get('left') as any)
        } else {
          dep.usages.push(path)
        }

        return dep
      }

      // Nay, we must create the match
      const dep = path.isAssignmentExpression()
        ? new Dependency(this.stateObjectVar, [ path ], [ path.get('left') as any ], [])
        : new Dependency(this.stateObjectVar, [], [ path ], [])

      this.dependencies.push(dep)

      return dep
    }


    /**
     * Same as `NodePath.traverse`, but also traverses the root node.
     */
    private static traverseIncludingRoot<S = {}>(path: NodePath, visitor: Visitor<S>, state?: S) {
      // This doesn't handle every case, but in my case that's enough
      let visitEnter = visitor[path.type]
      let visitExit = null

      if (typeof visitEnter != 'undefined') {
        if (typeof visitEnter == 'object') {
          visitExit = visitEnter.exit
          visitEnter = visitEnter.enter
        }

        if (visitEnter != null)
          visitEnter(path, state)
        if (path.shouldSkip)
          return
      }

      path.traverse(visitor, state)

      if (path.shouldSkip)
        return

      if (visitExit != null)
        visitExit(path, state)
    }

    /**
     * Compiles the given template to an AST node.
     */
    template<T extends keyof typeof tpl>(
      type        : T,
      template    : string,
      replacements: tpl.PublicReplacements
    ): typeof tpl[T] extends (...args: any) => infer R ? R : never {
      let [allowedSubstitutions, compiledTemplate] = this.plugin.templateCache[template] || [null, null]

      if (compiledTemplate == null) {
        compiledTemplate = tpl[type](template, { placeholderPattern: /^\$\w+$/ }) as any

        allowedSubstitutions = []

        let match: RegExpExecArray
        let regex = /\$(\w+)/g

        while (match = regex.exec(template))
          allowedSubstitutions.push(match[1])

        this.plugin.templateCache[template] = [allowedSubstitutions, compiledTemplate]
      }

      for (const prop in replacements) {
        if (allowedSubstitutions.indexOf(prop) != -1)
          replacements['$' + prop] = replacements[prop]

        delete replacements[prop]
      }

      for (const runtimeMethod of ['destroy', 'isObservable', 'map', 'observable']) {
        if (allowedSubstitutions.indexOf(runtimeMethod) != -1)
          replacements['$' + runtimeMethod] = this.makeRuntimeMemberExpression(runtimeMethod as keyof typeof runtime)
      }

      return compiledTemplate(replacements)
    }


    /**
     * Create a member expression that represents a call to the specified method
     * of the runtime.
     */
    private makeRuntimeMemberExpression(method: keyof typeof runtime, args?: t.Expression[]) {
      const expr = this.plugin.runtimeMemberPrefix == null
        ? t.identifier(method)
        : t.memberExpression(this.plugin.runtimeMemberPrefix, t.identifier(method))

      return args == undefined
        ? expr
        : t.callExpression(expr, args)
    }


    /**
     * Finds and tracks all reactive variables referenced within the given node.
     *
     * @param all Whether all expressions should be checked, even though they
     *   may not require an attribute update.
     */
    private findDependencies(path: NodePath, all: boolean): Dependency[] {
      let dependencies: Dependency[] = []
      let depth = 0

      const ignoreIdentifier = (path: NodePath<t.Identifier>) => {
        const binding = path.scope.getBinding(path.node.name)

        if (binding && binding.kind != 'module' && binding.kind != 'const') {
          // That value was found in the scope, so we have to watch it
          // HOWEVER, it might be a parameter inside another function
          // in the expression...
          // Watch out for that
          if (binding.kind as string == 'param') {
            let scopePath = binding.scope.path

            while (scopePath) {
              if (scopePath == this.rootPath)
                // Defined in the expression, so we don't care
                return true

              scopePath = scopePath.parentPath
            }
          }

          return false
        }

        return true
      }

      const dependencyFinder = <Visitor>{
        CallExpression: (path) => {
          if (this.plugin.isPragma(path.get('callee')))
            path.skip()
        },

        AssignmentExpression: {
          exit: (path) => {
            if (depth == 0)
              dependencies.push(this.getDependency(path))
            else
              this.getDependency(path)
          }
        },

        MemberExpression: {
          exit: (path) => {
            // This will add the dependency automatically, no big deal
            if (path.getData('process') !== false) {
              if (depth == 0)
                dependencies.push(this.getDependency(path))
              else
                this.getDependency(path)
            }
          }
        },

        Identifier: (path) => {
          // Ditto.
          let skip = ignoreIdentifier(path)

          if (skip) {
            let parent = path.parentPath

            while (parent != null && !parent.isAssignmentExpression() && parent.isExpression()) {
              parent.setData('process', false)
              parent = parent.parentPath
            }

            return
          }

          // @ts-ignore
          if (path.isExpression() || (path.parent.type == 'MemberExpression' && path.key == 'object')) {
            if (depth == 0)
              dependencies.push(this.getDependency(path))
            else
              this.getDependency(path)
          }
        }
      }

      if (!all) {
        // assuming { onclick: () => counter.value++ },
        // we have a dependency to the reactive value 'counter', BUT
        // we shouldn't update 'onclick' everytime 'counter' changes
        // anyway, so we don't visit function bodies
        //
        // if 'all' is true though, we want ALL dependencies, even those
        // that do not trigger a value update, so we don't skip these bodies

        const ignore = {
          enter: () => { depth++ },
          exit: () => { depth-- }
        }

        dependencyFinder.ArrowFunctionExpression = ignore
        dependencyFinder.FunctionExpression = ignore
      }

      State.traverseIncludingRoot(path, dependencyFinder)

      return dependencies
    }

    // /**
    //  * Finds all references to external values (such as parameters or variables),
    //  * and creates reactive versions of them, adding them to `externalDependencies`.
    //  */
    // private findExternalDependencies(path: NodePath, all: boolean) {
    //   const dependencyFinder = <Visitor>{
    //     Identifier: (path) => {
    //       // @ts-ignore
    //       if (!path.isExpression() && !(path.parent.type == 'AssignmentExpression' && path.key == 'left'))
    //         // Neither an expression nor the target of an assignment: we skip it
    //         return

    //       const id = path.node.name
    //       const existingDep = this.externalDependencies[id]

    //       const binding = path.scope.getBinding(id)

    //       if (existingDep && existingDep.scope == binding.scope)
    //         return

    //       if (binding && binding.kind != 'module' && binding.kind != 'const') {
    //         // That value was found in the scope, so we have to watch it
    //         // HOWEVER, it might be a parameter inside another function
    //         // in the expression...
    //         // Watch out for that
    //         if (binding.kind as string == 'param') {
    //           let scopePath = binding.scope.path

    //           while (scopePath) {
    //             if (scopePath == this.rootPath)
    //               // Defined in the expression, so we don't care
    //               return

    //             scopePath = scopePath.parentPath
    //           }
    //         }

    //         this.externalDependencies[id] = new ExternalDependency(path.scope.generateUidIdentifier(id), binding.scope)
    //       }
    //     }
    //   }

    //   if (!all) {
    //     dependencyFinder.ArrowFunctionExpression = (path) => path.skip()
    //     dependencyFinder.FunctionExpression = (path) => path.skip()
    //   }

    //   State.traverseIncludingRoot(path, dependencyFinder)
    // }

    // /**
    //  * Replaces accesses to a reactive value by accesses to their underlying value.
    //  *
    //  * @param takeValue Replace accesses by `observable.value` instead of `observable`.
    //  * @param all Replace accesses, even in inner functions.
    //  */
    // private replaceReactiveAccesses(path: NodePath, takeValue: boolean, all: boolean) {
    //   const replacer = <Visitor<{ takeValue: boolean[] }>>{
    //     Identifier: (path, state) => {
    //       // @ts-ignore
    //       if (!path.isExpression() && !(path.parent.type == 'AssignmentExpression' && path.key == 'left'))
    //         // Neither an expression nor the target of an assignment: we skip it
    //         return

    //       const rep = this.externalDependencies[path.node.name]

    //       if (rep == null)
    //         return

    //       const takeValue = state.takeValue[state.takeValue.length - 1]
    //                      && !this.isObservableCall(path.parentPath.node)

    //       path.replaceWith(takeValue ? t.memberExpression(rep.id, t.identifier('value')) : rep.id)
    //     }
    //   }

    //   if (all) {
    //     replacer.ArrowFunctionExpression = replacer.FunctionExpression = {
    //       enter: (_: any, state) => { state.takeValue.push(true) },
    //       exit : (_: any, state) => { state.takeValue.pop() }
    //     }
    //   } else {
    //     replacer.ArrowFunctionExpression = (path) => path.skip()
    //     replacer.FunctionExpression = (path) => path.skip()
    //   }

    //   State.traverseIncludingRoot(path, replacer, { takeValue: [takeValue] })
    // }

    /**
     * Given the list of all the dependencies of an expression and the expression
     * of its computation, returns an observable stream that gets updated everytime
     * one of its dependencies changes.
     */
    private makeComputedValueFromDependencies(dependencies: Dependency[], value: t.Expression) {
      const isIdentity = dependencies.length == 1 && dependencies[0].matches(value)

      if (isIdentity)
        //  computed([ foo ], () => foo.value)
        // becomes
        //  foo
        return value

      return t.callExpression(
        //  runtime.combine([ ...dependencies ], () => value)
        this.makeRuntimeMemberExpression('combine'),
        [ t.arrayExpression(dependencies.map(x => x.subscribableExpression)),
          t.arrowFunctionExpression([], value) ])
    }

    /**
     * Analyzes and processes attributes given to elements or components.
     *
     * This analysis allows us to set an attribute to be automatically updated
     * when a value it depends on changes.
     *
     * For instance,
     *
     * ```javascript
     * const attributes = {
     *   type    : 'checkbox',
     *   checked : checked,
     *   onchange: e => checked = e.target.checked,
     *   class   : checked ? 'active' : 'nonactive'
     * }
     * ```
     *
     * will become
     *
     * ```javascript
     * const observables = {
     *   checked: new Observable(checked)
     * }
     *
     * const _ = {
     *   _: observables
     * }
     *
     * Object.defineProperty(_, 'checked', {
     *   get: ( ) => observables.checked.value,
     *   set: (v) => {
     *     if (isObservable(v))
     *       observables.checked = v
     *     else
     *       observables.checked.value = v
     *   }
     * })
     *
     * const attributes = {
     *   type    : 'checkbox',
     *   checked : _.checked,
     *   onchange: e => _.checked = e.target.checked,
     *   class   : runtime.combine([_._.checked], () => _.checked ? 'active' : 'nonactive')
     * }
     * ```
     */
    private processAttributes(path: NodePath<t.ObjectExpression>) {
      const visitor = <Visitor>{
        CallExpression: (path) => {
          if (this.plugin.isPragma(path.get('callee')))
            path.skip()
        },

        ObjectProperty: (path) => {
          if (!t.isIdentifier(path.node.key))
            return path.skip()

          let key = path.node.key.name

          if (key == 'ref')
            return path.remove()
          if (key == 'class')
            (path.get('key') as NodePath<t.Identifier>).replaceWith(t.identifier('className'))

          const dependencies = this.findDependencies(path.get('value'), false)

          if (dependencies.length == 0) {
            // No reactive dependency, we can leave the attribute as-is
            // this.replaceReactiveAccesses(path, false, true)

            return path.skip()
          }

          // Replace value by computed property
          // this.replaceReactiveAccesses(path.get('value'), true, true)

          path.get('value').replaceWith(
            this.makeComputedValueFromDependencies(dependencies, path.node.value as t.Expression))

          path.skip()
        }
      }

      path.traverse(visitor)
    }

    /**
     * Visits a JSX expression, transforming it into a valid Ricochet expression.
     */
    private visitElement(path: NodePath<t.Expression>, subscriptionsVar: t.Identifier): t.Expression {
      const node = path.node

      if (node.type == 'StringLiteral') {
        // String literal: simply push as child
        return node
      }

      else if (node.type == 'CallExpression' && this.plugin.isPragma(path.get('callee') as NodePath<t.Node>)) {
        // Element: find reactive dependencies, set up subscriptions, and let the runtime handle it

        const args = path.get('arguments') as NodePath<t.Expression>[]
        const name = args[0].node
        const attrs = args[1]

        let ref: t.Identifier = null


        // Process attributes
        if (attrs.isObjectExpression()) {
          const refProps = attrs.node.properties.filter(x => x.type == 'ObjectProperty'
                                                          && t.isIdentifier(x.key, { name: 'ref' })
                                                          && t.isIdentifier(x.value))

          if (refProps.length > 0)
            ref = (refProps[0] as t.ObjectProperty).value as t.Identifier

          this.processAttributes(attrs)
        }


        // Process children recursively
        const children: t.Expression[] = []

        for (let i = 2; i < args.length; i++)
          children.push(this.visitElement(args[i], subscriptionsVar))

        const childrenExpr = children.length == 0 ? t.nullLiteral() : t.arrayExpression(children)


        // Transform
        //  h('div', { ...attrs }, ...children)
        // into
        //  rie('div', { ...attrs }, [ ...children ])
        // and
        //  h(Foo, { ...attrs }, ...children)
        // into
        //  rc(Foo, { ...attrs }, [ ...children ])
        let element: t.Expression =
          t.callExpression(
            this.makeRuntimeMemberExpression(name.type == 'StringLiteral' ? 'rie' : 'rc'),
            [ name, attrs.node, childrenExpr, subscriptionsVar ])

        if (ref != null)
          element = t.assignmentExpression('=', ref, element)

        return element
      }

      else if (path.isExpression()) {
        // Normal expression: just add to siblings

        // Find dependencies to reactive properties
        const dependencies = this.findDependencies(path, false)

        if (dependencies.length == 0)
          // There are no dependencies, so we return the value directly
          return path.node

        // Note: it is important to replace accesses AFTER finding
        // dependencies, since we would otherwise find no access
        // to external values
        // this.replaceReactiveAccesses(path, true, false)

        // There are reactive dependencies, so we transform
        //  firstName + lastName
        // into
        //  runtime.combine([firstName, lastName], () => firstName + lastName)
        return this.makeComputedValueFromDependencies(dependencies, path.node)
      }
    }


    /**
     * Visits the given call expression.
     */
    visit(path: NodePath<t.CallExpression>) {
      const stateVar = path.scope.generateDeclaredUidIdentifier('state')
      const subscriptionsVar = path.scope.generateDeclaredUidIdentifier('subscriptions')

      this.stateObjectVar = stateVar
      this.rootPath = path

      // We don't use a Babel Visitor here because we only want to visit
      // the top node in 'path'
      const element = this.visitElement(path, subscriptionsVar)
      const topLevelElement = this.makeRuntimeMemberExpression('rtl', [ element, subscriptionsVar ])

      const watchedObject =
        t.objectExpression(
          this.dependencies
              .map(x =>
                t.objectProperty(
                  x.identifier,
                  x.assignments.length > 0
                    ? this.makeRuntimeMemberExpression('observable', [ x.usages[0].node ])
                    : x.usages[0].node)))

      for (const dep of this.dependencies) {
        if (dep.usages.length <= dep.assignments.length)
          continue

        const member = dep.stateExpression

        for (const usage of dep.usages) {
          if (usage.parent.type == 'AssignmentExpression' && usage.key == 'left')
            continue

          usage.replaceWith(member)
        }

        for (const assignment of dep.assignments)
          assignment.replaceWith(
            t.assignmentExpression('=', member, assignment.node))

        if (dep.observableUsages.length > 0) {
          const observableMember = dep.subscribableExpression

          for (const usage of dep.observableUsages)
            usage.replaceWith(observableMember)
        }
      }

      path.replaceWith(
        [ t.assignmentExpression('=',
            stateVar,
            this.makeRuntimeMemberExpression('watchProperties', [ watchedObject ]))
        , t.assignmentExpression('=',
            subscriptionsVar,
            t.arrayExpression([]))
        ].reduce((fn, assignement) =>
          t.logicalExpression('&&', assignement, fn), topLevelElement as t.Expression))
    }
  }


  // Key used to store states when visiting sub-expressions
  const dataKey = 'ricochet'

  return <PluginObj>{
    name: 'ricochet',

    inherits: require('@babel/plugin-transform-react-jsx').default,

    visitor: {
      Program(_, state) {
        this['state'] = new PluginState((state as any).opts)
      },

      CallExpression(path) {
        if (path.findParent(x => x.type == 'JSXElement'))
          return

        const pluginState = this['state'] as PluginState

        if (!pluginState.isPragma(path.get('callee')) || path.parent.type == 'JSXElement')
          return

        const parentWithState = path.find(x => x.scope.getData(dataKey) != null)
        const parentState = parentWithState != null ? parentWithState.scope.getData(dataKey) as State : null

        const state = new State(pluginState, parentState)

        path.scope.setData(dataKey, state)

        state.visit(path)
      }
    }
  }
}
