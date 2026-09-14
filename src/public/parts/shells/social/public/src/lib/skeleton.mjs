/**
 * 骨架屏：在数据到达前用纯装饰占位撑住布局，内容渲染后由 `replaceChildren`
 * 自然接管。占位块整体 `aria-hidden`，外层 `role="status"` 提供加载语义。
 */
import { renderTemplate } from '../templates.mjs'

/** 骨架种类 → 模板名。 */
const SKELETON_TEMPLATES = {
	post: 'skeleton_post',
	account: 'skeleton_account',
	notification: 'skeleton_notification',
}

/**
 * 用骨架屏替换容器内容。
 * @param {HTMLElement} container 容器
 * @param {'post' | 'account' | 'notification'} [kind='post'] 骨架种类
 * @param {number} [count=3] 占位数量
 * @returns {Promise<HTMLElement>} 骨架宿主
 */
export async function mountSkeleton(container, kind = 'post', count = 3) {
	if (!(container instanceof HTMLElement)) return container
	const templateName = SKELETON_TEMPLATES[kind] || SKELETON_TEMPLATES.post
	const host = document.createElement('div')
	host.className = 'skeleton-host'
	host.setAttribute('role', 'status')
	host.setAttribute('aria-busy', 'true')
	const label = document.createElement('span')
	label.className = 'sr-only'
	label.dataset.i18n = 'social.post.loading'
	host.appendChild(label)
	const list = document.createElement('div')
	list.className = `skeleton-list skeleton-list--${kind}`
	for (let index = 0; index < count; index++)
		list.appendChild(await renderTemplate(templateName, {}))
	host.appendChild(list)
	// 追加而非替换：通知容器内还含视图头与过滤 tab，不能整体清空
	container.querySelector(':scope > .skeleton-host')?.remove()
	container.appendChild(host)
	return host
}

/**
 * 移除容器中的骨架宿主（若存在）。
 * @param {HTMLElement} container 容器
 * @returns {void}
 */
export function clearSkeleton(container) {
	container.querySelector(':scope > .skeleton-host')?.remove()
}
