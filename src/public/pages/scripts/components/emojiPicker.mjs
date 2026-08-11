/**
 * 共享 emoji picker：包头像 rail + 连续滚动分区（Discord 式）。
 */
import {
	orderPackSections,
	parseUsageId,
	recentEmojisFromLog,
	trimUsageLog,
	USAGE_WINDOW,
} from '../features/emoji/order.mjs'
import { resolvePackEmojiUrl } from '../features/emoji/packIndex.mjs'
import { aggregateEmojiPacks } from '../features/emoji/providers.mjs'
import {
	loadUnicodeEmojiByGroup,
	RECENT_EMOJI_SECTION_GLYPH,
	RECENT_EMOJI_SECTION_KEY,
	unicodeEmojiGroupGlyph,
	unicodeEmojiGroupI18nKey,
	unicodeEmojiSectionKey,
} from '../features/emoji/unicodeData.mjs'
import { escapeHtml } from '../lib/escapeHtml.mjs'

import { showEmojiPackPreview } from './emojiPackPreview.mjs'
import { positionFloatingPanel, wireOutsideClickClose } from './floatingPanel.mjs'

/** 重导出 showEmojiPackPreview。 */
export { showEmojiPackPreview } from './emojiPackPreview.mjs'

const JUMP_START_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h16v2H4V4zm8 3l6 6h-4v7h-4v-7H6l6-6z"/></svg>'
const JUMP_UNICODE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-4.5-7.5c.83 0 1.5-.67 1.5-1.5S8.33 9.5 7.5 9.5 6 10.17 6 11s.67 1.5 1.5 1.5zm9 0c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5-1.5.67-1.5 1.5.67 1.5 1.5 1.5zm-4.5 5.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>'

/**
 * 来源侧默认包：由 provider/API 回显的 defaultEmojiPackId（已在后端 resolve）判定。
 * @param {object} pack pack
 * @returns {boolean} 是否为来源默认包
 */
function isSourceDefaultPack(pack) {
	return Boolean(pack?.packId && pack.defaultEmojiPackId === pack.packId)
}

/**
 * 把 manifest 条目补成 grid 可渲染的 pack item。
 * @param {string} packId 所属包
 * @param {object} item manifest 条目
 * @returns {object} 带 kind / packId / emojiRef 的条目
 */
function enrichPackItem(packId, item) {
	return {
		...item,
		kind: 'pack',
		packId,
		emojiRef: item.emojiRef || (item.emojiId ? `:[emoji:${packId}/${item.emojiId}]:` : ''),
	}
}

/**
 * 在输入框光标处插入 token。
 * @param {HTMLTextAreaElement | HTMLInputElement} inputElement 目标输入框
 * @param {string} token 要插入的文本或表情引用
 * @returns {void}
 */
function insertAtCursor(inputElement, token) {
	const start = inputElement.selectionStart ?? inputElement.value.length
	const end = inputElement.selectionEnd ?? start
	inputElement.setRangeText(token, start, end, 'end')
	inputElement.focus()
}

/**
 * 包 rail 按钮内部 HTML（头像或首字）。
 * @param {object} pack 包展示字段
 * @returns {string} rail 按钮 innerHTML
 */
function packRailInnerHtml(pack) {
	if (pack.avatar)
		return `<img class="emoji-rail-avatar" src="${escapeHtml(pack.avatar)}" alt="" loading="lazy" />`
	const glyph = (pack.name || pack.packId || '?').slice(0, 1)
	return `<span class="emoji-rail-glyph" aria-hidden="true">${escapeHtml(glyph)}</span>`
}

/**
 * 向网格追加单个表情按钮。
 * @param {HTMLElement} grid 表情网格容器
 * @param {object} item 包表情、自定义表情或 Unicode 项
 * @returns {void}
 */
