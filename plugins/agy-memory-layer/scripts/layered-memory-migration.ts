#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { isDirectCliInvocation } from './cli-entrypoint.ts'
import { parseMemoryDocument } from './layered-memory.ts'
import {
  assertMemoryRepositoryCleanForWrite,
  commitMemoryPaths,
  deleteMemoryFile,
  getMemoryHeadRevision,
  listCommittedMemoryFiles,
  readCommittedMemoryFile,
  resolveMemoryPath,
  restoreDeclaredMemoryPaths,
  writeMemoryFile,
} from './memory-repository.ts'
import { withMemoryWriteLock } from './memory-write-lock.ts'

export type MigrationDispositionState =
  | 'active'
  | 'reference'
  | 'historical'
  | 'duplicate'
  | 'rejected'

export type MigrationSource = {
  relativePath: string
  sha256: string
}

export type MigrationTarget = {
  relativePath: string
  content: string
}

export type MigrationDisposition = {
  sourcePath: string
  sourceUnitId: string
  destinationPath?: string
  state: MigrationDispositionState
  representation?: 'exact' | 'summary'
  summaryText?: string
  reason: string
  humanApproved?: boolean
}

export type LayeredMigrationSpec = {
  schemaVersion: 1
  id: string
  expectedHead: string
  sources: MigrationSource[]
  targets: MigrationTarget[]
  dispositions: MigrationDisposition[]
}

export type DurableSourceUnit = {
  id: string
  sourcePath: string
  occurrence: number
  text: string
  textSha256: string
}

export type LayeredMigrationPlan = {
  id: string
  expectedHead: string
  planHash: string
  sourceUnits: DurableSourceUnit[]
  sources: MigrationSource[]
  targets: MigrationTarget[]
  archiveTargets: MigrationTarget[]
  removePaths: string[]
  dispositions: MigrationDisposition[]
  changedPaths: string[]
}

export type MigrationApplyResult = {
  status: 'MIGRATED'
  commit: string
  planHash: string
  changedPaths: string[]
}

export type MigrationRollbackResult = {
  status: 'ROLLED_BACK'
  commit: string
  restoredParent: string
  preservedArchive: string
  changedPaths: string[]
}

const MIGRATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const LEGACY_PROJECT_PATTERN = /^projects\/([^/]+)\/(project|rules)\.md$/

const sha256 = (content: string): string =>
  crypto.createHash('sha256').update(content).digest('hex')

const stableSort = <T>(values: T[], key: (value: T) => string): T[] =>
  [...values].sort((left, right) => key(left).localeCompare(key(right)))

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    )
    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export const getAllLegacyActivePaths = (memoryRoot: string): string[] => {
  const committed = [
    ...listCommittedMemoryFiles(memoryRoot, 'global'),
    ...listCommittedMemoryFiles(memoryRoot, 'projects'),
  ]
  return [...new Set(committed)]
    .filter(
      (relativePath) =>
        relativePath === 'global/human.md' ||
        relativePath === 'global/persona.md' ||
        LEGACY_PROJECT_PATTERN.test(relativePath),
    )
    .sort()
}

export const extractDurableSourceUnits = (
  sourcePath: string,
  content: string,
): DurableSourceUnit[] => {
  const occurrences = new Map<string, number>()
  const units: DurableSourceUnit[] = []
  const parsed = parseMemoryDocument(content, sourcePath)
  const semanticContent =
    content.startsWith('---\n') && parsed.diagnostics.length === 0 ? parsed.body : content
  for (const line of semanticContent.split('\n')) {
    const text = line.trim()
    if (!text) continue
    const occurrence = (occurrences.get(text) || 0) + 1
    occurrences.set(text, occurrence)
    const textSha256 = sha256(text)
    units.push({
      id: sha256(`${sourcePath}\0${textSha256}\0${occurrence}`),
      sourcePath,
      occurrence,
      text,
      textSha256,
    })
  }
  return units
}

