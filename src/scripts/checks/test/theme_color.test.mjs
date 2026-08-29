/**
 * 主题颜色感知检测扫描器自测。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	containsHardcodedColor,
	isThemeColorExcluded,
	isThemeColorVar,
	scanFileThemeColor,
	scanThemeColor,
} from '../theme_color.mjs'

Deno.test('containsHardcodedColor: matches hex colors', () => {
	for (const token of ['#1e1e1e', '#ddd', '#abc', '#a1b2c3d4', '#7aa2ff'])
		assertEquals(containsHardcodedColor(token), true, `expect ${token} to match`)
})

Deno.test('containsHardcodedColor: matches color functions', () => {
	for (const token of ['rgb(0, 0, 0)', 'rgba(255, 255, 255, 0.08)', 'hsl(0 0% 0%)', 'hsla(0, 0%, 0%, 0.5)', 'hwb(0 0% 0%)', 'oklch(0.2 0 0)', 'oklab(0.2 0 0)', 'lab(20 0 0)', 'lch(20 0 0)'])
		assertEquals(containsHardcodedColor(token), true, `expect ${token} to match`)
})

Deno.test('containsHardcodedColor: matches black/white keywords', () => {
	assertEquals(containsHardcodedColor('black'), true)
	assertEquals(containsHardcodedColor('white'), true)
	assertEquals(containsHardcodedColor(' 0 0 black'), true)
})

Deno.test('containsHardcodedColor: does not match transparent/none/lengths/var refs', () => {
	for (const token of ['transparent', 'none', '1px', '0', 'var(--color-base-content)', 'color-mix(in srgb, var(--color-base-content) 8%, transparent)'])
		assertEquals(containsHardcodedColor(token), false, `expect ${token} not to match`)
})

Deno.test('scanFileThemeColor: flags custom var with hardcoded color fallback', () => {
	const text = '.a { background: var(--bg-panel, #1e1e1e); }\n.b { color: var(--text-normal, #ddd); }\n'
	const issues = scanFileThemeColor('a.css', text)
	assertEquals(issues.length, 2)
	assertEquals(issues[0], { path: 'a.css', line: 1, token: 'var(--bg-panel, #1e1e1e)' })
	assertEquals(issues[1], { path: 'a.css', line: 2, token: 'var(--text-normal, #ddd)' })
})

Deno.test('scanFileThemeColor: flags nested var fallback with hardcoded color', () => {
	const issues = scanFileThemeColor('a.css', '.a { background: var(--bg-panel, var(--bg-channel, #1e1e1e)); }\n')
	assertEquals(issues.length, 2)
	assertEquals(issues[0].token, 'var(--bg-panel, var(--bg-channel, #1e1e1e))')
	assertEquals(issues[1].token, 'var(--bg-channel, #1e1e1e)')
})

Deno.test('scanFileThemeColor: flags color inside color-mix fallback', () => {
	const issues = scanFileThemeColor('a.css', '.a { background: color-mix(in srgb, var(--bg-sidebar, #1e1f22) 80%, #000); }\n')
	assertEquals(issues.length, 1)
	assertEquals(issues[0].token, 'var(--bg-sidebar, #1e1f22)')
})

Deno.test('scanFileThemeColor: theme vars with hardcoded fallback are allowed', () => {
	const text = '.a { background: var(--color-base-100, #fff); }\n.b { color: var(--color-warning, #f59e0b); }\n.c { border: var(--border, 1px) solid var(--color-base-300); }\n'
	assertEquals(scanFileThemeColor('a.css', text).length, 0)
})

Deno.test('scanFileThemeColor: no fallback / theme-var fallback are allowed', () => {
	const text = '.a { border-radius: var(--radius-box); }\n.b { color: var(--text-muted, var(--color-base-content)); }\n.c { background: color-mix(in srgb, var(--text-muted, var(--color-base-content)) 18%, transparent); }\n'
	assertEquals(scanFileThemeColor('a.css', text).length, 0)
})

Deno.test('scanFileThemeColor: detects multiline var fallback', () => {
	const text = '.a {\n\tbackground: var(--bg-panel,\n\t\t#1e1e1e);\n}\n'
	const issues = scanFileThemeColor('a.css', text)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].line, 2)
	assertEquals(issues[0].token, 'var(--bg-panel, #1e1e1e)')
})

Deno.test('scanFileThemeColor: theme-color-ignore exempts only the next line', () => {
	const text = '/* theme-color-ignore */\n.a { background: var(--bg-panel, #1e1e1e); }\n.b { background: var(--bg-panel, #1e1e1e); }\n'
	const issues = scanFileThemeColor('a.css', text)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].line, 3)
})

Deno.test('scanFileThemeColor: theme-color-ignore does not exempt theme-radius-ignore', () => {
	const text = '/* theme-radius-ignore */\n.a { background: var(--bg-panel, #1e1e1e); }\n'
	const issues = scanFileThemeColor('a.css', text)
	assertEquals(issues.length, 1)
})

Deno.test('isThemeColorVar: theme prefixes vs custom vars', () => {
	for (const prop of ['--color-base-100', '--color-primary', '--border'])
		assertEquals(isThemeColorVar(prop), true, `expect ${prop} to be theme var`)
	for (const prop of ['--bg-panel', '--bg-hover', '--text-normal', '--text-muted', '--accent', '--border-color', '--radius-box', '--rounded-field', '--radius-sm', '--fallback-b1'])
		assertEquals(isThemeColorVar(prop), false, `expect ${prop} not to be theme var`)
})

Deno.test('isThemeColorExcluded: excludes user scripts and test fixtures', () => {
	assertEquals(isThemeColorExcluded('src/public/parts/shells/browserIntegration/public/script.user.js'), true)
	assertEquals(isThemeColorExcluded('src/public/a/test/b.css'), true)
	assertEquals(isThemeColorExcluded('src/public/a/b.test.css'), true)
	assertEquals(isThemeColorExcluded('src/public/a/b.php.html'), true)
	assertEquals(isThemeColorExcluded('src/public/a/b.css'), false)
})

Deno.test('repo: no hardcoded color fallback on custom vars in themed frontend', async () => {
	const { issues } = await scanThemeColor(REPO_ROOT)
	if (issues.length)
		assert(false, `主题化前端存在自定义变量 + 硬编码颜色 fallback（绕过主题 --color-*）(${issues.length}):\n${issues.slice(0, 12).map(issue => `${issue.path}:${issue.line} ${issue.token}`).join('\n')}`)
})
