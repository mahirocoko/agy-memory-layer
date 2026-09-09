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

export type EvaluatorId =
  | 'no-interface'
  | 'inline-dictionary'
  | 'max-lines'
  | 'forbidden-pattern'
  | 'required-pattern'
  | 'comment-taxonomy'

export type FindingSeverity = 'violation' | 'lead'

export type CheckDirective = {
  evaluator: EvaluatorId
  scope?: string
  limit?: number
  pattern?: string
  allow?: string[]
  severity?: FindingSeverity
}

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
  check?: CheckDirective
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
  severity: FindingSeverity
  ruleId: string
  ruleTitle: string
  file?: string
  line?: number
  message: string
  snippet?: string
  suggestedAction: string
  diffSuppressed?: boolean
}

export type RuleCoverage = {
  ruleId: string
  title: string
  owner: string
  declaredClass: RuleClass
  evaluators: EvaluatorId[]
  applicableFiles: number
}

export type EvaluationVerdict =
  | 'deterministic-clean'
  | 'deterministic-violations'
  | 'contract-dispute'

export type CodeEvaluationResult = {
  totalFilesChecked: number
  coverage: {
    evaluated: RuleCoverage[]
    unevaluated: RuleCoverage[]
    ratio: number
  }
  verdict: EvaluationVerdict
  passed: boolean
  deterministicPassed: boolean
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

function parseCheckDirective(text: string): CheckDirective | undefined {
  const match = text.match(/(?:^|[\n\r])\s*(?:\*\*)?Check\s*[:：]\s*([^\n\r]+)/i)
  if (!match) return undefined
  let raw = match[1].trim()
  if (raw.endsWith('**')) raw = raw.slice(0, -2).trim()

  const evalMatch = raw.match(/^([a-z0-9-]+)(?:\s+(.*))?$/i)
  if (!evalMatch) return undefined
  const evaluator = evalMatch[1].toLowerCase() as EvaluatorId
  const validEvaluators: EvaluatorId[] = [
    'no-interface',
    'inline-dictionary',
    'max-lines',
    'forbidden-pattern',
    'required-pattern',
    'comment-taxonomy',
  ]
  if (!validEvaluators.includes(evaluator)) return undefined

  const dir: CheckDirective = { evaluator }
  const rest = evalMatch[2] || ''

  const paramRegex = /(?:^|\s+)(scope|limit|pattern|allow|severity)=(?:"([^"]*)"|'([^']*)'|(\S+))/g
  let pMatch = paramRegex.exec(rest)
  while (pMatch !== null) {
    const key = pMatch[1]
    const val = pMatch[2] ?? pMatch[3] ?? pMatch[4] ?? ''
    if (key === 'scope') {
      dir.scope = val
    } else if (key === 'limit') {
      const parsedLimit = parseInt(val, 10)
      if (!Number.isNaN(parsedLimit)) dir.limit = parsedLimit
    } else if (key === 'pattern') {
      dir.pattern = val
    } else if (key === 'allow') {
      dir.allow = val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (key === 'severity') {
      if (val === 'violation' || val === 'lead') {
        dir.severity = val
      }
    }
    pMatch = paramRegex.exec(rest)
  }
  return dir
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

      // Look ahead up to 10 lines for structured Intent/Trigger/Action/Boundary/Rationale/Check
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
      const check = parseCheckDirective(fullText)

      const ruleId = computeRuleId(title, intent, action)
      const ruleClass = check ? 'deterministic' : classifyRule(`${title} ${fullText}`)
      const status = determineStatus(filePath, currentSection, fullText)

      // Infer default scope
      let scope: string[] = ['**/*.ts', '**/*.tsx']
      if (check?.scope) {
        scope = check.scope
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      } else if (title.toLowerCase().includes('doc') || title.toLowerCase().includes('markdown')) {
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
        check,
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

function matchesGlob(filePath: string, globPattern: string): boolean {
  const normFile = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  const normGlob = globPattern.replace(/\\/g, '/').replace(/^\.\//, '')
  if (normGlob === '**/*' || normGlob === '*' || normGlob === '') return true

  const regexStr = normGlob
    .replace(/\*\*\//g, '___GLOBSTAR_SLASH___')
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '___STAR___')
    .replace(/\?/g, '___QUESTION___')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/___GLOBSTAR_SLASH___/g, '(?:.*/)?')
    .replace(/___GLOBSTAR___/g, '.*')
    .replace(/___STAR___/g, '[^/]*')
    .replace(/___QUESTION___/g, '[^/]')

  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(normFile)
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
    {
      rule: RuleUnit
      applicableCount: number
      files: {
        file: string
        line: number
        snippet: string
        message: string
        severity: FindingSeverity
      }[]
    }
  >()

  const evaluatedCoverage: RuleCoverage[] = []
  const unevaluatedCoverage: RuleCoverage[] = []

  // Resolve bound evaluators for each active rule
  for (const rule of activeRules) {
    const boundEvaluators: EvaluatorId[] = []
    if (rule.check) {
      boundEvaluators.push(rule.check.evaluator)
    } else {
      // Backward-compatible fallback heuristics
      const text = `${rule.title} ${rule.action} ${rule.intent}`.toLowerCase()
      if (
        (rule.class === 'deterministic' || text.includes('type') || text.includes('interface')) &&
        text.includes('interface') &&
        (text.includes('type') ||
          text.includes('never declare') ||
          text.includes('do not declare') ||
          text.includes('no interface') ||
          text.includes('zero interface') ||
          text.includes('prohibit'))
      ) {
        boundEvaluators.push('no-interface')
      } else if (
        rule.title.toLowerCase().includes('constant') ||
        rule.action.toLowerCase().includes('inline dictionary')
      ) {
        boundEvaluators.push('inline-dictionary')
      }
    }

    // Determine applicable target files for this rule
    const applicableTargetFiles = filePaths.filter((fp) => {
      if (!rule.scope || rule.scope.length === 0) return true
      const relFp =
        path.isAbsolute(fp) && ledger.repoRoot
          ? path.relative(ledger.repoRoot, fp).replace(/\\/g, '/')
          : fp.replace(/\\/g, '/')
      const rawFp = fp.replace(/\\/g, '/')
      return rule.scope.some(
        (pattern) => matchesGlob(relFp, pattern) || matchesGlob(rawFp, pattern),
      )
    })

    if (boundEvaluators.length > 0) {
      evaluatedCoverage.push({
        ruleId: rule.id,
        title: rule.title,
        owner: rule.owner,
        declaredClass: rule.class,
        evaluators: boundEvaluators,
        applicableFiles: applicableTargetFiles.length,
      })

      // Run bound evaluators across applicable target files
      for (const filePath of applicableTargetFiles) {
        let content = ''
        try {
          content = readFileFn(filePath)
        } catch {
          continue
        }

        const cleanContent = content.replace(/\r?\n$/, '')
        const lines = cleanContent === '' ? [] : cleanContent.split(/\r?\n/)

        for (const evalId of boundEvaluators) {
          if (evalId === 'no-interface') {
            if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim()
                if (!line.startsWith('//') && !line.startsWith('*')) {
                  const match = line.match(/\b(export\s+)?interface\s+([A-Z]\w*)\b/)
                  if (match && !line.includes("'interface'") && !line.includes('"interface"')) {
                    let entry = violationsByRule.get(rule.id)
                    if (!entry) {
                      entry = { rule, applicableCount: applicableTargetFiles.length, files: [] }
                      violationsByRule.set(rule.id, entry)
                    }
                    entry.files.push({
                      file: filePath,
                      line: i + 1,
                      snippet: line,
                      message: `Violates '${rule.title}': ${rule.action || 'Do not declare interface'}`,
                      severity: 'violation',
                    })
                  }
                }
              }
            }
          } else if (evalId === 'inline-dictionary') {
            if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim()
                if (line.match(/const\s+\w+_(?:LABELS|MAP|TITLES)\s*[:=]\s*\{/)) {
                  let entry = violationsByRule.get(rule.id)
                  if (!entry) {
                    entry = { rule, applicableCount: applicableTargetFiles.length, files: [] }
                    violationsByRule.set(rule.id, entry)
                  }
                  entry.files.push({
                    file: filePath,
                    line: i + 1,
                    snippet: line,
                    message: `Violates '${rule.title}': Inline dictionary detected`,
                    severity: 'violation',
                  })
                }
              }
            }
          } else if (evalId === 'max-lines') {
            const limit = rule.check?.limit || 100
            if (lines.length > limit) {
              let entry = violationsByRule.get(rule.id)
              if (!entry) {
                entry = { rule, applicableCount: applicableTargetFiles.length, files: [] }
                violationsByRule.set(rule.id, entry)
              }
              entry.files.push({
                file: filePath,
                line: 1,
                snippet: `Total lines: ${lines.length} (limit: ${limit})`,
                message: `Violates '${rule.title}': File exceeds line limit (${lines.length} > ${limit})`,
                severity: rule.check?.severity || 'violation',
              })
            }
          } else if (evalId === 'forbidden-pattern') {
            if (!rule.check?.pattern) {
              contractFindings.push({
                type: 'contract-finding',
                severity: 'violation',
                ruleId: rule.id,
                ruleTitle: rule.title,
                message: `Rule '${rule.title}' specifies 'forbidden-pattern' but is missing required 'pattern=' attribute in Check directive.`,
                suggestedAction: `Specify pattern="..." in Check directive.`,
              })
            } else {
              let regex: RegExp
              try {
                regex = new RegExp(rule.check.pattern)
              } catch (err) {
                contractFindings.push({
                  type: 'contract-finding',
                  severity: 'violation',
                  ruleId: rule.id,
                  ruleTitle: rule.title,
                  message: `Rule '${rule.title}' has invalid regex pattern '${rule.check.pattern}': ${err instanceof Error ? err.message : String(err)}`,
                  suggestedAction: `Fix regex syntax in Check directive.`,
                })
                continue
              }
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i]
                if (regex.test(line)) {
                  let entry = violationsByRule.get(rule.id)
                  if (!entry) {
                    entry = { rule, applicableCount: applicableTargetFiles.length, files: [] }
                    violationsByRule.set(rule.id, entry)
                  }
                  entry.files.push({
                    file: filePath,
                    line: i + 1,
                    snippet: line.trim(),
                    message: `Violates forbidden pattern '${rule.check.pattern}' in '${rule.title}'`,
                    severity: rule.check.severity || 'violation',
                  })
                }
              }
            }
          } else if (evalId === 'required-pattern') {
            if (!rule.check?.pattern) {
              contractFindings.push({
                type: 'contract-finding',
                severity: 'violation',
                ruleId: rule.id,
                ruleTitle: rule.title,
                message: `Rule '${rule.title}' specifies 'required-pattern' but is missing required 'pattern=' attribute in Check directive.`,
                suggestedAction: `Specify pattern="..." in Check directive.`,
              })
            } else {
              let regex: RegExp
              try {
                regex = new RegExp(rule.check.pattern)
              } catch (err) {
                contractFindings.push({
                  type: 'contract-finding',
                  severity: 'violation',
                  ruleId: rule.id,
                  ruleTitle: rule.title,
                  message: `Rule '${rule.title}' has invalid regex pattern '${rule.check.pattern}': ${err instanceof Error ? err.message : String(err)}`,
                  suggestedAction: `Fix regex syntax in Check directive.`,
                })
                continue
              }
              if (!regex.test(content)) {
                let entry = violationsByRule.get(rule.id)
                if (!entry) {
                  entry = { rule, applicableCount: applicableTargetFiles.length, files: [] }
                  violationsByRule.set(rule.id, entry)
                }
                entry.files.push({
                  file: filePath,
                  line: 1,
                  snippet: `Missing required pattern: ${rule.check.pattern}`,
                  message: `Violates '${rule.title}': File missing required pattern '${rule.check.pattern}'`,
                  severity: rule.check.severity || 'violation',
                })
              }
            }
          } else if (evalId === 'comment-taxonomy') {
            const allowed = rule.check?.allow || []
            if (allowed.length === 0) {
              contractFindings.push({
                type: 'contract-finding',
                severity: 'violation',
                ruleId: rule.id,
                ruleTitle: rule.title,
                message: `Rule '${rule.title}' specifies 'comment-taxonomy' but is missing required 'allow=' attribute in Check directive.`,
                suggestedAction: `Specify allow=_Tag1,_Tag2 in Check directive.`,
              })
            } else {
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim()
                const match = line.match(/^\/\/\s*(_[A-Za-z0-9_-]+)\s*$/)
                if (match) {
                  const tag = match[1].trim()
                  if (!allowed.includes(tag)) {
                    let entry = violationsByRule.get(rule.id)
                    if (!entry) {
                      entry = { rule, applicableCount: applicableTargetFiles.length, files: [] }
                      violationsByRule.set(rule.id, entry)
                    }
                    entry.files.push({
                      file: filePath,
                      line: i + 1,
                      snippet: line,
                      message: `Section comment tag '// ${tag}' not in allowed taxonomy: [${allowed.join(', ')}]`,
                      severity: rule.check?.severity || 'violation',
                    })
                  }
                }
              }
            }
          }
        }
      }
    } else {
      unevaluatedCoverage.push({
        ruleId: rule.id,
        title: rule.title,
        owner: rule.owner,
        declaredClass: rule.class,
        evaluators: [],
        applicableFiles: applicableTargetFiles.length,
      })
    }
  }

  // Evaluate majority violation threshold to prevent "prose overruling code"
  const totalScanned = filePaths.length

  for (const [ruleId, entry] of violationsByRule.entries()) {
    const violatingFilesCount = new Set(entry.files.map((f) => f.file)).size
    // Hub invariants (from AGENTS.md or tagged invariant) are NEVER outvotable or reclassified!
    const isHubInvariant =
      ledger.hub.invariants.includes(entry.rule.title) ||
      entry.rule.owner.includes('AGENTS.md') ||
      entry.rule.tags.includes('invariant')

    // Strict majority: strictly more than 50% of applicable files violate the rule, with at least 3 files evaluated
    const isMajority =
      !isHubInvariant &&
      entry.applicableCount > 2 &&
      violatingFilesCount * 2 > entry.applicableCount

    if (isMajority) {
      // Majority of files violate a non-hub spoke rule: this is a CONTRACT finding
      contractFindings.push({
        type: 'contract-finding',
        severity: 'violation',
        ruleId,
        ruleTitle: entry.rule.title,
        message: `Rule '${entry.rule.title}' is violated by ${violatingFilesCount}/${entry.applicableCount} files (> 50%). In reality, this pattern is 'preferred-direction', not 'current-reality'.`,
        suggestedAction: `Reclassify rule status in '${entry.rule.owner}' to 'preferred-direction' or update AGENTS.md via /contract-refine before attempting code refactoring.`,
      })
      // Keep code findings with diffSuppressed: true so findings are never hidden
      for (const f of entry.files) {
        codeFindings.push({
          type: 'code-finding',
          severity: f.severity,
          ruleId,
          ruleTitle: entry.rule.title,
          file: f.file,
          line: f.line,
          snippet: f.snippet,
          message: f.message,
          suggestedAction: `Contract in dispute. Await resolution before refactoring.`,
          diffSuppressed: true,
        })
      }
    } else {
      for (const f of entry.files) {
        codeFindings.push({
          type: 'code-finding',
          severity: f.severity,
          ruleId,
          ruleTitle: entry.rule.title,
          file: f.file,
          line: f.line,
          snippet: f.snippet,
          message: f.message,
          suggestedAction: `Refactor line ${f.line} in ${f.file} according to ${entry.rule.owner}.`,
          diffSuppressed: false,
        })
      }
    }
  }

  const activeInScopeCount = evaluatedCoverage.length + unevaluatedCoverage.length
  const ratio = activeInScopeCount > 0 ? evaluatedCoverage.length / activeInScopeCount : 1.0

  const hasContractDispute = contractFindings.length > 0
  const hasCodeViolations = codeFindings.some(
    (f) => f.severity === 'violation' && !f.diffSuppressed,
  )

  let verdict: EvaluationVerdict = 'deterministic-clean'
  if (hasCodeViolations) {
    verdict = 'deterministic-violations'
  } else if (hasContractDispute) {
    verdict = 'contract-dispute'
  }

  const passed = verdict === 'deterministic-clean' && ratio === 1.0
  const deterministicPassed = verdict === 'deterministic-clean'

  return {
    totalFilesChecked: totalScanned,
    coverage: {
      evaluated: evaluatedCoverage,
      unevaluated: unevaluatedCoverage,
      ratio,
    },
    verdict,
    passed,
    deterministicPassed,
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
    const isJson = args.includes('--json')
    const isDeterministicOnly = args.includes('--deterministic-only')

    const targetArgs = args.slice(1).filter((a, idx) => {
      if (a === '--json' || a === '--deterministic-only') return false
      if (a.startsWith('--')) return false
      if (ledgerIndex !== -1 && (idx + 1 === ledgerIndex || idx === ledgerIndex)) return false
      return true
    })

    if (targetArgs.length === 0) {
      console.error(
        'Usage: contract-ledger.ts eval [--ledger <path>] [--json] [--deterministic-only] <files-or-dirs...>',
      )
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
      if (isJson) {
        console.log(
          JSON.stringify({
            totalFilesChecked: 0,
            coverage: { evaluated: [], unevaluated: [], ratio: 1.0 },
            verdict: 'deterministic-clean',
            passed: true,
            deterministicPassed: true,
            contractFindings: [],
            codeFindings: [],
          }),
        )
      } else {
        console.log(`🔍 No code files found matching: ${targetArgs.join(', ')}`)
      }
      process.exit(0)
    }

    const result = evaluateCodeAgainstContract(ledger, targetFiles)

    if (isJson) {
      console.log(JSON.stringify(result, null, 2))
      if (result.verdict === 'deterministic-violations') process.exit(1)
      if (result.verdict === 'contract-dispute') process.exit(4)
      if (result.coverage.ratio === 1.0 || isDeterministicOnly) process.exit(0)
      process.exit(3) // REVIEW_REQUIRED
    }

    const totalActiveInScope = result.coverage.evaluated.length + result.coverage.unevaluated.length
    const coveragePct = Math.round(result.coverage.ratio * 100)
    const violationsCount = result.codeFindings.filter(
      (f) => f.severity === 'violation' && !f.diffSuppressed,
    ).length
    const leadsCount = result.codeFindings.filter(
      (f) => f.severity === 'lead' && !f.diffSuppressed,
    ).length

    const heuristicCount = result.coverage.unevaluated.filter(
      (r) => r.declaredClass === 'heuristic',
    ).length
    const humanCount = result.coverage.unevaluated.filter(
      (r) => r.declaredClass === 'human-only',
    ).length
    const declaredDetCount = result.coverage.unevaluated.filter(
      (r) => r.declaredClass === 'deterministic',
    ).length

    console.log(
      `🔍 Code Contract Evaluation: ${targetFiles.length} file(s) checked | ${totalActiveInScope} active rule(s) in scope`,
    )
    console.log(
      `   Deterministic: ${result.coverage.evaluated.length} rule(s) bound to evaluators — ${violationsCount} violation(s), ${leadsCount} lead(s)`,
    )
    console.log(
      `   Unevaluated:   ${result.coverage.unevaluated.length} rule(s) (${heuristicCount} heuristic, ${humanCount} human-only, ${declaredDetCount} declared-deterministic without evaluator)`,
    )
    console.log(
      `   Coverage:      ${coveragePct}% → deterministic pass is NOT a compliance verdict. Heuristic review REQUIRED.`,
    )

    if (result.contractFindings.length > 0) {
      console.log(`\n⚠️ Contract Status Findings (${result.contractFindings.length}):`)
      for (const cf of result.contractFindings) {
        console.log(`  - [${cf.ruleTitle}] ${cf.message}`)
        console.log(`    ↳ Action: ${cf.suggestedAction}`)
      }
    }

    if (result.codeFindings.length > 0) {
      console.log(`\nFindings (${result.codeFindings.length}):`)
      for (const cf of result.codeFindings) {
        const icon = cf.diffSuppressed ? '⚠️' : cf.severity === 'violation' ? '❌' : 'ℹ️'
        const tag = cf.diffSuppressed
          ? '[DISPUTED]'
          : cf.severity === 'violation'
            ? '[VIOLATION]'
            : '[LEAD]'
        console.log(`  ${icon} ${tag} ${cf.file}:${cf.line} [${cf.ruleTitle}]`)
        console.log(`     ${cf.message}`)
        if (cf.suggestedAction) console.log(`     ↳ ${cf.suggestedAction}`)
      }
    }

    if (result.verdict === 'deterministic-violations') {
      console.log(
        `\n❌ Deterministic violations found (${violationsCount} violation(s)). Fix code before proceeding.`,
      )
      process.exit(1)
    }

    if (result.verdict === 'contract-dispute') {
      console.log(
        `\n⚠️ Contract dispute detected. In reality this pattern is disputed; route to /contract-refine.`,
      )
      process.exit(4)
    }

    // Deterministic clean
    if (result.coverage.ratio === 1.0 || isDeterministicOnly) {
      console.log(`\n✓ Deterministic rules evaluated cleanly (Coverage: ${coveragePct}%).`)
      process.exit(0)
    }

    console.log(
      `\nℹ️ Deterministic checks passed for evaluated rules, but ${result.coverage.unevaluated.length} unevaluated rule(s) require model heuristic review.`,
    )
    console.log(
      `   Run model review on unevaluated rules and verify with 'contract-ledger.ts verdict'.`,
    )
    process.exit(3) // REVIEW_REQUIRED
  }

  if (command === 'verdict') {
    const evalIndex = args.indexOf('--eval')
    const reviewIndex = args.indexOf('--review')
    const evalPath = evalIndex !== -1 ? args[evalIndex + 1] : null
    const reviewPath = reviewIndex !== -1 ? args[reviewIndex + 1] : null

    if (!evalPath || !reviewPath) {
      console.error(
        'Usage: contract-ledger.ts verdict --eval <eval-result.json> --review <heuristic-review.json>',
      )
      process.exit(2)
    }

    const absEval = path.isAbsolute(evalPath) ? evalPath : path.resolve(workspaceDir, evalPath)
    const absReview = path.isAbsolute(reviewPath)
      ? reviewPath
      : path.resolve(workspaceDir, reviewPath)

    if (!fs.existsSync(absEval)) {
      console.error(`Error: eval file not found at ${absEval}`)
      process.exit(2)
    }
    if (!fs.existsSync(absReview)) {
      console.error(`Error: review file not found at ${absReview}`)
      process.exit(2)
    }

    const evalResult: CodeEvaluationResult = JSON.parse(fs.readFileSync(absEval, 'utf-8'))
    const reviewData: {
      assessedBy?: string
      reviews: Array<{
        ruleId: string
        ruleTitle?: string
        verdict: 'pass' | 'violation' | 'not-applicable' | 'cannot-assess'
        rationale?: string
      }>
    } = JSON.parse(fs.readFileSync(absReview, 'utf-8'))

    if (!reviewData || !Array.isArray(reviewData.reviews)) {
      console.error("Error: review file must contain a 'reviews' array.")
      process.exit(2)
    }

    if (evalResult.totalFilesChecked === 0) {
      console.error('Error: eval result checked 0 files; cannot grant ALIGNED.')
      process.exit(2)
    }

    const seenReviewRules = new Set<string>()
    for (const r of reviewData.reviews) {
      if (seenReviewRules.has(r.ruleId)) {
        console.error(
          `Error: duplicate review entry for rule ID '${r.ruleId}' detected in review file.`,
        )
        process.exit(2)
      }
      seenReviewRules.add(r.ruleId)
    }

    if (evalResult.verdict !== 'deterministic-clean') {
      console.log(
        `❌ Evaluation verdict is '${evalResult.verdict}'; cannot declare aligned until violations/disputes are resolved.`,
      )
      process.exit(evalResult.verdict === 'contract-dispute' ? 4 : 1)
    }

    const reviewsByRuleId = new Map(reviewData.reviews.map((r) => [r.ruleId, r]))
    const unassessed: RuleCoverage[] = []
    const heuristicViolations: string[] = []

    for (const unevaluated of evalResult.coverage.unevaluated) {
      const review = reviewsByRuleId.get(unevaluated.ruleId)
      if (
        !review ||
        review.verdict === 'cannot-assess' ||
        !['pass', 'not-applicable', 'violation'].includes(review.verdict)
      ) {
        unassessed.push(unevaluated)
      } else if (review.verdict === 'violation') {
        heuristicViolations.push(
          `${unevaluated.title}: ${review.rationale || 'Violation reported'}`,
        )
      }
    }

    if (heuristicViolations.length > 0) {
      console.log(`\n❌ Heuristic review reported ${heuristicViolations.length} violation(s):`)
      for (const hv of heuristicViolations) {
        console.log(`  - ${hv}`)
      }
      process.exit(1)
    }

    if (unassessed.length > 0) {
      console.log(`\n⚠️ INCOMPLETE REVIEW: ${unassessed.length} rule(s) lack a definitive verdict:`)
      for (const u of unassessed) {
        console.log(`  - [${u.ruleId}] ${u.title} (${u.owner})`)
      }
      console.log(`   Tool refuses to grant ALIGNED until all active rules are assessed.`)
      process.exit(3)
    }

    const totalEvaluatedCount = evalResult.coverage.evaluated.length
    const totalHeuristicCount = evalResult.coverage.unevaluated.length
    console.log(
      `\n✓ VERDICT: ALIGNED (${totalEvaluatedCount + totalHeuristicCount} rules assessed: ${totalEvaluatedCount} deterministic, ${totalHeuristicCount} heuristic)`,
    )
    process.exit(0)
  }

  console.error(`Unknown command: ${command}. Use 'compile', 'verify', 'eval', or 'verdict'.`)
  process.exit(2)
}

if (process.argv[1]?.endsWith('contract-ledger.ts')) {
  runCli()
}
