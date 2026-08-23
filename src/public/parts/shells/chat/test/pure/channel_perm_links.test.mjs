/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { effectiveChannelPermissions, emptyMaterializedState, memberChannelPermissions, resolvePermBlockOwner } from '../../src/chat/dag/groupMaterializedState.mjs'
import { channelReducers } from '../../src/chat/dag/reducers/channels.mjs'
import { calculateMemberPermissions, createDefaultRoles, PERMISSIONS } from '../../src/permissions/chat.mjs'

Deno.test('channel_create stores links/permBlockId; delete removes links subtree', () => {
	let state = emptyMaterializedState()

	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: 'cat-1', type: 'category', name: '媒体', links: [], permBlockId: null },
	})
	if (state.channels['cat-1']?.type !== 'category') throw new Error('category channel not stored')
	if (!Array.isArray(state.channels['cat-1']?.links)) throw new Error('links should default to array')

	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'ch-1', type: 'text', name: 'general', permBlockId: 'cat-1' },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 3,
		content: { channelId: 'ch-1b', type: 'text', name: 'sub', permBlockId: 'ch-1' },
	})

	// 通过 channel_update 链接：cat-1 -> ch-1 -> ch-1b
	state = channelReducers.channel_update(state, {
		content: { channelId: 'cat-1', updates: { links: ['ch-1'] } },
	})
	state = channelReducers.channel_update(state, {
		content: { channelId: 'ch-1', updates: { links: ['ch-1b'] } },
	})
	assertEquals(state.channels['cat-1'].links, ['ch-1'])
	assertEquals(state.channels['ch-1'].links, ['ch-1b'])

	// 删除 cat-1 → 递归删除其 links 子树（ch-1、ch-1b）
	state = channelReducers.channel_delete(state, { content: { channelId: 'cat-1' } })
	if (state.channels['cat-1']) throw new Error('channel_delete did not remove root')
	if (state.channels['ch-1']) throw new Error('channel_delete did not remove link child')
	if (state.channels['ch-1b']) throw new Error('channel_delete did not remove nested link child')
})

Deno.test('channel_create with parentChannelId appends the child to the parent links', () => {
	let state = emptyMaterializedState()
	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: 'cat-1', type: 'category', name: '媒体', links: [], permBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'ch-1', type: 'text', name: 'general', permBlockId: 'cat-1', parentChannelId: 'cat-1' },
	})
	assertEquals(state.channels['cat-1'].links, ['ch-1'], 'parent channel should gain the created child in its links')
})

Deno.test('permBlockId strong reference: child follows parent block, detach copies on update', () => {
	let state = emptyMaterializedState()

	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: 'root', type: 'text', name: 'root', permBlockId: null },
	})
	state = channelReducers.channel_permissions_update(state, {
		content: { channelId: 'root', roleId: '@everyone', allow: { SEND_MESSAGES: true }, deny: {} },
	})

	// 子频道强引用父块：resolvePermBlockOwner 应解析到 root
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'child', type: 'text', name: 'child', permBlockId: 'root' },
	})
	if (resolvePermBlockOwner(state, 'child') !== 'root') throw new Error('child should resolve to parent block owner')

	if (!effectiveChannelPermissions(state, 'child')['child']['@everyone']?.allow.SEND_MESSAGES) throw new Error('child should inherit parent block')

	// 父块改 → 子自动跟随（强引用运行时解析）
	state = channelReducers.channel_permissions_update(state, {
		content: { channelId: 'root', roleId: '@everyone', allow: { SEND_MESSAGES: true, STREAM: true }, deny: {} },
	})
	if (!effectiveChannelPermissions(state, 'child')['child']['@everyone']?.allow.STREAM) throw new Error('child should follow parent block update')

	// 脱钩（permBlockId -> null）→ 复制当前有效块进自有覆写
	state = channelReducers.channel_update(state, {
		content: { channelId: 'child', updates: { permBlockId: null } },
	})
	if (state.channels['child'].permBlockId !== null) throw new Error('child should be detached')
	if (resolvePermBlockOwner(state, 'child') !== 'child') throw new Error('child should own its block after detach')
	const copied = state.channelPermissions['child']
	if (!copied['@everyone']?.allow.SEND_MESSAGES) throw new Error('detach should copy parent block')
	if (!copied['@everyone']?.allow.STREAM) throw new Error('detach should copy latest parent block')

	// 脱钩后再改父块 → 子不受影响
	state = channelReducers.channel_permissions_update(state, {
		content: { channelId: 'root', roleId: '@everyone', allow: {}, deny: { STREAM: true } },
	})
	if (effectiveChannelPermissions(state, 'child')['child']['@everyone']?.allow.STREAM !== true) throw new Error('detached child should not follow parent after detach')
})

Deno.test('permBlock resolution through the real permission evaluator', () => {
	let state = emptyMaterializedState()
	state.roles = createDefaultRoles()

	const sender = 'a'.repeat(64)
	state.members[sender] = {
		status: 'active',
		pubKeyHex: sender,
		roles: ['@everyone'],
		memberKind: 'human',
	}

	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: 'root', type: 'text', name: 'root', permBlockId: null },
	})
	// @everyone deny SEND_MESSAGES on root
	state = channelReducers.channel_permissions_update(state, {
		content: { channelId: 'root', roleId: '@everyone', allow: {}, deny: { SEND_MESSAGES: true } },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'ch-read', type: 'text', name: 'read', permBlockId: 'root' },
	})

	assertEquals(memberChannelPermissions(state, sender, 'ch-read')[PERMISSIONS.SEND_MESSAGES], false, 'parent deny should be inherited via strong ref')

	// 频道自身 override 覆盖父块 deny（先脱钩复制再覆写）
	state = channelReducers.channel_update(state, {
		content: { channelId: 'ch-read', updates: { permBlockId: null } },
	})
	state = channelReducers.channel_permissions_update(state, {
		content: { channelId: 'ch-read', roleId: '@everyone', allow: { SEND_MESSAGES: true }, deny: {} },
	})
	const overridden = memberChannelPermissions(state, sender, 'ch-read')
	assertEquals(overridden[PERMISSIONS.SEND_MESSAGES], true, 'channel allow should override parent deny after detach')
	assertEquals(overridden[PERMISSIONS.VIEW_CHANNEL], true, 'default role VIEW_CHANNEL should persist')

	assertEquals(calculateMemberPermissions(state.members[sender], state.roles, 'ch-read', effectiveChannelPermissions(state, 'ch-read'))[PERMISSIONS.SEND_MESSAGES], true, 'direct eval should match')
})

Deno.test('channel_delete resets permBlockId of channels referencing deleted block', () => {
	let state = emptyMaterializedState()
	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: 'root', type: 'text', name: 'root', permBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'child', type: 'text', name: 'child', permBlockId: 'root' },
	})
	state = channelReducers.channel_delete(state, { content: { channelId: 'root' } })
	if (state.channels['root']) throw new Error('root should be deleted')
	if (state.channels['child'].permBlockId !== null) throw new Error('referencing channel permBlockId should reset to null')
})
