import { createWriteStream, readFileSync, writeFileSync } from 'fs'
import * as tsdoc from '@microsoft/tsdoc'


const paramRegex = /(\w+|\{[\w, .]+\})\??: (\(.+?\) => .+?|[^{}<>]+?|.+?>|.+?})(,|\):)/g

// Remove previous API from README
writeFileSync('README.md', readFileSync('README.md', 'utf8').replace(/\s+# API[\s\S]+$/, ''))

// Append the API to the freshly modified README
const stream = createWriteStream('README.md', { flags: 'a+' })

stream.write('\n\n\n\n# API\n')

const files = {
  'src/index.ts': {
    path: 'ricochet',
    header: 'The core Ricochet API, used to render JSX nodes.',
  },
  'src/array.ts': {
    path: 'ricochet/array',
    header: 'Utilities for rendering lists efficiently with the `ObservableArray` type.',
  },
  'src/async.ts': {
    path: 'ricochet/async',
    header: 'Utilities for rendering with promises.',
  },
  'src/reactive.ts': {
    path: 'ricochet/reactive',
    header: 'Utilities for creating and combining observable streams and subjects.',
  },
  'src/interop/rxjs.ts': {
    path: 'ricochet/interop/rxjs',
    header: 'Interop helpers for [RxJS](https://github.com/ReactiveX/rxjs).',
  },
  'src/interop/wc.ts': {
    path: 'ricochet/interop/wc',
    header: 'Utilities for defining Web Components.',
  },
}

const parser = new tsdoc.TSDocParser()

for (const file in files) {
  const { path, header } = files[file]
  const content = readFileSync(file, 'utf8')

  stream.write('\n')
  stream.write('### [`' + path + '`](' + file + ')\n')
  stream.write(header + '\n\n')

  let docRegex = /(\/\*\*[\s\S]+?\*\/)\s+((?:export|  )[\S\s]+?)(?=\/(?:\/|\*\*|$))/g
  let result = null as RegExpExecArray

  let previousEnd = 0
  let currentLine = 1

  while (result = docRegex.exec(content)) {
    if (currentLine == 1)
      currentLine += countLines(content.substr(0, result.index))

    let startLine = currentLine

    currentLine += countLines(result[0])

    previousEnd = result.index

    let [_, doc, decl] = result

    if (doc.includes('@ignore'))
      continue

    doc = doc.trim()
    decl = decl.trim()

    if (decl == '' || doc == '')
      continue
    if (decl.includes('unique symbol'))
      continue
    if (decl.startsWith('type'))
      continue

    const startOfDoc = doc.lastIndexOf('/**')

    startLine += countLines(doc.substr(0, startOfDoc))

    const link = `(${file}#L${startLine}-L${currentLine - 1})\n`
    const topLevel = decl.startsWith('export ')

    if (topLevel)
      decl = decl.substring(7)

    // With that out of the way, let's clean up our strings
    decl = decl
            .replace(/\r?\n|\r/g, ';')
            .replace(/ +/g, ' ')
            .replace(/(?<!T|void) +:/g, ':')
            .replace(/([({,)]);/g, '$1')
            .replace(/[;,]([})])/g, '$1')
            .replace(/\( +/g, '(')
            .replace(/^(interface.+?)\s+{.*$/, '$1')
            .replace(/^(function.+?(<.+?>.*?)?\(.*?\).*?)\s+{.*$/g, '$1')
            .replace(/^(class.+?)\s+{.*$/, '$1')
            .replace(/^get +(.+?)\({.*$/, 'property $1')
            .replace(/([^{\s])}/g, '$1 }')
            .replace('ObservableSymbol', 'Symbol.observable')

    const ctx = parser.parseString(doc.substr(doc.lastIndexOf('/**')))
    const comment = ctx.docComment

    ctx.log.messages.forEach(msg => console.error(msg.toString()))

    if (topLevel) {
      if (decl.startsWith('function')) {
        const [newDecl, list] = formatConstraints(decl)

        stream.write('#### [`' + stripParameterTypes(newDecl) + '`]' + link)
        stream.write(list + '\n')

        if (!decl.includes('():'))
          printParameters(newDecl, comment.params)
      } else if (decl.startsWith('type')) {
        const [newDecl, list] = formatConstraints(decl)

        stream.write('#### [`' + newDecl.substring(0, newDecl.indexOf('=') - 1) + '`]' + link)
        stream.write(list + '\n')
      } else {
        stream.write('#### [`' + decl + '`]' + link)
      }

      comment.summarySection.nodes.forEach(n => print(n, false))

      if (decl.startsWith('type')) {
        stream.write('Defined as:\n')
        stream.write('```typescript\n')
        stream.write(result[2].trim().substr(7) + '\n')
        stream.write('```\n\n')
      }
    } else {
      decl = decl.replace(/}[\s\S]*$/g, '')

      stream.write('##### [`' + stripParameterTypes(decl).trim() + '`]' + link)

      if (decl.includes('):') && !decl.includes('():'))
        printParameters(decl, comment.params)

      comment.summarySection.nodes.forEach(n => print(n, false))
    }

    stream.write('\n')
  }
}


function print(node: tsdoc.DocNode, inline = false) {
  const nl = inline ? ' ' : '\n'

  if (node instanceof tsdoc.DocParagraph || node instanceof tsdoc.DocSection) {
    node.nodes.forEach(n => print(n, inline))

    if (!inline)
      stream.write('\n\n')
  } else if (node instanceof tsdoc.DocExcerpt) {
    stream.write(node.content.toString().trim() + nl)
  } else if (node instanceof tsdoc.DocPlainText) {
    stream.write(node.text)
  } else if (node instanceof tsdoc.DocCodeSpan) {
    stream.write('`' + node.code + '`')
  } else if (node instanceof tsdoc.DocFencedCode) {
    stream.write('```typescript\n')
    stream.write(node.code + '\n')
    stream.write('```\n')
  } else if (node instanceof tsdoc.DocSoftBreak) {
    stream.write(nl)
  } else if (node instanceof tsdoc.DocBlockTag) {
    console.error('Unknown block tag ' + node.tagName + '.')
  } else {
    console.error('Unknown node ' + node.kind + '.')
  }
}

function formatConstraints(fn: string): [string, string] {
  let regex = /(\w+) extends (.+?(?:<.+?>.*?)?)(>\(|> =|, )/g
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
          let paramType = result[2].substring(result[2].indexOf(paramName + ': ') + paramName.length + 2)
          let paramTypeEnd = paramType.indexOf(';')

          if (paramTypeEnd === -1)
            paramTypeEnd = paramType.length - 2

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
        print(param.content, true)
      else
        stream.write('None')

      stream.write(' |\n')
    }
  }

  stream.write('\n')
}


function countLines(s: string) {
  let lines = 0
  let indexOfNewline = s.indexOf('\n')

  while (indexOfNewline != -1) {
    lines++
    indexOfNewline = s.indexOf('\n', indexOfNewline + 1)
  }

  return lines
}
