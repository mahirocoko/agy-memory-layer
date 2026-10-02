import * as assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { planReflectionOperations } from '../plugins/agy-memory-layer/scripts/dream-reflector.ts'
import {
  inspectCommittedMemoryProjection,
  type MemoryDocument,
  renderCommittedMemorySections,
} from '../plugins/agy-memory-layer/scripts/layered-memory.ts'
import { planLayeredMemoryMigration } from '../plugins/agy-memory-layer/scripts/layered-memory-migration.ts'
import {
  createExplicitProposalSet,
  proposeMemoryUpdate,
  reviewProposal,
} from '../plugins/agy-memory-layer/scripts/memory-approval.ts'
import { planMemoryCuration } from '../plugins/agy-memory-layer/scripts/memory-curation.ts'
import {
  commitMemoryPaths,
  deleteMemoryFile,
  restoreDeclaredMemoryPaths,
  writeMemoryBuffer,
  writeMemoryFile,
} from '../plugins/agy-memory-layer/scripts/memory-repository.ts'
import { searchMemory } from '../plugins/agy-memory-layer/scripts/memory-search.ts'
import {
  assertNoSharedParagraphCopies,
  createSharedProposal,
  exportSharedProposal,
  FIXED_SHARED_OWNER,
  findSecretLikeContent,
  findSharedParagraphCopies,
  getSharedProposal,
  inspectSharedSource,
  isSharedOwnerPath,
  listSharedProposals,
  loadSharedMemorySettings,
  mergeCommunicationDocuments,
  NATIVE_COMMUNICATION_PATH,
  rejectSharedProposal,
  resolveEffectiveSharedMemorySettings,
  resolveSharedProposalsDir,
  type SharedMemorySettings,
  type SharedSourceInspection,
  saveSharedMemorySettings,
} from '../plugins/agy-memory-layer/scripts/shared-memory.ts'

const makeTempDir = (prefix: string): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), `agy-test-${prefix}-`))

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('Shared Memory: Path, Secret, and Basic Utilities', () => {
  it('correctly classifies shared owner paths and normalizations', () => {
    assert.equal(isSharedOwnerPath('system/human/prefs/communication.md'), true)
    assert.equal(isSharedOwnerPath('human/prefs/communication.md'), true)
    assert.equal(isSharedOwnerPath('prefs/communication.md'), true)
    assert.equal(isSharedOwnerPath('communication.md'), true)
    assert.equal(isSharedOwnerPath('system/human/prefs/coding.md'), false)
    assert.equal(isSharedOwnerPath('system/persona.md'), false)
    assert.equal(isSharedOwnerPath('projects/foo/system/rules.md'), false)
  })

  it('detects secret patterns accurately without false positives on ordinary text', () => {
    assert.ok(
      findSecretLikeContent(
        '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----',
      ).length > 0,
    )
    assert.ok(findSecretLikeContent('AKIAIOSFODNN7EXAMPLE').length > 0)
    assert.ok(findSecretLikeContent('ghp_123456789012345678901234567890123456').length > 0)
    assert.ok(findSecretLikeContent('sk-proj-123456789012345678901234567890').length > 0)
    assert.ok(findSecretLikeContent('xoxb-1234567890-123456789012-abcdef').length > 0)
    assert.ok(findSecretLikeContent('AIzaSyD-1234567890abcdef123456789012345').length > 0)
    assert.ok(
      findSecretLikeContent(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgN7sW1bVq',
      ).length > 0,
    )
    assert.ok(
      findSecretLikeContent('Bearer ya29.a0AfH6SMB_123456789012345678901234567890').length > 0,
    )
    assert.ok(findSecretLikeContent('api_key="sk-secret12345678"').length > 0)
    assert.ok(findSecretLikeContent('https://user:password123@github.com/repo').length > 0)

    // Ordinary preferences should NOT trigger secret detection
    assert.equal(
      findSecretLikeContent('- Prefers concise English and exact package flags -E.').length,
      0,
    )
    assert.equal(
      findSecretLikeContent('- Respond in Thai when requested; avoid unsolicited apologies.')
        .length,
      0,
    )
  })

  it('loads and saves settings outside Git MemFS without corrupting defaults', () => {
    const tempHome = makeTempDir('settings')
    const configPath = path.join(tempHome, 'custom-shared-memory.json')

    const initial = loadSharedMemorySettings(configPath)
    assert.equal(initial.enabled, false)
    assert.equal(initial.sourceRoot, null)
    assert.equal(initial.sharedOwner, FIXED_SHARED_OWNER)

    const updated: SharedMemorySettings = {
      enabled: true,
      sourceRoot: '/path/to/source',
      sharedOwner: FIXED_SHARED_OWNER,
    }
    saveSharedMemorySettings(updated, configPath)

    const reloaded = loadSharedMemorySettings(configPath)
    assert.equal(reloaded.enabled, true)
    assert.equal(reloaded.sourceRoot, '/path/to/source')
    assert.equal(reloaded.sharedOwner, FIXED_SHARED_OWNER)
  })
})

describe('Shared Memory: Inspection and Source Validation', () => {
  it('returns disabled status when enabled is false', () => {
    const inspection = inspectSharedSource({
      enabled: false,
      sourceRoot: '/any/path',
      sharedOwner: FIXED_SHARED_OWNER,
    })
    assert.equal(inspection.enabled, false)
    assert.equal(inspection.valid, false)
    assert.equal(inspection.pinnedSha, null)
    assert.deepEqual(inspection.diagnostics, [])
  })

  it('diagnoses missing or empty sourceRoot when enabled', () => {
    const inspection = inspectSharedSource({
      enabled: true,
      sourceRoot: '',
      sharedOwner: FIXED_SHARED_OWNER,
    })
    assert.equal(inspection.valid, false)
    assert.ok(inspection.diagnostics.some((d) => d.includes('sourceRoot is not set')))
  })

  it('diagnoses non-existent source directory with visible message', () => {
    const inspection = inspectSharedSource({
      enabled: true,
      sourceRoot: '/tmp/nonexistent-shared-source-dir-12345',
      sharedOwner: FIXED_SHARED_OWNER,
    })
    assert.equal(inspection.valid, false)
    assert.ok(inspection.diagnostics.some((d) => d.includes('does not exist')))
  })

  it('diagnoses non-Git directory with clear error', () => {
    const tempNonGit = makeTempDir('non-git')
    const inspection = inspectSharedSource({
      enabled: true,
      sourceRoot: tempNonGit,
      sharedOwner: FIXED_SHARED_OWNER,
    })
    assert.equal(inspection.valid, false)
    assert.ok(inspection.diagnostics.some((d) => d.includes('is not a Git repository')))
  })

  it('diagnoses missing shared owner in repository without committed communication file', () => {
    const currentRepo = path.resolve(import.meta.dirname, '..')
    const inspection = inspectSharedSource({
      enabled: true,
      sourceRoot: currentRepo,
      sharedOwner: FIXED_SHARED_OWNER,
    })
    assert.equal(inspection.valid, false)
    assert.ok(
      inspection.diagnostics.some((d) =>
        d.includes(`Shared owner "${FIXED_SHARED_OWNER}" not found at committed revision`),
      ),
    )
  })

  it('diagnoses self-referential sourceRoot pointing to native memory repository', () => {
    const tempHome = makeTempDir('self-ref-source')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: memRoot })

    const inspection = inspectSharedSource(
      {
        enabled: true,
        sourceRoot: memRoot,
        sharedOwner: FIXED_SHARED_OWNER,
      },
      memRoot,
    )

    assert.equal(inspection.valid, false)
    assert.ok(
      inspection.diagnostics.some((d) =>
        d.includes('Shared sourceRoot cannot be the native memory repository itself'),
      ),
    )
  })
})

