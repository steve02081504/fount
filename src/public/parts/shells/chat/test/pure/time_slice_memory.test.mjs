/**
 * 【文件】time_slice_memory.test.mjs — timeSlice 不再携带 chars_memories
 * 【职责】保障频道级角色记忆本地化后：序列化（toJSON/toData）、拷贝（copy）与
 *   fromJSON 水合（含旧数据）均不产生 chars_memories 字段（存储迁至 scopedState.mjs 本地文件）。
 * 【关联】session/models.mjs、session/hydrate.mjs、session/scopedState.mjs。
 */
/* global Deno */
import { assertStrictEquals } from 'jsr:@std/assert'

import { timeSlice_t } from '../../src/chat/session/models.mjs'

Deno.test('timeSlice_t 序列化与拷贝均不含 chars_memories', () => {
	const slice = new timeSlice_t()
	assertStrictEquals(slice.toJSON().chars_memories, undefined)
})

Deno.test('timeSlice_t.fromJSON 水合后不含 chars_memories（旧数据不迁移）', async () => {
	const slice = await timeSlice_t.fromJSON({
		chars: [],
		plugins: [],
		chars_memories: { legacy_char: { note: 'legacy' } },
	}, 'testuser')
	assertStrictEquals(slice.chars_memories, undefined)
})

Deno.test('timeSlice_t.copy 不克隆 chars_memories', () => {
	const slice = new timeSlice_t()
	slice.chars_memories = { some_char: {} }
	const copy = slice.copy()
	assertStrictEquals(copy.chars_memories, undefined)
})
