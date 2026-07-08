/* global Deno */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { MiB } from '../core/concurrency.mjs'
import {
	detectDependencyCycle,
	expandWithDependencies,
	expandWithDependents,
	listUnsatisfiedDependencies,
	resolveSuiteDependencies,
	sortManifestIds,
	topoSortSuites,
} from '../core/deps.mjs'
import { listManifestIds, loadAllSuites, selectSuitesByDiff } from '../core/manifest.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import {
	computeSuiteTriggerHash,
	isDependencySatisfied,
	isSuiteGreen,
	isSuiteOutdated,
	isSuiteReusable,
	readState,
	suiteKey,
	upsertSuiteRun,
	writeState,
	writeStateMarkdown,
} from '../core/state.mjs'
import { DependencyRunCoordinator } from '../runner/dependency_scheduler.mjs'
import { ResourceRunGate } from '../runner/scheduler.mjs'

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

Deno.test('sortManifestIds orders dependency before dependent', () => {
	const all = [
		suite('p2p', 'sim'),
		suite('shells/chat', 'fed_core', ['p2p:sim']),
		suite('server', 'live'),
	]
	assertEquals(
		sortManifestIds(['shells/chat', 'p2p', 'server'], all),
		['server', 'p2p', 'shells/chat'],
	)
})

Deno.test('topoSortSuites tie-breaks by slash count then length before locale', () => {
	const all = [
		suite('p2p', 'sim'),
		suite('aa', 'sim'),
		suite('shells/chat', 'sim'),
	]
	assertEquals(
		topoSortSuites(all).map(s => suiteKey(s.manifestId, s.name)),
		['aa/sim', 'p2p/sim', 'shells/chat/sim'],
	)
})

Deno.test('sortManifestIds tie-breaks by slash count then length before locale', () => {
	const all = [
		suite('p2p', 'sim'),
		suite('aa', 'sim'),
		suite('shells/chat', 'sim'),
	]
	assertEquals(
		sortManifestIds(['shells/chat', 'p2p', 'aa'], all),
		['aa', 'p2p', 'shells/chat'],
	)
})

Deno.test('topoSortSuites tie-breaks by dependent count then dep count then locale', () => {
	const all = [
		suite('a', 'one'),
		suite('b', 'one'),
		suite('c', 'one', ['a:one']),
		suite('d', 'one', ['a:one', 'b:one']),
	]
	assertEquals(
		topoSortSuites(all).map(s => suiteKey(s.manifestId, s.name)),
		['b/one', 'a/one', 'c/one', 'd/one'],
	)
})

Deno.test('sortManifestIds tie-breaks by dependent count then dep count then locale', () => {
	const all = [
		suite('a', 'one'),
		suite('b', 'one'),
		suite('c', 'one', ['a:one']),
		suite('d', 'one', ['a:one', 'b:one']),
	]
	assertEquals(
		sortManifestIds(['a', 'b', 'c', 'd'], all),
		['b', 'a', 'c', 'd'],
	)
})

Deno.test('topoSortSuites reorders reversed input', () => {
	const all = [
		suite('p2p', 'sim'),
		suite('shells/chat', 'fed_core', ['p2p:sim']),
	]
	assertEquals(
		topoSortSuites([all[1], all[0]], all).map(s => suiteKey(s.manifestId, s.name)),
		['p2p/sim', 'shells/chat/fed_core'],
	)
})

