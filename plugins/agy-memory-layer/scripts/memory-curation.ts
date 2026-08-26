#!/usr/bin/env node

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { isDirectCliInvocation } from './cli-entrypoint.ts'
import { parseMemoryDocument } from './layered-memory.ts'
import {
  type DurableSourceUnit,
  extractDurableSourceUnits,
  type MigrationDisposition,
  type MigrationSource,
  type MigrationTarget,
} from './layered-memory-migration.ts'
import {
  assertMemoryRepositoryCleanForWrite,
  commitMemoryPaths,
  deleteMemoryFile,
  getMemoryHeadRevision,
  readCommittedMemoryFile,
  resolveMemoryPath,
  restoreDeclaredMemoryPaths,
  writeMemoryFile,
} from './memory-repository.ts'
import { withMemoryWriteLock } from './memory-write-lock.ts'

export type MemoryCurationSpec = {
  schemaVersion: 1
  id: string
  expectedHead: string
  sources: MigrationSource[]
  targets: MigrationTarget[]
  dispositions: MigrationDisposition[]
  reason: string
  author?: string
}

export type MemoryCurationPlan = {
  id: string
  expectedHead: string
  planHash: string
  reason: string
  author: string
  sources: MigrationSource[]
  sourceUnits: DurableSourceUnit[]
  targets: MigrationTarget[]
  archiveTargets: MigrationTarget[]
  removePaths: string[]
  dispositions: MigrationDisposition[]
  changedPaths: string[]
}

export type MemoryCurationProposal = {
  id: string
  createdAt: string
  planHash: string
  spec: MemoryCurationSpec
}

