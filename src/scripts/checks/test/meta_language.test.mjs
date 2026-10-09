/**
 * 仓库完整 HTML：og / description 必须是无中文的英文；`<title>` 非空时同样无中文，为空时由 i18n 提供标题并与 en-UK 的 `.description` 三方一致。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { assert, assertEquals } from 'https://deno.land/std/assert/mod.ts'
import { parseHTML } from 'npm:linkedom'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import { isFullHtmlDocument } from '../html_meta.mjs'
import {
	FORBIDDEN_META_SCRIPT,
	META_REFERENCE_LOCALE,
	hasForbiddenScript,
	inspectMetaLanguage,
	inspectMetaLanguageFromDocument,
	inspectPageMeta,
	resolveLocaleLeaf,
	resolvePageId,
} from '../meta_language.mjs'
import { listRepoFiles } from '../walk.mjs'

/** 参照 locale 数据（en-UK）。 */
const referenceLocaleData = JSON.parse(
	await readFile(join(REPO_ROOT, 'src/public/locales', `${META_REFERENCE_LOCALE}.json`), 'utf8'),
)

/**
 * 读取页面同目录的候选脚本源码，供 `initTranslations` 解析页面 id。
 * @param {string} relHtml 仓库相对 HTML 路径
 * @returns {Promise<string[]>} 脚本源码；不存在则为空数组
 */
async function siblingScripts(relHtml) {
	const dir = dirname(relHtml)
	/** @type {string[]} */
	const sources = []
	for (const name of ['index.mjs', 'base.mjs', 'main.mjs']) {
		try {
			sources.push(await readFile(join(REPO_ROOT, dir, name), 'utf8'))
		}
		catch {
			// 页面没有这个脚本，继续找下一个
		}
	}
	return sources
}

/** 构造完整文档 head，便于逐条规则断言。 */
const documentWith = head => `<!DOCTYPE html><html><head>${head}</head></html>`

Deno.test('FORBIDDEN_META_SCRIPT matches Han / kana / Cyrillic but not Latin', () => {
	assert(FORBIDDEN_META_SCRIPT.test('确认您的身份'))
	assert(FORBIDDEN_META_SCRIPT.test('こんにちは'))
	assert(FORBIDDEN_META_SCRIPT.test('Привет'))
	assertEquals(FORBIDDEN_META_SCRIPT.test('Where words take flight.'), false)
	assertEquals(FORBIDDEN_META_SCRIPT.test('A fountain in the terminal — fount'), false)
})

Deno.test('hasForbiddenScript tolerates empty and missing values', () => {
	assertEquals(hasForbiddenScript(''), false)
	assertEquals(hasForbiddenScript(undefined), false)
	assertEquals(hasForbiddenScript(null), false)
})

Deno.test('inspectMetaLanguage skips fragments and empty input', () => {
	assertEquals(inspectMetaLanguage('<div>fragment</div>').skipped, true)
	assertEquals(inspectMetaLanguage('').skipped, true)
})

Deno.test('resolveLocaleLeaf walks dotted keys', () => {
	const data = { gist: { title: 'Gist', description: 'Leaves' } }
	assertEquals(resolveLocaleLeaf(data, 'gist.description'), 'Leaves')
	assertEquals(resolveLocaleLeaf(data, 'gist.missing'), undefined)
	assertEquals(resolveLocaleLeaf(data, ''), undefined)
})

Deno.test('resolvePageId reads the title attribute first, then initTranslations', () => {
	const { document } = parseHTML('<html><head><title data-i18n="gist.title"></title></head></html>')
	const titleElement = document.querySelector('title')
	assertEquals(resolvePageId(titleElement, []), 'gist')
	assertEquals(resolvePageId(null, ["await initTranslations('installer_wait_screen')"]), 'installer_wait_screen')
	assertEquals(resolvePageId(null, []), '')
})

