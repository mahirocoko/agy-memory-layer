import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

export const isDirectCliInvocation = (
  moduleUrl: string,
  argvPath: string | undefined = process.argv[1],
): boolean => {
  if (!argvPath) return false

  const modulePath = fileURLToPath(moduleUrl)
  try {
    return fs.realpathSync(path.resolve(argvPath)) === fs.realpathSync(modulePath)
  } catch {
    return path.resolve(argvPath) === path.resolve(modulePath)
  }
}
