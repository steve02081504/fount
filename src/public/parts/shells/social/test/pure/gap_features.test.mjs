/**
 * mediaRefs 清扫 / 敏感媒体判定 / 分享 URL。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { resolveSensitiveMedia, sanitizeMediaRefs } from '../../src/lib/mediaRefs.mjs'
import { formatSocialShareHttpsUrl } from '../../public/shared/runUri.mjs'
import { noteHelpfulScore } from '../../src/lib/noteScore.mjs'
import { normalizeDwellEntry, AUTHOR_BOOST_PER_DWELL } from '../../src/lib/dwellSignal.mjs'

Deno.test('sanitizeMediaRefs truncates alt and drops junk', () => {
	const refs = sanitizeMediaRefs([
		{ kind: 'image', alt: 'x'.repeat(2000) },
		null,
		'bad',
		{ kind: 'video', alt: '  hello  ' },
	])
	assertEquals(refs.length, 2)
	assertEquals(refs[0].alt.length, 1500)
	assertEquals(refs[1].alt, 'hello')
})

Deno.test('resolveSensitiveMedia defaults from contentWarning', () => {
	assertEquals(resolveSensitiveMedia(undefined, 'cw'), true)
	assertEquals(resolveSensitiveMedia(false, 'cw'), false)
	assertEquals(resolveSensitiveMedia(true, ''), true)
	assertEquals(resolveSensitiveMedia(undefined, ''), false)
})

Deno.test('noteHelpfulScore nets helpful votes', () => {
	assertEquals(noteHelpfulScore({}, { a: true, b: true, c: false }), 1)
	assertEquals(noteHelpfulScore({}, {}), 0)
})

Deno.test('normalizeDwellEntry rejects short dwells', () => {
	assertEquals(normalizeDwellEntry({ author: 'aa', postId: 'bb', dwellMs: 1000 }), null)
	const ok = normalizeDwellEntry({
		author: 'Aa',
		postId: 'Bb',
		dwellMs: 5000,
		tags: ['Foo', 'foo'],
	})
	assertEquals(ok?.author, 'aa')
	assertEquals(ok?.tags, ['foo'])
	assertEquals(AUTHOR_BOOST_PER_DWELL, 0.25)
})

Deno.test('formatSocialShareHttpsUrl wraps pages protocol', () => {
	const url = formatSocialShareHttpsUrl('abc', 'def')
	assertEquals(url.startsWith('https://steve02081504.github.io/fount/protocol?url='), true)
	assertEquals(decodeURIComponent(new URL(url).searchParams.get('url') || '').includes('shells:social/profile'), true)
})