const validateTargetPath = (relativePath: string): void => {
  const valid =
    relativePath.startsWith('system/') ||
    relativePath.startsWith('reference/') ||
    /^projects\/[^/]+\/(system|reference)\/.+\.md$/.test(relativePath)
  if (!valid || !relativePath.endsWith('.md')) {
    throw new Error(`Invalid layered migration target: ${relativePath}`)
  }
}

const validateSpecShape = (spec: LayeredMigrationSpec): void => {
  if (spec.schemaVersion !== 1) throw new Error('Migration spec schemaVersion must be 1.')
  if (typeof spec.id !== 'string' || !MIGRATION_ID_PATTERN.test(spec.id)) {
    throw new Error('Migration id must be 3-80 lowercase alphanumeric/hyphen characters.')
  }
  if (!spec.expectedHead) throw new Error('Migration spec requires expectedHead.')
  if (!Array.isArray(spec.sources) || spec.sources.length === 0) {
    throw new Error('Migration spec requires at least one source receipt.')
  }
  if (!Array.isArray(spec.targets) || spec.targets.length === 0) {
    throw new Error('Migration spec requires focused layered targets.')
  }
  if (!Array.isArray(spec.dispositions)) {
    throw new Error('Migration spec requires a disposition ledger.')
  }
}

const getArchivePath = (migrationId: string, sourcePath: string): string =>
  `archives/migrations/${migrationId}/legacy/${sourcePath}`

const readSources = (
  memoryRoot: string,
  spec: LayeredMigrationSpec,
): { sources: MigrationSource[]; contents: Map<string, string>; units: DurableSourceUnit[] } => {
  const actualLegacyPaths = getAllLegacyActivePaths(memoryRoot)
  const specifiedPaths = stableSort(spec.sources, (source) => source.relativePath).map(
    (source) => source.relativePath,
  )
  if (stableStringify(actualLegacyPaths) !== stableStringify(specifiedPaths)) {
    throw new Error(
      `Migration sources must exactly cover all committed legacy active owners. Expected: ${actualLegacyPaths.join(', ')}`,
    )
  }

  const contents = new Map<string, string>()
  const units: DurableSourceUnit[] = []
  const sources = stableSort(spec.sources, (source) => source.relativePath)
  for (const source of sources) {
    resolveMemoryPath(memoryRoot, source.relativePath)
    if (!SHA256_PATTERN.test(source.sha256)) {
      throw new Error(`Invalid SHA-256 receipt for ${source.relativePath}.`)
    }
    const content = readCommittedMemoryFile(memoryRoot, source.relativePath)
    if (content === null)
      throw new Error(`Missing committed migration source: ${source.relativePath}`)
    const actualHash = sha256(content)
    if (actualHash !== source.sha256) {
      throw new Error(
        `Source receipt mismatch for ${source.relativePath}: expected ${source.sha256}, received ${actualHash}.`,
      )
    }
    contents.set(source.relativePath, content)
    units.push(...extractDurableSourceUnits(source.relativePath, content))
  }
  return { sources, contents, units }
}

const validateTargets = (
  memoryRoot: string,
  spec: LayeredMigrationSpec,
  sourcePaths: Set<string>,
): MigrationTarget[] => {
  const seen = new Set<string>()
  const targets = stableSort(spec.targets, (target) => target.relativePath)
  for (const target of targets) {
    validateTargetPath(target.relativePath)
    resolveMemoryPath(memoryRoot, target.relativePath)
    if (seen.has(target.relativePath)) {
      throw new Error(`Duplicate migration target: ${target.relativePath}`)
    }
    if (sourcePaths.has(target.relativePath)) {
      throw new Error(`Migration target overlaps legacy source: ${target.relativePath}`)
    }
    const existing = readCommittedMemoryFile(memoryRoot, target.relativePath)
    if (existing !== null && existing !== target.content) {
      throw new Error(
        `Migration target already exists with different content: ${target.relativePath}`,
      )
    }
    seen.add(target.relativePath)
    const parsed = parseMemoryDocument(target.content, target.relativePath, {
      requireDescription: true,
    })
    if (parsed.diagnostics.length > 0) {
      throw new Error(parsed.diagnostics.join(' '))
    }
  }

  if (!seen.has('system/persona.md')) {
    throw new Error('Layered migration requires system/persona.md.')
  }
  if (![...seen].some((relativePath) => relativePath.startsWith('system/human/'))) {
    throw new Error('Layered migration requires at least one focused system/human owner.')
  }

  const projectSlugs = new Set<string>()
  for (const sourcePath of sourcePaths) {
    const match = sourcePath.match(LEGACY_PROJECT_PATTERN)
    if (match) projectSlugs.add(match[1])
  }
  for (const projectSlug of projectSlugs) {
    if (
      ![...seen].some((relativePath) => relativePath.startsWith(`projects/${projectSlug}/system/`))
    ) {
      throw new Error(`Layered migration requires a system owner for project ${projectSlug}.`)
    }
  }
  return targets
}

