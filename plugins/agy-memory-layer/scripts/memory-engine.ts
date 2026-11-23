#!/usr/bin/env node

/**
 * Direct CAS Memory Transaction Engine & Management API.
 * Mirrors mahiro-pi's ABI2 draft/edit/commit/manage semantics for agy-memory-layer:
 * - CAS expectedHash + baseRevision checks
 * - Surgical replace / patch / append (+ section heading insertion)
 * - One-step commit: true with <dir>/index.md + root index.md auto-sync
 * - Lossless Retention Guard, read_only frontmatter guard, and secret scan
 * - Opt-in shared communication diversion to memory.state/shared-proposals/
 * - Non-destructive Tiered v2 init and explicit dry-run/apply migrate-v2
 * Strict TypeScript `type` aliases only; zero external dependencies.
 */

import { execFileSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { isDirectCliInvocation } from './cli-entrypoint.ts'
import {
  generateProjectMemoryMarkdown,
  generateRulesMarkdown,
  scanCodebase,
} from './init-project-memory.ts'
import {
  inspectCommittedMemoryProjection,
  type MemoryDocument,
  parseMemoryDocument,
} from './layered-memory.ts'
import {
  assertMemoryRepositoryCleanForWrite,
  commitMemoryPaths,
  deleteMemoryFile,
  getMemoryHeadRevision,
  getMemoryRepositoryStatus,
  listCommittedMemoryFiles,
  normalizeMemoryRelativePath,
  readCommittedMemoryFile,
  restoreDeclaredMemoryPaths,
  writeMemoryFile,
} from './memory-repository.ts'
import {
  buildMemoryPalaceReport,
  extractFrontmatterAndLinks,
  type PalaceReport,
} from './memory-retrieval.ts'
import {
  allowedMemoryPath,
  applySurgicalEdit,
  assertLosslessRetention,
  assertReadOnlyFrontmatter,
  assertSafeMemoryContent,
  type EditModeOptions,
  ensureTieredFrontmatter,
  isEditableMemoryPath,
  MEMORY_LIMITS,
  MemorySchemaError,
  utf8Bytes,
} from './memory-schema.ts'
import { memoryStateRootFor, withMemoryWriteLock } from './memory-write-lock.ts'
import {
  exportOfflinePalaceHtml,
  type OfflinePalaceExportResult,
  readScopedMemoryHistory,
  type ScopedHistoryResult,
} from './palace-render.ts'
import {
  getProjectReflectionStepEntry,
  getReflectionPolicy,
  type ProjectStepEntry,
  type ReflectionPolicy,
  type ReflectionTrigger,
  saveReflectionPolicy,
} from './reflection-policy.ts'
import {
  assertNoSharedParagraphCopies,
  createSharedProposal,
  FIXED_SHARED_OWNER,
  inspectSharedSource,
  isSharedOwnerPath,
  mergeCommunicationDocuments,
  resolveEffectiveSharedMemorySettings,
  type SharedMemorySettings,
} from './shared-memory.ts'
import { resolveProjectSlug } from './workspace-identity.ts'

export type MemoryEngineErrorCode =
  | 'HASH_MISMATCH'
  | 'REVISION_CONFLICT'
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_STALE'
  | 'AMBIGUOUS_DRAFT'
  | 'SHARED_OWNER_DIVERTED'
  | 'MIXED_LAYOUT_CONFLICT'
  | 'UNINITIALIZED'

export class MemoryEngineError extends Error {
  readonly code: MemoryEngineErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: MemoryEngineErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'MemoryEngineError'
    this.code = code
    this.details = details
  }
}

export type MemoryDraftEdit = {
  text: string | null
  expectedBaseHash: string | null
}

export type MemoryDraftRecord = {
  id: string
  baseRevision: string | null
  projectSlug: string
  createdAt: string
  updatedAt: string
  edits: Record<string, MemoryDraftEdit>
}

export type EditMemoryOptions = {
  memoryRoot: string
  projectSlug: string
  path: string
  expectedHash: string | null
  text?: string | null
  mode?: EditModeOptions['mode']
  oldText?: string
  newText?: string
  section?: string
  commit?: boolean
  syncIndexes?: boolean
  isolatedDraft?: boolean
  allowShrink?: boolean
  message?: string
  draftId?: string
  sharedSettings?: Partial<SharedMemorySettings>
}

export type EditMemoryResult = {
  committed: boolean
  draft: boolean
  draftId?: string
  path: string
  hash: string | null
  revision?: string | null
  baseRevision?: string | null
  changedPaths?: string[]
  contextActivation?: 'next-invocation'
  activeContextChanged?: boolean
  divertedToSharedProposal?: boolean
  proposalId?: string
  message?: string
}

export type CommitDraftOptions = {
  memoryRoot: string
  revision: string | null
  draftId?: string
  message?: string
  allowShrink?: boolean
  sharedSettings?: Partial<SharedMemorySettings>
}

export type CommitDraftResult = {
  committed: boolean
  revision: string | null
  changedPaths: string[]
  contextActivation: 'next-invocation'
}

export type ManageAction =
  | 'status'
  | 'doctor'
  | 'palace'
  | 'palace_export'
  | 'history'
  | 'init'
  | 'migrate-v2'
  | 'cleanup'
  | 'remember'
  | 'policy'

export type ManageMemoryOptions = {
  memoryRoot: string
  workspacePath?: string
  projectSlug?: string
  action: ManageAction
  text?: string
  path?: string
  section?: string
  dryRun?: boolean
  outputPath?: string
  offset?: number
  limit?: number
  trigger?: ReflectionTrigger
  stepCountThreshold?: number
  model?: string
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function draftsDirFor(memoryRoot: string): string {
  return path.join(memoryStateRootFor(memoryRoot), 'drafts')
}

function draftFilePath(memoryRoot: string, draftId: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(draftId)) {
    throw new MemorySchemaError('INVALID_ARGUMENTS', `Invalid draft ID: ${draftId}`)
  }
  return path.join(draftsDirFor(memoryRoot), `${draftId}.json`)
}

function writeDraftAtomic(memoryRoot: string, draft: MemoryDraftRecord): void {
  const dir = draftsDirFor(memoryRoot)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = draftFilePath(memoryRoot, draft.id)
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(draft, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  })
  fs.renameSync(temp, target)
}

