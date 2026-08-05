/**
 * RPack 解码应套用内嵌替换表。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { decodeRPack } from '../../Risu/rpack.mjs'

Deno.test('rpack decode restores a known packed sample', () => {
	const packed = Uint8Array.of(
		142, 64, 178, 242, 15, 12, 121, 44, 211, 60, 205, 12, 121, 64, 178, 242, 226, 15, 121, 14, 44,
	)
	const unpacked = decodeRPack(packed)
	assertEquals(new TextDecoder().decode(unpacked), 'fount-rpack-roundtrip')
})
