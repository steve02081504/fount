/**
 * 本地 `.ts` 运行时导入检测扫描器自测。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	isLocalRepoSpecifier,
	scanFileNoTsImport,
	scanNoTsImport,
} from '../no_ts_import.mjs'

Deno.test('scanFileNoTsImport: flags static / side-effect / re-export / dynamic .ts imports', () => {
	assertEquals(scanFileNoTsImport('a.mjs', [
		'import { isSummaryEntry } from \'../../decl/chatLog.ts\';',
		'import \'../../decl/chatLog.ts\';',
		'export { isSummaryEntry } from \'../../decl/chatLog.ts\';',
		'export * from \'../../decl/chatLog.ts\';',
		'await import(\'../../decl/chatLog.ts\');',
	].join('\n')).length, 5)
})

Deno.test('scanFileNoTsImport: flags fount/ alias and bare relative .ts', () => {
	const issues = scanFileNoTsImport('a.mjs', [
		'import { x } from \'fount/decl/chatLog.ts\'',
		'import { x } from \'./local.ts\'',
	].join('\n'))
	assertEquals(issues.length, 2)
	assertEquals(issues[0].specifier, 'fount/decl/chatLog.ts')
	assertEquals(issues[1].specifier, './local.ts')
})

Deno.test('scanFileNoTsImport: reports line numbers across lines', () => {
	const issues = scanFileNoTsImport('a.mjs', [
		'const a = 1;',
		'import { x } from \'./local.ts\'',
	].join('\n'))
	assertEquals(issues[0].line, 2)
})

Deno.test('scanFileNoTsImport: ignores remote / package-manager specifiers', () => {
	assertEquals(scanFileNoTsImport('a.mjs', [
		'import { assertEquals } from \'https://deno.land/std/assert/mod.ts\'',
		'import { assert } from \'jsr:@std/assert\'',
		'import open from \'npm:open\'',
		'import { join } from \'node:path\'',
	].join('\n')).length, 0)
})

Deno.test('scanFileNoTsImport: ignores JSDoc type references and comments', () => {
	assertEquals(scanFileNoTsImport('a.mjs', [
		'/** @typedef {import(\'../../decl/chatLog.ts\').chatLogEntry_t} chatLogEntry_t */',
		'// import { x } from \'./local.ts\'',
		'/* import { x } from \'./local.ts\' */',
	].join('\n')).length, 0)
})

Deno.test('scanFileNoTsImport: ignores .ts text inside string and template literals', () => {
	assertEquals(scanFileNoTsImport('a.mjs', [
		'const a = "from \'./local.ts\'";',
		'const b = `import(\'./local.ts\')`;',
	].join('\n')).length, 0)
})

Deno.test('scanFileNoTsImport: ignores non-.ts specifiers', () => {
	assertEquals(scanFileNoTsImport('a.mjs', [
		'import { x } from \'./local.mjs\'',
		'import { x } from \'./local.js\'',
	].join('\n')).length, 0)
})

Deno.test('scanFileNoTsImport: flags a multi-line import whose specifier is on its own line', () => {
	const issues = scanFileNoTsImport('a.mjs', 'import {\n\tx,\n} from \'./local.ts\'\n')
	assertEquals(issues.length, 1)
	assertEquals(issues[0].specifier, './local.ts')
})

Deno.test('isLocalRepoSpecifier: repo-relative and alias are local, schemes are not', () => {
	assertEquals(isLocalRepoSpecifier('./a.ts'), true)
	assertEquals(isLocalRepoSpecifier('../a/b.ts'), true)
	assertEquals(isLocalRepoSpecifier('fount/decl/chatLog.ts'), true)
	assertEquals(isLocalRepoSpecifier('https://deno.land/std/assert/mod.ts'), false)
	assertEquals(isLocalRepoSpecifier('jsr:@std/assert'), false)
	assertEquals(isLocalRepoSpecifier('npm:open'), false)
	assertEquals(isLocalRepoSpecifier('node:path'), false)
})

Deno.test('repo: .mjs / .js must not import repo-local .ts', async () => {
	const { issues } = await scanNoTsImport(REPO_ROOT)
	if (issues.length)
		assert(false, [
			'fount 约定：`.ts` 只作 JSDoc 类型声明，实际逻辑由 `.mjs` / `.js` 承担。',
			'因此 `.mjs` / `.js` 不得在运行时 import 仓库内的 `.ts`（from / import / export … from / import()）。',
			'修法：把被 import 的运行时值（常量、谓词、工厂）挪进 `.mjs` / `.js`，再让 `.mjs` / `.js` 引用它；',
			'类型标注改用 JSDoc `{import(\'./x.ts\')}`（不算运行时 import）。',
			'',
			`命中 ${issues.length} 处：`,
			...issues.map(issue => `${issue.path}:${issue.line} ${issue.specifier}`),
		].join('\n'))
})
