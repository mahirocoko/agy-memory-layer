#!/usr/bin/env node

/**
 * Contract Ledger & Hub-and-Spoke Governance Engine for agy-memory-layer
 *
 * Provides a compiled, structured contract artifact and deterministic verification
 * to power /contract-refine and /contract-align skills without raw markdown context bloat.
 *
 * Strict engineering rules:
 * - TypeScript type alias ONLY (zero interface).
 * - Zero external npm dependencies (only Node.js built-ins).
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type RuleClass = 'deterministic' | 'heuristic' | 'human-only'
export type RuleStatus =
  | 'current-reality'
  | 'preferred-direction'
  | 'not-established'
  | 'historical'
export type RuleDisposition =
  | 'keep'
  | 'merge-into'
  | 'move-to'
  | 'historical'
  | 'duplicate'
  | 'rejected'

export type RuleUnit = {
  id: string // sha256(normalized title + intent + action).slice(0, 16)
  title: string
  owner: string // e.g. "AGENTS.md#L12" or "docs/patterns/component-conventions.md#Section-3"
  scope: string[] // glob patterns
  class: RuleClass
  status: RuleStatus
  intent: string
  trigger: string
  action: string
  boundary: string
  rationale: string
  tags: string[]
}

export type SpokeEntry = {
  path: string
  title: string
  ruleCount: number
  isHistorical: boolean
  isReachable: boolean
}

export type ContractLedger = {
  version: '1.0.0'
  repoRoot: string
  sourcesHash: string
  compiledAt: string
  hub: {
    path: string
    exists: boolean
    ruleCount: number
    invariants: string[]
  }
  spokes: SpokeEntry[]
  rules: RuleUnit[]
  allowlists: {
    i18nExcludeGlobs: string[]
    literalExcludePatterns: string[]
  }
}

export type VerificationFinding = {
  severity: 'error' | 'warning' | 'info'
  code: string
  file: string
  line?: number
  message: string
  suggestion?: string
}

export type ContractVerificationResult = {
  passed: boolean
  totalRules: number
  totalSpokes: number
  findings: VerificationFinding[]
}

export type FindingType = 'code-finding' | 'contract-finding'

export type EvaluationFinding = {
  type: FindingType
  ruleId: string
  ruleTitle: string
  file?: string
  line?: number
  message: string
  snippet?: string
  suggestedAction: string
}

export type CodeEvaluationResult = {
  totalFilesChecked: number
  passed: boolean
  contractFindings: EvaluationFinding[]
  codeFindings: EvaluationFinding[]
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function computeRuleId(title: string, intent: string, action: string): string {
  const norm = `${normalizeText(title)}|${normalizeText(intent)}|${normalizeText(action)}`
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16)
}

function classifyRule(text: string): RuleClass {
  const lower = text.toLowerCase()
  if (
    lower.includes('type') ||
    lower.includes('interface') ||
    lower.includes('pnpm') ||
    lower.includes('import') ||
    lower.includes('package.json') ||
    lower.includes('biome') ||
    lower.includes('tsc') ||
    lower.includes('linter') ||
    lower.includes('path')
  ) {
    return 'deterministic'
  }
  if (
    lower.includes('review') ||
    lower.includes('approve') ||
    lower.includes('mahiro') ||
    lower.includes('human') ||
    lower.includes('gate') ||
    lower.includes('confirm')
  ) {
    return 'human-only'
  }
  return 'heuristic'
}

function determineStatus(filePath: string, sectionTitle: string, ruleText: string): RuleStatus {
  const normPath = filePath.toLowerCase().replace(/\\/g, '/')
  if (
    normPath.includes('/releases/') ||
    normPath.includes('/history/') ||
    normPath.includes('/archive/')
  ) {
    return 'historical'
  }
  const text = `${sectionTitle}\n${ruleText}`
  if (text.includes('[preferred-direction]') || text.includes('[preferred_direction]')) {
    return 'preferred-direction'
  }
  if (text.includes('[not-established]') || text.includes('[not_established]')) {
    return 'not-established'
  }
  return 'current-reality'
}

function extractStructuredField(text: string, fieldName: string): string | null {
  const regex = new RegExp(`(?:^|[\\n\\r]|\\*\\*)${fieldName}\\s*[:：]\\s*([^\\n\\r*]+)`, 'i')
  const match = text.match(regex)
  return match ? match[1].trim() : null
}

export function parseRuleUnitsFromMarkdown(content: string, filePath: string): RuleUnit[] {
  const lines = content.split(/\r?\n/)
  const rules: RuleUnit[] = []
  let currentSection = 'General'

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const line = lines[i].trim()

    // Detect section headings
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/)
    if (headingMatch) {
      currentSection = headingMatch[1].trim()
      continue
    }

    // Detect rule bullet points (e.g. "- **Title**: Description" or "1. **Title**: Description")
    const bulletMatch = line.match(
      /^(?:[-*]|\d+\.)\s+(?:\*\*([^*]+)\*\*|`([^`]+)`)\s*[:：]?\s*(.*)$/,
    )
    if (bulletMatch) {
      const title = (bulletMatch[1] || bulletMatch[2] || 'Unnamed Rule').trim()
      const body = bulletMatch[3] ? bulletMatch[3].trim() : ''

      // Look ahead up to 10 lines for structured Intent/Trigger/Action/Boundary/Rationale
      const extraLines: string[] = []
      let lookahead = i + 1
      while (lookahead < lines.length) {
        const nextLine = lines[lookahead].trim()
        if (nextLine.startsWith('#') || nextLine.match(/^(?:[-*]|\d+\.)\s+\*\*/)) {
          break
        }
        if (nextLine.length > 0) {
          extraLines.push(nextLine)
        }
        lookahead++
      }

      const fullText = [body, ...extraLines].join('\n').trim()

      const intent = extractStructuredField(fullText, 'Intent') || body || title
      const trigger = extractStructuredField(fullText, 'Trigger') || currentSection
      const action = extractStructuredField(fullText, 'Action') || body || title
      const boundary = extractStructuredField(fullText, 'Boundary') || ''
      const rationale = extractStructuredField(fullText, 'Rationale') || ''

      const ruleId = computeRuleId(title, intent, action)
      const ruleClass = classifyRule(`${title} ${fullText}`)
      const status = determineStatus(filePath, currentSection, fullText)

      // Infer default scope
      const scope: string[] = ['**/*.ts', '**/*.tsx']
      if (title.toLowerCase().includes('doc') || title.toLowerCase().includes('markdown')) {
        scope.push('**/*.md')
      }

      rules.push({
        id: ruleId,
        title,
        owner: `${filePath}#L${lineNum}`,
        scope,
        class: ruleClass,
        status,
        intent,
        trigger,
        action,
        boundary,
        rationale,
        tags: [currentSection.toLowerCase().replace(/[^\w-]/g, '_')],
      })
    }
  }

  return rules
}