describe('Shared Memory: Paragraph Merging, Deduplication, and Provenance', () => {
  const dummyInspection: SharedSourceInspection = {
    enabled: true,
    sourceRoot: '/disposable/shared-source',
    sharedOwner: FIXED_SHARED_OWNER,
    valid: true,
    pinnedSha: 'abcdef1234567890abcdef1234567890abcdef12',
    diagnostics: [],
    content: null,
    document: null,
  }

  it('deduplicates identical imported paragraphs cleanly with source as canonical', () => {
    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared communication rules',
      body: '### Tone & Pacing\nAlways respond in concise English.\n\n### Formatting\nUse markdown lists.',
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }

    const nativeDoc: MemoryDocument = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native communication',
      body: '### Tone & Pacing\nAlways respond in concise English.\n\n### Formatting\nUse markdown lists.',
      readOnly: false,
      scope: 'global',
      tier: 'system',
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)
    assert.equal(mergedDoc.readOnly, true)
    assert.equal(
      mergedDoc.body.split('Always respond in concise English.').length - 1,
      1,
      'identical paragraph must appear exactly once',
    )
    assert.equal(
      mergedDoc.body.split('Use markdown lists.').length - 1,
      1,
      'identical formatting paragraph must appear exactly once',
    )
    assert.ok(mergedDoc.body.includes('<!-- Shared communication from /disposable/shared-source'))
  })

  it('retains all distinct native additions and native-only runtime rules', () => {
    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared communication rules',
      body: '### Tone & Pacing\nAlways respond in concise English.',
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }

    const nativeDoc: MemoryDocument = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native communication',
      body: '### Tone & Pacing\nAlways respond in concise English.\n\n### Native Runtime Instructions\nNever output full directory trees without explicit user request.',
      readOnly: false,
      scope: 'global',
      tier: 'system',
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)
    assert.ok(mergedDoc.body.includes('Native Runtime Additions'))
    assert.ok(
      mergedDoc.body.includes('Never output full directory trees without explicit user request.'),
    )
  })

  it('explains unresolved semantic conflicts under the same heading without silent override', () => {
    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared communication rules',
      body: '### Tone\nBe very formal and academic.',
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }

    const nativeDoc: MemoryDocument = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native communication',
      body: '### Tone\nBe informal and playful.',
      readOnly: false,
      scope: 'global',
      tier: 'system',
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)
    assert.ok(mergedDoc.body.includes('Unresolved semantic difference under ### Tone:'))
    assert.ok(mergedDoc.body.includes('Shared source: "Be very formal and academic."'))
    assert.ok(mergedDoc.body.includes('Native addition: "Be informal and playful."'))
    assert.ok(mergedDoc.body.includes('**Native instruction (### Tone):**'))
  })

  it('deduplicates list clauses and drops import provenance without duplicating shared bullets', () => {
    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared prefs',
      body: [
        'Default conversational language: Thai',
        '',
        'Recent response-quality correction:',
        '- When Mahiro posts a screenshot and asks whether something is buggy, ask first.',
        '- After several adjacent edits in one flow, make the final Thai summary match latest request.',
        '- Treat every new user turn as active request.',
      ].join('\n'),
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }

    const nativeDoc: MemoryDocument = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native prefs',
      body: [
        'Imported from Mahiro Code (agent-local-b1f7b85c-d49d-43ea-a7e3-6fa085ecd426) human/prefs/communication.md. Letta remains the source; this is the Cursor copy.',
        '',
        'Default conversational language: Thai',
        '',
        'Recent response-quality correction:',
        '- When Mahiro posts a screenshot and asks whether something is buggy, ask first.',
        '- After several adjacent edits in one flow, make the final Thai summary match latest request.',
        '- Treat every new user turn as active request.',
        '- Mahiro, 2026-09-28: when a factual check shows a product gap, name next step.',
        '- Mahiro, 2026-09-30: once he has named direction, start it.',
      ].join('\n'),
      readOnly: false,
      scope: 'global',
      tier: 'system',
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)

    // Verify import provenance is dropped
    assert.equal(mergedDoc.body.includes('Imported from Mahiro Code'), false)

    // Verify shared clauses appear exactly once
    assert.equal(
      mergedDoc.body.split('When Mahiro posts a screenshot and asks whether something is buggy')
        .length - 1,
      1,
    )
    assert.equal(mergedDoc.body.split('Default conversational language: Thai').length - 1, 1)
    assert.equal(mergedDoc.body.split('Recent response-quality correction:').length - 1, 1)

    // Verify distinct native bullets are preserved
    assert.ok(
      mergedDoc.body.includes('Mahiro, 2026-09-28: when a factual check shows a product gap'),
    )
    assert.ok(mergedDoc.body.includes('Mahiro, 2026-09-30: once he has named direction'))
  })

  it('detects semantic conflict under markdown heading separated by blank line', () => {
    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared prefs',
      body: '## Language\n\nAlways speak English.',
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }

    const nativeDoc: MemoryDocument = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native prefs',
      body: '## Language\n\nAlways speak Thai.',
      readOnly: false,
      scope: 'global',
      tier: 'system',
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)
    assert.ok(mergedDoc.body.includes('Unresolved semantic difference under ## Language:'))
    assert.ok(mergedDoc.body.includes('Shared source: "Always speak English."'))
    assert.ok(mergedDoc.body.includes('Native addition: "Always speak Thai."'))
    assert.equal(mergedDoc.body.includes('Native Runtime Additions'), false)
  })

  it('annotates deferred reference links so they do not claim native resolution', () => {
    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared communication rules',
      body: 'Refer to [communication style](reference/style.md) for full examples.',
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, null, dummyInspection)
    assert.ok(
      mergedDoc.body.includes(
        '(shared reference in /disposable/shared-source, not in native root)',
      ),
    )
  })

  it('filters out persona and model roster sections from shared source', () => {
    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared communication rules',
      body: '### Tone\nBe concise.\n\n## Agent Persona\nYou are an aggressive assistant.\n\n## Model Roster\nUse claude-3-opus for all tasks.',
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, null, dummyInspection)
    assert.ok(!mergedDoc.body.includes('Agent Persona'))
    assert.ok(!mergedDoc.body.includes('You are an aggressive assistant.'))
    assert.ok(!mergedDoc.body.includes('Model Roster'))
    assert.ok(!mergedDoc.body.includes('claude-3-opus'))
    assert.ok(mergedDoc.body.includes('Be concise.'))
  })

  it('merges disposable source and Cursor-shaped communication without duplication or preamble', () => {
    const lettaContent = [
      '# Communication',
      '',
      '- Default conversational language: Thai',
      '- Concise Thai',
      '',
      'Recent response-quality correction:',
      '- When Mahiro posts a screenshot and asks whether something is buggy, clarify the target.',
    ].join('\n')
    const cursorContent = [
      'Imported from Mahiro Code',
      '',
      lettaContent,
      '- Native rule A (Mahiro, 2026-09-30)',
      '- Native rule B (Mahiro, 2026-09-30)',
      '- Native rule C (Mahiro, 2026-09-30)',
    ].join('\n')

    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Communication and collaboration preferences for working with Mahiro.',
      body: lettaContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, ''),
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }

    const nativeDoc: MemoryDocument = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Communication and collaboration preferences for working with Mahiro.',
      body: cursorContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, ''),
      readOnly: false,
      scope: 'global',
      tier: 'system',
    }

    const inspection: SharedSourceInspection = {
      enabled: true,
      sourceRoot: '/disposable/shared-source',
      sharedOwner: FIXED_SHARED_OWNER,
      valid: true,
      pinnedSha: 'b1f7b85cd49d43eaa7e36fa085ecd42600000000',
      diagnostics: [],
      content: lettaContent,
      document: sourceDoc,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, inspection)

    const phrase1 = 'Default conversational language: Thai'
    assert.equal(
      mergedDoc.body.split(phrase1).length - 1,
      1,
      'Default language phrase appears once',
    )

    const phrase2 = 'Concise Thai'
    assert.equal(mergedDoc.body.split(phrase2).length - 1, 1, 'Concise Thai appears once')

    const phrase3 = 'Recent response-quality correction:'
    assert.equal(mergedDoc.body.split(phrase3).length - 1, 1, 'Section heading appears once')

    const phrase4 = 'When Mahiro posts a screenshot and asks whether something is buggy'
    assert.equal(mergedDoc.body.split(phrase4).length - 1, 1, 'Screenshot clause appears once')

    const phrase5 = 'Mahiro, 2026-09-30'
    assert.equal(mergedDoc.body.split(phrase5).length - 1, 3, '2026-09-30 additions appear 3 times')

    const phrase6 = 'Imported from Mahiro Code'
    assert.equal(
      mergedDoc.body.split(phrase6).length - 1,
      0,
      'Import preamble is completely dropped',
    )
  })
})

