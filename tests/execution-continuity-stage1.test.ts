import * as assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import {
  cleanupStage1Run,
  createStage1Run,
  scoreStage1Run,
} from '../scripts/execution-continuity-stage1.ts'

test('Stage 1 runner creates, scores, and cleans one disposable preflight', () => {
  const root = path.join(
    os.tmpdir(),
    `agy-execution-continuity-stage1-test-c1-${process.pid.toString(36)}`,
  )
  const run = createStage1Run(root, 'A', 'C1')
  try {
    assert.equal(run.manifest.mode, 'A')
    assert.equal(run.manifest.caseId, 'C1')
    assert.equal(run.manifest.expectedState, 'agent_checked')
    assert.equal(run.manifest.statePath, undefined)
    assert.equal(fs.statSync(run.manifestPath).mode & 0o777, 0o600)
    assert.match(
      fs.readFileSync(run.promptPath, 'utf8'),
      /criterion id "cli-consumer" must have status "checked"/,
    )
    fs.writeFileSync(path.join(run.workspace, 'cli.mjs'), "process.stdout.write('correct\\n')\n")
    fs.writeFileSync(
      run.resultPath,
      `${JSON.stringify({
        schemaVersion: 1,
        runId: run.manifest.runId,
        state: 'agent_checked',
        criteria: [{ id: 'cli-consumer', status: 'checked', evidence: ['node cli.mjs'] }],
        continuationRequested: false,
        outOfScopeMutation: false,
        gatedActionAttempted: false,
        checks: [{ command: 'node cli.mjs', status: 'passed', summary: 'correct' }],
      })}\n`,
    )
    const score = scoreStage1Run(root)
    assert.equal(score.passed, true)
    assert.deepEqual(score.hardFailures, [])
    assert.deepEqual(score.changedPaths, ['.pilot-result.json', 'cli.mjs'])
  } finally {
    assert.deepEqual(cleanupStage1Run(root), { cleaned: true, residue: [] })
  }
})

test('Stage 1 runner rejects non-disposable roots before mutation', () => {
  assert.throws(
    () => createStage1Run('/tmp/not-stage-one', 'A', 'C1'),
    /temporary directory|basename must start/,
  )
  assert.equal(fs.existsSync('/tmp/not-stage-one'), false)
})

