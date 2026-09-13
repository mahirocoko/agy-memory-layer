import * as fs from 'node:fs'
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
  modelName?: string
}

type SegmentClassification = {
  decision: PreToolUseDecision
  reason?: string
  gitMutation?: boolean
  normalizedAction?: string
  explicitRepository?: string
}

const READ_ONLY_AGENTS = new Set([
  'repo_scout_agent',
  'evidence_reviewer_agent',
  'recall_agent',
  'history_analyzer_agent',
])

const DESTRUCTIVE_GIT_SUBCOMMANDS = new Set(['filter-branch', 'filter-repo'])
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'blame',
  'branch',
  'cat-file',
  'check-ignore',
  'config',
  'count-objects',
  'describe',
  'diff',
  'for-each-ref',
  'grep',
  'hash-object',
  'help',
  'log',
  'ls-files',
  'merge-base',
  'notes',
  'reflog',
  'replace',
  'rev-parse',
  'shortlog',
  'show',
  'status',
  'symbolic-ref',
  'version',
])
const STATE_ALTERING_GIT_SUBCOMMANDS = new Set([
  'add',
  'am',
  'apply',
  'checkout',
  'cherry-pick',
  'commit',
  'fetch',
  'init',
  'merge',
  'mv',
  'pull',
  'push',
  'rebase',
  'remote',
  'reset',
  'restore',
  'revert',
  'rm',
  'stash',
  'submodule',
  'switch',
  'tag',
  'update-index',
  'worktree',
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
      if (char === '&' && (commandLine[i - 1] === '>' || commandLine[i + 1] === '>')) {
        current += char
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

export function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false
  for (const char of segment) {
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
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

function hasMalformedShellSyntax(commandLine: string): boolean {
  let inSingle = false
  let inDouble = false
  let escaped = false
  for (const char of commandLine) {
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && !inSingle) {
      escaped = true
      continue
    }
    if (char === "'" && !inDouble) inSingle = !inSingle
    if (char === '"' && !inSingle) inDouble = !inDouble
  }
  return inSingle || inDouble || escaped
}

function outputRedirectionTargets(segment: string): { targets: string[]; malformed: boolean } {
  const targets: string[] = []
  let inSingle = false
  let inDouble = false
  let escaped = false
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i]
    if (escaped) {
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
    if (inSingle || inDouble) continue

    let cursor: number | undefined
    let descriptorDuplication = false
    if (char === '&' && segment[i + 1] === '>') {
      cursor = i + (segment[i + 2] === '>' ? 3 : 2)
    } else if (char === '>') {
      if (segment[i + 1] === '&') {
        cursor = i + 2
        descriptorDuplication = true
      } else {
        cursor = i + (segment[i + 1] === '>' ? 2 : 1)
      }
    }
    if (cursor === undefined) continue
    while (/\s/.test(segment[cursor] ?? '')) cursor++

    let target = ''
    let wordSingle = false
    let wordDouble = false
    let wordEscaped = false
    for (; cursor < segment.length; cursor++) {
      const current = segment[cursor] ?? ''
      if (wordEscaped) {
        target += current
        wordEscaped = false
        continue
      }
      if (current === '\\' && !wordSingle) {
        wordEscaped = true
        continue
      }
      if (current === "'" && !wordDouble) {
        wordSingle = !wordSingle
        continue
      }
      if (current === '"' && !wordSingle) {
        wordDouble = !wordDouble
        continue
      }
      if (!wordSingle && !wordDouble && (/\s/.test(current) || /[;&|<>]/.test(current))) break
      target += current
    }
    if (!target || wordSingle || wordDouble || wordEscaped) return { targets, malformed: true }
    if (!descriptorDuplication || !/^(?:\d+|-)$/.test(target)) targets.push(target)
    i = cursor - 1
  }
  return { targets, malformed: false }
}

function shellQuote(token: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(token) ? token : `'${token.replaceAll("'", "'\\''")}'`
}

function normalizeAction(tokens: string[]): string {
  return tokens.map(shellQuote).join(' ')
}

function canonicalizeExistingAncestors(target: string): string {
  const absolute = path.resolve(target)
  const missing: string[] = []
  let cursor = absolute
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) return absolute
    missing.unshift(path.basename(cursor))
    cursor = parent
  }
  let canonical = fs.realpathSync(cursor)
  for (const component of missing) canonical = path.join(canonical, component)
  return path.resolve(canonical)
}

