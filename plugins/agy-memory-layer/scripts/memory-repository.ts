#!/usr/bin/env node

/**
 * Shared Git and path boundary for the agy-memory-layer MemFS repository.
 *
 * Active prompt projection reads committed HEAD only. Memory writers resolve
 * paths inside the configured root and may commit only the paths they own.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { isDirectCliInvocation } from './cli-entrypoint.ts'

export type MemoryRepositoryState = 'uninitialized' | 'clean' | 'dirty' | 'conflict' | 'error'

export type MemoryRepositoryStatus = {
  state: MemoryRepositoryState
  changedPaths: string[]
  summary: string
  error?: string
}

export type ResolvedMemoryPath = {
  relativePath: string
  absolutePath: string
}

export type CommitMemoryPathsOptions = {
  memoryRoot: string
  relativePaths: string[]
  reason: string
  authorName?: string
  authorEmail?: string
}

export type CommitMemoryPathsResult = {
  committed: boolean
  sha?: string
}

type GitResult = {
  status: number | null
  stdout: string
  stderr: string
}

export const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const getRealPathIfPresent = (candidate: string): string => {
  return fs.existsSync(candidate) ? fs.realpathSync.native(candidate) : path.resolve(candidate)
}

const findExistingAncestor = (candidate: string): string => {
  let current = candidate
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) return current
    current = parent
  }
  return current
}

export function normalizeMemoryRelativePath(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('Memory path must not be empty.')
  if (value.includes('\0')) throw new Error('Memory path must not contain NUL bytes.')
  if (value.includes('\\')) throw new Error(`Memory path must use forward slashes: ${input}`)
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error(`Memory path must be relative: ${input}`)
  }

  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Memory path contains an unsafe segment: ${input}`)
  }

  return segments.join('/')
}

export function validateProjectSlug(input: string): string {
  const slug = input.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
    throw new Error(`Invalid project slug: ${input}`)
  }
  return slug
}

export function resolveMemoryPath(memoryRoot: string, input: string): ResolvedMemoryPath {
  const relativePath = normalizeMemoryRelativePath(input)
  const absoluteRoot = path.resolve(memoryRoot)
  const absolutePath = path.resolve(absoluteRoot, ...relativePath.split('/'))

  if (!isWithin(absoluteRoot, absolutePath)) {
    throw new Error(`Memory path escapes configured root: ${input}`)
  }

  if (fs.existsSync(absoluteRoot)) {
    const realRoot = getRealPathIfPresent(absoluteRoot)
    const existingAncestor = findExistingAncestor(absolutePath)
    const realAncestor = getRealPathIfPresent(existingAncestor)
    if (!isWithin(realRoot, realAncestor)) {
      throw new Error(`Memory path resolves through a symlink outside configured root: ${input}`)
    }

    if (fs.existsSync(absolutePath)) {
      const realTarget = getRealPathIfPresent(absolutePath)
      if (!isWithin(realRoot, realTarget)) {
        throw new Error(`Memory path resolves outside configured root: ${input}`)
      }
    }
  }

  return { relativePath, absolutePath }
}

const runGit = (
  memoryRoot: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): GitResult => {
  const result = spawnSync('git', ['-C', memoryRoot, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const normalized: GitResult = {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  }
  if (!options.allowFailure && result.status !== 0) {
    const detail = (normalized.stderr || normalized.stdout || `exit ${result.status}`).trim()
    throw new Error(`Git ${args[0] || 'command'} failed: ${detail}`)
  }
  return normalized
}

const parsePorcelainPaths = (output: string): { paths: string[]; hasConflict: boolean } => {
  const records = output.split('\0').filter(Boolean)
  const paths = new Set<string>()
  let hasConflict = false

  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    const status = record.slice(0, 2)
    const recordPath = record.slice(3)
    if (recordPath) paths.add(recordPath)
    if (status.includes('U') || status === 'AA' || status === 'DD') hasConflict = true

    if (status.includes('R') || status.includes('C')) {
      const originalPath = records[index + 1]
      if (originalPath) {
        paths.add(originalPath)
        index++
      }
    }
  }

  return { paths: [...paths].sort(), hasConflict }
}

export function getMemoryRepositoryStatus(memoryRoot: string): MemoryRepositoryStatus {
  if (!fs.existsSync(path.join(memoryRoot, '.git'))) {
    return {
      state: 'uninitialized',
      changedPaths: [],
      summary: 'Memory repository is not initialized.',
    }
  }

  const result = runGit(memoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    allowFailure: true,
  })
  if (result.status !== 0) {
    const error = (result.stderr || result.stdout || `exit ${result.status}`).trim()
    return {
      state: 'error',
      changedPaths: [],
      summary: 'Unable to inspect memory repository.',
      error,
    }
  }

  const parsed = parsePorcelainPaths(result.stdout || '')
  if (parsed.hasConflict) {
    return {
      state: 'conflict',
      changedPaths: parsed.paths,
      summary: `Memory repository has conflicts in ${parsed.paths.length} path(s).`,
    }
  }
  if (parsed.paths.length > 0) {
    return {
      state: 'dirty',
      changedPaths: parsed.paths,
      summary: `Memory repository has ${parsed.paths.length} uncommitted path(s).`,
    }
  }

  return { state: 'clean', changedPaths: [], summary: 'Memory repository is clean.' }
}

export function assertMemoryRepositoryCleanForWrite(memoryRoot: string): void {
  const status = getMemoryRepositoryStatus(memoryRoot)
  if (status.state !== 'clean') {
    throw new Error(
      `${status.summary} Commit, resolve, or discard existing changes before writing memory.`,
    )
  }
}

export function readCommittedMemoryFile(memoryRoot: string, input: string): string | null {
  const { relativePath } = resolveMemoryPath(memoryRoot, input)
  if (!fs.existsSync(path.join(memoryRoot, '.git'))) return null

  const result = runGit(memoryRoot, ['show', `HEAD:${relativePath}`], { allowFailure: true })
  return result.status === 0 ? result.stdout : null
}

export function committedMemoryPathExists(memoryRoot: string, input: string): boolean {
  const { relativePath } = resolveMemoryPath(memoryRoot, input)
  if (!fs.existsSync(path.join(memoryRoot, '.git'))) return false

  return (
    runGit(memoryRoot, ['cat-file', '-e', `HEAD:${relativePath}`], { allowFailure: true })
      .status === 0
  )
}

export function listCommittedMemoryFiles(memoryRoot: string, directory: string): string[] {
  if (!fs.existsSync(path.join(memoryRoot, '.git'))) return []
  const relativePath = directory ? resolveMemoryPath(memoryRoot, directory).relativePath : ''

  const result = runGit(
    memoryRoot,
    relativePath
      ? ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', relativePath]
      : ['ls-tree', '-r', '--name-only', '-z', 'HEAD'],
    { allowFailure: true },
  )
  if (result.status !== 0) return []
  return (result.stdout || '').split('\0').filter(Boolean).sort()
}

export function getMemoryHeadRevision(memoryRoot: string): string | null {
  if (!fs.existsSync(path.join(memoryRoot, '.git'))) return null
  const result = runGit(memoryRoot, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
  return result.status === 0 ? result.stdout.trim() : null
}

export function restoreDeclaredMemoryPaths(
  memoryRoot: string,
  revision: string,
  relativePaths: string[],
): void {
  if (!/^[a-f0-9]{40}$/i.test(revision)) throw new Error('Invalid restore revision.')
  const normalizedPaths = [...new Set(relativePaths.map(normalizeMemoryRelativePath))].sort()
  if (normalizedPaths.length === 0) return
  for (const relativePath of normalizedPaths) resolveMemoryPath(memoryRoot, relativePath)

  runGit(memoryRoot, ['reset', revision, '--', ...normalizedPaths])
  for (const relativePath of normalizedPaths) {
    const previous = runGit(memoryRoot, ['show', `${revision}:${relativePath}`], {
      allowFailure: true,
    })
    if (previous.status === 0) writeMemoryFile(memoryRoot, relativePath, previous.stdout)
    else deleteMemoryFile(memoryRoot, relativePath)
  }
}

export function writeMemoryFile(
  memoryRoot: string,
  input: string,
  content: string,
): ResolvedMemoryPath {
  const resolved = resolveMemoryPath(memoryRoot, input)
  fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true })
  resolveMemoryPath(memoryRoot, input)

  const tempPath = `${resolved.absolutePath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tempPath, content, 'utf-8')
  fs.renameSync(tempPath, resolved.absolutePath)
  return resolved
}

export function writeMemoryBuffer(
  memoryRoot: string,
  input: string,
  content: Uint8Array,
): ResolvedMemoryPath {
  const resolved = resolveMemoryPath(memoryRoot, input)
  fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true })
  const tempPath = path.join(
    path.dirname(resolved.absolutePath),
    `.${path.basename(resolved.absolutePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  )
  fs.writeFileSync(tempPath, content)
  fs.renameSync(tempPath, resolved.absolutePath)
  return resolved
}

export function deleteMemoryFile(memoryRoot: string, input: string): ResolvedMemoryPath {
  const resolved = resolveMemoryPath(memoryRoot, input)
  if (fs.existsSync(resolved.absolutePath)) fs.unlinkSync(resolved.absolutePath)
  return resolved
}

export function commitMemoryPaths(options: CommitMemoryPathsOptions): CommitMemoryPathsResult {
  const relativePaths = [...new Set(options.relativePaths.map(normalizeMemoryRelativePath))]
  if (relativePaths.length === 0) return { committed: false }
  for (const relativePath of relativePaths) resolveMemoryPath(options.memoryRoot, relativePath)

  const status = getMemoryRepositoryStatus(options.memoryRoot)
  if (status.state === 'uninitialized' || status.state === 'error') {
    throw new Error(status.error || status.summary)
  }
  if (status.state === 'conflict') throw new Error(status.summary)
  if (status.state === 'clean') return { committed: false }

  const unrelated = status.changedPaths.filter(
    (changedPath) => !relativePaths.includes(changedPath),
  )
  if (unrelated.length > 0) {
    throw new Error(`Refusing memory commit with unrelated dirty paths: ${unrelated.join(', ')}`)
  }

  runGit(options.memoryRoot, ['add', '--', ...relativePaths])
  const staged = runGit(
    options.memoryRoot,
    ['diff', '--cached', '--quiet', '--', ...relativePaths],
    { allowFailure: true },
  )
  if (staged.status === 0) return { committed: false }
  if (staged.status !== 1) {
    throw new Error((staged.stderr || 'Unable to inspect staged memory changes.').trim())
  }

  const authorName = options.authorName || 'Antigravity Memory'
  const authorEmail = options.authorEmail || 'agy-memory-layer@local'
  try {
    runGit(options.memoryRoot, [
      '-c',
      `user.name=${authorName}`,
      '-c',
      `user.email=${authorEmail}`,
      'commit',
      '-m',
      options.reason,
      '--',
      ...relativePaths,
    ])
  } catch (error) {
    runGit(options.memoryRoot, ['reset', 'HEAD', '--', ...relativePaths], { allowFailure: true })
    throw error
  }

  const sha = execFileSync('git', ['-C', options.memoryRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf-8',
  }).trim()
  return { committed: true, sha }
}

const runCli = (): void => {
  const memoryRoot =
    process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')
  const args = process.argv.slice(2)
  const command = args[0] || 'status'

  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(getMemoryRepositoryStatus(memoryRoot), null, 2)}\n`)
    return
  }
  if (command === 'commit') {
    const relativePaths: string[] = []
    let reason = ''
    for (let index = 1; index < args.length; index++) {
      if (args[index] === '--path' && args[index + 1]) relativePaths.push(args[++index])
      else if (args[index] === '--reason' && args[index + 1]) reason = args[++index]
    }
    if (!reason || relativePaths.length === 0) {
      throw new Error(
        'Usage: memory-repository.ts commit --reason <message> --path <relative-path> [...]',
      )
    }
    process.stdout.write(
      `${JSON.stringify(commitMemoryPaths({ memoryRoot, relativePaths, reason }), null, 2)}\n`,
    )
    return
  }

  throw new Error(`Unknown memory repository command: ${command}`)
}

if (isDirectCliInvocation(import.meta.url)) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
