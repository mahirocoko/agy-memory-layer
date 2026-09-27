import * as assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import {
  acquireReflectionReservation,
  inspectReflectionReservation,
  reclaimDeadReflectionReservation,
  reflectionReservationPath,
  releaseReflectionReservation,
} from '../plugins/agy-memory-layer/scripts/dream-reflection-reservation.ts'
import {
  type CronExecutor,
  installLlmReflectionCron,
  installRegexDreamCron,
  isLlmDreamCronLine,
  isRegexDreamCronLine,
  LLM_CRON_INSTALL_CONFIRMATION,
  previewLlmReflectionCron,
  shellQuote,
  uninstallRegexDreamCron,
} from '../plugins/agy-memory-layer/scripts/dream-reflection-schedule.ts'
import {
  AGY_HOST_ISOLATION,
  AGY_REFLECTION_CHILD_ENV,
  createAgyReflectionTransport,
  PRIMARY_REFLECTION_MODEL,
  ReflectionTransportError,
} from '../plugins/agy-memory-layer/scripts/dream-reflection-transport.ts'
import {
  acquireMemoryWriteLock,
  acquireMemoryWriteLockAtStateRoot,
  releaseMemoryWriteLock,
} from '../plugins/agy-memory-layer/scripts/memory-write-lock.ts'
import { isProcessAlive } from '../plugins/agy-memory-layer/scripts/process-liveness.ts'
import {
  TEST_ENVIRONMENT,
  TEST_MEMORY_ROOT,
  TEST_ORIGINAL_HOME,
  TEST_STATE_ROOT,
  TEST_TEMP_ROOT,
} from './test-environment.ts'

const MEMORY_ROOT = TEST_MEMORY_ROOT
const stateDir = `${MEMORY_ROOT}.state`
const stateFile = path.join(stateDir, 'dream-state.json')
const reservationFile = path.join(stateDir, 'reflection-reservation.json')
const receiptFile = path.join(stateDir, 'reflection-receipt.json')
const historyFile = path.join(
  TEST_ENVIRONMENT.homeDir,
  '.gemini',
  'antigravity-cli',
  'history.jsonl',
)
const brainRoot = path.join(TEST_ENVIRONMENT.homeDir, '.gemini', 'antigravity-cli', 'brain')
const {
  DEFAULT_REFLECTION_STEP_COUNT,
  dreamLlmExitCode,
  getDreamState,
  inspectDreamReflectionStatus,
  interpretCrontabListFailure,
  liveCronInvocationCount,
  planDreamCli,
  runDream,
  runDreamMaintenanceCommand,
  runScheduledReflection,
  saveDreamState,
} = await import('../plugins/agy-memory-layer/scripts/dream-daemon.ts')
const { commitMemoryPaths, writeMemoryFile } = await import(
  '../plugins/agy-memory-layer/scripts/memory-repository.ts'
)
const { listPendingProposals, proposeMemoryUpdate } = await import(
  '../plugins/agy-memory-layer/scripts/memory-approval.ts'
)

const conversationId = '12121212-1212-4212-8212-121212121212'
const otherConversationId = '34343434-3434-4434-8434-343434343434'

const exitedPid = async (): Promise<number> =>
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
    if (!child.pid) {
      reject(new Error('missing pid'))
      return
    }
    const pid = child.pid
    child.once('exit', () => resolve(pid))
    child.once('error', reject)
  })

const reservationDocument = (pid: number, token = crypto.randomUUID()) => ({
  version: 1,
  token,
  pid,
  createdAt: '2026-09-27T00:00:00.000Z',
  conversationId,
})

const writeReservation = (root: string, value: unknown): string => {
  fs.mkdirSync(root, { recursive: true })
  const file = reflectionReservationPath(root)
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`)
  return file
}

const explodingCron = (): CronExecutor => ({
  read: () => {
    throw new Error('crontab read')
  },
  write: () => {
    throw new Error('crontab write')
  },
})

const recordingCron = (
  initial = '',
): {
  executor: CronExecutor
  text: () => string
  writes: string[]
} => {
  let current = initial
  const writes: string[] = []
  return {
    writes,
    text: () => current,
    executor: {
      read: () => current,
      write: (crontab: string) => {
        writes.push(crontab)
        current = crontab
      },
    },
  }
}

const userLine = (content: string): string =>
  JSON.stringify({ type: 'USER_INPUT', content: `<USER_REQUEST>${content}</USER_REQUEST>` })

const eligibleTranscript = (label: string): string[] =>
  Array.from({ length: DEFAULT_REFLECTION_STEP_COUNT }, (_, index) => userLine(`${label}_${index}`))

const reviewedJson = (operations: unknown[]): string =>
  JSON.stringify({ summary: 'reviewed slice', operations })

const gitHead = (): string =>
  execFileSync('git', ['-C', MEMORY_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

const pendingDir = path.join(stateDir, 'pending-approvals')

const withDream = (run: (created: string[]) => void): void => {
  const head = gitHead()
  const stateBackup = fs.existsSync(stateFile) ? fs.readFileSync(stateFile) : null
  const reservationBackup = fs.existsSync(reservationFile) ? fs.readFileSync(reservationFile) : null
  const receiptBackup = fs.existsSync(receiptFile) ? fs.readFileSync(receiptFile) : null
  const historyBackup = fs.existsSync(historyFile) ? fs.readFileSync(historyFile) : null
  const pendingBefore = new Set(fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir) : [])
  const created: string[] = []
  try {
    run(created)
  } finally {
    if (gitHead() !== head) {
      execFileSync('git', ['-C', MEMORY_ROOT, 'reset', '--hard', head], { stdio: 'ignore' })
    }
    if (stateBackup === null) fs.rmSync(stateFile, { force: true })
    else fs.writeFileSync(stateFile, stateBackup)
    if (reservationBackup === null) fs.rmSync(reservationFile, { force: true })
    else fs.writeFileSync(reservationFile, reservationBackup)
    if (receiptBackup === null) fs.rmSync(receiptFile, { force: true })
    else fs.writeFileSync(receiptFile, receiptBackup)
    if (historyBackup === null) fs.rmSync(historyFile, { force: true })
    else fs.writeFileSync(historyFile, historyBackup)
    for (const id of created) fs.rmSync(path.join(brainRoot, id), { recursive: true, force: true })
    if (fs.existsSync(pendingDir)) {
      for (const file of fs.readdirSync(pendingDir)) {
        if (!pendingBefore.has(file)) fs.rmSync(path.join(pendingDir, file), { force: true })
      }
    }
  }
}

const seedConversation = (id: string, lines: string[]): string => {
  const slug = 'phase4-dream'
  const workspace = path.join(TEST_TEMP_ROOT, slug)
  fs.mkdirSync(workspace, { recursive: true })
  const relativePath = `projects/${slug}/project.md`
  if (!fs.existsSync(path.join(MEMORY_ROOT, relativePath))) {
    writeMemoryFile(MEMORY_ROOT, relativePath, `# ${slug}\n- Keep this project note.\n`)
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [relativePath],
      reason: `test: init ${slug}`,
    })
  }
  const logDir = path.join(brainRoot, id, '.system_generated', 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, 'transcript.jsonl')
  fs.writeFileSync(logPath, `${lines.join('\n')}\n`)
  fs.mkdirSync(path.dirname(historyFile), { recursive: true })
  fs.writeFileSync(
    historyFile,
    `${JSON.stringify({ conversationId: id, timestamp: 1, workspace })}\n`,
  )
  return logPath
}