Deno.test('listManifestIds uses dependency-aware order', async () => {
	const all = await loadAllSuites(REPO_ROOT)
	const ids = listManifestIds(all)
	assertEquals(ids.includes('p2p') && ids.includes('shells/chat'), true)
	assertEquals(ids.indexOf('p2p') < ids.indexOf('shells/chat'), true)
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
		expanded.suites.map(s => suiteKey(s.manifestId, s.name)),
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

Deno.test('isSuiteReusable reuses any real result when triggers untouched, force disables', () => {
	const s = suite('shells/chat', 'pure')
	s.triggers = ['src/public/parts/shells/chat/**']
	const base = {
		commitHash: 'abc',
		uncommittedHash: null,
		ranAt: '',
		durationMs: 1,
		triggerHash: 'h1',
		failedFiles: [],
		noiseHits: [],
		logPath: null,
	}
	const passed = { ...base, status: 'passed' }
	const failed = { ...base, status: 'failed' }
	const noisy = { ...base, status: 'noisy' }

	// 无 commit trigger 命中 + triggerHash 一致 → passed/failed/noisy 都复用（失败也复用）。
	assertEquals(isSuiteReusable(s, passed, [], 'h1', false), true)
	assertEquals(isSuiteReusable(s, failed, [], 'h1', false), true)
	assertEquals(isSuiteReusable(s, noisy, [], 'h1', false), true)

	// --force 一律不复用。
	assertEquals(isSuiteReusable(s, passed, [], 'h1', true), false)
	// blocked 非真实结果 → 不复用。
	assertEquals(isSuiteReusable(s, { ...base, status: 'blocked' }, [], 'h1', false), false)
	// commit 变更命中 trigger → 不复用。
	assertEquals(isSuiteReusable(s, passed, ['src/public/parts/shells/chat/foo.mjs'], 'h1', false), false)
	// 未提交 trigger 内容变化（triggerHash 不一致）→ 不复用。
	assertEquals(isSuiteReusable(s, passed, [], 'h2', false), false)
	assertEquals(isSuiteReusable(s, passed, [], null, false), false)
	// 无记录 → 不复用。
	assertEquals(isSuiteReusable(s, undefined, [], null, false), false)
})

Deno.test('computeSuiteTriggerHash digests only trigger-matched uncommitted files', () => {
	const s = suite('shells/chat', 'pure')
	s.triggers = ['src/public/parts/shells/chat/**']
	const rel = 'src/public/parts/shells/chat/foo.mjs'

	// 无相关未提交文件 → null。
	assertEquals(computeSuiteTriggerHash(s, new Map([['README.md', 'x']])), null)

	const h1 = computeSuiteTriggerHash(s, new Map([[rel, 'v1'], ['README.md', 'x']]))
	assertEquals(typeof h1, 'string')
	// 命中文件内容变化 → 指纹变化。
	const h2 = computeSuiteTriggerHash(s, new Map([[rel, 'v2'], ['README.md', 'x']]))
	assertEquals(h1 === h2, false)
	// 只有非命中文件变化 → 指纹不变。
	const h3 = computeSuiteTriggerHash(s, new Map([[rel, 'v1'], ['README.md', 'y']]))
	assertEquals(h1 === h3, true)
})

Deno.test('expandWithDependents pulls only one downstream level when parent is outdated', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/chat', 'smoke_chat', ['server:live']),
		suite('shells/chat', 'e2e_single', ['server:live', 'smoke_chat']),
		suite('shells/chat', 'frontend', ['server:live', 'e2e_single']),
	]
	all[1].triggers = ['src/public/parts/shells/chat/**']
	const state = {
		suites: {
			'shells/chat/smoke_chat': {
				status: 'passed',
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
	const changedSinceRecordByKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), []]))
	changedSinceRecordByKey.set('shells/chat/smoke_chat', ['src/public/parts/shells/chat/src/foo.mjs'])
	const ctx = {
		commitHash: 'abc',
		changedSinceRecordByKey,
	}
	// 只拉一层：smoke_chat 的直接下游是 e2e_single；frontend 只依赖 e2e_single，属第二层，不纳入。
	const expanded = expandWithDependents([all[1]], all, state, ctx)
	assertEquals(
		expanded.suites.map(s => suiteKey(s.manifestId, s.name)).sort(),
		['shells/chat/e2e_single', 'shells/chat/smoke_chat'].sort(),
	)
})

