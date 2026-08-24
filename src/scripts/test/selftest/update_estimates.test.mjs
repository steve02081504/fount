/**
 * --update-estimates：按现状库基线回写 manifest `expected`。
 */
/* global Deno */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { expectedDriftToleranceMs, formatExpected, isExpectedDrift, parseExpectedMs, roundExpectedMs } from '../core/expected.mjs'
import { suiteKey } from '../core/state.mjs'
import { applyDriftPatchToManifest, driftedEstimatePatch, updateManifestEstimates } from '../core/update_estimates.mjs'

import { makeStateEntry, makeSuite } from './fixtures.mjs'

Deno.test('parseExpectedMs accepts number and duration tokens', () => {
	assertEquals(parseExpectedMs(16_000), 16_000)
	assertEquals(parseExpectedMs('16s'), 16_000)
	assertEquals(parseExpectedMs('2m'), 120_000)
	assertEquals(parseExpectedMs('4m12s'), 252_000)
	assertEquals(parseExpectedMs('4m 12s'), 252_000)
	assertEquals(parseExpectedMs('500ms'), 500)
	assertEquals(parseExpectedMs(' 1h '), 3_600_000)
	assertEquals(parseExpectedMs(0), null)
	assertEquals(parseExpectedMs('nope'), null)
	assertEquals(parseExpectedMs('16s leftover'), null)
})

Deno.test('roundExpectedMs uses second grid above 1s', () => {
	assertEquals(roundExpectedMs(16_347), 16_000)
	assertEquals(roundExpectedMs(477), 500)
	assertEquals(roundExpectedMs(50), 100)
	assertEquals(roundExpectedMs(0), null)
	assertEquals(roundExpectedMs(-1), null)
})

Deno.test('formatExpected writes compact duration literals', () => {
	assertEquals(formatExpected(16_000), '16s')
	assertEquals(formatExpected(120_000), '2m')
	assertEquals(formatExpected(252_000), '4m12s')
	assertEquals(formatExpected(477), 500)
	assertEquals(formatExpected(null), null)
})

/**
 * @returns {Promise<string>} 临时仓库根
 */
async function makeRepoRoot() {
	return await mkdtemp(join(tmpdir(), 'fount_update_estimates_'))
}

Deno.test('updateManifestEstimates writes suite and subtest expected after name', async () => {
	const repoRoot = await makeRepoRoot()
	try {
		const rel = 'src/parts/demo/test/manifest.json'
		const abs = join(repoRoot, rel)
		await mkdir(join(abs, '..'), { recursive: true })
		await writeFile(abs, `${JSON.stringify({
			id: 'demo',
			suites: [
				{
					name: 'pure',
					run: ['deno', 'test'],
					triggers: ['src/parts/demo/**'],
				},
				{
					name: 'frontend',
					run: ['deno', 'run'],
					subtests: [
						{ name: 'smoke', triggers: ['a'] },
						{ name: 'feed', triggers: ['b'] },
					],
				},
			],
		}, null, '\t')}\n`, 'utf8')

		const pure = makeSuite('demo', 'pure', { manifestPath: rel })
		const frontend = makeSuite('demo', 'frontend', {
			manifestPath: rel,
			subtests: [
				{ name: 'smoke', spec: 'smoke.spec.mjs', triggers: [] },
				{ name: 'feed', spec: 'feed.spec.mjs', triggers: [] },
			],
		})
		const result = await updateManifestEstimates({
			repoRoot,
			suites: [pure, frontend],
			state: {
				suites: {
					[suiteKey('demo', 'pure')]: makeStateEntry({ baselineDurationMs: 16_347 }),
					[suiteKey('demo', 'frontend')]: makeStateEntry({
						baselineDurationMs: 90_400,
						subtests: {
							smoke: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 20_200, triggerHash: null },
							feed: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 30_400, triggerHash: null },
						},
					}),
				},
			},
		})
		assertEquals(result, { filesChanged: 1, suitesUpdated: 2, skipped: 0 })

		const written = JSON.parse(await readFile(abs, 'utf8'))
		assertEquals(Object.keys(written.suites[0]), ['name', 'expected', 'run', 'triggers'])
		assertEquals(written.suites[0].expected, '16s')
		assertEquals(written.suites[1].expected, '1m30s')
		assertEquals(written.suites[1].subtests[0].expected, '20s')
		assertEquals(written.suites[1].subtests[1].expected, '30s')
		assertEquals(Object.keys(written.suites[1].subtests[0])[1], 'expected')
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})

Deno.test('expectedDriftToleranceMs grows sub-linearly and matches the anchor points', () => {
	// 幂函数 37·scale^0.656：500ms→~2s，4min→~3min，30min→~6min。
	assertEquals(expectedDriftToleranceMs(0), 0)
	assert(expectedDriftToleranceMs(500) > 1_000 && expectedDriftToleranceMs(500) < 3_000)
	assert(expectedDriftToleranceMs(240_000) > 60_000 && expectedDriftToleranceMs(240_000) < 300_000)
	assert(expectedDriftToleranceMs(1_800_000) > 120_000 && expectedDriftToleranceMs(1_800_000) < 600_000)
	// 单调、亚线性（规模×10 时容差远小于×10）。
	const ten = expectedDriftToleranceMs(100_000) * 10
	assert(expectedDriftToleranceMs(1_000_000) < ten)
})

