/**
 * 手算毫秒乘积检测扫描器自测。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	isMsLiteralScanned,
	scanFileMsLiteral,
	scanMsLiteral,
} from '../ms_literal.mjs'

Deno.test('scanFileMsLiteral: flags minute / hour / day products', () => {
	const issues = scanFileMsLiteral('a.mjs', [
		'const a = 5 * 60 * 1000;',
		'const b = 2 * 60 * 60 * 1000;',
		'const c = 24 * 60 * 60 * 1000;',
	].join('\n'))
	assertEquals(issues.length, 3)
	assertEquals(issues[0], { path: 'a.mjs', line: 1, token: '5 * 60 * 1000' })
	assertEquals(issues[1], { path: 'a.mjs', line: 2, token: '2 * 60 * 60 * 1000' })
	assertEquals(issues[2], { path: 'a.mjs', line: 3, token: '24 * 60 * 60 * 1000' })
})

Deno.test('scanFileMsLiteral: flags weeks / months / years and hour/day aliases', () => {
	assertEquals(scanFileMsLiteral('a.mjs', [
		'7 * 24 * 60 * 60 * 1000',
		'30 * 24 * 60 * 60 * 1000',
		'365 * 24 * 3600 * 1000',
		'8 * 3600 * 1000',
		'7 * 86400 * 1000',
	].join('\n')).length, 5)
})

Deno.test('scanFileMsLiteral: does not flag variable / byte / exponent products', () => {
	assertEquals(scanFileMsLiteral('a.mjs', [
		'json.expires_in * 1000',
		'const bytes = 1000 * MiB;',
		'1000 * 2 ** Math.min(n, 5)',
		'width * height',
	].join('\n')).length, 0)
})

Deno.test('scanFileMsLiteral: does not flag a bare seconds factor or non-ms products', () => {
	assertEquals(scanFileMsLiteral('a.mjs', [
		'const s = 5 * 1000;',      // 秒，无时间单位因子 → 不判为手算产物
		'const m = 1000 * 1000;',   // 一千万，非毫秒
	].join('\n')).length, 0)
})

Deno.test('scanFileMsLiteral: does not match inside identifiers', () => {
	const issues = scanFileMsLiteral('a.mjs', 'const foo1000 = 60 * 60 * 1000;\n')
	assertEquals(issues.length, 1)
	assertEquals(issues[0].token, '60 * 60 * 1000')
})

Deno.test('scanFileMsLiteral: flags embedded sub-chain after a variable multiplier', () => {
	const issues = scanFileMsLiteral('a.mjs', 'const ms = EXPIRY_DAYS * 24 * 60 * 60 * 1000;\n')
	assertEquals(issues.length, 1)
	assertEquals(issues[0].token, '24 * 60 * 60 * 1000')
})

Deno.test('scanFileMsLiteral: reports line numbers across lines', () => {
	const issues = scanFileMsLiteral('a.mjs', 'const a = 1;\nconst b = 5 * 60 * 1000;\nconst c = 2;\n')
	assertEquals(issues[0].line, 2)
})

Deno.test('scanFileMsLiteral: ignores ms products in comments, JSDoc, strings, and template literals', () => {
	const issues = scanFileMsLiteral('a.mjs', [
		'// 5 * 60 * 1000',
		'/* 24 * 60 * 60 * 1000 */',
		'/** 7 * 24 * 60 * 60 * 1000 */',
		'const s = "365 * 24 * 3600 * 1000";',
		'const t = "30 * 24 * 60 * 60 * 1000";',
		'const u = `8 * 3600 * 1000`;',
		'const ok = 5 * 60 * 1000;',
	].join('\n'))
	assertEquals(issues.length, 1)
	assertEquals(issues[0], { path: 'a.mjs', line: 7, token: '5 * 60 * 1000' })
})

Deno.test('scanFileMsLiteral: flags ms products inside template literal interpolations', () => {
	const issues = scanFileMsLiteral('a.mjs', [
		'const a = `timeout ${5 * 60 * 1000}ms`;',
		'const b = `${prefix}${24 * 60 * 60 * 1000}`;',
		'const c = `${`nested ${7 * 24 * 60 * 60 * 1000}`}`;',
	].join('\n'))
	assertEquals(issues.length, 3)
	assertEquals(issues[0].token, '5 * 60 * 1000')
	assertEquals(issues[1].token, '24 * 60 * 60 * 1000')
	assertEquals(issues[2].token, '7 * 24 * 60 * 60 * 1000')
})

