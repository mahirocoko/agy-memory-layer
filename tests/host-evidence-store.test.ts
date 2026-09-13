import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import {
  computeManifestHash,
  type StrictFinalResponse,
  stableJson,
} from '../tools/host-evidence-contract.ts'
import {
  computeReceiptHash,
  type Receipt,
  type ReceiptPayload,
} from '../tools/host-evidence-receipts.ts'
import {
  authorizeRun,
  createRun,
  dispatch,
  disposeRun,
  inspectRun,
  RUN_PREFIX,
  type RunHandle,
  receiptFileName,
  sealRun,
  verifySealedRun,
} from '../tools/host-evidence-store.ts'
import {
  createHostEvidenceFakeTransport,
  throwingFakeTransport,
} from './support/host-evidence-fake-transport.ts'
import {
  buildPositiveHostEvidenceFixture,
  cloneHostEvidenceFixture,
} from './support/host-evidence-fixtures.ts'

function phase2Manifest() {
  const fixture = buildPositiveHostEvidenceFixture()
  fixture.manifest.executionPolicy.allowLiveHostExecution = true
  return fixture.manifest
}

function cleanupRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true })
}

function payloads(handle: RunHandle) {
  const manifest = inspectRun(handle).manifest
  return {
    attempt: {
      event: 'attempt.reserved',
      attemptId: 'attempt-1',
      processId: 'process-1',
    } as const,
    ready: {
      event: 'shell.ready',
      attemptId: 'attempt-1',
      shellProcessId: 'process-1',
      foregroundProcessId: 'process-1',
      foregroundProcessCount: 1,
      cwd: '/trusted/repository',
    } as const,
    host: { event: 'host.observed', attemptId: 'attempt-1', ...manifest.plannedHost } as const,
    conversationReservation: {
      event: 'effect.reserved',
      attemptId: 'attempt-1',
      effectId: 'conversation-effect',
      operation: 'conversation-create',
    } as const,
    conversationSubmission: {
      event: 'effect.submitted',
      attemptId: 'attempt-1',
      effectId: 'conversation-effect',
    } as const,
    conversation: {
      event: 'conversation.created',
      attemptId: 'attempt-1',
      effectId: 'conversation-effect',
      conversationId: 'conversation-1',
    } as const,
    inputReservation: {
      event: 'effect.reserved',
      attemptId: 'attempt-1',
      effectId: 'input-effect',
      operation: 'user-input',
    } as const,
    inputSubmission: {
      event: 'effect.submitted',
      attemptId: 'attempt-1',
      effectId: 'input-effect',
    } as const,
    input: {
      event: 'user-input.observed',
      attemptId: 'attempt-1',
      effectId: 'input-effect',
      conversationId: 'conversation-1',
      structured: true,
      taskId: manifest.taskId,
      promptHash: manifest.promptHash,
    } as const,
    retrievalReservation: {
      event: 'effect.reserved',
      attemptId: 'attempt-1',
      effectId: 'retrieval-effect',
      operation: 'retrieval',
    } as const,
    retrievalSubmission: {
      event: 'effect.submitted',
      attemptId: 'attempt-1',
      effectId: 'retrieval-effect',
    } as const,
    retrieval: {
      event: 'retrieval.result',
      attemptId: 'attempt-1',
      effectId: 'retrieval-effect',
      conversationId: 'conversation-1',
      query: 'synthetic runbook owner',
      owner: manifest.retrieval.canonicalOwner,
      source: manifest.expectedResponse.canonicalSource,
      success: true,
      content: 'api-marker command-marker order-marker',
    } as const,
    final: {
      event: 'planner.response',
      attemptId: 'attempt-1',
      effectId: 'input-effect',
      conversationId: 'conversation-1',
      kind: 'final',
      response: {
        taskId: manifest.taskId,
        status: 'ANSWERED',
        answer: {
          humanAction: 'Throttle',
          api: 'POST',
          path: '/v1/synthetic/jobs',
          command: 'syntheticctl inspect',
          order: 'inspect then throttle',
        },
        sources: [manifest.expectedResponse.canonicalSource],
      },
    } as Extract<ReceiptPayload, { event: 'planner.response' }>,
    close: {
      event: 'observations.closed',
      captureTruncated: false,
      truncatedFields: [],
      providerRequestVisibility: 'incomplete',
    } as Extract<ReceiptPayload, { event: 'observations.closed' }>,
  }
}

