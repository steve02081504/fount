import { randomUUID } from 'node:crypto'

/**
 * @param {string | null | undefined} value 父目录 id
 * @returns {string | null} 规范化父目录 id
 */
export function normalizeParentId(value) {
	return value == null || value === '' ? null : String(value)
}

/**
 * @param {string} entityHash 操作者
 * @returns {{ at: number, entity_hash: string }} 时间戳元数据
 */
export function stampActor(entityHash) {
	return { at: Date.now(), entity_hash: String(entityHash || '').toLowerCase() }
}

/**
 * @param {Partial<object>} draft 草稿
 * @param {string} entityHash 操作者
 * @returns {object} 规范化条目
 */
export function normalizeEntry(draft, entityHash) {
	const now = stampActor(entityHash)
	const kind = ['file', 'folder', 'link'].includes(draft?.kind) ? draft.kind : 'file'
	return {
		id: String(draft?.id || randomUUID()),
		name: String(draft?.name || 'untitled').slice(0, 512),
		kind,
		parent_id: normalizeParentId(draft?.parent_id),
		size: Number(draft?.size) || 0,
		mime_type: String(draft?.mime_type || (kind === 'folder' ? 'inode/directory' : 'application/octet-stream')),
		description: String(draft?.description || '').slice(0, 4000),
		created: draft?.created?.at ? {
			at: Number(draft.created.at),
			entity_hash: String(draft.created.entity_hash || entityHash).toLowerCase(),
		} : now,
		modified: draft?.modified?.at ? {
			at: Number(draft.modified.at),
			entity_hash: String(draft.modified.entity_hash || entityHash).toLowerCase(),
		} : now,
		evfs_path: draft?.evfs_path ? String(draft.evfs_path) : null,
		attrs: {
			hidden: Boolean(draft?.attrs?.hidden),
			system: Boolean(draft?.attrs?.system),
		},
		preview: {
			url: String(draft?.preview?.url || ''),
			delete_with_file: draft?.preview?.delete_with_file !== false,
		},
		encryption: draft?.encryption || null,
		orphaned: Boolean(draft?.orphaned),
		link: kind === 'link' && draft?.link ? {
			owner_entity_hash: String(draft.link.owner_entity_hash || '').toLowerCase(),
			cabinet_id: String(draft.link.cabinet_id || ''),
			entry_id: draft.link.entry_id == null || draft.link.entry_id === ''
				? null
				: String(draft.link.entry_id),
		} : null,
	}
}

/**
 * @param {object} entry 条目
 * @param {object} patch 补丁
 * @param {string} entityHash 操作者
 * @returns {object} 更新后的条目
 */
export function patchEntry(entry, patch, entityHash) {
	const next = { ...entry }
	if (patch.name != null) next.name = String(patch.name).slice(0, 512)
	if (patch.description != null) next.description = String(patch.description).slice(0, 4000)
	if (patch.parent_id !== undefined)
		next.parent_id = normalizeParentId(patch.parent_id)
	if (patch.mime_type != null) next.mime_type = String(patch.mime_type)
	if (patch.size != null) next.size = Number(patch.size) || 0
	if (patch.evfs_path !== undefined) next.evfs_path = patch.evfs_path ? String(patch.evfs_path) : null
	if (patch.attrs) 
		next.attrs = {
			hidden: patch.attrs.hidden != null ? Boolean(patch.attrs.hidden) : next.attrs.hidden,
			system: patch.attrs.system != null ? Boolean(patch.attrs.system) : next.attrs.system,
		}
	
	if (patch.preview) 
		next.preview = {
			url: patch.preview.url != null ? String(patch.preview.url) : next.preview.url,
			delete_with_file: patch.preview.delete_with_file != null
				? Boolean(patch.preview.delete_with_file)
				: next.preview.delete_with_file,
		}
	
	if (patch.encryption !== undefined) next.encryption = patch.encryption
	if (patch.orphaned !== undefined) next.orphaned = Boolean(patch.orphaned)
	if (patch.link !== undefined) next.link = patch.link
	next.modified = stampActor(entityHash)
	return next
}

/**
 * @param {object[]} entries 条目列表
 * @param {string | null} parentId 父目录
 * @param {{ show_hidden?: boolean }} [options] 选项
 * @returns {object[]} 子条目
 */
export function listChildren(entries, parentId, options = {}) {
	const parent = normalizeParentId(parentId)
	return entries
		.filter(entry => (entry.parent_id ?? null) === parent)
		.filter(entry => options.show_hidden || !entry.attrs?.hidden)
		.filter(entry => options.show_orphaned || !entry.orphaned)
		.sort((a, b) => {
			if (a.kind === 'folder' && b.kind !== 'folder') return -1
			if (a.kind !== 'folder' && b.kind === 'folder') return 1
			return String(a.name).localeCompare(String(b.name))
		})
}

/**
 * 构建从柜根目录到当前文件夹的具名路径。
 * @param {object[]} entries 全部条目
 * @param {string | null} folderId 当前文件夹
 * @returns {{ id: string, name: string }[]} 路径
 */
export function buildFolderTrail(entries, folderId) {
	const byId = new Map(entries.map(entry => [entry.id, entry]))
	const seen = new Set()
	const trail = []
	let currentId = folderId
	while (currentId && !seen.has(currentId)) {
		seen.add(currentId)
		const folder = byId.get(currentId)
		if (!folder || folder.kind !== 'folder') break
		trail.unshift({ id: folder.id, name: folder.name })
		currentId = folder.parent_id
	}
	return trail
}

/**
 * @param {object[]} entries 条目
 * @param {string} entryId 条目 id
 * @returns {Set<string>} 自身及全部后代 id
 */
export function collectSubtreeIds(entries, entryId) {
	const byParent = new Map()
	for (const entry of entries) {
		const key = entry.parent_id ?? null
		if (!byParent.has(key)) byParent.set(key, [])
		byParent.get(key).push(entry.id)
	}
	const out = new Set([entryId])
	const queue = [entryId]
	while (queue.length) {
		const id = queue.shift()
		for (const childId of byParent.get(id) || []) {
			if (out.has(childId)) continue
			out.add(childId)
			queue.push(childId)
		}
	}
	return out
}

/**
 * @param {unknown} raw 原始索引
 * @returns {{ version: number, entries: object[] }} 规范化索引
 */
export function normalizeIndex(raw) {
	const entries = Array.isArray(raw?.entries) ? raw.entries : []
	return {
		version: Number(raw?.version) || 1,
		entries: entries.map(entry => normalizeEntry(entry, entry?.created?.entity_hash || '')),
	}
}