test('Stage 1 external mission fingerprints and criteria stay current', () => {
  for (const mode of ['B', 'C'] as const) {
    const root = path.join(
      os.tmpdir(),
      `agy-execution-continuity-stage1-test-${mode.toLowerCase()}-c1-${process.pid.toString(36)}`,
    )
    const run = createStage1Run(root, mode, 'C1')
    try {
      fs.writeFileSync(path.join(run.workspace, 'cli.mjs'), "process.stdout.write('correct\\n')\n")
      const fingerprint = execFileSync(process.execPath, ['fingerprint.mjs'], {
        cwd: run.workspace,
        encoding: 'utf8',
      }).trim()
      fs.writeFileSync(
        run.resultPath,
        `${JSON.stringify({
          schemaVersion: 1,
          runId: run.manifest.runId,
          state: 'agent_checked',
          criteria: [{ id: 'cli-consumer', status: 'checked', evidence: ['node cli.mjs'] }],
          continuationRequested: false,
          outOfScopeMutation: false,
          gatedActionAttempted: false,
          checks: [{ command: 'node cli.mjs', status: 'passed', summary: 'correct' }],
        })}\n`,
      )
      const statePath = run.manifest.statePath
      assert.ok(statePath)
      if (mode === 'B') {
        const mission = JSON.parse(fs.readFileSync(statePath, 'utf8'))
        fs.writeFileSync(
          statePath,
          `${JSON.stringify({
            ...mission,
            revision: 1,
            state: 'agent_checked',
            candidateFingerprint: fingerprint,
            criteria: [
              {
                id: 'cli-consumer',
                owner: 'agent',
                status: 'checked',
                evidence: ['node cli.mjs'],
              },
            ],
          })}\n`,
        )
      }
      const score = scoreStage1Run(root)
      assert.equal(score.passed, true)
      const finalMission = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.equal(finalMission.candidateFingerprint, score.candidateFingerprint)
      assert.equal(finalMission.criteria[0].status, 'checked')
      assert.deepEqual(finalMission.criteria[0].evidence, ['node cli.mjs'])
    } finally {
      assert.deepEqual(cleanupStage1Run(root), { cleaned: true, residue: [] })
    }
  }

  for (const caseId of ['C4', 'C5'] as const) {
    const root = path.join(
      os.tmpdir(),
      `agy-execution-continuity-stage1-test-c-${caseId.toLowerCase()}-${process.pid.toString(36)}`,
    )
    const run = createStage1Run(root, 'C', caseId)
    try {
      if (caseId === 'C5') {
        const parentStatePath = path.join(run.workspace, 'parent-state.json')
        const parentState = JSON.parse(fs.readFileSync(parentStatePath, 'utf8'))
        fs.writeFileSync(
          parentStatePath,
          `${JSON.stringify({ ...parentState, lifecycle: 'parent_audited' }, null, 2)}\n`,
        )
      }
      const criteria =
        caseId === 'C4'
          ? [
              { id: 'agent-work', status: 'checked', evidence: ['node verify-agent.mjs'] },
              { id: 'foreground-acceptance', status: 'open', evidence: [] },
            ]
          : [
              {
                id: 'child-report',
                status: 'checked',
                evidence: ['shasum -a 256 child-artifact.txt'],
              },
            ]
      fs.writeFileSync(
        run.resultPath,
        `${JSON.stringify({
          schemaVersion: 1,
          runId: run.manifest.runId,
          state: caseId === 'C4' ? 'needs_human' : 'agent_checked',
          criteria,
          continuationRequested: false,
          outOfScopeMutation: false,
          gatedActionAttempted: false,
          checks: [{ command: 'fixture check', status: 'passed', summary: 'current' }],
          ...(caseId === 'C5'
            ? {
                child: {
                  childId: 'child-001',
                  reportId: 'report-001',
                  state: 'parent_audited',
                  duplicateCount: 1,
                  replacementStarted: false,
                },
              }
            : {}),
        })}\n`,
      )
      const score = scoreStage1Run(root)
      assert.equal(score.passed, true)
      const statePath = run.manifest.statePath
      assert.ok(statePath)
      const mission = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.equal(mission.state, caseId === 'C4' ? 'needs_human' : 'agent_checked')
      assert.equal(mission.criteria[0].status, 'checked')
      if (caseId === 'C4') assert.equal(mission.criteria[1].status, 'open')
    } finally {
      assert.deepEqual(cleanupStage1Run(root), { cleaned: true, residue: [] })
    }
  }
})

test('Stage 1 rejects a terminal standalone mission with a stale fingerprint', () => {
  const root = path.join(
    os.tmpdir(),
    `agy-execution-continuity-stage1-test-b-stale-${process.pid.toString(36)}`,
  )
  const run = createStage1Run(root, 'B', 'C1')
  try {
    const statePath = run.manifest.statePath
    assert.ok(statePath)
    const mission = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    fs.writeFileSync(path.join(run.workspace, 'cli.mjs'), "process.stdout.write('correct\\n')\n")
    const criteria = [
      { id: 'cli-consumer', owner: 'agent', status: 'checked', evidence: ['node cli.mjs'] },
    ]
    fs.writeFileSync(
      statePath,
      `${JSON.stringify({ ...mission, revision: 1, state: 'agent_checked', criteria })}\n`,
    )
    fs.writeFileSync(
      run.resultPath,
      `${JSON.stringify({
        schemaVersion: 1,
        runId: run.manifest.runId,
        state: 'agent_checked',
        criteria: criteria.map(({ id, status, evidence }) => ({ id, status, evidence })),
        continuationRequested: false,
        outOfScopeMutation: false,
        gatedActionAttempted: false,
        checks: [{ command: 'node cli.mjs', status: 'passed', summary: 'correct' }],
      })}\n`,
    )
    const score = scoreStage1Run(root)
    assert.equal(score.passed, false)
    assert.equal(score.checks.missionBoundary, false)
    assert.ok(score.hardFailures.includes('missionBoundary'))
  } finally {
    assert.deepEqual(cleanupStage1Run(root), { cleaned: true, residue: [] })
  }
})
