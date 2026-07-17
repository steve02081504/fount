/**
 * 【文件】public/shared/entityProfileCard.mjs
 * 【职责】跨壳实体资料归一化与人物卡附属区块（所属方 / 归因警告）绘制。
 * 【原理】API profile → 统一字段；owner / attribution 用 data-* 宿主节点填充；链接走 Social profile hash。
 * bio 只吃 markdown 源，本机 processFountMessageMarkdown 安全渲染后挂载，不信任对端 HTML、也不对源做 escapeHtml。
 */
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { createDocumentFragmentFromHtmlStringNoScriptActivation } from '/scripts/features/template.mjs'
import { formatSocialProfileHref } from '/parts/shells:social/shared/runUri.mjs'
import { applyProfileAvatarToHost } from '../hub/core/avatarCover.mjs'
import { processFountMessageMarkdown } from '../src/lib/fountMessageMarkdown.mjs'
import { isTrustedMarkdownAuthor } from '../src/trustedAuthors.mjs'

import { aliasForEntity } from './aliases.mjs'
import { entityHashLabel, formatEntityAtId, isEntityHash128 } from './entityHash.mjs'
import { customProfileAvatar, entityProfilePattern, isAvatarImageUrl } from './hashAvatar.mjs'

/**
 * 清扫远端资料链接，只允许浏览器安全的网页协议。
 * @param {string} raw 原始链接
 * @returns {string|null} 可展示链接
 */
function safeProfileLink(raw) {
	try {
		const url = new URL(String(raw || ''), location.origin)
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
	}
	catch {
		return null
	}
}

const ENTITY_PROFILE_CARD_STYLESHEET = '/parts/shells:chat/shared/entityProfileCard.css'
const ENTITY_PROFILE_BANNER_STYLESHEET = '/parts/shells:chat/shared/entityProfileBanner.css'

/**
 * 跨壳弹出人物卡时按需挂载共享样式。
 * @returns {void}
 */
export function ensureEntityProfileCardStyles() {
	for (const href of [ENTITY_PROFILE_BANNER_STYLESHEET, ENTITY_PROFILE_CARD_STYLESHEET]) {
		if (document.querySelector(`link[href="${href}"]`)) continue
		const link = document.createElement('link')
		link.rel = 'stylesheet'
		link.href = href
		document.head.appendChild(link)
	}
}

/**
 * 将 hash 纹理 / 自定义 banner 应用到 banner 元素。
 * @param {HTMLElement} host 设 data-profile-pattern 的宿主
 * @param {HTMLElement} bannerEl banner 节点（应含 .entity-profile-banner）
 * @param {{ entityHash: string, banner?: string, themeColor?: string }} options 选项
 * @returns {void}
 */
export function paintEntityProfileBanner(host, bannerEl, options) {
	if (!(host instanceof HTMLElement) || !(bannerEl instanceof HTMLElement)) return
	const entityHash = String(options.entityHash || '')
	const pattern = entityProfilePattern(entityHash)
	host.dataset.profilePattern = pattern.variant
	host.style.setProperty('--entity-card-accent', options.themeColor || '#5865f2')
	host.style.setProperty('--entity-card-pattern-angle', `${pattern.angle}deg`)
	host.style.setProperty('--entity-card-pattern-size', `${pattern.size}px`)
	host.style.setProperty('--entity-card-pattern-x', `${pattern.offsetX}px`)
	host.style.setProperty('--entity-card-pattern-y', `${pattern.offsetY}px`)
	const bannerUrl = isAvatarImageUrl(options.banner) ? String(options.banner).trim() : ''
	bannerEl.classList.add('entity-profile-banner')
	bannerEl.classList.toggle('entity-profile-banner--image', !!bannerUrl)
	bannerEl.classList.toggle('hub-profile-popup-banner--image', !!bannerUrl)
	if (bannerUrl) {
		bannerEl.style.backgroundImage = `linear-gradient(rgb(0 0 0 / 18%), rgb(0 0 0 / 28%)), url(${JSON.stringify(bannerUrl)})`
		bannerEl.style.backgroundSize = 'cover, cover'
		bannerEl.style.backgroundPosition = 'center, center'
	}
	else {
		bannerEl.style.removeProperty('background-image')
		bannerEl.style.removeProperty('background-size')
		bannerEl.style.removeProperty('background-position')
	}
}

