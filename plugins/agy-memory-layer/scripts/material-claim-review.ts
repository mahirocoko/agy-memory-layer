import * as fs from 'node:fs'
import * as path from 'node:path'
import { sha256, stableJson } from './contract-snapshot.ts'

export type EvidenceKind = 'file' | 'command' | 'runtime' | 'manual'
export type FileClaimReference = {
  id: string
  type: 'file'
  path: string
  sha256: string
  contains: string
}
export type NonFileClaimReference = {
  id: string
  type: 'non-file'
  evidenceKind: Exclude<EvidenceKind, 'file'>
  locator: string
}
export type MaterialClaimReference = FileClaimReference | NonFileClaimReference
export type MaterialClaim = {
  id: string
  statement: string
  owner: MaterialClaimReference
  consumers: MaterialClaimReference[]
  failureCondition: string
  requiredEvidenceKinds: EvidenceKind[]
}
export type SubjectPacket = {
  schemaVersion: 'material-claim-subject/v1'
  taskId: string
  writer: {
    conversationId: string
    completedAt: string
  }
  claims: MaterialClaim[]
}
export type EvidenceReference = {
  referenceId: string
  kind: EvidenceKind
  locator: string
  excerpt?: string
}
export type ClaimReviewResult = {
  claimId: string
  rationale: string
  verdict: 'pass' | 'fail' | 'blocked'
  counterexample: {
    probe: string
    result: 'survived' | 'disproved' | 'blocked'
    evidence: EvidenceReference[]
  }
  directEvidence: EvidenceReference[]
  blockingOutcome: 'none' | 'claim-failed' | 'insufficient-evidence'
}
export type ReviewPacket = {
  schemaVersion: 'material-claim-review/v1'
  subjectHash: string
  reviewer: {
    conversationId: string
    role: 'fresh-read-only'
    startedAt: string
  }
  results: ClaimReviewResult[]
}
export type ReviewVerdict = 'pass' | 'fail' | 'blocked'
export type MaterialClaimVerification = {
  valid: boolean
  verdict: ReviewVerdict | 'invalid'
  identityAuthentication: 'not-authenticated'
  errors: string[]
}

type JsonRecord = Record<string, unknown>

const EVIDENCE_KINDS = new Set<EvidenceKind>(['file', 'command', 'runtime', 'manual'])
const NON_FILE_KINDS = new Set<Exclude<EvidenceKind, 'file'>>(['command', 'runtime', 'manual'])

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function exactKeys(value: JsonRecord, keys: string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`)
  }
}

function keysWithOptional(
  value: JsonRecord,
  required: string[],
  optional: string[],
  label: string,
): void {
  for (const key of required) {
    if (!(key in value)) throw new Error(`${label}.${key} is required`)
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new Error(`${label} contains unknown key: ${key}`)
    }
  }
}

function stringValue(value: unknown, label: string, maximum = 1000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty string of at most ${maximum} characters`)
  }
  return value
}

function timestamp(value: unknown, label: string): string {
  const result = stringValue(value, label, 40)
  if (Number.isNaN(Date.parse(result)) || new Date(result).toISOString() !== result) {
    throw new Error(`${label} must be an exact ISO timestamp`)
  }
  return result
}

function boundedArray(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain ${minimum}-${maximum} entries`)
  }
  return value
}

function evidenceKind(value: unknown, label: string): EvidenceKind {
  if (typeof value !== 'string' || !EVIDENCE_KINDS.has(value as EvidenceKind)) {
    throw new Error(`${label} has an invalid evidence kind`)
  }
  return value as EvidenceKind
}

function parseReference(value: unknown, label: string): MaterialClaimReference {
  const source = record(value, label)
  const type = source.type
  if (type === 'file') {
    exactKeys(source, ['id', 'type', 'path', 'sha256', 'contains'], label)
    const digest = stringValue(source.sha256, `${label}.sha256`, 64)
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label}.sha256 must be SHA-256`)
    return {
      id: stringValue(source.id, `${label}.id`, 100),
      type,
      path: stringValue(source.path, `${label}.path`, 500),
      sha256: digest,
      contains: stringValue(source.contains, `${label}.contains`, 2000),
    }
  }
  if (type === 'non-file') {
    exactKeys(source, ['id', 'type', 'evidenceKind', 'locator'], label)
    if (
      typeof source.evidenceKind !== 'string' ||
      !NON_FILE_KINDS.has(source.evidenceKind as Exclude<EvidenceKind, 'file'>)
    ) {
      throw new Error(`${label}.evidenceKind must be command, runtime, or manual`)
    }
    return {
      id: stringValue(source.id, `${label}.id`, 100),
      type,
      evidenceKind: source.evidenceKind as Exclude<EvidenceKind, 'file'>,
      locator: stringValue(source.locator, `${label}.locator`, 1000),
    }
  }
  throw new Error(`${label}.type must be file or non-file`)
}

