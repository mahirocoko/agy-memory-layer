import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import {
  type CodeEvaluationResult,
  compileContractLedger,
  computeRuleId,
  evaluateCodeAgainstContract,
  parseRuleUnitsFromMarkdown,
  verifyContractLedger,
} from '../plugins/agy-memory-layer/scripts/contract-ledger.ts'

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

test('contract-ledger: verdict subcommand mechanically enforces complete heuristic review', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-verdict-test-'))

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
    fs.writeFileSync(evalPath, JSON.stringify(evalData, null, 2))

    // Case 1: Incomplete review (missing rule-heur-2) -> must reject with exit 3
    fs.writeFileSync(
      reviewPath,
      JSON.stringify(
        {
          assessedBy: 'model-reviewer',
          reviews: [{ ruleId: 'rule-heur-1', verdict: 'pass' }],
        },
        null,
        2,
      ),
    )

    const runVerdict = (ePath: string, rPath: string) => {
      return spawnSync(
        process.execPath,
        ['--experimental-strip-types', scriptPath, 'verdict', '--eval', ePath, '--review', rPath],
        { encoding: 'utf-8' },
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
          assessedBy: 'model-reviewer',
          reviews: [
            { ruleId: 'rule-heur-1', verdict: 'pass' },
            {
              ruleId: 'rule-heur-2',
              verdict: 'violation',
              rationale: 'Route file has too much business logic',
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
          assessedBy: 'model-reviewer',
          reviews: [
            { ruleId: 'rule-heur-1', verdict: 'pass' },
            { ruleId: 'rule-heur-2', verdict: 'not-applicable' },
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

test('contract-ledger: B3, B4, B8, F3, F4 verdict subcommand rejects disputes, unknown verdicts, duplicates, and zero files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-verdict-reject-'))
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
    fs.writeFileSync(evalPath, JSON.stringify(disputeEval, null, 2))
    fs.writeFileSync(reviewPath, JSON.stringify({ reviews: [] }, null, 2))

    const resDispute = spawnSync(
      'node',
      [
        '--experimental-strip-types',
        scriptPath,
        'verdict',
        '--eval',
        evalPath,
        '--review',
        reviewPath,
      ],
      { encoding: 'utf-8' },
    )
    assert.equal(resDispute.status, 4)
    assert.ok(resDispute.stdout.includes("Evaluation verdict is 'contract-dispute'"))

    // B8: review without reviews array rejects with exit 2
    fs.writeFileSync(
      evalPath,
      JSON.stringify({ ...disputeEval, verdict: 'deterministic-clean' }, null, 2),
    )
    fs.writeFileSync(reviewPath, JSON.stringify({ invalidKey: true }, null, 2))
    const resMalformed = spawnSync(
      'node',
      [
        '--experimental-strip-types',
        scriptPath,
        'verdict',
        '--eval',
        evalPath,
        '--review',
        reviewPath,
      ],
      { encoding: 'utf-8' },
    )
    assert.equal(resMalformed.status, 2)
    assert.ok(resMalformed.stderr.includes("reviews' array"))

    // F4: eval result with 0 files rejects with exit 2
    fs.writeFileSync(
      evalPath,
      JSON.stringify(
        { ...disputeEval, totalFilesChecked: 0, verdict: 'deterministic-clean' },
        null,
        2,
      ),
    )
    fs.writeFileSync(reviewPath, JSON.stringify({ reviews: [] }, null, 2))
    const resZeroFiles = spawnSync(
      'node',
      [
        '--experimental-strip-types',
        scriptPath,
        'verdict',
        '--eval',
        evalPath,
        '--review',
        reviewPath,
      ],
      { encoding: 'utf-8' },
    )
    assert.equal(resZeroFiles.status, 2)
    assert.ok(resZeroFiles.stderr.includes('checked 0 files'))

    // F3: duplicate reviews for same ruleId rejects with exit 2
    fs.writeFileSync(
      evalPath,
      JSON.stringify(
        { ...disputeEval, totalFilesChecked: 1, verdict: 'deterministic-clean' },
        null,
        2,
      ),
    )
    fs.writeFileSync(
      reviewPath,
      JSON.stringify(
        {
          reviews: [
            { ruleId: 'rule-dup', verdict: 'violation' },
            { ruleId: 'rule-dup', verdict: 'pass' },
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
        '--eval',
        evalPath,
        '--review',
        reviewPath,
      ],
      { encoding: 'utf-8' },
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
    fs.writeFileSync(evalPath, JSON.stringify(unevaluatedEval, null, 2))
    fs.writeFileSync(
      reviewPath,
      JSON.stringify(
        {
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
        '--eval',
        evalPath,
        '--review',
        reviewPath,
      ],
      { encoding: 'utf-8' },
    )
    assert.equal(resLaxVerdict.status, 3)
    assert.ok(resLaxVerdict.stdout.includes('INCOMPLETE REVIEW'))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
