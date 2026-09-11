export type CaseVariant =
  | 'C1'
  | 'C2'
  | 'C3'
  | 'C4'
  | 'C5-duplicate'
  | 'C5-missing'
  | 'C5-cancel'
  | 'C5-replacement'
  | 'guards'

export type MissionState =
  | 'working'
  | 'verifying'
  | 'agent_checked'
  | 'blocked'
  | 'needs_human'
  | 'cancelled'

export type ProbeName =
  | 'c1-cli'
  | 'c2-propagation'
  | 'c3-structural'
  | 'c3-runtime'
  | 'c4-agent'
  | 'c5-report'

export type RepairName = 'c1-cli' | 'c2-propagation' | 'c3-catalog'
export type AssignmentId = 'assignment-primary'
export type AttemptId = 'attempt-primary' | 'attempt-replacement'
export type ReportId = 'report-primary' | 'report-replacement'

export type Operation =
  | { kind: 'probe'; name: ProbeName }
  | { kind: 'repair'; name: RepairName }
  | { kind: 'set-source'; value: 'day' | 'night' }
  | { kind: 'closeout' }
  | { kind: 'start-attempt'; assignmentId: AssignmentId; attemptId: 'attempt-primary' }
  | { kind: 'report'; attemptId: AttemptId; reportId: ReportId }
  | { kind: 'audit-report'; attemptId: AttemptId; reportId: ReportId }
  | { kind: 'fail-attempt'; attemptId: AttemptId }
  | { kind: 'reconcile-attempt'; attemptId: AttemptId }
  | {
      kind: 'replace-attempt'
      assignmentId: AssignmentId
      failedAttemptId: 'attempt-primary'
      attemptId: 'attempt-replacement'
    }
  | { kind: 'cancel-attempt'; attemptId: AttemptId }
  | { kind: 'gated-sentinel'; grant: 'missing' | 'historical' | 'wrong-scope' | 'fresh' }
  | { kind: 'reconcile-pending' }
  | { kind: 'reload-session' }
  | { kind: 'simulate-interruption'; effect: 'c1-repair' }
  | { kind: 'hold-lock-fixture'; controller: 'A' }
  | { kind: 'release-lock-fixture'; controller: 'A' }
  | {
      kind: 'external-tamper-fixture'
      mutation:
        | 'candidate-bytes'
        | 'candidate-mode'
        | 'regular-symlink'
        | 'dangling-symlink'
        | 'special-file'
        | 'malformed-state'
        | 'identity-mismatch'
        | 'deadline-clock'
    }

export type Limits = {
  cycleLimit: number
  repairLimit: number
  childLimit: number
  failedAttemptLimit: number
  noProgressLimit: number
  rereviewLimit: number
}

export type Accounting = {
  cycles: number
  repairs: number
  children: number
  failedAttempts: number
  noProgress: number
  rereviews: number
}

export type Evidence = {
  fingerprint: string
  observedAt: string
  observedRevision: number
  proofMethod: ProbeName
  scope: readonly string[]
  reportRefs: readonly ReportId[]
}

export type Criterion = {
  id: string
  owner: 'agent' | 'human'
  status: 'open' | 'checked'
  proofMethod: ProbeName | 'human-acceptance'
  evidence?: Evidence
}

export type AttemptState = 'live' | 'failed' | 'cancelled' | 'reported' | 'audited' | 'reconciled'

export type Report = {
  reportId: ReportId
  attemptId: AttemptId
  fingerprint: string
  outcome: 'success'
  proofMethod: 'c5-report'
}

export type Attempt = {
  attemptId: AttemptId
  assignmentId: AssignmentId
  state: AttemptState
  replacementFor?: 'attempt-primary'
  report?: Report
  reconciledOutcome?: 'failed' | 'cancelled'
}

export type Assignment = {
  assignmentId: AssignmentId
  required: true
  attemptIds: readonly AttemptId[]
  fulfilledBy?: AttemptId
}

export type Debit = {
  cycles: number
  repairs: number
  children: number
  failedAttempts: number
  noProgress: number
  rereviews: number
}

export type PendingReceipt = {
  stage: 'pending'
  operationId: string
  operationKind: Operation['kind']
  startedAt: string
  beforeFingerprint: string
  debit: Debit
}

