#!/usr/bin/env node --experimental-strip-types

/**
 * Memory Backup & Migration Tool for agy-memory-layer (MemFS)
 * Provides export, import, and verification of memory blocks with SHA-256 integrity checks.
 *
 * Rules:
 * - TypeScript type alias ONLY (no interface).
 * - Zero external dependencies (uses native Node.js crypto, fs, path).
 */

import { execSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertMemoryRepositoryCleanForWrite,
  commitMemoryPaths,
  deleteMemoryFile,
  writeMemoryBuffer,
} from '../plugins/agy-memory-layer/scripts/memory-repository.ts'

// -----------------------------------------------------------------------------
// Type Definitions (Strictly type aliases ONLY - No interface)
// -----------------------------------------------------------------------------

export type MemoryFileEntry = {
  relativePath: string
  content: string
  encoding: 'utf-8' | 'base64'
  sizeBytes: number
  sha256: string
  mtime?: string
}

export type MemoryBackupManifest = {
  version: '1.0.0'
  format: 'agy-memfs-bundle/v1'
  createdAt: string
  sourceDir: string
  gitCommitHash?: string | null
  fileCount: number
  totalBytes: number
  files: MemoryFileEntry[]
}

export type MemoryBundle = {
  format: 'agy-memfs-bundle/v1'
  version: '1.0.0'
  createdAt: string
  payloadChecksum: string
  manifest: MemoryBackupManifest
}

export type ExportOptions = {
  sourceDir?: string
  outputPath?: string
  projectFilter?: string[]
  pretty?: boolean
}

export type VerificationFileResult = {
  relativePath: string
  valid: boolean
  expectedSha256: string
  actualSha256: string
  error?: string
}

export type VerificationResult = {
  valid: boolean
  formatMatch: boolean
  manifestChecksumMatch: boolean
  filesIntegrityMatch: boolean
  fileCount: number
  totalBytes: number
  manifest?: MemoryBackupManifest
  fileDetails: VerificationFileResult[]
  errors: string[]
}

export type ImportOptions = {
  bundlePath?: string
  bundleData?: MemoryBundle
  targetDir?: string
  overwrite?: boolean
  cleanTarget?: boolean
  dryRun?: boolean
  autoCommit?: boolean
  ignoreTamperWarning?: boolean
}

export type ImportResult = {
  success: boolean
  targetDir: string
  restoredFiles: string[]
  skippedFiles: string[]
  dryRun: boolean
  gitCommitted: boolean
  commitHash?: string
  verification: VerificationResult
}

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

/**
 * Computes SHA-256 hash string for buffer or string.
 */