Deno.test('expandWithDependents does not pull downstream on failure without trigger', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/chat', 'smoke_chat', ['server:live']),
		suite('shells/chat', 'e2e_single', ['server:live', 'smoke_chat']),
	]
	const state = {
		suites: {
			'shells/chat/smoke_chat': {
				status: 'failed',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 1,
				failedFiles: ['a.mjs'],
				noiseHits: [],
				logPath: null,
			},
		},
	}
	const ctx = {
		commitHash: 'abc',
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
	}
	// 仅 failed、无 trigger 命中：不向下传播（修复必改文件 → 届时靠 trigger 拉起）。
	const expanded = expandWithDependents([all[1]], all, state, ctx)
	assertEquals(
		expanded.suites.map(s => suiteKey(s.manifestId, s.name)),
		['shells/chat/smoke_chat'],
	)
})

Deno.test('expandWithDependents skips downstream when parent is green and fresh', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/chat', 'smoke_chat', ['server:live']),
		suite('shells/chat', 'e2e_single', ['server:live', 'smoke_chat']),
		suite('shells/chat', 'frontend', ['server:live', 'e2e_single']),
	]
	const state = {
		suites: {
			'shells/chat/smoke_chat': {
				status: 'passed',
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
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
	}
	const expanded = expandWithDependents([all[1]], all, state, ctx)
	assertEquals(
		expanded.suites.map(s => suiteKey(s.manifestId, s.name)),
		['shells/chat/smoke_chat'],
	)
})

Deno.test('explicit suite selection does not pull downstream federation tree', () => {
	const all = [
		suite('server', 'live'),
		suite('p2p', 'sim'),
		suite('p2p', 'live'),
		suite('shells/chat', 'fed_core', ['server:live', 'p2p:sim', 'p2p:live']),
		suite('shells/chat', 'fed_e2e_ext', ['fed_core']),
	]
	const state = {
		suites: {
			'server/live': {
				status: 'passed',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 1,
				failedFiles: [],
				noiseHits: [],
				logPath: null,
			},
			'p2p/sim': {
				status: 'passed',
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
	const expanded = expandWithDependencies([all[2]], all, state, ctx)
	assertEquals(
		expanded.suites.map(s => suiteKey(s.manifestId, s.name)),
		['p2p/live'],
	)
})

Deno.test('expandWithDependencies skips upstream when only uncommittedHash drifted', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/chat', 'e2e_single', ['server:live', 'smoke_chat']),
		suite('shells/chat', 'frontend', ['server:live', 'e2e_single']),
	]
	const passed = {
		status: 'passed',
		commitHash: 'abc',
		uncommittedHash: 'old-digest',
		ranAt: '',
		durationMs: 1,
		failedFiles: [],
		noiseHits: [],
		logPath: null,
	}
	const state = {
		suites: {
			'server/live': passed,
			'shells/chat/e2e_single': passed,
		},
	}
	const ctx = {
		commitHash: 'abc',
		uncommittedHash: 'new-digest',
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
		runGreenKeys: new Set(),
		byKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), s])),
	}
	assertEquals(isSuiteGreen(passed, 'abc', 'new-digest', false), false)
	assertEquals(isDependencySatisfied(passed, false), true)
	const expanded = expandWithDependencies([all[2]], all, state, ctx)
	assertEquals(expanded.suites.map(s => suiteKey(s.manifestId, s.name)), ['shells/chat/frontend'])
})

Deno.test('expandWithDependencies skips green upstream deps', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/chat', 'e2e_single', ['server:live', 'smoke_chat']),
		suite('shells/chat', 'frontend', ['server:live', 'e2e_single']),
	]
	const passed = {
		status: 'passed',
		commitHash: 'abc',
		uncommittedHash: null,
		ranAt: '',
		durationMs: 1,
		failedFiles: [],
		noiseHits: [],
		logPath: null,
	}
	const state = {
		suites: {
			'server/live': passed,
			'shells/chat/e2e_single': passed,
		},
	}
	const ctx = {
		commitHash: 'abc',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
		runGreenKeys: new Set(),
		byKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), s])),
	}
	const expanded = expandWithDependencies([all[2]], all, state, ctx)
	assertEquals(expanded.suites.map(s => suiteKey(s.manifestId, s.name)), ['shells/chat/frontend'])
})