export type CompletedReceipt = {
  stage: 'completed'
  operationId: string
  operationKind: Operation['kind']
  startedAt: string
  completedAt: string
  beforeFingerprint: string
  afterFingerprint: string
  debit: Debit
  result: 'passed' | 'failed' | 'applied' | 'refused' | 'idempotent'
}

export type Grant = {
  action: 'disposable-sentinel-mutation'
  turnId: string
  grantedAt: string
  scope: readonly ['sentinel.txt']
  synthetic: true
}

export type Mission = {
  schemaVersion: 1
  missionId: string
  workspaceId: string
  controllerId: string
  mode: 'stage0'
  sourceTurnId: string
  scope: readonly ['workspace/**']
  nonGoals: readonly string[]
  limits: Limits
  deadline: string
  seedHash: string
  sourceHashes: Readonly<Record<'entrypoint' | 'fixtures' | 'harness' | 'state', string>>
  expectedOutcome: string
  nodeVersion: string
  revision: number
  state: MissionState
  nextAction: string
  hypothesis: string
  sessionId: string
  accounting: Accounting
  criteria: readonly Criterion[]
  assignments: readonly Assignment[]
  attempts: readonly Attempt[]
  artifactFingerprint: string
  receipts: readonly CompletedReceipt[]
  pendingReceipt?: PendingReceipt
  grant?: Grant
}

export type ImmutableMission = Pick<
  Mission,
  | 'schemaVersion'
  | 'missionId'
  | 'workspaceId'
  | 'controllerId'
  | 'mode'
  | 'sourceTurnId'
  | 'scope'
  | 'nonGoals'
  | 'limits'
  | 'deadline'
  | 'seedHash'
  | 'sourceHashes'
  | 'expectedOutcome'
  | 'nodeVersion'
>

const idPattern = /^[a-z0-9][a-z0-9-]{0,127}$/
const hashPattern = /^[a-f0-9]{64}$/
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const missionStates: readonly MissionState[] = [
  'working',
  'verifying',
  'agent_checked',
  'blocked',
  'needs_human',
  'cancelled',
]
const attemptStates: readonly AttemptState[] = [
  'live',
  'failed',
  'cancelled',
  'reported',
  'audited',
  'reconciled',
]
const probeNames: readonly ProbeName[] = [
  'c1-cli',
  'c2-propagation',
  'c3-structural',
  'c3-runtime',
  'c4-agent',
  'c5-report',
]
const reportIds: readonly ReportId[] = ['report-primary', 'report-replacement']
const persistedOperationKinds: readonly Operation['kind'][] = [
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
  'reload-session',
  'simulate-interruption',
]
const zeroDebit: Debit = {
  cycles: 0,
  repairs: 0,
  children: 0,
  failedAttempts: 0,
  noProgress: 0,
  rereviews: 0,
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`invalid ${label} fields`)
  }
}

function safeId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new Error(`invalid ${label}`)
}

function hash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !hashPattern.test(value)) throw new Error(`invalid ${label}`)
}

function iso(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !isoPattern.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`invalid ${label}`)
  }
}

function natural(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`invalid ${label}`)
}

