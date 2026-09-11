import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fixtureDefinitions,
  repairedPropagation,
  seedFixture,
} from './execution-continuity-fixtures.ts'
import {
  type Assignment,
  type Attempt,
  addDebit,
  assertBudgetAvailable,
  type CaseVariant,
  type CompletedReceipt,
  type Criterion,
  closeoutDecision,
  type Debit,
  debitFor,
  type Evidence,
  evidenceCurrent,
  type Grant,
  type ImmutableMission,
  immutableMission,
  legalTransition,
  type Mission,
  type Operation,
  type PendingReceipt,
  type ProbeName,
  parseMission,
  type RepairName,
  type Report,
  sameImmutable,
} from './execution-continuity-state.ts'

export type Run = {
  readonly caseVariant: CaseVariant
  readonly runRoot: string
  readonly repoRoot: string
  readonly stateRoot: string
  readonly missionPath: string
  readonly preflightPath: string
  readonly lockPath: string
  readonly immutable: ImmutableMission
  now: string
  heldLockOwner?: string
  disposed: boolean
  fixtureEffects: number
  processCalls: number
  refusedProcessCalls: number
}

export type ExecuteResult = {
  mission: Mission
  outcome: 'passed' | 'failed' | 'applied' | 'refused' | 'idempotent' | 'interrupted'
  details: Readonly<Record<string, unknown>>
}

const fixedNow = '2026-09-11T08:00:00.000Z'
const fixedDeadline = '2026-09-11T09:00:00.000Z'
const hashPattern = /^[a-f0-9]{64}$/
const allowedOperationKinds: readonly Operation['kind'][] = [
  'probe',
  'repair',
  'set-source',
  'closeout',
  'start-attempt',
  'report',
  'audit-report',
  'fail-attempt',
  'reconcile-attempt',
  'replace-attempt',
  'cancel-attempt',
  'gated-sentinel',
  'reconcile-pending',
  'reload-session',
  'simulate-interruption',
  'hold-lock-fixture',
  'release-lock-fixture',
  'external-tamper-fixture',
]
const sourcePaths = {
  entrypoint: fileURLToPath(new URL('../execution-continuity.test.ts', import.meta.url)),
  fixtures: fileURLToPath(new URL('./execution-continuity-fixtures.ts', import.meta.url)),
  harness: fileURLToPath(import.meta.url),
  state: fileURLToPath(new URL('./execution-continuity-state.ts', import.meta.url)),
} as const

type FixedProcess =
  | 'git-init'
  | 'git-config-name'
  | 'git-config-email'
  | 'git-add'
  | 'git-commit'
  | 'c1-cli-probe'
  | 'c2-propagate-day'
  | 'c2-propagate-night'
  | 'special-file-probe'

type ProcessResult = {
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  error?: string
}

type EffectResult = {
  outcome: CompletedReceipt['result']
  details: Readonly<Record<string, unknown>>
  mission: Mission
}

function sha256(parts: readonly (string | Buffer)[]): string {
  const digest = createHash('sha256')
  for (const part of parts) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part)
    const length = Buffer.alloc(8)
    length.writeBigUInt64BE(BigInt(bytes.length))
    digest.update(length)
    digest.update(bytes)
  }
  return digest.digest('hex')
}

function assertInside(runRoot: string, candidate: string): void {
  const root = path.resolve(runRoot)
  const target = path.resolve(candidate)
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('path escapes disposable root')
  }
  let ancestor = target
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  const realRoot = fs.realpathSync(root)
  const realAncestor = fs.realpathSync(ancestor)
  const realRelative = path.relative(realRoot, realAncestor)
  if (
    realRelative === '..' ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) {
    throw new Error('path resolves outside disposable root')
  }
}