export type CurationReviewResult = {
  status: 'APPLIED' | 'REJECTED'
  proposalId: string
  commit?: string
  planHash: string
  changedPaths: string[]
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

const sha256 = (content: string): string =>
  crypto.createHash('sha256').update(content).digest('hex')

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const stateRootFor = (memoryRoot: string): string =>
  process.env.AGY_MEMORY_STATE_DIR || `${path.resolve(memoryRoot)}.state`

const pendingDirFor = (memoryRoot: string): string =>
  path.join(stateRootFor(memoryRoot), 'pending-curations')

const archivePathFor = (curationId: string, sourcePath: string): string =>
  `archives/curations/${curationId}/source/${sourcePath}`

const isSystemPath = (relativePath: string): boolean =>
  relativePath.startsWith('system/') ||
  /^projects\/[^/]+\/system\//.test(relativePath) ||
  relativePath === 'global/human.md' ||
  relativePath === 'global/persona.md' ||
  /^projects\/[^/]+\/(project|rules)\.md$/.test(relativePath)

const isReferencePath = (relativePath: string): boolean =>
  relativePath.startsWith('reference/') || /^projects\/[^/]+\/reference\//.test(relativePath)

const validateSpec = (spec: MemoryCurationSpec): void => {
  if (spec.schemaVersion !== 1) throw new Error('Curation schemaVersion must be 1.')
  if (typeof spec.id !== 'string' || !ID_PATTERN.test(spec.id)) {
    throw new Error('Invalid curation id.')
  }
  if (!spec.expectedHead) throw new Error('Curation expectedHead is required.')
  if (!spec.reason?.trim()) throw new Error('Curation reason is required.')
  if (!Array.isArray(spec.sources) || spec.sources.length === 0) {
    throw new Error('Curation requires at least one source.')
  }
  if (!Array.isArray(spec.targets)) throw new Error('Curation targets must be an array.')
  if (!Array.isArray(spec.dispositions)) {
    throw new Error('Curation requires a disposition ledger.')
  }
}

export const planMemoryCuration = (
  memoryRoot: string,
  spec: MemoryCurationSpec,
): MemoryCurationPlan => {
  validateSpec(spec)
  const currentHead = getMemoryHeadRevision(memoryRoot)
  if (currentHead !== spec.expectedHead) {
    throw new Error(
      `Curation HEAD mismatch: expected ${spec.expectedHead}, received ${currentHead}.`,
    )
  }

  const sourcePaths = new Set<string>()
  const sourceContents = new Map<string, string>()
  const sourceUnits: DurableSourceUnit[] = []
  const sources = [...spec.sources].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )
  for (const source of sources) {
    resolveMemoryPath(memoryRoot, source.relativePath)
    if (sourcePaths.has(source.relativePath)) {
      throw new Error(`Duplicate curation source: ${source.relativePath}`)
    }
    if (!SHA256_PATTERN.test(source.sha256)) {
      throw new Error(`Invalid curation source receipt: ${source.relativePath}`)
    }
    const content = readCommittedMemoryFile(memoryRoot, source.relativePath)
    if (content === null)
      throw new Error(`Missing committed curation source: ${source.relativePath}`)
    if (sha256(content) !== source.sha256) {
      throw new Error(`Curation source receipt mismatch: ${source.relativePath}`)
    }
    sourcePaths.add(source.relativePath)
    sourceContents.set(source.relativePath, content)
    sourceUnits.push(...extractDurableSourceUnits(source.relativePath, content))
  }

  const targetPaths = new Set<string>()
  const targetByPath = new Map<string, MigrationTarget>()
  const targets = [...spec.targets].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )
  for (const target of targets) {
    resolveMemoryPath(memoryRoot, target.relativePath)
    if (!isSystemPath(target.relativePath) && !isReferencePath(target.relativePath)) {
      throw new Error(
        `Curation target must be layered system/reference memory: ${target.relativePath}`,
      )
    }
    if (targetPaths.has(target.relativePath)) {
      throw new Error(`Duplicate curation target: ${target.relativePath}`)
    }
    const existing = readCommittedMemoryFile(memoryRoot, target.relativePath)
    if (existing !== null && !sourcePaths.has(target.relativePath) && existing !== target.content) {
      throw new Error(
        `Existing curation target must be included as a source before replacement: ${target.relativePath}`,
      )
    }
    targetPaths.add(target.relativePath)
    targetByPath.set(target.relativePath, target)
    const layeredTarget =
      target.relativePath.startsWith('system/') ||
      target.relativePath.startsWith('reference/') ||
      target.relativePath.includes('/system/') ||
      target.relativePath.includes('/reference/')
    const parsed = parseMemoryDocument(target.content, target.relativePath, {
      requireDescription: layeredTarget,
    })
    if (parsed.diagnostics.length > 0) throw new Error(parsed.diagnostics.join(' '))
  }

  const unitById = new Map(sourceUnits.map((unit) => [unit.id, unit]))
  const seenUnits = new Set<string>()
  const dispositions = [...spec.dispositions].sort((left, right) =>
    left.sourceUnitId.localeCompare(right.sourceUnitId),
  )
  for (const disposition of dispositions) {
    const unit = unitById.get(disposition.sourceUnitId)
    if (!unit || unit.sourcePath !== disposition.sourcePath) {
      throw new Error(`Unknown or mismatched curation source unit: ${disposition.sourceUnitId}`)
    }
    if (seenUnits.has(disposition.sourceUnitId)) {
      throw new Error(`Duplicate curation disposition: ${disposition.sourceUnitId}`)
    }
    seenUnits.add(disposition.sourceUnitId)
    if (!disposition.reason.trim()) {
      throw new Error(`Curation disposition ${disposition.sourceUnitId} requires a reason.`)
    }
    const archivePath = archivePathFor(spec.id, unit.sourcePath)
    if (disposition.state === 'rejected') {
      if (disposition.humanApproved !== true) {
        throw new Error(
          `Rejected curation unit ${disposition.sourceUnitId} requires humanApproved.`,
        )
      }
      continue
    }
    if (!disposition.destinationPath) {
      throw new Error(`Curation disposition ${disposition.sourceUnitId} requires a destination.`)
    }
    if (disposition.state === 'historical') {
      if (disposition.destinationPath !== archivePath) {
        throw new Error(`Historical curation unit must point to ${archivePath}.`)
      }
      continue
    }
    if (!targetPaths.has(disposition.destinationPath)) {
      throw new Error(`Curation destination is not a target: ${disposition.destinationPath}`)
    }
    if (disposition.state === 'active' && !isSystemPath(disposition.destinationPath)) {
      throw new Error('Active curation units must point to system memory.')
    }
    if (disposition.state === 'reference' && !isReferencePath(disposition.destinationPath)) {
      throw new Error('Reference curation units must point to reference memory.')
    }
    const target = targetByPath.get(disposition.destinationPath)
    if (!target) {
      throw new Error(`Missing curation representation target: ${disposition.sourceUnitId}`)
    }
    const targetUnits = new Set(
      extractDurableSourceUnits(disposition.destinationPath, target.content).map(
        (targetUnit) => targetUnit.text,
      ),
    )
    if (disposition.representation === 'exact') {
      if (!targetUnits.has(unit.text)) {
        throw new Error(
          `Exact curation unit ${disposition.sourceUnitId} is absent from ${disposition.destinationPath}.`,
        )
      }
    } else if (disposition.representation === 'summary') {
      const summaryText = disposition.summaryText?.trim()
      if (!summaryText || !targetUnits.has(summaryText)) {
        throw new Error(
          `Summary curation unit ${disposition.sourceUnitId} must name one exact summary unit in ${disposition.destinationPath}.`,
        )
      }
    } else {
      throw new Error(
        `Curation disposition ${disposition.sourceUnitId} requires exact or summary representation.`,
      )
    }
  }
  const missing = sourceUnits.filter((unit) => !seenUnits.has(unit.id))
  if (missing.length > 0) {
    throw new Error(`Curation ledger omits ${missing.length} durable source unit(s).`)
  }

  const removePaths = [...sourcePaths].filter((sourcePath) => !targetPaths.has(sourcePath)).sort()
  const archiveTargets: MigrationTarget[] = [...sourceContents.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourcePath, content]) => ({
      relativePath: archivePathFor(spec.id, sourcePath),
      content,
    }))
  const core = {
    schemaVersion: 1,
    id: spec.id,
    expectedHead: spec.expectedHead,
    reason: spec.reason,
    author: spec.author || 'Antigravity Memory Curation',
    sources,
    sourceUnits,
    targets,
    dispositions,
    removePaths,
  }
  const planHash = sha256(stableStringify(core))
  archiveTargets.push({
    relativePath: `archives/curations/${spec.id}/manifest.json`,
    content: `${JSON.stringify(
      {
        ...core,
        planHash,
        archivePolicy: 'Exact source blobs retained before approved curation.',
      },
      null,
      2,
    )}\n`,
  })
  for (const archiveTarget of archiveTargets) {
    const resolved = resolveMemoryPath(memoryRoot, archiveTarget.relativePath)
    if (
      readCommittedMemoryFile(memoryRoot, archiveTarget.relativePath) !== null ||
      fs.existsSync(resolved.absolutePath)
    ) {
      throw new Error(`Curation archive target already exists: ${archiveTarget.relativePath}`)
    }
  }
  const changedPaths = [
    ...targetPaths,
    ...removePaths,
    ...archiveTargets.map((target) => target.relativePath),
  ].sort()

  return {
    id: spec.id,
    expectedHead: spec.expectedHead,
    planHash,
    reason: spec.reason,
    author: spec.author || 'Antigravity Memory Curation',
    sources,
    sourceUnits,
    targets,
    archiveTargets,
    removePaths,
    dispositions,
    changedPaths,
  }
}