function parseEvidence(value: unknown, label: string): EvidenceReference {
  const source = record(value, label)
  keysWithOptional(source, ['referenceId', 'kind', 'locator'], ['excerpt'], label)
  return {
    referenceId: stringValue(source.referenceId, `${label}.referenceId`, 100),
    kind: evidenceKind(source.kind, `${label}.kind`),
    locator: stringValue(source.locator, `${label}.locator`, 1000),
    ...(source.excerpt === undefined
      ? {}
      : { excerpt: stringValue(source.excerpt, `${label}.excerpt`, 2000) }),
  }
}

export function validateSubjectPacket(value: unknown): SubjectPacket {
  const source = record(value, 'subject')
  exactKeys(source, ['schemaVersion', 'taskId', 'writer', 'claims'], 'subject')
  if (source.schemaVersion !== 'material-claim-subject/v1') {
    throw new Error('subject.schemaVersion must be material-claim-subject/v1')
  }
  const writer = record(source.writer, 'subject.writer')
  exactKeys(writer, ['conversationId', 'completedAt'], 'subject.writer')
  const claimValues = boundedArray(source.claims, 'subject.claims', 1, 32)
  const claimIds = new Set<string>()
  const claims = claimValues.map((claimValue, claimIndex): MaterialClaim => {
    const label = `subject.claims[${claimIndex}]`
    const claim = record(claimValue, label)
    exactKeys(
      claim,
      ['id', 'statement', 'owner', 'consumers', 'failureCondition', 'requiredEvidenceKinds'],
      label,
    )
    const id = stringValue(claim.id, `${label}.id`, 100)
    if (claimIds.has(id)) throw new Error(`duplicate claim ID: ${id}`)
    claimIds.add(id)
    const owner = parseReference(claim.owner, `${label}.owner`)
    const consumers = boundedArray(claim.consumers, `${label}.consumers`, 1, 16).map(
      (consumer, index) => parseReference(consumer, `${label}.consumers[${index}]`),
    )
    const referenceIds = new Set<string>()
    for (const reference of [owner, ...consumers]) {
      if (referenceIds.has(reference.id)) throw new Error(`duplicate reference ID in claim ${id}`)
      referenceIds.add(reference.id)
    }
    const requiredEvidenceKinds = boundedArray(
      claim.requiredEvidenceKinds,
      `${label}.requiredEvidenceKinds`,
      1,
      4,
    ).map((kind) => evidenceKind(kind, `${label}.requiredEvidenceKinds`))
    if (new Set(requiredEvidenceKinds).size !== requiredEvidenceKinds.length) {
      throw new Error(`duplicate required evidence kind in claim ${id}`)
    }
    return {
      id,
      statement: stringValue(claim.statement, `${label}.statement`, 2000),
      owner,
      consumers,
      failureCondition: stringValue(claim.failureCondition, `${label}.failureCondition`, 2000),
      requiredEvidenceKinds,
    }
  })
  return {
    schemaVersion: 'material-claim-subject/v1',
    taskId: stringValue(source.taskId, 'subject.taskId', 200),
    writer: {
      conversationId: stringValue(writer.conversationId, 'subject.writer.conversationId', 200),
      completedAt: timestamp(writer.completedAt, 'subject.writer.completedAt'),
    },
    claims,
  }
}

export function computeSubjectHash(subject: SubjectPacket): string {
  return sha256(stableJson(subject))
}

