import * as assert from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import {
  inspectCommittedMemoryProjection,
  parseMemoryDocument,
  renderCommittedMemoryProjection,
} from '../plugins/agy-memory-layer/scripts/layered-memory.ts'
import {
  applyLayeredMemoryMigration,
  extractDurableSourceUnits,
  type LayeredMigrationSpec,
  planLayeredMemoryMigration,
  rollbackLayeredMemoryMigration,
} from '../plugins/agy-memory-layer/scripts/layered-memory-migration.ts'
import {
  type MemoryCurationSpec,
  planMemoryCuration,
  proposeMemoryCuration,
  reviewMemoryCuration,
} from '../plugins/agy-memory-layer/scripts/memory-curation.ts'
import {
  acquireMemoryWriteLock,
  reclaimStaleMemoryWriteLock,
  releaseMemoryWriteLock,
} from '../plugins/agy-memory-layer/scripts/memory-write-lock.ts'

const runGit = (root: string, args: string[]): string =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8' }).trim()

const createMemoryRepository = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-layered-memory-'))
  runGit(root, ['init', '-q'])
  return root
}

const writeFilesAndCommit = (
  root: string,
  files: Record<string, string>,
  message = 'test: seed memory',
): void => {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, content, 'utf-8')
  }
  runGit(root, ['add', '--', ...Object.keys(files)])
  runGit(root, [
    '-c',
    'user.name=Agy Test',
    '-c',
    'user.email=agy-test@local',
    'commit',
    '-q',
    '-m',
    message,
    '--',
    ...Object.keys(files),
  ])
}

const layered = (description: string, body: string): string =>
  `---\ndescription: ${description}\n---\n${body}\n`

const sha256 = (content: string): string =>
  crypto.createHash('sha256').update(content).digest('hex')

type PalaceCoreFile = {
  index: number
  path: string
  description: string
  content: string
  commit: { hash: string }
}

const generatePalace = (
  memoryRoot: string,
  projectSlug: string,
): { html: string; outputPath: string; workspace: string; home: string } => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-palace-fixture-'))
  const home = path.join(fixtureRoot, 'home')
  const workspace = path.join(fixtureRoot, projectSlug)
  const outputPath = path.join(fixtureRoot, 'palace.html')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(workspace, { recursive: true })
  const generator = path.join(process.cwd(), 'plugins/agy-memory-layer/scripts/palace-generator.ts')
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', generator, workspace, outputPath],
    {
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: home,
        AGY_MEMORY_DIR: memoryRoot,
        AGY_HISTORY_FILE: path.join(home, 'missing-history.jsonl'),
      },
    },
  )
  if (result.status !== 0) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
    throw new Error(`Palace generation failed: ${result.stderr}`)
  }
  return { html: fs.readFileSync(outputPath, 'utf-8'), outputPath, workspace, home }
}

const parsePalaceCoreFiles = (html: string): PalaceCoreFile[] => {
  const startMarker = 'const CORE_FILES = '
  const endMarker = ';\n    const EXT_FILES = '
  const start = html.indexOf(startMarker)
  const end = html.indexOf(endMarker, start)
  assert.notStrictEqual(start, -1)
  assert.notStrictEqual(end, -1)
  return JSON.parse(html.slice(start + startMarker.length, end)) as PalaceCoreFile[]
}

