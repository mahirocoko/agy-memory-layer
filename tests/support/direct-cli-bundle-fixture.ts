import * as fs from 'node:fs'
import * as path from 'node:path'
import { sha256Text } from '../../tools/host-evidence-contract.ts'
import {
  createCanaryReportBody,
  DIRECT_CLI_FIXTURE_SCHEMA,
  type DIRECT_CLI_JOB_SCHEMA,
  DIRECT_CLI_MESSAGE_SCHEMA,
  type DirectCliCallbackMessageV1,
  type DirectCliCurrentReceipt,
  type DirectCliJobV2,
  type DirectCliParentReceipt,
  type DirectCliTargetReceipt,
} from '../../tools/host-evidence-direct-cli.ts'

export type CreateDirectCliJobBundleOptions = {
  jobId?: string
  mode?: 'callback' | 'watcher'
  status?: 'done' | 'attention' | 'error' | 'running'
  targetName?: string
  promptText?: string
  dispatchFooter?: string
  reportBody?: string
  cwd?: string
  agentSession?: string
  collectedAt?: string
  ackBy?: string
  deliveryStatus?: 'accepted' | 'failed' | 'pending'
  reportKind?: 'report_ready' | 'report_failed'
  schema?: string
  messageSchema?: string
  watcherFallback?: boolean
  corruptBodyHash?: boolean
  corruptResultFile?: boolean
}

const writeJson = (target: string, value: unknown): void => {
  fs.writeFileSync(target, JSON.stringify(value, null, 2), { mode: 0o600 })
}

