/**
 * 主题圆角感知检测扫描器自测。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	hasHardcodedRadius,
	isThemeRadiusExcluded,
	scanFileThemeRadius,
	scanThemeRadius,
} from '../theme_radius.mjs'

Deno.test('hasHardcodedRadius: matches fixed-radius classes', () => {
	const cases = [
		'rounded', 'rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl',
		'rounded-2xl', 'rounded-3xl', 'rounded-xs',
	]
	for (const token of cases)
		assertEquals(hasHardcodedRadius(token), true, `expect ${token} to match`)
})

Deno.test('hasHardcodedRadius: matches single-corner fixed radius', () => {
	assertEquals(hasHardcodedRadius('rounded-t-lg'), true)
	assertEquals(hasHardcodedRadius('rounded-l-md'), true)
	assertEquals(hasHardcodedRadius('rounded-tr-2xl'), true)
})

Deno.test('hasHardcodedRadius: matches rounded-full (avatar circle)', () => {
	assertEquals(hasHardcodedRadius('rounded-full'), true)
})

Deno.test('hasHardcodedRadius: does not match theme-aware or explicit square', () => {
	for (const token of ['rounded-none', 'rounded-box', 'rounded-field', 'rounded-selector', 'rounded-btn', 'rounded-badge'])
		assertEquals(hasHardcodedRadius(token), false, `expect ${token} not to match`)
})

Deno.test('scanFileThemeRadius: reports line and token', () => {
	const text = '<div class="bg-base-100 rounded-lg shadow"></div>\n<div class="rounded-md"></div>\n'
	const issues = scanFileThemeRadius('a.html', text)
	assertEquals(issues.length, 2)
	assertEquals(issues[0], { path: 'a.html', line: 1, token: 'rounded-lg' })
	assertEquals(issues[1], { path: 'a.html', line: 2, token: 'rounded-md' })
})

Deno.test('scanFileThemeRadius: theme-aware classes are ignored', () => {
	const text = '<div class="rounded-box rounded-none"></div>\n'
	assertEquals(scanFileThemeRadius('a.html', text).length, 0)
})

Deno.test('scanFileThemeRadius: flags hardcoded CSS border-radius', () => {
	const text = '.a { border-radius: 0.5rem; }\n.b { border-radius: var(--radius-box); }\n'
	const issues = scanFileThemeRadius('a.css', text)
	assertEquals(issues.length, 1)
	assertEquals(issues[0], { path: 'a.css', line: 1, token: 'border-radius: 0.5rem' })
})

Deno.test('scanFileThemeRadius: flags custom hardcoded --radius-* var definitions', () => {
	const text = ':root { --radius-sm: 6px; --radius-md: 10px; --radius-lg: var(--radius-box); }\n'
	const issues = scanFileThemeRadius('a.css', text)
	assertEquals(issues.length, 2)
	assertEquals(issues[0].token, '--radius-sm: 6px')
	assertEquals(issues[1].token, '--radius-md: 10px')
})

Deno.test('scanFileThemeRadius: flags hardcoded border width', () => {
	const text = '.a { border: 1px solid #ccc; }\n.b { border-bottom: 2px solid var(--border); }\n'
	const issues = scanFileThemeRadius('a.css', text)
	assertEquals(issues.length, 2)
	assertEquals(issues[0].token, 'border: 1px')
	assertEquals(issues[1].token, 'border-bottom: 2px')
})

Deno.test('scanFileThemeRadius: border-width regex ignores border-radius', () => {
	const text = '.a { border-radius: 0.5rem; border-top-left-radius: 8px; }\n'
	const issues = scanFileThemeRadius('a.css', text)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].token, 'border-radius: 0.5rem')
})

Deno.test('scanFileThemeRadius: theme-radius-ignore skips the next line only', () => {
	const text = '.a { border: 1px solid #ccc; }\n/* theme-radius-ignore */\n.b { border: 2px solid #ccc; }\n.c { border: 2px solid #ccc; }\n'
	const issues = scanFileThemeRadius('a.css', text)
	assertEquals(issues.length, 2)
	assertEquals(issues[0].token, 'border: 1px')
	assertEquals(issues[1].token, 'border: 2px')
})

Deno.test('isThemeRadiusExcluded: excludes test fixtures', () => {
	assertEquals(isThemeRadiusExcluded('src/public/a/test/b.html'), true)
	assertEquals(isThemeRadiusExcluded('src/public/a/b.test.mjs'), true)
	assertEquals(isThemeRadiusExcluded('src/public/a/server-status.php.html'), true)
	assertEquals(isThemeRadiusExcluded('src/public/a/b.html'), false)
})

Deno.test('repo: no hardcoded fixed-radius classes in themed frontend (incl. .github/pages)', async () => {
	const { issues } = await scanThemeRadius(REPO_ROOT)
	if (issues.length) {
		const sample = issues.slice(0, 12).map(i => `${i.path}:${i.line} ${i.token}`).join('\n')
		assert(false, `主题化前端存在硬编码固定圆角类 (${issues.length}):\n${sample}`)
	}
})
