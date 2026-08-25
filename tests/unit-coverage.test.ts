import * as assert from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { TEST_ENVIRONMENT, TEST_MEMORY_ROOT, TEST_TEMP_ROOT } from './test-environment.ts'

const ROOT_DIR = path.resolve(import.meta.dirname, '..')
const PLUGIN_DIR = path.join(ROOT_DIR, 'plugins', 'agy-memory-layer')
const SCRIPTS_DIR = path.join(PLUGIN_DIR, 'scripts')
const MEMORY_ROOT = TEST_MEMORY_ROOT

const { initProjectMemory, scanCodebase } = await import(
  path.join(SCRIPTS_DIR, 'init-project-memory.ts')
)
const { searchMemory } = await import(path.join(SCRIPTS_DIR, 'memory-search.ts'))
const { runCli } = await import(path.join(ROOT_DIR, 'tools', 'memory-backup.ts'))
const { inspectMemoryHealth } = await import(path.join(ROOT_DIR, 'tools', 'memory-health.ts'))
const { PERSONA_PRESETS, getActivePersona, switchPersona } = await import(
  path.join(SCRIPTS_DIR, 'switch-persona.ts')
)
const { cosineSimilarity, buildVectorProfile, scanAllConversations, searchRecall } = await import(
  path.join(SCRIPTS_DIR, 'recall-engine.ts')
)
const {
  extractExplicitDurableLessons,
  getDreamedConversationIds,
  runAutoDream,
  scanPendingConversations,
  synthesizeConversationLearning,
  printStatus,
} = await import(path.join(SCRIPTS_DIR, 'dream-daemon.ts'))
const { generatePreInvocationContext, getRecentLearningsSnippet } = await import(
  path.join(SCRIPTS_DIR, 'hook-inject-memory.ts')
)
const { getWorkingHypothesisPath, inspectCommittedWorkingHypothesis } = await import(
  path.join(SCRIPTS_DIR, 'active-learning.ts')
)
const { getWorkspaceRootSlug, readConversationWorkspaceMap, resolveProjectSlug } = await import(
  path.join(SCRIPTS_DIR, 'workspace-identity.ts')
)
const { listSubagents, getSubagent } = await import(path.join(SCRIPTS_DIR, 'agent-launcher.ts'))
const { createIsolatedWorktree, getWorktreeDiff, cleanupWorktree, listActiveWorktrees } =
  await import(path.join(SCRIPTS_DIR, 'worktree-manager.ts'))
const {
  getApprovalPolicy,
  getApprovalModeForFile,
  saveApprovalPolicy,
  proposeMemoryUpdate,
  listPendingProposals,
  getPendingProposal,
  reviewProposal,
} = await import(path.join(SCRIPTS_DIR, 'memory-approval.ts'))
const { createTsInspector } = await import(path.join(SCRIPTS_DIR, 'ts-inspector.ts'))
const { estimateTokens, compactMarkdownContent, compactProjectMemory, runAutoCompaction } =
  await import(path.join(SCRIPTS_DIR, 'memory-compactor.ts'))
const { scanAndSynthesizeSkills, generateDraftSkill } = await import(
  path.join(SCRIPTS_DIR, 'skill-synthesizer.ts')
)
const { findCrossProjectSynapses, formatSynapseNotice } = await import(
  path.join(SCRIPTS_DIR, 'cross-project-synapse.ts')
)
const { syncLettaMemory, normalizeLettaProjectSlug, findPrimaryLettaAgent } = await import(
  path.join(SCRIPTS_DIR, 'letta-sync.ts')
)
const {
  commitMemoryPaths,
  getMemoryRepositoryStatus,
  readCommittedMemoryFile,
  resolveMemoryPath,
  validateProjectSlug,
  writeMemoryFile,
} = await import(path.join(SCRIPTS_DIR, 'memory-repository.ts'))

