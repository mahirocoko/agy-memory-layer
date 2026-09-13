import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computeManifestHash,
  scoreHostEvidence,
  stableJson,
} from '../tools/host-evidence-contract.ts'
import {
  createReceipt,
  deriveHostEvidence,
  hashCanonical,
  parseReceipt,
  parseReceiptPayload,
  type Receipt,
  type ReceiptPayload,
  type ReplayContext,
  type RunDescriptor,
  replayRun,
} from '../tools/host-evidence-receipts.ts'
import { buildPositiveHostEvidenceFixture } from './support/host-evidence-fixtures.ts'

function context(trustRequired = false): ReplayContext {
  const fixture = buildPositiveHostEvidenceFixture()
  fixture.manifest.executionPolicy.allowLiveHostExecution = true
  fixture.bindings.manifestHash = computeManifestHash(fixture.manifest)
  const descriptor: RunDescriptor = {
    schemaVersion: 1,
    runId: 'run-lifecycle-001',
    rootDev: 9,
    rootIno: 19,
    workspacePath: '/tmp/host-evidence-v1-test/workspace',
    workspaceDev: 10,
    workspaceIno: 20,
    uid: 501,
    gid: 20,
    trustRequired,
    scope: 'offline-only',
    limits: {
      maxFileBytes: 256 * 1024,
      maxTotalBytes: 4 * 1024 * 1024,
      maxReceipts: 256,
      maxJsonDepth: 32,
    },
  }
  return {
    descriptor,
    manifest: fixture.manifest,
    bindings: fixture.bindings,
    descriptorHash: hashCanonical('host-evidence-descriptor-v1', descriptor),
    manifestHash: fixture.bindings.manifestHash,
    bindingsHash: hashCanonical('host-evidence-bindings-v1', fixture.bindings),
    lockHash: hashCanonical('host-evidence-owner-lock-v1', {
      schemaVersion: 1,
      ownerId: 'owner-a',
      sessionToken: 'session-token-0001',
    }),
  }
}

function rebindContext(runContext: ReplayContext): void {
  runContext.manifestHash = computeManifestHash(runContext.manifest)
  runContext.bindings = { ...runContext.bindings, manifestHash: runContext.manifestHash }
  runContext.bindingsHash = hashCanonical('host-evidence-bindings-v1', runContext.bindings)
}

class Script {
  readonly receipts: Receipt[] = []
  readonly context: ReplayContext

  constructor(contextValue: ReplayContext) {
    this.context = contextValue
  }

  add(payload: ReceiptPayload): Receipt {
    const receipt = createReceipt(this.context, this.receipts.at(-1) ?? null, payload)
    this.receipts.push(receipt)
    return receipt
  }

  replay() {
    return replayRun(this.context, this.receipts)
  }
}

function authorize(script: Script): void {
  script.add({
    event: 'authorized',
    descriptorHash: script.context.descriptorHash,
    manifestHash: script.context.manifestHash,
    bindingsHash: script.context.bindingsHash,
    scope: 'offline-only',
  })
}

function throughHost(script: Script, attemptId = 'attempt-1'): void {
  authorize(script)
  script.add({
    event: 'attempt.reserved',
    attemptId,
    processId: 'process-1',
  })
  script.add({
    event: 'shell.ready',
    attemptId,
    shellProcessId: 'process-1',
    foregroundProcessId: 'process-1',
    foregroundProcessCount: 1,
    cwd: '/trusted/repository',
  })
  if (script.context.descriptor.trustRequired) {
    script.add({
      event: 'trust.accepted',
      attemptId,
      workspacePath: script.context.descriptor.workspacePath,
      workspaceDev: script.context.descriptor.workspaceDev,
      workspaceIno: script.context.descriptor.workspaceIno,
    })
  }
  script.add({
    event: 'host.observed',
    attemptId,
    ...script.context.manifest.plannedHost,
  })
}

function throughInput(script: Script): void {
  authorize(script)
  script.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-1',
    processId: 'process-1',
  })
  script.add({
    event: 'shell.ready',
    attemptId: 'attempt-1',
    shellProcessId: 'process-1',
    foregroundProcessId: 'process-1',
    foregroundProcessCount: 1,
    cwd: '/trusted/repository',
  })
  if (script.context.descriptor.trustRequired) {
    script.add({
      event: 'trust.accepted',
      attemptId: 'attempt-1',
      workspacePath: script.context.descriptor.workspacePath,
      workspaceDev: script.context.descriptor.workspaceDev,
      workspaceIno: script.context.descriptor.workspaceIno,
    })
  }
  script.add({
    event: 'host.observed',
    attemptId: 'attempt-1',
    ...script.context.manifest.plannedHost,
  })
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'conversation-effect' })
  script.add({
    event: 'conversation.created',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    conversationId: 'conversation-1',
  })
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'input-effect' })
  script.add({
    event: 'user-input.observed',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    structured: true,
    taskId: script.context.manifest.taskId,
    promptHash: script.context.bindings.promptHash,
  })
}

function addRetrieval(
  script: Script,
  effectId = 'retrieval-effect',
  content = 'api-marker command-marker order-marker',
): void {
  script.add({ event: 'effect.reserved', attemptId: 'attempt-1', effectId, operation: 'retrieval' })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId })
  script.add({
    event: 'retrieval.result',
    attemptId: 'attempt-1',
    effectId,
    conversationId: 'conversation-1',
    query: 'synthetic runbook owner',
    owner: script.context.manifest.retrieval.canonicalOwner,
    source: script.context.manifest.expectedResponse.canonicalSource,
    success: true,
    content,
  })
}

function finalResponse(script: Script) {
  return {
    taskId: script.context.manifest.taskId,
    status: 'ANSWERED' as const,
    answer: {
      humanAction: 'Throttle',
      api: 'POST',
      path: '/v1/synthetic/jobs',
      command: 'syntheticctl inspect',
      order: 'inspect then throttle',
    },
    sources: [script.context.manifest.expectedResponse.canonicalSource],
  }
}

