import babel, { types as t, PluginObj, Visitor } from '@babel/core'
import { parseExpression } from '@babel/parser'
import * as tpl            from '@babel/template'
import { NodePath, Scope } from '@babel/traverse'

import * as runtime from './runtime/index'

/** Whether assertions should be checked. */
const ASSERTIONS = process.env.NODE_ENV != 'production'


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
        runtimeImport: 'require("babel-plugin-transform-raw-jsx/runtime")',
        ... opts
      }

      this.isPragma = this.opts.pragma.match(/[^0-9a-z]/i)
        ? path => path.matchesPattern(this.opts.pragma)
        : path => path.node.type == 'Identifier' && path.node.name == this.opts.pragma

      if (!this.opts.runtime)
        this.runtimeMemberPrefix = t.identifier('document')
      else if (!this.opts.runtimeImport)
        this.runtimeMemberPrefix = null
      else
        this.runtimeMemberPrefix = parseExpression(this.opts.runtimeImport)
    }

    /**
     * Returns whether the given node matches the pragma specified by the user.
     */
    isPragma: (path: NodePath) => boolean
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
     * Statements that are to be inserted prior to the call to `h`
     * in order to setup the state.
     */
    private readonly stmts: t.Statement[]

    /**
     * Names that have been given to slots. Used to ensure there aren't
     * duplicate names.
     */
    private readonly givenSlotNames: string[]

    /**
     * `subscriptions` variable.
     */
    private subscriptionsVar: t.Identifier

    /**
     * Root call expression that is being processed.
     */
    private rootPath: NodePath<t.CallExpression>

    /**
     * The variable name of the root element.
     */
    private rootVarName: t.Identifier

    /**
     * Name of the `addElements` function, if it was defined.
     */
    private addFunction: t.Identifier

    constructor(public plugin: PluginState, parent?: State) {
      this.stmts = []
      this.givenSlotNames = []
      this.externalDependencies = {}

      if (parent) {
        for (const dep in parent.externalDependencies)
          this.externalDependencies[dep] = parent.externalDependencies[dep].inherit()

        this.addFunction = parent.addFunction
      }
    }

    /**
     * Create a child state that inherits some attributes from the current state.
     */
    createChildState() {
      return new State(this.plugin, this)
    }

    /**
     * Returns whether the generated code will have access to the reactive runtime.
     */
    private get hasRuntime() {
      return this.plugin.opts.runtime
    }


    /**
     * Returns whether the given expression represents a call to `runtime.observable`.
     */
    private isObservableCall(callExpression: t.Node) {
      if (callExpression.type != 'CallExpression')
        return false

      const callee = callExpression.callee

      return (callee.type == 'Identifier' && callee.name == 'observable')
          || (callee.type == 'MemberExpression' && t.isIdentifier(callee.property, { name: 'observable' }))
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

      for (const runtimeMethod of ['addElement', 'destroy', 'isObservable', 'map', 'observable']) {
        if (allowedSubstitutions.indexOf(runtimeMethod) != -1)
          replacements['$' + runtimeMethod] = this.makeRuntimeMemberExpression(runtimeMethod as keyof typeof runtime)
      }

      return compiledTemplate(replacements)
    }


    /**
     * Create a member expression that represents a call to the specified method
     * of the runtime.
     */
    private makeRuntimeMemberExpression(method: keyof typeof runtime) {
      if (ASSERTIONS && !this.plugin.opts.runtime && method != 'createElement')
        throw new Error('Cannot make runtime call to method in a no-runtime context.')

      if (this.plugin.runtimeMemberPrefix == null)
        return t.identifier(method)
      else
        return t.memberExpression(this.plugin.runtimeMemberPrefix, t.identifier(method))
    }

    /**
     * Returns a conditional expression that succeeds if the given expression
     * represents an observable value.
     */
    private makeObservableConditionalExpression(expr: t.Identifier, ifObservable: t.Expression, notObservable?: t.Expression) {
      return t.conditionalExpression(
        t.logicalExpression(
          '&&',
          expr,
          t.binaryExpression('===',
            t.unaryExpression('typeof', t.memberExpression(expr, t.identifier('subscribe'))),
            t.stringLiteral('function')
          )
        ),
        ifObservable,
        notObservable
      )
    }

    /**
     * Returns an expression whose value is certain to be observable.
     */
    private makeObservableExpression(expr?: t.Identifier) {
      if (expr == null)
        return t.newExpression(this.makeRuntimeMemberExpression('Observable'), [ t.identifier('undefined') ])

      return this.makeObservableConditionalExpression(
        expr,
        expr,
        t.newExpression(this.makeRuntimeMemberExpression('Observable'), [ expr ])
      )
    }


    /**
     * Returns the identifier of the `addElement` function. If `addElement` hasn't been defined yet,
     * it will automatically be inserted at the start of the function.
     */
    private getAddFunction(path: NodePath) {
      if (this.hasRuntime)
        return this.makeRuntimeMemberExpression('addElement')

      if (this.addFunction != null)
        return this.addFunction

      const addFunctionName = this.addFunction = path.scope.generateUidIdentifier('addElement')

      const parentVariableName = path.scope.generateUidIdentifier('parent')
      const itemVariableName   = path.scope.generateUidIdentifier('elt')
      const loopVariableName   = path.scope.generateUidIdentifier('x')

      this.stmts.unshift(
        // const addElement = (parent, elt, inserted, nextDivMarker) => {
        //   if (elt == null)
        //     return
        //   if (Array.isArray(elt)) {
        //     for (const item of elt)
        //       addElement(parent, child, inserted, nextDivMarker)
        //     return
        //   }
        //
        //   parent.append(elt)
        // }
        t.variableDeclaration(
          'const',
          [
            t.variableDeclarator(
              addFunctionName,
              t.arrowFunctionExpression(
                [ parentVariableName, itemVariableName ],
                t.blockStatement([
                  t.ifStatement(
                    t.binaryExpression('==', itemVariableName, t.nullLiteral()),
                    t.returnStatement()
                  ),
                  t.ifStatement(
                    t.callExpression(
                      t.memberExpression(t.identifier('Array'), t.identifier('isArray')),
                      [
                        itemVariableName
                      ]
                    ),
                    t.blockStatement([
                      t.forOfStatement(
                        t.variableDeclaration('const', [ t.variableDeclarator(loopVariableName) ]),
                        itemVariableName,
                        t.expressionStatement(
                          t.callExpression(
                            addFunctionName,
                            [ parentVariableName, loopVariableName ]
                          )
                        )
                      ),
                      t.returnStatement()
                    ])
                  ),
                  t.expressionStatement(
                    t.callExpression(
                      t.memberExpression(parentVariableName, t.identifier('append')),
                      [
                        itemVariableName
                      ]
                    )
                  )
                ])
              )
            )
          ],
        )
      )

      return addFunctionName
    }


    /**
     * Returns all reactive variables referenced within the given node.
     *
     * @param all Whether all expressions should be checked, even though they
     *   may not require an attribute update.
     */
    private findDependencies(path: NodePath, all: boolean, dependencies: t.Identifier[]) {
      if (!this.hasRuntime)
        return

      const dependencyFinder = <Visitor>{
        Identifier: (path) => {
          if (!path.isExpression())
            return

          const id = path.node.name
          const rep = this.externalDependencies[id]

          if (rep && dependencies.indexOf(rep.id) == -1)
            dependencies.push(rep.id)
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

        dependencyFinder.ArrowFunctionExpression = (path) => path.skip()
        dependencyFinder.FunctionExpression = (path) => path.skip()
      }

      State.traverseIncludingRoot(path, dependencyFinder)

      return dependencies
    }

    /**
     * Finds all references to external values (such as parameters or variables),
     * and creates reactive versions of them, adding them to `externalDependencies`.
     */
    private findExternalDependencies(path: NodePath, all: boolean) {
      const dependencyFinder = <Visitor>{
        Identifier: (path) => {
          // @ts-ignore
          if (!path.isExpression() && !(path.parent.type == 'AssignmentExpression' && path.key == 'left'))
            // Neither an expression nor the target of an assignment: we skip it
            return

          const id = path.node.name
          const existingDep = this.externalDependencies[id]

          const binding = path.scope.getBinding(id)

          if (existingDep && existingDep.scope == binding.scope)
            return

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
                  return

                scopePath = scopePath.parentPath
              }
            }

            this.externalDependencies[id] = new ExternalDependency(path.scope.generateUidIdentifier(id), binding.scope)
          }
        }
      }

      if (!all) {
        dependencyFinder.ArrowFunctionExpression = (path) => path.skip()
        dependencyFinder.FunctionExpression = (path) => path.skip()
      }

      State.traverseIncludingRoot(path, dependencyFinder)
    }

    /**
     * Replaces accesses to a reactive value by accesses to their underlying value.
     *
     * @param takeValue Replace accesses by `observable.value` instead of `observable`.
     * @param all Replace accesses, even in inner functions.
     */
    private replaceReactiveAccesses(path: NodePath, takeValue: boolean, all: boolean) {
      const replacer = <Visitor<{ takeValue: boolean[] }>>{
        Identifier: (path, state) => {
          // @ts-ignore
          if (!path.isExpression() && !(path.parent.type == 'AssignmentExpression' && path.key == 'left'))
            // Neither an expression nor the target of an assignment: we skip it
            return

          const rep = this.externalDependencies[path.node.name]

          if (rep == null)
            return

          const takeValue = state.takeValue[state.takeValue.length - 1]
                         && !this.isObservableCall(path.parentPath.node)

          path.replaceWith(takeValue ? t.memberExpression(rep.id, t.identifier('value')) : rep.id)
        }
      }

      if (all) {
        replacer.ArrowFunctionExpression = replacer.FunctionExpression = {
          enter: (_: any, state) => { state.takeValue.push(true) },
          exit : (_: any, state) => { state.takeValue.pop() }
        }
      } else {
        replacer.ArrowFunctionExpression = (path) => path.skip()
        replacer.FunctionExpression = (path) => path.skip()
      }

      State.traverseIncludingRoot(path, replacer, { takeValue: [takeValue] })
    }


    /**
     * Given the list of all athe dependencies of an expression and the
     * subscription method, returns a function that subscribes
     * to the given dependencies with the given callback.
     */
    private makeSubscribeExpressionFromDependencies(dependencies: t.Identifier[], callback: t.ArrowFunctionExpression | t.Identifier) {
      const object = dependencies.length == 1
        ? dependencies[0]
        : t.callExpression(
            this.makeRuntimeMemberExpression('merge'),
            dependencies
          )

      return t.callExpression(
        t.memberExpression(object, t.identifier('subscribe')),
        [
          callback
        ]
      )
    }

    /**
     * Given the list of all the dependencies of an expression and the expression
     * of its computation, returns an observable stream that gets updated everytime
     * one of its dependencies changes.
     */
    private makeComputedValueFromDependencies(dependencies: t.Identifier[], value: t.Expression) {
      const isIdentity = dependencies.length == 1
                      && t.isMemberExpression(value)
                      && t.isIdentifier(value.property, { name: 'value' })
                      && t.isIdentifier(value.object  , { name: dependencies[0].name })

      if (isIdentity)
        // 'computed([ foo ], () => foo.value)' => 'foo'
        return dependencies[0]

      return t.callExpression(
        this.makeRuntimeMemberExpression('computed'),
        [
          t.arrayExpression(dependencies),
          t.arrowFunctionExpression([], value)
        ]
      )
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
     * const attributes = {
     *   type    : 'checkbox',
     *   checked : checked.value,
     *   onchange: e => checked.value = e.target.checked,
     *   class   : computed([checked], () => checked.value ? 'active' : 'nonactive')
     * }
     *
     * checked.subscribe(newValue => attributes.checked = checked.value)
     * ```
     */
    private processAttributes(path: NodePath<t.ObjectExpression>) {
      const visitor = <Visitor>{
        ObjectProperty: (path) => {
          if (!t.isIdentifier(path.node.key))
            return path.skip()

          let key = path.node.key.name

          if (key == 'ref')
            return path.remove()
          if (key == 'class')
            (path.get('key') as NodePath<t.Identifier>).replaceWith(t.identifier('className'))

          this.findExternalDependencies(path.get('value'), true)

          const dependencies = path.node.value.type == 'Identifier'
            ? (this.externalDependencies[key] ? [this.externalDependencies[key].id] : [])
            : (this.findDependencies(path.get('value'), false, []))

          if (dependencies.length == 0) {
            // No reactive dependency, we can leave the attribute as-is
            this.replaceReactiveAccesses(path, false, true)

            return path.skip()
          }

          // Replace value by computed property
          this.replaceReactiveAccesses(path.get('value'), true, true)

          path.get('value').replaceWith(
            this.makeComputedValueFromDependencies(dependencies, path.node.value as any)
          )

          path.skip()
        }
      }

      path.traverse(visitor)
    }

    /**
     * Recursively visits an expression of the type...
     *
     * ```javascript
     * h('div', { foo: bar }, ...children)
     * ```
     *
     * replacing it by an expression of the type...
     *
     * ```javascript
     * const div = createElement('div', { foo: bar.value })
     *
     * parent.appendChild(div)
     *
     * bar.subscribe(() => div.foo = bar.value)
     * ```
     */
    private visitElement(
      parent    : t.Identifier | null,
      parentKind: 'component' | 'intrinsic' | 'slot',
      path      : NodePath<t.Expression>,
      lastChild : boolean
    ) {
      const node = path.node

      if (node.type == 'StringLiteral') {
        // String literal: simply push as child

        this.stmts.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                parent, t.identifier(parentKind == 'slot' ? 'push'
                                   : parentKind == 'intrinsic' ? 'append'
                                   : 'appendToSlot')),

              parentKind == 'component'
                ? [ t.stringLiteral('default'), t.stringLiteral(node.value) ]
                : [ t.stringLiteral(node.value) ])))
      }

      else if (node.type == 'CallExpression' && this.plugin.isPragma(path.get('callee') as NodePath<t.Node>)) {
        // Call expression to pragma:
        // - create element
        // - append created element to parent
        // - if needed, subscribe to changes and make sure values get updated if needed

        const args = path.get('arguments') as NodePath<t.Expression>[]
        const name = args[0].node
        const attrs = args[1]

        let nodeVarName: string
        let isSlot = false

        if (name.type == 'StringLiteral') {
          nodeVarName = name.value

          if (name.value == 'slot') {
            if (parent == null)
              throw path.buildCodeFrameError('A slot cannot be a the top-level of an element.')

            isSlot = true
          }
        } else {
          nodeVarName = 'tmp'
        }

        let nodeVar = path.scope.generateUidIdentifierBasedOnNode(name, nodeVarName)
        let hasRef = false

        if (this.rootVarName == null) {
          // We're visiting the root element, so we initialize its name
          this.rootVarName = nodeVar
        }

        let slot: t.Expression = t.stringLiteral('default')

        if (attrs.node.type == 'ObjectExpression') {
          const refProps = attrs.node.properties.filter(x => x.type == 'ObjectProperty'
                                                          && t.isIdentifier(x.key, { name: 'ref' })
                                                          && t.isIdentifier(x.value))

          if (refProps.length > 0) {
            nodeVar = (refProps[0] as t.ObjectProperty).value as t.Identifier
            hasRef = true
          }

          const slotProps = attrs.node.properties.filter(x => x.type == 'ObjectProperty'
                                                           && t.isIdentifier(x.key, { name: 'slot' }))

          if (slotProps.length > 0) {
            if (parentKind != 'component')
              throw path.buildCodeFrameError('Slots can only be given for custom components.')

            slot = (slotProps[0] as t.ObjectProperty).value as t.Expression
          }

          if (isSlot) {
            const nameProps = attrs.node.properties.filter(x => x.type == 'ObjectProperty'
                                                             && t.isIdentifier(x.key, { name: 'name' }))
            let maxAttrs = 0

            if (nameProps.length > 0) {
              slot = (nameProps[0] as t.ObjectProperty).value as t.Expression
              maxAttrs = 1
            }

            if (attrs.node.properties.length > maxAttrs)
              throw path.buildCodeFrameError('Slots cannot have properties.')
          }
        }

        if (isSlot) {
          if (t.isStringLiteral(slot)) {
            const slotName = slot.value

            if (this.givenSlotNames.indexOf(slotName) != -1)
              throw path.buildCodeFrameError('Multiple slots cannot have the same name.')

            this.givenSlotNames.push(slotName)
          }

          this.stmts.push(
            // const element = []
            t.variableDeclaration('const', [ t.variableDeclarator(nodeVar, t.arrayExpression([])) ]))
        } else {
          if (this.hasRuntime && attrs.isObjectExpression())
            this.processAttributes(attrs)

          let attrsVar = this.hasRuntime || attrs.isNullLiteral()
            ? null
            : path.scope.generateUidIdentifier(name.type == 'StringLiteral' ? name.value + 'attrs' : 'attrs')

          if (attrsVar != null)
            this.stmts.push(
              // const attrs = { ...props }
              t.variableDeclaration('const', [ t.variableDeclarator(attrsVar, attrs.node) ]))


          // Replace  h('element', { ...props }, [...children])
          // by       const element = createElement('element', { ...props })
          //          element.appendToSlot('default', [...children])
          //          ...
          const element = this.hasRuntime || name.type == 'StringLiteral'
            ? t.callExpression(
                this.makeRuntimeMemberExpression('createElement'),
                this.hasRuntime ? [ name, attrs.node ] : [ name ]
              )
            : t.callExpression(
                name, [ attrsVar ]
              )

          if (hasRef)
            this.stmts.push(t.expressionStatement(
              t.assignmentExpression('=', nodeVar, element)
            ))
          else
            this.stmts.push(t.variableDeclaration('const', [
              t.variableDeclarator(nodeVar, element)
            ]))

          if (attrsVar != null) {
            const loopVar = path.scope.generateUidIdentifier('attr')

            // Add attributes manually
            this.stmts.push(
              t.forInStatement(
                t.variableDeclaration('const', [ t.variableDeclarator(loopVar) ]),
                attrsVar,
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(nodeVar, t.identifier('setAttribute')),
                    [
                      loopVar,
                      t.memberExpression(attrsVar, loopVar, true)
                    ]
                  )
                )
              )
            )
          }

          if (parent != null)
            // parent.append(element)
            //   or
            // parent.appendToSlot(slot, element)
            this.stmts.push(
              t.expressionStatement(
                t.callExpression(
                  t.memberExpression(
                    parent, t.identifier(parentKind == 'slot' ? 'push'
                                       : parentKind == 'intrinsic' ? 'append'
                                       : 'appendToSlot')),

                  parentKind == 'component'
                    ? [ slot, nodeVar ]
                    : [ nodeVar ])))
        }

        const selfKind = isSlot ? 'slot' : name.type == 'StringLiteral' ? 'intrinsic' : 'component'

        for (let i = 2; i < args.length; i++)
          this.visitElement(nodeVar, selfKind, args[i], i == args.length - 1)

        if (isSlot) {
          this.stmts.push(
            // runtime.defineSlot(element, name, default)
            t.expressionStatement(
              t.callExpression(
                this.makeRuntimeMemberExpression('defineSlot'),
                [
                  this.rootVarName,
                  parent,
                  slot,
                  args.length == 2
                    ? t.nullLiteral()
                    : nodeVar
                ])))
        }

        return nodeVar
      }

      else if (path.isFunctionExpression() || path.isArrowFunctionExpression()) {
        // Arrow function: give it the parent and let it do its thing
        this.stmts.push(
          t.expressionStatement(
            t.callExpression(
              path.node,
              [
                parent
              ]
            )
          )
        )
      }

      else if (path.isExpression()) {
        // Normal expression

        // Find dependencies to reactive properties
        const dependencies: t.Identifier[] = []

        if (this.hasRuntime) {
          this.findExternalDependencies(path, false)
          this.findDependencies(path, false, dependencies)

          // Note: it is important to replace accesses AFTER finding
          // dependencies, since we would otherwise find no access
          // to external values
          this.replaceReactiveAccesses(path, true, false)
        }

        if (dependencies.length > 0) {
          // A normal expression may return zero, one or more elements,
          // therefore handling them isn't very simple.
          //
          // What we must therefore do is to keep a list of all the elements
          // that this expression return, and update them when needed.
          const elementsVar = path.scope.generateUidIdentifierBasedOnNode(node)
          const nextMarkerVar = lastChild
            ? t.identifier('undefined')
            : path.scope.generateUidIdentifier('nextMarker')

          // Add a list that stores all inserted elements (for easy removal later on)

          // const inserted = []
          this.stmts.push(t.variableDeclaration('const', [
            t.variableDeclarator(
              elementsVar,
              t.arrayExpression()
            )
          ]))

          // Add marker to know where elements should be inserted

          if (!lastChild)
            this.stmts.push(
              // const nextMarker = runtime.createMarker()
              t.variableDeclaration('const', [
                t.variableDeclarator(
                  nextMarkerVar,
                  t.callExpression(
                    this.makeRuntimeMemberExpression('createMarker'), []
                  )
                )
              ]),

              // parent.append(nextMarker)
              t.expressionStatement(
                t.callExpression(
                  t.memberExpression(parent, t.identifier('append')),
                  [
                    nextMarkerVar
                  ]
                )
              )
            )

          // Merge property stream in order to update things
          const updateFuncVar = path.scope.generateUidIdentifier()

          this.stmts.push(
            t.variableDeclaration(
              'const',
              [
                t.variableDeclarator(
                  updateFuncVar,
                  t.arrowFunctionExpression(
                    [],
                    t.blockStatement([
                      // 1. Remove previously added elements

                      // inserted.splice(0, inserted.length).forEach(runtime.destroy)
                      t.expressionStatement(
                        t.callExpression(
                          t.memberExpression(
                            t.callExpression(
                              t.memberExpression(elementsVar, t.identifier('splice')),
                              [
                                t.numericLiteral(0),
                                t.memberExpression(elementsVar, t.identifier('length'))
                              ]
                            ),
                            t.identifier('forEach')
                          ),
                          [
                            this.makeRuntimeMemberExpression('destroy')
                          ]
                        )
                      ),

                      // 2. Add elements recursively

                      // addElement(parent, <value>, inserted, nextMarker)
                      t.expressionStatement(
                        t.callExpression(
                          this.getAddFunction(path),
                          [ parent, path.node, elementsVar, nextMarkerVar ]
                        )
                      )
                    ])
                  )
                )
              ]
            ),
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(this.subscriptionsVar, t.identifier('push')),
                [
                  this.makeSubscribeExpressionFromDependencies(
                    dependencies,
                    updateFuncVar
                  )
                ]
              )
            ),
            t.expressionStatement(
              t.callExpression(updateFuncVar, [])
            )
          )
        } else {
          // No runtime or no dependency, so we insert elements directly
          this.stmts.push(
            t.blockStatement([
              // addElement(parent, <value>)
              t.expressionStatement(
                t.callExpression(
                  this.getAddFunction(path),
                  [ parent, path.node ]
                )
              )
            ])
          )
        }
      }
    }


    /**
     * Visits the given call expression.
     */
    visit(path: NodePath<t.CallExpression>) {
      const isIntrinsicRoot = t.isStringLiteral(path.node.arguments[0])

      this.rootPath = path
      this.subscriptionsVar = path.scope.generateUidIdentifier('subscriptions')

      this.stmts.push(
        // const subscriptions = []
        t.variableDeclaration('const', [
          t.variableDeclarator(this.subscriptionsVar, t.arrayExpression([]))
        ]),
      )

      // We don't use a visitor here because we only want to visit
      // the top node in 'path'
      const varName = this.visitElement(null, 'component', path, true)


      // Initialize reactive external variables
      const declarators : t.VariableDeclarator[] = []

      for (const dependency in this.externalDependencies) {
        const { id, createVar } = this.externalDependencies[dependency]

        if (createVar)
          declarators.push(t.variableDeclarator(id, this.makeObservableExpression(t.identifier(dependency))))
      }

      if (declarators.length > 0)
        this.stmts.splice(0, 0, t.variableDeclaration('const', declarators))


      // Define custom properties

      if (isIntrinsicRoot) {
        this.stmts.push(
          // if (subscriptions.length > 0)
          //   element.subscriptions = subscriptions
          t.ifStatement(
            t.binaryExpression(
              '>',
              t.memberExpression(this.subscriptionsVar, t.identifier('length')),
              t.numericLiteral(0)
            ),
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(varName, t.identifier('subscriptions')),
                this.subscriptionsVar
              )
            )
          )
        )

        this.stmts.push(
          // element.destroy = runtime.destroy.bind(element)
          // element.setSlot = runtime.setSlot.bind(element)
          ...['destroy', 'appendToSlot'].map((x: 'destroy' | 'appendToSlot') =>
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(varName, t.identifier(x)),
                t.callExpression(
                  t.memberExpression(
                    this.makeRuntimeMemberExpression(x),
                    t.identifier('bind')
                  ),
                  [
                    varName
                  ]
                )
              )
            )
          )
        )
      }


      // Find the first parent where we can insert our data
      let parent: NodePath<t.Node> = path

      for (;;) {
        parent = parent.parentPath

        if (parent == null || parent.isFunction()) {
          // We didn't find a suitable parent, go the hacky way and use
          // an arrow expression with body
          path.replaceWith(t.callExpression(
            t.arrowFunctionExpression(
              [],
              t.blockStatement([
                ...this.stmts,
                t.returnStatement(varName)
              ])
            ),
            []
          ))

          break
        }

        if (parent.isStatement()) {
          // The parent is a statement, so we can insert our statements
          // in its place
          parent.insertBefore(this.stmts)
          path.replaceWith(varName)

          break
        }
      }
    }
  }


  // Key used to store states when visiting sub-expressions
  const dataKey = 'babel-plugin-transform-raw-jsx-state'

  return <PluginObj>{
    name: 'babel-plugin-transform-raw-jsx',

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

        path.skip()
      }
    }
  }
}
