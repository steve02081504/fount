/**
 * 表情包预览卡：展示 pack 信息，并按来源提供加群 / 关注 / 收藏。
 */
import { resolvePackPresentation } from '../features/emoji/packPresentation.mjs'
import { findCollectionCapability, listEmojiProviders } from '../features/emoji/providers.mjs'
import { showToastI18n } from '../features/toast.mjs'
import { geti18n, loadPreferredLangs, primaryLocale } from '../i18n/index.mjs'
import { escapeHtml } from '../lib/escapeHtml.mjs'
import { isSafeHtmlUrl } from '../lib/sanitizeHtml.mjs'

const CARD_ID = 'fount-emoji-pack-preview'

const CHAT_API = '/api/parts/shells:chat'
const SOCIAL_API = '/api/parts/shells:social'

/** @type {(() => void) | null} */
let disposeOutsideClose = null

/**
 * @param {HTMLElement} card 卡
 * @param {HTMLElement} anchor 锚点
 * @returns {void}
 */
function positionNearAnchor(card, anchor) {
	const rect = anchor.getBoundingClientRect()
	const width = card.offsetWidth || 340
	const height = card.offsetHeight || 280
	let left = rect.left
	let top = rect.bottom + 8
	if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
	if (top + height > window.innerHeight - 8) top = rect.top - height - 8
	if (top < 8) top = 8
	if (left < 8) left = 8
	card.style.left = `${left}px`
	card.style.top = `${top}px`
}

/**
 * @returns {HTMLElement} 预览卡根
 */
function ensureCard() {
	let card = document.getElementById(CARD_ID)
	if (card instanceof HTMLElement) return card
	card = document.createElement('div')
	card.id = CARD_ID
	card.className = 'emoji-pack-preview'
	card.setAttribute('role', 'dialog')
	document.body.appendChild(card)
	return card
}

/**
 * @returns {void}
 */
export function hideEmojiPackPreview() {
	disposeOutsideClose?.()
	disposeOutsideClose = null
	const card = document.getElementById(CARD_ID)
	if (!(card instanceof HTMLElement)) return
	card.classList.remove('show')
	card.replaceChildren()
}

/**
 * @param {HTMLElement} panel 面板
 * @param {HTMLElement} [alsoInside] 额外内部
 * @returns {() => void} dispose
 */
function wirePreviewOutsideClose(panel, alsoInside) {
	/**
	 * @param {Event} event 点击
	 * @returns {void}
	 */
	const close = event => {
		if (panel.contains(event.target) || alsoInside?.contains(event.target)) return
		hideEmojiPackPreview()
	}
	const timer = setTimeout(() => document.addEventListener('click', close, true), 0)
	return () => {
		clearTimeout(timer)
		document.removeEventListener('click', close, true)
	}
}

/**
 * @param {string | null | undefined} url 候选 URL
 * @returns {string | null} 同源绝对 URL；否则 null
 */
function sameOriginHref(url) {
	const raw = String(url ?? '').trim()
	if (!raw || !isSafeHtmlUrl(raw)) return null
	try {
		const resolved = new URL(raw, location.href)
		return resolved.origin === location.origin ? resolved.href : null
	}
	catch {
		return null
	}
}

/**
 * @param {string[]} locales locales
 * @param {object} pack pack
 * @returns {object} 展示字段
 */
function presentationOf(locales, pack) {
	return resolvePackPresentation(pack, locales, pack.infoDefaults || {})
}

/**
 * @param {HTMLElement} actions 容器
 * @param {string} labelKey i18n
 * @param {string} className 按钮类
 * @param {() => void | Promise<void>} onClick 点击
 * @returns {HTMLButtonElement} 按钮
 */
function appendAction(actions, labelKey, className, onClick) {
	const button = document.createElement('button')
	button.type = 'button'
	button.className = className
	button.dataset.i18n = labelKey
	button.textContent = geti18n(labelKey) || labelKey
	button.addEventListener('click', () => {
		void Promise.resolve(onClick()).catch(error => {
			showToastI18n('error', 'chat.emoji.previewActionFailed', { error: error.message || String(error) })
		})
	})
	actions.appendChild(button)
	return button
}

/**
 * @param {object} pack pack
 * @param {object | null} provider provider
 * @returns {Promise<object | null>} collection 能力
 */
async function resolveCollection(pack, provider) {
	if (provider?.collection) return provider.collection
	if (pack?.sourceProvider?.collection) return pack.sourceProvider.collection
	const providers = await listEmojiProviders()
	return findCollectionCapability(providers)
}

/**
 * @param {HTMLElement} anchor 锚点
 * @param {{
 *   pack: object,
 *   provider?: object | null,
 *   emojiName?: string,
 *   available?: boolean,
 * }} options 选项
 * @returns {Promise<void>}
 */
