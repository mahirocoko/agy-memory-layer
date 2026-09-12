import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import {
  type CodeEvaluationResult,
  type ContractLedger,
  compileContractLedger,
  computeRuleId,
  evaluateCodeAgainstContract,
  parseRuleUnitsFromMarkdown,
  verifyContractLedger,
} from '../plugins/agy-memory-layer/scripts/contract-ledger.ts'
import {
  buildOwnerManifest,
  buildTargetManifest,
  computeEvaluationHash,
  computeProposalHash,
  createContractSnapshot,
  sha256,
  stableJson,
  verifyContractSnapshot,
} from '../plugins/agy-memory-layer/scripts/contract-snapshot.ts'

const bindingFixtures = [
  {
    name: 'interface permission with I-prefix naming',
    markdown:
      '- **Type and interface naming**: Interfaces are permitted. Prefix interface names with I; type aliases need no prefix.',
    bound: false,
  },
  {
    name: 'type preference is not a prohibition',
    markdown: '- **Declaration preference**: Prefer type over interface.',
    bound: false,
  },
  {
    name: 'unrelated prohibition cannot bind interface mentions',
    markdown: '- **Declaration naming**: Never declare any types. Interfaces must use an I prefix.',
    bound: false,
  },
  {
    name: 'qualified prohibition requires explicit review',
    markdown:
      '- **Declaration policy**: Do not declare interface unless needed for declaration merging.',
    bound: false,
  },
  {
    name: 'explicit no-interface binding',
    markdown:
      '- **Declaration policy**: Use aliases.\n  Check: no-interface scope=**/*.ts,**/*.tsx',
    bound: true,
  },
  {
    name: 'unambiguous legacy prohibition',
    markdown: "- **Declaration policy**: Do not declare 'interface'.",
    bound: true,
  },
]

for (const fixture of bindingFixtures) {
  test(`contract-ledger: isolated CLI binding — ${fixture.name}`, () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-binding-'))
    try {
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), `${fixture.markdown}\n`)
      const kw = 'interface'
      fs.writeFileSync(path.join(tempDir, 'sample.ts'), `export ${kw} IUser { id: string }\n`)
      const result = spawnSync(
        process.execPath,
        [
          '--experimental-strip-types',
          path.resolve('plugins/agy-memory-layer/scripts/contract-ledger.ts'),
          'eval',
          '--unsafe-live-contract',
          '--json',
          'sample.ts',
        ],
        { cwd: tempDir, env: { ...process.env, HOME: tempDir }, encoding: 'utf-8' },
      )
      assert.equal(result.status, fixture.bound ? 1 : 3, result.stderr || result.stdout)
      const evaluation: CodeEvaluationResult = JSON.parse(result.stdout)
      assert.equal(evaluation.coverage.evaluated.length, fixture.bound ? 1 : 0)
      assert.equal(evaluation.coverage.unevaluated.length, fixture.bound ? 0 : 1)
      assert.equal(evaluation.codeFindings.length, fixture.bound ? 1 : 0)
      assert.equal(evaluation.contractFindings.length, 0)
      assert.equal(evaluation.passed, false)
      assert.equal(evaluation.deterministicPassed, !fixture.bound)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
}

test('contract-ledger: actual Thai type-only hub rule binds explicitly', () => {
  const ledger = compileContractLedger(process.cwd())
  const rule = ledger.rules.find((candidate) => candidate.title === 'Strict `type` Aliases')
  assert.ok(rule)
  assert.ok(rule.action.includes('ห้ามใช้ `interface`'))
  assert.equal(rule.check?.evaluator, 'no-interface')
  assert.deepEqual(rule.scope, ['**/*.ts', '**/*.tsx'])
  assert.ok(rule.owner.startsWith('AGENTS.md#L'))
  const kw = 'interface'
  const result = evaluateCodeAgainstContract(
    { ...ledger, rules: [rule] },
    ['probe.ts', 'probe.tsx', 'probe.js'],
    () => `export ${kw} IUser { id: string }`,
  )
  assert.deepEqual(result.coverage.evaluated[0].evaluators, ['no-interface'])
  assert.equal(result.coverage.evaluated[0].applicableFiles, 2)
  assert.equal(result.codeFindings.length, 2)
  assert.equal(result.verdict, 'deterministic-violations')
  const clean = evaluateCodeAgainstContract(
    { ...ledger, rules: [rule] },
    ['probe.ts'],
    () => 'export type User = { id: string }',
  )
  assert.equal(clean.passed, true)
})

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
# Spoke Rules
- **Non Hub Spoke Rule**: Do not declare 'interface'.
`
  const rules = parseRuleUnitsFromMarkdown(sampleMarkdown, 'docs/patterns/spoke.md')
  const ledger = {
    version: '1.0.0' as const,
    repoRoot: '/fake/root',
    sourcesHash: 'dummy',
    compiledAt: new Date().toISOString(),
    hub: { path: 'AGENTS.md', exists: true, ruleCount: 0, invariants: [] },
    spokes: [
      {
        path: 'docs/patterns/spoke.md',
        title: 'Spoke',
        ruleCount: 1,
        isHistorical: false,
        isReachable: true,
      },
    ],
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
  assert.equal(resultMinority.deterministicPassed, false)
  assert.equal(resultMinority.verdict, 'deterministic-violations')
  assert.equal(resultMinority.contractFindings.length, 0)
  assert.equal(resultMinority.codeFindings.length, 1)
  assert.equal(resultMinority.codeFindings[0].file, 'file1.ts')
  assert.equal(resultMinority.codeFindings[0].diffSuppressed, false)

  // Case 2: Majority violation (4 out of 5 files) on Spoke rule -> Contract Finding + preserved diff-suppressed code findings
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
  assert.equal(resultMajority.verdict, 'contract-dispute')
  assert.equal(resultMajority.contractFindings.length, 1)
  assert.ok(resultMajority.contractFindings[0].message.includes('preferred-direction'))
  // Code findings are preserved for evidence, marked with diffSuppressed: true
  assert.equal(resultMajority.codeFindings.length, 4)
  assert.ok(resultMajority.codeFindings.every((f) => f.diffSuppressed === true))
})

test('contract-ledger: Hub invariants can NEVER be outvoted by majority drift', () => {
  const sampleMarkdown = `
