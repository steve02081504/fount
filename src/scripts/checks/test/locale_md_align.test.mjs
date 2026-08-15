/**
 * locale markdown 行级结构对齐。
 */
/* global Deno */
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals, assert } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	compareLocaleMdFiles,
	countEmphasis,
	formatLocaleMdAlignIssue,
	mdLineShape,
	scanLocaleMdAlign,
	splitMdLines,
} from '../locale_md_align.mjs'

Deno.test('splitMdLines drops trailing newline only', () => {
	assertEquals(splitMdLines('a\nb\n'), ['a', 'b'])
	assertEquals(splitMdLines('a\nb'), ['a', 'b'])
	assertEquals(splitMdLines('a\r\nb\r\n'), ['a', 'b'])
})

Deno.test('countEmphasis: bold, italic, triple', () => {
	assertEquals(countEmphasis('**a** and **b**'), { bold: 2, italic: 0 })
	assertEquals(countEmphasis('void *ab initio* here'), { bold: 0, italic: 1 })
	assertEquals(countEmphasis('(*ab initio*)'), { bold: 0, italic: 1 })
	assertEquals(countEmphasis('***both***'), { bold: 1, italic: 1 })
})

Deno.test('mdLineShape: heading list hr quote links', () => {
	assertEquals(mdLineShape('## I. Definitions').heading, 2)
	assertEquals(mdLineShape('---').hr, 1)
	assertEquals(mdLineShape('* item').list, '*')
	assertEquals(mdLineShape('* **Title:** rest').bold, 1)
	assertEquals(mdLineShape('* **Title:** rest').list, '*')
	assertEquals(mdLineShape('see <https://example.com/a> and [x](https://example.com/b)').links, 2)
	assertEquals(mdLineShape('![alt](https://example.com/i.png)').images, 1)
	assertEquals(mdLineShape('> quote').quote, 1)
	assertEquals(mdLineShape('```js').fence, 1)
	assertEquals(mdLineShape('use `PIPL` here').codes, 1)
})

Deno.test('compareLocaleMdFiles: line count and per-line fields', () => {
	const reference = {
		locale: 'en-UK',
		path: 'EULA.en-UK.md',
		lines: ['# T', '', '**bold** and *i*', '* item'],
	}
	const ok = {
		locale: 'zh-CN',
		path: 'EULA.zh-CN.md',
		lines: ['# 标', '', '**粗** 与 *斜*', '* 项'],
	}
	assertEquals(compareLocaleMdFiles([reference, ok]), [])

	const short = { locale: 'ja-JP', path: 'EULA.ja-JP.md', lines: ['# T'] }
	assertEquals(compareLocaleMdFiles([reference, short])[0].field, 'lines')

	const italicMiss = {
		locale: 'de-DE',
		path: 'EULA.de-DE.md',
		lines: ['# T', '', '**bold** and i', '* item'],
	}
	const issues = compareLocaleMdFiles([reference, italicMiss])
	assertEquals(issues.length, 1)
	assertEquals(issues[0].field, 'italic')
	assertEquals(issues[0].line, 3)
})

Deno.test('formatLocaleMdAlignIssue', () => {
	assertEquals(
		formatLocaleMdAlignIssue({
			dir: 'docs/EULA',
			stem: 'EULA',
			file: 'docs/EULA/EULA.zh-CN.md',
			reference: 'docs/EULA/EULA.en-UK.md',
			field: 'lines',
			expected: 170,
			actual: 169,
		}),
		'docs/EULA/EULA.zh-CN.md: 行数 169 ≠ docs/EULA/EULA.en-UK.md 170',
	)
})

Deno.test('scanLocaleMdAlign: temp family', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'locale-md-align-'))
	const family = join(dir, 'docs', 'EULA')
	await mkdir(family, { recursive: true })
	try {
		await writeFile(join(family, 'EULA.en-UK.md'), '# A\n\n**x**\n', 'utf8')
		await writeFile(join(family, 'EULA.zh-CN.md'), '# 甲\n\n**乙**\n', 'utf8')
		const { issues } = await scanLocaleMdAlign(dir)
		assertEquals(issues, [])
		await writeFile(join(family, 'EULA.zh-CN.md'), '# 甲\n\nx\n', 'utf8')
		const bad = await scanLocaleMdAlign(dir)
		assert(bad.issues.some(issue => issue.field === 'bold'))
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})

Deno.test('repo: docs/EULA locales share markdown shape', async () => {
	const { issues } = await scanLocaleMdAlign(REPO_ROOT)
	if (issues.length) {
		const sample = issues.slice(0, 24).map(formatLocaleMdAlignIssue).join('\n')
		assert(false, `locale md 不对齐 (${issues.length}):\n${sample}`)
	}
})
