import { renderTemplate } from '../../../../../../pages/scripts/template.mjs'
import { createVirtualList } from '../../../../../../pages/scripts/virtualList.mjs'
import { geti18n, setLocalizeLogic } from '../../../../../../scripts/i18n.mjs'
import { handleUIError, normalizeError } from '../utils.mjs'

import { mergeChannelMessagesForDisplay } from './dagMessageUtils.mjs'

/**
 * 将 `renderTemplate` 结果规范为单个根 `HTMLElement`（片段则取首个子元素）。
 * @param {Element | DocumentFragment} node 模板渲染结果
 * @returns {HTMLElement} 用于挂载或查询的根元素
 */
function unwrapTemplateNode(node) {
	if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
		const el = node.firstElementChild
		if (el) return /** @type {HTMLElement} */ el
		const wrap = document.createElement('div')
		wrap.appendChild(node)
		return wrap
	}
	return /** @type {HTMLElement} */ node
}

/**
 * 统一包装本地化绑定，减少重复样板。
 * @param {HTMLElement} target 目标节点
 * @param {() => void} apply 执行本地化赋值
 * @returns {void}
 */
function bindLocalize(target, apply) {
	setLocalizeLogic(target, apply)
}

/**
 * 绑定 title 本地化文本。
 * @param {HTMLElement} target 目标节点
 * @param {string} key i18n key
 * @param {string} [fallback] 可选兜底文本
 * @returns {void}
 */
function bindLocalizedTitle(target, key, fallback) {
	bindLocalize(target, () => {
		target.title = geti18n(key) || fallback || ''
	})
}

/**
 * 创建 Discord 风格的 Thread Drawer（群聊主容器内联侧边栏）。
 *
 * @param {object} params 工厂参数
 * @param {string} params.groupId 群组 ID
 * @param {HTMLElement} params.panel 群聊主容器（thread drawer 将 append 到其中）
 * @param {Function} params.createThreadRenderer
 *   工厂函数：`({ channelId, msgBox, loadMessages }) => { renderMessageItem }`，
 *   负责为指定线程频道创建消息渲染器。
 * @returns {{ open: Function, close: Function, destroy: Function, openFresh: Function, openChild: Function }} Thread Drawer 控制器
 */
