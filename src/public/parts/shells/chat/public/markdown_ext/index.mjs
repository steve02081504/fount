/**
 * Chat shell 注册的 markdown 扩展：群 emoji token、频道/群链接。
 */
import { visit } from 'npm:unist-util-visit'

import { expandChannelLinksInText } from '../shared/expandChannelLinks.mjs'

const EMOJI_CONTENT_API = '/api/parts/shells:chat/emoji-content'

const EMOJI_TOKEN = /:\[([\w.-]+)\/([\w.-]+)]:/g

/**
 * remark：展开 `:[group/emoji]:` 与 `#[group/channel]`。
 * @returns {(tree: import('npm:@types/mdast').Root) => void} remark 插件。
 */
function remarkChatDialect() {
	return tree => {
		visit(tree, 'text', node => {
			if (typeof node.value !== 'string') return
			let value = node.value
			if (value.includes('#['))
				value = expandChannelLinksInText(value)
			if (value.includes(':[',))
				value = value.replace(EMOJI_TOKEN, (_match, groupId, emojiId) => {
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
	if (typeof IntersectionObserver === 'undefined') return
	const observer = new IntersectionObserver(entries => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue
			const img = entry.target
			if (!(img instanceof HTMLImageElement)) continue
			if (!img.classList.contains('fount-emoji')) continue
			if (img.dataset.emojiHydrated === '1') continue
			img.dataset.emojiHydrated = '1'
			if (img.complete && img.naturalWidth > 0) continue
			const src = img.getAttribute('src')
			if (!src) continue
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
	const mo = new MutationObserver(mutations => {
		for (const mutation of mutations)
			for (const node of mutation.addedNodes)
				if (node instanceof HTMLElement)
					scan(node)
	})
	mo.observe(document.body, { childList: true, subtree: true })
}

/** @type {import('npm:unified').Plugin[]} */
const remarkPlugins = [remarkChatDialect]

/**
 *
 */
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
}