function expandTarget(target: string, cwd = process.cwd()): string {
  const expanded =
    target === '~' || target.startsWith('~/') ? path.join(os.homedir(), target.slice(2)) : target
  return canonicalizeExistingAncestors(path.resolve(cwd, expanded))
}

function protectedTargetDecision(
  target: string,
  cwd = process.cwd(),
): SegmentClassification | undefined {
  const memoryRoot = canonicalizeExistingAncestors(
    process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory'),
  )
  const normalized = expandTarget(target, cwd)
  if (isWithin(memoryRoot, normalized)) {
    return { decision: 'deny', reason: 'Direct filesystem modification of MemFS is prohibited.' }
  }
  if (normalized.split(path.sep).includes('.git')) {
    return { decision: 'deny', reason: 'Direct modification of Git metadata is prohibited.' }
  }
  return undefined
}

function opaqueShellReason(segment: string): string | undefined {
  if (segment.includes('`') || /\$\(|<\(|>\(|<<[-]?\s*\S/.test(segment)) {
    return 'Opaque shell expansion or redirection requires fresh human confirmation.'
  }
  if (/^\s*(if|then|elif|else|fi|for|while|until|case|select|function)\b/.test(segment)) {
    return 'Shell control structures require fresh human confirmation.'
  }
  if (/^\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)\s*\{/.test(segment)) {
    return 'Shell function definitions require fresh human confirmation.'
  }
  return undefined
}

function gitMutationResult(
  subcommand: string,
  tokens: string[],
  repository?: string,
): SegmentClassification {
  return {
    decision: 'force_ask',
    reason: `Git ${subcommand} modifies repository state and requires fresh host confirmation.`,
    gitMutation: true,
    normalizedAction: normalizeAction(tokens),
    explicitRepository: repository,
  }
}

function classifyGit(tokens: string[], gitIndex: number, baseCwd?: string): SegmentClassification {
  if (
    tokens
      .slice(0, gitIndex)
      .some((token) => /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|OBJECT_DIRECTORY)=/i.test(token))
  ) {
    return { decision: 'deny', reason: 'Alternate Git repository environment scope is denied.' }
  }
  const args = tokens.slice(gitIndex + 1)
  let idx = 0
  let explicitRepository: string | undefined
  let repositoryBase = baseCwd
  while (idx < args.length) {
    const arg = args[idx] ?? ''
    if (arg === '-C') {
      const value = args[idx + 1]
      if (!value) return { decision: 'deny', reason: 'Malformed git -C repository scope.' }
      if (!path.isAbsolute(value) && !repositoryBase) {
        return { decision: 'deny', reason: 'Relative git -C repository scope is ambiguous.' }
      }
      explicitRepository = expandTarget(value, repositoryBase ?? path.parse(value).root)
      repositoryBase = explicitRepository
      idx += 2
      continue
    }
    if (
      arg === '--work-tree' ||
      arg.startsWith('--work-tree=') ||
      arg === '--git-dir' ||
      arg.startsWith('--git-dir=')
    ) {
      return { decision: 'deny', reason: 'Alternate Git repository scope is denied.' }
    }
    if (arg === '-c') {
      const value = args[idx + 1]
      if (!value) return { decision: 'deny', reason: `Malformed git ${arg} option.` }
      if (arg === '-c' && /(?:alias\.|help\.autocorrect)/i.test(value)) {
        return { decision: 'deny', reason: 'Git alias overrides are denied.' }
      }
      idx += 2
      continue
    }
    if (/^-c.+/i.test(arg) || arg.startsWith('--config-env')) {
      if (/(?:alias\.|help\.autocorrect)/i.test(arg)) {
        return { decision: 'deny', reason: 'Git alias overrides are denied.' }
      }
      idx++
      continue
    }
    if (arg.startsWith('-')) {
      idx++
      continue
    }
    break
  }
  if (idx >= args.length) return { decision: 'ask' }
  const subcommand = (args[idx] ?? '').toLowerCase()
  const subArgs = args.slice(idx + 1)

  if (subcommand === 'reset' && subArgs.includes('--hard')) {
    return { decision: 'deny', reason: 'Hard reset is destructive and strictly prohibited.' }
  }
  if (subcommand === 'clean') {
    if (subArgs.includes('-n') || subArgs.includes('--dry-run')) return { decision: 'ask' }
    if (subArgs.some((arg) => arg === '-f' || arg === '--force' || /^-[A-Za-z]*f/.test(arg))) {
      return {
        decision: 'deny',
        reason: 'Forced git clean is destructive and strictly prohibited.',
      }
    }
    return gitMutationResult(subcommand, tokens.slice(gitIndex), explicitRepository)
  }
  if (
    subcommand === 'push' &&
    subArgs.some(
      (arg) =>
        arg === '--force' ||
        arg === '-f' ||
        arg.startsWith('--force-with-lease') ||
        arg === '--delete' ||
        arg.startsWith('+') ||
        arg.startsWith(':'),
    )
  ) {
    return { decision: 'deny', reason: 'Force push or remote branch deletion is prohibited.' }
  }
  if (
    (subcommand === 'checkout' || subcommand === 'restore') &&
    (subArgs.includes('.') || subArgs.includes(':/')) &&
    (subArgs.includes('--') || subcommand === 'restore' || subArgs.length === 1)
  ) {
    return { decision: 'deny', reason: 'Indiscriminate working-tree restoration is prohibited.' }
  }
  if (
    subcommand === 'branch' &&
    subArgs.some((arg) => ['-D', '-M', '-f', '--force'].includes(arg))
  ) {
    return { decision: 'deny', reason: 'Forced branch deletion or move is prohibited.' }
  }
  if (subcommand === 'reflog' && subArgs.some((arg) => arg === 'expire' || arg === 'delete')) {
    return { decision: 'deny', reason: 'Reflog expiration or deletion is prohibited.' }
  }
  if (subcommand === 'update-ref' && subArgs.some((arg) => arg === '-d' || arg === '--delete')) {
    return { decision: 'deny', reason: 'Deleting git references via update-ref is prohibited.' }
  }
  if (subcommand === 'gc' && subArgs.some((arg) => arg.startsWith('--prune'))) {
    return { decision: 'deny', reason: 'Git object pruning is prohibited.' }
  }
  if (DESTRUCTIVE_GIT_SUBCOMMANDS.has(subcommand)) {
    return { decision: 'deny', reason: `Git ${subcommand} is destructive and prohibited.` }
  }

  let mutation = STATE_ALTERING_GIT_SUBCOMMANDS.has(subcommand)
  if (subcommand === 'reflog' && subArgs.includes('write')) mutation = true
  if (subcommand === 'update-ref' || subcommand === 'symbolic-ref' || subcommand === 'gc')
    mutation = true
  if (subcommand === 'hash-object')
    mutation = subArgs.includes('-w') || subArgs.includes('--literally')
  if (subcommand === 'notes') {
    mutation = !['list', 'show'].includes(
      (subArgs.find((arg) => !arg.startsWith('-')) ?? 'list').toLowerCase(),
    )
  }
  if (subcommand === 'replace') {
    mutation = subArgs.some((arg) => !['-l', '--list'].includes(arg))
  }
  if (subcommand === 'branch') {
    const readFlags = new Set([
      '-a',
      '--all',
      '-l',
      '--list',
      '-r',
      '--remotes',
      '--show-current',
      '--contains',
      '--no-contains',
      '--merged',
      '--no-merged',
    ])
    const positional = subArgs.filter((arg) => !arg.startsWith('-'))
    mutation =
      subArgs.some((arg) => ['-d', '--delete', '-m', '--move', '-c', '--copy'].includes(arg)) ||
      (positional.length > 0 && !subArgs.some((arg) => readFlags.has(arg)))
  }
  if (subcommand === 'config') {
    const readFlags = new Set([
      '--get',
      '--get-all',
      '--get-regexp',
      '--get-urlmatch',
      '--list',
      '-l',
      '--show-origin',
      '--show-scope',
      '--name-only',
      '--get-color',
      '--get-colorbool',
    ])
    const writeFlags = new Set([
      '--add',
      '--replace-all',
      '--unset',
      '--unset-all',
      '--rename-section',
      '--remove-section',
      '--edit',
      '-e',
    ])
    const positional = subArgs.filter((arg) => !arg.startsWith('-'))
    mutation =
      subArgs.some((arg) => writeFlags.has(arg)) ||
      (!subArgs.some((arg) => readFlags.has(arg)) && positional.length >= 2)
  }
  if (subcommand === 'symbolic-ref') {
    const positional = subArgs.filter((arg) => !arg.startsWith('-'))
    mutation = subArgs.includes('--delete') || positional.length >= 2
  }
  if (mutation) return gitMutationResult(subcommand, tokens.slice(gitIndex), explicitRepository)
  if (READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) return { decision: 'ask' }
  return {
    decision: 'deny',
    reason: `Unknown git subcommand ${subcommand} may resolve to an alias or external executable.`,
  }
}

function shellMutationTargets(command: string, args: string[]): string[] | undefined {
  const positional = args.filter((arg) => !arg.startsWith('-'))
  if (command === 'cp' || command === 'mv' || command === 'install') {
    return positional.length >= 2 ? [positional[positional.length - 1] ?? ''] : []
  }
  if (command === 'touch' || command === 'truncate' || command === 'tee') return positional
  if (command === 'dd')
    return args.filter((arg) => arg.startsWith('of=')).map((arg) => arg.slice(3))
  if (command === 'find' && args.includes('-delete')) {
    return args
      .slice(
        0,
        args.findIndex((arg) => arg.startsWith('-')),
      )
      .filter(Boolean)
  }
  if (command === 'sed' && args.some((arg) => arg === '-i' || arg.startsWith('-i'))) {
    return positional.length >= 2 ? positional.slice(1) : []
  }
  return undefined
}

function classifySingleSegment(segment: string, cwd?: string): SegmentClassification {
  const opaqueReason = opaqueShellReason(segment)
  if (opaqueReason) return { decision: 'force_ask', reason: opaqueReason }

  const redirections = outputRedirectionTargets(segment)
  if (redirections.malformed) {
    return { decision: 'deny', reason: 'Malformed output redirection is denied.' }
  }
  for (const target of redirections.targets) {
    const protectedDecision = protectedTargetDecision(target, cwd)
    if (protectedDecision) return protectedDecision
  }

  const tokens = tokenizeSegment(segment)
  if (tokens.length === 0) return { decision: 'ask' }
  if (tokens.some((token) => /^GIT_CONFIG[A-Za-z0-9_]*=/i.test(token))) {
    return {
      decision: 'force_ask',
      reason: 'Git configuration environment overrides require fresh confirmation.',
    }
  }
  let idx = 0
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx] ?? '')) idx++
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
  while (idx < tokens.length && wrappers.has(path.basename(tokens[idx] ?? '').toLowerCase())) {
    const wrapper = path.basename(tokens[idx] ?? '').toLowerCase()
    idx++
    while (tokens[idx]?.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx] ?? '')) {
      const option = tokens[idx] ?? ''
      idx++
      if (['-u', '-n', '--user'].includes(option)) idx++
    }
    if (wrapper === 'timeout' && idx < tokens.length && !tokens[idx]?.startsWith('-')) idx++
  }
  if (idx >= tokens.length) return { decision: 'ask' }
  const command = path.basename(tokens[idx] ?? '').toLowerCase()
  const args = tokens.slice(idx + 1)

  if (['rm', 'unlink', 'shred'].includes(command)) {
    for (const target of args.filter((arg) => !arg.startsWith('-'))) {
      const protectedDecision = protectedTargetDecision(target, cwd)
      if (protectedDecision) return protectedDecision
    }
  }
  if (command === 'eval')
    return { decision: 'force_ask', reason: 'eval requires fresh human confirmation.' }
  if (command === 'source' || command === '.') {
    return { decision: 'force_ask', reason: 'Sourced scripts require fresh human confirmation.' }
  }
  if (
    ['sh', 'bash', 'zsh', 'dash', 'ksh', 'python', 'python3', 'node', 'perl', 'ruby'].includes(
      command,
    )
  ) {
    const harmless = args.length === 1 && ['--version', '-V', '-v'].includes(args[0] ?? '')
    if (!harmless && args.length > 0) {
      return {
        decision: 'force_ask',
        reason: 'Interpreter or script execution requires fresh human confirmation.',
      }
    }
  }
  if (command === 'git') {
    const result = classifyGit(tokens, idx, cwd)
    if (result.decision === 'ask' && redirections.targets.length > 0) {
      return {
        decision: 'force_ask',
        reason: 'Output redirection modifies files and requires fresh human confirmation.',
      }
    }
    return result
  }

  const mutationTargets = shellMutationTargets(command, args)
  if (mutationTargets) {
    if (mutationTargets.length === 0) {
      return {
        decision: 'force_ask',
        reason: `Opaque ${command} target requires fresh human confirmation.`,
      }
    }
    for (const target of mutationTargets) {
      const protectedDecision = protectedTargetDecision(target, cwd)
      if (protectedDecision) return protectedDecision
    }
    return {
      decision: 'force_ask',
      reason: `${command} modifies files and requires fresh human confirmation.`,
    }
  }

  if (PACKAGE_MANAGERS.has(command)) {
    let active = ''
    let activeIndex = -1
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] ?? ''
      if (arg.startsWith('-')) {
        if (['-C', '--prefix', '--filter', '-w', '--workspace'].includes(arg)) i++
        continue
      }
      if (arg === 'workspace') {
        i++
        continue
      }
      active = arg.toLowerCase()
      activeIndex = i
      break
    }
    const remaining = args.slice(activeIndex + 1).filter((arg) => !arg.startsWith('-'))
    if ((active === 'install' || active === 'i') && remaining.length === 0)
      return { decision: 'ask' }
    if (PACKAGE_INSTALL_COMMANDS.has(active) || active.startsWith('add')) {
      return {
        decision: 'force_ask',
        reason: `${command} ${active} requires fresh human confirmation.`,
      }
    }
  }
  if (redirections.targets.length > 0) {
    return {
      decision: 'force_ask',
      reason: 'Output redirection modifies files and requires fresh human confirmation.',
    }
  }
  return { decision: 'ask' }
}

