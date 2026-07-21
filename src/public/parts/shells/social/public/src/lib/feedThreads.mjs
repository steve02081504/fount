import { groupSelfReplyThreads } from '../../shared/feedThreads.mjs'
import { insertBeforeScrollSentinel } from '/scripts/infiniteScroll.mjs'

/**
 * 将分组渲染并追加到容器（插在 `[data-scroll-sentinel]` 之前）。
 * @param {HTMLElement} container 列表容器
 * @param {object[]} items feed 条目
 * @param {(item: object) => Promise<HTMLElement | null>} buildCard 卡片构建
 * @returns {Promise<void>}
 */
export async function appendFeedItemsWithThreads(container, items, buildCard) {
	const groups = groupSelfReplyThreads(items)
	for (const group of groups) {
		if (group.type === 'single') {
			const card = await buildCard(group.items[0])
			if (card) insertBeforeScrollSentinel(container, card)
			continue
		}
		const thread = document.createElement('div')
		thread.className = 'post-thread'
		for (const item of group.items) {
			const card = await buildCard(item)
			if (!card) continue
			card.classList.add('post-thread-item')
			thread.appendChild(card)
		}
		if (thread.childElementCount)
			insertBeforeScrollSentinel(container, thread)
	}
}