function nonempty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid ${label}`)
}

function parseLimits(value: unknown): Limits {
  const item = record(value, 'limits')
  const keys = [
    'cycleLimit',
    'repairLimit',
    'childLimit',
    'failedAttemptLimit',
    'noProgressLimit',
    'rereviewLimit',
  ] as const
  exactKeys(item, keys, 'limits')
  for (const key of keys) natural(item[key], `limits.${key}`)
  return item as Limits
}

function parseAccounting(value: unknown, limits: Limits): Accounting {
  const item = record(value, 'accounting')
  const keys = [
    'cycles',
    'repairs',
    'children',
    'failedAttempts',
    'noProgress',
    'rereviews',
  ] as const
  exactKeys(item, keys, 'accounting')
  for (const key of keys) natural(item[key], `accounting.${key}`)
  const parsed = item as Accounting
  if (
    parsed.cycles > limits.cycleLimit ||
    parsed.repairs > limits.repairLimit ||
    parsed.children > limits.childLimit ||
    parsed.failedAttempts > limits.failedAttemptLimit ||
    parsed.noProgress > limits.noProgressLimit ||
    parsed.rereviews > limits.rereviewLimit
  ) {
    throw new Error('accounting exceeds immutable limits')
  }
  return parsed
}

function parseDebit(value: unknown): Debit {
  const item = record(value, 'debit')
  const keys = [
    'cycles',
    'repairs',
    'children',
    'failedAttempts',
    'noProgress',
    'rereviews',
  ] as const
  exactKeys(item, keys, 'debit')
  for (const key of keys) natural(item[key], `debit.${key}`)
  return item as Debit
}

function parseEvidence(value: unknown): Evidence {
  const item = record(value, 'evidence')
  exactKeys(
    item,
    ['fingerprint', 'observedAt', 'observedRevision', 'proofMethod', 'scope', 'reportRefs'],
    'evidence',
  )
  hash(item.fingerprint, 'evidence.fingerprint')
  iso(item.observedAt, 'evidence.observedAt')
  natural(item.observedRevision, 'evidence.observedRevision')
  if (typeof item.proofMethod !== 'string' || !probeNames.includes(item.proofMethod as ProbeName)) {
    throw new Error('invalid evidence.proofMethod')
  }
  if (!Array.isArray(item.scope) || item.scope.some((entry) => entry !== 'workspace/**')) {
    throw new Error('invalid evidence.scope')
  }
  if (
    !Array.isArray(item.reportRefs) ||
    item.reportRefs.some(
      (entry) => typeof entry !== 'string' || !reportIds.includes(entry as ReportId),
    ) ||
    new Set(item.reportRefs).size !== item.reportRefs.length
  ) {
    throw new Error('invalid evidence.reportRefs')
  }
  return item as unknown as Evidence
}

function parseCriterion(value: unknown): Criterion {
  const item = record(value, 'criterion')
  const keys = ['id', 'owner', 'status', 'proofMethod']
  if ('evidence' in item) keys.push('evidence')
  exactKeys(item, keys, 'criterion')
  safeId(item.id, 'criterion.id')
  if (item.owner !== 'agent' && item.owner !== 'human') throw new Error('invalid criterion.owner')
  if (item.status !== 'open' && item.status !== 'checked')
    throw new Error('invalid criterion.status')
  if (
    item.proofMethod !== 'human-acceptance' &&
    (typeof item.proofMethod !== 'string' || !probeNames.includes(item.proofMethod as ProbeName))
  ) {
    throw new Error('invalid criterion.proofMethod')
  }
  if (item.owner === 'human' && item.proofMethod !== 'human-acceptance') {
    throw new Error('human criterion must use human-acceptance')
  }
  if (item.owner === 'human' && item.status === 'checked') {
    throw new Error('agent cannot check human criterion')
  }
  const evidence = item.evidence === undefined ? undefined : parseEvidence(item.evidence)
  if ((item.status === 'checked') !== (evidence !== undefined)) {
    throw new Error('criterion status/evidence mismatch')
  }
  return { ...item, evidence } as Criterion
}

function parseReport(value: unknown): Report {
  const item = record(value, 'report')
  exactKeys(item, ['reportId', 'attemptId', 'fingerprint', 'outcome', 'proofMethod'], 'report')
  if (!reportIds.includes(item.reportId as ReportId)) throw new Error('invalid report.reportId')
  if (item.attemptId !== 'attempt-primary' && item.attemptId !== 'attempt-replacement') {
    throw new Error('invalid report.attemptId')
  }
  hash(item.fingerprint, 'report.fingerprint')
  if (item.outcome !== 'success' || item.proofMethod !== 'c5-report') {
    throw new Error('invalid report outcome or proofMethod')
  }
  return item as unknown as Report
}

function parseAttempt(value: unknown): Attempt {
  const item = record(value, 'attempt')
  const keys = ['attemptId', 'assignmentId', 'state']
  if ('replacementFor' in item) keys.push('replacementFor')
  if ('report' in item) keys.push('report')
  if ('reconciledOutcome' in item) keys.push('reconciledOutcome')
  exactKeys(item, keys, 'attempt')
  if (item.attemptId !== 'attempt-primary' && item.attemptId !== 'attempt-replacement') {
    throw new Error('invalid attempt.attemptId')
  }
  if (item.assignmentId !== 'assignment-primary') throw new Error('invalid attempt.assignmentId')
  if (typeof item.state !== 'string' || !attemptStates.includes(item.state as AttemptState)) {
    throw new Error('invalid attempt.state')
  }
  if (item.replacementFor !== undefined && item.replacementFor !== 'attempt-primary') {
    throw new Error('invalid attempt.replacementFor')
  }
  if ((item.attemptId === 'attempt-replacement') !== (item.replacementFor === 'attempt-primary')) {
    throw new Error('replacement link mismatch')
  }
  const report = item.report === undefined ? undefined : parseReport(item.report)
  if (report !== undefined && report.attemptId !== item.attemptId)
    throw new Error('report reference mismatch')
  if ((item.state === 'reported' || item.state === 'audited') !== (report !== undefined)) {
    throw new Error('attempt report/state mismatch')
  }
  if (
    item.reconciledOutcome !== undefined &&
    item.reconciledOutcome !== 'failed' &&
    item.reconciledOutcome !== 'cancelled'
  ) {
    throw new Error('invalid reconciled outcome')
  }
  if ((item.state === 'reconciled') !== (item.reconciledOutcome !== undefined)) {
    throw new Error('attempt reconciliation mismatch')
  }
  return { ...item, report } as Attempt
}

function parseAssignment(value: unknown): Assignment {
  const item = record(value, 'assignment')
  const keys = ['assignmentId', 'required', 'attemptIds']
  if ('fulfilledBy' in item) keys.push('fulfilledBy')
  exactKeys(item, keys, 'assignment')
  if (item.assignmentId !== 'assignment-primary' || item.required !== true) {
    throw new Error('invalid assignment identity')
  }
  if (
    !Array.isArray(item.attemptIds) ||
    item.attemptIds.some((id) => id !== 'attempt-primary' && id !== 'attempt-replacement') ||
    new Set(item.attemptIds).size !== item.attemptIds.length
  ) {
    throw new Error('invalid assignment attempts')
  }
  if (
    item.fulfilledBy !== undefined &&
    item.fulfilledBy !== 'attempt-primary' &&
    item.fulfilledBy !== 'attempt-replacement'
  ) {
    throw new Error('invalid assignment fulfillment')
  }
  if (item.fulfilledBy !== undefined && !item.attemptIds.includes(item.fulfilledBy)) {
    throw new Error('assignment fulfillment reference missing')
  }
  return item as unknown as Assignment
}

function parsePending(value: unknown): PendingReceipt {
  const item = record(value, 'pendingReceipt')
  exactKeys(
    item,
    ['stage', 'operationId', 'operationKind', 'startedAt', 'beforeFingerprint', 'debit'],
    'pendingReceipt',
  )
  if (item.stage !== 'pending') throw new Error('invalid pending stage')
  safeId(item.operationId, 'pending.operationId')
  if (
    typeof item.operationKind !== 'string' ||
    !persistedOperationKinds.includes(item.operationKind as Operation['kind'])
  ) {
    throw new Error('invalid pending.operationKind')
  }
  iso(item.startedAt, 'pending.startedAt')
  hash(item.beforeFingerprint, 'pending.beforeFingerprint')
  return { ...item, debit: parseDebit(item.debit) } as PendingReceipt
}

function parseReceipt(value: unknown): CompletedReceipt {
  const item = record(value, 'receipt')
  exactKeys(
    item,
    [
      'stage',
      'operationId',
      'operationKind',
      'startedAt',
      'completedAt',
      'beforeFingerprint',
      'afterFingerprint',
      'debit',
      'result',
    ],
    'receipt',
  )
  if (item.stage !== 'completed') throw new Error('invalid receipt stage')
  safeId(item.operationId, 'receipt.operationId')
  if (
    typeof item.operationKind !== 'string' ||
    !persistedOperationKinds.includes(item.operationKind as Operation['kind'])
  ) {
    throw new Error('invalid receipt.operationKind')
  }
  iso(item.startedAt, 'receipt.startedAt')
  iso(item.completedAt, 'receipt.completedAt')
  hash(item.beforeFingerprint, 'receipt.beforeFingerprint')
  hash(item.afterFingerprint, 'receipt.afterFingerprint')
  if (!['passed', 'failed', 'applied', 'refused', 'idempotent'].includes(String(item.result))) {
    throw new Error('invalid receipt result')
  }
  const kind = item.operationKind as Operation['kind']
  const result = item.result as CompletedReceipt['result']
  const validResult =
    (kind === 'probe' && (result === 'passed' || result === 'failed')) ||
    (kind === 'closeout' && (result === 'passed' || result === 'failed')) ||
    (kind === 'gated-sentinel' && (result === 'applied' || result === 'refused')) ||
    (kind === 'report' && (result === 'applied' || result === 'idempotent')) ||
    (kind === 'audit-report' && result === 'applied') ||
    (kind === 'simulate-interruption' && result === 'refused') ||
    (![
      'probe',
      'closeout',
      'gated-sentinel',
      'report',
      'audit-report',
      'simulate-interruption',
    ].includes(kind) &&
      result === 'applied')
  if (!validResult) throw new Error('receipt result does not match operation transition')
  return { ...item, debit: parseDebit(item.debit) } as CompletedReceipt
}

function parseGrant(value: unknown): Grant {
  const item = record(value, 'grant')
  exactKeys(item, ['action', 'turnId', 'grantedAt', 'scope', 'synthetic'], 'grant')
  if (
    item.action !== 'disposable-sentinel-mutation' ||
    item.synthetic !== true ||
    !Array.isArray(item.scope) ||
    item.scope.length !== 1 ||
    item.scope[0] !== 'sentinel.txt'
  ) {
    throw new Error('invalid grant action or scope')
  }
  safeId(item.turnId, 'grant.turnId')
  iso(item.grantedAt, 'grant.grantedAt')
  return item as unknown as Grant
}

export function parseMission(value: unknown): Mission {
  const item = record(value, 'mission')
  const keys = [
    'schemaVersion',
    'missionId',
    'workspaceId',
    'controllerId',
    'mode',
    'sourceTurnId',
    'scope',
    'nonGoals',
    'limits',
    'deadline',
    'seedHash',
    'sourceHashes',
    'expectedOutcome',
    'nodeVersion',
    'revision',
    'state',
    'nextAction',
    'hypothesis',
    'sessionId',
    'accounting',
    'criteria',
    'assignments',
    'attempts',
    'artifactFingerprint',
    'receipts',
  ]
  if ('pendingReceipt' in item) keys.push('pendingReceipt')
  if ('grant' in item) keys.push('grant')
  exactKeys(item, keys, 'mission')
  if (item.schemaVersion !== 1 || item.mode !== 'stage0') throw new Error('invalid mission schema')
  for (const key of ['missionId', 'workspaceId', 'controllerId', 'sourceTurnId', 'sessionId']) {
    safeId(item[key], key)
  }
  if (!Array.isArray(item.scope) || item.scope.length !== 1 || item.scope[0] !== 'workspace/**') {
    throw new Error('invalid mission scope')
  }
  if (!Array.isArray(item.nonGoals) || item.nonGoals.some((entry) => typeof entry !== 'string')) {
    throw new Error('invalid nonGoals')
  }
  const limits = parseLimits(item.limits)
  iso(item.deadline, 'deadline')
  hash(item.seedHash, 'seedHash')
  const sourceHashes = record(item.sourceHashes, 'sourceHashes')
  exactKeys(sourceHashes, ['entrypoint', 'fixtures', 'harness', 'state'], 'sourceHashes')
  for (const key of Object.keys(sourceHashes)) hash(sourceHashes[key], `sourceHashes.${key}`)
  nonempty(item.expectedOutcome, 'expectedOutcome')
  if (typeof item.nodeVersion !== 'string' || !item.nodeVersion.startsWith('v')) {
    throw new Error('invalid nodeVersion')
  }
  natural(item.revision, 'revision')
  if (typeof item.state !== 'string' || !missionStates.includes(item.state as MissionState)) {
    throw new Error('invalid mission state')
  }
  nonempty(item.nextAction, 'nextAction')
  nonempty(item.hypothesis, 'hypothesis')
  const accounting = parseAccounting(item.accounting, limits)
  if (
    !Array.isArray(item.criteria) ||
    !Array.isArray(item.assignments) ||
    !Array.isArray(item.attempts)
  ) {
    throw new Error('invalid mission collections')
  }
  const criteria = item.criteria.map(parseCriterion)
  const assignments = item.assignments.map(parseAssignment)
  const attempts = item.attempts.map(parseAttempt)
  for (const ids of [
    criteria.map((criterion) => criterion.id),
    assignments.map((assignment) => assignment.assignmentId),
    attempts.map((attempt) => attempt.attemptId),
  ]) {
    if (new Set(ids).size !== ids.length) throw new Error('duplicate persisted id')
  }
  for (const attempt of attempts) {
    const assignment = assignments.find(
      (candidate) => candidate.assignmentId === attempt.assignmentId,
    )
    if (assignment === undefined || !assignment.attemptIds.includes(attempt.attemptId)) {
      throw new Error('attempt is not referenced by its assignment')
    }
  }
  for (const assignment of assignments) {
    for (const attemptId of assignment.attemptIds) {
      const attempt = attempts.find((candidate) => candidate.attemptId === attemptId)
      if (attempt === undefined || attempt.assignmentId !== assignment.assignmentId) {
        throw new Error('assignment/attempt reference mismatch')
      }
    }
    if (assignment.fulfilledBy !== undefined) {
      const attempt = attempts.find((candidate) => candidate.attemptId === assignment.fulfilledBy)
      if (attempt?.state !== 'audited') throw new Error('assignment fulfilled by unaudited attempt')
    }
  }
  hash(item.artifactFingerprint, 'artifactFingerprint')
  if (!Array.isArray(item.receipts)) throw new Error('invalid receipts')
  const receipts = item.receipts.map(parseReceipt)
  const receiptIds = receipts.map((receipt) => receipt.operationId)
  if (new Set(receiptIds).size !== receiptIds.length) throw new Error('duplicate receipt id')
  const pendingReceipt =
    item.pendingReceipt === undefined ? undefined : parsePending(item.pendingReceipt)
  if (pendingReceipt !== undefined && receiptIds.includes(pendingReceipt.operationId)) {
    throw new Error('pending operation already completed')
  }
  const knownReports = new Map(
    attempts.flatMap((attempt) =>
      attempt.report === undefined ? [] : [[attempt.report.reportId, attempt.report] as const],
    ),
  )
  for (const criterion of criteria) {
    if (criterion.evidence === undefined) continue
    if (
      criterion.evidence.proofMethod !== criterion.proofMethod ||
      criterion.evidence.observedRevision > Number(item.revision)
    ) {
      throw new Error('criterion evidence proof or revision mismatch')
    }
    if (criterion.evidence.reportRefs.some((reportId) => !knownReports.has(reportId))) {
      throw new Error('criterion evidence references missing report')
    }
    if (
      criterion.evidence.reportRefs.some(
        (reportId) => knownReports.get(reportId)?.fingerprint !== criterion.evidence?.fingerprint,
      )
    ) {
      throw new Error('criterion evidence/report fingerprint mismatch')
    }
    if (criterion.proofMethod === 'c5-report' && criterion.evidence.reportRefs.length !== 1) {
      throw new Error('C5 evidence requires one report reference')
    }
    if (criterion.proofMethod !== 'c5-report' && criterion.evidence.reportRefs.length !== 0) {
      throw new Error('non-report evidence cannot reference report')
    }
  }
  const accounted = [...receipts.map((receipt) => receipt.debit)]
  if (pendingReceipt !== undefined) accounted.push(pendingReceipt.debit)
  const summed = accounted.reduce(addDebit, { ...zeroDebit })
  if (JSON.stringify(summed) !== JSON.stringify(accounting)) {
    throw new Error('persisted accounting does not match receipts')
  }
  const grant = item.grant === undefined ? undefined : parseGrant(item.grant)
  return {
    ...item,
    limits,
    accounting,
    criteria,
    assignments,
    attempts,
    receipts,
    pendingReceipt,
    grant,
    sourceHashes: sourceHashes as Mission['sourceHashes'],
  } as unknown as Mission
}

export function immutableMission(mission: Mission): ImmutableMission {
  return {
    schemaVersion: mission.schemaVersion,
    missionId: mission.missionId,
    workspaceId: mission.workspaceId,
    controllerId: mission.controllerId,
    mode: mission.mode,
    sourceTurnId: mission.sourceTurnId,
    scope: mission.scope,
    nonGoals: mission.nonGoals,
    limits: mission.limits,
    deadline: mission.deadline,
    seedHash: mission.seedHash,
    sourceHashes: mission.sourceHashes,
    expectedOutcome: mission.expectedOutcome,
    nodeVersion: mission.nodeVersion,
  }
}

export function sameImmutable(left: ImmutableMission, right: ImmutableMission): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function debitFor(operation: Operation): Debit {
  if (operation.kind === 'probe' || operation.kind === 'set-source') {
    return { ...zeroDebit, cycles: 1 }
  }
  if (operation.kind === 'repair') return { ...zeroDebit, repairs: 1 }
  if (operation.kind === 'start-attempt' || operation.kind === 'replace-attempt') {
    return { ...zeroDebit, children: 1 }
  }
  if (operation.kind === 'fail-attempt') return { ...zeroDebit, failedAttempts: 1 }
  return zeroDebit
}

export function addDebit(accounting: Accounting, debit: Debit): Accounting {
  return {
    cycles: accounting.cycles + debit.cycles,
    repairs: accounting.repairs + debit.repairs,
    children: accounting.children + debit.children,
    failedAttempts: accounting.failedAttempts + debit.failedAttempts,
    noProgress: accounting.noProgress + debit.noProgress,
    rereviews: accounting.rereviews + debit.rereviews,
  }
}

export function assertBudgetAvailable(mission: Mission, debit: Debit, now: string): void {
  if (Date.parse(now) >= Date.parse(mission.deadline)) throw new Error('deadline exhausted')
  const next = addDebit(mission.accounting, debit)
  if (next.noProgress > mission.limits.noProgressLimit) {
    throw new Error('persisted noProgress budget exhausted')
  }
  if (
    next.cycles > mission.limits.cycleLimit ||
    next.repairs > mission.limits.repairLimit ||
    next.children > mission.limits.childLimit ||
    next.failedAttempts > mission.limits.failedAttemptLimit ||
    next.rereviews > mission.limits.rereviewLimit
  ) {
    throw new Error('persisted budget exhausted')
  }
}

export function evidenceCurrent(criterion: Criterion, fingerprint: string): boolean {
  return criterion.status === 'checked' && criterion.evidence?.fingerprint === fingerprint
}

export function closeoutDecision(mission: Mission, fingerprint: string): MissionState {
  if (mission.pendingReceipt !== undefined) return 'blocked'
  const live = mission.attempts.some((attempt) =>
    ['live', 'failed', 'cancelled', 'reported'].includes(attempt.state),
  )
  if (live)
    return mission.attempts.some((attempt) => attempt.state === 'cancelled')
      ? 'cancelled'
      : 'blocked'
  if (
    mission.assignments.some(
      (assignment) => assignment.required && assignment.fulfilledBy === undefined,
    )
  ) {
    const cancelled = mission.attempts.some(
      (attempt) => attempt.state === 'reconciled' && attempt.reconciledOutcome === 'cancelled',
    )
    return cancelled ? 'cancelled' : mission.assignments.length > 0 ? 'blocked' : mission.state
  }
  const agentCriteria = mission.criteria.filter((criterion) => criterion.owner === 'agent')
  if (
    agentCriteria.some(
      (criterion) =>
        !evidenceCurrent(criterion, fingerprint) || criterion.evidence?.scope[0] !== 'workspace/**',
    )
  ) {
    return 'working'
  }
  if (mission.criteria.some((criterion) => criterion.owner === 'human')) return 'needs_human'
  return 'agent_checked'
}

export function legalTransition(from: MissionState, to: MissionState): boolean {
  const legal: Readonly<Record<MissionState, readonly MissionState[]>> = {
    working: ['working', 'verifying', 'blocked', 'cancelled'],
    verifying: ['working', 'agent_checked', 'needs_human', 'blocked', 'cancelled'],
    agent_checked: ['working'],
    blocked: ['working', 'cancelled'],
    needs_human: ['working', 'cancelled'],
    cancelled: [],
  }
  return legal[from].includes(to)
}