const runEligible = (transport: {
  reflect: (request: { cwd?: string; prompt: string }) => string
}): ReturnType<typeof runDream> =>
  runDream(
    { kind: 'project', slug: 'phase4-dream' },
    { llm: true, force: true, idleMinutes: 0, transport },
  )

describe('dream v2 phase 4 reservation and activation', () => {
  it('distinguishes live, dead, and unreadable reservations without deleting them', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-reflection-reservation-'))
    assert.equal(root.startsWith(os.homedir()), false)
    const acquired = acquireReflectionReservation(root, conversationId)
    assert.equal(acquired.status, 'acquired')
    if (acquired.status !== 'acquired') return
    const busy = acquireReflectionReservation(root, otherConversationId)
    assert.equal(busy.status, 'live')
    const beforeInspect = fs.readFileSync(reflectionReservationPath(root))
    assert.equal(inspectReflectionReservation(root).status, 'live')
    assert.deepEqual(fs.readFileSync(reflectionReservationPath(root)), beforeInspect)
    assert.equal(releaseReflectionReservation(root, crypto.randomUUID()).status, 'mismatch')
    assert.equal(fs.existsSync(reflectionReservationPath(root)), true)
    assert.equal(reclaimDeadReflectionReservation(root, acquired.reservation.token).status, 'live')
    assert.equal(releaseReflectionReservation(root, acquired.reservation.token).status, 'released')
    assert.equal(fs.existsSync(reflectionReservationPath(root)), false)

    const deadPid = await exitedPid()
    assert.equal(isProcessAlive(deadPid), false)
    const deadToken = crypto.randomUUID()
    const deadFile = writeReservation(root, reservationDocument(deadPid, deadToken))
    const deadBytes = fs.readFileSync(deadFile)
    assert.equal(inspectReflectionReservation(root).status, 'dead')
    assert.equal(acquireReflectionReservation(root, conversationId).status, 'dead')
    assert.deepEqual(fs.readFileSync(deadFile), deadBytes)
    assert.equal(reclaimDeadReflectionReservation(root, crypto.randomUUID()).status, 'mismatch')
    assert.deepEqual(fs.readFileSync(deadFile), deadBytes)
    assert.equal(reclaimDeadReflectionReservation(root, deadToken).status, 'reclaimed')
    assert.equal(fs.existsSync(deadFile), false)

    const liveAgain = acquireReflectionReservation(root, conversationId)
    assert.equal(liveAgain.status, 'acquired')
    if (liveAgain.status === 'acquired') {
      assert.equal(
        releaseReflectionReservation(root, liveAgain.reservation.token, {
          pid: liveAgain.reservation.pid + 1,
        }).status,
        'mismatch',
      )
      assert.equal(fs.existsSync(reflectionReservationPath(root)), true)
      assert.equal(
        releaseReflectionReservation(root, liveAgain.reservation.token).status,
        'released',
      )
    }
    const probeToken = crypto.randomUUID()
    const probeFile = writeReservation(root, reservationDocument(deadPid, probeToken))
    const probeBytes = fs.readFileSync(probeFile)
    assert.equal(
      reclaimDeadReflectionReservation(root, probeToken, {
        liveness: () => {
          throw new Error('probe down')
        },
      }).status,
      'ambiguous',
    )
    assert.deepEqual(fs.readFileSync(probeFile), probeBytes)
    assert.deepEqual(inspectReflectionReservation(root, { liveness: () => 'ambiguous' }), {
      status: 'ambiguous',
      reason: 'liveness',
    })
    fs.rmSync(probeFile, { force: true })

    const ambiguous = reflectionReservationPath(root)
    fs.writeFileSync(ambiguous, '{')
    const ambiguousBytes = fs.readFileSync(ambiguous)
    assert.deepEqual(inspectReflectionReservation(root), {
      status: 'ambiguous',
      reason: 'invalid-json',
    })
    assert.equal(acquireReflectionReservation(root, conversationId).status, 'ambiguous')
    assert.equal(reclaimDeadReflectionReservation(root, deadToken).status, 'ambiguous')
    assert.equal(releaseReflectionReservation(root, deadToken).status, 'ambiguous')
    assert.deepEqual(fs.readFileSync(ambiguous), ambiguousBytes)
    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
      fs.chmodSync(ambiguous, 0o000)
      assert.equal(inspectReflectionReservation(root).status, 'ambiguous')
      fs.chmodSync(ambiguous, 0o600)
      assert.deepEqual(fs.readFileSync(ambiguous), ambiguousBytes)
    }
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('refuses a nested provider call before transport and cleans a private temp cwd', () => {
    const previous = process.env[AGY_REFLECTION_CHILD_ENV]
    process.env[AGY_REFLECTION_CHILD_ENV] = '1'
    let runnerCalls = 0
    try {
      const nested = createAgyReflectionTransport({
        run: () => {
          runnerCalls += 1
          throw new Error('runner must not be called')
        },
      })
      assert.throws(
        () =>
          nested.reflect({
            prompt: 'nested',
            model: PRIMARY_REFLECTION_MODEL,
            jsonSchema: '{}',
          }),
        (error: unknown) =>
          error instanceof ReflectionTransportError && error.code === 'RECURSIVE_CHILD',
      )
      assert.equal(runnerCalls, 0)
    } finally {
      if (previous === undefined) delete process.env[AGY_REFLECTION_CHILD_ENV]
      else process.env[AGY_REFLECTION_CHILD_ENV] = previous
    }

    withDream((created) => {
      created.push(conversationId)
      const lines = eligibleTranscript('TEMP_SENTINEL')
      const logPath = seedConversation(conversationId, lines)
      let cwd = ''
      let cwdMode = 0
      const transport = {
        reflect: (request: { cwd?: string; prompt: string }): string => {
          assert.ok(request.cwd)
          cwd = request.cwd
          const stat = fs.statSync(request.cwd)
          cwdMode = stat.mode & 0o777
          assert.equal(stat.isDirectory(), true)
          const promptStat = fs.statSync(path.join(request.cwd, 'prompt.txt'))
          assert.equal(promptStat.mode & 0o777, 0o600)
          assert.equal(fs.existsSync(path.join(stateDir, 'locks', 'memory-write.lock')), false)
          assert.equal(fs.existsSync(reservationFile), true)
          assert.equal(request.prompt.includes('TEMP_SENTINEL_0'), true)
          return reviewedJson([])
        },
      }
      const result = runEligible(transport)
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.status, 'advanced')
      assert.equal(cwdMode, 0o700)
      assert.equal(fs.existsSync(cwd), false)
      assert.equal(fs.existsSync(reservationFile), false)
      const receiptText = fs.readFileSync(receiptFile, 'utf8')
      assert.equal(receiptText.includes('TEMP_SENTINEL_0'), false)
      assert.equal(receiptText.includes('reviewed slice'), false)
      assert.equal(receiptText.includes(logPath), false)
      const receipt = JSON.parse(receiptText) as {
        hostIsolation: string
        cliVersion: string | null
      }
      assert.equal(receipt.hostIsolation, AGY_HOST_ISOLATION)
      assert.equal(receipt.cliVersion, null)
      assert.equal(result.result.receipt?.hostIsolation, 'unverified')
    })
  })

  it('allows an appended suffix and rejects captured-prefix or cursor races without rewind', () => {
    withDream((created) => {
      const id = '56565656-5656-4565-8565-565656565656'
      created.push(id)
      const lines = eligibleTranscript('PREFIX')
      const logPath = seedConversation(id, lines)
      const state = getDreamState()
      state.lastDreamedSteps[id] = 3
      state.reflection.failures[otherConversationId] = {
        count: 2,
        lastAt: '2026-09-27T00:00:00.000Z',
        code: 'TIMEOUT',
      }
      saveDreamState(state)
      const appended = {
        reflect: (): string => {
          fs.appendFileSync(logPath, `${userLine('APPENDED_SUFFIX')}\n`)
          return reviewedJson([])
        },
      }
      const advanced = runEligible(appended)
      assert.equal(advanced.mode, 'llm')
      if (advanced.mode !== 'llm') return
      assert.equal(advanced.result.status, 'advanced')
      assert.equal(advanced.result.capturedThroughStep, DEFAULT_REFLECTION_STEP_COUNT)
      assert.equal(
        getDreamState().reflection.reflectedThroughStep[id],
        DEFAULT_REFLECTION_STEP_COUNT,
      )
      assert.equal(fs.readFileSync(logPath, 'utf8').includes('APPENDED_SUFFIX'), true)
      assert.equal(getDreamState().lastDreamedSteps[id], 3)
      assert.equal(getDreamState().reflection.failures[otherConversationId]?.count, 2)
    })

    withDream((created) => {
      const id = '78787878-7878-4787-8787-787878787878'
      created.push(id)
      const lines = eligibleTranscript('MUTATE')
      const logPath = seedConversation(id, lines)
      const mutate = {
        reflect: (): string => {
          const current = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n')
          current[0] = userLine('REWRITTEN_PREFIX')
          fs.writeFileSync(logPath, `${current.join('\n')}\n`)
          return reviewedJson([])
        },
      }
      const rewritten = runEligible(mutate)
      assert.equal(rewritten.mode, 'llm')
      if (rewritten.mode !== 'llm') return
      assert.equal(rewritten.result.code, 'TRANSCRIPT_PREFIX_CHANGED')
      assert.equal(getDreamState().reflection.reflectedThroughStep[id], undefined)
      assert.equal(getDreamState().reflection.failures[id], undefined)
      assert.equal(
        listPendingProposals().some((proposal) => proposal.author === 'Dream v2 reflection'),
        false,
      )
    })

    withDream((created) => {
      const id = '90909090-9090-4909-8909-909090909090'
      created.push(id)
      const lines = eligibleTranscript('TRUNCATE')
      const logPath = seedConversation(id, lines)
      const truncate = {
        reflect: (): string => {
          const current = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n')
          fs.writeFileSync(logPath, `${current.slice(0, 10).join('\n')}\n`)
          return reviewedJson([])
        },
      }
      const truncated = runEligible(truncate)
      assert.equal(truncated.mode, 'llm')
      if (truncated.mode !== 'llm') return
      assert.equal(truncated.result.code, 'TRANSCRIPT_PREFIX_CHANGED')
      assert.equal(getDreamState().reflection.reflectedThroughStep[id], undefined)
      assert.equal(getDreamState().reflection.failures[id], undefined)
    })

    withDream((created) => {
      const id = '92929292-9292-4292-8292-929292929292'
      created.push(id)
      const lines = [userLine('ALREADY_REFLECTED_0'), userLine('ALREADY_REFLECTED_1')]
      lines.push(...eligibleTranscript('NONZERO_CURSOR'))
      const logPath = seedConversation(id, lines)
      const state = getDreamState()
      state.reflection.reflectedThroughStep[id] = 2
      saveDreamState(state)
      const rewriteEarlierPrefix = {
        reflect: (): string => {
          const current = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n')
          current[0] = userLine('REWRITTEN_BEFORE_NONZERO_CURSOR')
          fs.writeFileSync(logPath, `${current.join('\n')}\n`)
          return reviewedJson([])
        },
      }
      const rewritten = runEligible(rewriteEarlierPrefix)
      assert.equal(rewritten.mode, 'llm')
      if (rewritten.mode !== 'llm') return
      assert.equal(rewritten.result.code, 'TRANSCRIPT_PREFIX_CHANGED')
      assert.equal(getDreamState().reflection.reflectedThroughStep[id], 2)
      assert.equal(getDreamState().reflection.failures[id], undefined)
      assert.equal(rewritten.result.proposalIds.length, 0)
      assert.equal(
        listPendingProposals().some((proposal) => proposal.author === 'Dream v2 reflection'),
        false,
      )
    })

    withDream((created) => {
      const id = 'abababab-abab-4bab-8bab-abababababab'
      created.push(id)
      const lines = eligibleTranscript('CURSOR')
      seedConversation(id, lines)
      const move = {
        reflect: (): string => {
          const latest = getDreamState()
          latest.reflection.reflectedThroughStep[id] = 80
          saveDreamState(latest)
          return reviewedJson([])
        },
      }
      const moved = runEligible(move)
      assert.equal(moved.mode, 'llm')
      if (moved.mode !== 'llm') return
      assert.equal(moved.result.code, 'CURSOR_MOVED')
      assert.equal(getDreamState().reflection.reflectedThroughStep[id], 80)
      assert.equal(getDreamState().reflection.failures[id], undefined)
      assert.equal(moved.result.proposalIds.length, 0)
    })
  })

  it('discards proposals when the cursor moves after creation and does not rewind it', () => {
    withDream((created) => {
      const id = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
      created.push(id)
      seedConversation(id, eligibleTranscript('AFTER_CREATE'))
      const persona = fs.readFileSync(path.join(MEMORY_ROOT, 'global', 'persona.md'), 'utf8')
      const unrelated = proposeMemoryUpdate(
        'global/persona.md',
        `${persona.trimEnd()}\n- unrelated proposal\n`,
        { reason: 'unrelated', author: 'phase4 test', requireExplicit: true },
      )
      const result = runDream(
        { kind: 'project', slug: 'phase4-dream' },
        {
          llm: true,
          force: true,
          idleMinutes: 0,
          beforePersistProposal: () => {
            const latest = getDreamState()
            latest.reflection.reflectedThroughStep[id] = 77
            saveDreamState(latest)
          },
          transport: {
            reflect: () =>
              reviewedJson([
                {
                  op: 'write',
                  path: 'global/persona.md',
                  description: 'Append one reviewed line.',
                  body: `${persona.trimEnd()}\n- Reviewed line.\n`,
                },
              ]),
          },
        },
      )
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.code, 'CURSOR_MOVED')
      assert.equal(getDreamState().reflection.reflectedThroughStep[id], 77)
      assert.equal(result.result.proposalIds.length, 0)
      const pending = listPendingProposals()
      assert.equal(
        pending.some((proposal) => proposal.author === 'Dream v2 reflection'),
        false,
      )
      assert.equal(
        pending.some((proposal) => proposal.id === unrelated.proposalId),
        true,
      )
    })
  })

  it('does not treat reservation contention as a model failure or call transport', async () => {
    const deadPid = await exitedPid()
    withDream((created) => {
      const id = 'efefefef-efef-4fef-8fef-efefefefefef'
      created.push(id)
      seedConversation(id, eligibleTranscript('BUSY'))
      const held = acquireReflectionReservation(stateDir, otherConversationId)
      assert.equal(held.status, 'acquired')
      if (held.status !== 'acquired') return
      let calls = 0
      const busy = runDream(
        { kind: 'project', slug: 'phase4-dream' },
        {
          llm: true,
          force: true,
          idleMinutes: 0,
          transport: {
            reflect: () => {
              calls += 1
              return reviewedJson([])
            },
          },
        },
      )
      assert.equal(busy.mode, 'llm')
      if (busy.mode !== 'llm') return
      assert.equal(busy.result.code, 'RESERVATION_LIVE')
      assert.equal(calls, 0)
      assert.equal(getDreamState().reflection.failures[id], undefined)
      assert.equal(getDreamState().reflection.reflectedThroughStep[id], undefined)
      assert.equal(fs.existsSync(receiptFile), false)
      assert.equal(
        releaseReflectionReservation(stateDir, held.reservation.token).status,
        'released',
      )
    })

    withDream((created) => {
      const id = '01010101-0101-4010-8010-010101010101'
      created.push(id)
      seedConversation(id, eligibleTranscript('DEAD'))
      const token = crypto.randomUUID()
      writeReservation(stateDir, reservationDocument(deadPid, token))
      const before = fs.readFileSync(reservationFile)
      let calls = 0
      const dead = runDream(
        { kind: 'project', slug: 'phase4-dream' },
        {
          llm: true,
          force: true,
          idleMinutes: 0,
          transport: {
            reflect: () => {
              calls += 1
              return reviewedJson([])
            },
          },
        },
      )
      assert.equal(dead.mode, 'llm')
      if (dead.mode !== 'llm') return
      assert.equal(dead.result.code, 'RESERVATION_DEAD')
      assert.equal(calls, 0)
      assert.equal(getDreamState().reflection.failures[id], undefined)
      assert.deepEqual(fs.readFileSync(reservationFile), before)
    })

    withDream((created) => {
      const id = '23232323-2323-4232-8232-232323232323'
      created.push(id)
      seedConversation(id, eligibleTranscript('AMBIGUOUS'))
      fs.mkdirSync(stateDir, { recursive: true })
      fs.writeFileSync(reservationFile, '{')
      const before = fs.readFileSync(reservationFile)
      let calls = 0
      const ambiguous = runDream(
        { kind: 'project', slug: 'phase4-dream' },
        {
          llm: true,
          force: true,
          idleMinutes: 0,
          transport: {
            reflect: () => {
              calls += 1
              return reviewedJson([])
            },
          },
        },
      )
      assert.equal(ambiguous.mode, 'llm')
      if (ambiguous.mode !== 'llm') return
      assert.equal(ambiguous.result.code, 'RESERVATION_AMBIGUOUS')
      assert.equal(calls, 0)
      assert.deepEqual(fs.readFileSync(reservationFile), before)
    })

    withDream((created) => {
      const id = '45454545-4545-4454-8454-454545454545'
      created.push(id)
      seedConversation(id, eligibleTranscript('TOKEN'))
      const swapped = crypto.randomUUID()
      const result = runDream(
        { kind: 'project', slug: 'phase4-dream' },
        {
          llm: true,
          force: true,
          idleMinutes: 0,
          transport: {
            reflect: () => {
              writeReservation(stateDir, reservationDocument(process.pid, swapped))
              return reviewedJson([])
            },
          },
        },
      )
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.code, 'RESERVATION_LOST')
      assert.equal(result.result.proposalIds.length, 0)
      const left = JSON.parse(fs.readFileSync(reservationFile, 'utf8')) as { token: string }
      assert.equal(left.token, swapped)
      assert.equal(getDreamState().reflection.failures[id], undefined)
    })
  })

  it('keeps scheduled LLM behind the enabled flag and guards cron installation', () => {
    const preview = previewLlmReflectionCron({
      nodePath: process.execPath,
      scriptPath: 'plugins/agy-memory-layer/scripts/dream-daemon.ts',
    })
    assert.equal(preview.mutatesCrontab, false)
    assert.equal(preview.line.includes('--run-scheduled-llm'), true)
    assert.equal(preview.line.includes('--run-now'), false)
    assert.equal(isLlmDreamCronLine(preview.line), true)
    assert.equal(isRegexDreamCronLine(preview.line), false)
    const previewCode = runDreamMaintenanceCommand(
      { kind: 'llm-cron-preview' },
      {
        cron: explodingCron(),
        nodePath: process.execPath,
        scriptPath: 'plugins/agy-memory-layer/scripts/dream-daemon.ts',
        log: () => undefined,
        error: () => undefined,
      },
    )
    assert.equal(previewCode, 0)

    for (const args of [
      ['--install-cron', '--llm'],
      ['--uninstall-cron', '--llm'],
      ['--preview-llm-cron', '--llm'],
      ['--install-llm-cron', '--llm'],
    ]) {
      assert.equal(planDreamCli(args).kind, 'refuse')
    }
    const refused = runDreamMaintenanceCommand(
      { kind: 'llm-cron-install', confirmation: 'wrong' },
      {
        cron: explodingCron(),
        nodePath: process.execPath,
        scriptPath: 'plugins/agy-memory-layer/scripts/dream-daemon.ts',
        log: () => undefined,
        error: () => undefined,
      },
    )
    assert.equal(refused, 1)
    const missing = installLlmReflectionCron({
      enabled: true,
      executor: explodingCron(),
      nodePath: process.execPath,
      scriptPath: 'dream-daemon.ts',
    })
    assert.equal(missing.code, 'CONFIRMATION_MISSING')
    const mismatched = installLlmReflectionCron({
      enabled: true,
      confirmation: 'wrong',
      confirm: () => true,
      executor: explodingCron(),
      nodePath: process.execPath,
      scriptPath: 'dream-daemon.ts',
    })
    assert.equal(mismatched.code, 'CONFIRMATION_MISMATCH')
    const disabled = installLlmReflectionCron({
      enabled: false,
      confirmation: LLM_CRON_INSTALL_CONFIRMATION,
      executor: explodingCron(),
      nodePath: process.execPath,
      scriptPath: 'dream-daemon.ts',
    })
    assert.equal(disabled.code, 'DISABLED')

    const recorded = recordingCron('# keep\n')
    const regex = installRegexDreamCron(recorded.executor, process.execPath, 'dream-daemon.ts')
    assert.equal(regex.status, 'installed')
    assert.equal(isRegexDreamCronLine(regex.line), true)
    assert.equal(regex.line.includes('--llm'), false)
    const installed = installLlmReflectionCron({
      enabled: true,
      confirm: () => true,
      executor: recorded.executor,
      nodePath: process.execPath,
      scriptPath: 'dream-daemon.ts',
    })
    assert.equal(installed.code, 'INSTALLED')
    assert.equal(recorded.text().includes('--run-now'), true)
    assert.equal(recorded.text().includes('--run-scheduled-llm'), true)
    uninstallRegexDreamCron(recorded.executor)
    assert.equal(recorded.text().includes('--run-now'), false)
    assert.equal(recorded.text().includes('--run-scheduled-llm'), true)
    assert.equal(recorded.text().includes('# keep'), true)

    withDream((created) => {
      const id = '67676767-6767-4676-8676-676767676767'
      created.push(id)
      seedConversation(id, eligibleTranscript('SCHEDULE'))
      let calls = 0
      const transport = {
        reflect: () => {
          calls += 1
          return reviewedJson([])
        },
      }
      const off = runScheduledReflection(
        { kind: 'project', slug: 'phase4-dream' },
        { transport, force: true, idleMinutes: 0 },
      )
      assert.equal(off.mode, 'llm')
      if (off.mode !== 'llm') return
      assert.equal(off.result.code, 'SKIPPED_DISABLED')
      assert.equal(calls, 0)
      const state = getDreamState()
      state.reflection.enabled = true
      saveDreamState(state)
      const manual = runDream(
        { kind: 'project', slug: 'phase4-dream' },
        { llm: true, force: true, idleMinutes: 0, transport },
      )
      assert.equal(manual.mode, 'llm')
      if (manual.mode !== 'llm') return
      assert.equal(manual.result.status, 'advanced')
      assert.equal(calls, 1)
    })
  })

  it('preserves concurrent regex state and refuses to rewind the same conversation cursor', () => {
    withDream((created) => {
      const id = 'abababab-abab-4aba-8aba-ababababab01'
      created.push(id)
      seedConversation(id, eligibleTranscript('PRESERVE'))
      const preserved = runDream(
        { kind: 'project', slug: 'phase4-dream' },
        {
          llm: true,
          force: true,
          idleMinutes: 0,
          beforeOwnedReflectionWrite: () => {
            const latest = getDreamState()
            latest.lastRun = 'regex-preserved'
            latest.lastDreamedSteps[otherConversationId] = 6
            latest.lastRunByProject['phase4-dream'] = 'regex-project'
            latest.reflection.enabled = true
            latest.reflection.failures[otherConversationId] = {
              count: 2,
              lastAt: '2026-09-27T00:00:00.000Z',
              code: 'TIMEOUT',
            }
            saveDreamState(latest)
          },
          transport: { reflect: () => reviewedJson([]) },
        },
      )
      assert.equal(preserved.mode, 'llm')
      if (preserved.mode !== 'llm') return
      assert.equal(preserved.result.status, 'advanced')
      assert.equal(
        getDreamState().reflection.reflectedThroughStep[id],
        DEFAULT_REFLECTION_STEP_COUNT,
      )
      assert.equal(getDreamState().lastRun, 'regex-preserved')
      assert.equal(getDreamState().lastDreamedSteps[otherConversationId], 6)
      assert.equal(getDreamState().lastRunByProject['phase4-dream'], 'regex-project')
      assert.equal(getDreamState().reflection.enabled, true)
      assert.equal(getDreamState().reflection.failures[otherConversationId]?.count, 2)
      assert.equal(getDreamState().reflection.failures[id], undefined)
    })

    withDream((created) => {
      const id = 'abababab-abab-4aba-8aba-ababababab02'
      created.push(id)
      seedConversation(id, eligibleTranscript('NO_REWIND'))
      const moved = runDream(
        { kind: 'project', slug: 'phase4-dream' },
        {
          llm: true,
          force: true,
          idleMinutes: 0,
          beforeOwnedReflectionWrite: () => {
            const latest = getDreamState()
            latest.lastRun = 'kept-run'
            latest.reflection.reflectedThroughStep[id] = 80
            saveDreamState(latest)
          },
          transport: { reflect: () => reviewedJson([]) },
        },
      )
      assert.equal(moved.mode, 'llm')
      if (moved.mode !== 'llm') return
      assert.equal(moved.result.code, 'CURSOR_MOVED')
      assert.equal(getDreamState().reflection.reflectedThroughStep[id], 80)
      assert.equal(getDreamState().lastRun, 'kept-run')
      assert.equal(moved.result.proposalIds.length, 0)
    })

    withDream((created) => {
      const id = 'abababab-abab-4aba-8aba-ababababab03'
      created.push(id)
      seedConversation(id, eligibleTranscript('FAILURE_RACE'))
      let calls = 0
      const failed = runDream(
        { kind: 'project', slug: 'phase4-dream' },
        {
          llm: true,
          force: true,
          idleMinutes: 0,
          beforeOwnedReflectionWrite: () => {
            const latest = getDreamState()
            latest.lastRun = 'newer-run'
            latest.lastDreamedSteps[otherConversationId] = 9
            latest.reflection.enabled = true
            latest.reflection.reflectedThroughStep[id] = 64
            saveDreamState(latest)
          },
          transport: {
            reflect: () => {
              calls += 1
              throw new ReflectionTransportError('TIMEOUT', 'timed out')
            },
          },
        },
      )
      assert.equal(failed.mode, 'llm')
      if (failed.mode !== 'llm') return
      assert.equal(calls, 1)
      assert.equal(failed.result.code, 'TIMEOUT')
      assert.equal(getDreamState().reflection.reflectedThroughStep[id], 64)
      assert.equal(getDreamState().reflection.failures[id], undefined)
      assert.equal(getDreamState().lastRun, 'newer-run')
      assert.equal(getDreamState().lastDreamedSteps[otherConversationId], 9)
      assert.equal(getDreamState().reflection.enabled, true)
    })
  })

  it('rejects a stale whole-state save after reflection finalizes its cursor', () => {
    withDream((created) => {
      const id = 'abababab-abab-4aba-8aba-ababababab04'
      created.push(id)
      seedConversation(id, eligibleTranscript('STALE_STATE'))
      const stale = getDreamState()
      const advanced = runEligible({ reflect: () => reviewedJson([]) })
      assert.equal(advanced.mode, 'llm')
      if (advanced.mode !== 'llm') return
      assert.equal(advanced.result.code, 'NO_OP')
      stale.lastRun = 'stale-regex-save'
      assert.throws(() => saveDreamState(stale), /Dream state changed after it was read/)
      const current = getDreamState()
      assert.equal(current.reflection.reflectedThroughStep[id], DEFAULT_REFLECTION_STEP_COUNT)
      assert.notEqual(current.lastRun, 'stale-regex-save')
      assert.equal(current.stateRevision > stale.stateRevision, true)
    })
  })

  it('refuses regex recovery when a present state revision is invalid', () => {
    withDream((created) => {
      const id = 'abababab-abab-4aba-8aba-ababababab06'
      created.push(id)
      seedConversation(id, eligibleTranscript('INVALID_REVISION'))
      const advanced = runEligible({ reflect: () => reviewedJson([]) })
      assert.equal(advanced.mode, 'llm')
      if (advanced.mode !== 'llm') return
      assert.equal(advanced.result.code, 'NO_OP')
      const head = gitHead()
      const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
        stateRevision: unknown
        reflection: { reflectedThroughStep: Record<string, number> }
      }
      assert.equal(raw.reflection.reflectedThroughStep[id], DEFAULT_REFLECTION_STEP_COUNT)
      const validState = getDreamState()
      const corruptBackupsBefore = fs
        .readdirSync(stateDir)
        .filter((name) => name.startsWith('dream-state.json.corrupt-'))
      raw.stateRevision = 'invalid'
      fs.writeFileSync(stateFile, `${JSON.stringify(raw, null, 2)}\n`)
      assert.throws(() => getDreamState(), /stateRevision must be a non-negative safe integer/)
      assert.throws(
        () => saveDreamState(validState),
        /stateRevision must be a non-negative safe integer/,
      )
      assert.throws(
        () => runDream({ kind: 'project', slug: 'phase4-dream' }, { force: true }),
        /stateRevision must be a non-negative safe integer/,
      )
      const after = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
        stateRevision: unknown
        reflection: { reflectedThroughStep: Record<string, number> }
      }
      assert.equal(after.stateRevision, 'invalid')
      assert.equal(after.reflection.reflectedThroughStep[id], DEFAULT_REFLECTION_STEP_COUNT)
      assert.equal(gitHead(), head)
      assert.deepEqual(
        fs.readdirSync(stateDir).filter((name) => name.startsWith('dream-state.json.corrupt-')),
        corruptBackupsBefore,
      )
    })
  })

  it('migrates a legacy missing state revision from zero on the next guarded save', () => {
    withDream(() => {
      const current = getDreamState()
      const { stateRevision: _stateRevision, ...legacy } = current
      fs.writeFileSync(stateFile, `${JSON.stringify(legacy, null, 2)}\n`)
      const loaded = getDreamState()
      assert.equal(loaded.stateRevision, 0)
      loaded.lastRun = '2026-09-27T00:00:00.000Z'
      saveDreamState(loaded)
      const migrated = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
        stateRevision: number
        lastRun: string
      }
      assert.equal(migrated.stateRevision, 1)
      assert.equal(migrated.lastRun, '2026-09-27T00:00:00.000Z')
    })
  })

  it('keeps finalized proposals and cursor when the durable receipt write fails', () => {
    withDream((created) => {
      const id = 'abababab-abab-4aba-8aba-ababababab05'
      created.push(id)
      seedConversation(id, eligibleTranscript('RECEIPT_FAIL'))
      const persona = fs.readFileSync(path.join(MEMORY_ROOT, 'global', 'persona.md'), 'utf8')
      const result = runDream(
        { kind: 'project', slug: 'phase4-dream' },
        {
          llm: true,
          force: true,
          idleMinutes: 0,
          beforePersistReceipt: (receipt) => {
            if (receipt.outcome === 'ADVANCED') throw new Error('receipt disk full')
          },
          transport: {
            reflect: () =>
              reviewedJson([
                {
                  op: 'write',
                  path: 'global/persona.md',
                  description: 'Append one receipt-failure proof line.',
                  body: `${persona.trimEnd()}\n- Receipt failure proof.\n`,
                },
              ]),
          },
        },
      )
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.status, 'advanced')
      assert.equal(result.result.code, 'ADVANCED_RECEIPT_FAILED')
      assert.equal(dreamLlmExitCode(result.result), 1)
      assert.equal(result.result.proposalIds.length, 1)
      assert.equal(
        getDreamState().reflection.reflectedThroughStep[id],
        DEFAULT_REFLECTION_STEP_COUNT,
      )
      assert.equal(
        listPendingProposals().some((proposal) => proposal.id === result.result.proposalIds[0]),
        true,
      )
      assert.equal(fs.existsSync(reservationFile), true)
    })
  })

  it('does not let a stale release or second reclaim delete a replacement reservation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-reflection-replacement-'))
    const acquired = acquireReflectionReservation(root, conversationId)
    assert.equal(acquired.status, 'acquired')
    if (acquired.status !== 'acquired') return
    const replacementToken = crypto.randomUUID()
    const released = releaseReflectionReservation(root, acquired.reservation.token, {
      beforeReservationUnlink: () => {
        fs.writeFileSync(
          reflectionReservationPath(root),
          `${JSON.stringify(reservationDocument(process.pid, replacementToken))}\n`,
        )
      },
    })
    assert.equal(released.status, 'mismatch')
    const left = JSON.parse(fs.readFileSync(reflectionReservationPath(root), 'utf8')) as {
      token: string
    }
    assert.equal(left.token, replacementToken)
    assert.equal(releaseReflectionReservation(root, acquired.reservation.token).status, 'mismatch')
    assert.equal(
      (JSON.parse(fs.readFileSync(reflectionReservationPath(root), 'utf8')) as { token: string })
        .token,
      replacementToken,
    )

    const deadPid = await exitedPid()
    const deadToken = crypto.randomUUID()
    writeReservation(root, reservationDocument(deadPid, deadToken))
    const replaced = crypto.randomUUID()
    const reclaimed = reclaimDeadReflectionReservation(root, deadToken, {
      beforeReservationUnlink: () => {
        fs.writeFileSync(
          reflectionReservationPath(root),
          `${JSON.stringify(reservationDocument(process.pid, replaced))}\n`,
        )
      },
    })
    assert.equal(reclaimed.status, 'mismatch')
    assert.equal(
      (JSON.parse(fs.readFileSync(reflectionReservationPath(root), 'utf8')) as { token: string })
        .token,
      replaced,
    )
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('serializes reclaim on the writer lock and leaves a replacement in place', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-reflection-reclaim-lock-'))
    const deadPid = await exitedPid()
    const deadToken = crypto.randomUUID()
    const file = writeReservation(root, reservationDocument(deadPid, deadToken))
    const before = fs.readFileSync(file)
    const moduleUrl = pathToFileURL(
      path.resolve(
        import.meta.dirname,
        '../plugins/agy-memory-layer/scripts/dream-reflection-reservation.ts',
      ),
    ).href
    const script = path.join(root, 'reclaim.ts')
    fs.writeFileSync(
      script,
      `import { reclaimDeadReflectionReservation } from ${JSON.stringify(moduleUrl)}\nconst result = reclaimDeadReflectionReservation(process.argv[2], process.argv[3])\nprocess.stdout.write(JSON.stringify(result))\n`,
    )
    const runChild = (): { status: string } =>
      JSON.parse(
        execFileSync(process.execPath, ['--experimental-strip-types', script, root, deadToken], {
          encoding: 'utf8',
        }),
      ) as { status: string }

    const held = acquireMemoryWriteLockAtStateRoot(root, 'phase4 holder')
    try {
      const blocked = runChild()
      assert.equal(blocked.status, 'lock-contention')
      assert.deepEqual(fs.readFileSync(file), before)
    } finally {
      releaseMemoryWriteLock(held)
    }
    assert.equal(runChild().status, 'reclaimed')
    assert.equal(fs.existsSync(file), false)
    const replacement = acquireReflectionReservation(root, otherConversationId)
    assert.equal(replacement.status, 'acquired')
    if (replacement.status !== 'acquired') return
    assert.equal(runChild().status, 'mismatch')
    const surviving = JSON.parse(fs.readFileSync(reflectionReservationPath(root), 'utf8')) as {
      token: string
    }
    assert.equal(surviving.token, replacement.reservation.token)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('treats writer-lock contention as infrastructure failure and does not retry the provider', () => {
    withDream((created) => {
      const id = 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbc01'
      created.push(id)
      seedConversation(id, eligibleTranscript('LOCK_BEFORE'))
      let calls = 0
      const held = acquireMemoryWriteLock(MEMORY_ROOT, 'phase4 contender')
      try {
        const blocked = runDream(
          { kind: 'project', slug: 'phase4-dream' },
          {
            llm: true,
            force: true,
            idleMinutes: 0,
            transport: {
              reflect: () => {
                calls += 1
                return reviewedJson([])
              },
            },
          },
        )
        assert.equal(blocked.mode, 'llm')
        if (blocked.mode !== 'llm') return
        assert.equal(blocked.result.code, 'LOCK_CONTENTION')
        assert.equal(calls, 0)
        assert.equal(getDreamState().reflection.failures[id], undefined)
        assert.equal(fs.existsSync(reservationFile), false)
      } finally {
        releaseMemoryWriteLock(held)
      }
    })

    withDream((created) => {
      const id = 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbc02'
      created.push(id)
      seedConversation(id, eligibleTranscript('LOCK_AFTER'))
      let calls = 0
      let held: ReturnType<typeof acquireMemoryWriteLock> | null = null
      try {
        const blocked = runDream(
          { kind: 'project', slug: 'phase4-dream' },
          {
            llm: true,
            force: true,
            idleMinutes: 0,
            transport: {
              reflect: () => {
                calls += 1
                held = acquireMemoryWriteLock(MEMORY_ROOT, 'phase4 finalizer')
                return reviewedJson([])
              },
            },
          },
        )
        assert.equal(blocked.mode, 'llm')
        if (blocked.mode !== 'llm') return
        assert.equal(calls, 1)
        assert.equal(blocked.result.code, 'LOCK_CONTENTION')
        assert.equal(getDreamState().reflection.failures[id], undefined)
        assert.equal(getDreamState().reflection.reflectedThroughStep[id], undefined)
        assert.equal(fs.existsSync(reservationFile), true)
        const reservation = JSON.parse(fs.readFileSync(reservationFile, 'utf8')) as {
          conversationId: string
        }
        assert.equal(reservation.conversationId, id)
      } finally {
        if (held) releaseMemoryWriteLock(held)
      }
    })
  })

  it('reports reservation release contention and leaves the reservation inspectable', () => {
    withDream((created) => {
      const id = 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbc03'
      created.push(id)
      seedConversation(id, eligibleTranscript('RELEASE_LOCK'))
      let calls = 0
      let held: ReturnType<typeof acquireMemoryWriteLock> | null = null
      try {
        const result = runDream(
          { kind: 'project', slug: 'phase4-dream' },
          {
            llm: true,
            force: true,
            idleMinutes: 0,
            beforeReleaseReservation: () => {
              held = acquireMemoryWriteLock(MEMORY_ROOT, 'phase4 release contender')
            },
            transport: {
              reflect: () => {
                calls += 1
                return reviewedJson([])
              },
            },
          },
        )
        assert.equal(result.mode, 'llm')
        if (result.mode !== 'llm') return
        assert.equal(calls, 1)
        assert.equal(result.result.status, 'advanced')
        assert.equal(result.result.code, 'RESERVATION_RELEASE_FAILED')
        assert.equal(dreamLlmExitCode(result.result), 1)
        assert.equal(
          getDreamState().reflection.reflectedThroughStep[id],
          DEFAULT_REFLECTION_STEP_COUNT,
        )
        assert.equal(getDreamState().reflection.failures[id], undefined)
        assert.equal(fs.existsSync(reservationFile), true)
      } finally {
        if (held) releaseMemoryWriteLock(held)
      }
    })
  })

  it('reports schedule state without inspecting crontab and quotes the all-projects command', () => {
    const status = inspectDreamReflectionStatus({ kind: 'project', slug: 'phase4-dream' })
    assert.equal(status.schedule, 'not-inspected')
    assert.equal(typeof status.enabled, 'boolean')
    assert.equal(liveCronInvocationCount(), 0)
    const nodePath = "/tmp/node's bin/node"
    const scriptPath = '/tmp/My Scripts/dream-daemon.ts'
    const preview = previewLlmReflectionCron({ nodePath, scriptPath })
    assert.equal(preview.mutatesCrontab, false)
    assert.equal(preview.command.includes(shellQuote(nodePath)), true)
    assert.equal(preview.command.includes(shellQuote(scriptPath)), true)
    assert.equal(preview.command.includes('--run-scheduled-llm --all-projects'), true)
    assert.equal(preview.line.includes('--run-now'), false)
    assert.equal(isLlmDreamCronLine(preview.line), true)
    assert.equal(isRegexDreamCronLine(preview.line), false)
    const regex = installRegexDreamCron(
      { read: () => '', write: () => undefined },
      nodePath,
      scriptPath,
    )
    assert.equal(regex.line.includes('--all-projects'), false)
    assert.equal(regex.line.includes(shellQuote(nodePath)), true)
    assert.equal(regex.line.includes('--run-now'), true)

    const writes: string[] = []
    const refused = installLlmReflectionCron({
      enabled: true,
      confirmation: LLM_CRON_INSTALL_CONFIRMATION,
      executor: {
        read: () => {
          throw new Error('permission denied')
        },
        write: (crontab: string) => {
          writes.push(crontab)
        },
      },
      nodePath,
      scriptPath,
    })
    assert.equal(refused.code, 'CRON_READ_FAILED')
    assert.equal(writes.length, 0)
    const regexWrites: string[] = []
    const regexRefused = installRegexDreamCron(
      {
        read: () => {
          throw new Error('permission denied')
        },
        write: (crontab: string) => {
          regexWrites.push(crontab)
        },
      },
      nodePath,
      scriptPath,
    )
    assert.equal(regexRefused.status, 'refused')
    assert.equal(regexWrites.length, 0)
    assert.equal(
      interpretCrontabListFailure(
        Object.assign(new Error('crontab: no crontab for mahiro'), {
          status: 1,
          stderr: 'crontab: no crontab for mahiro\n',
        }),
      ),
      'absent',
    )
    assert.equal(
      interpretCrontabListFailure(
        Object.assign(new Error('permission denied'), { status: 1, stderr: 'permission denied\n' }),
      ),
      'failed',
    )
    assert.equal(
      interpretCrontabListFailure(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      'failed',
    )
    assert.equal(planDreamCli(['--not-a-command']).kind, 'refuse')
    assert.equal(planDreamCli(['--status', '--force']).kind, 'refuse')
    assert.equal(planDreamCli(['--run-scheduled-llm', '--all-projects']).kind, 'scheduled-llm-run')
    assert.equal(planDreamCli([]).kind, 'status')
    withDream(() => {
      const state = getDreamState()
      state.reflection.enabled = true
      saveDreamState(state)
      const logs: string[] = []
      const recorded = recordingCron('')
      const code = runDreamMaintenanceCommand(
        { kind: 'llm-cron-install', confirmation: LLM_CRON_INSTALL_CONFIRMATION },
        {
          cron: recorded.executor,
          nodePath: process.execPath,
          scriptPath: 'dream-daemon.ts',
          log: (line) => logs.push(line),
          error: (line) => logs.push(line),
        },
      )
      assert.equal(code, 0)
      assert.equal(
        logs.some((line) => line.includes('installed') && line.includes('eligible')),
        true,
      )
      assert.equal(
        logs.some((line) => line.toLowerCase().includes('inactive')),
        false,
      )
      assert.equal(recorded.text().includes('--run-scheduled-llm --all-projects'), true)
      assert.equal(liveCronInvocationCount(), 0)
    })
  })

  it('keeps Dream tests on a disposable HOME and state root and does not invoke live cron', () => {
    assert.equal(liveCronInvocationCount(), 0)
    assert.equal(process.argv[1]?.endsWith('dream-daemon.ts'), false)
    assert.equal(process.env.HOME, TEST_ENVIRONMENT.homeDir)
    assert.equal(process.env.AGY_MEMORY_STATE_DIR, TEST_STATE_ROOT)
    assert.equal(stateDir, TEST_STATE_ROOT)
    assert.equal(TEST_STATE_ROOT.startsWith(os.tmpdir()), true)
    assert.equal(TEST_ENVIRONMENT.homeDir.startsWith(os.tmpdir()), true)
    assert.notEqual(TEST_ENVIRONMENT.homeDir, TEST_ORIGINAL_HOME)
  })

  it('overrides an inherited AGY_MEMORY_STATE_DIR with the disposable state root', () => {
    const sentinel = path.join(os.tmpdir(), 'agy-inherited-state-root-must-not-survive')
    const script = `
      import { TEST_STATE_ROOT } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, 'test-environment.ts')).href)}
      if (process.env.AGY_MEMORY_STATE_DIR !== TEST_STATE_ROOT) process.exit(2)
      if (process.env.AGY_MEMORY_STATE_DIR === ${JSON.stringify(sentinel)}) process.exit(3)
      if (!String(process.env.AGY_MEMORY_STATE_DIR).startsWith(${JSON.stringify(os.tmpdir())})) process.exit(4)
      process.stdout.write(String(process.env.AGY_MEMORY_STATE_DIR))
    `
    const output = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', script],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: { ...process.env, AGY_MEMORY_STATE_DIR: sentinel },
      },
    )
    assert.equal(output.includes(sentinel), false)
    assert.equal(output.startsWith(os.tmpdir()), true)
  })
})