function runThroughInput(handle: RunHandle): ReturnType<typeof payloads> {
  const commands = payloads(handle)
  authorizeRun(handle)
  for (const payload of [
    commands.attempt,
    commands.ready,
    commands.host,
    commands.conversationReservation,
    commands.conversationSubmission,
    commands.conversation,
    commands.inputReservation,
    commands.inputSubmission,
    commands.input,
  ])
    dispatch(handle, payload)
  return commands
}

function completeRun(handle: RunHandle, responseOverride?: Partial<StrictFinalResponse>) {
  const commands = runThroughInput(handle)
  const fake = createHostEvidenceFakeTransport(() => [
    commands.retrievalSubmission,
    commands.retrieval,
  ])
  dispatch(handle, commands.retrievalReservation, fake)
  const final = structuredClone(commands.final)
  if (responseOverride && final.response) Object.assign(final.response, responseOverride)
  dispatch(handle, final)
  dispatch(handle, commands.close)
  return { fake, sealed: sealRun(handle) }
}

test('store creates only a fresh canonical system-temp run with exact modes and frozen files', () => {
  const fixture = buildPositiveHostEvidenceFixture()
  const handle = createRun(fixture.manifest, { ownerId: 'cooperative-owner' })
  try {
    assert.equal(path.dirname(handle.root), fs.realpathSync(os.tmpdir()))
    assert.match(path.basename(handle.root), new RegExp(`^${RUN_PREFIX}`))
    assert.equal(fs.statSync(handle.root).mode & 0o777, 0o700)
    assert.equal(fs.statSync(handle.workspace).mode & 0o777, 0o700)
    const inspection = inspectRun(handle)
    assert.deepEqual(fs.readdirSync(handle.root).sort(), [
      'bindings.json',
      'descriptor.json',
      'manifest.json',
      'owner-lock.json',
      'workspace',
    ])
    for (const name of ['bindings.json', 'descriptor.json', 'manifest.json', 'owner-lock.json']) {
      const stat = fs.lstatSync(path.join(handle.root, name))
      assert.equal(stat.mode & 0o777, 0o600)
      assert.equal(stat.nlink, 1)
      assert.equal(stat.isFile(), true)
    }
    assert.equal(inspection.descriptor.scope, 'offline-only')
    assert.equal(inspection.bindings.manifestHash, fixture.bindings.manifestHash)
    assert.equal(inspection.receipts.length, 0)
  } finally {
    disposeRun(handle)
  }
})

test('fake transport persists reservation first, performs no live capability, and seals positive evidence', () => {
  const handle = createRun(phase2Manifest())
  try {
    const { fake, sealed } = completeRun(handle)
    assert.deepEqual(fake.audit, {
      dispatches: 1,
      childProcesses: 0,
      networkCalls: 0,
      providerCalls: 0,
      trustAutomationCalls: 0,
      memfsPaths: 0,
    })
    assert.equal(sealed.score.passed, true)
    assert.equal(sealed.evidence.accounting.returnedBytes, 38)
    assert.deepEqual(verifySealedRun(handle.root, sealed.checkpoint).checkpoint, sealed.checkpoint)
    assert.throws(() => dispatch(handle, payloads(handle).close), /sealed/)
  } finally {
    disposeRun(handle)
  }
})

test('a complete failing score may be sealed without treating sealed as PASS', () => {
  const handle = createRun(phase2Manifest())
  try {
    const { sealed } = completeRun(handle, {
      answer: {
        humanAction: 'Throttle',
        api: 'POST',
        path: '/wrong',
        command: 'syntheticctl inspect',
        order: 'inspect then throttle',
      },
    })
    assert.equal(sealed.score.correctness, false)
    assert.equal(sealed.score.passed, false)
    assert.equal(verifySealedRun(handle.root).score.passed, false)
  } finally {
    disposeRun(handle)
  }
})

test('fake interruption after durable reservation leaves an immutable unresolved receipt and blocks seal', () => {
  const handle = createRun(phase2Manifest())
  try {
    const commands = runThroughInput(handle)
    const fake = throwingFakeTransport()
    dispatch(handle, commands.retrievalReservation)
    assert.throws(
      () => dispatch(handle, commands.retrievalSubmission, fake),
      /injected offline interruption/,
    )
    assert.equal(fake.audit.dispatches, 1)
    assert.equal(inspectRun(handle).receipts.at(-1)?.payload.event, 'effect.submitted')
    dispatch(handle, {
      event: 'transport.failed',
      attemptId: 'attempt-1',
      effectId: 'retrieval-effect',
      uncertainty: 'after-submission',
      label: 'injected fake failure',
    })
    assert.throws(() => sealRun(handle), /observations|completion/)
  } finally {
    disposeRun(handle)
  }
})

