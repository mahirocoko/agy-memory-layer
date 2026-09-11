import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CaseVariant, Limits, ProbeName } from './execution-continuity-state.ts'

export type FixtureDefinition = {
  caseVariant: CaseVariant
  expectedOutcome: string
  limits: Limits
  criteria: readonly {
    id: string
    owner: 'agent' | 'human'
    proofMethod: ProbeName | 'human-acceptance'
  }[]
}

const standardLimits: Limits = {
  cycleLimit: 8,
  repairLimit: 2,
  childLimit: 2,
  failedAttemptLimit: 2,
  noProgressLimit: 2,
  rereviewLimit: 2,
}

export const fixtureDefinitions: Readonly<Record<CaseVariant, FixtureDefinition>> = {
  C1: {
    caseVariant: 'C1',
    expectedOutcome: 'wrong CLI status and output become correct after named repair',
    limits: standardLimits,
    criteria: [{ id: 'cli-consumer', owner: 'agent', proofMethod: 'c1-cli' }],
  },
  C2: {
    caseVariant: 'C2',
    expectedOutcome: 'one executable propagation API updates control, hero, sibling, and export',
    limits: standardLimits,
    criteria: [{ id: 'source-propagation', owner: 'agent', proofMethod: 'c2-propagation' }],
  },
  C3: {
    caseVariant: 'C3',
    expectedOutcome: 'runtime catalog validator passes after named catalog repair',
    limits: standardLimits,
    criteria: [{ id: 'runtime-catalog', owner: 'agent', proofMethod: 'c3-runtime' }],
  },
  C4: {
    caseVariant: 'C4',
    expectedOutcome:
      'fresh agent proof plus rejected historical grant ends needs_human; a separate positive control accepts one scoped synthetic grant',
    limits: standardLimits,
    criteria: [
      { id: 'agent-work', owner: 'agent', proofMethod: 'c4-agent' },
      { id: 'foreground-acceptance', owner: 'human', proofMethod: 'human-acceptance' },
    ],
  },
  'C5-duplicate': {
    caseVariant: 'C5-duplicate',
    expectedOutcome: 'duplicate identical report is idempotent and closes agent_checked',
    limits: standardLimits,
    criteria: [{ id: 'child-report', owner: 'agent', proofMethod: 'c5-report' }],
  },
  'C5-missing': {
    caseVariant: 'C5-missing',
    expectedOutcome: 'missing live report blocks closeout',
    limits: standardLimits,
    criteria: [{ id: 'child-report', owner: 'agent', proofMethod: 'c5-report' }],
  },
  'C5-cancel': {
    caseVariant: 'C5-cancel',
    expectedOutcome: 'explicit cancellation reconciles and closes cancelled',
    limits: standardLimits,
    criteria: [{ id: 'child-report', owner: 'agent', proofMethod: 'c5-report' }],
  },
  'C5-replacement': {
    caseVariant: 'C5-replacement',
    expectedOutcome: 'linked audited replacement fulfills the immutable assignment',
    limits: standardLimits,
    criteria: [{ id: 'child-report', owner: 'agent', proofMethod: 'c5-report' }],
  },
  guards: {
    caseVariant: 'guards',
    expectedOutcome:
      'locking, validation, fingerprint, process, and persisted accounting fail closed',
    limits: {
      cycleLimit: 4,
      repairLimit: 1,
      childLimit: 1,
      failedAttemptLimit: 1,
      noProgressLimit: 2,
      rereviewLimit: 1,
    },
    criteria: [{ id: 'guard-proof', owner: 'agent', proofMethod: 'c1-cli' }],
  },
}

const brokenPropagation = `import * as fs from 'node:fs'
const value = process.argv[2]
if (value !== 'day' && value !== 'night') process.exit(64)
fs.writeFileSync('source.json', JSON.stringify({ theme: value }) + '\\n')
fs.writeFileSync('control.txt', value + '\\n')
fs.writeFileSync('hero.txt', value + '\\n')
`

export const repairedPropagation = `import * as fs from 'node:fs'
const value = process.argv[2]
if (value !== 'day' && value !== 'night') process.exit(64)
fs.writeFileSync('source.json', JSON.stringify({ theme: value }) + '\\n')
for (const file of ['control.txt', 'hero.txt', 'sibling.txt']) fs.writeFileSync(file, value + '\\n')
fs.writeFileSync('export.json', JSON.stringify({ theme: value }) + '\\n')
`

export function seedFixture(caseVariant: CaseVariant, repoRoot: string): void {
  if (caseVariant === 'C1' || caseVariant === 'guards') {
    fs.writeFileSync(path.join(repoRoot, 'expected.txt'), 'correct\n')
    fs.writeFileSync(
      path.join(repoRoot, 'cli.mjs'),
      "process.stdout.write('wrong\\n')\nprocess.stderr.write('seeded failure\\n')\nprocess.exitCode = 7\n",
    )
    return
  }
  if (caseVariant === 'C2') {
    fs.writeFileSync(path.join(repoRoot, 'source.json'), '{"theme":"night"}\n')
    for (const name of ['control.txt', 'hero.txt', 'sibling.txt']) {
      fs.writeFileSync(path.join(repoRoot, name), 'night\n')
    }
    fs.writeFileSync(path.join(repoRoot, 'export.json'), '{"theme":"night"}\n')
    fs.writeFileSync(path.join(repoRoot, 'propagate.mjs'), brokenPropagation)
    return
  }
  if (caseVariant === 'C3') {
    fs.mkdirSync(path.join(repoRoot, 'catalogs'))
    fs.writeFileSync(path.join(repoRoot, 'app.txt'), 'welcome_key\n')
    fs.writeFileSync(path.join(repoRoot, 'catalogs', 'en.json'), '{"welcome_key":"Welcome"}\n')
    fs.writeFileSync(path.join(repoRoot, 'catalogs', 'th.json'), '{}\n')
    return
  }
  if (caseVariant === 'C4') {
    fs.writeFileSync(path.join(repoRoot, 'candidate.txt'), 'verified\n')
    return
  }
  fs.writeFileSync(path.join(repoRoot, 'child.txt'), 'candidate\n')
}

export function expectedC2Snapshot(value: 'day' | 'night'): Readonly<Record<string, string>> {
  return {
    control: value,
    hero: value,
    sibling: value,
    export: value,
  }
}
