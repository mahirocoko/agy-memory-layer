#!/usr/bin/env node

/**
 * Persona Switcher for agy-memory-layer (/persona)
 * Manages switching, inspecting, and customizing agent personality presets in ~/.gemini/memory/global/persona.md
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseMemoryDocument } from './layered-memory.ts'
import { extractDurableSourceUnits } from './layered-memory-migration.ts'
import { proposeMemoryUpdate } from './memory-approval.ts'
import { proposeMemoryCuration } from './memory-curation.ts'
import {
  committedMemoryPathExists,
  getMemoryHeadRevision,
  readCommittedMemoryFile,
} from './memory-repository.ts'

export type PersonaPreset = {
  name: string
  description: string
  content: string
}

const memoryRoot =
  process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')
const PROMPTS_PERSONA_DIR = path.resolve(import.meta.dirname, '..', 'prompts', 'persona')

const getPersonaRelativePath = (): string =>
  committedMemoryPathExists(memoryRoot, 'system/persona.md')
    ? 'system/persona.md'
    : 'global/persona.md'

export const PERSONA_PRESETS: Record<string, PersonaPreset> = {
  memo: {
    name: 'Letta Code (Default)',
    description:
      'The memory-first pair programmer. Warm, grounded, low filler, reality first, builds continuous identity over time.',
    content: loadPromptFile(
      'memo.md',
      '# Agent Persona\n\nYou are a stateful, memory-first pair programmer.',
    ),
  },
  linus: {
    name: 'Linus (Stern Code Quality Master)',
    description:
      'Direct, uncompromising on performance, cleanliness, and code quality. Zero fluff, brutal honesty, maximum clarity.',
    content: loadPromptFile(
      'linus.md',
      '# Agent Persona: Linus Mode\n\nDirect, pragmatic, zero filler.',
    ),
  },
  tutor: {
    name: 'Tutor (Educational & Socratic)',
    description:
      'Patient teacher who explains concepts, asks guiding questions, and builds deep understanding.',
    content: loadPromptFile(
      'tutor.md',
      '# Agent Persona: Tutor\n\nEducational, thoughtful, patient mentor.',
    ),
  },
  architect: {
    name: 'Software Architect',
    description:
      'Systems thinker focused on modularity, clean boundaries, scalability, and maintainability.',
    content: loadPromptFile(
      'architect.md',
      '# Agent Persona: Software Architect\n\nSystems thinking and clean boundaries.',
    ),
  },
  kawaii: {
    name: 'Kawaii Companion',
    description: 'Cheerful, supportive, and energetic coding companion.',
    content: loadPromptFile(
      'kawaii.md',
      '# Agent Persona: Kawaii\n\nFriendly and energetic companion.',
    ),
  },
  blank: {
    name: 'Blank / Minimal',
    description: 'Clean slate without preset steering.',
    content: loadPromptFile('blank.md', '# Agent Persona\n\nStandard assistant mode.'),
  },
}

function loadPromptFile(filename: string, fallback: string): string {
  try {
    const fullPath = path.join(PROMPTS_PERSONA_DIR, filename)
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf-8')
    }
  } catch {}
  return fallback
}

export function getActivePersona(): {
  content: string
  presetName: string | null
} {
  const relativePath = getPersonaRelativePath()
  const committedContent = readCommittedMemoryFile(memoryRoot, relativePath)
  if (committedContent === null) {
    return { content: '', presetName: null }
  }
  const content = relativePath.startsWith('system/')
    ? parseMemoryDocument(committedContent, relativePath, { requireDescription: true }).body
    : committedContent
  let detectedPreset: string | null = null

  for (const [key, preset] of Object.entries(PERSONA_PRESETS)) {
    if (content.trim() === preset.content.trim()) {
      detectedPreset = key
      break
    }
  }

  return { content, presetName: detectedPreset }
}

export function switchPersona(presetKey: string): {
  success: boolean
  preset: PersonaPreset
  proposalId?: string
  proposalStatus?: 'PENDING_APPROVAL' | 'COMMITTED'
  error?: string
} {
  const key = presetKey.toLowerCase().trim()
  const preset = PERSONA_PRESETS[key]

  if (!preset) {
    return {
      success: false,
      preset: PERSONA_PRESETS.memo,
      error: `Unknown persona "${presetKey}". Available: ${Object.keys(PERSONA_PRESETS).join(', ')}`,
    }
  }

  const relativePath = getPersonaRelativePath()
  const nextContent = relativePath.startsWith('system/')
    ? `---\ndescription: Persistent agent identity and behavior.\n---\n${preset.content.trim()}\n`
    : preset.content
  const oldContent = readCommittedMemoryFile(memoryRoot, relativePath)
  if (oldContent === null || oldContent.trim() === nextContent.trim()) {
    const proposal = proposeMemoryUpdate(relativePath, nextContent, {
      reason: `Switch agent persona to '${key}' (${preset.name})`,
      author: 'Antigravity Persona',
    })
    return {
      success: true,
      preset,
      proposalId: proposal.proposalId,
      proposalStatus: proposal.status,
    }
  }

  const curationId = `persona-${key}-${Date.now().toString(36)}`
  const sourceUnits = extractDurableSourceUnits(relativePath, oldContent)
  const proposal = proposeMemoryCuration(memoryRoot, {
    schemaVersion: 1,
    id: curationId,
    expectedHead: getMemoryHeadRevision(memoryRoot) || '',
    reason: `Switch agent persona to '${key}' (${preset.name})`,
    author: 'Antigravity Persona',
    sources: [
      {
        relativePath,
        sha256: crypto.createHash('sha256').update(oldContent).digest('hex'),
      },
    ],
    targets: [{ relativePath, content: nextContent }],
    dispositions: sourceUnits.map((unit) => ({
      sourcePath: relativePath,
      sourceUnitId: unit.id,
      destinationPath: `archives/curations/${curationId}/source/${relativePath}`,
      state: 'historical',
      reason: 'Preserve the exact prior persona before activating a reviewed replacement.',
    })),
  })
  return {
    success: true,
    preset,
    proposalId: proposal.id,
    proposalStatus: 'PENDING_APPROVAL',
  }
}

if (process.argv[1]?.endsWith('switch-persona.ts')) {
  const args = process.argv.slice(2)
  const cmd = args[0] || 'status'

  if (cmd === 'list' || cmd === '--list') {
    console.log('\n🎭 Available Persona Presets:\n')
    const { presetName } = getActivePersona()
    for (const [key, p] of Object.entries(PERSONA_PRESETS)) {
      const activeMark = key === presetName ? ' ⭐ (ACTIVE)' : ''
      console.log(`- **${key}** (${p.name})${activeMark}`)
      console.log(`  ${p.description}\n`)
    }
  } else if (cmd === 'status' || cmd === '--status') {
    const { content, presetName } = getActivePersona()
    const personaMdPath = path.join(memoryRoot, getPersonaRelativePath())
    console.log('\n🎭 Current Persona Status:\n')
    if (presetName && PERSONA_PRESETS[presetName]) {
      console.log(`- Active Preset: **${presetName}** (${PERSONA_PRESETS[presetName].name})`)
      console.log(`- Description: ${PERSONA_PRESETS[presetName].description}`)
    } else {
      console.log('- Active Preset: Custom / Unmatched')
    }
    console.log(`- File Location: ${personaMdPath}`)
    console.log(`- Content Length: ${content.length} characters\n`)
  } else {
    const target = cmd
    const res = switchPersona(target)
    if (res.success) {
      console.log(`\n✓ Persona update prepared for '${target}' (${res.preset.name}).`)
      console.log(`  Description: ${res.preset.description}`)
      console.log(`  Status: ${res.proposalStatus}`)
      if (res.proposalId) console.log(`  Proposal: ${res.proposalId}`)
      console.log('  The active persona changes only after explicit approval and commit.\n')
    } else {
      console.error(`\n❌ Error: ${res.error}\n`)
      process.exit(1)
    }
  }
}