function atomicWrite(run: Run, target: string, value: string, owner: string): void {
  verifyOwnedLock(run, owner)
  assertInside(run.runRoot, target)
  const temporary = `${target}.tmp-${owner}-${String(run.fixtureEffects).padStart(4, '0')}`
  assertInside(run.runRoot, temporary)
  try {
    fs.writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' })
    fs.chmodSync(temporary, 0o600)
    fs.renameSync(temporary, target)
    fs.chmodSync(target, 0o600)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

function acquireLock(run: Run, owner: string): void {
  assertInside(run.runRoot, run.lockPath)
  let descriptor: number
  try {
    descriptor = fs.openSync(run.lockPath, 'wx', 0o600)
  } catch (error) {
    const candidate = fs.existsSync(run.lockPath)
      ? fs.readFileSync(run.lockPath, 'utf8')
      : 'unknown'
    throw new Error(`mission lock contention; candidate=${candidate}; requester=${owner}`, {
      cause: error,
    })
  }
  try {
    fs.writeFileSync(descriptor, `${owner}\n`)
    fs.fchmodSync(descriptor, 0o600)
  } finally {
    fs.closeSync(descriptor)
  }
}

function verifyOwnedLock(run: Run, owner: string): void {
  const stat = fs.lstatSync(run.lockPath)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error('invalid mission lock')
  }
  if (fs.readFileSync(run.lockPath, 'utf8') !== `${owner}\n`) {
    throw new Error('mission lock ownership mismatch')
  }
}

function releaseLock(run: Run, owner: string): void {
  verifyOwnedLock(run, owner)
  fs.unlinkSync(run.lockPath)
}

function normalizeRelative(root: string, candidate: string): string {
  const relative = path.relative(root, candidate).split(path.sep).join('/').normalize('NFC')
  if (relative.length === 0 || relative.startsWith('../') || relative === '..') {
    throw new Error('invalid fingerprint path')
  }
  return relative
}

function workspaceFingerprint(run: Run): string {
  assertInside(run.runRoot, run.repoRoot)
  const parts: (string | Buffer)[] = ['stage0-workspace-v2']
  const visit = (directory: string): void => {
    for (const name of fs
      .readdirSync(directory)
      .sort((left, right) => left.localeCompare(right, 'en'))) {
      if (directory === run.repoRoot && name === '.git') continue
      const absolute = path.join(directory, name)
      const relative = normalizeRelative(run.repoRoot, absolute)
      const stat = fs.lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new Error(`fingerprint rejects symlink: ${relative}`)
      const mode = (stat.mode & 0o777).toString(8).padStart(3, '0')
      if (stat.isDirectory()) {
        parts.push('directory', relative, mode)
        visit(absolute)
      } else if (stat.isFile()) {
        parts.push('regular', relative, mode, fs.readFileSync(absolute))
      } else {
        throw new Error(`fingerprint rejects special file: ${relative}`)
      }
    }
  }
  visit(run.repoRoot)
  return sha256(parts)
}

function fixedCommand(run: Run, name: FixedProcess): { executable: string; args: string[] } {
  const git = '/usr/bin/git'
  const node = process.execPath
  const commands: Readonly<Record<FixedProcess, { executable: string; args: string[] }>> = {
    'git-init': { executable: git, args: ['init', '--quiet'] },
    'git-config-name': { executable: git, args: ['config', 'user.name', 'Stage Zero'] },
    'git-config-email': {
      executable: git,
      args: ['config', 'user.email', 'stage-zero@example.invalid'],
    },
    'git-add': { executable: git, args: ['add', '--all'] },
    'git-commit': { executable: git, args: ['commit', '--quiet', '-m', `${run.caseVariant} seed`] },
    'c1-cli-probe': { executable: node, args: [path.join(run.repoRoot, 'cli.mjs')] },
    'c2-propagate-day': {
      executable: node,
      args: [path.join(run.repoRoot, 'propagate.mjs'), 'day'],
    },
    'c2-propagate-night': {
      executable: node,
      args: [path.join(run.repoRoot, 'propagate.mjs'), 'night'],
    },
    'special-file-probe': {
      executable: node,
      args: [path.join(run.repoRoot, 'create-special.mjs')],
    },
  }
  return commands[name]
}

function runFixedProcess(run: Run, name: FixedProcess): ProcessResult {
  const command = fixedCommand(run, name)
  const allowedExecutables = ['/usr/bin/git', process.execPath]
  if (!allowedExecutables.includes(command.executable)) {
    run.refusedProcessCalls += 1
    throw new Error('fixed process executable rejected')
  }
  if (
    command.executable === process.execPath &&
    (command.args[0]?.startsWith('-') || !path.isAbsolute(command.args[0] ?? ''))
  ) {
    run.refusedProcessCalls += 1
    throw new Error('Node flags or relative executable source rejected')
  }
  if (
    command.executable === '/usr/bin/git' &&
    !['init', 'config', 'add', 'commit'].includes(command.args[0] ?? '')
  ) {
    run.refusedProcessCalls += 1
    throw new Error('Git subcommand rejected')
  }
  run.processCalls += 1
  const result = spawnSync(command.executable, command.args, {
    cwd: run.repoRoot,
    encoding: 'utf8',
    timeout: 3_000,
    maxBuffer: 64 * 1024,
    env: {
      GIT_CONFIG_GLOBAL: path.join(run.runRoot, 'empty-git-config'),
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: run.runRoot,
      LANG: 'C',
      PATH: '/usr/bin:/bin',
    },
  })
  const stdout = String(result.stdout).slice(0, 64 * 1024)
  const stderr = String(result.stderr).slice(0, 64 * 1024)
  return {
    status: result.status,
    signal: result.signal,
    stdout,
    stderr,
    error: result.error?.message,
  }
}

function requireProcessSuccess(result: ProcessResult, name: string): void {
  if (result.status !== 0) {
    throw new Error(`${name} failed: ${result.error ?? result.stderr ?? result.stdout}`)
  }
}

function sourceHashes(): Mission['sourceHashes'] {
  const hashes = {
    entrypoint: sha256([fs.readFileSync(sourcePaths.entrypoint)]),
    fixtures: sha256([fs.readFileSync(sourcePaths.fixtures)]),
    harness: sha256([fs.readFileSync(sourcePaths.harness)]),
    state: sha256([fs.readFileSync(sourcePaths.state)]),
  }
  for (const value of Object.values(hashes)) {
    if (!hashPattern.test(value)) throw new Error('invalid test source hash')
  }
  return hashes
}

function initialMission(run: Run, seedHash: string): Mission {
  const definition = fixtureDefinitions[run.caseVariant]
  const assignments: Assignment[] = run.caseVariant.startsWith('C5')
    ? [{ assignmentId: 'assignment-primary', required: true, attemptIds: [] }]
    : []
  return {
    schemaVersion: 1,
    missionId: `${run.caseVariant.toLowerCase()}-mission-0001`,
    workspaceId: `${run.caseVariant.toLowerCase()}-workspace`,
    controllerId: 'controller-a',
    mode: 'stage0',
    sourceTurnId: 'turn-current',
    scope: ['workspace/**'],
    nonGoals: [
      'external-calls',
      'live-home-or-memfs',
      'provider-or-model-calls',
      'production-source',
      'concurrent-hostile-replacement-acl-xattr-proof',
    ],
    limits: definition.limits,
    deadline: fixedDeadline,
    seedHash,
    sourceHashes: sourceHashes(),
    expectedOutcome: definition.expectedOutcome,
    nodeVersion: process.version,
    revision: 0,
    state: 'working',
    nextAction: 'run named fixture operation',
    hypothesis: `${run.caseVariant} seeded defect requires actual evidence`,
    sessionId: 'session-0001',
    accounting: {
      cycles: 0,
      repairs: 0,
      children: 0,
      failedAttempts: 0,
      noProgress: 0,
      rereviews: 0,
    },
    criteria: definition.criteria.map((criterion) => ({ ...criterion, status: 'open' })),
    assignments,
    attempts: [],
    artifactFingerprint: seedHash,
    receipts: [],
  }
}

function writeInitialState(run: Run, mission: Mission): void {
  const owner = 'controller-a'
  acquireLock(run, owner)
  try {
    atomicWrite(run, run.missionPath, `${JSON.stringify(mission, null, 2)}\n`, owner)
    const preflight = {
      caseVariant: run.caseVariant,
      recordedAt: fixedNow,
      nodeVersion: process.version,
      expectedOutcome: mission.expectedOutcome,
      limits: mission.limits,
      deadline: mission.deadline,
      seedHash: mission.seedHash,
      sourceHashes: mission.sourceHashes,
      processBoundary: 'trusted-fixture-allowlist-not-os-sandbox',
    }
    atomicWrite(run, run.preflightPath, `${JSON.stringify(preflight, null, 2)}\n`, owner)
  } finally {
    releaseLock(run, owner)
  }
}

export function createRun(caseVariant: CaseVariant): Run {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), `stage0-${caseVariant.toLowerCase()}-`))
  const repoRoot = path.join(runRoot, 'workspace')
  const stateRoot = path.join(runRoot, 'state')
  fs.mkdirSync(repoRoot, { mode: 0o700 })
  fs.mkdirSync(stateRoot, { mode: 0o700 })
  fs.writeFileSync(path.join(runRoot, 'empty-git-config'), '', { mode: 0o600 })
  const placeholder = {} as Run
  const run: Run = Object.assign(placeholder, {
    caseVariant,
    runRoot,
    repoRoot,
    stateRoot,
    missionPath: path.join(stateRoot, 'mission.json'),
    preflightPath: path.join(stateRoot, 'preflight.json'),
    lockPath: path.join(stateRoot, 'mission.lock'),
    immutable: {} as ImmutableMission,
    now: fixedNow,
    disposed: false,
    fixtureEffects: 0,
    processCalls: 0,
    refusedProcessCalls: 0,
  })
  try {
    seedFixture(caseVariant, repoRoot)
    for (const command of [
      'git-init',
      'git-config-name',
      'git-config-email',
      'git-add',
      'git-commit',
    ] satisfies FixedProcess[]) {
      requireProcessSuccess(runFixedProcess(run, command), command)
    }
    const seedHash = workspaceFingerprint(run)
    const mission = initialMission(run, seedHash)
    Object.assign(run, { immutable: immutableMission(mission) })
    writeInitialState(run, mission)
    return run
  } catch (error) {
    fs.rmSync(runRoot, { recursive: true, force: true })
    throw error
  }
}

