/**
 * 【文件】public/shared/entityProfileHoverCard.mjs
 * 【职责】跨壳人物卡悬浮层：与点击弹层共用 profile_popup + paintEntityProfileCard。
 * 【原理】单例卡 + 单队列串行绘制：任意时刻最多一条 paint 流水线写 DOM；新悬停只抬世代号，
 * 排队中的旧请求直接跳过，进行中的在每个 await 后退出。从根上避免内容串台，不靠「事后检查补洞」。
 */
import { cachedProfileFromApi, fetchEntityProfileApi } from '../src/entityProfileApi.mjs'

import { aliasForEntity } from './aliases.mjs'
import { isEntityHash128 } from './entityHash.mjs'
import {
	createEntityProfileCardElement,
	paintEntityProfileCard,
	paintEntityProfileExtras,
} from './entityProfileCard.mjs'
import { resolveDisplayName } from './nameResolve.mjs'

const HOVER_CARD_ID = 'entity-profile-hover-card'
const HOVER_ANCHOR_ATTR = 'data-entity-profile-hover'

/** @type {ReturnType<typeof setTimeout> | null} */
let hideTimer = null
/** 每次 show 递增；仅最新世代会真正写卡 */
let showGeneration = 0
/** 串行链：保证 paintEntityProfileCard 永不并发打同一 DOM */
let paintChain = Promise.resolve()
/** @type {Promise<HTMLElement> | null} */
let ensureHoverCardInFlight = null

/**
 * @returns {void}
 */
function cancelHide() {
	if (hideTimer != null) {
		clearTimeout(hideTimer)
		hideTimer = null
	}
}

/**
 * @param {number} generation 请求世代
 * @returns {boolean} 是否仍是最新悬停请求
 */
function isCurrentShow(generation) {
	return generation === showGeneration
}

/**
 * @param {EventTarget | null} node 相关目标
 * @param {string} [selector] 文档委托锚点选择器
 * @returns {boolean} 是否仍在悬停表面（卡或另一锚点）
 */
function relatedStaysOnHoverSurface(node, selector = '') {
	if (!(node instanceof Element)) return false
	if (node.closest(`#${HOVER_CARD_ID}`)) return true
	if (node.closest(`[${HOVER_ANCHOR_ATTR}]`)) return true
	return !!(selector && node.closest(selector))
}

/**
 * 延迟隐藏悬停资料卡。
 * @returns {void}
 */
export function hideEntityProfileHoverCard() {
	const card = document.getElementById(HOVER_CARD_ID)
	if (!card) return
	cancelHide()
	const generationAtHide = showGeneration
	hideTimer = setTimeout(() => {
		if (generationAtHide !== showGeneration) return
		card.classList.remove('show')
		delete card.dataset.cacheKey
		hideTimer = null
	}, 220)
}

/**
 * @returns {Promise<HTMLElement>} 悬停卡根节点
 */
async function ensureHoverCard() {
	const existing = document.getElementById(HOVER_CARD_ID)
	if (existing instanceof HTMLElement) return existing
	ensureHoverCardInFlight ??= (async () => {
		const raced = document.getElementById(HOVER_CARD_ID)
		if (raced instanceof HTMLElement) return raced
		const card = await createEntityProfileCardElement('hover')
		const again = document.getElementById(HOVER_CARD_ID)
		if (again instanceof HTMLElement) return again
		card.id = HOVER_CARD_ID
		card.addEventListener('mouseenter', cancelHide)
		card.addEventListener('mouseleave', hideEntityProfileHoverCard)
		document.body.appendChild(card)
		return card
	})()
	try {
		return await ensureHoverCardInFlight
	}
	finally {
		ensureHoverCardInFlight = null
	}
}

/**
 * @param {HTMLElement} card 卡
 * @param {HTMLElement} anchor 锚点
 * @returns {void}
 */
function positionNearAnchor(card, anchor) {
	const rect = anchor.getBoundingClientRect()
	const width = card.offsetWidth || 320
	const height = card.offsetHeight || 360
	let left = rect.right + 8
	let top = rect.top
	if (left + width > window.innerWidth) left = rect.left - width - 8
	if (top + height > window.innerHeight) top = window.innerHeight - height - 10
	if (top < 8) top = 8
	if (left < 8) left = 8
	card.style.left = `${left}px`
	card.style.top = `${top}px`
}

/**
 * 实际绘制（仅由 paintChain 串行调用）。
 * @param {number} generation 请求世代
 * @param {HTMLElement} anchor 锚点
 * @param {{
 *   cacheKey: string,
 *   entityHash?: string | null,
 *   displayName?: string,
 *   groupId?: string,
 *   profile?: object | null,
 *   loadProfile?: () => Promise<object | null>,
 *   paintOptions?: object,
 *   attribution?: object | null,
 * }} options 选项
 * @returns {Promise<void>}
 */