Deno.test('scanFileMsLiteral: ignores comments inside template interpolations', () => {
	const issues = scanFileMsLiteral('a.mjs', [
		'const lineCommentValue = `${5 * 60 * 1000 // 30 * 24 * 60 * 60 * 1000\n}`;',
		'const blockCommentValue = `${/* 24 * 60 * 60 * 1000 */ 5 * 60 * 1000}`;',
		'const braceCommentValue = `${/* } */ 7 * 24 * 60 * 60 * 1000}`;',
	].join('\n'))
	assertEquals(issues.length, 3)
	assertEquals(issues[0].token, '5 * 60 * 1000')
	assertEquals(issues[1].token, '5 * 60 * 1000')
	assertEquals(issues[2].token, '7 * 24 * 60 * 60 * 1000')
})

Deno.test('scanFileMsLiteral: ignores a commented multiplication expression inside interpolation', () => {
	const issues = scanFileMsLiteral('a.mjs', 'const a = `${/* 24 * 60 * 60 * 1000 */ 1}`;\n')
	assertEquals(issues.length, 0)
})

Deno.test('scanFileMsLiteral: closing brace right after a comment is not skipped', () => {
	const issues = scanFileMsLiteral('a.mjs', 'const templateValue = `${/* note */} 5 * 60 * 1000`;\n')
	assertEquals(issues.length, 0)
})

Deno.test('scanFileMsLiteral: still flags code across a masked comment boundary', () => {
	const issues = scanFileMsLiteral('a.mjs', 'const a = 5 * 60 * 1000; // 30 * 24 * 60 * 60 * 1000\n')
	assertEquals(issues.length, 1)
	assertEquals(issues[0].token, '5 * 60 * 1000')
})

Deno.test('isMsLiteralScanned: skips browser, tests, specs, and the ms helper', () => {
	assertEquals(isMsLiteralScanned('src/scripts/ms.mjs'), false)
	assertEquals(isMsLiteralScanned('src/scripts/checks/ms_literal.mjs'), false)
	assertEquals(isMsLiteralScanned('a/b.test.mjs'), false)
	assertEquals(isMsLiteralScanned('a/b.spec.js'), false)
	assertEquals(isMsLiteralScanned('a/b.test.ts'), false)
	assertEquals(isMsLiteralScanned('src/public/pages/service_worker.mjs'), false)
	assertEquals(isMsLiteralScanned('src/public/pages/scripts/features/embedCard.mjs'), false)
	assertEquals(isMsLiteralScanned('.github/pages/wait/install/index.mjs'), false)
	assertEquals(isMsLiteralScanned('src/public/parts/shells/chat/public/hub/hubStatus.mjs'), false)
	assertEquals(isMsLiteralScanned('src/public/parts/shells/chat/src/chat/lib/inviteTickets.mjs'), true)
	assertEquals(isMsLiteralScanned('src/public/parts/serviceGenerators/SpeechRecognition/shared/iflytekAuth.mjs'), true)
	assertEquals(isMsLiteralScanned('path/test/ensure_shellcheck.mjs'), true)
	assertEquals(isMsLiteralScanned('src/public/parts/shells/chat/public/src/trustAuthorDialog.mjs'), false)
	assertEquals(isMsLiteralScanned('src/public/parts/shells/userSettings/public/src/passwordConfirmationRequest.mjs'), false)
	assertEquals(isMsLiteralScanned('src/scripts/test/kernel/runtime.mjs'), true)
	assertEquals(isMsLiteralScanned('src/server/test/foo.mjs'), true)
})

Deno.test('repo: no hand-computed ms products in non-test source', async () => {
	const { issues } = await scanMsLiteral(REPO_ROOT)
	if (issues.length)
		assert(false, `源码存在手算毫秒乘积（应改用 ms('...')）(${issues.length}):\n${issues.slice(0, 12).map(issue => `${issue.path}:${issue.line} ${issue.token}`).join('\n')}`)
})