const validateDispositionLedger = (
  spec: LayeredMigrationSpec,
  units: DurableSourceUnit[],
  targets: MigrationTarget[],
): MigrationDisposition[] => {
  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  const targetByPath = new Map(targets.map((target) => [target.relativePath, target]))
  const targetPaths = new Set(targetByPath.keys())
  const seen = new Set<string>()
  const dispositions = stableSort(spec.dispositions, (disposition) => disposition.sourceUnitId)

  for (const disposition of dispositions) {
    const unit = unitById.get(disposition.sourceUnitId)
    if (!unit || unit.sourcePath !== disposition.sourcePath) {
      throw new Error(`Unknown or mismatched source unit: ${disposition.sourceUnitId}`)
    }
    if (seen.has(disposition.sourceUnitId)) {
      throw new Error(`Duplicate disposition for source unit: ${disposition.sourceUnitId}`)
    }
    seen.add(disposition.sourceUnitId)
    if (!disposition.reason.trim()) {
      throw new Error(`Disposition ${disposition.sourceUnitId} requires a reason.`)
    }

    const archivePath = getArchivePath(spec.id, unit.sourcePath)
    if (disposition.state === 'rejected') {
      if (disposition.humanApproved !== true) {
        throw new Error(`Rejected source unit ${disposition.sourceUnitId} requires humanApproved.`)
      }
      continue
    }
    if (!disposition.destinationPath) {
      throw new Error(`Disposition ${disposition.sourceUnitId} requires destinationPath.`)
    }
    if (disposition.state === 'historical') {
      if (disposition.destinationPath !== archivePath) {
        throw new Error(`Historical unit ${disposition.sourceUnitId} must point to ${archivePath}.`)
      }
      continue
    }
    if (!targetPaths.has(disposition.destinationPath)) {
      throw new Error(
        `Disposition ${disposition.sourceUnitId} points to missing target ${disposition.destinationPath}.`,
      )
    }
    if (disposition.state === 'active' && !disposition.destinationPath.includes('/system/')) {
      const globalSystem = disposition.destinationPath.startsWith('system/')
      if (!globalSystem) {
        throw new Error(`Active unit ${disposition.sourceUnitId} must point to a system owner.`)
      }
    }
    if (
      disposition.state === 'reference' &&
      !disposition.destinationPath.startsWith('reference/') &&
      !disposition.destinationPath.includes('/reference/')
    ) {
      throw new Error(`Reference unit ${disposition.sourceUnitId} must point to a reference owner.`)
    }
    const target = targetByPath.get(disposition.destinationPath)
    if (!target) {
      throw new Error(`Missing representation target for ${disposition.sourceUnitId}.`)
    }
    const targetUnits = new Set(
      extractDurableSourceUnits(disposition.destinationPath, target.content).map(
        (targetUnit) => targetUnit.text,
      ),
    )
    if (disposition.representation === 'exact') {
      if (!targetUnits.has(unit.text)) {
        throw new Error(
          `Exact disposition ${disposition.sourceUnitId} is not present in ${disposition.destinationPath}.`,
        )
      }
    } else if (disposition.representation === 'summary') {
      const summaryText = disposition.summaryText?.trim()
      if (!summaryText || !targetUnits.has(summaryText)) {
        throw new Error(
          `Summary disposition ${disposition.sourceUnitId} must name one exact summary unit in ${disposition.destinationPath}.`,
        )
      }
    } else {
      throw new Error(
        `Disposition ${disposition.sourceUnitId} requires exact or summary representation.`,
      )
    }
  }

  const missing = units.filter((unit) => !seen.has(unit.id))
  if (missing.length > 0) {
    throw new Error(
      `Disposition ledger omits ${missing.length} durable source unit(s): ${missing
        .slice(0, 5)
        .map((unit) => `${unit.sourcePath}:${unit.textSha256.slice(0, 12)}`)
        .join(', ')}`,
    )
  }
  return dispositions
}