/**
 * 将 API profile 归一化为跨壳展示结构。
 * @param {object | null | undefined} profile API profile
 * @param {string} entityHash 128 hex
 * @returns {object | null} 归一化资料
 */
export function normalizeEntityProfile(profile, entityHash) {
	if (!profile && !entityHash) return null
	const key = String(entityHash || '').toLowerCase()
	return {
		entityHash: key,
		avatar: customProfileAvatar(profile) || null,
		name: profile?.name || (key ? entityHashLabel(key) : '?'),
		handle: profile?.handle || null,
		themeColor: profile?.themeColor || '',
		banner: String(profile?.banner || '').trim(),
		description: profile?.description || '',
		description_markdown: profile?.description_markdown || '',
		tags: Array.isArray(profile?.tags) ? profile.tags : [],
		links: Array.isArray(profile?.links) ? profile.links : [],
		status: profile?.effectiveStatus || profile?.status || 'offline',
		customStatus: profile?.customStatus || '',
		ownerEntityHash: profile?.ownerEntityHash
			? String(profile.ownerEntityHash).toLowerCase()
			: null,
		activePubKeyHex: profile?.activePubKeyHex || null,
		keyGeneration: profile?.keyGeneration ?? null,
	}
}

/**
 * 设置共享人物卡的嵌入模式；资料弹窗、资料页和编辑预览使用同一份结构。
 * @param {HTMLElement} root 人物卡根节点
 * @param {'popup'|'embedded'|'preview'} mode 使用场景
 * @returns {void}
 */
export function configureEntityProfileCard(root, mode = 'popup') {
	if (!(root instanceof HTMLElement)) return
	root.classList.toggle('entity-profile-card--embedded', mode === 'embedded')
	root.classList.toggle('entity-profile-card--preview', mode === 'preview')
	if (mode === 'popup') return
	root.querySelector('[data-profile-popup-close]')?.remove()
	for (const button of root.querySelectorAll('[data-profile-popup-edit], [data-profile-popup-care], [data-profile-popup-alias], [data-profile-popup-dm], [data-profile-popup-social]'))
		button.remove()
}

/**
 * 使用共享人物卡结构绘制资料；可用于真实资料和编辑中的临时资料。
 * @param {HTMLElement} root 人物卡根节点
 * @param {object} profile API 或编辑态资料
 * @param {{ entityHash?: string, avatarOverride?: string, bannerOverride?: string, nameOverride?: string, selfEntityHash?: string | null }} [options] 绘制选项
 * @returns {Promise<void>}
 */