export function validateReviewPacket(value: unknown, subject: SubjectPacket): ReviewPacket {
  const source = record(value, 'review')
  exactKeys(source, ['schemaVersion', 'subjectHash', 'reviewer', 'results'], 'review')
  if (source.schemaVersion !== 'material-claim-review/v1') {
    throw new Error('review.schemaVersion must be material-claim-review/v1')
  }
  const subjectHash = stringValue(source.subjectHash, 'review.subjectHash', 64)
  if (!/^[a-f0-9]{64}$/.test(subjectHash)) throw new Error('review.subjectHash must be SHA-256')
  if (subjectHash !== computeSubjectHash(subject)) throw new Error('review subject hash mismatch')
  const reviewer = record(source.reviewer, 'review.reviewer')
  exactKeys(reviewer, ['conversationId', 'role', 'startedAt'], 'review.reviewer')
  if (reviewer.role !== 'fresh-read-only') {
    throw new Error('review.reviewer.role must be fresh-read-only')
  }
  const reviewerConversationId = stringValue(
    reviewer.conversationId,
    'review.reviewer.conversationId',
    200,
  )
  if (reviewerConversationId === subject.writer.conversationId) {
    throw new Error('writer and reviewer conversation IDs must differ')
  }
  const startedAt = timestamp(reviewer.startedAt, 'review.reviewer.startedAt')
  if (Date.parse(startedAt) < Date.parse(subject.writer.completedAt)) {
    throw new Error('reviewer started before writer completed')
  }
  const claimById = new Map(subject.claims.map((claim) => [claim.id, claim]))
  const seen = new Set<string>()
  const results = boundedArray(source.results, 'review.results', 1, 32).map(
    (resultValue, resultIndex): ClaimReviewResult => {
      const label = `review.results[${resultIndex}]`
      const result = record(resultValue, label)
      exactKeys(
        result,
        ['claimId', 'rationale', 'verdict', 'counterexample', 'directEvidence', 'blockingOutcome'],
        label,
      )
      const claimId = stringValue(result.claimId, `${label}.claimId`, 100)
      if (seen.has(claimId)) throw new Error(`duplicate result for claim: ${claimId}`)
      seen.add(claimId)
      const claim = claimById.get(claimId)
      if (!claim) throw new Error(`result references unknown claim: ${claimId}`)
      if (!['pass', 'fail', 'blocked'].includes(String(result.verdict))) {
        throw new Error(`invalid verdict for claim: ${claimId}`)
      }
      if (
        !['none', 'claim-failed', 'insufficient-evidence'].includes(String(result.blockingOutcome))
      ) {
        throw new Error(`invalid blocking outcome for claim: ${claimId}`)
      }
      const counterexample = record(result.counterexample, `${label}.counterexample`)
      exactKeys(counterexample, ['probe', 'result', 'evidence'], `${label}.counterexample`)
      if (!['survived', 'disproved', 'blocked'].includes(String(counterexample.result))) {
        throw new Error(`invalid counterexample result for claim: ${claimId}`)
      }
      const counterEvidence = boundedArray(
        counterexample.evidence,
        `${label}.counterexample.evidence`,
        1,
        16,
      ).map((evidence, index) =>
        parseEvidence(evidence, `${label}.counterexample.evidence[${index}]`),
      )
      const directEvidence = boundedArray(
        result.directEvidence,
        `${label}.directEvidence`,
        1,
        32,
      ).map((evidence, index) => parseEvidence(evidence, `${label}.directEvidence[${index}]`))
      const references = [claim.owner, ...claim.consumers]
      const referenceById = new Map(references.map((reference) => [reference.id, reference]))
      const referenceIds = new Set(referenceById.keys())
      for (const evidence of [...counterEvidence, ...directEvidence]) {
        const reference = referenceById.get(evidence.referenceId)
        if (!reference) {
          throw new Error(
            `evidence references unknown binding in claim ${claimId}: ${evidence.referenceId}`,
          )
        }
        const expectedKind = reference.type === 'file' ? 'file' : reference.evidenceKind
        if (evidence.kind !== expectedKind) {
          throw new Error(
            `evidence kind does not match binding in claim ${claimId}: ${evidence.referenceId}`,
          )
        }
        const expectedLocator = reference.type === 'file' ? reference.path : reference.locator
        if (evidence.locator !== expectedLocator) {
          throw new Error(
            `evidence locator does not match binding in claim ${claimId}: ${evidence.referenceId}`,
          )
        }
      }
      const covered = new Set(directEvidence.map((evidence) => evidence.referenceId))
      for (const referenceId of referenceIds) {
        if (!covered.has(referenceId)) {
          throw new Error(
            `direct evidence does not cover binding in claim ${claimId}: ${referenceId}`,
          )
        }
      }
      const presentKinds = new Set(directEvidence.map((evidence) => evidence.kind))
      for (const kind of claim.requiredEvidenceKinds) {
        if (!presentKinds.has(kind)) {
          throw new Error(`claim ${claimId} is missing required evidence kind: ${kind}`)
        }
      }
      const verdict = result.verdict as ClaimReviewResult['verdict']
      const counterResult = counterexample.result as ClaimReviewResult['counterexample']['result']
      const blockingOutcome = result.blockingOutcome as ClaimReviewResult['blockingOutcome']
      const coherent =
        (verdict === 'pass' && counterResult === 'survived' && blockingOutcome === 'none') ||
        (verdict === 'fail' &&
          counterResult === 'disproved' &&
          blockingOutcome === 'claim-failed') ||
        (verdict === 'blocked' &&
          counterResult === 'blocked' &&
          blockingOutcome === 'insufficient-evidence')
      if (!coherent)
        throw new Error(`verdict, counterexample, and outcome mismatch for claim: ${claimId}`)
      return {
        claimId,
        rationale: stringValue(result.rationale, `${label}.rationale`, 2000),
        verdict,
        counterexample: {
          probe: stringValue(counterexample.probe, `${label}.counterexample.probe`, 2000),
          result: counterResult,
          evidence: counterEvidence,
        },
        directEvidence,
        blockingOutcome,
      }
    },
  )
  for (const claim of subject.claims) {
    if (!seen.has(claim.id)) throw new Error(`missing result for claim: ${claim.id}`)
  }
  return {
    schemaVersion: 'material-claim-review/v1',
    subjectHash,
    reviewer: { conversationId: reviewerConversationId, role: 'fresh-read-only', startedAt },
    results,
  }
}

