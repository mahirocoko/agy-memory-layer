import * as assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import {
  AGY_HOST_ISOLATION,
  AGY_REFLECTION_CHILD_ENV,
  type AgyCommandRequest,
  type AgyCommandResult,
  buildAgyModelProbeArgs,
  createAgyReflectionTransport,
  createFakeReflectionTransport,
  PRIMARY_REFLECTION_MODEL,
  parseAgyModelProbeEnvelope,
  parseAgyReflectionEnvelope,
  REFLECTION_MAX_DURATION_SECONDS,
  REFLECTION_MAX_TURNS,
  REFLECTION_MAX_USAGE_TOKENS,
  ReflectionTransportError,
  type ReflectionTransportRequest,
  reflectionResponseJsonSchema,
} from '../plugins/agy-memory-layer/scripts/dream-reflection-transport.ts'
import { TEST_ENVIRONMENT, TEST_MEMORY_ROOT, TEST_TEMP_ROOT } from './test-environment.ts'

const MEMORY_ROOT = TEST_MEMORY_ROOT
const stateDir = `${MEMORY_ROOT}.state`
const stateFile = path.join(stateDir, 'dream-state.json')
const reservationFile = path.join(stateDir, 'reflection-reservation.json')
const receiptFile = path.join(stateDir, 'reflection-receipt.json')
const pendingDir = path.join(stateDir, 'pending-approvals')
const historyFile = path.join(
  TEST_ENVIRONMENT.homeDir,
  '.gemini',
  'antigravity-cli',
  'history.jsonl',
)
const brainRoot = path.join(TEST_ENVIRONMENT.homeDir, '.gemini', 'antigravity-cli', 'brain')

const {
  DEFAULT_REFLECTION_MODEL,
  DEFAULT_REFLECTION_STEP_COUNT,
  getDreamState,
  inspectDreamReflectionStatus,
  printStatus,
  REFLECTION_BASE_BACKOFF_MINUTES,
  REFLECTION_MAX_BACKOFF_MINUTES,
  REFLECTION_MEMORY_BUDGET_CAP,
  REFLECTION_TRANSCRIPT_BUDGET_CAP,
  reflectionBackoffMinutes,
  runDream,
  saveDreamState,
} = await import('../plugins/agy-memory-layer/scripts/dream-daemon.ts')
const {
  createExplicitProposalSet,
  getApprovalModeForFile,
  listPendingProposals,
  MemoryProposalSetError,
  proposeMemoryUpdate,
  reviewProposal,
} = await import('../plugins/agy-memory-layer/scripts/memory-approval.ts')
const { commitMemoryPaths, deleteMemoryFile, readCommittedMemoryFile, writeMemoryFile } =
  await import('../plugins/agy-memory-layer/scripts/memory-repository.ts')

