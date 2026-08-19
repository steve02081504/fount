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

Deno.test('hasHardcodedRadius: matches daisyUI btn-circle (circular button)', () => {
	assertEquals(hasHardcodedRadius('btn btn-ghost btn-circle btn-sm'), true)
})

Deno.test('hasHardcodedRadius: does not match theme-aware or explicit square', () => {
	for (const token of ['rounded-none', 'rounded-box', 'rounded-field', 'rounded-selector', 'rounded-btn', 'rounded-badge', 'btn-square'])
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

Deno.test('scanFileThemeRadius: flags percentage border-radius and --radius-* var', () => {
	const text = '.a { border-radius: 50%; }\n:root { --radius-avatar: 50%; }\n'
	const issues = scanFileThemeRadius('a.css', text)
	assertEquals(issues.length, 2)
	assertEquals(issues[0], { path: 'a.css', line: 1, token: 'border-radius: 50%' })
	assertEquals(issues[1], { path: 'a.css', line: 2, token: '--radius-avatar: 50%' })
})

Deno.test('scanFileThemeRadius: detects multiline border-radius / border / --radius-*', () => {
	const text = '.a {\n\tborder-radius:\n\t\t50%;\n}\n.b {\n\tborder:\n\t\t2px solid #ccc;\n}\n:root {\n\t--radius-sm:\n\t\t6px;\n}\n'
	const issues = scanFileThemeRadius('a.css', text)
	assertEquals(issues.length, 3)
	const tokens = issues.map(issue => issue.token.replaceAll('\n', ' ').replace(/\s+/g, ' ').trim()).sort()
	assertEquals(tokens, ['--radius-sm: 6px', 'border: 2px', 'border-radius: 50%'].sort())
	assertEquals(issues.map(issue => issue.line).sort((a, b) => a - b), [2, 6, 10])
})

Deno.test('scanFileThemeRadius: theme-radius-ignore exempts only the next border-width line', () => {
	const text = '.a { border-radius: 8px; }\n/* theme-radius-ignore */\n.b { border: 2px solid #ccc; }\n.c { border: 2px solid #ccc; }\n'
	const issues = scanFileThemeRadius('a.css', text)
	const tokens = issues.map(issue => `${issue.line}:${issue.token}`)
	assertEquals(tokens, ['1:border-radius: 8px', '4:border: 2px'])
})

Deno.test('scanFileThemeRadius: theme-radius-ignore does not exempt radius matches', () => {
	const text = '/* theme-radius-ignore */\n.b { border-radius: 8px; }\n'
	const issues = scanFileThemeRadius('a.css', text)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].token, 'border-radius: 8px')
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

Deno.test('isThemeRadiusExcluded: excludes .test/.spec across supported suffixes', () => {
	for (const suffix of ['html', 'mjs', 'js', 'css'])
		assertEquals(isThemeRadiusExcluded(`src/public/a/b.test.${suffix}`), true, `expect .test.${suffix} excluded`)
	for (const suffix of ['html', 'mjs', 'js', 'css'])
		assertEquals(isThemeRadiusExcluded(`src/public/a/b.spec.${suffix}`), true, `expect .spec.${suffix} excluded`)
	assertEquals(isThemeRadiusExcluded('src/public/a/b.spec.js.map'), false)
	assertEquals(isThemeRadiusExcluded('src/public/a/b.test'), false)
	assertEquals(isThemeRadiusExcluded('src/public/a/b.spec.tmp.js'), false)
})

Deno.test('scanFileThemeRadius: flags ch/vw/vh and calc border-radius', () => {
	const text = '.a { border-radius: 12ch; }\n.b { border-radius: 5vw; }\n.c { border-radius: calc(8px + 2px); }\n'
	const issues = scanFileThemeRadius('a.css', text)
	assertEquals(issues.length, 3)
	assertEquals(issues.map(issue => issue.token).sort(), ['border-radius: 12ch', 'border-radius: 5vw', 'border-radius: calc(8px + 2px)'].sort())
})

Deno.test('scanFileThemeRadius: theme-relative calc() with radius var is not flagged', () => {
	const text = '.a { border-radius: calc(var(--radius-box) - 2px); }\n'
	assertEquals(scanFileThemeRadius('a.css', text).length, 0)
})

Deno.test('scanFileThemeRadius: unitless zero corners and theme vars are not flagged', () => {
	const text = '.a { border-radius: 0; }\n.b { border-radius: 0 0 var(--radius-box) var(--radius-box); }\n.c { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }\n'
	assertEquals(scanFileThemeRadius('a.css', text).length, 0)
})

Deno.test('scanFileThemeRadius: flags mixed fixed length with theme var', () => {
	const text = '.a { border-radius: var(--radius-box) 8px; }\n.b { border-radius: 10px / var(--radius-field); }\n'
	const issues = scanFileThemeRadius('a.css', text)
	assertEquals(issues.length, 2)
	assertEquals(issues[0].token, 'border-radius: var(--radius-box) 8px')
	assertEquals(issues[1].token, 'border-radius: 10px / var(--radius-field)')
})

Deno.test('scanFileThemeRadius: --radius-* var accepts zero and theme-var values', () => {
	const text = ':root { --radius-a: 0; --radius-b: var(--radius-field); --radius-c: 6px; }\n'
	const issues = scanFileThemeRadius('a.css', text)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].token, '--radius-c: 6px')
})

Deno.test('repo: no hardcoded fixed-radius classes in themed frontend (incl. .github/pages)', async () => {
	const { issues } = await scanThemeRadius(REPO_ROOT)
	if (issues.length)
		assert(false, `主题化前端存在硬编码圆角 / 圆角变量 / 边框宽度（绕过主题 --radius-* / --border）(${issues.length}):\n${issues.slice(0, 12).map(issue => `${issue.path}:${issue.line} ${issue.token}`).join('\n')}`)
})
