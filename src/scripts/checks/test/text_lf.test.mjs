/**
 * 仓库 UTF-8 文本文件须使用 LF 换行。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	detectFinalNewline,
	detectLeadingLf,
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

Deno.test('detectFinalNewline', () => {
	assertEquals(detectFinalNewline(encoder.encode('a')), 'none')
	assertEquals(detectFinalNewline(encoder.encode('a\n')), 'single')
	assertEquals(detectFinalNewline(encoder.encode('a\n\n')), 'multiple')
	assertEquals(detectFinalNewline(encoder.encode('a\r\n')), 'single')
	assertEquals(detectFinalNewline(new Uint8Array([])), 'none')
})

Deno.test('detectLeadingLf', () => {
	assertEquals(detectLeadingLf(encoder.encode('\na')), true)
	assertEquals(detectLeadingLf(encoder.encode('\n\n')), true)
	assertEquals(detectLeadingLf(encoder.encode('a\n')), false)
	assertEquals(detectLeadingLf(new Uint8Array([])), false)
})

Deno.test('detectLeadingLf skips UTF-8 BOM', () => {
	const bom = new Uint8Array([0xef, 0xbb, 0xbf])
	assertEquals(detectLeadingLf(new Uint8Array([...bom, 10, ...encoder.encode('a')])), true)
	assertEquals(detectLeadingLf(new Uint8Array([...bom, ...encoder.encode('a')])), false)
})

Deno.test('scanFileTextLf: compliant files', () => {
	assertEquals(scanFileTextLf('ok.mjs', encoder.encode('a\nexport {}\n')), [])
	assertEquals(scanFileTextLf('empty.txt', new Uint8Array([])), [])
	assertEquals(scanFileTextLf('ok-bom.mjs', new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('a\nb\n')])), [])
})

Deno.test('scanFileTextLf: non-LF and boundary issues', () => {
	assertEquals(scanFileTextLf('bad.mjs', encoder.encode('export {}\r\n'))[0].kind, 'crlf')
	assertEquals(scanFileTextLf('no-final.mjs', encoder.encode('a\nb'))[0].kind, 'no-final-newline')
	assertEquals(scanFileTextLf('extra-final.mjs', encoder.encode('a\nb\n\n'))[0].kind, 'extra-final-newlines')
	assertEquals(scanFileTextLf('leading.mjs', encoder.encode('\nexport {}\n'))[0].kind, 'leading-newline')
	assertEquals(
		scanFileTextLf('leading-bom.mjs', new Uint8Array([0xef, 0xbb, 0xbf, 10, ...encoder.encode('export {}')]))
			.map(issue => issue.kind)
			.sort(),
		['leading-newline', 'no-final-newline'],
	)
})

Deno.test('scanFileTextLf: single-line svg must not end with LF; other files need exactly one', () => {
	assertEquals(scanFileTextLf('icon.svg', encoder.encode('<svg></svg>')), [])
	assertEquals(scanFileTextLf('icon.svg', encoder.encode('<svg></svg>\n'))[0].kind, 'unexpected-final-newline')
	assertEquals(scanFileTextLf('icon.svg', encoder.encode('<svg></svg>\n\n'))[0].kind, 'unexpected-final-newline')
	assertEquals(scanFileTextLf('multi.svg', encoder.encode('<svg>\n<g></g>\n')), [])
	assertEquals(scanFileTextLf('single.txt', encoder.encode('abc'))[0].kind, 'no-final-newline')
	assertEquals(scanFileTextLf('single.mjs', encoder.encode('export {}'))[0].kind, 'no-final-newline')
	assertEquals(scanFileTextLf('single.txt', encoder.encode('abc\n')), [])
	assertEquals(scanFileTextLf('single.txt', encoder.encode('abc\n\n'))[0].kind, 'extra-final-newlines')
	assertEquals(
		scanFileTextLf('icon.svg', encoder.encode('<svg></svg>\n<g></g>'))[0].kind,
		'no-final-newline',
	)
	assertEquals(scanFileTextLf('multi.mjs', encoder.encode('a\nb'))[0].kind, 'no-final-newline')
	assertEquals(scanFileTextLf('multi.mjs', encoder.encode('a\nb\n')), [])
	assertEquals(scanFileTextLf('multi.mjs', encoder.encode('a\nb\n\n'))[0].kind, 'extra-final-newlines')
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

Deno.test('repo: UTF-8 text files use LF, correct final LF, no leading LF', async () => {
	const { issues } = await scanTextLf(REPO_ROOT, { triggeredFiles: [] })
	if (issues.length) {
		const sample = issues.slice(0, 12).map(issue => `${issue.path} (${issue.kind})`).join('\n')
		assert(false, `文本文件须使用 LF 换行、结尾 LF 符合规则且开头不为 LF (${issues.length}):\n${sample}`)
	}
})