const gitHead = (): string =>
  execFileSync('git', ['-C', MEMORY_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

const withIsolatedDream = (run: (createdConversations: string[]) => void): void => {
  const head = gitHead()
  const stateBackup = fs.existsSync(stateFile) ? fs.readFileSync(stateFile) : null
  const reservationBackup = fs.existsSync(reservationFile) ? fs.readFileSync(reservationFile) : null
  const receiptBackup = fs.existsSync(receiptFile) ? fs.readFileSync(receiptFile) : null
  const historyBackup = fs.existsSync(historyFile) ? fs.readFileSync(historyFile) : null
  const pendingBefore = new Set(fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir) : [])
  const createdConversations: string[] = []
  try {
    run(createdConversations)
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
    for (const conversationId of createdConversations) {
      fs.rmSync(path.join(brainRoot, conversationId), { recursive: true, force: true })
    }
    if (fs.existsSync(pendingDir)) {
      for (const file of fs.readdirSync(pendingDir)) {
        if (!pendingBefore.has(file)) fs.rmSync(path.join(pendingDir, file), { force: true })
      }
    }
  }
}

const writeHistory = (entries: { id: string; workspace: string; timestamp: number }[]): void => {
  fs.mkdirSync(path.dirname(historyFile), { recursive: true })
  fs.writeFileSync(
    historyFile,
    entries
      .map((entry) =>
        JSON.stringify({
          conversationId: entry.id,
          timestamp: entry.timestamp,
          workspace: entry.workspace,
        }),
      )
      .join('\n'),
  )
}

const writeConversation = (conversationId: string, lines: string[], mtimeMs?: number): void => {
  const logDir = path.join(brainRoot, conversationId, '.system_generated', 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, 'transcript.jsonl')
  fs.writeFileSync(logPath, `${lines.join('\n')}\n`)
  if (mtimeMs !== undefined) {
    const seconds = mtimeMs / 1000
    fs.utimesSync(logPath, seconds, seconds)
  }
}

const writeRawConversation = (conversationId: string, content: string): string => {
  const logDir = path.join(brainRoot, conversationId, '.system_generated', 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, 'transcript.jsonl')
  fs.writeFileSync(logPath, content)
  return logPath
}

const userLine = (content: string): string =>
  JSON.stringify({ type: 'USER_INPUT', content: `<USER_REQUEST>${content}</USER_REQUEST>` })

const eligibleTranscript = (lines: readonly string[], label = 'ELIGIBLE_FILLER'): string[] => {
  if (lines.length >= DEFAULT_REFLECTION_STEP_COUNT) return [...lines]
  const fillers = Array.from({ length: DEFAULT_REFLECTION_STEP_COUNT - lines.length }, (_, index) =>
    userLine(`${label}_${index}`),
  )
  return [...lines, ...fillers]
}

const initProject = (slug: string): void => {
  const relativePath = `projects/${slug}/project.md`
  writeMemoryFile(MEMORY_ROOT, relativePath, `# ${slug}\n- Keep this project note.\n`)
  commitMemoryPaths({
    memoryRoot: MEMORY_ROOT,
    relativePaths: [relativePath],
    reason: `test: init ${slug}`,
  })
}

const workspaceFor = (slug: string): string => {
  const workspace = path.join(TEST_TEMP_ROOT, slug)
  fs.mkdirSync(workspace, { recursive: true })
  return workspace
}

const reviewedJson = (operations: unknown[]): string =>
  JSON.stringify({ summary: 'reviewed slice', operations })

const REFLECTION_SCHEMA = reflectionResponseJsonSchema(8)

const usage = {
  input_tokens: 0,
  output_tokens: 0,
  thinking_tokens: 0,
  cache_read_tokens: 0,
  total_tokens: 0,
}

const modelProbeEnvelope = (
  model: string = PRIMARY_REFLECTION_MODEL,
  responseModel: string = model,
): string =>
  JSON.stringify({
    conversation_id: '',
    status: 'SUCCESS',
    response: `${responseModel}\tClaude Opus 4.6 (Thinking)\n`,
    duration_seconds: 0,
    num_turns: 0,
    usage,
    command: {
      name: 'model',
      data: { id: model, label: 'Claude Opus 4.6 (Thinking)', is_default: false },
    },
  })

const reflectionEnvelope = (
  structuredOutput: unknown,
  extra: Record<string, unknown> = {},
  jsonSchema: string = REFLECTION_SCHEMA,
): string => {
  const normalizedStructuredOutput =
    typeof structuredOutput === 'string' ? JSON.parse(structuredOutput) : structuredOutput
  return JSON.stringify({
    conversation_id: '12121212-1212-4212-8212-121212121212',
    status: 'SUCCESS',
    response: JSON.stringify(normalizedStructuredOutput),
    duration_seconds: 1.25,
    num_turns: 1,
    structured_output: normalizedStructuredOutput,
    json_schema: JSON.parse(jsonSchema),
    usage,
    ...extra,
  })
}

const duplicateStructuredEnvelope = (jsonSchema: string = REFLECTION_SCHEMA): string => {
  const envelope = reflectionEnvelope(reviewedJson([]), {}, jsonSchema)
  const marker = '"structured_output":{"summary":"reviewed slice",'
  assert.equal(envelope.includes(marker), true)
  return envelope.replace(
    marker,
    '"structured_output":{"summary":"ambiguous duplicate","summary":"reviewed slice",',
  )
}

const layeredDocument = (description: string, body: string): string =>
  `---\ndescription: ${description}\n---\n${body}\n`

const codePointLength = (value: string): number => [...value].length

const appendLine = (body: string, line: string): string => `${body.trimEnd()}\n${line}\n`

const cursorFor = (conversationId: string): number | undefined =>
  getDreamState().reflection.reflectedThroughStep[conversationId]

const commandResult = (stdout: string, status = 0): AgyCommandResult => ({
  status,
  stdout,
  stderr: '',
  timedOut: false,
  truncated: false,
})

describe('dream v2 phase 2 reflection', () => {
  it('keeps regex Dream as the default and does not call transport', () => {
    withIsolatedDream((created) => {
      const slug = 'llm-regex-gap'
      const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      writeConversation(conversationId, [
        userLine('Please remember this: always use pnpm for this project.'),
      ])
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const transport = createFakeReflectionTransport(() => {
        throw new Error('regex Dream must not call the reflection transport')
      })
      const head = gitHead()

      const llm = runDream(
        { kind: 'current' },
        { llm: true, force: true, transport, workspaceDir: workspace, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(llm.mode, 'llm')
      if (llm.mode !== 'llm') return
      assert.equal(llm.result.code, 'SKIPPED_UNINITIALIZED')
      assert.equal(transport.calls.length, 0)
      assert.equal(cursorFor(conversationId), undefined)
      assert.equal(getDreamState().lastDreamedSteps[conversationId], undefined)

      const regex = runDream(
        { kind: 'current' },
        { transport, workspaceDir: workspace, force: true, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(regex.mode, 'regex')
      assert.equal(transport.calls.length, 0)
      assert.equal(getDreamState().lastDreamedSteps[conversationId], 1)
      assert.equal(cursorFor(conversationId), undefined)
      assert.notEqual(gitHead(), head)
    })
  })

  it('dispatches one explicit llm slice and advances the reflection cursor', () => {
    withIsolatedDream((created) => {
      const slug = 'llm-ready'
      const conversationId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      const headLines = [
        userLine('SLICE_LINE_ONE'),
        userLine('SLICE_LINE_TWO'),
        userLine('SLICE_LINE_THREE'),
        userLine('SLICE_LINE_FOUR'),
      ]
      const almost = [
        ...headLines,
        ...Array.from({ length: 45 }, (_, index) => userLine(`SLICE_ALMOST_${index}`)),
      ]
      writeConversation(conversationId, almost)
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const head = gitHead()
      const persona = readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md')
      assert.ok(persona)
      const transport = createFakeReflectionTransport(() =>
        reviewedJson([
          {
            op: 'write',
            path: 'global/persona.md',
            description: 'Append one reviewed line.',
            body: appendLine(persona, 'Reviewed line.'),
          },
        ]),
      )

      const below = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(below.mode, 'llm')
      if (below.mode !== 'llm') return
      assert.equal(almost.length, 49)
      assert.equal(below.result.code, 'SKIPPED_NO_SLICE')
      assert.equal(transport.calls.length, 0)
      assert.equal(cursorFor(conversationId), undefined)

      const lines = [
        ...headLines,
        ...Array.from({ length: 48 }, (_, index) => userLine(`SLICE_FILLER_${index}`)),
      ]
      writeConversation(conversationId, lines)
      const state = getDreamState()
      state.reflection.reflectedThroughStep[conversationId] = 2
      saveDreamState(state)
      const dispatched = runDream(
        { kind: 'project', slug },
        { llm: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(dispatched.mode, 'llm')
      if (dispatched.mode !== 'llm') return
      assert.equal(lines.length - 2, DEFAULT_REFLECTION_STEP_COUNT)
      assert.equal(dispatched.result.status, 'advanced')
      assert.equal(dispatched.result.code, 'ADVANCED')
      assert.equal(transport.calls.length, 1)
      assert.equal(transport.calls[0]?.model, PRIMARY_REFLECTION_MODEL)
      const prompt = transport.calls[0]?.prompt ?? ''
      assert.equal(prompt.includes('SLICE_LINE_THREE'), true)
      assert.equal(prompt.includes('SLICE_LINE_FOUR'), true)
      assert.equal(prompt.includes('SLICE_LINE_ONE'), false)
      assert.equal(cursorFor(conversationId), lines.length)
      assert.equal(getDreamState().lastDreamedSteps[conversationId], undefined)
      assert.equal(gitHead(), head)
      assert.equal(dispatched.result.proposalIds.length, 1)
      const proposalId = dispatched.result.proposalIds[0]
      assert.ok(proposalId)

      const rejected = reviewProposal(proposalId, 'reject')
      assert.equal(rejected.decision, 'reject')
      assert.equal(cursorFor(conversationId), lines.length)
      assert.equal(readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md'), persona)

      const replay = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(replay.mode, 'llm')
      if (replay.mode !== 'llm') return
      assert.equal(replay.result.code, 'SKIPPED_NO_SLICE')
      assert.equal(transport.calls.length, 1)
      assert.equal(gitHead(), head)
    })
  })

  it('accepts the current Agy structured envelope through the proposal boundary', () => {
    withIsolatedDream((created) => {
      const slug = 'llm-structured-envelope'
      const conversationId = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(
        conversationId,
        eligibleTranscript([userLine('Remember one exact synthetic preference.')], 'STRUCTURED'),
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const persona = readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md')
      assert.ok(persona)
      const head = gitHead()
      const reflected = reviewedJson([
        {
          op: 'write',
          path: 'global/persona.md',
          description: 'Append one structured-envelope line.',
          body: appendLine(persona, 'Structured envelope line.'),
        },
      ])
      const transport = createAgyReflectionTransport({
        run: (request) => {
          if (request.args[0] === '--version') return commandResult('1.2.12\n')
          if (request.args[0] === 'models') {
            return commandResult(
              'Fetching available models...\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n',
            )
          }
          if (request.args.at(-1) === '/model') return commandResult(modelProbeEnvelope())
          const schemaIndex = request.args.indexOf('--json-schema')
          const schema = request.args[schemaIndex + 1]
          assert.ok(schema)
          return commandResult(
            reflectionEnvelope(
              reflected,
              { response: 'Current Agy display response is non-authoritative.' },
              schema,
            ),
          )
        },
      })

      const result = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.code, 'ADVANCED')
      assert.equal(result.result.proposalIds.length, 1)
      assert.equal(cursorFor(conversationId), DEFAULT_REFLECTION_STEP_COUNT)
      assert.equal(gitHead(), head)
      const proposalId = result.result.proposalIds[0]
      assert.ok(proposalId)
      assert.equal(reviewProposal(proposalId, 'reject').decision, 'reject')
    })
  })

  it('rejects duplicate structured-output keys before proposal or cursor advancement', () => {
    withIsolatedDream((created) => {
      const slug = 'llm-duplicate-structured-envelope'
      const conversationId = 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(
        conversationId,
        eligibleTranscript([userLine('Synthetic duplicate-key guard.')], 'DUPLICATE'),
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const head = gitHead()
      const pendingBefore = listPendingProposals().map((proposal) => proposal.id)
      const transport = createAgyReflectionTransport({
        run: (request) => {
          if (request.args[0] === '--version') return commandResult('1.2.12\n')
          if (request.args[0] === 'models') {
            return commandResult(
              'Fetching available models...\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n',
            )
          }
          if (request.args.at(-1) === '/model') return commandResult(modelProbeEnvelope())
          const schemaIndex = request.args.indexOf('--json-schema')
          const schema = request.args[schemaIndex + 1]
          assert.ok(schema)
          return commandResult(duplicateStructuredEnvelope(schema))
        },
      })

      const result = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.status, 'failed')
      assert.equal(result.result.code, 'ENVELOPE_INVALID')
      assert.equal(result.result.proposalIds.length, 0)
      assert.equal(cursorFor(conversationId), undefined)
      assert.deepEqual(
        listPendingProposals().map((proposal) => proposal.id),
        pendingBefore,
      )
      assert.equal(gitHead(), head)
    })
  })

  it('advances the reflection cursor on a valid no-op and records delete as curation only', () => {
    withIsolatedDream((created) => {
      const slug = 'llm-noop'
      const conversationId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(
        conversationId,
        eligibleTranscript([userLine('No durable write in this slice.')], 'NOOP'),
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const persona = readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md')
      const head = gitHead()
      const transport = createFakeReflectionTransport(() =>
        reviewedJson([
          {
            op: 'delete',
            path: 'global/persona.md',
            description: 'Suggest curation later.',
          },
        ]),
      )

      const result = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.status, 'advanced')
      assert.equal(result.result.code, 'NO_OP')
      assert.deepEqual(result.result.proposalIds, [])
      assert.deepEqual(result.result.curationRequired, [
        { path: 'global/persona.md', description: 'Suggest curation later.' },
      ])
      assert.equal(cursorFor(conversationId), DEFAULT_REFLECTION_STEP_COUNT)
      assert.equal(readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md'), persona)
      assert.equal(gitHead(), head)
      assert.equal(
        listPendingProposals().some((proposal) => proposal.targetRelPath === 'global/persona.md'),
        false,
      )
    })
  })

  it('leaves the reflection cursor unchanged when transport or planning fails', () => {
    withIsolatedDream((created) => {
      const slug = 'llm-fail'
      const workspace = workspaceFor(slug)
      initProject(slug)
      const cases: {
        id: string
        respond: (request: ReflectionTransportRequest) => string
        code: string
      }[] = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          code: 'MODEL_UNAVAILABLE',
          respond: () => {
            throw new ReflectionTransportError('MODEL_UNAVAILABLE', 'catalog missing exact model')
          },
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          code: 'TIMEOUT',
          respond: () => {
            throw new ReflectionTransportError('TIMEOUT', 'reflection timed out')
          },
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          code: 'MALFORMED',
          respond: () => 'not json',
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          code: 'SCHEMA',
          respond: () => JSON.stringify({ summary: 'extra', operations: [], extra: true }),
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          code: 'PATH',
          respond: () =>
            reviewedJson([
              {
                op: 'write',
                path: 'archives/projects/llm-fail/learnings/note.md',
                description: 'Archive is not an active owner.',
                body: 'nope\n',
              },
            ]),
        },
      ]

      for (const entry of cases) {
        created.push(entry.id)
        writeConversation(
          entry.id,
          eligibleTranscript([userLine(`failure ${entry.code}`)], entry.code),
        )
      }
      for (const [index, entry] of cases.entries()) {
        writeHistory([{ id: entry.id, workspace, timestamp: index + 1 }])
        const transport = createFakeReflectionTransport(entry.respond)
        const result = runDream(
          { kind: 'project', slug },
          { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
        )
        assert.equal(result.mode, 'llm')
        if (result.mode !== 'llm') continue
        assert.equal(result.result.status, 'failed')
        assert.equal(result.result.code, entry.code)
        assert.equal(result.result.conversationId, entry.id)
        assert.equal(cursorFor(entry.id), undefined)
        assert.equal(getDreamState().lastDreamedSteps[entry.id], undefined)
      }
    })
  })

  it('rejects a MemFS HEAD race before creating proposals or advancing the cursor', () => {
    withIsolatedDream((created) => {
      const slug = 'llm-race'
      const conversationId = '66666666-6666-4666-8666-666666666666'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(
        conversationId,
        eligibleTranscript([userLine('Race during transport.')], 'RACE'),
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const head = gitHead()
      const transport = createFakeReflectionTransport(() => {
        const relativePath = `projects/${slug}/rules.md`
        writeMemoryFile(MEMORY_ROOT, relativePath, '# Rules\n- Changed during transport.\n')
        commitMemoryPaths({
          memoryRoot: MEMORY_ROOT,
          relativePaths: [relativePath],
          reason: 'test: race MemFS HEAD during reflection',
        })
        return reviewedJson([])
      })

      const result = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.code, 'HEAD_RACE')
      assert.equal(cursorFor(conversationId), undefined)
      assert.deepEqual(result.result.proposalIds, [])
      assert.notEqual(gitHead(), head)
    })
  })

  it('skips uninitialized projects for both current-project and cross-project llm runs', () => {
    withIsolatedDream((created) => {
      const readySlug = 'llm-cross-ready'
      const bareSlug = 'llm-cross-bare'
      const readyId = '77777777-7777-4777-8777-777777777777'
      const bareId = '88888888-8888-4888-8888-888888888888'
      const currentId = '99999999-9999-4999-8999-999999999999'
      const readyWorkspace = workspaceFor(readySlug)
      const bareWorkspace = workspaceFor(bareSlug)
      const currentWorkspace = workspaceFor('llm-current-gap')
      created.push(readyId, bareId, currentId)
      initProject(readySlug)
      writeConversation(
        readyId,
        eligibleTranscript([userLine('Initialized project slice.')], 'READY'),
        1_000,
      )
      writeConversation(bareId, [userLine('Uninitialized newer slice.')], 9_000)
      writeConversation(currentId, [
        userLine('Please remember this: always use pnpm for the current gap.'),
      ])
      writeHistory([
        { id: readyId, workspace: readyWorkspace, timestamp: 1 },
        { id: bareId, workspace: bareWorkspace, timestamp: 2 },
        { id: currentId, workspace: currentWorkspace, timestamp: 3 },
      ])
      const transport = createFakeReflectionTransport(() => reviewedJson([]))

      const current = runDream(
        { kind: 'current' },
        {
          llm: true,
          force: true,
          transport,
          workspaceDir: currentWorkspace,
          minSteps: 1,
          idleMinutes: 0,
        },
      )
      assert.equal(current.mode, 'llm')
      if (current.mode !== 'llm') return
      assert.equal(current.result.code, 'SKIPPED_UNINITIALIZED')
      assert.equal(transport.calls.length, 0)

      const cross = runDream(
        { kind: 'all-projects' },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(cross.mode, 'llm')
      if (cross.mode !== 'llm') return
      assert.equal(cross.result.status, 'advanced')
      assert.equal(cross.result.conversationId, readyId)
      assert.equal(cross.result.projectSlug, readySlug)
      assert.equal(transport.calls.length, 1)
      assert.equal(transport.calls[0]?.prompt.includes(readyId), true)
      assert.equal(transport.calls[0]?.prompt.includes(bareId), false)
      assert.equal(cursorFor(readyId), DEFAULT_REFLECTION_STEP_COUNT)
      assert.equal(cursorFor(bareId), undefined)
      assert.equal(cursorFor(currentId), undefined)
    })
  })

  it('forces an explicit proposal for an auto-approved path and does not commit MemFS', () => {
    withIsolatedDream(() => {
      const relativePath = 'projects/explicit-override/learnings/note.md'
      assert.equal(getApprovalModeForFile(relativePath), 'auto')
      const head = gitHead()
      const result = proposeMemoryUpdate(relativePath, 'Remember the explicit Dream override.\n', {
        requireExplicit: true,
        reason: 'dream reflection',
      })
      assert.equal(result.status, 'PENDING_APPROVAL')
      assert.equal(gitHead(), head)
      assert.equal(readCommittedMemoryFile(MEMORY_ROOT, relativePath), null)
      assert.equal(
        listPendingProposals().some((proposal) => proposal.id === result.proposalId),
        true,
      )
    })
  })

  it('prevalidates a proposal set and cleans up a partial set without deleting unrelated proposals', () => {
    withIsolatedDream((created) => {
      const slug = 'llm-cleanup'
      const conversationId = 'abababab-abab-4bab-8bab-abababababab'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(
        conversationId,
        eligibleTranscript([userLine('Two writes, second persist fails.')], 'CLEANUP'),
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const head = gitHead()
      const human = readCommittedMemoryFile(MEMORY_ROOT, 'global/human.md')
      const persona = readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md')
      assert.ok(human && persona)
      const unrelated = proposeMemoryUpdate(
        'projects/llm-unrelated/project.md',
        '# Unrelated\n- Keep this pending proposal.\n',
        { reason: 'unrelated' },
      )
      assert.equal(unrelated.status, 'PENDING_APPROVAL')
      assert.ok(unrelated.proposalId)

      assert.throws(
        () =>
          createExplicitProposalSet([
            {
              targetRelPath: 'projects/explicit-override/learnings/one.md',
              newContent: 'first\n',
            },
            { targetRelPath: '../escape.md', newContent: 'second\n' },
          ]),
        /unsafe segment|must be relative/,
      )
      assert.equal(
        listPendingProposals().some((proposal) => proposal.targetRelPath.endsWith('/one.md')),
        false,
      )
      assert.equal(
        listPendingProposals().some((proposal) => proposal.id === unrelated.proposalId),
        true,
      )

      const transport = createFakeReflectionTransport(() =>
        reviewedJson([
          {
            op: 'write',
            path: 'global/human.md',
            description: 'Append a human line.',
            body: appendLine(human, 'Human reviewed line.'),
          },
          {
            op: 'write',
            path: 'global/persona.md',
            description: 'Append a persona line.',
            body: appendLine(persona, 'Persona reviewed line.'),
          },
        ]),
      )
      const failed = runDream(
        { kind: 'project', slug },
        {
          llm: true,
          force: true,
          transport,
          minSteps: 1,
          idleMinutes: 0,
          beforePersistProposal: (index) => {
            if (index === 1) throw new Error('proposal disk failed')
          },
        },
      )
      assert.equal(failed.mode, 'llm')
      if (failed.mode !== 'llm') return
      assert.equal(failed.result.code, 'PROPOSAL_FAILED')
      assert.match(failed.result.message, /proposal disk failed/)
      assert.equal(cursorFor(conversationId), undefined)
      assert.equal(gitHead(), head)
      assert.equal(readCommittedMemoryFile(MEMORY_ROOT, 'global/human.md'), human)
      assert.equal(readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md'), persona)
      const pending = listPendingProposals()
      assert.equal(
        pending.some((proposal) => proposal.id === unrelated.proposalId),
        true,
      )
      assert.equal(
        pending.some((proposal) => proposal.reason === 'Append a human line.'),
        false,
      )
      assert.equal(
        pending.some((proposal) => proposal.reason === 'Append a persona line.'),
        false,
      )
    })
  })

  it('refuses unavailable or drifted models and parses only the current Agy envelope', () => {
    const calls: AgyCommandRequest[] = []
    const geminiCatalog = commandResult(
      'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n',
    )
    const unavailable = createAgyReflectionTransport({
      fallbackModel: null,
      run: (request) => {
        calls.push(request)
        if (request.args[0] === '--version') return commandResult('1.2.12\n')
        if (request.args[0] === 'models') return geminiCatalog
        throw new Error('print must not run when the exact model is absent')
      },
    })
    assert.equal(unavailable.hostIsolation, AGY_HOST_ISOLATION)
    assert.throws(
      () =>
        unavailable.reflect({
          prompt: 'reflect',
          model: PRIMARY_REFLECTION_MODEL,
          jsonSchema: '{}',
        }),
      (error: unknown) => {
        assert.ok(error instanceof ReflectionTransportError)
        assert.equal(error.code, 'MODEL_UNAVAILABLE')
        assert.match(error.message, /not a substitute/)
        return true
      },
    )
    assert.deepEqual(
      calls.map((call) => call.args[0]),
      ['--version', 'models'],
    )
    assert.equal(
      calls.some((call) => call.args.includes('gemini-3.8-flash-high')),
      false,
    )

    const fallbackCalls: AgyCommandRequest[] = []
    const withFallback = createAgyReflectionTransport({
      fallbackModel: 'gemini-3.8-flash-high',
      run: (request) => {
        fallbackCalls.push(request)
        return commandResult('1.2.12\n')
      },
    })
    assert.throws(
      () =>
        withFallback.reflect({
          prompt: 'reflect',
          model: PRIMARY_REFLECTION_MODEL,
          jsonSchema: '{}',
        }),
      (error: unknown) =>
        error instanceof ReflectionTransportError && error.code === 'FALLBACK_REFUSED',
    )
    assert.equal(fallbackCalls.length, 0)

    const liveCalls: AgyCommandRequest[] = []
    const listed = createAgyReflectionTransport({
      run: (request) => {
        liveCalls.push(request)
        if (request.args[0] === '--version') return commandResult('1.2.12\n')
        if (request.args[0] === 'models') {
          return commandResult(
            'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n',
          )
        }
        if (request.args.at(-1) === '/model') return commandResult(modelProbeEnvelope())
        return commandResult(reflectionEnvelope(reviewedJson([])))
      },
    })
    assert.equal(
      listed.reflect({
        prompt: 'bounded prompt',
        model: PRIMARY_REFLECTION_MODEL,
        jsonSchema: REFLECTION_SCHEMA,
      }),
      reviewedJson([]),
    )
    const modelProbeCall = liveCalls.find((call) => call.args.at(-1) === '/model')
    assert.ok(modelProbeCall)
    assert.deepEqual(modelProbeCall.args, buildAgyModelProbeArgs(PRIMARY_REFLECTION_MODEL))
    const printCall = liveCalls.find((call) => call.args.at(-1) === 'bounded prompt')
    assert.ok(printCall)
    assert.equal(printCall.env[AGY_REFLECTION_CHILD_ENV], '1')
    assert.equal(printCall.args[printCall.args.indexOf('--model') + 1], PRIMARY_REFLECTION_MODEL)
    assert.equal(printCall.args[printCall.args.indexOf('--mode') + 1], 'plan')
    assert.equal(printCall.args.includes('--sandbox'), true)
    assert.equal(printCall.args.includes('--disable-slash-commands'), true)
    assert.equal(printCall.args[printCall.args.indexOf('--output-format') + 1], 'json')
    assert.equal(printCall.args[printCall.args.indexOf('--print-timeout') + 1], '120s')
    assert.equal(printCall.args.at(-2), '--print')
    assert.equal(printCall.args.at(-1), 'bounded prompt')
    assert.equal(DEFAULT_REFLECTION_STEP_COUNT, 50)

    const driftCalls: AgyCommandRequest[] = []
    const drifted = createAgyReflectionTransport({
      run: (request) => {
        driftCalls.push(request)
        if (request.args[0] === '--version') return commandResult('1.2.12\n')
        if (request.args[0] === 'models') {
          return commandResult(
            'Fetching available models...\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n',
          )
        }
        return commandResult(modelProbeEnvelope('gemini-3.8-flash-high'))
      },
    })
    assert.throws(
      () =>
        drifted.reflect({
          prompt: 'must not dispatch',
          model: PRIMARY_REFLECTION_MODEL,
          jsonSchema: '{}',
        }),
      (error: unknown) => error instanceof ReflectionTransportError && error.code === 'MODEL_DRIFT',
    )
    assert.equal(
      driftCalls.some((call) => call.args.at(-1) === 'must not dispatch'),
      false,
    )
  })

  it('rejects malformed, drifted, denied, and command-style Agy reflection envelopes', () => {
    assert.equal(parseAgyModelProbeEnvelope(modelProbeEnvelope()), PRIMARY_REFLECTION_MODEL)
    assert.equal(
      parseAgyReflectionEnvelope(reflectionEnvelope(reviewedJson([])), REFLECTION_SCHEMA),
      reviewedJson([]),
    )
    assert.equal(
      parseAgyReflectionEnvelope(
        reflectionEnvelope({ summary: 'Object response.', operations: [] }),
        REFLECTION_SCHEMA,
      ),
      JSON.stringify({ summary: 'Object response.', operations: [] }),
    )
    assert.equal(
      parseAgyReflectionEnvelope(
        reflectionEnvelope(reviewedJson([]), {
          response: 'Non-authoritative Agy display response.',
        }),
        REFLECTION_SCHEMA,
      ),
      reviewedJson([]),
    )
    assert.equal(
      parseAgyReflectionEnvelope(
        reflectionEnvelope(reviewedJson([]), {
          duration_seconds: REFLECTION_MAX_DURATION_SECONDS,
          num_turns: REFLECTION_MAX_TURNS,
          usage: {
            input_tokens: REFLECTION_MAX_USAGE_TOKENS,
            output_tokens: REFLECTION_MAX_USAGE_TOKENS,
            thinking_tokens: REFLECTION_MAX_USAGE_TOKENS,
            cache_read_tokens: REFLECTION_MAX_USAGE_TOKENS,
            total_tokens: REFLECTION_MAX_USAGE_TOKENS,
          },
        }),
        REFLECTION_SCHEMA,
      ),
      reviewedJson([]),
    )
    assert.throws(
      () =>
        parseAgyModelProbeEnvelope(
          modelProbeEnvelope(PRIMARY_REFLECTION_MODEL, 'gemini-3.8-flash-high'),
        ),
      (error: unknown) => error instanceof ReflectionTransportError && error.code === 'MODEL_DRIFT',
    )

    const invalid: { stdout: string; code: string }[] = [
      { stdout: reviewedJson([]), code: 'ENVELOPE_INVALID' },
      {
        stdout: reflectionEnvelope(reviewedJson([]), { status: 'FAILED' }),
        code: 'ENVELOPE_INVALID',
      },
      {
        stdout: reflectionEnvelope(reviewedJson([]), { conversation_id: '' }),
        code: 'ENVELOPE_INVALID',
      },
      { stdout: reflectionEnvelope(reviewedJson([]), { num_turns: 0 }), code: 'ENVELOPE_INVALID' },
      {
        stdout: reflectionEnvelope(reviewedJson([]), { num_turns: 1e100 }),
        code: 'ENVELOPE_INVALID',
      },
      {
        stdout: reflectionEnvelope(reviewedJson([]), {
          duration_seconds: REFLECTION_MAX_DURATION_SECONDS + 1,
        }),
        code: 'ENVELOPE_INVALID',
      },
      {
        stdout: reflectionEnvelope(reviewedJson([]), {
          usage: { ...usage, input_tokens: 1e100 },
        }),
        code: 'ENVELOPE_INVALID',
      },
      {
        stdout: reflectionEnvelope(reviewedJson([]), { structured_output: 42 }),
        code: 'ENVELOPE_INVALID',
      },
      {
        stdout: reflectionEnvelope(reviewedJson([]), { json_schema: { type: 'array' } }),
        code: 'ENVELOPE_INVALID',
      },
      {
        stdout: reflectionEnvelope(reviewedJson([]), { response: '' }),
        code: 'ENVELOPE_INVALID',
      },
      {
        stdout: duplicateStructuredEnvelope(),
        code: 'ENVELOPE_INVALID',
      },
      {
        stdout: reflectionEnvelope(reviewedJson([]), { denied_actions: [{ tool: 'view_file' }] }),
        code: 'HOST_ACTION_DENIED',
      },
      {
        stdout: reflectionEnvelope(reviewedJson([]), { command: { name: 'model' } }),
        code: 'ENVELOPE_INVALID',
      },
    ]
    for (const entry of invalid) {
      assert.throws(
        () => parseAgyReflectionEnvelope(entry.stdout, REFLECTION_SCHEMA),
        (error: unknown) => error instanceof ReflectionTransportError && error.code === entry.code,
      )
    }
  })

  it('refuses llm reflection from a process marked as a reflection child', () => {
    const previous = process.env[AGY_REFLECTION_CHILD_ENV]
    process.env[AGY_REFLECTION_CHILD_ENV] = '1'
    try {
      const transport = createFakeReflectionTransport(() => reviewedJson([]))
      const result = runDream({ kind: 'current' }, { llm: true, force: true, transport })
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.code, 'RECURSIVE_CHILD')
      assert.equal(transport.calls.length, 0)
    } finally {
      if (previous === undefined) delete process.env[AGY_REFLECTION_CHILD_ENV]
      else process.env[AGY_REFLECTION_CHILD_ENV] = previous
    }
  })

  it('fails closed on layered/legacy conflict and omits reference bodies from a layered snapshot', () => {
    withIsolatedDream((created) => {
      const conflictSlug = 'llm-conflict'
      const conflictId = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc'
      const conflictWorkspace = workspaceFor(conflictSlug)
      created.push(conflictId)
      initProject(conflictSlug)
      writeMemoryFile(
        MEMORY_ROOT,
        'system/overlap.md',
        layeredDocument('Overlap', 'LAYERED_OVERLAP_BODY'),
      )
      commitMemoryPaths({
        memoryRoot: MEMORY_ROOT,
        relativePaths: [`projects/${conflictSlug}/project.md`, 'system/overlap.md'],
        reason: 'test: overlap layered and legacy memory',
      })
      writeConversation(
        conflictId,
        eligibleTranscript([userLine('Conflict must not reflect.')], 'CONFLICT'),
      )
      writeHistory([{ id: conflictId, workspace: conflictWorkspace, timestamp: 1 }])
      const conflictTransport = createFakeReflectionTransport(() => reviewedJson([]))
      const conflict = runDream(
        { kind: 'project', slug: conflictSlug },
        { llm: true, force: true, transport: conflictTransport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(conflict.mode, 'llm')
      if (conflict.mode !== 'llm') return
      assert.equal(conflict.result.code, 'SNAPSHOT_CONFLICT')
      assert.equal(conflictTransport.calls.length, 0)
      assert.equal(cursorFor(conflictId), undefined)
    })

    withIsolatedDream((created) => {
      const slug = 'llm-layered'
      const conversationId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      deleteMemoryFile(MEMORY_ROOT, 'global/human.md')
      deleteMemoryFile(MEMORY_ROOT, 'global/persona.md')
      const paths = [
        'global/human.md',
        'global/persona.md',
        'system/active.md',
        'reference/secret.md',
        `projects/${slug}/system/note.md`,
        `projects/${slug}/reference/secret.md`,
      ]
      writeMemoryFile(
        MEMORY_ROOT,
        'system/active.md',
        layeredDocument('Active global system', 'GLOBAL_SYSTEM_BODY_MARKER'),
      )
      writeMemoryFile(
        MEMORY_ROOT,
        'reference/secret.md',
        layeredDocument('Hidden reference', 'GLOBAL_REFERENCE_BODY_MARKER'),
      )
      writeMemoryFile(
        MEMORY_ROOT,
        `projects/${slug}/system/note.md`,
        layeredDocument('Active project system', 'PROJECT_SYSTEM_BODY_MARKER'),
      )
      writeMemoryFile(
        MEMORY_ROOT,
        `projects/${slug}/reference/secret.md`,
        layeredDocument('Hidden project reference', 'PROJECT_REFERENCE_BODY_MARKER'),
      )
      commitMemoryPaths({
        memoryRoot: MEMORY_ROOT,
        relativePaths: paths,
        reason: 'test: layered snapshot without legacy overlap',
      })
      const activePath = 'system/active.md'
      const rawActive = readCommittedMemoryFile(MEMORY_ROOT, activePath)
      assert.ok(rawActive)
      assert.equal(rawActive.includes('description: Active global system'), true)
      assert.equal(rawActive.includes('GLOBAL_SYSTEM_BODY_MARKER'), true)
      const head = gitHead()
      writeConversation(
        conversationId,
        eligibleTranscript([userLine('Layered snapshot only.')], 'LAYERED'),
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const transport = createFakeReflectionTransport(() =>
        reviewedJson([
          {
            op: 'write',
            path: activePath,
            description: 'Preserve layered frontmatter and append one line.',
            body: appendLine(rawActive, 'LAYERED_FRONTMATTER_WRITE'),
          },
        ]),
      )
      const result = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.status, 'advanced')
      assert.equal(result.result.code, 'ADVANCED')
      assert.equal(result.result.proposalIds.length, 1)
      assert.equal(transport.calls.length, 1)
      const prompt = transport.calls[0]?.prompt ?? ''
      assert.equal(prompt.includes('description: Active global system'), true)
      assert.equal(prompt.includes('description: Active project system'), true)
      assert.equal(prompt.includes('GLOBAL_SYSTEM_BODY_MARKER'), true)
      assert.equal(prompt.includes('PROJECT_SYSTEM_BODY_MARKER'), true)
      assert.equal(prompt.includes('GLOBAL_REFERENCE_BODY_MARKER'), false)
      assert.equal(prompt.includes('PROJECT_REFERENCE_BODY_MARKER'), false)
      assert.equal(prompt.includes('description: Hidden reference'), false)
      assert.equal(prompt.includes('description: Hidden project reference'), false)
      assert.equal(gitHead(), head)
      assert.equal(readCommittedMemoryFile(MEMORY_ROOT, activePath), rawActive)
      const proposalId = result.result.proposalIds[0]
      const proposal = listPendingProposals().find((item) => item.id === proposalId)
      assert.ok(proposal)
      assert.equal(proposal.targetRelPath, activePath)
      assert.equal(proposal.newContent.includes('description: Active global system'), true)
      assert.equal(proposal.newContent.includes('GLOBAL_SYSTEM_BODY_MARKER'), true)
      assert.equal(proposal.newContent.includes('LAYERED_FRONTMATTER_WRITE'), true)
      assert.equal(cursorFor(conversationId), DEFAULT_REFLECTION_STEP_COUNT)
    })
  })

  it('advances only through a budget-fitting transcript prefix and stops on an oversized line', () => {
    withIsolatedDream((created) => {
      const slug = 'llm-prefix'
      const conversationId = 'dededede-dede-4ede-8ede-dededededede'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      const lines = [
        userLine('PREFIX_ONE'),
        userLine('PREFIX_TWO'),
        userLine('PREFIX_THREE'),
        ...Array.from({ length: 49 }, (_, index) => userLine(`PREFIX_FILLER_${index}`)),
      ]
      const budget = codePointLength(`${lines[0]}\n${lines[1]}`)
      writeConversation(conversationId, lines)
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const state = getDreamState()
      state.reflection.transcriptCharacterBudget = budget
      saveDreamState(state)
      assert.equal(getDreamState().reflection.transcriptCharacterBudget, budget)
      const transport = createFakeReflectionTransport(() => reviewedJson([]))

      const first = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(first.mode, 'llm')
      if (first.mode !== 'llm') return
      assert.equal(first.result.status, 'advanced')
      assert.equal(first.result.capturedThroughStep, 2)
      assert.equal(cursorFor(conversationId), 2)
      const firstPrompt = transport.calls[0]?.prompt ?? ''
      assert.equal(firstPrompt.includes('PREFIX_ONE'), true)
      assert.equal(firstPrompt.includes('PREFIX_TWO'), true)
      assert.equal(firstPrompt.includes('PREFIX_THREE'), false)
      assert.equal(firstPrompt.includes('truncated transcript evidence'), false)

      const tightened = getDreamState()
      tightened.reflection.transcriptCharacterBudget = codePointLength(lines[2] ?? '')
      saveDreamState(tightened)
      const second = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(second.mode, 'llm')
      if (second.mode !== 'llm') return
      assert.equal(second.result.capturedThroughStep, 3)
      assert.equal(cursorFor(conversationId), 3)
      const secondPrompt = transport.calls[1]?.prompt ?? ''
      assert.equal(secondPrompt.includes('PREFIX_THREE'), true)
      assert.equal(secondPrompt.includes('PREFIX_ONE'), false)
    })

    withIsolatedDream((created) => {
      const slug = 'llm-oversize'
      const conversationId = 'efefefef-efef-4fef-8fef-efefefefefef'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      const line = userLine('OVERSIZED_TRANSCRIPT_LINE')
      writeConversation(conversationId, eligibleTranscript([line], 'OVERSIZE'))
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const state = getDreamState()
      state.reflection.transcriptCharacterBudget = codePointLength(line) - 1
      saveDreamState(state)
      const transport = createFakeReflectionTransport(() => reviewedJson([]))
      const result = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.code, 'TRANSCRIPT_OVERFLOW')
      assert.equal(transport.calls.length, 0)
      assert.equal(cursorFor(conversationId), undefined)
    })

    withIsolatedDream((created) => {
      const slug = 'llm-surrogate'
      const conversationId = '34343434-3434-4343-8343-343434343434'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      const line = userLine('SURROGATE_\u{1F600}_BOUNDARY')
      assert.ok(codePointLength(line) < line.length)
      writeConversation(conversationId, eligibleTranscript([line], 'SURROGATE_FILLER'))
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const state = getDreamState()
      state.reflection.transcriptCharacterBudget = codePointLength(line)
      saveDreamState(state)
      const transport = createFakeReflectionTransport(() => reviewedJson([]))
      const result = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.status, 'advanced')
      assert.equal(result.result.capturedThroughStep, 1)
      assert.equal(cursorFor(conversationId), 1)
      const prompt = transport.calls[0]?.prompt ?? ''
      assert.equal(prompt.includes('SURROGATE_'), true)
      assert.equal(prompt.includes('\u{1F600}'), true)
    })
  })

  it('never advances across an unterminated or invalid JSONL step', () => {
    withIsolatedDream((created) => {
      const slug = 'llm-incomplete-jsonl'
      const conversationId = 'acacacac-acac-4cac-8cac-acacacacacac'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      const firstLines = [
        ...Array.from({ length: 49 }, (_, index) => userLine(`JSONL_FIRST_${index}`)),
        userLine('COMPLETE_FIRST_STEP'),
      ]
      const partial = '{"type":"USER_INPUT","content":"INCOMPLETE_SECOND_STEP'
      const logPath = writeRawConversation(
        conversationId,
        `${firstLines.join('\n')}\r\n\n${partial}`,
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const transport = createFakeReflectionTransport(() => reviewedJson([]))

      const first = runDream(
        { kind: 'project', slug },
        { llm: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(first.mode, 'llm')
      if (first.mode !== 'llm') return
      assert.equal(first.result.code, 'NO_OP')
      assert.equal(first.result.capturedThroughStep, DEFAULT_REFLECTION_STEP_COUNT)
      assert.equal(cursorFor(conversationId), DEFAULT_REFLECTION_STEP_COUNT)
      assert.equal(transport.calls.length, 1)
      assert.equal(transport.calls[0]?.prompt.includes('COMPLETE_FIRST_STEP'), true)
      assert.equal(transport.calls[0]?.prompt.includes('INCOMPLETE_SECOND_STEP'), false)

      const secondLines = Array.from({ length: 49 }, (_, index) =>
        userLine(index === 48 ? 'SECOND_SLICE_TAIL' : `JSONL_SECOND_${index}`),
      )
      fs.appendFileSync(logPath, `"}\n${secondLines.join('\n')}\n`)
      const second = runDream(
        { kind: 'project', slug },
        { llm: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(second.mode, 'llm')
      if (second.mode !== 'llm') return
      assert.equal(second.result.code, 'NO_OP')
      assert.equal(second.result.capturedThroughStep, DEFAULT_REFLECTION_STEP_COUNT * 2)
      assert.equal(cursorFor(conversationId), DEFAULT_REFLECTION_STEP_COUNT * 2)
      assert.equal(transport.calls.length, 2)
      assert.equal(transport.calls[1]?.prompt.includes('COMPLETE_FIRST_STEP'), false)
      assert.equal(transport.calls[1]?.prompt.includes('INCOMPLETE_SECOND_STEP'), true)
      assert.equal(transport.calls[1]?.prompt.includes('SECOND_SLICE_TAIL'), true)

      fs.appendFileSync(logPath, 'not-json\n')
      fs.appendFileSync(logPath, `${userLine('VALID_STEP_AFTER_INVALID_RECORD')}\n`)
      const blocked = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(blocked.mode, 'llm')
      if (blocked.mode !== 'llm') return
      assert.equal(blocked.result.code, 'SKIPPED_NO_SLICE')
      assert.equal(cursorFor(conversationId), DEFAULT_REFLECTION_STEP_COUNT * 2)
      assert.equal(transport.calls.length, 2)
    })
  })

  it('rejects out-of-range persisted budgets and treats identical writes as a no-op', () => {
    withIsolatedDream((created) => {
      const slug = 'llm-bounds'
      const conversationId = 'fafafafa-fafa-4afa-8afa-fafafafafafa'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(
        conversationId,
        eligibleTranscript([userLine('Budget and operation cap.')], 'BUDGET'),
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const state = getDreamState()
      state.reflection.maxOperations = 1
      saveDreamState(state)
      const widened = getDreamState()
      widened.reflection.memoryCharacterBudget = REFLECTION_MEMORY_BUDGET_CAP + 1
      widened.reflection.transcriptCharacterBudget = REFLECTION_TRANSCRIPT_BUDGET_CAP + 1
      assert.throws(() => saveDreamState(widened), /memoryCharacterBudget/)
      const loaded = getDreamState()
      assert.equal(loaded.reflection.memoryCharacterBudget, REFLECTION_MEMORY_BUDGET_CAP)
      assert.equal(loaded.reflection.transcriptCharacterBudget, REFLECTION_TRANSCRIPT_BUDGET_CAP)
      assert.equal(loaded.reflection.maxOperations, 1)
      const human = readCommittedMemoryFile(MEMORY_ROOT, 'global/human.md')
      const persona = readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md')
      assert.ok(human && persona)
      const transport = createFakeReflectionTransport(() =>
        reviewedJson([
          {
            op: 'write',
            path: 'global/human.md',
            description: 'Append a human line.',
            body: appendLine(human, 'Human extra.'),
          },
          {
            op: 'write',
            path: 'global/persona.md',
            description: 'Append a persona line.',
            body: appendLine(persona, 'Persona extra.'),
          },
        ]),
      )
      const overflow = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(overflow.mode, 'llm')
      if (overflow.mode !== 'llm') return
      assert.equal(overflow.result.status, 'failed')
      assert.equal(overflow.result.code, 'SCHEMA')
      assert.match(overflow.result.message, /exceeds 1/)
      assert.equal(cursorFor(conversationId), undefined)
      assert.deepEqual(overflow.result.proposalIds, [])
    })

    withIsolatedDream((created) => {
      const slug = 'llm-identical'
      const conversationId = 'abababab-abab-4aba-8aba-ababababab01'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(
        conversationId,
        eligibleTranscript([userLine('Identical write is a no-op.')], 'IDENTICAL'),
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const persona = readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md')
      const human = readCommittedMemoryFile(MEMORY_ROOT, 'global/human.md')
      assert.ok(persona && human)
      const head = gitHead()
      const identicalTransport = createFakeReflectionTransport(() =>
        reviewedJson([
          {
            op: 'write',
            path: 'global/persona.md',
            description: 'Leave persona unchanged.',
            body: persona,
          },
        ]),
      )
      const identical = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport: identicalTransport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(identical.mode, 'llm')
      if (identical.mode !== 'llm') return
      assert.equal(identical.result.code, 'NO_OP')
      assert.equal(identical.result.message.includes('Created 0'), false)
      assert.deepEqual(identical.result.proposalIds, [])
      assert.equal(cursorFor(conversationId), DEFAULT_REFLECTION_STEP_COUNT)
      assert.equal(gitHead(), head)

      const mixedId = 'abababab-abab-4aba-8aba-ababababab02'
      created.push(mixedId)
      writeConversation(
        mixedId,
        eligibleTranscript([userLine('Mixed identical and changed writes.')], 'MIXED'),
      )
      writeHistory([
        { id: conversationId, workspace, timestamp: 1 },
        { id: mixedId, workspace, timestamp: 2 },
      ])
      const mixedTransport = createFakeReflectionTransport(() =>
        reviewedJson([
          {
            op: 'write',
            path: 'global/persona.md',
            description: 'Leave persona unchanged.',
            body: persona,
          },
          {
            op: 'write',
            path: 'global/human.md',
            description: 'Append a human line.',
            body: appendLine(human, 'Human changed.'),
          },
        ]),
      )
      const mixed = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport: mixedTransport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(mixed.mode, 'llm')
      if (mixed.mode !== 'llm') return
      assert.equal(mixed.result.code, 'ADVANCED')
      assert.equal(mixed.result.conversationId, mixedId)
      assert.equal(mixed.result.proposalIds.length, 1)
      assert.match(mixed.result.message, /Created 1 explicit memory proposal/)
      assert.equal(gitHead(), head)
    })
  })

  it('registers the focused reflection test in both package test scripts', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { scripts: { test: string; 'test:coverage': string } }
    assert.equal(manifest.scripts.test.includes('tests/dream-reflection.test.ts'), true)
    assert.equal(manifest.scripts['test:coverage'].includes('tests/dream-reflection.test.ts'), true)
  })

  it('wraps a partial explicit proposal set as a persist failure', () => {
    withIsolatedDream(() => {
      const unrelated = proposeMemoryUpdate(
        'projects/llm-set-unrelated/project.md',
        '# Stay\n- Unrelated proposal.\n',
        { reason: 'stay' },
      )
      assert.ok(unrelated.proposalId)
      assert.throws(
        () =>
          createExplicitProposalSet(
            [
              {
                targetRelPath: 'projects/explicit-override/learnings/a.md',
                newContent: 'alpha\n',
                reason: 'alpha',
              },
              {
                targetRelPath: 'projects/explicit-override/learnings/b.md',
                newContent: 'beta\n',
                reason: 'beta',
              },
            ],
            {
              beforePersist: (_proposal, index) => {
                if (index === 1) throw new Error('second write failed')
              },
            },
          ),
        (error: unknown) => {
          assert.ok(error instanceof MemoryProposalSetError)
          assert.equal(error.code, 'PERSIST_FAILED')
          return true
        },
      )
      const pending = listPendingProposals()
      assert.equal(
        pending.some((proposal) => proposal.id === unrelated.proposalId),
        true,
      )
      assert.equal(
        pending.some((proposal) => proposal.reason === 'alpha' || proposal.reason === 'beta'),
        false,
      )
    })
  })
})

const minuteMs = 60_000
const reflectionNow = (iso: string): number => Date.parse(iso)

const writeReflectionState = (reflection: unknown, extra: Record<string, unknown> = {}): void => {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        lastRun: null,
        stepCountThreshold: 20,
        lastDreamedSteps: {},
        lastRunByProject: {},
        ...extra,
        reflection,
      },
      null,
      2,
    ),
  )
}

const captureLogs = (run: () => void): string => {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '))
  }
  try {
    run()
  } finally {
    console.log = original
  }
  return lines.join('\n')
}

describe('dream v2 phase 3 configuration backoff status and approval', () => {
  it('uses a disposable MemFS root and keeps regex Dream as the default', () => {
    assert.equal(MEMORY_ROOT, path.join(TEST_ENVIRONMENT.homeDir, '.gemini', 'memory'))
    assert.equal(TEST_ENVIRONMENT.homeDir.startsWith(os.tmpdir()), true)
    assert.equal(path.resolve(MEMORY_ROOT).includes(`${path.sep}.gemini${path.sep}memory`), true)

    withIsolatedDream((created) => {
      const slug = 'phase3-regex'
      const conversationId = '13131313-1313-4131-8131-131313131313'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(conversationId, [
        userLine('Please remember this: always use pnpm for phase 3.'),
      ])
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const head = gitHead()
      const transport = createFakeReflectionTransport(() => {
        throw new Error('regex Dream must not call the reflection transport')
      })

      const regex = runDream(
        { kind: 'project', slug },
        { transport, force: true, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(regex.mode, 'regex')
      assert.equal(transport.calls.length, 0)
      assert.equal(cursorFor(conversationId), undefined)
      assert.equal(getDreamState().reflection.enabled, false)
      assert.equal(getDreamState().lastDreamedSteps[conversationId], 1)
      assert.notEqual(gitHead(), head)
    })
  })

  it('treats reflection.enabled as the automatic gate and still accepts a manual override', () => {
    withIsolatedDream((created) => {
      const slug = 'phase3-enabled'
      const manualId = '1c1c1c1c-1c1c-41c1-81c1-1c1c1c1c1c1c'
      const regexId = '1d1d1d1d-1d1d-41d1-81d1-1d1d1d1d1d1d'
      const workspace = workspaceFor(slug)
      created.push(manualId, regexId)
      initProject(slug)
      writeConversation(manualId, [userLine('Manual override while automatic LLM is off.')], 1_000)
      writeConversation(
        regexId,
        eligibleTranscript(
          [userLine('Please remember this: always use pnpm for the enabled flag.')],
          'ENABLED',
        ),
        2_000,
      )
      writeHistory([
        { id: manualId, workspace, timestamp: 1 },
        { id: regexId, workspace, timestamp: 2 },
      ])
      const off = getDreamState()
      off.reflection.enabled = false
      saveDreamState(off)
      const manualTransport = createFakeReflectionTransport(() => reviewedJson([]))
      const manual = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport: manualTransport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(manual.mode, 'llm')
      if (manual.mode !== 'llm') return
      assert.equal(manual.result.code, 'NO_OP')
      assert.equal(manual.result.conversationId, regexId)
      assert.equal(manualTransport.calls.length, 1)
      assert.equal(getDreamState().reflection.enabled, false)

      const on = getDreamState()
      on.reflection.enabled = true
      saveDreamState(on)
      const regexTransport = createFakeReflectionTransport(() => {
        throw new Error('automatic flag must not turn regex Dream into an LLM call')
      })
      const regex = runDream(
        { kind: 'project', slug },
        { transport: regexTransport, force: true, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(regex.mode, 'regex')
      assert.equal(regexTransport.calls.length, 0)
      const statusText = captureLogs(() => printStatus(slug))
      assert.equal(statusText.includes('Automatic/scheduled LLM: on'), true)
      assert.equal(statusText.includes('Manual --run-now --llm: operator override'), true)
      assert.equal(statusText.includes('Schedule installation: not inspected'), true)
      assert.equal(statusText.includes('Config enabled:'), false)
    })
  })

  it('increments backoff only after selection and does not let --force skip a schema failure', () => {
    withIsolatedDream((created) => {
      const slug = 'phase3-force-guard'
      const conversationId = '1e1e1e1e-1e1e-41e1-81e1-1e1e1e1e1e1e'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      const steps = Array.from({ length: 50 }, (_, index) => userLine(`FORCE_STEP_${index}`))
      writeConversation(conversationId, steps)
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const start = reflectionNow('2026-09-27T13:00:00.000Z')
      const state = getDreamState()
      state.reflection.failures[conversationId] = {
        count: 1,
        lastAt: new Date(start).toISOString(),
        code: 'TIMEOUT',
      }
      saveDreamState(state)
      const waiting = createFakeReflectionTransport(() => reviewedJson([]))
      const skipped = runDream(
        { kind: 'project', slug },
        { llm: true, transport: waiting, minSteps: 1, idleMinutes: 0, now: () => start },
      )
      assert.equal(skipped.mode, 'llm')
      if (skipped.mode !== 'llm') return
      assert.equal(skipped.result.code, 'SKIPPED_BACKOFF')
      assert.equal(waiting.calls.length, 0)
      assert.equal(getDreamState().reflection.failures[conversationId]?.count, 1)
      assert.equal(cursorFor(conversationId), undefined)

      const forced = createFakeReflectionTransport(() => '{')
      const failed = runDream(
        { kind: 'project', slug },
        {
          llm: true,
          force: true,
          transport: forced,
          minSteps: 1,
          idleMinutes: 0,
          now: () => start,
        },
      )
      assert.equal(failed.mode, 'llm')
      if (failed.mode !== 'llm') return
      assert.equal(failed.result.status, 'failed')
      assert.equal(failed.result.code, 'MALFORMED')
      assert.equal(forced.calls.length, 1)
      assert.equal(cursorFor(conversationId), undefined)
      assert.equal(getDreamState().reflection.failures[conversationId]?.count, 2)

      const recovered = createFakeReflectionTransport(() => reviewedJson([]))
      const reset = runDream(
        { kind: 'project', slug },
        {
          llm: true,
          force: true,
          transport: recovered,
          minSteps: 1,
          idleMinutes: 0,
          now: () => start,
        },
      )
      assert.equal(reset.mode, 'llm')
      if (reset.mode !== 'llm') return
      assert.equal(reset.result.code, 'NO_OP')
      assert.equal(cursorFor(conversationId), 50)
      assert.equal(getDreamState().reflection.failures[conversationId], undefined)
    })
  })

  it('follows the fixed backoff schedule and caps it at 360 minutes', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((count) => reflectionBackoffMinutes(count)),
      [15, 30, 60, 120, 240, 360, 360, 360],
    )
    assert.equal(REFLECTION_BASE_BACKOFF_MINUTES, 15)
    assert.equal(REFLECTION_MAX_BACKOFF_MINUTES, 360)
  })

  it('persists backoff, skips transport until eligible, and clears it after success', () => {
    withIsolatedDream((created) => {
      const slug = 'phase3-backoff'
      const conversationId = '14141414-1414-4141-8141-141414141414'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      const steps = Array.from({ length: 50 }, (_, index) =>
        userLine(
          index === 0
            ? 'SECRET_FIRST_PROMPT_LINE'
            : index === 49
              ? 'SECRET_TRANSCRIPT_LINE'
              : `VISIBLE_STEP_${index}`,
        ),
      )
      const start = reflectionNow('2026-09-27T10:00:00.000Z')
      writeConversation(conversationId, steps, start)
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const head = gitHead()
      let attempts = 0
      const transport = createFakeReflectionTransport(() => {
        attempts += 1
        if (attempts < 3) throw new ReflectionTransportError('TIMEOUT', 'timed out')
        return reviewedJson([])
      })
      const runAt = (now: number, force = false) =>
        runDream(
          { kind: 'project', slug },
          { llm: true, force, transport, minSteps: 1, idleMinutes: 0, now: () => now },
        )

      const first = runAt(start)
      assert.equal(first.mode, 'llm')
      if (first.mode !== 'llm') return
      assert.equal(first.result.status, 'failed')
      assert.equal(first.result.code, 'TIMEOUT')
      assert.equal(transport.calls.length, 1)
      assert.equal(cursorFor(conversationId), undefined)
      assert.equal(gitHead(), head)
      assert.equal(listPendingProposals().length, 0)
      const stored = getDreamState().reflection.failures[conversationId]
      assert.ok(stored)
      assert.equal(stored.count, 1)
      assert.equal(stored.code, 'TIMEOUT')
      assert.equal(stored.lastAt, new Date(start).toISOString())

      const skipped = runAt(start + 15 * minuteMs - 1)
      assert.equal(skipped.mode, 'llm')
      if (skipped.mode !== 'llm') return
      assert.equal(skipped.result.code, 'SKIPPED_BACKOFF')
      assert.equal(skipped.result.conversationId, conversationId)
      assert.equal(transport.calls.length, 1)
      assert.equal(cursorFor(conversationId), undefined)
      assert.equal(gitHead(), head)
      assert.equal(listPendingProposals().length, 0)

      const second = runAt(start + 15 * minuteMs)
      assert.equal(second.mode, 'llm')
      if (second.mode !== 'llm') return
      assert.equal(second.result.code, 'TIMEOUT')
      assert.equal(transport.calls.length, 2)
      assert.equal(getDreamState().reflection.failures[conversationId]?.count, 2)
      assert.equal(cursorFor(conversationId), undefined)

      const stillWaiting = runAt(start + 45 * minuteMs - 1)
      assert.equal(stillWaiting.mode, 'llm')
      if (stillWaiting.mode !== 'llm') return
      assert.equal(stillWaiting.result.code, 'SKIPPED_BACKOFF')
      assert.equal(transport.calls.length, 2)

      const duringBackoff = inspectDreamReflectionStatus(
        { kind: 'project', slug },
        { now: start + 15 * minuteMs },
      )
      assert.equal(duringBackoff.enabled, false)
      assert.equal(duringBackoff.model, DEFAULT_REFLECTION_MODEL)
      assert.equal(duringBackoff.schedule, 'not-inspected')
      assert.equal(duringBackoff.eligibleConversationCount, 0)
      const blocked = duringBackoff.conversations[0]
      assert.ok(blocked)
      assert.equal(blocked.cursor, 0)
      assert.equal(blocked.lag, 50)
      assert.equal(blocked.consecutiveFailures, 2)
      assert.equal(blocked.latestFailureCode, 'TIMEOUT')
      assert.equal(blocked.latestFailureAt, new Date(start + 15 * minuteMs).toISOString())
      assert.equal(blocked.nextEligibleAt, new Date(start + 45 * minuteMs).toISOString())
      assert.equal(JSON.stringify(duringBackoff).includes('SECRET_TRANSCRIPT_LINE'), false)
      const statusText = captureLogs(() => printStatus(slug))
      assert.equal(statusText.includes('Automatic/scheduled LLM: off'), true)
      assert.equal(statusText.includes('Manual --run-now --llm: operator override'), true)
      assert.equal(statusText.includes('Schedule installation: not inspected'), true)
      assert.equal(statusText.includes('Config enabled:'), false)
      assert.equal(statusText.includes(DEFAULT_REFLECTION_MODEL), true)
      assert.equal(statusText.includes('TIMEOUT'), true)
      assert.equal(statusText.includes(conversationId), true)
      assert.equal(statusText.includes('SECRET_FIRST_PROMPT_LINE'), false)
      assert.equal(statusText.includes('SECRET_TRANSCRIPT_LINE'), false)
      assert.equal(statusText.includes('Keep fixture-backed verification concise.'), false)

      const cleared = runAt(start + 15 * minuteMs + 1, true)
      assert.equal(cleared.mode, 'llm')
      if (cleared.mode !== 'llm') return
      assert.equal(cleared.result.code, 'NO_OP')
      assert.equal(transport.calls.length, 3)
      assert.equal(cursorFor(conversationId), 50)
      assert.equal(getDreamState().reflection.failures[conversationId], undefined)
      assert.equal(gitHead(), head)
    })
  })

  it('does not let one conversation backoff block another eligible conversation', () => {
    withIsolatedDream((created) => {
      const slug = 'phase3-backoff-isolation'
      const blockedId = '15151515-1515-4151-8151-151515151515'
      const readyId = '16161616-1616-4161-8161-161616161616'
      const workspace = workspaceFor(slug)
      created.push(blockedId, readyId)
      initProject(slug)
      const steps = Array.from({ length: 50 }, (_, index) => userLine(`ISOLATED_STEP_${index}`))
      const start = reflectionNow('2026-09-27T11:00:00.000Z')
      writeConversation(blockedId, steps, start)
      writeConversation(readyId, steps, start - minuteMs)
      writeHistory([
        { id: blockedId, workspace, timestamp: 2 },
        { id: readyId, workspace, timestamp: 1 },
      ])
      const state = getDreamState()
      state.reflection.failures[blockedId] = {
        count: 1,
        lastAt: new Date(start).toISOString(),
        code: 'TIMEOUT',
      }
      saveDreamState(state)
      const transport = createFakeReflectionTransport(() => reviewedJson([]))
      const result = runDream(
        { kind: 'project', slug },
        { llm: true, transport, minSteps: 1, idleMinutes: 0, now: () => start },
      )
      assert.equal(result.mode, 'llm')
      if (result.mode !== 'llm') return
      assert.equal(result.result.conversationId, readyId)
      assert.equal(result.result.code, 'NO_OP')
      assert.equal(transport.calls.length, 1)
      assert.equal(cursorFor(readyId), 50)
      assert.equal(cursorFor(blockedId), undefined)
      assert.equal(getDreamState().reflection.failures[blockedId]?.count, 1)
    })
  })

  it('keeps a capped failure ineligible until 360 minutes and does not advance early', () => {
    withIsolatedDream((created) => {
      const slug = 'phase3-cap'
      const conversationId = '1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      const steps = Array.from({ length: 50 }, (_, index) => userLine(`CAP_STEP_${index}`))
      writeConversation(conversationId, steps)
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const start = reflectionNow('2026-09-27T12:00:00.000Z')
      const state = getDreamState()
      state.reflection.failures[conversationId] = {
        count: 8,
        lastAt: new Date(start).toISOString(),
        code: 'TIMEOUT',
      }
      saveDreamState(state)
      const transport = createFakeReflectionTransport(() => reviewedJson([]))
      const early = runDream(
        { kind: 'project', slug },
        {
          llm: true,
          transport,
          minSteps: 1,
          idleMinutes: 0,
          now: () => start + 360 * minuteMs - 1,
        },
      )
      assert.equal(early.mode, 'llm')
      if (early.mode !== 'llm') return
      assert.equal(early.result.code, 'SKIPPED_BACKOFF')
      assert.equal(transport.calls.length, 0)
      assert.equal(cursorFor(conversationId), undefined)
      assert.equal(getDreamState().reflection.failures[conversationId]?.count, 8)

      const ready = runDream(
        { kind: 'project', slug },
        {
          llm: true,
          transport,
          minSteps: 1,
          idleMinutes: 0,
          now: () => start + 360 * minuteMs,
        },
      )
      assert.equal(ready.mode, 'llm')
      if (ready.mode !== 'llm') return
      assert.equal(ready.result.code, 'NO_OP')
      assert.equal(transport.calls.length, 1)
      assert.equal(cursorFor(conversationId), 50)
      assert.equal(getDreamState().reflection.failures[conversationId], undefined)
    })
  })

  it('rejects malformed reflection config and preserves it across regex Dream', () => {
    withIsolatedDream((created) => {
      const slug = 'phase3-config'
      const conversationId = '17171717-1717-4171-8171-171717171717'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(conversationId, [userLine('Please remember this: keep the bad config.')])
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const transport = createFakeReflectionTransport(() => reviewedJson([]))
      const iso = '2026-09-27T00:00:00.000Z'
      const rejected: unknown[] = [
        { enabled: 'yes' },
        { model: 'gemini-3.1-pro' },
        { fallbackModel: 'gemini-3.1-pro' },
        { maxOperations: 9 },
        { memoryCharacterBudget: REFLECTION_MEMORY_BUDGET_CAP + 1 },
        { transcriptCharacterBudget: REFLECTION_TRANSCRIPT_BUDGET_CAP + 1 },
        { stepCountThreshold: DEFAULT_REFLECTION_STEP_COUNT - 1 },
        { baseBackoffMinutes: 1 },
        { maxBackoffMinutes: 1 },
        { autoCommit: true },
        {
          reflectedThroughStep: { [conversationId]: 1 },
          failures: {
            [conversationId]: { count: '4', lastAt: iso, code: 'TIMEOUT' },
          },
        },
      ]
      for (const reflection of rejected) {
        writeReflectionState(reflection)
        const result = runDream(
          { kind: 'project', slug },
          { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
        )
        assert.equal(result.mode, 'llm')
        if (result.mode !== 'llm') return
        assert.equal(result.result.code, 'CONFIG_INVALID')
        assert.equal(transport.calls.length, 0)
        assert.equal(cursorFor(conversationId), undefined)
        assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).reflection, reflection)
      }

      writeReflectionState(
        {
          enabled: false,
          reflectedThroughStep: { [conversationId]: 1 },
          autoCommit: true,
        },
        { lastDreamedSteps: {} },
      )
      const regex = runDream(
        { kind: 'project', slug },
        { transport, force: true, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(regex.mode, 'regex')
      assert.equal(transport.calls.length, 0)
      const preserved = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
        lastDreamedSteps: Record<string, number>
        reflection: { autoCommit?: boolean; reflectedThroughStep?: Record<string, number> }
      }
      assert.equal(preserved.lastDreamedSteps[conversationId], 1)
      assert.equal(preserved.reflection.autoCommit, true)
      assert.equal(preserved.reflection.reflectedThroughStep?.[conversationId], 1)

      writeReflectionState(undefined, {
        lastRun: iso,
        lastDreamedSteps: { [conversationId]: 4 },
        lastRunByProject: { [slug]: iso },
      })
      const migrated = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { reflection?: unknown }
      delete migrated.reflection
      fs.writeFileSync(stateFile, JSON.stringify(migrated))
      const loaded = getDreamState()
      assert.equal(loaded.reflection.enabled, false)
      assert.equal(loaded.reflection.model, DEFAULT_REFLECTION_MODEL)
      assert.equal(loaded.reflection.fallbackModel, null)
      assert.deepEqual(loaded.reflection.failures, {})
      assert.deepEqual(loaded.reflection.reflectedThroughStep, {})
      assert.equal(loaded.lastDreamedSteps[conversationId], 4)
      assert.equal(loaded.stepCountThreshold, 20)
    })
  })

  it('approves one explicit proposal into disposable MemFS and keeps rejection from rewriting the slice', () => {
    withIsolatedDream((created) => {
      const slug = 'phase3-approve'
      const conversationId = '18181818-1818-4181-8181-181818181818'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(
        conversationId,
        eligibleTranscript([userLine('Approve this reviewed line.')], 'APPROVE'),
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const persona = readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md')
      assert.ok(persona)
      const head = gitHead()
      const start = Date.parse('2026-09-27T14:00:00.000Z')
      const seeded = getDreamState()
      seeded.reflection.failures[conversationId] = {
        count: 2,
        lastAt: new Date(start).toISOString(),
        code: 'TIMEOUT',
      }
      saveDreamState(seeded)
      const transport = createFakeReflectionTransport(() =>
        reviewedJson([
          {
            op: 'write',
            path: 'global/persona.md',
            description: 'Append one approved line.',
            body: appendLine(persona, 'Approved dream line.'),
          },
        ]),
      )
      const createdRun = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0, now: () => start },
      )
      assert.equal(createdRun.mode, 'llm')
      if (createdRun.mode !== 'llm') return
      assert.equal(createdRun.result.code, 'ADVANCED')
      assert.equal(createdRun.result.proposalIds.length, 1)
      assert.equal(getDreamState().reflection.failures[conversationId], undefined)
      assert.equal(gitHead(), head)
      assert.equal(readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md'), persona)
      const proposalId = createdRun.result.proposalIds[0]
      assert.ok(proposalId)
      const proposal = listPendingProposals().find((item) => item.id === proposalId)
      assert.ok(proposal)
      assert.equal(proposal.author, 'Dream v2 reflection')
      assert.equal(proposal.targetRelPath, 'global/persona.md')
      const pendingReport = inspectDreamReflectionStatus({ kind: 'project', slug })
      assert.equal(pendingReport.pendingProposalCount, 1)
      assert.equal(pendingReport.conversations[0]?.cursor, DEFAULT_REFLECTION_STEP_COUNT)
      assert.equal(pendingReport.conversations[0]?.lag, 0)
      assert.equal(JSON.stringify(pendingReport).includes('Approved dream line.'), false)

      const approved = reviewProposal(proposalId, 'approve')
      assert.equal(approved.decision, 'approve')
      assert.equal(approved.success, true)
      assert.equal(
        readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md')?.includes('Approved dream line.'),
        true,
      )
      assert.notEqual(gitHead(), head)
      assert.equal(
        listPendingProposals().some((item) => item.id === proposalId),
        false,
      )
      assert.equal(cursorFor(conversationId), DEFAULT_REFLECTION_STEP_COUNT)

      const replay = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(replay.mode, 'llm')
      if (replay.mode !== 'llm') return
      assert.equal(replay.result.code, 'SKIPPED_NO_SLICE')
      assert.equal(transport.calls.length, 1)
    })

    withIsolatedDream((created) => {
      const slug = 'phase3-reject'
      const conversationId = '19191919-1919-4191-8191-191919191919'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(
        conversationId,
        eligibleTranscript([userLine('Reject this reviewed line.')], 'REJECT'),
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const persona = readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md')
      assert.ok(persona)
      const head = gitHead()
      const transport = createFakeReflectionTransport(() =>
        reviewedJson([
          {
            op: 'write',
            path: 'global/persona.md',
            description: 'Append one rejected line.',
            body: appendLine(persona, 'Rejected dream line.'),
          },
        ]),
      )
      const createdRun = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(createdRun.mode, 'llm')
      if (createdRun.mode !== 'llm') return
      const proposalId = createdRun.result.proposalIds[0]
      assert.ok(proposalId)
      const rejected = reviewProposal(proposalId, 'reject')
      assert.equal(rejected.decision, 'reject')
      assert.equal(readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md'), persona)
      assert.equal(gitHead(), head)
      assert.equal(cursorFor(conversationId), DEFAULT_REFLECTION_STEP_COUNT)
      const replay = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(replay.mode, 'llm')
      if (replay.mode !== 'llm') return
      assert.equal(replay.result.code, 'SKIPPED_NO_SLICE')
      assert.equal(transport.calls.length, 1)
    })

    withIsolatedDream((created) => {
      const slug = 'phase3-stale'
      const conversationId = '1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a'
      const workspace = workspaceFor(slug)
      created.push(conversationId)
      initProject(slug)
      writeConversation(
        conversationId,
        eligibleTranscript([userLine('Stale this reviewed line.')], 'STALE'),
      )
      writeHistory([{ id: conversationId, workspace, timestamp: 1 }])
      const persona = readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md')
      assert.ok(persona)
      const transport = createFakeReflectionTransport(() =>
        reviewedJson([
          {
            op: 'write',
            path: 'global/persona.md',
            description: 'Append one stale line.',
            body: appendLine(persona, 'Stale dream line.'),
          },
        ]),
      )
      const createdRun = runDream(
        { kind: 'project', slug },
        { llm: true, force: true, transport, minSteps: 1, idleMinutes: 0 },
      )
      assert.equal(createdRun.mode, 'llm')
      if (createdRun.mode !== 'llm') return
      const proposalId = createdRun.result.proposalIds[0]
      assert.ok(proposalId)
      const replacement = appendLine(persona, 'Manual replacement.')
      writeMemoryFile(MEMORY_ROOT, 'global/persona.md', replacement)
      commitMemoryPaths({
        memoryRoot: MEMORY_ROOT,
        relativePaths: ['global/persona.md'],
        reason: 'test: move persona ahead of approval',
      })
      assert.throws(() => reviewProposal(proposalId, 'approve'), /stale/)
      assert.equal(readCommittedMemoryFile(MEMORY_ROOT, 'global/persona.md'), replacement)
      assert.equal(
        listPendingProposals().some((item) => item.id === proposalId),
        true,
      )
      assert.equal(cursorFor(conversationId), DEFAULT_REFLECTION_STEP_COUNT)
    })
  })
})