export function listMemoryDrafts(memoryRoot: string): MemoryDraftRecord[] {
  const dir = draftsDirFor(memoryRoot)
  if (!fs.existsSync(dir)) return []
  const drafts: MemoryDraftRecord[] = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json') || name.includes('.tmp')) continue
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, name), 'utf-8'),
      ) as Partial<MemoryDraftRecord>
      if (
        parsed &&
        typeof parsed.id === 'string' &&
        (parsed.baseRevision === null || typeof parsed.baseRevision === 'string') &&
        typeof parsed.projectSlug === 'string' &&
        parsed.edits &&
        typeof parsed.edits === 'object'
      ) {
        drafts.push(parsed as MemoryDraftRecord)
      }
    } catch {
      // Ignore unreadable draft files
    }
  }
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function deleteDraftFile(memoryRoot: string, draftId: string): void {
  const filePath = draftFilePath(memoryRoot, draftId)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

export function deleteMemoryDraft(memoryRoot: string, draftId: string): void {
  deleteDraftFile(memoryRoot, draftId)
}

export function getActiveDraftOverlay(
  memoryRoot: string,
  draftId?: string,
): Record<string, string | null> | undefined {
  const drafts = listMemoryDrafts(memoryRoot)
  if (drafts.length === 0) return undefined
  const selected = draftId ? drafts.find((d) => d.id === draftId) : drafts[0]
  if (!selected) return undefined
  const head = getMemoryHeadRevision(memoryRoot)
  if (selected.baseRevision !== head) return undefined
  const overlay: Record<string, string | null> = {}
  for (const [relPath, entry] of Object.entries(selected.edits)) {
    overlay[relPath] = entry.text
  }
  return overlay
}

function readEffectiveFile(
  memoryRoot: string,
  draft: MemoryDraftRecord,
  relativePath: string,
): string | undefined {
  if (Object.hasOwn(draft.edits, relativePath)) {
    return draft.edits[relativePath]?.text ?? undefined
  }
  const committed = readCommittedMemoryFile(memoryRoot, relativePath)
  return committed === null ? undefined : committed
}

function autoSyncIndexesInDraft(
  memoryRoot: string,
  draft: MemoryDraftRecord,
  targetPath: string,
  targetBody: string,
): void {
  if (
    targetPath === 'Core.md' ||
    targetPath === 'index.md' ||
    targetPath.endsWith('/index.md') ||
    targetPath.startsWith('archives/')
  ) {
    return
  }
  const description =
    extractFrontmatterAndLinks(targetBody).description ??
    `Maintained memory notes for ${targetPath}`

  const indexEntries: Array<{ indexPath: string; pointerTarget: string; summary: string }> = []
  if (targetPath.includes('/')) {
    const dirParts = targetPath.slice(0, targetPath.lastIndexOf('/')).split('/')
    for (let i = 1; i < dirParts.length; i++) {
      const ancestorDir = dirParts.slice(0, i).join('/')
      const childDir = dirParts.slice(0, i + 1).join('/')
      const ancestorIndex = `${ancestorDir}/index.md`
      const childIndex = `${childDir}/index.md`
      if (allowedMemoryPath(ancestorIndex) && allowedMemoryPath(childIndex)) {
        indexEntries.push({
          indexPath: ancestorIndex,
          pointerTarget: childIndex,
          summary: `Index for ${childDir}`,
        })
      }
    }
    const parentIndex = `${dirParts.join('/')}/index.md`
    if (allowedMemoryPath(parentIndex)) {
      indexEntries.push({
        indexPath: parentIndex,
        pointerTarget: targetPath,
        summary: description,
      })
    }
  }
  indexEntries.push({
    indexPath: 'index.md',
    pointerTarget: targetPath,
    summary: description,
  })

  for (const { indexPath, pointerTarget, summary } of indexEntries) {
    const current = readEffectiveFile(memoryRoot, draft, indexPath)
    if (current === undefined) {
      const title = indexPath.endsWith('/index.md')
        ? `${indexPath.slice(0, -'/index.md'.length)} index`
        : 'Memory Index'
      const content = `# ${title}\n\n- [[${pointerTarget}]] — ${summary}\n`
      assertSafeMemoryContent(indexPath, content)
      draft.edits[indexPath] = { text: content, expectedBaseHash: null }
    } else if (!current.includes(`[[${pointerTarget}]]`)) {
      const updated = applySurgicalEdit(current, `- [[${pointerTarget}]] — ${summary}`, {
        mode: 'append',
      })
      if (updated !== null) {
        assertSafeMemoryContent(indexPath, updated)
        const baseCommitted = readCommittedMemoryFile(memoryRoot, indexPath)
        const expectedBaseHash = baseCommitted === null ? null : sha256Hex(baseCommitted)
        draft.edits[indexPath] = {
          text: updated,
          expectedBaseHash: draft.edits[indexPath]?.expectedBaseHash ?? expectedBaseHash,
        }
      }
    }
  }
}

function removeIndexPointersInDraft(
  memoryRoot: string,
  draft: MemoryDraftRecord,
  targetPath: string,
): void {
  if (targetPath === 'Core.md' || targetPath === 'index.md' || targetPath.startsWith('archives/')) {
    return
  }

  const indexPaths: string[] = []
  if (targetPath.endsWith('/index.md')) {
    const parentDir = targetPath.slice(0, -'/index.md'.length)
    if (parentDir.includes('/')) {
      const enclosingIndex = `${parentDir.slice(0, parentDir.lastIndexOf('/'))}/index.md`
      if (allowedMemoryPath(enclosingIndex) && enclosingIndex !== targetPath) {
        indexPaths.push(enclosingIndex)
      }
    }
  } else if (targetPath.includes('/')) {
    const parentIndex = `${targetPath.slice(0, targetPath.lastIndexOf('/'))}/index.md`
    if (allowedMemoryPath(parentIndex)) indexPaths.push(parentIndex)
  }
  indexPaths.push('index.md')

  const pointerToken = `[[${targetPath}]]`
  for (const indexPath of indexPaths) {
    const current = readEffectiveFile(memoryRoot, draft, indexPath)
    if (current === undefined || !current.includes(pointerToken)) continue
    const filteredLines = current.split('\n').filter((line) => !line.includes(pointerToken))
    const collapsed = filteredLines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()
    const updated = collapsed ? `${collapsed}\n` : ''
    assertSafeMemoryContent(indexPath, updated)
    const baseCommitted = readCommittedMemoryFile(memoryRoot, indexPath)
    const expectedBaseHash = baseCommitted === null ? null : sha256Hex(baseCommitted)
    draft.edits[indexPath] = {
      text: updated,
      expectedBaseHash: draft.edits[indexPath]?.expectedBaseHash ?? expectedBaseHash,
    }
  }
}

export function getProjectedSharedOverlay(
  memoryRoot: string,
  sharedSettings?: Partial<SharedMemorySettings>,
): Record<string, string> | undefined {
  const effective = resolveEffectiveSharedMemorySettings(sharedSettings, memoryRoot)
  if (!effective.enabled) return undefined
  const inspection = inspectSharedSource(effective, memoryRoot)
  if (!inspection.valid || !inspection.document) return undefined

  let nativeDoc: MemoryDocument | null = null
  const nativeRaw = readCommittedMemoryFile(memoryRoot, FIXED_SHARED_OWNER)
  if (nativeRaw !== null) {
    const parsed = parseMemoryDocument(nativeRaw, FIXED_SHARED_OWNER, { requireDescription: true })
    if (parsed.diagnostics.length === 0) {
      nativeDoc = {
        relativePath: FIXED_SHARED_OWNER,
        ...(parsed.name ? { name: parsed.name } : {}),
        description: parsed.description,
        body: parsed.body,
        readOnly: parsed.readOnly,
        scope: 'global',
        tier: 'system',
      }
    }
  }
  const { mergedDoc } = mergeCommunicationDocuments(inspection.document, nativeDoc, inspection)
  return {
    [FIXED_SHARED_OWNER]: `---\ndescription: ${mergedDoc.description}\n---\n${mergedDoc.body}\n`,
  }
}

export function editMemory(options: EditMemoryOptions): EditMemoryResult {
  const strippedInput = options.path.startsWith('/')
    ? options.path.replace(/^\/+/, '')
    : options.path
  const candidateInput =
    options.path.startsWith('/') && allowedMemoryPath(strippedInput) ? strippedInput : options.path
  const normalizedPath = normalizeMemoryRelativePath(candidateInput)
  if (!isEditableMemoryPath(normalizedPath)) {
    throw new MemorySchemaError(
      'INVALID_PATH',
      `Path "${normalizedPath}" is not an editable Tiered v2 memory path.`,
    )
  }

  const effectiveShared = resolveEffectiveSharedMemorySettings(
    options.sharedSettings,
    options.memoryRoot,
  )

  if (effectiveShared.enabled && isSharedOwnerPath(normalizedPath)) {
    const projectedBase = getProjectedSharedOverlay(options.memoryRoot, options.sharedSettings)?.[
      FIXED_SHARED_OWNER
    ]
    const baseContent =
      projectedBase ?? readCommittedMemoryFile(options.memoryRoot, normalizedPath) ?? undefined
    const rawNext = applySurgicalEdit(baseContent, options.text, {
      mode: options.mode,
      oldText: options.oldText,
      newText: options.newText,
      section: options.section,
    })
    if (rawNext !== null) {
      assertSafeMemoryContent(normalizedPath, ensureTieredFrontmatter(normalizedPath, rawNext))
    }
    const op: 'write' | 'append' | 'replace' | 'delete' =
      rawNext === null
        ? 'delete'
        : options.mode === 'append'
          ? 'append'
          : options.mode === 'patch'
            ? 'replace'
            : 'write'
    const proposal = createSharedProposal({
      memoryRoot: options.memoryRoot,
      targetPath: FIXED_SHARED_OWNER,
      operation: op,
      sourceRoot: effectiveShared.sourceRoot,
      content: rawNext === null ? '' : ensureTieredFrontmatter(normalizedPath, rawNext),
      message: options.message || `Proposed ${op} via agent_memory_edit`,
    })
    return {
      committed: false,
      draft: false,
      path: normalizedPath,
      hash: null,
      divertedToSharedProposal: true,
      proposalId: proposal.id,
      message: `Shared owner "${FIXED_SHARED_OWNER}" cannot be mutated directly. Diverted to pending shared proposal ${proposal.id}.`,
    }
  }

  return withMemoryWriteLock(options.memoryRoot, `edit memory ${normalizedPath}`, () => {
    if (!fs.existsSync(path.join(options.memoryRoot, '.git'))) {
      throw new MemoryEngineError('UNINITIALIZED', 'Memory repository is not initialized.')
    }
    const lockRevision = getMemoryHeadRevision(options.memoryRoot)
    if (lockRevision !== null) {
      const projection = inspectCommittedMemoryProjection(options.memoryRoot, options.projectSlug)
      if (projection.mode === 'conflict') {
        throw new MemoryEngineError(
          'MIXED_LAYOUT_CONFLICT',
          `Refusing memory edit while layered and legacy active owners overlap:\n${projection.diagnostics.join('\n')}`,
        )
      }
    }

    const existingDrafts = listMemoryDrafts(options.memoryRoot)
    let draft: MemoryDraftRecord
    let previousDraftSnapshot: MemoryDraftRecord | null = null
    if (options.draftId) {
      const found = existingDrafts.find((d) => d.id === options.draftId)
      if (!found) {
        throw new MemoryEngineError('DRAFT_NOT_FOUND', `Unknown memory draft: ${options.draftId}`)
      }
      if (found.baseRevision !== lockRevision) {
        throw new MemoryEngineError(
          'DRAFT_STALE',
          `Draft ${found.id} is based on stale revision ${found.baseRevision}; current HEAD is ${lockRevision}. Run cleanup and re-read before editing.`,
        )
      }
      previousDraftSnapshot = structuredClone(found)
      draft = found
    } else if (options.isolatedDraft === true) {
      draft = {
        id: crypto.randomUUID(),
        baseRevision: lockRevision,
        projectSlug: options.projectSlug,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        edits: {},
      }
    } else {
      const matching = existingDrafts.find((d) => d.baseRevision === lockRevision)
      const stale = existingDrafts.find((d) => d.baseRevision !== lockRevision)
      if (!matching && stale) {
        throw new MemoryEngineError(
          'DRAFT_STALE',
          `A stale uncommitted draft (${stale.id} at ${stale.baseRevision}) exists while HEAD is ${lockRevision}. Run agent_memory_manage({ action: "cleanup" }) before editing.`,
        )
      }
      if (matching) {
        previousDraftSnapshot = structuredClone(matching)
        draft = matching
      } else {
        draft = {
          id: crypto.randomUUID(),
          baseRevision: lockRevision,
          projectSlug: options.projectSlug,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          edits: {},
        }
      }
    }

    const currentText = readEffectiveFile(options.memoryRoot, draft, normalizedPath)
    const actualHash = currentText === undefined ? null : sha256Hex(currentText)
    if (options.expectedHash !== actualHash) {
      throw new MemoryEngineError(
        'HASH_MISMATCH',
        `Content hash mismatch for ${normalizedPath}: expected ${String(options.expectedHash)}, actual ${String(actualHash)}. Read the file again before editing.`,
        { currentHash: actualHash, currentRevision: lockRevision },
      )
    }

    const rawNext = applySurgicalEdit(currentText, options.text, {
      mode: options.mode,
      oldText: options.oldText,
      newText: options.newText,
      section: options.section,
    })

    if (currentText === undefined && rawNext === null) {
      throw new MemorySchemaError(
        'INVALID_ARGUMENTS',
        `Cannot delete non-existent memory file ${normalizedPath}.`,
      )
    }

    if (rawNext === null && (normalizedPath === 'Core.md' || normalizedPath === 'index.md')) {
      throw new MemorySchemaError(
        'INVALID_ARGUMENTS',
        `Cannot remove protected root file ${normalizedPath}.`,
      )
    }

    const nextText = rawNext === null ? null : ensureTieredFrontmatter(normalizedPath, rawNext)
    assertReadOnlyFrontmatter(normalizedPath, currentText, nextText)

    if (nextText !== null) {
      assertSafeMemoryContent(normalizedPath, nextText)
      if (effectiveShared.enabled) {
        const inspection = inspectSharedSource(effectiveShared, options.memoryRoot)
        if (inspection.valid) {
          assertNoSharedParagraphCopies(nextText, normalizedPath, inspection)
        }
      }
    }

    const committedBefore = readCommittedMemoryFile(options.memoryRoot, normalizedPath)
    const committedBaseHash = committedBefore === null ? null : sha256Hex(committedBefore)
    draft.edits[normalizedPath] = {
      text: nextText,
      expectedBaseHash: draft.edits[normalizedPath]?.expectedBaseHash ?? committedBaseHash,
    }
    draft.updatedAt = new Date().toISOString()

    if (options.commit === true || options.syncIndexes === true) {
      if (nextText !== null) {
        autoSyncIndexesInDraft(options.memoryRoot, draft, normalizedPath, nextText)
      } else {
        removeIndexPointersInDraft(options.memoryRoot, draft, normalizedPath)
      }
    }

    writeDraftAtomic(options.memoryRoot, draft)

    if (options.commit === true) {
      try {
        const committed = commitMemoryDraftLocked(
          {
            memoryRoot: options.memoryRoot,
            revision: lockRevision,
            draftId: draft.id,
            message: options.message || `memory: update ${normalizedPath}`,
            allowShrink: options.allowShrink,
            sharedSettings: options.sharedSettings,
          },
          draft,
        )
        return {
          committed: committed.committed,
          draft: false,
          path: normalizedPath,
          hash: nextText === null ? null : sha256Hex(nextText),
          revision: committed.revision,
          changedPaths: committed.changedPaths,
          contextActivation: committed.contextActivation,
        }
      } catch (error) {
        if (previousDraftSnapshot) {
          writeDraftAtomic(options.memoryRoot, previousDraftSnapshot)
        } else {
          deleteDraftFile(options.memoryRoot, draft.id)
        }
        throw error
      }
    }

    return {
      committed: false,
      draft: true,
      draftId: draft.id,
      path: normalizedPath,
      hash: nextText === null ? null : sha256Hex(nextText),
      baseRevision: draft.baseRevision,
      activeContextChanged: false,
    }
  })
}

function commitMemoryDraftLocked(
  options: CommitDraftOptions,
  draft: MemoryDraftRecord,
): CommitDraftResult {
  const changedPaths = Object.keys(draft.edits).sort()
  if (changedPaths.length === 0) {
    deleteDraftFile(options.memoryRoot, draft.id)
    return {
      committed: false,
      revision: getMemoryHeadRevision(options.memoryRoot),
      changedPaths: [],
      contextActivation: 'next-invocation',
    }
  }

  const repoStatus = getMemoryRepositoryStatus(options.memoryRoot)
  if (repoStatus.state === 'uninitialized' || repoStatus.state === 'error') {
    throw new MemoryEngineError('UNINITIALIZED', repoStatus.summary)
  }
  const head = getMemoryHeadRevision(options.memoryRoot)
  if (draft.baseRevision !== head || options.revision !== head) {
    throw new MemoryEngineError(
      'REVISION_CONFLICT',
      `Revision conflict: expected ${String(options.revision)} (draft base ${String(draft.baseRevision)}), current HEAD is ${String(head)}.`,
      { expectedRevision: options.revision, currentRevision: head },
    )
  }
  if (head !== null) {
    assertMemoryRepositoryCleanForWrite(options.memoryRoot)
    const projection = inspectCommittedMemoryProjection(options.memoryRoot, draft.projectSlug)
    if (projection.mode === 'conflict') {
      throw new MemoryEngineError(
        'MIXED_LAYOUT_CONFLICT',
        `Refusing memory commit while layered and legacy active owners overlap:\n${projection.diagnostics.join('\n')}`,
      )
    }
  }

  const baseFiles: Record<string, string | undefined> = {}
  const nextFiles: Record<string, string | undefined> = {}
  let projectedTotalBytes = 0

  const allCommitted = head ? listCommittedMemoryFiles(options.memoryRoot, '') : []
  for (const rel of allCommitted) {
    const content = readCommittedMemoryFile(options.memoryRoot, rel)
    if (content !== null) {
      baseFiles[rel] = content
      if (!Object.hasOwn(draft.edits, rel)) {
        projectedTotalBytes += utf8Bytes(content)
      }
    }
  }

  for (const relPath of changedPaths) {
    const edit = draft.edits[relPath]
    if (!edit) continue
    const prev = baseFiles[relPath]
    const currentBaseHash = prev === undefined ? null : sha256Hex(prev)
    if (edit.expectedBaseHash !== currentBaseHash) {
      throw new MemoryEngineError(
        'HASH_MISMATCH',
        `Committed content changed under draft for ${relPath}. Re-read and reapply.`,
        { path: relPath, currentRevision: head },
      )
    }
    assertReadOnlyFrontmatter(relPath, prev, edit.text)
    if (edit.text !== null) {
      assertSafeMemoryContent(relPath, edit.text)
      projectedTotalBytes += utf8Bytes(edit.text)
    }
    nextFiles[relPath] = edit.text ?? undefined
  }

  if (projectedTotalBytes > MEMORY_LIMITS.totalBytes) {
    throw new MemorySchemaError(
      'BUDGET_EXCEEDED',
      `Projected total memory size (${projectedTotalBytes} bytes) exceeds ${MEMORY_LIMITS.totalBytes}-byte limit.`,
    )
  }

  assertLosslessRetention(baseFiles, nextFiles, changedPaths, options.allowShrink === true)

  try {
    for (const relPath of changedPaths) {
      const edit = draft.edits[relPath]
      if (!edit) continue
      const next = edit.text
      if (next === null) {
        deleteMemoryFile(options.memoryRoot, relPath, { sharedSettings: options.sharedSettings })
      } else {
        writeMemoryFile(options.memoryRoot, relPath, next, {
          sharedSettings: options.sharedSettings,
        })
      }
    }

    let sha: string | undefined
    if (head === null) {
      execFileSync('git', ['-C', options.memoryRoot, 'add', '--', ...changedPaths], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })
      execFileSync(
        'git',
        [
          '-C',
          options.memoryRoot,
          '-c',
          'user.name=Antigravity Memory',
          '-c',
          'user.email=agy-memory-layer@local',
          'commit',
          '-m',
          options.message || 'memory: update maintained knowledge',
          '--',
          ...changedPaths,
        ],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 },
      )
      sha = getMemoryHeadRevision(options.memoryRoot) ?? undefined
    } else {
      const result = commitMemoryPaths({
        memoryRoot: options.memoryRoot,
        relativePaths: changedPaths,
        reason: options.message || 'memory: update maintained knowledge',
        sharedSettings: options.sharedSettings,
      })
      if (!result.committed) {
        deleteDraftFile(options.memoryRoot, draft.id)
        return {
          committed: false,
          revision: head,
          changedPaths: [],
          contextActivation: 'next-invocation',
        }
      }
      sha = result.sha ?? head
    }

    deleteDraftFile(options.memoryRoot, draft.id)
    return {
      committed: true,
      revision: sha ?? null,
      changedPaths,
      contextActivation: 'next-invocation',
    }
  } catch (error) {
    if (head) {
      restoreDeclaredMemoryPaths(options.memoryRoot, head, changedPaths, {
        sharedSettings: options.sharedSettings,
      })
    }
    throw error
  }
}

