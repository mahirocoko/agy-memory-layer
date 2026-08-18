#!/usr/bin/env node

/**
 * In-Memory TypeScript Language Inspector for agy-memory-layer
 * Provides sub-50ms AST diagnostics, hover type signatures, and definition resolution
 * without spawning slow external compiler processes.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'

export type DiagnosticItem = {
  file: string
  line: number
  col: number
  code: string
  category: 'error' | 'warning' | 'suggestion' | 'message'
  message: string
}

export type TypeInfo = {
  typeString: string
  documentation: string
  kind: string
}

export type SymbolLocation = {
  file: string
  line: number
  col: number
  context: string
}

export type TsInspector = {
  getDiagnostics: (targetFile?: string) => DiagnosticItem[]
  getTypeAtPosition: (filePath: string, line: number, col: number) => TypeInfo | null
  getDefinition: (filePath: string, line: number, col: number) => SymbolLocation[]
  findReferences: (filePath: string, line: number, col: number) => SymbolLocation[]
}

export function createTsInspector(workspaceDir: string = process.cwd()): TsInspector {
  const configPath = ts.findConfigFile(workspaceDir, ts.sys.fileExists, 'tsconfig.json')
  let options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
  }
  let rootFileNames: string[] = []

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath),
    )
    options = parsed.options
    rootFileNames = parsed.fileNames
  }

  const filesMap = new Map<string, { version: number; content: string }>()

  const servicesHost: ts.LanguageServiceHost = {
    getScriptFileNames: () => {
      const all = new Set([...rootFileNames, ...filesMap.keys()])
      return Array.from(all)
    },
    getScriptVersion: (fileName) => {
      return filesMap.get(fileName)?.version.toString() || '1'
    },
    getScriptSnapshot: (fileName) => {
      if (filesMap.has(fileName)) {
        return ts.ScriptSnapshot.fromString(filesMap.get(fileName)!.content)
      }
      if (fs.existsSync(fileName)) {
        return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf-8'))
      }
      return undefined
    },
    getCurrentDirectory: () => workspaceDir,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  }

  const languageService = ts.createLanguageService(servicesHost, ts.createDocumentRegistry())

  function formatDiagnostic(d: ts.Diagnostic): DiagnosticItem {
    let line = 0
    let col = 0
    let file = 'unknown'

    if (d.file && typeof d.start === 'number') {
      const pos = d.file.getLineAndCharacterOfPosition(d.start)
      line = pos.line + 1
      col = pos.character + 1
      file = path.relative(workspaceDir, d.file.fileName)
    }

    const categoryMap: Record<ts.DiagnosticCategory, DiagnosticItem['category']> = {
      [ts.DiagnosticCategory.Error]: 'error',
      [ts.DiagnosticCategory.Warning]: 'warning',
      [ts.DiagnosticCategory.Suggestion]: 'suggestion',
      [ts.DiagnosticCategory.Message]: 'message',
    }

    return {
      file,
      line,
      col,
      code: `TS${d.code}`,
      category: categoryMap[d.category] || 'error',
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    }
  }

  function getSafePosition(sourceFile: ts.SourceFile, line: number, col: number): number {
    try {
      const lineStarts = sourceFile.getLineStarts()
      const targetLine = Math.max(0, Math.min(lineStarts.length - 1, line - 1))
      const lineStart = lineStarts[targetLine]
      const nextLineStart =
        targetLine < lineStarts.length - 1 ? lineStarts[targetLine + 1] : sourceFile.text.length
      const lineLength = Math.max(0, nextLineStart - lineStart)
      const targetCol = Math.max(0, Math.min(lineLength, col - 1))
      return lineStart + targetCol
    } catch {
      return 0
    }
  }

  return {
    getDiagnostics(targetFile?: string): DiagnosticItem[] {
      const results: DiagnosticItem[] = []

      if (targetFile) {
        const fullTarget = path.isAbsolute(targetFile)
          ? targetFile
          : path.join(workspaceDir, targetFile)
        const syntactic = languageService.getSyntacticDiagnostics(fullTarget)
        const semantic = languageService.getSemanticDiagnostics(fullTarget)
        return [...syntactic, ...semantic].map(formatDiagnostic)
      }

      const program = languageService.getProgram()
      if (!program) return []

      const sourceFiles = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile)
      for (const sf of sourceFiles) {
        const syntactic = languageService.getSyntacticDiagnostics(sf.fileName)
        const semantic = languageService.getSemanticDiagnostics(sf.fileName)
        results.push(...[...syntactic, ...semantic].map(formatDiagnostic))
      }

      return results
    },

    getTypeAtPosition(filePath: string, line: number, col: number): TypeInfo | null {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceDir, filePath)
      const sourceFile = languageService.getProgram()?.getSourceFile(fullPath)
      if (!sourceFile) return null

      const pos = getSafePosition(sourceFile, line, col)
      const quickInfo = languageService.getQuickInfoAtPosition(fullPath, pos)
      if (!quickInfo) return null

      return {
        typeString: ts.displayPartsToString(quickInfo.displayParts),
        documentation: ts.displayPartsToString(quickInfo.documentation),
        kind: quickInfo.kind,
      }
    },

    getDefinition(filePath: string, line: number, col: number): SymbolLocation[] {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceDir, filePath)
      const sourceFile = languageService.getProgram()?.getSourceFile(fullPath)
      if (!sourceFile) return []

      const pos = getSafePosition(sourceFile, line, col)
      const defs = languageService.getDefinitionAtPosition(fullPath, pos)
      if (!defs) return []

      return defs.map((d) => {
        const targetSf = languageService.getProgram()?.getSourceFile(d.fileName)
        let defLine = 1
        let defCol = 1
        if (targetSf) {
          const loc = targetSf.getLineAndCharacterOfPosition(d.textSpan.start)
          defLine = loc.line + 1
          defCol = loc.character + 1
        }
        return {
          file: path.relative(workspaceDir, d.fileName),
          line: defLine,
          col: defCol,
          context: d.name,
        }
      })
    },

    findReferences(filePath: string, line: number, col: number): SymbolLocation[] {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceDir, filePath)
      const sourceFile = languageService.getProgram()?.getSourceFile(fullPath)
      if (!sourceFile) return []

      const pos = getSafePosition(sourceFile, line, col)
      const refEntries = languageService.findReferences(fullPath, pos)
      if (!refEntries) return []

      const locations: SymbolLocation[] = []
      for (const entry of refEntries) {
        for (const ref of entry.references) {
          const targetSf = languageService.getProgram()?.getSourceFile(ref.fileName)
          let refLine = 1
          let refCol = 1
          if (targetSf) {
            const loc = targetSf.getLineAndCharacterOfPosition(ref.textSpan.start)
            refLine = loc.line + 1
            refCol = loc.character + 1
          }
          locations.push({
            file: path.relative(workspaceDir, ref.fileName),
            line: refLine,
            col: refCol,
            context: entry.definition.name,
          })
        }
      }
      return locations
    },
  }
}

if (process.argv[1]?.endsWith('ts-inspector.ts')) {
  const args = process.argv.slice(2)
  const cmd = args[0] || 'diagnostics'
  const inspector = createTsInspector(process.cwd())

  if (cmd === 'diagnostics' || cmd === 'diag') {
    const targetFile = args[1]
    const startTime = Date.now()
    const diags = inspector.getDiagnostics(targetFile)
    const duration = Date.now() - startTime

    console.log(`\n🔍 TypeScript Diagnostics (${duration}ms):`)
    if (diags.length === 0) {
      console.log('   ✓ Zero diagnostics / No type errors found.\n')
    } else {
      console.log(`   Found ${diags.length} issue(s):\n`)
      diags.forEach((d, i) => {
        const icon = d.category === 'error' ? '✖' : '⚠'
        console.log(`   [${i + 1}] ${icon} ${d.file}:${d.line}:${d.col} [${d.code}]`)
        console.log(`       ${d.message}\n`)
      })
    }
  } else if (cmd === 'type' || cmd === 'hover') {
    const loc = args[1]
    if (!loc || !loc.includes(':')) {
      console.error('Usage: ts-inspector.ts type <file>:<line>:<col>')
      process.exit(1)
    }
    const [file, lineStr, colStr] = loc.split(':')
    const line = parseInt(lineStr, 10) || 1
    const col = parseInt(colStr, 10) || 1

    const typeInfo = inspector.getTypeAtPosition(file, line, col)
    if (!typeInfo) {
      console.log(`\nNo type information found at ${file}:${line}:${col}\n`)
    } else {
      console.log(`\n🏷️  Type at ${file}:${line}:${col}:`)
      console.log(`   Kind: ${typeInfo.kind}`)
      console.log(`   Type: ${typeInfo.typeString}`)
      if (typeInfo.documentation) {
        console.log(`   Docs: ${typeInfo.documentation}`)
      }
      console.log('')
    }
  } else if (cmd === 'def' || cmd === 'definition') {
    const loc = args[1]
    if (!loc || !loc.includes(':')) {
      console.error('Usage: ts-inspector.ts def <file>:<line>:<col>')
      process.exit(1)
    }
    const [file, lineStr, colStr] = loc.split(':')
    const line = parseInt(lineStr, 10) || 1
    const col = parseInt(colStr, 10) || 1

    const defs = inspector.getDefinition(file, line, col)
    console.log(`\n📍 Definitions for ${file}:${line}:${col}:`)
    if (defs.length === 0) {
      console.log('   No definitions found.')
    } else {
      defs.forEach((d, i) => {
        console.log(`   [${i + 1}] ${d.file}:${d.line}:${d.col} (${d.context})`)
      })
    }
    console.log('')
  }
}
