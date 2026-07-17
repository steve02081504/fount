/**
 * 【文件】public/shared/entityProfileCard.mjs
 * 【职责】跨壳实体资料归一化与人物卡附属区块（所属方 / 归因警告）绘制。
 * 【原理】API profile → 统一字段；owner / attribution 用 data-* 宿主节点填充；链接走 Social profile hash。
 */
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { formatSocialProfileHref } from '/parts/shells:social/shared/runUri.mjs'
import { aliasForEntity } from './aliases.mjs'
import { entityHashLabel, isEntityHash128 } from './entityHash.mjs'

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
		avatar: profile?.avatar || null,
		name: profile?.name || (key ? entityHashLabel(key) : '?'),
		handle: profile?.handle || null,
		themeColor: profile?.themeColor || '',
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
 * 简介纯文本（优先 markdown 源）。
 * @param {object | null | undefined} profile 资料
 * @returns {string} 简介
 */
export function profileDescriptionText(profile) {
	const md = String(profile?.description_markdown || '').trim()
	if (md) return md
	return String(profile?.description || profile?.bio || '').trim()
}

/**
 * 渲染「此实体为 xxx 所有」HTML。
 * @param {string | null | undefined} ownerEntityHash 主人
 * @param {{ ownerName?: string | null, linkHref?: string | null }} [options] 选项
 * @returns {string} HTML；无主人时为空串
 */
export function renderOwnedByBoxHtml(ownerEntityHash, options = {}) {
	const owner = String(ownerEntityHash || '').trim().toLowerCase()
	if (!isEntityHash128(owner)) return ''
	const label = options.ownerName
		|| aliasForEntity(owner)
		|| entityHashLabel(owner)
	const href = options.linkHref || formatSocialProfileHref(owner)
	const ownerLink = `<a class="entity-owned-by-link link link-hover" href="${escapeHtml(href)}" data-entity-owned-by-link="${escapeHtml(owner)}">${escapeHtml(label)}</a>`
	const text = geti18n('entityProfile.ownedBy', { owner: ownerLink })
	return `<div class="entity-owned-by-box" data-entity-owned-by="${escapeHtml(owner)}">${text}</div>`
}

/**
 * 渲染归因不匹配警告框 HTML。
 * @param {object | null | undefined} attribution 归因
 * @returns {string} HTML
 */
export function renderAttributionWarningBoxHtml(attribution) {
	if (!attribution?.mismatch) return ''
	const text = geti18n('entityProfile.attributionMismatch')
		|| '显示身份与消息签名者不匹配（例如导入历史经导入者重新签名）。'
	return '<div class="entity-attribution-warning-box" role="alert" data-entity-attribution-warning>'
		+ '<span class="entity-attribution-warning-icon" aria-hidden="true">⚠</span>'
		+ `<span class="entity-attribution-warning-text">${escapeHtml(text)}</span>`
		+ '</div>'
}

/**
 * 人名旁归因警告图标 HTML。
 * @param {object | null | undefined} attribution 归因
 * @returns {string} HTML
 */
export function renderAttributionWarningIconHtml(attribution) {
	if (!attribution?.mismatch) return ''
	const title = geti18n('entityProfile.attributionMismatchShort')
		|| '签名归因不匹配'
	return `<span class="entity-attribution-warning-icon-inline" title="${escapeHtml(title)}" role="img" aria-label="${escapeHtml(title)}" data-attribution-warning-icon>⚠</span>`
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
		const html = renderOwnedByBoxHtml(options.ownerEntityHash, {
			ownerName: options.ownerName,
			linkHref: options.ownerLinkHref,
		})
		ownerHost.innerHTML = html
		ownerHost.hidden = !html
	}
	const warnHost = root.querySelector('[data-entity-attribution-warning-host]')
	if (warnHost instanceof HTMLElement) {
		const html = renderAttributionWarningBoxHtml(options.attribution)
		warnHost.innerHTML = html
		warnHost.hidden = !html
	}
}