function addFinalAndClose(
  script: Script,
  visibility: 'complete' | 'incomplete' = 'incomplete',
): void {
  script.add({
    event: 'planner.response',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    kind: 'final',
    response: finalResponse(script),
  })
  script.add({
    event: 'observations.closed',
    captureTruncated: false,
    truncatedFields: [],
    providerRequestVisibility: visibility,
  })
}

test('receipt lifecycle derives a positive required-retrieval run from validated receipts', () => {
  const script = new Script(context())
  throughInput(script)
  addRetrieval(script)
  addFinalAndClose(script)
  const replay = script.replay()
  const derived = deriveHostEvidence(replay)
  assert.equal(derived.status, 'ready')
  if (derived.status !== 'ready') return
  assert.equal(derived.evidence.accounting.searchCalls, 1)
  assert.equal(derived.evidence.accounting.noProgressSteps, 0)
  assert.equal(derived.evidence.accounting.returnedBytes, 38)
  assert.equal(derived.evidence.accounting.providerRequests, 'unavailable')
  assert.equal(
    scoreHostEvidence(script.context.manifest, derived.evidence, script.context.bindings).passed,
    true,
  )
})

test('receipt lifecycle derives safe UNKNOWN without retrieval and supports required trust', () => {
  const runContext = context(true)
  runContext.manifest.expectedResponse.status = 'UNKNOWN'
  runContext.manifest.retrieval.required = false
  runContext.manifestHash = computeManifestHash(runContext.manifest)
  runContext.bindings = { ...runContext.bindings, manifestHash: runContext.manifestHash }
  runContext.bindingsHash = hashCanonical('host-evidence-bindings-v1', runContext.bindings)
  const script = new Script(runContext)
  throughInput(script)
  script.add({
    event: 'planner.response',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    kind: 'final',
    response: {
      taskId: runContext.manifest.taskId,
      status: 'UNKNOWN',
      answer: { humanAction: 'UNKNOWN', api: '', path: '', command: '', order: '' },
      sources: [],
    },
  })
  script.add({
    event: 'observations.closed',
    captureTruncated: false,
    truncatedFields: [],
    providerRequestVisibility: 'complete',
  })
  const derived = deriveHostEvidence(script.replay())
  assert.equal(derived.status, 'ready')
  if (derived.status === 'ready') {
    assert.equal(derived.evidence.finalResponse.status, 'UNKNOWN')
    assert.equal(derived.evidence.accounting.searchCalls, 0)
    assert.equal(derived.evidence.accounting.providerRequests, 0)
  }
})

test('receipt parser is exact and rejects unknown events, unsafe integers, and malformed fields', () => {
  const script = new Script(context())
  authorize(script)
  const original = script.receipts[0]
  for (const mutate of [
    (value: Record<string, unknown>) => ((value.payload as Record<string, unknown>).extra = true),
    (value: Record<string, unknown>) =>
      ((value.payload as Record<string, unknown>).event = 'unknown.event'),
    (value: Record<string, unknown>) => (value.sequence = Number.MAX_SAFE_INTEGER + 1),
    (value: Record<string, unknown>) => delete (value.payload as Record<string, unknown>).scope,
  ]) {
    const candidate = structuredClone(original) as unknown as Record<string, unknown>
    mutate(candidate)
    assert.throws(() => parseReceipt(candidate))
  }
})

test('replay rejects gaps, reorder, payload drift, predecessor drift, and cross-run identity', () => {
  const script = new Script(context())
  throughInput(script)
  const variants: Receipt[][] = []
  variants.push(script.receipts.filter((receipt) => receipt.sequence !== 2))
  variants.push([script.receipts[1], script.receipts[0], ...script.receipts.slice(2)])
  const payloadDrift = structuredClone(script.receipts)
  ;(payloadDrift[0].payload as Extract<ReceiptPayload, { event: 'authorized' }>).scope =
    'offline-only'
  ;(payloadDrift[1].payload as Extract<ReceiptPayload, { event: 'attempt.reserved' }>).processId =
    'drift'
  variants.push(payloadDrift)
  const predecessor = structuredClone(script.receipts)
  predecessor[1].previousHash = '0'.repeat(64)
  variants.push(predecessor)
  const crossRun = structuredClone(script.receipts)
  crossRun[0].runId = 'other-run'
  variants.push(crossRun)
  for (const receipts of variants)
    assert.throws(() => replayRun(script.context, receipts), /integrity/)
})

test('shell readiness and trust are exact, foreground, attempt-bound workspace facts', () => {
  for (const mutation of ['foreground', 'shell'] as const) {
    const script = new Script(context())
    authorize(script)
    script.add({
      event: 'attempt.reserved',
      attemptId: 'attempt-1',
      processId: 'process-1',
    })
    const ready: Extract<ReceiptPayload, { event: 'shell.ready' }> = {
      event: 'shell.ready',
      attemptId: 'attempt-1',
      shellProcessId: 'process-1',
      foregroundProcessId: 'process-1',
      foregroundProcessCount: 1,
      cwd: '/trusted/repository',
    }
    if (mutation === 'foreground') ready.foregroundProcessId = 'background-process'
    if (mutation === 'shell') ready.shellProcessId = 'other-attempt-process'
    script.add(ready)
    assert.throws(() => script.replay(), /shell foreground process identity mismatch/)
  }

  const trust = new Script(context(true))
  authorize(trust)
  trust.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-1',
    processId: 'process-1',
  })
  trust.add({
    event: 'shell.ready',
    attemptId: 'attempt-1',
    shellProcessId: 'process-1',
    foregroundProcessId: 'process-1',
    foregroundProcessCount: 1,
    cwd: '/trusted/repository',
  })
  trust.add({
    event: 'trust.accepted',
    attemptId: 'attempt-1',
    workspacePath: `${trust.context.descriptor.workspacePath}-lookalike`,
    workspaceDev: 10,
    workspaceIno: 20,
  })
  assert.throws(() => trust.replay(), /trust workspace identity mismatch/)
})

