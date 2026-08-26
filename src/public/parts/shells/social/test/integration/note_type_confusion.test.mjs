/**
 * 安全回归：社区便签文本的类型混淆 / 长度绕过（恶意联邦 post_note 事件）。
 *
 * 恶意节点经 `timeline/sync.mjs` / `timeline/append.mjs` → `projectNoteFromTimelineEvent`
 * 下发 `post_note`，若 `content.text` 不是字符串（例如数组），
 * `note/index.mjs` 的 `entry.text?.slice(0, NOTE_TEXT_MAX)` 会把数组原样入库：
 *  - 长度上限按「元素个数」而非「字符数」生效，被轻易绕过（脏数据/存储膨胀）；
 *  - 下游渲染若把数组隐式 join 进 DOM，存在 XSS 面（当前 `showText` 走 escapeHtml 未触发）。
 * 本用例断言远端文本必须被强转为受长度约束的字符串。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { placeholderEntityHash } from 'fount/scripts/test/fixtures.mjs'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const noteIndex = await import('../../src/federation/note/index.mjs')

const TARGET = placeholderEntityHash('a')
const POST_ID = 'd'.repeat(64)

Deno.test('post_note text is stored as a string (no type confusion)', async () => {
	const { username, operator } = await getSession()
	const noteId = 'c'.repeat(64)

	await noteIndex.projectNoteFromTimelineEvent(username, operator, {
		id: noteId,
		type: 'post_note',
		content: {
			targetEntityHash: TARGET,
			targetPostId: POST_ID,
			// 恶意节点用数组替换字符串文本：数组元素既携带 HTML 又试图堆满字节。
			text: [
				'<img src=x onerror=alert(1)>',
				'x'.repeat(10_000),
			],
		},
		hlc: { wall: Date.now() },
	})

	const summary = await noteIndex.summarizeNotes(username, TARGET, POST_ID)
	assertEquals(summary.notes.length, 1)
	const stored = summary.notes[0]
	// 安全不变量：远端文本必须被规范化为字符串，且受 NOTE_TEXT_MAX 字符约束。
	assert(typeof stored.text === 'string', `stored text must be a string, got ${typeof stored.text}`)
	assert(stored.text.length <= 2000, `stored text length must be <= 2000, got ${stored.text.length}`)
})
