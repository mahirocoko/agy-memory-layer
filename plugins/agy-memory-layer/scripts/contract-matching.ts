import * as crypto from 'node:crypto'

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function computeRuleId(title: string, intent: string, action: string): string {
  const norm = `${normalizeText(title)}|${normalizeText(intent)}|${normalizeText(action)}`
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16)
}

export function matchesGlob(filePath: string, globPattern: string): boolean {
  const normFile = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  const normGlob = globPattern.replace(/\\/g, '/').replace(/^\.\//, '')
  if (normGlob === '**/*' || normGlob === '*' || normGlob === '') return true

  const regexStr = normGlob
    .replace(/\*\*\//g, '___GLOBSTAR_SLASH___')
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '___STAR___')
    .replace(/\?/g, '___QUESTION___')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/___GLOBSTAR_SLASH___/g, '(?:.*/)?')
    .replace(/___GLOBSTAR___/g, '.*')
    .replace(/___STAR___/g, '[^/]*')
    .replace(/___QUESTION___/g, '[^/]')

  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(normFile)
}
