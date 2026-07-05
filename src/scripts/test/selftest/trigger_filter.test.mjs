/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { selectSuitesByDiff } from '../core/manifest.mjs'
import { collectTriggerEvidence, isSuiteOutdated } from '../core/state.mjs'
import { filterTriggerRelevantFiles, mergeTriggerFilter } from '../core/trigger_filter.mjs'

/** @type {import('../core/manifest.mjs').SuiteDef} */
function suite(manifestId, name, triggers) {
	return {
		manifestId,
		name,
		id: name,
		run: [],
		triggers,
		manifestPath: '',
		heavy: false,
	}
}

const passedEntry = {
	status: 'passed',
	commitHash: 'abc',
	uncommittedHash: null,
	ranAt: '',
	durationMs: 1,
	failedFiles: [],
	noiseHits: [],
	logPath: null,
}

Deno.test('filterTriggerRelevantFiles drops docs and metadata', () => {
	const ignored = [
		'README.md',
		'src/public/parts/shells/chat/public/hub/AGENTS.md',
		'src/public/parts/shells/chat/test/manifest.json',
		'src/scripts/p2p/docs/signaling.md',
		'src/public/parts/shells/chat/public/llms.txt',
	]
	for (const path of ignored)
		assertEquals(filterTriggerRelevantFiles([path]), [])
	assertEquals(
		filterTriggerRelevantFiles(['src/server/test/live/static_scripts.test.mjs']),
		['src/server/test/live/static_scripts.test.mjs'],
	)
})

Deno.test('isSuiteOutdated stays fresh when only docs or manifest change', () => {
	const s = suite('shells/chat', 'pure', ['src/public/parts/shells/chat/**'])
	const changed = [
		'src/public/parts/shells/chat/public/hub/AGENTS.md',
		'src/public/parts/shells/chat/test/manifest.json',
	]
	assertEquals(isSuiteOutdated(s, passedEntry, changed), false)
})

Deno.test('selectSuitesByDiff skips doc-only changes', () => {
	const all = [
		suite('shells/chat', 'pure', ['src/public/parts/shells/chat/**']),
		suite('p2p', 'pure', ['src/scripts/p2p/**']),
	]
	const docOnly = [
		'src/public/parts/shells/chat/test/manifest.json',
		'src/scripts/p2p/AGENTS.md',
	]
	assertEquals(selectSuitesByDiff('diff', docOnly, all), [])
})

Deno.test('selectSuitesByDiff still matches code and test infra changes', () => {
	const all = [
		suite('shells/chat', 'pure', ['src/public/parts/shells/chat/**']),
		suite('p2p', 'pure', ['src/scripts/p2p/**']),
	]
	assertEquals(
		selectSuitesByDiff('diff', ['src/public/parts/shells/chat/src/foo.mjs'], all).map(s => s.name),
		['pure'],
	)
	assertEquals(
		selectSuitesByDiff('diff', ['src/scripts/test/core/state.mjs'], all).length,
		all.length,
	)
})

Deno.test('triggerFilter unignore restores md for one suite only', () => {
	const mdPath = 'src/public/parts/shells/chat/public/hub/guide.md'
	const defaultSuite = suite('shells/chat', 'pure', ['src/public/parts/shells/chat/**'])
	const mdSuite = {
		...suite('shells/chat', 'docs', ['src/public/parts/shells/chat/**']),
		triggerFilter: { unignore: ['src/public/parts/shells/chat/**/*.md'] },
	}
	assertEquals(filterTriggerRelevantFiles([mdPath]), [])
	assertEquals(filterTriggerRelevantFiles([mdPath], mdSuite.triggerFilter), [mdPath])
	assertEquals(collectTriggerEvidence(defaultSuite, [mdPath]).matchedPaths, [])
	assertEquals(collectTriggerEvidence(mdSuite, [mdPath]).matchedPaths, [mdPath])
	assertEquals(
		selectSuitesByDiff('diff', [mdPath], [defaultSuite, mdSuite]).map(s => s.name),
		['docs'],
	)
})

Deno.test('triggerFilter ignoreDefaults false only applies custom ignore', () => {
	const filter = { ignoreDefaults: false, ignore: ['**/docs/**'] }
	assertEquals(filterTriggerRelevantFiles(['src/foo/AGENTS.md'], filter), ['src/foo/AGENTS.md'])
	assertEquals(filterTriggerRelevantFiles(['src/foo/test/manifest.json'], filter), ['src/foo/test/manifest.json'])
	assertEquals(filterTriggerRelevantFiles(['src/foo/docs/guide.md'], filter), [])
})

Deno.test('mergeTriggerFilter combines manifest and suite layers', () => {
	const merged = mergeTriggerFilter(
		{ unignore: ['src/a/**'] },
		{ ignore: ['**/*.json'], ignoreDefaults: false },
	)
	assertEquals(merged, {
		ignoreDefaults: false,
		ignore: ['**/*.json'],
		unignore: ['src/a/**'],
	})
	assertEquals(mergeTriggerFilter({}, {}), undefined)
})
