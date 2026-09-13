import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  computeManifestHash,
  type FrozenContractBindings,
  type HostEvidenceManifest,
  type StrictFinalResponse,
  sha256Text,
} from '../tools/host-evidence-contract.ts'
import {
  createCanaryReportBody,
  type IngestDirectCliEvidenceParams,
  ingestAndVerifyDirectCliEvidence,
  loadPhase3Checkpoint,
  type MemfsSnapshot,
  type RepositorySnapshot,
  savePhase3Checkpoint,
  verifyPhase3Checkpoint,
} from '../tools/host-evidence-direct-cli.ts'
import { createDirectCliJobBundle } from './support/direct-cli-bundle-fixture.ts'

const TEST_PROMPT = 'synthetic host-evidence prompt direct-cli'

export function buildTestFixture(promptText = TEST_PROMPT) {
  const promptHash = sha256Text(promptText)
  const answerKeyHash = sha256Text('synthetic answer key direct-cli')
  const scorerHash = sha256Text('host-evidence scorer direct-cli')
  const manifest: HostEvidenceManifest = {
    schemaVersion: 1,
    cellId: 'cell-direct-001',
    taskId: 'task-direct-001',
    promptHash,
    answerKeyHash,
    scorerHash,
    plannedHost: {
      agyVersion: '0.1.0',
      model: 'gemini-2.5-pro',
      effort: 'high',
    },
    executionPolicy: {
      allowMemoryMutation: false,
      allowLiveHostExecution: true,
      allowProviderAction: false,
    },
    expectedResponse: {
      status: 'ANSWERED',
      canonicalSource: 'reference/synthetic-runbook.md',
      fields: [
        { name: 'humanAction', value: 'throttle', unknownValue: 'UNKNOWN', policy: 'case-fold' },
        { name: 'api', value: 'POST', unknownValue: '', policy: 'exact' },
        { name: 'path', value: '/v1/synthetic/jobs', unknownValue: '', policy: 'exact' },
      ],
    },
    retrieval: {
      required: false,
      canonicalOwner: 'synthetic-owner',
      requiredFactMarkers: [],
      factAlreadyActive: true,
    },
    budgets: {
      gateEfficiency: false,
      maxTransportAttempts: 1,
      maxCreatedConversations: 1,
      maxPlannerResponses: 2,
      maxPlannerContinuations: 1,
      maxToolCalls: 2,
      maxSearchCalls: 1,
      maxReturnedBytes: 8192,
      maxNoProgressSteps: 0,
      maxRepeatedQueries: 0,
    },
  }
  const manifestHash = computeManifestHash(manifest)
  const bindings: FrozenContractBindings = {
    manifestHash,
    promptHash,
    answerKeyHash,
    scorerHash,
  }
  return { manifest, bindings }
}

export function testFinalResponse(): StrictFinalResponse {
  return {
    taskId: 'task-direct-001',
    status: 'ANSWERED',
    answer: {
      humanAction: 'Throttle',
      api: 'POST',
      path: '/v1/synthetic/jobs',
    },
    sources: ['reference/synthetic-runbook.md'],
  }
}

