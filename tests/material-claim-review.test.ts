import * as assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  computeSubjectHash,
  type ReviewPacket,
  type SubjectPacket,
  verifyMaterialClaimReview,
} from '../plugins/agy-memory-layer/scripts/material-claim-review.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCRIPT = path.join(ROOT, 'plugins', 'agy-memory-layer', 'scripts', 'material-claim-review.ts')
const TEMP_ROOTS = new Set<string>()

function tempRoot(prefix = 'material-claim-review-'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  TEMP_ROOTS.add(root)
  return root
}

function fixture() {
  const repo = tempRoot()
  fs.writeFileSync(path.join(repo, 'owner.txt'), 'owner contract\n')
  fs.writeFileSync(path.join(repo, 'consumer.txt'), 'consumer contract\n')
  const subject: SubjectPacket = {
    schemaVersion: 'material-claim-subject/v1',
    taskId: 'task-1',
    writer: {
      conversationId: 'writer-1',
      completedAt: '2026-09-13T10:00:00.000Z',
    },
    claims: [
      {
        id: 'claim-1',
        statement: 'The consumer preserves the owner contract.',
        owner: {
          id: 'owner-1',
          type: 'file',
          path: 'owner.txt',
          sha256: hashFile(path.join(repo, 'owner.txt')),
          contains: 'owner contract',
        },
        consumers: [
          {
            id: 'consumer-1',
            type: 'file',
            path: 'consumer.txt',
            sha256: hashFile(path.join(repo, 'consumer.txt')),
            contains: 'consumer contract',
          },
        ],
        failureCondition: 'The consumer omits the contract.',
        requiredEvidenceKinds: ['file'],
      },
    ],
  }
  const review: ReviewPacket = {
    schemaVersion: 'material-claim-review/v1',
    subjectHash: computeSubjectHash(subject),
    reviewer: {
      conversationId: 'reviewer-1',
      role: 'fresh-read-only',
      startedAt: '2026-09-13T10:00:01.000Z',
    },
    results: [
      {
        claimId: 'claim-1',
        rationale: 'Both current bindings contain the claimed contract.',
        verdict: 'pass',
        counterexample: {
          probe: 'Search both bindings for an omitted contract.',
          result: 'survived',
          evidence: [{ referenceId: 'consumer-1', kind: 'file', locator: 'consumer.txt' }],
        },
        directEvidence: [
          { referenceId: 'owner-1', kind: 'file', locator: 'owner.txt' },
          { referenceId: 'consumer-1', kind: 'file', locator: 'consumer.txt' },
        ],
        blockingOutcome: 'none',
      },
    ],
  }
  return { repo, subject, review }
}

function hashFile(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function errorFor(repo: string, subject: unknown, review: unknown): string {
  const result = verifyMaterialClaimReview(repo, subject, review)
  assert.strictEqual(result.valid, false)
  assert.strictEqual(result.verdict, 'invalid')
  return result.errors.join('\n')
}

function coherentVerdict(review: ReviewPacket, verdict: 'pass' | 'fail' | 'blocked'): void {
  const result = review.results[0]
  result.verdict = verdict
  if (verdict === 'pass') {
    result.counterexample.result = 'survived'
    result.blockingOutcome = 'none'
  } else if (verdict === 'fail') {
    result.counterexample.result = 'disproved'
    result.blockingOutcome = 'claim-failed'
  } else {
    result.counterexample.result = 'blocked'
    result.blockingOutcome = 'insufficient-evidence'
  }
}

function writePackets(repo: string, subject: SubjectPacket, review: ReviewPacket): void {
  fs.writeFileSync(path.join(repo, 'subject.json'), JSON.stringify(subject))
  fs.writeFileSync(path.join(repo, 'review.json'), JSON.stringify(review))
}

function cli(repo: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      SCRIPT,
      'verify',
      '--subject',
      'subject.json',
      '--review',
      'review.json',
    ],
    { cwd: repo, encoding: 'utf8' },
  )
}

afterEach(() => {
  const roots = [...TEMP_ROOTS]
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
  for (const root of roots)
    assert.strictEqual(fs.existsSync(root), false, `temp root leaked: ${root}`)
  TEMP_ROOTS.clear()
})

