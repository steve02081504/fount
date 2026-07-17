/**
 * 【文件】public/hub/messages/render/markdown.mjs
 * 【职责】Hub 消息区 Markdown 水合与可信作者策略。
 * 原文走内存 Map（勿塞进 data-md-raw 属性：正文常含 HTML 引号，属性转义一旦失手会撑破 DOM）。
 */
import { renderMarkdownAsString } from '../../../../../../scripts/features/markdown/index.mjs'
import { createDocumentFragmentFromHtmlStringNoScriptActivation } from '../../../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { geti18n } from '../../../../../../scripts/i18n/index.mjs'
import { buildMentionLabelMapFromHubState, expandMentionsInMarkdown } from '../../../shared/expandMentions.mjs'
import { isTrustedMarkdownAuthor } from '../../../src/trustedAuthors.mjs'
import { mountMdRevealButton } from '../../../src/ui/mdRevealButton.mjs'
import { resolveEntityHashForAuthorKey } from '../../core/domUtils.mjs'
import { hubStore } from '../../core/state.mjs'

import { disposeEmbedGuard, wireBubbleOffscreenGuards } from './embed.mjs'

/** 未信任远端 Markdown 预览字数（与 mention inbox `textPreview` 对齐）。 */
const UNTRUSTED_REMOTE_PREVIEW_LEN = 120

/**
 * messageId → 待水合原文（未信任预览阶段保留，完整水合后删除）。
 * @type {Map<string, { raw: string, authorPubKeyHash: string }>}
 */
const pendingMarkdownByMessageId = new Map()

/**
 * 注册待水合 Markdown（由消息行渲染时调用）。
 * @param {string} messageId 消息 eventId
 * @param {string} raw 原文
 * @param {string} [authorPubKeyHash] 作者公钥哈希
 * @returns {void}
 */
export function registerPendingMessageMarkdown(messageId, raw, authorPubKeyHash = '') {
	const id = String(messageId || '')
	if (!id) return
	pendingMarkdownByMessageId.set(id, {
		raw: String(raw || ''),
		authorPubKeyHash: String(authorPubKeyHash || ''),
	})
}

/**
 * 从当前群成员表解析作者声明的 ownerEntityHash。
 * @param {string} [authorKey] pubKeyHash / entityHash / charId
 * @returns {string | null} 所属主人 entityHash，无则 null
 */
function resolveAuthorOwnerEntityHash(authorKey) {
	const authorEntity = resolveEntityHashForAuthorKey(authorKey)
	const sender = String(authorKey || '').trim().toLowerCase()
	for (const member of hubStore.context.currentState?.members || []) {
		const memberEntity = String(member?.entityHash || '').trim().toLowerCase()
		const memberKey = String(member?.memberKey || member?.pubKeyHash || '').trim().toLowerCase()
		if ((authorEntity && memberEntity === authorEntity) || (sender && memberKey === sender)) {
			const owner = String(member?.ownerEntityHash || '').trim().toLowerCase()
			return owner || null
		}
	}
	return null
}

/**
 * @param {string} [authorPubKeyHash] 作者 hash
 * @param {boolean} [isRemote] 是否远端消息
 * @returns {Promise<boolean>} 是否走可信档
 */
async function isMessageMarkdownTrusted(authorPubKeyHash, isRemote) {
	if (!isRemote) return true
	return isTrustedMarkdownAuthor(authorPubKeyHash, {
		selfEntityHash: hubStore.viewer?.viewerEntityHash,
		nodeHash: hubStore.viewer?.nodeHash,
		authorOwnerEntityHash: resolveAuthorOwnerEntityHash(authorPubKeyHash),
	})
}

/**
 * 消息行首帧即渲染 Markdown，避免「escape 原文 → 异步水合」闪屏。
 * 未信任远端超长文仍只出预览，并登记 pending 供展开按钮挂载。
 * @param {string} messageId 消息 eventId
 * @param {string} markdown 原文
 * @param {{ isRemote?: boolean, authorPubKeyHash?: string }} [options] 信任判定
 * @returns {Promise<{ html: string, bubbleAttrs: string }>} 已渲染 HTML 与气泡属性
 */
export async function renderMessageMarkdownForPaint(messageId, markdown, {
	isRemote = false,
	authorPubKeyHash = '',
} = {}) {
	const raw = String(markdown || '')
	const author = String(authorPubKeyHash || '')
	const authorAttr = escapeHtml(author)
	const labelMap = buildMentionLabelMapFromHubState(hubStore.context.currentState, hubStore.viewer)
	const expanded = expandMentionsInMarkdown(raw, labelMap)
	const trusted = await isMessageMarkdownTrusted(author, isRemote)

	if (trusted) {
		const html = await renderMarkdownAsString(expanded, undefined, { allowDangerousHtml: true })
		return {
			html,
			bubbleAttrs: ` data-md-hydrated="1" data-md-preview="0" data-md-untrusted="0" data-md-author="${authorAttr}"`,
		}
	}

	const canExpand = visibleMarkdownLength(expanded) > UNTRUSTED_REMOTE_PREVIEW_LEN
	const previewMd = canExpand
		? truncateVisibleMarkdown(expanded, UNTRUSTED_REMOTE_PREVIEW_LEN)
		: expanded
	const html = await renderMarkdownAsString(previewMd, undefined, { allowDangerousHtml: false })
	if (canExpand) {
		// 首帧已是预览 HTML；保留 pending 供 hydrate 挂「展开」按钮（勿标 hydrated，否则会被跳过）
		registerPendingMessageMarkdown(messageId, raw, author)
		return {
			html,
			bubbleAttrs: ` data-md-pending="1" data-md-untrusted="1" data-md-author="${authorAttr}"`,
		}
	}
	return {
		html,
		bubbleAttrs: ` data-md-hydrated="1" data-md-preview="0" data-md-untrusted="1" data-md-author="${authorAttr}"`,
	}
}