# Project Rules
- **Strict Invariant**: Never declare 'interface' Foo. Always use type.
  Check: no-interface scope=**/*.ts,**/*.tsx
`
  const rules = parseRuleUnitsFromMarkdown(sampleMarkdown, 'AGENTS.md')
  const ledger = {
    version: '1.0.0' as const,
    repoRoot: '/fake/root',
    sourcesHash: 'dummy',
    compiledAt: new Date().toISOString(),
    hub: { path: 'AGENTS.md', exists: true, ruleCount: 1, invariants: ['Strict Invariant'] },
    spokes: [],
    rules,
    allowlists: { i18nExcludeGlobs: [], literalExcludePatterns: [] },
  }

  const kw = 'interface'
  const files = ['file1.ts', 'file2.ts', 'file3.ts']
  const fileContents: Record<string, string> = {
    'file1.ts': `export ${kw} InterfaceA { a: string }`,
    'file2.ts': `export ${kw} InterfaceB { b: string }`,
    'file3.ts': `export ${kw} InterfaceC { c: string }`,
  }

  const result = evaluateCodeAgainstContract(ledger, files, (p) => fileContents[p])
  // Even though 100% of files violate the rule, hub invariants are NEVER downgraded to contract dispute!
  assert.equal(result.contractFindings.length, 0)
  assert.equal(result.codeFindings.length, 3)
  assert.equal(result.verdict, 'deterministic-violations')
  assert.ok(result.codeFindings.every((f) => f.diffSuppressed === false))
})

test('contract-ledger: Check directives (max-lines, forbidden-pattern, comment-taxonomy) and coverage tracking', () => {
  const sampleMarkdown = `
# Modular Architecture
- **Thin Route Orchestrators**: Routes must delegate to modules.
  Check: max-lines scope=app/routes/**/*.tsx limit=50

- **Restrained Typography**: Avoid extra bold text.
  Check: forbidden-pattern scope=**/*.tsx pattern=\\bfont-(extrabold|black)\\b severity=violation

- **Section Taxonomy**: Only recognized section headers.
  Check: comment-taxonomy scope=**/*.tsx allow=_State,_Query,_Mutation

- **Heuristic Rule Without Evaluator**: Ensure proper naming.
`
  const rules = parseRuleUnitsFromMarkdown(sampleMarkdown, 'docs/conventions.md')
  assert.equal(rules.length, 4)
  assert.ok(rules[0].check)
  assert.equal(rules[0].check?.evaluator, 'max-lines')
  assert.equal(rules[0].check?.limit, 50)

  const ledger = {
    version: '1.0.0' as const,
    repoRoot: '/fake/root',
    sourcesHash: 'dummy',
    compiledAt: new Date().toISOString(),
    hub: { path: 'AGENTS.md', exists: true, ruleCount: 0, invariants: [] },
    spokes: [],
    rules,
    allowlists: { i18nExcludeGlobs: [], literalExcludePatterns: [] },
  }

  const files = ['app/routes/big-route.tsx', 'app/components/clean.tsx']
  const fileContents: Record<string, string> = {
    'app/routes/big-route.tsx': `
// _State
const a = 1
// _UnknownTag
const b = 2
const c = 'font-extrabold'
${'\n'.repeat(60)}
`,
    'app/components/clean.tsx': `