describe('Shared Memory: Proposal Queue and Mutation Diversion', () => {
  it('creates atomic proposal outside versioned Git memory in state directory', () => {
    const tempHome = makeTempDir('proposals')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })

    const proposal = createSharedProposal({
      memoryRoot: memRoot,
      targetPath: FIXED_SHARED_OWNER,
      operation: 'write',
      sourceSha: '1111222233334444555566667777888899990000',
      content: 'Propose updating tone preference',
      description: 'Update communication tone',
      message: 'test author note',
    })

    assert.ok(proposal.id.startsWith('prop-shared-'))
    assert.equal(proposal.status, 'pending')
    assert.equal(proposal.targetPath, FIXED_SHARED_OWNER)
    assert.equal(proposal.operation, 'write')
    assert.equal(proposal.content, 'Propose updating tone preference')

    const list = listSharedProposals(memRoot)
    assert.equal(list.length, 1)
    assert.equal(list[0].id, proposal.id)

    const fetched = getSharedProposal(proposal.id, memRoot)
    assert.ok(fetched)
    assert.equal(fetched.description, 'Update communication tone')

    const exported = exportSharedProposal(proposal.id, memRoot)
    assert.ok(exported.includes('# Shared Memory Proposal:'))
    assert.ok(exported.includes('Propose updating tone preference'))

    const rejected = rejectSharedProposal(proposal.id, memRoot)
    assert.equal(rejected, true)
    assert.equal(listSharedProposals(memRoot).length, 0)
  })

  it('proposeMemoryUpdate diverts shared owner edits to proposal queue', () => {
    const tempHome = makeTempDir('propose-divert')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    const configPath = path.join(tempHome, 'config.json')

    saveSharedMemorySettings(
      {
        enabled: true,
        sourceRoot: '/path/to/source',
        sharedOwner: FIXED_SHARED_OWNER,
      },
      configPath,
      memRoot,
    )

    const prevConfigEnv = process.env.AGY_SHARED_MEMORY_CONFIG
    const prevMemDirEnv = process.env.AGY_MEMORY_DIR
    try {
      process.env.AGY_SHARED_MEMORY_CONFIG = configPath
      process.env.AGY_MEMORY_DIR = memRoot

      const result = proposeMemoryUpdate(
        FIXED_SHARED_OWNER,
        'Proposed communication update content',
        {
          reason: 'Diverted proposal test',
          author: 'Test Agent',
        },
      )

      assert.equal(result.status, 'PENDING_APPROVAL')
      assert.ok(result.proposalId)
      assert.ok(result.proposalId.startsWith('prop-shared-'))
      assert.ok(result.message.includes('Proposal created for'))

      const proposals = listSharedProposals(memRoot)
      assert.equal(proposals.length, 1)
      assert.equal(proposals[0].id, result.proposalId)
    } finally {
      restoreEnv('AGY_SHARED_MEMORY_CONFIG', prevConfigEnv)
      restoreEnv('AGY_MEMORY_DIR', prevMemDirEnv)
    }
  })

  it('detects stale proposal base revision when current source HEAD differs', () => {
    const tempHome = makeTempDir('stale-prop')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })

    const currentRepo = path.resolve(import.meta.dirname, '..')

    const proposal = createSharedProposal({
      memoryRoot: memRoot,
      targetPath: FIXED_SHARED_OWNER,
      operation: 'write',
      sourceSha: '0000000000000000000000000000000000000000', // Stale synthetic SHA
      content: 'Propose against old SHA',
    })

    const proposals = listSharedProposals(memRoot, currentRepo)
    assert.equal(proposals.length, 1)
    assert.equal(proposals[0].isStale, true)

    const exported = exportSharedProposal(proposal.id, memRoot, currentRepo)
    assert.ok(exported.includes('STALE BASE'))
  })

  it('rejects proposals with tampered targetPath, binds nativeOrigin to FIXED_SHARED_OWNER, and marks null sourceSha as ungrounded', () => {
    const tempHome = makeTempDir('tamper-prop')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    const currentRepo = path.resolve(import.meta.dirname, '..')

    const proposal = createSharedProposal({
      memoryRoot: memRoot,
      targetPath: 'some/arbitrary/path.md',
      operation: 'write',
      sourceSha: null,
      content: 'Propose content',
    })

    assert.equal(proposal.targetPath, FIXED_SHARED_OWNER)
    assert.equal(proposal.nativeOrigin.relativePath, FIXED_SHARED_OWNER)

    const proposals = listSharedProposals(memRoot, currentRepo)
    assert.equal(proposals.length, 1)
    assert.equal(proposals[0].isStale, true)
    assert.equal(proposals[0].isUngrounded, true)

    const exported = exportSharedProposal(proposal.id, memRoot, currentRepo)
    assert.ok(exported.includes('UNGROUNDED (no source SHA recorded)'))
    assert.equal(exported.includes('CURRENT'), false)

    // Simulate tampered proposal file with path traversal
    const propDir = resolveSharedProposalsDir(memRoot)
    const tamperedId = 'prop-shared-tampered'
    fs.writeFileSync(
      path.join(propDir, `${tamperedId}.json`),
      JSON.stringify({
        id: tamperedId,
        createdAt: new Date().toISOString(),
        targetPath: '../../../../etc/passwd',
        operation: 'write',
        sourceSha: 'stale-sha',
        nativeOrigin: { commitSha: null, relativePath: 'persona.md' },
        content: 'tampered payload',
        status: 'pending',
      }),
    )

    // listSharedProposals must filter out tampered proposal
    const safeProposals = listSharedProposals(memRoot, currentRepo)
    assert.equal(
      safeProposals.some((p) => p.id === tamperedId),
      false,
    )
    assert.equal(getSharedProposal(tamperedId, memRoot, currentRepo), null)
  })

  it('reviewProposal refuses to auto-commit shared memory proposals to native MemFS', () => {
    const tempHome = makeTempDir('review-shared')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    const configPath = path.join(tempHome, 'config.json')

    saveSharedMemorySettings(
      {
        enabled: true,
        sourceRoot: '/path/to/source',
        sharedOwner: FIXED_SHARED_OWNER,
      },
      configPath,
      memRoot,
    )

    const prevConfigEnv = process.env.AGY_SHARED_MEMORY_CONFIG
    const prevMemDirEnv = process.env.AGY_MEMORY_DIR
    try {
      process.env.AGY_SHARED_MEMORY_CONFIG = configPath
      process.env.AGY_MEMORY_DIR = memRoot

      // Create a dummy proposal in pending approvals that targets the shared owner
      const stateDir = path.join(`${memRoot}.state`, 'pending-approvals')
      fs.mkdirSync(stateDir, { recursive: true })
      const propId = 'prop-test-shared-1'
      const propFile = path.join(stateDir, `${propId}.json`)
      fs.writeFileSync(
        propFile,
        JSON.stringify({
          id: propId,
          targetRelPath: FIXED_SHARED_OWNER,
          oldContent: '',
          newContent: 'New content',
          reason: 'test',
          author: 'test',
          diff: '',
          createdAt: new Date().toISOString(),
        }),
      )

      assert.throws(
        () => reviewProposal(propId, 'approve'),
        /Shared memory proposals cannot be auto-committed into canonical source/,
      )
    } finally {
      restoreEnv('AGY_SHARED_MEMORY_CONFIG', prevConfigEnv)
      restoreEnv('AGY_MEMORY_DIR', prevMemDirEnv)
    }
  })
})

