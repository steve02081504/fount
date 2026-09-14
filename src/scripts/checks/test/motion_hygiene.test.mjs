/**
 * 动效卫生检测扫描器自测。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	isLayoutTransitionProp,
	scanFileMotionHygiene,
	scanMotionHygiene,
} from '../motion_hygiene.mjs'

Deno.test('isLayoutTransitionProp: matches reflow properties and prefixes', () => {
	for (const prop of ['width', 'height', 'max-height', 'top', 'left', 'inset', 'flex-basis', 'grid-template-rows', 'margin', 'margin-top', 'padding-inline', 'inset-block-start'])
		assertEquals(isLayoutTransitionProp(prop), true, `expect ${prop} to match`)
})

Deno.test('isLayoutTransitionProp: ignores composited / paint properties', () => {
	for (const prop of ['transform', 'opacity', 'background-color', 'color', 'box-shadow', 'border-color', 'filter', 'border-radius'])
		assertEquals(isLayoutTransitionProp(prop), false, `expect ${prop} not to match`)
})

Deno.test('scanFileMotionHygiene: flags transition: all forms', () => {
	const text = '.a { transition: all 0.3s ease; }\n.b { transition: all; }\n.c { transition-property: all; }\n.d { transition: 0.3s ease; }\n'
	const issues = scanFileMotionHygiene('a.css', text)
	assertEquals(issues.map(issue => `${issue.line}:${issue.token}`), [
		'1:transition: all', '2:transition: all', '3:transition-property: all', '4:transition: all',
	])
})

Deno.test('scanFileMotionHygiene: flags Tailwind transition-all class', () => {
	const issues = scanFileMotionHygiene('a.html', '<div class="card transition-all duration-500"></div>\n')
	assertEquals(issues, [{ path: 'a.html', line: 1, token: 'transition-all' }])
})

Deno.test('scanFileMotionHygiene: Tailwind transition-[…] arbitrary value is allowed', () => {
	assertEquals(scanFileMotionHygiene('a.html', '<div class="transition-[border-color,box-shadow]"></div>\n').length, 0)
})

Deno.test('scanFileMotionHygiene: flags layout-property transitions per layer', () => {
	const text = '.a { transition: opacity 0.2s, width 0.3s; }\n.b { transition: max-height 0.2s ease, margin-top 0.2s ease; }\n'
	const issues = scanFileMotionHygiene('a.css', text)
	assertEquals(issues.map(issue => `${issue.line}:${issue.token}`), [
		'1:transition: width', '2:transition: max-height', '2:transition: margin-top',
	])
})

Deno.test('scanFileMotionHygiene: allows composited property transitions', () => {
	const text = '.a { transition: transform 0.15s ease, opacity 0.15s ease; }\n.b { transition: background-color 0.12s, color 0.12s; }\n.c { transition: border-color 0.15s ease, box-shadow 0.15s ease; }\n'
	assertEquals(scanFileMotionHygiene('a.css', text).length, 0)
})

Deno.test('scanFileMotionHygiene: var() transition layer is not resolved and skipped', () => {
	assertEquals(scanFileMotionHygiene('a.css', '.a { transition: background var(--transition); }\n').length, 0)
})

Deno.test('scanFileMotionHygiene: flags transition-property layout list', () => {
	const issues = scanFileMotionHygiene('a.css', '.a { transition-property: color, width; }\n')
	assertEquals(issues, [{ path: 'a.css', line: 1, token: 'transition-property: width' }])
})

Deno.test('scanFileMotionHygiene: flags non-composited will-change and allows composited ones', () => {
	const text = '.a { will-change: width; }\n.b { will-change: transform, opacity; }\n.c { will-change: filter; }\n'
	assertEquals(scanFileMotionHygiene('a.css', text), [{ path: 'a.css', line: 1, token: 'will-change: width' }])
})

Deno.test('scanFileMotionHygiene: motion-ignore skips only the next line', () => {
	const text = '.a { transition: width 0.3s; }\n/* motion-ignore */\n.b { transition: width 0.3s; }\n.c { transition: all; }\n'
	const issues = scanFileMotionHygiene('a.css', text)
	assertEquals(issues.map(issue => `${issue.line}:${issue.token}`), [
		'1:transition: width', '4:transition: all',
	])
})

Deno.test('scanFileMotionHygiene: motion-ignore also exempts Tailwind transition-all', () => {
	const text = '<!-- motion-ignore -->\n<div class="transition-all"></div>\n<div class="transition-all"></div>\n'
	const issues = scanFileMotionHygiene('a.html', text)
	assertEquals(issues.map(issue => `${issue.line}:${issue.token}`), ['3:transition-all'])
})

Deno.test('repo: no motion hygiene violations in themed frontend (incl. .github/pages)', async () => {
	const { issues } = await scanMotionHygiene(REPO_ROOT)
	if (issues.length)
		assert(false, `主题化前端存在动效卫生问题（transition: all / 布局属性过渡 / 非合成 will-change）(${issues.length}):\n${issues.slice(0, 20).map(issue => `${issue.path}:${issue.line} ${issue.token}`).join('\n')}`)
})

Deno.test('repo: motion/styles.css keeps the global prefers-reduced-motion guard', async () => {
	const content = await readFile(join(REPO_ROOT, 'src/public/pages/scripts/motion/styles.css'), 'utf8')
	assert(
		/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/u.test(content),
		'motion/styles.css 必须保留全局 prefers-reduced-motion 守卫（页面动效依赖它，见 pages/docs/motion-notes.md）',
	)
})
