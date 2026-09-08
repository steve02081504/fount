/**
 * daisyUI 语义变量缩写检测扫描器自测。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	DAISYUI_VAR_FULL_NAMES,
	isDaisyuiVarExcluded,
	scanDaisyuiVar,
	scanFileDaisyuiVar,
} from '../daisyui_var.mjs'

Deno.test('DAISYUI_VAR_FULL_NAMES: covers every v4 abbreviation with v5 full name', () => {
	assertEquals(DAISYUI_VAR_FULL_NAMES, {
		'--b1': '--color-base-100',
		'--b2': '--color-base-200',
		'--b3': '--color-base-300',
		'--bc': '--color-base-content',
		'--p': '--color-primary',
		'--pc': '--color-primary-content',
		'--s': '--color-secondary',
		'--sc': '--color-secondary-content',
		'--a': '--color-accent',
		'--ac': '--color-accent-content',
		'--n': '--color-neutral',
		'--nc': '--color-neutral-content',
		'--in': '--color-info',
		'--inc': '--color-info-content',
		'--su': '--color-success',
		'--suc': '--color-success-content',
		'--wa': '--color-warning',
		'--wac': '--color-warning-content',
		'--er': '--color-error',
		'--erc': '--color-error-content',
	})
})

Deno.test('scanFileDaisyuiVar: flags var() references to abbreviated semantic vars', () => {
	const text = '.a { background: oklch(var(--b2) / 0.5); }\n.b { color: var(--bc); }\n'
	const issues = scanFileDaisyuiVar('a.css', text)
	assertEquals(issues.length, 2)
	assertEquals(issues[0], {
		path: 'a.css',
		line: 1,
		token: 'var(--b2',
		abbreviation: '--b2',
		full: '--color-base-200',
	})
	assertEquals(issues[1], {
		path: 'a.css',
		line: 2,
		token: 'var(--bc',
		abbreviation: '--bc',
		full: '--color-base-content',
	})
})

Deno.test('scanFileDaisyuiVar: flags bare abbreviations with alpha prefix over long names', () => {
	assertEquals(scanFileDaisyuiVar('a.css', '.a { background: var(--p / 0.15); }\n.b { border: var(--wa) 1px; }\n.c { color: var(--a); }\n').map(issue => issue.full), ['--color-primary', '--color-warning', '--color-accent'])
})

Deno.test('scanFileDaisyuiVar: flags --abbr: definitions', () => {
	const issues = scanFileDaisyuiVar('a.css', ':root {\n\t--b1: 100% 0 0;\n\t--p: 58.2% 0.1612 17.9;\n\t--wa: 80.8% 0.114 19.57;\n}\n')
	assertEquals(issues.length, 3)
	assertEquals(issues.map(issue => issue.abbreviation), ['--b1', '--p', '--wa'])
	assertEquals(issues.map(issue => issue.line), [2, 3, 4])
})

Deno.test('scanFileDaisyuiVar: full names are allowed', () => {
	assertEquals(scanFileDaisyuiVar('a.css', '.a { background: oklch(var(--color-base-200) / 0.5); }\n.b { color: var(--color-base-content); }\n:root { --color-primary: 58.2% 0.1612 17.9; }\n').length, 0)
})

Deno.test('scanFileDaisyuiVar: no false positives on longer custom vars sharing a prefix', () => {
	assertEquals(scanFileDaisyuiVar('a.css', '.a { color: var(--primary); }\n.b { margin: var(--padding); }\n.c { border: var(--border) solid #000; }\n.d { outline: var(--nunito); }\n.e { color: var(--info); }\n.f { background: var(--base-100); }\n').length, 0)
})

Deno.test('scanFileDaisyuiVar: single-letter abbrevs need a word boundary after them', () => {
	assertEquals(scanFileDaisyuiVar('a.css', '.a { color: var(--primary); }\n.b { --sassy: 1; }\n.c { --main: 1; }\n').length, 0)
})

Deno.test('scanFileDaisyuiVar: abbreviations inside comments are ignored', () => {
	const mjs = '// 解析 var(--bc)\nconst x = "var(--color-base-content)"\n/* var(--p) 说明 */\n'
	assertEquals(scanFileDaisyuiVar('a.mjs', mjs).length, 0)
	const css = '/* fallback var(--b1) */\n.a { color: var(--color-base-100); }\n<!-- var(--wa) -->\n'
	assertEquals(scanFileDaisyuiVar('a.css', css).length, 0)
	const html = '<!-- var(--bc) 说明 -->\n<div style="color: var(--color-base-content)"></div>\n'
	assertEquals(scanFileDaisyuiVar('a.html', html).length, 0)
})

Deno.test('scanFileDaisyuiVar: real code after a comment line still keeps its line number', () => {
	const issues = scanFileDaisyuiVar('a.css', '/* 多行注释\n   说明 var(--b1)\n*/\n.a { background: var(--b2); }\n')
	assertEquals(issues.length, 1)
	assertEquals(issues[0].line, 4)
	assertEquals(issues[0].token, 'var(--b2')
})

Deno.test('scanFileDaisyuiVar: daisyui-var-ignore exempts only the next line', () => {
	const issues = scanFileDaisyuiVar('a.css', '/* daisyui-var-ignore */\n.a { background: var(--b2); }\n.b { background: var(--b2); }\n')
	assertEquals(issues.length, 1)
	assertEquals(issues[0].line, 3)
})

Deno.test('scanFileDaisyuiVar: daisyui-var-ignore does not exempt theme-radius-ignore', () => {
	assertEquals(scanFileDaisyuiVar('a.css', '/* theme-radius-ignore */\n.a { background: var(--b2); }\n').length, 1)
})

Deno.test('scanFileDaisyuiVar: flags @property declarations of abbreviated vars', () => {
	const issues = scanFileDaisyuiVar('a.css', '@property --b1 { syntax: "<color>"; initial-value: #fff; }\n.a { background: var(--b2); }\n')
	assertEquals(issues.length, 2)
	assertEquals(issues[0].abbreviation, '--b1')
	assertEquals(issues[0].token, '@property --b1')
	assertEquals(issues[0].full, '--color-base-100')
	assertEquals(issues[0].line, 1)
	assertEquals(issues[1].abbreviation, '--b2')
})

Deno.test('isDaisyuiVarExcluded: matches theme_radius exclusions', () => {
	assertEquals(isDaisyuiVarExcluded('src/public/a/test/b.css'), true)
	assertEquals(isDaisyuiVarExcluded('src/public/a/b.test.css'), true)
	assertEquals(isDaisyuiVarExcluded('src/public/a/b.php.html'), true)
	assertEquals(isDaisyuiVarExcluded('src/public/a/b.css'), false)
})

Deno.test('repo: no abbreviated daisyUI semantic vars in themed frontend', async () => {
	const { issues } = await scanDaisyuiVar(REPO_ROOT)
	if (issues.length)
		assert(false, `主题化前端存在 daisyUI 语义变量缩写（改用全拼 --color-*）(${issues.length}):\n${issues.slice(0, 12).map(issue => `${issue.path}:${issue.line} ${issue.token} → ${issue.full}`).join('\n')}`)
})