describe('Unit Coverage Extensions', () => {
  it('tests init-project-memory with Rust, Go, Python, and Docker manifests', () => {
    const tempDir = path.join(TEST_TEMP_ROOT, 'test-multi-stack-project')
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), '[package]\nname = "rust-app"')
    fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module mygoapp\ngo 1.22')
    fs.writeFileSync(path.join(tempDir, 'pyproject.toml'), '[project]\nname = "py-app"')
    fs.writeFileSync(path.join(tempDir, 'wrangler.jsonc'), '{"name": "worker"}')
    fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), 'version: "3"')
    fs.writeFileSync(path.join(tempDir, 'src', 'main.rs'), 'fn main() {}')
    fs.writeFileSync(path.join(tempDir, 'main.go'), 'package main')
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Multi Stack App')

    const scanned = scanCodebase(tempDir)
    assert.strictEqual(scanned.languages.has('Rust'), true)
    assert.strictEqual(scanned.languages.has('Go'), true)
    assert.strictEqual(scanned.languages.has('Python'), true)
    assert.strictEqual(scanned.frameworks.has('Cloudflare Workers'), true)
    assert.strictEqual(scanned.frameworks.has('Docker'), true)

    assert.throws(() => initProjectMemory(tempDir, { force: true }), /requires --confirm-init/)
    const res1 = initProjectMemory(tempDir, { force: true, confirmed: true })
    assert.strictEqual(res1.status, 'INITIALIZED')

    // Test ALREADY_INITIALIZED branch
    const res2 = initProjectMemory(tempDir, { force: false, confirmed: true })
    assert.strictEqual(res2.status, 'ALREADY_INITIALIZED')

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(path.join(MEMORY_ROOT, 'projects', 'test-multi-stack-project'), {
      recursive: true,
      force: true,
    })
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [
        'projects/test-multi-stack-project/project.md',
        'projects/test-multi-stack-project/rules.md',
      ],
      reason: 'test: remove initialized project memory',
    })
  })

  it('tests memory-search error and edge cases', () => {
    assert.throws(() => searchMemory(''), /Search query must not be empty/)
    const nonExistent = searchMemory('supercalifragilistic_nonexistent_term_xyz_12345')
    assert.strictEqual(nonExistent.length, 0)
  })

  it('tests memory-backup CLI runner functions directly', () => {
    const trackedTmpPath = path.join(MEMORY_ROOT, 'global', 'tracked-test-evidence.tmp')
    fs.writeFileSync(trackedTmpPath, 'tracked transient evidence')

    // Test help command
    let helpOutput = ''
    const origLog = console.log
    console.log = (msg: string) => {
      helpOutput += `${msg}\n`
    }
    try {
      runCli(['help'])
    } finally {
      console.log = origLog
    }
    assert.strictEqual(helpOutput.includes('MemFS Backup & Restore Utility'), true)

    // Test export command CLI
    const tempBundle = path.join(TEST_TEMP_ROOT, 'test-cli-bundle.json')
    runCli(['export', '-o', tempBundle, '--json'])
    assert.strictEqual(fs.existsSync(tempBundle), true)
    const bundle = JSON.parse(fs.readFileSync(tempBundle, 'utf-8'))
    assert.strictEqual(
      bundle.manifest.files.some(
        (entry: { relativePath: string }) =>
          entry.relativePath === 'global/tracked-test-evidence.tmp',
      ),
      true,
    )

    // Test verify command CLI
    runCli(['verify', '-i', tempBundle, '--json'])

    // Test import command CLI (dry run)
    runCli(['import', '-i', tempBundle, '--dry-run', '--json'])

    // Exercise human-readable output in-process so aggregate coverage does not
    // depend on whether Node collects the spawned integration fixture's report.
    let detailOutput = ''
    console.log = (...messages: unknown[]) => {
      detailOutput += `${messages.join(' ')}\n`
    }
    try {
      runCli(['export', '-o', tempBundle])
      runCli(['verify', '-i', tempBundle])
      runCli(['import', '-i', tempBundle, '--dry-run'])
    } finally {
      console.log = origLog
    }
    assert.strictEqual(detailOutput.includes('Memory Blocks Export Complete'), true)
    assert.strictEqual(detailOutput.includes('Memory Bundle Integrity Verification'), true)
    assert.strictEqual(detailOutput.includes('Memory Bundle Import & Restore'), true)

    fs.unlinkSync(tempBundle)
    fs.unlinkSync(trackedTmpPath)
  })

  it('tests switch-persona script functionality and presets', () => {
    assert.strictEqual(typeof PERSONA_PRESETS.memo, 'object')
    assert.strictEqual(typeof PERSONA_PRESETS.linus, 'object')
    assert.strictEqual(typeof PERSONA_PRESETS.tutor, 'object')
    assert.strictEqual(typeof PERSONA_PRESETS.architect, 'object')

    // Test switching persona
    switchPersona('linus')
    let current = getActivePersona()
    assert.strictEqual(current.presetName, 'linus')

    switchPersona('memo')
    current = getActivePersona()
    assert.strictEqual(current.presetName, 'memo')
  })

  it('tests hook-inject-memory budget notice calculation', () => {
    const hookScript = path.join(SCRIPTS_DIR, 'hook-inject-memory.sh')
    const res = spawnSync('bash', [hookScript], {
      input: JSON.stringify({ workspacePaths: [ROOT_DIR] }),
      encoding: 'utf-8',
    })
    assert.strictEqual(res.status, 0)
    const parsed = JSON.parse(res.stdout)
    assert.strictEqual(Array.isArray(parsed.injectSteps), true)
    assert.strictEqual(parsed.injectSteps.length > 0, true)
    assert.strictEqual(parsed.injectSteps[0].ephemeralMessage.includes('MemFS Active Memory'), true)

    for (const malformedInput of ['{"workspacePaths":', 'null', '{"workspacePaths":"bad"}']) {
      const malformedResult = spawnSync('bash', [hookScript], {
        input: malformedInput,
        encoding: 'utf-8',
      })
      assert.strictEqual(malformedResult.status, 0)
      assert.deepStrictEqual(JSON.parse(malformedResult.stdout), { injectSteps: [] })
    }
  })

  it('resolves nested workspaces to one Git-root project identity', () => {
    const workspaceRoot = path.join(TEST_TEMP_ROOT, 'workspace-identity-root')
    const nestedWorkspace = path.join(workspaceRoot, 'apps', 'web')
    const projectPath = path.join(MEMORY_ROOT, 'projects', 'workspace-identity-root', 'project.md')
    fs.mkdirSync(nestedWorkspace, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: workspaceRoot })
    fs.mkdirSync(path.dirname(projectPath), { recursive: true })
    fs.writeFileSync(projectPath, '# Workspace Identity Root\n')
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: ['projects/workspace-identity-root/project.md'],
      reason: 'test: seed workspace identity fixture',
    })

    assert.strictEqual(getWorkspaceRootSlug(nestedWorkspace), 'workspace-identity-root')
    assert.strictEqual(resolveProjectSlug(nestedWorkspace, MEMORY_ROOT), 'workspace-identity-root')

    const nestedScopePath = path.join(MEMORY_ROOT, 'projects', 'web', 'project.md')
    fs.mkdirSync(path.dirname(nestedScopePath), { recursive: true })
    fs.writeFileSync(nestedScopePath, '# Explicit Nested Workspace\n')
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: ['projects/web/project.md'],
      reason: 'test: seed explicit nested workspace identity',
    })
    assert.strictEqual(resolveProjectSlug(nestedWorkspace, MEMORY_ROOT), 'web')

    const historyFile = path.join(TEST_TEMP_ROOT, 'workspace-history.jsonl')
    fs.writeFileSync(
      historyFile,
      [
        JSON.stringify({
          conversationId: 'conv-identity',
          timestamp: 1,
          workspace: workspaceRoot,
        }),
        JSON.stringify({
          conversationId: 'conv-identity',
          timestamp: 2,
          workspace: nestedWorkspace,
        }),
        '{invalid-json',
      ].join('\n'),
    )
    assert.strictEqual(
      readConversationWorkspaceMap(historyFile).get('conv-identity'),
      nestedWorkspace,
    )

    fs.rmSync(path.join(MEMORY_ROOT, 'projects', 'workspace-identity-root'), {
      recursive: true,
      force: true,
    })
    fs.rmSync(path.join(MEMORY_ROOT, 'projects', 'web'), { recursive: true, force: true })
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: ['projects/workspace-identity-root/project.md', 'projects/web/project.md'],
      reason: 'test: remove workspace identity fixture',
    })
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
    fs.unlinkSync(historyFile)
  })

  it('injects only one canonical committed working hypothesis and fails closed on conflict', () => {
    const slug = 'learning-filter'
    const projectDir = path.join(MEMORY_ROOT, 'projects', slug)
    const learningDir = path.join(projectDir, 'learnings')
    fs.mkdirSync(learningDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'project.md'), '# Learning Filter\n')
    fs.writeFileSync(path.join(projectDir, 'rules.md'), '# Rules\n- Keep hypotheses scoped.\n')
    fs.writeFileSync(
      path.join(learningDir, 'working-hypothesis.md'),
      '---\nmemory_status: active\nmemory_kind: working-hypothesis\n---\n# Working Hypothesis\n- Hypothesis: canonical committed evidence is injected.\n- Cheapest check: inspect the generated context.\n',
    )
    fs.writeFileSync(
      path.join(learningDir, 'stray-active.md'),
      '---\nmemory_status: active\nmemory_kind: durable-learning\n---\n- Must not win by lexical order.\n',
    )
    const relativePaths = [
      `projects/${slug}/project.md`,
      `projects/${slug}/rules.md`,
      `projects/${slug}/learnings/working-hypothesis.md`,
      `projects/${slug}/learnings/stray-active.md`,
    ]
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths,
      reason: 'test: seed working hypothesis conflict fixtures',
    })

    const conflict = inspectCommittedWorkingHypothesis(slug, MEMORY_ROOT)
    assert.strictEqual(conflict.state, 'conflict')
    assert.strictEqual(
      conflict.diagnostics.some((item: string) => item.includes('stray-active')),
      true,
    )
    const conflictHealth = inspectMemoryHealth(MEMORY_ROOT, [path.join(TEST_TEMP_ROOT, slug)])
    assert.strictEqual(conflictHealth.healthy, false)
    assert.strictEqual(
      conflictHealth.issues.some((issue: string) => issue.includes('Working hypothesis conflict')),
      true,
    )

    const conflictedContext = generatePreInvocationContext(
      JSON.stringify({ workspacePaths: [path.join(TEST_TEMP_ROOT, slug)] }),
    )
    const conflictedMessage = conflictedContext.injectSteps[0]?.ephemeralMessage || ''
    assert.strictEqual(conflictedMessage.includes('Working Hypothesis Conflict'), true)
    assert.strictEqual(
      conflictedMessage.includes('canonical committed evidence is injected'),
      false,
    )

    fs.unlinkSync(path.join(learningDir, 'stray-active.md'))
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [`projects/${slug}/learnings/stray-active.md`],
      reason: 'test: remove stray active learning',
    })

    fs.writeFileSync(
      path.join(learningDir, 'legacy-example.md'),
      '# Historical Example\nmemory_status: active\nThis body example is not frontmatter.\n',
    )
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [`projects/${slug}/learnings/legacy-example.md`],
      reason: 'test: seed non-metadata active marker example',
    })

    const selected = inspectCommittedWorkingHypothesis(slug, MEMORY_ROOT)
    assert.strictEqual(selected.state, 'selected')
    assert.strictEqual(selected.selectedPath, getWorkingHypothesisPath(slug))
    const snippet = getRecentLearningsSnippet(slug, MEMORY_ROOT, 1)
    assert.strictEqual(snippet.includes('canonical committed evidence is injected'), true)

    fs.writeFileSync(
      path.join(learningDir, 'working-hypothesis.md'),
      '---\nmemory_status: active\nmemory_kind: working-hypothesis\n---\n- UNCOMMITTED_HYPOTHESIS_SENTINEL\n',
    )
    const dirtyContext = generatePreInvocationContext(
      JSON.stringify({ workspacePaths: [path.join(TEST_TEMP_ROOT, slug)] }),
    )
    const dirtyMessage = dirtyContext.injectSteps[0]?.ephemeralMessage || ''
    assert.strictEqual(dirtyMessage.includes('UNCOMMITTED_HYPOTHESIS_SENTINEL'), false)
    assert.strictEqual(dirtyMessage.includes('canonical committed evidence is injected'), true)
    assert.strictEqual(dirtyMessage.includes('Uncommitted memory is not active'), true)

    fs.writeFileSync(
      path.join(learningDir, 'working-hypothesis.md'),
      '---\nmemory_status: active\nmemory_status: active\nmemory_kind: working-hypothesis\n---\n- Duplicate metadata must fail closed.\n',
    )
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [`projects/${slug}/learnings/working-hypothesis.md`],
      reason: 'test: seed malformed working hypothesis metadata',
    })
    const malformed = inspectCommittedWorkingHypothesis(slug, MEMORY_ROOT)
    assert.strictEqual(malformed.state, 'conflict')
    assert.strictEqual(
      malformed.diagnostics.some((item: string) => item.includes('Duplicate frontmatter key')),
      true,
    )

    fs.rmSync(projectDir, { recursive: true, force: true })
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [
        `projects/${slug}/project.md`,
        `projects/${slug}/rules.md`,
        `projects/${slug}/learnings/working-hypothesis.md`,
        `projects/${slug}/learnings/legacy-example.md`,
      ],
      reason: 'test: remove working hypothesis fixtures',
    })
  })

  it('reports deterministic active-memory health gates', () => {
    const slug = 'health-project'
    const projectDir = path.join(MEMORY_ROOT, 'projects', slug)
    const relativePaths = [`projects/${slug}/project.md`, `projects/${slug}/rules.md`]
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'project.md'), '# Health Project\n- Compact context.\n')
    fs.writeFileSync(path.join(projectDir, 'rules.md'), '# Rules\n- Must stay scoped.\n')
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths,
      reason: 'test: seed health report fixture',
    })

    const workspace = path.join(TEST_TEMP_ROOT, slug)
    const healthy = inspectMemoryHealth(MEMORY_ROOT, [workspace])
    assert.strictEqual(healthy.healthy, true)
    assert.strictEqual(healthy.workspaces[0]?.projectSlug, slug)
    assert.strictEqual(healthy.workspaces[0]?.withinBudget, true)

    const transientPath = path.join(MEMORY_ROOT, 'global', 'tracked-health.tmp')
    fs.writeFileSync(transientPath, 'transient fixture')
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: ['global/tracked-health.tmp'],
      reason: 'test: seed tracked transient fixture',
    })
    const unhealthy = inspectMemoryHealth(MEMORY_ROOT, [workspace])
    assert.strictEqual(unhealthy.healthy, false)
    assert.deepStrictEqual(unhealthy.trackedTransientPaths, ['global/tracked-health.tmp'])

    fs.rmSync(projectDir, { recursive: true, force: true })
    fs.unlinkSync(transientPath)
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [...relativePaths, 'global/tracked-health.tmp'],
      reason: 'test: remove health report fixtures',
    })
  })

  it('keeps the strict active-memory budget healthy at 1,400 and failing above it', () => {
    const slug = 'budget-boundary'
    const projectDir = path.join(MEMORY_ROOT, 'projects', slug)
    const projectPath = path.join(projectDir, 'project.md')
    const rulesPath = path.join(projectDir, 'rules.md')
    const relativePaths = [`projects/${slug}/project.md`, `projects/${slug}/rules.md`]
    const workspace = path.join(TEST_TEMP_ROOT, slug)
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(projectPath, '# Budget Boundary\n')
    fs.writeFileSync(rulesPath, '# Rules\n')
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths,
      reason: 'test: seed budget boundary fixture',
    })

    const baseline = generatePreInvocationContext(JSON.stringify({ workspacePaths: [workspace] }))
      .injectSteps[0]?.ephemeralMessage
    assert.ok(baseline)
    const paddingLength = 1400 * 4 - baseline.length
    assert.strictEqual(paddingLength > 0, true)
    fs.writeFileSync(projectPath, `# Budget Boundary\n${'x'.repeat(paddingLength - 1)}`)
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [`projects/${slug}/project.md`],
      reason: 'test: set exact budget boundary',
    })

    const exact = inspectMemoryHealth(MEMORY_ROOT, [workspace])
    assert.strictEqual(exact.workspaces[0]?.estimatedTokens, 1400)
    assert.strictEqual(exact.workspaces[0]?.withinBudget, true)

    fs.appendFileSync(projectPath, 'x')
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [`projects/${slug}/project.md`],
      reason: 'test: exceed exact budget boundary',
    })
    const over = inspectMemoryHealth(MEMORY_ROOT, [workspace])
    assert.strictEqual(over.workspaces[0]?.estimatedTokens > 1400, true)
    assert.strictEqual(over.workspaces[0]?.withinBudget, false)
    assert.strictEqual(
      generatePreInvocationContext(
        JSON.stringify({ workspacePaths: [workspace] }),
      ).injectSteps[0]?.ephemeralMessage.includes('MemFS Budget Notice'),
      true,
    )

    fs.rmSync(projectDir, { recursive: true, force: true })
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths,
      reason: 'test: remove budget boundary fixture',
    })
  })

  it('re-resolves project memory when one conversation changes workspaces', () => {
    const slugs = ['switch-alpha', 'switch-beta']
    const relativePaths: string[] = []
    for (const slug of slugs) {
      const projectDir = path.join(MEMORY_ROOT, 'projects', slug)
      fs.mkdirSync(projectDir, { recursive: true })
      fs.writeFileSync(path.join(projectDir, 'project.md'), `# ${slug}\n- Marker: ${slug}.\n`)
      fs.writeFileSync(path.join(projectDir, 'rules.md'), '# Rules\n- Must remain isolated.\n')
      relativePaths.push(`projects/${slug}/project.md`, `projects/${slug}/rules.md`)
    }
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths,
      reason: 'test: seed workspace switch fixtures',
    })

    const conversationId = 'same-conversation-workspace-switch'
    const alpha = generatePreInvocationContext(
      JSON.stringify({
        conversationId,
        workspacePaths: [path.join(TEST_TEMP_ROOT, 'switch-alpha')],
      }),
    ).injectSteps[0]?.ephemeralMessage
    const beta = generatePreInvocationContext(
      JSON.stringify({
        conversationId,
        workspacePaths: [path.join(TEST_TEMP_ROOT, 'switch-beta')],
      }),
    ).injectSteps[0]?.ephemeralMessage
    assert.strictEqual(alpha?.includes('Marker: switch-alpha.'), true)
    assert.strictEqual(alpha?.includes('Marker: switch-beta.'), false)
    assert.strictEqual(beta?.includes('Marker: switch-beta.'), true)
    assert.strictEqual(beta?.includes('Marker: switch-alpha.'), false)

    for (const slug of slugs) {
      fs.rmSync(path.join(MEMORY_ROOT, 'projects', slug), { recursive: true, force: true })
    }
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths,
      reason: 'test: remove workspace switch fixtures',
    })
  })

  it('tests committed projection, contained paths, and targeted commits', () => {
    const relativePath = 'global/projection-contract.md'
    writeMemoryFile(MEMORY_ROOT, relativePath, '# Projection\nCommitted v1\n')
    const initialCommit = commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [relativePath],
      reason: 'test: seed committed projection',
    })
    assert.strictEqual(initialCommit.committed, true)

    writeMemoryFile(MEMORY_ROOT, relativePath, '# Projection\nUncommitted v2\n')
    assert.strictEqual(
      readCommittedMemoryFile(MEMORY_ROOT, relativePath)?.includes('Committed v1'),
      true,
    )
    assert.strictEqual(getMemoryRepositoryStatus(MEMORY_ROOT).state, 'dirty')

    const unrelatedPath = path.join(MEMORY_ROOT, 'global', 'unrelated.tmp')
    fs.writeFileSync(unrelatedPath, 'unrelated')
    assert.throws(
      () =>
        commitMemoryPaths({
          memoryRoot: MEMORY_ROOT,
          relativePaths: [relativePath],
          reason: 'test: must reject unrelated dirty paths',
        }),
      /unrelated dirty paths/,
    )
    fs.unlinkSync(unrelatedPath)

    const secondCommit = commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [relativePath],
      reason: 'test: accept targeted projection update',
    })
    assert.strictEqual(secondCommit.committed, true)
    assert.strictEqual(
      readCommittedMemoryFile(MEMORY_ROOT, relativePath)?.includes('Uncommitted v2'),
      true,
    )

    for (const unsafePath of ['../escape.md', '/tmp/escape.md', 'C:\\escape.md', 'a/../b.md']) {
      assert.throws(() => resolveMemoryPath(MEMORY_ROOT, unsafePath))
    }
    assert.throws(() => validateProjectSlug('../escape'))

    const outsideRoot = path.join(TEST_TEMP_ROOT, 'outside-memory-root')
    const escapeLink = path.join(MEMORY_ROOT, 'projects', 'escape-link')
    fs.mkdirSync(outsideRoot, { recursive: true })
    fs.symlinkSync(outsideRoot, escapeLink)
    assert.throws(
      () => resolveMemoryPath(MEMORY_ROOT, 'projects/escape-link/outside.md'),
      /outside configured root/,
    )
    fs.unlinkSync(escapeLink)
    fs.rmSync(outsideRoot, { recursive: true, force: true })

    fs.unlinkSync(path.join(MEMORY_ROOT, relativePath))
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [relativePath],
      reason: 'test: remove projection fixture',
    })
    assert.strictEqual(getMemoryRepositoryStatus(MEMORY_ROOT).state, 'clean')
  })

  it('tests recall-engine search, vector math, and hybrid modes', async () => {
    // Test vectorization & cosine similarity
    const vecA = buildVectorProfile('database migrations schema sqlite')
    const vecB = buildVectorProfile('sqlite database schema migration tool')
    const vecC = buildVectorProfile('unrelated frontend css styling')

    const simHigh = cosineSimilarity(vecA, vecB)
    const simLow = cosineSimilarity(vecA, vecC)

    assert.strictEqual(simHigh > 0.4, true)
    assert.strictEqual(simLow < simHigh, true)

    // Test scan & search
    const convs = scanAllConversations()
    assert.strictEqual(Array.isArray(convs), true)

    const hybridMatches = await searchRecall('palace', { mode: 'hybrid', limit: 3 })
    assert.strictEqual(Array.isArray(hybridMatches), true)

    const semanticMatches = await searchRecall('memory layer', { mode: 'semantic', limit: 3 })
    assert.strictEqual(Array.isArray(semanticMatches), true)

    const keywordMatches = await searchRecall('git', { mode: 'keyword', limit: 3 })
    assert.strictEqual(Array.isArray(keywordMatches), true)

    await assert.rejects(async () => {
      await searchRecall('')
    }, /Search query must not be empty/)

    const recallScript = path.join(SCRIPTS_DIR, 'recall-engine.ts')
    const directQuery = spawnSync(
      process.execPath,
      ['--experimental-strip-types', recallScript, 'palace', 'token'],
      { encoding: 'utf-8' },
    )
    assert.strictEqual(directQuery.status, 0)
    assert.strictEqual(directQuery.stdout.includes('Recall Results'), true)

    const list = spawnSync(process.execPath, ['--experimental-strip-types', recallScript, 'list'], {
      encoding: 'utf-8',
    })
    assert.strictEqual(list.status, 0)
    assert.strictEqual(list.stdout.includes('Recent Antigravity Conversations'), true)
  })

  it('tests dream-daemon scanner, synthesis, and status reporter', () => {
    const pending = scanPendingConversations('learn-letta-code', {
      force: true,
      minSteps: 1,
      idleMinutes: 0,
    })
    assert.strictEqual(Array.isArray(pending), true)

    if (pending.length > 0) {
      const sample = pending[0]
      assert.strictEqual(typeof sample.id, 'string')
      assert.strictEqual(typeof sample.shortId, 'string')

      const doc = synthesizeConversationLearning(sample, 'learn-letta-code')
      assert.strictEqual(doc === null || typeof doc === 'string', true)
    }

    assert.doesNotThrow(() => {
      printStatus('learn-letta-code')
    })
  })

  it('routes Dream by local Agy workspace history and skips non-durable sessions', () => {
    const brainRoot = path.join(TEST_ENVIRONMENT.homeDir, '.gemini', 'antigravity-cli', 'brain')
    const historyFile = path.join(
      TEST_ENVIRONMENT.homeDir,
      '.gemini',
      'antigravity-cli',
      'history.jsonl',
    )
    const alphaWorkspace = path.join(TEST_TEMP_ROOT, 'dream-alpha')
    const betaWorkspace = path.join(TEST_TEMP_ROOT, 'dream-beta')
    const alphaId = '11111111-1111-4111-8111-111111111111'
    const betaId = '22222222-2222-4222-8222-222222222222'
    const writeConversation = (conversationId: string, content: string): string => {
      const logDir = path.join(brainRoot, conversationId, '.system_generated', 'logs')
      fs.mkdirSync(logDir, { recursive: true })
      const logPath = path.join(logDir, 'transcript.jsonl')
      fs.writeFileSync(
        logPath,
        `${JSON.stringify({ type: 'USER_INPUT', content: `<USER_REQUEST>${content}</USER_REQUEST>` })}\n`,
      )
      return logPath
    }

    fs.mkdirSync(path.dirname(historyFile), { recursive: true })
    fs.mkdirSync(alphaWorkspace, { recursive: true })
    fs.mkdirSync(betaWorkspace, { recursive: true })
    const alphaLog = writeConversation(alphaId, 'จำไว้ ครั้งต่อไปต้องใช้ project scope ที่ตรงกัน')
    writeConversation(betaId, 'Inspect this session without creating durable memory.')
    fs.writeFileSync(
      historyFile,
      [
        JSON.stringify({ conversationId: alphaId, timestamp: 1, workspace: alphaWorkspace }),
        JSON.stringify({ conversationId: betaId, timestamp: 2, workspace: betaWorkspace }),
      ].join('\n'),
    )

    const pendingAlpha = scanPendingConversations('dream-alpha', {
      force: true,
      minSteps: 1,
      idleMinutes: 0,
    })
    assert.deepStrictEqual(
      pendingAlpha.map((conversation: { id: string }) => conversation.id),
      [alphaId],
    )
    assert.strictEqual(pendingAlpha[0]?.projectSlug, 'dream-alpha')
    assert.strictEqual(extractExplicitDurableLessons(alphaLog).length, 1)
    const vagueLog = writeConversation(
      '33333333-3333-4333-8333-333333333333',
      'Please remember this.',
    )
    assert.deepStrictEqual(extractExplicitDurableLessons(vagueLog), [])
    const normalizedLog = writeConversation(
      '44444444-4444-4444-8444-444444444444',
      'Please remember this: always use pnpm for this project.',
    )
    assert.deepStrictEqual(extractExplicitDurableLessons(normalizedLog), [
      'always use pnpm for this project.',
    ])
    const doc = synthesizeConversationLearning(pendingAlpha[0], 'dream-alpha')
    assert.strictEqual(doc?.includes('memory_status: archived'), true)
    assert.strictEqual(doc?.includes('memory_kind: correction-evidence'), true)
    assert.strictEqual(doc?.includes('memory_status: active'), false)
    assert.strictEqual(doc?.includes('Session Continuity'), false)

    const dreamResults = runAutoDream('dream-alpha', {
      force: true,
      minSteps: 1,
      idleMinutes: 0,
    })
    assert.strictEqual(dreamResults.length, 1)
    assert.strictEqual(dreamResults[0]?.status, 'written')
    assert.strictEqual(
      dreamResults[0]?.file?.includes(
        path.join('archives', 'projects', 'dream-alpha', 'learnings'),
      ),
      true,
    )
    assert.strictEqual(getDreamedConversationIds('dream-alpha').has(alphaId), true)
    assert.strictEqual(
      fs.existsSync(path.join(MEMORY_ROOT, 'projects', 'dream-alpha', 'learnings')),
      false,
    )

    const pendingBeta = scanPendingConversations('dream-beta', {
      force: true,
      minSteps: 1,
      idleMinutes: 0,
    })
    assert.strictEqual(synthesizeConversationLearning(pendingBeta[0], 'dream-beta'), null)

    fs.rmSync(brainRoot, { recursive: true, force: true })
    fs.rmSync(alphaWorkspace, { recursive: true, force: true })
    fs.rmSync(betaWorkspace, { recursive: true, force: true })
    fs.unlinkSync(historyFile)
    fs.rmSync(path.join(MEMORY_ROOT, 'archives', 'projects', 'dream-alpha'), {
      recursive: true,
      force: true,
    })
    commitMemoryPaths({
      memoryRoot: MEMORY_ROOT,
      relativePaths: [
        `archives/projects/dream-alpha/learnings/${new Date().toISOString().split('T')[0]}_auto_dream_${alphaId.slice(0, 8)}.md`,
      ],
      reason: 'test: remove Dream archive fixture',
    })
  })

  it('tests agent-launcher subagent manifests and prompt resolution', () => {
    const all = listSubagents()
    assert.strictEqual(Array.isArray(all), true)
    assert.strictEqual(all.length >= 7, true)

    const dreamAgent = getSubagent('dream_agent')
    assert.strictEqual(Boolean(dreamAgent), true)
    assert.strictEqual(dreamAgent?.role.includes('Reflection'), true)
    assert.strictEqual(dreamAgent?.systemPrompt.length > 0, true)

    const recallAgent = getSubagent('recall_agent')
    assert.strictEqual(Boolean(recallAgent), true)

    const evidenceReviewer = getSubagent('evidence_reviewer_agent')
    assert.strictEqual(Boolean(evidenceReviewer), true)
    assert.strictEqual(evidenceReviewer?.modelTier, 'flash')
    assert.strictEqual(evidenceReviewer?.enableWriteTools, false)
    assert.strictEqual(evidenceReviewer?.enableSubagentTools, false)
    assert.strictEqual(evidenceReviewer?.systemPrompt.includes('Observed'), true)
    assert.strictEqual(recallAgent?.systemPrompt.length > 0, true)

    const nonExistent = getSubagent('non_existent_random_agent_xyz')
    assert.strictEqual(nonExistent, null)
  })

  it('keeps the Evidence Controller Agy-native, model-routed, and human-gated', () => {
    const skillPath = path.join(PLUGIN_DIR, 'skills', 'evidence-controller', 'SKILL.md')
    const content = fs.readFileSync(skillPath, 'utf-8')
    const requiredContracts = [
      'Observed',
      'Inferred',
      'Unverified',
      '`DIRECT`',
      '`ONE_LANE`',
      '`WRITER_REVIEWER`',
      '`PARALLEL_READONLY`',
      'define_subagent',
      'invoke_subagent',
      'hard delegation triggers',
      'as at least one fresh',
      'evidence_reviewer_agent',
      'stop before retry',
      'Human-owned gates',
      'Repo bootstrap mode',
      'Memory is guidance, not enforcement',
    ]
    for (const contract of requiredContracts) {
      assert.strictEqual(
        content.includes(contract),
        true,
        `Missing controller contract: ${contract}`,
      )
    }
    assert.strictEqual(content.includes('other agent platforms'), true)
    assert.strictEqual(content.includes('one writer per mutable scope'), true)
    assert.strictEqual(content.includes('nested delegation is disabled by default'), true)
  })

  it('tests worktree-manager isolation, diffing, patch apply, and cleanup', () => {
    const testId = `test-wt-${Date.now().toString(36)}`
    const fixtureRepo = path.join(TEST_ENVIRONMENT.homeDir, 'worktree-source')
    fs.mkdirSync(fixtureRepo, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: fixtureRepo })
    execFileSync('git', ['config', 'user.name', 'agy-memory-layer tests'], {
      cwd: fixtureRepo,
    })
    execFileSync('git', ['config', 'user.email', 'tests@example.invalid'], {
      cwd: fixtureRepo,
    })
    fs.writeFileSync(path.join(fixtureRepo, 'README.md'), '# Worktree fixture\n')
    execFileSync('git', ['add', 'README.md'], { cwd: fixtureRepo })
    execFileSync('git', ['commit', '-q', '-m', 'test: seed worktree fixture'], {
      cwd: fixtureRepo,
    })

    const wt = createIsolatedWorktree(fixtureRepo, { subagentId: testId })

    assert.strictEqual(fs.existsSync(wt.worktreePath), true)
    assert.strictEqual(typeof wt.branchName, 'string')

    // Modify a test file inside the isolated worktree
    const tempFileInWt = path.join(wt.worktreePath, 'WORKTREE_TEST_TEMP.md')
    fs.writeFileSync(
      tempFileInWt,
      '# Isolated Subagent Test File\nContent written inside worktree.',
    )

    // Verify diff in worktree
    const diff = getWorktreeDiff(wt.worktreePath)
    assert.strictEqual(diff.hasChanges, true)
    assert.strictEqual(
      diff.files.some((f: string) => f.includes('WORKTREE_TEST_TEMP.md')),
      true,
    )

    // Check listActiveWorktrees
    const activeList = listActiveWorktrees(fixtureRepo)
    assert.strictEqual(
      activeList.some((p: string) => p.includes(testId)),
      true,
    )

    // Clean up worktree
    cleanupWorktree(wt, { deleteBranch: true })
    assert.strictEqual(fs.existsSync(wt.worktreePath), false)
    fs.rmSync(fixtureRepo, { recursive: true, force: true })
  })

  it('tests installer, refresh, uninstall, and confirmed purge in disposable HOME', () => {
    const lifecycleHome = path.join(TEST_TEMP_ROOT, 'lifecycle-home')
    const pluginsDir = path.join(lifecycleHome, '.gemini', 'antigravity-cli', 'plugins')
    const targetLink = path.join(pluginsDir, 'agy-memory-layer')
    const memoryRoot = path.join(lifecycleHome, '.gemini', 'memory')
    const env = {
      ...process.env,
      HOME: lifecycleHome,
      USERPROFILE: lifecycleHome,
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    }
    fs.rmSync(lifecycleHome, { recursive: true, force: true })

    const install = spawnSync(
      '/bin/bash',
      [path.join(ROOT_DIR, 'plugins', 'agy-memory-layer', 'scripts', 'install.sh')],
      { cwd: ROOT_DIR, env, encoding: 'utf-8' },
    )
    assert.strictEqual(install.status, 0, install.stderr)
    assert.strictEqual(fs.lstatSync(targetLink).isSymbolicLink(), true)
    assert.strictEqual(fs.existsSync(path.join(memoryRoot, '.git')), true)
    const configLink = path.join(lifecycleHome, '.gemini', 'config', 'plugins', 'agy-memory-layer')
    assert.strictEqual(fs.lstatSync(configLink).isSymbolicLink(), true)

    const refresh = spawnSync(
      '/bin/bash',
      [path.join(ROOT_DIR, 'plugins', 'agy-memory-layer', 'scripts', 'update.sh')],
      { cwd: ROOT_DIR, env, encoding: 'utf-8' },
    )
    assert.strictEqual(refresh.status, 0, refresh.stderr)

    const uninstallScript = path.join(
      ROOT_DIR,
      'plugins',
      'agy-memory-layer',
      'scripts',
      'uninstall.sh',
    )
    const uninstall = spawnSync('/bin/bash', [uninstallScript], {
      cwd: ROOT_DIR,
      env,
      encoding: 'utf-8',
    })
    assert.strictEqual(uninstall.status, 0, uninstall.stderr)
    assert.strictEqual(fs.existsSync(targetLink), false)
    assert.strictEqual(fs.existsSync(configLink), false)
    assert.strictEqual(fs.existsSync(memoryRoot), true)

    const thirdPartyPlugin = path.join(lifecycleHome, 'third-party-plugin')
    fs.mkdirSync(thirdPartyPlugin, { recursive: true })
    fs.writeFileSync(
      path.join(thirdPartyPlugin, 'plugin.json'),
      JSON.stringify({ name: 'third-party-plugin' }),
    )
    fs.symlinkSync(thirdPartyPlugin, targetLink)
    const refusedThirdPartyRefresh = spawnSync(
      '/bin/bash',
      [path.join(ROOT_DIR, 'plugins', 'agy-memory-layer', 'scripts', 'update.sh')],
      { cwd: ROOT_DIR, env, encoding: 'utf-8' },
    )
    assert.strictEqual(refusedThirdPartyRefresh.status, 1)
    assert.strictEqual(fs.lstatSync(targetLink).isSymbolicLink(), true)
    fs.unlinkSync(targetLink)

    fs.mkdirSync(targetLink, { recursive: true })
    fs.writeFileSync(path.join(targetLink, 'owner-marker'), 'preserve')
    const refusedRefresh = spawnSync(
      '/bin/bash',
      [path.join(ROOT_DIR, 'plugins', 'agy-memory-layer', 'scripts', 'update.sh')],
      { cwd: ROOT_DIR, env, encoding: 'utf-8' },
    )
    assert.strictEqual(refusedRefresh.status, 1)
    assert.strictEqual(fs.existsSync(path.join(targetLink, 'owner-marker')), true)
    fs.rmSync(targetLink, { recursive: true, force: true })

    fs.symlinkSync(path.join(ROOT_DIR, 'plugins', 'agy-memory-layer'), targetLink)
    const refusedPurge = spawnSync('/bin/bash', [uninstallScript, '--purge'], {
      cwd: ROOT_DIR,
      env,
      encoding: 'utf-8',
    })
    assert.strictEqual(refusedPurge.status, 1)
    assert.strictEqual(fs.existsSync(memoryRoot), true)
    assert.strictEqual(fs.lstatSync(targetLink).isSymbolicLink(), true)

    const confirmedPurge = spawnSync('/bin/bash', [uninstallScript, '--purge', '--confirm-purge'], {
      cwd: ROOT_DIR,
      env,
      encoding: 'utf-8',
    })
    assert.strictEqual(confirmedPurge.status, 0, confirmedPurge.stderr)
    assert.strictEqual(fs.existsSync(memoryRoot), false)

    fs.mkdirSync(memoryRoot, { recursive: true })
    fs.writeFileSync(path.join(memoryRoot, 'third-party-marker'), 'preserve')
    fs.symlinkSync(path.join(ROOT_DIR, 'plugins', 'agy-memory-layer'), targetLink)
    const refusedUnprovenPurge = spawnSync(
      '/bin/bash',
      [uninstallScript, '--purge', '--confirm-purge'],
      { cwd: ROOT_DIR, env, encoding: 'utf-8' },
    )
    assert.strictEqual(refusedUnprovenPurge.status, 1)
    assert.strictEqual(fs.existsSync(path.join(memoryRoot, 'third-party-marker')), true)
    fs.rmSync(lifecycleHome, { recursive: true, force: true })

    const legacyHome = path.join(TEST_TEMP_ROOT, 'legacy-owner-home')
    const legacyPath = path.join(legacyHome, '.gemini', 'antigravity-cli', 'plugins', 'memfs')
    fs.mkdirSync(legacyPath, { recursive: true })
    fs.writeFileSync(path.join(legacyPath, 'owner-marker'), 'preserve')
    const refusedLegacyInstall = spawnSync(
      '/bin/bash',
      [path.join(ROOT_DIR, 'plugins', 'agy-memory-layer', 'scripts', 'install.sh')],
      {
        cwd: ROOT_DIR,
        env: { ...env, HOME: legacyHome, USERPROFILE: legacyHome },
        encoding: 'utf-8',
      },
    )
    assert.strictEqual(refusedLegacyInstall.status, 1)
    assert.strictEqual(fs.existsSync(path.join(legacyPath, 'owner-marker')), true)
    assert.strictEqual(
      fs.existsSync(path.join(legacyHome, '.gemini', 'memory')),
      false,
      'ownership preflight must run before MemFS initialization',
    )
    fs.rmSync(legacyHome, { recursive: true, force: true })

    const rootInstallerHome = path.join(TEST_TEMP_ROOT, 'root-installer-home')
    const rootInstallerEnv = {
      ...env,
      HOME: rootInstallerHome,
      USERPROFILE: rootInstallerHome,
    }
    const rootInstall = spawnSync('/bin/bash', [path.join(ROOT_DIR, 'install.sh')], {
      cwd: ROOT_DIR,
      env: rootInstallerEnv,
      encoding: 'utf-8',
    })
    assert.strictEqual(rootInstall.status, 0, rootInstall.stderr)
    const rootPluginLink = path.join(
      rootInstallerHome,
      '.gemini',
      'antigravity-cli',
      'plugins',
      'agy-memory-layer',
    )
    const rootConfigLink = path.join(
      rootInstallerHome,
      '.gemini',
      'config',
      'plugins',
      'agy-memory-layer',
    )
    assert.strictEqual(fs.lstatSync(rootPluginLink).isSymbolicLink(), true)
    assert.strictEqual(fs.lstatSync(rootConfigLink).isSymbolicLink(), true)
    const rootUninstall = spawnSync('/bin/bash', [uninstallScript], {
      cwd: ROOT_DIR,
      env: rootInstallerEnv,
      encoding: 'utf-8',
    })
    assert.strictEqual(rootUninstall.status, 0, rootUninstall.stderr)
    assert.strictEqual(fs.existsSync(rootPluginLink), false)
    assert.strictEqual(fs.existsSync(rootConfigLink), false)
    assert.strictEqual(
      fs.existsSync(path.join(rootInstallerHome, '.gemini', 'memory', '.git')),
      true,
    )
    fs.rmSync(rootInstallerHome, { recursive: true, force: true })
  })

  it('tests memory-approval dual-mode policy, proposals, and reviews', () => {
    const policy = getApprovalPolicy()
    assert.strictEqual(policy.defaultMode, 'auto')

    // Mode check
    const learningMode = getApprovalModeForFile('projects/test/learnings/2026-08-18_note.md')
    const hypothesisMode = getApprovalModeForFile('projects/test/learnings/working-hypothesis.md')
    const projectMode = getApprovalModeForFile('projects/test/project.md')
    const rulesMode = getApprovalModeForFile('projects/test/rules.md')
    const humanMode = getApprovalModeForFile('global/human.md')

    assert.strictEqual(learningMode, 'auto')
    assert.strictEqual(hypothesisMode, 'explicit')
    assert.strictEqual(humanMode, 'auto')
    assert.strictEqual(projectMode, 'explicit')
    assert.strictEqual(rulesMode, 'explicit')

    saveApprovalPolicy({
      defaultMode: 'auto',
      patterns: { 'projects/*/learnings/*': 'auto' },
    })
    assert.strictEqual(
      getApprovalModeForFile('projects/test/learnings/working-hypothesis.md'),
      'explicit',
    )
    saveApprovalPolicy(policy)

    // Test explicit mode -> creates proposal
    const propRes = proposeMemoryUpdate(
      'projects/test-approval-slug/project.md',
      '# Test Project Architecture\nNew Proposed Rules',
      { reason: 'Refactored backend architecture' },
    )
    assert.strictEqual(propRes.status, 'PENDING_APPROVAL')
    assert.strictEqual(typeof propRes.proposalId, 'string')
    const proposalId = propRes.proposalId
    assert.ok(proposalId)

    const pending = listPendingProposals()
    assert.strictEqual(
      pending.some((p: { id: string }) => p.id === proposalId),
      true,
    )

    const fetched = getPendingProposal(proposalId)
    assert.strictEqual(fetched?.reason, 'Refactored backend architecture')

    // Review approve
    const reviewApprove = reviewProposal(proposalId, 'approve')
    assert.strictEqual(reviewApprove.decision, 'approve')
    assert.strictEqual(reviewApprove.success, true)

    // Clean up test file created by approval
    const testFile = path.join(MEMORY_ROOT, 'projects', 'test-approval-slug', 'project.md')
    if (fs.existsSync(testFile)) {
      fs.rmSync(path.join(MEMORY_ROOT, 'projects', 'test-approval-slug'), {
        recursive: true,
        force: true,
      })
      commitMemoryPaths({
        memoryRoot: MEMORY_ROOT,
        relativePaths: ['projects/test-approval-slug/project.md'],
        reason: 'test: remove approved memory fixture',
      })
    }

    assert.throws(
      () => proposeMemoryUpdate('../escape.md', 'unsafe'),
      /unsafe segment|must be relative/,
    )
  })

  it('tests ts-inspector in-memory diagnostics, type resolution, and definition lookup', () => {
    const inspector = createTsInspector(ROOT_DIR)

    // 1. Diagnostics test
    const diags = inspector.getDiagnostics('plugins/agy-memory-layer/scripts/worktree-manager.ts')
    assert.strictEqual(Array.isArray(diags), true)
    assert.strictEqual(diags.length, 0) // Should have zero errors

    // 2. Type at position test
    const typeInfo = inspector.getTypeAtPosition(
      'plugins/agy-memory-layer/scripts/worktree-manager.ts',
      42,
      17,
    )
    assert.strictEqual(Boolean(typeInfo), true)
    assert.strictEqual(typeInfo?.typeString.includes('getGitRoot'), true)

    // 3. Definition lookup test
    const defs = inspector.getDefinition(
      'plugins/agy-memory-layer/scripts/worktree-manager.ts',
      42,
      17,
    )
    assert.strictEqual(Array.isArray(defs), true)
    assert.strictEqual(defs.length > 0, true)
    assert.strictEqual(defs[0].file.includes('worktree-manager.ts'), true)
  })

  it('tests memory-compactor token estimation, deduplication, and project compaction', () => {
    // 1. Token estimator
    const est = estimateTokens('Hello world! This is a test markdown content.')
    assert.strictEqual(est > 5, true)
    assert.strictEqual(estimateTokens(''), 0)

    // 2. Markdown deduplication
    const sampleMd = `
# Project Rules
- Always use exact versions with -E.
- Strict typing, no interface.
- Always use exact versions with -E.
- Strict typing, no interface.

## Empty Section

## Valid Section
- Keep memory blocks compact.
`
    const { compacted, deduplicatedCount, prunedSectionsCount } = compactMarkdownContent(sampleMd)
    assert.strictEqual(deduplicatedCount, 2)
    assert.strictEqual(prunedSectionsCount, 1)
    assert.strictEqual(compacted.includes('## Empty Section'), false)
    assert.strictEqual(compacted.includes('## Valid Section'), true)

    // 3. Mock MemFS sandbox compaction test
    const tempMemfs = path.join(TEST_TEMP_ROOT, 'test-compactor-memfs')
    const tempProjDir = path.join(tempMemfs, 'projects', 'compactor-test-proj')
    fs.mkdirSync(tempProjDir, { recursive: true })
    fs.writeFileSync(
      path.join(tempProjDir, 'rules.md'),
      '# Rules\n- Rule 1\n- Rule 2\n- Rule 1\n- Rule 2\n',
    )
    const originalRules = fs.readFileSync(path.join(tempProjDir, 'rules.md'), 'utf-8')

    const projRes = compactProjectMemory('compactor-test-proj', { dryRun: false }, tempMemfs)
    assert.strictEqual(projRes.totalTokensSaved > 0, true)
    assert.strictEqual(fs.readFileSync(path.join(tempProjDir, 'rules.md'), 'utf-8'), originalRules)
    assert.throws(() => compactProjectMemory('../escape', {}, tempMemfs), /Invalid project slug/)

    const autoRes = runAutoCompaction(tempMemfs, { dryRun: true })
    assert.strictEqual(typeof autoRes.timestamp, 'string')
    assert.strictEqual(Array.isArray(autoRes.projects), true)

    // Clean up
    fs.rmSync(tempMemfs, { recursive: true, force: true })
  })

  it('tests skill-synthesizer clustering, draft generation, and scanMemfsLearnings', () => {
    // 1. Test draft skill markdown generator
    const sampleCluster = [
      {
        filePath: path.join(TEST_TEMP_ROOT, 'learnings', '1.md'),
        fileName: '1.md',
        projectSlug: 'proj-a',
        title: 'Fix SQLite WAL Lock',
        content: 'Fix sqlite lock by setting busy_timeout to 5000',
        vector: {},
      },
      {
        filePath: path.join(TEST_TEMP_ROOT, 'learnings', '2.md'),
        fileName: '2.md',
        projectSlug: 'proj-b',
        title: 'Fix SQLite WAL Lock Contention',
        content: 'Fix sqlite lock by setting busy_timeout to 5000',
        vector: {},
      },
      {
        filePath: path.join(TEST_TEMP_ROOT, 'learnings', '3.md'),
        fileName: '3.md',
        projectSlug: 'proj-c',
        title: 'Prevent SQLite Database Locked Errors',
        content: 'Fix sqlite lock by setting busy_timeout to 5000',
        vector: {},
      },
    ]

    const draft = generateDraftSkill(
      'sqlite-lock-recovery',
      'Fix SQLite Database Lock',
      sampleCluster,
    )
    assert.strictEqual(draft.includes('name: sqlite-lock-recovery'), true)
    assert.strictEqual(draft.includes('Fix SQLite Database Lock'), true)
    assert.strictEqual(draft.includes('Synthesized by `agy-memory-layer` Skill Synthesizer'), true)

    // 2. Test sandbox scan & synthesis
    const tempMemfs = path.join(TEST_TEMP_ROOT, 'test-synthesizer-memfs')
    const tempProjDir = path.join(tempMemfs, 'projects', 'test-app', 'learnings')
    fs.mkdirSync(tempProjDir, { recursive: true })

    // Write 3 similar learnings to trigger clustering threshold (minOccurrences = 3)
    fs.writeFileSync(
      path.join(tempProjDir, '2026-08-18_d1_setup_1.md'),
      '# Cloudflare D1 Setup\nStep 1: wrangler d1 create\nStep 2: bind in wrangler.jsonc\nStep 3: execute migrations\n',
    )
    fs.writeFileSync(
      path.join(tempProjDir, '2026-08-18_d1_setup_2.md'),
      '# Cloudflare D1 Setup Guide\nStep 1: wrangler d1 create\nStep 2: bind in wrangler.jsonc\nStep 3: execute migrations\n',
    )
    fs.writeFileSync(
      path.join(tempProjDir, '2026-08-18_d1_setup_3.md'),
      '# Cloudflare D1 Database Configuration\nStep 1: wrangler d1 create\nStep 2: bind in wrangler.jsonc\nStep 3: execute migrations\n',
    )

    const scanRes = scanAndSynthesizeSkills({ minOccurrences: 3, minSimilarity: 0.6 }, tempMemfs)

    assert.strictEqual(scanRes.totalLearningsScanned, 3)
    assert.strictEqual(scanRes.candidates.length >= 1, true)
    assert.strictEqual(scanRes.candidates[0].occurrenceCount, 3)

    // Clean up
    fs.rmSync(tempMemfs, { recursive: true, force: true })
  })

  it('tests cross-project-synapse matching and notice formatting', () => {
    const tempMemfs = path.join(TEST_TEMP_ROOT, 'test-synapse-memfs')
    const projADir = path.join(tempMemfs, 'projects', 'project-a', 'learnings')
    const projBDir = path.join(tempMemfs, 'projects', 'project-b', 'learnings')

    fs.mkdirSync(projADir, { recursive: true })
    fs.mkdirSync(projBDir, { recursive: true })

    // Project A solved SQLite WAL contention
    fs.writeFileSync(
      path.join(projADir, '2026-08-18_sqlite_wal.md'),
      '# SQLite WAL Lock Contention Fix\n- Set busy_timeout to 5000ms\n- Enable journal_mode=WAL\n- Lessons: Prevents database locked errors in concurrent execution.',
    )

    // Project B solved frontend styling
    fs.writeFileSync(
      path.join(projBDir, '2026-08-18_css_tokens.md'),
      '# Design Tokens & CSS Variables\n- Define color palette tokens in index.css\n- Lessons: Keep typography scale consistent.',
    )

    // Query from Project B searching for sqlite lock fix
    const hits = findCrossProjectSynapses(
      'sqlite database locked contention',
      { currentProjectSlug: 'project-b', minSimilarity: 0.45, limit: 3 },
      tempMemfs,
    )

    assert.strictEqual(hits.length >= 1, true)
    assert.strictEqual(hits[0].projectSlug, 'project-a')
    assert.strictEqual(hits[0].title.includes('SQLite WAL Lock'), true)

    // Test notice formatting
    const notice = formatSynapseNotice(hits)
    assert.strictEqual(notice.includes('Cross-Project Knowledge Synapses'), true)
    assert.strictEqual(notice.includes('project-a'), true)

    // Clean up
    fs.rmSync(tempMemfs, { recursive: true, force: true })
  })

  it('tests letta-sync normalization, primary agent discovery, and dry-run sync', () => {
    // 1. Slug normalization test
    const slugA = normalizeLettaProjectSlug('Users_mahiro_ghq_github.com_haabiz_haabiz-ui')
    assert.strictEqual(slugA, 'haabiz-haabiz-ui')

    const slugB = normalizeLettaProjectSlug('Users_mahiro_ghq_github.com_mahirocoko_agent-halo')
    assert.strictEqual(slugB, 'mahirocoko-agent-halo')

    const slugC = normalizeLettaProjectSlug('Users_mahiro_Documents_my-project')
    assert.strictEqual(slugC, 'my-project')

    // 2. Mock Letta sandbox sync test
    const tempLetta = path.join(TEST_TEMP_ROOT, 'test-letta-sync-root')
    const tempMemfs = path.join(TEST_TEMP_ROOT, 'test-letta-sync-memfs')
    fs.rmSync(tempLetta, { recursive: true, force: true })
    fs.rmSync(tempMemfs, { recursive: true, force: true })

    fs.mkdirSync(tempMemfs, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tempMemfs })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=tests',
        '-c',
        'user.email=tests@example.invalid',
        'commit',
        '--allow-empty',
        '-q',
        '-m',
        'test: seed Letta sync MemFS',
      ],
      { cwd: tempMemfs },
    )

    const agentDir = path.join(tempLetta, 'agents', 'agent-test-1234', 'memory')

    fs.mkdirSync(path.join(agentDir, 'system'), { recursive: true })
    fs.mkdirSync(path.join(agentDir, 'reference'), { recursive: true })
    fs.mkdirSync(path.join(tempLetta, 'projects', 'Users_mahiro_ghq_github.com_org_repo-a'), {
      recursive: true,
    })

    fs.writeFileSync(
      path.join(agentDir, 'system', 'human.md'),
      '# Letta Human Profile\n- User prefers Thai language\n- User prefers Bun for Bun projects\n',
    )
    fs.writeFileSync(
      path.join(agentDir, 'reference', 'thai-grammar.md'),
      '# Thai Grammar Reference\n- Writing tone guidelines.',
    )
    fs.writeFileSync(
      path.join(tempLetta, 'projects', 'Users_mahiro_ghq_github.com_org_repo-a', 'rules.md'),
      '# Repo A Rules\n- Always run linter before push.',
    )

    // Discover primary agent
    const discoveredAgent = findPrimaryLettaAgent(tempLetta)
    assert.strictEqual(discoveredAgent, 'agent-test-1234')

    assert.throws(
      () =>
        syncLettaMemory({
          lettaRoot: tempLetta,
          memoryRoot: tempMemfs,
          dryRun: true,
        }),
      /Select the Letta agent explicitly/,
    )
    assert.throws(
      () =>
        syncLettaMemory({
          lettaRoot: tempLetta,
          memoryRoot: tempMemfs,
          dryRun: true,
          targetAgentId: 'agent-test-1234',
        }),
      /Select the import scope explicitly/,
    )
    assert.throws(
      () =>
        syncLettaMemory({
          lettaRoot: tempLetta,
          memoryRoot: tempMemfs,
          dryRun: true,
          targetAgentId: 'agent-test-1234',
          targetScope: 'invalid' as 'global',
        }),
      /Invalid target scope/,
    )
    assert.throws(
      () =>
        syncLettaMemory({
          lettaRoot: tempLetta,
          memoryRoot: tempMemfs,
          dryRun: true,
          targetAgentId: 'agent-test-1234',
          targetScope: 'project',
        }),
      /requires --project-slug/,
    )
    const projectDryRun = syncLettaMemory({
      lettaRoot: tempLetta,
      memoryRoot: tempMemfs,
      dryRun: true,
      targetAgentId: 'agent-test-1234',
      targetScope: 'project',
      projectSlug: 'org-repo-a',
    })
    assert.strictEqual(projectDryRun.globalHumanUpdated, false)
    assert.strictEqual(projectDryRun.syncedProjectsCount, 1)
    assert.throws(
      () =>
        syncLettaMemory({
          lettaRoot: tempLetta,
          memoryRoot: tempMemfs,
          dryRun: false,
          targetAgentId: 'agent-test-1234',
          targetScope: 'global',
        }),
      /requires --confirm-import/,
    )

    // Test live sync into sandbox MemFS
    const syncRes = syncLettaMemory({
      lettaRoot: tempLetta,
      memoryRoot: tempMemfs,
      dryRun: false,
      autoCommit: true,
      targetAgentId: 'agent-test-1234',
      targetScope: 'global',
      confirmed: true,
    })

    assert.strictEqual(syncRes.status, 'SYNCED_SUCCESSFULLY')
    assert.strictEqual(syncRes.globalHumanUpdated, true)
    assert.strictEqual(syncRes.importedReferencesCount, 1)
    assert.strictEqual(syncRes.syncedProjectsCount, 0)

    // Verify imported files in sandbox MemFS
    assert.strictEqual(fs.existsSync(path.join(tempMemfs, 'global', 'human.md')), true)
    assert.strictEqual(
      fs.existsSync(path.join(tempMemfs, 'global', 'reference', 'thai-grammar.md')),
      true,
    )
    assert.strictEqual(fs.existsSync(path.join(tempMemfs, 'projects', 'org-repo-a')), false)

    const projectSyncRes = syncLettaMemory({
      lettaRoot: tempLetta,
      memoryRoot: tempMemfs,
      dryRun: false,
      autoCommit: true,
      targetAgentId: 'agent-test-1234',
      targetScope: 'project',
      projectSlug: 'org-repo-a',
      confirmed: true,
    })
    assert.strictEqual(projectSyncRes.globalHumanUpdated, false)
    assert.strictEqual(projectSyncRes.syncedProjectsCount, 1)
    assert.strictEqual(
      fs.existsSync(path.join(tempMemfs, 'projects', 'org-repo-a', 'rules.md')),
      true,
    )
    const projectCommitPaths = execFileSync('git', ['show', '--pretty=', '--name-only', 'HEAD'], {
      cwd: tempMemfs,
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .sort()
    assert.deepStrictEqual(projectCommitPaths, [
      'projects/org-repo-a/learnings/thai-grammar.md',
      'projects/org-repo-a/rules.md',
    ])

    assert.throws(
      () =>
        syncLettaMemory({
          lettaRoot: tempLetta,
          memoryRoot: tempMemfs,
          targetAgentId: 'agent-test-1234',
          targetScope: 'project',
          projectSlug: '../escape',
          dryRun: true,
        }),
      /Invalid project slug/,
    )

    // Clean up
    fs.rmSync(tempLetta, { recursive: true, force: true })
    fs.rmSync(tempMemfs, { recursive: true, force: true })
  })
})
