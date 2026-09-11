import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { test } from 'node:test'
import { expectedC2Snapshot } from './support/execution-continuity-fixtures.ts'
import {
  createRun,
  disposeRun,
  execute,
  readMission,
} from './support/execution-continuity-harness.ts'
import { type Operation, parseMission } from './support/execution-continuity-state.ts'

test('C1 actual CLI failure requires the named repair and current consumer proof', () => {
  const run = createRun('C1')
  try {
    const initial = readMission(run)
    assert.equal(initial.nodeVersion, process.version)
    assert.deepEqual(Object.keys(initial.sourceHashes).sort(), [
      'entrypoint',
      'fixtures',
      'harness',
      'state',
    ])
    const preflight = JSON.parse(fs.readFileSync(run.preflightPath, 'utf8')) as Record<
      string,
      unknown
    >
    assert.equal(preflight.nodeVersion, process.version)
    assert.equal(preflight.seedHash, initial.seedHash)
    assert.deepEqual(preflight.limits, initial.limits)
    assert.deepEqual(preflight.sourceHashes, initial.sourceHashes)
    assert.equal(preflight.expectedOutcome, initial.expectedOutcome)
    assert.equal(preflight.processBoundary, 'trusted-fixture-allowlist-not-os-sandbox')
    const failed = execute(run, initial.revision, { kind: 'probe', name: 'c1-cli' })
    assert.equal(failed.outcome, 'failed')
    assert.equal(failed.details.status, 7)
    assert.equal(failed.details.stdout, 'wrong\n')
    assert.equal(failed.details.stderr, 'seeded failure\n')
    assert.equal(failed.mission.criteria[0].status, 'open')

    const repaired = execute(run, failed.mission.revision, { kind: 'repair', name: 'c1-cli' })
    const passed = execute(run, repaired.mission.revision, { kind: 'probe', name: 'c1-cli' })
    assert.equal(passed.outcome, 'passed')
    assert.equal(passed.mission.accounting.noProgress, failed.mission.accounting.noProgress)
    assert.deepEqual(
      {
        status: passed.details.status,
        stdout: passed.details.stdout,
        stderr: passed.details.stderr,
      },
      { status: 0, stdout: 'correct\n', stderr: '' },
    )
    const closed = execute(run, passed.mission.revision, { kind: 'closeout' })
    assert.equal(closed.mission.state, 'agent_checked')
    assert.equal(closed.mission.accounting.cycles, 2)
    assert.equal(closed.mission.accounting.repairs, 1)
  } finally {
    assert.deepEqual(disposeRun(run), { cleaned: true, residue: [] })
  }
})

test('C2 repairs executable propagation code and proves initial, changed, reset, and changed-again', () => {
  const run = createRun('C2')
  try {
    const initialMission = readMission(run)
    const initial = execute(run, initialMission.revision, {
      kind: 'probe',
      name: 'c2-propagation',
    })
    assert.equal(initial.outcome, 'passed')
    assert.deepEqual(initial.details.snapshot, expectedC2Snapshot('night'))

    const changed = execute(run, initial.mission.revision, { kind: 'set-source', value: 'day' })
    assert.deepEqual(changed.details.snapshot, {
      control: 'day',
      hero: 'day',
      sibling: 'night',
      export: 'night',
    })
    assert.equal(changed.mission.criteria[0].status, 'open')
    const brokenProbe = execute(run, changed.mission.revision, {
      kind: 'probe',
      name: 'c2-propagation',
    })
    assert.equal(brokenProbe.outcome, 'failed')

    const repaired = execute(run, brokenProbe.mission.revision, {
      kind: 'repair',
      name: 'c2-propagation',
    })
    const reset = execute(run, repaired.mission.revision, { kind: 'set-source', value: 'night' })
    assert.deepEqual(reset.details.snapshot, expectedC2Snapshot('night'))
    const changedAgain = execute(run, reset.mission.revision, { kind: 'set-source', value: 'day' })
    assert.deepEqual(changedAgain.details.snapshot, expectedC2Snapshot('day'))
    const proof = execute(run, changedAgain.mission.revision, {
      kind: 'probe',
      name: 'c2-propagation',
    })
    assert.equal(proof.outcome, 'passed')
    const closed = execute(run, proof.mission.revision, { kind: 'closeout' })
    assert.equal(closed.mission.state, 'agent_checked')
  } finally {
    assert.deepEqual(disposeRun(run), { cleaned: true, residue: [] })
  }
})