test('store retains contradictory never-submitted tool evidence and cannot seal or verify PASS', () => {
  const handle = createRun(phase2Manifest())
  try {
    const commands = runThroughInput(handle)
    dispatch(handle, {
      event: 'effect.reserved',
      attemptId: 'attempt-1',
      effectId: 'tool-never-submitted',
      operation: 'tool',
    })
    dispatch(handle, {
      event: 'transport.failed',
      attemptId: 'attempt-1',
      effectId: 'tool-never-submitted',
      uncertainty: 'before-submission',
      label: 'failed before dispatch',
    })
    const result = dispatch(handle, {
      event: 'tool.result',
      attemptId: 'attempt-1',
      effectId: 'tool-never-submitted',
      conversationId: 'conversation-1',
      tool: 'offline-fake',
      success: true,
      content: 'contradictory terminal evidence',
    })
    assert.throws(
      () =>
        dispatch(handle, {
          event: 'effect.reconciled',
          reservationKind: 'effect',
          reservationId: 'tool-never-submitted',
          resolution: 'completed',
          observationSequences: [result.sequence],
        }),
      /completed reconciliation requires exact effect submission/,
    )
    const inspection = inspectRun(handle)
    assert.equal(inspection.receipts.at(-1)?.sequence, result.sequence)
    assert.equal(inspection.receipts.at(-1)?.payload.event, 'tool.result')
    dispatch(handle, commands.final)
    assert.throws(() => dispatch(handle, commands.close), /unresolved reservations/)
    assert.throws(() => sealRun(handle), /observations|completion/)
    assert.throws(() => verifySealedRun(handle.root), /sealed artifacts missing/)
    assert.equal(fs.existsSync(path.join(handle.root, 'score.json')), false)
  } finally {
    disposeRun(handle)
  }
})

test('store retains late contradictions and blocks new effect submission after final', () => {
  const contradicted = createRun(phase2Manifest())
  try {
    const commands = runThroughInput(contradicted)
    dispatch(contradicted, {
      event: 'effect.reserved',
      attemptId: 'attempt-1',
      effectId: 'late-tool',
      operation: 'tool',
    })
    dispatch(contradicted, {
      event: 'transport.failed',
      attemptId: 'attempt-1',
      effectId: 'late-tool',
      uncertainty: 'before-submission',
      label: 'failed before dispatch',
    })
    dispatch(contradicted, {
      event: 'effect.reconciled',
      reservationKind: 'effect',
      reservationId: 'late-tool',
      resolution: 'not-submitted',
      observationSequences: [],
    })
    const late = dispatch(contradicted, {
      event: 'provider.action',
      attemptId: 'attempt-1',
      effectId: 'late-tool',
      conversationId: 'conversation-1',
      action: 'late-provider-action',
    })
    assert.equal(inspectRun(contradicted).receipts.at(-1)?.receiptHash, late.receiptHash)
    dispatch(contradicted, commands.final)
    assert.throws(() => dispatch(contradicted, commands.close), /unresolved reservations/)
    assert.throws(() => sealRun(contradicted), /observations|completion/)
  } finally {
    disposeRun(contradicted)
  }

  const postFinal = createRun(phase2Manifest())
  try {
    const commands = runThroughInput(postFinal)
    dispatch(postFinal, {
      event: 'effect.reserved',
      attemptId: 'attempt-1',
      effectId: 'reserved-before-final',
      operation: 'tool',
    })
    dispatch(postFinal, commands.final)
    assert.throws(
      () =>
        dispatch(postFinal, {
          event: 'effect.submitted',
          attemptId: 'attempt-1',
          effectId: 'reserved-before-final',
        }),
      /effect submission after final/,
    )
    assert.equal(inspectRun(postFinal).receipts.at(-1)?.payload.event, 'planner.response')
    assert.throws(() => dispatch(postFinal, commands.close), /unresolved reservations/)
    assert.throws(() => sealRun(postFinal), /observations|completion/)
  } finally {
    disposeRun(postFinal)
  }
})