export function commitMemoryDraft(options: CommitDraftOptions): CommitDraftResult {
  return withMemoryWriteLock(options.memoryRoot, 'commit memory draft', () => {
    const drafts = listMemoryDrafts(options.memoryRoot)
    let draft: MemoryDraftRecord | undefined
    if (options.draftId) {
      draft = drafts.find((d) => d.id === options.draftId)
      if (!draft) {
        throw new MemoryEngineError('DRAFT_NOT_FOUND', `Unknown memory draft: ${options.draftId}`)
      }
    } else if (drafts.length === 1) {
      draft = drafts[0]
    } else if (drafts.length === 0) {
      throw new MemoryEngineError('DRAFT_NOT_FOUND', 'No active memory draft to commit.')
    } else {
      throw new MemoryEngineError(
        'AMBIGUOUS_DRAFT',
        `Multiple memory drafts exist (${drafts.map((d) => d.id).join(', ')}); pass draftId or run cleanup.`,
      )
    }
    return commitMemoryDraftLocked(options, draft)
  })
}

function buildStarterCoreMd(): string {
  return `---
name: core
description: Core identity, persona, and operating invariants.
---
# Companion Core

- Name: Companion
- Posture: Concise, evidence-backed coding collaborator; verify claims against live files and test output before reporting.
- Collaboration: Follow current user instructions and repository owners first; keep durable identity, preferences, and cross-session lessons in MemFS.
`
}

