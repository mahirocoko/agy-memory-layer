import * as assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it } from 'node:test'

const ROOT_DIR = path.resolve(import.meta.dirname, '..')
const PLUGIN_DIR = path.join(ROOT_DIR, 'plugins', 'agy-memory-layer')
const SCRIPTS_DIR = path.join(PLUGIN_DIR, 'scripts')
const MEMORY_ROOT = path.join(process.env.HOME || '', '.gemini', 'memory')

const { initProjectMemory, scanCodebase } = await import(
  path.join(SCRIPTS_DIR, 'init-project-memory.ts')
)
const { searchMemory } = await import(path.join(SCRIPTS_DIR, 'memory-search.ts'))
const { runCli } = await import(path.join(ROOT_DIR, 'tools', 'memory-backup.ts'))
const { PERSONA_PRESETS, getActivePersona, switchPersona } = await import(
  path.join(SCRIPTS_DIR, 'switch-persona.ts')
)
const { cosineSimilarity, buildVectorProfile, scanAllConversations, searchRecall } = await import(
  path.join(SCRIPTS_DIR, 'recall-engine.ts')
)
const { scanPendingConversations, synthesizeConversationLearning, printStatus } = await import(
  path.join(SCRIPTS_DIR, 'dream-daemon.ts')
)
const { listSubagents, getSubagent } = await import(path.join(SCRIPTS_DIR, 'agent-launcher.ts'))
const {
  createIsolatedWorktree,
  getWorktreeDiff,
  applyWorktreeChanges,
  cleanupWorktree,
  listActiveWorktrees,
} = await import(path.join(SCRIPTS_DIR, 'worktree-manager.ts'))
const {
  getApprovalPolicy,
  getApprovalModeForFile,
  proposeMemoryUpdate,
  listPendingProposals,
  getPendingProposal,
  reviewProposal,
} = await import(path.join(SCRIPTS_DIR, 'memory-approval.ts'))
const { createTsInspector } = await import(path.join(SCRIPTS_DIR, 'ts-inspector.ts'))
const {
  estimateTokens,
  compactMarkdownContent,
  compactFile,
  compactProjectMemory,
  runAutoCompaction,
} = await import(path.join(SCRIPTS_DIR, 'memory-compactor.ts'))
const { scanAndSynthesizeSkills, generateDraftSkill, scanMemfsLearnings } = await import(
  path.join(SCRIPTS_DIR, 'skill-synthesizer.ts')
)
const { findCrossProjectSynapses, formatSynapseNotice } = await import(
  path.join(SCRIPTS_DIR, 'cross-project-synapse.ts')
)
const { syncLettaMemory, normalizeLettaProjectSlug, findPrimaryLettaAgent } = await import(
  path.join(SCRIPTS_DIR, 'letta-sync.ts')
)

