/**
 * 多行字符串构建风格扫描器自测。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	isBuildStringScanned,
	scanBuildString,
	scanFileBuildString,
} from '../build_string.mjs'

Deno.test('scanFileBuildString: flags literal array join with newline', () => {
	const issues = scanFileBuildString('a.mjs', `
const x = [
	'a',
	'b',
].join('\\n')
`)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].kind, 'array-join')
	assertEquals(issues[0].line, 2)
})

Deno.test('scanFileBuildString: flags single-line array join and mixed elements', () => {
	assertEquals(scanFileBuildString('a.mjs', String.raw`const x = ['a', 'b'].join('\n')`)[0].kind, 'array-join')
	assertEquals(scanFileBuildString('a.mjs', `
const x = [
	'head',
	value,
	\`tail \${n}\`,
].join('\\n')
`)[0].kind, 'array-join')
	assertEquals(scanFileBuildString('a.mjs', String.raw`function f() { return [0, 1].join('\n') }`).length, 1)
})

Deno.test('scanFileBuildString: does not flag method chains, spreads, subscripts, or other separators', () => {
	assertEquals(scanFileBuildString('a.mjs', String.raw`const x = [a, b].filter(Boolean).join('\n')`).length, 0)
	assertEquals(scanFileBuildString('a.mjs', String.raw`const x = [...new Set(list)].join('\n')`).length, 0)
	assertEquals(scanFileBuildString('a.mjs', String.raw`const x = rows.map(r => r).join('\n')`).length, 0)
	assertEquals(scanFileBuildString('a.mjs', String.raw`const x = arr[0].join('\n')`).length, 0)
	assertEquals(scanFileBuildString('a.mjs', String.raw`const x = ['a', 'b'].join(',')`).length, 0)
	assertEquals(scanFileBuildString('a.mjs', String.raw`const x = [].join('\n')`).length, 0)
})

Deno.test('scanFileBuildString: flags pure literal + chains containing newlines', () => {
	const issues = scanFileBuildString('a.mjs', String.raw`const x = 'a\n' + 'b\n' + 'c'`)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].kind, 'literal-concat')
})

Deno.test('scanFileBuildString: does not flag mixed, newline-free, or chained literal concatenations', () => {
	assertEquals(scanFileBuildString('a.mjs', String.raw`const x = 'a\n' + b + 'c'`).length, 0)
	assertEquals(scanFileBuildString('a.mjs', String.raw`const x = 'a' + 'b'`).length, 0)
	assertEquals(scanFileBuildString('a.mjs', String.raw`const x = 'a\n' + 'b' + c`).length, 0)
	assertEquals(scanFileBuildString('a.mjs', String.raw`const x = a + 'x\n' + 'y'`).length, 0)
})

Deno.test('scanFileBuildString: flags a single-use const string returned through a template', () => {
	const issues = scanFileBuildString('a.mjs', 'const a = getName()\nreturn `\\\n${a}\n`\n')
	assertEquals(issues.length, 1)
	assertEquals(issues[0].kind, 'inline-const')
})

Deno.test('scanFileBuildString: does not flag reused or non-trivial const interpolations', () => {
	assertEquals(scanFileBuildString('a.mjs', 'const a = getName()\nreturn `${a}${a}`\n').length, 0)
	assertEquals(scanFileBuildString('a.mjs', 'const a = getName()\nreturn `pre ${a}`\n').length, 0)
	assertEquals(scanFileBuildString('a.mjs', 'const a = getName()\ndoSomething(a)\n').length, 0)
})

Deno.test('scanFileBuildString: ignores patterns inside strings, templates, and comments', () => {
	assertEquals(scanFileBuildString('a.mjs', String.raw`const s = "['a', 'b'].join('\n')" // ['c', 'd'].join('\n')`).length, 0)
	assertEquals(scanFileBuildString('a.mjs', String.raw`// [a, b].join('\n')
const x = 1`).length, 0)
})

Deno.test('isBuildStringScanned: skips tests, specs, and the scanner itself', () => {
	assertEquals(isBuildStringScanned('src/scripts/checks/build_string.mjs'), false)
	assertEquals(isBuildStringScanned('a/b.test.mjs'), false)
	assertEquals(isBuildStringScanned('a/b.spec.js'), false)
	assertEquals(isBuildStringScanned('a/b.test.ts'), false)
	assertEquals(isBuildStringScanned('src/log_viewer/selector.mjs'), true)
	assertEquals(isBuildStringScanned('src/public/parts/shells/chat/src/group/routes/channelAutoName.mjs'), true)
})

Deno.test('repo: no static multiline string builds outside tests', async () => {
	const { issues } = await scanBuildString(REPO_ROOT)
	if (issues.length)
		assert(false, `源码存在静态多行字符串拼接（应改用多行模板字符串）(${issues.length}):\n${issues.slice(0, 12).map(issue => `${issue.path}:${issue.line} [${issue.kind}] ${issue.token}`).join('\n')}`)
})