describe('Shared Memory: Write Preflights, Mixed Batches, and Blocking Copying', () => {
  it('writeMemoryFile, writeMemoryBuffer, and deleteMemoryFile refuse direct mutation on shared owner when enabled', () => {
    const tempHome = makeTempDir('repo-preflights')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    const configPath = path.join(tempHome, 'config.json')

    saveSharedMemorySettings(
      {
        enabled: true,
        sourceRoot: '/path/to/source',
        sharedOwner: FIXED_SHARED_OWNER,
      },
      configPath,
      memRoot,
    )

    const prevConfigEnv = process.env.AGY_SHARED_MEMORY_CONFIG
    try {
      process.env.AGY_SHARED_MEMORY_CONFIG = configPath

      assert.throws(
        () => writeMemoryFile(memRoot, FIXED_SHARED_OWNER, 'Direct write attempt'),
        /Refusing direct write: shared owner/,
      )

      assert.throws(
        () => writeMemoryBuffer(memRoot, FIXED_SHARED_OWNER, new Uint8Array([1, 2, 3])),
        /Refusing direct write: shared owner/,
      )

      assert.throws(
        () => deleteMemoryFile(memRoot, FIXED_SHARED_OWNER),
        /Refusing direct deletion: shared owner/,
      )
    } finally {
      restoreEnv('AGY_SHARED_MEMORY_CONFIG', prevConfigEnv)
    }
  })

  it('commitMemoryPaths preflights and refuses commits containing shared owner before staging', () => {
    const tempHome = makeTempDir('commit-preflights')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    const configPath = path.join(tempHome, 'config.json')

    saveSharedMemorySettings(
      {
        enabled: true,
        sourceRoot: '/path/to/source',
        sharedOwner: FIXED_SHARED_OWNER,
      },
      configPath,
      memRoot,
    )

    const prevConfigEnv = process.env.AGY_SHARED_MEMORY_CONFIG
    try {
      process.env.AGY_SHARED_MEMORY_CONFIG = configPath

      assert.throws(
        () =>
          commitMemoryPaths({
            memoryRoot: memRoot,
            relativePaths: ['system/persona.md', FIXED_SHARED_OWNER],
            reason: 'Mixed commit batch attempt',
          }),
        /Refusing memory commit: shared owner/,
      )
    } finally {
      restoreEnv('AGY_SHARED_MEMORY_CONFIG', prevConfigEnv)
    }
  })

  it('createExplicitProposalSet preflights and refuses mixed batches containing shared owner', () => {
    const tempHome = makeTempDir('explicit-mixed')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    const configPath = path.join(tempHome, 'config.json')

    saveSharedMemorySettings(
      {
        enabled: true,
        sourceRoot: '/path/to/source',
        sharedOwner: FIXED_SHARED_OWNER,
      },
      configPath,
      memRoot,
    )

    const prevConfigEnv = process.env.AGY_SHARED_MEMORY_CONFIG
    const prevMemDirEnv = process.env.AGY_MEMORY_DIR
    try {
      process.env.AGY_SHARED_MEMORY_CONFIG = configPath
      process.env.AGY_MEMORY_DIR = memRoot

      assert.throws(
        () =>
          createExplicitProposalSet([
            { targetRelPath: 'system/persona.md', newContent: 'Valid persona' },
            { targetRelPath: FIXED_SHARED_OWNER, newContent: 'Shared communication rewrite' },
          ]),
        /Refusing explicit proposal set: batch contains protected shared owner/,
      )
    } finally {
      restoreEnv('AGY_SHARED_MEMORY_CONFIG', prevConfigEnv)
      restoreEnv('AGY_MEMORY_DIR', prevMemDirEnv)
    }
  })

  it('planMemoryCuration refuses curation targeting or sourcing the shared owner', () => {
    const tempHome = makeTempDir('curation-shared')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    const configPath = path.join(tempHome, 'config.json')

    saveSharedMemorySettings(
      {
        enabled: true,
        sourceRoot: '/path/to/source',
        sharedOwner: FIXED_SHARED_OWNER,
      },
      configPath,
      memRoot,
    )

    const prevConfigEnv = process.env.AGY_SHARED_MEMORY_CONFIG
    try {
      process.env.AGY_SHARED_MEMORY_CONFIG = configPath

      assert.throws(
        () =>
          planMemoryCuration(memRoot, {
            schemaVersion: 1,
            id: 'curation-test',
            expectedHead: 'dummyhead',
            reason: 'Test curation',
            sources: [],
            targets: [{ relativePath: FIXED_SHARED_OWNER, content: 'curated content' }],
            dispositions: [],
          }),
        /Refusing curation: protected shared owner/,
      )
    } finally {
      restoreEnv('AGY_SHARED_MEMORY_CONFIG', prevConfigEnv)
    }
  })

  it('planLayeredMemoryMigration refuses migration targeting the shared owner', () => {
    const tempHome = makeTempDir('migration-shared')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    const configPath = path.join(tempHome, 'config.json')

    saveSharedMemorySettings(
      {
        enabled: true,
        sourceRoot: '/path/to/source',
        sharedOwner: FIXED_SHARED_OWNER,
      },
      configPath,
      memRoot,
    )

    const prevConfigEnv = process.env.AGY_SHARED_MEMORY_CONFIG
    try {
      process.env.AGY_SHARED_MEMORY_CONFIG = configPath

      assert.throws(
        () =>
          planLayeredMemoryMigration(memRoot, {
            schemaVersion: 1,
            id: 'migration-test',
            expectedHead: 'dummyhead',
            sources: [],
            targets: [{ relativePath: FIXED_SHARED_OWNER, content: 'migrated content' }],
            dispositions: [],
          }),
        /Refusing migration: protected shared owner/,
      )
    } finally {
      restoreEnv('AGY_SHARED_MEMORY_CONFIG', prevConfigEnv)
    }
  })

  it('planReflectionOperations rejects reflection operations rewriting the shared owner', () => {
    const tempHome = makeTempDir('reflection-shared')
    const configPath = path.join(tempHome, 'config.json')

    saveSharedMemorySettings(
      {
        enabled: true,
        sourceRoot: '/path/to/source',
        sharedOwner: FIXED_SHARED_OWNER,
      },
      configPath,
    )

    const prevConfigEnv = process.env.AGY_SHARED_MEMORY_CONFIG
    try {
      process.env.AGY_SHARED_MEMORY_CONFIG = configPath

      const snapshot = {
        files: [
          {
            path: FIXED_SHARED_OWNER,
            description: 'desc',
            body: 'body',
            scope: 'global' as const,
            tier: 'system' as const,
          },
        ],
      }

      assert.throws(
        () =>
          planReflectionOperations(
            {
              summary: 'test reflection',
              operations: [
                {
                  op: 'write',
                  path: FIXED_SHARED_OWNER,
                  description: 'desc',
                  body: 'Reflection rewriting shared communication',
                },
              ],
            },
            snapshot,
            'test-project',
          ),
        /Protected shared owner system\/human\/prefs\/communication.md cannot be rewritten during reflection/,
      )
    } finally {
      restoreEnv('AGY_SHARED_MEMORY_CONFIG', prevConfigEnv)
    }
  })

  it('blocks copying known shared paragraphs into other native memory files', () => {
    const inspection: SharedSourceInspection = {
      enabled: true,
      sourceRoot: '/path/to/source',
      sharedOwner: FIXED_SHARED_OWNER,
      valid: true,
      pinnedSha: '1234567890abcdef1234567890abcdef12345678',
      diagnostics: [],
      content:
        '---\ndescription: Communication\n---\n### Tone\nAlways respond in concise English and avoid unnecessary verbosity.\n',
      document: null,
    }

    const copiedContent =
      '---\ndescription: Project rules\n---\nAlways respond in concise English and avoid unnecessary verbosity.\n'

    const copies = findSharedParagraphCopies(copiedContent, inspection)
    assert.ok(copies.length > 0)
    assert.equal(copies[0], 'Always respond in concise English and avoid unnecessary verbosity.')

    assert.throws(
      () =>
        assertNoSharedParagraphCopies(copiedContent, 'projects/test/system/rules.md', inspection),
      /contains known shared communication paragraph/,
    )

    // Distinct content is not blocked
    const distinctContent =
      '---\ndescription: Project rules\n---\nUse PostgreSQL for database storage.\n'
    assert.doesNotThrow(() =>
      assertNoSharedParagraphCopies(distinctContent, 'projects/test/system/rules.md', inspection),
    )
  })

  it('restoreDeclaredMemoryPaths refuses restoring shared owner when shared memory is enabled', () => {
    const tempHome = makeTempDir('restore-guard')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: memRoot })

    const configPath = path.join(tempHome, 'config.json')
    saveSharedMemorySettings(
      {
        enabled: true,
        sourceRoot: '/path/to/source',
        sharedOwner: FIXED_SHARED_OWNER,
      },
      configPath,
      memRoot,
    )

    const prevConfigEnv = process.env.AGY_SHARED_MEMORY_CONFIG
    try {
      process.env.AGY_SHARED_MEMORY_CONFIG = configPath

      assert.throws(
        () =>
          restoreDeclaredMemoryPaths(memRoot, '0123456789abcdef0123456789abcdef01234567', [
            FIXED_SHARED_OWNER,
          ]),
        /Refusing restore: shared owner/,
      )
    } finally {
      restoreEnv('AGY_SHARED_MEMORY_CONFIG', prevConfigEnv)
    }
  })
})

