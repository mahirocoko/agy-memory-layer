#!/usr/bin/env node

/**
 * Static Architectural Boundary & Convention Linter for agy-memory-layer.
 * Inspired by Letta Code `check-layer-boundaries.js`.
 *
 * Enforces:
 * 1. Strict TypeScript `type` alias rule (zero `interface Foo` declarations).
 * 2. Lifecycle hook isolation (hooks cannot import presentation/palace/cli layers).
 * 3. Plugin boundary containment (no `../../` path traversal escaping plugin root).
 *
 * Strict engineering rules:
 * - TypeScript type alias ONLY (no interface).
 * - Zero external npm dependencies.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export type BoundaryViolation = {
  file: string
  line: number
  rule: string
  message: string
}

export type CheckBoundariesResult = {
  totalFilesChecked: number
  violations: BoundaryViolation[]
  passed: boolean
}

const ROOT_DIR = path.resolve(import.meta.dirname, '..')
const PLUGINS_DIR = path.join(ROOT_DIR, 'plugins', 'agy-memory-layer')

const SCAN_DIRECTORIES = [
  path.join(PLUGINS_DIR, 'scripts'),
  path.join(ROOT_DIR, 'tools'),
  path.join(ROOT_DIR, 'tests'),
]

function collectTypeScriptFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const files: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        files.push(...collectTypeScriptFiles(fullPath))
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath)
    }
  }
  return files
}

export function checkLayerBoundaries(): CheckBoundariesResult {
  const violations: BoundaryViolation[] = []
  let totalFiles = 0

  const allFiles: string[] = []
  for (const dir of SCAN_DIRECTORIES) {
    allFiles.push(...collectTypeScriptFiles(dir))
  }

  // Deduplicate files
  const uniqueFiles = Array.from(new Set(allFiles))
  totalFiles = uniqueFiles.length

  for (const filePath of uniqueFiles) {
    const relPath = path.relative(ROOT_DIR, filePath)
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1
      const line = lines[i].trim()

      // 1. Strict 'type' alias rule (forbid `export interface Foo` or `interface Foo {`)
      // Skip commented lines or string literals
      if (!line.startsWith('//') && !line.startsWith('*')) {
        const interfaceMatch = line.match(/\b(export\s+)?interface\s+([A-Z]\w*)\b/)
        if (interfaceMatch && !line.includes("'interface'") && !line.includes('"interface"')) {
          violations.push({
            file: relPath,
            line: lineNum,
            rule: 'strict-type-alias-no-interface',
            message: `Forbidden interface '${interfaceMatch[2]}' declared. Use 'export type ${interfaceMatch[2]} = { ... }' instead.`,
          })
        }
      }

      // 2. Lifecycle Hook Isolation
      if (relPath.includes('hook-inject-memory.ts') || relPath.includes('hook-memory-status.ts')) {
        if (
          line.startsWith('import') &&
          (line.includes('palace-generator') || line.includes('skill-synthesizer'))
        ) {
          violations.push({
            file: relPath,
            line: lineNum,
            rule: 'hook-layer-isolation',
            message: `Lifecycle hooks must not import presentation or synthesizer layers: ${line}`,
          })
        }
      }

      // 3. Plugin boundary containment (no escaping plugins directory)
      if (relPath.startsWith('plugins/agy-memory-layer/')) {
        if (line.startsWith('import') && line.includes('../../..')) {
          violations.push({
            file: relPath,
            line: lineNum,
            rule: 'plugin-boundary-containment',
            message: `Plugin imports must not traverse outside plugin root: ${line}`,
          })
        }
      }
    }
  }

  return {
    totalFilesChecked: totalFiles,
    violations,
    passed: violations.length === 0,
  }
}

if (process.argv[1]?.endsWith('check-layer-boundaries.ts')) {
  console.log('🔍 Checking architectural boundaries and strict type conventions...')
  const result = checkLayerBoundaries()

  console.log(`   Scanned ${result.totalFilesChecked} TypeScript files.`)
  if (result.passed) {
    console.log('✓ All layer boundaries, hook isolation, and type conventions are clean!\n')
    process.exit(0)
  } else {
    console.error(`\n❌ Found ${result.violations.length} boundary violation(s):\n`)
    for (const v of result.violations) {
      console.error(`  - ${v.file}:${v.line} [${v.rule}]`)
      console.error(`    ${v.message}\n`)
    }
    process.exit(1)
  }
}