function readMissionUnlocked(run: Run): Mission {
  if (run.disposed) throw new Error('run already disposed')
  const raw = fs.readFileSync(run.missionPath, 'utf8')
  const mission = parseMission(JSON.parse(raw) as unknown)
  if (!sameImmutable(run.immutable, immutableMission(mission))) {
    throw new Error('persisted mission identity mismatch')
  }
  return mission
}

export function readMission(run: Run): Mission {
  return readMissionUnlocked(run)
}

function validateOperation(value: Operation): void {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    throw new Error('unknown operation rejected before effect')
  }
  if (!allowedOperationKinds.includes(value.kind))
    throw new Error('unknown operation rejected before effect')
  const serialized = JSON.stringify(value)
  const parsed = JSON.parse(serialized) as Record<string, unknown>
  const allowedShapes: Readonly<Record<Operation['kind'], readonly string[]>> = {
    probe: ['kind', 'name'],
    repair: ['kind', 'name'],
    'set-source': ['kind', 'value'],
    closeout: ['kind'],
    'start-attempt': ['kind', 'assignmentId', 'attemptId'],
    report: ['kind', 'attemptId', 'reportId'],
    'audit-report': ['kind', 'attemptId', 'reportId'],
    'fail-attempt': ['kind', 'attemptId'],
    'reconcile-attempt': ['kind', 'attemptId'],
    'replace-attempt': ['kind', 'assignmentId', 'failedAttemptId', 'attemptId'],
    'cancel-attempt': ['kind', 'attemptId'],
    'gated-sentinel': ['kind', 'grant'],
    'reconcile-pending': ['kind'],
    'reload-session': ['kind'],
    'simulate-interruption': ['kind', 'effect'],
    'hold-lock-fixture': ['kind', 'controller'],
    'release-lock-fixture': ['kind', 'controller'],
    'external-tamper-fixture': ['kind', 'mutation'],
  }
  const actual = Object.keys(parsed).sort()
  const expected = [...allowedShapes[value.kind]].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('operation fields rejected before effect')
  }
  const oneOf = (candidate: unknown, allowed: readonly string[], label: string): void => {
    if (typeof candidate !== 'string' || !allowed.includes(candidate)) {
      throw new Error(`invalid ${label} rejected before lock or effect`)
    }
  }
  if (value.kind === 'probe') {
    oneOf(
      value.name,
      ['c1-cli', 'c2-propagation', 'c3-structural', 'c3-runtime', 'c4-agent', 'c5-report'],
      'probe',
    )
  } else if (value.kind === 'repair') {
    oneOf(value.name, ['c1-cli', 'c2-propagation', 'c3-catalog'], 'repair')
  } else if (value.kind === 'set-source') {
    oneOf(value.value, ['day', 'night'], 'set-source value')
  } else if (value.kind === 'start-attempt') {
    oneOf(value.assignmentId, ['assignment-primary'], 'assignment id')
    oneOf(value.attemptId, ['attempt-primary'], 'attempt id')
  } else if (value.kind === 'report' || value.kind === 'audit-report') {
    oneOf(value.attemptId, ['attempt-primary', 'attempt-replacement'], 'attempt id')
    oneOf(value.reportId, ['report-primary', 'report-replacement'], 'report id')
  } else if (
    value.kind === 'fail-attempt' ||
    value.kind === 'reconcile-attempt' ||
    value.kind === 'cancel-attempt'
  ) {
    oneOf(value.attemptId, ['attempt-primary', 'attempt-replacement'], 'attempt id')
  } else if (value.kind === 'replace-attempt') {
    oneOf(value.assignmentId, ['assignment-primary'], 'assignment id')
    oneOf(value.failedAttemptId, ['attempt-primary'], 'failed attempt id')
    oneOf(value.attemptId, ['attempt-replacement'], 'replacement attempt id')
  } else if (value.kind === 'gated-sentinel') {
    oneOf(value.grant, ['missing', 'historical', 'wrong-scope', 'fresh'], 'grant')
  } else if (value.kind === 'simulate-interruption') {
    oneOf(value.effect, ['c1-repair'], 'simulated effect')
  } else if (value.kind === 'hold-lock-fixture' || value.kind === 'release-lock-fixture') {
    oneOf(value.controller, ['A'], 'controller')
  } else if (value.kind === 'external-tamper-fixture') {
    oneOf(
      value.mutation,
      [
        'candidate-bytes',
        'candidate-mode',
        'regular-symlink',
        'dangling-symlink',
        'special-file',
        'malformed-state',
        'identity-mismatch',
        'deadline-clock',
      ],
      'tamper mutation',
    )
  }
}

