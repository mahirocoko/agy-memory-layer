#!/usr/bin/env node

/**
 * Opt-in shared human communication adapter for agy-memory-layer.
 *
 * Connects Letta/Cursor/Agy shared human communication knowledge through
 * committed-only Git inspection, paragraph-level deduplication, native-addition
 * preservation, and proposal diversion outside Git MemFS.
 */

import { execFileSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { isDirectCliInvocation } from './cli-entrypoint.ts'
import { type MemoryDocument, parseMemoryDocument } from './layered-memory.ts'
import { getMemoryHeadRevision } from './memory-repository.ts'

export const FIXED_SHARED_OWNER = 'system/human/prefs/communication.md'
export const NATIVE_COMMUNICATION_PATH = 'system/human/prefs/communication.md'
export const SYSTEM_FILE_MAX_CHARS = 20_000

export type SharedMemorySettings = {
  enabled: boolean
  sourceRoot: string | null
  sharedOwner: string
}

export type SharedSourceInspection = {
  enabled: boolean
  sourceRoot: string | null
  sharedOwner: string
  valid: boolean
  pinnedSha: string | null
  diagnostics: string[]
  content: string | null
  document: MemoryDocument | null
}

export type SharedMemoryProposal = {
  id: string
  createdAt: string
  targetPath: string
  operation: 'write' | 'append' | 'replace' | 'delete'
  sourceSha: string | null
  nativeOrigin: {
    commitSha: string | null
    relativePath: string
    message?: string
  }
  content: string
  description?: string
  status: 'pending'
}

export type SharedMemoryProposalWithStale = SharedMemoryProposal & {
  isStale: boolean
  isUngrounded?: boolean
  currentSourceSha: string | null
}

export type ParagraphBlock = {
  raw: string
  normalized: string
  heading?: string
  atxHeading?: string
  label?: string
  contentWithoutHeading: string
  kind: 'list' | 'paragraph' | 'heading_only'
  intro?: string
}

export const DEFAULT_SHARED_MEMORY_SETTINGS: SharedMemorySettings = {
  enabled: false,
  sourceRoot: null,
  sharedOwner: FIXED_SHARED_OWNER,
}

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    label: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  },
  { label: 'OpenAI/Anthropic-style API key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    label: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  { label: 'bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/ },
  {
    label: 'credential assignment',
    pattern:
      /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["']?[^\s"'`]{8,}/i,
  },
  {
    label: 'URL with embedded credentials',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
  },
]

export function findSecretLikeContent(text: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label)
}

export function isSharedOwnerPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return (
    normalized === FIXED_SHARED_OWNER ||
    normalized === 'human/prefs/communication.md' ||
    normalized === 'prefs/communication.md' ||
    normalized === 'communication.md'
  )
}

export function getSharedMemoryConfigPath(memRoot?: string): string {
  if (
    process.env.AGY_SHARED_MEMORY_CONFIG &&
    process.env.AGY_SHARED_MEMORY_CONFIG.trim() !== '' &&
    process.env.AGY_SHARED_MEMORY_CONFIG !== 'undefined'
  ) {
    return path.resolve(process.env.AGY_SHARED_MEMORY_CONFIG)
  }
  const root = memRoot || process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory')
  const stateRoot = process.env.AGY_MEMORY_STATE_DIR || `${root}.state`
  return path.join(stateRoot, 'shared-memory.json')
}

export function loadSharedMemorySettings(
  configPath?: string,
  memRoot?: string,
): SharedMemorySettings {
  const filePath = configPath || getSharedMemoryConfigPath(memRoot)
  let raw: Record<string, unknown> = {}
  if (fs.existsSync(filePath)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>
      }
    } catch {}
  }

  let enabled =
    typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SHARED_MEMORY_SETTINGS.enabled
  if (
    process.env.AGY_SHARED_MEMORY_ENABLED !== undefined &&
    process.env.AGY_SHARED_MEMORY_ENABLED !== 'undefined'
  ) {
    const envVal = process.env.AGY_SHARED_MEMORY_ENABLED.trim().toLowerCase()
    enabled = envVal === '1' || envVal === 'true'
  }

  let sourceRoot =
    typeof raw.sourceRoot === 'string' && raw.sourceRoot.trim()
      ? raw.sourceRoot.trim()
      : DEFAULT_SHARED_MEMORY_SETTINGS.sourceRoot
  if (
    process.env.AGY_SHARED_MEMORY_SOURCE_ROOT &&
    process.env.AGY_SHARED_MEMORY_SOURCE_ROOT !== 'undefined'
  ) {
    sourceRoot = process.env.AGY_SHARED_MEMORY_SOURCE_ROOT.trim()
  }

  return {
    enabled,
    sourceRoot,
    sharedOwner: FIXED_SHARED_OWNER,
  }
}

