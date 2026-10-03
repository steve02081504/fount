/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { collectTriggerEvidence } from '../core/state.mjs'
import { filterTriggerRelevantFiles, matchGlob, mergeTriggerFilter } from '../core/trigger_filter.mjs'
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
	assertEquals(isContentFresh(s, makeStateEntry(), changed, null), true)
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

Deno.test('repeated trigger matching preserves nested braces, extglobs and dot paths', () => {
	const pattern = 'src/{server,public/{pages,parts}}/**/@(main|index).{mjs,ts}'
	for (let pass = 0; pass < 3; pass++) {
		assertEquals(matchGlob(pattern, 'src/server/.internal/main.mjs'), true)
		assertEquals(matchGlob(pattern, 'src/public/pages/.cache/index.ts'), true)
		assertEquals(matchGlob(pattern, 'src/public/parts/plugins/main.mjs'), true)
		assertEquals(matchGlob(pattern, 'src/server/index.json'), false)
		assertEquals(matchGlob(pattern, 'src/scripts/main.mjs'), false)
	}
})

Deno.test('compiled triggers retain per-filter ignore and unignore behavior', () => {
	const files = ['src/.draft/guide.md', 'src/.draft/main.mjs', 'src/docs/index.mjs']
	assertEquals(filterTriggerRelevantFiles(files), ['src/.draft/main.mjs'])
	assertEquals(filterTriggerRelevantFiles(files, { unignore: ['src/{.draft,docs}/**'] }), files)
	assertEquals(filterTriggerRelevantFiles(files, { ignore: ['src/{.draft,docs}/**'] }), [])
	assertEquals(filterTriggerRelevantFiles(files), ['src/.draft/main.mjs'])
})

Deno.test('trigger matching remains correct after many different patterns', () => {
	for (let index = 0; index < 2100; index++)
		assertEquals(matchGlob(`src/generated/${index}/**`, `src/generated/${index}/.keep`), true)
	assertEquals(matchGlob('src/**/main.{mjs,ts}', 'src/.nested/main.mjs'), true)
	assertEquals(matchGlob('src/**/main.{mjs,ts}', 'src/.nested/main.json'), false)
})
