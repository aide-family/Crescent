import Parser from 'web-tree-sitter'
import { createRequire } from 'node:module'
import { dirname, join, extname } from 'node:path'
import type { CodeSymbol, CodeReference } from '../../shared/knowledge'
import { redactSensitiveText } from '../../shared/secret-redaction'

const runtimeRequire = createRequire(__filename)
const extensions: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.sh': 'bash',
  '.bash': 'bash',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml'
}
const languages = new Map<string, Parser.Language>()
/** Describe callable identity without capturing argument values or anonymous function bodies. */
function callableName(node: Parser.SyntaxNode): string | undefined {
  if (/^(?:identifier|property_identifier|word|command_name)$/.test(node.type)) return node.text
  if (/^(?:member_expression|attribute)$/.test(node.type)) {
    const object = node.childForFieldName('object'),
      property = node.childForFieldName('property') ?? node.childForFieldName('attribute')
    return object && property
      ? `${callableName(object) ?? '<expression>'}.${property.text}`
      : undefined
  }
  if (/^(?:call_expression|call)$/.test(node.type)) {
    const fn = node.childForFieldName('function')
    return fn ? `${callableName(fn) ?? '<anonymous>'}()` : undefined
  }
  return undefined
}
let initialized: Promise<void> | undefined
export function codeLanguage(path: string): string | undefined {
  return extensions[extname(path)]
}

export async function parseCode(
  path: string,
  text: string
): Promise<{ symbols: CodeSymbol[]; references: CodeReference[]; errors: boolean }> {
  initialized ??= Parser.init().catch((error) => {
    initialized = undefined
    throw error
  })
  await initialized
  const language = codeLanguage(path)
  if (!language) throw new Error('Unsupported language')
  if (!languages.has(language)) {
    const wasmRoot = dirname(runtimeRequire.resolve('tree-sitter-wasms/package.json'))
    languages.set(
      language,
      await Parser.Language.load(join(wasmRoot, 'out', `tree-sitter-${language}.wasm`))
    )
  }
  const parser = new Parser()
  parser.setLanguage(languages.get(language)!)
  const tree = parser.parse(text)
  const symbols: CodeSymbol[] = []
  const references: CodeReference[] = []
  function visit(node: Parser.SyntaxNode, from?: string): void {
    if (symbols.length + references.length >= 12000) return
    const definition =
      /^(?:function_declaration|function_definition|class_declaration|class_definition|method_definition|interface_declaration|type_alias_declaration|variable_declarator|pair|block_mapping_pair)$/.test(
        node.type
      )
    const nameNode = node.childForFieldName('name') ?? node.childForFieldName('key')
    const name = nameNode
      ? redactSensitiveText(nameNode.text.replace(/^['"]|['"]$/g, '')).slice(0, 200)
      : undefined
    if (definition && name) {
      symbols.push({
        path,
        name,
        kind: node.type,
        start: node.startPosition.row + 1,
        end: node.endPosition.row + 1
      })
      if (/function|method|class/.test(node.type)) from = name
    }
    if (/^(?:call_expression|call|command)$/.test(node.type)) {
      const target = node.childForFieldName('function') ?? node.childForFieldName('name')
      const name = target ? callableName(target) : undefined
      if (name)
        references.push({
          path,
          name: redactSensitiveText(name).slice(0, 200),
          kind: 'call',
          line: node.startPosition.row + 1,
          from
        })
    }
    if (/^(?:import_statement|import_from_statement|export_statement)$/.test(node.type)) {
      const target = node.childForFieldName('source') ?? node.childForFieldName('module_name')
      if (target)
        references.push({
          path,
          name: redactSensitiveText(target.text.replace(/^['"]|['"]$/g, '')).slice(0, 200),
          kind: 'import',
          line: node.startPosition.row + 1
        })
    }
    if (/^(?:identifier|property_identifier)$/.test(node.type) && node.id !== nameNode?.id) {
      references.push({
        path,
        name: node.text.slice(0, 200),
        kind: 'reference',
        line: node.startPosition.row + 1,
        from
      })
    }
    for (const child of node.namedChildren) visit(child, from)
  }
  try {
    visit(tree.rootNode)
    return { symbols, references, errors: tree.rootNode.hasError() }
  } finally {
    tree.delete()
    parser.delete()
  }
}