/**
 * Resolves effective shared memory settings against live runtime configuration.
 *
 * Security Invariant: Public options/flags must not weaken runtime-owned protection.
 * Parameters may tighten (false -> true) to enable protection for tests or scoped calls,
 * but cannot disable (true -> false) live runtime policy.
 */
export function resolveEffectiveSharedMemorySettings(
  override?: Partial<SharedMemorySettings> | null,
  memRoot?: string,
): SharedMemorySettings {
  const live = loadSharedMemorySettings(undefined, memRoot)
  if (!override) return live

  const effectiveEnabled = live.enabled || Boolean(override.enabled)
  const effectiveSourceRoot =
    typeof override.sourceRoot === 'string' && override.sourceRoot.trim() !== ''
      ? override.sourceRoot.trim()
      : override.sourceRoot === null
        ? null
        : live.sourceRoot

  return {
    enabled: effectiveEnabled,
    sourceRoot: effectiveSourceRoot,
    sharedOwner: FIXED_SHARED_OWNER,
  }
}

export function saveSharedMemorySettings(
  settings: SharedMemorySettings,
  configPath?: string,
  memRoot?: string,
): void {
  const filePath = configPath || getSharedMemoryConfigPath(memRoot)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  let existing: Record<string, unknown> = {}
  if (fs.existsSync(filePath)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>
      }
    } catch {}
  }

  const merged = {
    ...existing,
    enabled: settings.enabled,
    sourceRoot: settings.sourceRoot,
    sharedOwner: FIXED_SHARED_OWNER,
  }

  const tempFile = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(tempFile, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tempFile, filePath)
}

