import { mountTemplate } from '../../../../scripts/features/template.mjs'

/**
 * 将 feed 条目渲染为帖子卡片列表（支持追加与空状态）。
 * @param {(key: string, params?: object) => string} geti18n i18n
 * @param {(item: object) => Promise<HTMLElement>} buildPostCard 卡片构建
 * @param {HTMLElement} container 容器
 * @param {object[]} items feed items
 * @param {boolean} [append=false] 追加模式
 * @param {string} [emptyKey='social.empty.feed'] 空状态 i18n 键
 * @returns {Promise<void>}
 */
export async function renderFeedItems(geti18n, buildPostCard, container, items, append = false, emptyKey = 'social.empty.feed') {
	if (!append) container.replaceChildren()
	if (!items.length && !append) {
		await mountTemplate(container, 'feed_empty', { emptyKey })
		return
	}
	for (const item of items)
		container.appendChild(await buildPostCard(item))
}
