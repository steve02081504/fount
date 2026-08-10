/**
 * 【文件】`dag/knownLocalEventIds.mjs` — 本地已见证但可能已从 `events.jsonl` 折叠掉的事件 id。
 * 【职责】为 tip_merge 父齐备判定与 catchup wantSet 提供「本地已知」集合，避免已归档/已验收的 tip 父被永远当成缺失。
 * 【原理】并集：events.jsonl ∪ archive_manifest.archivedEventIds ∪ event_meta.receivedAt ∪ checkpoint 锚点链。
 * 【关联】`ingest.mjs`、`federation/index.mjs`、`archive/index.mjs`、`events/meta.mjs`。
 */
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'

import { archivedMessageIdSet, loadArchiveManifest } from '../archive/index.mjs'
import { loadEventMeta } from '../events/meta.mjs'
import { eventsPath } from '../lib/paths.mjs'

import { safeReadSnapshot } from './wal.mjs'

/**
 * @param {object | null | undefined} checkpoint 群快照
 * @param {Set<string>} out 写入集合
 * @returns {void}
 */
export function addCheckpointKnownEventIds(checkpoint, out) {
	if (!checkpoint) return
	const tip = String(checkpoint.checkpoint_event_id || '').trim().toLowerCase()
	if (isHex64(tip)) out.add(tip)
	for (const id of checkpoint.dag_tip_ids || []) {
		const n = String(id || '').trim().toLowerCase()
		if (isHex64(n)) out.add(n)
	}
	for (const id of checkpoint.eventIdsInEpoch || []) {
		const n = String(id || '').trim().toLowerCase()
		if (isHex64(n)) out.add(n)
	}
	for (const entry of checkpoint.epoch_chain || []) {
		const n = String(entry?.checkpoint_event_id || '').trim().toLowerCase()
		if (isHex64(n)) out.add(n)
	}
	for (const ids of Object.values(checkpoint.hot_posts?.latestByChannel || {})) {
		const list = Array.isArray(ids) ? ids : (ids ? [ids] : [])
		for (const id of list) {
			const n = String(id || '').trim().toLowerCase()
			if (isHex64(n)) out.add(n)
		}
	}
}

/**
 * 收集本机已见证的 DAG 事件 id（含已从热 DAG 折叠但仍在归档/侧车/checkpoint 中的）。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {Promise<Set<string>>} 规范化小写 64-hex id 集合
 */
export async function loadKnownLocalDagEventIds(username, groupId) {
	/** @type {Set<string>} */
	const known = new Set()
	try {
		for (const row of await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })) {
			const id = String(row?.id || '').trim().toLowerCase()
			if (isHex64(id)) known.add(id)
		}
	}
	catch { /* 无 events */ }

	try {
		for (const id of archivedMessageIdSet(await loadArchiveManifest(username, groupId))) {
			const n = String(id || '').trim().toLowerCase()
			if (isHex64(n)) known.add(n)
		}
	}
	catch { /* 无 archive */ }

	try {
		for (const id of Object.keys((await loadEventMeta(username, groupId)).receivedAt || {})) {
			const n = String(id || '').trim().toLowerCase()
			if (isHex64(n)) known.add(n)
		}
	}
	catch { /* 无 meta */ }

	addCheckpointKnownEventIds(await safeReadSnapshot(username, groupId), known)
	return known
}