function extractFirstSummaryLine(raw: string | null | undefined): string | null {
  if (!raw) return null
  const normalized = raw.replace(/\r\n?/g, '\n')
  let body = normalized
  if (body.startsWith('---\n')) {
    const closeIdx = body.indexOf('\n---', 4)
    if (closeIdx !== -1) {
      const afterClose = body.indexOf('\n', closeIdx + 4)
      body = afterClose === -1 ? '' : body.slice(afterClose + 1)
    }
  }
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---')) continue
    return trimmed.replace(/^[-*]\s+/, '').slice(0, 200)
  }
  return null
}

function buildMigratedCoreMd(memoryRoot: string, writes: Record<string, string>): string {
  const identityRaw =
    writes['system/human/identity.md'] ??
    readCommittedMemoryFile(memoryRoot, 'system/human/identity.md')
  const personaRaw =
    writes['system/persona.md'] ?? readCommittedMemoryFile(memoryRoot, 'system/persona.md')
  const humanSummary = extractFirstSummaryLine(identityRaw)
  const personaSummary = extractFirstSummaryLine(personaRaw)
  if (!humanSummary && !personaSummary) {
    return buildStarterCoreMd()
  }
  const lines = [
    '---',
    'name: core',
    'description: Core identity, persona, and operating invariants.',
    '---',
    '# Core Memory',
    '',
    ...(humanSummary ? [`- **Human**: ${humanSummary} (see [[system/human/identity.md]])`] : []),
    ...(personaSummary ? [`- **Companion**: ${personaSummary} (see [[system/persona.md]])`] : []),
    '- **Navigation**: Use [[index.md]] for cross-project and deferred memory pointers; repo instructions and live tool output outrank memory.',
  ]
  return `${lines.join('\n')}\n`
}