function appendEmojiGridItem(grid, item) {
	if (item.kind === 'pack' || item.kind === 'custom' || (item.packId && item.emojiId) || (item.groupId && item.emojiId)) {
		const packId = item.packId || item.groupId
		const gridButton = document.createElement('button')
		gridButton.type = 'button'
		gridButton.className = 'emoji-grid-button group-emoji-grid-button'
		gridButton.dataset.packId = packId
		gridButton.dataset.groupEmojiId = item.emojiId
		gridButton.dataset.groupEmojiRef = item.emojiRef || (packId && item.emojiId ? `:[emoji:${packId}/${item.emojiId}]:` : '')
		gridButton.title = item.name || item.label || item.emojiId
		if (item.previewUrl) {
			const img = document.createElement('img')
			img.src = item.previewUrl
			img.alt = item.alt || item.name || ''
			img.loading = 'lazy'
			img.className = 'group-emoji-img'
			gridButton.appendChild(img)
		}
		else
			gridButton.textContent = item.name || item.label || item.emojiId || '?'
		grid.appendChild(gridButton)
		return
	}

	if (item.unicode) {
		const gridButton = document.createElement('button')
		gridButton.type = 'button'
		gridButton.className = 'emoji-grid-button'
		gridButton.dataset.emoji = item.unicode
		gridButton.title = item.name || item.unicode
		gridButton.textContent = item.unicode
		grid.appendChild(gridButton)
	}
}

/**
 * 聚合 provider 数据并构建 picker 分区列表。
 * @param {object} [context] 选择器上下文（群、回复对象等）
 * @returns {Promise<{ sections: object[], usage: object | null }>} 分区与 usage 能力
 */
async function buildSections(context = {}) {
	const { packs, usage, collection } = await aggregateEmojiPacks(context)
	const usagePayload = usage ? await usage.load() : { log: [], lastUsedAtByPack: {} }
	const log = trimUsageLog(usagePayload.log || [], USAGE_WINDOW)
	const collectionIds = new Set((await collection?.list())?.packIds || [])
	const usedPackIds = new Set()
	for (const entry of log) {
		const parsed = parseUsageId(entry.id)
		if (parsed?.kind === 'pack') usedPackIds.add(parsed.packId)
	}

	const visiblePacks = packs.filter(p => collectionIds.has(p.packId) || usedPackIds.has(p.packId) || isSourceDefaultPack(p))
	const contextDefaultPackIds = []
	if (context.groupId) {
		const groupPack = packs.find(p =>
			(p.groupId === context.groupId || p.source?.id === context.groupId) && isSourceDefaultPack(p))
		if (groupPack) contextDefaultPackIds.push(groupPack.packId)
	}
	if (context.replyToEntityHash) {
		const entityPack = packs.find(p =>
			p.source?.kind === 'entity' && p.source.id === context.replyToEntityHash && isSourceDefaultPack(p))
		if (entityPack) contextDefaultPackIds.push(entityPack.packId)
	}
	for (const id of contextDefaultPackIds) {
		const p = packs.find(x => x.packId === id)
		if (p && !visiblePacks.some(v => v.packId === id)) visiblePacks.push(p)
	}

	/** @type {object[]} */
	const sections = []

	const recent = recentEmojisFromLog(log)
	if (recent.length) {
		const packById = new Map(packs.map(p => [p.packId, p]))
		/** @type {object[]} */
		const items = []
		for (const { parsed } of recent) {
			if (parsed.kind === 'unicode') {
				items.push({ kind: 'unicode', unicode: parsed.unicode, name: parsed.unicode })
				continue
			}
			const pack = packById.get(parsed.packId)
			const item = pack?.items?.find(i => i.emojiId === parsed.emojiId)
			if (item) items.push(enrichPackItem(parsed.packId, item))
			else {
				const previewUrl = await resolvePackEmojiUrl(parsed.packId, parsed.emojiId, {
					providers: pack?._provider ? [pack._provider] : undefined,
				})
				items.push({
					kind: 'pack',
					packId: parsed.packId,
					emojiId: parsed.emojiId,
					emojiRef: `:[emoji:${parsed.packId}/${parsed.emojiId}]:`,
					name: parsed.emojiId,
					previewUrl,
				})
			}
		}
		sections.push({
			id: RECENT_EMOJI_SECTION_KEY,
			kind: 'recent',
			glyph: RECENT_EMOJI_SECTION_GLYPH,
			i18nKey: 'chat.emoji.recent',
			items,
		})
	}

	const ordered = orderPackSections({
		packs: visiblePacks,
		contextDefaultPackIds,
		log,
		lastUsedAtByPack: usagePayload.lastUsedAtByPack || {},
	})
	const packById = new Map(visiblePacks.map(p => [p.packId, p]))
	for (const { packId } of ordered) {
		const pack = packById.get(packId)
		if (!pack) continue
		sections.push({
			id: `pack:${packId}`,
			kind: 'pack',
			packId,
			pack,
			items: (pack.items || []).map(item => enrichPackItem(packId, item)),
		})
	}

	let byGroup = {}
	/** @type {string[]} */
	let order = []
	try {
		({ byGroup, order } = await loadUnicodeEmojiByGroup())
	}
	catch (error) {
		console.warn('[emoji] unicode data load failed', error)
	}
	for (const groupName of order) {
		const codes = byGroup[groupName] || []
		if (!codes.length) continue
		sections.push({
			id: unicodeEmojiSectionKey(groupName),
			kind: 'unicode',
			glyph: unicodeEmojiGroupGlyph(groupName),
			i18nKey: unicodeEmojiGroupI18nKey(groupName),
			items: codes.map(unicode => ({ kind: 'unicode', unicode, name: unicode })),
		})
	}

	return { sections, usage }
}