Deno.test('a non-empty title only has to be Chinese-free', () => {
	const shared = {
		pageId: '',
		htmlDescription: 'A quiet emblem that still breathes.',
		ogDescription: 'A quiet emblem that still breathes.',
		ogTitle: 'A Fountain in the Terminal',
		localeData: referenceLocaleData,
	}
	assertEquals(inspectPageMeta({ ...shared, title: 'preloadrunner' }), [])
	assertEquals(inspectPageMeta({ ...shared, title: '𝒻ℴ𝓊𝓃𝓉 𝓵𝓸𝓰𝓸' }), [])
	assert(inspectPageMeta({ ...shared, title: '确认您的身份' }).some(issue => issue.includes('充满诗意的英文')))
})

Deno.test('an empty title needs an i18n page id', () => {
	const page = {
		pageId: '',
		title: '',
		htmlDescription: 'Where words take flight.',
		ogDescription: 'Where words take flight.',
		ogTitle: 'The Stage of Whispers',
		localeData: referenceLocaleData,
	}
	const issues = inspectPageMeta(page)
	assertEquals(issues.length, 1)
	assert(issues[0].includes('i18n 提供标题'))
})

Deno.test('an empty title accepts a description that matches en-UK byte for byte', () => {
	const description = referenceLocaleData.gist.description
	const issues = inspectPageMeta({
		pageId: 'gist',
		title: '',
		htmlDescription: description,
		ogDescription: description,
		ogTitle: 'Gist: Markdown Docs in fount',
		localeData: referenceLocaleData,
	})
	assertEquals(issues, [])
})

Deno.test('an empty title reports a description drift against en-UK', () => {
	const issues = inspectPageMeta({
		pageId: 'gist',
		title: '',
		htmlDescription: 'A quiet library of Markdown leaves.',
		ogDescription: 'A quiet library of Markdown leaves.',
		ogTitle: 'Gist: Markdown Docs in fount',
		localeData: referenceLocaleData,
	})
	assertEquals(issues.length, 1)
	assert(issues[0].includes('gist.description'))
	assert(issues[0].includes('三者逐字相同'))
})

Deno.test('an empty title reports a page id whose description key is missing', () => {
	const issues = inspectPageMeta({
		pageId: 'not_a_page',
		title: '',
		htmlDescription: 'Nothing here.',
		ogDescription: 'Nothing here.',
		ogTitle: 'Nothing here',
		localeData: referenceLocaleData,
	})
	assertEquals(issues.length, 2)
	assert(issues.some(issue => issue.includes('缺少 not_a_page.description')))
	assert(issues.some(issue => issue.includes('缺少页面 id 的标题键 not_a_page.title')))
})

Deno.test('an empty title reports a page id whose title key is missing', () => {
	const issues = inspectPageMeta({
		pageId: 'gist',
		title: '',
		htmlDescription: referenceLocaleData.gist.description,
		ogDescription: referenceLocaleData.gist.description,
		ogTitle: 'Gist: Markdown Docs in fount',
		localeData: { gist: { description: referenceLocaleData.gist.description } },
	})
	assertEquals(issues.length, 1)
	assert(issues[0].includes('缺少页面 id 的标题键 gist.title'))
})

Deno.test('inspectMetaLanguageFromDocument returns no issues without a head', () => {
	const { document } = parseHTML('<html><body>no head</body></html>')
	assertEquals(inspectMetaLanguageFromDocument(document), [])
})

Deno.test('repo HTML meta is Chinese-free and empty titles agree with en-UK descriptions', async () => {
	const files = await listRepoFiles(REPO_ROOT, ['.html'])
	/** @type {string[]} */
	const failures = []
	let checked = 0
	for (const rel of files) {
		const content = await readFile(join(REPO_ROOT, rel), 'utf8')
		if (!isFullHtmlDocument(content)) continue
		checked++
		const result = inspectMetaLanguage(content, {
			scripts: await siblingScripts(rel),
			localeData: referenceLocaleData,
		})
		if (result.skipped || !result.issues.length) continue
		failures.push(`${rel}:\n  ${result.issues.join('\n  ')}`)
	}
	assert(checked > 0, '未找到任何完整 HTML 文档')
	assertEquals(failures, [], `以下 HTML 的 head 元数据不合格：\n${failures.join('\n')}`)
})