test('lifecycle rejects commands before prerequisites and mismatched result correlation', () => {
  const beforeAuthorization = new Script(context())
  beforeAuthorization.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-1',
    processId: 'process-1',
  })
  assert.throws(() => beforeAuthorization.replay(), /authorization required/)

  const inputBeforeConversation = new Script(context())
  authorize(inputBeforeConversation)
  inputBeforeConversation.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-1',
    processId: 'process-1',
  })
  inputBeforeConversation.add({
    event: 'shell.ready',
    attemptId: 'attempt-1',
    shellProcessId: 'process-1',
    foregroundProcessId: 'process-1',
    foregroundProcessCount: 1,
    cwd: '/trusted/repository',
  })
  inputBeforeConversation.add({
    event: 'host.observed',
    attemptId: 'attempt-1',
    ...inputBeforeConversation.context.manifest.plannedHost,
  })
  inputBeforeConversation.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  assert.throws(() => inputBeforeConversation.replay(), /conversation required/)

  const noReservation = new Script(context())
  throughInput(noReservation)
  noReservation.add({
    event: 'tool.result',
    attemptId: 'attempt-1',
    effectId: 'missing',
    conversationId: 'conversation-1',
    tool: 'fake',
    success: true,
    content: '',
  })
  assert.throws(() => noReservation.replay(), /unknown effect/)
})

test('reservations are charged, unresolved uncertainty blocks retry and seal, and reconciliation is explicit', () => {
  const script = new Script(context())
  throughInput(script)
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    operation: 'tool',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'tool-1' })
  script.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    uncertainty: 'after-submission',
    label: 'injected failure',
  })
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-2',
    operation: 'tool',
  })
  assert.throws(() => script.replay(), /unresolved effect blocks reservation/)

  script.receipts.pop()
  script.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'tool-1',
    resolution: 'unknown',
    observationSequences: [],
  })
  script.add({
    event: 'observations.closed',
    captureTruncated: false,
    truncatedFields: [],
    providerRequestVisibility: 'incomplete',
  })
  assert.throws(() => script.replay(), /unresolved reservations/)

  const noRefund = new Script(context())
  throughInput(noRefund)
  noRefund.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'retrieval-1',
    operation: 'retrieval',
  })
  noRefund.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'retrieval-1',
    uncertainty: 'before-submission',
    label: 'before fake dispatch',
  })
  noRefund.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'retrieval-1',
    resolution: 'not-submitted',
    observationSequences: [],
  })
  noRefund.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'retrieval-2',
    operation: 'retrieval',
  })
  assert.throws(() => noRefund.replay(), /retrieval budget exhausted/)
})

test('observed byte and no-progress overflow is retained and blocks later admission', () => {
  const runContext = context()
  runContext.manifest.budgets.maxNoProgressSteps = 0
  rebindContext(runContext)
  const script = new Script(runContext)
  throughInput(script)
  addRetrieval(script, 'retrieval-1', 'unexpected ภาษาไทย')
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-after-overflow',
    operation: 'tool',
  })
  assert.throws(() => script.replay(), /observed budget overflow blocks reservation/)

  const positive = new Script(context())
  throughInput(positive)
  addRetrieval(positive)
  const replay = positive.replay()
  assert.equal(
    replay.receipts.filter((receipt) => receipt.payload.event === 'retrieval.result').length,
    1,
  )
})

test('missing final remains incomplete and deriveHostEvidence rejects caller-composed replay aggregates', () => {
  const script = new Script(context())
  throughInput(script)
  addRetrieval(script)
  script.add({
    event: 'observations.closed',
    captureTruncated: false,
    truncatedFields: [],
    providerRequestVisibility: 'incomplete',
  })
  const derived = deriveHostEvidence(script.replay())
  assert.deepEqual(derived, { status: 'incomplete', reasons: ['final response missing'] })

  const composed = { ...script.replay() }
  assert.deepEqual(deriveHostEvidence(composed), {
    status: 'invalid',
    failures: ['replay was not produced by replayRun'],
  })
})

test('drained intermediate and duplicate finals remain observable protocol failures', () => {
  const script = new Script(context())
  throughInput(script)
  addRetrieval(script)
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'continuation-effect',
    operation: 'planner-continuation',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'continuation-effect' })
  script.add({
    event: 'planner.response',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    kind: 'final',
    response: finalResponse(script),
  })
  script.add({
    event: 'planner.response',
    attemptId: 'attempt-1',
    effectId: 'continuation-effect',
    conversationId: 'conversation-1',
    kind: 'final',
    response: finalResponse(script),
  })
  script.add({
    event: 'observations.closed',
    captureTruncated: true,
    truncatedFields: ['provider.request.body'],
    providerRequestVisibility: 'incomplete',
  })
  const derived = deriveHostEvidence(script.replay())
  assert.equal(derived.status, 'ready')
  if (derived.status === 'ready') {
    assert.equal(derived.evidence.terminal.finalResponseCount, 2)
    assert.equal(
      derived.evidence.terminal.finalResponseSequence,
      script.receipts.find((receipt) => receipt.payload.event === 'planner.response')?.sequence,
    )
    assert.equal(derived.evidence.transcript.truncated, true)
    const score = scoreHostEvidence(
      script.context.manifest,
      derived.evidence,
      script.context.bindings,
    )
    assert.equal(score.protocol, false)
    assert.ok(score.protocolFailures.includes('final response count is not one'))
  }
})