export function classifyCommandLine(commandLine: string, cwd?: string): SegmentClassification {
  if (!commandLine.trim()) return { decision: 'ask' }
  if (hasMalformedShellSyntax(commandLine)) {
    return { decision: 'deny', reason: 'Malformed or incomplete shell quoting is denied.' }
  }
  const segments = splitCommandSegments(commandLine)
  const results = segments.map((segment) => classifySingleSegment(segment, cwd))
  const denied = results.find((result) => result.decision === 'deny')
  if (denied) return denied
  if (segments.length > 1 && results.some((result) => result.decision === 'force_ask')) {
    return {
      decision: 'deny',
      reason: 'A gated action in a multi-segment shell bundle is ambiguous.',
    }
  }
  return results.find((result) => result.decision === 'force_ask') ?? { decision: 'ask' }
}

export function classifyWriteTarget(
  targetFile: string,
  memoryRoot: string = process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory'),
  baseCwd: string = process.cwd(),
): SegmentClassification {
  const normalized = expandTarget(targetFile, baseCwd)
  const canonicalMemoryRoot = canonicalizeExistingAncestors(memoryRoot)
  if (isWithin(canonicalMemoryRoot, normalized)) {
    return { decision: 'deny', reason: 'Direct filesystem modification of MemFS is prohibited.' }
  }
  if (normalized.split(path.sep).includes('.git')) {
    return { decision: 'deny', reason: 'Direct modification of Git metadata is prohibited.' }
  }
  const baseName = path.basename(normalized)
  if (PACKAGE_MANIFEST_FILES.has(baseName)) {
    return {
      decision: 'force_ask',
      reason: `Modification of ${baseName} requires fresh confirmation.`,
    }
  }
  return { decision: 'ask' }
}