describe('Shared Memory: Projection, Hook Integration, and Rollback', () => {
  it('disabled mode preserves exact existing projection and does not add diagnostics', () => {
    const tempHome = makeTempDir('proj-disabled')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })

    const proj = inspectCommittedMemoryProjection(memRoot, 'test-slug', {
      enabled: false,
      sourceRoot: null,
      sharedOwner: FIXED_SHARED_OWNER,
    })

    assert.equal(proj.sharedSource, null)
    assert.deepEqual(proj.diagnostics, [])
  })

  it('enabled mode with invalid source records visible diagnostics in projection and rendered sections', () => {
    const tempHome = makeTempDir('proj-invalid')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })

    const proj = inspectCommittedMemoryProjection(memRoot, 'test-slug', {
      enabled: true,
      sourceRoot: '/path/does/not/exist/at/all',
      sharedOwner: FIXED_SHARED_OWNER,
    })

    assert.equal(proj.sharedSource, null)
    assert.ok(proj.diagnostics.length > 0)
    assert.ok(proj.diagnostics.some((d) => d.includes('does not exist')))

    const sections = renderCommittedMemorySections(memRoot, proj)
    const combined = sections.join('')
    assert.ok(combined.includes('Layered Memory Diagnostics'))
    assert.ok(combined.includes('does not exist'))
  })

  it('PreInvocation hook injects projected shared memory within budget and authority boundary', () => {
    const tempHome = makeTempDir('hook-test')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })

    // Create a mock source Git repository for testing
    const sourceDir = makeTempDir('source-repo')
    // We can use a dummy inspection object directly through mock settings
    const sharedDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared communication prefs',
      body: 'Always respond in concise English with bullet points.',
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }

    const dummyInspection: SharedSourceInspection = {
      enabled: true,
      sourceRoot: sourceDir,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: true,
      pinnedSha: 'abcdef1234567890abcdef1234567890abcdef12',
      diagnostics: [],
      content:
        '---\ndescription: Shared communication prefs\n---\nAlways respond in concise English with bullet points.\n',
      document: sharedDoc,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sharedDoc, null, dummyInspection)

    const projection = {
      mode: 'layered' as const,
      revision: 'headsha12345678',
      projectSlug: 'hook-project',
      globalSystem: [mergedDoc],
      projectSystem: [],
      external: [],
      diagnostics: [],
      legacyPaths: [],
      layeredPaths: [FIXED_SHARED_OWNER],
      sharedSource: {
        sourceRoot: sourceDir,
        pinnedSha: dummyInspection.pinnedSha ?? '',
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }

    const rendered = renderCommittedMemorySections(memRoot, projection)
    assert.ok(rendered.some((s) => s.includes(FIXED_SHARED_OWNER)))
    assert.ok(
      rendered.some((s) => s.includes('Always respond in concise English with bullet points.')),
    )
    assert.ok(rendered.some((s) => s.includes('<!-- Shared communication from')))
  })

  it('disabling shared memory rolls back projection to native memory only', () => {
    const tempHome = makeTempDir('rollback-test')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    const configPath = path.join(tempHome, 'config.json')

    saveSharedMemorySettings(
      {
        enabled: true,
        sourceRoot: '/some/source',
        sharedOwner: FIXED_SHARED_OWNER,
      },
      configPath,
      memRoot,
    )
    assert.equal(loadSharedMemorySettings(configPath, memRoot).enabled, true)

    // Disable rollback
    saveSharedMemorySettings(
      {
        enabled: false,
        sourceRoot: null,
        sharedOwner: FIXED_SHARED_OWNER,
      },
      configPath,
      memRoot,
    )
    const afterRollback = loadSharedMemorySettings(configPath, memRoot)
    assert.equal(afterRollback.enabled, false)

    const proj = inspectCommittedMemoryProjection(memRoot, 'test-slug', afterRollback)
    assert.equal(proj.sharedSource, null)
    assert.deepEqual(proj.diagnostics, [])
  })
})

