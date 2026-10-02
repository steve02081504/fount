/** 已折叠的 checkpoint 锚点不能让下一次频道创建被当作旧历史跳过。 */
/* global Deno */
import { readFile, writeFile } from 'node:fs/promises'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createIntegrationBoot } from '../harness.mjs'

const { ensureServer, username } = createIntegrationBoot({ username: 'folded-channel-user', minP2pNode: true })

Deno.test('first channel after a folded checkpoint anchor remains materialized and has a usable key', async () => {
	await ensureServer()
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { createChannel } = await import('../../src/chat/dag/channelOperations.mjs')
	const { loadChannelKeysFile } = await import('../../src/chat/channel_keys/store.mjs')
	const { eventsPath, snapshotPath } = await import('../../src/chat/lib/paths.mjs')
	const groupId = await newGroup(username, { name: 'before fold' })
	const anchor = await appendSignedLocalEvent(username, groupId, {
		type: 'group_meta_update', timestamp: Date.now(), content: { name: 'signed base' },
	}, { publishFederation: false })
	const snapshot = JSON.parse(await readFile(snapshotPath(username, groupId), 'utf8'))
	assertEquals(snapshot.checkpoint_event_id, anchor.id)
	assert(snapshot.checkpoint_signature)
	// 模拟进程事件折叠：签名基态保留锚点，events 中只剩此前的权限/内容历史。
	const events = (await readFile(eventsPath(username, groupId), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
	await writeFile(eventsPath(username, groupId), events.filter(event => event.id !== anchor.id).map(event => JSON.stringify(event)).join('\n') + '\n')
	const root = (await getState(username, groupId)).state.groupSettings.rootChannelId
	const created = await createChannel(username, groupId, {
		channelId: 'after-fold', type: 'text', parentChannelId: root, permissionBlockId: root,
	})
	assert(created.prev_event_ids.includes(anchor.id), 'append must extend the signed base frontier')
	const state = (await getState(username, groupId)).state
	assert(state.channels['after-fold'], 'the first new channel must not disappear after checkpoint rebuild')
	assert(state.channels[root].links.includes('after-fold'))
	const keys = await loadChannelKeysFile(username, groupId)
	assert(keys.channels['after-fold']?.generations?.some(generation => generation.keyHex))
})
