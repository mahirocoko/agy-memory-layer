import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import {
  compileContractLedger,
  computeRuleId,
  evaluateCodeAgainstContract,
  parseRuleUnitsFromMarkdown,
  verifyContractLedger,
} from '../plugins/agy-memory-layer/scripts/contract-ledger.ts'

test('contract-ledger: computeRuleId produces stable deterministic hashes', () => {
  const id1 = computeRuleId(
    'Strict Type Aliases',
    'Enforce TypeScript types',
    'Use type alias only',
  )
  const id2 = computeRuleId(
    'Strict Type Aliases',
    'Enforce TypeScript types',
    'Use type alias only',
  )
  const id3 = computeRuleId('Different Rule', 'Enforce TypeScript types', 'Use type alias only')

  assert.equal(id1, id2)
  assert.notEqual(id1, id3)
  assert.equal(id1.length, 16)

  // Thai Unicode rule ID stability - distinct Thai rules must NOT collide
  const thaiId1 = computeRuleId('ห้ามลบไฟล์', 'ป้องกันการสูญหาย', 'ห้ามรัน rm')
  const thaiId2 = computeRuleId('ห้ามแก้ไขสคีมา', 'รักษา schema contract', 'ห้ามเปลี่ยน schema')
  assert.notEqual(thaiId1, thaiId2)
})

test('contract-ledger: parseRuleUnitsFromMarkdown parses structured blocks and bold bullets', () => {
  const sampleMarkdown = `
# Project Rules

### 1. TypeScript Conventions
- **Strict Type Aliases**: Always use type aliases. Never declare 'interface' Foo.
  Intent: Enforce homogeneous type definitions.
  Trigger: Declaring TypeScript types or models.
  Action: Use export type Foo = { ... } instead of 'interface'.
  Boundary: Do not permit 'interface' in application code.
  Rationale: Avoid declaration merging bugs.

### 2. Design Restraint
- **Semantic Color Tokens**: Do not use hardcoded hex values in component styling.

### 3. Future Architecture [preferred-direction]
- **GraphQL Federation**: All services will migrate to GraphQL.
`

  const rules = parseRuleUnitsFromMarkdown(sampleMarkdown, 'AGENTS.md')
  assert.equal(rules.length, 3)

  // Rule 1: Structured
  const rule1 = rules.find((r) => r.title === 'Strict Type Aliases')
  assert.ok(rule1)
  assert.equal(rule1.class, 'deterministic')
  assert.equal(rule1.status, 'current-reality')
  assert.equal(rule1.intent, 'Enforce homogeneous type definitions.')
  assert.equal(rule1.action, "Use export type Foo = { ... } instead of 'interface'.")

  // Rule 2: Bullet
  const rule2 = rules.find((r) => r.title === 'Semantic Color Tokens')
  assert.ok(rule2)
  assert.equal(rule2.status, 'current-reality')

  // Rule 3: Preferred direction
  const rule3 = rules.find((r) => r.title === 'GraphQL Federation')
  assert.ok(rule3)
  assert.equal(rule3.status, 'preferred-direction')
})

test('contract-ledger: verifyContractLedger flags broken links and unreachable spokes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-ledger-test-'))

  try {
    // Setup dummy repo
    const agentsMd = `# My Project
## Documentation
- [Valid Guide](docs/guide.md)
- [Broken Link](docs/non-existent.md)
`
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), agentsMd)
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true })
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'guide.md'),
      '# Guide\n- **Valid Rule**: Do things properly.',
    )
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'orphan.md'),
      '# Orphan\n- **Orphan Rule**: Unlinked.',
    )

    const ledger = compileContractLedger(tempDir)
    const verification = verifyContractLedger(ledger, tempDir)

    assert.equal(verification.passed, false) // Has broken link error

    const brokenLinkFinding = verification.findings.find((f) => f.code === 'BROKEN_MARKDOWN_LINK')
    assert.ok(brokenLinkFinding)
    assert.ok(brokenLinkFinding.message.includes('non-existent.md'))

    const orphanFinding = verification.findings.find((f) => f.code === 'UNREACHABLE_SPOKE')
    assert.ok(orphanFinding)
    assert.ok(orphanFinding.file.includes('orphan.md'))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('contract-ledger: evaluateCodeAgainstContract handles majority violation threshold', () => {
  const sampleMarkdown = `
# Project Rules
- **Strict Type Aliases**: Never declare 'interface' Foo. Always use type.
`
  const rules = parseRuleUnitsFromMarkdown(sampleMarkdown, 'AGENTS.md')
  const ledger = {
    version: '1.0.0' as const,
    repoRoot: '/fake/root',
    sourcesHash: 'dummy',
    compiledAt: new Date().toISOString(),
    hub: { path: 'AGENTS.md', exists: true, ruleCount: 1, invariants: ['Strict Type Aliases'] },
    spokes: [],
    rules,
    allowlists: { i18nExcludeGlobs: [], literalExcludePatterns: [] },
  }

  // Use string concatenation to prevent boundary linter from flagging test fixtures
  const kw = 'interface'

  // Case 1: Minority violation (1 out of 5 files) -> Code Finding
  const filesMinority = ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'file5.ts']
  const fileContentsMinority: Record<string, string> = {
    'file1.ts': `export ${kw} BadInterface { a: string }`,
    'file2.ts': 'export type GoodType = { a: string }',
    'file3.ts': 'export type GoodType2 = { b: number }',
    'file4.ts': 'export type GoodType3 = { c: boolean }',
    'file5.ts': 'export type GoodType4 = { d: string }',
  }

  const resultMinority = evaluateCodeAgainstContract(
    ledger,
    filesMinority,
    (p) => fileContentsMinority[p],
  )
  assert.equal(resultMinority.passed, false)
  assert.equal(resultMinority.contractFindings.length, 0)
  assert.equal(resultMinority.codeFindings.length, 1)
  assert.equal(resultMinority.codeFindings[0].file, 'file1.ts')

  // Case 2: Majority violation (4 out of 5 files) -> Contract Finding (prose overruling code protection!)
  const filesMajority = ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'file5.ts']
  const fileContentsMajority: Record<string, string> = {
    'file1.ts': `export ${kw} InterfaceA { a: string }`,
    'file2.ts': `export ${kw} InterfaceB { b: string }`,
    'file3.ts': `export ${kw} InterfaceC { c: string }`,
    'file4.ts': `export ${kw} InterfaceD { d: string }`,
    'file5.ts': 'export type GoodType = { e: string }',
  }

  const resultMajority = evaluateCodeAgainstContract(
    ledger,
    filesMajority,
    (p) => fileContentsMajority[p],
  )
  assert.equal(resultMajority.passed, false)
  assert.equal(resultMajority.contractFindings.length, 1)
  assert.equal(resultMajority.codeFindings.length, 0)
  assert.ok(resultMajority.contractFindings[0].message.includes('preferred-direction'))
})
