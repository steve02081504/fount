/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { effectiveChannelPermissions, emptyMaterializedState, memberChannelPermissions, resolvePermissionBlockOwner } from '../../src/chat/dag/groupMaterializedState.mjs'
import { channelReducers } from '../../src/chat/dag/reducers/channels.mjs'
import { calculateMemberPermissions, createDefaultRoles, PERMISSIONS } from '../../src/permissions/chat.mjs'

Deno.test('channel_create stores links/permissionBlockId; delete removes links subtree', () => {
	let state = emptyMaterializedState()

	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: 'cat-1', type: 'category', name: '媒体', links: [], permissionBlockId: null },
	})
	if (state.channels['cat-1']?.type !== 'category') throw new Error('category channel not stored')
	if (!Array.isArray(state.channels['cat-1']?.links)) throw new Error('links should default to array')

	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'ch-1', type: 'text', name: 'general', permissionBlockId: 'cat-1' },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 3,
		content: { channelId: 'ch-1b', type: 'text', name: 'sub', permissionBlockId: 'ch-1' },
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
		content: { channelId: 'cat-1', type: 'category', name: '媒体', links: [], permissionBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'ch-1', type: 'text', name: 'general', permissionBlockId: 'cat-1', parentChannelId: 'cat-1' },
	})
	assertEquals(state.channels['cat-1'].links, ['ch-1'], 'parent channel should gain the created child in its links')
})

Deno.test('permissionBlockId strong reference: child follows parent block, detach copies on update', () => {
	let state = emptyMaterializedState()

	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: 'root', type: 'text', name: 'root', permissionBlockId: null },
	})
	state = channelReducers.channel_permissions_update(state, {
		content: { channelId: 'root', roleId: '@everyone', allow: { SEND_MESSAGES: true }, deny: {} },
	})

	// 子频道强引用父块：resolvePermissionBlockOwner 应解析到 root
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'child', type: 'text', name: 'child', permissionBlockId: 'root' },
	})
	if (resolvePermissionBlockOwner(state, 'child') !== 'root') throw new Error('child should resolve to parent block owner')

	if (!effectiveChannelPermissions(state, 'child')['child']['@everyone']?.allow.SEND_MESSAGES) throw new Error('child should inherit parent block')

	// 父块改 → 子自动跟随（强引用运行时解析）
	state = channelReducers.channel_permissions_update(state, {
		content: { channelId: 'root', roleId: '@everyone', allow: { SEND_MESSAGES: true, STREAM: true }, deny: {} },
	})
	if (!effectiveChannelPermissions(state, 'child')['child']['@everyone']?.allow.STREAM) throw new Error('child should follow parent block update')

	// 脱钩（permissionBlockId -> null）→ 复制当前有效块进自有覆写
	state = channelReducers.channel_update(state, {
		content: { channelId: 'child', updates: { permissionBlockId: null } },
	})
	if (state.channels['child'].permissionBlockId !== null) throw new Error('child should be detached')
	if (resolvePermissionBlockOwner(state, 'child') !== 'child') throw new Error('child should own its block after detach')
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
		content: { channelId: 'root', type: 'text', name: 'root', permissionBlockId: null },
	})
	// @everyone deny SEND_MESSAGES on root
	state = channelReducers.channel_permissions_update(state, {
		content: { channelId: 'root', roleId: '@everyone', allow: {}, deny: { SEND_MESSAGES: true } },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'ch-read', type: 'text', name: 'read', permissionBlockId: 'root' },
	})

	assertEquals(memberChannelPermissions(state, sender, 'ch-read')[PERMISSIONS.SEND_MESSAGES], false, 'parent deny should be inherited via strong ref')

	// 频道自身 override 覆盖父块 deny（先脱钩复制再覆写）
	state = channelReducers.channel_update(state, {
		content: { channelId: 'ch-read', updates: { permissionBlockId: null } },
	})
	state = channelReducers.channel_permissions_update(state, {
		content: { channelId: 'ch-read', roleId: '@everyone', allow: { SEND_MESSAGES: true }, deny: {} },
	})
	const overridden = memberChannelPermissions(state, sender, 'ch-read')
	assertEquals(overridden[PERMISSIONS.SEND_MESSAGES], true, 'channel allow should override parent deny after detach')
	assertEquals(overridden[PERMISSIONS.VIEW_CHANNEL], true, 'default role VIEW_CHANNEL should persist')

	assertEquals(calculateMemberPermissions(state.members[sender], state.roles, 'ch-read', effectiveChannelPermissions(state, 'ch-read'))[PERMISSIONS.SEND_MESSAGES], true, 'direct eval should match')
})

