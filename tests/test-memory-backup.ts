#!/usr/bin/env node

/**
 * Unit Test Suite for tools/memory-backup.ts
 * Tests export, import, SHA-256 integrity checks, tamper detection, and project-specific conventions.
 */

import * as assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const ROOT_DIR = path.resolve(import.meta.dirname, '..')
const TOOLS_DIR = path.join(ROOT_DIR, 'tools')
const BACKUP_TOOL_TS = path.join(TOOLS_DIR, 'memory-backup.ts')
const { computeSha256, importMemoryBundle } = await import(BACKUP_TOOL_TS)

export type TestResult = {
  suite: string
  name: string
  status: 'PASSED' | 'FAILED'
  duration: number
  detail: string | null
  error: string | null
}

const results: TestResult[] = []

function runTest(suite: string, name: string, testFn: () => string | undefined): void {
  const startTime = Date.now()
  console.log(`▶ [${suite}] ${name}...`)
  try {
    const detail = testFn()
    const duration = Date.now() - startTime
    results.push({
      suite,
      name,
      status: 'PASSED',
      duration,
      detail: detail || 'OK',
      error: null,
    })
    console.log(`  ✔ PASSED (${duration}ms)`)
  } catch (err: unknown) {
    const duration = Date.now() - startTime
    const message = err instanceof Error ? err.message : String(err)
    results.push({
      suite,
      name,
      status: 'FAILED',
      duration,
      detail: null,
      error: message,
    })
    console.error(`  ✖ FAILED (${duration}ms): ${message}`)
  }
}

console.log('==================================================')
console.log('🧪 Running tools/memory-backup.ts Unit Tests')
console.log('==================================================')

const BACKUP_TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-memory-backup-tests-'))
const SANDBOX_DIR = path.join(BACKUP_TEST_ROOT, 'sandbox')
const TEST_BUNDLE_PATH = path.join(BACKUP_TEST_ROOT, 'memfs-bundle.json')
const OUTSIDE_ESCAPE_PATH = `${BACKUP_TEST_ROOT}-escape.md`