function assertOperationAllowed(
  mission: Mission,
  operation: Operation,
  caseVariant: CaseVariant,
  now: string,
): void {
  const terminalCleanup =
    operation.kind === 'cancel-attempt' ||
    operation.kind === 'reconcile-attempt' ||
    operation.kind === 'reconcile-pending'
  if (
    ['agent_checked', 'blocked', 'needs_human', 'cancelled'].includes(mission.state) &&
    !terminalCleanup
  ) {
    throw new Error(`terminal mission ${mission.state} rejects new work`)
  }
  const caseProbe: Readonly<Partial<Record<CaseVariant, readonly ProbeName[]>>> = {
    C1: ['c1-cli'],
    C2: ['c2-propagation'],
    C3: ['c3-structural', 'c3-runtime'],
    C4: ['c4-agent'],
    'C5-duplicate': ['c5-report'],
    'C5-missing': ['c5-report'],
    'C5-cancel': ['c5-report'],
    'C5-replacement': ['c5-report'],
    guards: ['c1-cli'],
  }
  if (operation.kind === 'probe' && !caseProbe[caseVariant]?.includes(operation.name)) {
    throw new Error('probe is outside fixed case route')
  }
  if (operation.kind === 'repair') {
    const expected: Readonly<Partial<Record<CaseVariant, RepairName>>> = {
      C1: 'c1-cli',
      C2: 'c2-propagation',
      C3: 'c3-catalog',
      guards: 'c1-cli',
    }
    if (expected[caseVariant] !== operation.name)
      throw new Error('repair is outside fixed case route')
  }
  if (operation.kind === 'set-source' && caseVariant !== 'C2') {
    throw new Error('source propagation is outside fixed C2 route')
  }
  if (operation.kind === 'start-attempt') {
    if (mission.assignments[0]?.assignmentId !== operation.assignmentId) {
      throw new Error('unknown assignment fails closed')
    }
    if (mission.attempts.some((attempt) => attempt.attemptId === operation.attemptId)) {
      throw new Error('duplicate attempt id')
    }
  }
  if (
    operation.kind === 'report' ||
    operation.kind === 'audit-report' ||
    operation.kind === 'fail-attempt' ||
    operation.kind === 'cancel-attempt' ||
    operation.kind === 'reconcile-attempt'
  ) {
    const attempt = mission.attempts.find(
      (candidate) => candidate.attemptId === operation.attemptId,
    )
    if (attempt === undefined) throw new Error('unknown attempt fails closed')
    if (operation.kind === 'report') {
      const expected =
        attempt.attemptId === 'attempt-primary' ? 'report-primary' : 'report-replacement'
      if (operation.reportId !== expected) throw new Error('conflicting report fails closed')
      if (attempt.report !== undefined && attempt.report.reportId !== operation.reportId) {
        throw new Error('conflicting duplicate report fails closed')
      }
      if (attempt.report === undefined && attempt.state !== 'live') {
        throw new Error('report requires live attempt')
      }
    }
    if (operation.kind === 'audit-report') {
      if (
        attempt.state !== 'reported' ||
        attempt.report === undefined ||
        attempt.report.reportId !== operation.reportId
      ) {
        throw new Error('audit requires exact persisted reported report')
      }
    }
    if (
      (operation.kind === 'fail-attempt' || operation.kind === 'cancel-attempt') &&
      attempt.state !== 'live'
    ) {
      throw new Error('only live attempt may terminate')
    }
    if (
      operation.kind === 'reconcile-attempt' &&
      attempt.state !== 'failed' &&
      attempt.state !== 'cancelled'
    ) {
      throw new Error('only terminal attempt may reconcile')
    }
  }
  if (operation.kind === 'replace-attempt') {
    const failed = mission.attempts.find(
      (attempt) => attempt.attemptId === operation.failedAttemptId,
    )
    if (failed?.state !== 'reconciled' || failed.reconciledOutcome !== 'failed') {
      throw new Error('replacement requires reconciled failed attempt')
    }
    if (mission.attempts.some((attempt) => attempt.attemptId === operation.attemptId)) {
      throw new Error('duplicate replacement attempt')
    }
  }
  if (operation.kind === 'gated-sentinel' && operation.grant !== 'fresh') {
    const reason =
      operation.grant === 'missing'
        ? 'missing grant'
        : operation.grant === 'historical'
          ? 'historical grant'
          : 'wrong-scope grant: other-sentinel.txt'
    throw new Error(`${reason} rejected before pending receipt or fixture effect`)
  }
  if (operation.kind === 'gated-sentinel' && now !== fixedNow) {
    throw new Error('grant clock mismatch rejected before effect')
  }
  if (operation.kind === 'reconcile-pending' && mission.pendingReceipt === undefined) {
    throw new Error('no interrupted pending effect to reconcile')
  }
}

function pendingDebit(mission: Mission, operation: Operation, fingerprint: string): Debit {
  const base = debitFor(operation)
  if (operation.kind === 'simulate-interruption') return { ...base, repairs: 1 }
  if (operation.kind === 'probe') return { ...base, noProgress: 1 }
  if (
    operation.kind === 'closeout' &&
    mission.criteria.some(
      (criterion) => criterion.owner === 'agent' && !evidenceCurrent(criterion, fingerprint),
    )
  ) {
    return { ...base, rereviews: 1 }
  }
  return base
}

