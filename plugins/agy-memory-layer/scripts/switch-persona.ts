#!/usr/bin/env node

/**
 * Persona Switcher for agy-memory-layer (/persona)
 * Manages switching, inspecting, and customizing agent personality presets in ~/.gemini/memory/global/persona.md
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type PersonaPreset = {
  name: string
  description: string
  content: string
}

const memoryRoot =
  process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')
const personaMdPath = path.join(memoryRoot, 'global', 'persona.md')
const PROMPTS_PERSONA_DIR = path.resolve(import.meta.dirname, '..', 'prompts', 'persona')

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
  if (!fs.existsSync(personaMdPath)) {
    return { content: '', presetName: null }
  }
  const content = fs.readFileSync(personaMdPath, 'utf-8')
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

  const globalDir = path.join(memoryRoot, 'global')
  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true })
  }

  fs.writeFileSync(personaMdPath, preset.content, 'utf-8')

  // Auto-commit to MemFS Git
  try {
    if (fs.existsSync(path.join(memoryRoot, '.git'))) {
      execSync('git add global/persona.md', { cwd: memoryRoot, stdio: 'ignore' })
      const status = execSync('git status --porcelain', {
        cwd: memoryRoot,
        encoding: 'utf-8',
      }).trim()
      if (status) {
        execSync(
          `git commit -m "chore(persona): switch agent persona to '${key}' (${preset.name})"`,
          { cwd: memoryRoot, stdio: 'ignore' },
        )
      }
    }
  } catch {}

  return { success: true, preset }
}

if (process.argv[1] && process.argv[1].endsWith('switch-persona.ts')) {
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
      console.log(`\n✓ Agent persona successfully switched to '${target}' (${res.preset.name})!`)
      console.log(`  Description: ${res.preset.description}`)
      console.log(`  Updated: ${personaMdPath}\n`)
    } else {
      console.error(`\n❌ Error: ${res.error}\n`)
      process.exit(1)
    }
  }
}