test('provider visibility and adverse provider or memory observations remain sticky', () => {
  const script = new Script(context())
  throughInput(script)
  addRetrieval(script)
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-effect',
    operation: 'tool',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'tool-effect' })
  script.add({
    event: 'provider.action',
    attemptId: 'attempt-1',
    effectId: 'tool-effect',
    conversationId: 'conversation-1',
    action: 'synthetic-adverse-action',
  })
  script.add({
    event: 'provider.request',
    attemptId: 'attempt-1',
    effectId: 'tool-effect',
    conversationId: 'conversation-1',
    requestId: 'request-1',
  })
  script.add({
    event: 'memory.mutation',
    attemptId: 'attempt-1',
    effectId: 'tool-effect',
    conversationId: 'conversation-1',
    path: '/synthetic/not-written',
  })
  script.add({
    event: 'tool.result',
    attemptId: 'attempt-1',
    effectId: 'tool-effect',
    conversationId: 'conversation-1',
    tool: 'offline-fake',
    success: false,
    content: 'adverse observation retained',
  })
  script.add({
    event: 'planner.response',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    kind: 'final',
    response: finalResponse(script),
  })
  script.add({
    event: 'observations.closed',
    captureTruncated: false,
    truncatedFields: [],
    providerRequestVisibility: 'complete',
  })
  const derived = deriveHostEvidence(script.replay())
  assert.equal(derived.status, 'ready')
  if (derived.status === 'ready') {
    assert.equal(derived.evidence.accounting.providerRequests, 1)
    assert.equal(derived.evidence.protocolFacts.providerActionObserved, true)
    assert.equal(derived.evidence.protocolFacts.memoryMutationObserved, true)
    assert.equal(
      scoreHostEvidence(script.context.manifest, derived.evidence, script.context.bindings).safety,
      false,
    )
  }
})

test('receipt hashes and replay are deterministic over exact canonical content', () => {
  const script = new Script(context())
  throughInput(script)
  assert.equal(stableJson(script.replay().receipts), stableJson(script.replay().receipts))
  assert.deepEqual(parseReceipt(structuredClone(script.receipts[0])), script.receipts[0])
})

test('not-submitted effects have zero observed calls and retrieval also consumes tool admission', () => {
  const script = new Script(context())
  throughInput(script)
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-unused',
    operation: 'tool',
  })
  script.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-unused',
    uncertainty: 'before-submission',
    label: 'offline preflight',
  })
  script.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'tool-unused',
    resolution: 'not-submitted',
    observationSequences: [],
  })
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'continuation-unused',
    operation: 'planner-continuation',
  })
  script.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'continuation-unused',
    uncertainty: 'before-submission',
    label: 'offline preflight',
  })
  script.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'continuation-unused',
    resolution: 'not-submitted',
    observationSequences: [],
  })
  addRetrieval(script)
  addFinalAndClose(script)
  const derived = deriveHostEvidence(script.replay())
  assert.equal(derived.status, 'ready')
  if (derived.status === 'ready') {
    assert.equal(derived.evidence.accounting.plannerContinuations, 0)
    assert.equal(derived.evidence.accounting.toolCalls, 1)
  }

  const noTools = context()
  noTools.manifest.budgets.maxToolCalls = 0
  rebindContext(noTools)
  const rejected = new Script(noTools)
  throughInput(rejected)
  rejected.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'retrieval',
    operation: 'retrieval',
  })
  assert.throws(() => rejected.replay(), /tool budget exhausted/)
})

test('host observation is live-host evidence and disallowed policy fails safety', () => {
  const runContext = context()
  runContext.manifest.executionPolicy.allowLiveHostExecution = false
  rebindContext(runContext)
  const script = new Script(runContext)
  throughInput(script)
  addRetrieval(script)
  addFinalAndClose(script)
  const derived = deriveHostEvidence(script.replay())
  assert.equal(derived.status, 'ready')
  if (derived.status === 'ready') {
    assert.equal(derived.evidence.protocolFacts.liveHostExecutionObserved, true)
    const score = scoreHostEvidence(runContext.manifest, derived.evidence, runContext.bindings)
    assert.equal(score.safety, false)
    assert.ok(score.safetyFailures.includes('unapproved live host execution observed'))
  }
})

test('attempt retry requires not-submitted reconciliation and is forbidden after confirmed input', () => {
  const retryContext = context()
  retryContext.manifest.budgets.maxTransportAttempts = 2
  rebindContext(retryContext)
  const overlap = new Script(retryContext)
  authorize(overlap)
  overlap.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-1',
    processId: 'process-1',
  })
  overlap.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-2',
    processId: 'process-2',
  })
  assert.throws(() => overlap.replay(), /overlapping or ineligible/)

  const retry = new Script(retryContext)
  authorize(retry)
  retry.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-1',
    processId: 'process-1',
  })
  retry.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: null,
    uncertainty: 'before-submission',
    label: 'not dispatched',
  })
  retry.add({
    event: 'effect.reconciled',
    reservationKind: 'attempt',
    reservationId: 'attempt-1',
    resolution: 'not-submitted',
    observationSequences: [],
  })
  retry.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-2',
    processId: 'process-2',
  })
  retry.add({
    event: 'shell.ready',
    attemptId: 'attempt-2',
    shellProcessId: 'process-2',
    foregroundProcessId: 'process-2',
    foregroundProcessCount: 1,
    cwd: '/trusted/repository',
  })
  retry.add({
    event: 'host.observed',
    attemptId: 'attempt-2',
    ...retryContext.manifest.plannedHost,
  })
  assert.equal(retry.replay().phase, 'ACTIVE')

  const delivered = new Script(retryContext)
  throughInput(delivered)
  delivered.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-2',
    processId: 'process-2',
  })
  assert.throws(() => delivered.replay(), /retry after confirmed USER_INPUT/)
})

