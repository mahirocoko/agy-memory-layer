#!/usr/bin/env node

/**
 * Subagent Helper & Manifest Resolver for agy-memory-layer
 * Loads subagent configurations from agents/*.json and resolves system prompts from prompts/subagents/*.md
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export type SubagentModelTier = 'inherit' | 'flash_lite' | 'flash' | 'pro'

export type SubagentConfig = {
  name: string
  description: string
  role: string
  model_tier?: SubagentModelTier
  enable_write_tools?: boolean
  enable_mcp_tools?: boolean
  enable_subagent_tools?: boolean
  system_prompt_file?: string
}

export type ResolvedSubagent = {
  name: string
  role: string
  description: string
  modelTier: SubagentModelTier
  enableWriteTools: boolean
  enableMcpTools: boolean
  enableSubagentTools: boolean
  systemPrompt: string
}

const AGENTS_DIR = path.resolve(import.meta.dirname, '..', 'agents')

export function listSubagents(): ResolvedSubagent[] {
  if (!fs.existsSync(AGENTS_DIR)) return []
  const files = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.json'))
  const subagents: ResolvedSubagent[] = []

  for (const f of files) {
    try {
      const fullPath = path.join(AGENTS_DIR, f)
      const conf: SubagentConfig = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))

      let systemPrompt = ''
      if (conf.system_prompt_file) {
        const promptPath = path.resolve(AGENTS_DIR, conf.system_prompt_file)
        if (fs.existsSync(promptPath)) {
          systemPrompt = fs.readFileSync(promptPath, 'utf-8')
        }
      }

      subagents.push({
        name: conf.name,
        role: conf.role,
        description: conf.description,
        modelTier: conf.model_tier || 'inherit',
        enableWriteTools: Boolean(conf.enable_write_tools),
        enableMcpTools: Boolean(conf.enable_mcp_tools),
        enableSubagentTools: Boolean(conf.enable_subagent_tools),
        systemPrompt,
      })
    } catch {}
  }

  return subagents
}

export function getSubagent(name: string): ResolvedSubagent | null {
  const all = listSubagents()
  return (
    all.find((a) => a.name === name || a.role.toLowerCase().includes(name.toLowerCase())) || null
  )
}

if (process.argv[1] && process.argv[1].endsWith('agent-launcher.ts')) {
  const args = process.argv.slice(2)
  const cmd = args[0] || 'list'

  if (cmd === 'list') {
    console.log('\n🤖 Registered Antigravity Subagents in Plugin:\n')
    listSubagents().forEach((s, i) => {
      console.log(`[${i + 1}] 🏷️  Name: ${s.name} (${s.role})`)
      console.log(`    📝 ${s.description}`)
      console.log(`    ⚙️  Model: ${s.modelTier} | Write Tools: ${s.enableWriteTools}\n`)
    })
  } else if (cmd === 'get') {
    const target = args[1]
    const sub = getSubagent(target)
    if (sub) {
      console.log(JSON.stringify(sub, null, 2))
    } else {
      console.error(`❌ Subagent "${target}" not found.`)
      process.exit(1)
    }
  }
}
