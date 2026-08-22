/**
 * 角色私聊侧栏 viewer 展示名：异步 profile 未就绪（viewerDisplayName 为 null）时
 * 不得渲染空白，应回退到群 viewer 成员 displayName，最后落到 entityHash 短码。
 */
/* global Deno */
import { resolveViewerSidebarDisplayName } from 'fount/public/parts/shells/chat/public/shared/viewerDisplay.mjs'
import { assertEquals } from 'jsr:@std/assert'

const ENTITY = '96e6a72489ffda0e6d626ee81ce757cd96e91bf27714dcbeb5d7cfdb5f667cbb82cf4d7f9e21fbf888c7fcf8bb613731b23b82863e79eb76f8eb4693dd4e6235'

Deno.test('异步 viewerDisplayName 已就绪时直接采用', () => {
	assertEquals(resolveViewerSidebarDisplayName({
		viewerDisplayName: 'steve02081504',
		entityHash: ENTITY,
	}), 'steve02081504')
})

Deno.test('viewerDisplayName 为空但群成员 displayName 存在时回退成员名', () => {
	assertEquals(resolveViewerSidebarDisplayName({
		viewerDisplayName: null,
		entityHash: ENTITY,
		memberDisplayName: 'steve02081504',
	}), 'steve02081504')
})

Deno.test('别名优先于成员 displayName', () => {
	assertEquals(resolveViewerSidebarDisplayName({
		viewerDisplayName: null,
		entityHash: ENTITY,
		memberDisplayName: 'steve02081504',
		alias: '某人',
	}), '某人')
})

Deno.test('viewerDisplayName 为纯空白但成员 displayName 存在时回退成员名', () => {
	assertEquals(resolveViewerSidebarDisplayName({
		viewerDisplayName: '   ',
		entityHash: ENTITY,
		memberDisplayName: 'steve02081504',
	}), 'steve02081504')
})

Deno.test('viewerDisplayName 为纯空白且无成员名时回退 entityHash 短码', () => {
	assertEquals(resolveViewerSidebarDisplayName({
		viewerDisplayName: '\t\n ',
		entityHash: ENTITY,
	}), '82cf4d7f…6235')
})

Deno.test('成员名与别名皆缺时回退 entityHash 短码（绝不为空）', () => {
	assertEquals(resolveViewerSidebarDisplayName({
		viewerDisplayName: null,
		entityHash: ENTITY,
	}), '82cf4d7f…6235')
})

Deno.test('一切皆缺时回退问号，不为空串', () => {
	assertEquals(resolveViewerSidebarDisplayName({}), '?')
})
