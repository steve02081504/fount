/**
 * Chat shell 注册的 markdown 扩展：群 emoji token、频道/群链接。
 */
import { visit } from 'https://esm.sh/unist-util-visit'

import { expandChannelLinksInText } from '../shared/expandChannelLinks.mjs'
import { EMOJI_TOKEN_RE, LINK_TOKEN_RE, MENTION_TOKEN_RE } from '../shared/inlineTokenSyntax.mjs'

const EMOJI_CONTENT_API = '/api/parts/shells:chat/emoji-content'

/**
 * remark：展开 `:[emoji:group/emoji]:` 与 `#[channel:…]` / `#[group:…]` / `#[message:…]`。
 * @returns {(tree: import('npm:@types/mdast').Root) => void} remark 插件。
 */
function remarkChatDialect() {
	return tree => {
		visit(tree, 'text', node => {
			let { value } = node
			if (value.includes('#['))
				value = expandChannelLinksInText(value)
			if (value.includes(':[emoji:'))
				value = value.replace(EMOJI_TOKEN_RE, (_match, groupId, emojiId) => {
					const src = `${EMOJI_CONTENT_API}/${encodeURIComponent(groupId)}/${encodeURIComponent(emojiId)}`
					return `![emoji](${src})`
				})

			node.value = value
		})
	}
}

/**
 * 对失败或未加载的 emoji 图片做懒加载重试。
 * @returns {void}
 */
function initEmojiHydration() {
	const observer = new IntersectionObserver(entries => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue
			const img = /** @type {HTMLImageElement} */ entry.target
			if (img.dataset.emojiHydrated === '1') continue
			img.dataset.emojiHydrated = '1'
			if (img.complete && img.naturalWidth > 0) continue
			img.addEventListener('error', () => {
				img.classList.add('fount-emoji--failed')
			}, { once: true })
		}
	}, { rootMargin: '64px' })

	/**
	 * 扫描 DOM 中的 emoji 图片并注册懒加载观察。
	 * @param {ParentNode} [root=document] - 扫描根节点。
	 * @returns {void}
	 */
	const scan = (root = document) => {
		for (const img of root.querySelectorAll('img.fount-emoji'))
			observer.observe(img)
	}

	scan()
	new MutationObserver(mutations => {
		for (const mutation of mutations)
			for (const node of mutation.addedNodes)
				if (node instanceof HTMLElement)
					scan(node)
	}).observe(document.body, { childList: true, subtree: true })
}

/**
 * 构造自定义表情 chip（异步补图；失败回退标签）。
 * @param {RegExpExecArray} match emoji token 匹配（单 token 正则，match[1]=packId、match[2]=emojiId）
 * @param {{ makeChip: (raw: string, kind: string) => HTMLSpanElement }} helpers 编辑器注入的 chip 构造器
 * @returns {HTMLSpanElement} chip
 */
function buildEmojiChip(match, { makeChip }) {
	const raw = match[0]
	const packId = match[1]
	const emojiId = match[2]
	const chip = makeChip(raw, 'emoji')
	const label = chip.firstElementChild
	label.textContent = `:${emojiId}:`
	label.hidden = true
	const img = document.createElement('img')
	img.className = 'fount-emoji'
	img.alt = emojiId
	img.setAttribute('loading', 'lazy')
	/**
	 * 表情图加载失败回退。
	 * @returns {void}
	 */
	const fallback = () => {
		if (img.src) {
			img.remove()
			chip.classList.add('fount-markdown-rich-input-emoji-fallback')
			label.hidden = false
		}
	}
	img.addEventListener('error', fallback)
	chip.appendChild(img)
	// 动态 import：保持本模块可被 Deno 纯测试顶层加载（`/scripts/*` 仅在浏览器可解析）。
	void import('/scripts/features/emoji/packIndex.mjs').then(({ resolvePackEmojiUrl }) =>
		resolvePackEmojiUrl(packId, emojiId)
	).then(url => {
		if (!chip.isConnected) return
		if (url) img.src = url
		else fallback()
	})
	return chip
}

/**
 * 解析 @ 提及原始 token 为描述对象。
 * @param {string} raw 原始 token
 * @returns {{ kind: 'mention', body: string, entityHash?: string, roleId?: string }} token 描述
 */
function parseMentionToken(raw) {
	const body = raw.slice(2, -1)
	const token = { kind: 'mention', body }
	if (body.startsWith('entity:')) token.entityHash = body.slice(7)
	else if (body.startsWith('role:')) token.roleId = body.slice(5)
	return token
}

/**
 * 解析频道/群/消息链接原始 token 为描述对象。
 * @param {string} raw 原始 token
 * @returns {{ kind: 'link', body: string, id?: string }} token 描述
 */
function parseLinkToken(raw) {
	const token = { kind: 'link', body: raw }
	const channel = raw.match(/^#\[channel:([\w.-]+)\/([\w.-]+)]$/)
	const group = raw.match(/^#\[group:([\w.-]+)]$/)
	const message = raw.match(/^#\[message:([\w.-]+)\/([\w.-]+)\/([\w.-]+)]$/)
	if (channel) token.id = channel[2]
	else if (group) token.id = group[1]
	else if (message) token.id = message[3]
	return token
}

/** @type {Array<object>} 编辑器 inline token 定义（emoji / mention / link）。 */
const inlineTokens = [
	{ kind: 'emoji', regex: EMOJI_TOKEN_RE, buildChip: buildEmojiChip },
	{ kind: 'mention', regex: MENTION_TOKEN_RE, parse: parseMentionToken },
	{ kind: 'link', regex: LINK_TOKEN_RE, parse: parseLinkToken },
]

/** @type {import('npm:unified').Plugin[]} */
const remarkPlugins = [remarkChatDialect]

/** Chat markdown 扩展默认导出。 */
export default {
	remarkPlugins,
	rehypePlugins: [],
	css: /* css */ `
img.fount-emoji, .markdown-body img[alt="emoji"] {
	display: inline-block;
	height: 1.25em;
	width: 1.25em;
	vertical-align: -0.2em;
	object-fit: contain;
}
img.fount-emoji--failed {
	opacity: 0.35;
}
`,
	init: initEmojiHydration,
	inlineTokens,
}