function buildStarterFiles(projectSlug: string, workspacePath: string): Record<string, string> {
  const scan = scanCodebase(workspacePath)
  const overviewBody = generateProjectMemoryMarkdown(scan)
  const conventionsBody = generateRulesMarkdown(scan)

  return {
    'Core.md': buildStarterCoreMd(),
    'index.md': `# Memory Index

## System
- [[system/persona.md]] — companion identity and operating posture
- [[system/human/identity.md]] — collaborator identity and personal context
- [[system/human/prefs/coding.md]] — cross-project coding and tooling defaults
- [[system/human/prefs/communication.md]] — language, tone, and response style
- [[system/human/prefs/workflow.md]] — verification, delegation, and Git habits

## Reference & Procedures
- [[reference/index.md]] — global deferred reference notes
- [[procedures/index.md]] — reusable operational procedures

## Projects
- [[projects/${projectSlug}/system/overview.md]] — architecture and commands for ${projectSlug}
- [[projects/${projectSlug}/system/conventions.md]] — conventions and invariants for ${projectSlug}
- [[projects/${projectSlug}/reference/index.md]] — deferred deep-dives for ${projectSlug}
`,
    'system/index.md': `# system index

- [[system/persona.md]] — companion identity and operating posture
- [[system/human/index.md]] — human identity and preferences
`,
    'system/persona.md': `---
name: persona
description: Persistent agent identity and operating posture.
---
# Agent Persona

- Act as a stateful, evidence-backed pair programmer.
- Keep maintained memory synthesized as principles with reasons rather than incident logs.
`,
    'system/human/index.md': `# system/human index

- [[system/human/identity.md]] — collaborator identity, role, and personal context
- [[system/human/prefs/index.md]] — recurring preference files
`,
    'system/human/identity.md': `---
name: identity
description: Stable user identity and collaboration context.
---
# Human Identity

- Record confirmed identity, role, and enduring personal context from direct evidence only.
`,
    'system/human/prefs/index.md': `# system/human/prefs index

- [[system/human/prefs/coding.md]] — cross-project coding defaults
- [[system/human/prefs/communication.md]] — language, tone, and communication style
- [[system/human/prefs/workflow.md]] — verification, delegation, and Git habits
`,
    'system/human/prefs/coding.md': `---
name: coding
description: Cross-project coding defaults used when repository guidance is silent.
---
# Coding Defaults

- Always use exact version flags (\`-E\`) when installing dependencies.
- Keep TypeScript types strict and avoid \`any\`.
`,
    'system/human/prefs/communication.md': `---
name: communication
description: Stable communication and response-style preferences.
---
# Communication Preferences

- Respond in Thai or English matching the user's request.
- Keep responses concise, direct, and grounded in observed evidence.
`,
    'system/human/prefs/workflow.md': `---
name: workflow
description: Verification, delegation, and Git review workflow defaults.
---
# Workflow Preferences

- Present test results and diffs for user review before committing; never commit or push autonomously.
- Re-verify runtime behavior after edits before claiming completion.
`,
    'reference/index.md': `# reference index

Add cross-project deferred reference notes here and link them with request-shaped cues.
`,
    'procedures/index.md': `# procedures index

Add reusable operational checklists here.
`,
    [`projects/${projectSlug}/index.md`]: `# projects/${projectSlug} index

- [[projects/${projectSlug}/system/index.md]] — always-loaded system memory for ${projectSlug}
- [[projects/${projectSlug}/reference/index.md]] — deferred reference notes for ${projectSlug}
`,
    [`projects/${projectSlug}/system/index.md`]: `# projects/${projectSlug}/system index

- [[projects/${projectSlug}/system/overview.md]] — architecture, tech stack, and commands
- [[projects/${projectSlug}/system/conventions.md]] — repository conventions and invariants
`,
    [`projects/${projectSlug}/system/overview.md`]: `---
name: overview
description: Architecture, tech stack, and development commands for ${projectSlug}.
---
${overviewBody}`,
    [`projects/${projectSlug}/system/conventions.md`]: `---
name: conventions
description: Repository conventions and execution invariants for ${projectSlug}.
---
${conventionsBody}`,
    [`projects/${projectSlug}/reference/index.md`]: `# projects/${projectSlug}/reference index

Add deferred project reference notes here and link them from root index.md.
`,
  }
}

function initializeMemoryV2(options: {
  memoryRoot: string
  workspacePath: string
  projectSlug: string
  dryRun?: boolean
}): Record<string, unknown> {
  const { memoryRoot, workspacePath, projectSlug, dryRun } = options
  const initializedGit = fs.existsSync(path.join(memoryRoot, '.git'))

  if (initializedGit) {
    const projection = inspectCommittedMemoryProjection(memoryRoot, projectSlug)
    if (projection.mode === 'conflict') {
      throw new MemoryEngineError(
        'MIXED_LAYOUT_CONFLICT',
        'Cannot initialize Tiered v2 memory while layered and legacy active owners overlap.',
      )
    }
    if (projection.mode === 'legacy') {
      throw new MemoryEngineError(
        'MIXED_LAYOUT_CONFLICT',
        'Legacy active memory detected. Run migrate-v2 instead of init to upgrade losslessly.',
      )
    }
  }

  const starter = buildStarterFiles(projectSlug, workspacePath)
  const existing = new Set(initializedGit ? listCommittedMemoryFiles(memoryRoot, '') : [])
  const sharedSettings = resolveEffectiveSharedMemorySettings(undefined, memoryRoot)
  const toCreate: Record<string, string> = {}
  for (const [relPath, content] of Object.entries(starter)) {
    if (sharedSettings.enabled && isSharedOwnerPath(relPath)) continue
    if (!existing.has(relPath)) {
      toCreate[relPath] = content
    }
  }

  // If index.md exists already but lacks this project's system pointers, append them cleanly
  let indexUpdate: string | null = null
  if (existing.has('index.md')) {
    const currentIndex = readCommittedMemoryFile(memoryRoot, 'index.md') ?? ''
    const missingLines: string[] = []
    const projPointers = [
      `- [[projects/${projectSlug}/system/overview.md]] — architecture and commands for ${projectSlug}`,
      `- [[projects/${projectSlug}/system/conventions.md]] — conventions and invariants for ${projectSlug}`,
      `- [[projects/${projectSlug}/reference/index.md]] — deferred deep-dives for ${projectSlug}`,
    ]
    for (const line of projPointers) {
      const target = line.match(/\[\[([^\]]+)\]\]/)?.[1]
      if (target && !currentIndex.includes(`[[${target}]]`)) missingLines.push(line)
    }
    if (missingLines.length > 0) {
      indexUpdate = `${currentIndex.trimEnd()}\n${missingLines.join('\n')}\n`
    }
  }

  const createdPaths = Object.keys(toCreate).sort()
  if (createdPaths.length === 0 && indexUpdate === null) {
    return {
      status: 'ALREADY_INITIALIZED',
      projectSlug,
      revision: getMemoryHeadRevision(memoryRoot),
      filesCreated: [],
    }
  }

  if (dryRun) {
    return {
      status: 'DRY_RUN',
      projectSlug,
      filesToCreate: createdPaths,
      willUpdateRootIndex: indexUpdate !== null,
    }
  }

  if (!initializedGit) {
    if (
      fs.existsSync(memoryRoot) &&
      fs.readdirSync(memoryRoot).some((entry) => entry !== '.DS_Store')
    ) {
      throw new MemoryEngineError(
        'UNINITIALIZED',
        `Refusing to initialize non-empty memory directory without .git: ${memoryRoot}`,
      )
    }
    fs.mkdirSync(memoryRoot, { recursive: true })
    try {
      execFileSync('git', ['-C', memoryRoot, 'init', '-b', 'main'], {
        stdio: 'ignore',
        timeout: 5000,
      })
    } catch {
      execFileSync('git', ['-C', memoryRoot, 'init'], { stdio: 'ignore', timeout: 5000 })
    }
  }

  return withMemoryWriteLock(memoryRoot, `init tiered v2 ${projectSlug}`, () => {
    const head = getMemoryHeadRevision(memoryRoot)
    if (head !== null) assertMemoryRepositoryCleanForWrite(memoryRoot)
    const changedPaths = [...createdPaths, ...(indexUpdate !== null ? ['index.md'] : [])]
    try {
      for (const relPath of createdPaths) {
        const content = toCreate[relPath]
        if (content !== undefined) {
          writeMemoryFile(memoryRoot, relPath, content)
        }
      }
      if (indexUpdate !== null) {
        writeMemoryFile(memoryRoot, 'index.md', indexUpdate)
      }
      if (head === null) {
        execFileSync('git', ['-C', memoryRoot, 'add', '--', ...changedPaths], {
          stdio: 'ignore',
          timeout: 10_000,
        })
        execFileSync(
          'git',
          [
            '-C',
            memoryRoot,
            '-c',
            'user.name=Antigravity Memory',
            '-c',
            'user.email=agy-memory-layer@local',
            'commit',
            '-m',
            `memory(init): initialize tiered v2 memory for ${projectSlug}`,
            '--',
            ...changedPaths,
          ],
          { stdio: 'ignore', timeout: 10_000 },
        )
      } else {
        commitMemoryPaths({
          memoryRoot,
          relativePaths: changedPaths,
          reason: `memory(init): initialize tiered v2 memory for ${projectSlug}`,
        })
      }
    } catch (error) {
      if (head) restoreDeclaredMemoryPaths(memoryRoot, head, changedPaths)
      throw error
    }
    return {
      status: 'INITIALIZED',
      projectSlug,
      revision: getMemoryHeadRevision(memoryRoot),
      filesCreated: changedPaths,
    }
  })
}

