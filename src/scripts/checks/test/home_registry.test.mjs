/**
 * home_registry.json info 键健康检查。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals, assert } from 'https://deno.land/std/assert/mod.ts'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import { collectHomeInfoRefs, resolveLocaleKey, scanHomeRegistryData } from '../home_registry.mjs'
import { listRepoFiles } from '../walk.mjs'

Deno.test('resolveLocaleKey walks dot paths', () => {
	const locale = { a: { b: { title: 'x' } } }
	assertEquals(resolveLocaleKey(locale, 'a.b.title'), 'x')
	assertEquals(resolveLocaleKey(locale, 'a.b.missing'), undefined)
	assertEquals(resolveLocaleKey(locale, 'a.b.title.deep'), undefined)
	assertEquals(resolveLocaleKey(locale, ''), undefined)
	assertEquals(resolveLocaleKey(locale, undefined), undefined)
})

Deno.test('collectHomeInfoRefs walks sub_items and interfaces', () => {
	const refs = collectHomeInfoRefs({
		home_function_buttons: [{ info: 'a', sub_items: [{ info: 'b' }] }],
		home_interfaces: { chars: [{ info: 'c' }] },
		home_drag_in_handlers: [{ info: 'd' }],
		home_drag_out_generators: [{ info: 'e' }],
	})
	assertEquals(refs.map(ref => ref.info), ['a', 'b', 'c', 'd', 'e'])
	assertEquals(refs.map(ref => ref.requiresTitle), [true, true, true, false, false])
})

Deno.test('scanHomeRegistryData flags missing key, non-object and missing title', () => {
	const locale = {
		ok: { title: 'OK' },
		empty: { title: '   ' },
		plain: 'text',
		drag: { description: 'x' },
	}
	const issues = scanHomeRegistryData('p/home_registry.json', {
		home_function_buttons: [
			{ info: 'ok' },
			{ info: 'empty' },
			{ info: 'plain' },
			{ info: 'absent' },
			{},
		],
		home_drag_in_handlers: [{ info: 'drag' }, { info: 'gone' }],
	}, locale)
	const messages = issues.map(issue => issue.message).join('\n')
	assert(messages.includes('info.title 缺失或非字符串'))
	assert(messages.includes('须指向含 title 的对象'))
	assert(messages.includes('不存在于 zh-CN'))
	assert(messages.includes('缺少 info locale 键'))
	assertEquals(issues.length, 5)
})

Deno.test('scanHomeRegistryData accepts a registry whose keys resolve', () => {
	const locale = {
		shell: {
			home_function_buttons: {
				component_related: { title: '组件', sub_items: { open: { title: '打开' } } },
			},
		},
	}
	const issues = scanHomeRegistryData('p/home_registry.json', {
		home_function_buttons: [{
			id: 'component_related',
			info: 'shell.home_function_buttons.component_related',
			sub_items: [{ info: 'shell.home_function_buttons.component_related.sub_items.open' }],
		}],
	}, locale)
	assertEquals(issues, [])
})

Deno.test('repo home_registry info keys resolve in zh-CN', async () => {
	const files = await listRepoFiles(REPO_ROOT, ['.json'], { under: 'src/public/parts' })
	const registryPaths = files.filter(path => path.endsWith('/home_registry.json'))
	assert(registryPaths.length > 0, '未找到 home_registry.json')
	const locale = JSON.parse(await readFile(join(REPO_ROOT, 'src/public/locales/zh-CN.json'), 'utf8'))

	/** @type {{ path: string, message: string }[]} */
	const issues = []
	for (const relPath of registryPaths) {
		const data = JSON.parse(await readFile(join(REPO_ROOT, relPath), 'utf8'))
		issues.push(...scanHomeRegistryData(relPath, data, locale))
	}
	assertEquals(
		issues.map(issue => `${issue.path}: ${issue.message}`),
		[],
		issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'),
	)
})