// _State
const ok = true
`,
  }

  const result = evaluateCodeAgainstContract(ledger, files, (p) => fileContents[p])
  // Coverage: 3 evaluated, 1 unevaluated (Heuristic Rule Without Evaluator)
  assert.equal(result.coverage.evaluated.length, 3)
  assert.equal(result.coverage.unevaluated.length, 1)
  assert.equal(result.coverage.unevaluated[0].title, 'Heuristic Rule Without Evaluator')
  assert.equal(result.coverage.ratio, 0.75)
  assert.equal(result.verdict, 'deterministic-violations')

  // Check finding details
  const maxLinesFinding = result.codeFindings.find(
    (f) => f.ruleTitle === 'Thin Route Orchestrators',
  )
  assert.ok(maxLinesFinding)
  assert.ok(maxLinesFinding.message.includes('exceeds line limit'))

  const forbiddenFinding = result.codeFindings.find((f) => f.ruleTitle === 'Restrained Typography')
  assert.ok(forbiddenFinding)

  const taxonomyFinding = result.codeFindings.find((f) => f.ruleTitle === 'Section Taxonomy')
  assert.ok(taxonomyFinding)
  assert.ok(taxonomyFinding.message.includes('_UnknownTag'))
})

test('contract-ledger: snapshot-bound verdict enforces complete heuristic review', () => {
  const tempDir = initializeSnapshotRepo('# Rules\n- **Naming**: Keep names clear.')

  try {
    const evalPath = path.join(tempDir, 'eval.json')
    const reviewPath = path.join(tempDir, 'review.json')
    const scriptPath = path.resolve(
      process.cwd(),
      'plugins/agy-memory-layer/scripts/contract-ledger.ts',
    )

    // Eval result with 2 unevaluated rules
    const evalData: CodeEvaluationResult = {
      totalFilesChecked: 1,
      coverage: {
        evaluated: [
          {
            ruleId: 'rule-det-1',
            title: 'Deterministic Rule 1',
            owner: 'AGENTS.md#L10',
            declaredClass: 'deterministic',
            evaluators: ['no-interface'],
            applicableFiles: 1,
          },
        ],
        unevaluated: [
          {
            ruleId: 'rule-heur-1',
            title: 'Heuristic Rule 1',
            owner: 'docs/guide.md#L5',
            declaredClass: 'heuristic',
            evaluators: [],
            applicableFiles: 1,
          },
          {
            ruleId: 'rule-heur-2',
            title: 'Heuristic Rule 2',
            owner: 'docs/guide.md#L15',
            declaredClass: 'heuristic',
            evaluators: [],
            applicableFiles: 1,
          },
        ],
        ratio: 0.33,
      },
      verdict: 'deterministic-clean',
      passed: false,
      deterministicPassed: true,
      contractFindings: [],
      codeFindings: [],
    }
    const { boundEvaluation, snapshotPath } = bindEvaluationFixture(tempDir, evalData)
    fs.writeFileSync(evalPath, JSON.stringify(boundEvaluation, null, 2))
    const evidence = [{ source: 'sample.ts', detail: 'Inspected the exact target bytes.' }]

    // Case 1: Incomplete review (missing rule-heur-2) -> must reject with exit 3
    fs.writeFileSync(
      reviewPath,
      JSON.stringify(
        {
          evaluationHash: boundEvaluation.workflow.evaluationHash,
          assessedBy: 'model-reviewer',
          reviews: [
            {
              ruleId: 'rule-heur-1',
              verdict: 'pass',
              rationale: 'The first heuristic is satisfied.',
              evidence,
            },
          ],
        },
        null,
        2,
      ),
    )

    const runVerdict = (ePath: string, rPath: string) => {
      return spawnSync(
        process.execPath,
        [
          '--experimental-strip-types',
          scriptPath,
          'verdict',
          '--snapshot',
          snapshotPath,
          '--eval',
          ePath,
          '--review',
          rPath,
        ],
        { cwd: tempDir, encoding: 'utf-8' },
      )
    }

    const resIncomplete = runVerdict(evalPath, reviewPath)
    assert.equal(resIncomplete.status, 3)
    assert.ok(resIncomplete.stdout.includes('INCOMPLETE REVIEW'))
    assert.ok(resIncomplete.stdout.includes('rule-heur-2'))

    // Case 2: Review reporting a violation -> must exit 1
    fs.writeFileSync(
      reviewPath,
      JSON.stringify(
        {
          evaluationHash: boundEvaluation.workflow.evaluationHash,
          assessedBy: 'model-reviewer',
          reviews: [
            {
              ruleId: 'rule-heur-1',
              verdict: 'pass',
              rationale: 'The first heuristic is satisfied.',
              evidence,
            },
            {
              ruleId: 'rule-heur-2',
              verdict: 'violation',
              rationale: 'Route file has too much business logic',
              evidence,
            },
          ],
        },
        null,
        2,
      ),
    )

    const resViolation = runVerdict(evalPath, reviewPath)
    assert.equal(resViolation.status, 1)
    assert.ok(resViolation.stdout.includes('Heuristic review reported 1 violation(s)'))

    // Case 3: Complete clean review -> must emit ALIGNED with exit 0
    fs.writeFileSync(
      reviewPath,
      JSON.stringify(
        {
          evaluationHash: boundEvaluation.workflow.evaluationHash,
          assessedBy: 'model-reviewer',
          reviews: [
            {
              ruleId: 'rule-heur-1',
              verdict: 'pass',
              rationale: 'The first heuristic is satisfied.',
              evidence,
            },
            {
              ruleId: 'rule-heur-2',
              verdict: 'not-applicable',
              rationale: 'The target does not expose the second heuristic surface.',
              evidence,
            },
          ],
        },
        null,
        2,
      ),
    )

    const resAligned = runVerdict(evalPath, reviewPath)
    assert.equal(resAligned.status, 0)
    assert.ok(resAligned.stdout.includes('VERDICT: ALIGNED'))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('contract-ledger: B1 & B2 scope matching with absolute paths and required-pattern evaluator', () => {
  const sampleMarkdown = `
# Scoped Requirements
- **Route Action Pattern**: Route files must export an action or loader.
  Check: required-pattern scope=app/routes/**/*.tsx pattern=export\\s+(const|function)\\s+(action|loader) severity=violation

- **Lib Strict Pattern**: Lib files must have export type.
  Check: required-pattern scope=lib/**/*.ts pattern=export\\s+type severity=violation
`
  const rules = parseRuleUnitsFromMarkdown(sampleMarkdown, 'docs/scoped.md')
  assert.equal(rules.length, 2)

  const fakeRoot = '/Users/test/project'
  const ledger = {
    version: '1.0.0' as const,
    repoRoot: fakeRoot,
    sourcesHash: 'dummy',
    compiledAt: new Date().toISOString(),
    hub: { path: 'AGENTS.md', exists: true, ruleCount: 0, invariants: [] },
    spokes: [],
    rules,
    allowlists: { i18nExcludeGlobs: [], literalExcludePatterns: [] },
  }

  // Pass absolute paths as collectCodeFiles would return
  const absFiles = [
    `${fakeRoot}/app/routes/valid.tsx`,
    `${fakeRoot}/app/routes/invalid.tsx`,
    `${fakeRoot}/lib/valid.ts`,
  ]

  const contents: Record<string, string> = {
    [`${fakeRoot}/app/routes/valid.tsx`]: 'export const loader = async () => {};',
    [`${fakeRoot}/app/routes/invalid.tsx`]: 'export default function Page() { return null; }',
    [`${fakeRoot}/lib/valid.ts`]: 'export type Foo = { bar: string };',
  }

  const result = evaluateCodeAgainstContract(ledger, absFiles, (p) => contents[p])
  assert.equal(result.coverage.evaluated.length, 2)
  assert.equal(result.verdict, 'deterministic-violations')
  assert.equal(result.codeFindings.length, 1)
  assert.equal(result.codeFindings[0].file, `${fakeRoot}/app/routes/invalid.tsx`)
  assert.ok(result.codeFindings[0].message.includes('missing required pattern'))
})

test('contract-ledger: B6 trailing newline does not inflate line count in max-lines', () => {
  const sampleMarkdown = `
