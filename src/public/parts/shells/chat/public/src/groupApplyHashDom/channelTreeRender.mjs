import { flattenChannelTree } from '../ui/dagMessageUtils.mjs'

/**
 * 渲染左侧频道树（含层级缩进与当前频道高亮）。
 * @param {HTMLElement} tree 频道树 `<ul>` 容器
 * @param {{ groupId: string, channelId: string, lastChannels: Record<string, object> }} opts 群组、当前频道与频道元数据映射
 * @returns {void}
 */
export function renderGroupChannelTree(tree, { groupId, channelId, lastChannels }) {
	tree.innerHTML = ''
	const flat = flattenChannelTree(lastChannels)
	for (const { id, meta, depth } of flat) {
		const li = document.createElement('li')
		const a = document.createElement('a')
		const iconSrc = meta.type === 'list'
			? 'https://api.iconify.design/mdi/format-list-bulleted.svg'
			: meta.type === 'streaming'
				? 'https://api.iconify.design/mdi/video-outline.svg'
				: 'https://api.iconify.design/line-md/chat-round-dots.svg'
		a.replaceChildren()
		const chIcon = document.createElement('img')
		chIcon.src = iconSrc
		chIcon.className = 'w-4 h-4 inline shrink-0 align-middle mr-1'
		chIcon.alt = ''
		a.appendChild(chIcon)
		a.appendChild(document.createTextNode(meta.name || id))
		a.href = `#${groupId}:${id}`
		a.className = channelId === id ? 'active' : ''
		li.style.paddingLeft = `${8 + depth * 12}px`
		li.appendChild(a)
		tree.appendChild(li)
	}
}
