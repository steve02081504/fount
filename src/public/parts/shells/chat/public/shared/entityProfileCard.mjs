/**
 * 【文件】public/shared/entityProfileCard.mjs
 * 【职责】跨壳实体资料归一化与人物卡附属区块（所属方 / 归因警告）绘制。
 * 【原理】API profile → 统一字段；owner / attribution 用 data-* 宿主节点填充；链接走 Social profile hash。
 * bio 只吃 markdown 源，本机安全/可信两档渲染后挂载，不信任对端 HTML、也不对源做 escapeHtml。
 * 悬停 / 点击弹层 / 嵌入页共用 `hub/profile_popup` 模板与 `paintEntityProfileCard`，勿另起视觉壳。
 */
import { renderTemplate } from '/parts/shells:chat/src/templates.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { formatSocialProfileHref } from '/parts/shells:social/shared/runUri.mjs'
import { applyProfileAvatarToHost } from '../hub/core/avatarCover.mjs'

import { aliasForEntity } from './aliases.mjs'
import { entityHashLabel, formatEntityAtId, isEntityHash128 } from './entityHash.mjs'
import { displayProfileAvatar, entityProfilePattern } from './hashAvatar.mjs'
import { safeProfileLink } from './safeProfileLink.mjs'
import { mountTrustedMarkdown } from './trustedMarkdown.mjs'

const ENTITY_PROFILE_CARD_STYLESHEET = '/parts/shells:chat/shared/entityProfileCard.css'
const ENTITY_PROFILE_BANNER_STYLESHEET = '/parts/shells:chat/shared/entityProfileBanner.css'

/**
 * 未指定 profile 主题色时，按当前使用主题生成的默认强调色。
 * @constant {string}
 */
const THEME_DEFAULT_ACCENT = 'var(--color-primary, var(--color-base-content))'

/**
 * 「关于」折叠阈值：简介 markdown 源的非空行超过该行数才提供展开/折叠。
 * @constant {number}
 */
const ABOUT_FOLD_MAX_SOURCE_LINES = 11

/**
 * 取实体卡强调色；未指定主题色时回退为当前主题的默认强调色。
 * @param {string | undefined | null} themeColor profile 主题色
 * @returns {string} 强调色值
 */
function entityAccentColor(themeColor) {
	return themeColor || THEME_DEFAULT_ACCENT
}

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
	const entityHash = options.entityHash || ''
	const pattern = entityProfilePattern(entityHash)
	host.dataset.profilePattern = pattern.variant
	host.style.setProperty('--entity-card-accent', entityAccentColor(options.themeColor))
	host.style.setProperty('--entity-card-pattern-angle', `${pattern.angle}deg`)
	host.style.setProperty('--entity-card-pattern-size', `${pattern.size}px`)
	host.style.setProperty('--entity-card-pattern-x', `${pattern.offsetX}px`)
	host.style.setProperty('--entity-card-pattern-y', `${pattern.offsetY}px`)
	const bannerUrl = options.banner || ''
	bannerEl.classList.add('entity-profile-banner')
	bannerEl.classList.toggle('entity-profile-banner--image', !!bannerUrl)
	bannerEl.classList.toggle('profile-popup-banner--image', !!bannerUrl)
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
	return {
		entityHash,
		avatar: displayProfileAvatar(profile) || null,
		name: profile?.name || (entityHash ? entityHashLabel(entityHash) : '?'),
		handle: profile?.handle || null,
		themeColor: profile?.themeColor || '',
		banner: String(profile?.displayBanner || profile?.banner || '').trim(),
		description: profile?.description || '',
		description_markdown: profile?.description_markdown || '',
		tags: Array.isArray(profile?.tags) ? profile.tags : [],
		links: Array.isArray(profile?.links) ? profile.links : [],
		status: profile?.effectiveStatus || profile?.status || 'offline',
		customStatus: profile?.customStatus || '',
		ownerEntityHash: profile?.ownerEntityHash || null,
		activePubKeyHex: profile?.activePubKeyHex || null,
		keyGeneration: profile?.keyGeneration ?? null,
	}
}