# Limit
- **Max Lines**: Files must be 3 lines or less.
  Check: max-lines scope=**/*.ts limit=3 severity=violation
`
  const rules = parseRuleUnitsFromMarkdown(sampleMarkdown, 'docs/lines.md')
  const ledger = {
    version: '1.0.0' as const,
    repoRoot: '/root',
    sourcesHash: 'dummy',
    compiledAt: new Date().toISOString(),
    hub: { path: 'AGENTS.md', exists: true, ruleCount: 0, invariants: [] },
    spokes: [],
    rules,
    allowlists: { i18nExcludeGlobs: [], literalExcludePatterns: [] },
  }

  // 3 lines ending with newline (\n)
  const threeLinesWithNewline = 'line1\nline2\nline3\n'
  const result = evaluateCodeAgainstContract(ledger, ['file.ts'], () => threeLinesWithNewline)
  assert.equal(result.verdict, 'deterministic-clean')
  assert.equal(result.codeFindings.length, 0)
})

test('contract-ledger: B7 invalid pattern syntax in Check directive does not crash evaluator', () => {
  const sampleMarkdown = `
# Guarded Pattern
- **Invalid Pattern**: Has an unclosed parenthesis.
  Check: forbidden-pattern scope=**/*.ts pattern=(unclosed-regex severity=violation
`
  const rules = parseRuleUnitsFromMarkdown(sampleMarkdown, 'docs/guarded.md')
  const ledger = {
    version: '1.0.0' as const,
    repoRoot: '/root',
    sourcesHash: 'dummy',
    compiledAt: new Date().toISOString(),
    hub: { path: 'AGENTS.md', exists: true, ruleCount: 0, invariants: [] },
    spokes: [],
    rules,
    allowlists: { i18nExcludeGlobs: [], literalExcludePatterns: [] },
  }

  // F1: Invalid regex pattern in Check directive must emit a contract-finding (contract-dispute) rather than silently pass
  const result = evaluateCodeAgainstContract(ledger, ['file.ts'], () => 'some code')
  assert.equal(result.verdict, 'contract-dispute')
  assert.equal(result.contractFindings.length, 1)
  assert.ok(result.contractFindings[0].message.includes('invalid regex pattern'))
})

test('contract-ledger: F2 comma-separated scope in Check directive matches multiple globs', () => {
  const sampleMarkdown = `
# Multi-Scope Rule
- **Multi Scope Pattern**: Applies to both routes and lib.
  Check: required-pattern scope=app/routes/**/*.tsx,lib/**/*.ts pattern=export\\s+type severity=violation
`
  const rules = parseRuleUnitsFromMarkdown(sampleMarkdown, 'docs/multiscope.md')
  assert.equal(rules.length, 1)
  assert.deepEqual(rules[0].scope, ['app/routes/**/*.tsx', 'lib/**/*.ts'])
})

test('contract-ledger: snapshot-bound verdict rejects invalid evaluations and reviews', () => {
  const tempDir = initializeSnapshotRepo('# Rules\n- **Naming**: Keep names clear.')
  const scriptPath = path.resolve(
    process.cwd(),
    'plugins/agy-memory-layer/scripts/contract-ledger.ts',
  )

  try {
    const evalPath = path.join(tempDir, 'eval.json')
    const reviewPath = path.join(tempDir, 'review.json')

    // B3: verdict rejects contract-dispute
    const disputeEval: CodeEvaluationResult = {
      totalFilesChecked: 3,
      coverage: { evaluated: [], unevaluated: [], ratio: 1.0 },
      verdict: 'contract-dispute',
      passed: false,
      deterministicPassed: false,
      contractFindings: [
        {
          type: 'contract-finding',
          severity: 'violation',
          ruleId: 'r1',
          ruleTitle: 'Disputed Spoke Rule',
          message: 'Violated by >50%',
          suggestedAction: 'Route to /contract-refine',
        },
      ],
      codeFindings: [],
    }
    const initialBinding = bindEvaluationFixture(tempDir, disputeEval)
    const snapshotPath = initialBinding.snapshotPath
    fs.writeFileSync(evalPath, JSON.stringify(initialBinding.boundEvaluation, null, 2))
    fs.writeFileSync(
      reviewPath,
      JSON.stringify({
        evaluationHash: initialBinding.boundEvaluation.workflow.evaluationHash,
        reviews: [],
      }),
    )

    const resDispute = spawnSync(
      'node',
      [
        '--experimental-strip-types',
        scriptPath,
        'verdict',
        '--snapshot',
        snapshotPath,
        '--eval',
        evalPath,
        '--review',
        reviewPath,
      ],
      { cwd: tempDir, encoding: 'utf-8' },
    )
    assert.equal(resDispute.status, 4)
    assert.ok(resDispute.stdout.includes("Evaluation verdict is 'contract-dispute'"))

    // B8: review without reviews array rejects with exit 2
    const malformedBinding = bindEvaluationFixture(
      tempDir,
      { ...disputeEval, verdict: 'deterministic-clean' },
      snapshotPath,
    )
    fs.writeFileSync(evalPath, JSON.stringify(malformedBinding.boundEvaluation, null, 2))
    fs.writeFileSync(
      reviewPath,
      JSON.stringify({
        evaluationHash: malformedBinding.boundEvaluation.workflow.evaluationHash,
        invalidKey: true,
      }),
    )
    const resMalformed = spawnSync(
      'node',
      [
        '--experimental-strip-types',
        scriptPath,
        'verdict',
        '--snapshot',
        snapshotPath,
        '--eval',
        evalPath,
        '--review',
        reviewPath,
      ],
      { cwd: tempDir, encoding: 'utf-8' },
    )
    assert.equal(resMalformed.status, 2)
    assert.ok(resMalformed.stderr.includes("reviews' array"))

    // F4: eval result with 0 files rejects with exit 2
    const zeroBinding = bindEvaluationFixture(
      tempDir,
      { ...disputeEval, totalFilesChecked: 0, verdict: 'deterministic-clean' },
      snapshotPath,
    )
    fs.writeFileSync(evalPath, JSON.stringify(zeroBinding.boundEvaluation, null, 2))
    fs.writeFileSync(
      reviewPath,
      JSON.stringify({
        evaluationHash: zeroBinding.boundEvaluation.workflow.evaluationHash,
        reviews: [],
      }),
    )
    const resZeroFiles = spawnSync(
      'node',
      [
        '--experimental-strip-types',
        scriptPath,
        'verdict',
        '--snapshot',
        snapshotPath,
        '--eval',
        evalPath,
        '--review',
        reviewPath,
      ],
      { cwd: tempDir, encoding: 'utf-8' },
    )
    assert.equal(resZeroFiles.status, 2)
    assert.ok(resZeroFiles.stderr.includes('checked 0 files'))

    // F3: duplicate reviews for same ruleId rejects with exit 2
    const duplicateBinding = bindEvaluationFixture(
      tempDir,
      { ...disputeEval, totalFilesChecked: 1, verdict: 'deterministic-clean' },
      snapshotPath,
    )
    fs.writeFileSync(evalPath, JSON.stringify(duplicateBinding.boundEvaluation, null, 2))
    fs.writeFileSync(
      reviewPath,
      JSON.stringify(
        {
          evaluationHash: duplicateBinding.boundEvaluation.workflow.evaluationHash,
          reviews: [
            {
              ruleId: 'rule-dup',
              verdict: 'violation',
              rationale: 'First assessment.',
              evidence: [{ source: 'sample.ts', detail: 'Exact target.' }],
            },
            {
              ruleId: 'rule-dup',
              verdict: 'pass',
              rationale: 'Second assessment.',
              evidence: [{ source: 'sample.ts', detail: 'Exact target.' }],
            },
          ],
        },
        null,
        2,
      ),
    )
    const resDup = spawnSync(
      'node',
      [
        '--experimental-strip-types',
        scriptPath,
        'verdict',
        '--snapshot',
        snapshotPath,
        '--eval',
        evalPath,
        '--review',
        reviewPath,
      ],
      { cwd: tempDir, encoding: 'utf-8' },
    )
    assert.equal(resDup.status, 2)
    assert.ok(resDup.stderr.includes('duplicate review entry'))

    // B4: unknown verdict (e.g. 'looks-good') is treated as unassessed -> exit 3
    const unevaluatedEval: CodeEvaluationResult = {
      totalFilesChecked: 1,
      coverage: {
        evaluated: [],
        unevaluated: [
          {
            ruleId: 'rule-unknown-test',
            title: 'Test Rule',
            owner: 'docs/test.md#L1',
            declaredClass: 'heuristic',
            evaluators: [],
            applicableFiles: 1,
          },
        ],
        ratio: 0.0,
      },
      verdict: 'deterministic-clean',
      passed: false,
      deterministicPassed: true,
      contractFindings: [],
      codeFindings: [],
    }
    const unknownBinding = bindEvaluationFixture(tempDir, unevaluatedEval, snapshotPath)
    fs.writeFileSync(evalPath, JSON.stringify(unknownBinding.boundEvaluation, null, 2))
    fs.writeFileSync(
      reviewPath,
      JSON.stringify(
        {
          evaluationHash: unknownBinding.boundEvaluation.workflow.evaluationHash,
          reviews: [{ ruleId: 'rule-unknown-test', verdict: 'looks-good' }],
        },
        null,
        2,
      ),
    )
    const resLaxVerdict = spawnSync(
      'node',
      [
        '--experimental-strip-types',
        scriptPath,
        'verdict',
        '--snapshot',
        snapshotPath,
        '--eval',
        evalPath,
        '--review',
        reviewPath,
      ],
      { cwd: tempDir, encoding: 'utf-8' },
    )
    assert.equal(resLaxVerdict.status, 3)
    assert.ok(resLaxVerdict.stdout.includes('INCOMPLETE REVIEW'))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

function initializeSnapshotRepo(rule: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-snapshot-test-'))
  fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), `${rule}\n`)
  fs.mkdirSync(path.join(tempDir, 'docs'))
  fs.writeFileSync(path.join(tempDir, 'docs', 'guide.md'), '# Guide\n')
  fs.writeFileSync(path.join(tempDir, 'sample.ts'), 'export type Sample = { id: string }\n')
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: tempDir }).status, 0)
  assert.equal(
    spawnSync('git', ['add', 'AGENTS.md', 'docs/guide.md', 'sample.ts'], { cwd: tempDir }).status,
    0,
  )
  assert.equal(
    spawnSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        'baseline',
      ],
      { cwd: tempDir },
    ).status,
    0,
  )
  return tempDir
}

function baselineProposalApproval(tempDir: string) {
  const proposal = {
    version: '1.0.0' as const,
    id: 'baseline-adoption',
    retrieval: {
      sources: ['current repository'],
      timeRange: 'current checkout',
      queries: ['active owners'],
      gaps: [],
    },
    finalOwners: buildOwnerManifest(tempDir),
    items: [
      {
        id: 'adopt-baseline',
        paths: ['AGENTS.md'],
        summary: 'Adopt the current contract baseline',
        truthClass: 'accepted-requirement' as const,
        disposition: 'keep' as const,
        evidence: [
          {
            class: 'current-user' as const,
            source: 'baseline approval',
            locator: 'conversation:baseline-approval',
          },
        ],
      },
    ],
  }
  const approval = {
    version: '1.0.0' as const,
    proposalId: proposal.id,
    proposalHash: computeProposalHash(proposal),
    decision: 'approved' as const,
    approvedItemIds: ['adopt-baseline'],
    approvedBy: 'recorded-user',
    decisionLocator: 'conversation:baseline-approval',
  }
  return { proposal, approval }
}

function createBaselineSnapshot(tempDir: string) {
  const { proposal, approval } = baselineProposalApproval(tempDir)
  return createContractSnapshot(tempDir, compileContractLedger(tempDir), proposal, approval)
}

function writeBaselineApprovalFiles(tempDir: string) {
  const { proposal, approval } = baselineProposalApproval(tempDir)
  const proposalPath = path.join(tempDir, 'proposal.json')
  const approvalPath = path.join(tempDir, 'approval.json')
  fs.writeFileSync(proposalPath, JSON.stringify(proposal, null, 2))
  fs.writeFileSync(approvalPath, JSON.stringify(approval, null, 2))
  return { proposalPath, approvalPath }
}

function bindEvaluationFixture(
  tempDir: string,
  evaluation: CodeEvaluationResult,
  existingSnapshotPath?: string,
) {
  const snapshotPath = existingSnapshotPath ?? path.join(tempDir, 'snapshot.json')
  const snapshot = existingSnapshotPath
    ? (JSON.parse(fs.readFileSync(existingSnapshotPath, 'utf-8')) as {
        snapshotHash: string
        contractHash: string
      })
    : createBaselineSnapshot(tempDir)
  if (!existingSnapshotPath) fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
  const targets = buildTargetManifest(tempDir, [path.join(tempDir, 'sample.ts')])
  return {
    snapshotPath,
    boundEvaluation: {
      ...evaluation,
      workflow: {
        compliant: true,
        snapshotHash: snapshot.snapshotHash,
        contractHash: snapshot.contractHash,
        targets,
        evaluationHash: computeEvaluationHash(
          snapshot.snapshotHash,
          snapshot.contractHash,
          targets,
          evaluation,
        ),
      },
    },
  }
}

const contractScript = path.resolve(
  process.cwd(),
  'plugins/agy-memory-layer/scripts/contract-ledger.ts',
)

function runContractCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, ['--experimental-strip-types', contractScript, ...args], {
    cwd,
    encoding: 'utf-8',
  })
}

test('contract snapshot: approved baseline adoption and owner byte/path freshness', () => {
  const tempDir = initializeSnapshotRepo('# Rules\n- **Naming**: Keep names clear.')
  try {
    const ledger = compileContractLedger(tempDir)
    const snapshot = createBaselineSnapshot(tempDir)
    assert.equal(snapshot.approvalAuthentication, 'not-authenticated')
    assert.equal(snapshot.approvedDirtyPaths.length, 0)
    assert.equal(verifyContractSnapshot(tempDir, snapshot, ledger).passed, true)
    fs.writeFileSync(path.join(tempDir, 'sample.ts'), 'export type SourceOnly = { id: string }\n')
    assert.equal(
      verifyContractSnapshot(tempDir, snapshot, compileContractLedger(tempDir)).passed,
      true,
    )

    fs.writeFileSync(path.join(tempDir, 'docs', 'guide.md'), '# Changed Guide\n')
    assert.equal(
      verifyContractSnapshot(tempDir, snapshot, compileContractLedger(tempDir)).passed,
      false,
    )
    fs.renameSync(path.join(tempDir, 'docs', 'guide.md'), path.join(tempDir, 'docs', 'renamed.md'))
    const renamed = verifyContractSnapshot(tempDir, snapshot, compileContractLedger(tempDir))
    assert.equal(renamed.passed, false)
    assert.ok(renamed.errors.some((error) => error.includes('path, role, or bytes')))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('contract snapshot: approved final owner bytes reject substitutions and ignored owners', () => {
  const tempDir = initializeSnapshotRepo('# Rules\n- **Naming**: Candidate A.')
  try {
    const first = baselineProposalApproval(tempDir)
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Rules\n- **Naming**: Candidate B.\n')
    assert.throws(
      () =>
        createContractSnapshot(
          tempDir,
          compileContractLedger(tempDir),
          first.proposal,
          first.approval,
        ),
      /does not match proposal.finalOwners/,
    )

    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Rules\n- **Naming**: Candidate A. \n')
    assert.throws(
      () =>
        createContractSnapshot(
          tempDir,
          compileContractLedger(tempDir),
          first.proposal,
          first.approval,
        ),
      /does not match proposal.finalOwners/,
    )

    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Rules\n- **Naming**: Candidate A.\n')
    const beforeIgnoredOwner = baselineProposalApproval(tempDir)
    fs.writeFileSync(path.join(tempDir, '.gitignore'), 'docs/ignored.md\n')
    fs.writeFileSync(path.join(tempDir, 'docs', 'ignored.md'), '# Ignored but active owner\n')
    assert.throws(
      () =>
        createContractSnapshot(
          tempDir,
          compileContractLedger(tempDir),
          beforeIgnoredOwner.proposal,
          beforeIgnoredOwner.approval,
        ),
      /does not match proposal.finalOwners/,
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('contract snapshot: verification rejects removed approval and tampered embedded ledger', () => {
  const tempDir = initializeSnapshotRepo('# Rules\n- **Naming**: Keep names clear.')
  try {
    const snapshot = createBaselineSnapshot(tempDir)
    const withoutApproval = {
      ...snapshot,
      proposal: undefined,
      approval: undefined,
      approvedDirtyPaths: [],
    }
    const { snapshotHash: ignoredHash, ...approvalPayload } = withoutApproval
    void ignoredHash
    const recomputedWithoutApproval = {
      ...withoutApproval,
      snapshotHash: sha256(stableJson(approvalPayload)),
    }
    assert.equal(
      verifyContractSnapshot(
        tempDir,
        recomputedWithoutApproval as unknown as typeof snapshot,
        compileContractLedger(tempDir),
      ).passed,
      false,
    )

    const tamperedLedger = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
    const ledger = tamperedLedger.ledger as ContractLedger
    ledger.rules = []
    const { snapshotHash: previousHash, ...ledgerPayload } = tamperedLedger
    void previousHash
    tamperedLedger.snapshotHash = sha256(stableJson(ledgerPayload))
    const verification = verifyContractSnapshot(
      tempDir,
      tamperedLedger,
      compileContractLedger(tempDir),
    )
    assert.equal(verification.passed, false)
    assert.ok(verification.errors.some((error) => error.includes('embedded ledger rules digest')))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('contract snapshot: approved dirty owner requires approved primary evidence', () => {
  const tempDir = initializeSnapshotRepo('# Rules\n- **Naming**: Keep names clear.')
  try {
    fs.appendFileSync(path.join(tempDir, 'AGENTS.md'), '\n- **Exports**: Export public types.\n')
    const supportingProposal = {
      version: '1.0.0' as const,
      id: 'proposal-exports',
      retrieval: {
        sources: ['current conversation'],
        timeRange: 'current turn',
        queries: ['export guidance'],
        gaps: [],
      },
      finalOwners: buildOwnerManifest(tempDir),
      items: [
        {
          id: 'rule-exports',
          paths: ['AGENTS.md'],
          summary: 'Add export guidance',
          truthClass: 'accepted-requirement' as const,
          disposition: 'add' as const,
          evidence: [{ class: 'agent-summary' as const, source: 'agent recap' }],
        },
      ],
    }
    const approval = {
      version: '1.0.0' as const,
      proposalId: supportingProposal.id,
      proposalHash: computeProposalHash(supportingProposal),
      decision: 'approved' as const,
      approvedItemIds: ['rule-exports'],
      approvedBy: 'recorded-user',
      decisionLocator: 'conversation:approval-message',
    }
    assert.throws(
      () =>
        createContractSnapshot(
          tempDir,
          compileContractLedger(tempDir),
          supportingProposal,
          approval,
        ),
      /lacks primary evidence/,
    )

    const substitutedProposal = { ...supportingProposal, id: 'substituted-proposal' }
    assert.throws(
      () =>
        createContractSnapshot(
          tempDir,
          compileContractLedger(tempDir),
          substitutedProposal,
          approval,
        ),
      /exact proposal ID and hash/,
    )
    assert.throws(
      () =>
        createContractSnapshot(tempDir, compileContractLedger(tempDir), supportingProposal, {
          ...approval,
          approvedItemIds: ['unknown-item'],
        }),
      /unknown item/,
    )

    const missingLocatorProposal = {
      ...supportingProposal,
      items: [
        {
          ...supportingProposal.items[0],
          evidence: [{ class: 'current-user' as const, source: 'current request' }],
        },
      ],
    }
    assert.throws(
      () =>
        createContractSnapshot(tempDir, compileContractLedger(tempDir), missingLocatorProposal, {
          ...approval,
          proposalHash: computeProposalHash(missingLocatorProposal),
        }),
      /exact locator/,
    )

    const unresolvedProposal = {
      ...missingLocatorProposal,
      items: [
        {
          ...missingLocatorProposal.items[0],
          truthClass: 'unresolved-direction' as const,
          evidence: [{ class: 'repo-current' as const, source: 'AGENTS.md' }],
        },
      ],
    }
    assert.throws(
      () =>
        createContractSnapshot(tempDir, compileContractLedger(tempDir), unresolvedProposal, {
          ...approval,
          proposalHash: computeProposalHash(unresolvedProposal),
        }),
      /unresolved direction/,
    )

    const proposal = {
      ...supportingProposal,
      items: [
        {
          ...supportingProposal.items[0],
          evidence: [
            {
              class: 'current-user' as const,
              source: 'current request',
              locator: 'conversation:request-message',
            },
          ],
        },
      ],
    }
    const boundApproval = { ...approval, proposalHash: computeProposalHash(proposal) }
    const snapshot = createContractSnapshot(
      tempDir,
      compileContractLedger(tempDir),
      proposal,
      boundApproval,
    )
    assert.deepEqual(snapshot.approvedDirtyPaths, ['AGENTS.md'])
    assert.equal(
      verifyContractSnapshot(tempDir, snapshot, compileContractLedger(tempDir)).passed,
      true,
    )
    assert.equal(spawnSync('git', ['add', 'AGENTS.md'], { cwd: tempDir }).status, 0)
    assert.equal(
      spawnSync(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-qm',
          'approve',
        ],
        { cwd: tempDir },
      ).status,
      0,
    )
    assert.equal(
      verifyContractSnapshot(tempDir, snapshot, compileContractLedger(tempDir)).passed,
      true,
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('contract snapshot: deleted and renamed owner sides require approval coverage', () => {
  const tempDir = initializeSnapshotRepo('# Rules\n- **Naming**: Keep names clear.')
  try {
    const guidePath = path.join(tempDir, 'docs', 'guide.md')
    fs.rmSync(guidePath)
    assert.throws(() => createBaselineSnapshot(tempDir), /not covered by an approved proposal item/)

    fs.writeFileSync(guidePath, '# Guide\n')
    const renamedPath = path.join(tempDir, 'docs', 'renamed.md')
    fs.renameSync(guidePath, renamedPath)
    const proposal = {
      version: '1.0.0' as const,
      id: 'rename-guide',
      retrieval: {
        sources: ['repository'],
        timeRange: 'current checkout',
        queries: ['renamed guide'],
        gaps: [],
      },
      finalOwners: buildOwnerManifest(tempDir),
      items: [
        {
          id: 'rename-destination-only',
          paths: ['docs/renamed.md'],
          summary: 'Rename the guide',
          truthClass: 'observed-reality' as const,
          disposition: 'move' as const,
          evidence: [{ class: 'repo-current' as const, source: 'Git rename' }],
        },
      ],
    }
    const approval = {
      version: '1.0.0' as const,
      proposalId: proposal.id,
      proposalHash: computeProposalHash(proposal),
      decision: 'approved' as const,
      approvedItemIds: ['rename-destination-only'],
      approvedBy: 'recorded-user',
      decisionLocator: 'conversation:rename-approval',
    }
    assert.throws(
      () => createContractSnapshot(tempDir, compileContractLedger(tempDir), proposal, approval),
      /docs\/guide.md/,
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('contract CLI: snapshot is mandatory and explicit ledgers fail closed', () => {
  const tempDir = initializeSnapshotRepo(
    '# Rules\n- **Aliases**: Use aliases.\n  Check: no-interface scope=**/*.ts',
  )
  try {
    const snapshotPath = path.join(tempDir, 'snapshot.json')
    const unapprovedBaseline = runContractCli(tempDir, ['snapshot', '--output', snapshotPath])
    assert.equal(unapprovedBaseline.status, 2)
    assert.match(unapprovedBaseline.stderr, /--proposal/)
    const { proposalPath, approvalPath } = writeBaselineApprovalFiles(tempDir)
    assert.equal(
      runContractCli(tempDir, [
        'snapshot',
        '--output',
        snapshotPath,
        '--proposal',
        proposalPath,
        '--approval',
        approvalPath,
      ]).status,
      0,
    )
    const missingSnapshot = runContractCli(tempDir, ['eval', '--json', 'sample.ts'])
    assert.equal(missingSnapshot.status, 2)
    assert.match(missingSnapshot.stderr, /--snapshot/)

    const zeroTargets = runContractCli(tempDir, [
      'eval',
      '--snapshot',
      snapshotPath,
      '--json',
      'missing-target.ts',
    ])
    assert.equal(zeroTargets.status, 2)
    assert.match(zeroTargets.stderr, /target does not exist/)

    const mixedMissingTarget = runContractCli(tempDir, [
      'eval',
      '--snapshot',
      snapshotPath,
      '--json',
      'sample.ts',
      'missing-target.ts',
    ])
    assert.equal(mixedMissingTarget.status, 2)
    assert.match(mixedMissingTarget.stderr, /target does not exist/)

    const outsideTarget = path.join(os.tmpdir(), `contract-outside-${path.basename(tempDir)}.ts`)
    fs.writeFileSync(outsideTarget, 'export const outside = true\n')
    try {
      const escapedTarget = runContractCli(tempDir, [
        'eval',
        '--snapshot',
        snapshotPath,
        '--json',
        outsideTarget,
      ])
      assert.equal(escapedTarget.status, 2)
      assert.match(escapedTarget.stderr, /target is outside repository/)
    } finally {
      fs.rmSync(outsideTarget, { force: true })
    }

    const missingLedger = runContractCli(tempDir, [
      'eval',
      '--snapshot',
      snapshotPath,
      '--ledger',
      'missing-ledger.json',
      '--json',
      'sample.ts',
    ])
    assert.equal(missingLedger.status, 2)
    assert.match(missingLedger.stderr, /ledger file not found/)

    const staleLedger = compileContractLedger(tempDir)
    staleLedger.sourcesHash = 'stale'
    fs.writeFileSync(path.join(tempDir, 'stale-ledger.json'), JSON.stringify(staleLedger))
    const stale = runContractCli(tempDir, [
      'eval',
      '--snapshot',
      snapshotPath,
      '--ledger',
      'stale-ledger.json',
      '--json',
      'sample.ts',
    ])
    assert.equal(stale.status, 2)
    assert.match(stale.stderr, /stale or does not match/)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('contract verdict: rejects stale targets, mismatched hash, and ungrounded review', () => {
  const tempDir = initializeSnapshotRepo('# Rules\n- **Naming**: Keep names clear.')
  try {
    const snapshotPath = path.join(tempDir, 'snapshot.json')
    const evalPath = path.join(tempDir, 'eval.json')
    const reviewPath = path.join(tempDir, 'review.json')
    const { proposalPath, approvalPath } = writeBaselineApprovalFiles(tempDir)
    assert.equal(
      runContractCli(tempDir, [
        'snapshot',
        '--output',
        snapshotPath,
        '--proposal',
        proposalPath,
        '--approval',
        approvalPath,
      ]).status,
      0,
    )
    const evaluation = runContractCli(tempDir, [
      'eval',
      '--snapshot',
      snapshotPath,
      '--json',
      'sample.ts',
    ])
    assert.equal(evaluation.status, 3, evaluation.stderr)
    fs.writeFileSync(evalPath, evaluation.stdout)
    const receipt = JSON.parse(evaluation.stdout) as CodeEvaluationResult & {
      workflow: {
        evaluationHash: string
        targets: Array<{ path: string; contentHash: string }>
      }
    }

    const escapedReceipt = {
      ...receipt,
      workflow: {
        ...receipt.workflow,
        targets: [{ ...receipt.workflow.targets[0], path: '../outside.ts' }],
      },
    }
    fs.writeFileSync(evalPath, JSON.stringify(escapedReceipt))
    fs.writeFileSync(
      reviewPath,
      JSON.stringify({ evaluationHash: receipt.workflow.evaluationHash, reviews: [] }),
    )
    const escapedTarget = runContractCli(tempDir, [
      'verdict',
      '--snapshot',
      snapshotPath,
      '--eval',
      evalPath,
      '--review',
      reviewPath,
    ])
    assert.equal(escapedTarget.status, 2)
    assert.match(escapedTarget.stderr, /outside repository/)
    fs.writeFileSync(evalPath, evaluation.stdout)

    fs.writeFileSync(
      reviewPath,
      JSON.stringify({
        evaluationHash: 'mismatch',
        reviews: [
          {
            ruleId: receipt.coverage.unevaluated[0].ruleId,
            verdict: 'pass',
            rationale: 'Inspected the target name.',
            evidence: [{ source: 'sample.ts', detail: 'Sample name is scoped and readable.' }],
          },
        ],
      }),
    )
    const mismatch = runContractCli(tempDir, [
      'verdict',
      '--snapshot',
      snapshotPath,
      '--eval',
      evalPath,
      '--review',
      reviewPath,
    ])
    assert.equal(mismatch.status, 2)
    assert.match(mismatch.stderr, /exact evaluation hash/)

    fs.writeFileSync(
      reviewPath,
      JSON.stringify({
        evaluationHash: receipt.workflow.evaluationHash,
        reviews: [{ ruleId: receipt.coverage.unevaluated[0].ruleId, verdict: 'pass' }],
      }),
    )
    const ungrounded = runContractCli(tempDir, [
      'verdict',
      '--snapshot',
      snapshotPath,
      '--eval',
      evalPath,
      '--review',
      reviewPath,
    ])
    assert.equal(ungrounded.status, 2)
    assert.match(ungrounded.stderr, /non-empty rationale/)

    fs.writeFileSync(
      reviewPath,
      JSON.stringify({
        evaluationHash: receipt.workflow.evaluationHash,
        reviews: [
          {
            ruleId: receipt.coverage.unevaluated[0].ruleId,
            verdict: 'pass',
            rationale: 'Inspected the exact target.',
          },
        ],
      }),
    )
    const missingEvidence = runContractCli(tempDir, [
      'verdict',
      '--snapshot',
      snapshotPath,
      '--eval',
      evalPath,
      '--review',
      reviewPath,
    ])
    assert.equal(missingEvidence.status, 2)
    assert.match(missingEvidence.stderr, /evidence entries/)

    fs.writeFileSync(path.join(tempDir, 'sample.ts'), 'export type Changed = { id: string }\n')
    const staleTarget = runContractCli(tempDir, [
      'verdict',
      '--snapshot',
      snapshotPath,
      '--eval',
      evalPath,
      '--review',
      reviewPath,
    ])
    assert.equal(staleTarget.status, 2)
    assert.match(staleTarget.stderr, /target path or bytes changed/)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