test('C3 structural proxy stays green while runtime catalog proof fails until repair', () => {
  const run = createRun('C3')
  try {
    const mission = readMission(run)
    const proxy = execute(run, mission.revision, { kind: 'probe', name: 'c3-structural' })
    assert.equal(proxy.outcome, 'passed')
    assert.equal(proxy.mission.criteria[0].status, 'open')
    const runtimeFailure = execute(run, proxy.mission.revision, {
      kind: 'probe',
      name: 'c3-runtime',
    })
    assert.equal(runtimeFailure.outcome, 'failed')
    const repaired = execute(run, runtimeFailure.mission.revision, {
      kind: 'repair',
      name: 'c3-catalog',
    })
    const runtimeProof = execute(run, repaired.mission.revision, {
      kind: 'probe',
      name: 'c3-runtime',
    })
    assert.equal(runtimeProof.outcome, 'passed')
    const closed = execute(run, runtimeProof.mission.revision, { kind: 'closeout' })
    assert.equal(closed.mission.state, 'agent_checked')
  } finally {
    assert.deepEqual(disposeRun(run), { cleaned: true, residue: [] })
  }
})

test('C4 reloads fresh state, invalidates edits, rejects stale grants, and selects needs_human', () => {
  const run = createRun('C4')
  try {
    const first = execute(run, readMission(run).revision, { kind: 'probe', name: 'c4-agent' })
    const cyclesBeforeReload = first.mission.accounting.cycles
    const reloaded = execute(run, first.mission.revision, { kind: 'reload-session' })
    assert.equal(readMission(run).sessionId, 'session-0002')
    assert.equal(reloaded.mission.accounting.cycles, cyclesBeforeReload)

    execute(run, reloaded.mission.revision, {
      kind: 'external-tamper-fixture',
      mutation: 'candidate-bytes',
    })
    const staleCloseout = execute(run, reloaded.mission.revision, { kind: 'closeout' })
    assert.equal(staleCloseout.mission.state, 'working')
    assert.equal(staleCloseout.mission.criteria[0].status, 'open')
    assert.equal(staleCloseout.mission.accounting.rereviews, 1)

    const freshProof = execute(run, staleCloseout.mission.revision, {
      kind: 'probe',
      name: 'c4-agent',
    })
    const revision = freshProof.mission.revision
    const effectsBeforeRefusals = run.fixtureEffects
    for (const grant of ['missing', 'historical', 'wrong-scope'] as const) {
      assert.throws(
        () => execute(run, revision, { kind: 'gated-sentinel', grant }),
        new RegExp(grant === 'wrong-scope' ? 'wrong-scope.*other-sentinel' : grant),
      )
      assert.equal(readMission(run).revision, revision)
      assert.equal(run.fixtureEffects, effectsBeforeRefusals)
    }
    const closeout = execute(run, revision, { kind: 'closeout' })
    assert.equal(closeout.details.decision, 'needs_human')
    assert.equal(closeout.mission.state, 'needs_human')
    assert.equal(closeout.mission.criteria[0].status, 'checked')
    assert.equal(closeout.mission.criteria[1].status, 'open')
  } finally {
    assert.deepEqual(disposeRun(run), { cleaned: true, residue: [] })
  }

  const positive = createRun('C4')
  try {
    const candidateBefore = fs.readFileSync(`${positive.repoRoot}/candidate.txt`, 'utf8')
    assert.deepEqual(
      fs.readdirSync(positive.repoRoot).filter((name) => name !== '.git'),
      ['candidate.txt'],
    )
    const proof = execute(positive, readMission(positive).revision, {
      kind: 'probe',
      name: 'c4-agent',
    })
    assert.equal(proof.mission.criteria[0].status, 'checked')
    const granted = execute(positive, proof.mission.revision, {
      kind: 'gated-sentinel',
      grant: 'fresh',
    })
    assert.equal(granted.outcome, 'applied')
    assert.deepEqual(
      fs
        .readdirSync(positive.repoRoot)
        .filter((name) => name !== '.git')
        .sort(),
      ['candidate.txt', 'sentinel.txt'],
    )
    assert.equal(fs.readFileSync(`${positive.repoRoot}/candidate.txt`, 'utf8'), candidateBefore)
    assert.equal(
      fs.readFileSync(`${positive.repoRoot}/sentinel.txt`, 'utf8'),
      'synthetic granted mutation\n',
    )
    assert.equal(granted.mission.criteria[0].status, 'open')
  } finally {
    assert.deepEqual(disposeRun(positive), { cleaned: true, residue: [] })
  }
})

