/**
 * 【文件】public/hub/stream/handlers/profileUpdate.mjs
 * 【职责】处理后端经群 WS 广播的 `profile_update` 事件：使该实体资料缓存失效并重绘 Hub 可见资料面。
 * 复用 `refreshHubAfterProfileChange`（invalidate + 重绘消息头像/作者名/成员列表/资料卡）。
 */
import { isEntityHash128 } from '../../../shared/entityHash.mjs'
import { refreshHubAfterProfileChange } from '../../presence.mjs'

/**
 * @param {object} wireMessage WS 载荷
 * @returns {boolean} 是否已消费（type === 'profile_update'）
 */
export function handleProfileUpdateWire(wireMessage) {
	if (wireMessage?.type !== 'profile_update') return false
	const entityHash = String(wireMessage.entityHash || '')
	if (isEntityHash128(entityHash)) void refreshHubAfterProfileChange(entityHash)
	return true
}
