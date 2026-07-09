/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { formatDuration } from '../core/format_duration.mjs'

Deno.test('formatDuration keeps sub-minute precision', () => {
	assertEquals(formatDuration(500), '500 毫秒')
	assertEquals(formatDuration(45_000), '45 秒')
	assertEquals(formatDuration(90_000), '1 分 30 秒')
	assertEquals(formatDuration(120_000), '2 分钟')
})

Deno.test('formatDuration shows hours instead of large minute counts', () => {
	assertEquals(formatDuration(3_600_000), '1 小时')
	assertEquals(formatDuration(5_400_000), '1 小时 30 分钟')
	assertEquals(formatDuration(5_686_000), '1 小时 34 分 46 秒')
})

Deno.test('formatDuration shows days for very long durations', () => {
	assertEquals(formatDuration(86_400_000), '1 天')
	assertEquals(formatDuration(90_000_000), '1 天 1 小时')
	assertEquals(formatDuration(93_660_000), '1 天 2 小时 1 分钟')
	assertEquals(formatDuration(93_661_000), '1 天 2 小时 1 分 1 秒')
})

Deno.test('formatDuration returns dash for nullish input', () => {
	assertEquals(formatDuration(null), '—')
	assertEquals(formatDuration(undefined), '—')
})