export function isGitRepository(dirPath: string): boolean {
  try {
    const res = execFileSync('git', ['-C', dirPath, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return res.trim() === 'true'
  } catch {
    return false
  }
}

export function getGitTopLevel(dirPath: string): string | null {
  try {
    const res = execFileSync('git', ['-C', dirPath, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return res.trim() ? path.resolve(res.trim()) : null
  } catch {
    return null
  }
}

export function getSourceHeadSha(sourceRoot: string): string | null {
  try {
    const res = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const sha = res.trim()
    return /^[a-f0-9]{40}$/.test(sha) ? sha : null
  } catch {
    return null
  }
}

export function inspectSharedSource(
  settings: SharedMemorySettings,
  memoryRoot?: string,
): SharedSourceInspection {
  const diagnostics: string[] = []

  if (!settings.enabled) {
    return {
      enabled: false,
      sourceRoot: settings.sourceRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics: [],
      content: null,
      document: null,
    }
  }

  if (!settings.sourceRoot?.trim()) {
    diagnostics.push('sharedRead is enabled but sourceRoot is not set.')
    return {
      enabled: true,
      sourceRoot: null,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  const resolvedRoot = path.resolve(settings.sourceRoot.trim())

  if (!fs.existsSync(resolvedRoot)) {
    diagnostics.push(`Shared sourceRoot "${resolvedRoot}" does not exist.`)
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  let realRoot: string
  try {
    realRoot = fs.realpathSync(resolvedRoot)
  } catch (err) {
    diagnostics.push(`Failed to resolve real path for sourceRoot "${resolvedRoot}": ${err}`)
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  if (!fs.statSync(realRoot).isDirectory()) {
    diagnostics.push(`Shared sourceRoot "${resolvedRoot}" is not a directory.`)
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  if (memoryRoot) {
    try {
      const realMem = fs.existsSync(memoryRoot)
        ? fs.realpathSync(memoryRoot)
        : path.resolve(memoryRoot)
      const normSource = path.resolve(realRoot)
      const normMem = path.resolve(realMem)
      if (
        normSource === normMem ||
        normSource.startsWith(normMem + path.sep) ||
        normMem.startsWith(normSource + path.sep)
      ) {
        diagnostics.push(
          `Shared sourceRoot cannot be the native memory repository itself or its ancestor/subtree (${resolvedRoot}).`,
        )
        return {
          enabled: true,
          sourceRoot: resolvedRoot,
          sharedOwner: FIXED_SHARED_OWNER,
          valid: false,
          pinnedSha: null,
          diagnostics,
          content: null,
          document: null,
        }
      }
    } catch {}
  }

  if (!isGitRepository(realRoot)) {
    diagnostics.push(`Shared sourceRoot "${resolvedRoot}" is not a Git repository.`)
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  const gitTopLevel = getGitTopLevel(realRoot)
  let realTopLevel: string | null = null
  try {
    if (gitTopLevel) {
      realTopLevel = fs.realpathSync(gitTopLevel)
    }
  } catch {}

  if (!realTopLevel || realRoot !== realTopLevel) {
    diagnostics.push(
      `Shared sourceRoot "${resolvedRoot}" is a subdirectory of a Git repository, not the top-level root ("${gitTopLevel || resolvedRoot}").`,
    )
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  const pinnedSha = getSourceHeadSha(realRoot)
  if (!pinnedSha) {
    diagnostics.push(
      `Shared sourceRoot "${resolvedRoot}" has no committed HEAD revision or is empty.`,
    )
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  try {
    const lsTreeOut = execFileSync(
      'git',
      ['-C', realRoot, 'ls-tree', pinnedSha, FIXED_SHARED_OWNER],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()

    if (!lsTreeOut) {
      diagnostics.push(
        `Shared owner "${FIXED_SHARED_OWNER}" not found at committed revision ${pinnedSha.slice(0, 8)}.`,
      )
      return {
        enabled: true,
        sourceRoot: resolvedRoot,
        sharedOwner: FIXED_SHARED_OWNER,
        valid: false,
        pinnedSha,
        diagnostics,
        content: null,
        document: null,
      }
    }

    const mode = lsTreeOut.split(/\s+/)[0]
    if (mode === '120000') {
      diagnostics.push(
        `Shared owner "${FIXED_SHARED_OWNER}" at revision ${pinnedSha.slice(0, 8)} is a symbolic link; symlink escape is rejected.`,
      )
      return {
        enabled: true,
        sourceRoot: resolvedRoot,
        sharedOwner: FIXED_SHARED_OWNER,
        valid: false,
        pinnedSha,
        diagnostics,
        content: null,
        document: null,
      }
    }
  } catch (err) {
    diagnostics.push(`Failed to inspect Git tree in "${resolvedRoot}": ${err}`)
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha,
      diagnostics,
      content: null,
      document: null,
    }
  }

  let rawContent: string
  try {
    rawContent = execFileSync(
      'git',
      ['-C', realRoot, 'show', `${pinnedSha}:${FIXED_SHARED_OWNER}`],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } catch (err) {
    diagnostics.push(
      `Failed to read committed content for "${FIXED_SHARED_OWNER}" at revision ${pinnedSha.slice(0, 8)}: ${err}`,
    )
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha,
      diagnostics,
      content: null,
      document: null,
    }
  }

  if (rawContent.length > SYSTEM_FILE_MAX_CHARS) {
    diagnostics.push(
      `Shared owner "${FIXED_SHARED_OWNER}" exceeds ${SYSTEM_FILE_MAX_CHARS} characters (${rawContent.length}).`,
    )
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha,
      diagnostics,
      content: null,
      document: null,
    }
  }

  const secrets = findSecretLikeContent(rawContent)
  if (secrets.length > 0) {
    diagnostics.push(
      `Shared owner "${FIXED_SHARED_OWNER}" contains secret-like content: ${secrets.join(', ')}.`,
    )
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha,
      diagnostics,
      content: null,
      document: null,
    }
  }

  const parsed = parseMemoryDocument(rawContent, FIXED_SHARED_OWNER, {
    requireDescription: true,
  })
  if (parsed.diagnostics.length > 0) {
    diagnostics.push(
      `Shared owner "${FIXED_SHARED_OWNER}" has malformed document frontmatter: ${parsed.diagnostics.join('; ')}.`,
    )
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha,
      diagnostics,
      content: null,
      document: null,
    }
  }

  return {
    enabled: true,
    sourceRoot: resolvedRoot,
    sharedOwner: FIXED_SHARED_OWNER,
    valid: true,
    pinnedSha,
    diagnostics: [],
    content: rawContent,
    document: {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: parsed.description,
      body: parsed.body,
      readOnly: true,
      scope: 'global',
      tier: 'system',
    },
  }
}

const SEED_ONLY_LINE = /^- (?:Workspace: .*|\(.*\))$/

function isSeedOnly(body: string): boolean {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length === 0 || lines.every((l) => SEED_ONLY_LINE.test(l))
}

const FORBIDDEN_SECTION_HEADING = /^#+\s+(?:persona|agent persona|model roster|models)\b/i

export function isImportProvenanceBlock(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/^<!--[\s\S]*?-->$/.test(trimmed)) return true
  if (
    /^(?:imported from\b|.*letta remains the source\b|.*this is the (?:cursor|antigravity|agy) copy\b)/i.test(
      trimmed,
    )
  ) {
    return true
  }
  return false
}

export type ListClause = {
  bullet: string
  text: string
  raw: string
}

export function extractListClauses(content: string): ListClause[] {
  const lines = content.split('\n')
  const clauses: ListClause[] = []
  let current: ListClause | null = null
  let baseIndent: number | null = null

  for (const line of lines) {
    if (!line.trim()) {
      if (current) {
        current.raw += `\n${line}`
      }
      continue
    }

    if (line.trim().startsWith('#')) {
      if (current) {
        clauses.push(current)
        current = null
        baseIndent = null
      }
      continue
    }

    const bulletMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
    if (bulletMatch) {
      const indent = bulletMatch[1].length
      if (baseIndent === null || indent <= baseIndent) {
        if (current) clauses.push(current)
        baseIndent = indent
        current = {
          bullet: bulletMatch[2],
          text: bulletMatch[3].trim(),
          raw: line,
        }
      } else {
        if (current) {
          current.raw += `\n${line}`
          current.text += `\n${line.trim()}`
        } else {
          baseIndent = indent
          current = {
            bullet: bulletMatch[2],
            text: bulletMatch[3].trim(),
            raw: line,
          }
        }
      }
    } else if (current) {
      current.raw += `\n${line}`
      current.text += ` ${line.trim()}`
    }
  }

  if (current) clauses.push(current)
  return clauses
}

export function normalizeClauseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/[.,:;!?]+$/gm, '')
    .trim()
}

export function splitIntroAndClauses(content: string): { intro: string; clauses: ListClause[] } {
  const lines = content.split('\n')
  let firstBulletIndex = -1

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
      firstBulletIndex = i
      break
    }
  }

  if (firstBulletIndex === -1) {
    return { intro: content.trim(), clauses: [] }
  }

  const intro = lines.slice(0, firstBulletIndex).join('\n').trim()
  const listContent = lines.slice(firstBulletIndex).join('\n')
  const clauses = extractListClauses(listContent)

  return { intro, clauses }
}

export function parseBlocks(markdown: string): ParagraphBlock[] {
  let body = markdown
  const frontmatterMatch = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (frontmatterMatch) {
    body = markdown.slice(frontmatterMatch[0].length)
  }

  const normalizedNewlines = body.replace(/\r\n/g, '\n')
  const spaced = normalizedNewlines.replace(/\n(?=#{1,6}\s)/g, '\n\n')

  const chunks = spaced
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)

  const blocks: ParagraphBlock[] = []
  let currentAtxHeading: string | undefined

  for (const raw of chunks) {
    const headingMatch = raw.match(/^(#{1,6}\s+[^\n]+)/)
    const labelMatch = !headingMatch ? raw.match(/^([^#\-*>\s\n][^\n:]{1,80}:)(?:\r?\n|$)/) : null

    let atxHeading = currentAtxHeading
    let label: string | undefined
    let contentWithoutHeading = raw
    let kind: 'list' | 'paragraph' | 'heading_only'

    if (headingMatch) {
      currentAtxHeading = headingMatch[1].trim()
      atxHeading = currentAtxHeading
      const rest = raw.slice(headingMatch[0].length).trim()
      if (!rest) {
        kind = 'heading_only'
        contentWithoutHeading = ''
      } else {
        const subLabel = rest.match(/^([^#\-*>\s\n][^\n:]{1,80}:)(?:\r?\n|$)/)
        if (subLabel) {
          label = subLabel[1].trim()
          contentWithoutHeading = rest.slice(subLabel[0].length).trim()
        } else {
          contentWithoutHeading = rest
        }
        kind = extractListClauses(contentWithoutHeading).length > 0 ? 'list' : 'paragraph'
      }
    } else if (labelMatch) {
      label = labelMatch[1].trim()
      contentWithoutHeading = raw.slice(labelMatch[0].length).trim()
      kind = extractListClauses(contentWithoutHeading).length > 0 ? 'list' : 'paragraph'
    } else {
      contentWithoutHeading = raw
      kind = extractListClauses(contentWithoutHeading).length > 0 ? 'list' : 'paragraph'
    }

    const { intro } = splitIntroAndClauses(contentWithoutHeading)

    const normalized = raw
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim()

    blocks.push({
      raw,
      normalized,
      heading: label || atxHeading,
      atxHeading,
      label,
      contentWithoutHeading,
      kind,
      intro: intro || undefined,
    })
  }

  return blocks
}

export function annotateDeferredReferences(text: string, sourceRoot: string): string {
  return text.replace(
    /(\[([^\]]+)\]\((reference\/[^)]+)\))/g,
    `$1 (shared reference in ${sourceRoot}, not in native root)`,
  )
}

export function mergeCommunicationDocuments(
  sourceDoc: MemoryDocument,
  nativeDoc: MemoryDocument | null,
  inspection: SharedSourceInspection,
): { mergedDoc: MemoryDocument; diagnostics: string[] } {
  const diagnostics: string[] = []
  const sourceRoot = inspection.sourceRoot || 'source'
  const shortSha = inspection.pinnedSha ? inspection.pinnedSha.slice(0, 8) : 'unknown'

  const sourceBodyAnnotated = annotateDeferredReferences(sourceDoc.body, sourceRoot)

  const rawSourceBlocks = parseBlocks(sourceBodyAnnotated)
  const sourceBlocks = rawSourceBlocks.filter(
    (b) => !b.heading || !FORBIDDEN_SECTION_HEADING.test(b.heading),
  )

  if (!nativeDoc?.body.trim() || isSeedOnly(nativeDoc.body)) {
    const provenanceNotice = `<!-- Shared communication from ${sourceRoot} @ ${inspection.pinnedSha} (${FIXED_SHARED_OWNER}) -->\n`
    const cleanedBody = sourceBlocks.map((b) => b.raw).join('\n\n')
    return {
      mergedDoc: {
        relativePath: NATIVE_COMMUNICATION_PATH,
        description: `${sourceDoc.description} (shared from ${path.basename(sourceRoot)} @ ${shortSha})`,
        body: `${provenanceNotice}${cleanedBody.trim()}`,
        readOnly: true,
        scope: 'global',
        tier: 'system',
      },
      diagnostics,
    }
  }

  const rawNativeBlocks = parseBlocks(nativeDoc.body)
  const nativeBlocks = rawNativeBlocks.filter(
    (b) =>
      (!b.heading || !FORBIDDEN_SECTION_HEADING.test(b.heading)) && !isImportProvenanceBlock(b.raw),
  )

  const allSourceClauses = sourceBlocks
    .filter((b) => b.kind === 'list')
    .flatMap((b) => extractListClauses(b.contentWithoutHeading))
  const allSourceClauseTexts = new Set(allSourceClauses.map((c) => normalizeClauseText(c.text)))

  const usedNativeIndexes = new Set<number>()
  const mergedSections: string[] = []
  const nativeAdditionsByIndex = new Map<number, string>()

  for (const sBlock of sourceBlocks) {
    mergedSections.push(sBlock.raw)

    if (sBlock.kind === 'heading_only') {
      continue
    }

    for (let i = 0; i < nativeBlocks.length; i++) {
      if (usedNativeIndexes.has(i)) continue
      const nBlock = nativeBlocks[i]

      if (nBlock.normalized === sBlock.normalized) {
        usedNativeIndexes.add(i)
        continue
      }

      // Reconcile equivalent kinds only (list vs list, paragraph vs paragraph)
      if (sBlock.kind !== nBlock.kind) {
        continue
      }

      const sameLabel = Boolean(sBlock.label && nBlock.label && sBlock.label === nBlock.label)
      const sameAtxHeading = Boolean(
        sBlock.atxHeading &&
          nBlock.atxHeading &&
          sBlock.atxHeading === nBlock.atxHeading &&
          !sBlock.label &&
          !nBlock.label,
      )

      if (!sameLabel && !sameAtxHeading) {
        continue
      }

      if (sBlock.kind === 'list') {
        usedNativeIndexes.add(i)
        const { intro: nIntro, clauses: nClauses } = splitIntroAndClauses(
          nBlock.contentWithoutHeading,
        )
        const distinctFromThisBlock = nClauses.filter(
          (nc) => !allSourceClauseTexts.has(normalizeClauseText(nc.text)),
        )
        const combinedIntro = [nBlock.label, nIntro || nBlock.intro].filter(Boolean).join('\n')
        const parts: string[] = []
        if (combinedIntro && !sBlock.raw.includes(combinedIntro)) {
          parts.push(combinedIntro)
        }
        if (distinctFromThisBlock.length > 0) {
          parts.push(distinctFromThisBlock.map((c) => c.raw).join('\n'))
        }
        if (parts.length > 0) {
          nativeAdditionsByIndex.set(i, parts.join('\n'))
        }
      } else if (sBlock.kind === 'paragraph') {
        const sContent = sBlock.contentWithoutHeading.trim()
        const nContent = nBlock.contentWithoutHeading.trim()

        if (!sContent || !nContent || sContent === nContent) {
          if (sContent === nContent) {
            usedNativeIndexes.add(i)
          }
          continue
        }

        usedNativeIndexes.add(i)
        const sectionTitle = sBlock.label || sBlock.atxHeading || 'shared section'
        const conflictExplanation = [
          `> Unresolved semantic difference under ${sectionTitle}:`,
          `> - Shared source: "${sContent}"`,
          `> - Native addition: "${nContent}"`,
          `> (Both preserved; source given canonical precedence for shared baseline.)`,
          '',
          `**Native instruction (${sectionTitle}):**\n${nContent}`,
        ].join('\n')
        mergedSections.push(conflictExplanation)
      }
    }
  }

  for (let i = 0; i < nativeBlocks.length; i++) {
    if (usedNativeIndexes.has(i)) continue
    const nBlock = nativeBlocks[i]
    if (isSeedOnly(nBlock.raw) || isImportProvenanceBlock(nBlock.raw)) continue

    // DO NOT emit orphan heading_only blocks (e.g. '# Communication')
    if (nBlock.kind === 'heading_only' || !nBlock.contentWithoutHeading.trim()) continue

    if (nBlock.kind === 'list') {
      const { intro: nIntro, clauses: nClauses } = splitIntroAndClauses(
        nBlock.contentWithoutHeading,
      )
      const distinct = nClauses.filter(
        (nc) => !allSourceClauseTexts.has(normalizeClauseText(nc.text)),
      )
      const combinedIntro = [nBlock.label, nIntro || nBlock.intro].filter(Boolean).join('\n')
      const parts: string[] = []
      if (combinedIntro) {
        parts.push(combinedIntro)
      }
      if (distinct.length > 0) {
        parts.push(distinct.map((c) => c.raw).join('\n'))
      }
      if (parts.length > 0) {
        nativeAdditionsByIndex.set(i, parts.join('\n'))
      }
    } else {
      nativeAdditionsByIndex.set(i, nBlock.raw)
    }
  }

  const distinctAdditions: string[] = []
  for (let i = 0; i < nativeBlocks.length; i++) {
    const addition = nativeAdditionsByIndex.get(i)
    if (addition) {
      distinctAdditions.push(addition)
    }
  }

  if (distinctAdditions.length > 0) {
    mergedSections.push(
      '### Native Runtime Additions\n_Distinct instructions recorded in native Antigravity memory:_\n\n' +
        distinctAdditions.join('\n\n'),
    )
  }

  const provenanceNotice = `<!-- Shared communication from ${sourceRoot} @ ${inspection.pinnedSha} (${FIXED_SHARED_OWNER}) merged with native additions -->\n`
  const mergedBody = `${provenanceNotice}${mergedSections.join('\n\n').trim()}`

  return {
    mergedDoc: {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: `${sourceDoc.description} (shared from ${path.basename(sourceRoot)} @ ${shortSha} + native additions)`,
      body: mergedBody,
      readOnly: true,
      scope: 'global',
      tier: 'system',
    },
    diagnostics,
  }
}

export function findSharedParagraphCopies(
  newContent: string,
  inspection: SharedSourceInspection,
): string[] {
  if (!inspection.valid || !inspection.content) return []
  const parsed = parseBlocks(inspection.content)
  const normalizedNew = newContent
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .toLowerCase()

  const copies: string[] = []
  for (const block of parsed) {
    const text = block.contentWithoutHeading.trim()
    if (text.length >= 30 && normalizedNew.includes(text.toLowerCase())) {
      copies.push(text)
    }
  }
  return copies
}

export function assertNoSharedParagraphCopies(
  newContent: string,
  targetRelPath: string,
  inspection: SharedSourceInspection,
): void {
  if (isSharedOwnerPath(targetRelPath)) return
  const copies = findSharedParagraphCopies(newContent, inspection)
  if (copies.length > 0) {
    const sample = copies[0].length > 60 ? `${copies[0].slice(0, 57)}...` : copies[0]
    throw new Error(
      `Refusing to store content: contains known shared communication paragraph from ${FIXED_SHARED_OWNER} ("${sample}"). Shared communication is centrally managed and must not be duplicated into other memory files.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Proposal Queue (State outside Git memory)
// ---------------------------------------------------------------------------

export function resolveSharedProposalsDir(memRoot?: string): string {
  const root = memRoot || process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory')
  const stateRoot = process.env.AGY_MEMORY_STATE_DIR || `${root}.state`
  return path.join(stateRoot, 'shared-proposals')
}

export function isValidSharedProposal(prop: unknown): prop is SharedMemoryProposal {
  if (!prop || typeof prop !== 'object' || Array.isArray(prop)) return false
  const p = prop as Record<string, unknown>
  if (typeof p.id !== 'string' || !/^prop-shared-[a-z0-9-]+$/.test(p.id)) return false
  if (typeof p.createdAt !== 'string' || Number.isNaN(Date.parse(p.createdAt))) return false
  if (p.targetPath !== FIXED_SHARED_OWNER) return false
  if (!['write', 'append', 'replace', 'delete'].includes(p.operation as string)) return false
  if (
    p.sourceSha !== null &&
    (typeof p.sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(p.sourceSha))
  ) {
    return false
  }
  if (typeof p.content !== 'string') return false
  if (p.status !== 'pending') return false
  if (!p.nativeOrigin || typeof p.nativeOrigin !== 'object') return false
  const origin = p.nativeOrigin as Record<string, unknown>
  if (origin.relativePath !== FIXED_SHARED_OWNER) return false
  if (
    origin.commitSha !== null &&
    (typeof origin.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(origin.commitSha))
  ) {
    return false
  }
  return true
}

export function createSharedProposal(options: {
  memoryRoot?: string
  targetPath: string
  operation: 'write' | 'append' | 'replace' | 'delete'
  sourceRoot?: string | null
  sourceSha?: string | null
  content: string
  description?: string
  message?: string
}): SharedMemoryProposal {
  if (!['write', 'append', 'replace', 'delete'].includes(options.operation)) {
    throw new Error(`Invalid shared proposal operation: "${options.operation}".`)
  }
  if (typeof options.content !== 'string') {
    throw new Error('Shared proposal content must be a string.')
  }

  const dir = resolveSharedProposalsDir(options.memoryRoot)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  const id = `prop-shared-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const rawSha =
    options.sourceSha || (options.sourceRoot ? getSourceHeadSha(options.sourceRoot) : null)
  const sourceSha = rawSha && /^[a-f0-9]{40}$/.test(rawSha) ? rawSha : null
  const nativeCommitSha = options.memoryRoot ? getMemoryHeadRevision(options.memoryRoot) : null
  const validNativeCommitSha =
    nativeCommitSha && /^[a-f0-9]{40}$/.test(nativeCommitSha) ? nativeCommitSha : null

  const proposal: SharedMemoryProposal = {
    id,
    createdAt: new Date().toISOString(),
    targetPath: FIXED_SHARED_OWNER,
    operation: options.operation,
    sourceSha,
    nativeOrigin: {
      commitSha: validNativeCommitSha,
      relativePath: FIXED_SHARED_OWNER,
      message: options.message,
    },
    content: options.content,
    description: options.description,
    status: 'pending',
  }

  const targetFile = path.join(dir, `${id}.json`)
  const tempFile = `${targetFile}.tmp-${process.pid}`
  fs.writeFileSync(tempFile, `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tempFile, targetFile)

  return proposal
}

export function listSharedProposals(
  memoryRoot?: string,
  sourceRoot?: string | null,
): SharedMemoryProposalWithStale[] {
  const dir = resolveSharedProposalsDir(memoryRoot)
  if (!fs.existsSync(dir)) return []

  let realDir: string
  try {
    realDir = fs.realpathSync(dir)
  } catch {
    return []
  }

  const currentSourceSha = sourceRoot ? getSourceHeadSha(sourceRoot) : null
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('.tmp-'))
  const results: SharedMemoryProposalWithStale[] = []

  for (const file of files) {
    const fullPath = path.join(dir, file)
    let realFile: string
    try {
      realFile = fs.realpathSync(fullPath)
    } catch {
      continue
    }

    if (!realFile.startsWith(realDir + path.sep)) continue
    try {
      const stat = fs.statSync(realFile)
      if (!stat.isFile()) continue
    } catch {
      continue
    }

    try {
      const raw = fs.readFileSync(realFile, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      if (!isValidSharedProposal(parsed)) {
        continue
      }
      const prop = parsed
      const isUngrounded = !prop.sourceSha
      const isStale = Boolean(
        isUngrounded || (currentSourceSha && prop.sourceSha && prop.sourceSha !== currentSourceSha),
      )
      results.push({ ...prop, isStale, isUngrounded, currentSourceSha })
    } catch {}
  }

  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return results
}

export function getSharedProposal(
  proposalId: string,
  memoryRoot?: string,
  sourceRoot?: string | null,
): SharedMemoryProposalWithStale | null {
  const proposals = listSharedProposals(memoryRoot, sourceRoot)
  return (
    proposals.find((p) => p.id === proposalId) ||
    proposals.find((p) => p.id.startsWith(proposalId)) ||
    null
  )
}

export function exportSharedProposal(
  proposalId: string,
  memoryRoot?: string,
  sourceRoot?: string | null,
): string {
  const prop = getSharedProposal(proposalId, memoryRoot, sourceRoot)
  if (!prop) throw new Error(`Shared proposal not found: ${proposalId}`)
  if (prop.targetPath !== FIXED_SHARED_OWNER) {
    throw new Error(`Invalid proposal targetPath: ${prop.targetPath}`)
  }

  let baseStatus: string
  if (prop.isUngrounded || !prop.sourceSha) {
    baseStatus = 'UNGROUNDED (no source SHA recorded)'
  } else if (prop.isStale) {
    baseStatus = `STALE BASE (proposal created at ${prop.sourceSha.slice(0, 8)}, current source HEAD is ${prop.currentSourceSha?.slice(0, 8) || 'unknown'})`
  } else if (prop.currentSourceSha && prop.sourceSha === prop.currentSourceSha) {
    baseStatus = `CURRENT (${prop.sourceSha.slice(0, 8)})`
  } else {
    baseStatus = `PINNED (${prop.sourceSha.slice(0, 8)})`
  }

  const lines = [
    `# Shared Memory Proposal: ${prop.id}`,
    '',
    `Status: ${prop.status} (requires human review; not committed to canonical source)`,
    `Target: ${prop.targetPath}`,
    `Operation: ${prop.operation}`,
    `Base Source Revision: ${prop.sourceSha || 'ungrounded'} [${baseStatus}]`,
    `Native Origin Revision: ${prop.nativeOrigin.commitSha || 'none'} (${prop.nativeOrigin.relativePath})`,
    `Created: ${prop.createdAt}`,
    prop.description ? `Description: ${prop.description}` : '',
    prop.nativeOrigin.message ? `Origin Note: ${prop.nativeOrigin.message}` : '',
    '',
    '## Proposed Content',
    '',
    prop.content,
    '',
  ]

  return lines.filter(Boolean).join('\n')
}

export function rejectSharedProposal(proposalId: string, memoryRoot?: string): boolean {
  const dir = resolveSharedProposalsDir(memoryRoot)
  const prop = getSharedProposal(proposalId, memoryRoot)
  if (!prop) return false
  const targetFile = path.join(dir, `${prop.id}.json`)
  if (fs.existsSync(targetFile)) {
    fs.unlinkSync(targetFile)
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// CLI Execution Handler
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`
Usage: shared-memory.ts <command> [arguments]

Commands:
  status                     Show shared memory configuration and health status
  enable <sourceRoot>        Enable shared communication with explicit Git sourceRoot
  disable                    Disable shared communication adapter
  list                       List pending proposals awaiting source review
  show <proposalId>          Display proposal details
  export <proposalId>        Export proposal Markdown for human review/patch application
  reject <proposalId>        Reject and discard a pending proposal
`)
}

export function runCli(args: string[] = process.argv.slice(2)): void {
  const command = args[0] || 'status'

  if (command === 'status') {
    const settings = loadSharedMemorySettings()
    const inspection = inspectSharedSource(settings)
    const proposals = listSharedProposals(undefined, settings.sourceRoot)
    const staleCount = proposals.filter((p) => p.isStale).length

    console.log('\n🌐 Shared Communication Adapter Status\n')
    console.log(`Enabled: ${settings.enabled ? 'yes' : 'no'}`)
    console.log(`Config file: ${getSharedMemoryConfigPath()}`)
    console.log(`Source root: ${settings.sourceRoot || '(none)'}`)
    console.log(`Shared owner: ${settings.sharedOwner}`)
    console.log(`Source valid: ${inspection.valid ? 'yes' : 'no'}`)
    console.log(`Pinned revision: ${inspection.pinnedSha || '(none)'}`)
    if (inspection.diagnostics.length > 0) {
      console.log('Diagnostics:')
      for (const d of inspection.diagnostics) {
        console.log(`  - ${d}`)
      }
    }
    console.log(`Pending proposals: ${proposals.length} (${staleCount} stale)`)
    console.log('')
    return
  }

  if (command === 'enable') {
    const sourceRoot = args[1]
    if (!sourceRoot?.trim()) {
      console.error('Error: specify <sourceRoot> to enable shared communication.')
      process.exitCode = 1
      return
    }
    const resolved = path.resolve(sourceRoot.trim())
    const current = loadSharedMemorySettings()
    const updated: SharedMemorySettings = {
      ...current,
      enabled: true,
      sourceRoot: resolved,
    }
    const inspection = inspectSharedSource(updated)
    if (!inspection.valid) {
      console.warn(
        `Warning: source inspection reported issues:\n${inspection.diagnostics.map((d) => `  - ${d}`).join('\n')}`,
      )
    }
    saveSharedMemorySettings(updated)
    console.log(`✓ Shared communication enabled with sourceRoot: ${resolved}`)
    return
  }

  if (command === 'disable') {
    const current = loadSharedMemorySettings()
    saveSharedMemorySettings({ ...current, enabled: false })
    console.log('✓ Shared communication adapter disabled.')
    return
  }

  if (command === 'list') {
    const settings = loadSharedMemorySettings()
    const proposals = listSharedProposals(undefined, settings.sourceRoot)
    console.log(`\n📋 Pending Shared Memory Proposals (${proposals.length}):\n`)
    if (proposals.length === 0) {
      console.log('   No pending shared proposals.')
    } else {
      proposals.forEach((p, idx) => {
        const staleLabel = p.isStale ? ' [⚠️ STALE BASE]' : ''
        console.log(`[${idx + 1}] 🏷️  ${p.id}${staleLabel}`)
        console.log(`    Operation: ${p.operation} | Target: ${p.targetPath}`)
        console.log(`    Base SHA: ${p.sourceSha?.slice(0, 8) || 'unknown'}`)
        console.log(`    Created: ${p.createdAt}\n`)
      })
    }
    console.log('')
    return
  }

  if (command === 'show') {
    const id = args[1]
    if (!id) {
      console.error('Error: specify <proposalId> to show.')
      process.exitCode = 1
      return
    }
    const settings = loadSharedMemorySettings()
    const prop = getSharedProposal(id, undefined, settings.sourceRoot)
    if (!prop) {
      console.error(`Error: proposal "${id}" not found.`)
      process.exitCode = 1
      return
    }
    console.log(JSON.stringify(prop, null, 2))
    return
  }

  if (command === 'export') {
    const id = args[1]
    if (!id) {
      console.error('Error: specify <proposalId> to export.')
      process.exitCode = 1
      return
    }
    const settings = loadSharedMemorySettings()
    try {
      const exported = exportSharedProposal(id, undefined, settings.sourceRoot)
      console.log(exported)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exitCode = 1
    }
    return
  }

  if (command === 'reject') {
    const id = args[1]
    if (!id) {
      console.error('Error: specify <proposalId> to reject.')
      process.exitCode = 1
      return
    }
    const ok = rejectSharedProposal(id)
    if (ok) {
      console.log(`✓ Shared proposal "${id}" rejected and discarded.`)
    } else {
      console.error(`Error: proposal "${id}" not found.`)
      process.exitCode = 1
    }
    return
  }

  printUsage()
  process.exitCode = 1
}

if (isDirectCliInvocation(import.meta.url)) {
  runCli()
}