test('read-only import rejects outside-temp, prefix lookalike, nested, and symlink roots before parsing', () => {
  const outside = path.join(process.cwd(), `${RUN_PREFIX}outside`)
  assert.throws(() => inspectRun(outside), /filesystem boundary/)
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'host-evidence-parent-'))
  try {
    const lookalike = path.join(parent, `${RUN_PREFIX}lookalike`)
    fs.mkdirSync(lookalike, { mode: 0o700 })
    assert.throws(() => inspectRun(lookalike), /direct prefixed child/)
    const nested = path.join(fs.realpathSync(os.tmpdir()), `${RUN_PREFIX}nested-${process.pid}`)
    fs.mkdirSync(nested, { mode: 0o700 })
    const child = path.join(nested, `${RUN_PREFIX}child`)
    fs.mkdirSync(child, { mode: 0o700 })
    assert.throws(() => inspectRun(child), /direct prefixed child/)
    cleanupRoot(nested)
    const link = path.join(fs.realpathSync(os.tmpdir()), `${RUN_PREFIX}link-${process.pid}`)
    fs.symlinkSync(lookalike, link)
    assert.throws(() => inspectRun(link), /replacement or alias|direct prefixed child/)
    fs.unlinkSync(link)
  } finally {
    cleanupRoot(parent)
  }
})

test('unknown entries and root replacement fail closed without deleting foreign state', () => {
  const handle = createRun(phase2Manifest())
  const unknown = path.join(handle.root, 'unknown.json')
  fs.writeFileSync(unknown, '{}', { mode: 0o600 })
  assert.throws(() => inspectRun(handle), /unknown entries/)
  cleanupRoot(handle.root)

  const replacement = createRun(phase2Manifest())
  const moved = `${replacement.root}-moved`
  fs.renameSync(replacement.root, moved)
  fs.mkdirSync(replacement.root, { mode: 0o700 })
  assert.throws(() => inspectRun(replacement), /unknown entries|root replacement|descriptor/)
  cleanupRoot(replacement.root)
  cleanupRoot(moved)
})

test('immutable and receipt guards directly reject symlink, hardlink, directory substitution, and mode drift', () => {
  // A true FIFO/socket fixture is deferred because creating one here would require forbidden
  // child-process or network APIs; the production guard still requires fstat().isFile().
  const cases = ['symlink', 'hardlink', 'directory', 'mode'] as const
  for (const targetKind of ['descriptor.json', receiptFileName(1)] as const) {
    for (const mutation of cases) {
      const handle = createRun(phase2Manifest())
      if (targetKind.startsWith('receipt')) authorizeRun(handle)
      const target = path.join(handle.root, targetKind)
      const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'host-evidence-guard-backup-'))
      const backup = path.join(backupRoot, 'original')
      if (mutation === 'mode') {
        fs.chmodSync(target, 0o644)
      } else {
        fs.renameSync(target, backup)
        if (mutation === 'symlink') fs.symlinkSync(backup, target)
        if (mutation === 'hardlink') fs.linkSync(backup, target)
        if (mutation === 'directory') fs.mkdirSync(target, { mode: 0o700 })
      }
      assert.throws(() => inspectRun(handle), /filesystem boundary/)
      cleanupRoot(handle.root)
      cleanupRoot(backupRoot)
    }
  }
})

test('canonical reads reject whitespace, malformed JSON, malformed UTF-8, and receipt filename rename', () => {
  const variants: Array<(handle: RunHandle) => void> = [
    (handle) => fs.appendFileSync(path.join(handle.root, 'manifest.json'), '\n'),
    (handle) => fs.writeFileSync(path.join(handle.root, 'manifest.json'), '{', { mode: 0o600 }),
    (handle) =>
      fs.writeFileSync(path.join(handle.root, 'manifest.json'), Buffer.from([0xff]), {
        mode: 0o600,
      }),
    (handle) =>
      fs.renameSync(
        path.join(handle.root, receiptFileName(1)),
        path.join(handle.root, 'receipt-000002.json'),
      ),
  ]
  for (const [index, mutate] of variants.entries()) {
    const handle = createRun(phase2Manifest())
    if (index === 3) authorizeRun(handle)
    mutate(handle)
    assert.throws(() => inspectRun(handle), /representation|integrity/)
    cleanupRoot(handle.root)
  }
})