const buildArchiveTargets = (
  spec: LayeredMigrationSpec,
  contents: Map<string, string>,
  manifestContent: string,
): MigrationTarget[] => [
  ...[...contents.entries()].map(([sourcePath, content]) => ({
    relativePath: getArchivePath(spec.id, sourcePath),
    content,
  })),
  {
    relativePath: `archives/migrations/${spec.id}/manifest.json`,
    content: manifestContent,
  },
]

export const planLayeredMemoryMigration = (
  memoryRoot: string,
  spec: LayeredMigrationSpec,
): LayeredMigrationPlan => {
  validateSpecShape(spec)
  const currentHead = getMemoryHeadRevision(memoryRoot)
  if (currentHead !== spec.expectedHead) {
    throw new Error(
      `Migration HEAD mismatch: expected ${spec.expectedHead}, received ${currentHead}.`,
    )
  }

  const { sources, contents, units } = readSources(memoryRoot, spec)
  const sourcePaths = new Set(sources.map((source) => source.relativePath))
  const targets = validateTargets(memoryRoot, spec, sourcePaths)
  const dispositions = validateDispositionLedger(spec, units, targets)
  const planCore = {
    schemaVersion: 1,
    id: spec.id,
    expectedHead: spec.expectedHead,
    sources,
    sourceUnits: units,
    targets,
    dispositions,
    removePaths: [...sourcePaths].sort(),
  }
  const planHash = sha256(stableStringify(planCore))
  const manifestContent = `${JSON.stringify(
    {
      ...planCore,
      planHash,
      archivePolicy:
        'Exact legacy source blobs retained; active/reference semantics require human review.',
    },
    null,
    2,
  )}\n`
  const archiveTargets = buildArchiveTargets(spec, contents, manifestContent)
  for (const archiveTarget of archiveTargets) {
    const resolved = resolveMemoryPath(memoryRoot, archiveTarget.relativePath)
    if (
      readCommittedMemoryFile(memoryRoot, archiveTarget.relativePath) !== null ||
      fs.existsSync(resolved.absolutePath)
    ) {
      throw new Error(`Migration archive target already exists: ${archiveTarget.relativePath}`)
    }
  }
  const changedPaths = [
    ...targets.map((target) => target.relativePath),
    ...archiveTargets.map((target) => target.relativePath),
    ...sourcePaths,
  ].sort()

  return {
    id: spec.id,
    expectedHead: spec.expectedHead,
    planHash,
    sourceUnits: units,
    sources,
    targets,
    archiveTargets,
    removePaths: [...sourcePaths].sort(),
    dispositions,
    changedPaths,
  }
}

