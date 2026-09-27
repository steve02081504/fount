/* global Deno */
/**
 * code shell 条目扩展白名单测试：前端渲染所需字段与插件私有数据保留，内部结构剔除。
 */
import { assert, assertEquals } from 'jsr:@std/assert'

import { pickEntryExtension } from '../../src/entry_extension.mjs'

Deno.test('pickEntryExtension keeps frontend-rendering fields and drops the rest', () => {
	const pluginData = { 'file-operations': { contextHashes: ['abc'] }, nested: { n: 1 } }
	const picked = pickEntryExtension({
		subAgent: { runId: 'r' },
		asyncTask: { id: 't', kind: 'js' },
		asyncList: { tasks: [] },
		asyncAwait: { settled: [] },
		asyncInspect: { id: 't', kind: 'js' },
		error: true,
		pluginData,
		preloadFiles: [{ path: 'a.mjs', resolved: '/w/a.mjs' }],
		preloadForUser: 'u1',
		feedback: { type: 'up' },
		internal: { secret: 1 },
	})
	assertEquals(picked, {
		subAgent: { runId: 'r' },
		asyncTask: { id: 't', kind: 'js' },
		asyncList: { tasks: [] },
		asyncAwait: { settled: [] },
		asyncInspect: { id: 't', kind: 'js' },
		error: true,
		pluginData,
	})
	// 深拷贝：落盘内容与源对象解耦，保证可 JSON 序列化
	assert(picked.pluginData !== pluginData, 'pluginData 应为深拷贝')
	assert(picked.pluginData.nested !== pluginData.nested, 'pluginData 内层对象也应深拷贝')
	assertEquals(pickEntryExtension(null), {})
	assertEquals(pickEntryExtension('nope'), {})
	assertEquals(pickEntryExtension({ pluginData: null, preloadFiles: [] }), {})
	assertEquals(pickEntryExtension({ pluginData: ['array'] }), {}, '数组不是合法 pluginData')
})
