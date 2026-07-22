/**
 * 将本地 char part 的多语言 info 写入 agent 实体 profile（联邦可见）。
 * 头像若为图片则下载并 publish 到 EVFS `profile/avatar`；emoji/文本直接写入 localized。
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

import { isWritableLocalEntity } from 'npm:@steve02081504/fount-p2p/node/identity'

import { primaryLocaleForUser } from '../../../../../../scripts/locale.mjs'
import { baseloadPart, GetPartPath } from '../../../../../../server/parts_loader.mjs'
import { isAvatarImageUrl } from '../../public/shared/hashAvatar.mjs'
import { normalizeLocalizedMap } from '../entity/localized.mjs'
import { resolveAgentCharPartName } from '../entity/member.mjs'
import { getProfile, updateProfile, uploadAvatar } from '../entity/profile.mjs'

/** @type {Record<string, string>} */
const IMAGE_MIME_BY_EXT = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	svg: 'image/svg+xml',
}

/**
 * @param {string} extOrName 扩展名或文件名
 * @param {string} [fallback] 默认 MIME
 * @returns {string} image/*
 */
function imageMimeFromExt(extOrName, fallback = 'image/png') {
	const raw = String(extOrName || '').trim().toLowerCase()
	const ext = raw.includes('.') ? path.extname(raw).slice(1) : raw
	return IMAGE_MIME_BY_EXT[ext] || fallback
}

/**
 * @param {string} mimeType Content-Type / MIME
 * @param {string} [urlHint] URL 用于兜底扩展名
 * @returns {string} 规范化 MIME
 */
function imageMimeFromHttp(mimeType, urlHint = '') {
	const mime = String(mimeType || '').split(';')[0].trim().toLowerCase()
	if (mime.startsWith('image/')) return mime
	return imageMimeFromExt(urlHint, 'image/png')
}

/**
 * 解析 part 内静态文件：`/parts/...` 与静态路由一致，优先 `public/`。
 * @param {string} root part 根目录
 * @param {string} rel 相对路径
 * @returns {string} 存在的绝对路径；否则空串
 */