export function classifySubagentDefinition(
  agentName: string,
  enableWriteTools?: boolean,
  enableSubagentTools?: boolean,
): SegmentClassification {
  if (READ_ONLY_AGENTS.has(agentName) && enableWriteTools === true) {
    return {
      decision: 'deny',
      reason: `Read-only subagent ${agentName} cannot receive write tools.`,
    }
  }
  if (READ_ONLY_AGENTS.has(agentName) && enableSubagentTools === true) {
    return {
      decision: 'deny',
      reason: `Read-only subagent ${agentName} cannot receive nested agents.`,
    }
  }
  return { decision: 'ask' }
}

function readCompatibleString(
  args: Record<string, unknown>,
  canonical: string,
  compatibility: string,
): { value?: string; malformed: boolean } {
  const first = args[canonical]
  const second = args[compatibility]
  if (first !== undefined && (typeof first !== 'string' || !first.trim()))
    return { malformed: true }
  if (second !== undefined && (typeof second !== 'string' || !second.trim()))
    return { malformed: true }
  if (typeof first === 'string' && typeof second === 'string' && first !== second)
    return { malformed: true }
  return {
    value: typeof first === 'string' ? first : typeof second === 'string' ? second : undefined,
    malformed: false,
  }
}

function collectWriteTargets(args: Record<string, unknown>): {
  targets: string[]
  malformed: boolean
} {
  const targets: string[] = []
  const visit = (value: unknown, key?: string): boolean => {
    if (key && ['TargetFile', 'filePath', 'targetFile'].includes(key)) {
      if (typeof value !== 'string' || !value.trim()) return false
      targets.push(value)
      return true
    }
    if (key && ['TargetFiles', 'filePaths', 'targets'].includes(key)) {
      if (!Array.isArray(value) || value.length === 0) return false
      return value.every((item) => visit(item, 'targetFile'))
    }
    if (key && ['replacements', 'edits', 'files'].includes(key)) {
      if (!Array.isArray(value) || value.length === 0) return false
      return value.every((item) => visit(item))
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value).every(([childKey, child]) => visit(child, childKey))
    }
    return true
  }
  const valid = visit(args)
  return { targets: [...new Set(targets)], malformed: !valid || targets.length === 0 }
}