/**
 * 绑定 rail 与滚动区的 intersection 高亮，并按位置显隐跳转按钮。
 * @param {HTMLElement} rail 左侧 rail 容器
 * @param {HTMLElement} scroll 右侧滚动区
 * @param {object[]} sections 分区元数据
 * @param {{ jumpStart: HTMLElement, jumpUnicode: HTMLElement, firstUnicodeId: string | undefined, sectionById: Map<string, object> }} jump 跳转按钮与 unicode 首分区
 * @returns {() => void} 断开 observer / scroll 监听的清理函数
 */
function wireScrollSpy(rail, scroll, sections, jump) {
	const buttons = [...rail.querySelectorAll('[data-section]')]
	/** @type {Map<string, number>} */
	const ratios = new Map()
	/** @type {string | null} */
	let activeSectionId = null

	/**
	 * 已在顶部则藏「回开头」；已在 unicode 区则藏「跳到 unicode」。
	 * @returns {void}
	 */
	function updateJumpVisibility() {
		jump.jumpStart.classList.toggle('hidden', scroll.scrollTop < 8)
		const active = activeSectionId ? jump.sectionById.get(activeSectionId) : null
		jump.jumpUnicode.classList.toggle('hidden', !jump.firstUnicodeId || active?.kind === 'unicode')
	}

	const observer = new IntersectionObserver(entries => {
		for (const entry of entries)
			ratios.set(entry.target.dataset.section, entry.intersectionRatio)
		let bestId = null
		let bestRatio = 0
		for (const [id, ratio] of ratios)
			if (ratio > bestRatio) {
				bestRatio = ratio
				bestId = id
			}
		if (!bestId) return
		activeSectionId = bestId
		for (const btn of buttons) {
			const active = btn.dataset.section === bestId
			btn.classList.toggle('emoji-rail-active', active)
			btn.setAttribute('aria-current', active ? 'true' : 'false')
		}
		updateJumpVisibility()
	}, { root: scroll, threshold: [0, 0.25, 0.5, 0.75, 1] })

	for (const section of sections) {
		const el = scroll.querySelector(`[data-section="${CSS.escape(section.id)}"]`)
		if (el) observer.observe(el)
	}
	scroll.addEventListener('scroll', updateJumpVisibility, { passive: true })
	updateJumpVisibility()
	return () => {
		observer.disconnect()
		scroll.removeEventListener('scroll', updateJumpVisibility)
	}
}

/**
 * @param {HTMLElement} anchor 锚点
 * @param {object} section 分区
 * @returns {void}
 */
function openSectionPackPreview(anchor, section) {
	if (section?.kind !== 'pack' || !section.pack) return
	void showEmojiPackPreview(anchor, {
		pack: section.pack,
		provider: section.pack._provider,
		available: true,
	})
}