test('manifest, binding, descriptor, authorization, payload, predecessor, and receipt hash drift fail integrity', () => {
  const targets: Array<[string, (value: Record<string, unknown>) => void]> = [
    ['manifest.json', (value) => (value.cellId = 'drifted')],
    ['bindings.json', (value) => (value.promptHash = '1'.repeat(64))],
    ['descriptor.json', (value) => (value.runId = 'other-run')],
  ]
  for (const [name, mutate] of targets) {
    const handle = createRun(phase2Manifest())
    const target = path.join(handle.root, name)
    const value = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>
    mutate(value)
    fs.writeFileSync(target, JSON.stringify(value), { mode: 0o600 })
    assert.throws(() => inspectRun(handle), /integrity|filesystem boundary|context\.bindings/)
    cleanupRoot(handle.root)
  }

  for (const field of ['payload', 'previousHash', 'receiptHash'] as const) {
    const handle = createRun(phase2Manifest())
    authorizeRun(handle)
    const target = path.join(handle.root, receiptFileName(1))
    const value = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>
    if (field === 'payload')
      (value.payload as Record<string, unknown>).manifestHash = '2'.repeat(64)
    else value[field] = '3'.repeat(64)
    const ordered = JSON.parse(JSON.stringify(value))
    // Re-sort through the contract's canonical serializer by copying stored key order is intentionally insufficient.
    fs.writeFileSync(target, JSON.stringify(ordered), { mode: 0o600 })
    assert.throws(() => inspectRun(handle), /representation|integrity/)
    cleanupRoot(handle.root)
  }
})

test('stored evidence, score, seal head, and expected checkpoint tampering are detected', () => {
  for (const targetName of ['evidence.json', 'score.json', 'seal.json'] as const) {
    const handle = createRun(phase2Manifest())
    const { sealed } = completeRun(handle)
    const target = path.join(handle.root, targetName)
    const value = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>
    if (targetName === 'evidence.json') value.cellId = 'tampered'
    if (targetName === 'score.json') value.passed = !value.passed
    if (targetName === 'seal.json') value.receiptHead = '4'.repeat(64)
    fs.writeFileSync(target, JSON.stringify(value), { mode: 0o600 })
    assert.throws(() => verifySealedRun(handle.root, sealed.checkpoint), /integrity/)
    cleanupRoot(handle.root)
  }

  const handle = createRun(phase2Manifest())
  try {
    const { sealed } = completeRun(handle)
    const wrong = cloneHostEvidenceFixture(buildPositiveHostEvidenceFixture())
    assert.throws(
      () => verifySealedRun(handle.root, { ...sealed.checkpoint, runId: wrong.manifest.taskId }),
      /checkpoint substitution/,
    )
  } finally {
    disposeRun(handle)
  }
})

test('store accepts only exact typed payloads before persistence', () => {
  const handle = createRun(phase2Manifest())
  try {
    authorizeRun(handle)
    const before = fs.readdirSync(handle.root)
    const invalid = {
      event: 'attempt.reserved',
      attemptId: 'attempt-1',
      processId: 'process-1',
      extra: true,
    }
    assert.throws(() => dispatch(handle, invalid as unknown as ReceiptPayload), /exact keys/)
    assert.deepEqual(fs.readdirSync(handle.root), before)
  } finally {
    disposeRun(handle)
  }
})

function writeCanonical(target: string, value: unknown): void {
  fs.writeFileSync(target, stableJson(value), { mode: 0o600 })
}

