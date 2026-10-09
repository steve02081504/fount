/**
 * 图标 `<img>` 必须带 `crossorigin="anonymous"`：否则 `<img>` 的 no-cors 响应
 * 不能被 `svgInliner` 的 cors fetch 复用，每个图标要下载两次。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	fixIconCrossorigin,
	fixTextIconCrossorigin,
	isIconCrossoriginScopePath,
	scanFileIconCrossorigin,
	scanIconCrossorigin,
	scanTextIconCrossorigin,
} from '../icon_crossorigin.mjs'

const ICON = 'https://api.iconify.design/line-md/home.svg'

Deno.test('scanTextIconCrossorigin: flags an iconify img without crossorigin', () => {
	const issues = scanTextIconCrossorigin('a.html', `<img src="${ICON}" class="text-icon" />`)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].line, 1)
})

Deno.test('scanTextIconCrossorigin: accepts an iconify img that already carries crossorigin', () => {
	assertEquals(scanTextIconCrossorigin('a.html', `<img crossorigin="anonymous" src="${ICON}" />`).length, 0)
	assertEquals(scanFileIconCrossorigin('a.html', `<img src="${ICON}" crossorigin />`).length, 0)
})

Deno.test('scanTextIconCrossorigin: leaves non-icon hosts and interpolated srcs alone', () => {
	assertEquals(scanTextIconCrossorigin('a.html', '<img src="https://example.com/avatar.png" />').length, 0)
	assertEquals(scanTextIconCrossorigin('a.mjs', '<img src="${part.avatar}" />').length, 0)
})

Deno.test('scanTextIconCrossorigin: reports the line inside a JSON-escaped tag', () => {
	const json = `{\n\t"button": "<img src=\\"${ICON}\\" class=\\"text-icon\\"/>"\n}\n`
	const issues = scanTextIconCrossorigin('registry.json', json)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].line, 2)
	assertEquals(fixTextIconCrossorigin(json).includes('crossorigin=\\"anonymous\\"'), true)
})

Deno.test('scanTextIconCrossorigin: an above-line directive skips only that tag', () => {
	const text = [
		'<!-- icon-crossorigin-ignore -->',
		`<img src="${ICON}" />`,
		`<img src="${ICON}" />`,
	].join('\n')
	const issues = scanTextIconCrossorigin('a.html', text)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].line, 3)
})

Deno.test('fixTextIconCrossorigin: fixes every violating tag, is idempotent and keeps the rest untouched', () => {
	const text = `<img src="${ICON}" class="text-icon"/>\n<img src="https://example.com/a.svg" />\n<img src="${ICON}" />`
	const fixed = fixTextIconCrossorigin(text)
	assert(fixed.includes(`<img crossorigin="anonymous" src="${ICON}" class="text-icon"/>`))
	assert(fixed.includes('<img src="https://example.com/a.svg" />'))
	assertEquals((fixed.match(/crossorigin="anonymous"/g) ?? []).length, 2)
	assertEquals(fixTextIconCrossorigin(fixed), null)
})

Deno.test('fixTextIconCrossorigin: returns null for clean and empty input', () => {
	assertEquals(fixTextIconCrossorigin(''), null)
	assertEquals(fixTextIconCrossorigin(`<img crossorigin="anonymous" src="${ICON}" />`), null)
})

Deno.test('scanTextIconCrossorigin: flags a literal iconify img.src assignment', () => {
	const text = `function show() {\n\tstatus.src = '${ICON}'\n}\n`
	const issues = scanTextIconCrossorigin('a.mjs', text)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].line, 2)
	assertEquals(issues[0].tag, 'status.src')
	const fixed = fixTextIconCrossorigin(text)
	assertEquals(fixed, `function show() {\n\tstatus.crossOrigin = 'anonymous'\n\tstatus.src = '${ICON}'\n}\n`)
	assertEquals(fixTextIconCrossorigin(fixed), null)
})

Deno.test('scanTextIconCrossorigin: flags src assigned from an icon constant or a ternary of them', () => {
	const text = [
		`const LOADING = '${ICON}'`,
		'const DONE = \'https://api.iconify.design/line-md/confirm.svg\'',
		'icon.src = LOADING',
		'other.src = flag ? LOADING : DONE',
	].join('\n')
	const issues = scanTextIconCrossorigin('a.mjs', text)
	assertEquals(issues.map(issue => issue.tag), ['icon.src', 'other.src'])
	const fixed = fixTextIconCrossorigin(text)
	assert(fixed.includes('icon.crossOrigin = \'anonymous\'\nicon.src = LOADING'))
	assert(fixed.includes('other.crossOrigin = \'anonymous\'\nother.src = flag ? LOADING : DONE'))
})

Deno.test('scanTextIconCrossorigin: accepts src assignments preceded by crossOrigin, ignores other srcs', () => {
	const text = [
		'img.crossOrigin = \'anonymous\'',
		`img.src = '${ICON}'`,
		`img.src = '${ICON}'`,
		'avatar.src = \'https://example.com/avatar.png\'',
		'copy.src = source.src',
	].join('\n')
	assertEquals(scanTextIconCrossorigin('a.mjs', text).length, 0)
})

Deno.test('scanTextIconCrossorigin: guarded src assignment is reported but not auto-fixed', () => {
	const text = `if (icon) icon.src = '${ICON}'\n`
	assertEquals(scanTextIconCrossorigin('a.mjs', text).length, 1)
	assertEquals(fixTextIconCrossorigin(text), null)
	const ignored = `/* icon-crossorigin-ignore */\nif (icon) icon.src = '${ICON}'\n`
	assertEquals(scanTextIconCrossorigin('a.mjs', ignored).length, 0)
})

Deno.test('isIconCrossoriginScopePath: themed frontend only, tests excluded', () => {
	assertEquals(isIconCrossoriginScopePath('src/public/parts/shells/home/public/index.html'), true)
	assertEquals(isIconCrossoriginScopePath('.github/pages/index.html'), true)
	assertEquals(isIconCrossoriginScopePath('src/public/pages/test/frontend/a.spec.mjs'), false)
	assertEquals(isIconCrossoriginScopePath('src/server/web_server/preload_list.mjs'), false)
})

Deno.test('repo: iconify <img> tags and icon src assignments carry CORS mode (auto-fix)', async () => {
	const fixed = await fixIconCrossorigin(REPO_ROOT)
	const { issues } = await scanIconCrossorigin(REPO_ROOT)
	if (fixed.length)
		console.log(`自动修复 ${fixed.length} 个文件的图标 crossorigin:\n${fixed.join('\n')}`)
	if (issues.length) {
		const sample = issues.slice(0, 12).map(issue => `${issue.path}:${issue.line} ${issue.tag}`).join('\n')
		assert(false, `图标缺少 crossorigin="anonymous"（${issues.length}）：\n${sample}`)
	}
})
