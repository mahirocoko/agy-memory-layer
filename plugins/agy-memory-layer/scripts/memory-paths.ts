import * as path from 'node:path'

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