test('C5 duplicate, missing, and cancellation variants close deterministically across reload', () => {
  const duplicate = createRun('C5-duplicate')
  try {
    const started = execute(duplicate, readMission(duplicate).revision, {
      kind: 'start-attempt',
      assignmentId: 'assignment-primary',
      attemptId: 'attempt-primary',
    })
    const reported = execute(duplicate, started.mission.revision, {
      kind: 'report',
      attemptId: 'attempt-primary',
      reportId: 'report-primary',
    })
    const persisted = readMission(duplicate)
    assert.throws(
      () =>
        execute(duplicate, persisted.revision, {
          kind: 'report',
          attemptId: 'attempt-primary',
          reportId: 'report-replacement',
        }),
      /conflicting report/,
    )
    assert.throws(
      () =>
        execute(duplicate, persisted.revision, {
          kind: 'report',
          attemptId: 'attempt-unknown',
          reportId: 'report-primary',
        } as unknown as Operation),
      /invalid attempt id rejected before lock or effect/,
    )
    assert.equal(readMission(duplicate).revision, persisted.revision)
    const repeated = execute(duplicate, persisted.revision, {
      kind: 'report',
      attemptId: 'attempt-primary',
      reportId: 'report-primary',
    })
    assert.equal(repeated.outcome, 'idempotent')
    assert.deepEqual(repeated.mission.attempts, reported.mission.attempts)
    assert.equal(repeated.mission.attempts[0].state, 'reported')
    assert.equal(repeated.mission.assignments[0].fulfilledBy, undefined)
    assert.equal(repeated.mission.criteria[0].status, 'open')
    const audited = execute(duplicate, repeated.mission.revision, {
      kind: 'audit-report',
      attemptId: 'attempt-primary',
      reportId: 'report-primary',
    })
    const closed = execute(duplicate, audited.mission.revision, { kind: 'closeout' })
    assert.equal(closed.mission.state, 'agent_checked')
  } finally {
    assert.deepEqual(disposeRun(duplicate), { cleaned: true, residue: [] })
  }

  const unaudited = createRun('C5-duplicate')
  try {
    const started = execute(unaudited, readMission(unaudited).revision, {
      kind: 'start-attempt',
      assignmentId: 'assignment-primary',
      attemptId: 'attempt-primary',
    })
    const reported = execute(unaudited, started.mission.revision, {
      kind: 'report',
      attemptId: 'attempt-primary',
      reportId: 'report-primary',
    })
    const closed = execute(unaudited, reported.mission.revision, { kind: 'closeout' })
    assert.equal(closed.mission.state, 'blocked')
    assert.throws(
      () =>
        execute(unaudited, closed.mission.revision, {
          kind: 'audit-report',
          attemptId: 'attempt-primary',
          reportId: 'report-primary',
        }),
      /terminal mission blocked rejects new work/,
    )
  } finally {
    assert.deepEqual(disposeRun(unaudited), { cleaned: true, residue: [] })
  }

  const missing = createRun('C5-missing')
  try {
    const started = execute(missing, readMission(missing).revision, {
      kind: 'start-attempt',
      assignmentId: 'assignment-primary',
      attemptId: 'attempt-primary',
    })
    const closed = execute(missing, started.mission.revision, { kind: 'closeout' })
    assert.equal(closed.mission.state, 'blocked')
  } finally {
    assert.deepEqual(disposeRun(missing), { cleaned: true, residue: [] })
  }

  const cancelled = createRun('C5-cancel')
  try {
    const started = execute(cancelled, readMission(cancelled).revision, {
      kind: 'start-attempt',
      assignmentId: 'assignment-primary',
      attemptId: 'attempt-primary',
    })
    const stopped = execute(cancelled, started.mission.revision, {
      kind: 'cancel-attempt',
      attemptId: 'attempt-primary',
    })
    const reconciled = execute(cancelled, stopped.mission.revision, {
      kind: 'reconcile-attempt',
      attemptId: 'attempt-primary',
    })
    const closed = execute(cancelled, reconciled.mission.revision, { kind: 'closeout' })
    assert.equal(closed.mission.state, 'cancelled')
  } finally {
    assert.deepEqual(disposeRun(cancelled), { cleaned: true, residue: [] })
  }
})

