/**
 * formatBytes 人类可读字节格式化。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { formatBytes } from '../../../../../pages/scripts/lib/formatBytes.mjs'

Deno.test('formatBytes formats zero and binary steps', () => {
	assertEquals(formatBytes(0), '0 Bytes')
	assertEquals(formatBytes(1024), '1 KB')
	assertEquals(formatBytes(1536), '1.5 KB')
})
