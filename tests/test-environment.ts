import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type TestEnvironment = {
  homeDir: string
  memoryRoot: string
  stateRoot: string
  tempRoot: string
}

export const TEST_ORIGINAL_HOME = os.homedir()

const createTestEnvironment = (): TestEnvironment => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-memory-layer-test-home-'))
  const memoryRoot = path.join(homeDir, '.gemini', 'memory')
  const stateRoot = `${memoryRoot}.state`
  const tempRoot = path.join(homeDir, 'tmp')

  process.env.HOME = homeDir
  process.env.USERPROFILE = homeDir
  process.env.AGY_MEMORY_DIR = memoryRoot
  process.env.MEMORY_ROOT = memoryRoot
  process.env.AGY_MEMORY_STATE_DIR = stateRoot
  process.env.AGY_TEST_MODE = '1'
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 })

  fs.mkdirSync(path.join(memoryRoot, 'global'), { recursive: true })
  fs.mkdirSync(path.join(memoryRoot, 'projects'), { recursive: true })
  fs.mkdirSync(tempRoot, { recursive: true })
  fs.writeFileSync(
    path.join(memoryRoot, 'global', 'human.md'),
    '# Test Human Profile\n- Uses TypeScript with strict typing.\n',
  )
  fs.writeFileSync(
    path.join(memoryRoot, 'global', 'persona.md'),
    '# Test Persona\n- Keep fixture-backed verification concise.\n',
  )

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: memoryRoot })
  execFileSync('git', ['config', 'user.name', 'agy-memory-layer tests'], { cwd: memoryRoot })
  execFileSync('git', ['config', 'user.email', 'tests@example.invalid'], { cwd: memoryRoot })
  execFileSync('git', ['add', 'global/human.md', 'global/persona.md'], { cwd: memoryRoot })
  execFileSync('git', ['commit', '-q', '-m', 'test: seed isolated MemFS'], { cwd: memoryRoot })

  return { homeDir, memoryRoot, stateRoot, tempRoot }
}

export const TEST_ENVIRONMENT = createTestEnvironment()
export const TEST_MEMORY_ROOT = TEST_ENVIRONMENT.memoryRoot
export const TEST_STATE_ROOT = TEST_ENVIRONMENT.stateRoot
export const TEST_TEMP_ROOT = TEST_ENVIRONMENT.tempRoot

const cleanupTestEnvironment = (): void => {
  fs.rmSync(TEST_ENVIRONMENT.homeDir, { recursive: true, force: true })
}

process.once('exit', cleanupTestEnvironment)