export const computeSha256 = (data: string | Buffer): string => {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/**
 * Normalizes relative path to forward slashes for cross-platform consistency.
 */
export const normalizeRelPath = (relPath: string): string => {
  return relPath.split(path.sep).join('/')
}

/**
 * Validates the portable relative-path contract used by bundle manifests.
 */
export const validateBundleRelativePath = (relativePath: string): string => {
  if (!relativePath || relativePath.includes('\0')) {
    throw new Error('Unsafe bundle path: path must be a non-empty relative path')
  }

  if (relativePath.includes('\\')) {
    throw new Error(`Unsafe bundle path '${relativePath}': use forward slashes only`)
  }

  if (path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(`Unsafe bundle path '${relativePath}': absolute paths are not allowed`)
  }

  const segments = relativePath.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe bundle path '${relativePath}': traversal segments are not allowed`)
  }

  return relativePath
}

/**
 * Resolves a validated bundle path and proves it remains inside the import target.
 */
export const resolveImportTargetPath = (targetDir: string, relativePath: string): string => {
  const validatedPath = validateBundleRelativePath(relativePath)
  const resolvedTarget = path.resolve(targetDir)
  const resolvedFile = path.resolve(resolvedTarget, ...validatedPath.split('/'))
  const relativeToTarget = path.relative(resolvedTarget, resolvedFile)

  if (
    relativeToTarget === '' ||
    relativeToTarget === '..' ||
    relativeToTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToTarget)
  ) {
    throw new Error(`Unsafe bundle path '${relativePath}': target escapes the import directory`)
  }

  return resolvedFile
}

/**
 * Recursively scans directory for memory files, ignoring .git directory.
 */
export const scanMemoryDirectory = (dirPath: string, rootDir: string = dirPath): string[] => {
  if (!fs.existsSync(dirPath)) {
    return []
  }

  const results: string[] = []
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    const relPath = path.relative(rootDir, fullPath)

    // Preserve every memory file, including tracked test/transient evidence. Only editor swap
    // files are excluded because they are incomplete process artifacts.
    if (entry.name === '.git' || entry.name.endsWith('.swp')) {
      continue
    }

    if (entry.isDirectory()) {
      results.push(...scanMemoryDirectory(fullPath, rootDir))
    } else if (entry.isFile()) {
      results.push(relPath)
    }
  }

  return results.sort()
}

/**
 * Gets default MemFS directory path (~/.gemini/memory).
 */
export const getDefaultMemoryDir = (): string => {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ''
  return path.join(homeDir, '.gemini', 'memory')
}

/**
 * Retrieves latest Git commit hash from directory if it is a Git repo.
 */
export const getGitCommitHash = (dirPath: string): string | null => {
  const gitDir = path.join(dirPath, '.git')
  if (!fs.existsSync(gitDir)) {
    return null
  }
  try {
    const hash = execSync('git rev-parse HEAD', {
      cwd: dirPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return hash || null
  } catch {
    return null
  }
}

// -----------------------------------------------------------------------------
// Core Operations: Export, Verify, Import
// -----------------------------------------------------------------------------

/**
 * Exports memory blocks into a standalone MemoryBundle with individual and manifest SHA256 checksums.
 */
export const exportMemoryBundle = (options: ExportOptions = {}): MemoryBundle => {
  const sourceDir = path.resolve(options.sourceDir || getDefaultMemoryDir())

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Memory source directory does not exist: ${sourceDir}`)
  }

  const relFiles = scanMemoryDirectory(sourceDir)
  const fileEntries: MemoryFileEntry[] = []
  let totalBytes = 0

  for (const relFile of relFiles) {
    const normalizedRel = normalizeRelPath(relFile)

    // Optional project filter
    if (options.projectFilter && options.projectFilter.length > 0) {
      if (normalizedRel.startsWith('projects/')) {
        const parts = normalizedRel.split('/')
        const projectSlug = parts[1]
        if (!options.projectFilter.includes(projectSlug)) {
          continue
        }
      }
    }

    const fullPath = path.join(sourceDir, relFile)
    const buffer = fs.readFileSync(fullPath)
    const content = buffer.toString('utf-8')
    const sha256 = computeSha256(buffer)
    const stat = fs.statSync(fullPath)

    totalBytes += buffer.length
    fileEntries.push({
      relativePath: normalizedRel,
      content,
      encoding: 'utf-8',
      sizeBytes: buffer.length,
      sha256,
      mtime: stat.mtime.toISOString(),
    })
  }

  const gitCommitHash = getGitCommitHash(sourceDir)
  const manifest: MemoryBackupManifest = {
    version: '1.0.0',
    format: 'agy-memfs-bundle/v1',
    createdAt: new Date().toISOString(),
    sourceDir: path.basename(sourceDir),
    gitCommitHash,
    fileCount: fileEntries.length,
    totalBytes,
    files: fileEntries,
  }

  const manifestJsonString = JSON.stringify(manifest)
  const payloadChecksum = computeSha256(manifestJsonString)

  const bundle: MemoryBundle = {
    format: 'agy-memfs-bundle/v1',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    payloadChecksum,
    manifest,
  }

  if (options.outputPath) {
    const outResolved = path.resolve(options.outputPath)
    const outDir = path.dirname(outResolved)
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true })
    }
    const jsonOutput = options.pretty ? JSON.stringify(bundle, null, 2) : JSON.stringify(bundle)
    fs.writeFileSync(outResolved, jsonOutput, 'utf-8')
  }

  return bundle
}

/**
 * Verifies integrity of a MemoryBundle against SHA-256 signatures.
 */