function buildMigrationRootIndex(
  memoryRoot: string,
  allPaths: readonly string[],
  draftMap: Record<string, string>,
): string {
  const pathSet = new Set(allPaths)
  const descFor = (target: string, fallback: string): string => {
    const text = draftMap[target] ?? readCommittedMemoryFile(memoryRoot, target) ?? ''
    return extractFrontmatterAndLinks(text).description ?? fallback
  }

  const systemFiles = allPaths
    .filter((p) => p.startsWith('system/') && !p.endsWith('/index.md') && p.endsWith('.md'))
    .sort()

  const refProcTargets = (['reference/index.md', 'procedures/index.md'] as const).filter((p) =>
    pathSet.has(p),
  )

  const projectSlugs = [
    ...new Set(
      allPaths
        .map((p) => {
          const match = /^projects\/([^/]+)\//.exec(p)
          return match?.[1] ?? null
        })
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ].sort()

  const lines: string[] = [
    '---',
    'name: index',
    'description: Top-level memory map and deferred navigation cues.',
    '---',
    '# Memory Index',
    '',
  ]

  if (systemFiles.length > 0) {
    lines.push('## System')
    for (const target of systemFiles) {
      lines.push(`- [[${target}]] — ${descFor(target, `System memory (${target})`)}`)
    }
    lines.push('')
  }

  if (refProcTargets.length > 0) {
    lines.push('## Reference & Procedures')
    for (const target of refProcTargets) {
      const label =
        target === 'reference/index.md'
          ? 'Global deferred reference notes'
          : 'Reusable operational procedures'
      lines.push(`- [[${target}]] — ${descFor(target, label)}`)
    }
    lines.push('')
  }

  if (projectSlugs.length > 0) {
    lines.push('## Projects')
    for (const slug of projectSlugs) {
      const candidates = [
        `projects/${slug}/system/index.md`,
        `projects/${slug}/reference/index.md`,
        `projects/${slug}/learnings/index.md`,
      ].filter((candidate) => pathSet.has(candidate))
      if (candidates.length > 0) {
        for (const target of candidates) {
          lines.push(`- [[${target}]] — ${descFor(target, `Project memory index (${target})`)}`)
        }
      } else if (pathSet.has(`projects/${slug}/index.md`)) {
        const target = `projects/${slug}/index.md`
        lines.push(`- [[${target}]] — ${descFor(target, `Project memory index (${slug})`)}`)
      }
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

export function migrateMemoryToV2(options: {
  memoryRoot: string
  projectSlug: string
  dryRun?: boolean
}): Record<string, unknown> {
  const { memoryRoot, projectSlug, dryRun } = options
  if (!fs.existsSync(path.join(memoryRoot, '.git'))) {
    throw new MemoryEngineError('UNINITIALIZED', 'Memory repository is not initialized.')
  }
  const head = getMemoryHeadRevision(memoryRoot)
  if (!head) {
    throw new MemoryEngineError('UNINITIALIZED', 'Memory repository has no committed HEAD.')
  }

  const projection = inspectCommittedMemoryProjection(memoryRoot, projectSlug)
  if (projection.mode === 'conflict') {
    throw new MemoryEngineError(
      'MIXED_LAYOUT_CONFLICT',
      `Refusing migrate-v2 with mixed legacy/layered ownership:\n${projection.diagnostics.join('\n')}`,
    )
  }

  const committed = listCommittedMemoryFiles(memoryRoot, '')
  const existingSet = new Set(committed)
  const writes: Record<string, string> = {}
  const removals: string[] = []
  const archivedOriginals: string[] = []

  if (projection.mode === 'legacy') {
    const archivePrefix = `archives/legacy-v1-${head.slice(0, 12)}`
    const legacyPaths = projection.legacyPaths
    for (const legacyPath of legacyPaths) {
      const content = readCommittedMemoryFile(memoryRoot, legacyPath)
      if (content === null) continue
      const archivePath = `${archivePrefix}/${legacyPath}`
      const existingArchive = readCommittedMemoryFile(memoryRoot, archivePath)
      if (existingArchive !== null && existingArchive !== content) {
        throw new MemoryEngineError(
          'MIXED_LAYOUT_CONFLICT',
          `Archive collision at ${archivePath}; existing archive content differs.`,
        )
      }
      if (existingArchive === null) {
        writes[archivePath] = content
      }
      archivedOriginals.push(archivePath)

      let targetPath: string
      let name: string
      let desc: string
      if (legacyPath === 'global/persona.md') {
        targetPath = 'system/persona.md'
        name = 'persona'
        desc = 'Persistent agent identity and operating posture.'
      } else if (legacyPath === 'global/human.md') {
        targetPath = 'system/human/identity.md'
        name = 'identity'
        desc = 'Stable user identity and collaboration context.'
      } else {
        const match = /^projects\/([^/]+)\/(project|rules)\.md$/.exec(legacyPath)
        const slug = match?.[1] ?? projectSlug
        const kind = match?.[2] ?? 'project'
        targetPath =
          kind === 'project'
            ? `projects/${slug}/system/overview.md`
            : `projects/${slug}/system/conventions.md`
        name = kind === 'project' ? 'overview' : 'conventions'
        desc =
          kind === 'project'
            ? `Architecture and domain context for ${slug}.`
            : `Repository conventions and invariants for ${slug}.`
      }

      if (!existingSet.has(targetPath) && !writes[targetPath]) {
        const hasFm = /^---\n[\s\S]*?\n---(?:\n|$)/.test(content)
        const withNewline = content.endsWith('\n') ? content : `${content}\n`
        if (hasFm) {
          const meta = extractFrontmatterAndLinks(withNewline)
          writes[targetPath] = meta.description
            ? withNewline
            : withNewline.replace(/\n---(\n|$)/, `\ndescription: ${desc}\n---$1`)
        } else {
          writes[targetPath] = `---\nname: ${name}\ndescription: ${desc}\n---\n${withNewline}`
        }
      }
      removals.push(legacyPath)
    }
  }

  const allAfterPaths = [
    ...new Set([...committed.filter((p) => !removals.includes(p)), ...Object.keys(writes)]),
  ]

  if (!existingSet.has('Core.md')) {
    writes['Core.md'] = buildMigratedCoreMd(memoryRoot, writes)
    allAfterPaths.push('Core.md')
  }

  // Generate missing <dir>/index.md files (including ancestors)
  const neededDirs = new Set<string>()
  for (const relPath of allAfterPaths) {
    if (!relPath.endsWith('.md') || relPath.startsWith('archives/')) continue
    if (!relPath.includes('/')) continue
    const parts = relPath.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      const candidateIndex = `${dir}/index.md`
      if (allowedMemoryPath(candidateIndex)) {
        neededDirs.add(dir)
      }
    }
  }

  const postExistingSet = new Set(allAfterPaths)
  for (const dir of [...neededDirs].sort((a, b) => b.length - a.length || a.localeCompare(b))) {
    const idxPath = `${dir}/index.md`
    if (postExistingSet.has(idxPath)) continue
    const prefix = `${dir}/`
    const directFiles = allAfterPaths
      .filter((p) => p.startsWith(prefix) && p !== idxPath && !p.slice(prefix.length).includes('/'))
      .sort()
    const subDirIndexes = [...neededDirs]
      .filter((d) => d.startsWith(prefix) && d.slice(prefix.length).indexOf('/') === -1)
      .map((d) => `${d}/index.md`)
      .sort()
    const lines = [...directFiles, ...subDirIndexes].map((target) => {
      const text = writes[target] ?? readCommittedMemoryFile(memoryRoot, target) ?? ''
      const desc =
        extractFrontmatterAndLinks(text).description ??
        (target.endsWith('/index.md')
          ? `Index for ${target.slice(0, -'/index.md'.length)}`
          : `Maintained memory (${target})`)
      return `- [[${target}]] — ${desc}`
    })
    writes[idxPath] =
      `---\ndescription: Directory index for ${dir}.\n---\n# ${dir} index\n\n${lines.join('\n') || 'Directory index.'}\n`
    postExistingSet.add(idxPath)
    allAfterPaths.push(idxPath)
  }

  if (!existingSet.has('index.md')) {
    writes['index.md'] = buildMigrationRootIndex(memoryRoot, allAfterPaths, writes)
    allAfterPaths.push('index.md')
  }

  const writePaths = Object.keys(writes).sort()
  const changedPaths = [...new Set([...writePaths, ...removals])].sort()
  if (changedPaths.length === 0) {
    return {
      status: 'ALREADY_TIERED_V2',
      revision: head,
      projectSlug,
      changedPaths: [],
    }
  }

  if (dryRun) {
    return {
      status: 'DRY_RUN',
      layoutBefore: projection.mode,
      revision: head,
      projectSlug,
      writes: writePaths,
      removals: removals.sort(),
      archivedOriginals: archivedOriginals.sort(),
    }
  }

  return withMemoryWriteLock(memoryRoot, 'migrate memory to tiered v2', () => {
    assertMemoryRepositoryCleanForWrite(memoryRoot)
    const liveHead = getMemoryHeadRevision(memoryRoot)
    if (liveHead !== head) {
      throw new MemoryEngineError(
        'REVISION_CONFLICT',
        `Memory HEAD changed during migration planning (${head} -> ${String(liveHead)}).`,
      )
    }
    try {
      for (const relPath of writePaths) {
        const nextText = writes[relPath]
        if (nextText !== undefined) {
          writeMemoryFile(memoryRoot, relPath, nextText)
        }
      }
      for (const relPath of removals) {
        deleteMemoryFile(memoryRoot, relPath)
      }
      const commitRes = commitMemoryPaths({
        memoryRoot,
        relativePaths: changedPaths,
        reason: `memory(migrate-v2): upgrade layout to Tiered v2 (${projection.mode})`,
      })
      return {
        status: 'MIGRATED_V2',
        layoutBefore: projection.mode,
        revision: commitRes.sha ?? liveHead,
        projectSlug,
        writes: writePaths,
        removals: removals.sort(),
        archivedOriginals: archivedOriginals.sort(),
      }
    } catch (error) {
      restoreDeclaredMemoryPaths(memoryRoot, head, changedPaths)
      throw error
    }
  })
}

function applySharedOwnerProjection(
  fileMap: Record<string, string | undefined>,
  projection: ReturnType<typeof inspectCommittedMemoryProjection> | null,
): void {
  if (!projection?.sharedSource || fileMap[FIXED_SHARED_OWNER] !== undefined) return
  const sharedDoc = projection.globalSystem.find((d) => isSharedOwnerPath(d.relativePath))
  if (!sharedDoc) return
  fileMap[FIXED_SHARED_OWNER] =
    `---\ndescription: ${sharedDoc.description}\n---\n${sharedDoc.body}\n`
}

function runDoctor(memoryRoot: string, projectSlug: string): Record<string, unknown> {
  const repoStatus = getMemoryRepositoryStatus(memoryRoot)
  const revision = getMemoryHeadRevision(memoryRoot)
  const drafts = listMemoryDrafts(memoryRoot)
  if (!revision) {
    return {
      healthy: false,
      initialized: false,
      projectSlug,
      repositoryState: repoStatus.state,
      issues: ['MemFS repository is uninitialized or has no committed HEAD.'],
    }
  }

  const projection = inspectCommittedMemoryProjection(memoryRoot, projectSlug)
  const committed = listCommittedMemoryFiles(memoryRoot, '').filter((p) => p.endsWith('.md'))
  const fileMap: Record<string, string | undefined> = {}
  for (const relPath of committed) {
    if (!allowedMemoryPath(relPath, undefined)) continue
    fileMap[relPath] = readCommittedMemoryFile(memoryRoot, relPath) ?? undefined
  }
  applySharedOwnerProjection(fileMap, projection)
  const palace: PalaceReport = buildMemoryPalaceReport({
    revision,
    projectSlug,
    files: fileMap,
  })

  const activeSet = new Set(committed)
  const missingRootFiles = (['Core.md', 'index.md'] as const).filter((f) => !activeSet.has(f))

  const missingDirectoryIndexes: string[] = []
  const candidateDirs = new Set<string>()
  for (const p of committed) {
    if (p.startsWith('archives/') || !p.includes('/')) continue
    const parts = p.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      const idx = `${dir}/index.md`
      if (allowedMemoryPath(idx)) candidateDirs.add(idx)
    }
  }
  for (const idx of [...candidateDirs].sort()) {
    if (!activeSet.has(idx)) missingDirectoryIndexes.push(idx)
  }

  const missingDescriptions: string[] = []
  const linkedTargets = new Set<string>()
  for (const [relPath, text] of Object.entries(fileMap)) {
    if (!text || relPath.startsWith('archives/')) continue
    const meta = extractFrontmatterAndLinks(text)
    if (
      relPath !== 'Core.md' &&
      relPath !== 'index.md' &&
      !relPath.endsWith('/index.md') &&
      !relPath.startsWith('procedures/') &&
      !relPath.startsWith('global/') &&
      !/^projects\/[^/]+\/learnings\//.test(relPath) &&
      !meta.description
    ) {
      missingDescriptions.push(relPath)
    }
    const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/') + 1) : ''
    for (const link of meta.links) {
      const normalized = link.endsWith('.md') ? link : `${link}.md`
      linkedTargets.add(link)
      linkedTargets.add(normalized)
      if (dir && !link.includes('/')) {
        linkedTargets.add(`${dir}${link}`)
        linkedTargets.add(`${dir}${normalized}`)
      }
    }
  }

  const orphanFiles = committed
    .filter(
      (p) =>
        p !== 'Core.md' &&
        p !== 'index.md' &&
        !p.endsWith('/index.md') &&
        !p.startsWith('archives/') &&
        (p.startsWith('reference/') ||
          p.startsWith(`projects/${projectSlug}/reference/`) ||
          p.startsWith('procedures/')) &&
        !linkedTargets.has(p),
    )
    .sort()

  const estimatedActiveTokens = Math.ceil(palace.budget.alwaysLoadedBytes / 4)
  const withinBudget =
    estimatedActiveTokens <= 32_000 && palace.budget.totalBytesUsed <= MEMORY_LIMITS.totalBytes
  const unmigratedLegacyPaths = projection.legacyPaths

  const issues: string[] = []
  if (repoStatus.state !== 'clean') issues.push(`MemFS working tree is ${repoStatus.state}.`)
  if (projection.mode === 'conflict') issues.push(...projection.diagnostics)
  if (!withinBudget) {
    issues.push(
      `Always-loaded memory (~${estimatedActiveTokens} tokens) or total bytes exceeds ceiling.`,
    )
  }
  if (palace.coverage.criticalBrokenLinksTotal > 0) {
    issues.push(
      `Found ${palace.coverage.criticalBrokenLinksTotal} critical broken [[wiki-link]](s).`,
    )
  }
  if (missingDescriptions.length > 0) {
    issues.push(`Missing frontmatter description in: ${missingDescriptions.join(', ')}`)
  }

  return {
    healthy: issues.length === 0,
    revision,
    projectSlug,
    layoutMode: projection.mode,
    repositoryState: repoStatus.state,
    estimatedActiveTokens,
    budgetTokens: 32_000,
    withinBudget,
    fileCount: palace.budget.fileCount,
    totalBytesUsed: palace.budget.totalBytesUsed,
    alwaysLoadedBytes: palace.budget.alwaysLoadedBytes,
    missingRootFiles,
    missingDirectoryIndexes,
    missingDescriptions,
    orphanFiles,
    unmigratedLegacyPaths,
    brokenLinksTotal: palace.coverage.brokenLinksTotal,
    criticalBrokenLinksTotal: palace.coverage.criticalBrokenLinksTotal,
    advisoryBrokenLinksTotal: palace.coverage.advisoryBrokenLinksTotal,
    brokenLinks: palace.brokenLinks,
    activeDrafts: drafts.map((d) => ({
      id: d.id,
      baseRevision: d.baseRevision,
      editedPaths: Object.keys(d.edits),
    })),
    issues,
  }
}

export function manageMemory(options: ManageMemoryOptions): Record<string, unknown> {
  const memoryRoot = path.resolve(options.memoryRoot)
  const workspacePath = options.workspacePath || process.cwd()
  const projectSlug = options.projectSlug || resolveProjectSlug(workspacePath, memoryRoot)

  switch (options.action) {
    case 'status': {
      const repoStatus = getMemoryRepositoryStatus(memoryRoot)
      const revision = getMemoryHeadRevision(memoryRoot)
      const projection = revision ? inspectCommittedMemoryProjection(memoryRoot, projectSlug) : null
      const drafts = listMemoryDrafts(memoryRoot)
      const policy = getReflectionPolicy(memoryRoot)
      const steps: ProjectStepEntry = getProjectReflectionStepEntry(memoryRoot, projectSlug)
      const sharedSettings = resolveEffectiveSharedMemorySettings(undefined, memoryRoot)
      return {
        memoryRoot,
        projectSlug,
        initialized: repoStatus.state !== 'uninitialized',
        repositoryState: repoStatus.state,
        layoutMode: projection?.mode ?? 'empty',
        revision,
        activeDrafts: drafts.map((d) => ({
          id: d.id,
          baseRevision: d.baseRevision,
          editedPaths: Object.keys(d.edits),
        })),
        reflectionPolicy: policy,
        reflectionSteps: steps,
        sharedMemory: {
          enabled: sharedSettings.enabled,
          sourceRoot: sharedSettings.sourceRoot,
          sharedOwner: sharedSettings.sharedOwner,
        },
        healthy:
          repoStatus.state === 'clean' &&
          projection !== null &&
          projection.mode !== 'conflict' &&
          projection.diagnostics.length === 0,
      }
    }

    case 'doctor':
      return runDoctor(memoryRoot, projectSlug)

    case 'palace': {
      const revision = getMemoryHeadRevision(memoryRoot)
      const projection = revision ? inspectCommittedMemoryProjection(memoryRoot, projectSlug) : null
      const committed = revision ? listCommittedMemoryFiles(memoryRoot, '') : []
      const fileMap: Record<string, string | undefined> = {}
      for (const relPath of committed) {
        if (!relPath.endsWith('.md') || !allowedMemoryPath(relPath, undefined)) continue
        fileMap[relPath] = readCommittedMemoryFile(memoryRoot, relPath) ?? undefined
      }
      applySharedOwnerProjection(fileMap, projection)
      return {
        palace: buildMemoryPalaceReport({ revision, projectSlug, files: fileMap }),
      }
    }

    case 'palace_export': {
      const exported: OfflinePalaceExportResult = exportOfflinePalaceHtml({
        memoryRoot,
        projectSlug,
        outputPath: options.outputPath,
      })
      return exported
    }

    case 'history': {
      const history: ScopedHistoryResult = readScopedMemoryHistory({
        memoryRoot,
        projectSlug,
        offset: options.offset ?? 0,
        limit: options.limit ?? 32,
      })
      return history
    }

    case 'init':
      return initializeMemoryV2({
        memoryRoot,
        workspacePath,
        projectSlug,
        dryRun: options.dryRun,
      })

    case 'migrate-v2':
      return migrateMemoryToV2({
        memoryRoot,
        projectSlug,
        dryRun: options.dryRun,
      })

    case 'cleanup': {
      const drafts = listMemoryDrafts(memoryRoot)
      for (const draft of drafts) {
        deleteDraftFile(memoryRoot, draft.id)
      }
      return {
        cleaned: true,
        reclaimedDrafts: drafts.length,
        reclaimedIds: drafts.map((d) => d.id),
      }
    }

    case 'remember': {
      if (!options.text?.trim()) {
        throw new MemorySchemaError('INVALID_ARGUMENTS', 'remember action requires non-empty text.')
      }
      const targetPath = options.path?.trim() || 'system/human/notes.md'
      const committed = readCommittedMemoryFile(memoryRoot, targetPath)
      const expectedHash = committed === null ? null : sha256Hex(committed)
      const bullet = options.text.trim().startsWith('-')
        ? options.text.trim()
        : `- ${options.text.trim()}`
      return editMemory({
        memoryRoot,
        projectSlug,
        path: targetPath,
        expectedHash,
        text: bullet,
        mode: 'append',
        ...(options.section ? { section: options.section } : {}),
        commit: true,
        isolatedDraft: true,
        message: `memory(remember): update ${targetPath}`,
      })
    }

    case 'policy': {
      if (
        options.trigger === undefined &&
        options.stepCountThreshold === undefined &&
        options.model === undefined
      ) {
        return {
          policy: getReflectionPolicy(memoryRoot),
          steps: getProjectReflectionStepEntry(memoryRoot, projectSlug),
        }
      }
      const updated: ReflectionPolicy = saveReflectionPolicy(memoryRoot, {
        ...(options.trigger !== undefined ? { trigger: options.trigger } : {}),
        ...(options.stepCountThreshold !== undefined
          ? { stepCountThreshold: options.stepCountThreshold }
          : {}),
        ...(options.model !== undefined ? { model: options.model } : {}),
      })
      return {
        updated: true,
        policy: updated,
        steps: getProjectReflectionStepEntry(memoryRoot, projectSlug),
      }
    }

    default:
      throw new MemorySchemaError(
        'INVALID_ARGUMENTS',
        `Unknown manage action: ${String(options.action)}`,
      )
  }
}

if (isDirectCliInvocation(import.meta.url)) {
  const args = process.argv.slice(2)
  const action = (args[0] || 'status') as ManageAction
  const memoryRoot = process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory')
  const dryRun = args.includes('--dry-run')
  const textIdx = args.indexOf('--text')
  const text = textIdx >= 0 ? args[textIdx + 1] : undefined
  const outIdx = args.indexOf('--out')
  const outputPath = outIdx >= 0 ? args[outIdx + 1] : undefined
  const result = manageMemory({
    memoryRoot,
    workspacePath: process.cwd(),
    action,
    dryRun,
    text,
    outputPath,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