export async function showEmojiPackPreview(anchor, options) {
	if (!(anchor instanceof HTMLElement) || !options?.pack) return
	const card = ensureCard()
	const pack = options.pack
	const provider = options.provider || pack.sourceProvider || null
	const preferredLangs = loadPreferredLangs()
	const locales = preferredLangs.length ? preferredLangs : [primaryLocale()]
	const presentation = presentationOf(locales, pack)
	const available = options.available !== false

	const avatarUrl = isSafeHtmlUrl(presentation.avatar) ? String(presentation.avatar).trim() : ''
	const avatarHtml = avatarUrl
		? `<img class="emoji-pack-preview-avatar svg-inliner-ignore" src="${escapeHtml(avatarUrl)}" alt="" />`
		: `<div class="emoji-pack-preview-avatar-fallback" aria-hidden="true">${escapeHtml((presentation.name || '?').slice(0, 1))}</div>`

	const tagsHtml = (presentation.tags || []).map(tag =>
		`<span class="emoji-pack-preview-tag">${escapeHtml(String(tag))}</span>`,
	).join('')

	const linksHtml = (presentation.links || []).map(link => {
		const url = String(link?.url || '').trim()
		if (!isSafeHtmlUrl(url)) return ''
		const name = String(link?.name || url).trim()
		return `<a class="emoji-pack-preview-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>`
	}).join('')

	const emojiName = String(options.emojiName || '').trim()
	card.innerHTML = `
		<div class="emoji-pack-preview-head">
			${avatarHtml}
			<div>
				<h3 class="emoji-pack-preview-title"></h3>
				${emojiName ? '<p class="emoji-pack-preview-emoji-name"></p>' : ''}
			</div>
		</div>
		${presentation.description ? '<p class="emoji-pack-preview-desc"></p>' : ''}
		${tagsHtml ? `<div class="emoji-pack-preview-tags">${tagsHtml}</div>` : ''}
		${linksHtml ? `<div class="emoji-pack-preview-links">${linksHtml}</div>` : ''}
		<p class="emoji-pack-preview-meta" hidden></p>
		<div class="emoji-pack-preview-actions"></div>
	`
	card.querySelector('.emoji-pack-preview-title').textContent = presentation.name || pack.packId
	if (emojiName) card.querySelector('.emoji-pack-preview-emoji-name').textContent = emojiName
	const descEl = card.querySelector('.emoji-pack-preview-desc')
	if (descEl) descEl.textContent = presentation.description
	const metaEl = card.querySelector('.emoji-pack-preview-meta')
	const actions = card.querySelector('.emoji-pack-preview-actions')

	card.classList.add('show')
	positionNearAnchor(card, anchor)
	disposeOutsideClose?.()
	disposeOutsideClose = wirePreviewOutsideClose(card, anchor)

	const sourcePreview = await provider?.packSourcePreview?.(pack)
	const collection = await resolveCollection(pack, provider)

	if (sourcePreview?.kind === 'group') {
		const preview = sourcePreview.preview || {}
		const title = preview.title || sourcePreview.groupId
		metaEl.hidden = false
		metaEl.textContent = geti18n('chat.emoji.previewGroupMeta', { name: title }) || title
		if (preview.isMember)
			appendAction(actions, 'chat.emoji.alreadyMember', 'btn btn-ghost btn-sm', () => {
				const fallback = `/parts/shells:chat/hub/#group:${encodeURIComponent(sourcePreview.groupId)}:default`
				window.location.href = sameOriginHref(preview.hubUrl) || fallback
			})
		else if (preview.canJoin)
			appendAction(actions, 'chat.emoji.joinGroup', 'btn btn-primary btn-sm', async () => {
				const r = await fetch(`${CHAT_API}/groups/${encodeURIComponent(sourcePreview.groupId)}/join`, {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: '{}',
				})
				if (!r.ok) throw new Error(await r.text() || r.statusText)
				hideEmojiPackPreview()
				window.location.href = `/parts/shells:chat/hub/#group:${encodeURIComponent(sourcePreview.groupId)}:default`
			})
	}
	else if (sourcePreview?.kind === 'entity') {
		const entityHash = sourcePreview.entityHash
		metaEl.hidden = false
		metaEl.textContent = geti18n('chat.emoji.previewAuthorMeta') || entityHash.slice(0, 8)
		appendAction(actions, 'chat.emoji.followAuthor', 'btn btn-primary btn-sm', async () => {
			const r = await fetch(`${SOCIAL_API}/relationships/follow`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ entityHash, follow: true }),
			})
			if (!r.ok) throw new Error(await r.text() || r.statusText)
			showToastI18n('success', 'chat.emoji.followSuccess')
			hideEmojiPackPreview()
		})
		appendAction(actions, 'chat.emoji.openAuthor', 'btn btn-ghost btn-sm', async () => {
			const { showEntityProfileHoverCard } = await import('/parts/shells:chat/shared/entityProfileHoverCard.mjs')
			await showEntityProfileHoverCard(anchor, {
				cacheKey: `emoji-pack:${entityHash}`,
				entityHash,
				displayName: presentation.author || presentation.name,
				wireActions: true,
			})
			hideEmojiPackPreview()
		})
	}

	if (available && collection?.add && pack.packId)
		appendAction(actions, 'chat.emoji.addToCollection', 'btn btn-outline btn-sm', async () => {
			await collection.add(pack.packId)
			showToastI18n('success', 'chat.emoji.addedToCollection')
			hideEmojiPackPreview()
		})

	positionNearAnchor(card, anchor)
}

// --- 全局样式注入 ---

document.head.prepend(Object.assign(document.createElement('link'), {
	rel: 'stylesheet',
	href: '/scripts/components/emojiPackPreview.css',
}))
