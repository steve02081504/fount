/**
 * resolveCharPartNameAgainstList：空串 / 未安装 / 大小写变体。
 */
/* global Deno */
import { resolveCharPartNameAgainstList } from 'fount/public/parts/shells/chat/src/entity/charPartNameMatch.mjs'
import { assertEquals, assertThrows } from 'jsr:@std/assert'

Deno.test('resolveCharPartNameAgainstList 返回列表中的真实目录名', () => {
	assertEquals(resolveCharPartNameAgainstList('Alice', ['Alice', 'Bob']), 'Alice')
	assertEquals(resolveCharPartNameAgainstList('alice', ['Alice', 'Bob']), 'Alice')
	assertEquals(resolveCharPartNameAgainstList('ALICE', ['Alice', 'Bob']), 'Alice')
	assertEquals(resolveCharPartNameAgainstList('chars/Bob', ['Alice', 'Bob']), 'Bob')
})

Deno.test('resolveCharPartNameAgainstList 拒绝空串与未安装 part', () => {
	assertThrows(() => resolveCharPartNameAgainstList('', ['Alice']), Error, 'charPartName required')
	assertThrows(() => resolveCharPartNameAgainstList('   ', ['Alice']), Error, 'charPartName required')
	assertThrows(() => resolveCharPartNameAgainstList('missing', ['Alice']), Error, 'char part not found: missing')
})