/**
 * 渲染连续滚动式 picker 主体。
 * @param {HTMLElement} host 挂载容器
 * @param {object[]} sections 分区列表
 * @param {{ onInsert: (token: string) => void, usage?: object | null }} handlers 插入与 usage 回调
 * @returns {{ disconnect: () => void, scrollElement: HTMLElement, railElement: HTMLElement }} DOM 引用与清理句柄
 */
function renderContinuousPicker(host, sections, handlers) {
	host.replaceChildren()

	const sectionById = new Map(sections.map(section => [section.id, section]))

	const railWrap = document.createElement('div')
	railWrap.className = 'emoji-rail-wrap'
	const jumpStart = document.createElement('button')
	jumpStart.type = 'button'
	jumpStart.className = 'emoji-rail-jump emoji-rail-jump-start'
	jumpStart.dataset.i18n = 'chat.emoji.jumpToStart'
	jumpStart.innerHTML = JUMP_START_ICON

	const rail = document.createElement('div')
	rail.className = 'emoji-rail'
	rail.setAttribute('role', 'toolbar')

	const jumpUnicode = document.createElement('button')
	jumpUnicode.type = 'button'
	jumpUnicode.className = 'emoji-rail-jump emoji-rail-jump-unicode'
	jumpUnicode.dataset.i18n = 'chat.emoji.jumpToUnicode'
	jumpUnicode.innerHTML = JUMP_UNICODE_ICON

	railWrap.append(jumpStart, rail, jumpUnicode)

	const scroll = document.createElement('div')
	scroll.className = 'emoji-scroll'
	scroll.id = 'emoji-scroll'

	const firstUnicodeId = sections.find(s => s.kind === 'unicode')?.id

	for (const section of sections) {
		const packName = section.kind === 'pack' ? section.pack?.name || section.packId || '' : ''
		const railBtn = document.createElement('button')
		railBtn.type = 'button'
		railBtn.className = 'emoji-rail-item'
		railBtn.dataset.section = section.id
		railBtn.setAttribute('aria-current', 'false')
		if (section.kind === 'pack' && section.pack?.avatar)
			railBtn.innerHTML = `<img class="emoji-rail-avatar" src="${escapeHtml(section.pack.avatar)}" alt="" loading="lazy" />`
		else if (section.kind === 'pack')
			railBtn.innerHTML = packRailInnerHtml({ name: packName, packId: section.packId })
		else
			railBtn.innerHTML = `<span class="emoji-rail-glyph" aria-hidden="true">${escapeHtml(section.glyph || '?')}</span>`

		const sectionEl = document.createElement('section')
		sectionEl.className = 'emoji-section'
		sectionEl.dataset.section = section.id
		const header = document.createElement(section.kind === 'pack' ? 'button' : 'h2')
		header.className = section.kind === 'pack'
			? 'emoji-section-header emoji-section-header-pack'
			: 'emoji-section-header'
		if (section.kind === 'pack') {
			header.type = 'button'
			header.dataset.packPreview = '1'
		}
		if (section.i18nKey) {
			railBtn.dataset.i18n = section.i18nKey
			header.dataset.i18n = `${section.i18nKey}.title`
		}
		else if (packName) {
			railBtn.title = packName
			railBtn.setAttribute('aria-label', packName)
			railBtn.setAttribute('user-content', '')
			header.textContent = packName
			header.setAttribute('user-content', '')
		}
		rail.appendChild(railBtn)
		const grid = document.createElement('div')
		grid.className = 'emoji-grid'
		for (const item of section.items)
			appendEmojiGridItem(grid, item)
		sectionEl.append(header, grid)
		scroll.appendChild(sectionEl)
	}

	host.append(railWrap, scroll)

	const footer = document.createElement('div')
	footer.className = 'emoji-picker-footer'
	const discoverLink = document.createElement('a')
	discoverLink.className = 'emoji-picker-discover'
	discoverLink.href = '/parts/shells:chat/emoji-packs/'
	discoverLink.target = '_blank'
	discoverLink.rel = 'noopener'
	discoverLink.dataset.i18n = 'chat.emoji.discoverPacks'
	footer.appendChild(discoverLink)
	host.appendChild(footer)

	const disconnectSpy = wireScrollSpy(rail, scroll, sections, {
		jumpStart,
		jumpUnicode,
		firstUnicodeId,
		sectionById,
	})

	/**
	 * 平滑滚动到指定分区。
	 * @param {string} sectionId 分区 ID
	 * @returns {void}
	 */
	function scrollToSection(sectionId) {
		const el = scroll.querySelector(`[data-section="${CSS.escape(sectionId)}"]`)
		el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
		const railBtn = rail.querySelector(`[data-section="${CSS.escape(sectionId)}"]`)
		railBtn?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
	}

	jumpStart.addEventListener('click', () => {
		scroll.scrollTo({ top: 0, behavior: 'smooth' })
		rail.scrollTo({ left: 0, behavior: 'smooth' })
	})
	jumpUnicode.addEventListener('click', () => {
		if (firstUnicodeId) scrollToSection(firstUnicodeId)
	})
	rail.addEventListener('click', event => {
		const btn = event.target.closest('[data-section]')
		if (!btn) return
		const section = sectionById.get(btn.dataset.section)
		if (section?.kind === 'pack' && (event.altKey || event.button === 1)) {
			event.preventDefault()
			openSectionPackPreview(btn, section)
			return
		}
		scrollToSection(btn.dataset.section)
	})
	rail.addEventListener('contextmenu', event => {
		const btn = event.target.closest('[data-section]')
		if (!btn) return
		const section = sectionById.get(btn.dataset.section)
		if (section?.kind !== 'pack') return
		event.preventDefault()
		openSectionPackPreview(btn, section)
	})
	rail.addEventListener('auxclick', event => {
		if (event.button !== 1) return
		const btn = event.target.closest('[data-section]')
		if (!btn) return
		const section = sectionById.get(btn.dataset.section)
		if (section?.kind !== 'pack') return
		event.preventDefault()
		openSectionPackPreview(btn, section)
	})

	scroll.addEventListener('click', event => {
		const header = event.target.closest('[data-pack-preview]')
		if (header) {
			const sectionEl = header.closest('[data-section]')
			const section = sectionById.get(sectionEl?.dataset?.section)
			openSectionPackPreview(header, section)
			return
		}
		const groupButton = event.target.closest('[data-group-emoji-ref]')
		if (groupButton) {
			const ref = groupButton.dataset.groupEmojiRef || ''
			const packId = groupButton.dataset.packId
			const emojiId = groupButton.dataset.groupEmojiId
			if (packId && emojiId)
				void handlers.usage?.record?.({ kind: 'pack', packId, emojiId })
			if (ref) handlers.onInsert(ref)
			return
		}
		const gridButton = event.target.closest('[data-emoji]')
		if (!gridButton?.dataset.emoji) return
		const { emoji } = gridButton.dataset
		void handlers.usage?.record?.({ kind: 'unicode', unicode: emoji })
		handlers.onInsert(emoji)
	})

	return {
		disconnect: disconnectSpy,
		scrollElement: scroll,
		railElement: rail,
	}
}

