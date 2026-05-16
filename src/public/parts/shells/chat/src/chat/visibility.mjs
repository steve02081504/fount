/**
 * GSH 消息加密（§11.1）：用 `KDF(H, "broadcast", channelId)` 加密/解密消息内容。
 *
 * 旧 mailbox-ECDH 方案已废弃，此文件仅保留：
 *   - `encryptMessageContent` / `decryptMessageContent`（GSH 广播加密）
 *   - `canViewMessage`（visibility 访问控制，与加密无关）
 */

import {
	decryptMessage,
	encryptMessage,
} from '../../../../../../scripts/p2p/gsh.mjs'

/**
 *
 */
export { decryptMessage as decryptMessageContent, encryptMessage as encryptMessageContent }

/**
 * 检查当前 member 是否有权看到某条消息（OR 语义）。
 * @param {{ roles?: string[], members?: string[] } | null | undefined} visibility 可见性约束
 * @param {{ memberId: string, roles: string[], charId?: string }} viewer 当前查看者
 * @returns {boolean} 是否可见
 */
export function canViewMessage(visibility, viewer) {
	if (!visibility) return true
	const { roles, members } = visibility
	const hasRoles = Array.isArray(roles) && roles.length > 0
	const hasMembers = Array.isArray(members) && members.length > 0
	if (!hasRoles && !hasMembers) return true
	if (hasMembers && (members.includes(viewer.memberId) || (viewer.charId && members.includes(viewer.charId))))
		return true
	if (hasRoles && roles.some(r => viewer.roles?.includes(r))) return true
	return false
}