Deno.test('isDependencySatisfied accepts noisy upstream', () => {
	const noisy = {
		status: 'noisy',
		commitHash: 'abc',
		uncommittedHash: null,
		ranAt: '',
		durationMs: 1,
		failedFiles: [],
		noiseHits: ['warn'],
		logPath: './logs/server/live.log',
	}
	assertEquals(isDependencySatisfied(noisy, false), true)
	assertEquals(isDependencySatisfied(noisy, true), false)
	assertEquals(isDependencySatisfied({ ...noisy, status: 'failed' }, false), false)
	assertEquals(isDependencySatisfied({ ...noisy, commitHash: 'old' }, false), true)
})

Deno.test('expandWithDependencies skips upstream when only commit drifted', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/chat', 'e2e_single', ['server:live', 'smoke_chat']),
		suite('shells/chat', 'frontend', ['server:live', 'e2e_single']),
	]
	const passed = {
		status: 'passed',
		commitHash: 'old-commit',
		uncommittedHash: null,
		ranAt: '',
		durationMs: 1,
		failedFiles: [],
		noiseHits: [],
		logPath: null,
	}
	const state = {
		suites: {
			'server/live': passed,
			'shells/chat/e2e_single': passed,
		},
	}
	const ctx = {
		commitHash: 'new-head',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
		runGreenKeys: new Set(),
		byKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), s])),
	}
	assertEquals(isDependencySatisfied(passed, false), true)
	const expanded = expandWithDependencies([all[2]], all, state, ctx)
	assertEquals(expanded.suites.map(s => suiteKey(s.manifestId, s.name)), ['shells/chat/frontend'])
})

Deno.test('listUnsatisfiedDependencies when dep is noisy', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/chat', 'frontend', ['server:live']),
	]
	const state = {
		suites: {
			'server/live': {
				status: 'noisy',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 1,
				failedFiles: [],
				noiseHits: ['warn'],
				logPath: './logs/server/live.log',
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
	assertEquals(listUnsatisfiedDependencies(all[1], state, ctx), [])
})

Deno.test('expandWithDependencies skips noisy upstream deps', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/chat', 'e2e_single', ['server:live']),
		suite('shells/chat', 'frontend', ['server:live', 'e2e_single']),
	]
	const noisy = {
		status: 'noisy',
		commitHash: 'abc',
		uncommittedHash: null,
		ranAt: '',
		durationMs: 1,
		failedFiles: [],
		noiseHits: ['warn'],
		logPath: './logs/server/live.log',
	}
	const state = {
		suites: {
			'server/live': noisy,
			'shells/chat/e2e_single': noisy,
		},
	}
	const ctx = {
		commitHash: 'abc',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])),
		runGreenKeys: new Set(),
		byKey: new Map(all.map(s => [suiteKey(s.manifestId, s.name), s])),
	}
	const expanded = expandWithDependencies([all[2]], all, state, ctx)
	assertEquals(expanded.suites.map(s => suiteKey(s.manifestId, s.name)), ['shells/chat/frontend'])
})

