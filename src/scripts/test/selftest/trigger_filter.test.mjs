/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { collectTriggerEvidence } from '../core/state.mjs'
import { filterTriggerRelevantFiles, mergeTriggerFilter } from '../core/trigger_filter.mjs'
import { isContentFresh } from '../core/verdict.mjs'

import { makeStateEntry, makeSuite } from './fixtures.mjs'

Deno.test('filterTriggerRelevantFiles drops docs and metadata', () => {
	const ignored = [
		'README.md',
		'src/public/parts/shells/chat/public/hub/AGENTS.md',
		'src/public/parts/shells/chat/test/manifest.json',
		'src/server/p2p_server/AGENTS.md',
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

Deno.test('collectTriggerEvidence skips doc-only changes', () => {
	const suite = makeSuite('shells/chat', 'pure', { triggers: ['src/public/parts/shells/chat/**'] })
	const docOnly = [
		'src/public/parts/shells/chat/test/manifest.json',
		'src/server/p2p_server/AGENTS.md',
	]
	assertEquals(collectTriggerEvidence(suite, docOnly).matchedPaths, [])
})

Deno.test('collectTriggerEvidence matches code paths under triggers', () => {
	const suite = makeSuite('shells/chat', 'pure', { triggers: ['src/public/parts/shells/chat/**'] })
	assertEquals(
		collectTriggerEvidence(suite, ['src/public/parts/shells/chat/src/foo.mjs']).matchedPaths,
		['src/public/parts/shells/chat/src/foo.mjs'],
	)
	const infra = makeSuite('testkit', 'state', { triggers: ['src/scripts/test/core/state.mjs'] })
	assertEquals(
		collectTriggerEvidence(infra, ['src/scripts/test/core/state.mjs']).matchedPaths,
		['src/scripts/test/core/state.mjs'],
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
