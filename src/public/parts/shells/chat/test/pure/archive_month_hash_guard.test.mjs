/**
 * 安全回归：冷归档分块清单的哈希白名单校验。
 *
 * 远端 Manifest 里的 part `hash` 会被用作 chunk 拉取键、以及写临时重组文件前的
 * 内容寻址。`parseArchiveMonthWireParts` 校验了 index 结构但未校验 hash 是否为
 * 64-hex。虽然 digest 有 `isHex64` + 内容摘要校验、拉块侧也用 `HEX_ID_64` 过滤，
 * 边界上仍应拒绝非 hex 的 hash（防路径穿越式键值 / 畸形清单）。
 * `resolveArchiveMonthCandidateBody` 对 digest 的 `isHex64` 守卫应保持。
 */
/* global Deno */
import { assert } from 'jsr:@std/assert'

import { parseArchiveMonthWireParts, resolveArchiveMonthCandidateBody } from '../../src/chat/archive/monthChunks.mjs'

Deno.test('parseArchiveMonthWireParts rejects non-hex part hash', () => {
	const parsed = parseArchiveMonthWireParts([
		{ hash: '../../../../Windows/System32/drivers/etc/hosts', size: 1, index: 0 },
	])
	// 安全不变量：非 64-hex 的 hash 必须在边界被拒。
	assert(parsed === null, `expected null for non-hex hash, got ${JSON.stringify(parsed)}`)
})

Deno.test('resolveArchiveMonthCandidateBody rejects non-hex digest', async () => {
	const result = await resolveArchiveMonthCandidateBody('u', 'g', null, {
		complete: true,
		digest: '../../../../etc/hosts',
		parts: [{ hash: 'a'.repeat(64), size: 1, index: 0 }],
	})
	assert(result === null, 'non-hex digest must be rejected')
})