export function compileContractLedger(workspaceDir: string): ContractLedger {
  const hubPath = path.join(workspaceDir, 'AGENTS.md')
  const docsDir = path.join(workspaceDir, 'docs')
  const hubExists = fs.existsSync(hubPath)

  let combinedContent = ''
  const rules: RuleUnit[] = []
  const invariants: string[] = []

  // 1. Process Hub (AGENTS.md)
  if (hubExists) {
    const hubContent = fs.readFileSync(hubPath, 'utf-8')
    combinedContent += hubContent
    const hubRules = parseRuleUnitsFromMarkdown(hubContent, 'AGENTS.md')
    rules.push(...hubRules)

    for (const r of hubRules) {
      invariants.push(r.title)
    }
  }

  // 2. Process Spokes (docs/**/*.md)
  const spokes: SpokeEntry[] = []
  if (fs.existsSync(docsDir)) {
    const collectDocs = (dir: string): string[] => {
      const res: string[] = []
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') {
          res.push(...collectDocs(full))
        } else if (e.isFile() && e.name.endsWith('.md')) {
          res.push(full)
        }
      }
      return res
    }

    const docFiles = collectDocs(docsDir)
    for (const docFile of docFiles) {
      const rel = path.relative(workspaceDir, docFile)
      const isHistorical =
        rel.includes('releases/') || rel.includes('history/') || rel.includes('archive/')

      const content = fs.readFileSync(docFile, 'utf-8')
      combinedContent += content

      const docRules = isHistorical ? [] : parseRuleUnitsFromMarkdown(content, rel)
      rules.push(...docRules)

      const titleMatch = content.match(/^#\s+(.+)$/m)
      const title = titleMatch ? titleMatch[1].trim() : path.basename(docFile, '.md')

      spokes.push({
        path: rel,
        title,
        ruleCount: docRules.length,
        isHistorical,
        isReachable: false,
      })
    }
  }

  // Compute overall sources hash
  const sourcesHash = crypto.createHash('sha256').update(combinedContent).digest('hex')

  return {
    version: '1.0.0',
    repoRoot: workspaceDir,
    sourcesHash,
    compiledAt: new Date().toISOString(),
    hub: {
      path: 'AGENTS.md',
      exists: hubExists,
      ruleCount: rules.filter((r) => r.owner.startsWith('AGENTS.md')).length,
      invariants,
    },
    spokes,
    rules,
    allowlists: {
      i18nExcludeGlobs: ['tests/**', '**/fixtures/**', '**/locales/**', '**/*.test.*'],
      literalExcludePatterns: ['^[A-Z0-9_-]+$', '^https?://', '^[a-z]+:[a-z0-9_-]+$'],
    },
  }
}