async function paintHoverCard(generation, anchor, options) {
	if (!isCurrentShow(generation)) return
	const card = await ensureHoverCard()
	if (!isCurrentShow(generation)) return

	if (card.classList.contains('show') && card.dataset.cacheKey === options.cacheKey) {
		positionNearAnchor(card, anchor)
		return
	}

	const fallbackName = options.displayName || '?'
	const entityHash = options.entityHash ? String(options.entityHash).toLowerCase() : ''
	card.dataset.cacheKey = options.cacheKey
	await paintEntityProfileCard(card, { name: fallbackName }, {
		entityHash,
		nameOverride: fallbackName,
		...options.paintOptions,
	})
	if (!isCurrentShow(generation)) return
	card.classList.add('show')
	positionNearAnchor(card, anchor)

	const profile = options.profile !== undefined
		? options.profile
		: options.loadProfile
			? await options.loadProfile()
			: isEntityHash128(entityHash)
				? await fetchEntityProfileApi(entityHash, options.groupId)
					.then(data => cachedProfileFromApi(data?.profile, entityHash))
					.catch(() => null)
				: null
	if (!isCurrentShow(generation) || card.dataset.cacheKey !== options.cacheKey) return

	const resolvedHash = profile?.entityHash || entityHash
	const name = resolveDisplayName({
		entityHash: resolvedHash || undefined,
		alias: resolvedHash ? aliasForEntity(resolvedHash) : '',
		profileName: profile?.name,
		fallbackLabel: fallbackName,
	})
	await paintEntityProfileCard(card, profile || { name }, {
		entityHash: resolvedHash,
		nameOverride: name,
		...options.paintOptions,
	})
	if (!isCurrentShow(generation)) return

	let ownerName = null
	const ownerEntityHash = profile?.ownerEntityHash || null
	if (isEntityHash128(ownerEntityHash)) {
		ownerName = aliasForEntity(ownerEntityHash)
		if (!ownerName)
			try {
				const ownerData = await fetchEntityProfileApi(ownerEntityHash)
				if (!isCurrentShow(generation)) return
				ownerName = ownerData?.profile?.name || null
			}
			catch { /* miss */ }
	}
	if (!isCurrentShow(generation)) return
	paintEntityProfileExtras(card, {
		ownerEntityHash,
		ownerName,
		attribution: options.attribution || null,
	})
	positionNearAnchor(card, anchor)
}

/**
 * 在锚点旁展示共享人物卡（含 tags / handle / links / owner）。
 * @param {HTMLElement} anchor 锚点
 * @param {{
 *   cacheKey: string,
 *   entityHash?: string | null,
 *   displayName?: string,
 *   groupId?: string,
 *   profile?: object | null,
 *   loadProfile?: () => Promise<object | null>,
 *   paintOptions?: object,
 *   attribution?: object | null,
 * }} options 选项
 * @returns {Promise<void>}
 */
export function showEntityProfileHoverCard(anchor, options) {
	if (!(anchor instanceof HTMLElement) || !options?.cacheKey) return Promise.resolve()
	cancelHide()
	const generation = ++showGeneration
	paintChain = paintChain
		.then(() => paintHoverCard(generation, anchor, options))
		.catch(() => { /* 单次绘制失败不堵队列 */ })
	return paintChain
}

/**
 * 为元素绑定悬停资料卡。
 * @param {HTMLElement} el 锚点
 * @param {() => (object | null | Promise<object | null>)} resolve 返回 showEntityProfileHoverCard 选项
 * @returns {void}
 */
export function bindEntityProfileHoverAnchor(el, resolve) {
	if (!(el instanceof HTMLElement) || el.dataset.hoverBound) return
	el.dataset.hoverBound = '1'
	el.setAttribute(HOVER_ANCHOR_ATTR, '')
	el.addEventListener('mouseenter', () => {
		void (async () => {
			const options = await resolve()
			if (options) await showEntityProfileHoverCard(el, options)
		})()
	})
	el.addEventListener('mouseleave', (event) => {
		if (relatedStaysOnHoverSurface(event.relatedTarget)) return
		hideEntityProfileHoverCard()
	})
}

/**
 * 文档级悬停委托。
 * @param {string} selector 锚点选择器
 * @param {(el: HTMLElement) => (object | null | Promise<object | null>)} resolveAnchor 解析选项
 * @returns {void}
 */
export function wireEntityProfileHover(selector, resolveAnchor) {
	document.addEventListener('mouseover', (event) => {
		const target = event.target instanceof Element
			? event.target.closest(selector)
			: null
		if (!(target instanceof HTMLElement) || target.contains(event.relatedTarget)) return
		target.setAttribute(HOVER_ANCHOR_ATTR, '')
		void (async () => {
			const options = await resolveAnchor(target)
			if (options) await showEntityProfileHoverCard(target, options)
		})()
	})
	document.addEventListener('mouseout', (event) => {
		const target = event.target instanceof Element
			? event.target.closest(selector)
			: null
		if (!(target instanceof HTMLElement) || target.contains(event.relatedTarget)) return
		if (relatedStaysOnHoverSurface(event.relatedTarget, selector)) return
		hideEntityProfileHoverCard()
	})
}
