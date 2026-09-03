import * as os from 'node:os'
import * as path from 'node:path'
import { isWithin } from './memory-repository.ts'

export type PreToolUseDecision = 'allow' | 'deny' | 'ask' | 'force_ask'

export type PreToolUseOutput = {
  decision: PreToolUseDecision
  reason?: string
  permissionOverrides?: string[]
}

export type PreToolUsePayload = {
  toolCall: {
    name: string
    args?: Record<string, unknown>
  }
  stepIdx?: number
  conversationId?: string
  workspacePaths?: string[]
  transcriptPath?: string
  artifactDirectoryPath?: string
}

const SEVERITY_WEIGHT: Record<PreToolUseDecision, number> = {
  deny: 3,
  force_ask: 2,
  ask: 1,
  allow: 0,
}

// Known declared read-only subagent manifests
const READ_ONLY_AGENTS = new Set([
  'repo_scout_agent',
  'evidence_reviewer_agent',
  'recall_agent',
  'history_analyzer_agent',
])

const DESTRUCTIVE_GIT_SUBCOMMANDS = new Set(['filter-branch', 'filter-repo'])

const STATE_ALTERING_GIT_SUBCOMMANDS = new Set([
  'commit',
  'push',
  'checkout',
  'switch',
  'restore',
  'reset',
  'stash',
  'rebase',
  'merge',
  'cherry-pick',
  'am',
  'tag',
  'rm',
  'mv',
  'worktree',
  'pull',
  'revert',
  'apply',
  'remote',
  'submodule',
])

const PACKAGE_INSTALL_COMMANDS = new Set([
  'add',
  'install',
  'i',
  'get',
  'update',
  'up',
  'upgrade',
  'remove',
  'uninstall',
  'dlx',
])

const PACKAGE_MANAGERS = new Set([
  'pnpm',
  'npm',
  'yarn',
  'bun',
  'cargo',
  'pip',
  'pip3',
  'brew',
  'go',
  'uv',
])

const PACKAGE_MANIFEST_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  '.npmrc',
])

/**
 * Splits a shell command string into discrete command segments, respecting quotes.
 */
export function splitCommandSegments(commandLine: string): string[] {
  const segments: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < commandLine.length; i++) {
    const char = commandLine[i]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\' && !inSingle) {
      current += char
      escaped = true
      continue
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle
      current += char
      continue
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble
      current += char
      continue
    }

    if (!inSingle && !inDouble) {
      // Split on command separators ; && || | \n &
      if (char === ';' || char === '\n') {
        if (current.trim()) segments.push(current.trim())
        current = ''
        continue
      }
      if (
        (char === '&' && commandLine[i + 1] === '&') ||
        (char === '|' && commandLine[i + 1] === '|')
      ) {
        if (current.trim()) segments.push(current.trim())
        current = ''
        i++
        continue
      }
      if (char === '|' || char === '&') {
        if (current.trim()) segments.push(current.trim())
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) segments.push(current.trim())
  return segments
}

/**
 * Tokenizes a single command segment into argv tokens, respecting quotes.
 */
export function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\' && !inSingle) {
      escaped = true
      continue
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }

    if (!inSingle && !inDouble && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current.length > 0) tokens.push(current)
  return tokens
}

/**
 * Classifies a single command segment for Git, dependency, and containment safety.
 */