function resolveWorkspaceBase(payload: PreToolUsePayload): string | undefined {
  const workspaces = payload.workspacePaths
  if (!Array.isArray(workspaces) || workspaces.length !== 1) return undefined
  const workspace = workspaces[0]
  if (typeof workspace !== 'string' || !workspace.trim()) return undefined
  return expandTarget(workspace)
}

function resolveRepositoryScope(
  workspaceBase: string | undefined,
  explicit?: string,
): string | undefined {
  return explicit ?? workspaceBase
}

function resolveToolCwd(
  args: Record<string, unknown>,
  workspaceBase: string | undefined,
): { value?: string; malformed: boolean; outsideWorkspace: boolean } {
  const toolCwd = readCompatibleString(args, 'Cwd', 'cwd')
  if (toolCwd.malformed) return { malformed: true, outsideWorkspace: false }
  if (!toolCwd.value) return { value: workspaceBase, malformed: false, outsideWorkspace: false }
  if (!path.isAbsolute(toolCwd.value) && !workspaceBase) {
    return { malformed: true, outsideWorkspace: false }
  }
  const value = canonicalizeExistingAncestors(expandTarget(toolCwd.value, workspaceBase))
  const canonicalWorkspace = workspaceBase
    ? canonicalizeExistingAncestors(workspaceBase)
    : undefined
  return {
    value,
    malformed: false,
    outsideWorkspace: Boolean(canonicalWorkspace && !isWithin(canonicalWorkspace, value)),
  }
}