/**
 * 克隆共享人物卡 DOM（`hub/profile_popup`）；经 chat bound templates API，跨壳安全。
 * @param {'popup'|'embedded'|'preview'|'hover'|'sidebar'} [mode='popup'] 使用场景
 * @returns {Promise<HTMLElement>} 人物卡根节点
 */
export async function createEntityProfileCardElement(mode = 'popup') {
	ensureEntityProfileCardStyles()
	const root = await renderTemplate('hub/profile_popup', {})
	if (!(root instanceof HTMLElement)) throw new Error('profile_popup template root missing')
	configureEntityProfileCard(root, mode)
	return root
}

/**
 * 设置共享人物卡的嵌入模式；悬停、弹窗、资料页和编辑预览使用同一份结构。
 * @param {HTMLElement} root 人物卡根节点
 * @param {'popup'|'embedded'|'preview'|'hover'|'sidebar'} mode 使用场景
 * @returns {void}
 */
export function configureEntityProfileCard(root, mode = 'popup') {
	if (!(root instanceof HTMLElement)) return
	root.classList.toggle('entity-profile-card--embedded', mode === 'embedded')
	root.classList.toggle('entity-profile-card--preview', mode === 'preview')
	root.classList.toggle('entity-profile-card--hover', mode === 'hover')
	root.classList.toggle('entity-profile-card--sidebar', mode === 'sidebar')
	if (mode === 'hover') {
		root.setAttribute('role', 'region')
		root.dataset.i18n = 'chat.hub.profilePopup'
	}
	if (mode === 'popup') return
	root.querySelector('[data-profile-popup-close]')?.remove()
	if (mode === 'preview' || mode === 'embedded')
		for (const button of root.querySelectorAll('[data-profile-popup-edit], [data-profile-popup-care], [data-profile-popup-alias], [data-profile-popup-dm], [data-profile-popup-social], [data-profile-popup-trust], [data-profile-popup-copy-contact]'))
			button.remove()
}

/**
 * 使用共享人物卡结构绘制资料；可用于真实资料和编辑中的临时资料。
 * @param {HTMLElement} root 人物卡根节点
 * @param {object} profile API 或编辑态资料
 * @param {{ entityHash?: string, avatarOverride?: string, bannerOverride?: string, nameOverride?: string, selfEntityHash?: string | null, nodeHash?: string | null, viewerOwnerEntityHash?: string | null }} [options] 绘制选项
 * @returns {Promise<void>}
 */
