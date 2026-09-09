/**
 * 工具块流式渲染（前端实跑）：以 file-operations 预览更新器产出的 content_for_show 形态为输入，
 * 驱动客户端 StreamRenderer 同款管线（围栏补全 + 安全/可信档 markdown），按帧断言最终 DOM。
 * 更新器侧（Deno 纯）语义由 test/pure/tool_stream_pipeline.test.mjs 钉住；本文件只钉「show → 渲染」。
 * 浏览器模块必须在浏览器里测（modulePage），断言回 Node 侧。
 */
import { expect, test } from './fixtures.mjs'

/**
 * 按行切帧（与 pure 侧同款）。
 * @param {string} text 原文
 * @returns {string[]} 各帧增量
 */
const byLine = text => text.match(/[^\n]*\n|[^\n]+/g) || [text]
/**
 * 按小块切帧（模拟 AI 源逐 token）。
 * @param {string} text 原文
 * @returns {string[]} 各帧增量
 */
const bySmallChunks = text => text.match(/[\s\S]{1,7}/g) || [text]
/**
 * 增量 → 各帧累积全文（StreamRenderer.setTarget 接收绝对目标）。
 * @param {string[]} chunks 各帧增量
 * @returns {string[]} 各帧累积全文
 */
const accumulate = chunks => chunks.reduce((frames, chunk) => [...frames, (frames.at(-1) ?? '') + chunk], [])

/**
 * 在模块逻辑页里创建客户端 StreamRenderer（detached 容器），逐帧喂入**累积全文**并收集每帧渲染。
 * @param {import('fount/scripts/test/playwright/module_page.mjs').ModulePage} modulePage 模块逻辑页
 * @param {string[]} frames 各帧累积全文（即每帧的 content_for_show 快照）
 * @param {{ trusted?: boolean }} [options] 可信作者渲染档
 * @returns {Promise<Array<{ html: string, text: string, show: string }>>} 各帧渲染结果
 */
async function streamShow(modulePage, frames, { trusted = false } = {}) {
	return modulePage.run(async arg => {
		const { StreamRenderer } = await import('/parts/shells:chat/src/ui/StreamRenderer.mjs')
		const body = document.createElement('div')
		const renderer = new StreamRenderer(body, { allowDangerousHtml: arg.trusted })
		const framesOut = []
		for (const show of arg.frames) {
			renderer.setTarget(show)
			await renderer.finish()
			framesOut.push({ show, html: body.innerHTML, text: body.textContent })
		}
		return framesOut
	}, { frames, trusted })
}

/**
 * 解析渲染 HTML 里的 titled 代码块 figure（标题与代码正文）。
 * @param {import('fount/scripts/test/playwright/module_page.mjs').ModulePage} modulePage 模块逻辑页
 * @param {string} html 渲染结果
 * @returns {Promise<Array<{ title: string, code: string }>>} 各 figure 的标题与代码
 */
async function figureParts(modulePage, html) {
	return modulePage.run(async arg => {
		const parsedDocument = new DOMParser().parseFromString(`<div id="root">${arg.html}</div>`, 'text/html')
		return [...parsedDocument.querySelectorAll('figure')].map(figure => ({
			title: figure.querySelector('figcaption')?.textContent ?? '',
			code: figure.querySelector('code')?.textContent ?? '',
		}))
	}, { html })
}

/**
 * 通用不变量：任何帧都不应残留原始工具标签。
 * @param {Array<{ html: string }>} frames 各帧渲染结果
 * @returns {void}
 */
function expectNoRawToolTags(frames) {
	for (const [index, frame] of frames.entries())
		for (const label of ['<view-file', '<replace-file', '<override-file', '<list-machines'])
			expect(frame.html.includes(label), `frame ${index} 残留原始标签 ${label}`).toBe(false)
}

