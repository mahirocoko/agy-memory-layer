import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import { generatePreInvocationContext } from '../plugins/agy-memory-layer/scripts/hook-inject-memory.ts'
import { runStopHook } from '../plugins/agy-memory-layer/scripts/hook-memory-status.ts'
import {
  inspectCommittedMemoryProjection,
  parseMemoryDocument,
} from '../plugins/agy-memory-layer/scripts/layered-memory.ts'
import {
  commitMemoryDraft,
  editMemory,
  listMemoryDrafts,
  MemoryEngineError,
  manageMemory,
  migrateMemoryToV2,
} from '../plugins/agy-memory-layer/scripts/memory-engine.ts'
import { handleMcpMessage } from '../plugins/agy-memory-layer/scripts/memory-mcp-server.ts'
import { reflectMemory } from '../plugins/agy-memory-layer/scripts/memory-reflect.ts'
import {
  childIndexDescription,
  extractFrontmatterAndLinks,
  matchesQueryClauses,
  memoryPathSuggestions,
  palaceLayerFor,
  readMemory,
  tokenizeQueryClauses,
} from '../plugins/agy-memory-layer/scripts/memory-retrieval.ts'
import {
  applySurgicalEdit,
  assertLosslessRetention,
  assertReadOnlyFrontmatter,
  assertSafeMemoryContent,
  ensureTieredFrontmatter,
  MemorySchemaError,
  readOnlyFrontmatterValue,
} from '../plugins/agy-memory-layer/scripts/memory-schema.ts'
import { searchMemory } from '../plugins/agy-memory-layer/scripts/memory-search.ts'
import {
  exportOfflinePalaceHtml,
  readScopedMemoryHistory,
  renderOfflinePalaceHtml,
} from '../plugins/agy-memory-layer/scripts/palace-render.ts'
import {
  getProjectReflectionStepEntry,
  getReflectionPolicy,
  reflectionStepsPath,
  saveReflectionPolicy,
} from '../plugins/agy-memory-layer/scripts/reflection-policy.ts'
import { resolveProjectSlug } from '../plugins/agy-memory-layer/scripts/workspace-identity.ts'
import { inspectMemoryHealth } from '../tools/memory-health.ts'

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function initGitRepoWithCommits(
  repoDir: string,
  files: Record<string, string>,
  message = 'init',
): void {
  fs.mkdirSync(repoDir, { recursive: true })
  try {
    execFileSync('git', ['-C', repoDir, 'init', '-b', 'main'], { stdio: 'ignore' })
  } catch {
    execFileSync('git', ['-C', repoDir, 'init'], { stdio: 'ignore' })
  }
  const relPaths = Object.keys(files).sort()
  for (const relPath of relPaths) {
    const absPath = path.join(repoDir, relPath)
    fs.mkdirSync(path.dirname(absPath), { recursive: true })
    fs.writeFileSync(absPath, files[relPath] ?? '', 'utf-8')
  }
  execFileSync('git', ['-C', repoDir, 'add', '--', ...relPaths], { stdio: 'ignore' })
  execFileSync(
    'git',
    [
      '-C',
      repoDir,
      '-c',
      'user.name=Test Runner',
      '-c',
      'user.email=test@example.local',
      'commit',
      '-m',
      message,
    ],
    { stdio: 'ignore' },
  )
}

function commitAdditionalFiles(
  repoDir: string,
  files: Record<string, string>,
  message: string,
): void {
  const relPaths = Object.keys(files).sort()
  for (const relPath of relPaths) {
    const absPath = path.join(repoDir, relPath)
    fs.mkdirSync(path.dirname(absPath), { recursive: true })
    fs.writeFileSync(absPath, files[relPath] ?? '', 'utf-8')
  }
  execFileSync('git', ['-C', repoDir, 'add', '--', ...relPaths], { stdio: 'ignore' })
  execFileSync(
    'git',
    [
      '-C',
      repoDir,
      '-c',
      'user.name=Test Runner',
      '-c',
      'user.email=test@example.local',
      'commit',
      '-m',
      message,
    ],
    { stdio: 'ignore' },
  )
}

function runMcpStdioSession(
  requests: Array<Record<string, unknown>>,
  env: Record<string, string>,
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve('plugins/agy-memory-layer/scripts/memory-mcp-server.ts')
    const child = spawn(process.execPath, ['--experimental-strip-types', scriptPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`MCP stdio subprocess timed out. stderr=${stderr}`))
    }, 15_000)

    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`MCP server exited with code ${String(code)}: ${stderr}`))
        return
      }
      const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      try {
        resolve(lines.map((line) => JSON.parse(line) as Record<string, unknown>))
      } catch (err) {
        reject(new Error(`Failed to parse MCP stdout JSONL: ${String(err)}\n${stdout}`))
      }
    })

    for (const req of requests) {
      child.stdin.write(`${JSON.stringify(req)}\n`)
    }
    child.stdin.end()
  })
}

test('Schema guardrails: read_only protection, surgical edits, Lossless Retention Guard, secret scan, and frontmatter', () => {
  const roDoc = '---\ndescription: Protected contract\nread_only: true\n---\nLocked rules.\n'
  assert.equal(readOnlyFrontmatterValue(roDoc), 'true')
  assert.throws(
    () => assertReadOnlyFrontmatter('system/persona.md', roDoc, 'Unlocked'),
    (err: unknown) => err instanceof MemorySchemaError && err.code === 'READ_ONLY',
  )
  assert.throws(
    () => assertReadOnlyFrontmatter('system/persona.md', roDoc, null),
    (err: unknown) => err instanceof MemorySchemaError && err.code === 'READ_ONLY',
  )
  assert.throws(
    () =>
      assertReadOnlyFrontmatter(
        'system/persona.md',
        '---\ndescription: Normal\n---\nHello\n',
        '---\ndescription: Normal\nread_only: true\n---\nHello\n',
      ),
    (err: unknown) => err instanceof MemorySchemaError && err.code === 'READ_ONLY',
  )

  const baseDoc = '---\ndescription: Demo\n---\n# Title\n\n## Rules\n- Use pnpm -E.\n'
  const patched = applySurgicalEdit(baseDoc, undefined, {
    mode: 'patch',
    oldText: '- Use pnpm -E.',
    newText: '- Always use pnpm add -E.',
  })
  assert.ok(patched?.includes('- Always use pnpm add -E.'))

  assert.throws(
    () =>
      applySurgicalEdit(baseDoc, undefined, { mode: 'patch', oldText: 'missing', newText: 'x' }),
    (err: unknown) => err instanceof MemorySchemaError && err.code === 'PATCH_TARGET_NOT_FOUND',
  )

  const dupDoc = 'hello\nhello\n'
  assert.throws(
    () =>
      applySurgicalEdit(dupDoc, undefined, { mode: 'patch', oldText: 'hello', newText: 'world' }),
    (err: unknown) => err instanceof MemorySchemaError && err.code === 'PATCH_TARGET_AMBIGUOUS',
  )

  const underExisting = applySurgicalEdit(baseDoc, '- Never force push.', {
    mode: 'append',
    section: 'Rules',
  })
  assert.ok(underExisting?.includes('## Rules\n- Use pnpm -E.\n- Never force push.'))

  const newSection = applySurgicalEdit(baseDoc, '- Thai responses default.', {
    mode: 'append',
    section: 'Language',
  })
  assert.ok(newSection?.includes('## Language\n\n- Thai responses default.'))

  // Lossless Retention Guard
  const largeProtected =
    '---\ndescription: Conventions\n---\n# Architecture\n\n' +
    'This is a long durable rule describing architecture constraints in detail. '.repeat(4) +
    '\n## Tooling\n\nUse strict Biome and TypeScript type aliases everywhere.\n'
  const shrunken = '---\ndescription: Conventions\n---\n# Architecture\n\nToo short.\n'
  assert.throws(
    () =>
      assertLosslessRetention(
        { 'system/persona.md': largeProtected },
        { 'system/persona.md': shrunken },
        ['system/persona.md'],
        false,
      ),
    (err: unknown) => err instanceof MemorySchemaError && err.code === 'RETENTION',
  )

  // Archiving into reference/ in the same commit satisfies Lossless Retention
  const archivedRef =
    '---\ndescription: Superseded tooling archive\n---\n# Archived Notes\n\n' +
    'Superseded architectural details preserved verbatim with context. '.repeat(4)
  assert.doesNotThrow(() =>
    assertLosslessRetention(
      { 'system/persona.md': largeProtected },
      { 'system/persona.md': shrunken, 'reference/superseded.md': archivedRef },
      ['system/persona.md', 'reference/superseded.md'],
      false,
    ),
  )

  // Explicit allowShrink bypasses shrink guard, and small Core.md (<2 headings & <160 chars) is exempt
  assert.doesNotThrow(() =>
    assertLosslessRetention(
      { 'system/persona.md': largeProtected },
      { 'system/persona.md': shrunken },
      ['system/persona.md'],
      true,
    ),
  )
  assert.doesNotThrow(() =>
    assertLosslessRetention(
      { 'Core.md': '# Core\nStarter line only under 160 chars.\n' },
      { 'Core.md': '# Core\nRefined.\n' },
      ['Core.md'],
      false,
    ),
  )

  // Secret scan & frontmatter normalization
  assert.throws(
    () =>
      assertSafeMemoryContent(
        'system/human/prefs/tokens.md',
        '---\ndescription: Bad\n---\nsk-ant-api03-secretvalue1234567890abcdef\n',
      ),
    (err: unknown) => err instanceof MemorySchemaError && err.code === 'SECRET_DETECTED',
  )
  const withFm = ensureTieredFrontmatter('system/human/prefs/editor.md', '# Editor\nUse Zed.\n')
  assert.ok(withFm.startsWith('---\nname: editor\ndescription:'))
  assert.equal(ensureTieredFrontmatter('Core.md', '# Core\nSummary.\n'), '# Core\nSummary.\n')
})