describe('Shared Memory: Defect Regressions and Disposable Acceptance Probes', () => {
  it('preserves hierarchical list ownership and retains nested sub-bullets under different topics', () => {
    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared source',
      body: '- Topic A\n  - Details',
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }
    const nativeDoc: MemoryDocument = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native addition',
      body: '- Topic B\n  - Details',
      readOnly: false,
      scope: 'global',
      tier: 'system',
    }
    const inspection: SharedSourceInspection = {
      enabled: true,
      sourceRoot: '/path/to/source',
      sharedOwner: FIXED_SHARED_OWNER,
      valid: true,
      pinnedSha: '0123456789abcdef0123456789abcdef01234567',
      diagnostics: [],
      content: sourceDoc.body,
      document: sourceDoc,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, inspection)
    // Must retain both Topic B and Details
    assert.ok(mergedDoc.body.includes('- Topic B'))
    assert.ok(mergedDoc.body.includes('- Details'))
    // Source Topic A must also be retained
    assert.ok(mergedDoc.body.includes('- Topic A'))
  })

  it('compares equivalent kinds and does not compare unrelated native paragraph against source list', () => {
    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared source',
      body: '## Invariants\n\n- Item 1\n\nSome explanatory text under Invariants.',
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }
    const nativeDoc: MemoryDocument = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native addition',
      body: '## Invariants\n\n- Item 1\n\nSome different explanatory text under Invariants.',
      readOnly: false,
      scope: 'global',
      tier: 'system',
    }
    const inspection: SharedSourceInspection = {
      enabled: true,
      sourceRoot: '/path/to/source',
      sharedOwner: FIXED_SHARED_OWNER,
      valid: true,
      pinnedSha: '0123456789abcdef0123456789abcdef01234567',
      diagnostics: [],
      content: sourceDoc.body,
      document: sourceDoc,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, inspection)
    // Must NOT compare '- Item 1' against 'Some different explanatory text'
    assert.equal(mergedDoc.body.includes('Shared source: "- Item 1"'), false)
    // Must compare paragraph to paragraph
    assert.ok(mergedDoc.body.includes('Shared source: "Some explanatory text under Invariants."'))
    assert.ok(
      mergedDoc.body.includes(
        'Native addition: "Some different explanatory text under Invariants."',
      ),
    )
  })

  it('preserves disposable Agy-shaped labels without orphan headers or duplicate screenshot clauses', () => {
    const lettaContent = [
      '# Communication',
      '',
      '- When Mahiro posts a screenshot and asks whether something is buggy, clarify the target.',
    ].join('\n')
    const agyContent = [
      lettaContent,
      '',
      'Agy carry-forward invariants:',
      '- Default to concise Thai for user-facing messages',
      '',
      'Agy-specific reporting:',
      '- Distinguish the current Agy conversation from external execution.',
    ].join('\n')

    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Communication and collaboration preferences for working with Mahiro.',
      body: lettaContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, ''),
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }

    const nativeDoc: MemoryDocument = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: "Durable communication preferences adapted for Mahiro's Agy companion.",
      body: agyContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, ''),
      readOnly: false,
      scope: 'global',
      tier: 'system',
    }

    const inspection: SharedSourceInspection = {
      enabled: true,
      sourceRoot: '/disposable/shared-source',
      sharedOwner: FIXED_SHARED_OWNER,
      valid: true,
      pinnedSha: '0123456789abcdef0123456789abcdef01234567',
      diagnostics: [],
      content: lettaContent,
      document: sourceDoc,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, inspection)

    // 1. Native labels retained with content
    assert.ok(mergedDoc.body.includes('Agy carry-forward invariants:'))
    assert.ok(mergedDoc.body.includes('Agy-specific reporting:'))
    assert.ok(mergedDoc.body.includes('Default to concise Thai for user-facing messages'))
    assert.ok(mergedDoc.body.includes('Distinguish the current Agy conversation'))

    // 2. No orphan '# Communication' under Native Runtime Additions
    const additionsIndex = mergedDoc.body.indexOf('### Native Runtime Additions')
    if (additionsIndex !== -1) {
      const additionsSection = mergedDoc.body.slice(additionsIndex)
      assert.equal(additionsSection.includes('# Communication\n'), false)
      assert.equal(additionsSection.includes('\n# Communication'), false)
    }

    // 3. Source SHA appears once in provenance comment
    const provenanceMatches = mergedDoc.body.match(/0123456789abcdef0123456789abcdef01234567/g)
    assert.equal(provenanceMatches?.length, 1)

    // 4. Common screenshot clause appears once
    const screenshotMatches = mergedDoc.body.match(
      /When Mahiro posts a screenshot and asks whether something is buggy/g,
    )
    assert.equal(screenshotMatches?.length, 1)

    // 5. Total step bytes <= 40000
    const byteLength = Buffer.byteLength(mergedDoc.body, 'utf-8')
    assert.ok(byteLength <= 40000, `Step byte length ${byteLength} must be <= 40000`)
  })

  it('rejects sourceRoot pointing to git subdirectory or memory repository ancestor/subtree', () => {
    const tempHome = makeTempDir('root-validation')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: memRoot })

    // Test git subdirectory rejection
    const subRepoDir = path.join(tempHome, 'repo')
    const subDir = path.join(subRepoDir, 'nested', 'sub')
    fs.mkdirSync(subDir, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: subRepoDir })

    const subInspection = inspectSharedSource(
      { enabled: true, sourceRoot: subDir, sharedOwner: FIXED_SHARED_OWNER },
      memRoot,
    )
    assert.equal(subInspection.valid, false)
    assert.ok(
      subInspection.diagnostics.some((d) =>
        d.includes('is a subdirectory of a Git repository, not the top-level root'),
      ),
    )

    // Test memory repository subtree rejection
    const memSubDir = path.join(memRoot, 'system', 'human')
    fs.mkdirSync(memSubDir, { recursive: true })
    const subtreeInspection = inspectSharedSource(
      { enabled: true, sourceRoot: memSubDir, sharedOwner: FIXED_SHARED_OWNER },
      memRoot,
    )
    assert.equal(subtreeInspection.valid, false)
    assert.ok(
      subtreeInspection.diagnostics.some((d) =>
        d.includes('cannot be the native memory repository itself or its ancestor/subtree'),
      ),
    )

    // Test memory repository ancestor rejection
    const ancestorInspection = inspectSharedSource(
      { enabled: true, sourceRoot: tempHome, sharedOwner: FIXED_SHARED_OWNER },
      memRoot,
    )
    assert.equal(ancestorInspection.valid, false)
    assert.ok(
      ancestorInspection.diagnostics.some((d) =>
        d.includes('cannot be the native memory repository itself or its ancestor/subtree'),
      ),
    )
  })

  it('labels memory search results in merged shared document as virtual', () => {
    const tempHome = makeTempDir('search-virtual')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: memRoot })

    // Write a dummy committed file in native memory
    const prefsDir = path.join(memRoot, 'system', 'human', 'prefs')
    fs.mkdirSync(prefsDir, { recursive: true })
    writeMemoryFile(
      memRoot,
      FIXED_SHARED_OWNER,
      '# Communication\n\nNative unique phrase: banana-cat-strawberry\n',
    )
    commitMemoryPaths({
      memoryRoot: memRoot,
      relativePaths: [FIXED_SHARED_OWNER],
      reason: 'init communication',
    })

    // Setup source repo
    const sourceRepo = path.join(tempHome, 'source-repo')
    const sourcePrefsDir = path.join(sourceRepo, 'system', 'human', 'prefs')
    fs.mkdirSync(sourcePrefsDir, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: sourceRepo })
    fs.writeFileSync(
      path.join(sourceRepo, FIXED_SHARED_OWNER),
      '---\ndescription: Shared prefs\n---\nShared unique phrase: banana-cat-strawberry\n',
    )
    execFileSync('git', ['add', '.'], { cwd: sourceRepo })
    execFileSync('git', ['commit', '-m', 'add shared communication'], { cwd: sourceRepo })

    saveSharedMemorySettings(
      { enabled: true, sourceRoot: sourceRepo, sharedOwner: FIXED_SHARED_OWNER },
      undefined,
      memRoot,
    )

    const matches = searchMemory('banana-cat-strawberry', { memoryRoot: memRoot })
    assert.ok(matches.length > 0)
    const virtualMatch = matches.find((m) => m.relPath === FIXED_SHARED_OWNER)
    assert.ok(virtualMatch)
    assert.equal(virtualMatch.isVirtual, true)
    assert.ok(virtualMatch.virtualLabel?.includes('virtual'))
  })

  it('rejects malformed proposal shapes during listing and preserves runtime protection floor', () => {
    const tempHome = makeTempDir('schema-val')
    const memRoot = path.join(tempHome, 'memory')
    fs.mkdirSync(memRoot, { recursive: true })

    const propDir = resolveSharedProposalsDir(memRoot)
    fs.mkdirSync(propDir, { recursive: true, mode: 0o700 })

    // 1. Missing required fields
    fs.writeFileSync(
      path.join(propDir, 'prop-shared-missing.json'),
      JSON.stringify({ id: 'prop-shared-1' }),
    )
    // 2. Invalid operation
    fs.writeFileSync(
      path.join(propDir, 'prop-shared-bad-op.json'),
      JSON.stringify({
        id: 'prop-shared-bad-op',
        createdAt: new Date().toISOString(),
        targetPath: FIXED_SHARED_OWNER,
        operation: 'drop-database',
        sourceSha: '0123456789abcdef0123456789abcdef01234567',
        nativeOrigin: { commitSha: null, relativePath: FIXED_SHARED_OWNER },
        content: 'test',
        status: 'pending',
      }),
    )
    // 3. Non-40 hex SHA
    fs.writeFileSync(
      path.join(propDir, 'prop-shared-bad-sha.json'),
      JSON.stringify({
        id: 'prop-shared-bad-sha',
        createdAt: new Date().toISOString(),
        targetPath: FIXED_SHARED_OWNER,
        operation: 'write',
        sourceSha: 'not-a-valid-sha',
        nativeOrigin: { commitSha: null, relativePath: FIXED_SHARED_OWNER },
        content: 'test',
        status: 'pending',
      }),
    )

    const list = listSharedProposals(memRoot)
    assert.equal(list.length, 0, 'Malformed proposals must be ignored by listSharedProposals')

    // Test runtime protection floor
    saveSharedMemorySettings(
      { enabled: true, sourceRoot: '/path', sharedOwner: FIXED_SHARED_OWNER },
      undefined,
      memRoot,
    )
    // Override attempting to weaken protection
    const effective = resolveEffectiveSharedMemorySettings({ enabled: false }, memRoot)
    assert.equal(effective.enabled, true, 'Override cannot weaken live runtime-enabled protection')

    // Null safety
    const safeNull = resolveEffectiveSharedMemorySettings({ sourceRoot: null }, memRoot)
    assert.equal(safeNull.sourceRoot, null)
  })

  it('preserves both source list and native distinct plain paragraph under the same heading', () => {
    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared source',
      body: '## Rules\n\n- Shared rule 1\n- Shared rule 2',
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }
    const nativeDoc: MemoryDocument = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native addition',
      body: '## Rules\n\nThis is a distinct plain paragraph describing rules.',
      readOnly: false,
      scope: 'global',
      tier: 'system',
    }
    const dummyInspection: SharedSourceInspection = {
      enabled: true,
      sourceRoot: '/disposable/shared-source',
      sharedOwner: FIXED_SHARED_OWNER,
      valid: true,
      pinnedSha: 'abcdef1234567890abcdef1234567890abcdef12',
      diagnostics: [],
      content: sourceDoc.body,
      document: sourceDoc,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)
    // Source list must be retained
    assert.ok(mergedDoc.body.includes('- Shared rule 1'))
    assert.ok(mergedDoc.body.includes('- Shared rule 2'))
    // Native distinct plain paragraph must be retained
    assert.ok(mergedDoc.body.includes('This is a distinct plain paragraph describing rules.'))
  })

  it('preserves distinct native intro before its list when source has a list under the same heading', () => {
    const sourceDoc: MemoryDocument = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared source',
      body: '## Rules\n\n- Shared rule 1\n- Shared rule 2',
      readOnly: true,
      scope: 'global',
      tier: 'system',
    }
    const nativeDoc: MemoryDocument = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native addition',
      body: '## Rules\n\nDistinct native intro before its list.\n- Native rule A',
      readOnly: false,
      scope: 'global',
      tier: 'system',
    }
    const dummyInspection: SharedSourceInspection = {
      enabled: true,
      sourceRoot: '/disposable/shared-source',
      sharedOwner: FIXED_SHARED_OWNER,
      valid: true,
      pinnedSha: 'abcdef1234567890abcdef1234567890abcdef12',
      diagnostics: [],
      content: sourceDoc.body,
      document: sourceDoc,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)
    // Both source list and native list item must be retained
    assert.ok(mergedDoc.body.includes('- Shared rule 1'))
    assert.ok(mergedDoc.body.includes('- Native rule A'))
    // Distinct native intro before its list MUST be retained
    assert.ok(mergedDoc.body.includes('Distinct native intro before its list.'))
    // The intro must appear before '- Native rule A'
    const introIndex = mergedDoc.body.indexOf('Distinct native intro before its list.')
    const bulletIndex = mergedDoc.body.indexOf('- Native rule A')
    assert.ok(introIndex < bulletIndex, 'Intro must appear before its list items')
  })
})