export const applyLayeredMemoryMigration = (
  memoryRoot: string,
  spec: LayeredMigrationSpec,
  confirmedPlanHash: string,
): MigrationApplyResult =>
  withMemoryWriteLock(memoryRoot, `apply layered migration ${spec.id}`, () => {
    assertMemoryRepositoryCleanForWrite(memoryRoot)
    const plan = planLayeredMemoryMigration(memoryRoot, spec)
    if (plan.planHash !== confirmedPlanHash) {
      throw new Error(
        `Migration plan confirmation mismatch: expected ${plan.planHash}, received ${confirmedPlanHash}.`,
      )
    }

    try {
      for (const target of [...plan.targets, ...plan.archiveTargets]) {
        writeMemoryFile(memoryRoot, target.relativePath, target.content)
      }
      for (const sourcePath of plan.removePaths) deleteMemoryFile(memoryRoot, sourcePath)
      const commit = commitMemoryPaths({
        memoryRoot,
        relativePaths: plan.changedPaths,
        reason: `feat(memory): migrate to layered memory (${plan.id})`,
        authorName: 'Antigravity Memory Migration',
      })
      if (!commit.committed || !commit.sha) {
        throw new Error('Layered migration produced no commit.')
      }
      return {
        status: 'MIGRATED',
        commit: commit.sha,
        planHash: plan.planHash,
        changedPaths: plan.changedPaths,
      }
    } catch (error) {
      restoreDeclaredMemoryPaths(memoryRoot, spec.expectedHead, plan.changedPaths)
      throw error
    }
  })

const readFileAtRef = (
  memoryRoot: string,
  revision: string,
  relativePath: string,
): string | null => {
  const result = spawnSync('git', ['-C', memoryRoot, 'show', `${revision}:${relativePath}`], {
    encoding: 'utf-8',
  })
  return result.status === 0 ? result.stdout : null
}

export const rollbackLayeredMemoryMigration = (
  memoryRoot: string,
  migrationId: string,
  migrationCommit: string,
): MigrationRollbackResult =>
  withMemoryWriteLock(memoryRoot, `rollback layered migration ${migrationId}`, () => {
    if (typeof migrationId !== 'string' || !MIGRATION_ID_PATTERN.test(migrationId)) {
      throw new Error('Invalid migration id.')
    }
    assertMemoryRepositoryCleanForWrite(memoryRoot)
    const currentHead = getMemoryHeadRevision(memoryRoot)
    if (!currentHead) throw new Error('Rollback requires a committed memory HEAD.')
    const ancestry = spawnSync(
      'git',
      ['-C', memoryRoot, 'merge-base', '--is-ancestor', migrationCommit, currentHead],
      { encoding: 'utf-8' },
    )
    if (ancestry.status !== 0) {
      throw new Error(
        `Rollback requires ${migrationCommit} to be an ancestor of current HEAD ${currentHead}.`,
      )
    }
    const parent = execFileSync('git', ['-C', memoryRoot, 'rev-parse', `${migrationCommit}^`], {
      encoding: 'utf-8',
    }).trim()
    const archivePrefix = `archives/migrations/${migrationId}/`
    const manifestPath = `${archivePrefix}manifest.json`
    if (readFileAtRef(memoryRoot, migrationCommit, manifestPath) === null) {
      throw new Error(`Migration manifest not found at ${migrationCommit}:${manifestPath}.`)
    }
    const changed = execFileSync(
      'git',
      ['-C', memoryRoot, 'diff', '--no-renames', '--name-only', '-z', parent, migrationCommit],
      { encoding: 'utf-8' },
    )
      .split('\0')
      .filter(Boolean)
      .filter((relativePath) => !relativePath.startsWith(archivePrefix))
      .sort()

    const rollbackArchivePrefix = `${archivePrefix}rollbacks/${currentHead}/`
    const currentReceipts = changed.map((relativePath) => {
      const content = readCommittedMemoryFile(memoryRoot, relativePath)
      return {
        relativePath,
        present: content !== null,
        sha256: content === null ? null : sha256(content),
      }
    })
    const rollbackArchiveTargets: MigrationTarget[] = currentReceipts
      .filter((receipt) => receipt.present)
      .map((receipt) => ({
        relativePath: `${rollbackArchivePrefix}current/${receipt.relativePath}`,
        content: readCommittedMemoryFile(memoryRoot, receipt.relativePath) as string,
      }))
    rollbackArchiveTargets.push({
      relativePath: `${rollbackArchivePrefix}manifest.json`,
      content: `${JSON.stringify(
        {
          schemaVersion: 1,
          migrationId,
          migrationCommit,
          rollbackFrom: currentHead,
          restoredParent: parent,
          currentReceipts,
          policy: 'Exact current migration-owned paths are archived before rollback.',
        },
        null,
        2,
      )}\n`,
    })
    for (const target of rollbackArchiveTargets) {
      const resolved = resolveMemoryPath(memoryRoot, target.relativePath)
      if (
        readCommittedMemoryFile(memoryRoot, target.relativePath) !== null ||
        fs.existsSync(resolved.absolutePath)
      ) {
        throw new Error(`Rollback archive target already exists: ${target.relativePath}`)
      }
    }
    const rollbackPaths = rollbackArchiveTargets.map((target) => target.relativePath)
    const commitPaths = [...changed, ...rollbackPaths].sort()

    try {
      for (const target of rollbackArchiveTargets) {
        writeMemoryFile(memoryRoot, target.relativePath, target.content)
      }
      for (const relativePath of changed) {
        resolveMemoryPath(memoryRoot, relativePath)
        const parentContent = readFileAtRef(memoryRoot, parent, relativePath)
        if (parentContent === null) deleteMemoryFile(memoryRoot, relativePath)
        else writeMemoryFile(memoryRoot, relativePath, parentContent)
      }

      const commit = commitMemoryPaths({
        memoryRoot,
        relativePaths: commitPaths,
        reason: `revert(memory): roll back layered migration (${migrationId})`,
        authorName: 'Antigravity Memory Migration',
      })
      if (!commit.committed || !commit.sha)
        throw new Error('Layered migration rollback produced no commit.')
      return {
        status: 'ROLLED_BACK',
        commit: commit.sha,
        restoredParent: parent,
        preservedArchive: archivePrefix,
        changedPaths: commitPaths,
      }
    } catch (error) {
      restoreDeclaredMemoryPaths(memoryRoot, currentHead, commitPaths)
      throw error
    }
  })