export async function paintEntityProfileCard(root, profile, options = {}) {
	if (!(root instanceof HTMLElement)) return
	const entityHash = String(options.entityHash || profile?.entityHash || root.dataset.entityHash || '')
	const normalized = normalizeEntityProfile(profile, entityHash)
	if (!normalized) return
	const name = options.nameOverride || normalized.name
	const avatar = options.avatarOverride === undefined ? normalized.avatar : options.avatarOverride
	const banner = options.bannerOverride === undefined ? normalized.banner : options.bannerOverride
	root.dataset.entityHash = entityHash
	const pattern = entityProfilePattern(entityHash || name)
	root.dataset.profilePattern = pattern.variant
	root.style.setProperty('--entity-card-accent', normalized.themeColor || '#5865f2')
	root.style.setProperty('--entity-card-pattern-angle', `${pattern.angle}deg`)
	root.style.setProperty('--entity-card-pattern-size', `${pattern.size}px`)
	root.style.setProperty('--entity-card-pattern-x', `${pattern.offsetX}px`)
	root.style.setProperty('--entity-card-pattern-y', `${pattern.offsetY}px`)

	const bannerElement = root.querySelector('.hub-profile-popup-banner')
	if (bannerElement instanceof HTMLElement)
		paintEntityProfileBanner(root, bannerElement, {
			entityHash: entityHash || name,
			banner,
			themeColor: normalized.themeColor || '#5865f2',
		})


	const nameElement = root.querySelector('[data-entity-profile-name]')
	if (nameElement) nameElement.textContent = name
	const handleElement = root.querySelector('[data-entity-profile-handle]')
	if (handleElement)
		handleElement.textContent = formatEntityAtId(entityHash, { handle: normalized.handle })

	const avatarElement = root.querySelector('[data-entity-profile-avatar]')
	if (avatarElement instanceof HTMLElement)
		await applyProfileAvatarToHost(avatarElement, {
			seed: entityHash || name,
			label: name,
			avatar,
			emojiFontSize: '30px',
			letterClass: 'hub-avatar-letter',
		})

	const status = normalized.status === 'away'
		? 'idle'
		: normalized.status === 'busy'
			? 'dnd'
			: normalized.status
	const statusDot = root.querySelector('[data-entity-profile-status-dot]')
	if (statusDot instanceof HTMLElement) statusDot.dataset.status = status
	const statusText = root.querySelector('[data-entity-profile-status-text]')
	if (statusText instanceof HTMLElement) 
		if (normalized.customStatus) {
			delete statusText.dataset.i18n
			statusText.textContent = normalized.customStatus
		}
		else {
			statusText.textContent = ''
			statusText.dataset.i18n = `profile.statusOptions.${normalized.status}`
		}
	

	const bioElement = root.querySelector('[data-entity-profile-bio]')
	if (bioElement instanceof HTMLElement)
		await paintEntityProfileBio(bioElement, profileDescriptionText(normalized), entityHash, {
			selfEntityHash: options.selfEntityHash,
		})

	const tagsHost = root.querySelector('[data-entity-profile-tags]')
	if (tagsHost instanceof HTMLElement) {
		tagsHost.replaceChildren(...normalized.tags.filter(Boolean).map(tag => {
			const chip = document.createElement('span')
			chip.className = 'hub-profile-tag'
			chip.textContent = `#${String(tag).replace(/^#+/, '')}`
			return chip
		}))
		tagsHost.hidden = !tagsHost.childElementCount
	}

	const linksHost = root.querySelector('[data-entity-profile-links]')
	if (linksHost instanceof HTMLElement) {
		linksHost.replaceChildren(...normalized.links.flatMap(link => {
			const safeUrl = safeProfileLink(link?.url)
			if (!safeUrl) return []
			const anchor = document.createElement('a')
			anchor.className = 'entity-profile-card-link'
			anchor.href = safeUrl
			anchor.target = '_blank'
			anchor.rel = 'noopener noreferrer'
			anchor.textContent = link.name || link.url
			return [anchor]
		}))
		linksHost.hidden = !linksHost.childElementCount
	}
	paintEntityProfileExtras(root, { ownerEntityHash: normalized.ownerEntityHash })
}

/**
 * 简介 markdown 源（优先 description_markdown；忽略任何对端预渲染 HTML 字段）。
 * @param {object | null | undefined} profile 资料
 * @returns {string} 简介
 */
export function profileDescriptionText(profile) {
	const md = String(profile?.description_markdown || '').trim()
	if (md) return md
	return String(profile?.description || profile?.bio || '').trim()
}

/**
 * 将简介 markdown 源本机安全渲染进宿主（可信作者走 allowDangerousHtml，否则 sanitize）。
 * @param {HTMLElement} bioElement 简介容器
 * @param {string} markdown markdown 源
 * @param {string} [entityHash] 作者 entityHash / pubKeyHash（决定信任）
 * @param {{ emptyI18n?: string, selfEntityHash?: string | null }} [options] 空态 i18n / 本人实体
 * @returns {Promise<void>}
 */
export async function paintEntityProfileBio(bioElement, markdown, entityHash = '', options = {}) {
	if (!(bioElement instanceof HTMLElement)) return
	const text = String(markdown || '').trim()
	const emptyI18n = options.emptyI18n || 'chat.hub.bioEmpty'
	if (!text) {
		bioElement.replaceChildren()
		bioElement.classList.remove('markdown-body')
		bioElement.dataset.i18n = emptyI18n
		return
	}
	delete bioElement.dataset.i18n
	bioElement.classList.add('markdown-body')
	const trusted = entityHash
		? await isTrustedMarkdownAuthor(entityHash, { selfEntityHash: options.selfEntityHash })
		: false
	const html = await processFountMessageMarkdown(text, trusted)
	bioElement.replaceChildren(createDocumentFragmentFromHtmlStringNoScriptActivation(html))
}

