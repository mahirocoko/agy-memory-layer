#!/usr/bin/env node

/**
 * Stop Hook for agy-memory-layer
 * Handles cross-platform automated Git snapshot and non-blocking background daemon trigger.
 * Fully cross-platform with Windows index.lock retry backoff.
 */

import { execSync, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type StopPayload = {
  decision?: string
}

export type StopOutput = {
  decision: string
}

export function handleAutoCommit(memRoot: string): boolean {
  const gitDir = path.join(memRoot, '.git')
  if (!fs.existsSync(gitDir)) return false

  try {
    const status = execSync('git status --porcelain', {
      cwd: memRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    if (!status) return false

    // Exponential backoff retry loop for Git index.lock (Windows & concurrent access safe)
    let retries = 3
    let committed = false

    while (retries > 0 && !committed) {
      const lockFile = path.join(gitDir, 'index.lock')
      if (fs.existsSync(lockFile)) {
        // If lock file is older than 5 seconds, it is likely a stale lock from a killed process
        try {
          const stat = fs.statSync(lockFile)
          if (Date.now() - stat.mtimeMs > 5000) {
            fs.unlinkSync(lockFile)
          }
        } catch {}
      }

      try {
        execSync('git add -A', { cwd: memRoot, stdio: 'ignore' })
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19)
        execSync(`git commit -m "memfs auto-snapshot: ${now}"`, { cwd: memRoot, stdio: 'ignore' })
        committed = true
      } catch {
        retries--
        if (retries > 0) {
          // Micro-sleep 50ms before retry
          const start = Date.now()
          while (Date.now() - start < 50) {}
        }
      }
    }

    return committed
  } catch {
    return false
  }
}

export function triggerBackgroundDream(scriptsDir: string): void {
  if (process.env.AGY_TEST_MODE === '1') return

  const targetScript = path.join(scriptsDir, 'dream-daemon.ts')
  if (!fs.existsSync(targetScript)) return

  try {
    const args = ['--experimental-strip-types', targetScript, '--auto-check']

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })

    child.unref()
  } catch {}
}

export function runStopHook(): StopOutput {
  const memRoot = process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory')
  handleAutoCommit(memRoot)

  const scriptsDir = import.meta.dirname
  triggerBackgroundDream(scriptsDir)

  return { decision: 'stop' }
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('hook-auto-commit.ts') ||
    process.argv[1].endsWith('hook-auto-commit.js'))
) {
  const result = runStopHook()
  process.stdout.write(JSON.stringify(result))
}
