/** 远端 DM 邀请须在查找本机实体及读写群数据之前拒绝不安全的目录名（含超长 ID）。 */
/* global Deno */
import { assertRejects } from 'jsr:@std/assert'

import { bootHeadlessDataRoot } from 'fount/scripts/test/node/boot.mjs'

Deno.test('DM invitations reject unsafe group IDs before looking up the invited entity', async () => {
	await bootHeadlessDataRoot()
	const { handleDmInvitation } = await import('../../src/chat/dm/invitation.mjs')
	const nodeHash = 'ab'.repeat(32)
	const invitation = {
		introducerNodeHash: nodeHash,
		introducerEntityHash: nodeHash + 'cd'.repeat(32),
		inviteCode: 'ticket', roomSecret: 'secret', dmSessionTag: 'ef'.repeat(32),
		inviterPubKeyHex: '12'.repeat(32),
	}
	for (const groupId of ['..', '.', '../outside', '..\\outside', '/absolute', 'group\0suffix', 'g'.repeat(129)])
		await assertRejects(() => handleDmInvitation({ ...invitation, groupId }, { requesterNodeHash: nodeHash }),
			Error, 'dm_invitation has an invalid group id')
})