export const verifyMemoryBundle = (bundleOrPath: string | MemoryBundle): VerificationResult => {
  let bundle: MemoryBundle
  const errors: string[] = []

  if (typeof bundleOrPath === 'string') {
    const resolvedPath = path.resolve(bundleOrPath)
    if (!fs.existsSync(resolvedPath)) {
      return {
        valid: false,
        formatMatch: false,
        manifestChecksumMatch: false,
        filesIntegrityMatch: false,
        fileCount: 0,
        totalBytes: 0,
        fileDetails: [],
        errors: [`Bundle file not found at: ${resolvedPath}`],
      }
    }

    try {
      const raw = fs.readFileSync(resolvedPath, 'utf-8')
      bundle = JSON.parse(raw) as MemoryBundle
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        valid: false,
        formatMatch: false,
        manifestChecksumMatch: false,
        filesIntegrityMatch: false,
        fileCount: 0,
        totalBytes: 0,
        fileDetails: [],
        errors: [`Failed to parse bundle JSON: ${msg}`],
      }
    }
  } else {
    bundle = bundleOrPath
  }

  // 1. Format check
  const formatMatch = bundle.format === 'agy-memfs-bundle/v1' && bundle.version === '1.0.0'
  if (!formatMatch) {
    errors.push(
      `Invalid bundle format: expected 'agy-memfs-bundle/v1' v1.0.0, received '${bundle.format}'`,
    )
  }

  if (!bundle.manifest || !Array.isArray(bundle.manifest.files)) {
    errors.push('Invalid bundle structure: manifest or manifest.files is missing')
    return {
      valid: false,
      formatMatch,
      manifestChecksumMatch: false,
      filesIntegrityMatch: false,
      fileCount: 0,
      totalBytes: 0,
      fileDetails: [],
      errors,
    }
  }

  // 2. Manifest payload checksum verification
  const computedPayloadChecksum = computeSha256(JSON.stringify(bundle.manifest))
  const manifestChecksumMatch = computedPayloadChecksum === bundle.payloadChecksum
  if (!manifestChecksumMatch) {
    errors.push(
      `Manifest payload checksum mismatch (tampering detected)! Expected: ${bundle.payloadChecksum}, Computed: ${computedPayloadChecksum}`,
    )
  }

  // 3. Individual file hash verification
  const fileDetails: VerificationFileResult[] = []
  let allFilesValid = true

  for (const fileEntry of bundle.manifest.files) {
    try {
      validateBundleRelativePath(fileEntry.relativePath)
    } catch (err: unknown) {
      allFilesValid = false
      const errorMsg = err instanceof Error ? err.message : String(err)
      errors.push(errorMsg)
      fileDetails.push({
        relativePath: fileEntry.relativePath,
        valid: false,
        expectedSha256: fileEntry.sha256,
        actualSha256: fileEntry.sha256,
        error: errorMsg,
      })
      continue
    }

    const rawBuffer = Buffer.from(fileEntry.content, fileEntry.encoding || 'utf-8')
    const computedFileSha256 = computeSha256(rawBuffer)
    const valid = computedFileSha256 === fileEntry.sha256

    if (!valid) {
      allFilesValid = false
      const errorMsg = `File '${fileEntry.relativePath}' SHA-256 mismatch! Expected: ${fileEntry.sha256}, Computed: ${computedFileSha256}`
      errors.push(errorMsg)
      fileDetails.push({
        relativePath: fileEntry.relativePath,
        valid: false,
        expectedSha256: fileEntry.sha256,
        actualSha256: computedFileSha256,
        error: errorMsg,
      })
    } else {
      fileDetails.push({
        relativePath: fileEntry.relativePath,
        valid: true,
        expectedSha256: fileEntry.sha256,
        actualSha256: computedFileSha256,
      })
    }
  }

  const valid = formatMatch && manifestChecksumMatch && allFilesValid

  return {
    valid,
    formatMatch,
    manifestChecksumMatch,
    filesIntegrityMatch: allFilesValid,
    fileCount: bundle.manifest.fileCount,
    totalBytes: bundle.manifest.totalBytes,
    manifest: bundle.manifest,
    fileDetails,
    errors,
  }
}

/**
 * Imports a memory bundle into target directory with integrity verification and git auto-commit.
 */