function classifySingleSegment(seg: string): {
  decision: PreToolUseDecision
  reason?: string
} {
  // Check for shell output redirection INTO MemFS or .git
  const redirectMatch = seg.match(/(?:>|>>)\s*([^\s;&|]+)/)
  if (redirectMatch) {
    const target = redirectMatch[1] ?? ''
    // Ignore fd redirects like 2>&1, >&2
    if (!/^&\d+/.test(target)) {
      if (/\.gemini\/memory/i.test(target)) {
        return {
          decision: 'deny',
          reason: 'Direct shell output redirection into MemFS is strictly prohibited.',
        }
      }
      if (/\.git\b/i.test(target)) {
        return {
          decision: 'deny',
          reason: 'Direct shell output redirection into Git metadata is strictly prohibited.',
        }
      }
    }
  }

  // Check for opaque subshells or backtick evaluation
  if (seg.includes('`') || /\$\([^)]*\)/.test(seg)) {
    return {
      decision: 'force_ask',
      reason: 'Opaque subshell evaluation requires human gate review per AGENTS.md.',
    }
  }

  // Check for unexpanded parameter execution
  if (/^\s*\$[A-Za-z0-9_]+/.test(seg)) {
    return {
      decision: 'force_ask',
      reason: 'Variable command expansion requires human gate review per AGENTS.md.',
    }
  }

  const rawTokens = tokenizeSegment(seg)
  if (rawTokens.length === 0) return { decision: 'ask' }

  // Check for environment-based alias laundering (GIT_CONFIG_*=...)
  for (const t of rawTokens) {
    if (/^GIT_CONFIG[A-Za-z0-9_]*=/i.test(t)) {
      return {
        decision: 'force_ask',
        reason: 'Git configuration environment overrides require human gate review.',
      }
    }
  }

  // Strip leading environment variable assignments (e.g. FOO=bar, PAGER=cat)
  let idx = 0
  while (idx < rawTokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rawTokens[idx] ?? '')) {
    idx++
  }

  // Strip wrappers: env, command, sudo, xargs, exec, nohup, builtin, time, nice, timeout
  const wrappers = new Set([
    'env',
    'command',
    'sudo',
    'xargs',
    'exec',
    'nohup',
    'builtin',
    'time',
    'nice',
    'timeout',
  ])
  while (
    idx < rawTokens.length &&
    wrappers.has(path.basename(rawTokens[idx] ?? '').toLowerCase())
  ) {
    const wrapper = path.basename(rawTokens[idx] ?? '').toLowerCase()
    idx++
    // consume wrapper flags like -u, -i, -n, etc.
    while (
      idx < rawTokens.length &&
      (rawTokens[idx]?.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(rawTokens[idx] ?? ''))
    ) {
      const opt = rawTokens[idx] ?? ''
      idx++
      // If wrapper flag takes an argument (-u user, -n priority, etc.)
      if (['-u', '-n', '--user'].includes(opt) && idx < rawTokens.length) {
        idx++
      }
    }
    // If wrapper takes a positional duration/delay (e.g. timeout 30 <cmd>)
    if (wrapper === 'timeout' && idx < rawTokens.length && !rawTokens[idx]?.startsWith('-')) {
      idx++
    }
  }

  if (idx >= rawTokens.length) return { decision: 'ask' }
  const cmdToken = path.basename(rawTokens[idx] ?? '').toLowerCase()
  const cmdArgs = rawTokens.slice(idx + 1)

  // Direct shell destructive commands on MemFS or .git
  if (['rm', 'unlink', 'shred'].includes(cmdToken)) {
    for (const a of cmdArgs) {
      if (/\.gemini\/memory/i.test(a)) {
        return {
          decision: 'deny',
          reason: 'Destructive shell deletion of MemFS is strictly prohibited.',
        }
      }
      if (/\.git\b/i.test(a)) {
        return {
          decision: 'deny',
          reason: 'Destructive shell deletion of Git metadata is strictly prohibited.',
        }
      }
    }
  }

  // Check for eval
  if (cmdToken === 'eval') {
    return {
      decision: 'force_ask',
      reason: 'eval command execution requires human gate review per AGENTS.md.',
    }
  }

  // Check for opaque interpreters with inline scripts
  if (
    ['sh', 'bash', 'zsh', 'dash', 'ksh', 'python', 'python3', 'node', 'perl', 'ruby'].includes(
      cmdToken,
    ) &&
    cmdArgs.some(
      (a) => a === '-c' || a === '-e' || a.startsWith('-c') || a.startsWith('-e') || a === '--eval',
    )
  ) {
    return {
      decision: 'force_ask',
      reason: 'Inline interpreter execution requires human gate review per AGENTS.md.',
    }
  }

  // Git inspection
  if (cmdToken === 'git') {
    let gIdx = 0
    // Consume global git flags (-C <path>, -c <k=v>, --git-dir, --work-tree, etc.)
    while (gIdx < cmdArgs.length) {
      const arg = cmdArgs[gIdx] ?? ''
      if (arg === '-C' || arg === '--work-tree' || arg === '--git-dir') {
        gIdx += 2
        continue
      }
      if (arg === '-c') {
        const configVal = (cmdArgs[gIdx + 1] ?? '').toLowerCase()
        if (configVal.includes('alias.') || configVal.includes('help.autocorrect')) {
          return {
            decision: 'force_ask',
            reason: 'Git alias configuration override requires human gate review.',
          }
        }
        gIdx += 2
        continue
      }
      if (arg.toLowerCase().startsWith('-c') || arg.toLowerCase().startsWith('--config-env')) {
        const configVal = arg.toLowerCase()
        if (configVal.includes('alias.') || configVal.includes('help.autocorrect')) {
          return {
            decision: 'force_ask',
            reason: 'Git alias configuration override requires human gate review.',
          }
        }
        gIdx += 1
        continue
      }
      if (arg.startsWith('-')) {
        gIdx++
        continue
      }
      break
    }

    if (gIdx >= cmdArgs.length) return { decision: 'ask' }
    const gitSubcmd = (cmdArgs[gIdx] ?? '').toLowerCase()
    const subcmdArgs = cmdArgs.slice(gIdx + 1)

    // 1. Destructive Git checks -> hard deny
    if (gitSubcmd === 'reset' && subcmdArgs.includes('--hard')) {
      return {
        decision: 'deny',
        reason: 'Hard reset is destructive and strictly prohibited.',
      }
    }
    if (gitSubcmd === 'clean') {
      if (subcmdArgs.includes('-n') || subcmdArgs.includes('--dry-run')) {
        return { decision: 'ask' }
      }
      if (
        subcmdArgs.some((a) => a === '-f' || a === '--force' || /^-([a-zA-Z]*f[a-zA-Z]*)/.test(a))
      ) {
        return {
          decision: 'deny',
          reason: 'Forced git clean is destructive and strictly prohibited.',
        }
      }
      return {
        decision: 'force_ask',
        reason:
          'Git clean modifies repository working tree and requires explicit human gate authorization.',
      }
    }
    if (
      gitSubcmd === 'push' &&
      (subcmdArgs.some(
        (a) =>
          a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || a === '--delete',
      ) ||
        subcmdArgs.some((a) => a.startsWith('+') || a.startsWith(':')))
    ) {
      return {
        decision: 'deny',
        reason: 'Force push or remote branch deletion is destructive and strictly prohibited.',
      }
    }
    if (
      (gitSubcmd === 'checkout' || gitSubcmd === 'restore') &&
      (subcmdArgs.includes('.') || subcmdArgs.includes(':/')) &&
      (subcmdArgs.includes('--') || gitSubcmd === 'restore' || subcmdArgs.length === 1)
    ) {
      return {
        decision: 'deny',
        reason: 'Indiscriminate git checkout/restore of working tree is strictly prohibited.',
      }
    }
    if (
      gitSubcmd === 'branch' &&
      subcmdArgs.some(
        (a) =>
          a === '-D' ||
          a === '-M' ||
          a === '-f' ||
          a === '--force' ||
          (subcmdArgs.includes('--delete') && subcmdArgs.includes('--force')),
      )
    ) {
      return {
        decision: 'deny',
        reason: 'Forced branch deletion or move is strictly prohibited.',
      }
    }
    if (gitSubcmd === 'reflog' && subcmdArgs.some((a) => a === 'expire' || a === 'delete')) {
      return {
        decision: 'deny',
        reason: 'Reflog expiration or deletion is destructive and strictly prohibited.',
      }
    }
    if (gitSubcmd === 'update-ref' && subcmdArgs.some((a) => a === '-d' || a === '--delete')) {
      return {
        decision: 'deny',
        reason: 'Deleting git references via update-ref is strictly prohibited.',
      }
    }
    if (gitSubcmd === 'gc' && subcmdArgs.some((a) => a.startsWith('--prune'))) {
      return {
        decision: 'deny',
        reason: 'Aggressive git pruning via gc is strictly prohibited.',
      }
    }
    if (DESTRUCTIVE_GIT_SUBCOMMANDS.has(gitSubcmd)) {
      return {
        decision: 'deny',
        reason: `Git ${gitSubcmd} is destructive and strictly prohibited.`,
      }
    }

    // 2. State-altering Git checks -> force_ask (Human Gate)
    if (STATE_ALTERING_GIT_SUBCOMMANDS.has(gitSubcmd)) {
      return {
        decision: 'force_ask',
        reason: `Git ${gitSubcmd} modifies repository state and requires explicit human gate authorization.`,
      }
    }
  }

  // Package manager inspection
  if (PACKAGE_MANAGERS.has(cmdToken)) {
    // Scan all tokens in cmdArgs to find the active package manager action
    let activeSub = ''
    let activeSubIdx = -1

    for (let i = 0; i < cmdArgs.length; i++) {
      const a = cmdArgs[i] ?? ''
      // Skip flags and option values
      if (a.startsWith('-')) {
        if (['-C', '--prefix', '--filter', '-w', '--workspace'].includes(a)) {
          i++
        }
        continue
      }
      if (a === 'workspace') {
        i++ // consume workspace name argument (e.g. yarn workspace <name> add)
        continue
      }
      activeSub = a.toLowerCase()
      activeSubIdx = i
      break
    }

    if (activeSub) {
      const remainingArgs = cmdArgs.slice(activeSubIdx + 1).filter((a) => !a.startsWith('-'))

      // Allow pure install without package arguments (lockfile restore)
      if ((activeSub === 'install' || activeSub === 'i') && remainingArgs.length === 0) {
        return { decision: 'ask' }
      }

      if (PACKAGE_INSTALL_COMMANDS.has(activeSub) || activeSub.startsWith('add')) {
        return {
          decision: 'force_ask',
          reason: `Package manager command "${cmdToken} ${activeSub}" requires explicit human authorization per AGENTS.md rule 5.`,
        }
      }
    }
  }

  return { decision: 'ask' }
}