export const createDirectCliJobBundle = (
  baseDir: string,
  options: CreateDirectCliJobBundleOptions = {},
) => {
  const jobId = options.jobId ?? 'direct-job-test-001'
  const mode = options.mode ?? 'callback'
  const status = options.status ?? 'done'
  const targetName = options.targetName ?? 'agy-worker-1'
  const promptText = options.promptText ?? 'synthetic host-evidence prompt direct-cli'
  const footer =
    options.dispatchFooter ??
    `\n\n[Direct-CLI callback contract]\nreceive=herdr-jobs.py receive ${jobId}`
  const dispatchPrompt = promptText + (mode === 'callback' ? footer : '')
  const promptSha256 = sha256Text(promptText)
  const dispatchSha256 = sha256Text(dispatchPrompt)
  const cwd = options.cwd ?? fs.realpathSync(baseDir)
  const agentSession = options.agentSession ?? 'session-agy-001'
  const messageId = 'm-msg-test-001'
  const defaultReport = createCanaryReportBody({
    taskId: 'task-direct-001',
    promptHash: promptSha256,
    agyVersion: '0.1.0',
    model: 'gemini-2.5-pro',
    effort: 'high',
    finalResponse: {
      taskId: 'task-direct-001',
      status: 'ANSWERED',
      answer: {
        humanAction: 'Throttle',
        api: 'POST',
        path: '/v1/synthetic/jobs',
      },
      sources: ['reference/synthetic-runbook.md'],
    },
  })
  const reportBody = options.reportBody ?? defaultReport
  const bodyBytes = Buffer.from(reportBody, 'utf8')
  const bodySha256 = options.corruptBodyHash
    ? 'a'.repeat(64)
    : sha256Text(bodyBytes.toString('utf8'))
  const reportKind = options.reportKind ?? 'report_ready'
  const deliveryStatus = options.deliveryStatus ?? 'accepted'
  const ackBy = options.ackBy === undefined ? 'parent' : options.ackBy

  const jobDir = path.join(baseDir, jobId)
  fs.mkdirSync(path.join(jobDir, 'results'), { mode: 0o700, recursive: true })
  fs.mkdirSync(path.join(jobDir, 'messages', messageId), { mode: 0o700, recursive: true })
  fs.writeFileSync(path.join(jobDir, 'prompt.txt'), promptText, { mode: 0o600 })
  fs.writeFileSync(path.join(jobDir, 'dispatch-prompt.txt'), dispatchPrompt, { mode: 0o600 })

  const targetReceipt: DirectCliTargetReceipt = {
    role: 'target',
    requestedPaneId: 'target-pane-1',
    paneId: 'p1',
    workspaceId: 'w1',
    tabId: 't1',
    terminal: 'term_agy_1',
    herdrSocket: '/tmp/herdr.sock',
    cwd,
    agentKind: 'agy',
    agentName: targetName,
    agentSession,
  }
  const parentReceipt: DirectCliParentReceipt = {
    role: 'parent',
    requestedPaneId: 'parent-pane-1',
    paneId: 'p0',
    workspaceId: 'w1',
    tabId: 't1',
    terminal: 'term_parent_0',
    herdrSocket: '/tmp/herdr.sock',
    cwd,
    agentKind: 'letta',
    agentName: 'parent-orchestrator',
    lettaTokens: {
      letta_pid: '12345',
      letta_started_at: '2026-09-13T00:00:00Z',
      letta_scope: 'system',
    },
  }
  const messageRecord: DirectCliCallbackMessageV1 = {
    schema: (options.messageSchema ??
      DIRECT_CLI_MESSAGE_SCHEMA) as typeof DIRECT_CLI_MESSAGE_SCHEMA,
    job: jobId,
    id: messageId,
    from: targetName,
    to: 'parent',
    kind: reportKind,
    idempotencyKey: 'final',
    bodyPath: `messages/${messageId}/body`,
    bodySha256,
    bodyBytes: bodyBytes.length,
    senderReceipt: {
      ...targetReceipt,
      role: 'current',
      agentName: null,
    } as DirectCliCurrentReceipt,
    createdAt: new Date().toISOString(),
    delivery: { status: deliveryStatus, acceptedAt: new Date().toISOString() },
    ack:
      ackBy === ''
        ? null
        : {
            at: new Date().toISOString(),
            by: ackBy,
            receipt: { ...parentReceipt, role: 'current' } as DirectCliCurrentReceipt,
          },
  }
  writeJson(path.join(jobDir, 'messages', messageId, 'message.json'), messageRecord)
  fs.writeFileSync(path.join(jobDir, 'messages', messageId, 'body'), bodyBytes, { mode: 0o600 })
  fs.writeFileSync(
    path.join(jobDir, 'results', `${targetName}.txt`),
    options.corruptResultFile ? Buffer.from('corrupted', 'utf8') : bodyBytes,
    { mode: 0o600 },
  )

  const jobPayload: DirectCliJobV2 = {
    schema: (options.schema ?? DIRECT_CLI_FIXTURE_SCHEMA) as
      | typeof DIRECT_CLI_JOB_SCHEMA
      | typeof DIRECT_CLI_FIXTURE_SCHEMA,
    id: jobId,
    mode,
    status,
    cwd,
    promptSha256,
    taskSha256: promptSha256,
    taskPromptSha256: promptSha256,
    dispatchSha256,
    dispatchPromptSha256: dispatchSha256,
    targets: [
      {
        name: targetName,
        baselineSeq: 1,
        initialStatus: 'idle',
        resultPath: `results/${targetName}.txt`,
        receipt: targetReceipt,
      },
    ],
    parentReceipt,
    reports: {
      [targetName]: {
        status: reportKind,
        message: messageId,
        resultPath: `results/${targetName}.txt`,
        bodySha256,
        reportedAt: new Date().toISOString(),
      },
    },
    messageCount: 1,
    watcherFallback: options.watcherFallback ?? false,
    summary: 'all target reports acknowledged',
    collectedAt: options.collectedAt,
    finishedAt: new Date().toISOString(),
  }
  writeJson(path.join(jobDir, 'job.json'), jobPayload)
  return { jobDir, jobId, promptText, reportBody, targetName, messageId }
}
