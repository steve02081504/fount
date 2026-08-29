/**
 * Chat 消息折叠合并纯测试（Deno）：生成终稿 vs 用户手动编辑的 `wasEdited` 标记。
 */
/* global Deno */

import { assertEquals } from 'jsr:@std/assert'

import {
	applyMessageEditToRow,
	mergeChannelMessagesForDisplay,
} from '../../public/shared/messageMerge.mjs'

Deno.test('mergeChannelMessagesForDisplay: generation finalize does not mark as edited', () => {
	const placeholder = {
		type: 'message',
		eventId: 'a'.repeat(64),
		sender: 'char',
		content: { content: '', role: 'char', is_generating: true },
	}
	const finalize = {
		type: 'message_edit',
		content: {
			targetId: 'a'.repeat(64),
			newContent: { content: 'final text', role: 'char', is_generating: false },
			extension: { chat: { entryId: 'e1', generationFinalize: true } },
		},
	}
	const merged = mergeChannelMessagesForDisplay([placeholder, finalize])
	assertEquals(merged.length, 1)
	assertEquals(merged[0].content.content, 'final text')
	assertEquals(merged[0].wasEdited, false)
})

Deno.test('mergeChannelMessagesForDisplay: manual user edit is still marked as edited', () => {
	const message = {
		type: 'message',
		eventId: 'b'.repeat(64),
		sender: 'user',
		content: { content: 'original' },
	}
	const edit = {
		type: 'message_edit',
		content: {
			targetId: 'b'.repeat(64),
			newContent: { content: 'edited' },
		},
	}
	const merged = mergeChannelMessagesForDisplay([message, edit])
	assertEquals(merged.length, 1)
	assertEquals(merged[0].content.content, 'edited')
	assertEquals(merged[0].wasEdited, true)
})

Deno.test('applyMessageEditToRow: generation finalize does not mark as edited', () => {
	const row = {
		type: 'message',
		eventId: 'c'.repeat(64),
		sender: 'char',
		content: { content: '', role: 'char', is_generating: true },
	}
	const editContent = {
		newContent: { content: 'final text', role: 'char', is_generating: false },
		extension: { chat: { entryId: 'e2', generationFinalize: true } },
	}
	const patched = applyMessageEditToRow(row, editContent)
	assertEquals(patched.content.content, 'final text')
	assertEquals(patched.wasEdited, false)
})

Deno.test('applyMessageEditToRow: manual user edit is still marked as edited', () => {
	const row = {
		type: 'message',
		eventId: 'd'.repeat(64),
		sender: 'user',
		content: { content: 'original' },
	}
	const editContent = {
		newContent: { content: 'edited' },
	}
	const patched = applyMessageEditToRow(row, editContent)
	assertEquals(patched.content.content, 'edited')
	assertEquals(patched.wasEdited, true)
})

Deno.test('generation finalize propagates edit timestamp/hlc as row sort key', () => {
	const placeholder = {
		type: 'message',
		eventId: 'e'.repeat(64),
		sender: 'char',
		timestamp: 100,
		hlc: { wall: 100, logical: 1 },
		content: { content: '', role: 'char', is_generating: true },
	}
	const finalize = {
		type: 'message_edit',
		eventId: 'f'.repeat(64),
		timestamp: 200,
		hlc: { wall: 200, logical: 3 },
		content: {
			targetId: 'e'.repeat(64),
			newContent: { content: 'done', role: 'char', is_generating: false },
			extension: { chat: { entryId: 'e3', generationFinalize: true } },
		},
	}
	const merged = mergeChannelMessagesForDisplay([placeholder, finalize])
	assertEquals(merged.length, 1)
	assertEquals(merged[0].timestamp, 200)
	assertEquals(merged[0].hlc.wall, 200)
	assertEquals(merged[0].wasEdited, false)
})

Deno.test('non-finalize edit keeps original row sort key', () => {
	const message = {
		type: 'message',
		eventId: 'g'.repeat(64),
		sender: 'user',
		timestamp: 100,
		content: { content: 'original' },
	}
	const edit = {
		type: 'message_edit',
		eventId: 'h'.repeat(64),
		timestamp: 300,
		hlc: { wall: 300, logical: 5 },
		content: {
			targetId: 'g'.repeat(64),
			newContent: { content: 'edited' },
		},
	}
	const merged = mergeChannelMessagesForDisplay([message, edit])
	assertEquals(merged.length, 1)
	assertEquals(merged[0].timestamp, 100)
	assertEquals(merged[0].wasEdited, true)
})

Deno.test('applyMessageEditToRow uses sortMeta for generation finalize only', () => {
	const row = {
		type: 'message',
		eventId: 'i'.repeat(64),
		sender: 'char',
		timestamp: 100,
		content: { content: '', is_generating: true },
	}
	const final = applyMessageEditToRow(
		row,
		{ newContent: { content: 'x' }, extension: { chat: { generationFinalize: true } } },
		{ timestamp: 250, hlc: { wall: 250, logical: 9 } },
	)
	assertEquals(final.timestamp, 250)
	assertEquals(final.hlc.wall, 250)
	const manual = applyMessageEditToRow(
		row,
		{ newContent: { content: 'x' } },
		{ timestamp: 250, hlc: { wall: 250, logical: 9 } },
	)
	assertEquals(manual.timestamp, 100)
	assertEquals(manual.hlc, undefined)
})