/**
 * Classifies a shell command line for Git and dependency safety across all segments.
 */
export function classifyCommandLine(commandLine: string): {
  decision: PreToolUseDecision
  reason?: string
} {
  const segments = splitCommandSegments(commandLine)
  let maxDecision: PreToolUseDecision = 'ask'
  let dominantReason: string | undefined

  for (const seg of segments) {
    const result = classifySingleSegment(seg)
    if (SEVERITY_WEIGHT[result.decision] > SEVERITY_WEIGHT[maxDecision]) {
      maxDecision = result.decision
      dominantReason = result.reason
      if (maxDecision === 'deny') break // Deny is highest severity
    }
  }

  return { decision: maxDecision, reason: dominantReason }
}

/**
 * Classifies file writing/editing targets for path safety.
 */
export function classifyWriteTarget(
  targetFile: string,
  memoryRoot: string = process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory'),
): {
  decision: PreToolUseDecision
  reason?: string
} {
  const expanded = targetFile.startsWith('~')
    ? path.join(os.homedir(), targetFile.slice(1))
    : targetFile
  const normalized = path.resolve(expanded)
  const baseName = path.basename(normalized)

  // 1. Direct MemFS write attempt outside approval writer
  if (isWithin(memoryRoot, normalized)) {
    return {
      decision: 'deny',
      reason:
        'Direct filesystem modification of MemFS outside the memory approval writer is prohibited.',
    }
  }

  // 2. Direct .git internal metadata write attempt
  if (normalized.split(path.sep).includes('.git')) {
    return {
      decision: 'deny',
      reason: 'Direct modification of internal Git repository metadata is prohibited.',
    }
  }

  // 3. Package manifest or lockfile write attempt -> force_ask
  if (PACKAGE_MANIFEST_FILES.has(baseName)) {
    return {
      decision: 'force_ask',
      reason: `Direct modification of package manifest or lockfile "${baseName}" requires explicit human authorization.`,
    }
  }

  return { decision: 'ask' }
}