test('C5 immutable assignment rejects live replacement and accepts linked audited replacement', () => {
  const run = createRun('C5-replacement')
  try {
    const started = execute(run, readMission(run).revision, {
      kind: 'start-attempt',
      assignmentId: 'assignment-primary',
      attemptId: 'attempt-primary',
    })
    const childDebit = started.mission.accounting.children
    assert.throws(
      () =>
        execute(run, started.mission.revision, {
          kind: 'replace-attempt',
          assignmentId: 'assignment-primary',
          failedAttemptId: 'attempt-primary',
          attemptId: 'attempt-replacement',
        }),
      /reconciled failed/,
    )
    assert.equal(readMission(run).revision, started.mission.revision)
    assert.equal(readMission(run).accounting.children, childDebit)

    const failed = execute(run, started.mission.revision, {
      kind: 'fail-attempt',
      attemptId: 'attempt-primary',
    })
    assert.throws(
      () =>
        execute(run, failed.mission.revision, {
          kind: 'replace-attempt',
          assignmentId: 'assignment-primary',
          failedAttemptId: 'attempt-primary',
          attemptId: 'attempt-replacement',
        }),
      /reconciled failed/,
    )
    const reconciled = execute(run, failed.mission.revision, {
      kind: 'reconcile-attempt',
      attemptId: 'attempt-primary',
    })
    assert.equal(reconciled.mission.assignments[0].fulfilledBy, undefined)
    const replacement = execute(run, reconciled.mission.revision, {
      kind: 'replace-attempt',
      assignmentId: 'assignment-primary',
      failedAttemptId: 'attempt-primary',
      attemptId: 'attempt-replacement',
    })
    const report = execute(run, replacement.mission.revision, {
      kind: 'report',
      attemptId: 'attempt-replacement',
      reportId: 'report-replacement',
    })
    assert.equal(report.mission.assignments[0].fulfilledBy, undefined)
    assert.equal(report.mission.attempts[1].replacementFor, 'attempt-primary')
    const audited = execute(run, report.mission.revision, {
      kind: 'audit-report',
      attemptId: 'attempt-replacement',
      reportId: 'report-replacement',
    })
    assert.equal(audited.mission.assignments[0].fulfilledBy, 'attempt-replacement')
    const closed = execute(run, audited.mission.revision, { kind: 'closeout' })
    assert.equal(closed.mission.state, 'agent_checked')
  } finally {
    assert.deepEqual(disposeRun(run), { cleaned: true, residue: [] })
  }
})