/**
 * 在 Hub composer 等位置挂载停靠式 emoji picker。
 * @param {object} options 挂载选项
 * @param {HTMLElement} options.pickerElement picker 根元素
 * @param {HTMLElement} options.triggerButton 触发按钮
 * @param {HTMLTextAreaElement | HTMLInputElement} [options.inputElement] 插入目标输入框
 * @param {object} [options.pickerContext] 静态上下文
 * @param {() => object} [options.getPickerContext] 动态上下文
 * @param {(token: string) => void} [options.onInsert] 无 inputElement 时的插入回调
 * @param {HTMLElement} [options.closeWhenOpening] 打开时需关闭的互斥面板
 * @returns {Promise<{ refresh: () => Promise<void>, scrollElement: HTMLElement | null } | null>} 刷新句柄与滚动元素
 */
export async function mountDockedEmojiPicker(options) {
	const {
		pickerElement, triggerButton, inputElement,
		pickerContext = {}, getPickerContext, onInsert, closeWhenOpening,
	} = options

	/** @returns {object} 当前 picker 上下文 */
	const resolvePickerContext = () => getPickerContext?.() ?? pickerContext

	/** @type {(() => void) | null} */
	let disconnect = null
	/** @type {HTMLElement | null} */
	let scrollElement = null

	/**
	 * @returns {Promise<void>}
	 */
	async function refresh() {
		disconnect?.()
		const liveContext = resolvePickerContext()
		const { sections, usage } = await buildSections(liveContext)
		let body = pickerElement.querySelector('.emoji-picker-body')
		if (!body) {
			pickerElement.replaceChildren()
			body = document.createElement('div')
			body.className = 'emoji-picker-body'
			pickerElement.appendChild(body)
		}
		const result = renderContinuousPicker(body, sections, {
			usage,
			/** @param {string} token 插入的文本或表情引用 */
			onInsert: token => {
				if (inputElement) insertAtCursor(inputElement, token)
				else onInsert?.(token)
				pickerElement.classList.remove('show')
			},
		})
		disconnect = result.disconnect
		scrollElement = result.scrollElement
	}

	triggerButton.addEventListener('click', event => {
		event.stopPropagation()
		closeWhenOpening?.classList.remove('show')
		pickerElement.classList.toggle('show')
		if (pickerElement.classList.contains('show'))
			void refresh()
	})

	document.addEventListener('click', event => {
		if (pickerElement.classList.contains('show')
			&& !pickerElement.contains(event.target)
			&& !triggerButton.contains(event.target))
			pickerElement.classList.remove('show')
	})

	return {
		refresh,
		/** @returns {HTMLElement | null} 当前滚动区元素 */
		get scrollElement() { return scrollElement },
	}
}