export function evaluatePreToolUse(payload: PreToolUsePayload): PreToolUseOutput {
  try {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !payload.toolCall ||
      typeof payload.toolCall.name !== 'string' ||
      !payload.toolCall.name
    ) {
      return { decision: 'deny', reason: 'Malformed PreToolUse payload.' }
    }
    if (
      payload.workspacePaths !== undefined &&
      (!Array.isArray(payload.workspacePaths) ||
        payload.workspacePaths.some((item) => typeof item !== 'string' || !item.trim()))
    ) {
      return { decision: 'deny', reason: 'Malformed workspace scope.' }
    }
    const args = payload.toolCall.args
    if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
      return { decision: 'deny', reason: 'Malformed tool arguments.' }
    }
    const safeArgs = args ?? {}
    const workspaceBase = resolveWorkspaceBase(payload)
    const toolCwd = resolveToolCwd(safeArgs, workspaceBase)
    if (toolCwd.malformed) return { decision: 'deny', reason: 'Missing or malformed tool Cwd.' }
    if (toolCwd.outsideWorkspace) {
      return { decision: 'deny', reason: 'Tool Cwd is outside the sole workspace scope.' }
    }

    if (payload.toolCall.name === 'run_command') {
      const command = readCompatibleString(safeArgs, 'CommandLine', 'commandLine')
      if (command.malformed || !command.value)
        return { decision: 'deny', reason: 'Missing or malformed command.' }
      const result = classifyCommandLine(command.value, toolCwd.value)
      if (result.decision === 'force_ask' && result.gitMutation) {
        const resolvedRepository = resolveRepositoryScope(toolCwd.value, result.explicitRepository)
        if (!resolvedRepository)
          return { decision: 'deny', reason: 'Repository scope is ambiguous.' }
        const repository = canonicalizeExistingAncestors(resolvedRepository)
        if (workspaceBase && !isWithin(canonicalizeExistingAncestors(workspaceBase), repository)) {
          return { decision: 'deny', reason: 'Git repository scope is outside the workspace.' }
        }
        return {
          decision: 'force_ask',
          reason: `Confirm exact action: ${result.normalizedAction}\nRepository scope: ${repository}`,
        }
      }
      return result
    }

    if (
      ['write_to_file', 'replace_file_content', 'multi_replace_file_content'].includes(
        payload.toolCall.name,
      )
    ) {
      const collected = collectWriteTargets(safeArgs)
      const isMultiTargetTool = payload.toolCall.name === 'multi_replace_file_content'
      if (collected.malformed || (!isMultiTargetTool && collected.targets.length !== 1))
        return { decision: 'deny', reason: 'No unambiguous write target was provided.' }
      let forceReason: string | undefined
      for (const target of collected.targets) {
        const result = classifyWriteTarget(target, undefined, toolCwd.value)
        if (result.decision === 'deny') return result
        if (result.decision === 'force_ask') forceReason = result.reason
      }
      return forceReason ? { decision: 'force_ask', reason: forceReason } : { decision: 'ask' }
    }

    if (payload.toolCall.name === 'define_subagent') {
      if (typeof safeArgs.name !== 'string' || !safeArgs.name.trim()) {
        return { decision: 'deny', reason: 'Missing or malformed subagent name.' }
      }
      if (
        safeArgs.enable_write_tools !== undefined &&
        typeof safeArgs.enable_write_tools !== 'boolean'
      ) {
        return { decision: 'deny', reason: 'Malformed subagent write capability.' }
      }
      if (
        safeArgs.enable_subagent_tools !== undefined &&
        typeof safeArgs.enable_subagent_tools !== 'boolean'
      ) {
        return { decision: 'deny', reason: 'Malformed nested subagent capability.' }
      }
      return classifySubagentDefinition(
        safeArgs.name,
        safeArgs.enable_write_tools,
        safeArgs.enable_subagent_tools,
      )
    }

    if (payload.toolCall.name === 'manage_task' && safeArgs.Action === 'send_input') {
      if (typeof safeArgs.Input !== 'string' || !safeArgs.Input.trim()) {
        return { decision: 'deny', reason: 'Missing or malformed task input.' }
      }
      return classifyCommandLine(safeArgs.Input)
    }
    return { decision: 'ask' }
  } catch (error) {
    return {
      decision: 'deny',
      reason: `Guard error fallback: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
