/**
 * viewEpoch / channelViewScope：切视图后，旧视图在途异步渲染的作用域守卫必须失效，
 * 防止其把结果画进新视图共享的 `#messages` 容器。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { store } from '../../public/hub/core/state.mjs'
import {
	bumpViewEpoch,
	currentViewEpoch,
} from '../../public/hub/core/viewEpoch.mjs'
import {
	captureChannelViewScope,
	isChannelViewScopeCurrent,
} from '../../public/hub/messages/channelViewScope.mjs'

Deno.test('bumpViewEpoch strictly increases, currentViewEpoch tracks', () => {
	const before = currentViewEpoch()
	assertEquals(bumpViewEpoch(), before + 1)
	assertEquals(currentViewEpoch(), before + 1)
})

Deno.test('captured scope is current while group/channel/view epoch unchanged', () => {
	store.context.currentGroupId = 'g1'
	store.context.currentChannelId = 'c1'
	const scope = captureChannelViewScope('g1', 'c1')
	assertEquals(isChannelViewScopeCurrent(scope), true)
})

Deno.test('stale scope after view epoch bump is rejected', () => {
	store.context.currentGroupId = 'g1'
	store.context.currentChannelId = 'c1'
	const scope = captureChannelViewScope('g1', 'c1')
	bumpViewEpoch()
	assertEquals(isChannelViewScopeCurrent(scope), false)
})

Deno.test('stale scope after switching to another group is rejected', () => {
	store.context.currentGroupId = 'g1'
	store.context.currentChannelId = 'c1'
	const scope = captureChannelViewScope('g1', 'c1')
	store.context.currentGroupId = 'g2'
	assertEquals(isChannelViewScopeCurrent(scope), false)
})

Deno.test('stale scope after switching to another channel is rejected', () => {
	store.context.currentGroupId = 'g1'
	store.context.currentChannelId = 'c1'
	const scope = captureChannelViewScope('g1', 'c1')
	store.context.currentChannelId = 'c2'
	assertEquals(isChannelViewScopeCurrent(scope), false)
})

Deno.test('stale scope after leaving to discovery (group/channel nulled) is rejected', () => {
	store.context.currentGroupId = 'g1'
	store.context.currentChannelId = 'c1'
	const scope = captureChannelViewScope('g1', 'c1')
	store.context.currentGroupId = null
	store.context.currentChannelId = null
	assertEquals(isChannelViewScopeCurrent(scope), false)
})

Deno.test('null / empty scope is never current', () => {
	assertEquals(isChannelViewScopeCurrent(null), false)
	assertEquals(isChannelViewScopeCurrent(undefined), false)
})
