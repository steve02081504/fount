/**
 * 手动 SVG 定义检测扫描器自测。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	isNoManualSvgExcluded,
	scanFileManualSvg,
	scanManualSvg,
} from '../no_manual_svg.mjs'

Deno.test('scanFileManualSvg: flags a hand-written icon svg element', () => {
	const icon = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 4h16"/></svg>'
	const issues = scanFileManualSvg('a.mjs', `const ICON = '${icon}'\n`)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].path, 'a.mjs')
	assertEquals(issues[0].line, 1)
})

Deno.test('scanFileManualSvg: flags a multi-line svg with shape children', () => {
	const html = '<div>\n<svg viewBox="0 0 24 24">\n<rect width="4" height="4"/>\n</svg>\n</div>\n'
	assertEquals(scanFileManualSvg('a.html', html).map(issue => issue.line), [2])
})

Deno.test('scanFileManualSvg: allows svg string fragments (replace / regex)', () => {
	const mjs = [
		'return svgTag.replace(\'<svg\', `<svg ${name}="${value}"`)',
		'if (/<svg\\b/i.test(html)) {',
		'return html.replace(/<svg\\b/i, `<svg id="${id}"`)',
		'const addClass = (svg, c) => svg.replace(\'<svg\', `<svg class="${c}"`)',
	].join('\n')
	assertEquals(scanFileManualSvg('a.mjs', mjs).length, 0)
})

Deno.test('scanFileManualSvg: allows template wrappers whose child is an interpolation', () => {
	assertEquals(scanFileManualSvg('a.mjs', 'return `<svg id="${id}" xmlns="http://www.w3.org/2000/svg">${html}</svg>`\n').length, 0)
})

Deno.test('scanFileManualSvg: ignores svg inside comments', () => {
	const mjs = '// <svg><path d="M0 0"/></svg>\nconst x = "ok"\n/* <svg><rect/></svg> 说明 */\n'
	assertEquals(scanFileManualSvg('a.mjs', mjs).length, 0)
	const html = '<!-- <svg><path d="M0 0"/></svg> 说明 -->\n<p>ok</p>\n'
	assertEquals(scanFileManualSvg('a.html', html).length, 0)
})

Deno.test('scanFileManualSvg: no-manual-svg-ignore exempts only the next line', () => {
	const text = '/* no-manual-svg-ignore */\n<svg><path d="M0 0"/></svg>\n<svg><path d="M0 0"/></svg>\n'
	const issues = scanFileManualSvg('a.html', text)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].line, 3)
})

Deno.test('isNoManualSvgExcluded: matches theme_radius exclusions', () => {
	assertEquals(isNoManualSvgExcluded('src/public/a/test/b.mjs'), true)
	assertEquals(isNoManualSvgExcluded('src/public/a/b.test.mjs'), true)
	assertEquals(isNoManualSvgExcluded('src/public/a/b.spec.mjs'), true)
	assertEquals(isNoManualSvgExcluded('src/public/a/b.php.html'), true)
	assertEquals(isNoManualSvgExcluded('src/public/a/b.mjs'), false)
})

Deno.test('repo: no hand-written svg definitions in themed frontend', async () => {
	const { issues } = await scanManualSvg(REPO_ROOT)
	if (issues.length)
		assert(false, `主题化前端存在手写 SVG 定义（改用 Iconify CDN 图标）(${issues.length}):\n${issues.slice(0, 12).map(issue => `${issue.path}:${issue.line} ${issue.token}`).join('\n')}`)
})