export const importMemoryBundle = (options: ImportOptions): ImportResult => {
  const targetDir = path.resolve(options.targetDir || getDefaultMemoryDir())

  let bundle: MemoryBundle
  if (options.bundleData) {
    bundle = options.bundleData
  } else if (options.bundlePath) {
    const resolvedPath = path.resolve(options.bundlePath)
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Bundle file not found: ${resolvedPath}`)
    }
    const raw = fs.readFileSync(resolvedPath, 'utf-8')
    bundle = JSON.parse(raw) as MemoryBundle
  } else {
    throw new Error('Either bundlePath or bundleData must be provided to importMemoryBundle')
  }

  // Verify integrity
  const verification = verifyMemoryBundle(bundle)
  if (!verification.valid && !options.ignoreTamperWarning) {
    throw new Error(`Bundle integrity verification failed:\n- ${verification.errors.join('\n- ')}`)
  }

  const validatedEntries = bundle.manifest.files.map((fileEntry) => ({
    fileEntry,
    targetFilePath: resolveImportTargetPath(targetDir, fileEntry.relativePath),
  }))
  const uniqueTargets = new Set(validatedEntries.map(({ targetFilePath }) => targetFilePath))
  if (uniqueTargets.size !== validatedEntries.length) {
    throw new Error('Unsafe bundle manifest: multiple entries resolve to the same target path')
  }

  const restoredFiles: string[] = []
  const skippedFiles: string[] = []

  if (options.dryRun) {
    for (const { fileEntry, targetFilePath } of validatedEntries) {
      if (fs.existsSync(targetFilePath) && !options.overwrite) {
        skippedFiles.push(fileEntry.relativePath)
      } else {
        restoredFiles.push(fileEntry.relativePath)
      }
    }
    return {
      success: true,
      targetDir,
      restoredFiles,
      skippedFiles,
      dryRun: true,
      gitCommitted: false,
      verification,
    }
  }

  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const changedPaths = new Set<string>()
  const isGitRepo = fs.existsSync(path.join(targetDir, '.git'))
  if (isGitRepo) assertMemoryRepositoryCleanForWrite(targetDir)

  // Clean target if requested
  if (options.cleanTarget) {
    const existing = scanMemoryDirectory(targetDir)
    for (const rel of existing) {
      deleteMemoryFile(targetDir, rel)
      changedPaths.add(rel)
    }
  }

  // Restore files
  for (const { fileEntry, targetFilePath } of validatedEntries) {
    const parentDir = path.dirname(targetFilePath)

    if (fs.existsSync(targetFilePath) && !options.overwrite && !options.cleanTarget) {
      skippedFiles.push(fileEntry.relativePath)
      continue
    }

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }

    const contentBuffer = Buffer.from(fileEntry.content, fileEntry.encoding || 'utf-8')
    writeMemoryBuffer(targetDir, fileEntry.relativePath, contentBuffer)
    restoredFiles.push(fileEntry.relativePath)
    changedPaths.add(fileEntry.relativePath)
  }

  // Git auto-commit if target is a git repository
  let gitCommitted = false
  let commitHash: string | undefined

  const shouldAutoCommit = options.autoCommit !== false

  if (shouldAutoCommit && isGitRepo && changedPaths.size > 0) {
    const commitMsg = `backup: restore ${restoredFiles.length} memory blocks (${new Date().toISOString()})`
    const commit = commitMemoryPaths({
      memoryRoot: targetDir,
      relativePaths: [...changedPaths],
      reason: commitMsg,
    })
    if (commit.committed) {
      commitHash = getGitCommitHash(targetDir) || undefined
      gitCommitted = true
    }
  }

  return {
    success: true,
    targetDir,
    restoredFiles,
    skippedFiles,
    dryRun: false,
    gitCommitted,
    commitHash,
    verification,
  }
}

// -----------------------------------------------------------------------------
// CLI Handler
// -----------------------------------------------------------------------------

const printHelp = (): void => {
  console.log(`
📦 MemFS Backup & Restore Utility (agy-memory-layer)

Usage:
  memory-backup export [options]   Export memory blocks into a single verified bundle
  memory-backup import [options]   Import and restore memory blocks with SHA-256 verification
  memory-backup verify [options]   Verify bundle SHA-256 checksums and payload integrity
  memory-backup help               Show this help message

Options:
  --output, -o <path>       Output bundle file path (default: ./memory-backup-<timestamp>.agybackup.json)
  --input, -i <path>        Input bundle file path
  --source, -s <path>       Source memory directory (default: ~/.gemini/memory)
  --target, -t <path>       Target memory directory (default: ~/.gemini/memory)
  --project, -p <slug>      Filter export by project slug (can be specified multiple times)
  --overwrite               Overwrite existing files during import (default: true)
  --clean                   Clean target directory before importing
  --dry-run                 Simulate restore without writing files to disk
  --no-commit               Skip automatic git commit after restore
  --pretty                  Format output JSON nicely
  --json                    Output pure JSON result to stdout

Examples:
  # Export active memory to bundle
  node tools/memory-backup.ts export -o ./backup.json

  # Verify bundle integrity
  node tools/memory-backup.ts verify -i ./backup.json

  # Restore bundle to MemFS
  node tools/memory-backup.ts import -i ./backup.json
`)
}

export const runCli = (args: string[]): void => {
  const command = args[0] || 'help'

  const getArg = (flags: string[]): string | undefined => {
    for (const flag of flags) {
      const idx = args.indexOf(flag)
      if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
        return args[idx + 1]
      }
    }
    return undefined
  }

  const getMultiArg = (flags: string[]): string[] => {
    const list: string[] = []
    for (let i = 0; i < args.length; i++) {
      if (flags.includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('-')) {
        list.push(args[i + 1])
      }
    }
    return list
  }

  const hasFlag = (flags: string[]): boolean => {
    return flags.some((flag) => args.includes(flag))
  }

  const isJson = hasFlag(['--json'])

  try {
    if (command === 'export') {
      const defaultName = `memory-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      const outputPath = getArg(['--output', '-o']) || path.join(process.cwd(), defaultName)
      const sourceDir = getArg(['--source', '-s', '--memory-dir'])
      const projectFilter = getMultiArg(['--project', '-p'])
      const pretty = hasFlag(['--pretty']) || !hasFlag(['--compact'])

      const bundle = exportMemoryBundle({
        sourceDir,
        outputPath,
        projectFilter: projectFilter.length > 0 ? projectFilter : undefined,
        pretty,
      })

      if (isJson) {
        console.log(JSON.stringify(bundle))
      } else {
        console.log('==================================================')
        console.log('📦 Memory Blocks Export Complete')
        console.log('==================================================')
        console.log(`- Bundle File   : ${outputPath}`)
        console.log(`- Total Files   : ${bundle.manifest.fileCount}`)
        console.log(`- Total Size    : ${bundle.manifest.totalBytes} bytes`)
        console.log(`- SHA-256 Hash  : ${bundle.payloadChecksum}`)
        if (bundle.manifest.gitCommitHash) {
          console.log(`- Git Snapshot  : ${bundle.manifest.gitCommitHash}`)
        }
        console.log('==================================================')
      }
    } else if (command === 'verify') {
      const inputPath = getArg(['--input', '-i']) || args[1]
      if (!inputPath) {
        console.error('Error: --input <path> is required for verify command.')
        process.exit(1)
      }

      const result = verifyMemoryBundle(inputPath)

      if (isJson) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log('==================================================')
        console.log('🔍 Memory Bundle Integrity Verification')
        console.log('==================================================')
        console.log(`- Bundle File        : ${inputPath}`)
        console.log(`- Format Check       : ${result.formatMatch ? '✔ PASSED' : '✖ FAILED'}`)
        console.log(
          `- Manifest SHA-256   : ${result.manifestChecksumMatch ? '✔ MATCHED' : '✖ TAMPERED'}`,
        )
        console.log(
          `- Files Hash Check   : ${result.filesIntegrityMatch ? '✔ ALL MATCHED' : '✖ CORRUPTED'}`,
        )
        console.log(`- Total Files        : ${result.fileCount}`)
        console.log(
          `- Overall Status     : ${result.valid ? '🟢 INTEGRITY VERIFIED' : '🔴 VERIFICATION FAILED'}`,
        )

        if (result.errors.length > 0) {
          console.log('\nErrors Detected:')
          for (const err of result.errors) {
            console.log(`  ✖ ${err}`)
          }
        }
        console.log('==================================================')
      }

      if (!result.valid) {
        process.exit(1)
      }
    } else if (command === 'import') {
      const inputPath = getArg(['--input', '-i']) || args[1]
      if (!inputPath) {
        console.error('Error: --input <path> is required for import command.')
        process.exit(1)
      }

      const targetDir = getArg(['--target', '-t', '--target-dir'])
      const overwrite = !hasFlag(['--no-overwrite'])
      const cleanTarget = hasFlag(['--clean'])
      const dryRun = hasFlag(['--dry-run'])
      const autoCommit = !hasFlag(['--no-commit'])

      const result = importMemoryBundle({
        bundlePath: inputPath,
        targetDir,
        overwrite,
        cleanTarget,
        dryRun,
        autoCommit,
      })

      if (isJson) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log('==================================================')
        console.log('📥 Memory Bundle Import & Restore')
        console.log('==================================================')
        console.log(`- Bundle File     : ${inputPath}`)
        console.log(`- Target Directory: ${result.targetDir}`)
        console.log(`- Mode            : ${dryRun ? 'SIMULATION (Dry Run)' : 'APPLIED'}`)
        console.log(`- Restored Files  : ${result.restoredFiles.length}`)
        console.log(`- Skipped Files   : ${result.skippedFiles.length}`)
        console.log(
          `- Git Auto-Commit : ${result.gitCommitted ? `✔ Commit: ${result.commitHash}` : 'Skipped'}`,
        )
        console.log('==================================================')
      }
    } else if (command === 'help' || command === '--help' || command === '-h') {
      printHelp()
    } else {
      console.error(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`✖ Error: ${msg}`)
    process.exit(1)
  }
}

// Direct CLI execution check
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null
const isMain = entryPath ? pathToFileURL(entryPath).href === import.meta.url : false

if (isMain) {
  runCli(process.argv.slice(2))
}
