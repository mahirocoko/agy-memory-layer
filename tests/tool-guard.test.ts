import * as assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import {
  classifyCommandLine,
  classifyWriteTarget,
  evaluatePreToolUse,
  type PreToolUsePayload,
} from '../plugins/agy-memory-layer/scripts/tool-guard.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const HOOK = path.join(ROOT, 'plugins', 'agy-memory-layer', 'scripts', 'hook-pre-tool-use.ts')

function evaluateGit(command: string, workspacePaths: string[] = [ROOT]) {
  return evaluatePreToolUse({
    toolCall: { name: 'run_command', args: { CommandLine: command } },
    workspacePaths,
  })
}

describe('atomic PreToolUse confirmation request gate', () => {
  it('denies ambiguous gated bundles while preserving quoted separators', () => {
    assert.strictEqual(classifyCommandLine('git commit -m one && git push').decision, 'deny')
    assert.strictEqual(classifyCommandLine('git status; git commit -m one').decision, 'deny')
    assert.strictEqual(
      classifyCommandLine('git -C /tmp/one commit -m one; git -C /tmp/two commit -m two').decision,
      'deny',
    )
    assert.strictEqual(
      classifyCommandLine("git commit -m 'message; still one'").decision,
      'force_ask',
    )
    assert.strictEqual(classifyCommandLine('git status && git log -1').decision, 'ask')
    assert.strictEqual(classifyCommandLine('if true; then git commit -m x; fi').decision, 'deny')
    assert.strictEqual(classifyCommandLine("echo 'if true; then literal; fi'").decision, 'ask')
  })

  it('gates newly covered Git mutations and preserves read-only forms', () => {
    const mutations = [
      'git add file',
      'git update-ref refs/heads/main HEAD',
      'git symbolic-ref HEAD refs/heads/main',
      'git config user.name Mahiro',
      'git notes add -m note',
      'git replace HEAD HEAD~1',
      'git branch feature',
      'git branch -d feature',
      'git branch -m old new',
      'git fetch origin',
      'git init',
      'git gc',
      'git reflog write refs/heads/main 0123456789012345678901234567890123456789 old',
      'git update-index --assume-unchanged file',
      'git hash-object -w file',
    ]
    for (const command of mutations) {
      assert.strictEqual(classifyCommandLine(command).decision, 'force_ask', command)
    }

    const reads = [
      'git status',
      'git diff',
      'git log -1',
      'git show HEAD',
      'git rev-parse HEAD',
      'git ls-files',
      'git grep needle',
      'git cat-file -t HEAD',
      'git check-ignore file',
      'git for-each-ref',
      'git merge-base HEAD main',
      'git describe --always',
      'git blame file',
      'git shortlog',
      'git version',
      'git help status',
      'git count-objects',
      'git config --get user.name',
      'git config user.name',
      'git notes list',
      'git notes show HEAD',
      'git replace -l',
      'git branch --list',
      'git symbolic-ref HEAD',
      'git hash-object file',
    ]
    for (const command of reads)
      assert.strictEqual(classifyCommandLine(command).decision, 'ask', command)

    assert.strictEqual(classifyCommandLine('git update-ref -d refs/heads/x').decision, 'deny')
    assert.strictEqual(classifyCommandLine('git gc --prune=now').decision, 'deny')
    assert.strictEqual(classifyCommandLine('git branch -D feature').decision, 'deny')
    assert.strictEqual(classifyCommandLine('git upload').decision, 'deny')
    assert.strictEqual(classifyCommandLine('git custom-helper action').decision, 'deny')
    assert.strictEqual(
      classifyCommandLine("git -c alias.publish='commit' publish").decision,
      'deny',
    )
    assert.strictEqual(
      classifyCommandLine('git --git-dir=/tmp/repo.git commit -m x').decision,
      'deny',
    )
    assert.strictEqual(
      classifyCommandLine('GIT_WORK_TREE=/tmp/other git commit -m x').decision,
      'deny',
    )
    assert.strictEqual(
      classifyCommandLine('env GIT_DIR=/tmp/repo.git git commit -m x').decision,
      'deny',
    )
  })

  it('requests exact scoped confirmation without trusting historical metadata', () => {
    const expectedScope = fs.realpathSync(ROOT)
    const first = evaluatePreToolUse({
      toolCall: { name: 'run_command', args: { CommandLine: "git commit -m 'one message'" } },
      workspacePaths: [ROOT],
      conversationId: 'approved-before',
      transcriptPath: '/tmp/stale-approval.jsonl',
      modelName: 'stale-model',
    })
    const second = evaluatePreToolUse({
      toolCall: { name: 'run_command', args: { CommandLine: "git commit -m 'one message'" } },
      workspacePaths: [ROOT],
      conversationId: 'different',
      transcriptPath: '/tmp/different.jsonl',
      modelName: 'different-model',
    })
    assert.deepStrictEqual(first, second)
    assert.strictEqual(first.decision, 'force_ask')
    assert.match(first.reason ?? '', /Confirm exact action: git commit -m 'one message'/)
    assert.match(
      first.reason ?? '',
      new RegExp(`Repository scope: ${expectedScope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    )
    assert.strictEqual('permissionOverrides' in first, false)
    assert.strictEqual('overwrite' in first, false)

    assert.strictEqual(evaluateGit('git commit -m x', []).decision, 'deny')
    assert.strictEqual(evaluateGit('git commit -m x', [ROOT, os.tmpdir()]).decision, 'deny')
    assert.strictEqual(
      evaluatePreToolUse({
        toolCall: { name: 'run_command', args: { CommandLine: 'git commit -m x' } },
        workspacePaths: [''],
      }).decision,
      'deny',
    )

    const explicit = evaluatePreToolUse({
      toolCall: { name: 'run_command', args: { CommandLine: `git -C ${ROOT} commit -m x` } },
    })
    assert.strictEqual(explicit.decision, 'force_ask')
    assert.match(
      explicit.reason ?? '',
      new RegExp(`Repository scope: ${expectedScope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    )

    const relative = evaluateGit('git -C . commit -m x')
    assert.strictEqual(relative.decision, 'force_ask')
    assert.match(
      relative.reason ?? '',
      new RegExp(`Repository scope: ${expectedScope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    )
    assert.strictEqual(
      evaluatePreToolUse({
        toolCall: { name: 'run_command', args: { CommandLine: 'git -C . commit -m x' } },
      }).decision,
      'deny',
    )

    const nested = path.join(ROOT, 'plugins')
    const toolCwd = evaluatePreToolUse({
      toolCall: { name: 'run_command', args: { CommandLine: 'git commit -m x', Cwd: nested } },
      workspacePaths: [ROOT],
    })
    assert.strictEqual(toolCwd.decision, 'force_ask')
    assert.match(toolCwd.reason ?? '', new RegExp(`Repository scope: ${nested}`))
    assert.strictEqual(
      evaluatePreToolUse({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git commit -m x', Cwd: os.tmpdir() },
        },
        workspacePaths: [ROOT],
      }).decision,
      'deny',
    )
    assert.strictEqual(evaluateGit(`git -C ${os.tmpdir()} commit -m x`).decision, 'deny')
  })

  it('denies malformed known-tool payloads and ambiguous compatibility casing', () => {
    const malformed = [
      { toolCall: { name: 'run_command' } },
      { toolCall: { name: 'run_command', args: { CommandLine: 42 } } },
      { toolCall: { name: 'run_command', args: { commandLine: '' } } },
      {
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git status', commandLine: 'git commit -m x' },
        },
      },
      { toolCall: { name: 'write_to_file', args: {} } },
      {
        toolCall: {
          name: 'write_to_file',
          args: { TargetFile: '/tmp/one', targetFile: '/tmp/two' },
        },
      },
      { toolCall: { name: 'define_subagent', args: {} } },
    ]
    for (const payload of malformed) {
      assert.strictEqual(evaluatePreToolUse(payload).decision, 'deny')
    }
    assert.strictEqual(
      evaluatePreToolUse({
        toolCall: { name: 'run_command', args: { commandLine: 'git status' } },
      }).decision,
      'ask',
    )
  })

  it('checks every multi-edit target and canonicalizes symlink ancestors', () => {
    const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-memory-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-outside-'))
    const link = path.join(outside, 'linked-memory')
    fs.symlinkSync(memoryRoot, link, 'dir')
    try {
      assert.strictEqual(
        classifyWriteTarget(path.join(link, 'new', 'file.md'), memoryRoot).decision,
        'deny',
      )
      assert.strictEqual(
        evaluatePreToolUse({
          toolCall: {
            name: 'multi_replace_file_content',
            args: {
              replacements: [
                { TargetFile: path.join(outside, 'safe.ts') },
                { filePath: path.join(ROOT, '.git', 'config') },
              ],
            },
          },
        }).decision,
        'deny',
      )
      assert.strictEqual(
        evaluatePreToolUse({
          toolCall: {
            name: 'multi_replace_file_content',
            args: { replacements: [{ old_string: 'x', new_string: 'y' }] },
          },
        }).decision,
        'deny',
      )
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
      fs.rmSync(memoryRoot, { recursive: true, force: true })
    }
  })

  it('gates direct shell file mutators and denies protected literal targets', () => {
    const gated = [
      'cp a b',
      'mv a b',
      'truncate -s 0 file',
      'touch file',
      'tee file',
      'install source target',
      'dd if=a of=b',
      'find . -delete',
      "sed -i 's/a/b/' file",
      'source script.sh',
      'python script.py',
    ]
    for (const command of gated) {
      assert.strictEqual(classifyCommandLine(command).decision, 'force_ask', command)
    }
    const protectedTarget = path.join(ROOT, '.git', 'config')
    for (const command of [
      `cp a ${protectedTarget}`,
      `mv a ${protectedTarget}`,
      `touch ${protectedTarget}`,
      `tee ${protectedTarget}`,
      `dd if=a of=${protectedTarget}`,
      `sed -i s/a/b/ ${protectedTarget}`,
    ]) {
      assert.strictEqual(classifyCommandLine(command).decision, 'deny', command)
    }
    assert.strictEqual(classifyCommandLine('python --version').decision, 'ask')

    const protectedMemory = path.join(os.homedir(), '.gemini', 'memory', 'guard-test.md')
    for (const command of [
      `echo blocked > ${protectedMemory}`,
      `echo blocked >& ${protectedMemory}`,
      `echo blocked &> ${protectedMemory}`,
      `echo blocked 1> ${protectedMemory}`,
      `echo blocked 2>> ${protectedMemory}`,
      `echo blocked>${protectedMemory}`,
      `echo blocked>>${protectedMemory}`,
    ]) {
      assert.strictEqual(classifyCommandLine(command).decision, 'deny', command)
    }
    assert.strictEqual(classifyCommandLine('echo ok 2>&1').decision, 'ask')
    assert.strictEqual(classifyCommandLine('echo changed>/tmp/out').decision, 'force_ask')
    assert.strictEqual(classifyCommandLine("echo 'literal>/tmp/out'").decision, 'ask')
    assert.strictEqual(classifyCommandLine("git commit -m 'unterminated").decision, 'deny')
  })

  it('denies internal evaluator exceptions without treating them as authorization', () => {
    const throwingPayload = new Proxy(
      {},
      {
        get() {
          throw new Error('synthetic payload failure')
        },
      },
    ) as PreToolUsePayload
    const result = evaluatePreToolUse(throwingPayload)
    assert.strictEqual(result.decision, 'deny')
    assert.match(result.reason ?? '', /Guard error fallback: synthetic payload failure/)
  })

  it('fails safely when the executable hook receives invalid JSON', () => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', HOOK], {
      cwd: ROOT,
      input: '{invalid',
      encoding: 'utf8',
    })
    assert.strictEqual(result.status, 0)
    const output = JSON.parse(result.stdout)
    assert.strictEqual(output.decision, 'force_ask')
    assert.match(output.reason, /Hook error fallback/)
  })
})
