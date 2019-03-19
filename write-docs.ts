import { createWriteStream, readFileSync, writeFileSync } from 'fs'
import * as tsdoc from '@microsoft/tsdoc'


const paramRegex = /(\w+|\{[\w, .]+\})\??: (\(.+?\) => .+?|[^{}<>]+?|.+?>|.+?})(,|\):)/g

// Remove previous API from README
writeFileSync('README.md', readFileSync('README.md', 'utf8').replace(/\s+# API[\s\S]+$/, ''))

// Append the API to the freshly modified README
const stream = createWriteStream('README.md', { flags: 'a+' })

stream.write('\n\n\n# API\n')

const files = {
  'index.d.ts': {
    path: 'ricochet',
    header: 'The core Ricochet API, used to render JSX nodes.',
  },
  'array.d.ts': {
    path: 'ricochet/array',
    header: 'Utilities for rendering lists efficiently with the `ObservableArray` type.',
  },
  'async.d.ts': {
    path: 'ricochet/async',
    header: 'Utilities for rendering with promises.',
  },
  'reactive.d.ts': {
    path: 'ricochet/reactive',
    header: 'Utilities for creating and combining observable streams and subjects.',
  },
  'interop/rxjs.d.ts': {
    path: 'ricochet/interop/rxjs',
    header: 'Interop helpers for [RxJS](https://github.com/ReactiveX/rxjs).',
  },
  'interop/wc.d.ts': {
    path: 'ricochet/interop/wc',
    header: 'Utilities for defining Web Components.',
  },
}

const parser = new tsdoc.TSDocParser()

for (const file in files) {
  const { path, header } = files[file]
  const content = readFileSync(file, 'utf8')

  stream.write('\n')
  stream.write('### `' + path + '`\n')
  stream.write(header + '\n\n')

  let docRegex = /(\/\*\*[\s\S]+?\n\s+\*\/)\s*(render[\s\S]+?void;|export declare type[^{}]+?{[^{}]+?};$|export interface[\s\S]+?{$|export declare function[\s\S]+?\): .+;$|(?:\w[\s\S]+?);$)/gm
  let result = null as RegExpExecArray

  while (result = docRegex.exec(content)) {
    let [_, doc, decl] = result

    if (decl.includes('unique symbol'))
      continue
    if (decl.startsWith('declare type'))
      continue

    decl = decl
            .replace(/;$/, '')
            .replace(/\s*{$/, '')
            .replace(/ +/g, ' ')
            .replace(/\r?\n|\r/g, '')

    const ctx = parser.parseString(doc)
    const comment = ctx.docComment

    console.assert(ctx.log.messages.length === 0)

    if (decl.startsWith('export')) {
      decl = decl.trim()
              .replace('export ', '')
              .replace('declare ', '')

      if (decl.startsWith('function')) {
        const [newDecl, list] = formatConstraints(decl)

        stream.write('#### `' + stripParameterTypes(newDecl) + '`\n')
        stream.write(list + '\n')

        if (!decl.includes('():'))
          printParameters(newDecl, comment.params)
      } else if (decl.startsWith('type')) {
        const [newDecl, list] = formatConstraints(decl)

        stream.write('#### `' + newDecl.substring(0, newDecl.indexOf('=') - 1) + '`\n')
        stream.write(list + '\n')
      } else {
        stream.write('#### `' + decl + '`\n')
      }

      comment.summarySection.nodes.forEach(print)

      if (decl.startsWith('type')) {
        stream.write('Defined as:\n')
        stream.write('```typescript\n')
        stream.write(decl.replace(';}', ' }') + '\n')
        stream.write('```\n\n')
      }
    } else {
      stream.write('##### `' + stripParameterTypes(decl).trim() + '`\n')

      if (decl.includes('):') && !decl.includes('():'))
        printParameters(decl, comment.params)

      comment.summarySection.nodes.forEach(print)
    }

    stream.write('\n')
  }
}


function print(node: tsdoc.DocNode) {
  if (node instanceof tsdoc.DocParagraph) {
    node.nodes.forEach(print)
    stream.write('\n\n')
  } else if (node instanceof tsdoc.DocExcerpt) {
    stream.write(node.content.toString() + '\n')
  } else if (node instanceof tsdoc.DocPlainText) {
    stream.write(node.text)
  } else if (node instanceof tsdoc.DocCodeSpan) {
    stream.write('`' + node.code + '`')
  } else if (node instanceof tsdoc.DocFencedCode) {
    stream.write('```typescript\n')
    stream.write(node.code + '\n')
    stream.write('```\n')
  } else if (node instanceof tsdoc.DocSoftBreak) {
    stream.write('\n')
  } else if (node instanceof tsdoc.DocBlockTag) {
    if (node.tagName === '@see') {
      node.getChildNodes().forEach(print)
    } else {
      console.error('Unknown block tag ' + node.tagName + '.')
    }
  } else {
    console.error('Unknown node ' + node.kind + '.')
  }
}

function formatConstraints(fn: string): [string, string] {
  let regex = /(\w+) extends (.+?)(>\(|> =|, )/g
  let result = null as RegExpExecArray

  let list = ''

  while (result = regex.exec(fn)) {
    list += ' - `' + result[1] + '`: `' + result[2] + '`\n'
  }

  return [fn.replace(regex, '$1$3'), list]
}

function stripParameterTypes(fn: string) {
  return fn.replace(paramRegex, '$1$3')
}

function printParameters(fn: string, params: tsdoc.DocParamCollection) {
  stream.write('| Parameter | Type | Description |\n')
  stream.write('| --------- | ---- | ----------- |\n')

  let result = null as RegExpExecArray

  while (result = paramRegex.exec(fn)) {
    const paramLhs = result[1]
    const paramPairs = new Array<[string, string]>()

    if (paramLhs.includes(',')) {
      const paramNames = paramLhs.substring(2, paramLhs.length - 2).split(', ')

      for (const paramName of paramNames) {
        if (paramName.startsWith('...')) {
          const beforeAmpersand = /(.+?) &/g.exec(result[2])[1]

          paramPairs.push([paramName.substr(3), beforeAmpersand])
        } else {
          const paramType = result[2].substring(result[2].indexOf(paramName + ': ') + paramName.length + 2)
          const paramTypeEnd = paramType.indexOf(';')

          paramPairs.push([paramName, paramType.substring(0, paramTypeEnd)])
        }
      }
    } else {
      paramPairs.push([paramLhs, result[2]])
    }

    for (const [paramName, paramType] of paramPairs) {
      const param = params.blocks.find(x => x.parameterName === paramName)

      stream.write('| ' + paramName + ' | `' + paramType.replace(';}', ' }') + '` | ')

      if (param != null)
        print(param.content)
      else
        stream.write('None')

      stream.write(' |\n')
    }
  }

  stream.write('\n')
}