function setupSandbox() {
  if (fs.existsSync(SANDBOX_DIR)) {
    fs.rmSync(SANDBOX_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(path.join(SANDBOX_DIR, 'global'), { recursive: true })
  fs.mkdirSync(path.join(SANDBOX_DIR, 'projects', 'proj-alpha', 'learnings'), {
    recursive: true,
  })
  fs.mkdirSync(path.join(SANDBOX_DIR, 'projects', 'proj-beta'), {
    recursive: true,
  })

  // Global files
  fs.writeFileSync(
    path.join(SANDBOX_DIR, 'global', 'human.md'),
    '# Human Profile\nPreferences: Fast, concise, Thai language.',
  )
  fs.writeFileSync(
    path.join(SANDBOX_DIR, 'global', 'persona.md'),
    '# Persona Directives\nRole: Lead Architect Pair Programmer.',
  )

  // Project Alpha
  fs.writeFileSync(
    path.join(SANDBOX_DIR, 'projects', 'proj-alpha', 'project.md'),
    '# Project Alpha\nType: Cloudflare Workers + SQLite.',
  )
  fs.writeFileSync(
    path.join(SANDBOX_DIR, 'projects', 'proj-alpha', 'rules.md'),
    '# Alpha Rules\nUse exact versions with -E.',
  )
  fs.writeFileSync(
    path.join(SANDBOX_DIR, 'projects', 'proj-alpha', 'learnings', '2026-08-18_db.md'),
    '# Learning: Database Migrations\nUse D1 execSync for batch migration.',
  )

  // Project Beta
  fs.writeFileSync(
    path.join(SANDBOX_DIR, 'projects', 'proj-beta', 'project.md'),
    '# Project Beta\nType: Next.js + Tailwind CSS.',
  )
}

function cleanupSandbox() {
  fs.rmSync(BACKUP_TEST_ROOT, { recursive: true, force: true })
  fs.rmSync(OUTSIDE_ESCAPE_PATH, { force: true })
}

// 1. Export Bundle Verification
runTest('Export', 'Generates valid JSON bundle with SHA-256 checksums', () => {
  setupSandbox()

  const exportProc = spawnSync(
    'node',
    [
      '--experimental-strip-types',
      BACKUP_TOOL_TS,
      'export',
      '--memory-dir',
      SANDBOX_DIR,
      '--output',
      TEST_BUNDLE_PATH,
      '--json',
    ],
    { encoding: 'utf-8' },
  )

  if (exportProc.status !== 0) {
    throw new Error(`Export command failed: ${exportProc.stderr || exportProc.stdout}`)
  }

  assert.ok(fs.existsSync(TEST_BUNDLE_PATH), 'Bundle file must exist')
  const bundle = JSON.parse(fs.readFileSync(TEST_BUNDLE_PATH, 'utf-8'))

  assert.strictEqual(bundle.format, 'agy-memfs-bundle/v1')
  assert.strictEqual(bundle.manifest.fileCount, 6)
  assert.ok(bundle.payloadChecksum.length === 64, 'Payload checksum must be 64-char SHA256 hex')

  // Check file entries
  const relPaths = bundle.manifest.files.map((f: { relativePath: string }) => f.relativePath)
  assert.ok(relPaths.includes('global/human.md'))
  assert.ok(relPaths.includes('global/persona.md'))
  assert.ok(relPaths.includes('projects/proj-alpha/project.md'))
  assert.ok(relPaths.includes('projects/proj-alpha/learnings/2026-08-18_db.md'))
  assert.ok(relPaths.includes('projects/proj-beta/project.md'))

  return `Exported ${bundle.manifest.fileCount} files successfully.`
})

// 2. Verify Bundle (Integrity check)
runTest('Verify', 'Validates untampered bundle successfully', () => {
  const verifyProc = spawnSync(
    'node',
    ['--experimental-strip-types', BACKUP_TOOL_TS, 'verify', '--input', TEST_BUNDLE_PATH, '--json'],
    { encoding: 'utf-8' },
  )

  if (verifyProc.status !== 0) {
    throw new Error(`Verify command failed: ${verifyProc.stderr || verifyProc.stdout}`)
  }

  const result = JSON.parse(verifyProc.stdout)
  assert.strictEqual(result.valid, true)
  assert.strictEqual(result.fileCount, 6)
  return 'Payload and all 6 individual file SHA-256 checksums verified.'
})

// 3. Tamper Detection Test
runTest('Tamper Detection', 'Detects corrupted or modified payload', () => {
  const bundle = JSON.parse(fs.readFileSync(TEST_BUNDLE_PATH, 'utf-8'))

  const humanFile = bundle.manifest.files.find(
    (f: { relativePath: string }) => f.relativePath === 'global/human.md',
  )
  humanFile.content = '# HACKED PREFERENCES\nMalicious injected content!'

  const tamperedPath = path.join(BACKUP_TEST_ROOT, 'tampered-bundle.json')
  fs.writeFileSync(tamperedPath, JSON.stringify(bundle, null, 2), 'utf-8')

  const verifyProc = spawnSync(
    'node',
    ['--experimental-strip-types', BACKUP_TOOL_TS, 'verify', '--input', tamperedPath, '--json'],
    { encoding: 'utf-8' },
  )

  fs.unlinkSync(tamperedPath)

  // Must fail validation (non-zero status or valid: false in JSON)
  const result = JSON.parse(verifyProc.stdout || verifyProc.stderr)
  assert.strictEqual(result.valid, false, 'Verification must report invalid for tampered bundle')
  assert.ok(result.errors.length > 0, 'Must list checksum mismatch errors')

  return `Tamper detected: ${result.errors[0]}`
})

// 4. Import / Restore Dry-Run Test
runTest('Import Dry-Run', 'Simulates restore without writing files to disk', () => {
  const importProc = spawnSync(
    'node',
    [
      '--experimental-strip-types',
      BACKUP_TOOL_TS,
      'import',
      '--input',
      TEST_BUNDLE_PATH,
      '--target-dir',
      SANDBOX_DIR,
      '--dry-run',
      '--json',
    ],
    { encoding: 'utf-8' },
  )

  if (importProc.status !== 0) {
    throw new Error(`Import dry-run failed: ${importProc.stderr || importProc.stdout}`)
  }

  const result = JSON.parse(importProc.stdout)
  assert.strictEqual(result.dryRun, true)
  assert.strictEqual(result.restoredFiles.length, 6)
  return `Simulated restore of ${result.restoredFiles.length} files safely.`
})

// 5. Full Restore to Empty Directory
runTest('Import Real', 'Restores entire MemFS tree to empty target', () => {
  const RESTORE_TARGET = path.join(BACKUP_TEST_ROOT, 'restore-destination')
  if (fs.existsSync(RESTORE_TARGET)) {
    fs.rmSync(RESTORE_TARGET, { recursive: true, force: true })
  }

  const importProc = spawnSync(
    'node',
    [
      '--experimental-strip-types',
      BACKUP_TOOL_TS,
      'import',
      '--input',
      TEST_BUNDLE_PATH,
      '--target-dir',
      RESTORE_TARGET,
      '--json',
    ],
    { encoding: 'utf-8' },
  )

  if (importProc.status !== 0) {
    throw new Error(`Import failed: ${importProc.stderr || importProc.stdout}`)
  }

  // Verify all files exist in restore target with exact contents
  const humanContent = fs.readFileSync(path.join(RESTORE_TARGET, 'global', 'human.md'), 'utf-8')
  assert.ok(humanContent.includes('Preferences: Fast, concise, Thai language.'))

  const alphaRuleContent = fs.readFileSync(
    path.join(RESTORE_TARGET, 'projects', 'proj-alpha', 'rules.md'),
    'utf-8',
  )
  assert.ok(alphaRuleContent.includes('Use exact versions with -E.'))

  const learningContent = fs.readFileSync(
    path.join(RESTORE_TARGET, 'projects', 'proj-alpha', 'learnings', '2026-08-18_db.md'),
    'utf-8',
  )
  assert.ok(learningContent.includes('Use D1 execSync for batch migration.'))

  // Clean up restore destination
  fs.rmSync(RESTORE_TARGET, { recursive: true, force: true })

  return 'Complete directory structure, global profile, and project rules restored 1:1.'
})

// 6. Project Filter Export Test
runTest(
  'Project Filter',
  'Exports only specific project while including global preferences',
  () => {
    const filteredBundlePath = path.join(BACKUP_TEST_ROOT, 'filtered-bundle.json')
    const filterProc = spawnSync(
      'node',
      [
        '--experimental-strip-types',
        BACKUP_TOOL_TS,
        'export',
        '--memory-dir',
        SANDBOX_DIR,
        '--project',
        'proj-alpha',
        '--output',
        filteredBundlePath,
        '--json',
      ],
      { encoding: 'utf-8' },
    )

    if (filterProc.status !== 0) {
      throw new Error(`Filtered export failed: ${filterProc.stderr || filterProc.stdout}`)
    }

    const bundle = JSON.parse(fs.readFileSync(filteredBundlePath, 'utf-8'))
    fs.unlinkSync(filteredBundlePath)

    const paths = bundle.manifest.files.map((f: { relativePath: string }) => f.relativePath)
    assert.ok(paths.includes('global/human.md'), 'Global profile must be included')
    assert.ok(paths.includes('projects/proj-alpha/project.md'), 'proj-alpha must be included')
    assert.ok(!paths.includes('projects/proj-beta/project.md'), 'proj-beta must NOT be included')

    return `Filtered bundle contains ${bundle.manifest.fileCount} files (proj-alpha included, proj-beta excluded).`
  },
)

// 7. Import Path Containment Test
runTest('Import Security', 'Rejects checksum-valid paths that escape or bypass the target', () => {
  const originalBundle = JSON.parse(fs.readFileSync(TEST_BUNDLE_PATH, 'utf-8'))
  const targetDir = path.join(BACKUP_TEST_ROOT, 'path-containment-target')
  const unsafePaths = [
    '../escape.md',
    OUTSIDE_ESCAPE_PATH,
    'C:\\escape.md',
    'global\\human.md',
    'global/./human.md',
  ]

  for (const unsafePath of unsafePaths) {
    const maliciousBundle = structuredClone(originalBundle)
    maliciousBundle.manifest.files[0].relativePath = unsafePath
    maliciousBundle.payloadChecksum = computeSha256(JSON.stringify(maliciousBundle.manifest))

    assert.throws(
      () =>
        importMemoryBundle({
          bundleData: maliciousBundle,
          targetDir,
          dryRun: true,
          ignoreTamperWarning: true,
        }),
      /Unsafe bundle path/,
      `Expected unsafe bundle path to be rejected: ${unsafePath}`,
    )
  }

  const symlinkTarget = path.join(BACKUP_TEST_ROOT, 'symlink-containment-target')
  const outsideDir = path.join(BACKUP_TEST_ROOT, 'outside-symlink-target')
  fs.mkdirSync(symlinkTarget, { recursive: true })
  fs.mkdirSync(outsideDir, { recursive: true })
  fs.symlinkSync(outsideDir, path.join(symlinkTarget, 'global'))
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: symlinkTarget })
  spawnSync('git', ['add', 'global'], { cwd: symlinkTarget })
  spawnSync(
    'git',
    [
      '-c',
      'user.name=tests',
      '-c',
      'user.email=tests@example.invalid',
      'commit',
      '-q',
      '-m',
      'test: seed symlink fixture',
    ],
    { cwd: symlinkTarget },
  )

  assert.throws(
    () =>
      importMemoryBundle({
        bundleData: originalBundle,
        targetDir: symlinkTarget,
        overwrite: true,
        autoCommit: false,
      }),
    /outside configured root/,
  )
  assert.strictEqual(fs.existsSync(path.join(outsideDir, 'human.md')), false)

  assert.strictEqual(fs.existsSync(OUTSIDE_ESCAPE_PATH), false)
  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.rmSync(symlinkTarget, { recursive: true, force: true })
  fs.rmSync(outsideDir, { recursive: true, force: true })
  return `Rejected ${unsafePaths.length} unsafe path variants plus a committed symlink escape.`
})

// Clean up test sandbox
cleanupSandbox()

const total = results.length
const passed = results.filter((r) => r.status === 'PASSED').length
const failed = results.filter((r) => r.status === 'FAILED').length

console.log('\n==================================================')
console.log(`📊 Result: ${passed}/${total} passed (${failed === 0 ? 'ALL PASSED' : 'FAILED'})`)
console.log('==================================================')

if (failed > 0) {
  process.exit(1)
}