/**
 * 在锚点附近弹出浮动 emoji picker。
 * @param {HTMLElement} anchor 定位锚点
 * @param {(text: string) => void} onInsert 选中后的插入回调
 * @param {object} [pickerContext] 选择器上下文
 * @returns {Promise<void>}
 */
export async function mountEmojiPicker(anchor, onInsert, pickerContext = {}) {
	document.getElementById('fount-shared-emoji-picker')?.remove()

	const panel = document.createElement('div')
	panel.id = 'fount-shared-emoji-picker'
	panel.className = 'emoji-picker show'
	panel.setAttribute('role', 'dialog')
	panel.style.cssText = 'position:fixed;z-index:10000;width:320px;height:360px;'
	positionFloatingPanel(panel, anchor)

	// 标题单独挂 data-i18n，避免字符串形态 locale 写 innerHTML 清掉 picker body。
	const title = document.createElement('span')
	title.className = 'sr-only'
	title.id = 'fount-shared-emoji-picker-title'
	title.dataset.i18n = 'chat.emoji.pickerTitle'
	panel.setAttribute('aria-labelledby', title.id)

	const body = document.createElement('div')
	body.className = 'emoji-picker-body'
	panel.append(title, body)
	document.body.appendChild(panel)

	const { sections, usage } = await buildSections(pickerContext)
	renderContinuousPicker(body, sections, {
		usage,
		/** @param {string} token 插入的文本或表情引用 */
		onInsert: token => {
			onInsert(token)
			panel.remove()
		},
	})

	wireOutsideClickClose(panel, () => panel.remove(), anchor)
}

/**
 * 为按钮绑定点击弹出 emoji picker。
 * @param {HTMLElement} button 触发按钮
 * @param {(text: string) => void} onInsert 选中后的插入回调
 * @param {object} [pickerContext] 选择器上下文
 * @returns {void}
 */
export function wireEmojiPickerButton(button, onInsert, pickerContext = {}) {
	button.addEventListener('click', event => {
		event.preventDefault()
		void mountEmojiPicker(button, onInsert, pickerContext)
	})
}

// --- 全局样式注入 ---

document.head.prepend(Object.assign(document.createElement('link'), {
	rel: 'stylesheet',
	href: '/scripts/components/emojiPicker.css',
}))