describe('material claim review verifier', () => {
  it('accepts a hash-bound fresh review pass', () => {
    const { repo, subject, review } = fixture()
    const result = verifyMaterialClaimReview(repo, subject, review)
    assert.deepStrictEqual(result, {
      valid: true,
      verdict: 'pass',
      identityAuthentication: 'not-authenticated',
      errors: [],
    })
  })

  it('derives fail from a reviewer-reported counterexample and blocked from insufficient evidence', () => {
    const failed = fixture()
    coherentVerdict(failed.review, 'fail')
    assert.strictEqual(
      verifyMaterialClaimReview(failed.repo, failed.subject, failed.review).verdict,
      'fail',
    )

    const blocked = fixture()
    coherentVerdict(blocked.review, 'blocked')
    assert.strictEqual(
      verifyMaterialClaimReview(blocked.repo, blocked.subject, blocked.review).verdict,
      'blocked',
    )
  })

  it('rejects subject hash, reviewer identity, and time-order violations', () => {
    const mismatch = fixture()
    mismatch.review.subjectHash = '0'.repeat(64)
    assert.match(
      errorFor(mismatch.repo, mismatch.subject, mismatch.review),
      /subject hash mismatch/,
    )

    const collision = fixture()
    collision.review.reviewer.conversationId = collision.subject.writer.conversationId
    assert.match(errorFor(collision.repo, collision.subject, collision.review), /must differ/)

    const early = fixture()
    early.review.reviewer.startedAt = '2026-09-13T09:59:59.000Z'
    assert.match(errorFor(early.repo, early.subject, early.review), /before writer completed/)
  })

  it('rejects stale or tampered owner and consumer bytes', () => {
    const owner = fixture()
    fs.writeFileSync(path.join(owner.repo, 'owner.txt'), 'tampered\n')
    assert.match(errorFor(owner.repo, owner.subject, owner.review), /owner\.txt/)

    const consumer = fixture()
    fs.writeFileSync(path.join(consumer.repo, 'consumer.txt'), 'tampered\n')
    assert.match(errorFor(consumer.repo, consumer.subject, consumer.review), /consumer\.txt/)
  })

  it('rejects outside-repository and symlink file bindings', () => {
    const outside = fixture()
    const outsideFile = path.join(tempRoot('material-claim-outside-'), 'outside.txt')
    fs.writeFileSync(outsideFile, 'outside contract\n')
    const owner = outside.subject.claims[0].owner
    assert.strictEqual(owner.type, 'file')
    if (owner.type === 'file') {
      owner.path = outsideFile
      owner.sha256 = hashFile(outsideFile)
      owner.contains = 'outside contract'
    }
    outside.review.subjectHash = computeSubjectHash(outside.subject)
    assert.match(errorFor(outside.repo, outside.subject, outside.review), /outside repository/)

    const symlink = fixture()
    fs.symlinkSync(
      path.join(symlink.repo, 'owner.txt'),
      path.join(symlink.repo, 'linked-owner.txt'),
    )
    const linkedOwner = symlink.subject.claims[0].owner
    assert.strictEqual(linkedOwner.type, 'file')
    if (linkedOwner.type === 'file') linkedOwner.path = 'linked-owner.txt'
    symlink.review.subjectHash = computeSubjectHash(symlink.subject)
    assert.match(errorFor(symlink.repo, symlink.subject, symlink.review), /symlink/)
  })

  it('rejects omitted, duplicate, and unknown claim results', () => {
    const omitted = fixture()
    const second = clone(omitted.subject.claims[0])
    second.id = 'claim-2'
    second.owner.id = 'owner-2'
    second.consumers[0].id = 'consumer-2'
    omitted.subject.claims.push(second)
    omitted.review.subjectHash = computeSubjectHash(omitted.subject)
    assert.match(
      errorFor(omitted.repo, omitted.subject, omitted.review),
      /missing result for claim: claim-2/,
    )

    const duplicate = fixture()
    duplicate.review.results.push(clone(duplicate.review.results[0]))
    assert.match(errorFor(duplicate.repo, duplicate.subject, duplicate.review), /duplicate result/)

    const unknown = fixture()
    unknown.review.results[0].claimId = 'unknown'
    assert.match(errorFor(unknown.repo, unknown.subject, unknown.review), /unknown claim/)
  })

  it('requires owner, consumer, and required-kind evidence', () => {
    const ownerMissing = fixture()
    ownerMissing.review.results[0].directEvidence.shift()
    assert.match(errorFor(ownerMissing.repo, ownerMissing.subject, ownerMissing.review), /owner-1/)

    const consumerMissing = fixture()
    consumerMissing.review.results[0].directEvidence.pop()
    assert.match(
      errorFor(consumerMissing.repo, consumerMissing.subject, consumerMissing.review),
      /consumer-1/,
    )

    const kindMissing = fixture()
    kindMissing.subject.claims[0].requiredEvidenceKinds = ['runtime']
    kindMissing.review.subjectHash = computeSubjectHash(kindMissing.subject)
    assert.match(
      errorFor(kindMissing.repo, kindMissing.subject, kindMissing.review),
      /missing required evidence kind/,
    )
  })

  it('rejects owner and consumer evidence locator substitution', () => {
    const ownerSubstitution = fixture()
    ownerSubstitution.review.results[0].directEvidence[0].locator = 'consumer.txt'
    assert.match(
      errorFor(ownerSubstitution.repo, ownerSubstitution.subject, ownerSubstitution.review),
      /evidence locator does not match binding.*owner-1/,
    )

    const consumerSubstitution = fixture()
    consumerSubstitution.review.results[0].directEvidence[1].locator = 'owner.txt'
    assert.match(
      errorFor(
        consumerSubstitution.repo,
        consumerSubstitution.subject,
        consumerSubstitution.review,
      ),
      /evidence locator does not match binding.*consumer-1/,
    )
  })

  it('rejects PASS without a surviving counterexample and all verdict tuple mismatches', () => {
    const passMismatch = fixture()
    passMismatch.review.results[0].counterexample.result = 'blocked'
    assert.match(errorFor(passMismatch.repo, passMismatch.subject, passMismatch.review), /mismatch/)

    for (const verdict of ['fail', 'blocked'] as const) {
      const mismatch = fixture()
      mismatch.review.results[0].verdict = verdict
      assert.match(errorFor(mismatch.repo, mismatch.subject, mismatch.review), /mismatch/)
    }
  })

  it('returns CLI exit codes 0 pass, 1 fail, 3 blocked, and 2 invalid', () => {
    for (const [verdict, status] of [
      ['pass', 0],
      ['fail', 1],
      ['blocked', 3],
    ] as const) {
      const value = fixture()
      coherentVerdict(value.review, verdict)
      writePackets(value.repo, value.subject, value.review)
      const result = cli(value.repo)
      assert.strictEqual(result.status, status, String(result.stderr))
      assert.match(String(result.stdout), /"identityAuthentication":"not-authenticated"/)
    }

    const invalid = fixture()
    invalid.review.subjectHash = '0'.repeat(64)
    writePackets(invalid.repo, invalid.subject, invalid.review)
    assert.strictEqual(cli(invalid.repo).status, 2)
  })
})
