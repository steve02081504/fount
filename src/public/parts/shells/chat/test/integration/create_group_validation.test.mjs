/** 建群入口须在第一次落盘（`groups/<groupId>`）之前拒绝不安全的 groupId。 */
/* global Deno */
import { assertRejects } from 'jsr:@std/assert'

import { bootHeadlessDataRoot } from 'fount/scripts/test/node/boot.mjs'

Deno.test('createGroup rejects unsafe group IDs before creating the group directory', async () => {
	await bootHeadlessDataRoot()
	const { createGroup } = await import('../../src/chat/dag/lifecycle.mjs')
	// 其余字段都给足，确保用例挂在 groupId 校验上而不是别的缺字段错误（空串/缺省走 `|| randomUUID()`，不归校验管）。
	const body = { name: 'unsafe', ownerPubKeyHash: 'ab'.repeat(32) }
	for (const groupId of ['..', '.', '../outside', '..\\outside', '/absolute', 'group\0suffix', 'g'.repeat(129)])
		await assertRejects(() => createGroup('nobody', { ...body, groupId }), Error, 'createGroup: invalid groupId')
})
