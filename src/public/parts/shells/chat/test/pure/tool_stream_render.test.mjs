/**
 * 工具块流式渲染暴力测试：把「各种可能的工具输出 × 各种流式切帧」组合起来，
 * 经 file-operations 预览更新器 + 客户端 StreamRenderer 同款管线（围栏补全 + 安全档 markdown），
 * 程序化校验每帧应有的渲染结果。
 */
/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { installMarkdownTestDom } from './markdown_test_dom.mjs'

installMarkdownTestDom()

const { GetMarkdownConvertor } = await import('../../../../../pages/scripts/features/markdown/convertor.mjs')
const { ensureClosedTrailingCodeFence } = await import('../../../../../pages/scripts/features/markdown/codeFence.mjs')
const { renderMarkdownCodeBlock, defineToolUseBlocks } = await import('../../src/streaming/index.mjs')
const { generateDiff } = await import('../../src/streaming/diff.mjs')
const { applySlices } = await import('../../public/src/streamSlices.mjs')
const { formatUpwardContext } = await import('../../../../plugins/file-operations/src/context_files.mjs')

const fileOpsMain = (await import('../../../../plugins/file-operations/main.mjs')).default

// 与 SillyTavern Template 相同的链式组装：插件 updater 包裹 base（此处 base 为 noop）
const fileOpsUpdater = fileOpsMain.interfaces.chat.GetReplyPreviewUpdater(() => { })

const args = {
	supported_functions: { markdown: true, mathjax: true, html: true, unsafe_html: false, files: true, add_message: true, fount_i18nkeys: true, fount_assets: true, fount_themes: true },
	locales: ['zh-CN'],
	extension: {},
}

const processor = await GetMarkdownConvertor({ allowDangerousHtml: false, isStandalone: true })
const trustedProcessor = await GetMarkdownConvertor({ allowDangerousHtml: true, isStandalone: true })

/**
 * @param {string} text markdown
 * @param {{ trusted?: boolean }} [options] trusted = 可信作者同款渲染档
 * @returns {Promise<string>} html
 */
async function render(text, { trusted = false } = {}) {
	return String(await (trusted ? trustedProcessor : processor).process(ensureClosedTrailingCodeFence(text)))
}

/**
 * 提取 HTML 可见文本。
 * @param {string} html 渲染结果
 * @returns {string} 可见文本
 */
function textOf(html) {
	const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
	return doc.getElementById('root').textContent
}

/**
 * @param {string} html 渲染结果
 * @returns {number} figure（titled 代码块）数量
 */
function figureCount(html) {
	const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
	return doc.getElementById('root').querySelectorAll('figure').length
}

/**
 * @param {string} html 渲染结果
 * @returns {{ title: string, code: string }[]} 各 figure 的标题与代码正文
 */
function figureParts(html) {
	const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
	return [...doc.getElementById('root').querySelectorAll('figure')].map(figure => ({
		title: figure.querySelector('figcaption')?.textContent ?? '',
		code: figure.querySelector('code')?.textContent ?? '',
	}))
}

/**
 * 按行切帧。
 * @param {string} s 原文
 * @returns {string[]} 各帧增量
 */
const byLine = s => s.match(/[^\n]*\n|[^\n]+/g) || [s]
/**
 * 按小块（模拟 AI 源逐 token）切帧。
 * @param {string} s 原文
 * @returns {string[]} 各帧增量
 */
const bySmallChunks = s => s.match(/[\s\S]{1,7}/g) || [s]

/**
 * 模拟流式：按帧增长 content，跑更新器 + 渲染 + diff 往返校验。
 * @param {Function} updater 预览更新器（已实例化的 CharReplyPreviewUpdater_t）
 * @param {string} finalContent 最终 content
 * @param {(s: string) => string[]} slicer 切帧函数
 * @returns {Promise<Array<{ content: string, show: string, html: string }>>} 各帧
 */
async function streamFrames(updater, finalContent, slicer) {
	const chunks = slicer(finalContent)
	const frames = []
	const tracked = {}
	let last = { content: '', content_for_show: '', files: [] }
	for (const chunk of chunks) {
		const content = (frames.at(-1)?.content ?? '') + chunk
		const reply = { content }
		updater(args, reply)
		const html = await render(reply.content_for_show)
		frames.push({ content, show: reply.content_for_show, html })
		// diff 往返：客户端按 slices 重建应与直算快照逐字节一致
		const snapshot = { content: reply.content ?? '', content_for_show: reply.content_for_show ?? '', files: reply.files ?? [] }
		applySlices(tracked, generateDiff(last, snapshot))
		assertEquals(tracked.content_for_show, snapshot.content_for_show, `frame ${frames.length - 1} diff 往返 content_for_show 不一致`)
		assertEquals(tracked.content, snapshot.content, `frame ${frames.length - 1} diff 往返 content 不一致`)
		last = structuredClone(snapshot)
	}
	return frames
}

