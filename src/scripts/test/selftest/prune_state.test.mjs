/**
 * pruneAbsentState：manifest 移除/重命名后裁掉现状、log、playwright 残留。
 */
/* global Deno */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals, assertRejects } from 'jsr:@std/assert'

import {
	playwrightOutputDir,
	stateDir,
	stateLogPath,
} from '../core/paths.mjs'
import {
	buildStateMarkdown,
	pruneAbsentState,
	readModuleCheckStats,
	readState,
	suiteKey,
	upsertSuiteRun,
	writeModuleCheckStats,
	writeState,
} from '../core/state.mjs'

import { makeStateEntry, makeSuite } from './fixtures.mjs'

/**
 * 建临时 repo 根（含 data/test 树）。
 * @returns {Promise<string>} repoRoot
 */
async function makeRepoRoot() {
	return await mkdtemp(join(tmpdir(), 'fount_prune_state_'))
}

Deno.test('module-check stats persist and round-trip across kernels', async () => {
	const repoRoot = await makeRepoRoot()
	try {
		assertEquals(await readModuleCheckStats(repoRoot), { totalMs: 0, count: 0 })
		await writeModuleCheckStats(repoRoot, { totalMs: 400_000, count: 10 })
		assertEquals(await readModuleCheckStats(repoRoot), { totalMs: 400_000, count: 10 })
		await writeModuleCheckStats(repoRoot, { totalMs: 450_000, count: 11 })
		assertEquals(await readModuleCheckStats(repoRoot), { totalMs: 450_000, count: 11 })
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})

Deno.test('pruneAbsentState drops removed and renamed suite entries', async () => {
	const repoRoot = await makeRepoRoot()
	try {
		const keep = makeSuite('shells/chat', 'pure')
		const renamedAway = makeSuite('shells/chat', 'old_name')
		const removedManifest = makeSuite('p2p', 'sim')
		const state = {
			suites: {
				[suiteKey(keep.manifestId, keep.name)]: makeStateEntry({
					blockedBy: ['p2p:sim', 'shells/chat:pure'],
				}),
				[suiteKey(renamedAway.manifestId, renamedAway.name)]: makeStateEntry(),
				[suiteKey(removedManifest.manifestId, removedManifest.name)]: makeStateEntry(),
			},
		}
		await writeState(repoRoot, state)

		const result = await pruneAbsentState(repoRoot, [keep], state)
		assertEquals(result.changed, true)
		assertEquals(result.removedSuiteKeys.sort(), [
			'shells/chat:old_name',
			'p2p:sim',
		].sort())
		assertEquals(Object.keys(state.suites), ['shells/chat:pure'])
		assertEquals(state.suites['shells/chat:pure'].blockedBy, ['shells/chat:pure'])

		await writeState(repoRoot, state)
		const reloaded = await readState(repoRoot)
		assertEquals(Object.keys(reloaded.suites), ['shells/chat:pure'])
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})

Deno.test('pruneAbsentState drops renamed subtests and clears subtests when suite has none', async () => {
	const repoRoot = await makeRepoRoot()
	try {
		const withSubs = makeSuite('shells/chat', 'frontend', {
			subtests: [
				{ name: 'feed', triggers: ['a'], spec: 'feed.spec.mjs' },
			],
		})
		const plain = makeSuite('shells/chat', 'pure')
		const state = {
			suites: {
				[suiteKey(withSubs.manifestId, withSubs.name)]: makeStateEntry({
					subtests: {
						feed: {
							status: 'passed',
							commitHash: 'a',
							uncommittedHash: null,
							ranAt: '',
							durationMs: 1,
							triggerHash: null,
						},
						legacy: {
							status: 'failed',
							commitHash: 'a',
							uncommittedHash: null,
							ranAt: '',
							durationMs: 1,
							triggerHash: null,
						},
					},
				}),
				[suiteKey(plain.manifestId, plain.name)]: makeStateEntry({
					subtests: {
						ghost: {
							status: 'passed',
							commitHash: 'a',
							uncommittedHash: null,
							ranAt: '',
							durationMs: 1,
							triggerHash: null,
						},
					},
				}),
			},
		}

		const result = await pruneAbsentState(repoRoot, [withSubs, plain], state)
		assertEquals(result.changed, true)
		assertEquals(result.removedSubtests.sort(), [
			'shells/chat:frontend:legacy',
			'shells/chat:pure:ghost',
		].sort())
		assertEquals(Object.keys(state.suites['shells/chat:frontend'].subtests), ['feed'])
		assertEquals(state.suites['shells/chat:pure'].subtests, undefined)
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})

Deno.test('pruneAbsentState removes orphan logs and playwright dirs', async () => {
	const repoRoot = await makeRepoRoot()
	try {
		const keep = makeSuite('shells/chat', 'pure')
		const gone = makeSuite('shells/chat', 'legacy')
		const goneManifest = makeSuite('p2p', 'sim')

		const keepLog = stateLogPath(repoRoot, keep.manifestId, keep.name)
		const goneLog = stateLogPath(repoRoot, gone.manifestId, gone.name)
		const goneManifestLog = stateLogPath(repoRoot, goneManifest.manifestId, goneManifest.name)
		await mkdir(join(keepLog, '..'), { recursive: true })
		await mkdir(join(goneManifestLog, '..'), { recursive: true })
		await writeFile(keepLog, 'keep\n')
		await writeFile(goneLog, 'gone suite\n')
		await writeFile(goneManifestLog, 'gone manifest\n')

		const keepPlaywrightDir = playwrightOutputDir(repoRoot, keep.manifestId)
		const gonePlaywrightDir = playwrightOutputDir(repoRoot, goneManifest.manifestId)
		const orphanLogDir = join(stateDir(repoRoot), 'logs', 'frontend_pages')
		await mkdir(keepPlaywrightDir, { recursive: true })
		await mkdir(gonePlaywrightDir, { recursive: true })
		await mkdir(orphanLogDir, { recursive: true })
		await writeFile(join(keepPlaywrightDir, 'marker.txt'), 'ok\n')
		await writeFile(join(gonePlaywrightDir, 'marker.txt'), 'drop\n')
		await writeFile(join(orphanLogDir, 'x.log'), 'drop\n')

		const state = {
			suites: {
				[suiteKey(keep.manifestId, keep.name)]: makeStateEntry({ logPath: keepLog }),
				[suiteKey(gone.manifestId, gone.name)]: makeStateEntry({ logPath: goneLog }),
				[suiteKey(goneManifest.manifestId, goneManifest.name)]: makeStateEntry({ logPath: goneManifestLog }),
			},
		}

		await pruneAbsentState(repoRoot, [keep], state)

		assertEquals(await readFile(keepLog, 'utf8'), 'keep\n')
		await assertRejects(() => readFile(goneLog, 'utf8'), Error)
		await assertRejects(() => readFile(goneManifestLog, 'utf8'), Error)
		await assertRejects(() => readFile(join(orphanLogDir, 'x.log'), 'utf8'), Error)
		assertEquals(await readFile(join(keepPlaywrightDir, 'marker.txt'), 'utf8'), 'ok\n')
		await assertRejects(() => readFile(join(gonePlaywrightDir, 'marker.txt'), 'utf8'), Error)
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})

Deno.test('buildStateMarkdown lists only current suites', () => {
	const suite = makeSuite('shells/chat', 'pure')
	const state = {
		suites: {
			'shells/chat:pure': makeStateEntry({ status: 'passed', commitHash: 'abcdef12', ranAt: 't', durationMs: 1 }),
			'p2p:sim': makeStateEntry({ status: 'failed' }),
		},
	}
	const md = buildStateMarkdown([suite], state, new Set())
	assertEquals(md.includes('shells/chat:pure'), true)
	assertEquals(md.includes('p2p:sim'), false)
})

Deno.test('upsertSuiteRun drops unknown subtest entries', async () => {
	const repoRoot = await makeRepoRoot()
	try {
		const suite = makeSuite('shells/chat', 'frontend', {
			subtests: [
				{ name: 'feed', triggers: ['a'], spec: 'feed.spec.mjs' },
			],
		})
		const key = suiteKey(suite.manifestId, suite.name)
		const state = {
			suites: {
				[key]: makeStateEntry({
					subtests: {
						feed: {
							status: 'passed',
							commitHash: 'old',
							uncommittedHash: null,
							ranAt: '',
							durationMs: 10,
							triggerHash: null,
						},
						legacy: {
							status: 'failed',
							commitHash: 'old',
							uncommittedHash: null,
							ranAt: '',
							durationMs: 10,
							triggerHash: null,
						},
					},
				}),
			},
		}
		await upsertSuiteRun({
			repoRoot,
			state,
			suite,
			result: { passed: true, failedFiles: [], output: '', durationMs: 5 },
			commitHash: 'head',
			uncommittedHash: null,
			ranSubtests: ['feed'],
		})
		assertEquals(Object.keys(state.suites[key].subtests), ['feed'])
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})
