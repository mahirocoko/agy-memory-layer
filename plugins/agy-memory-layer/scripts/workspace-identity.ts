import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { committedMemoryPathExists, validateProjectSlug } from './memory-repository.ts'

export type WorkspaceHistoryEntry = {
  conversationId?: string
  timestamp?: number
  workspace?: string
}

export const toProjectSlug = (value: string): string => {
  const candidate = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  return validateProjectSlug(candidate || 'workspace')
}

export const resolveGitRoot = (workspacePath: string): string | null => {
  try {
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workspacePath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return gitRoot || null
  } catch {
    return null
  }
}

export const getWorkspaceRootSlug = (workspacePath: string = process.cwd()): string => {
  const gitRoot = resolveGitRoot(workspacePath)
  return toProjectSlug(path.basename(gitRoot || workspacePath))
}

const projectScopeExists = (memoryRoot: string, slug: string): boolean =>
  committedMemoryPathExists(memoryRoot, `projects/${slug}/project.md`) ||
  committedMemoryPathExists(memoryRoot, `projects/${slug}/rules.md`)

const getRemoteCanonicalSlug = (workspacePath: string): string | null => {
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: workspacePath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!remote) return null

    const match = remote.match(/[:/]([^/:]+)\/([^/:]+?)(?:\.git)?$/)
    return match ? toProjectSlug(`${match[1]}-${match[2]}`) : null
  } catch {
    return null
  }
}

export const resolveProjectSlug = (workspacePath: string, memoryRoot: string): string => {
  const gitRoot = resolveGitRoot(workspacePath)
  const rootSlug = getWorkspaceRootSlug(workspacePath)
  const workspaceSlug = toProjectSlug(path.basename(workspacePath))
  const remoteSlug = getRemoteCanonicalSlug(gitRoot || workspacePath)
  const candidates = Array.from(
    new Set([workspaceSlug, rootSlug, remoteSlug].filter((slug): slug is string => Boolean(slug))),
  )

  return candidates.find((slug) => projectScopeExists(memoryRoot, slug)) || rootSlug
}

export const getDefaultHistoryFile = (): string =>
  process.env.AGY_HISTORY_FILE ||
  path.join(os.homedir(), '.gemini', 'antigravity-cli', 'history.jsonl')

export const readConversationWorkspaceMap = (
  historyFile: string = getDefaultHistoryFile(),
): Map<string, string> => {
  const workspaces = new Map<string, { timestamp: number; workspace: string }>()
  if (!fs.existsSync(historyFile)) return new Map()

  const lines = fs.readFileSync(historyFile, 'utf-8').split('\n').filter(Boolean)
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as WorkspaceHistoryEntry
      const conversationId = entry.conversationId?.trim()
      const workspace = entry.workspace?.trim()
      if (!conversationId || !workspace || !path.isAbsolute(workspace)) continue

      const timestamp = Number.isFinite(entry.timestamp) ? Number(entry.timestamp) : 0
      const current = workspaces.get(conversationId)
      if (!current || timestamp >= current.timestamp) {
        workspaces.set(conversationId, { timestamp, workspace })
      }
    } catch {}
  }

  return new Map(
    Array.from(workspaces, ([conversationId, entry]) => [conversationId, entry.workspace]),
  )
}
