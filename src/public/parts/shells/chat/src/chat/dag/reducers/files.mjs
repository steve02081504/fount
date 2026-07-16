import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { withGroupId } from './state.mjs'

/**
 * @param {object} state 物化状态
 * @param {object} event DAG 事件
 * @param {'kick' | 'rotate'} rotationType 文件主密钥轮换原因
 * @param {Record<string, unknown>} [extra] 附加字段
 * @returns {void}
 */
export function recordFileMasterKeyRotation(state, event, rotationType, extra = {}) {
	const generation = event.content.key_generation
	const nonce = event.content.new_key_nonce
	if (!Number.isFinite(generation) || !nonce) return
	if (!state.fileMasterKeyRotations) state.fileMasterKeyRotations = []
	state.fileMasterKeyRotations.push({
		eventId: event.id,
		generation,
		nonce,
		type: rotationType,
		...extra,
	})
}

/** @type {Record<string, (state: object, event: object) => object>} */
export const fileReducers = {
	/**
	 * 处理 `file_upload` 事件：在 `messageOverlay.fileIndex` 登记文件元数据。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	file_upload(state, event) {
		withGroupId(state, event)
		const { sender } = event
		state.messageOverlay.fileIndex.set(event.content.fileId, {
			name: event.content.name,
			size: event.content.size,
			mime_type: event.content.mime_type,
			folderId: event.content.folderId,
			ceMode: event.content.ceMode || 'convergent',
			contentHash: event.content.contentHash ?? null,
			ciphertextHash: event.content.ciphertextHash ?? null,
			wrappedKey: event.content.wrappedKey ?? null,
			key_generation: event.content.key_generation ?? null,
			storageLocator: event.content.storageLocator ?? null,
			parts: Array.isArray(event.content.parts) ? event.content.parts : null,
			uploaderPubKeyHash: isHex64(sender) ? sender : null,
			...event.content.description ? { description: String(event.content.description).slice(0, 4000) } : {},
			...event.content.attrs ? { attrs: event.content.attrs } : {},
			...event.content.preview ? { preview: event.content.preview } : {},
			...event.content.created ? { created: event.content.created } : {},
			...event.content.modified ? { modified: event.content.modified } : {
				created: { at: event.timestamp || Date.now(), entity_hash: isHex64(sender) ? sender : '' },
				modified: { at: event.timestamp || Date.now(), entity_hash: isHex64(sender) ? sender : '' },
			},
		})
		return state
	},

	/**
	 * 处理 `file_delete` 事件：从文件索引移除指定 fileId。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	file_delete(state, event) {
		withGroupId(state, event)
		state.messageOverlay.fileIndex.delete(event.content.fileId)
		return state
	},

	/**
	 * 处理 `file_system_update` 事件：创建、重命名、移动或删除文件文件夹。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	file_system_update(state, event) {
		withGroupId(state, event)
		const { operation, folderId } = event.content
		const fid = folderId ? String(folderId).trim() : ''
		if (fid)
			switch (operation) {
				case 'create':
					state.fileFolders[fid] = {
						name: event.content.name || fid,
						parentFolderId: event.content.parentFolderId ?? null,
					}
					break
				case 'rename':
					if (state.fileFolders[fid])
						state.fileFolders[fid].name = event.content.name || state.fileFolders[fid].name
					break
				case 'move':
					if (state.fileFolders[fid])
						state.fileFolders[fid].parentFolderId = event.content.parentFolderId ?? null
					break
				case 'delete':
					delete state.fileFolders[fid]
					break
				default:
					break
			}

		return state
	},
}