export function createThreadDrawer({ groupId, panel, createThreadRenderer }) {
	/** @type {{ drawer: HTMLElement, titleText: HTMLElement, closeBtn: HTMLButtonElement, breadcrumb: HTMLElement, msgBox: HTMLElement } | null} */
	let refs = null
	let aborted = false

	const initPromise = renderTemplate('thread_drawer', {})
		.then(raw => {
			if (aborted) return
			const drawer = unwrapTemplateNode(raw)
			panel.appendChild(drawer)
			if (aborted) {
				drawer.remove()
				return
			}
			const titleText = /** @type {HTMLElement} */ drawer.querySelector('[data-thread-title]')
			const closeBtn = /** @type {HTMLButtonElement} */ drawer.querySelector('[data-thread-close]')
			const breadcrumb = /** @type {HTMLElement} */ drawer.querySelector('[data-thread-breadcrumb]')
			const msgBox = /** @type {HTMLElement} */ drawer.querySelector('[data-thread-msgbox]')
			refs = { drawer, titleText, closeBtn, breadcrumb, msgBox }

			bindLocalize(drawer, () => {
				drawer.setAttribute('aria-label', geti18n('chat.group.thread') || 'Thread')
			})
			bindLocalizedTitle(closeBtn, 'chat.group.threadClose', 'Close thread')
			closeBtn.addEventListener('click', () => close())
			bindLocalize(titleText, syncThreadTitleBar)
			bindLocalize(breadcrumb, renderBreadcrumb)
		})
		.catch(err => {
			handleUIError(normalizeError(err), 'chat.group.loadError', 'threadDrawer: template load failed')
		})

	/** @type {Array<{ channelId: string, title: string | null }>} */
	const breadcrumbHistory = []

	/**
	 * @returns {void}
	 */
	function syncThreadTitleBar() {
		const last = breadcrumbHistory[breadcrumbHistory.length - 1]
		if (refs?.titleText)
			refs.titleText.textContent = (last?.title ?? geti18n('chat.group.thread')) || 'Thread'
	}

	/** @type {AbortController | null} */
	let currentAbort = null
	/** @type {object | null} */
	let msgVirtualList = null

	/**
	 * @returns {Promise<void>}
	 */
	async function ensureReady() {
		await initPromise
	}

	/**
	 * 拉取线程消息并用虚拟列表渲染。
	 * @param {string} threadChannelId 线程频道 ID
	 * @param {Function} renderMessageItem 消息项渲染函数
	 * @param {AbortSignal} signal 生命周期信号
	 */
	async function fetchAndRender(threadChannelId, renderMessageItem, signal) {
		if (!refs) return
		const r = await fetch(
			`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/chat/${encodeURIComponent(threadChannelId)}/messages`,
		)
		if (!r.ok) throw new Error(`loadMessages HTTP ${r.status}`)
		if (signal.aborted) return

		const { messages } = await r.json()
		const rawMessages = Array.isArray(messages) ? [...messages] : []
		const displayMessages = mergeChannelMessagesForDisplay(rawMessages)

		if (signal.aborted) return

		msgVirtualList?.destroy()
		msgVirtualList = null
		refs.msgBox.innerHTML = ''
		refs.msgBox.classList.add('flex', 'flex-col', 'min-h-0', 'overflow-hidden')

		const scrollContainer = document.createElement('div')
		scrollContainer.className = 'flex-1 min-h-0 overflow-y-auto w-full'
		refs.msgBox.appendChild(scrollContainer)

		msgVirtualList = createVirtualList({
			container: scrollContainer,
			/**
			 * @param {number} offset 偏移
			 * @param {number} limit 条数
			 * @returns {Promise<{items: object[], total: number}>} 当前窗口切片与总数
			 */
			fetchData: async (offset, limit) => ({
				items: displayMessages.slice(offset, offset + limit),
				total: displayMessages.length,
			}),
			/**
			 * @param {object} item 消息项
			 * @param {number} index 索引
			 * @returns {HTMLElement | Promise<HTMLElement>} 消息 DOM 元素
			 */
			renderItem: (item, index) => renderMessageItem(item, index),
			initialIndex: Math.max(0, displayMessages.length - 1),
			/**
			 *
			 */
			onRenderComplete: () => {
				scrollContainer.scrollTop = scrollContainer.scrollHeight
			},
		})
	}

	/** 超过该深度时在导航条折叠中间层，并始终保留路径起点与返回链 */
	const BREADCRUMB_FULL_MAX = 4

	/**
	 * @param {HTMLElement} container 面包屑容器
	 * @returns {void}
	 */
	function appendBreadcrumbSep(container) {
		const sep = document.createElement('span')
		sep.textContent = '›'
		sep.className = 'opacity-40 shrink-0'
		sep.setAttribute('aria-hidden', 'true')
		container.appendChild(sep)
	}

	/**
	 * @param {HTMLElement} container 面包屑容器
	 * @param {{ channelId: string, title: string | null }} entry 该层频道与标题
	 * @param {number} fullIndex 在 `breadcrumbHistory` 中的索引
	 * @param {boolean} asCurrent 是否为当前层（仅展示不可点）
	 * @param {{ rootJump?: boolean }} [opts] `rootJump` 时为起点层附加说明
	 * @returns {void}
	 */
	function appendBreadcrumbCrumb(container, entry, fullIndex, asCurrent, opts = {}) {
		const label = entry.title?.trim() || geti18n('chat.group.thread')
		if (asCurrent) {
			const span = document.createElement('span')
			span.className = 'opacity-50 truncate max-w-[10rem] min-w-0 shrink'
			span.textContent = label
			span.setAttribute('aria-current', 'page')
			container.appendChild(span)
			return
		}
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'hover:underline opacity-70 hover:opacity-100 transition-opacity truncate max-w-[10rem] min-w-0 shrink text-left'
		btn.textContent = label
		if (opts.rootJump)
			bindLocalizedTitle(btn, 'chat.group.threadBreadcrumbRootTitle')
		btn.addEventListener('click', () => {
			void navigateTo(fullIndex)
		})
		container.appendChild(btn)
	}

	/**
	 * @param {HTMLElement} container 面包屑容器
	 * @param {number} fromIdx 折叠区间起点索引（含）
	 * @param {number} toIdx 折叠区间终点索引（含）
	 * @returns {void}
	 */
	function appendBreadcrumbMiddleFold(container, fromIdx, toIdx) {
		const count = toIdx - fromIdx + 1
		const det = document.createElement('details')
		det.className = 'relative shrink-0'
		const sum = document.createElement('summary')
		sum.className =
			'btn btn-ghost btn-xs px-1.5 list-none cursor-pointer marker:content-none [&::-webkit-details-marker]:hidden max-w-[8rem] truncate'
		bindLocalize(sum, () => {
			sum.textContent = geti18n('chat.group.threadBreadcrumbMiddleSummary', { count })
			sum.title = geti18n('chat.group.threadBreadcrumbMiddleTitle')
		})
		const panel = document.createElement('div')
		panel.className =
			'absolute left-0 top-[calc(100%+2px)] z-50 flex min-w-[10rem] max-w-[min(18rem,90vw)] max-h-48 flex-col gap-0.5 overflow-y-auto rounded-md border border-base-300 bg-base-200 p-1 shadow-md'
		for (let i = fromIdx; i <= toIdx; i++) {
			const entry = breadcrumbHistory[i]
			const row = document.createElement('button')
			row.type = 'button'
			row.className =
				'w-full rounded px-2 py-1 text-left text-xs hover:bg-base-300 truncate'
			row.textContent = entry.title?.trim() || geti18n('chat.group.thread')
			const idx = i
			row.addEventListener('click', () => {
				det.open = false
				void navigateTo(idx)
			})
			panel.appendChild(row)
		}
		det.appendChild(sum)
		det.appendChild(panel)
		container.appendChild(det)
	}

	/**
	 * @returns {void}
	 */
	function renderBreadcrumb() {
		if (!refs) return
		refs.breadcrumb.replaceChildren()
		if (breadcrumbHistory.length === 0) {
			refs.breadcrumb.classList.add('hidden')
			return
		}
		refs.breadcrumb.classList.remove('hidden')
		const full = breadcrumbHistory
		const n = full.length

		if (n > 1) {
			const backBtn = document.createElement('button')
			backBtn.type = 'button'
			backBtn.className = 'btn btn-ghost btn-xs px-1 shrink-0'
			backBtn.textContent = '‹'
			bindLocalizedTitle(backBtn, 'chat.group.threadBack', 'Back')
			backBtn.addEventListener('click', () => {
				void back()
			})
			refs.breadcrumb.appendChild(backBtn)
		}

		if (n <= BREADCRUMB_FULL_MAX) {
			for (let i = 0; i < n; i++) {
				if (i > 0) appendBreadcrumbSep(refs.breadcrumb)
				appendBreadcrumbCrumb(refs.breadcrumb, full[i], i, i === n - 1)
			}
			return
		}

		const parentIdx = n - 2
		const midStart = 1
		const midEnd = n - 3

		appendBreadcrumbCrumb(refs.breadcrumb, full[0], 0, false, { rootJump: true })
		appendBreadcrumbSep(refs.breadcrumb)
		appendBreadcrumbMiddleFold(refs.breadcrumb, midStart, midEnd)
		appendBreadcrumbSep(refs.breadcrumb)
		appendBreadcrumbCrumb(refs.breadcrumb, full[parentIdx], parentIdx, false)
		appendBreadcrumbSep(refs.breadcrumb)
		appendBreadcrumbCrumb(refs.breadcrumb, full[n - 1], n - 1, true)
	}

	/**
	 * @param {number} fullIndex 面包屑完整路径中的目标索引
	 * @returns {Promise<void>}
	 */
	async function navigateTo(fullIndex) {
		if (fullIndex < 0 || fullIndex >= breadcrumbHistory.length - 1) return
		breadcrumbHistory.length = fullIndex + 1
		const { channelId } = breadcrumbHistory[breadcrumbHistory.length - 1]
		syncThreadTitleBar()
		renderBreadcrumb()
		await restartLoad(channelId)
	}

	/**
	 * @returns {Promise<void>}
	 */
	async function back() {
		if (breadcrumbHistory.length <= 1) {
			close()
			return
		}
		breadcrumbHistory.pop()
		const { channelId } = breadcrumbHistory[breadcrumbHistory.length - 1]
		syncThreadTitleBar()
		renderBreadcrumb()
		await restartLoad(channelId)
	}

	/**
	 * @param {string} threadChannelId 线程频道 ID
	 * @returns {Promise<void>}
	 */
	async function restartLoad(threadChannelId) {
		await ensureReady()
		if (!refs || aborted) return
		currentAbort?.abort()
		currentAbort = new AbortController()
		const { signal } = currentAbort
		msgVirtualList?.destroy()
		msgVirtualList = null
		const loading = unwrapTemplateNode(await renderTemplate('thread_drawer_loading', {}))
		refs.msgBox.replaceChildren(loading)
		await loadThreadContent(threadChannelId, signal)
	}

	/**
	 * @param {string} threadChannelId 线程频道 ID
	 * @param {AbortSignal} signal 生命周期信号
	 */
	async function loadThreadContent(threadChannelId, signal) {
		if (!refs) return
		const loadMessagesRef = {
			/**
			 * @returns {Promise<void>} 加载或刷新线程消息（占位实现）
			 */
			run: () => Promise.resolve(),
		}

		const { renderMessageItem } = createThreadRenderer({
			channelId: threadChannelId,
			msgBox: refs.msgBox,
			/**
			 * @returns {Promise<void>} 调用当前绑定的线程加载函数
			 */
			loadMessages: () => loadMessagesRef.run(),
		})

		/**
		 * @returns {Promise<void>} 拉取并渲染线程频道消息
		 */
		loadMessagesRef.run = () => fetchAndRender(threadChannelId, renderMessageItem, signal)

		try {
			await loadMessagesRef.run()
		}
		catch (e) {
			if (!signal.aborted) {
				handleUIError(normalizeError(e), 'chat.group.messagesLoadFailed', 'threadDrawer: loadMessages failed')
				refs.msgBox.replaceChildren()
			}
		}
	}

	/**
	 * @param {string} threadChannelId 线程频道 ID
	 * @param {string} [threadTitle] 可选线程标题
	 * @param {{ fresh?: boolean }} [options] 打开选项
	 * @returns {Promise<void>}
	 */
	async function open(threadChannelId, threadTitle, { fresh = false } = {}) {
		await ensureReady()
		if (!refs || aborted) return
		const treatFresh = fresh || breadcrumbHistory.length === 0 || !refs.drawer.classList.contains('open')
		const normalizedTitle = threadTitle?.trim() ? threadTitle.trim() : null
		if (treatFresh) {
			breadcrumbHistory.length = 0
			breadcrumbHistory.push({
				channelId: threadChannelId,
				title: normalizedTitle,
			})
		}
		else {
			const last = breadcrumbHistory[breadcrumbHistory.length - 1]
			if (last?.channelId === threadChannelId) {
				renderBreadcrumb()
				return
			}
			breadcrumbHistory.push({
				channelId: threadChannelId,
				title: normalizedTitle,
			})
		}

		syncThreadTitleBar()
		renderBreadcrumb()

		refs.drawer.classList.add('open')

		await restartLoad(threadChannelId)
	}

	/**
	 * @param {string} threadChannelId 线程频道 ID
	 * @param {string} [threadTitle] 可选线程标题
	 * @returns {Promise<void>}
	 */
	function openFresh(threadChannelId, threadTitle) {
		return open(threadChannelId, threadTitle, { fresh: true })
	}

	/**
	 * @param {string} threadChannelId 线程频道 ID
	 * @param {string} [threadTitle] 可选线程标题
	 * @returns {Promise<void>}
	 */
	function openChild(threadChannelId, threadTitle) {
		return open(threadChannelId, threadTitle, { fresh: false })
	}

	/**
	 * @returns {void}
	 */
	function close() {
		currentAbort?.abort()
		currentAbort = null
		if (refs?.drawer)
			refs.drawer.classList.remove('open')
		msgVirtualList?.destroy()
		msgVirtualList = null
		if (refs?.msgBox)
			refs.msgBox.innerHTML = ''
		breadcrumbHistory.length = 0
		syncThreadTitleBar()
		renderBreadcrumb()
	}

	/**
	 * @returns {void}
	 */
	function destroy() {
		aborted = true
		close()
		const drawerEl = refs?.drawer
		refs = null
		drawerEl?.remove()
	}

	return { open, close, destroy, openFresh, openChild }
}