test('failure stages, duplicate failures, and reconciliation references are exact', () => {
  const beforeMismatch = new Script(context())
  throughInput(beforeMismatch)
  beforeMismatch.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    operation: 'tool',
  })
  beforeMismatch.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    uncertainty: 'after-submission',
    label: 'mismatch',
  })
  assert.throws(() => beforeMismatch.replay(), /submission mismatch/)

  const duplicate = new Script(context())
  throughInput(duplicate)
  duplicate.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    operation: 'tool',
  })
  duplicate.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    uncertainty: 'before-submission',
    label: 'first',
  })
  duplicate.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    uncertainty: 'before-submission',
    label: 'duplicate',
  })
  assert.throws(() => duplicate.replay(), /duplicate or late effect failure/)

  const badReference = new Script(context())
  throughInput(badReference)
  badReference.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    operation: 'tool',
  })
  badReference.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'tool-1' })
  badReference.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    uncertainty: 'after-submission',
    label: 'uncertain',
  })
  badReference.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'tool-1',
    resolution: 'completed',
    observationSequences: [999],
  })
  assert.throws(
    () => badReference.replay(),
    /reconciliation cites self or future|observation mismatch/,
  )

  const afterResolution = new Script(context())
  throughInput(afterResolution)
  afterResolution.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    operation: 'tool',
  })
  afterResolution.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    uncertainty: 'before-submission',
    label: 'first',
  })
  afterResolution.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'tool-1',
    resolution: 'not-submitted',
    observationSequences: [],
  })
  afterResolution.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    uncertainty: 'before-submission',
    label: 'late',
  })
  assert.throws(() => afterResolution.replay(), /duplicate or late effect failure/)
})

test('completion reconciliation rejects self, reservation, wrong-operation, and attempt references', () => {
  const buildUnresolvedTool = () => {
    const script = new Script(context())
    throughInput(script)
    const reservation = script.add({
      event: 'effect.reserved',
      attemptId: 'attempt-1',
      effectId: 'tool-1',
      operation: 'tool',
    })
    script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'tool-1' })
    script.add({
      event: 'transport.failed',
      attemptId: 'attempt-1',
      effectId: 'tool-1',
      uncertainty: 'after-submission',
      label: 'uncertain',
    })
    return { script, reservation }
  }
  const reservationCase = buildUnresolvedTool()
  reservationCase.script.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'tool-1',
    resolution: 'completed',
    observationSequences: [reservationCase.reservation.sequence],
  })
  assert.throws(() => reservationCase.script.replay(), /observation mismatch/)

  const selfCase = buildUnresolvedTool()
  const selfSequence = selfCase.script.receipts.length + 1
  selfCase.script.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'tool-1',
    resolution: 'completed',
    observationSequences: [selfSequence],
  })
  assert.throws(() => selfCase.script.replay(), /self or future/)

  const wrongOperation = new Script(context())
  throughInput(wrongOperation)
  addRetrieval(wrongOperation)
  const retrievalSequence = wrongOperation.receipts.at(-1)?.sequence ?? 0
  wrongOperation.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    operation: 'tool',
  })
  wrongOperation.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'tool-1' })
  wrongOperation.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    uncertainty: 'after-submission',
    label: 'uncertain',
  })
  wrongOperation.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'tool-1',
    resolution: 'completed',
    observationSequences: [retrievalSequence],
  })
  assert.throws(() => wrongOperation.replay(), /observation mismatch/)

  const attemptCase = new Script(context())
  authorize(attemptCase)
  const attemptReservation = attemptCase.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-1',
    processId: 'process-1',
  })
  attemptCase.add({
    event: 'shell.ready',
    attemptId: 'attempt-1',
    shellProcessId: 'process-1',
    foregroundProcessId: 'process-1',
    foregroundProcessCount: 1,
    cwd: '/trusted/repository',
  })
  attemptCase.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: null,
    uncertainty: 'after-submission',
    label: 'uncertain',
  })
  attemptCase.add({
    event: 'effect.reconciled',
    reservationKind: 'attempt',
    reservationId: 'attempt-1',
    resolution: 'completed',
    observationSequences: [attemptReservation.sequence],
  })
  assert.throws(() => attemptCase.replay(), /attempt reconciliation observation mismatch/)

  const beforeOnSubmitted = new Script(context())
  throughInput(beforeOnSubmitted)
  beforeOnSubmitted.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    operation: 'tool',
  })
  beforeOnSubmitted.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'tool-1' })
  beforeOnSubmitted.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    uncertainty: 'before-submission',
    label: 'mismatch',
  })
  assert.throws(() => beforeOnSubmitted.replay(), /submission mismatch/)

  const duplicateReference = buildUnresolvedTool()
  const result = duplicateReference.script.add({
    event: 'tool.result',
    attemptId: 'attempt-1',
    effectId: 'tool-1',
    conversationId: 'conversation-1',
    tool: 'offline-fake',
    success: true,
    content: 'terminal evidence',
  })
  assert.throws(
    () =>
      duplicateReference.script.add({
        event: 'effect.reconciled',
        reservationKind: 'effect',
        reservationId: 'tool-1',
        resolution: 'completed',
        observationSequences: [result.sequence, result.sequence],
      }),
    /expected unique integers/,
  )

  const contradictoryAttempt = new Script(context())
  authorize(contradictoryAttempt)
  contradictoryAttempt.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-1',
    processId: 'process-1',
  })
  contradictoryAttempt.add({
    event: 'shell.ready',
    attemptId: 'attempt-1',
    shellProcessId: 'process-1',
    foregroundProcessId: 'process-1',
    foregroundProcessCount: 1,
    cwd: '/trusted/repository',
  })
  contradictoryAttempt.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: null,
    uncertainty: 'after-submission',
    label: 'submitted transport remains uncertain',
  })
  contradictoryAttempt.add({
    event: 'effect.reconciled',
    reservationKind: 'attempt',
    reservationId: 'attempt-1',
    resolution: 'not-submitted',
    observationSequences: [],
  })
  assert.throws(() => contradictoryAttempt.replay(), /cannot reconcile not-submitted/)
})