function checkedEvidence(
  mission: Mission,
  fingerprint: string,
  proofMethod: ProbeName,
  reportRefs: Evidence['reportRefs'] = [],
): Evidence {
  return {
    fingerprint,
    observedAt: fixedNow,
    observedRevision: mission.revision,
    proofMethod,
    scope: ['workspace/**'],
    reportRefs,
  }
}

function invalidateStaleCriteria(criteria: readonly Criterion[], fingerprint: string): Criterion[] {
  return criteria.map((criterion) => {
    if (criterion.owner === 'human' || criterion.evidence === undefined) return criterion
    if (criterion.evidence.fingerprint === fingerprint) return criterion
    return { ...criterion, status: 'open', evidence: undefined }
  })
}

function markCriterion(
  mission: Mission,
  proofMethod: ProbeName,
  fingerprint: string,
  reportRefs: Evidence['reportRefs'] = [],
): Criterion[] {
  return mission.criteria.map((criterion) =>
    criterion.owner === 'agent' && criterion.proofMethod === proofMethod
      ? {
          ...criterion,
          status: 'checked',
          evidence: checkedEvidence(mission, fingerprint, proofMethod, reportRefs),
        }
      : criterion,
  )
}

function c2Snapshot(run: Run): Readonly<Record<string, string>> {
  const read = (name: string): string =>
    fs.readFileSync(path.join(run.repoRoot, name), 'utf8').trim()
  const exported = JSON.parse(read('export.json')) as Record<string, unknown>
  return {
    control: read('control.txt'),
    hero: read('hero.txt'),
    sibling: read('sibling.txt'),
    export: String(exported.theme),
  }
}

function probeEffect(run: Run, mission: Mission, name: ProbeName): EffectResult {
  const fingerprint = workspaceFingerprint(run)
  if (name === 'c1-cli') {
    const result = runFixedProcess(run, 'c1-cli-probe')
    const passed = result.status === 0 && result.stdout === 'correct\n' && result.stderr === ''
    return {
      outcome: passed ? 'passed' : 'failed',
      details: { status: result.status, stdout: result.stdout, stderr: result.stderr },
      mission: passed
        ? { ...mission, criteria: markCriterion(mission, name, fingerprint), state: 'verifying' }
        : mission,
    }
  }
  if (name === 'c2-propagation') {
    const snapshot = c2Snapshot(run)
    const source = JSON.parse(fs.readFileSync(path.join(run.repoRoot, 'source.json'), 'utf8')) as {
      theme?: unknown
    }
    const passed = Object.values(snapshot).every((value) => value === source.theme)
    return {
      outcome: passed ? 'passed' : 'failed',
      details: { snapshot, source: source.theme },
      mission: passed
        ? { ...mission, criteria: markCriterion(mission, name, fingerprint), state: 'verifying' }
        : mission,
    }
  }
  if (name === 'c3-structural') {
    const files = ['app.txt', 'catalogs/en.json', 'catalogs/th.json']
    const passed = files.every(
      (file) =>
        !fs.readFileSync(path.join(run.repoRoot, file), 'utf8').includes('FORBIDDEN_LITERAL'),
    )
    return { outcome: passed ? 'passed' : 'failed', details: { structural: passed }, mission }
  }
  if (name === 'c3-runtime') {
    const key = fs.readFileSync(path.join(run.repoRoot, 'app.txt'), 'utf8').trim()
    const passed = ['en.json', 'th.json'].every((catalog) => {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(run.repoRoot, 'catalogs', catalog), 'utf8'),
      ) as Record<string, unknown>
      return typeof parsed[key] === 'string' && parsed[key].length > 0
    })
    return {
      outcome: passed ? 'passed' : 'failed',
      details: { runtimeCatalog: passed },
      mission: passed
        ? { ...mission, criteria: markCriterion(mission, name, fingerprint), state: 'verifying' }
        : mission,
    }
  }
  if (name === 'c4-agent') {
    const passed =
      fs.readFileSync(path.join(run.repoRoot, 'candidate.txt'), 'utf8').trim().length > 0
    return {
      outcome: passed ? 'passed' : 'failed',
      details: { candidate: passed },
      mission: passed
        ? { ...mission, criteria: markCriterion(mission, name, fingerprint), state: 'verifying' }
        : mission,
    }
  }
  const assignment = mission.assignments[0]
  const report = mission.attempts.find(
    (attempt) => attempt.attemptId === assignment?.fulfilledBy,
  )?.report
  const passed = assignment?.fulfilledBy !== undefined && report !== undefined
  return {
    outcome: passed ? 'passed' : 'failed',
    details: { reportId: report?.reportId },
    mission: passed
      ? {
          ...mission,
          criteria: markCriterion(mission, name, fingerprint, [report.reportId]),
          state: 'verifying',
        }
      : mission,
  }
}

function repairEffect(run: Run, mission: Mission, name: RepairName): EffectResult {
  if (name === 'c1-cli') {
    fs.writeFileSync(path.join(run.repoRoot, 'cli.mjs'), "process.stdout.write('correct\\n')\n")
  } else if (name === 'c2-propagation') {
    fs.writeFileSync(path.join(run.repoRoot, 'propagate.mjs'), repairedPropagation)
  } else {
    fs.writeFileSync(path.join(run.repoRoot, 'catalogs', 'th.json'), '{"welcome_key":"ยินดีต้อนรับ"}\n')
  }
  run.fixtureEffects += 1
  return {
    outcome: 'applied',
    details: { repair: name },
    mission: { ...mission, state: 'working' },
  }
}

function attemptIndex(mission: Mission, attemptId: Attempt['attemptId']): number {
  const index = mission.attempts.findIndex((attempt) => attempt.attemptId === attemptId)
  if (index < 0) throw new Error('unknown attempt fails closed')
  return index
}

function replaceAttempt(mission: Mission, index: number, attempt: Attempt): Attempt[] {
  return mission.attempts.map((candidate, candidateIndex) =>
    candidateIndex === index ? attempt : candidate,
  )
}

