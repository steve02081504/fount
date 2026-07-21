import { logicalEntityHash } from 'npm:@steve02081504/fount-p2p/core/logical_entity'

/** EVFS 逻辑实体 subject：`cabinet_id`（64 hex）→ 128 hex ownerEntityHash */
export const SHARED_CABINET_SUBJECT_PREFIX = 'fount:cabinet:shared:'

/**
 * @param {string} cabinetId 共享柜 id（写公钥 hash）
 * @returns {string} 128 位 logical entityHash（EVFS owner）
 */
export function sharedCabinetEntityHash(cabinetId) {
	const id = String(cabinetId || '').trim().toLowerCase()
	if (!id) throw new Error('cabinetId required')
	return logicalEntityHash(`${SHARED_CABINET_SUBJECT_PREFIX}${id}`)
}