/**
 * 可见预览长度：Markdown 链接只计 label，避免 mention URL 虚增字数。
 * @param {string} markdown 已展开 @ 的 Markdown
 * @returns {number} 近似可见字数
 */
function visibleMarkdownLength(markdown) {
	return String(markdown || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').length
}

/**
 * 按可见字数截断 Markdown（优先在空格处切开）。
 * @param {string} markdown 已展开 @ 的 Markdown
 * @param {number} maxLen 可见字数上限
 * @returns {string} 截断后的 Markdown
 */
function truncateVisibleMarkdown(markdown, maxLen) {
	const source = String(markdown || '')
	if (visibleMarkdownLength(source) <= maxLen) return source
	let visible = 0
	let index = 0
	while (index < source.length && visible < maxLen) {
		if (source[index] === '[') {
			const labelEnd = source.indexOf('](', index)
			const urlEnd = labelEnd >= 0 ? source.indexOf(')', labelEnd + 2) : -1
			if (labelEnd >= 0 && urlEnd >= 0) {
				const label = source.slice(index + 1, labelEnd)
				if (visible + label.length > maxLen) break
				visible += label.length
				index = urlEnd + 1
				continue
			}
		}
		visible += 1
		index += 1
	}
	const cut = source.slice(0, index)
	const lastSpace = cut.lastIndexOf(' ')
	const body = lastSpace > index * 0.6 ? cut.slice(0, lastSpace) : cut
	return `${body}…`
}

/**
 * @param {HTMLElement} bubble 正文气泡
 * @param {string} markdown 已展开 @ 的 Markdown
 * @param {boolean} trusted 是否可信作者（决定 pipeline）
 * @returns {Promise<void>}
 */
async function applyMarkdownToBubble(bubble, markdown, trusted) {
	const html = await renderMarkdownAsString(markdown, {}, { allowDangerousHtml: trusted })
	bubble.replaceChildren(await createDocumentFragmentFromHtmlStringNoScriptActivation(html))
}

/**
 * @param {HTMLElement} bubble 正文气泡
 * @returns {void}
 */
function showMarkdownHydrateFailure(bubble) {
	const label = geti18n('chat.hub.markdownRenderFailed') || 'Markdown render failed'
	bubble.replaceChildren()
	const notice = document.createElement('span')
	notice.className = 'opacity-60 text-sm'
	notice.dataset.i18n = 'chat.hub.markdownRenderFailed'
	notice.textContent = label
	bubble.appendChild(notice)
}

/**
 * @param {HTMLElement} container 消息列表根
 * @param {string} messageId 消息 id
 * @param {HTMLElement} row 消息行
 * @param {HTMLElement} bubble 正文气泡
 * @returns {Promise<void>}
 */
async function hydrateOneMarkdown(container, messageId, row, bubble) {
	const pending = pendingMarkdownByMessageId.get(messageId)
	const raw = (pending?.raw ?? bubble.dataset.mdRaw) || ''
	if (!raw.trim()) return

	const isRemote = row.hasAttribute('data-is-remote')
	const authorPubKeyHash = pending?.authorPubKeyHash || bubble.dataset.mdAuthor || ''
	const trusted = await isMessageMarkdownTrusted(authorPubKeyHash, isRemote)
	const labelMap = buildMentionLabelMapFromHubState(hubStore.context.currentState, hubStore.viewer)

	try {
		const expanded = expandMentionsInMarkdown(raw, labelMap)
		if (trusted || bubble.dataset.mdRevealed === '1') {
			await applyMarkdownToBubble(bubble, expanded, trusted)
			pendingMarkdownByMessageId.delete(messageId)
			delete bubble.dataset.mdRaw
			delete bubble.dataset.mdPending
			bubble.dataset.mdHydrated = '1'
			bubble.dataset.mdPreview = '0'
			wireBubbleOffscreenGuards(bubble, trusted, () => {
				bubble.dataset.mdRevealed = '1'
				void hydrateMessageMarkdown(container, messageId)
			})
			return
		}

		const canExpand = visibleMarkdownLength(expanded) > UNTRUSTED_REMOTE_PREVIEW_LEN
		await applyMarkdownToBubble(bubble, truncateVisibleMarkdown(expanded, UNTRUSTED_REMOTE_PREVIEW_LEN), false)
		bubble.dataset.mdHydrated = '1'
		bubble.dataset.mdPreview = canExpand ? '1' : '0'
		bubble.dataset.mdUntrusted = '1'
		if (canExpand)
			bubble.dataset.mdPending = '1'
		else {
			pendingMarkdownByMessageId.delete(messageId)
			delete bubble.dataset.mdPending
			delete bubble.dataset.mdRaw
		}

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
	catch (error) {
		console.error('[hub] markdown hydrate failed', messageId, error)
		showMarkdownHydrateFailure(bubble)
		bubble.dataset.mdHydrated = '1'
		bubble.dataset.mdPreview = '0'
	}
}

/**
 * Hub 消息区 Markdown + 可信作者策略。
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
		const bubble = row.querySelector('.hub-message-content')
		if (!(bubble instanceof HTMLElement)) continue
		const hasPending = pendingMarkdownByMessageId.has(messageId)
			|| bubble.dataset.mdPending === '1'
			|| !!bubble.dataset.mdRaw
		if (!hasPending) continue
		if (onlyMessageId) {
			delete bubble.dataset.mdHydrated
			disposeEmbedGuard(bubble)
		}
		else if (bubble.dataset.mdHydrated === '1')
			continue

		await hydrateOneMarkdown(container, messageId, row, bubble)
	}
}