test.describe('tool stream render', () => {
	test.describe.configure({ timeout: 600_000 })

	test('view-file 多路径合并为单个代码块，不再逐行成块', async ({ modulePage }) => {
		const show = '好的，我来看看这两个文件。\n\n```text title="正在读取2个文件"\nC:\\repo\\src\\server\\server.mjs\nC:\\repo\\src\\public\\index.html\n```'
		for (const slicer of [byLine, bySmallChunks]) {
			const chunks = slicer(show)
			const frames = await streamShow(modulePage, accumulate(chunks))
			expectNoRawToolTags(frames)
			const parts = await figureParts(modulePage, frames.at(-1).html)
			expect(parts).toHaveLength(1)
			expect(parts[0].title).toContain('2')
			expect(parts[0].code).toBe('C:\\repo\\src\\server\\server.mjs\nC:\\repo\\src\\public\\index.html')
			// 逐帧：已流出的正文不得丢失（镜像 pure 侧「首个工具标签前的正文」不变量；
			// fence/标题语法不进渲染文本，故只断言纯正文片段）
			for (const frame of frames)
				if (frame.show.includes('好的，我来看看这两个文件。'))
					expect(frame.text).toContain('好的，我来看看这两个文件。')
		}
	})

	test('view-file 单路径推断语言并保留路径', async ({ modulePage }) => {
		const show = '看一下入口。\n\n```mjs title="正在读取 src/foo.mjs"\nsrc/foo.mjs\n```'
		const frames = await streamShow(modulePage, accumulate(byLine(show)))
		expectNoRawToolTags(frames)
		const parsed = await modulePage.run(async arg => {
			const doc = new DOMParser().parseFromString(arg.html, 'text/html')
			return {
				figcaption: doc.querySelector('figcaption')?.textContent ?? '',
				language: doc.querySelector('pre')?.getAttribute('data-language'),
				code: doc.querySelector('code')?.textContent ?? '',
			}
		}, { html: frames.at(-1).html })
		expect(parsed.figcaption).toContain('foo.mjs')
		expect(parsed.language).toBe('mjs')
		expect(parsed.code).toBe('src/foo.mjs')
	})

	test('view-file 多次调用每个调用各一个代码块', async ({ modulePage }) => {
		const show = '```text title="正在读取1个文件"\na.txt\n```\n然后：\n\n```text title="正在读取2个文件"\nb.md\nc.md\n```'
		const frames = await streamShow(modulePage, accumulate(byLine(show)))
		expectNoRawToolTags(frames)
		const parts = await figureParts(modulePage, frames.at(-1).html)
		expect(parts).toHaveLength(2)
		expect(parts[0].code).toContain('a.txt')
		expect(parts[1].code).toBe('b.md\nc.md')
	})

	test('标签紧贴正文时块级渲染补全行边界，尾部内容不丢失', async ({ modulePage }) => {
		const show = '我来看看\n\n```mjs title="正在读取 src/foo.mjs"\nsrc/foo.mjs\n```\n\n好的。'
		for (const slicer of [byLine, bySmallChunks]) {
			const frames = await streamShow(modulePage, accumulate(slicer(show)))
			expectNoRawToolTags(frames)
			const last = frames.at(-1)
			expect(last.text).toContain('我来看看')
			expect(last.text).toContain('好的。')
			expect(last.text).toContain('src/foo.mjs')
			const parts = await figureParts(modulePage, last.html)
			expect(parts).toHaveLength(1)
		}
	})

	test('replace-file / override-file 紧贴正文同样补全行边界', async ({ modulePage }) => {
		const show = '替换\n\n```text title="a.txt"\n新内容\n```\n\n接着覆写\n\n```text title="b.txt"\n新内容\n```\n\n完成。'
		const frames = await streamShow(modulePage, accumulate(bySmallChunks(show)))
		expectNoRawToolTags(frames)
		for (const part of ['替换', '接着覆写', '完成。', 'a.txt', 'b.txt', '新内容'])
			expect(frames.at(-1).text).toContain(part)
	})

	test('正文夹在围栏代码与工具调用之间时结构完整', async ({ modulePage }) => {
		const show = '示例：\n\n```js\nconsole.log(1)\n```\n\n```text title="正在读取1个文件"\na.txt\n```\n\n结束。'
		const frames = await streamShow(modulePage, accumulate(bySmallChunks(show)))
		expectNoRawToolTags(frames)
		const last = frames.at(-1)
		for (const part of ['示例：', 'console.log(1)', '结束。'])
			expect(last.text).toContain(part)
		const parts = await figureParts(modulePage, last.html)
		expect(parts).toHaveLength(2)
	})

	test('重新生成时预览整体重置不残留', async ({ modulePage }) => {
		const frames = await streamShow(modulePage, [
			'第一版\n\n```text title="正在读取1个文件"\na.txt\n```',
			'重新生成后的干净回复。',
		])
		const parts = await figureParts(modulePage, frames[0].html)
		expect(parts).toHaveLength(1)
		expect(frames[1].text.trim()).toBe('重新生成后的干净回复。')
		const parts2 = await figureParts(modulePage, frames[1].html)
		expect(parts2).toHaveLength(0)
	})

	test('工具日志围栏安全：内容含 ``` 时不裂成多块', async ({ modulePage }) => {
		// renderMarkdownCodeBlock（Deno 侧）对含 ``` 内容自动加长围栏；此处镜像其产物形态
		const fileContent = '# 文档\n\n```js\nconst x = 1\n```\n\n正文。\n'
		const show = '````\n' + fileContent + '\n````'
		const frames = await streamShow(modulePage, [show])
		const check = await modulePage.run(async arg => {
			const doc = new DOMParser().parseFromString(`<div id="root">${arg.html}</div>`, 'text/html')
			return {
				preCount: doc.querySelectorAll('pre').length,
				code: doc.querySelector('code')?.textContent ?? '',
			}
		}, { html: frames.at(-1).html })
		// shiki 会给空行渲染出一个空格占位；按行去尾空白后比对
		/**
		 * 按行去尾空白并整体 trim。
		 * @param {string} text 代码文本
		 * @returns {string} 规整后的文本
		 */
		const normalize = text => text.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n').trim()
		expect(check.preCount).toBe(1)
		expect(normalize(check.code)).toBe(normalize(fileContent))
	})

	test('未闭合标签的占位卡在行边界上完整渲染（可信档）', async ({ modulePage }) => {
		// 镜像 defineToolUseBlocks renderToolCallingPlaceholder（html + fount_i18nkeys 关闭时的内联文案形态）
		const show = '我马上执行<div class="tool-call-placeholder card my-2 bg-base-100 text-sm shadow-xl">\n\t<div class="card-body">\n\t<span class="tool-call-placeholder-text">正在调用工具</span>\n\t</div>\n</div>\n'
		const frames = await streamShow(modulePage, [show], { trusted: true })
		const check = await modulePage.run(async arg => {
			const doc = new DOMParser().parseFromString(`<div id="root">${arg.html}</div>`, 'text/html')
			return {
				placeholders: doc.querySelectorAll('.tool-call-placeholder').length,
				text: doc.getElementById('root').textContent,
			}
		}, { html: frames.at(-1).html })
		expect(check.placeholders).toBe(1)
		expect(check.text).toContain('我马上执行')
	})

	test('list-machines 内联渲染不打断段落', async ({ modulePage }) => {
		const frames = await streamShow(modulePage, ['看看`list-machines`有哪些机器。'])
		expectNoRawToolTags(frames)
		const last = frames.at(-1)
		expect(last.text).toContain('看看')
		expect(last.text).toContain('有哪些机器。')
		const parts = await figureParts(modulePage, last.html)
		expect(parts).toHaveLength(0)
	})
})