describe('Direct CLI Phase 3 Evidence-Only Adapter', () => {
  let tempDir: string
  let beforeTemp: Set<string>

  beforeEach(() => {
    beforeTemp = new Set(fs.readdirSync(fs.realpathSync(os.tmpdir())))
    tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'direct-cli-test-'))
    fs.chmodSync(tempDir, 0o700)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    const temp = fs.realpathSync(os.tmpdir())
    for (const entry of fs.readdirSync(temp)) {
      if (
        !beforeTemp.has(entry) &&
        (entry.startsWith('direct-cli-test-') || entry.startsWith('host-evidence-v1-'))
      ) {
        fs.rmSync(path.join(temp, entry), { recursive: true, force: true })
      }
    }
  })

  function validParams(
    jobDir: string,
    manifest: HostEvidenceManifest,
    bindings: FrozenContractBindings,
    overrides: Partial<IngestDirectCliEvidenceParams> = {},
  ): IngestDirectCliEvidenceParams {
    const repoSnapshot: RepositorySnapshot = {
      headCommit: 'abc1234',
      statusHash: 'repo-clean-hash',
      contentHash: 'repo-content-hash',
    }
    const memfsSnapshot: MemfsSnapshot = {
      headCommit: 'def5678',
      statusHash: 'memfs-clean-hash',
      contentHash: 'memfs-content-hash',
    }
    return {
      jobDir,
      manifest,
      bindings,
      expectedCwd: fs.realpathSync(tempDir),
      beforeRepositorySnapshot: repoSnapshot,
      afterRepositorySnapshot: repoSnapshot,
      beforeMemfsSnapshot: memfsSnapshot,
      afterMemfsSnapshot: memfsSnapshot,
      ...overrides,
    }
  }

  it('1. fixture evidence: verifies a done callback-shaped bundle without promoting it to live', () => {
    const { manifest, bindings } = buildTestFixture()
    const reportBody = createCanaryReportBody({
      taskId: manifest.taskId,
      promptHash: manifest.promptHash,
      agyVersion: manifest.plannedHost.agyVersion,
      model: manifest.plannedHost.model,
      effort: manifest.plannedHost.effort,
      finalResponse: testFinalResponse(),
    })
    const { jobDir } = createDirectCliJobBundle(tempDir, {
      promptText: TEST_PROMPT,
      reportBody,
      cwd: fs.realpathSync(tempDir),
    })

    const result = ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings))
    assert.strictEqual(result.phase3Checkpoint.verifiedLive, false)
    assert.strictEqual(result.phase3Checkpoint.mode, 'fixture')
    assert.strictEqual(verifyPhase3Checkpoint(result.phase3Checkpoint, 'live'), false)
    assert.strictEqual(result.score.passed, true)
    assert.strictEqual(result.score.correctness, true)
    assert.strictEqual(result.score.safety, true)
    assert.strictEqual(result.report.finalResponse.status, 'ANSWERED')
    assert.strictEqual(result.evidence.protocolFacts.providerActionObserved, false)
    assert.strictEqual(fs.existsSync(path.join(result.phase2Root, 'seal.json')), true)
  })

  it('2. fixture mode: verifies successfully but verifiedLive is false and live checkpoint verification fails', () => {
    const { manifest, bindings } = buildTestFixture()
    const reportBody = createCanaryReportBody({
      taskId: manifest.taskId,
      promptHash: manifest.promptHash,
      agyVersion: manifest.plannedHost.agyVersion,
      model: manifest.plannedHost.model,
      effort: manifest.plannedHost.effort,
      finalResponse: testFinalResponse(),
    })
    const { jobDir } = createDirectCliJobBundle(tempDir, {
      promptText: TEST_PROMPT,
      reportBody,
      cwd: fs.realpathSync(tempDir),
    })

    const result = ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings))
    assert.strictEqual(result.phase3Checkpoint.verifiedLive, false)
    assert.strictEqual(result.phase3Checkpoint.mode, 'fixture')
    assert.strictEqual(verifyPhase3Checkpoint(result.phase3Checkpoint, 'live'), false)
    assert.strictEqual(verifyPhase3Checkpoint(result.phase3Checkpoint, 'fixture'), true)
    assert.strictEqual(result.score.passed, true)
  })

  it('3. rejection: watcher jobs rejected as live proof', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, {
      schema: 'direct-cli.herdr-job.v1',
      mode: 'watcher',
    })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /schema: unsupported job schema/,
    )
  })

  it('4. rejection: watcher mode rejected', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { mode: 'watcher' })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /mode: expected callback mode/,
    )
  })

  it('5. rejection: watcherFallback rejected as live callback proof', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { watcherFallback: true })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /mode: watcher fallback cannot serve as live callback proof/,
    )
  })

  it('6. rejection: status attention rejected', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { status: 'attention' })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /status: expected terminal done status/,
    )
  })

  it('7. rejection: status error rejected', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { status: 'error' })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /status: expected terminal done status/,
    )
  })

  it('8. rejection: status running rejected', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { status: 'running' })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /status: expected terminal done status/,
    )
  })

  it('9. rejection: report_failed in reportState or message kind', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { reportKind: 'report_failed' })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /reports: target report status is report_failed/,
    )
  })

  it('10. rejection: missing or empty agentSession in target receipt', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { agentSession: '' })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /target: receipt missing non-empty agentSession/,
    )
  })

  it('11. rejection: replaced/mismatched agentSession between message senderReceipt and job target receipt', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir, messageId } = createDirectCliJobBundle(tempDir)
    const msgPath = path.join(jobDir, 'messages', messageId, 'message.json')
    const msg = JSON.parse(fs.readFileSync(msgPath, 'utf8'))
    msg.senderReceipt.agentSession = 'session-tampered-999'
    fs.writeFileSync(msgPath, JSON.stringify(msg, null, 2), { mode: 0o600 })

    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /message: senderReceipt mismatch with target receipt/,
    )
  })

  it('12. rejection: mismatched target receipts (paneId drift)', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir, messageId } = createDirectCliJobBundle(tempDir)
    const msgPath = path.join(jobDir, 'messages', messageId, 'message.json')
    const msg = JSON.parse(fs.readFileSync(msgPath, 'utf8'))
    msg.senderReceipt.paneId = 'different-pane-id'
    fs.writeFileSync(msgPath, JSON.stringify(msg, null, 2), { mode: 0o600 })

    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /message: senderReceipt mismatch with target receipt/,
    )
  })

  it('13. rejection: mismatched parent receipt in message ack', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir, messageId } = createDirectCliJobBundle(tempDir)
    const msgPath = path.join(jobDir, 'messages', messageId, 'message.json')
    const msg = JSON.parse(fs.readFileSync(msgPath, 'utf8'))
    msg.ack.receipt.terminal = 'different-terminal'
    fs.writeFileSync(msgPath, JSON.stringify(msg, null, 2), { mode: 0o600 })

    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /message: acknowledgement receipt mismatch with parent receipt/,
    )
  })

  it('14. rejection: unacknowledged message (ack is null)', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { ackBy: '' })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /message: missing parent acknowledgement/,
    )
  })

  it('15. rejection: delivery status not accepted', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { deliveryStatus: 'failed' })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /message: delivery status is failed, expected accepted/,
    )
  })

  it('16. rejection: prompt.txt content tamper (hash mismatch)', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { promptText: TEST_PROMPT })
    fs.writeFileSync(path.join(jobDir, 'prompt.txt'), 'tampered prompt text', { mode: 0o600 })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /binding: prompt.txt SHA-256 does not match/,
    )
  })

  it('17. rejection: dispatch-prompt.txt content tamper', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { promptText: TEST_PROMPT })
    fs.writeFileSync(path.join(jobDir, 'dispatch-prompt.txt'), 'tampered dispatch prompt', {
      mode: 0o600,
    })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /binding: dispatch-prompt.txt SHA-256 does not match/,
    )

    const { jobDir: coherentJobDir } = createDirectCliJobBundle(tempDir, {
      jobId: 'coherent-dispatch-tamper',
      promptText: TEST_PROMPT,
    })
    const replacement = Buffer.from('unrelated dispatch bytes', 'utf8')
    fs.writeFileSync(path.join(coherentJobDir, 'dispatch-prompt.txt'), replacement, { mode: 0o600 })
    const jobPath = path.join(coherentJobDir, 'job.json')
    const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'))
    job.dispatchSha256 = sha256Text(replacement.toString('utf8'))
    job.dispatchPromptSha256 = job.dispatchSha256
    fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), { mode: 0o600 })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(coherentJobDir, manifest, bindings)),
      /binding: dispatch prompt is not the task prompt plus Direct CLI callback footer/,
    )
  })

  it('18. rejection: message body content tamper', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { corruptBodyHash: true })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /message: body content SHA-256 mismatch/,
    )
  })

  it('19. rejection: results file content does not match finalized message body', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir, { corruptResultFile: true })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /result: results file content does not match finalized message body/,
    )
  })

  it('20. rejection: duplicate/reused job identity', () => {
    const { manifest, bindings } = buildTestFixture()
    const reportBody = createCanaryReportBody({
      taskId: manifest.taskId,
      promptHash: manifest.promptHash,
      agyVersion: manifest.plannedHost.agyVersion,
      model: manifest.plannedHost.model,
      effort: manifest.plannedHost.effort,
      finalResponse: testFinalResponse(),
    })
    const { jobDir } = createDirectCliJobBundle(tempDir, {
      promptText: TEST_PROMPT,
      reportBody,
      cwd: fs.realpathSync(tempDir),
    })

    const seenJobIds = new Set<string>()
    ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings, { seenJobIds }))
    assert.throws(
      () =>
        ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings, { seenJobIds })),
      /ownership: duplicate\/reused job identity detected/,
    )
  })

  it('21. rejection: symlink job directory', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir)
    const symlinkPath = path.join(tempDir, 'job-symlink')
    fs.symlinkSync(jobDir, symlinkPath)
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(symlinkPath, manifest, bindings)),
      /filesystem boundary: directory must not be a symlink/,
    )
  })

  it('22. rejection: symlink file inside job bundle', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir)
    const promptPath = path.join(jobDir, 'prompt.txt')
    const realFile = path.join(tempDir, 'real-prompt.txt')
    fs.copyFileSync(promptPath, realFile)
    fs.unlinkSync(promptPath)
    fs.symlinkSync(realFile, promptPath)
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /filesystem boundary: symlinks forbidden in direct-cli bundle/,
    )
  })

  it('23. rejection: changed repository snapshot', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir)
    const params = validParams(jobDir, manifest, bindings, {
      afterRepositorySnapshot: {
        headCommit: 'abc1234',
        statusHash: 'dirty-diff-hash',
        contentHash: 'repo-content-hash',
      },
    })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(params),
      /invariance: repository snapshot modified during run/,
    )

    const sameStatusDifferentBytes = validParams(jobDir, manifest, bindings, {
      afterRepositorySnapshot: {
        headCommit: 'abc1234',
        statusHash: 'repo-clean-hash',
        contentHash: 'different-repo-content',
      },
    })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(sameStatusDifferentBytes),
      /invariance: repository snapshot modified during run/,
    )
  })

  it('24. rejection: changed live MemFS snapshot', () => {
    const { manifest, bindings } = buildTestFixture()
    const { jobDir } = createDirectCliJobBundle(tempDir)
    const params = validParams(jobDir, manifest, bindings, {
      afterMemfsSnapshot: {
        headCommit: 'modified-commit',
        statusHash: 'memfs-clean-hash',
        contentHash: 'memfs-content-hash',
      },
    })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(params),
      /invariance: MemFS snapshot modified during run/,
    )
  })

  it('25. rejection: working directory mismatch', () => {
    const { manifest, bindings } = buildTestFixture()
    const wrongDir = path.join(tempDir, 'wrong-dir')
    fs.mkdirSync(wrongDir, { recursive: true })
    const { jobDir } = createDirectCliJobBundle(tempDir, { cwd: fs.realpathSync(wrongDir) })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /cwd: job working directory mismatch/,
    )
  })

  it('26. acceptance: collectedAt marked in job.json verifies successfully', () => {
    const { manifest, bindings } = buildTestFixture()
    const reportBody = createCanaryReportBody({
      taskId: manifest.taskId,
      promptHash: manifest.promptHash,
      agyVersion: manifest.plannedHost.agyVersion,
      model: manifest.plannedHost.model,
      effort: manifest.plannedHost.effort,
      finalResponse: testFinalResponse(),
    })
    const { jobDir } = createDirectCliJobBundle(tempDir, {
      promptText: TEST_PROMPT,
      reportBody,
      cwd: fs.realpathSync(tempDir),
      collectedAt: '2026-09-13T01:00:00Z',
    })

    const result = ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings))
    assert.strictEqual(result.phase3Checkpoint.verifiedLive, false)
    assert.strictEqual(result.score.passed, true)
  })

  it('27. acceptance: collectedAt omitted but parent acknowledgement finalized callback job verifies successfully', () => {
    const { manifest, bindings } = buildTestFixture()
    const reportBody = createCanaryReportBody({
      taskId: manifest.taskId,
      promptHash: manifest.promptHash,
      agyVersion: manifest.plannedHost.agyVersion,
      model: manifest.plannedHost.model,
      effort: manifest.plannedHost.effort,
      finalResponse: testFinalResponse(),
    })
    const { jobDir } = createDirectCliJobBundle(tempDir, {
      promptText: TEST_PROMPT,
      reportBody,
      cwd: fs.realpathSync(tempDir),
      collectedAt: undefined,
    })

    const result = ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings))
    assert.strictEqual(result.phase3Checkpoint.verifiedLive, false)
    assert.strictEqual(result.score.passed, true)
  })

  it('28. rejection: report body contract - taskId mismatch', () => {
    const { manifest, bindings } = buildTestFixture()
    const reportBody = createCanaryReportBody({
      taskId: 'wrong-task-id',
      promptHash: manifest.promptHash,
      agyVersion: manifest.plannedHost.agyVersion,
      model: manifest.plannedHost.model,
      effort: manifest.plannedHost.effort,
      finalResponse: testFinalResponse(),
    })
    const { jobDir } = createDirectCliJobBundle(tempDir, {
      promptText: TEST_PROMPT,
      reportBody,
      cwd: fs.realpathSync(tempDir),
    })

    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /report.taskId mismatch/,
    )
  })

  it('29. rejection: report body contract - host claims drift or mutation claims', () => {
    const { manifest, bindings } = buildTestFixture()
    const reportBody = createCanaryReportBody({
      taskId: manifest.taskId,
      promptHash: manifest.promptHash,
      agyVersion: 'wrong-version',
      model: manifest.plannedHost.model,
      effort: manifest.plannedHost.effort,
      finalResponse: testFinalResponse(),
    })
    const { jobDir } = createDirectCliJobBundle(tempDir, {
      promptText: TEST_PROMPT,
      reportBody,
      cwd: fs.realpathSync(tempDir),
    })

    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings)),
      /report.reportedHost: host claims drift/,
    )

    const wrongAnswer = testFinalResponse()
    wrongAnswer.answer.api = 'GET'
    const wrongAnswerBody = createCanaryReportBody({
      taskId: manifest.taskId,
      promptHash: manifest.promptHash,
      agyVersion: manifest.plannedHost.agyVersion,
      model: manifest.plannedHost.model,
      effort: manifest.plannedHost.effort,
      finalResponse: wrongAnswer,
    })
    const { jobDir: wrongAnswerJob } = createDirectCliJobBundle(tempDir, {
      jobId: 'wrong-answer-job',
      promptText: TEST_PROMPT,
      reportBody: wrongAnswerBody,
      cwd: fs.realpathSync(tempDir),
    })
    assert.throws(
      () => ingestAndVerifyDirectCliEvidence(validParams(wrongAnswerJob, manifest, bindings)),
      /score: verified Direct CLI evidence did not pass/,
    )
  })

  it('30. retained checkpoint verification: detects tampering with snapshot hashes or mode', () => {
    const { manifest, bindings } = buildTestFixture()
    const reportBody = createCanaryReportBody({
      taskId: manifest.taskId,
      promptHash: manifest.promptHash,
      agyVersion: manifest.plannedHost.agyVersion,
      model: manifest.plannedHost.model,
      effort: manifest.plannedHost.effort,
      finalResponse: testFinalResponse(),
    })
    const { jobDir } = createDirectCliJobBundle(tempDir, {
      promptText: TEST_PROMPT,
      reportBody,
      cwd: fs.realpathSync(tempDir),
    })

    const result = ingestAndVerifyDirectCliEvidence(validParams(jobDir, manifest, bindings))
    const checkpointFile = path.join(tempDir, 'saved-checkpoint.json')
    savePhase3Checkpoint(result.phase3Checkpoint, checkpointFile)

    const loaded = loadPhase3Checkpoint(checkpointFile)
    assert.strictEqual(loaded.jobId, result.phase3Checkpoint.jobId)

    // Tamper with snapshot hash
    const tampered = { ...loaded, beforeRepositorySnapshotHash: 'tampered-hash' }
    assert.strictEqual(verifyPhase3Checkpoint(tampered), false)

    // Tamper with mode (claim live on fixture)
    const tamperedMode = { ...loaded, mode: 'fixture' as const, verifiedLive: true }
    assert.strictEqual(verifyPhase3Checkpoint(tamperedMode), false)
  })
})
