/**
 * 仓库 JSON 文件须使用 LF 换行。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	detectNonLfLineEndings,
	resolveJsonLfScanPaths,
	scanFileJsonLf,
	scanJsonLf,
} from '../json_lf.mjs'

const encoder = new TextEncoder()

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

Deno.test('scanFileJsonLf', () => {
	assertEquals(scanFileJsonLf('ok.json', encoder.encode('{}')), null)
	assertEquals(scanFileJsonLf('bad.json', encoder.encode('{}\r\n'))?.kind, 'crlf')
})

Deno.test('resolveJsonLfScanPaths scopes to triggered .json files', async () => {
	assertEquals(
		await resolveJsonLfScanPaths(REPO_ROOT, {
			triggeredFiles: [
				'src/public/locales/en-UK.json',
				'src/scripts/checks/json_lf.mjs',
				'src/public/locales/zh-CN.json',
			],
		}),
		['src/public/locales/en-UK.json', 'src/public/locales/zh-CN.json'],
	)
})

Deno.test('resolveJsonLfScanPaths normalizes Windows separators before under filter', async () => {
	assertEquals(
		await resolveJsonLfScanPaths(REPO_ROOT, {
			under: 'src/public/locales',
			triggeredFiles: [
				'src\\public\\locales\\en-UK.json',
				'src\\scripts\\checks\\json_lf.mjs',
				'src\\public\\locales\\zh-CN.json',
			],
		}),
		['src/public/locales/en-UK.json', 'src/public/locales/zh-CN.json'],
	)
})

Deno.test('resolveJsonLfScanPaths falls back to full scan when triggered has no json', async () => {
	const paths = await resolveJsonLfScanPaths(REPO_ROOT, {
		triggeredFiles: ['src/scripts/checks/json_lf.mjs'],
	})
	assert(paths.some(path => path.endsWith('.json')), 'full scan must include json files')
	assert(paths.length > 1)
})

Deno.test('repo: JSON files use LF line endings', async () => {
	const { issues } = await scanJsonLf(REPO_ROOT, { triggeredFiles: [] })
	if (issues.length) {
		const sample = issues.slice(0, 12).map(issue => `${issue.path} (${issue.kind})`).join('\n')
		assert(false, `JSON 须使用 LF 换行 (${issues.length}):\n${sample}`)
	}
})