/**
 * 渲染「此实体为 xxx 所有」节点（owner 需 HTML 插值，故用 geti18n；不改全局 templatePath）。
 * @param {string | null | undefined} ownerEntityHash 主人
 * @param {{ ownerName?: string | null, linkHref?: string | null }} [options] 选项
 * @returns {HTMLElement | null} 节点；无主人时为 null
 */
export function renderOwnedByBox(ownerEntityHash, options = {}) {
	const owner = String(ownerEntityHash || '').trim().toLowerCase()
	if (!isEntityHash128(owner)) return null
	const label = options.ownerName
		|| aliasForEntity(owner)
		|| entityHashLabel(owner)
	const href = options.linkHref || formatSocialProfileHref(owner)
	const ownerLink = `<a class="entity-owned-by-link link link-hover" href="${escapeHtml(href)}" data-entity-owned-by-link="${escapeHtml(owner)}">${escapeHtml(label)}</a>`
	const box = document.createElement('div')
	box.className = 'entity-owned-by-box'
	box.dataset.entityOwnedBy = owner
	box.innerHTML = geti18n('entityProfile.ownedBy', { owner: ownerLink })
	return box
}

/**
 * @param {string | null | undefined} ownerEntityHash 主人
 * @param {{ ownerName?: string | null, linkHref?: string | null }} [options] 选项
 * @returns {string} HTML
 */
export function renderOwnedByBoxHtml(ownerEntityHash, options = {}) {
	const box = renderOwnedByBox(ownerEntityHash, options)
	return box ? box.outerHTML : ''
}

/**
 * 人名旁归因警告图标。
 * @param {object | null | undefined} attribution 归因
 * @returns {HTMLElement | null} 节点
 */
export function renderAttributionWarningIcon(attribution) {
	if (!attribution?.mismatch) return null
	const span = document.createElement('span')
	span.className = 'entity-attribution-warning-icon-inline'
	span.role = 'img'
	span.dataset.i18n = 'entityProfile.attributionMismatchShort'
	span.dataset.attributionWarningIcon = ''
	span.textContent = '⚠'
	return span
}

/**
 * @param {object | null | undefined} attribution 归因
 * @returns {string} HTML
 */
export function renderAttributionWarningIconHtml(attribution) {
	const node = renderAttributionWarningIcon(attribution)
	return node ? node.outerHTML : ''
}

/**
 * 在人物卡根节点填充所属方与归因警告区块。
 * @param {HTMLElement} root 根
 * @param {{ ownerEntityHash?: string | null, ownerName?: string | null, attribution?: object | null, ownerLinkHref?: string | null }} options 选项
 * @returns {void}
 */
export function paintEntityProfileExtras(root, options = {}) {
	if (!(root instanceof HTMLElement)) return
	const ownerHost = root.querySelector('[data-entity-owned-by-host]')
	if (ownerHost instanceof HTMLElement) {
		const box = renderOwnedByBox(options.ownerEntityHash, {
			ownerName: options.ownerName,
			linkHref: options.ownerLinkHref,
		})
		ownerHost.replaceChildren(...box ? [box] : [])
		ownerHost.hidden = !box
	}
	const warnHost = root.querySelector('[data-entity-attribution-warning-host]')
	if (warnHost instanceof HTMLElement) 
		if (options.attribution?.mismatch) {
			const box = document.createElement('div')
			box.className = 'entity-attribution-warning-box'
			box.role = 'alert'
			box.dataset.entityAttributionWarning = ''
			const icon = document.createElement('span')
			icon.className = 'entity-attribution-warning-icon'
			icon.setAttribute('aria-hidden', 'true')
			icon.textContent = '⚠'
			const text = document.createElement('span')
			text.className = 'entity-attribution-warning-text'
			text.dataset.i18n = 'entityProfile.attributionMismatch'
			box.append(icon, text)
			warnHost.replaceChildren(box)
			warnHost.hidden = false
		}
		else {
			warnHost.replaceChildren()
			warnHost.hidden = true
		}
	
}