/**
 * Classifies subagent creation to ensure read-only agents cannot be escalated to write tools.
 */
export function classifySubagentDefinition(
  agentName: string,
  enableWriteTools?: boolean,
  enableSubagentTools?: boolean,
): {
  decision: PreToolUseDecision
  reason?: string
} {
  if (READ_ONLY_AGENTS.has(agentName)) {
    if (enableWriteTools === true) {
      return {
        decision: 'deny',
        reason: `Subagent "${agentName}" is a declared read-only role and cannot be granted write tools.`,
      }
    }
    if (enableSubagentTools === true) {
      return {
        decision: 'deny',
        reason: `Subagent "${agentName}" cannot be granted nested subagent tools.`,
      }
    }
  }

  return { decision: 'ask' }
}

/**
 * Main evaluation entrypoint for PreToolUse events.
 */
export function evaluatePreToolUse(payload: PreToolUsePayload): PreToolUseOutput {
  try {
    const { toolCall } = payload
    if (!toolCall?.name) {
      return { decision: 'ask' }
    }

    const args = toolCall.args || {}

    // 1. run_command inspection
    if (toolCall.name === 'run_command') {
      const commandLine = typeof args.CommandLine === 'string' ? args.CommandLine : ''
      if (commandLine) {
        return classifyCommandLine(commandLine)
      }
    }

    // 2. write_to_file / replace_file_content / multi_replace_file_content inspection
    if (
      toolCall.name === 'write_to_file' ||
      toolCall.name === 'replace_file_content' ||
      toolCall.name === 'multi_replace_file_content'
    ) {
      const targetFile =
        typeof args.TargetFile === 'string'
          ? args.TargetFile
          : typeof args.filePath === 'string'
            ? args.filePath
            : ''
      if (targetFile) {
        return classifyWriteTarget(targetFile)
      }
    }

    // 3. define_subagent inspection
    if (toolCall.name === 'define_subagent') {
      const name = typeof args.name === 'string' ? args.name : ''
      const write = Boolean(args.enable_write_tools)
      const subagent = Boolean(args.enable_subagent_tools)
      if (name) {
        return classifySubagentDefinition(name, write, subagent)
      }
    }

    // 4. manage_task send_input inspection
    if (toolCall.name === 'manage_task' && args.Action === 'send_input') {
      const input = typeof args.Input === 'string' ? args.Input : ''
      if (input) {
        return classifyCommandLine(input)
      }
    }

    return { decision: 'ask' }
  } catch (error) {
    return {
      decision: 'force_ask',
      reason: `Guard error fallback: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