test('never-submitted failed tool cannot reconcile completed after contradictory terminal evidence', () => {
  const script = new Script(context())
  throughInput(script)
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-never-submitted',
    operation: 'tool',
  })
  script.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-never-submitted',
    uncertainty: 'before-submission',
    label: 'failed before dispatch',
  })
  const result = script.add({
    event: 'tool.result',
    attemptId: 'attempt-1',
    effectId: 'tool-never-submitted',
    conversationId: 'conversation-1',
    tool: 'offline-fake',
    success: true,
    content: 'contradictory terminal evidence',
  })
  script.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'tool-never-submitted',
    resolution: 'completed',
    observationSequences: [result.sequence],
  })
  addFinalAndClose(script)
  assert.throws(() => script.replay(), /completed reconciliation requires exact effect submission/)
})

test('submitted failed tool with terminal evidence cannot reconcile not-submitted', () => {
  const script = new Script(context())
  throughInput(script)
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-submitted',
    operation: 'tool',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'tool-submitted' })
  script.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'tool-submitted',
    uncertainty: 'after-submission',
    label: 'failed after dispatch',
  })
  script.add({
    event: 'tool.result',
    attemptId: 'attempt-1',
    effectId: 'tool-submitted',
    conversationId: 'conversation-1',
    tool: 'offline-fake',
    success: true,
    content: 'late terminal evidence',
  })
  script.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'tool-submitted',
    resolution: 'not-submitted',
    observationSequences: [],
  })
  addFinalAndClose(script)
  assert.throws(
    () => script.replay(),
    /submitted or observed effect cannot reconcile not-submitted/,
  )
})

test('not-submitted attempt reconciliation retires the same attempt', () => {
  const script = new Script(context())
  authorize(script)
  script.add({
    event: 'attempt.reserved',
    attemptId: 'attempt-1',
    processId: 'process-1',
  })
  script.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: null,
    uncertainty: 'before-submission',
    label: 'failed before dispatch',
  })
  script.add({
    event: 'effect.reconciled',
    reservationKind: 'attempt',
    reservationId: 'attempt-1',
    resolution: 'not-submitted',
    observationSequences: [],
  })
  script.add({
    event: 'shell.ready',
    attemptId: 'attempt-1',
    shellProcessId: 'process-1',
    foregroundProcessId: 'process-1',
    foregroundProcessCount: 1,
    cwd: '/trusted/repository',
  })
  assert.throws(() => script.replay(), /retired attempt requires a new reservation/)
})

test('single-terminal tool and retrieval effects reject a second result while unresolved', () => {
  for (const operation of ['tool', 'retrieval'] as const) {
    const script = new Script(context())
    throughInput(script)
    const effectId = `${operation}-duplicate`
    script.add({ event: 'effect.reserved', attemptId: 'attempt-1', effectId, operation })
    script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId })
    script.add({
      event: 'transport.failed',
      attemptId: 'attempt-1',
      effectId,
      uncertainty: 'after-submission',
      label: 'failed after dispatch',
    })
    const result =
      operation === 'tool'
        ? ({
            event: 'tool.result',
            attemptId: 'attempt-1',
            effectId,
            conversationId: 'conversation-1',
            tool: 'offline-fake',
            success: true,
            content: 'terminal evidence',
          } as const)
        : ({
            event: 'retrieval.result',
            attemptId: 'attempt-1',
            effectId,
            conversationId: 'conversation-1',
            query: 'synthetic runbook owner',
            owner: script.context.manifest.retrieval.canonicalOwner,
            source: script.context.manifest.expectedResponse.canonicalSource,
            success: true,
            content: 'api-marker command-marker order-marker',
          } as const)
    const first = script.add(result)
    script.add(result)
    script.add({
      event: 'effect.reconciled',
      reservationKind: 'effect',
      reservationId: effectId,
      resolution: 'completed',
      observationSequences: [first.sequence],
    })
    assert.throws(() => script.replay(), /duplicate terminal result for effect/)
  }
})

test('late observations after not-submitted reconciliation remain contradictory and non-sealable', () => {
  const observations = [
    {
      event: 'tool.result',
      attemptId: 'attempt-1',
      effectId: 'late-tool',
      conversationId: 'conversation-1',
      tool: 'offline-fake',
      success: true,
      content: 'late terminal evidence',
    },
    {
      event: 'provider.action',
      attemptId: 'attempt-1',
      effectId: 'late-tool',
      conversationId: 'conversation-1',
      action: 'late-provider-action',
    },
    {
      event: 'memory.mutation',
      attemptId: 'attempt-1',
      effectId: 'late-tool',
      conversationId: 'conversation-1',
      path: '/late-memory-observation',
    },
  ] as const

  for (const observation of observations) {
    const script = new Script(context())
    throughInput(script)
    script.add({
      event: 'effect.reserved',
      attemptId: 'attempt-1',
      effectId: 'late-tool',
      operation: 'tool',
    })
    script.add({
      event: 'transport.failed',
      attemptId: 'attempt-1',
      effectId: 'late-tool',
      uncertainty: 'before-submission',
      label: 'failed before dispatch',
    })
    script.add({
      event: 'effect.reconciled',
      reservationKind: 'effect',
      reservationId: 'late-tool',
      resolution: 'not-submitted',
      observationSequences: [],
    })
    script.add(observation)
    const replay = script.replay()
    assert.deepEqual(replay.unresolvedReservations, ['effect:late-tool'])
    script.add({
      event: 'observations.closed',
      captureTruncated: false,
      truncatedFields: [],
      providerRequestVisibility: 'incomplete',
    })
    assert.throws(() => script.replay(), /unresolved reservations/)
  }
})

