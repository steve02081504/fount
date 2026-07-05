/* global Deno */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	detectDependencyCycle,
	expandWithDependencies,
	listUnsatisfiedDependencies,
	resolveSuiteDependencies,
	topoSortSuites,
} from '../core/deps.mjs'
import { loadAllSuites } from '../core/manifest.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import {
	isSuiteGreen,
	isSuiteOutdated,
	readState,
	suiteKey,
	upsertSuiteRun,
	writeState,
	writeStateMarkdown,
} from '../core/state.mjs'

/** @type {import('../core/manifest.mjs').SuiteDef} */
function suite(manifestId, name, dependsOn = []) {
	return {
		manifestId,
		name,
		id: name,
		run: [],
		triggers: [`src/${manifestId}/**`],
		manifestPath: '',
		heavy: false,
		dependsOn,
		dependencies: dependsOn.map(dep => {
			const colon = dep.indexOf(':')
			return colon >= 0
				? { manifestId: dep.slice(0, colon), name: dep.slice(colon + 1) }
				: { manifestId, name: dep }
		}),
	}
}

Deno.test('resolveSuiteDependencies expands manifest selector', () => {
	const all = [
		suite('p2p', 'sim'),
		suite('shells/chat', 'fed_core', ['p2p:sim']),
	]
	const deps = resolveSuiteDependencies(all[1], all)
	assertEquals(deps, [{ manifestId: 'p2p', name: 'sim' }])
})

Deno.test('resolveSuiteDependencies does not self-match fed_emoji prefix', () => {
	const all = [
		suite('shells/chat', 'fed_core'),
		suite('shells/chat', 'fed_emoji', ['fed_core']),
		suite('shells/chat', 'fed_emoji_nonmember', ['fed_core', 'fed_emoji']),
	]
	const deps = resolveSuiteDependencies(all[2], all)
	assertEquals(deps, [
		{ manifestId: 'shells/chat', name: 'fed_core' },
		{ manifestId: 'shells/chat', name: 'fed_emoji' },
	])
	assertEquals(detectDependencyCycle(all), null)
})

Deno.test('topoSortSuites orders dependencies first', () => {
	const all = [
		suite('p2p', 'sim'),
		suite('shells/chat', 'fed_core', ['p2p:sim']),
	]
	const sorted = topoSortSuites(all)
	assertEquals(sorted.map(s => suiteKey(s.manifestId, s.name)), ['p2p/sim', 'shells/chat/fed_core'])
})

Deno.test('detectDependencyCycle reports cycle', () => {
	const a = suite('a', 'one', ['b:two'])
	const b = suite('b', 'two', ['a:one'])
	assertEquals(detectDependencyCycle([a, b]), 'a/one -> b/two -> a/one')
})

Deno.test('expandWithDependencies pulls unsatisfied deps', () => {
	const all = [
		suite('p2p', 'sim'),
		suite('shells/social', 'cross_shell_emoji', ['shells/chat:pure']),
		suite('shells/chat', 'pure'),
	]
	const state = { suites: {} }
	const ctx = {
		commitHash: 'abc',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
		runGreenKeys: new Set(),
		byKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), s])),
	}
	const expanded = expandWithDependencies([all[1]], all, state, ctx)
	assertEquals(
		expanded.map(s => suiteKey(s.manifestId, s.name)),
		['shells/chat/pure', 'shells/social/cross_shell_emoji'],
	)
})

Deno.test('listUnsatisfiedDependencies when dep not green', () => {
	const all = [
		suite('p2p', 'sim'),
		suite('shells/chat', 'fed_core', ['p2p:sim']),
	]
	const state = {
		suites: {
			'p2p/sim': {
				status: 'failed',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 1,
				failedFiles: [],
				noiseHits: [],
				logPath: null,
			},
		},
	}
	const ctx = {
		commitHash: 'abc',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
		runGreenKeys: new Set(),
		byKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), s])),
	}
	const missing = listUnsatisfiedDependencies(all[1], state, ctx)
	assertEquals(missing, ['p2p/sim'])
})

Deno.test('state upsert preserves other suites and clears log on pass', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-state-test-'))
	try {
		const chatPure = suite('shells/chat', 'pure')
		const state = {
			suites: {
				'shells/chat/pure': {
					status: 'failed',
					commitHash: 'old',
					uncommittedHash: null,
					ranAt: 't0',
					durationMs: 10,
					baselineDurationMs: 10,
					failedFiles: ['a.mjs'],
					noiseHits: [],
					logPath: './logs/shells_chat/pure.log',
				},
				'p2p/sim': {
					status: 'passed',
					commitHash: 'old',
					uncommittedHash: null,
					ranAt: 't0',
					durationMs: 20,
					baselineDurationMs: 20,
					failedFiles: [],
					noiseHits: [],
					logPath: null,
				},
			},
		}
		await writeState(repoRoot, state)
		await upsertSuiteRun({
			repoRoot,
			state,
			suite: chatPure,
			result: {
				passed: true,
				failedFiles: [],
				output: 'noise',
				durationMs: 15,
			},
			commitHash: 'new',
			uncommittedHash: null,
		})
		assertEquals(state.suites['p2p/sim'].durationMs, 20)
		assertEquals(state.suites['shells/chat/pure'].status, 'passed')
		assertEquals(state.suites['shells/chat/pure'].logPath, null)
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})