export const proposeMemoryCuration = (
  memoryRoot: string,
  spec: MemoryCurationSpec,
): MemoryCurationProposal => {
  assertMemoryRepositoryCleanForWrite(memoryRoot)
  const plan = planMemoryCuration(memoryRoot, spec)
  const proposal: MemoryCurationProposal = {
    id: `cur-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    createdAt: new Date().toISOString(),
    planHash: plan.planHash,
    spec,
  }
  const pendingDir = pendingDirFor(memoryRoot)
  fs.mkdirSync(pendingDir, { recursive: true })
  fs.writeFileSync(
    path.join(pendingDir, `${proposal.id}.json`),
    `${JSON.stringify(proposal, null, 2)}\n`,
    { encoding: 'utf-8', flag: 'wx' },
  )
  return proposal
}

export const getPendingMemoryCuration = (
  memoryRoot: string,
  proposalId: string,
): MemoryCurationProposal | null => {
  if (!/^cur-[a-z0-9-]+$/.test(proposalId)) return null
  const proposalPath = path.join(pendingDirFor(memoryRoot), `${proposalId}.json`)
  try {
    return JSON.parse(fs.readFileSync(proposalPath, 'utf-8')) as MemoryCurationProposal
  } catch {
    return null
  }
}

export const reviewMemoryCuration = (
  memoryRoot: string,
  proposalId: string,
  decision: 'approve' | 'reject',
): CurationReviewResult => {
  const proposal = getPendingMemoryCuration(memoryRoot, proposalId)
  if (!proposal) throw new Error(`Memory curation proposal not found: ${proposalId}`)
  const proposalPath = path.join(pendingDirFor(memoryRoot), `${proposalId}.json`)
  if (decision === 'reject') {
    fs.unlinkSync(proposalPath)
    return {
      status: 'REJECTED',
      proposalId,
      planHash: proposal.planHash,
      changedPaths: [],
    }
  }

  return withMemoryWriteLock(memoryRoot, `approve curation ${proposalId}`, () => {
    assertMemoryRepositoryCleanForWrite(memoryRoot)
    const plan = planMemoryCuration(memoryRoot, proposal.spec)
    if (plan.planHash !== proposal.planHash) {
      throw new Error(`Memory curation proposal is stale: ${proposalId}`)
    }
    try {
      for (const target of [...plan.targets, ...plan.archiveTargets]) {
        writeMemoryFile(memoryRoot, target.relativePath, target.content)
      }
      for (const relativePath of plan.removePaths) deleteMemoryFile(memoryRoot, relativePath)
      const commit = commitMemoryPaths({
        memoryRoot,
        relativePaths: plan.changedPaths,
        reason: `chore(memory): approved curation ${plan.id} (${plan.reason})`,
        authorName: plan.author,
      })
      if (!commit.committed || !commit.sha) throw new Error('Memory curation produced no commit.')
      const result: CurationReviewResult = {
        status: 'APPLIED',
        proposalId,
        commit: commit.sha,
        planHash: plan.planHash,
        changedPaths: plan.changedPaths,
      }
      try {
        fs.unlinkSync(proposalPath)
      } catch {}
      return result
    } catch (error) {
      restoreDeclaredMemoryPaths(memoryRoot, plan.expectedHead, plan.changedPaths)
      throw error
    }
  })
}

const parseArgs = (args: string[]): Record<string, string> => {
  const parsed: Record<string, string> = {}
  for (let index = 0; index < args.length; index++) {
    if (args[index].startsWith('--') && args[index + 1])
      parsed[args[index].slice(2)] = args[++index]
  }
  return parsed
}

const requireArg = (args: Record<string, string>, key: string): string => {
  if (!args[key]) throw new Error(`Missing --${key}.`)
  return args[key]
}

export const runMemoryCurationCli = (argv = process.argv.slice(2)): void => {
  const command = argv[0] || 'help'
  if (command === 'help') {
    process.stdout.write(
      'Usage: memory-curation <plan|propose|approve|reject> --memory <path> [--spec <json>] [--proposal <id>]\n',
    )
    return
  }
  const args = parseArgs(argv.slice(1))
  const memoryRoot = path.resolve(requireArg(args, 'memory'))
  if (command === 'approve' || command === 'reject') {
    const result = reviewMemoryCuration(
      memoryRoot,
      requireArg(args, 'proposal'),
      command === 'approve' ? 'approve' : 'reject',
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  const spec = JSON.parse(fs.readFileSync(path.resolve(requireArg(args, 'spec')), 'utf-8'))
  if (command === 'plan') {
    process.stdout.write(`${JSON.stringify(planMemoryCuration(memoryRoot, spec), null, 2)}\n`)
    return
  }
  if (command === 'propose') {
    process.stdout.write(`${JSON.stringify(proposeMemoryCuration(memoryRoot, spec), null, 2)}\n`)
    return
  }
  throw new Error(`Unknown memory curation command: ${command}`)
}

if (isDirectCliInvocation(import.meta.url)) {
  try {
    runMemoryCurationCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