describe('layered memory projection', () => {
  it('parses minimal frontmatter and rejects malformed or unknown metadata', () => {
    assert.deepStrictEqual(
      parseMemoryDocument(layered('Useful detail.', '# Body'), 'system/a.md'),
      {
        description: 'Useful detail.',
        body: '# Body',
        readOnly: false,
        diagnostics: [],
      },
    )

    const missing = parseMemoryDocument('# Body', 'system/a.md', { requireDescription: true })
    assert.strictEqual(missing.body, '')
    assert.match(missing.diagnostics[0], /missing required description/)

    const unknown = parseMemoryDocument(
      '---\ndescription: Useful detail.\nowner: agent\n---\n# Body',
      'reference/a.md',
      { requireDescription: true },
    )
    assert.strictEqual(unknown.body, '')
    assert.match(unknown.diagnostics[0], /unknown frontmatter key/)
  })

  it('preserves legacy committed projection and ignores dirty working-tree memory', () => {
    const root = createMemoryRepository()
    try {
      writeFilesAndCommit(root, {
        'global/human.md': '# Human\nCommitted preference',
        'global/persona.md': '# Persona\nCommitted identity',
        'projects/alpha/project.md': '# Alpha\nCommitted alpha context',
        'projects/alpha/rules.md': '# Alpha Rules\nCommitted alpha rule',
        'projects/beta/project.md': '# Beta\nMust not leak',
      })
      fs.writeFileSync(path.join(root, 'global', 'human.md'), '# Human\nDirty preference', 'utf-8')

      const projection = inspectCommittedMemoryProjection(root, 'alpha')
      assert.strictEqual(projection.mode, 'legacy')
      const rendered = renderCommittedMemoryProjection(root, projection)
      assert.match(rendered, /Committed preference/)
      assert.doesNotMatch(rendered, /Dirty preference/)
      assert.match(rendered, /Committed alpha context/)
      assert.doesNotMatch(rendered, /Must not leak/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('projects focused global/current-project system files and indexes references without bodies', () => {
    const root = createMemoryRepository()
    try {
      writeFilesAndCommit(root, {
        'system/persona.md': layered('Persistent agent identity.', '# Persona\nLayered identity'),
        'system/human/identity.md': layered('Stable user identity.', '# Human\nLayered human'),
        'system/human/prefs/workflow.md': layered(
          'Global workflow preferences.',
          '# Workflow\nLayered workflow',
        ),
        'reference/human/prefs/workflow-detailed.md': layered(
          'Detailed workflow edge cases.',
          'GLOBAL_REFERENCE_SECRET',
        ),
        'projects/alpha/system/overview.md': layered(
          'Current project architecture.',
          '# Alpha\nLayered alpha context',
        ),
        'projects/alpha/reference/testing.md': layered(
          'Detailed project test commands.',
          'PROJECT_REFERENCE_SECRET',
        ),
        'projects/beta/system/overview.md': layered(
          'Other project architecture.',
          'BETA_SYSTEM_SECRET',
        ),
        'projects/beta/reference/testing.md': layered(
          'Other project tests.',
          'BETA_REFERENCE_SECRET',
        ),
        'archives/migrations/old.md': 'ARCHIVE_SECRET',
      })

      const projection = inspectCommittedMemoryProjection(root, 'alpha')
      assert.strictEqual(projection.mode, 'layered')
      assert.strictEqual(projection.diagnostics.length, 0)
      assert.deepStrictEqual(
        projection.globalSystem.map((document) => document.relativePath),
        ['system/human/identity.md', 'system/human/prefs/workflow.md', 'system/persona.md'],
      )
      assert.deepStrictEqual(
        projection.projectSystem.map((document) => document.relativePath),
        ['projects/alpha/system/overview.md'],
      )
      assert.deepStrictEqual(
        projection.external.map((document) => document.relativePath),
        ['projects/alpha/reference/testing.md', 'reference/human/prefs/workflow-detailed.md'],
      )

      const rendered = renderCommittedMemoryProjection(root, projection)
      assert.match(rendered, /Layered identity/)
      assert.match(rendered, /Layered human/)
      assert.match(rendered, /Layered alpha context/)
      assert.match(rendered, /reference\/human\/prefs\/workflow-detailed\.md/)
      assert.match(rendered, /projects\/alpha\/reference\/testing\.md/)
      assert.doesNotMatch(rendered, /GLOBAL_REFERENCE_SECRET/)
      assert.doesNotMatch(rendered, /PROJECT_REFERENCE_SECRET/)
      assert.doesNotMatch(rendered, /BETA_SYSTEM_SECRET/)
      assert.doesNotMatch(rendered, /BETA_REFERENCE_SECRET/)
      assert.doesNotMatch(rendered, /ARCHIVE_SECRET/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed when layered and legacy active owners overlap', () => {
    const root = createMemoryRepository()
    try {
      writeFilesAndCommit(root, {
        'global/human.md': '# Human\nLegacy active body',
        'system/human/identity.md': layered(
          'Stable user identity.',
          '# Human\nLayered active body',
        ),
      })

      const projection = inspectCommittedMemoryProjection(root, 'alpha')
      assert.strictEqual(projection.mode, 'conflict')
      assert.strictEqual(projection.globalSystem.length, 0)
      const rendered = renderCommittedMemoryProjection(root, projection)
      assert.match(rendered, /Layered Memory Conflict/)
      assert.doesNotMatch(rendered, /Legacy active body/)
      assert.doesNotMatch(rendered, /Layered active body/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed when layered and legacy owners coexist in different projects', () => {
    const root = createMemoryRepository()
    try {
      writeFilesAndCommit(root, {
        'system/persona.md': layered('Persistent agent identity.', '# Persona\nLayered'),
        'projects/alpha/rules.md': '# Alpha Rules\n- Legacy owner',
        'projects/beta/system/overview.md': layered('Beta overview.', '# Beta'),
      })
      const beta = inspectCommittedMemoryProjection(root, 'beta')
      assert.strictEqual(beta.mode, 'conflict')
      assert.deepStrictEqual(beta.globalSystem, [])
      assert.deepStrictEqual(beta.projectSystem, [])
      assert.match(renderCommittedMemoryProjection(root, beta), /Layered Memory Conflict/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Memory Palace topology', () => {
  it('renders every layered Human file as a selectable nested node for the current project', () => {
    const root = createMemoryRepository()
    try {
      writeFilesAndCommit(root, {
        'system/human/identity.md': layered('Stable identity.', '# Identity\nMahiro'),
        'system/human/prefs/coding.md': layered('Coding defaults.', '# Coding\nTyped'),
        'system/human/prefs/communication.md': layered(
          'Communication defaults.',
          '# Communication\nConcise Thai',
        ),
        'system/human/prefs/workflow.md': layered(
          'Workflow defaults.',
          '# Workflow\nVerify real artifacts',
        ),
        'system/persona.md': layered('Persistent persona.', '# Persona\nCompanion'),
        'projects/alpha/system/conventions.md': layered(
          'Alpha conventions.',
          '# Alpha Rules\nCurrent only',
        ),
        'projects/alpha/system/overview.md': layered('Alpha overview.', '# Alpha\nCurrent project'),
        'projects/beta/system/conventions.md': layered(
          'Beta conventions.',
          '# Beta Rules\nMust not enter Core',
        ),
        'projects/beta/system/overview.md': layered(
          'Beta overview.',
          '# Beta\nMust not enter Core',
        ),
        'reference/human/prefs/workflow-detailed.md': layered(
          'Detailed workflow evidence.',
          '# Reference\nMust remain external',
        ),
      })
      writeFilesAndCommit(
        root,
        {
          'system/human/identity.md': layered('Stable identity.', '# Identity\nMahiro updated'),
        },
        'test: update identity only',
      )

      const generated = generatePalace(root, 'alpha')
      try {
        const coreFiles = parsePalaceCoreFiles(generated.html)
        assert.deepStrictEqual(
          coreFiles.map((file) => file.path),
          [
            'system/human/identity.md',
            'system/human/prefs/coding.md',
            'system/human/prefs/communication.md',
            'system/human/prefs/workflow.md',
            'system/persona.md',
            'projects/alpha/system/conventions.md',
            'projects/alpha/system/overview.md',
          ],
        )
        assert.match(generated.html, /data-core-folder="system\/human"/)
        assert.match(generated.html, /data-core-folder="system\/human\/prefs"/)
        assert.match(generated.html, /data-core-path="system\/human\/identity\.md"/)
        assert.match(generated.html, /data-core-path="system\/human\/prefs\/workflow\.md"/)
        assert.doesNotMatch(generated.html, /system\/human\/\*/)
        assert.doesNotMatch(
          coreFiles.map((file) => file.path).join('\n'),
          /projects\/beta|reference\//,
        )

        const expectedDetails: Record<string, { description: string; content: string }> = {
          'system/human/identity.md': {
            description: 'Stable identity.',
            content: '# Identity\nMahiro updated',
          },
          'system/human/prefs/coding.md': {
            description: 'Coding defaults.',
            content: '# Coding\nTyped',
          },
          'system/human/prefs/communication.md': {
            description: 'Communication defaults.',
            content: '# Communication\nConcise Thai',
          },
          'system/human/prefs/workflow.md': {
            description: 'Workflow defaults.',
            content: '# Workflow\nVerify real artifacts',
          },
          'system/persona.md': {
            description: 'Persistent persona.',
            content: '# Persona\nCompanion',
          },
          'projects/alpha/system/conventions.md': {
            description: 'Alpha conventions.',
            content: '# Alpha Rules\nCurrent only',
          },
          'projects/alpha/system/overview.md': {
            description: 'Alpha overview.',
            content: '# Alpha\nCurrent project',
          },
        }
        for (const [index, file] of coreFiles.entries()) {
          assert.strictEqual(file.index, index)
          assert.deepStrictEqual(
            { description: file.description, content: file.content },
            expectedDetails[file.path],
          )
          assert.strictEqual(
            file.commit.hash,
            runGit(root, ['log', '-1', '--pretty=format:%h', '--', file.path]),
          )
        }
        assert.match(generated.html, /id="core-file-path">system\/human\/identity\.md<\/span>/)
        assert.match(generated.html, /id="core-file-desc">Stable identity\.<\/span>/)
        assert.match(generated.html, /data-core-index="6"/)
      } finally {
        fs.rmSync(path.dirname(generated.outputPath), { recursive: true, force: true })
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves the flat legacy Core tree without layered folders', () => {
    const root = createMemoryRepository()
    try {
      writeFilesAndCommit(root, {
        'global/human.md': '# Human\nLegacy preference',
        'global/persona.md': '# Persona\nLegacy persona',
        'projects/alpha/project.md': '# Alpha\nLegacy project',
        'projects/alpha/rules.md': '# Alpha Rules\nLegacy rule',
        'projects/beta/project.md': '# Beta\nMust not enter Core',
      })
      const generated = generatePalace(root, 'alpha')
      try {
        const coreFiles = parsePalaceCoreFiles(generated.html)
        assert.deepStrictEqual(
          coreFiles.map((file) => file.path),
          [
            'global/human.md',
            'global/persona.md',
            'projects/alpha/project.md',
            'projects/alpha/rules.md',
          ],
        )
        assert.match(generated.html, /data-core-group="global"/)
        assert.match(generated.html, /data-core-group="projects\/alpha"/)
        assert.match(generated.html, /data-core-path="global\/human\.md"/)
        assert.doesNotMatch(generated.html, /data-core-folder="(?:system|global)\/human"/)
        assert.doesNotMatch(coreFiles.map((file) => file.path).join('\n'), /projects\/beta/)
      } finally {
        fs.rmSync(path.dirname(generated.outputPath), { recursive: true, force: true })
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses to generate Palace HTML from mixed legacy and layered owners', () => {
    const root = createMemoryRepository()
    try {
      writeFilesAndCommit(root, {
        'global/human.md': '# Human\nLegacy owner',
        'system/persona.md': layered('Layered persona.', '# Persona\nLayered owner'),
      })
      assert.throws(() => generatePalace(root, 'alpha'), /refuses mixed legacy\/layered ownership/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('lossless layered memory migration', () => {
  it('requires an exhaustive ledger, applies one committed migration, and rolls back safely', () => {
    const root = createMemoryRepository()
    const stateRoot = `${root}.state`
    const legacyFiles = {
      'global/human.md': '# Human\n- Concise Thai\n- Verify repository evidence',
      'global/persona.md': '# Persona\n- Persistent companion\n- State unknowns honestly',
      'projects/alpha/project.md': '# Alpha\n- Uses SQLite',
      'projects/alpha/rules.md': '# Rules\n- Run focused tests',
    }
    try {
      writeFilesAndCommit(root, legacyFiles)
      const expectedHead = runGit(root, ['rev-parse', 'HEAD'])
      const sources = Object.entries(legacyFiles)
        .map(([relativePath, content]) => ({ relativePath, sha256: sha256(content) }))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      const units = Object.entries(legacyFiles).flatMap(([relativePath, content]) =>
        extractDurableSourceUnits(relativePath, content),
      )
      const destinationFor = (sourcePath: string, text: string): string => {
        if (sourcePath === 'global/persona.md') return 'system/persona.md'
        if (sourcePath === 'global/human.md') {
          if (text === '# Human') return 'system/human/identity.md'
          if (text === '- Concise Thai') return 'system/human/prefs/communication.md'
          return 'reference/human/workflow-detailed.md'
        }
        if (sourcePath.endsWith('/project.md')) return 'projects/alpha/system/overview.md'
        return 'projects/alpha/system/conventions.md'
      }
      const spec: LayeredMigrationSpec = {
        schemaVersion: 1,
        id: 'test-layered-v1',
        expectedHead,
        sources,
        targets: [
          {
            relativePath: 'system/persona.md',
            content: layered(
              'Persistent agent identity.',
              '# Persona\n- Persistent companion\n- State unknowns honestly',
            ),
          },
          {
            relativePath: 'system/human/identity.md',
            content: layered('Stable user identity.', '# Human\nMahiro'),
          },
          {
            relativePath: 'system/human/prefs/communication.md',
            content: layered('Communication preferences.', '# Communication\n- Concise Thai'),
          },
          {
            relativePath: 'reference/human/workflow-detailed.md',
            content: layered(
              'Detailed workflow evidence.',
              '# Workflow\n- Verify repository evidence',
            ),
          },
          {
            relativePath: 'projects/alpha/system/overview.md',
            content: layered('Project architecture.', '# Alpha\n- Uses SQLite'),
          },
          {
            relativePath: 'projects/alpha/system/conventions.md',
            content: layered('Project conventions.', '# Rules\n- Run focused tests'),
          },
        ],
        dispositions: units.map((unit) => {
          const destinationPath = destinationFor(unit.sourcePath, unit.text)
          return {
            sourcePath: unit.sourcePath,
            sourceUnitId: unit.id,
            destinationPath,
            state:
              destinationPath.startsWith('reference/') || destinationPath.includes('/reference/')
                ? 'reference'
                : 'active',
            representation: 'exact',
            reason: 'Preserved in a focused active owner and exact migration archive.',
          }
        }),
      }

      const incomplete = structuredClone(spec)
      incomplete.dispositions.pop()
      assert.throws(
        () => planLayeredMemoryMigration(root, incomplete),
        /Disposition ledger omits 1 durable source unit/,
      )

      const missingId = { ...structuredClone(spec), id: undefined as unknown as string }
      assert.throws(() => planLayeredMemoryMigration(root, missingId), /Migration id must be/)

      const unrepresented = structuredClone(spec)
      const communicationTarget = unrepresented.targets.find(
        (target) => target.relativePath === 'system/human/prefs/communication.md',
      )
      assert.ok(communicationTarget)
      communicationTarget.content = layered(
        'Communication preferences.',
        '# Communication\n- Unrelated text',
      )
      assert.throws(
        () => planLayeredMemoryMigration(root, unrepresented),
        /Exact disposition .* is not present/,
      )

      const firstPlan = planLayeredMemoryMigration(root, spec)
      const secondPlan = planLayeredMemoryMigration(root, spec)
      assert.strictEqual(firstPlan.planHash, secondPlan.planHash)
      assert.strictEqual(firstPlan.sourceUnits.length, units.length)
      assert.throws(
        () => applyLayeredMemoryMigration(root, spec, '0'.repeat(64)),
        /plan confirmation mismatch/,
      )
      assert.strictEqual(runGit(root, ['status', '--porcelain']), '')
      assert.strictEqual(runGit(root, ['rev-parse', 'HEAD']), expectedHead)

      const failingHook = path.join(root, '.git/hooks/pre-commit')
      fs.writeFileSync(failingHook, '#!/bin/sh\nexit 1\n')
      fs.chmodSync(failingHook, 0o755)
      assert.throws(
        () => applyLayeredMemoryMigration(root, spec, firstPlan.planHash),
        /Git .* failed/,
      )
      assert.strictEqual(runGit(root, ['status', '--porcelain']), '')
      assert.strictEqual(runGit(root, ['rev-parse', 'HEAD']), expectedHead)
      fs.rmSync(failingHook)

      const migrated = applyLayeredMemoryMigration(root, spec, firstPlan.planHash)
      assert.strictEqual(migrated.status, 'MIGRATED')
      assert.notStrictEqual(migrated.commit, expectedHead)
      const projection = inspectCommittedMemoryProjection(root, 'alpha')
      assert.strictEqual(projection.mode, 'layered')
      assert.strictEqual(
        fs.readFileSync(
          path.join(root, 'archives/migrations/test-layered-v1/legacy/global/human.md'),
          'utf-8',
        ),
        legacyFiles['global/human.md'],
      )
      assert.strictEqual(
        fs.existsSync(path.join(root, 'archives/migrations/test-layered-v1/manifest.json')),
        true,
      )
      assert.throws(
        () => rollbackLayeredMemoryMigration(root, undefined as unknown as string, migrated.commit),
        /Invalid migration id/,
      )
      assert.throws(
        () => rollbackLayeredMemoryMigration(root, spec.id, 'f'.repeat(40)),
        /to be an ancestor/,
      )

      const postMigrationContent = `${fs.readFileSync(path.join(root, 'system/persona.md'), 'utf-8')}\n- Post-migration approved detail.\n`
      fs.writeFileSync(path.join(root, 'system/persona.md'), postMigrationContent)
      fs.mkdirSync(path.join(root, 'archives/curations/post-migration/source/system'), {
        recursive: true,
      })
      fs.writeFileSync(
        path.join(root, 'archives/curations/post-migration/source/system/persona.md'),
        postMigrationContent,
      )
      runGit(root, ['add', 'system/persona.md', 'archives/curations/post-migration'])
      runGit(root, ['commit', '-m', 'test: preserve post-migration curation'])
      const postMigrationHead = runGit(root, ['rev-parse', 'HEAD'])

      fs.writeFileSync(failingHook, '#!/bin/sh\nexit 1\n')
      fs.chmodSync(failingHook, 0o755)
      assert.throws(
        () => rollbackLayeredMemoryMigration(root, spec.id, migrated.commit),
        /Git .* failed/,
      )
      assert.strictEqual(runGit(root, ['status', '--porcelain']), '')
      assert.strictEqual(runGit(root, ['rev-parse', 'HEAD']), postMigrationHead)
      assert.strictEqual(inspectCommittedMemoryProjection(root, 'alpha').mode, 'layered')
      assert.strictEqual(
        fs.existsSync(
          path.join(
            root,
            `archives/migrations/test-layered-v1/rollbacks/${postMigrationHead}/manifest.json`,
          ),
        ),
        false,
      )
      assert.strictEqual(
        fs.existsSync(
          path.join(
            root,
            `archives/migrations/test-layered-v1/rollbacks/${postMigrationHead}/current/system/persona.md`,
          ),
        ),
        false,
      )
      fs.rmSync(failingHook)

      const rolledBack = rollbackLayeredMemoryMigration(root, spec.id, migrated.commit)
      assert.strictEqual(rolledBack.status, 'ROLLED_BACK')
      assert.strictEqual(rolledBack.restoredParent, expectedHead)
      assert.strictEqual(inspectCommittedMemoryProjection(root, 'alpha').mode, 'legacy')
      for (const [relativePath, content] of Object.entries(legacyFiles)) {
        assert.strictEqual(fs.readFileSync(path.join(root, relativePath), 'utf-8'), content)
      }
      assert.strictEqual(fs.existsSync(path.join(root, 'system/persona.md')), false)
      assert.strictEqual(
        fs.existsSync(path.join(root, 'archives/migrations/test-layered-v1/manifest.json')),
        true,
      )
      assert.strictEqual(
        fs.readFileSync(
          path.join(
            root,
            `archives/migrations/test-layered-v1/rollbacks/${postMigrationHead}/current/system/persona.md`,
          ),
          'utf-8',
        ),
        postMigrationContent,
      )
      assert.strictEqual(
        fs.existsSync(
          path.join(
            root,
            `archives/migrations/test-layered-v1/rollbacks/${postMigrationHead}/manifest.json`,
          ),
        ),
        true,
      )
      const rollbackManifest = JSON.parse(
        fs.readFileSync(
          path.join(
            root,
            `archives/migrations/test-layered-v1/rollbacks/${postMigrationHead}/manifest.json`,
          ),
          'utf-8',
        ),
      )
      const migrationOwnedPaths = firstPlan.changedPaths.filter(
        (relativePath) => !relativePath.startsWith('archives/migrations/test-layered-v1/'),
      )
      assert.deepStrictEqual(
        rollbackManifest.currentReceipts.map(
          (receipt: { relativePath: string }) => receipt.relativePath,
        ),
        migrationOwnedPaths,
      )
      assert.strictEqual(
        rollbackManifest.currentReceipts.some(
          (receipt: { present: boolean; sha256: string | null }) =>
            !receipt.present && receipt.sha256 === null,
        ),
        true,
      )
      for (const receipt of rollbackManifest.currentReceipts as Array<{
        relativePath: string
        present: boolean
        sha256: string | null
      }>) {
        const snapshotPath = path.join(
          root,
          `archives/migrations/test-layered-v1/rollbacks/${postMigrationHead}/current`,
          receipt.relativePath,
        )
        if (!receipt.present) {
          assert.strictEqual(fs.existsSync(snapshotPath), false)
          assert.strictEqual(receipt.sha256, null)
          continue
        }
        const snapshot = fs.readFileSync(snapshotPath)
        assert.strictEqual(
          crypto.createHash('sha256').update(snapshot).digest('hex'),
          receipt.sha256,
        )
      }
      assert.strictEqual(
        fs.readFileSync(
          path.join(root, 'archives/curations/post-migration/source/system/persona.md'),
          'utf-8',
        ),
        postMigrationContent,
      )
      assert.strictEqual(runGit(root, ['status', '--porcelain']), '')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(stateRoot, { recursive: true, force: true })
    }
  })

  it('serializes memory writers and does not let a contender steal a live lock', () => {
    const root = createMemoryRepository()
    const stateRoot = `${root}.state`
    try {
      const lock = acquireMemoryWriteLock(root, 'first writer')
      assert.throws(
        () => acquireMemoryWriteLock(root, 'second writer'),
        /held by PID .* for first writer/,
      )
      releaseMemoryWriteLock(lock)
      const nextLock = acquireMemoryWriteLock(root, 'second writer')
      releaseMemoryWriteLock(nextLock)

      const staleLockPath = path.join(stateRoot, 'locks/memory-write.lock')
      fs.writeFileSync(
        staleLockPath,
        `${JSON.stringify({
          token: 'stale-token',
          operation: 'crashed writer',
          createdAt: '2026-01-01T00:00:00.000Z',
          pid: 999_999_999,
        })}\n`,
      )
      assert.throws(
        () => acquireMemoryWriteLock(root, 'third writer'),
        /Stale memory write lock.*remove .* only after verifying/,
      )
      assert.strictEqual(fs.existsSync(staleLockPath), true)
      assert.strictEqual(reclaimStaleMemoryWriteLock(root), true)
      assert.strictEqual(fs.existsSync(staleLockPath), false)
      assert.strictEqual(reclaimStaleMemoryWriteLock(root), false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(stateRoot, { recursive: true, force: true })
    }
  })
})

describe('provenance-preserving memory curation', () => {
  it('requires a complete destination ledger and archives exact source before approval', () => {
    const root = createMemoryRepository()
    const stateRoot = `${root}.state`
    const sourcePath = 'system/human/identity.md'
    const sourceContent = layered(
      'Stable user identity and core collaboration preferences.',
      '# Human\n- Keep concise Thai\n- Preserve detailed verification edge cases',
    )
    try {
      writeFilesAndCommit(root, {
        [sourcePath]: sourceContent,
        'system/persona.md': layered('Persistent agent identity.', '# Persona\nEvidence first'),
      })
      const expectedHead = runGit(root, ['rev-parse', 'HEAD'])
      const units = extractDurableSourceUnits(sourcePath, sourceContent)
      const spec: MemoryCurationSpec = {
        schemaVersion: 1,
        id: 'split-human-detail',
        expectedHead,
        reason: 'Keep the active owner compact while preserving detailed verification guidance.',
        sources: [{ relativePath: sourcePath, sha256: sha256(sourceContent) }],
        targets: [
          {
            relativePath: sourcePath,
            content: layered(
              'Stable user identity and core collaboration preferences.',
              '# Human\n- Keep concise Thai',
            ),
          },
          {
            relativePath: 'reference/human/workflow-detailed.md',
            content: layered(
              'Detailed verification edge cases.',
              '# Verification\n- Preserve detailed verification edge cases',
            ),
          },
        ],
        dispositions: [
          {
            sourcePath,
            sourceUnitId: units[0].id,
            destinationPath: sourcePath,
            state: 'active',
            representation: 'exact',
            reason: 'Keep the source heading active.',
          },
          {
            sourcePath,
            sourceUnitId: units[1].id,
            destinationPath: sourcePath,
            state: 'active',
            representation: 'exact',
            reason: 'Keep the concise communication preference active.',
          },
          {
            sourcePath,
            sourceUnitId: units[2].id,
            destinationPath: 'reference/human/workflow-detailed.md',
            state: 'reference',
            representation: 'exact',
            reason: 'Move detailed verification guidance to on-demand memory.',
          },
        ],
      }

      const incomplete = structuredClone(spec)
      incomplete.dispositions.pop()
      assert.throws(
        () => planMemoryCuration(root, incomplete),
        /ledger omits 1 durable source unit/,
      )

      const missingId = { ...structuredClone(spec), id: undefined as unknown as string }
      assert.throws(() => planMemoryCuration(root, missingId), /Invalid curation id/)

      const unrepresented = structuredClone(spec)
      unrepresented.targets[1].content = layered(
        'Detailed verification edge cases.',
        '# Verification\n- Different detail',
      )
      assert.throws(
        () => planMemoryCuration(root, unrepresented),
        /Exact curation unit .* is absent/,
      )

      const proposal = proposeMemoryCuration(root, spec)
      assert.match(proposal.id, /^cur-/)
      assert.strictEqual(runGit(root, ['rev-parse', 'HEAD']), expectedHead)
      assert.strictEqual(fs.readFileSync(path.join(root, sourcePath), 'utf-8'), sourceContent)

      const failingHook = path.join(root, '.git/hooks/pre-commit')
      fs.writeFileSync(failingHook, '#!/bin/sh\nexit 1\n')
      fs.chmodSync(failingHook, 0o755)
      assert.throws(() => reviewMemoryCuration(root, proposal.id, 'approve'), /Git .* failed/)
      assert.strictEqual(runGit(root, ['status', '--porcelain']), '')
      assert.strictEqual(runGit(root, ['rev-parse', 'HEAD']), expectedHead)
      assert.strictEqual(fs.readFileSync(path.join(root, sourcePath), 'utf-8'), sourceContent)
      fs.rmSync(failingHook)

      const applied = reviewMemoryCuration(root, proposal.id, 'approve')
      assert.strictEqual(applied.status, 'APPLIED')
      assert.notStrictEqual(applied.commit, expectedHead)
      assert.doesNotMatch(fs.readFileSync(path.join(root, sourcePath), 'utf-8'), /edge cases/)
      assert.match(
        fs.readFileSync(path.join(root, 'reference/human/workflow-detailed.md'), 'utf-8'),
        /edge cases/,
      )
      assert.strictEqual(
        fs.readFileSync(
          path.join(root, 'archives/curations/split-human-detail/source', sourcePath),
          'utf-8',
        ),
        sourceContent,
      )
      assert.strictEqual(runGit(root, ['status', '--porcelain']), '')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(stateRoot, { recursive: true, force: true })
    }
  })
})
