#!/usr/bin/env node

/**
 * Codebase Scanner & Initializer for agy-memory-layer (/init)
 * Analyzes repository structure, dependencies, frameworks, scripts, and linters,
 * then generates project.md and rules.md in ~/.gemini/memory/projects/<slug>/
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type CodebaseScanResult = {
  slug: string
  name: string
  root: string
  languages: Set<string>
  frameworks: Set<string>
  linters: Set<string>
  testFrameworks: Set<string>
  packageManager: string
  scripts: Record<string, string>
  dependencies: string[]
  devDependencies: string[]
  entrypoints: string[]
  hasDocker: boolean
  hasDocs: boolean
}

export type InitOptions = {
  force?: boolean
  dryRun?: boolean
}

export type InitResult = {
  status: 'INITIALIZED' | 'ALREADY_INITIALIZED' | 'DRY_RUN'
  projectSlug: string
  projectDir: string
  filesCreated: string[]
}

const memoryRoot =
  process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')

export function getProjectSlug(workspaceDir: string = process.cwd()): string {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel 2>/dev/null', {
      cwd: workspaceDir,
      encoding: 'utf-8',
    }).trim()
    if (gitRoot) return path.basename(gitRoot)
  } catch {}
  return path.basename(workspaceDir)
}

export function scanCodebase(workspaceDir: string = process.cwd()): CodebaseScanResult {
  const slug = getProjectSlug(workspaceDir)
  const result: CodebaseScanResult = {
    slug,
    name: slug,
    root: workspaceDir,
    languages: new Set(),
    frameworks: new Set(),
    linters: new Set(),
    testFrameworks: new Set(),
    packageManager: 'npm',
    scripts: {},
    dependencies: [],
    devDependencies: [],
    entrypoints: [],
    hasDocker: false,
    hasDocs: false,
  }

  // 1. Check Package Manifests
  const pkgPath = path.join(workspaceDir, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      if (pkg.name) result.name = pkg.name
      if (pkg.scripts) result.scripts = pkg.scripts
      if (pkg.dependencies) result.dependencies = Object.keys(pkg.dependencies)
      if (pkg.devDependencies) result.devDependencies = Object.keys(pkg.devDependencies)

      const allDeps = [...result.dependencies, ...result.devDependencies]

      // Detect Frameworks & Libs
      if (allDeps.includes('react')) result.frameworks.add('React')
      if (allDeps.includes('next')) result.frameworks.add('Next.js')
      if (allDeps.includes('vue')) result.frameworks.add('Vue')
      if (allDeps.includes('svelte')) result.frameworks.add('Svelte')
      if (allDeps.includes('vite')) result.frameworks.add('Vite')
      if (allDeps.includes('express')) result.frameworks.add('Express')
      if (allDeps.includes('@cloudflare/workers-types') || allDeps.includes('wrangler')) {
        result.frameworks.add('Cloudflare Workers')
      }

      // Detect Test Frameworks
      if (allDeps.includes('vitest')) result.testFrameworks.add('Vitest')
      if (allDeps.includes('jest')) result.testFrameworks.add('Jest')
      if (allDeps.includes('playwright') || allDeps.includes('@playwright/test')) {
        result.testFrameworks.add('Playwright')
      }

      // Detect Linters & Formatters
      if (allDeps.includes('@biomejs/biome')) result.linters.add('Biome')
      if (allDeps.includes('eslint')) result.linters.add('ESLint')
      if (allDeps.includes('prettier')) result.linters.add('Prettier')
      if (
        allDeps.includes('typescript') ||
        allDeps.includes('@types/node') ||
        fs.existsSync(path.join(workspaceDir, 'tsconfig.json'))
      ) {
        result.languages.add('TypeScript')
      }
      if (result.languages.size === 0) {
        result.languages.add('JavaScript')
      }
    } catch {}
  }

  // Detect Lockfiles for Package Manager
  if (fs.existsSync(path.join(workspaceDir, 'pnpm-lock.yaml'))) result.packageManager = 'pnpm'
  else if (
    fs.existsSync(path.join(workspaceDir, 'bun.lockb')) ||
    fs.existsSync(path.join(workspaceDir, 'bun.lock'))
  )
    result.packageManager = 'bun'
  else if (fs.existsSync(path.join(workspaceDir, 'yarn.lock'))) result.packageManager = 'yarn'
  else if (fs.existsSync(path.join(workspaceDir, 'package-lock.json')))
    result.packageManager = 'npm'

  // Other Language & Framework Manifests
  if (
    fs.existsSync(path.join(workspaceDir, 'wrangler.toml')) ||
    fs.existsSync(path.join(workspaceDir, 'wrangler.jsonc')) ||
    fs.existsSync(path.join(workspaceDir, 'wrangler.json'))
  ) {
    result.frameworks.add('Cloudflare Workers')
  }
  if (fs.existsSync(path.join(workspaceDir, 'Cargo.toml'))) result.languages.add('Rust')
  if (fs.existsSync(path.join(workspaceDir, 'go.mod'))) result.languages.add('Go')
  if (
    fs.existsSync(path.join(workspaceDir, 'pyproject.toml')) ||
    fs.existsSync(path.join(workspaceDir, 'requirements.txt'))
  ) {
    result.languages.add('Python')
  }

  // Detect Docker & Docs
  if (
    fs.existsSync(path.join(workspaceDir, 'Dockerfile')) ||
    fs.existsSync(path.join(workspaceDir, 'docker-compose.yml'))
  ) {
    result.hasDocker = true
    result.frameworks.add('Docker')
  }
  if (
    fs.existsSync(path.join(workspaceDir, 'docs')) ||
    fs.existsSync(path.join(workspaceDir, 'README.md'))
  ) {
    result.hasDocs = true
  }

  // Detect Entrypoints
  const potentialEntries = [
    'src/index.ts',
    'src/main.ts',
    'src/index.js',
    'src/main.js',
    'src/App.tsx',
    'src/index.tsx',
    'src/main.rs',
    'main.go',
    'app.py',
    'main.py',
  ]
  for (const entry of potentialEntries) {
    if (fs.existsSync(path.join(workspaceDir, entry))) {
      result.entrypoints.push(entry)
    }
  }

  return result
}

export function generateProjectMemoryMarkdown(scan: CodebaseScanResult): string {
  const languagesList =
    scan.languages.size > 0 ? Array.from(scan.languages).join(', ') : 'JavaScript / TypeScript'
  const frameworksList =
    scan.frameworks.size > 0 ? Array.from(scan.frameworks).join(', ') : 'Standard Runtime'
  const lintersList =
    scan.linters.size > 0 ? Array.from(scan.linters).join(', ') : 'Standard / Prettier'
  const testList =
    scan.testFrameworks.size > 0
      ? Array.from(scan.testFrameworks).join(', ')
      : 'Native Node test runner'

  const scriptsSection =
    Object.keys(scan.scripts).length > 0
      ? Object.entries(scan.scripts)
          .map(([k, v]) => `- \`${scan.packageManager} run ${k}\`: \`${v}\``)
          .join('\n')
      : '- `npm test`: Run automated tests'

  const entrypointsSection =
    scan.entrypoints.length > 0
      ? scan.entrypoints.map((e) => `- \`${e}\``).join('\n')
      : '- Inspect root directory for entrypoints'

  return `# Project Memory: ${scan.name}

## Architecture & Tech Stack
- **Primary Languages**: ${languagesList}
- **Frameworks & Runtimes**: ${frameworksList}
- **Package Manager**: \`${scan.packageManager}\`
- **Linters / Formatters**: ${lintersList}
- **Test Framework**: ${testList}

## Entrypoints & Key Files
${entrypointsSection}

## Core Development Commands
${scriptsSection}

## Domain Concepts & Knowledge
- Initialized on Day 1 via \`/init\` onboarding agent.
- Keep this document updated with architectural decisions, service boundaries, and state models.
`
}

export function generateRulesMarkdown(scan: CodebaseScanResult): string {
  return `# Codebase Rules & Conventions: ${scan.name}

## Development & Execution Rules
- **Memory Isolation**: Memory storage is strictly external in \`~/.gemini/memory/\` and must never pollute workspace git repositories.
- **Dependency Installation**: Use exact version flag (\`-E\`) when installing dependencies via \`${scan.packageManager}\`.
- **TypeScript Types**: ทุกครั้งที่เขียน TypeScript ต้องใช้ \`type\` alias เท่านั้น ห้ามใช้ \`interface\` เด็ดขาด (Always use \`type\` alias, never use \`interface\`).
- **Code Search**: Prefer CocoIndex (\`ccc search\`) for semantic code discovery; use \`grep_search\` for exact tokens and literal references.
- **Review-First Commits**: ห้าม commit อัตโนมัติเด็ดขาด ให้แสดงผลการทดสอบและ diff ให้ผู้ใช้ตรวจเช็คก่อนเสมอ เมื่อผู้ใช้สั่งจึงค่อย commit.
- **No Fluff**: Keep memory blocks compact, high-signal, structured in Markdown.
`
}

export function initProjectMemory(
  workspaceDir: string = process.cwd(),
  options: InitOptions = {},
): InitResult {
  const scan = scanCodebase(workspaceDir)
  const projectDir = path.join(memoryRoot, 'projects', scan.slug)
  const learningsDir = path.join(projectDir, 'learnings')

  const projectMdPath = path.join(projectDir, 'project.md')
  const rulesMdPath = path.join(projectDir, 'rules.md')

  if (fs.existsSync(projectMdPath) && !options.force) {
    return {
      status: 'ALREADY_INITIALIZED',
      projectSlug: scan.slug,
      projectDir,
      filesCreated: [],
    }
  }

  if (options.dryRun) {
    return {
      status: 'DRY_RUN',
      projectSlug: scan.slug,
      projectDir,
      filesCreated: [projectMdPath, rulesMdPath],
    }
  }

  // Ensure directories exist
  fs.mkdirSync(projectDir, { recursive: true })
  fs.mkdirSync(learningsDir, { recursive: true })

  // Write Memory Blocks
  const projectContent = generateProjectMemoryMarkdown(scan)
  const rulesContent = generateRulesMarkdown(scan)

  fs.writeFileSync(projectMdPath, projectContent, 'utf-8')
  fs.writeFileSync(rulesMdPath, rulesContent, 'utf-8')

  // Auto-commit to MemFS Git
  try {
    if (fs.existsSync(path.join(memoryRoot, '.git'))) {
      execSync('git add .', { cwd: memoryRoot, stdio: 'ignore' })
      const status = execSync('git status --porcelain', {
        cwd: memoryRoot,
        encoding: 'utf-8',
      }).trim()
      if (status) {
        execSync(`git commit -m "init(project): bootstrap memory for ${scan.slug}"`, {
          cwd: memoryRoot,
          stdio: 'ignore',
        })
      }
    }
  } catch {}

  return {
    status: 'INITIALIZED',
    projectSlug: scan.slug,
    projectDir,
    filesCreated: [projectMdPath, rulesMdPath],
  }
}

if (process.argv[1]?.endsWith('init-project-memory.ts')) {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const dryRun = args.includes('--dry-run')

  console.log('\n🚀 Starting Codebase Onboarding & Memory Initialization...\n')
  const res = initProjectMemory(process.cwd(), { force, dryRun })

  if (res.status === 'ALREADY_INITIALIZED') {
    console.log(`ℹ️ Project "${res.projectSlug}" is already initialized in MemFS.`)
    console.log(`   Location: ${res.projectDir}`)
    console.log('   (Use --force to overwrite)\n')
  } else if (res.status === 'DRY_RUN') {
    console.log(`[Dry Run] Would initialize memory for "${res.projectSlug}" at: ${res.projectDir}`)
  } else {
    console.log(`✅ Successfully initialized MemFS for "${res.projectSlug}"!`)
    console.log(`   Directory: ${res.projectDir}`)
    console.log(`   Created files:`)
    res.filesCreated.forEach((f) => {
      console.log(`   - ${path.relative(memoryRoot, f)}`)
    })
    console.log('\nActive memory blocks will now be automatically injected before turns.\n')
  }
}
