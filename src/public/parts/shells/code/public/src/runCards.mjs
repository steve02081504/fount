/**
 * 运行状态卡共享框架：卡片外壳、状态重绘（图标去重 / 转圈）、按会话的节流拉取与实时事件合并。
 * 子代理运行与统一异步任务只提供各自的状态映射与取数，通用逻辑收敛于此。
 */
import { svgInliner } from '/scripts/lib/svgInliner.mjs'

import { iconElement } from './icons.mjs'
import { elements } from './store.mjs'

/** 已注册的卡片流（会话级统一刷新 / 重绘据此遍历）。 @type {object[]} */
const feeds = []

/**
 * 注册一个运行状态卡流（模块加载时调用）。
 * @param {object} feed - 卡片流。
 * @returns {void}
 */
export function registerRunCardFeed(feed) {
	feeds.push(feed)
}

/**
 * 重绘消息流中的全部运行状态卡（条目 (重) 渲染后调用）。
 * @returns {void}
 */
export function updateRunCards() {
	for (const feed of feeds) feed.update()
}

/**
 * 刷新全部运行状态卡流（会话切换 / 生成结束时调用，节流交由各流处理）。
 * @param {{force?: boolean}} [options] - force 为 true 时忽略节流。
 * @returns {Promise<void>}
 */
export async function refreshRunCards(options = {}) {
	await Promise.all(feeds.map(feed => feed.refresh(options)))
}

/**
 * 构建运行状态卡外壳（图标 + 可选类型标签 + 标题 + 状态）。
 * @param {object} options - 卡片选项。
 * @param {string} [options.tag='div'] - 卡片标签名。
 * @param {string} options.className - 卡片类名。
 * @param {string} [options.kindClass=''] - 类型标签类名（缺省不建）。
 * @param {string} [options.kind=''] - 类型标签文本。
 * @param {string} options.label - 标题文本。
 * @param {object} [options.dataset] - 附加 data 属性。
 * @returns {HTMLElement} 卡片。
 */
export function createRunCard({ tag = 'div', className, kindClass = '', kind = '', label, dataset = {} }) {
	const card = document.createElement(tag)
	card.className = className
	Object.assign(card.dataset, dataset)
	const icon = document.createElement('span')
	icon.className = 'code-run-card-icon'
	card.appendChild(icon)
	if (kindClass) {
		const kindElement = document.createElement('span')
		kindElement.className = kindClass
		kindElement.textContent = kind
		card.appendChild(kindElement)
	}
	const labelElement = document.createElement('span')
	labelElement.className = 'code-run-card-label'
	labelElement.setAttribute('user-content', '')
	labelElement.textContent = label
	const status = document.createElement('span')
	status.className = 'code-run-card-status'
	card.append(labelElement, status)
	return card
}

/**
 * 按状态重绘卡片（图标以 icon+状态 去重，避免每次事件重建节点）。
 * @param {HTMLElement} card - 卡片。
 * @param {object} view - 展示信息。
 * @param {string} view.state - 状态。
 * @param {boolean} view.working - 是否转圈。
 * @param {string} view.icon - Iconify 图标 id。
 * @param {string} view.statusText - 状态文案。
 * @param {string} [view.title] - title。
 * @param {string|null} [view.ariaLabel] - aria-label（null 表示保留现值）。
 * @returns {void}
 */
export function paintRunCard(card, { state, working, icon, statusText, title, ariaLabel }) {
	card.dataset.state = state
	card.classList.toggle('is-working', working)
	if (title != null) card.title = title
	if (ariaLabel != null) card.setAttribute('aria-label', ariaLabel)
	const iconKey = `${icon}:${state}:${working}`
	if (card.dataset.iconKey !== iconKey) {
		card.dataset.iconKey = iconKey
		const holder = card.querySelector('.code-run-card-icon')
		if (holder) {
			holder.replaceChildren(iconElement(icon, { size: 15 }))
			void svgInliner(holder)
		}
	}
	const status = card.querySelector('.code-run-card-status')
	if (status) status.textContent = statusText
}

/**
 * 创建一个运行状态卡流：持有状态表，负责节流拉取、实时事件合并与卡片重绘。
 * @param {object} config - 配置。
 * @param {string} config.cardSelector - 卡片选择器（须能定位带 id 的卡片）。
 * @param {(card: HTMLElement) => string} config.cardId - 从卡片取运行 / 任务 id。
 * @param {() => string} config.chatId - 当前会话 chat id（空串表示无会话）。
 * @param {(payload: object) => string} config.eventId - 从事件负载取运行 / 任务 id。
 * @param {(payload: object) => string} config.eventChatId - 从事件负载取 chat id。
 * @param {(states: Map, payload: object) => void} config.ingest - 合并一条实时事件。
 * @param {(states: Map, entries: object[]) => void} config.merge - 合并一批拉取结果。
 * @param {(chatId: string) => Promise<object[]>} config.fetch - 拉取当前会话运行中的状态。
 * @param {(card: HTMLElement, entry: object|undefined) => void} config.paint - 重绘单卡。
 * @returns {{get: Function, update: Function, handle: Function, refresh: Function}} 卡片流。
 */
export function createRunCardFeed(config) {
	const states = new Map()
	/** 上次拉取节流记录：{ chatId, at }。 */
	let lastFetch = null

	/** 重绘消息流中的全部卡片。 */
	const update = () => {
		for (const card of elements.messages.querySelectorAll(config.cardSelector))
			config.paint(card, states.get(config.cardId(card)))
	}

	/**
	 * 处理服务端实时事件（仅当前会话）。
	 * @param {object} payload - 事件负载。
	 * @returns {void}
	 */
	const handle = payload => {
		const id = config.eventId(payload)
		if (!id) return
		const chatId = config.eventChatId(payload)
		if (chatId && chatId !== config.chatId()) return
		config.ingest(states, payload)
		update()
	}

	/**
	 * 拉取当前会话运行中的状态（3 秒节流；实时事件优先）。
	 * @param {{force?: boolean}} [options] - force 为 true 时忽略节流。
	 * @returns {Promise<void>}
	 */
	const refresh = async ({ force = false } = {}) => {
		const chatId = config.chatId()
		if (!chatId) {
			states.clear()
			update()
			return
		}
		const previousChatId = lastFetch?.chatId
		if (!force && previousChatId === chatId && Date.now() - lastFetch.at < 3000) return
		if (previousChatId && previousChatId !== chatId) states.clear()
		lastFetch = { chatId, at: Date.now() }
		try {
			const entries = await config.fetch(chatId)
			if (config.chatId() !== chatId) return
			config.merge(states, entries)
			update()
		}
		catch { /* 查询失败保留本地兜底状态 */ }
	}

	return {
		/**
		 * 取某 id 的状态摘要。
		 * @param {string} id - 运行 / 任务 id。
		 * @returns {object|undefined} 状态摘要。
		 */
		get: id => states.get(id),
		update,
		handle,
		refresh,
	}
}