export function deriveOverallVerdict(results: ClaimReviewResult[]): ReviewVerdict {
  if (results.some((result) => result.verdict === 'fail')) return 'fail'
  if (results.some((result) => result.verdict === 'blocked')) return 'blocked'
  return 'pass'
}

function containedRegularFile(repoRoot: string, candidate: string, label: string): string {
  const root = fs.realpathSync(path.resolve(repoRoot))
  const absolute = path.resolve(root, candidate)
  const relative = path.relative(root, absolute)
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside repository: ${candidate}`)
  }
  if (!fs.existsSync(absolute)) throw new Error(`${label} is not a regular file: ${candidate}`)
  const stat = fs.lstatSync(absolute)
  if (stat.isSymbolicLink()) throw new Error(`${label} uses a symlink: ${candidate}`)
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${candidate}`)
  const real = fs.realpathSync(absolute)
  if (real !== absolute || path.relative(root, real).startsWith(`..${path.sep}`)) {
    throw new Error(`${label} uses a symlink or escapes repository: ${candidate}`)
  }
  return absolute
}

function verifyCurrentFileBindings(repoRoot: string, subject: SubjectPacket): void {
  for (const claim of subject.claims) {
    for (const reference of [claim.owner, ...claim.consumers]) {
      if (reference.type !== 'file') continue
      const absolute = containedRegularFile(repoRoot, reference.path, `claim ${claim.id} binding`)
      const bytes = fs.readFileSync(absolute)
      if (sha256(bytes) !== reference.sha256) {
        throw new Error(`claim ${claim.id} binding has stale or tampered bytes: ${reference.path}`)
      }
      if (!bytes.toString('utf8').includes(reference.contains)) {
        throw new Error(`claim ${claim.id} binding lacks required containment: ${reference.path}`)
      }
    }
  }
}

export function verifyMaterialClaimReview(
  repoRoot: string,
  subjectValue: unknown,
  reviewValue: unknown,
): MaterialClaimVerification {
  try {
    const subject = validateSubjectPacket(subjectValue)
    verifyCurrentFileBindings(repoRoot, subject)
    const review = validateReviewPacket(reviewValue, subject)
    return {
      valid: true,
      verdict: deriveOverallVerdict(review.results),
      identityAuthentication: 'not-authenticated',
      errors: [],
    }
  } catch (error) {
    return {
      valid: false,
      verdict: 'invalid',
      identityAuthentication: 'not-authenticated',
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

function readRepoJson(repoRoot: string, candidate: string, label: string): unknown {
  const absolute = containedRegularFile(repoRoot, candidate, label)
  return JSON.parse(fs.readFileSync(absolute, 'utf8')) as unknown
}

export function runMaterialClaimReviewCli(args: string[], repoRoot = process.cwd()): number {
  try {
    if (args[0] !== 'verify') throw new Error('usage: verify --subject <json> --review <json>')
    const subjectIndex = args.indexOf('--subject')
    const reviewIndex = args.indexOf('--review')
    if (
      args.length !== 5 ||
      subjectIndex < 0 ||
      reviewIndex < 0 ||
      !args[subjectIndex + 1] ||
      !args[reviewIndex + 1]
    ) {
      throw new Error('usage: verify --subject <json> --review <json>')
    }
    const subject = readRepoJson(repoRoot, args[subjectIndex + 1], 'subject packet')
    const review = readRepoJson(repoRoot, args[reviewIndex + 1], 'review packet')
    const verification = verifyMaterialClaimReview(repoRoot, subject, review)
    process.stdout.write(`${JSON.stringify(verification)}\n`)
    if (!verification.valid) return 2
    if (verification.verdict === 'fail') return 1
    if (verification.verdict === 'blocked') return 3
    return 0
  } catch (error) {
    const verification: MaterialClaimVerification = {
      valid: false,
      verdict: 'invalid',
      identityAuthentication: 'not-authenticated',
      errors: [error instanceof Error ? error.message : String(error)],
    }
    process.stdout.write(`${JSON.stringify(verification)}\n`)
    return 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exitCode = runMaterialClaimReviewCli(process.argv.slice(2))
}
