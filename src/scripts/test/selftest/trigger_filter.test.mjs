/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { selectSuitesByDiff } from '../core/manifest.mjs'
import { collectTriggerEvidence } from '../core/state.mjs'
import { filterTriggerRelevantFiles, mergeTriggerFilter } from '../core/trigger_filter.mjs'
import { isContentFresh } from '../core/verdict.mjs'

import { makeStateEntry, makeSuite } from './fixtures.mjs'

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

Deno.test('isContentFresh stays fresh when only docs or manifest change', () => {
	const s = makeSuite('shells/chat', 'pure', { triggers: ['src/public/parts/shells/chat/**'] })
	const changed = [
		'src/public/parts/shells/chat/public/hub/AGENTS.md',
		'src/public/parts/shells/chat/test/manifest.json',
	]
	assertEquals(isContentFresh(s, makeStateEntry(), changed, new Map()), true)
})

Deno.test('selectSuitesByDiff skips doc-only changes', () => {
	const all = [
		makeSuite('shells/chat', 'pure', { triggers: ['src/public/parts/shells/chat/**'] }),
		makeSuite('p2p', 'pure', { triggers: ['src/scripts/p2p/**'] }),
	]
	const docOnly = [
		'src/public/parts/shells/chat/test/manifest.json',
		'src/scripts/p2p/AGENTS.md',
	]
	assertEquals(selectSuitesByDiff('diff', docOnly, all), [])
})

Deno.test('selectSuitesByDiff still matches code and test infra changes', () => {
	const all = [
		makeSuite('testkit', 'state', { triggers: ['src/scripts/test/core/state.mjs'] }),
		makeSuite('shells/chat', 'pure', { triggers: ['src/public/parts/shells/chat/**'] }),
		makeSuite('p2p', 'pure', { triggers: ['src/scripts/p2p/**'] }),
	]
	assertEquals(
		selectSuitesByDiff('diff', ['src/public/parts/shells/chat/src/foo.mjs'], all).map(s => s.name),
		['pure'],
	)
	assertEquals(
		selectSuitesByDiff('diff', ['src/scripts/test/core/state.mjs'], all).map(s => `${s.manifestId}/${s.name}`).sort(),
		['testkit/state'],
	)
})

Deno.test('triggerFilter unignore restores md for one suite only', () => {
	const mdPath = 'src/public/parts/shells/chat/public/hub/guide.md'
	const defaultSuite = makeSuite('shells/chat', 'pure', { triggers: ['src/public/parts/shells/chat/**'] })
	const mdSuite = {
		...makeSuite('shells/chat', 'docs', { triggers: ['src/public/parts/shells/chat/**'] }),
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
