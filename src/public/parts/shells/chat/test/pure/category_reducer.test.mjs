/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { effectiveChannelPermissions, emptyMaterializedState, memberChannelPermissions } from '../../src/chat/dag/groupMaterializedState.mjs'
import { categoryReducers } from '../../src/chat/dag/reducers/categories.mjs'
import { channelReducers } from '../../src/chat/dag/reducers/channels.mjs'
import { calculateMemberPermissions, createDefaultRoles, PERMISSIONS } from '../../src/permissions/chat.mjs'

Deno.test('category_create / permissions / channel assignment / delete materialize + inheritance', () => {
	let state = emptyMaterializedState()

	state = categoryReducers.category_create(state, {
		timestamp: 1,
		content: { categoryId: 'cat-1', name: '媒体', position: 2 },
	})
	if (state.categories['cat-1']?.name !== '媒体') throw new Error('category_create failed')

	state = categoryReducers.category_permissions_update(state, {
		content: { categoryId: 'cat-1', roleId: '@everyone', allow: { SEND_MESSAGES: true }, deny: {} },
	})
	state = categoryReducers.category_permissions_update(state, {
		content: { categoryId: 'cat-1', roleId: 'admin', allow: { VIEW_CHANNEL: true, MANAGE_CHANNELS: true }, deny: {} },
	})

	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'ch-1', type: 'text', name: 'general', category: 'cat-1' },
	})
	if (state.channels['ch-1']?.category !== 'cat-1') throw new Error('channel category not stored')

	// 频道覆写叠加在分类覆写之上
	state = channelReducers.channel_permissions_update(state, {
		content: { channelId: 'ch-1', roleId: '@everyone', allow: { SEND_STICKERS: true }, deny: {} },
	})

	const effective = effectiveChannelPermissions(state, 'ch-1')['ch-1']
	const everyone = effective['@everyone']
	if (!everyone.allow.SEND_MESSAGES) throw new Error('category allow not inherited')
	if (!everyone.allow.SEND_STICKERS) throw new Error('channel allow not layered')
	const admin = effective['admin']
	if (!admin.allow.MANAGE_CHANNELS) throw new Error('category admin allow not inherited')

	// 无分类频道不受分类影响
	state = channelReducers.channel_create(state, {
		timestamp: 3,
		content: { channelId: 'ch-2', type: 'text', name: 'bare' },
	})
	const bare = effectiveChannelPermissions(state, 'ch-2')['ch-2']
	if ('@everyone' in bare) throw new Error('bare channel should not inherit category overrides')

	// 删除分类 → 解除其下频道归属
	state = categoryReducers.category_delete(state, { content: { categoryId: 'cat-1' } })
	if (state.categories['cat-1']) throw new Error('category_delete did not remove category')
	if (state.channels['ch-1']?.category !== null) throw new Error('category_delete did not unset channel.category')
})

Deno.test('category permissions flow through the real permission evaluator', () => {
	let state = emptyMaterializedState()
	state.roles = createDefaultRoles()

	const sender = 'a'.repeat(64)
	state.members[sender] = {
		status: 'active',
		pubKeyHex: sender,
		roles: ['@everyone'],
		memberKind: 'human',
	}

	// @everyone 默认无 STREAM 的写入限制已被分类 override 放宽/收紧：分类 deny SEND_MESSAGES
	state = categoryReducers.category_create(state, {
		timestamp: 1,
		content: { categoryId: 'cat-deny', name: '只读', position: 0 },
	})
	state = categoryReducers.category_permissions_update(state, {
		content: { categoryId: 'cat-deny', roleId: '@everyone', allow: {}, deny: { SEND_MESSAGES: true } },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'ch-read', type: 'text', name: 'read', category: 'cat-deny' },
	})

	const perms = memberChannelPermissions(state, sender, 'ch-read')
	assertEquals(perms[PERMISSIONS.SEND_MESSAGES], false, 'category deny should be inherited')

	// 频道自身 override 可覆盖分类 deny
	state = channelReducers.channel_permissions_update(state, {
		content: { channelId: 'ch-read', roleId: '@everyone', allow: { SEND_MESSAGES: true }, deny: {} },
	})
	const overridden = memberChannelPermissions(state, sender, 'ch-read')
	assertEquals(overridden[PERMISSIONS.SEND_MESSAGES], true, 'channel allow should override category deny')
	assertEquals(overridden[PERMISSIONS.VIEW_CHANNEL], true, 'default role VIEW_CHANNEL should persist')

	// 同构：直接 calculateMemberPermissions + effectiveChannelPermissions 等价
	const direct = calculateMemberPermissions(state.members[sender], state.roles, 'ch-read', effectiveChannelPermissions(state, 'ch-read'))
	assertEquals(direct[PERMISSIONS.SEND_MESSAGES], true, 'direct eval should match')
})

Deno.test('category_update renames', () => {
	let state = emptyMaterializedState()
	state = categoryReducers.category_create(state, {
		timestamp: 1,
		content: { categoryId: 'cat-x', name: '旧名', position: 0 },
	})
	state = categoryReducers.category_update(state, {
		content: { categoryId: 'cat-x', updates: { name: '新名', position: 5 } },
	})
	if (state.categories['cat-x']?.name !== '新名') throw new Error('category_update rename failed')
	if (state.categories['cat-x']?.position !== 5) throw new Error('category_update position failed')
})