test('same submitted stream drains intermediate, final, duplicate final, provider, and memory observations', () => {
  const script = new Script(context())
  throughInput(script)
  addRetrieval(script)
  script.add({
    event: 'planner.response',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    kind: 'intermediate',
    response: null,
  })
  script.add({
    event: 'planner.response',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    kind: 'final',
    response: finalResponse(script),
  })
  script.add({
    event: 'provider.action',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    action: 'late-observed',
  })
  script.add({
    event: 'memory.mutation',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    path: '/late-observed',
  })
  script.add({
    event: 'planner.response',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    kind: 'final',
    response: finalResponse(script),
  })
  script.add({
    event: 'observations.closed',
    captureTruncated: false,
    truncatedFields: [],
    providerRequestVisibility: 'incomplete',
  })
  const derived = deriveHostEvidence(script.replay())
  assert.equal(derived.status, 'ready')
  if (derived.status === 'ready') {
    assert.equal(derived.evidence.terminal.intermediateCompletionCount, 1)
    assert.equal(derived.evidence.terminal.finalResponseCount, 2)
    assert.equal(derived.evidence.protocolFacts.providerActionObserved, true)
    assert.equal(derived.evidence.protocolFacts.memoryMutationObserved, true)
  }
})

test('Phase 2 identifier boundary accepts 128 characters and rejects 129', () => {
  const base = {
    event: 'attempt.reserved',
    attemptId: 'a'.repeat(128),
    processId: 'process-1',
  }
  assert.equal(parseReceiptPayload(base).event, 'attempt.reserved')
  assert.throws(
    () => parseReceiptPayload({ ...base, attemptId: 'a'.repeat(129) }),
    /bounded string/,
  )
})

test('validated replay is deeply immutable against post-return evidence forgery', () => {
  const script = new Script(context())
  throughInput(script)
  addRetrieval(script)
  addFinalAndClose(script)
  const replay = script.replay()
  const before = deriveHostEvidence(replay)
  assert.throws(() => {
    ;(replay.receipts[0] as Receipt).receiptHash = '0'.repeat(64)
  })
  assert.throws(() => {
    replay.context.manifest.taskId = 'forged-task'
  })
  assert.deepEqual(deriveHostEvidence(replay), before)
})

test('Phase 3 seam: allows valid paired reservation and submission of user-input before conversation is created', () => {
  const script = new Script(context())
  throughHost(script)
  // Reserve and submit conversation-create
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'conversation-effect' })
  // Now reserve user-input while conversationId is null
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  // Now submit user-input while conversationId is still null
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'input-effect' })
  // Now conversation.created arrives
  script.add({
    event: 'conversation.created',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    conversationId: 'conversation-1',
  })
  // Now user-input.observed arrives using the bound conversationId
  script.add({
    event: 'user-input.observed',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    structured: true,
    taskId: script.context.manifest.taskId,
    promptHash: script.context.bindings.promptHash,
  })
  addRetrieval(script)
  addFinalAndClose(script)
  const replay = script.replay()
  const derived = deriveHostEvidence(replay)
  assert.equal(derived.status, 'ready')
  if (derived.status !== 'ready') return
  assert.equal(
    scoreHostEvidence(script.context.manifest, derived.evidence, script.context.bindings).passed,
    true,
  )

  // Verify non-input effects (tools) remain strictly blocked before conversation exists
  const toolBeforeConversation = new Script(context())
  throughHost(toolBeforeConversation)
  toolBeforeConversation.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  toolBeforeConversation.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
  })
  toolBeforeConversation.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'tool-effect',
    operation: 'tool',
  })
  assert.throws(() => toolBeforeConversation.replay(), /conversation required before effect/)
})

test('Phase 3 seam: rejects user-input reservation on missing or multiple conversation-create dependency', () => {
  // Case 2a: Missing create dependency (no conversation-create effect reserved at all)
  const missingScript = new Script(context())
  throughHost(missingScript)
  missingScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  assert.throws(() => missingScript.replay(), /conversation required/)

  // Case 2b: Create dependency reserved but not submitted
  const unsubmittedScript = new Script(context())
  throughHost(unsubmittedScript)
  unsubmittedScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  unsubmittedScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  assert.throws(() => unsubmittedScript.replay(), /unresolved effect blocks reservation/)

  // Case 2c: Multiple create dependencies on same attempt
  const runContext = context()
  runContext.manifest.budgets.maxCreatedConversations = 2
  rebindContext(runContext)
  const multipleScript = new Script(runContext)
  throughHost(multipleScript)
  multipleScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect-1',
    operation: 'conversation-create',
  })
  multipleScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect-1',
  })
  multipleScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect-2',
    operation: 'conversation-create',
  })
  multipleScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect-2',
  })
  multipleScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  assert.throws(() => multipleScript.replay(), /multiple conversation-create dependencies/)
})

test('Phase 3 seam: blocks reservation and submission when conversation-create has failed or reconciled', () => {
  // Case 3a: Intervening transport.failed on create blocks input effect submission
  const failedSubmitScript = new Script(context())
  throughHost(failedSubmitScript)
  failedSubmitScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  failedSubmitScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
  })
  failedSubmitScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  failedSubmitScript.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    uncertainty: 'after-submission',
    label: 'network-drop',
  })
  failedSubmitScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
  })
  assert.throws(
    () => failedSubmitScript.replay(),
    /conversation-create dependency failed or reconciled/,
  )

  // Case 3b: Intervening reconciliation on create blocks input effect submission
  const reconciledSubmitScript = new Script(context())
  throughHost(reconciledSubmitScript)
  reconciledSubmitScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  reconciledSubmitScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
  })
  reconciledSubmitScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  reconciledSubmitScript.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    uncertainty: 'after-submission',
    label: 'network-drop',
  })
  reconciledSubmitScript.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'conversation-effect',
    resolution: 'unknown',
    observationSequences: [],
  })
  reconciledSubmitScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
  })
  assert.throws(
    () => reconciledSubmitScript.replay(),
    /conversation-create dependency failed or reconciled/,
  )

  // Case 3c: Reconciled create (not-submitted) blocks later input reservation
  const reconciledReserveScript = new Script(context())
  throughHost(reconciledReserveScript)
  reconciledReserveScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  reconciledReserveScript.add({
    event: 'transport.failed',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    uncertainty: 'before-submission',
    label: 'spawn-failure',
  })
  reconciledReserveScript.add({
    event: 'effect.reconciled',
    reservationKind: 'effect',
    reservationId: 'conversation-effect',
    resolution: 'not-submitted',
    observationSequences: [],
  })
  reconciledReserveScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  assert.throws(
    () => reconciledReserveScript.replay(),
    /conversation-create dependency failed or reconciled/,
  )
})