const parseCliArgs = (args: string[]): Record<string, string | boolean> => {
  const parsed: Record<string, string | boolean> = {}
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    if (args[index + 1] && !args[index + 1].startsWith('--')) parsed[key] = args[++index]
    else parsed[key] = true
  }
  return parsed
}

const requireStringArg = (args: Record<string, string | boolean>, key: string): string => {
  const value = args[key]
  if (typeof value !== 'string' || !value) throw new Error(`Missing required --${key}.`)
  return value
}

export const runLayeredMemoryMigrationCli = (argv = process.argv.slice(2)): void => {
  const command = argv[0] || 'help'
  const args = parseCliArgs(argv.slice(1))
  if (command === 'help') {
    process.stdout.write(
      'Usage: layered-memory-migration <units|plan|apply|rollback> --memory <path> [--spec <json>] [--confirm-plan <sha256>] [--migration-id <id>] [--migration-commit <sha>]\n',
    )
    return
  }
  const memoryRoot = path.resolve(requireStringArg(args, 'memory'))

  if (command === 'units') {
    const sources = getAllLegacyActivePaths(memoryRoot).map((relativePath) => {
      const content = readCommittedMemoryFile(memoryRoot, relativePath) || ''
      return {
        relativePath,
        sha256: sha256(content),
        units: extractDurableSourceUnits(relativePath, content),
      }
    })
    process.stdout.write(
      `${JSON.stringify({ head: getMemoryHeadRevision(memoryRoot), sources }, null, 2)}\n`,
    )
    return
  }

  if (command === 'rollback') {
    const result = rollbackLayeredMemoryMigration(
      memoryRoot,
      requireStringArg(args, 'migration-id'),
      requireStringArg(args, 'migration-commit'),
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  const specPath = path.resolve(requireStringArg(args, 'spec'))
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8')) as LayeredMigrationSpec
  if (command === 'plan') {
    process.stdout.write(
      `${JSON.stringify(planLayeredMemoryMigration(memoryRoot, spec), null, 2)}\n`,
    )
    return
  }
  if (command === 'apply') {
    const result = applyLayeredMemoryMigration(
      memoryRoot,
      spec,
      requireStringArg(args, 'confirm-plan'),
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  throw new Error(`Unknown layered migration command: ${command}`)
}

if (isDirectCliInvocation(import.meta.url)) {
  try {
    runLayeredMemoryMigrationCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