export function verifyContractLedger(
  ledger: ContractLedger,
  workspaceDir: string,
): ContractVerificationResult {
  const findings: VerificationFinding[] = []

  // Check 1: Hub existence
  if (!ledger.hub.exists) {
    findings.push({
      severity: 'error',
      code: 'HUB_MISSING',
      file: 'AGENTS.md',
      message:
        'Workspace has no AGENTS.md hub. Use mahiro-docs-rules-init or create an initial baseline.',
      suggestion: 'Create an AGENTS.md hub to anchor repository invariants.',
    })
  }

  // Check 2: Relative link validity and machine-specific paths across hub and docs
  const filesToScan = [
    ledger.hub.exists ? path.join(workspaceDir, 'AGENTS.md') : null,
    ...ledger.spokes.map((s) => path.join(workspaceDir, s.path)),
  ].filter((f): f is string => f !== null && fs.existsSync(f))

  const spokePaths = new Set(ledger.spokes.map((s) => s.path))
  const referencedSpokes = new Set<string>()

  for (const filePath of filesToScan) {
    const relFile = path.relative(workspaceDir, filePath)
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split(/\r?\n/)

    let inCodeBlock = false
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1
      const line = lines[i]

      // Toggle code block state
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock
        continue
      }
      if (inCodeBlock) continue

      // Check machine-specific paths (e.g. file:///Users/..., /Users/..., /var/folders/...)
      const machinePathMatch = line.match(/(?:file:\/\/\/|\/Users\/|\/var\/folders\/)[^\s)`"']+/i)
      if (machinePathMatch) {
        findings.push({
          severity: 'warning',
          code: 'MACHINE_SPECIFIC_PATH',
          file: relFile,
          line: lineNum,
          message: `Machine-specific path or file URI found in repo documentation: '${machinePathMatch[0]}'`,
          suggestion:
            'Convert to repository-relative markdown path (e.g. docs/...) for environment-agnostic hygiene.',
        })
      }

      // Check markdown links [text](target)
      const linkMatches = line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)
      for (const m of linkMatches) {
        const rawTarget = m[2].trim()

        // Skip pure web URLs (http/https) and pure local anchors (#)
        if (
          rawTarget.startsWith('http://') ||
          rawTarget.startsWith('https://') ||
          rawTarget.startsWith('#')
        ) {
          continue
        }

        // Handle file:/// URIs gracefully
        let cleanTarget = rawTarget
        if (cleanTarget.startsWith('file://')) {
          cleanTarget = cleanTarget.replace(/^file:\/\//, '')
        }

        // Strip markdown title if present e.g. [text](url "title")
        cleanTarget = cleanTarget.replace(/\s+["'][^"']*["']$/, '')
        cleanTarget = cleanTarget.split('#')[0].split('?')[0].trim()
        if (!cleanTarget) continue

        let resolvedPath: string
        if (
          cleanTarget.startsWith('/') &&
          !cleanTarget.startsWith('/Users/') &&
          !cleanTarget.startsWith('/var/')
        ) {
          // Repo root-relative link like /docs/guide.md
          resolvedPath = path.resolve(workspaceDir, `.${cleanTarget}`)
        } else if (path.isAbsolute(cleanTarget)) {
          resolvedPath = path.resolve(cleanTarget)
        } else {
          resolvedPath = path.resolve(path.dirname(filePath), cleanTarget)
        }

        const relResolved = path.relative(workspaceDir, resolvedPath)

        if (!fs.existsSync(resolvedPath)) {
          findings.push({
            severity: 'error',
            code: 'BROKEN_MARKDOWN_LINK',
            file: relFile,
            line: lineNum,
            message: `Broken link to non-existent target: '${rawTarget}'`,
            suggestion: `Verify target exists or correct path to '${relResolved}'.`,
          })
        } else {
          // Track reachability of spokes
          if (spokePaths.has(relResolved)) {
            referencedSpokes.add(relResolved)
          }
        }
      }
    }
  }

  // Check 3: Hub-and-Spoke Reachability for active (non-historical) spokes
  for (const spoke of ledger.spokes) {
    if (spoke.isHistorical) {
      spoke.isReachable = true
      continue
    }

    if (!referencedSpokes.has(spoke.path) && spoke.path !== 'docs/README.md') {
      findings.push({
        severity: 'warning',
        code: 'UNREACHABLE_SPOKE',
        file: spoke.path,
        message: `Active spoke document '${spoke.path}' is not linked from AGENTS.md or other documentation pages.`,
        suggestion: 'Link this spoke page in AGENTS.md under the Documentation Family Map.',
      })
    } else {
      spoke.isReachable = true
    }
  }

  // Check 4: Duplicate Rule IDs
  const seenRuleIds = new Map<string, string>()
  for (const rule of ledger.rules) {
    if (rule.status === 'historical') continue

    if (seenRuleIds.has(rule.id)) {
      findings.push({
        severity: 'warning',
        code: 'DUPLICATE_RULE',
        file: rule.owner,
        message: `Duplicate rule ID '${rule.id}' detected. First defined at '${seenRuleIds.get(rule.id)}'.`,
        suggestion: 'Merge overlapping rules into a single canonical owner to eliminate noise.',
      })
    } else {
      seenRuleIds.set(rule.id, rule.owner)
    }
  }

  const hasErrors = findings.some((f) => f.severity === 'error')

  return {
    passed: !hasErrors,
    totalRules: ledger.rules.length,
    totalSpokes: ledger.spokes.length,
    findings,
  }
}

export function evaluateCodeAgainstContract(
  ledger: ContractLedger,
  filePaths: string[],
  readFileFn: (p: string) => string = (p) => fs.readFileSync(p, 'utf-8'),
): CodeEvaluationResult {
  const contractFindings: EvaluationFinding[] = []
  const codeFindings: EvaluationFinding[] = []

  // Filter rules that are active for enforcement: must be current-reality
  const activeRules = ledger.rules.filter((r) => r.status === 'current-reality')

  // Rule violation tracker: ruleId -> list of files violating it
  const violationsByRule = new Map<
    string,
    { rule: RuleUnit; files: { file: string; line: number; snippet: string }[] }
  >()

  // Deterministic checks
  // 1. Strict 'type' alias rule (no interface)
  const typeRule = activeRules.find(
    (r) =>
      r.class === 'deterministic' &&
      r.title.toLowerCase().includes('type') &&
      r.action.toLowerCase().includes('interface'),
  )

  // 2. Constants / inline dictionary check
  const constRule = activeRules.find(
    (r) =>
      r.title.toLowerCase().includes('constant') ||
      r.action.toLowerCase().includes('inline dictionary'),
  )

  for (const filePath of filePaths) {
    let content = ''
    try {
      content = readFileFn(filePath)
    } catch {
      continue
    }

    const lines = content.split(/\r?\n/)

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1
      const line = lines[i].trim()

      // Check 1: Interface usage if type rule is active
      if (typeRule && (filePath.endsWith('.ts') || filePath.endsWith('.tsx'))) {
        if (!line.startsWith('//') && !line.startsWith('*')) {
          const match = line.match(/\b(export\s+)?interface\s+([A-Z]\w*)\b/)
          if (match && !line.includes("'interface'") && !line.includes('"interface"')) {
            let entry = violationsByRule.get(typeRule.id)
            if (!entry) {
              entry = { rule: typeRule, files: [] }
              violationsByRule.set(typeRule.id, entry)
            }
            entry.files.push({
              file: filePath,
              line: lineNum,
              snippet: line,
            })
          }
        }
      }

      // Check 2: Inline dictionary with raw hardcoded string labels
      if (constRule && (filePath.endsWith('.ts') || filePath.endsWith('.tsx'))) {
        if (line.match(/const\s+\w+_(?:LABELS|MAP|TITLES)\s*[:=]\s*\{/)) {
          let entry = violationsByRule.get(constRule.id)
          if (!entry) {
            entry = { rule: constRule, files: [] }
            violationsByRule.set(constRule.id, entry)
          }
          entry.files.push({
            file: filePath,
            line: lineNum,
            snippet: line,
          })
        }
      }
    }
  }

  // Evaluate majority violation threshold to prevent "prose overruling code"
  const totalScanned = filePaths.length

  for (const [ruleId, entry] of violationsByRule.entries()) {
    const violatingFilesCount = new Set(entry.files.map((f) => f.file)).size
    // Strict majority: strictly more than 50% of files violate the rule, with at least 3 files evaluated
    const isMajority = totalScanned > 2 && violatingFilesCount * 2 > totalScanned

    if (isMajority) {
      // Majority of files violate the rule: this is a CONTRACT finding, not code findings!
      contractFindings.push({
        type: 'contract-finding',
        ruleId,
        ruleTitle: entry.rule.title,
        message: `Rule '${entry.rule.title}' is violated by ${violatingFilesCount}/${totalScanned} files (> 50%). In reality, this pattern is 'preferred-direction', not 'current-reality'.`,
        suggestedAction: `Reclassify rule status in '${entry.rule.owner}' to 'preferred-direction' or update AGENTS.md via /contract-refine before attempting code refactoring.`,
      })
    } else {
      // Minority of files violate the rule: these are actionable code findings
      for (const f of entry.files) {
        codeFindings.push({
          type: 'code-finding',
          ruleId,
          ruleTitle: entry.rule.title,
          file: f.file,
          line: f.line,
          snippet: f.snippet,
          message: `Violates '${entry.rule.title}': ${entry.rule.action}`,
          suggestedAction: `Refactor line ${f.line} in ${f.file} according to ${entry.rule.owner}.`,
        })
      }
    }
  }

  return {
    totalFilesChecked: totalScanned,
    passed: contractFindings.length === 0 && codeFindings.length === 0,
    contractFindings,
    codeFindings,
  }
}

function collectCodeFiles(targets: string[], repoRoot: string): string[] {
  const result: string[] = []
  const extensions = ['.ts', '.tsx', '.js', '.jsx']

  for (const t of targets) {
    const absPath = path.isAbsolute(t) ? t : path.resolve(repoRoot, t)
    if (!fs.existsSync(absPath)) continue

    const stat = fs.statSync(absPath)
    if (stat.isFile()) {
      if (extensions.some((ext) => absPath.endsWith(ext))) {
        result.push(absPath)
      }
    } else if (stat.isDirectory()) {
      const walk = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            walk(full)
          } else if (entry.isFile() && extensions.some((ext) => full.endsWith(ext))) {
            result.push(full)
          }
        }
      }
      walk(absPath)
    }
  }

  return result
}

// CLI runner
export function runCli(): void {
  const args = process.argv.slice(2)
  const command = args[0] || 'verify'
  const workspaceDir = process.cwd()

  if (command === 'compile') {
    const ledger = compileContractLedger(workspaceDir)
    const outputPath = args.includes('--output') ? args[args.indexOf('--output') + 1] : null

    if (outputPath) {
      fs.writeFileSync(
        path.resolve(workspaceDir, outputPath),
        JSON.stringify(ledger, null, 2),
        'utf-8',
      )
      console.log(`✓ Compiled contract ledger with ${ledger.rules.length} rules to ${outputPath}`)
    } else {
      console.log(JSON.stringify(ledger, null, 2))
    }
    process.exit(0)
  }

  if (command === 'verify') {
    const ledger = compileContractLedger(workspaceDir)
    const result = verifyContractLedger(ledger, workspaceDir)

    console.log(`📋 Contract Ledger Verification for: ${path.basename(workspaceDir)}`)
    console.log(
      `   Rules: ${result.totalRules} | Spokes: ${result.totalSpokes} | Hash: ${ledger.sourcesHash.slice(0, 8)}`,
    )

    if (result.passed && result.findings.length === 0) {
      console.log('✓ All hub-and-spoke links, paths, and rule definitions are clean!\n')
      process.exit(0)
    }

    if (result.findings.length > 0) {
      console.log(`\nFindings (${result.findings.length}):`)
      for (const f of result.findings) {
        const icon = f.severity === 'error' ? '❌' : f.severity === 'warning' ? '⚠️' : 'ℹ️'
        console.log(`  ${icon} [${f.code}] ${f.file}${f.line ? `:${f.line}` : ''}`)
        console.log(`     ${f.message}`)
        if (f.suggestion) console.log(`     ↳ Suggestion: ${f.suggestion}`)
      }
      console.log('')
    }

    process.exit(result.passed ? 0 : 1)
  }

  if (command === 'eval') {
    const ledgerIndex = args.indexOf('--ledger')
    const ledgerPath = ledgerIndex !== -1 ? args[ledgerIndex + 1] : null
    const targetArgs = args
      .slice(1)
      .filter(
        (a, idx) =>
          !a.startsWith('--') &&
          (ledgerIndex === -1 || (idx + 1 !== ledgerIndex && idx !== ledgerIndex)),
      )

    if (targetArgs.length === 0) {
      console.error('Usage: contract-ledger.ts eval [--ledger <path>] <files-or-dirs...>')
      process.exit(2)
    }

    let ledger: ContractLedger
    if (ledgerPath && fs.existsSync(path.resolve(workspaceDir, ledgerPath))) {
      ledger = JSON.parse(fs.readFileSync(path.resolve(workspaceDir, ledgerPath), 'utf-8'))
    } else {
      ledger = compileContractLedger(workspaceDir)
    }

    const targetFiles = collectCodeFiles(targetArgs, workspaceDir)
    if (targetFiles.length === 0) {
      console.log(`🔍 No code files found matching: ${targetArgs.join(', ')}`)
      process.exit(0)
    }

    const result = evaluateCodeAgainstContract(ledger, targetFiles)

    console.log(`🔍 Code Contract Evaluation: ${targetFiles.length} file(s) checked`)
    if (result.contractFindings.length > 0) {
      console.log(`\n⚠️ Contract Status Findings (${result.contractFindings.length}):`)
      for (const cf of result.contractFindings) {
        console.log(`  - ${cf.ruleTitle}: ${cf.message}`)
        console.log(`    ↳ Action: ${cf.suggestedAction}`)
      }
    }

    if (result.codeFindings.length > 0) {
      console.log(`\n❌ Code Alignment Findings (${result.codeFindings.length}):`)
      for (const cf of result.codeFindings) {
        console.log(`  - ${cf.file}:${cf.line} [${cf.ruleTitle}]`)
        console.log(`    ${cf.message}`)
      }
    }

    if (result.passed) {
      console.log('✓ Code is 100% aligned with active contract rules!')
      process.exit(0)
    }

    process.exit(result.codeFindings.length > 0 ? 1 : 0)
  }

  console.error(`Unknown command: ${command}. Use 'compile', 'verify', or 'eval'.`)
  process.exit(2)
}

if (process.argv[1]?.endsWith('contract-ledger.ts')) {
  runCli()
}
