/**
 * reasoning `<details>` 块与正文拼接后的 Markdown 渲染（前端实跑）：
 * CommonMark raw HTML 块直到空行才结束，`</details>` 后无空行会把整段正文
 * 吞进 HTML 块，`**bold**` 原样输出（甚至未信任档整条变空）。
 * buildReasoningDetailsMarkdown 自身（Deno 纯）由 AI proxy 的 pure 测试钉住；此处钉「拼接结果 → 渲染」。
 */
import { expect, test } from './fixtures.mjs'

const SECURE = { allowDangerousHtml: false }
const TRUSTED = { allowDangerousHtml: true }

/**
 * 镜像 buildReasoningDetailsMarkdown 的产物形态（details 块 + 末尾两连换行）。
 * @param {string} body 正文
 * @returns {string} 拼接好的展示文本
 */
function reasoningJoined(body) {
	return '<details class="fount-reasoning-details collapse collapse-arrow my-2 mb-3 rounded-box border border-base-content/20 bg-base-200/30">\n\n'
		+ '<summary class="fount-reasoning-summary collapse-title min-h-0 py-2 text-sm font-semibold opacity-80 select-none"><span>推理</span></summary>\n\n'
		+ '<div class="collapse-content">\n\n'
		+ 'x\n\n'
		+ '</div>\n\n</details>\n\n'
		+ body
}

/**
 * 在模块逻辑页里渲染 markdown。
 * @param {import('fount/scripts/test/playwright/module_page.mjs').ModulePage} modulePage 模块逻辑页
 * @param {string} markdown 原文
 * @param {{ allowDangerousHtml?: boolean }} [options] 信任档
 * @returns {Promise<string>} HTML
 */
async function renderMarkdown(modulePage, markdown, options = SECURE) {
	return modulePage.run(async arg => {
		const md = await import('/scripts/features/markdown/index.mjs')
		return md.renderMarkdownAsString(arg.markdown, undefined, { allowDangerousHtml: arg.options.allowDangerousHtml, isStandalone: true })
	}, { markdown, options })
}

test.describe('reasoning render', () => {
	test.describe.configure({ timeout: 600_000 })

	test('reasoning block + body via string addition renders markdown bold (trusted)', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, reasoningJoined('你好，**fount前端**卡??'), TRUSTED)
		expect(html).toContain('<strong>fount前端</strong>')
		expect(html).not.toContain('**fount前端**')
		expect(html).toContain('<details')
	})

	test('reasoning block + body via string addition renders markdown bold (untrusted), details stripped', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, reasoningJoined('你好，**fount前端**卡??'))
		expect(html).toContain('<strong>fount前端</strong>')
		expect(html).not.toContain('**fount前端**')
		expect(html).not.toContain('<details')
	})

	test('no-blank-line join keeps raw asterisks (the bug blank line fixes)', async ({ modulePage }) => {
		// `</details>` 后无空行时，正文被吞进 raw HTML 块
		const html = await renderMarkdown(modulePage,
			'<details class="fount-reasoning-details collapse"><summary>推理</summary></details>\n你好，**fount前端**卡??', TRUSTED)
		expect(html).toContain('**fount前端**')
	})
})
