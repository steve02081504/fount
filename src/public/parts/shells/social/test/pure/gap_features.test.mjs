/**
 * mediaRefs 清扫 / 敏感媒体判定 / 分享 URL。
 */
/* global Deno */
import { wrapProtocolHttpsUrl } from 'fount/public/parts/shells/chat/public/shared/runUri.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { formatSocialPostRunUri } from '../../public/shared/runUri.mjs'
import { normalizeDwellEntry, AUTHOR_BOOST_PER_DWELL } from '../../src/lib/dwellSignal.mjs'
import { resolveSensitiveMedia, sanitizeMediaRefs } from '../../src/lib/mediaRefs.mjs'
import { noteHelpfulScore } from '../../src/lib/noteScore.mjs'

Deno.test('sanitizeMediaRefs truncates alt and drops junk', () => {
	const refs = sanitizeMediaRefs([
		{ kind: 'image', url: 'https://example.com/a.jpg', alt: 'x'.repeat(2000) },
		null,
		'bad',
		{ kind: 'video', url: '/api/parts/shells:chat/entities/aa/files/b', alt: '  hello  ' },
	])
	assertEquals(refs.length, 2)
	assertEquals(refs[0].alt.length, 1500)
	assertEquals(refs[1].alt, 'hello')
})

Deno.test('sanitizeMediaRefs strips javascript: and other unsafe urls', () => {
	const refs = sanitizeMediaRefs([
		{ kind: 'file', url: 'javascript:alert(1)', name: 'x' },
		{ kind: 'image', url: 'data:text/html,<script>1</script>' },
		{ kind: 'image', url: 'https://example.com/ok.jpg' },
		{ kind: 'image', url: 'javascript:void(0)', entityHash: 'ab'.repeat(64), path: 'profile/avatar' },
	])
	assertEquals(refs.length, 2)
	assertEquals(refs[0].url, 'https://example.com/ok.jpg')
	assertEquals(refs[1].url, undefined)
	assertEquals(refs[1].entityHash, 'ab'.repeat(64))
	assertEquals(refs[1].path, 'profile/avatar')
})

Deno.test('sanitizeMediaRefs keeps groupEmoji refs with contentHash', () => {
	const refs = sanitizeMediaRefs([
		{ kind: 'groupEmoji', groupId: 'g1', emojiId: 'e1', contentHash: 'a'.repeat(64) },
		{ kind: 'groupEmoji', groupId: 'g1', emojiId: 'e2' },
		{ kind: 'groupEmoji', emojiId: 'e3', contentHash: 'b'.repeat(64) },
	])
	assertEquals(refs.length, 1)
	assertEquals(refs[0].kind, 'groupEmoji')
	assertEquals(refs[0].emojiId, 'e1')
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
	const url = wrapProtocolHttpsUrl(formatSocialPostRunUri('abc', 'def'))
	assertEquals(url.startsWith('https://steve02081504.github.io/fount/protocol?url='), true)
	assertEquals(decodeURIComponent(new URL(url).searchParams.get('url') || '').includes('shells:social/post'), true)
})
