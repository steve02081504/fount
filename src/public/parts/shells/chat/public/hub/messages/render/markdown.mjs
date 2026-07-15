/**
 * 【文件】public/hub/messages/render/markdown.mjs
 * 【职责】Hub 消息区 Markdown 水合与可信作者策略。
 */
import { createDocumentFragmentFromHtmlStringNoScriptActivation } from '../../../../../../scripts/features/template.mjs'
import { buildMentionLabelMapFromHubState, expandMentionsInMarkdown } from '../../../shared/expandMentions.mjs'
import { getFountMessageMarkdownConvertor } from '../../../src/lib/fountMessageMarkdown.mjs'
import { isTrustedAuthor } from '../../../src/trustedAuthors.mjs'
import { mountMdRevealButton } from '../../../src/ui/mdRevealButton.mjs'
import { hubStore } from '../../core/state.mjs'

import { disposeEmbedGuard, wireBubbleOffscreenGuards } from './embed.mjs'

/** 未信任远端 Markdown 预览字数（与 mention inbox `textPreview` 对齐）。 */
const UNTRUSTED_REMOTE_PREVIEW_LEN = 120

/**
 * @param {string} text 原始正文
 * @param {number} maxLen 上限
 * @returns {string} 截断后正文（超长加省略号）
 */
function truncateTextPreview(text, maxLen) {
	const s = String(text || '')
	if (s.length <= maxLen) return s
	const cut = s.slice(0, maxLen)
	const lastSpace = cut.lastIndexOf(' ')
	const body = lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut
	return `${body}…`
}

/**
 * @param {HTMLElement} bubble 正文气泡
 * @param {string} markdown 已展开 @ 的 Markdown
 * @param {boolean} trusted 是否可信作者（决定 pipeline）
 * @returns {Promise<void>}
 */
async function applyMarkdownToBubble(bubble, markdown, trusted) {
	const processor = await getFountMessageMarkdownConvertor(trusted)
	const html = String(await processor.process({ value: markdown, data: { cache: {} } }))
	bubble.replaceChildren(await createDocumentFragmentFromHtmlStringNoScriptActivation(html))
}

/**
 * @param {HTMLElement} container 消息列表根
 * @param {string} messageId 消息 id
 * @param {HTMLElement} row 消息行
 * @param {HTMLElement} bubble 正文气泡
 * @returns {Promise<void>}
 */
async function hydrateOneMarkdown(container, messageId, row, bubble) {
	const raw = bubble.dataset.mdRaw || ''
	if (!raw.trim()) return

	const isRemote = row.hasAttribute('data-is-remote')
	const authorPubKeyHash = bubble.dataset.mdAuthor || ''
	const trusted = !isRemote || await isTrustedAuthor(String(authorPubKeyHash))
	const labelMap = buildMentionLabelMapFromHubState(hubStore.context.currentState, hubStore.viewer)

	try {
		if (trusted || bubble.dataset.mdRevealed === '1') {
			await applyMarkdownToBubble(bubble, expandMentionsInMarkdown(raw, labelMap), trusted)
			delete bubble.dataset.mdRaw
			bubble.dataset.mdHydrated = '1'
			bubble.dataset.mdPreview = '0'
			wireBubbleOffscreenGuards(bubble, trusted, () => {
				bubble.dataset.mdRevealed = '1'
				void hydrateMessageMarkdown(container, messageId)
			})
			return
		}

		const previewRaw = truncateTextPreview(raw, UNTRUSTED_REMOTE_PREVIEW_LEN)
		const canExpand = raw.length > UNTRUSTED_REMOTE_PREVIEW_LEN
		await applyMarkdownToBubble(bubble, expandMentionsInMarkdown(previewRaw, labelMap), false)
		bubble.dataset.mdHydrated = '1'
		bubble.dataset.mdPreview = canExpand ? '1' : '0'
		bubble.dataset.mdUntrusted = '1'

		if (canExpand)
			await mountMdRevealButton(bubble, () => {
				bubble.dataset.mdRevealed = '1'
				void hydrateMessageMarkdown(container, messageId)
			})

		wireBubbleOffscreenGuards(bubble, false, () => {
			bubble.dataset.mdRevealed = '1'
			void hydrateMessageMarkdown(container, messageId)
		})
	}
	catch { /* 保留 escape 占位 */ }
}

/**
 * §17：Hub 消息区 Markdown + 可信作者策略。
 * @param {HTMLElement} container 消息列表根
 * @param {string} [onlyMessageId] 仅重渲染指定消息
 * @returns {Promise<void>}
 */
export async function hydrateMessageMarkdown(container, onlyMessageId) {
	if (!(container instanceof HTMLElement)) return
	const rows = onlyMessageId
		? [...container.querySelectorAll(`[data-message-id="${onlyMessageId}"]`)]
		: [...container.querySelectorAll('.chat[data-message-id]')]
	for (const row of rows) {
		const messageId = row.getAttribute('data-message-id')
		if (!messageId) continue
		if (row.hasAttribute('data-streaming')) continue
		const bubble = row.querySelector('.hub-message-content, .chat-bubble.hub-message-content')
		if (!(bubble instanceof HTMLElement)) continue
		if (!bubble.dataset.mdRaw) continue
		if (onlyMessageId) {
			delete bubble.dataset.mdHydrated
			disposeEmbedGuard(bubble)
		}
		else if (bubble.dataset.mdHydrated === '1')
			continue

		await hydrateOneMarkdown(container, messageId, row, bubble)
	}
}