Deno.test('isExpectedDrift fires when the gap exceeds the continuous tolerance at the larger scale', () => {
	// 空值 / 缺失：语义不变。
	assertEquals(isExpectedDrift(null, 240_000), true)
	assertEquals(isExpectedDrift(240_000, null), false)
	assertEquals(isExpectedDrift(240_000, undefined), false)
	// 零漂移。
	assertEquals(isExpectedDrift(240_000, 240_000), false)
	// 容差以较大值为基准连续给出。
	const tol = expectedDriftToleranceMs(240_000)
	// 超出容差 → 漂移。
	assertEquals(isExpectedDrift(240_000 - tol - 10_000, 240_000), true)
	// 未超容差 → 不漂移。
	assertEquals(isExpectedDrift(240_000 - Math.floor(tol) + 10_000, 240_000), false)
})

Deno.test('driftedEstimatePatch only includes drifted suite and subtest fields', () => {
	const suite = makeSuite('demo', 'frontend', {
		expectedMs: 90_000,
		subtests: [
			{ name: 'smoke', spec: 'smoke.spec.mjs', triggers: [], expectedMs: 20_000 },
			{ name: 'feed', spec: 'feed.spec.mjs', triggers: [], expectedMs: 30_000 },
		],
	})
	const entry = makeStateEntry({
		baselineDurationMs: 120_000,
		subtests: {
			smoke: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 21_000, triggerHash: null },
			feed: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 33_000, triggerHash: null },
		},
	})
	const patch = driftedEstimatePatch(suite, entry)
	// suite 90s→120s 漂移；smoke 20s→21s 未漂移；feed 30s→33s 未漂移
	assertEquals(patch, { expected: '2m' })
})

Deno.test('driftedEstimatePatch returns null when nothing drifts or no baseline', () => {
	const suite = makeSuite('demo', 'pure', { expectedMs: 16_000 })
	const fresh = makeStateEntry({ baselineDurationMs: 16_200 })
	assertEquals(driftedEstimatePatch(suite, fresh), null)
	assertEquals(driftedEstimatePatch(suite, undefined), null)
})

Deno.test('applyDriftPatchToManifest writes only drifted fields and serializes same-path writes', async () => {
	const repoRoot = await makeRepoRoot()
	try {
		const manifestPath = 'src/parts/demo/test/manifest.json'
		const manifestAbsolutePath = join(repoRoot, manifestPath)
		await mkdir(join(manifestAbsolutePath, '..'), { recursive: true })
		await writeFile(manifestAbsolutePath, `${JSON.stringify({
			id: 'demo',
			suites: [
				{ name: 'pure', expected: '16s', run: ['deno'] },
				{ name: 'frontend', expected: '90s', run: ['deno'], subtests: [{ name: 'smoke', expected: '20s' }] },
			],
		}, null, '\t')}\n`, 'utf8')

		const pure = makeSuite('demo', 'pure', { manifestPath, expectedMs: 16_000 })
		const frontend = makeSuite('demo', 'frontend', {
			manifestPath,
			expectedMs: 90_000,
			subtests: [{ name: 'smoke', spec: 'smoke.spec.mjs', triggers: [], expectedMs: 20_000 }],
		})
		// 并发写同一 manifest：一个漂移、一个不漂移。
		const [pureChanged, frontendChanged] = await Promise.all([
			applyDriftPatchToManifest(repoRoot, pure, { expected: '2m' }),
			applyDriftPatchToManifest(repoRoot, frontend, { subtests: { smoke: '25s' } }),
		])
		assertEquals(pureChanged, true)
		assertEquals(frontendChanged, true)
		const written = JSON.parse(await readFile(manifestAbsolutePath, 'utf8'))
		assertEquals(written.suites[0].expected, '2m')
		assertEquals(written.suites[1].expected, '90s')
		assertEquals(written.suites[1].subtests[0].expected, '25s')
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})

Deno.test('updateManifestEstimates skips suites without baseline and leaves file when nothing changes', async () => {
	const repoRoot = await makeRepoRoot()
	try {
		const rel = 'src/parts/demo/test/manifest.json'
		const abs = join(repoRoot, rel)
		await mkdir(join(abs, '..'), { recursive: true })
		const original = `${JSON.stringify({
			id: 'demo',
			suites: [{ name: 'pure', expected: '16s', run: ['deno'] }],
		}, null, '\t')}\n`
		await writeFile(abs, original, 'utf8')

		const suite = makeSuite('demo', 'pure', { manifestPath: rel })
		const noBaseline = await updateManifestEstimates({
			repoRoot,
			suites: [suite],
			state: { suites: {} },
		})
		assertEquals(noBaseline, { filesChanged: 0, suitesUpdated: 0, skipped: 1 })
		assertEquals(await readFile(abs, 'utf8'), original)

		const alreadyFresh = await updateManifestEstimates({
			repoRoot,
			suites: [suite],
			state: {
				suites: {
					[suiteKey('demo', 'pure')]: makeStateEntry({ baselineDurationMs: 16_200 }),
				},
			},
		})
		assertEquals(alreadyFresh, { filesChanged: 0, suitesUpdated: 0, skipped: 1 })
		assertEquals(await readFile(abs, 'utf8'), original)
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})
