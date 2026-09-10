/**
 * 工具块流式管线暴力测试（Deno 纯）：把「各种可能的工具输出 × 各种流式切帧」组合起来，
 * 经 file-operations 预览更新器程序化校验每帧 content_for_show，并做 diff 往返校验。
 * 渲染侧（show → HTML）由 test/frontend/toolStreamRender.spec.mjs 在真实浏览器里钉住；
 * 后端测试禁止安装 DOM shim（no_dom_shim 预载会当场爆炸）。
 */
/* global Deno */
import { assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert'

import { formatUpwardContext } from '../../../../plugins/file-operations/src/context_files.mjs'
import { applySlices } from '../../public/shared/streamSlices.mjs'
import { generateDiff } from '../../src/streaming/diff.mjs'
import { defineToolUseBlocks, renderMarkdownCodeBlock } from '../../src/streaming/index.mjs'

const fileOpsMain = (await import('../../../../plugins/file-operations/main.mjs')).default

// 与 SillyTavern Template 相同的链式组装：插件 updater 包裹 base（此处 base 为 noop）
const fileOpsUpdater = fileOpsMain.interfaces.chat.GetReplyPreviewUpdater(() => { })

const previewArgs = {
	supported_functions: { markdown: true, mathjax: true, html: true, unsafe_html: false, files: true, add_message: true, fount_i18nkeys: true, fount_assets: true, fount_themes: true },
	locales: ['zh-CN'],
	extension: {},
}

/**
 * 按行切帧。
 * @param {string} text 原文
 * @returns {string[]} 各帧增量
 */
const byLine = text => text.match(/[^\n]*\n|[^\n]+/g) || [text]
/**
 * 按小块（模拟 AI 源逐 token）切帧。
 * @param {string} text 原文
 * @returns {string[]} 各帧增量
 */
const bySmallChunks = text => text.match(/[\s\S]{1,7}/g) || [text]

/**
 * 模拟流式：按帧增长 content，跑更新器 + diff 往返校验。
 * @param {Function} updater 预览更新器（已实例化的 CharReplyPreviewUpdater_t）
 * @param {string} finalContent 最终 content
 * @param {(s: string) => string[]} slicer 切帧函数
 * @returns {Array<{ content: string, show: string }>} 各帧
 */
function streamFrames(updater, finalContent, slicer) {
	const frames = []
	const tracked = {}
	let last = { content: '', content_for_show: '', files: [] }
	for (const chunk of slicer(finalContent)) {
		const content = (frames.at(-1)?.content ?? '') + chunk
		const reply = { content }
		updater(previewArgs, reply)
		frames.push({ content, show: reply.content_for_show })
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
 * 统计 show 中行首围栏标记的出现次数（开+闭成对，2 即一个代码块）。
 * @param {string} show 展示文本
 * @returns {number} 围栏标记数
 */
function fenceMarkerCount(show) {
	return (show.match(/^`{3,}/gm) || []).length
}

/**
 * 不变量：末帧 show 不应残留原始工具标签（中间帧允许出现未配对的标签片段，
 * 安全档渲染会丢弃 raw HTML —— 该性质由前端逐帧真渲染断言覆盖）。
 * @param {Array<{ show: string }>} frames 各帧
 * @param {string[]} [labels] 额外断言的标签
 * @returns {void}
 */
function assertNoRawToolTags(frames, labels = ['<view-file', '<replace-file', '<override-file', '<list-machines']) {
	for (const [index, frame] of frames.entries())
		for (const label of labels)
			assertEquals(frame.show.includes(label), false, `frame ${index} 残留原始标签 ${label}`)
}

Deno.test('view-file 多路径合并为单个代码块，不再逐行成块', () => {
	const finalContent = `好的，我来看看这两个文件。

<view-file>
C:\\repo\\src\\server\\server.mjs
C:\\repo\\src\\public\\index.html
</view-file>`

	for (const slicer of [byLine, bySmallChunks]) {
		const frames = streamFrames(fileOpsUpdater, finalContent, slicer)
		assertNoRawToolTags([frames.at(-1)])
		const last = frames.at(-1)
		assertEquals(fenceMarkerCount(last.show), 2, `最终应只有 1 个代码块（slicer=${slicer.name}）`)
		assertMatch(last.show, /title="[^"]*2[^"]*"/, '标题应含路径数')
		assertStringIncludes(last.show, 'C:\\repo\\src\\server\\server.mjs\nC:\\repo\\src\\public\\index.html')
	}
})

Deno.test('view-file 单路径推断语言并保留路径', () => {
	const finalContent = `看一下入口。

<view-file>
src/foo.mjs
</view-file>`

	const frames = streamFrames(fileOpsUpdater, finalContent, byLine)
	assertNoRawToolTags([frames.at(-1)])
	const last = frames.at(-1)
	assertEquals(fenceMarkerCount(last.show), 2)
	assertStringIncludes(last.show, '```mjs')
	assertStringIncludes(last.show, 'src/foo.mjs')
})

Deno.test('view-file 多次调用每个调用各一个代码块', () => {
	const finalContent = `<view-file>
a.txt
</view-file>
然后：

<view-file>
b.md
c.md
</view-file>`

	const frames = streamFrames(fileOpsUpdater, finalContent, byLine)
	assertNoRawToolTags([frames.at(-1)])
	assertEquals(fenceMarkerCount(frames.at(-1).show), 4, '每个调用各一个代码块')
})

Deno.test('标签紧贴正文时块级渲染补全行边界，尾部内容不丢失', () => {
	const finalContent = `我来看看<view-file>
src/foo.mjs
</view-file>好的。`

	for (const slicer of [byLine, bySmallChunks]) {
		const frames = streamFrames(fileOpsUpdater, finalContent, slicer)
		assertNoRawToolTags([frames.at(-1)])
		const last = frames.at(-1)
		assertStringIncludes(last.show, '我来看看\n\n```', '工具块前应补空行')
		assertStringIncludes(last.show, '```\n\n好的。', '工具块后应补空行')
	}
})

Deno.test('replace-file / override-file 紧贴正文同样补全行边界', () => {
	const finalContent = '替换<replace-file><file path="a.txt"><replacement><search>x</search><replace>y</replace></replacement></file></replace-file>接着覆写<override-file path="b.txt">新内容</override-file>完成。'

	const frames = streamFrames(fileOpsUpdater, finalContent, bySmallChunks)
	assertNoRawToolTags([frames.at(-1)])
	const last = frames.at(-1)
	for (const part of ['替换', '接着覆写', '完成。', 'a.txt', 'b.txt', '新内容'])
		assertStringIncludes(last.show, part)
})

Deno.test('带属性的标签仍被预览替换', () => {
	const finalContent = `<view-file machine="1">
a.txt
</view-file>

<replace-file machine="1"><file path="b.txt"><replacement><search>x</search><replace>y</replace></replacement></file></replace-file>

<list-machines machine="1"></list-machines>`

	const frames = streamFrames(fileOpsUpdater, finalContent, byLine)
	assertNoRawToolTags([frames.at(-1)])
	const last = frames.at(-1)
	assertEquals(last.show.includes('<view-file machine'), false, '带属性的 view-file 也应被替换')
	assertEquals(last.show.includes('<replace-file machine'), false, '带属性的 replace-file 也应被替换')
})

Deno.test('list-machines 内联渲染不打断段落', () => {
	const finalContent = '看看<list-machines></list-machines>有哪些机器。'

	const frames = streamFrames(fileOpsUpdater, finalContent, bySmallChunks)
	assertNoRawToolTags([frames.at(-1)])
	assertStringIncludes(frames.at(-1).show, '看看`list-machines`有哪些机器。')
})

Deno.test('正文夹在围栏代码与工具调用之间时结构完整', () => {
	const finalContent = `示例：

\`\`\`js
console.log(1)
\`\`\`

<view-file>
a.txt
</view-file>

结束。`

	const frames = streamFrames(fileOpsUpdater, finalContent, bySmallChunks)
	assertNoRawToolTags([frames.at(-1)])
	const last = frames.at(-1)
	for (const part of ['示例：', 'console.log(1)', '结束。'])
		assertStringIncludes(last.show, part)
	assertEquals(fenceMarkerCount(last.show), 4, '示例围栏 + 工具块')
})

Deno.test('重新生成时预览整体重置不残留', () => {
	const toolState = `第一版<view-file>
a.txt
</view-file>`
	const regenState = '重新生成后的干净回复。'
	const reply1 = { content: toolState }
	fileOpsUpdater(previewArgs, reply1)
	assertStringIncludes(reply1.content_for_show, 'a.txt')
	const reply2 = { content: regenState }
	fileOpsUpdater(previewArgs, reply2)
	assertEquals(reply2.content_for_show, regenState)
})

Deno.test('工具日志围栏安全：内容含 ``` 时围栏自动加长', () => {
	const fileContent = '# 文档\n\n```js\nconst x = 1\n```\n\n正文。\n'
	const show = renderMarkdownCodeBlock(fileContent)
	const fence = show.match(/^`{3,}/m)?.[0]
	assertEquals(fence?.length >= 4, true, `围栏应长于内容中的反引号串: ${JSON.stringify(show)}`)
	assertEquals(show.startsWith(`${fence}\n`), true)
	assertEquals(show.endsWith(`\n${fence}`), true)
	assertStringIncludes(show, fileContent)
})

Deno.test('路径含反引号时围栏自动加长且内容不丢失', () => {
	const show = renderMarkdownCodeBlock('a`b`c```d', { title: 't' })
	const fence = show.match(/^`{3,}/m)?.[0]
	assertEquals(fence?.length >= 4, true, `围栏应长于内容中的反引号串: ${JSON.stringify(show)}`)
	assertStringIncludes(show, 'a`b`c```d')
})

Deno.test('向上上下文块也用安全围栏', () => {
	const agentsContent = '说明\n```js\nx()\n```\n'
	const text = formatUpwardContext({ agents: [{ path: 'AGENTS.md', content: agentsContent }], docs: [] })
	const fence = text.match(/^`{3,}/m)?.[0]
	assertEquals(fence?.length >= 4, true, `围栏应长于内容中的反引号串: ${JSON.stringify(text)}`)
})

Deno.test('未闭合标签的占位卡补全行边界且为块级 HTML', () => {
	const updater = defineToolUseBlocks([{ start: '<do-x>', end: '</do-x>' }])(() => { })
	const reply = { content: '我马上执行<do-x>' }
	updater(previewArgs, reply)
	// 占位卡是块级 HTML：可信作者渲染档（StreamRenderer 按 isTrustedMarkdownAuthor 升档）下才保留
	assertStringIncludes(reply.content_for_show, '我马上执行\n\n<div')
	assertStringIncludes(reply.content_for_show, 'tool-call-placeholder')
})
