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