export async function paintEntityProfileCard(root, profile, options = {}) {
	if (!(root instanceof HTMLElement)) return
	const entityHash = options.entityHash || profile?.entityHash || root.dataset.entityHash || ''
	const normalized = normalizeEntityProfile(profile, entityHash)
	if (!normalized) return
	const name = options.nameOverride || normalized.name
	const avatar = options.avatarOverride === undefined ? normalized.avatar : options.avatarOverride
	const banner = options.bannerOverride === undefined ? normalized.banner : options.bannerOverride
	root.dataset.entityHash = entityHash
	const pattern = entityProfilePattern(entityHash || name)
	root.dataset.profilePattern = pattern.variant
	root.style.setProperty('--entity-card-accent', entityAccentColor(normalized.themeColor))
	root.style.setProperty('--entity-card-pattern-angle', `${pattern.angle}deg`)
	root.style.setProperty('--entity-card-pattern-size', `${pattern.size}px`)
	root.style.setProperty('--entity-card-pattern-x', `${pattern.offsetX}px`)
	root.style.setProperty('--entity-card-pattern-y', `${pattern.offsetY}px`)

	const bannerElement = root.querySelector('.profile-popup-banner')
	if (bannerElement instanceof HTMLElement)
		paintEntityProfileBanner(root, bannerElement, {
			entityHash: entityHash || name,
			banner,
			themeColor: normalized.themeColor,
		})

	const nameElement = root.querySelector('[data-entity-profile-name]')
	if (nameElement) nameElement.textContent = name
	const handleElement = root.querySelector('[data-entity-profile-handle]')
	if (handleElement)
		handleElement.textContent = formatEntityAtId(entityHash, { handle: normalized.handle })

	const avatarElement = root.querySelector('[data-entity-profile-avatar]')
	if (avatarElement instanceof HTMLElement)
		applyProfileAvatarToHost(avatarElement, {
			seed: entityHash || name,
			label: name,
			avatar,
			letterClass: 'avatar-letter',
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
			statusText.dataset.i18n = `chat.profile.statusOptions.${normalized.status}`
		}

	const bioElement = root.querySelector('[data-entity-profile-bio]')
	if (bioElement instanceof HTMLElement)
		await paintEntityProfileBio(bioElement, profileDescriptionText(normalized), entityHash, {
			selfEntityHash: options.selfEntityHash,
			nodeHash: options.nodeHash,
			viewerOwnerEntityHash: options.viewerOwnerEntityHash,
		})

	const tagsHost = root.querySelector('[data-entity-profile-tags]')
	if (tagsHost instanceof HTMLElement) {
		tagsHost.replaceChildren(...normalized.tags.filter(Boolean).map(tag => {
			const chip = document.createElement('span')
			chip.className = 'profile-tag'
			chip.textContent = `#${String(tag).replace(/^#+/, '')}`
			chip.setAttribute('user-content', '')
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
 * 刷新「展开 / 收起」按钮的文案与 aria 状态。
 * @param {HTMLButtonElement} button 按钮
 * @param {boolean} expanded 是否已展开
 * @returns {void}
 */
function paintBioToggleLabel(button, expanded) {
	button.dataset.i18n = expanded ? 'social.feed.showLess' : 'social.feed.showMore'
	button.setAttribute('aria-expanded', String(expanded))
}

/**
 * 绑定「展开 / 收起」按钮（每张卡只绑一次）。
 * @param {HTMLElement} wrap 简介包裹层
 * @returns {void}
 */
function wireBioToggle(wrap) {
	const button = wrap.querySelector('[data-profile-popup-bio-toggle]')
	if (!(button instanceof HTMLButtonElement) || wrap.dataset.bioToggleBound === '1') return
	wrap.dataset.bioToggleBound = '1'
	button.addEventListener('click', () => {
		const expanded = wrap.classList.toggle('is-expanded')
		paintBioToggleLabel(button, expanded)
	})
}

/**
 * 量简介是否被折叠高度裁掉。
 * @param {HTMLElement} bioElement 简介容器
 * @returns {boolean | null} 是否被裁切；卡片还没挂载 / 不可见（量不到布局）时返回 null
 */
function isBioClipped(bioElement) {
	if (!bioElement.isConnected || bioElement.clientHeight === 0) return null
	return bioElement.scrollHeight > bioElement.clientHeight + 1
}

/**
 * 落定「关于」折叠态：折叠时给按钮，「展开」后不再加渐隐。
 * @param {HTMLElement} wrap 简介包裹层
 * @param {Element | null} button 展开 / 收起按钮
 * @param {boolean} foldable 是否折叠
 * @param {boolean | null} clipped 是否真的被裁切（null = 量不到，先不加渐隐）
 * @returns {void}
 */
function finishAboutFold(wrap, button, foldable, clipped) {
	wrap.classList.toggle('is-foldable', foldable)
	wrap.classList.toggle('is-clipped', clipped === true)
	if (!foldable) wrap.classList.remove('is-expanded')
	if (!(button instanceof HTMLButtonElement)) return
	button.hidden = !foldable
	if (foldable) paintBioToggleLabel(button, wrap.classList.contains('is-expanded'))
}

/**
 * 卡片还没挂载 / 不可见时量不到布局：等它拿到尺寸后再补测一次折叠态。
 * @param {HTMLElement} bioElement 简介容器
 * @param {string} markdown 简介 markdown 源
 * @returns {void}
 */
function remeasureAboutFoldWhenSized(bioElement, markdown) {
	if (typeof ResizeObserver !== 'function') return
	const observer = new ResizeObserver(() => {
		if (isBioClipped(bioElement) === null) return
		observer.disconnect()
		applyAboutFold(bioElement, markdown, { retry: true })
	})
	observer.observe(bioElement)
}

/**
 * 应用「关于」折叠：简介源非空行超过 {@link ABOUT_FOLD_MAX_SOURCE_LINES} 行且真被裁到「头几行」时折叠，
 * 否则全文正常显示、不给展开按钮。
 *
 * 只数 markdown 源行数决定要不要量；卡片尚未挂载时量不到布局，先按源行数给按钮，拿到尺寸后补测一次。
 * @param {HTMLElement} bioElement 简介容器
 * @param {string} markdown 简介 markdown 源
 * @param {{ retry?: boolean }} [options] retry = 补测（不再等尺寸）
 * @returns {void}
 */
function applyAboutFold(bioElement, markdown, options = {}) {
	const wrap = bioElement.closest('.profile-popup-bio-wrap')
	if (!(wrap instanceof HTMLElement)) return
	wireBioToggle(wrap)
	const button = wrap.querySelector('[data-profile-popup-bio-toggle]')
	const sourceFoldable = markdown.split(/\r\n|\r|\n/).filter(line => line.trim()).length > ABOUT_FOLD_MAX_SOURCE_LINES
	if (!sourceFoldable) {
		finishAboutFold(wrap, button, false, false)
		return
	}
	// 先按折叠态渲染，再量正文是否真的超出「头几行」
	wrap.classList.add('is-foldable')
	const clipped = isBioClipped(bioElement)
	if (clipped === null && !options.retry) remeasureAboutFoldWhenSized(bioElement, markdown)
	finishAboutFold(wrap, button, clipped !== false, clipped)
}

/**
 * 将简介 markdown 源本机安全渲染进宿主（可信作者走 allowDangerousHtml，否则 sanitize）。
 * @param {HTMLElement} bioElement 简介容器
 * @param {string} markdown markdown 源
 * @param {string} [entityHash] 作者 entityHash / pubKeyHash（决定信任）
 * @param {{
 *   emptyI18n?: string,
 *   selfEntityHash?: string | null,
 *   nodeHash?: string | null,
 *   viewerOwnerEntityHash?: string | null,
 * }} [options] 空态 / 信任上下文
 * @returns {Promise<void>}
 */
export async function paintEntityProfileBio(bioElement, markdown, entityHash = '', options = {}) {
	if (!(bioElement instanceof HTMLElement)) return
	const text = markdown.trim()
	const emptyI18n = options.emptyI18n || 'chat.hub.bioEmpty'
	if (!text) {
		bioElement.replaceChildren()
		bioElement.classList.remove('markdown-body')
		bioElement.removeAttribute('user-content')
		bioElement.dataset.i18n = emptyI18n
		applyAboutFold(bioElement, text)
		return
	}
	delete bioElement.dataset.i18n
	bioElement.setAttribute('user-content', '')
	await mountTrustedMarkdown(bioElement, text, entityHash, {
		selfEntityHash: options.selfEntityHash,
		nodeHash: options.nodeHash,
		viewerOwnerEntityHash: options.viewerOwnerEntityHash,
	})
	applyAboutFold(bioElement, text)
}

/**
 * 渲染「此实体为 xxx 所有」节点（owner 为 HTML 插值，走 dataset 参数 + data-i18n，随语种切换自动重译）。
 * @param {string | null | undefined} ownerEntityHash 主人
 * @param {{ ownerName?: string | null, linkHref?: string | null }} [options] 选项
 * @returns {HTMLElement | null} 节点；无主人时为 null
 */
export function renderOwnedByBox(ownerEntityHash, options = {}) {
	const owner = ownerEntityHash || ''
	if (!isEntityHash128(owner)) return null
	const label = options.ownerName
		|| aliasForEntity(owner)
		|| entityHashLabel(owner)
	const href = options.linkHref || formatSocialProfileHref(owner)
	const box = document.createElement('div')
	box.className = 'entity-owned-by-box'
	box.dataset.entityOwnedBy = owner
	box.dataset.i18n = 'chat.entityProfile.ownedBy'
	box.dataset.owner = `<a class="entity-owned-by-link link link-hover" href="${escapeHtml(href)}" data-entity-owned-by-link="${escapeHtml(owner)}">${escapeHtml(label)}</a>`
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
	span.dataset.i18n = 'chat.entityProfile.attributionMismatchShort'
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
			text.dataset.i18n = 'chat.entityProfile.attributionMismatch'
			box.append(icon, text)
			warnHost.replaceChildren(box)
			warnHost.hidden = false
		}
		else {
			warnHost.replaceChildren()
			warnHost.hidden = true
		}
}