Deno.test('DependencyRunCoordinator treats green upstream as resolved without running', async () => {
	const all = [
		suite('server', 'live'),
		suite('shells/chat', 'frontend', ['server:live']),
	]
	const state = {
		suites: {
			'server/live': {
				status: 'passed',
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
	/**
	 * @returns {Promise<() => void>} release callback
	 */
	async function mockAcquire() {
		return () => {}
	}
	const gate = { acquire: mockAcquire }
	const coordinator = new DependencyRunCoordinator({
		suites: [all[1]],
		state,
		ctx,
		gate,
	})
	/** @type {string[]} */
	const ran = []
	await coordinator.runAll(async outcome => {
		if (outcome.kind === 'run')
			ran.push(suiteKey(outcome.suite.manifestId, outcome.suite.name))
		return { passed: true }
	})
	assertEquals(ran, ['shells/chat/frontend'])
})

Deno.test('DependencyRunCoordinator serial runs in report order, parallel packs biggest first', async () => {
	// 独立 suite，无依赖；suites 数组顺序 = 报告拓扑序。资源体量刻意与之相反。
	const light = { ...suite('p2p', 'pure'), resources: { memMb: 300, cpuPct: 10 } }
	const big = { ...suite('shells/chat', 'integration'), resources: { memMb: 1800, cpuPct: 25 } }
	const suites = [light, big]
	const state = { suites: {} }
	const ctx = {
		commitHash: 'abc',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(suites.map(s => [suiteKey(s.manifestId, s.name), []])),
		runGreenKeys: new Set(),
		byKey: new Map(suites.map(s => [suiteKey(s.manifestId, s.name), s])),
	}

	/**
	 * @param {boolean} serial 是否串行
	 * @returns {Promise<string[]>} 实际运行顺序
	 */
	async function runOrder(serial) {
		const gate = new ResourceRunGate(8000 * MiB, () => undefined, { serial })
		/** @type {string[]} */
		const ran = []
		await new DependencyRunCoordinator({ suites, state, ctx, gate }).runAll(async outcome => {
			if (outcome.kind === 'run') ran.push(suiteKey(outcome.suite.manifestId, outcome.suite.name))
			return { passed: true }
		})
		return ran
	}

	// 串行：gate FIFO 放行 → 严格按报告顺序。
	assertEquals(await runOrder(true), ['p2p/pure', 'shells/chat/integration'])
	// 并行：coordinator 按资源体量降序派发（BFD），重的先跑，证明二者确实分叉。
	assertEquals(await runOrder(false), ['shells/chat/integration', 'p2p/pure'])
})

Deno.test('chat frontend test change only selects frontend suite', async () => {
	const all = await loadAllSuites(REPO_ROOT)
	const chat = all.filter(s => s.manifestId === 'shells/chat')
	const hit = selectSuitesByDiff(
		'diff',
		['src/public/parts/shells/chat/test/frontend/phases.mjs'],
		chat,
	)
	assertEquals(hit.map(s => s.name), ['frontend'])
})

Deno.test('social integration test change only selects integration suite', async () => {
	const all = await loadAllSuites(REPO_ROOT)
	const social = all.filter(s => s.manifestId === 'shells/social')
	const hit = selectSuitesByDiff(
		'diff',
		['src/public/parts/shells/social/test/integration/posts_http.test.mjs'],
		social,
	)
	assertEquals(hit.map(s => s.name), ['integration'])
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
		expanded.suites.map(s => suiteKey(s.manifestId, s.name)),
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

Deno.test('listUnsatisfiedDependencies blocks social cross_shell_emoji when fed_core failed', () => {
	const all = [
		suite('server', 'live'),
		suite('p2p', 'sim'),
		suite('p2p', 'live'),
		suite('shells/social', 'smoke_social', ['server:live']),
		suite('shells/chat', 'fed_core', ['server:live', 'p2p:sim', 'p2p:live']),
		suite('shells/chat', 'fed_emoji', ['fed_core']),
		suite('shells/social', 'cross_shell_emoji', ['server:live', 'smoke_social', 'shells/chat:fed_core', 'shells/chat:fed_emoji']),
	]
	const state = {
		suites: {
			'shells/chat/fed_core': {
				status: 'failed',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 1,
				failedFiles: [],
				noiseHits: ['Error'],
				logPath: './logs/shells_chat/fed_core.log',
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
	const missing = listUnsatisfiedDependencies(all[6], state, ctx)
	assertEquals(missing, [
		'server/live',
		'shells/social/smoke_social',
		'shells/chat/fed_core',
		'shells/chat/fed_emoji',
	])
})

Deno.test('listUnsatisfiedDependencies blocks social e2e_single when smoke_social failed', () => {
	const all = [
		suite('server', 'live'),
		suite('shells/social', 'smoke_social', ['server:live']),
		suite('shells/social', 'e2e_single', ['server:live', 'smoke_social']),
	]
	const state = {
		suites: {
			'shells/social/smoke_social': {
				status: 'failed',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 1,
				failedFiles: [],
				noiseHits: ['Error'],
				logPath: './logs/shells_social/smoke_social.log',
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
	assertEquals(missing, ['server/live', 'shells/social/smoke_social'])
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