function reportEffect(
  run: Run,
  mission: Mission,
  operation: Extract<Operation, { kind: 'report' }>,
): EffectResult {
  const index = attemptIndex(mission, operation.attemptId)
  const attempt = mission.attempts[index]
  const expectedReportId =
    operation.attemptId === 'attempt-primary' ? 'report-primary' : 'report-replacement'
  if (operation.reportId !== expectedReportId) throw new Error('conflicting report fails closed')
  const fingerprint = workspaceFingerprint(run)
  const report: Report = {
    reportId: operation.reportId,
    attemptId: operation.attemptId,
    fingerprint,
    outcome: 'success',
    proofMethod: 'c5-report',
  }
  if (attempt.report !== undefined) {
    if (JSON.stringify(attempt.report) !== JSON.stringify(report)) {
      throw new Error('conflicting duplicate report fails closed')
    }
    return { outcome: 'idempotent', details: { reportId: operation.reportId }, mission }
  }
  if (attempt.state !== 'live') throw new Error('report requires live attempt')
  const reported: Attempt = { ...attempt, state: 'reported', report }
  run.fixtureEffects += 1
  return {
    outcome: 'applied',
    details: { reportId: operation.reportId },
    mission: {
      ...mission,
      attempts: replaceAttempt(mission, index, reported),
    },
  }
}

function auditReportEffect(
  run: Run,
  mission: Mission,
  operation: Extract<Operation, { kind: 'audit-report' }>,
): EffectResult {
  const index = attemptIndex(mission, operation.attemptId)
  const attempt = mission.attempts[index]
  const fingerprint = workspaceFingerprint(run)
  if (
    attempt.state !== 'reported' ||
    attempt.report === undefined ||
    attempt.report.reportId !== operation.reportId ||
    attempt.report.fingerprint !== fingerprint
  ) {
    throw new Error('audit requires exact current persisted report')
  }
  const audited: Attempt = { ...attempt, state: 'audited' }
  const assignments = mission.assignments.map((assignment) =>
    assignment.assignmentId === attempt.assignmentId
      ? { ...assignment, fulfilledBy: attempt.attemptId }
      : assignment,
  )
  return {
    outcome: 'applied',
    details: { reportId: operation.reportId },
    mission: {
      ...mission,
      attempts: replaceAttempt(mission, index, audited),
      assignments,
      criteria: markCriterion(mission, 'c5-report', fingerprint, [attempt.report.reportId]),
      state: 'verifying',
    },
  }
}

function grantEffect(
  run: Run,
  mission: Mission,
  grantKind: Extract<Operation, { kind: 'gated-sentinel' }>['grant'],
): EffectResult {
  type GrantCandidate = {
    action: string
    turnId: string
    grantedAt: string
    scope: readonly string[]
    synthetic: boolean
  }
  const grant: GrantCandidate | undefined =
    grantKind === 'fresh'
      ? {
          action: 'disposable-sentinel-mutation',
          turnId: mission.sourceTurnId,
          grantedAt: run.now,
          scope: ['sentinel.txt'],
          synthetic: true,
        }
      : grantKind === 'historical'
        ? {
            action: 'disposable-sentinel-mutation',
            turnId: 'turn-historical',
            grantedAt: '2026-09-10T08:00:00.000Z',
            scope: ['sentinel.txt'],
            synthetic: true,
          }
        : grantKind === 'wrong-scope'
          ? {
              action: 'disposable-sentinel-mutation',
              turnId: mission.sourceTurnId,
              grantedAt: run.now,
              scope: ['other-sentinel.txt'],
              synthetic: true,
            }
          : undefined
  const authorized =
    grant !== undefined &&
    grant.turnId === mission.sourceTurnId &&
    grant.grantedAt === run.now &&
    grant.scope.length === 1 &&
    grant.scope[0] === 'sentinel.txt' &&
    grant.action === 'disposable-sentinel-mutation' &&
    grant.synthetic === true
  if (!authorized) {
    return {
      outcome: 'refused',
      details: { grant: grantKind, candidateScope: grant?.scope },
      mission,
    }
  }
  const acceptedGrant: Grant = {
    action: 'disposable-sentinel-mutation',
    turnId: grant.turnId,
    grantedAt: grant.grantedAt,
    scope: ['sentinel.txt'],
    synthetic: true,
  }
  fs.writeFileSync(path.join(run.repoRoot, 'sentinel.txt'), 'synthetic granted mutation\n')
  run.fixtureEffects += 1
  return {
    outcome: 'applied',
    details: { grant: grantKind },
    mission: { ...mission, grant: acceptedGrant },
  }
}

