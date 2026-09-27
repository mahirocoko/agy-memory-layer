/**
 * Dream cron surfaces.
 *
 * Regex cron and LLM cron are separate lines. Preview never reads or writes
 * crontab. The scheduled LLM command passes `--all-projects` because cron has
 * no workspace cwd, and node/script paths are shell-quoted. A crontab read
 * failure refuses installation before any write. LLM installation requires
 * reflection.enabled plus an exact confirmation value or an explicit callback.
 * This module does not install a live schedule by itself.
 */

export const LLM_CRON_INSTALL_CONFIRMATION = 'install-llm-reflection-schedule'
export const LLM_CRON_SCHEDULE = '0 */6 * * *'
export const REGEX_CRON_SCHEDULE = '0 */2 * * *'

export type CronExecutor = {
  read: () => string
  write: (crontab: string) => void
}

export type LlmCronPreview = {
  schedule: string
  command: string
  line: string
  mutatesCrontab: false
}

export type LlmCronInstallCode =
  | 'INSTALLED'
  | 'ALREADY_INSTALLED'
  | 'CONFIRMATION_MISSING'
  | 'CONFIRMATION_MISMATCH'
  | 'DISABLED'
  | 'CRON_READ_FAILED'

export type LlmCronInstallResult = {
  status: 'installed' | 'refused'
  code: LlmCronInstallCode
  line: string | null
}

export type RegexCronInstallResult = {
  status: 'installed' | 'already-installed' | 'refused'
  line: string
}

export const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`

const shellLine = (nodePath: string, scriptPath: string, command: string): string =>
  `${shellQuote(nodePath)} --experimental-strip-types ${shellQuote(scriptPath)} ${command} >/dev/null 2>&1`

const readCrontab = (executor: CronExecutor): string | null => {
  try {
    return executor.read()
  } catch {
    return null
  }
}

export const regexDreamCronLine = (nodePath: string, scriptPath: string): string =>
  `${REGEX_CRON_SCHEDULE} ${shellLine(nodePath, scriptPath, '--run-now')}`

export const isRegexDreamCronLine = (line: string): boolean => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return false
  return (
    trimmed.includes('dream-daemon') &&
    trimmed.includes('--run-now') &&
    !trimmed.includes('--run-scheduled-llm') &&
    !trimmed.includes(' --llm') &&
    !trimmed.endsWith(' --llm')
  )
}

export const isLlmDreamCronLine = (line: string): boolean => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return false
  return trimmed.includes('dream-daemon') && trimmed.includes('--run-scheduled-llm')
}

export const previewLlmReflectionCron = (paths: {
  nodePath: string
  scriptPath: string
}): LlmCronPreview => {
  const command = shellLine(paths.nodePath, paths.scriptPath, '--run-scheduled-llm --all-projects')
  return {
    schedule: LLM_CRON_SCHEDULE,
    command,
    line: `${LLM_CRON_SCHEDULE} ${command}`,
    mutatesCrontab: false,
  }
}

const confirmationAccepted = (options: {
  confirmation?: string
  confirm?: () => boolean
}): 'ok' | 'CONFIRMATION_MISMATCH' | 'CONFIRMATION_MISSING' => {
  if (
    options.confirmation !== undefined &&
    options.confirmation !== LLM_CRON_INSTALL_CONFIRMATION
  ) {
    return 'CONFIRMATION_MISMATCH'
  }
  if (options.confirmation === LLM_CRON_INSTALL_CONFIRMATION) return 'ok'
  if (options.confirm?.() === true) return 'ok'
  return 'CONFIRMATION_MISSING'
}

export const installLlmReflectionCron = (options: {
  enabled: boolean
  confirmation?: string
  confirm?: () => boolean
  executor: CronExecutor
  nodePath: string
  scriptPath: string
}): LlmCronInstallResult => {
  const preview = previewLlmReflectionCron(options)
  const confirmation = confirmationAccepted(options)
  if (confirmation !== 'ok') {
    return { status: 'refused', code: confirmation, line: null }
  }
  if (!options.enabled) {
    return { status: 'refused', code: 'DISABLED', line: null }
  }
  const current = readCrontab(options.executor)
  if (current === null) return { status: 'refused', code: 'CRON_READ_FAILED', line: null }
  if (current.split('\n').some((line) => isLlmDreamCronLine(line))) {
    return { status: 'refused', code: 'ALREADY_INSTALLED', line: preview.line }
  }
  const trimmed = current.trim()
  const next = trimmed ? `${trimmed}\n${preview.line}\n` : `${preview.line}\n`
  options.executor.write(next)
  return { status: 'installed', code: 'INSTALLED', line: preview.line }
}

export const installRegexDreamCron = (
  executor: CronExecutor,
  nodePath: string,
  scriptPath: string,
): RegexCronInstallResult => {
  const line = regexDreamCronLine(nodePath, scriptPath)
  const current = readCrontab(executor)
  if (current === null) return { status: 'refused', line }
  if (current.split('\n').some((entry) => isRegexDreamCronLine(entry))) {
    return { status: 'already-installed', line }
  }
  const trimmed = current.trim()
  executor.write(trimmed ? `${trimmed}\n${line}\n` : `${line}\n`)
  return { status: 'installed', line }
}

export const uninstallRegexDreamCron = (executor: CronExecutor): string => {
  const current = readCrontab(executor)
  if (current === null) throw new Error('CRON_READ_FAILED')
  const filtered = current
    .split('\n')
    .filter((line) => !isRegexDreamCronLine(line))
    .join('\n')
  const next = filtered.endsWith('\n') || filtered.length === 0 ? filtered : `${filtered}\n`
  executor.write(next)
  return next
}