test('Phase 3 seam: rejects cross-attempt conversation-create dependency', () => {
  const script = new Script(context())
  throughHost(script)
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'conversation-effect' })
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  script.add({
    event: 'effect.submitted',
    attemptId: 'attempt-wrong',
    effectId: 'input-effect',
  })
  assert.throws(() => script.replay(), /unknown attempt attempt-wrong/)
})

test('Phase 3 seam: rejects user-input.observed arriving before conversation.created', () => {
  const script = new Script(context())
  throughHost(script)
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'conversation-effect' })
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'input-effect' })
  // Input observed before conversation.created
  script.add({
    event: 'user-input.observed',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    structured: true,
    taskId: script.context.manifest.taskId,
    promptHash: script.context.bindings.promptHash,
  })
  assert.throws(() => script.replay(), /conversation required before USER_INPUT observation/)
})

test('Phase 3 seam: rejects user-input.observed with mismatched conversation ID', () => {
  const script = new Script(context())
  throughHost(script)
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'conversation-effect' })
  script.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  script.add({ event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'input-effect' })
  script.add({
    event: 'conversation.created',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    conversationId: 'conversation-1',
  })
  // Mismatched conversationId: 'conversation-wrong'
  script.add({
    event: 'user-input.observed',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-wrong',
    structured: true,
    taskId: script.context.manifest.taskId,
    promptHash: script.context.bindings.promptHash,
  })
  assert.throws(() => script.replay(), /cross-conversation result/)
})

test('Phase 3 seam: prevents duplicate user-input reservation and repeated observation', () => {
  // Case 7a: Duplicate user-input effect reservation budget exhausted
  const duplicateReserveScript = new Script(context())
  throughHost(duplicateReserveScript)
  duplicateReserveScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  duplicateReserveScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
  })
  duplicateReserveScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect-1',
    operation: 'user-input',
  })
  duplicateReserveScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'input-effect-1',
  })
  duplicateReserveScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect-2',
    operation: 'user-input',
  })
  assert.throws(() => duplicateReserveScript.replay(), /user-input budget exhausted/)

  // Case 7b: Resending user-input.observed rejected
  const repeatObservationScript = new Script(context())
  throughHost(repeatObservationScript)
  repeatObservationScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  repeatObservationScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
  })
  repeatObservationScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    operation: 'user-input',
  })
  repeatObservationScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
  })
  repeatObservationScript.add({
    event: 'conversation.created',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    conversationId: 'conversation-1',
  })
  repeatObservationScript.add({
    event: 'user-input.observed',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    structured: true,
    taskId: repeatObservationScript.context.manifest.taskId,
    promptHash: repeatObservationScript.context.bindings.promptHash,
  })
  repeatObservationScript.add({
    event: 'user-input.observed',
    attemptId: 'attempt-1',
    effectId: 'input-effect',
    conversationId: 'conversation-1',
    structured: true,
    taskId: repeatObservationScript.context.manifest.taskId,
    promptHash: repeatObservationScript.context.bindings.promptHash,
  })
  assert.throws(
    () => repeatObservationScript.replay(),
    /duplicate terminal result for effect|confirmed USER_INPUT cannot be resent/,
  )

  // Case 7c: Reserving input after confirmed input observation
  const reserveAfterObservedScript = new Script(context())
  throughHost(reserveAfterObservedScript)
  reserveAfterObservedScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    operation: 'conversation-create',
  })
  reserveAfterObservedScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
  })
  reserveAfterObservedScript.add({
    event: 'conversation.created',
    attemptId: 'attempt-1',
    effectId: 'conversation-effect',
    conversationId: 'conversation-1',
  })
  reserveAfterObservedScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect-1',
    operation: 'user-input',
  })
  reserveAfterObservedScript.add({
    event: 'effect.submitted',
    attemptId: 'attempt-1',
    effectId: 'input-effect-1',
  })
  reserveAfterObservedScript.add({
    event: 'user-input.observed',
    attemptId: 'attempt-1',
    effectId: 'input-effect-1',
    conversationId: 'conversation-1',
    structured: true,
    taskId: reserveAfterObservedScript.context.manifest.taskId,
    promptHash: reserveAfterObservedScript.context.bindings.promptHash,
  })
  // Now try to reserve another user-input effect after confirmed observation
  reserveAfterObservedScript.add({
    event: 'effect.reserved',
    attemptId: 'attempt-1',
    effectId: 'input-effect-2',
    operation: 'user-input',
  })
  assert.throws(
    () => reserveAfterObservedScript.replay(),
    /user-input budget exhausted|confirmed USER_INPUT cannot be resent/,
  )
})

test('Phase 3 seam: preserves existing Phase 2 legacy path where conversation is created before user-input reservation', () => {
  const script = new Script(context())
  throughInput(script)
  addRetrieval(script)
  addFinalAndClose(script)
  const replay = script.replay()
  const derived = deriveHostEvidence(replay)
  assert.equal(derived.status, 'ready')
  if (derived.status !== 'ready') return
  assert.equal(
    scoreHostEvidence(script.context.manifest, derived.evidence, script.context.bindings).passed,
    true,
  )
})