function resolvePartStaticFile(root, rel) {
	const cleaned = String(rel || '').replace(/^\.\//, '').replace(/^\/+/, '')
	if (!cleaned || cleaned.includes('://')) return ''
	for (const candidate of [
		path.join(root, 'public', cleaned),
		path.join(root, cleaned),
	])
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
	return ''
}

/**
 * @param {object} localized 已规范化的 localized
 * @returns {boolean} 是否无有效内容
 */
function localizedIsBlank(localized) {
	const keys = Object.keys(localized || {})
	if (!keys.length) return true
	return keys.every((key) => {
		const slice = localized[key] || {}
		return !String(slice.name || '').trim()
			&& !String(slice.avatar || '').trim()
			&& !String(slice.description || '').trim()
			&& !String(slice.description_markdown || '').trim()
			&& !(Array.isArray(slice.tags) && slice.tags.length)
	})
}

/**
 * @param {object} localized 已规范化的 localized
 * @returns {boolean} 任一 locale 已有 avatar
 */
function localizedHasAvatar(localized) {
	return Object.values(localized || {}).some(slice => String(slice?.avatar || '').trim())
}

/**
 * @param {unknown} tags 原始 tags
 * @returns {string[]} 规范化 tags
 */
function normalizeTags(tags) {
	if (!Array.isArray(tags)) return []
	return tags.map(t => String(t).trim().replace(/^#+/, '')).filter(Boolean)
}

/**
 * @param {Record<string, object>} info part.info 全语言表
 * @returns {Record<string, object>} profile localized（尚未写 avatar URL）
 */
function localizedSlicesFromPartInfo(info) {
	/** @type {Record<string, object>} */
	const out = {}
	for (const [locale, raw] of Object.entries(info || {})) {
		const localeKey = String(locale || '').trim()
		if (!localeKey || !raw || typeof raw !== 'object') continue
		/** @type {Record<string, unknown>} */
		const slice = {}
		const name = String(raw.name || '').trim()
		if (name) slice.name = name
		if (raw.description != null) slice.description = String(raw.description)
		const md = raw.description_markdown != null
			? String(raw.description_markdown)
			: raw.description != null ? String(raw.description) : ''
		if (md) slice.description_markdown = md
		const tags = normalizeTags(raw.tags)
		if (tags.length) slice.tags = tags
		if (raw.version) slice.version = String(raw.version).trim()
		if (raw.author) slice.author = String(raw.author).trim()
		if (raw.home_page) slice.home_page = String(raw.home_page).trim()
		if (raw.issue_page) slice.issue_page = String(raw.issue_page).trim()
		if (Object.keys(slice).length) out[localeKey] = slice
	}
	return out
}

/**
 * @param {Record<string, object>} info part.info
 * @returns {string} 首选头像字符串（跨 locale 第一个非空）
 */
function pickPartAvatar(info) {
	for (const raw of Object.values(info || {})) {
		const avatar = String(raw?.avatar || '').trim()
		if (avatar) return avatar
	}
	return ''
}

/**
 * @param {string} username replica
 * @param {string} charname 角色 part 名
 * @param {string} avatarRaw part info.avatar
 * @returns {Promise<{ kind: 'emoji', value: string } | { kind: 'file', buffer: Buffer, mimeType: string, filename: string } | null>} emoji 文本或待上传的图片字节
 */
async function materializePartAvatar(username, charname, avatarRaw) {
	const raw = String(avatarRaw || '').trim()
	if (!raw) return null
	if (!isAvatarImageUrl(raw)) return { kind: 'emoji', value: raw }

	if (raw.startsWith('data:')) {
		const match = raw.match(/^data:([^;,]+)?(?:;base64)?,(.+)$/i)
		if (!match) return null
		const mimeType = match[1] || 'image/png'
		const payload = match[2]
		const buffer = /;base64/i.test(raw)
			? Buffer.from(payload, 'base64')
			: Buffer.from(decodeURIComponent(payload))
		return { kind: 'file', buffer, mimeType, filename: 'avatar' }
	}

	if (raw.startsWith('http://') || raw.startsWith('https://')) {
		const response = await fetch(raw)
		if (!response.ok) return null
		const mimeType = imageMimeFromHttp(response.headers.get('content-type') || '', raw)
		const buffer = Buffer.from(await response.arrayBuffer())
		const ext = Object.entries(IMAGE_MIME_BY_EXT).find(([, mime]) => mime === mimeType)?.[0]
			|| path.extname(new URL(raw).pathname).slice(1).toLowerCase()
			|| 'png'
		return { kind: 'file', buffer, mimeType, filename: `avatar.${ext}` }
	}

	// 相对路径：相对 part 目录；或 /parts/...（与静态路由一致 → public/）
	let filePath = ''
	if (raw.startsWith('/parts/')) {
		const rest = raw.slice('/parts/'.length)
		const slash = rest.indexOf('/')
		const partpath = (slash === -1 ? rest : rest.slice(0, slash)).replaceAll(':', '/')
		const rel = slash === -1 ? '' : rest.slice(slash + 1)
		const root = GetPartPath(username, partpath)
		filePath = resolvePartStaticFile(root, rel)
	}
	else if (!raw.includes('://')) {
		const root = GetPartPath(username, `chars/${charname}`)
		filePath = resolvePartStaticFile(root, raw)
	}
	if (!filePath) return null
	const buffer = fs.readFileSync(filePath)
	const filename = path.basename(filePath) || 'avatar.png'
	const mimeType = imageMimeFromExt(filename)
	return { kind: 'file', buffer, mimeType, filename }
}

/**
 * @param {string} username replica
 * @param {string} charname 角色名
 * @returns {Promise<Record<string, object>>} part.info 全语言表
 */
async function loadCharPartInfoMap(username, charname) {
	const partpath = `chars/${charname}`
	// 只 baseload（或 mid-load 时取模块缓存），禁止 loadPart：Load→ensureAgent→sync→loadPart 会死锁
	const part = await baseloadPart(username, partpath).catch(() => null)
	const info = part?.info || await part?.interfaces?.info?.UpdateInfo?.()
	if (!info || typeof info !== 'object') return {}
	return JSON.parse(JSON.stringify(info))
}

/**
 * @param {Record<string, object>} localized profile localized
 * @param {{ kind: 'emoji', value: string } | { kind: 'file', buffer: Buffer, mimeType: string, filename: string }} materialized 头像
 * @param {string} username replica
 * @param {string} hash entityHash
 * @returns {Promise<void>}
 */
async function applyMaterializedAvatar(localized, materialized, username, hash) {
	if (materialized.kind === 'emoji') {
		for (const key of Object.keys(localized))
			localized[key] = { ...localized[key], avatar: materialized.value }
		await updateProfile(username, hash, { localized }, { skipPresentation: true })
		return
	}
	await updateProfile(username, hash, { localized }, { skipPresentation: true })
	await uploadAvatar(username, hash, materialized.buffer, materialized.filename, materialized.mimeType)
}

/**
 * 从 char part info 重建（或首次填充）agent 实体 profile。
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @param {{ force?: boolean }} [options] force=true 覆盖已有 localized；默认仅空白 profile 填充（缺头像时会补传）
 * @returns {Promise<object | null>} 更新后的 profile；非 agent / 不可写 / 跳过时为 null
 */
export async function syncAgentProfileFromCharPart(username, entityHash, options = {}) {
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!hash || !isWritableLocalEntity(hash)) return null
	const charname = resolveAgentCharPartName(username, hash)
	if (!charname) return null

	const current = await getProfile(hash, username, { skipPresentation: true })
	const existing = normalizeLocalizedMap(current.localized)
	const blank = localizedIsBlank(existing)
	const needsAvatarBackfill = !blank && !localizedHasAvatar(existing)
	if (!options.force && !blank && !needsAvatarBackfill) return null

	const info = await loadCharPartInfoMap(username, charname)
	const avatarRaw = pickPartAvatar(info)
	const materialized = avatarRaw
		? await materializePartAvatar(username, charname, avatarRaw).catch(() => null)
		: null

	// 已有文案但缺头像：只补头像，不覆盖用户改过的 name/tags
	if (!options.force && needsAvatarBackfill) {
		if (!materialized) return null
		if (materialized.kind === 'emoji') {
			const localized = { ...existing }
			for (const key of Object.keys(localized))
				localized[key] = { ...localized[key], avatar: materialized.value }
			await updateProfile(username, hash, { localized }, { skipPresentation: true })
		}
		else
			await uploadAvatar(username, hash, materialized.buffer, materialized.filename, materialized.mimeType)
		return getProfile(hash, username, { skipPresentation: true })
	}

	const localized = localizedSlicesFromPartInfo(info)
	if (!Object.keys(localized).length)
		localized[primaryLocaleForUser(username)] = { name: charname }

	if (materialized)
		await applyMaterializedAvatar(localized, materialized, username, hash)
	else
		await updateProfile(username, hash, { localized }, { skipPresentation: true })

	return getProfile(hash, username, { skipPresentation: true })
}