/**
 * 通用不变量：任何帧都不应残留原始工具标签。
 * @param {Array<{ html: string }>} frames 各帧
 * @param {string[]} [labels] 额外断言的标签
 * @returns {void}
 */
function assertNoRawToolTags(frames, labels = ['<view-file', '<replace-file', '<override-file', '<list-machines']) {
	for (const [i, frame] of frames.entries())
		for (const label of labels)
			assertEquals(frame.html.includes(label), false, `frame ${i} 残留原始标签 ${label}`)
}

Deno.test('view-file 多路径合并为单个代码块，不再逐行成块', async () => {
	const finalContent = `好的，我来看看这两个文件。

<view-file>
C:\\repo\\src\\server\\server.mjs
C:\\repo\\src\\public\\index.html
</view-file>`

	for (const slicer of [byLine, bySmallChunks]) {
		const frames = await streamFrames(fileOpsUpdater, finalContent, slicer)
		assertNoRawToolTags(frames)
		const last = frames.at(-1)
		assertEquals(figureCount(last.html), 1, `最终应只有 1 个代码块（slicer=${slicer.name}）`)
		const [{ title, code }] = figureParts(last.html)
		assertStringIncludes(title, '2', '标题应含路径数')
		assertEquals(code, 'C:\\repo\\src\\server\\server.mjs\nC:\\repo\\src\\public\\index.html', '正文应为路径列表')
		// 逐帧：已流出的正文（第一个标签字符之前的部分）不得丢失
		for (const frame of frames) {
			const tagIndex = frame.content.indexOf('<')
			const prefix = (tagIndex === -1 ? frame.content : frame.content.slice(0, tagIndex)).trimEnd()
			if (!prefix) continue
			assertStringIncludes(textOf(frame.html), prefix)
		}
	}
})

Deno.test('view-file 单路径推断语言并保留路径', async () => {
	const finalContent = `看一下入口。

<view-file>
src/foo.mjs
</view-file>`

	const frames = await streamFrames(fileOpsUpdater, finalContent, byLine)
	assertNoRawToolTags(frames)
	const last = frames.at(-1)
	assertEquals(figureCount(last.html), 1)
	const doc = new DOMParser().parseFromString(last.html, 'text/html')
	assertStringIncludes(doc.querySelector('figcaption').textContent, 'foo.mjs')
	assertEquals(doc.querySelector('pre')?.getAttribute('data-language'), 'mjs')
	assertEquals(doc.querySelector('code').textContent, 'src/foo.mjs')
})

Deno.test('view-file 多次调用每个调用各一个代码块', async () => {
	const finalContent = `<view-file>
a.txt
</view-file>
然后：

<view-file>
b.md
c.md
</view-file>`

	const frames = await streamFrames(fileOpsUpdater, finalContent, byLine)
	assertNoRawToolTags(frames)
	const last = frames.at(-1)
	assertEquals(figureCount(last.html), 2)
	const parts = figureParts(last.html)
	assertStringIncludes(parts[0].code, 'a.txt')
	assertStringIncludes(parts[1].code, 'b.md\nc.md')
})

Deno.test('标签紧贴正文时块级渲染补全行边界，尾部内容不丢失', async () => {
	const finalContent = `我来看看<view-file>
src/foo.mjs
</view-file>好的。`

	for (const slicer of [byLine, bySmallChunks]) {
		const frames = await streamFrames(fileOpsUpdater, finalContent, slicer)
		assertNoRawToolTags(frames)
		const last = frames.at(-1)
		assertStringIncludes(last.show, '我来看看\n\n```', '工具块前应补空行')
		assertStringIncludes(last.show, '```\n\n好的。', '工具块后应补空行')
		const text = textOf(last.html)
		assertStringIncludes(text, '我来看看')
		assertStringIncludes(text, '好的。', '尾随正文不得被围栏修补吞掉')
		assertStringIncludes(text, 'src/foo.mjs')
		assertEquals(figureCount(last.html), 1)
	}
})

Deno.test('replace-file / override-file 紧贴正文同样补全行边界', async () => {
	const finalContent = '替换<replace-file><file path="a.txt"><replacement><search>x</search><replace>y</replace></replacement></file></replace-file>接着覆写<override-file path="b.txt">新内容</override-file>完成。'

	const frames = await streamFrames(fileOpsUpdater, finalContent, bySmallChunks)
	assertNoRawToolTags(frames)
	const text = textOf(frames.at(-1).html)
	for (const part of ['替换', '接着覆写', '完成。', 'a.txt', 'b.txt', '新内容'])
		assertStringIncludes(text, part)
})