test('exclusive ownership, stale revisions, and malformed identity produce no fixture effect', () => {
  const locked = createRun('C1')
  try {
    const initial = readMission(locked)
    assert.equal(fs.statSync(locked.missionPath).mode & 0o777, 0o600)
    assert.equal(fs.statSync(locked.preflightPath).mode & 0o777, 0o600)
    execute(locked, initial.revision, { kind: 'hold-lock-fixture', controller: 'A' })
    assert.equal(fs.statSync(locked.lockPath).mode & 0o777, 0o600)
    const effects = locked.fixtureEffects
    assert.throws(
      () => execute(locked, initial.revision, { kind: 'repair', name: 'c1-cli' }),
      /candidate=controller-a/,
    )
    assert.equal(readMission(locked).revision, initial.revision)
    assert.equal(locked.fixtureEffects, effects)
    execute(locked, initial.revision, { kind: 'release-lock-fixture', controller: 'A' })
    assert.throws(
      () => execute(locked, initial.revision + 1, { kind: 'repair', name: 'c1-cli' }),
      /stale mission revision/,
    )
    assert.equal(locked.fixtureEffects, effects)
    const calls = locked.processCalls
    assert.throws(
      () =>
        execute(locked, initial.revision, {
          kind: 'process',
          executable: process.execPath,
          argv: ['--eval', 'process.exit(0)'],
        } as unknown as Operation),
      /unknown operation rejected before effect/,
    )
    assert.equal(locked.processCalls, calls)
    const malformedOperations = [
      { kind: 'set-source', value: 'dusk' },
      { kind: 'start-attempt', assignmentId: 'assignment-other', attemptId: 'attempt-other' },
      { kind: 'report', attemptId: 'attempt-other', reportId: 'report-other' },
      {
        kind: 'replace-attempt',
        assignmentId: 'assignment-primary',
        failedAttemptId: 'attempt-other',
        attemptId: 'attempt-primary',
      },
      { kind: 'gated-sentinel', grant: 'forged' },
      { kind: 'simulate-interruption', effect: 'arbitrary' },
      { kind: 'hold-lock-fixture', controller: 'B' },
      { kind: 'external-tamper-fixture', mutation: 'arbitrary' },
    ]
    for (const operation of malformedOperations) {
      assert.throws(
        () => execute(locked, initial.revision, operation as unknown as Operation),
        /invalid .* rejected before lock or effect/,
      )
      assert.equal(readMission(locked).revision, initial.revision)
      assert.equal(locked.processCalls, calls)
      assert.equal(locked.fixtureEffects, effects)
    }
    assert.throws(
      () => parseMission({ ...initial, criteria: [...initial.criteria, initial.criteria[0]] }),
      /duplicate persisted id/,
    )
    assert.throws(
      () => parseMission({ ...initial, accounting: { ...initial.accounting, cycles: 1 } }),
      /accounting does not match receipts/,
    )
    assert.throws(
      () =>
        parseMission({
          ...initial,
          assignments: [{ assignmentId: 'assignment-primary', required: true, attemptIds: [] }],
          attempts: [
            {
              attemptId: 'attempt-primary',
              assignmentId: 'assignment-primary',
              state: 'live',
            },
          ],
        }),
      /not referenced by its assignment/,
    )
    assert.throws(
      () =>
        parseMission({
          ...initial,
          assignments: [
            {
              assignmentId: 'assignment-primary',
              required: true,
              attemptIds: ['attempt-primary'],
              fulfilledBy: 'attempt-primary',
            },
          ],
          attempts: [
            {
              attemptId: 'attempt-primary',
              assignmentId: 'assignment-primary',
              state: 'audited',
              report: {
                reportId: 'report-primary',
                attemptId: 'attempt-primary',
                fingerprint: initial.artifactFingerprint,
                outcome: 'success',
                proofMethod: 'c5-report',
              },
            },
          ],
          criteria: [
            {
              id: 'child-report',
              owner: 'agent',
              status: 'checked',
              proofMethod: 'c5-report',
              evidence: {
                fingerprint: '0'.repeat(64),
                observedAt: '2026-09-11T08:00:00.000Z',
                observedRevision: 0,
                proofMethod: 'c5-report',
                scope: ['workspace/**'],
                reportRefs: ['report-primary'],
              },
            },
          ],
        }),
      /evidence\/report fingerprint mismatch/,
    )
  } finally {
    assert.deepEqual(disposeRun(locked), { cleaned: true, residue: [] })
  }

  for (const mutation of ['malformed-state', 'identity-mismatch'] as const) {
    const run = createRun('guards')
    try {
      const effects = run.fixtureEffects
      execute(run, readMission(run).revision, { kind: 'external-tamper-fixture', mutation })
      assert.throws(() => readMission(run), /invalid mission fields|identity mismatch/)
      assert.equal(run.fixtureEffects, effects)
    } finally {
      assert.deepEqual(disposeRun(run), { cleaned: true, residue: [] })
    }
  }
})