Deno.test('channel_delete resets permissionBlockId of channels referencing deleted block', () => {
	let state = emptyMaterializedState()
	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: 'root', type: 'text', name: 'root', permissionBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'child', type: 'text', name: 'child', permissionBlockId: 'root' },
	})
	state = channelReducers.channel_delete(state, { content: { channelId: 'root' } })
	if (state.channels['root']) throw new Error('root should be deleted')
	if (state.channels['child'].permissionBlockId !== null) throw new Error('referencing channel permissionBlockId should reset to null')
})

Deno.test('channel_delete keeps a shared child that still has an external parent', () => {
	let state = emptyMaterializedState()
	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: 'parentA', type: 'category', name: 'A', links: [], permissionBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'parentB', type: 'category', name: 'B', links: [], permissionBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 3,
		content: { channelId: 'shared', type: 'text', name: 'shared', permissionBlockId: null },
	})
	// parentA 与 parentB 都链接 shared（共享子频道）。
	state = channelReducers.channel_update(state, {
		content: { channelId: 'parentA', updates: { links: ['shared'] } },
	})
	state = channelReducers.channel_update(state, {
		content: { channelId: 'parentB', updates: { links: ['shared'] } },
	})
	// 删除 parentA：shared 仍被删除集外的 parentB 链接，不应级联删除。
	state = channelReducers.channel_delete(state, { content: { channelId: 'parentA' } })
	if (!state.channels['shared']) throw new Error('shared child should survive when it still has an external parent')
	if (state.channels['parentA']) throw new Error('parentA should be deleted')
	if (!state.channels['parentB']?.links?.includes('shared')) throw new Error('parentB should keep its shared link')
})

Deno.test('channel_delete removes a shared child once all its parents are deleted (traversal-order independent)', () => {
	let state = emptyMaterializedState()
	state.groupSettings.rootChannelId = 'root'
	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: 'root', type: 'category', name: '', links: ['cat'], permissionBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'cat', type: 'category', name: 'C', links: ['parentB', 'shared'], permissionBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 3,
		content: { channelId: 'parentA', type: 'category', name: 'A', links: ['shared'], permissionBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 4,
		content: { channelId: 'parentB', type: 'category', name: 'B', links: ['shared'], permissionBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 5,
		content: { channelId: 'shared', type: 'text', name: 'shared', permissionBlockId: null },
	})
	// 让 shared 的父（parentA/parentB）都经 cat 级联进入删除闭包；parentA 在 shared 之后才被收集，
	// 若不先建完整闭包，shared 会被误判为仍被闭包外父链接而存活。
	state.channels.cat.links = ['parentA', 'parentB']
	state = channelReducers.channel_delete(state, { content: { channelId: 'cat' } })
	if (state.channels['cat']) throw new Error('cat should be deleted')
	if (state.channels['parentA']) throw new Error('parentA should be deleted')
	if (state.channels['parentB']) throw new Error('parentB should be deleted')
	if (state.channels['shared']) throw new Error('shared child should be deleted once all its parents are deleted')
})

Deno.test('channel_delete never cascade-deletes the root channel even via a back link', () => {
	let state = emptyMaterializedState()
	state.groupSettings.rootChannelId = 'root'
	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: 'root', type: 'category', name: '', links: ['child'], permissionBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: { channelId: 'child', type: 'category', name: 'child', links: ['root'], permissionBlockId: null },
	})
	// child 意外链接回 root；删除 child 不应把根容器级联删除。
	state = channelReducers.channel_delete(state, { content: { channelId: 'child' } })
	if (!state.channels['root']) throw new Error('root channel must never be cascade-deleted via links')
	if (state.channels['child']) throw new Error('child should be deleted')
})
