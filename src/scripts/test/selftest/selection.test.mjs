/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { suiteKey } from '../core/state.mjs'
import { parseCommandSeedSuites, rebuildReportSlotReasons } from '../runner/selection.mjs'

/**
 * @param {string} manifestId manifest id
 * @param {string} name suite 名
 * @param {string[]} dependsOn 依赖（`manifest:name` 或本 manifest 内 `name`）
 * @returns {import('../core/manifest.mjs').SuiteDef} suite 定义
 */
function suite(manifestId, name, dependsOn = []) {
	return {
		manifestId,
		name,
		id: name,
		run: [],
		triggers: [`src/${manifestId}/**`],
		manifestPath: '',
		heavy: false,
		dependencies: dependsOn.map(d => {
			const colon = d.indexOf(':')
			return colon >= 0
				? { manifestId: d.slice(0, colon), name: d.slice(colon + 1) }
				: { manifestId, name: d }
		}),
	}
}

/**
 * @param {import('../core/manifest.mjs').SuiteDef[]} suites suite 列表
 * @returns {object} 全新鲜、无变更的扩展上下文
 */
function freshCtx(suites) {
	return {
		commitHash: 'head1',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(suites.map(s => [suiteKey(s.manifestId, s.name), []])),
		byKey: new Map(suites.map(s => [suiteKey(s.manifestId, s.name), s])),
		runGreenKeys: new Set(),
	}
}

Deno.test('parseCommandSeedSuites distinguishes explicit / manifest / continue commands', () => {
	const all = [suite('server', 'live'), suite('shells/chat', 'frontend', ['server:live'])]

	const explicit = parseCommandSeedSuites('fount test shells/chat:frontend', all)
	assertEquals(explicit.explicitSuites, true)
	assertEquals(explicit.seedSuites.map(s => suiteKey(s.manifestId, s.name)), ['shells/chat/frontend'])

	const manifest = parseCommandSeedSuites('fount test server', all)
	assertEquals(manifest.explicitSuites, false)
	assertEquals(manifest.seedSuites.map(s => suiteKey(s.manifestId, s.name)), ['server/live'])

	const cont = parseCommandSeedSuites('fount test --continue', all)
	assertEquals(cont.explicitSuites, false)
	assertEquals(cont.seedSuites, [])
})

Deno.test('rebuildReportSlotReasons stamps explicit seed and its pulled dependency', () => {
	const all = [suite('server', 'live'), suite('shells/chat', 'frontend', ['server:live'])]
	const state = { suites: {} }
	const { reasons, seedKeys } = rebuildReportSlotReasons({
		command: 'fount test shells/chat:frontend',
		allSuites: all,
		slots: all,
		state,
		context: freshCtx(all),
	})
	assertEquals([...seedKeys], ['shells/chat/frontend'])
	assertEquals(reasons.get('shells/chat/frontend')?.kind, 'explicit_selected')
	assertEquals(reasons.get('server/live')?.requiredBy, 'shells/chat/frontend')
})

Deno.test('rebuildReportSlotReasons keeps continue slots untouched when no seed', () => {
	const all = [suite('server', 'live'), suite('shells/chat', 'frontend', ['server:live'])]
	const state = { suites: {} }
	const { reasons, seedKeys, provenance } = rebuildReportSlotReasons({
		command: 'fount test --continue',
		allSuites: all,
		slots: all,
		state,
		context: freshCtx(all),
	})
	assertEquals(seedKeys.size, 0)
	assertEquals(provenance.size, 0)
	assertEquals(reasons.size, 0)
})