Deno.test('带属性的标签仍被预览替换', async () => {
	const finalContent = `<view-file machine="1">
a.txt
</view-file>

<replace-file machine="1"><file path="b.txt"><replacement><search>x</search><replace>y</replace></replacement></file></replace-file>

<list-machines machine="1"></list-machines>`

	const frames = await streamFrames(fileOpsUpdater, finalContent, byLine)
	assertNoRawToolTags(frames)
	const last = frames.at(-1)
	assertEquals(last.show.includes('<view-file machine'), false, '带属性的 view-file 也应被替换')
	assertEquals(last.show.includes('<replace-file machine'), false, '带属性的 replace-file 也应被替换')
	assertEquals(figureCount(last.html), 2)
})

Deno.test('list-machines 内联渲染不打断段落', async () => {
	const finalContent = '看看<list-machines></list-machines>有哪些机器。'

	const frames = await streamFrames(fileOpsUpdater, finalContent, bySmallChunks)
	assertNoRawToolTags(frames)
	const last = frames.at(-1)
	assertStringIncludes(last.show, '看看`list-machines`有哪些机器。')
	assertEquals(figureCount(last.html), 0)
	const text = textOf(last.html)
	assertStringIncludes(text, '看看')
	assertStringIncludes(text, '有哪些机器。')
})

Deno.test('正文夹在围栏代码与工具调用之间时结构完整', async () => {
	const finalContent = `示例：

\`\`\`js
console.log(1)
\`\`\`

<view-file>
a.txt
</view-file>

结束。`

	const frames = await streamFrames(fileOpsUpdater, finalContent, bySmallChunks)
	assertNoRawToolTags(frames)
	const last = frames.at(-1)
	const text = textOf(last.html)
	for (const part of ['示例：', 'console.log(1)', '结束。'])
		assertStringIncludes(text, part)
	assertEquals(figureCount(last.html), 2, '示例围栏 + 工具块')
})

Deno.test('重新生成时预览整体重置不残留', async () => {
	const toolState = `第一版<view-file>
a.txt
</view-file>`
	const regenState = '重新生成后的干净回复。'
	const reply1 = { content: toolState }
	fileOpsUpdater(args, reply1)
	const html1 = await render(reply1.content_for_show)
	assertEquals(figureCount(html1), 1)
	const reply2 = { content: regenState }
	fileOpsUpdater(args, reply2)
	const html2 = await render(reply2.content_for_show)
	assertEquals(figureCount(html2), 0)
	assertEquals(textOf(html2).trim(), regenState)
})

Deno.test('工具日志围栏安全：内容含 ``` 时不裂成多块', async () => {
	const fileContent = '# 文档\n\n```js\nconst x = 1\n```\n\n正文。\n'
	const html = await render(renderMarkdownCodeBlock(fileContent))
	const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
	assertEquals(doc.getElementById('root').querySelectorAll('pre').length, 1, '整份文件内容应为一个代码块')
	assertEquals(doc.querySelector('code').textContent.trimEnd(), fileContent.trimEnd())
})

Deno.test('路径含反引号时围栏自动加长', async () => {
	const html = await render(renderMarkdownCodeBlock('a`b`c```d', { title: 't' }))
	const doc = new DOMParser().parseFromString(html, 'text/html')
	assertEquals(doc.querySelector('code').textContent.trimEnd(), 'a`b`c```d')
})

Deno.test('向上上下文块也用安全围栏', () => {
	const agentsContent = '说明\n```js\nx()\n```\n'
	const text = formatUpwardContext({ agents: [{ path: 'AGENTS.md', content: agentsContent }], docs: [] })
	const fence = text.match(/^`{3,}/m)?.[0]
	assertEquals(fence?.length >= 4, true, `围栏应长于内容中的反引号串: ${JSON.stringify(text)}`)
})

Deno.test('未闭合标签的占位卡在行边界上完整渲染', async () => {
	const updater = defineToolUseBlocks([{ start: '<do-x>', end: '</do-x>' }])(() => { })
	const reply = { content: '我马上执行<do-x>' }
	updater(args, reply)
	// 占位卡是块级 HTML：可信作者渲染档（StreamRenderer 按 isTrustedMarkdownAuthor 升档）下才保留
	const html = await render(reply.content_for_show, { trusted: true })
	const doc = new DOMParser().parseFromString(html, 'text/html')
	assertEquals(doc.querySelectorAll('.tool-call-placeholder').length, 1)
	assertStringIncludes(textOf(html), '我马上执行')
})