describe('Unit Coverage Extensions', () => {
  it('tests init-project-memory with Rust, Go, Python, and Docker manifests', () => {
    const tempDir = '/tmp/test-multi-stack-project'
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

    const res1 = initProjectMemory(tempDir, { force: true })
    assert.strictEqual(res1.status, 'INITIALIZED')

    // Test ALREADY_INITIALIZED branch
    const res2 = initProjectMemory(tempDir, { force: false })
    assert.strictEqual(res2.status, 'ALREADY_INITIALIZED')

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(path.join(MEMORY_ROOT, 'projects', 'test-multi-stack-project'), {
      recursive: true,
      force: true,
    })
  })

  it('tests memory-search error and edge cases', () => {
    assert.throws(() => searchMemory(''), /Search query must not be empty/)
    const nonExistent = searchMemory('supercalifragilistic_nonexistent_term_xyz_12345')
    assert.strictEqual(nonExistent.length, 0)
  })

  it('tests memory-backup CLI runner functions directly', () => {
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
    const tempBundle = '/tmp/test-cli-bundle.json'
    runCli(['export', '-o', tempBundle, '--json'])
    assert.strictEqual(fs.existsSync(tempBundle), true)

    // Test verify command CLI
    runCli(['verify', '-i', tempBundle, '--json'])

    // Test import command CLI (dry run)
    runCli(['import', '-i', tempBundle, '--dry-run', '--json'])

    fs.unlinkSync(tempBundle)
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
      assert.strictEqual(typeof doc, 'string')
      assert.strictEqual(doc.includes('Auto-Dream Learning'), true)
      assert.strictEqual(doc.includes(sample.id), true)
    }

    assert.doesNotThrow(() => {
      printStatus('learn-letta-code')
    })
  })

  it('tests agent-launcher subagent manifests and prompt resolution', () => {
    const all = listSubagents()
    assert.strictEqual(Array.isArray(all), true)
    assert.strictEqual(all.length >= 6, true)

    const dreamAgent = getSubagent('dream_agent')
    assert.strictEqual(Boolean(dreamAgent), true)
    assert.strictEqual(dreamAgent?.role.includes('Reflection'), true)
    assert.strictEqual(dreamAgent?.systemPrompt.length > 0, true)

    const recallAgent = getSubagent('recall_agent')
    assert.strictEqual(Boolean(recallAgent), true)
    assert.strictEqual(recallAgent?.systemPrompt.length > 0, true)

    const nonExistent = getSubagent('non_existent_random_agent_xyz')
    assert.strictEqual(nonExistent, null)
  })

  it('tests worktree-manager isolation, diffing, patch apply, and cleanup', () => {
    const testId = `test-wt-${Date.now().toString(36)}`
    const wt = createIsolatedWorktree(ROOT_DIR, { subagentId: testId })

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
    const activeList = listActiveWorktrees(ROOT_DIR)
    assert.strictEqual(
      activeList.some((p: string) => p.includes(testId)),
      true,
    )

    // Clean up worktree
    cleanupWorktree(wt, { deleteBranch: true })
    assert.strictEqual(fs.existsSync(wt.worktreePath), false)
  })

  it('tests memory-approval dual-mode policy, proposals, and reviews', () => {
    const policy = getApprovalPolicy()
    assert.strictEqual(policy.defaultMode, 'auto')

    // Mode check
    const learningMode = getApprovalModeForFile('projects/test/learnings/2026-08-18_note.md')
    const projectMode = getApprovalModeForFile('projects/test/project.md')
    const rulesMode = getApprovalModeForFile('projects/test/rules.md')
    const humanMode = getApprovalModeForFile('global/human.md')

    assert.strictEqual(learningMode, 'auto')
    assert.strictEqual(humanMode, 'auto')
    assert.strictEqual(projectMode, 'explicit')
    assert.strictEqual(rulesMode, 'explicit')

    // Test explicit mode -> creates proposal
    const propRes = proposeMemoryUpdate(
      'projects/test-approval-slug/project.md',
      '# Test Project Architecture\nNew Proposed Rules',
      { reason: 'Refactored backend architecture' },
    )
    assert.strictEqual(propRes.status, 'PENDING_APPROVAL')
    assert.strictEqual(typeof propRes.proposalId, 'string')

    const pending = listPendingProposals()
    assert.strictEqual(
      pending.some((p: { id: string }) => p.id === propRes.proposalId),
      true,
    )

    const fetched = getPendingProposal(propRes.proposalId!)
    assert.strictEqual(fetched?.reason, 'Refactored backend architecture')

    // Review approve
    const reviewApprove = reviewProposal(propRes.proposalId!, 'approve')
    assert.strictEqual(reviewApprove.decision, 'approve')
    assert.strictEqual(reviewApprove.success, true)

    // Clean up test file created by approval
    const testFile = path.join(MEMORY_ROOT, 'projects', 'test-approval-slug', 'project.md')
    if (fs.existsSync(testFile)) {
      fs.rmSync(path.join(MEMORY_ROOT, 'projects', 'test-approval-slug'), {
        recursive: true,
        force: true,
      })
    }
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
    const tempMemfs = '/tmp/test-compactor-memfs'
    const tempProjDir = path.join(tempMemfs, 'projects', 'compactor-test-proj')
    fs.mkdirSync(tempProjDir, { recursive: true })
    fs.writeFileSync(
      path.join(tempProjDir, 'rules.md'),
      '# Rules\n- Rule 1\n- Rule 2\n- Rule 1\n- Rule 2\n',
    )

    const projRes = compactProjectMemory('compactor-test-proj', { dryRun: false }, tempMemfs)
    assert.strictEqual(projRes.totalTokensSaved > 0, true)

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
        filePath: '/tmp/learnings/1.md',
        fileName: '1.md',
        projectSlug: 'proj-a',
        title: 'Fix SQLite WAL Lock',
        content: 'Fix sqlite lock by setting busy_timeout to 5000',
        vector: {},
      },
      {
        filePath: '/tmp/learnings/2.md',
        fileName: '2.md',
        projectSlug: 'proj-b',
        title: 'Fix SQLite WAL Lock Contention',
        content: 'Fix sqlite lock by setting busy_timeout to 5000',
        vector: {},
      },
      {
        filePath: '/tmp/learnings/3.md',
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
    const tempMemfs = '/tmp/test-synthesizer-memfs'
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
    const tempMemfs = '/tmp/test-synapse-memfs'
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
    const tempLetta = '/tmp/test-letta-sync-root'
    const tempMemfs = '/tmp/test-letta-sync-memfs'
    fs.rmSync(tempLetta, { recursive: true, force: true })
    fs.rmSync(tempMemfs, { recursive: true, force: true })

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

    // Test live sync into sandbox MemFS
    const syncRes = syncLettaMemory({
      lettaRoot: tempLetta,
      memoryRoot: tempMemfs,
      dryRun: false,
      autoCommit: false,
    })

    assert.strictEqual(syncRes.status, 'SYNCED_SUCCESSFULLY')
    assert.strictEqual(syncRes.globalHumanUpdated, true)
    assert.strictEqual(syncRes.importedReferencesCount, 1)
    assert.strictEqual(syncRes.syncedProjectsCount, 1)

    // Verify imported files in sandbox MemFS
    assert.strictEqual(fs.existsSync(path.join(tempMemfs, 'global', 'human.md')), true)
    assert.strictEqual(
      fs.existsSync(path.join(tempMemfs, 'global', 'reference', 'thai-grammar.md')),
      true,
    )
    assert.strictEqual(
      fs.existsSync(path.join(tempMemfs, 'projects', 'org-repo-a', 'rules.md')),
      true,
    )

    // Clean up
    fs.rmSync(tempLetta, { recursive: true, force: true })
    fs.rmSync(tempMemfs, { recursive: true, force: true })
  })
})
