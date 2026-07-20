/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { buildPlan } from '../core/plan.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import {
	normalizeTestFileStem,
	resolveSerialOnlyFiles,
	validateSubtestFilters,
} from '../core/serial_files.mjs'
import { suiteKey } from '../core/state.mjs'

import { makeSuite } from './fixtures.mjs'

Deno.test('normalizeTestFileStem strips extensions', () => {
	assertEquals(normalizeTestFileStem('channel_archive'), 'channel_archive')
	assertEquals(normalizeTestFileStem('channel_archive.test'), 'channel_archive')
	assertEquals(normalizeTestFileStem('channel_archive.test.mjs'), 'channel_archive')
	assertEquals(normalizeTestFileStem('path/to/channel_archive.test.mjs'), 'channel_archive')
})

Deno.test('resolveSerialOnlyFiles maps stem to chat pure tests', () => {
	const suite = makeSuite('shells/chat', 'pure', {
		run: [
			'deno', 'run', '--allow-scripts', '--allow-all', '-c', './deno.json',
			'./src/scripts/test/deno/serial.mjs',
			'./src/public/parts/shells/chat/test/pure/',
		],
	})
	const { files, missing } = resolveSerialOnlyFiles(
		suite,
		['channel_archive', 'local_plugins', 'no_such_file'],
		REPO_ROOT,
	)
	assertEquals(missing, ['no_such_file'])
	assertEquals(files.sort(), [
		'src/public/parts/shells/chat/test/pure/channel_archive.test.mjs',
		'src/public/parts/shells/chat/test/pure/local_plugins.test.mjs',
	].sort())
})

Deno.test('validateSubtestFilters rejects unknown frontend subtest', () => {
	const suite = makeSuite('shells/chat', 'frontend', {
		subtests: [{ name: 'feed', triggers: ['x'] }],
		run: ['deno', 'run', 'x'],
	})
	const byKey = new Map([[suiteKey(suite.manifestId, suite.name), suite]])
	const filter = new Map([[suiteKey(suite.manifestId, suite.name), ['missing']]])
	const errors = validateSubtestFilters(filter, byKey, REPO_ROOT)
	assertEquals(errors.length, 1)
	assertEquals(errors[0].kind, 'subtest')
	assertEquals(errors[0].missing, ['missing'])
})

Deno.test('buildPlan forces run for explicit file filter on green serial suite', () => {
	const suite = makeSuite('shells/chat', 'pure', {
		run: [
			'deno', 'run', '--allow-scripts', '--allow-all', '-c', './deno.json',
			'./src/scripts/test/deno/serial.mjs',
			'./src/public/parts/shells/chat/test/pure/',
		],
	})
	const key = suiteKey(suite.manifestId, suite.name)
	const byKey = new Map([[key, suite]])
	const verdicts = new Map([[key, {
		kind: 'green',
		triggerHash: 'h',
		reason: 'fresh',
	}]])
	const plan = buildPlan(
		new Set([key]),
		verdicts,
		byKey,
		[suite],
		new Map(),
		false,
		new Map([[key, ['channel_archive']]]),
	)
	const slot = plan.slots[0]
	assertEquals(slot.action, 'run')
	assertEquals(slot.fileFilters, ['channel_archive'])
})

Deno.test('buildPlan forces run for explicit registered subtest on green suite', () => {
	const suite = makeSuite('shells/chat', 'frontend', {
		subtests: [
			{ name: 'feed', triggers: ['a'] },
			{ name: 'smoke', triggers: ['b'] },
		],
		run: ['deno', 'run', 'x'],
	})
	const key = suiteKey(suite.manifestId, suite.name)
	const byKey = new Map([[key, suite]])
	const verdicts = new Map([[key, {
		kind: 'green',
		triggerHash: 'h',
		reason: 'fresh',
		subtests: {
			feed: { kind: 'green', triggerHash: 'h', reason: 'fresh' },
			smoke: { kind: 'green', triggerHash: 'h', reason: 'fresh' },
		},
		subtestsToRun: [],
	}]])
	const plan = buildPlan(
		new Set([key]),
		verdicts,
		byKey,
		[suite],
		new Map(),
		false,
		new Map([[key, ['feed']]]),
	)
	const slot = plan.slots[0]
	assertEquals(slot.action, 'run')
	assertEquals(slot.subtestsToRun, ['feed'])
})