function applyEffect(run: Run, mission: Mission, operation: Operation): EffectResult {
  if (operation.kind === 'probe') return probeEffect(run, mission, operation.name)
  if (operation.kind === 'repair') return repairEffect(run, mission, operation.name)
  if (operation.kind === 'set-source') {
    const result = runFixedProcess(
      run,
      operation.value === 'day' ? 'c2-propagate-day' : 'c2-propagate-night',
    )
    requireProcessSuccess(result, 'C2 executable propagation API')
    run.fixtureEffects += 1
    return {
      outcome: 'applied',
      details: { snapshot: c2Snapshot(run), value: operation.value },
      mission: { ...mission, state: 'working' },
    }
  }
  if (operation.kind === 'closeout') {
    const fingerprint = workspaceFingerprint(run)
    const decision = closeoutDecision(mission, fingerprint)
    const transitionAllowed =
      mission.state === decision ||
      legalTransition(mission.state, decision) ||
      (legalTransition(mission.state, 'verifying') && legalTransition('verifying', decision))
    if (!transitionAllowed)
      throw new Error(`illegal closeout transition ${mission.state} -> ${decision}`)
    return {
      outcome: decision === 'agent_checked' || decision === 'needs_human' ? 'passed' : 'failed',
      details: { decision },
      mission: { ...mission, state: decision },
    }
  }
  if (operation.kind === 'start-attempt') {
    if (mission.assignments[0]?.assignmentId !== operation.assignmentId) {
      throw new Error('unknown assignment fails closed')
    }
    if (mission.attempts.some((attempt) => attempt.attemptId === operation.attemptId)) {
      throw new Error('duplicate attempt id')
    }
    const attempts = [
      ...mission.attempts,
      {
        attemptId: operation.attemptId,
        assignmentId: operation.assignmentId,
        state: 'live' as const,
      },
    ]
    const assignments = mission.assignments.map((assignment) => ({
      ...assignment,
      attemptIds: [...assignment.attemptIds, operation.attemptId],
    }))
    return {
      outcome: 'applied',
      details: { attemptId: operation.attemptId },
      mission: { ...mission, attempts, assignments },
    }
  }
  if (operation.kind === 'report') return reportEffect(run, mission, operation)
  if (operation.kind === 'audit-report') return auditReportEffect(run, mission, operation)
  if (operation.kind === 'fail-attempt' || operation.kind === 'cancel-attempt') {
    const index = attemptIndex(mission, operation.attemptId)
    const attempt = mission.attempts[index]
    if (attempt.state !== 'live') throw new Error('only live attempt may terminate')
    const state = operation.kind === 'fail-attempt' ? 'failed' : 'cancelled'
    return {
      outcome: 'applied',
      details: { attemptId: operation.attemptId, state },
      mission: { ...mission, attempts: replaceAttempt(mission, index, { ...attempt, state }) },
    }
  }
  if (operation.kind === 'reconcile-attempt') {
    const index = attemptIndex(mission, operation.attemptId)
    const attempt = mission.attempts[index]
    if (attempt.state !== 'failed' && attempt.state !== 'cancelled') {
      throw new Error('only terminal attempt may reconcile')
    }
    return {
      outcome: 'applied',
      details: { attemptId: operation.attemptId },
      mission: {
        ...mission,
        attempts: replaceAttempt(mission, index, {
          ...attempt,
          state: 'reconciled',
          reconciledOutcome: attempt.state,
        }),
      },
    }
  }
  if (operation.kind === 'replace-attempt') {
    const failedIndex = attemptIndex(mission, operation.failedAttemptId)
    const failed = mission.attempts[failedIndex]
    if (failed.state !== 'reconciled' || failed.reconciledOutcome !== 'failed') {
      throw new Error('replacement requires reconciled failed attempt')
    }
    if (mission.attempts.some((attempt) => attempt.attemptId === operation.attemptId)) {
      throw new Error('duplicate replacement attempt')
    }
    const replacement: Attempt = {
      attemptId: operation.attemptId,
      assignmentId: operation.assignmentId,
      state: 'live',
      replacementFor: operation.failedAttemptId,
    }
    return {
      outcome: 'applied',
      details: { attemptId: operation.attemptId },
      mission: {
        ...mission,
        attempts: [...mission.attempts, replacement],
        assignments: mission.assignments.map((assignment) => ({
          ...assignment,
          attemptIds: [...assignment.attemptIds, replacement.attemptId],
        })),
      },
    }
  }
  if (operation.kind === 'gated-sentinel') {
    return grantEffect(run, mission, operation.grant)
  }
  if (operation.kind === 'reconcile-pending') {
    return {
      outcome: 'applied',
      details: { reconciled: true },
      mission: { ...mission, pendingReceipt: undefined, state: 'blocked' },
    }
  }
  if (operation.kind === 'reload-session') {
    return {
      outcome: 'applied',
      details: { sessionId: 'session-0002' },
      mission: {
        ...mission,
        sessionId: 'session-0002',
        hypothesis: 'fresh session must preserve persisted accounting and proof rules',
      },
    }
  }
  throw new Error('operation has no registered effect')
}

function externalTamper(
  run: Run,
  mutation: Extract<Operation, { kind: 'external-tamper-fixture' }>['mutation'],
): ExecuteResult {
  if (mutation === 'candidate-bytes') {
    fs.writeFileSync(path.join(run.repoRoot, 'candidate.txt'), 'edited after proof\n')
  } else if (mutation === 'candidate-mode') {
    const target = path.join(run.repoRoot, run.caseVariant === 'C4' ? 'candidate.txt' : 'cli.mjs')
    const current = fs.lstatSync(target).mode & 0o777
    fs.chmodSync(target, current ^ 0o100)
  } else if (mutation === 'regular-symlink') {
    fs.symlinkSync('cli.mjs', path.join(run.repoRoot, 'regular-link'))
  } else if (mutation === 'dangling-symlink') {
    fs.symlinkSync('missing-target', path.join(run.repoRoot, 'dangling-link'))
  } else if (mutation === 'special-file') {
    fs.writeFileSync(
      path.join(run.repoRoot, 'create-special.mjs'),
      "import net from 'node:net'\nconst server = net.createServer()\nserver.listen('special.sock', () => process.exit(0))\n",
    )
    requireProcessSuccess(runFixedProcess(run, 'special-file-probe'), 'special file fixture')
    fs.rmSync(path.join(run.repoRoot, 'create-special.mjs'))
  } else if (mutation === 'malformed-state') {
    fs.writeFileSync(run.missionPath, '{"schemaVersion":1}\n', { mode: 0o600 })
  } else if (mutation === 'identity-mismatch') {
    const raw = JSON.parse(fs.readFileSync(run.missionPath, 'utf8')) as Record<string, unknown>
    raw.missionId = 'hostile-mission'
    fs.writeFileSync(run.missionPath, `${JSON.stringify(raw)}\n`, { mode: 0o600 })
  } else {
    run.now = fixedDeadline
  }
  return {
    mission:
      mutation === 'malformed-state' || mutation === 'identity-mismatch'
        ? ({} as Mission)
        : readMissionUnlocked(run),
    outcome: 'applied',
    details: { externalTamperFixture: mutation },
  }
}