test('Tiered v2 projection & Thai/English lexical search + directory paging + upgraded searchMemory', () => {
  const tempRoot = createTempDir('agy-tiered-v2-')
  const memoryRoot = path.join(tempRoot, 'memory')
  const workspace = path.join(tempRoot, 'repo')
  fs.mkdirSync(workspace, { recursive: true })
  const slug = resolveProjectSlug(workspace, memoryRoot)

  try {
    initGitRepoWithCommits(memoryRoot, {
      'Core.md': '# Core Memory\nCompanion identity and operating rules.\n',
      'index.md':
        '# Memory Index\n\n- [[system/persona.md]] — Persona\n- [[reference/index.md]] — Reference index\n',
      'system/index.md': '# system index\n\n- [[system/persona.md]] — Persona\n',
      'system/persona.md':
        '---\nname: persona\ndescription: Agent persona and response language\n---\nตอบภาษาไทยแบบกระชับและตรวจสอบด้วย command จริง\n',
      'reference/index.md':
        '# reference index\n\n<!-- Deferred reference group -->\n- [[reference/ops/index.md]] — Deployment and rollback procedures\n',
      'reference/ops/index.md':
        '# reference/ops index\n\nProduction deploy and rollback playbooks\n\n- [[reference/ops/deploy.md]] — Blue-green deployment steps\n',
      'reference/ops/deploy.md':
        '---\ndescription: Blue-green deployment steps and rollback checklist\n---\n# Deploy\n\nการปรับใช้ระบบบนโปรดักชันต้องรัน canary check และเตรียม rollback เสมอ\n',
      [`projects/${slug}/system/overview.md`]:
        '---\ndescription: Repo overview\n---\n# Overview\nUses pnpm and strict TypeScript.\n',
    })

    // Layered projection includes Core.md + index.md, discoveryDirectories, omits index.md from globalSystem
    const projection = inspectCommittedMemoryProjection(memoryRoot, slug)
    assert.equal(projection.mode, 'layered')
    assert.deepEqual(
      projection.coreDocuments?.map((d) => d.relativePath),
      ['Core.md', 'index.md'],
    )
    assert.ok(projection.globalSystem.every((entry) => !entry.relativePath.endsWith('index.md')))
    assert.ok(
      projection.discoveryDirectories?.some(
        (d) => d.path === 'reference/' && d.index === 'reference/index.md',
      ),
    )
    assert.ok(
      projection.discoveryDirectories?.some(
        (d) => d.path === 'reference/ops/' && d.index === 'reference/ops/index.md',
      ),
    )

    // Thai/English stopword-stripped tokenizer & OR disjunction
    const thaiClauses = tokenizeQueryClauses('การ ปรับใช้ จาก | rollback checklist the')
    assert.ok(thaiClauses.length >= 2)
    assert.ok(
      matchesQueryClauses(
        thaiClauses,
        'reference/ops/deploy.md',
        'การปรับใช้ระบบบนโปรดักชันต้องเตรียม rollback เสมอ',
      ),
    )

    // Lexical search & directory paging via readMemory
    const searchRes = readMemory(
      memoryRoot,
      { query: 'ปรับใช้ OR canary' },
      { projectSlug: slug },
    ) as {
      outcome: string
      results: Array<{ path: string; text: string; offset: number; citation: string }>
    }
    assert.equal(searchRes.outcome, 'matches')
    assert.equal(searchRes.results[0]?.path, 'reference/ops/deploy.md')
    assert.ok(searchRes.results[0]?.citation.includes('#sha256:'))

    const dirRes = readMemory(memoryRoot, { path: 'reference' }, { projectSlug: slug }) as {
      directory: string
      childDirectories: Array<{ path: string; index: string; description?: string }>
      indexPreview?: { path: string; text: string }
    }
    assert.equal(dirRes.directory, 'reference')
    assert.equal(dirRes.childDirectories[0]?.path, 'reference/ops/')
    assert.equal(
      dirRes.childDirectories[0]?.description,
      'Production deploy and rollback playbooks',
    )
    assert.equal(
      childIndexDescription(
        '# reference/ops index\n\nProduction deploy and rollback playbooks\n\n- [[x]]',
      ),
      'Production deploy and rollback playbooks',
    )
    assert.ok(dirRes.indexPreview?.path === 'reference/index.md')

    // Path suggestions & upgraded searchMemory()
    const suggestions = memoryPathSuggestions(
      'reference/ops/deploy',
      Object.keys({
        'reference/ops/deploy.md': 1,
      }),
    )
    assert.equal(suggestions[0], 'reference/ops/deploy.md')

    const legacySearchHits = searchMemory('canary | nonexistent', { memoryRoot })
    assert.ok(legacySearchHits.some((hit) => hit.relPath === 'reference/ops/deploy.md'))
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('Direct CAS engine: init, surgical one-step commit index sync, multi-file draft commit, CAS conflicts, migrate-v2, and shared diversion', () => {
  const tempRoot = createTempDir('agy-engine-cas-')
  const memoryRoot = path.join(tempRoot, 'memory')
  const sharedSourceRoot = path.join(tempRoot, 'shared-source')
  const workspace = path.join(tempRoot, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  const projectSlug = resolveProjectSlug(workspace, memoryRoot)

  try {
    // 1. Initialize Tiered v2 repo via manageMemory('init')
    const initRes = manageMemory({
      memoryRoot,
      workspacePath: workspace,
      projectSlug,
      action: 'init',
    })
    assert.equal(initRes.status, 'INITIALIZED')
    assert.ok(fs.existsSync(path.join(memoryRoot, 'Core.md')))
    assert.ok(fs.existsSync(path.join(memoryRoot, 'index.md')))

    // 2. Single-step commit: true auto-syncs ancestor <dir>/index.md and root index.md
    const createRes = editMemory({
      memoryRoot,
      projectSlug,
      path: 'reference/ops/runbook.md',
      expectedHash: null,
      text: '---\nname: runbook\ndescription: Production incident runbook\n---\n# Runbook\nCheck health before rollback.\n',
      commit: true,
      message: 'memory: add incident runbook',
    })
    assert.equal(createRes.committed, true)
    assert.ok(createRes.changedPaths?.includes('reference/ops/runbook.md'))
    assert.ok(createRes.changedPaths?.includes('reference/ops/index.md'))
    assert.ok(createRes.changedPaths?.includes('reference/index.md'))
    assert.ok(createRes.changedPaths?.includes('index.md'))

    // 3. Stale expectedHash triggers HASH_MISMATCH
    assert.throws(
      () =>
        editMemory({
          memoryRoot,
          projectSlug,
          path: 'reference/ops/runbook.md',
          expectedHash: '0'.repeat(64),
          text: 'stale edit',
        }),
      (err: unknown) => err instanceof MemoryEngineError && err.code === 'HASH_MISMATCH',
    )

    // 4. Multi-file draft + commitMemoryDraft (+ REVISION_CONFLICT guard)
    const revBefore = String(createRes.revision)
    const draftEdit = editMemory({
      memoryRoot,
      projectSlug,
      path: 'system/human/prefs/style.md',
      expectedHash: null,
      text: '---\ndescription: Coding style\n---\n- Prefer type aliases over interfaces.\n',
      commit: false,
    })
    assert.equal(draftEdit.draft, true)
    assert.ok(draftEdit.draftId)

    assert.throws(
      () =>
        commitMemoryDraft({
          memoryRoot,
          revision: 'deadbeef',
          draftId: draftEdit.draftId,
        }),
      (err: unknown) => err instanceof MemoryEngineError && err.code === 'REVISION_CONFLICT',
    )

    const committedDraft = commitMemoryDraft({
      memoryRoot,
      revision: revBefore,
      draftId: draftEdit.draftId,
      message: 'memory: commit multi-file style draft',
    })
    assert.equal(committedDraft.committed, true)
    assert.ok(committedDraft.changedPaths.includes('system/human/prefs/style.md'))

    // 5. Doctor, palace, history, remember, cleanup, and policy actions
    const doctorRes = manageMemory({
      memoryRoot,
      workspacePath: workspace,
      projectSlug,
      action: 'doctor',
    })
    assert.equal(doctorRes.healthy, true)

    const remRes = manageMemory({
      memoryRoot,
      workspacePath: workspace,
      projectSlug,
      action: 'remember',
      text: 'Always use pnpm add -E.',
      path: 'system/human/prefs/pkg.md',
    })
    assert.equal(remRes.committed, true)

    const histRes = manageMemory({
      memoryRoot,
      workspacePath: workspace,
      projectSlug,
      action: 'history',
    }) as {
      entries: Array<{ subject: string }>
    }
    assert.ok(histRes.entries.length >= 3)

    // 6. Opt-in shared communication owner diversion
    initGitRepoWithCommits(sharedSourceRoot, {
      'system/human/prefs/communication.md':
        '---\ndescription: Shared communication prefs\n---\n- Reply in Thai unless asked otherwise.\n',
    })
    const diverted = editMemory({
      memoryRoot,
      projectSlug,
      path: 'system/human/prefs/communication.md',
      expectedHash: null,
      text: '---\ndescription: Shared communication prefs\n---\n- Keep answers super concise.\n',
      sharedSettings: {
        enabled: true,
        sourceRoot: sharedSourceRoot,
      },
    })
    assert.equal(diverted.committed, false)
    assert.equal(diverted.divertedToSharedProposal, true)
    assert.ok(diverted.proposalId)

    // 7. Legacy migration dryRun + apply
    const legacyMemoryRoot = path.join(tempRoot, 'legacy-memory')
    initGitRepoWithCommits(legacyMemoryRoot, {
      'global/human.md': '# Human\nMahiro likes Thai responses.\n',
      'global/persona.md': '# Persona\nPragmatic pair programmer.\n',
      [`projects/${projectSlug}/project.md`]: '# Project\nSandbox repo.\n',
      [`projects/${projectSlug}/rules.md`]: '# Rules\nNo interfaces.\n',
    })
    const dryMig = migrateMemoryToV2({
      memoryRoot: legacyMemoryRoot,
      projectSlug,
      dryRun: true,
    }) as {
      status: string
      writes: string[]
      removals: string[]
      archivedOriginals: string[]
    }
    assert.equal(dryMig.status, 'DRY_RUN')
    assert.ok(dryMig.archivedOriginals.length === 4)

    const appliedMig = migrateMemoryToV2({
      memoryRoot: legacyMemoryRoot,
      projectSlug,
      dryRun: false,
    }) as {
      status: string
      writes: string[]
    }
    assert.equal(appliedMig.status, 'MIGRATED_V2')
    assert.equal(inspectCommittedMemoryProjection(legacyMemoryRoot, projectSlug).mode, 'layered')
    assert.ok(fs.existsSync(path.join(legacyMemoryRoot, 'Core.md')))
    assert.ok(fs.existsSync(path.join(legacyMemoryRoot, 'index.md')))
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('Offline Letta-grammar Palace HTML renderer: 4 views, nested folders, scoping, zero scripts/external assets, 0600 perms', () => {
  const tempRoot = createTempDir('agy-offline-palace-')
  const memoryRoot = path.join(tempRoot, 'memory')
  const workspace = path.join(tempRoot, 'project-a')
  fs.mkdirSync(workspace, { recursive: true })
  const slugA = resolveProjectSlug(workspace, memoryRoot)
  const slugB = 'other-secret-project'

  try {
    initGitRepoWithCommits(memoryRoot, {
      'Core.md': '# Core\nActive memory.\n',
      'index.md': '# Index\n- [[system/persona.md]] — Persona\n',
      'system/persona.md':
        '---\nname: persona\ndescription: Persona\nread_only: true\n---\nSteady.\n',
      [`projects/${slugA}/system/overview.md`]:
        '---\ndescription: Alpha project overview\n---\n# Alpha\nVisible in palace.\n',
      [`projects/${slugB}/system/overview.md`]:
        '---\ndescription: Beta secret overview\n---\n# Beta Secret\nMUST NOT LEAK INTO PROJECT A HTML.\n',
    })
    commitAdditionalFiles(
      memoryRoot,
      { [`projects/${slugB}/system/extra.md`]: '---\ndescription: Secret\n---\nSecret body\n' },
      `Update ${slugB} secret internals`,
    )

    const outHtml = path.join(tempRoot, 'out', 'palace.html')
    const exported = exportOfflinePalaceHtml({
      memoryRoot,
      projectSlug: slugA,
      outputPath: outHtml,
    })
    assert.equal(exported.projectSlug, slugA)
    assert.ok(exported.coreCount >= 2)
    const html = fs.readFileSync(outHtml, 'utf-8')

    // Zero scripts, zero external assets/imports, all 4 views + raw toggle present, scoped away slugB
    assert.ok(!/<script[\s>]/i.test(html))
    assert.ok(!/(?:src|href|action)\s*=\s*["']https?:\/\//i.test(html))
    assert.ok(!/url\(\s*['"]?https?:\/\//i.test(html))
    assert.ok(!/@import/i.test(html))
    assert.ok(html.includes('Memory Palace'))
    assert.ok(html.includes('view-context'))
    assert.ok(html.includes('view-core'))
    assert.ok(html.includes('view-external'))
    assert.ok(html.includes('view-history'))
    assert.ok(html.includes('Raw'))
    assert.ok(html.includes('Alpha project overview'))
    assert.ok(!html.includes('MUST NOT LEAK INTO PROJECT A HTML'))
    assert.ok(html.includes('Out-of-scope project update'))

    const mode = fs.statSync(outHtml).mode & 0o777
    assert.equal(mode, 0o600)

    // Render helper sanity check with empty history
    const directHtml = renderOfflinePalaceHtml({
      projectSlug: slugA,
      revision: 'abc123456789',
      capturedAt: '2026-11-23T00:00:00.000Z',
      pluginVersion: '1.25.0',
      files: [
        {
          path: 'Core.md',
          layer: 'core',
          bytes: 16,
          protectedRetention: true,
          alwaysLoaded: true,
          body: '# Core\nDirect.',
        },
      ],
      history: [],
    })
    assert.ok(directHtml.includes('Core.md'))
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('Reflection policy, Stop/PreInvocation hooks & model-flexible reflectMemory', () => {
  const tempRoot = createTempDir('agy-reflect-policy-')
  const memoryRoot = path.join(tempRoot, 'memory')
  const workspace = path.join(tempRoot, 'ws')
  fs.mkdirSync(workspace, { recursive: true })
  const projectSlug = resolveProjectSlug(workspace, memoryRoot)

  try {
    manageMemory({ memoryRoot, workspacePath: workspace, projectSlug, action: 'init' })

    // Default policy is 'off', threshold 25, model 'inherit'; Stop does not create step file or dirty git
    const def = getReflectionPolicy(memoryRoot)
    assert.equal(def.trigger, 'off')
    assert.equal(def.stepCountThreshold, 25)
    assert.equal(def.model, 'inherit')

    runStopHook(
      memoryRoot,
      JSON.stringify({ workspacePaths: [workspace], terminationReason: 'NO_TOOL_CALL' }),
    )
    assert.equal(fs.existsSync(reflectionStepsPath(memoryRoot)), false)

    // Enable step-count trigger with threshold 2 and custom flexible model
    saveReflectionPolicy(memoryRoot, {
      trigger: 'step-count',
      stepCountThreshold: 2,
      model: 'gemini-custom-test',
    })

    runStopHook(
      memoryRoot,
      JSON.stringify({
        workspacePaths: [workspace],
        conversationId: 'conv-1',
        terminationReason: 'NO_TOOL_CALL',
      }),
    )
    assert.equal(getProjectReflectionStepEntry(memoryRoot, projectSlug).pendingReflectionDue, false)

    runStopHook(
      memoryRoot,
      JSON.stringify({
        workspacePaths: [workspace],
        conversationId: 'conv-1',
        terminationReason: 'NO_TOOL_CALL',
      }),
    )
    assert.equal(getProjectReflectionStepEntry(memoryRoot, projectSlug).pendingReflectionDue, true)

    // MemFS git status stays completely clean
    const gitStatus = execFileSync('git', ['-C', memoryRoot, 'status', '--short'], {
      encoding: 'utf-8',
    }).trim()
    assert.equal(gitStatus, '')

    // PreInvocation surfaces reflection due notice
    const preOut = generatePreInvocationContext(
      JSON.stringify({ workspacePaths: [workspace] }),
      memoryRoot,
    )
    const injected = preOut.injectSteps.map((s) => s.ephemeralMessage).join('\n')
    assert.ok(injected.includes('Memory Reflection Due'))

    // Plan mode returns structured packet & resolved model
    const planOut = reflectMemory({
      memoryRoot,
      projectSlug,
      workspacePath: workspace,
      mode: 'plan',
    })
    assert.equal(planOut.resolvedModel, 'gemini-custom-test')
    assert.ok((planOut.activeFiles?.length ?? 0) >= 2)

    // Apply mode uses custom transport without hardcoding any model and resets step counter
    let capturedModel: string | null = null
    const applyOut = reflectMemory({
      memoryRoot,
      projectSlug,
      workspacePath: workspace,
      mode: 'apply',
      model: 'openai/gpt-custom-reflect',
      transcriptText: 'User: Always use -E when adding pnpm dependencies.',
      transport: (req) => {
        capturedModel = req.model
        return JSON.stringify({
          summary: 'Added pnpm -E rule',
          no_changes: false,
          operations: [
            {
              op: 'create',
              path: 'system/human/prefs/dependencies.md',
              description: 'Package manager dependency installation rules',
              mode: 'replace',
              text: '# Dependencies\n- Always use `pnpm add -E <package>`.\n',
            },
          ],
        })
      },
    })
    assert.equal(capturedModel, 'openai/gpt-custom-reflect')
    assert.equal(applyOut.resolvedModel, 'openai/gpt-custom-reflect')
    assert.ok(applyOut.appliedPaths?.includes('system/human/prefs/dependencies.md'))
    assert.equal(applyOut.steps.pendingSteps, 0)
    assert.equal(applyOut.steps.pendingReflectionDue, false)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

function parseMcpToolPayload<T>(response: Record<string, unknown> | null | undefined): T {
  const result = response?.result as { content?: Array<{ text?: string }> } | undefined
  const text = result?.content?.[0]?.text
  assert.equal(typeof text, 'string', 'Expected JSON-RPC tool response content[0].text')
  return JSON.parse(text as string) as T
}

test('Bundled stdio MCP server subprocess handles initialize, notifications/initialized, tools/list, and all 6 tools', async () => {
  const tempRoot = createTempDir('agy-mcp-stdio-')
  const fakeHome = path.join(tempRoot, 'home')
  const memoryRoot = path.join(fakeHome, '.gemini', 'memory')
  const workspace = path.join(tempRoot, 'repo')
  const brainConv = path.join(
    fakeHome,
    '.gemini',
    'antigravity-cli',
    'brain',
    'conv-recall-test-001',
    '.system_generated',
    'logs',
  )
  fs.mkdirSync(workspace, { recursive: true })
  fs.mkdirSync(brainConv, { recursive: true })
  fs.writeFileSync(
    path.join(brainConv, 'transcript.jsonl'),
    `${JSON.stringify({
      type: 'USER_INPUT',
      content: 'Remember that continuity_recall should find our canary deploy keyword cleanly.',
      timestamp: '2026-11-23T08:00:00.000Z',
    })}\n${JSON.stringify({
      type: 'assistant',
      content: 'Acknowledged canary deploy verification keyword for recall.',
      timestamp: '2026-11-23T08:00:05.000Z',
    })}\n`,
    'utf-8',
  )

  const exportedHtmlPath = path.join(tempRoot, 'palace-mcp.html')

  try {
    // Phase 1: initialize, notification (no response), tools/list, init + one-step edit + read + palace_export + reflect(plan) + continuity_recall
    const phase1 = await runMcpStdioSession(
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-03-26', clientInfo: { name: 'test', version: '1.0.0' } },
        },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'agent_memory_manage', arguments: { action: 'init' } },
        },
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'agent_memory_edit',
            arguments: {
              path: 'reference/ops/release.md',
              expectedHash: null,
              text: '---\nname: release\ndescription: Release workflow and rollback gates\n---\n# Release\nUse canary verify before tag.\n',
              commit: true,
              message: 'memory: add release reference via MCP',
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: { name: 'agent_memory_read', arguments: { query: 'canary' } },
        },
        {
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'agent_memory_manage',
            arguments: { action: 'palace_export', outputPath: exportedHtmlPath },
          },
        },
        {
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: 'agent_memory_reflect', arguments: { mode: 'plan' } },
        },
        {
          jsonrpc: '2.0',
          id: 8,
          method: 'tools/call',
          params: { name: 'continuity_recall', arguments: { query: 'canary', mode: 'keyword' } },
        },
      ],
      {
        HOME: fakeHome,
        AGY_MEMORY_DIR: memoryRoot,
        AGY_WORKSPACE: workspace,
      },
    )

    // Notification produced no message => 8 responses total (ids 1..8)
    assert.equal(phase1.length, 8)
    const initResp = phase1[0]?.result as { serverInfo?: { name: string } }
    assert.equal(initResp.serverInfo?.name, 'agy-memory-layer')

    const toolsResp = phase1[1]?.result as { tools: Array<{ name: string }> }
    assert.deepEqual(toolsResp.tools.map((t) => t.name).sort(), [
      'agent_memory_commit',
      'agent_memory_edit',
      'agent_memory_manage',
      'agent_memory_read',
      'agent_memory_reflect',
      'continuity_recall',
    ])

    const editPayload = parseMcpToolPayload<{ committed: boolean; revision: string; hash: string }>(
      phase1[3],
    )
    assert.equal(editPayload.committed, true)
    assert.ok(editPayload.revision)

    const readPayload = parseMcpToolPayload<{ outcome: string; results: Array<{ path: string }> }>(
      phase1[4],
    )
    assert.equal(readPayload.outcome, 'matches')
    assert.equal(readPayload.results[0]?.path, 'reference/ops/release.md')

    assert.ok(fs.existsSync(exportedHtmlPath))

    const reflectPayload = parseMcpToolPayload<{ mode: string; resolvedModel: string }>(phase1[6])
    assert.equal(reflectPayload.mode, 'plan')
    assert.ok(reflectPayload.resolvedModel)

    const recallPayload = parseMcpToolPayload<{
      authority: string
      count: number
      hits: Array<{ convId: string }>
    }>(phase1[7])
    assert.equal(recallPayload.authority, 'non-binding historical evidence only')
    assert.ok(recallPayload.count >= 1)
    assert.equal(recallPayload.hits[0]?.convId, 'conv-recall-test-001')

    // Phase 2: Multi-step draft -> commit over stdio using revision from editPayload
    const phase2 = await runMcpStdioSession(
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'agent_memory_edit',
            arguments: {
              path: 'system/human/prefs/mcp-draft.md',
              expectedHash: null,
              text: '---\nname: mcp-draft\ndescription: Staged via MCP draft\n---\n# Draft\nStaged atomically.\n',
              commit: false,
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'agent_memory_commit',
            arguments: {
              revision: editPayload.revision,
              message: 'memory: commit MCP draft over stdio',
            },
          },
        },
      ],
      {
        HOME: fakeHome,
        AGY_MEMORY_DIR: memoryRoot,
        AGY_WORKSPACE: workspace,
      },
    )

    const commitPayload = parseMcpToolPayload<{ committed: boolean; changedPaths: string[] }>(
      phase2[1],
    )
    assert.equal(commitPayload.committed, true)
    assert.ok(commitPayload.changedPaths.includes('system/human/prefs/mcp-draft.md'))
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('Recheck regressions: failed commit:true draft cleanup, delete index pruning, reflect index sync/cleanup, empty-body frontmatter, remember section, and migrate-v2 description injection', () => {
  const tempRoot = createTempDir('agy-recheck-reg-')
  const memoryRoot = path.join(tempRoot, 'memory')
  const workspace = path.join(tempRoot, 'ws')
  fs.mkdirSync(workspace, { recursive: true })
  const projectSlug = resolveProjectSlug(workspace, memoryRoot)

  try {
    manageMemory({ memoryRoot, workspacePath: workspace, projectSlug, action: 'init' })

    // 1. Failed commit: true (Retention Guard) leaves zero orphaned drafts
    const longDoc =
      '---\ndescription: Long durable guide\n---\n# H1\n' +
      'Detailed durable knowledge sentence for retention guard testing. '.repeat(5) +
      '\n## H2\nExtra rules.\n'
    const createdLong = editMemory({
      memoryRoot,
      projectSlug,
      path: 'system/human/long.md',
      expectedHash: null,
      text: longDoc,
      commit: true,
    })
    assert.throws(
      () =>
        editMemory({
          memoryRoot,
          projectSlug,
          path: 'system/human/long.md',
          expectedHash: createdLong.hash,
          text: '---\ndescription: Long durable guide\n---\n# H1\nTiny.\n',
          commit: true,
        }),
      (err: unknown) => err instanceof MemorySchemaError && err.code === 'RETENTION',
    )
    assert.equal(listMemoryDrafts(memoryRoot).length, 0)

    // 2. Deleting a file via commit: true prunes [[...]] pointers from parent index and root index.md
    const createdRef = editMemory({
      memoryRoot,
      projectSlug,
      path: 'reference/ops/temp.md',
      expectedHash: null,
      text: '---\ndescription: Temporary ops note\n---\n# Temp\nEphemeral detail.\n',
      commit: true,
    })
    const deletedRef = editMemory({
      memoryRoot,
      projectSlug,
      path: 'reference/ops/temp.md',
      expectedHash: createdRef.hash,
      text: null,
      commit: true,
    })
    assert.equal(deletedRef.committed, true)
    assert.equal(listMemoryDrafts(memoryRoot).length, 0)
    const opsIdx = fs.readFileSync(path.join(memoryRoot, 'reference/ops/index.md'), 'utf-8')
    const rootIdx = fs.readFileSync(path.join(memoryRoot, 'index.md'), 'utf-8')
    assert.ok(!opsIdx.includes('[[reference/ops/temp.md]]'))
    assert.ok(!rootIdx.includes('[[reference/ops/temp.md]]'))
    const docAfterDel = manageMemory({
      memoryRoot,
      workspacePath: workspace,
      projectSlug,
      action: 'doctor',
    }) as { healthy: boolean; brokenLinksTotal: number }
    assert.equal(docAfterDel.healthy, true)
    assert.equal(docAfterDel.brokenLinksTotal, 0)

    // 3. reflectMemory apply syncs <dir>/index.md + root index.md, and failure leaves 0 orphaned drafts
    const reflectApply = reflectMemory({
      memoryRoot,
      projectSlug,
      workspacePath: workspace,
      mode: 'apply',
      transport: () =>
        JSON.stringify({
          summary: 'Add deploy guide',
          no_changes: false,
          operations: [
            {
              op: 'create',
              path: 'reference/deploy/guide.md',
              description: 'Production deployment checklist',
              mode: 'replace',
              text: '# Deploy Guide\nRun checks before promotion.\n',
            },
          ],
        }),
    })
    assert.ok(reflectApply.appliedPaths?.includes('reference/deploy/guide.md'))
    assert.ok(reflectApply.appliedPaths?.includes('reference/deploy/index.md'))
    assert.ok(reflectApply.appliedPaths?.includes('index.md'))

    assert.throws(
      () =>
        reflectMemory({
          memoryRoot,
          projectSlug,
          workspacePath: workspace,
          mode: 'apply',
          transport: () =>
            JSON.stringify({
              summary: 'Fail mid-loop',
              no_changes: false,
              operations: [
                {
                  op: 'create',
                  path: 'reference/deploy/ok.md',
                  description: 'Valid first op',
                  mode: 'replace',
                  text: '# Ok\nSafe note.\n',
                },
                {
                  op: 'create',
                  path: 'reference/deploy/bad.md',
                  description: 'Contains secret on second op',
                  mode: 'replace',
                  text: 'sk-ant-api03-secretvalue1234567890abcdef\n',
                },
              ],
            }),
        }),
      (err: unknown) => err instanceof MemorySchemaError && err.code === 'SECRET_DETECTED',
    )
    assert.equal(listMemoryDrafts(memoryRoot).length, 0)

    // 4. Empty-body YAML frontmatter at EOF parses cleanly
    const emptyBodyDoc = parseMemoryDocument(
      '---\ndescription: Empty body\n---',
      'reference/empty.md',
      { requireDescription: true },
    )
    assert.equal(emptyBodyDoc.description, 'Empty body')
    assert.equal(emptyBodyDoc.body, '')
    assert.deepEqual(emptyBodyDoc.diagnostics, [])

    // 5. remember forwards optional section heading
    const remSec = manageMemory({
      memoryRoot,
      workspacePath: workspace,
      projectSlug,
      action: 'remember',
      text: 'Use exact flags',
      path: 'system/human/prefs/pkg.md',
      section: 'Package Manager',
    })
    assert.equal(remSec.committed, true)
    const pkgText = fs.readFileSync(path.join(memoryRoot, 'system/human/prefs/pkg.md'), 'utf-8')
    assert.ok(pkgText.includes('## Package Manager\n\n- Use exact flags'))

    // 6. migrateMemoryToV2 injects missing description when legacy file already had frontmatter
    const legacyRoot = path.join(tempRoot, 'legacy-fm')
    initGitRepoWithCommits(legacyRoot, {
      'global/human.md': '---\nname: human\n---\n# Human\nNo description field yet.\n',
      [`projects/${projectSlug}/project.md`]: '# Project\nUses TypeScript.\n',
      [`projects/${projectSlug}/rules.md`]: '# Rules\nNo interfaces.\n',
    })
    const migRes = migrateMemoryToV2({ memoryRoot: legacyRoot, projectSlug, dryRun: false }) as {
      status: string
    }
    assert.equal(migRes.status, 'MIGRATED_V2')
    const migProjection = inspectCommittedMemoryProjection(legacyRoot, projectSlug)
    assert.deepEqual(migProjection.diagnostics, [])
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('Hardening Cycle 1: read_only quoted/CRLF bypasses, delete nonexistent/subdir index, remember draft isolation, mixed/uninit fail-closed, MCP JSON-RPC/schema strictness, reflect validation, and XSS + shared Palace', async () => {
  const tempRoot = createTempDir('agy-hardening-c1-')
  const memoryRoot = path.join(tempRoot, 'memory')
  const workspace = path.join(tempRoot, 'ws')
  fs.mkdirSync(workspace, { recursive: true })
  const projectSlug = resolveProjectSlug(workspace, memoryRoot)

  const prevSharedEnabled = process.env.AGY_SHARED_MEMORY_ENABLED
  const prevSharedConfig = process.env.AGY_SHARED_MEMORY_CONFIG
  const prevSharedSource = process.env.AGY_SHARED_MEMORY_SOURCE_ROOT

  try {
    // 1. Quoted read_only: "true" & CRLF frontmatter blocked in assertReadOnlyFrontmatter and parsed cleanly
    const quotedRo = '---\ndescription: Locked\nread_only: "true"\n---\nLocked body.\n'
    const quotedNext = '---\ndescription: Locked\nread_only: "true"\n---\nTampered body.\n'
    assert.throws(
      () => assertReadOnlyFrontmatter('system/persona.md', quotedRo, quotedNext),
      (err: unknown) => err instanceof MemorySchemaError && err.code === 'READ_ONLY',
    )

    const crlfRo = '---\r\ndescription: CRLF Locked\r\nread_only: true\r\n---\r\nSecret line.\r\n'
    assert.throws(
      () => assertReadOnlyFrontmatter('system/persona.md', crlfRo, crlfRo),
      (err: unknown) => err instanceof MemorySchemaError && err.code === 'READ_ONLY',
    )
    const parsedCrlf = parseMemoryDocument(crlfRo, 'system/persona.md', {
      requireDescription: true,
    })
    assert.equal(parsedCrlf.description, 'CRLF Locked')
    assert.equal(parsedCrlf.readOnly, true)
    assert.deepEqual(parsedCrlf.diagnostics, [])
    const metaCrlf = extractFrontmatterAndLinks(crlfRo)
    assert.equal(metaCrlf.description, 'CRLF Locked')
    assert.equal(metaCrlf.readOnly, true)

    // Uninitialized repo rejects editMemory fail-closed
    assert.throws(
      () =>
        editMemory({
          memoryRoot,
          projectSlug,
          path: 'reference/uninit.md',
          expectedHash: null,
          text: '# Uninit\n',
        }),
      (err: unknown) => err instanceof MemoryEngineError && err.code === 'UNINITIALIZED',
    )

    // Init Tiered v2 repo
    manageMemory({ memoryRoot, workspacePath: workspace, projectSlug, action: 'init' })

    // 2. Deleting non-existent file throws INVALID_ARGUMENTS & leaves 0 drafts
    assert.throws(
      () =>
        editMemory({
          memoryRoot,
          projectSlug,
          path: 'reference/nope.md',
          expectedHash: null,
          text: null,
          commit: true,
        }),
      (err: unknown) => err instanceof MemorySchemaError && err.code === 'INVALID_ARGUMENTS',
    )
    assert.equal(listMemoryDrafts(memoryRoot).length, 0)

    // 3. Deleting subdirectory reference/sub/index.md removes [[reference/sub/index.md]] from reference/index.md and index.md
    const subFile = editMemory({
      memoryRoot,
      projectSlug,
      path: 'reference/sub/a.md',
      expectedHash: null,
      text: '---\ndescription: Sub A\n---\n# Sub A\nDetail.\n',
      commit: true,
    })
    editMemory({
      memoryRoot,
      projectSlug,
      path: 'reference/sub/a.md',
      expectedHash: subFile.hash,
      text: null,
      commit: true,
    })
    const subIdxRead = readMemory(memoryRoot, { path: 'reference/sub/index.md' }) as {
      hash: string
    }
    const subIdxDel = editMemory({
      memoryRoot,
      projectSlug,
      path: 'reference/sub/index.md',
      expectedHash: subIdxRead.hash,
      text: null,
      commit: true,
    })
    assert.equal(subIdxDel.committed, true)
    const docAfterSubIdx = manageMemory({
      memoryRoot,
      workspacePath: workspace,
      projectSlug,
      action: 'doctor',
    }) as { healthy: boolean; brokenLinksTotal: number }
    assert.equal(docAfterSubIdx.healthy, true)
    assert.equal(docAfterSubIdx.brokenLinksTotal, 0)

    // 4. Leading "/" normalization works on /Core.md while /etc/passwd fails closed
    const coreRead = readMemory(memoryRoot, { path: 'Core.md' }) as { hash: string }
    const leadingEdit = editMemory({
      memoryRoot,
      projectSlug,
      path: '/Core.md',
      expectedHash: coreRead.hash,
      text: '- Leading slash normalized cleanly',
      mode: 'append',
      commit: false,
    })
    assert.equal(leadingEdit.path, 'Core.md')
    assert.throws(
      () =>
        editMemory({
          memoryRoot,
          projectSlug,
          path: '/etc/passwd',
          expectedHash: null,
          text: 'nope',
        }),
      /Memory path must be relative/,
    )
    assert.throws(
      () =>
        editMemory({
          memoryRoot,
          projectSlug,
          path: 'unauthorized/foo.md',
          expectedHash: null,
          text: 'nope',
        }),
      (err: unknown) => err instanceof MemorySchemaError && err.code === 'INVALID_PATH',
    )
    manageMemory({ memoryRoot, workspacePath: workspace, projectSlug, action: 'cleanup' })

    // 5. remember() stays isolated from unrelated uncommitted draft
    const openDraft = editMemory({
      memoryRoot,
      projectSlug,
      path: 'reference/unrelated-draft.md',
      expectedHash: null,
      text: '---\ndescription: Staged unrelated draft\n---\n# Unrelated\nHold.\n',
      commit: false,
    })
    const remRes = manageMemory({
      memoryRoot,
      workspacePath: workspace,
      projectSlug,
      action: 'remember',
      text: 'Isolated remember bullet',
      path: 'system/human/prefs/isolated.md',
    }) as { committed: boolean; changedPaths: string[] }
    assert.equal(remRes.committed, true)
    assert.ok(!remRes.changedPaths.includes('reference/unrelated-draft.md'))
    const draftsAfterRem = listMemoryDrafts(memoryRoot)
    assert.equal(draftsAfterRem.length, 1)
    assert.equal(draftsAfterRem[0]?.id, openDraft.draftId)
    manageMemory({ memoryRoot, workspacePath: workspace, projectSlug, action: 'cleanup' })

    // 6. Mixed-layout conflict repo blocks editMemory(commit: false) with MIXED_LAYOUT_CONFLICT
    const mixedRoot = path.join(tempRoot, 'mixed')
    initGitRepoWithCommits(mixedRoot, {
      'global/human.md': '# Legacy\n',
      'system/persona.md': '---\ndescription: Layered\n---\n# New\n',
    })
    assert.throws(
      () =>
        editMemory({
          memoryRoot: mixedRoot,
          projectSlug,
          path: 'reference/test.md',
          expectedHash: null,
          text: '---\ndescription: Test\n---\n# Test\n',
          commit: false,
        }),
      (err: unknown) => err instanceof MemoryEngineError && err.code === 'MIXED_LAYOUT_CONFLICT',
    )

    // 7. MCP protocol & schema hardening via handleMcpMessage
    for (const badPayload of ['null', '[]', JSON.stringify({ jsonrpc: '2.0', id: 9 })]) {
      const resp = await handleMcpMessage(badPayload, { memoryRoot, workspacePath: workspace })
      assert.equal(resp?.error?.code, -32600)
    }
    const invalidJsonResp = await handleMcpMessage('{bad-json', {
      memoryRoot,
      workspacePath: workspace,
    })
    assert.equal(invalidJsonResp?.error?.code, -32700)

    const extraReadResp = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'agent_memory_read', arguments: { query: 'Core', bogus: 1 } },
      },
      { memoryRoot, workspacePath: workspace },
    )
    const extraReadRes = extraReadResp?.result as {
      isError?: boolean
      content: Array<{ text: string }>
    }
    assert.equal(extraReadRes.isError, true)
    assert.ok(extraReadRes.content[0]?.text.includes('INVALID_ARGUMENTS'))

    const extraEditResp = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'agent_memory_edit',
          arguments: { path: 'Core.md', expectedHash: null, extraField: true },
        },
      },
      { memoryRoot, workspacePath: workspace },
    )
    const extraEditRes = extraEditResp?.result as {
      isError?: boolean
      content: Array<{ text: string }>
    }
    assert.equal(extraEditRes.isError, true)
    assert.ok(extraEditRes.content[0]?.text.includes('INVALID_ARGUMENTS'))

    for (const unsafePath of ['../etc/passwd', '.git/config']) {
      const unsafeResp = await handleMcpMessage(
        {
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/call',
          params: { name: 'agent_memory_read', arguments: { path: unsafePath } },
        },
        { memoryRoot, workspacePath: workspace },
      )
      const unsafeRes = unsafeResp?.result as { isError?: boolean }
      assert.equal(unsafeRes.isError, true)
    }

    // 8. reflectMemory validates op create/edit existence, model flag injection, and cleans up drafts on error
    assert.throws(
      () =>
        reflectMemory({
          memoryRoot,
          projectSlug,
          workspacePath: workspace,
          mode: 'plan',
          model: '--danger-flag',
        }),
      (err: unknown) => err instanceof MemorySchemaError && err.code === 'INVALID_ARGUMENTS',
    )
    assert.throws(
      () =>
        reflectMemory({
          memoryRoot,
          projectSlug,
          workspacePath: workspace,
          mode: 'apply',
          transport: () =>
            JSON.stringify({
              summary: 'Try create on existing Core.md',
              no_changes: false,
              operations: [{ op: 'create', path: 'Core.md', mode: 'replace', text: '# Core\n' }],
            }),
        }),
      (err: unknown) => err instanceof MemorySchemaError && err.code === 'INVALID_ARGUMENTS',
    )
    assert.throws(
      () =>
        reflectMemory({
          memoryRoot,
          projectSlug,
          workspacePath: workspace,
          mode: 'apply',
          transport: () =>
            JSON.stringify({
              summary: 'Try edit on missing file',
              no_changes: false,
              operations: [
                { op: 'edit', path: 'reference/does-not-exist.md', mode: 'replace', text: 'x' },
              ],
            }),
        }),
      (err: unknown) => err instanceof MemorySchemaError && err.code === 'INVALID_ARGUMENTS',
    )
    assert.equal(listMemoryDrafts(memoryRoot).length, 0)

    // 9. exportOfflinePalaceHtml escapes XSS & includes projected shared communication document when enabled
    editMemory({
      memoryRoot,
      projectSlug,
      path: 'reference/xss.md',
      expectedHash: null,
      text: '---\ndescription: </style><script>alert(1)</script>\n---\n# Title\nBody <img src=x onerror=alert(2)> test.\n',
      commit: true,
      message: 'Add </style><script>alert(3)</script>',
    })

    const sharedSource = path.join(tempRoot, 'shared-src')
    initGitRepoWithCommits(sharedSource, {
      'system/human/prefs/communication.md':
        '---\ndescription: Shared communication rule\n---\n# Shared Communication\nSHARED_PALACE_UNIQUE_TOKEN\n',
    })
    const sharedConfigPath = path.join(tempRoot, 'shared-config.json')
    fs.writeFileSync(
      sharedConfigPath,
      JSON.stringify({ enabled: true, sourceRoot: sharedSource }),
      'utf-8',
    )
    process.env.AGY_SHARED_MEMORY_ENABLED = '1'
    process.env.AGY_SHARED_MEMORY_CONFIG = sharedConfigPath
    delete process.env.AGY_SHARED_MEMORY_SOURCE_ROOT

    const offlineOut = path.join(tempRoot, 'palace-hardened.html')
    exportOfflinePalaceHtml({ memoryRoot, projectSlug, outputPath: offlineOut })
    const palaceHtml = fs.readFileSync(offlineOut, 'utf-8')
    assert.ok(!/<script[\s>]/i.test(palaceHtml))
    assert.equal((palaceHtml.match(/<\/style>/gi) ?? []).length, 1)
    assert.ok(palaceHtml.includes('SHARED_PALACE_UNIQUE_TOKEN'))
  } finally {
    if (prevSharedEnabled === undefined) delete process.env.AGY_SHARED_MEMORY_ENABLED
    else process.env.AGY_SHARED_MEMORY_ENABLED = prevSharedEnabled
    if (prevSharedConfig === undefined) delete process.env.AGY_SHARED_MEMORY_CONFIG
    else process.env.AGY_SHARED_MEMORY_CONFIG = prevSharedConfig
    if (prevSharedSource === undefined) delete process.env.AGY_SHARED_MEMORY_SOURCE_ROOT
    else process.env.AGY_SHARED_MEMORY_SOURCE_ROOT = prevSharedSource
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('Hardening Cycle 2: shared communication read/search/patch diversion, policy dash guard, fence-aware section append, MCP strict schema, and v1.24 layered migrate-v2', async () => {
  const tempRoot = createTempDir('agy-hardening-c2-')
  const memoryRoot = path.join(tempRoot, 'memory')
  const sharedSrc = path.join(tempRoot, 'shared-src')
  const workspace = path.join(tempRoot, 'ws')
  fs.mkdirSync(workspace, { recursive: true })
  const projectSlug = resolveProjectSlug(workspace, memoryRoot)

  const prevE = process.env.AGY_SHARED_MEMORY_ENABLED
  const prevC = process.env.AGY_SHARED_MEMORY_CONFIG
  const prevS = process.env.AGY_SHARED_MEMORY_SOURCE_ROOT

  try {
    // 1. Shared communication only in sourceRoot: MCP read + query + list + patch diversion
    initGitRepoWithCommits(sharedSrc, {
      'system/human/prefs/communication.md':
        '---\ndescription: Shared communication rules\n---\n# Communication\n- Always reply in Thai.\n- SHARED_SEARCH_MARKER_99\n',
    })
    const cfgPath = path.join(tempRoot, 'shared.json')
    fs.writeFileSync(cfgPath, JSON.stringify({ enabled: true, sourceRoot: sharedSrc }), 'utf-8')
    process.env.AGY_SHARED_MEMORY_ENABLED = '1'
    process.env.AGY_SHARED_MEMORY_CONFIG = cfgPath
    delete process.env.AGY_SHARED_MEMORY_SOURCE_ROOT

    manageMemory({ memoryRoot, workspacePath: workspace, projectSlug, action: 'init' })

    const mcpReadPath = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'agent_memory_read',
          arguments: { path: 'system/human/prefs/communication.md' },
        },
      },
      { memoryRoot, workspacePath: workspace },
    )
    const readPathPayload = parseMcpToolPayload<{ missing?: boolean; text: string }>(mcpReadPath)
    assert.notEqual(readPathPayload.missing, true)
    assert.ok(readPathPayload.text.includes('SHARED_SEARCH_MARKER_99'))

    const mcpSearch = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'agent_memory_read', arguments: { query: 'SHARED_SEARCH_MARKER_99' } },
      },
      { memoryRoot, workspacePath: workspace },
    )
    const searchPayload = parseMcpToolPayload<{ results: Array<{ path: string }> }>(mcpSearch)
    assert.equal(searchPayload.results[0]?.path, 'system/human/prefs/communication.md')

    const mcpList = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'agent_memory_read', arguments: {} },
      },
      { memoryRoot, workspacePath: workspace },
    )
    const listPayload = parseMcpToolPayload<{ files: Array<{ path: string }> }>(mcpList)
    assert.ok(listPayload.files.some((f) => f.path === 'system/human/prefs/communication.md'))

    const patchDiverted = editMemory({
      memoryRoot,
      projectSlug,
      path: 'system/human/prefs/communication.md',
      expectedHash: null,
      mode: 'patch',
      oldText: '- Always reply in Thai.',
      newText: '- Always reply concisely in Thai.',
    })
    assert.equal(patchDiverted.divertedToSharedProposal, true)
    assert.ok(patchDiverted.proposalId)

    delete process.env.AGY_SHARED_MEMORY_ENABLED
    delete process.env.AGY_SHARED_MEMORY_CONFIG

    // 2. Policy rejects leading-dash model identifiers
    assert.throws(
      () =>
        manageMemory({
          memoryRoot,
          workspacePath: workspace,
          projectSlug,
          action: 'policy',
          model: '--evil-flag',
        }),
      /leading dashes/i,
    )

    // 3. applySurgicalEdit skips fenced code block headings
    const fencedDoc =
      '# Guide\n\n```markdown\n## Rules\nExample only\n```\n\n## Rules\n- Real rule 1\n'
    const appendedSection = applySurgicalEdit(fencedDoc, '- Real rule 2', {
      mode: 'append',
      section: 'Rules',
    })
    assert.ok(!appendedSection?.includes('Example only\n- Real rule 2'))
    assert.ok(appendedSection?.includes('- Real rule 1\n- Real rule 2'))

    // 4. MCP strict JSON Schema validation fails closed
    const badCalls = [
      { name: 'agent_memory_manage', arguments: { action: 'policy', trigger: 'always' } },
      { name: 'agent_memory_read', arguments: { includeDraft: 'false' } },
      {
        name: 'agent_memory_edit',
        arguments: { path: 'Core.md', expectedHash: null, commit: 'true' },
      },
      {
        name: 'agent_memory_edit',
        arguments: { path: 'Core.md', expectedHash: null, mode: 'bogus' },
      },
      { name: 'agent_memory_manage', arguments: { action: 'policy', stepCountThreshold: 0 } },
      { name: 'agent_memory_read', arguments: { query: 'Core', limit: 0 } },
    ]
    for (let i = 0; i < badCalls.length; i++) {
      const resp = await handleMcpMessage(
        { jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: badCalls[i] },
        { memoryRoot, workspacePath: workspace },
      )
      const resObj = resp?.result as { isError?: boolean; content: Array<{ text: string }> }
      assert.equal(resObj.isError, true, `Expected strict schema error for case ${i}`)
      assert.ok(resObj.content[0]?.text.includes('INVALID_ARGUMENTS'))
    }

    // 5. migrate-v2 on v1.24.0 already-layered repo (without Core.md/index.md) preserves files and passes health checks
    const layeredV124 = path.join(tempRoot, 'layered-v124')
    initGitRepoWithCommits(layeredV124, {
      'system/persona.md': '---\ndescription: Persona\n---\n# Persona\nPragmatic.\n',
      'system/human/identity.md': '---\ndescription: Identity\n---\n# Identity\nMahiro.\n',
      'system/human/prefs/coding.md': '---\ndescription: Coding\n---\n# Coding\nUse pnpm -E.\n',
      [`projects/${projectSlug}/system/overview.md`]:
        '---\ndescription: Overview\n---\n# Overview\nRepo.\n',
      [`projects/${projectSlug}/system/conventions.md`]:
        '---\ndescription: Conventions\n---\n# Conventions\nNo interfaces.\n',
      [`projects/${projectSlug}/reference/notes.md`]:
        '---\ndescription: Notes\n---\n# Notes\nDeep detail.\n',
    })
    const dryMig = manageMemory({
      memoryRoot: layeredV124,
      workspacePath: workspace,
      projectSlug,
      action: 'migrate-v2',
      dryRun: true,
    }) as { status: string }
    assert.equal(dryMig.status, 'DRY_RUN')

    const appMig = manageMemory({
      memoryRoot: layeredV124,
      workspacePath: workspace,
      projectSlug,
      action: 'migrate-v2',
      dryRun: false,
    }) as { status: string }
    assert.equal(appMig.status, 'MIGRATED_V2')

    const docMig = manageMemory({
      memoryRoot: layeredV124,
      workspacePath: workspace,
      projectSlug,
      action: 'doctor',
    }) as { healthy: boolean }
    assert.equal(docMig.healthy, true)

    const healthMig = inspectMemoryHealth(layeredV124, [workspace])
    assert.equal(healthMig.healthy, true)

    // 6. Scoped history redacts diff on commits touching out-of-scope projects + truncates >8KB diff + symlink escape fails closed
    const largeBody =
      '---\ndescription: Large spec\n---\n' +
      'Detailed architectural line for 8KiB diff truncation regression testing.\n'.repeat(150)
    editMemory({
      memoryRoot,
      projectSlug,
      path: 'reference/large-spec.md',
      expectedHash: null,
      text: largeBody,
      commit: true,
      message: 'Add large spec',
    })
    editMemory({
      memoryRoot,
      projectSlug: 'other-secret',
      path: 'projects/other-secret/system/overview.md',
      expectedHash: null,
      text: '---\ndescription: Other project secret\n---\n# Secret\nTOP_SECRET_OTHER_PROJECT\n',
      commit: true,
      message: 'Other project update',
    })
    const scopedPage = readScopedMemoryHistory({
      memoryRoot,
      projectSlug,
      offset: 0,
      limit: 2,
    })
    assert.equal(scopedPage.nextOffset, 2)
    assert.equal(scopedPage.entries[0]?.subject, 'Out-of-scope project update')
    assert.equal(scopedPage.entries[0]?.diff, undefined)
    assert.equal(scopedPage.entries[1]?.diffTruncated, true)

    const escapeLink = path.join(memoryRoot, 'reference', 'symlink-escape.md')
    fs.symlinkSync('/etc/hosts', escapeLink)
    try {
      assert.throws(() =>
        editMemory({
          memoryRoot,
          projectSlug,
          path: 'reference/symlink-escape.md',
          expectedHash: null,
          text: '---\ndescription: Escape\n---\n# Escape\n',
          commit: true,
        }),
      )
    } finally {
      if (fs.lstatSync(escapeLink).isSymbolicLink()) fs.unlinkSync(escapeLink)
    }
  } finally {
    if (prevE === undefined) delete process.env.AGY_SHARED_MEMORY_ENABLED
    else process.env.AGY_SHARED_MEMORY_ENABLED = prevE
    if (prevC === undefined) delete process.env.AGY_SHARED_MEMORY_CONFIG
    else process.env.AGY_SHARED_MEMORY_CONFIG = prevC
    if (prevS === undefined) delete process.env.AGY_SHARED_MEMORY_SOURCE_ROOT
    else process.env.AGY_SHARED_MEMORY_SOURCE_ROOT = prevS
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('Palace mahiro-pi parity: learnings external classification, per-file lastCommit, legacy/conflict handling, palace-server default switch, and compact multi-project migrate-v2', () => {
  const tempRoot = createTempDir('agy-palace-parity-')
  const tempHome = path.join(tempRoot, 'home')
  const wsAlpha = path.join(tempRoot, 'alpha-ws')
  const memoryRoot = path.join(tempRoot, 'memory')
  fs.mkdirSync(tempHome, { recursive: true })
  fs.mkdirSync(wsAlpha, { recursive: true })
  const slugA = resolveProjectSlug(wsAlpha, memoryRoot)
  const slugB = 'beta-isolated'

  try {
    // 1. Palace layer classification for learnings/
    assert.equal(palaceLayerFor(`projects/${slugA}/learnings/note.md`), 'projectReference')
    assert.equal(palaceLayerFor(`projects/${slugA}/reference/deep.md`), 'projectReference')

    // 2. Per-file lastCommit preserved even when latest HEAD touches another project, learnings go to External, h4 renders, standalone omits fake system ~8,200 tok
    initGitRepoWithCommits(memoryRoot, {
      'Core.md': '---\nname: core\ndescription: Core summary\n---\n# Core\nMain core.\n',
      'index.md': '---\nname: index\ndescription: Root index\n---\n# Index\n',
      'system/persona.md': '---\nname: persona\ndescription: Persona\n---\n# Persona\nSteady.\n',
    })
    commitAdditionalFiles(
      memoryRoot,
      {
        [`projects/${slugA}/system/overview.md`]:
          '---\ndescription: Alpha overview\n---\n#### Subsection H4\nAlpha body.\n',
        [`projects/${slugA}/learnings/lesson-one.md`]: '# Lesson One\nLearned detail.\n',
      },
      'Alpha overview and learning commit',
    )
    const alphaOverviewCommit = execFileSync(
      'git',
      ['-C', memoryRoot, 'log', '-1', '--format=%H', '--', `projects/${slugA}/system/overview.md`],
      { encoding: 'utf-8' },
    ).trim()
    commitAdditionalFiles(
      memoryRoot,
      {
        [`projects/${slugB}/system/overview.md`]:
          '---\ndescription: Beta overview\n---\nBETA_ONLY_BODY\n',
      },
      'Beta secret commit message',
    )

    const palaceOut = path.join(tempRoot, 'custom-palace.html')
    const exported = exportOfflinePalaceHtml({
      memoryRoot,
      projectSlug: slugA,
      outputPath: palaceOut,
    })
    const html = fs.readFileSync(palaceOut, 'utf-8')
    assert.equal(exported.externalCount, 1)
    assert.ok(html.includes('<h4>Subsection H4</h4>'))
    assert.ok(!html.includes('class="ctx-legend-item" data-legend="system"'))
    assert.ok(html.includes('data-palace-folder="projects'))
    assert.ok(!html.includes('BETA_ONLY_BODY'))
    assert.ok(!html.includes('Beta secret commit message'))
    assert.ok(html.includes('Out-of-scope project update'))

    // Learning note is placed inside external view, not core view
    const extSectionStart = html.indexOf('class="view view-external"')
    const coreSectionStart = html.indexOf('class="view view-core"')
    const coreSlice = html.slice(coreSectionStart, extSectionStart)
    const extSlice = html.slice(extSectionStart)
    assert.ok(!coreSlice.includes(`projects/${slugA}/learnings/lesson-one.md`))
    assert.ok(extSlice.includes(`projects/${slugA}/learnings/lesson-one.md`))

    // Alpha overview card uses its own commit hash & subject, not Beta's Out-of-scope message
    const overviewArticleIdx = html.indexOf(`aria-label="projects/${slugA}/system/overview.md"`)
    assert.notEqual(overviewArticleIdx, -1)
    const overviewHeader = html.slice(overviewArticleIdx, overviewArticleIdx + 400)
    assert.ok(overviewHeader.includes(alphaOverviewCommit.slice(0, 7)))
    assert.ok(overviewHeader.includes('Alpha overview and learning commit'))
    assert.ok(!overviewHeader.includes('Out-of-scope project update'))

    // 3. Legacy flat layout offline Palace export
    const legacyMemoryRoot = path.join(tempRoot, 'legacy-palace')
    initGitRepoWithCommits(legacyMemoryRoot, {
      'global/human.md': '# Human\nALPHA_LEGACY_HUMAN\n',
      'global/persona.md': '# Persona\nALPHA_LEGACY_PERSONA\n',
      [`projects/${slugA}/project.md`]: '# Alpha Project\nALPHA_LEGACY_PROJECT\n',
      [`projects/${slugA}/rules.md`]: '# Alpha Rules\nALPHA_LEGACY_RULES\n',
      [`projects/${slugB}/project.md`]: '# Beta Project\nBETA_LEGACY_SECRET\n',
    })
    const legacyPalacePath = path.join(tempRoot, 'legacy-flat-palace.html')
    const legacyExport = exportOfflinePalaceHtml({
      memoryRoot: legacyMemoryRoot,
      projectSlug: slugA,
      outputPath: legacyPalacePath,
    })
    assert.equal(legacyExport.coreCount, 4)
    assert.equal(legacyExport.externalCount, 0)
    const legacyHtml = fs.readFileSync(legacyPalacePath, 'utf-8')
    assert.ok(legacyHtml.includes('ALPHA_LEGACY_HUMAN'))
    assert.ok(legacyHtml.includes('ALPHA_LEGACY_RULES'))
    assert.ok(!legacyHtml.includes('BETA_LEGACY_SECRET'))

    // 4. Mixed layout fail-closed in exportOfflinePalaceHtml
    const mixedRoot = path.join(tempRoot, 'mixed-palace')
    initGitRepoWithCommits(mixedRoot, {
      'global/human.md': '# Human\nLegacy owner.\n',
      'system/persona.md': '---\ndescription: Persona\n---\n# Persona\nLayered owner.\n',
    })
    assert.throws(
      () => exportOfflinePalaceHtml({ memoryRoot: mixedRoot, projectSlug: slugA }),
      /refuses mixed legacy\/layered ownership/,
    )

    // 5. palace-server.sh default runs palace-render.ts (0600 private path) & --legacy runs palace-generator.ts
    const palaceServerSh = path.resolve(
      process.cwd(),
      'plugins/agy-memory-layer/scripts/palace-server.sh',
    )
    const defaultOutJson = execFileSync('bash', [palaceServerSh, wsAlpha], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: tempHome, AGY_MEMORY_DIR: memoryRoot },
      timeout: 15_000,
    }).trim()
    const defaultExport = JSON.parse(defaultOutJson) as { filePath: string; projectSlug: string }
    const expectedViewerPath = path.join(`${memoryRoot}.state`, 'viewers', `palace-${slugA}.html`)
    assert.equal(defaultExport.filePath, expectedViewerPath)
    assert.equal(fs.statSync(expectedViewerPath).mode & 0o777, 0o600)
    const defaultHtml = fs.readFileSync(expectedViewerPath, 'utf-8')
    assert.ok(!/<script[\s>]/i.test(defaultHtml))
    assert.ok(defaultHtml.includes('view-context'))

    const legacyOutPath = path.join(tempRoot, 'legacy-server-out.html')
    execFileSync('bash', [palaceServerSh, wsAlpha, '--legacy', legacyOutPath], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: tempHome, AGY_MEMORY_DIR: memoryRoot },
      timeout: 15_000,
    })
    const legacyServerHtml = fs.readFileSync(legacyOutPath, 'utf-8')
    assert.ok(legacyServerHtml.includes('const CORE_FILES = '))

    // 6. Multi-project migrateMemoryToV2 with unfrontmattered learnings/*.md produces compact Core.md & index.md + healthy doctor & health check
    const multiRoot = path.join(tempRoot, 'multi-layered')
    initGitRepoWithCommits(multiRoot, {
      'system/persona.md':
        '---\ndescription: Persistent identity.\n---\n# Agy Companion\n\n- Evidence-first pair programmer.\n',
      'system/human/identity.md':
        '---\ndescription: Collaborator identity.\n---\n# Mahiro\n\nMahiro architect identity for testing.\n',
      'system/human/prefs/coding.md':
        '---\ndescription: Coding defaults.\n---\n# Coding\nUse pnpm -E.\n',
      'reference/human/workflow-nuances.md':
        '---\ndescription: Workflow nuances.\n---\n# Nuances\nDetails.\n',
      [`projects/${slugA}/system/overview.md`]:
        '---\ndescription: Alpha overview.\n---\n# Alpha\nArchitecture.\n',
      [`projects/${slugA}/system/conventions.md`]:
        '---\ndescription: Alpha conventions.\n---\n# Conventions\nStrict.\n',
      [`projects/${slugA}/reference/deep-dive.md`]:
        '---\ndescription: Alpha reference.\n---\n# Deep Dive\nNotes.\n',
      [`projects/${slugA}/learnings/no-frontmatter.md`]: '# Old Learning\nLegacy learning text.\n',
      [`projects/${slugB}/system/overview.md`]:
        '---\ndescription: Beta overview.\n---\n# Beta\nArchitecture.\n',
      [`projects/${slugB}/system/conventions.md`]:
        '---\ndescription: Beta conventions.\n---\n# Conventions\nRules.\n',
      [`projects/${slugB}/learnings/beta-learning.md`]: '# Beta Learning\nBeta text.\n',
    })

    const migDry = migrateMemoryToV2({
      memoryRoot: multiRoot,
      projectSlug: slugA,
      dryRun: true,
    }) as {
      status: string
      removals: string[]
    }
    assert.equal(migDry.status, 'DRY_RUN')
    assert.deepEqual(migDry.removals, [])

    const migApplied = migrateMemoryToV2({
      memoryRoot: multiRoot,
      projectSlug: slugA,
      dryRun: false,
    }) as { status: string; removals: string[] }
    assert.equal(migApplied.status, 'MIGRATED_V2')
    assert.deepEqual(migApplied.removals, [])

    const migratedCore = fs.readFileSync(path.join(multiRoot, 'Core.md'), 'utf-8')
    const migratedIndex = fs.readFileSync(path.join(multiRoot, 'index.md'), 'utf-8')
    assert.ok(migratedCore.includes('Mahiro architect identity for testing.'))
    assert.ok(migratedCore.includes('description:'))
    assert.ok(Buffer.byteLength(migratedIndex, 'utf-8') < 4096)
    assert.ok(migratedIndex.includes('## System'))
    assert.ok(migratedIndex.includes('## Projects'))
    assert.ok(migratedIndex.includes(`[[projects/${slugA}/system/index.md]]`))
    assert.ok(migratedIndex.includes(`[[projects/${slugA}/reference/index.md]]`))
    assert.ok(migratedIndex.includes(`[[projects/${slugA}/learnings/index.md]]`))
    assert.ok(!migratedIndex.includes(`[[projects/${slugA}/reference/deep-dive.md]]`))

    const subIndex = fs.readFileSync(
      path.join(multiRoot, `projects/${slugA}/reference/index.md`),
      'utf-8',
    )
    assert.ok(subIndex.startsWith('---\ndescription:'))

    const docRes = manageMemory({
      memoryRoot: multiRoot,
      workspacePath: wsAlpha,
      projectSlug: slugA,
      action: 'doctor',
    }) as { healthy: boolean; orphanFiles: string[]; missingDirectoryIndexes: string[] }
    assert.equal(docRes.healthy, true)
    assert.deepEqual(docRes.orphanFiles, [])
    assert.deepEqual(docRes.missingDirectoryIndexes, [])

    const healthRes = inspectMemoryHealth(multiRoot, [wsAlpha])
    assert.equal(healthRes.healthy, true)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