test('active handle pins immutable values, content, inode identity, and rejects forged clones', () => {
  const coherent = createRun(phase2Manifest())
  const manifestPath = path.join(coherent.root, 'manifest.json')
  const bindingsPath = path.join(coherent.root, 'bindings.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const bindings = JSON.parse(fs.readFileSync(bindingsPath, 'utf8'))
  manifest.cellId = 'coherently-rewritten-cell'
  bindings.manifestHash = computeManifestHash(manifest)
  writeCanonical(manifestPath, manifest)
  writeCanonical(bindingsPath, bindings)
  assert.throws(() => authorizeRun(coherent), /immutable active identity|immutable inode/)
  cleanupRoot(coherent.root)

  const replaced = createRun(phase2Manifest())
  const descriptorPath = path.join(replaced.root, 'descriptor.json')
  const bytes = fs.readFileSync(descriptorPath)
  fs.unlinkSync(descriptorPath)
  fs.writeFileSync(descriptorPath, bytes, { mode: 0o600 })
  assert.throws(() => authorizeRun(replaced), /immutable inode/)
  cleanupRoot(replaced.root)

  const real = createRun(phase2Manifest())
  const forged = { ...real } as RunHandle
  assert.throws(() => authorizeRun(forged), /forged or cloned/)
  disposeRun(real)
})

test('active receipt checkpoint rejects suffix deletion and coherent history rewrite', () => {
  const deleted = createRun(phase2Manifest())
  authorizeRun(deleted)
  dispatch(deleted, payloads(deleted).attempt)
  fs.unlinkSync(path.join(deleted.root, receiptFileName(2)))
  assert.throws(
    () => dispatch(deleted, payloads(deleted).attempt),
    /active receipt checkpoint drift/,
  )
  cleanupRoot(deleted.root)

  const rewritten = createRun(phase2Manifest())
  authorizeRun(rewritten)
  dispatch(rewritten, payloads(rewritten).attempt)
  const receiptPath = path.join(rewritten.root, receiptFileName(2))
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as Receipt
  const payload = receipt.payload as Extract<ReceiptPayload, { event: 'attempt.reserved' }>
  payload.processId = 'coherent-rewrite'
  const { receiptHash: _oldHash, ...unsigned } = receipt
  receipt.receiptHash = computeReceiptHash(unsigned)
  writeCanonical(receiptPath, receipt)
  assert.throws(
    () => dispatch(rewritten, payloads(rewritten).ready),
    /active receipt checkpoint drift/,
  )
  cleanupRoot(rewritten.root)
})

test('externally introduced seal and root or workspace mode drift block active mutation', () => {
  const externalSeal = createRun(phase2Manifest())
  writeCanonical(path.join(externalSeal.root, 'seal.json'), {})
  assert.throws(() => authorizeRun(externalSeal), /seal blocks mutation/)
  cleanupRoot(externalSeal.root)

  for (const targetName of ['root', 'workspace'] as const) {
    const handle = createRun(phase2Manifest())
    fs.chmodSync(targetName === 'root' ? handle.root : handle.workspace, 0o755)
    assert.throws(() => authorizeRun(handle), /mode drift/)
    fs.chmodSync(handle.root, 0o700)
    cleanupRoot(handle.root)
  }
})

test('Phase 1-valid but Phase 2-incompatible identifiers and field counts are rejected', () => {
  const unsafeId = phase2Manifest()
  unsafeId.taskId = 'unsafe task id'
  assert.throws(() => createRun(unsafeId), /safe identifier/)

  const tooManyFields = phase2Manifest()
  tooManyFields.expectedResponse.fields = Array.from({ length: 65 }, (_, index) => ({
    name: `field-${index}`,
    value: 'value',
    unknownValue: '' as const,
    policy: 'exact' as const,
  }))
  assert.throws(() => createRun(tooManyFields), /too many fields for Phase 2/)
})

test('foreign owner-lock value, BOM, duplicate keys, and excessive depth fail closed', () => {
  const cases: Array<(handle: RunHandle) => void> = [
    (handle) => {
      const target = path.join(handle.root, 'owner-lock.json')
      const lock = JSON.parse(fs.readFileSync(target, 'utf8'))
      lock.ownerId = 'foreign-owner'
      writeCanonical(target, lock)
    },
    (handle) => {
      const target = path.join(handle.root, 'manifest.json')
      fs.writeFileSync(
        target,
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(target)]),
        { mode: 0o600 },
      )
    },
    (handle) => {
      const target = path.join(handle.root, 'owner-lock.json')
      const lock = JSON.parse(fs.readFileSync(target, 'utf8'))
      fs.writeFileSync(
        target,
        `{"ownerId":"duplicate","ownerId":${JSON.stringify(lock.ownerId)},"schemaVersion":1,"sessionToken":${JSON.stringify(lock.sessionToken)}}`,
        { mode: 0o600 },
      )
    },
    (handle) => {
      let nested: unknown = 'leaf'
      for (let depth = 0; depth < 34; depth += 1) nested = { nested }
      writeCanonical(path.join(handle.root, 'manifest.json'), nested)
    },
  ]
  for (const mutate of cases) {
    const handle = createRun(phase2Manifest())
    mutate(handle)
    assert.throws(() => authorizeRun(handle), /integrity|representation|nesting|canonical/)
    cleanupRoot(handle.root)
  }
})