export function execute(run: Run, expectedRevision: number, operation: Operation): ExecuteResult {
  validateOperation(operation)
  if (run.disposed) throw new Error('run already disposed')
  if (operation.kind === 'external-tamper-fixture') return externalTamper(run, operation.mutation)
  if (operation.kind === 'hold-lock-fixture') {
    acquireLock(run, 'controller-a')
    run.heldLockOwner = 'controller-a'
    return {
      mission: readMissionUnlocked(run),
      outcome: 'applied',
      details: { owner: 'controller-a' },
    }
  }
  if (operation.kind === 'release-lock-fixture') {
    if (run.heldLockOwner !== 'controller-a') throw new Error('controller A does not own held lock')
    releaseLock(run, 'controller-a')
    run.heldLockOwner = undefined
    return { mission: readMissionUnlocked(run), outcome: 'applied', details: { released: true } }
  }
  const owner = run.heldLockOwner === undefined ? 'controller-a' : 'controller-b'
  acquireLock(run, owner)
  try {
    let mission = readMissionUnlocked(run)
    if (mission.revision !== expectedRevision) throw new Error('stale mission revision')
    if (mission.pendingReceipt !== undefined && operation.kind !== 'reconcile-pending') {
      throw new Error('interrupted pending effect blocks resume without replay or refund')
    }
    assertOperationAllowed(mission, operation, run.caseVariant, run.now)
    if (operation.kind === 'reconcile-pending') {
      const pending = mission.pendingReceipt
      if (pending === undefined) throw new Error('no interrupted pending effect to reconcile')
      const reconciled = parseMission({
        ...mission,
        revision: mission.revision + 1,
        state: 'blocked',
        receipts: [
          ...mission.receipts,
          {
            stage: 'completed',
            operationId: pending.operationId,
            operationKind: pending.operationKind,
            startedAt: pending.startedAt,
            completedAt: run.now,
            beforeFingerprint: pending.beforeFingerprint,
            afterFingerprint: workspaceFingerprint(run),
            debit: pending.debit,
            result: 'refused',
          },
        ],
        pendingReceipt: undefined,
      })
      atomicWrite(run, run.missionPath, `${JSON.stringify(reconciled, null, 2)}\n`, owner)
      return { mission: reconciled, outcome: 'applied', details: { reconciled: true } }
    }
    const beforeFingerprint = workspaceFingerprint(run)
    if (operation.kind === 'audit-report') {
      const attempt = mission.attempts.find(
        (candidate) => candidate.attemptId === operation.attemptId,
      )
      if (attempt?.report?.fingerprint !== beforeFingerprint) {
        throw new Error('audit report fingerprint is stale')
      }
    }
    let debit = pendingDebit(mission, operation, beforeFingerprint)
    const cleanupAllowed =
      operation.kind === 'reconcile-attempt' || operation.kind === 'cancel-attempt'
    try {
      if (!cleanupAllowed) assertBudgetAvailable(mission, debit, run.now)
    } catch (error) {
      const blocked = { ...mission, revision: mission.revision + 1, state: 'blocked' as const }
      atomicWrite(run, run.missionPath, `${JSON.stringify(blocked, null, 2)}\n`, owner)
      return {
        mission: blocked,
        outcome: 'failed',
        details: { blocked: error instanceof Error ? error.message : String(error) },
      }
    }
    if (cleanupAllowed) debit = { ...debitFor(operation) }
    const operationId = `operation-${String(mission.revision + 1).padStart(4, '0')}`
    const pending: PendingReceipt = {
      stage: 'pending',
      operationId,
      operationKind: operation.kind,
      startedAt: run.now,
      beforeFingerprint,
      debit,
    }
    mission = {
      ...mission,
      revision: mission.revision + 1,
      accounting: addDebit(mission.accounting, debit),
      pendingReceipt: pending,
    }
    atomicWrite(run, run.missionPath, `${JSON.stringify(mission, null, 2)}\n`, owner)
    if (operation.kind === 'simulate-interruption') {
      return { mission, outcome: 'interrupted', details: { pending: operation.effect } }
    }
    const effect = applyEffect(run, { ...mission, pendingReceipt: undefined }, operation)
    if (
      effect.mission.state !== mission.state &&
      !legalTransition(mission.state, effect.mission.state)
    ) {
      throw new Error(`illegal operation transition ${mission.state} -> ${effect.mission.state}`)
    }
    const afterFingerprint = workspaceFingerprint(run)
    const successfulProbe = operation.kind === 'probe' && effect.outcome === 'passed'
    const finalDebit = successfulProbe ? { ...debit, noProgress: 0 } : debit
    const finalAccounting = successfulProbe
      ? { ...effect.mission.accounting, noProgress: effect.mission.accounting.noProgress - 1 }
      : effect.mission.accounting
    const criteria = invalidateStaleCriteria(effect.mission.criteria, afterFingerprint)
    const receipt: CompletedReceipt = {
      stage: 'completed',
      operationId,
      operationKind: operation.kind,
      startedAt: run.now,
      completedAt: run.now,
      beforeFingerprint,
      afterFingerprint,
      debit: finalDebit,
      result: effect.outcome,
    }
    const completed = parseMission({
      ...effect.mission,
      revision: effect.mission.revision + 1,
      accounting: finalAccounting,
      artifactFingerprint: afterFingerprint,
      criteria,
      receipts: [...effect.mission.receipts, receipt],
      pendingReceipt: undefined,
    })
    if (!sameImmutable(run.immutable, immutableMission(completed))) {
      throw new Error('operation attempted immutable mission mutation')
    }
    atomicWrite(run, run.missionPath, `${JSON.stringify(completed, null, 2)}\n`, owner)
    return { mission: completed, outcome: effect.outcome, details: effect.details }
  } finally {
    if (run.heldLockOwner === undefined) releaseLock(run, owner)
  }
}

export function disposeRun(run: Run): { cleaned: boolean; residue: readonly string[] } {
  if (run.disposed) return { cleaned: true, residue: [] }
  if (run.heldLockOwner !== undefined) {
    releaseLock(run, run.heldLockOwner)
    run.heldLockOwner = undefined
  }
  const root = run.runRoot
  fs.rmSync(root, { recursive: true, force: true })
  run.disposed = true
  return { cleaned: !fs.existsSync(root), residue: fs.existsSync(root) ? fs.readdirSync(root) : [] }
}
