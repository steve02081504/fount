/**
 * 主动退群后本机群目录必须消失；迟到的 shun/signer 写回不得复活残渣。
 */
import { access } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { createIntegrationBoot } from '../harness.mjs'

/* global Deno */

Deno.test('performLocalGroupLeave removes group dir and blocks crumb resurrection', async () => {
	const username = `leave-clean-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { performLocalGroupLeave } = await import('../../src/chat/dag/leaveMany.mjs')
	const { groupDir } = await import('../../src/chat/lib/paths.mjs')
	const { saveGroupShunState } = await import('../../src/group/groupShunState.mjs')
	const { getLocalSignerForNewGroup } = await import('../../src/chat/dag/localSigner.mjs')

	const groupId = await newGroup(username, { name: 'leave-clean' })
	const dir = groupDir(username, groupId)
	await access(dir)

	const result = await performLocalGroupLeave(username, groupId)
	assertEquals(result.ok, true)
	await assertRejects(() => access(dir), Error)

	await saveGroupShunState(username, groupId, { lastProbeAt: Date.now() })
	await assertRejects(() => getLocalSignerForNewGroup(username, groupId), Error)
	await sleep(50)
	await assertRejects(() => access(dir), Error)
})
