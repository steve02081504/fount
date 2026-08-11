/**
 * 仓库 UTF-8 文本文件须使用 LF 换行。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	detectNonLfLineEndings,
	isUtf8Text,
	resolveTextLfScanPaths,
	scanFileTextLf,
	scanTextLf,
	TEXT_LF_OWN_PATHS,
} from '../text_lf.mjs'

const encoder = new TextEncoder()

Deno.test('isUtf8Text: accepts plain UTF-8', () => {
	assert(isUtf8Text(encoder.encode('hello\n中文')))
})

Deno.test('isUtf8Text: rejects NUL and invalid UTF-8', () => {
	assertEquals(isUtf8Text(new Uint8Array([0x61, 0x00, 0x62])), false)
	assertEquals(isUtf8Text(new Uint8Array([0xff, 0xfe])), false)
})

Deno.test('detectNonLfLineEndings: LF only', () => {
	assertEquals(detectNonLfLineEndings(encoder.encode('{\n"a": 1\n}')), null)
})

Deno.test('detectNonLfLineEndings: CRLF', () => {
	assertEquals(detectNonLfLineEndings(encoder.encode('{\r\n"a": 1\r\n}')), 'crlf')
})

Deno.test('detectNonLfLineEndings: lone CR', () => {
	assertEquals(detectNonLfLineEndings(encoder.encode('{\r"a": 1\r}')), 'cr')
})

Deno.test('detectNonLfLineEndings: mixed', () => {
	assertEquals(detectNonLfLineEndings(encoder.encode('{\r\n"a": 1\r}')), 'mixed')
})

Deno.test('scanFileTextLf', () => {
	assertEquals(scanFileTextLf('ok.mjs', encoder.encode('export {}\n')), null)
	assertEquals(scanFileTextLf('bad.mjs', encoder.encode('export {}\r\n'))?.kind, 'crlf')
})

Deno.test('resolveTextLfScanPaths scopes to triggered non-own files', async () => {
	assertEquals(
		await resolveTextLfScanPaths(REPO_ROOT, {
			triggeredFiles: [
				'src/public/locales/en-UK.json',
				...TEXT_LF_OWN_PATHS,
				'src/public/locales/zh-CN.json',
			],
		}),
		['src/public/locales/en-UK.json', 'src/public/locales/zh-CN.json'],
	)
})

Deno.test('resolveTextLfScanPaths normalizes Windows separators before under filter', async () => {
	assertEquals(
		await resolveTextLfScanPaths(REPO_ROOT, {
			under: 'src/public/locales',
			triggeredFiles: [
				'src\\public\\locales\\en-UK.json',
				'src\\scripts\\checks\\text_lf.mjs',
				'src\\public\\locales\\zh-CN.json',
			],
		}),
		['src/public/locales/en-UK.json', 'src/public/locales/zh-CN.json'],
	)
})

Deno.test('resolveTextLfScanPaths falls back to full scan when triggered is own-only', async () => {
	const paths = await resolveTextLfScanPaths(REPO_ROOT, {
		triggeredFiles: [...TEXT_LF_OWN_PATHS],
	})
	assert(paths.some(path => path.endsWith('.json')), 'full scan must include json files')
	assert(paths.some(path => path.endsWith('.mjs')), 'full scan must include mjs files')
	assert(paths.length > TEXT_LF_OWN_PATHS.length)
})

Deno.test('repo: UTF-8 text files use LF line endings', async () => {
	const { issues } = await scanTextLf(REPO_ROOT, { triggeredFiles: [] })
	if (issues.length) {
		const sample = issues.slice(0, 12).map(issue => `${issue.path} (${issue.kind})`).join('\n')
		assert(false, `文本文件须使用 LF 换行 (${issues.length}):\n${sample}`)
	}
})
