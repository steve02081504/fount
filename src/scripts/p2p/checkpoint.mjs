import { merkleRoot } from './dag.mjs'
import { MEMBERS_PAGE_SIZE } from './constants.mjs'

/**
 * 由 fileIndex 物化 Map 生成 folderId → { fileIds } 快照（供 Checkpoint）
 * @param {Map<string, unknown>} [fileIndex]
 */
export function buildFileFoldersSnapshot(fileIndex) {
	if (!fileIndex || !(fileIndex instanceof Map)) return {}
	/** @type {Map<string, string[]>} */
	const byFolder = new Map()
	for (const [fid, meta] of fileIndex) {
		const m = meta && typeof meta === 'object' ? /** @type {{ folderId?: string }} */ (meta) : {}
		const folder = m.folderId != null && m.folderId !== '' ? String(m.folderId) : 'default'
		if (!byFolder.has(folder)) byFolder.set(folder, [])
		byFolder.get(folder).push(String(fid))
	}
	/** @type {Record<string, { fileIds: string[] }>} */
	const out = {}
	for (const [folderId, ids] of byFolder) {
		out[folderId] = { fileIds: [...ids].sort() }
	}
	return out
}

/**
 * 构建 Checkpoint 可序列化对象（home 签名前）
 * @param {object} p
 */
export function buildCheckpointPayload({
	home_node_id,
	materialized,
	epoch_id,
	checkpoint_event_id,
	eventIdsInEpoch,
	overlay = {},
	fileFolders = {},
	epoch_chain = [],
}) {
	const members = [...materialized.members.keys()]
	const pages = []
	for (let i = 0; i < members.length; i += MEMBERS_PAGE_SIZE)
		pages.push(members.slice(i, i + MEMBERS_PAGE_SIZE))

	const memberPageHashes = pages.map((page, idx) =>
		merkleRoot(page.map(h => `${idx}:${h}`)),
	)
	const members_root = merkleRoot(memberPageHashes)
	const epoch_root_hash = merkleRoot(eventIdsInEpoch)

	const rolesObj = Object.fromEntries(materialized.roles)
	const channelsObj = Object.fromEntries(materialized.channels)

	return {
		home_node_id,
		members_root,
		members_pages_count: pages.length,
		members_page_0: pages[0] || [],
		roles: rolesObj,
		channelPermissions: serializeChannelPerms(materialized.channelPermissions),
		channels: channelsObj,
		fileFolders,
		groupMeta: materialized.groupMeta,
		groupSettings: materialized.groupSettings,
		delegatedOwnerPubKeyHash: materialized.delegatedOwnerPubKeyHash ?? null,
		privateMailboxEpochs: Object.fromEntries(materialized.privateMailboxEpochs ?? new Map()),
		messageOverlay: overlay,
		checkpoint_event_id,
		epoch_id,
		epoch_root_hash,
		epoch_chain,
	}
}

function serializeChannelPerms(chMap) {
	const out = {}
	for (const [chId, rMap] of chMap)
		out[chId] = Object.fromEntries(rMap)
	return out
}