test('fingerprints include bytes and mode and reject regular, dangling, and special links', () => {
  for (const mutation of [
    'candidate-mode',
    'regular-symlink',
    'dangling-symlink',
    'special-file',
  ] as const) {
    const run = createRun(mutation === 'candidate-mode' ? 'C4' : 'guards')
    try {
      let revision = readMission(run).revision
      if (mutation === 'candidate-mode') {
        const proof = execute(run, revision, { kind: 'probe', name: 'c4-agent' })
        revision = proof.mission.revision
      }
      execute(run, revision, { kind: 'external-tamper-fixture', mutation })
      if (mutation === 'candidate-mode') {
        const stale = execute(run, revision, { kind: 'closeout' })
        assert.equal(stale.mission.state, 'working')
      } else {
        assert.throws(
          () => execute(run, revision, { kind: 'probe', name: 'c1-cli' }),
          /fingerprint rejects symlink|fingerprint rejects special file/,
        )
        assert.equal(readMission(run).revision, revision)
      }
    } finally {
      assert.deepEqual(disposeRun(run), { cleaned: true, residue: [] })
    }
  }
})

test('persisted limits, deadline, and interrupted receipts block effects without replay or refund', () => {
  const exhausted = createRun('guards')
  try {
    const first = execute(exhausted, readMission(exhausted).revision, {
      kind: 'probe',
      name: 'c1-cli',
    })
    assert.equal(first.mission.accounting.noProgress, 1)
    const second = execute(exhausted, first.mission.revision, {
      kind: 'probe',
      name: 'c1-cli',
    })
    assert.equal(second.mission.accounting.noProgress, 2)
    const effects = exhausted.fixtureEffects
    const blocked = execute(exhausted, second.mission.revision, {
      kind: 'probe',
      name: 'c1-cli',
    })
    assert.equal(blocked.mission.state, 'blocked')
    assert.match(String(blocked.details.blocked), /noProgress budget exhausted/)
    assert.equal(exhausted.fixtureEffects, effects)
  } finally {
    assert.deepEqual(disposeRun(exhausted), { cleaned: true, residue: [] })
  }

  const deadline = createRun('C5-cancel')
  try {
    const started = execute(deadline, readMission(deadline).revision, {
      kind: 'start-attempt',
      assignmentId: 'assignment-primary',
      attemptId: 'attempt-primary',
    })
    execute(deadline, started.mission.revision, {
      kind: 'external-tamper-fixture',
      mutation: 'deadline-clock',
    })
    const effects = deadline.fixtureEffects
    const blocked = execute(deadline, started.mission.revision, {
      kind: 'report',
      attemptId: 'attempt-primary',
      reportId: 'report-primary',
    })
    assert.equal(blocked.mission.state, 'blocked')
    assert.match(String(blocked.details.blocked), /deadline exhausted/)
    assert.equal(deadline.fixtureEffects, effects)
    const cancelled = execute(deadline, blocked.mission.revision, {
      kind: 'cancel-attempt',
      attemptId: 'attempt-primary',
    })
    const reconciled = execute(deadline, cancelled.mission.revision, {
      kind: 'reconcile-attempt',
      attemptId: 'attempt-primary',
    })
    assert.equal(reconciled.mission.attempts[0].state, 'reconciled')
  } finally {
    assert.deepEqual(disposeRun(deadline), { cleaned: true, residue: [] })
  }

  const interrupted = createRun('guards')
  try {
    const pending = execute(interrupted, readMission(interrupted).revision, {
      kind: 'simulate-interruption',
      effect: 'c1-repair',
    })
    assert.equal(pending.outcome, 'interrupted')
    assert.equal(pending.mission.accounting.repairs, 1)
    const effects = interrupted.fixtureEffects
    assert.throws(
      () => execute(interrupted, pending.mission.revision, { kind: 'repair', name: 'c1-cli' }),
      /blocks resume without replay or refund/,
    )
    assert.equal(interrupted.fixtureEffects, effects)
    const reconciled = execute(interrupted, pending.mission.revision, {
      kind: 'reconcile-pending',
    })
    assert.equal(reconciled.mission.state, 'blocked')
    assert.equal(reconciled.mission.accounting.repairs, 1)
  } finally {
    assert.deepEqual(disposeRun(interrupted), { cleaned: true, residue: [] })
  }
})