Deno.test('isSuiteOutdated respects trigger files only', () => {
	const s = suite('shells/chat', 'pure')
	s.triggers = ['src/public/parts/shells/chat/**']
	const entry = {
		status: 'passed',
		commitHash: 'abc',
		uncommittedHash: null,
		ranAt: '',
		durationMs: 1,
		failedFiles: [],
		noiseHits: [],
		logPath: null,
	}
	assertEquals(isSuiteOutdated(s, entry, ['README.md']), false)
	assertEquals(isSuiteOutdated(s, entry, ['src/public/parts/shells/chat/foo.mjs']), true)
	assertEquals(isSuiteOutdated(s, undefined, []), true)
})

Deno.test('isSuiteGreen requires passed fingerprint and fresh triggers', () => {
	const entry = {
		status: 'passed',
		commitHash: 'abc',
		uncommittedHash: null,
		ranAt: '',
		durationMs: 1,
		failedFiles: [],
		noiseHits: [],
		logPath: null,
	}
	assertEquals(isSuiteGreen(entry, 'abc', null, false), true)
	assertEquals(isSuiteGreen(entry, 'abc', null, true), false)
	assertEquals(isSuiteGreen({ ...entry, status: 'blocked' }, 'abc', null, false), false)
})

Deno.test('expandWithDependencies pulls server:live for shell frontend', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/chat', 'frontend', ['server:live']),
	]
	const state = { suites: {} }
	const ctx = {
		commitHash: 'abc',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
		runGreenKeys: new Set(),
		byKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), s])),
	}
	const expanded = expandWithDependencies([all[1]], all, state, ctx)
	assertEquals(
		expanded.map(s => suiteKey(s.manifestId, s.name)),
		['server/live', 'shells/chat/frontend'],
	)
})

Deno.test('listUnsatisfiedDependencies blocks shell live when server:live failed', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/chat', 'frontend', ['server:live']),
	]
	const state = {
		suites: {
			'server/live': {
				status: 'failed',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 1,
				failedFiles: [],
				noiseHits: [],
				logPath: null,
			},
		},
	}
	const ctx = {
		commitHash: 'abc',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
		runGreenKeys: new Set(),
		byKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), s])),
	}
	const missing = listUnsatisfiedDependencies(all[1], state, ctx)
	assertEquals(missing, ['server/live'])
})

Deno.test('listUnsatisfiedDependencies blocks social cross_shell_emoji when social e2e_single failed', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/social', 'e2e_single', ['server:live']),
		suite('shells/social', 'cross_shell_emoji', ['server:live', 'e2e_single', 'shells/chat:pure', 'shells/chat:e2e_single']),
	]
	const state = {
		suites: {
			'shells/social/e2e_single': {
				status: 'failed',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 1,
				failedFiles: [],
				noiseHits: ['Error'],
				logPath: './logs/shells_social/e2e_single.log',
			},
		},
	}
	const ctx = {
		commitHash: 'abc',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
		runGreenKeys: new Set(),
		byKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), s])),
	}
	const missing = listUnsatisfiedDependencies(all[2], state, ctx)
	assertEquals(missing, [
		'server/live',
		'shells/social/e2e_single',
		'shells/chat/pure',
		'shells/chat/e2e_single',
	])
})

Deno.test('listUnsatisfiedDependencies blocks fed_core when p2p live failed', () => {
	const all = [
		suite('server', 'live'),
		suite('p2p', 'sim'),
		suite('p2p', 'live'),
		suite('shells/chat', 'fed_core', ['server:live', 'p2p:sim', 'p2p:live']),
	]
	const state = {
		suites: {
			'p2p/live': {
				status: 'failed',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 1,
				failedFiles: [],
				noiseHits: ['Error'],
				logPath: './logs/p2p/live.log',
			},
		},
	}
	const ctx = {
		commitHash: 'abc',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
		runGreenKeys: new Set(),
		byKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), s])),
	}
	const missing = listUnsatisfiedDependencies(all[3], state, ctx)
	assertEquals(missing, ['server/live', 'p2p/sim', 'p2p/live'])
})

Deno.test('writeStateMarkdown includes dependency mermaid', async () => {
	const all = await loadAllSuites(REPO_ROOT)
	const state = await readState(REPO_ROOT)
	const md = await writeStateMarkdown(REPO_ROOT, all, state, new Set())
	const content = await readFile(md, 'utf8')
	assertStringIncludes(content, '```mermaid')
	assertStringIncludes(content, 'classDef passed')
})
