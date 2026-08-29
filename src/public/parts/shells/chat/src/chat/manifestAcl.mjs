import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import {
	registerManifestAcl,
	unregisterManifestAcl,
} from 'npm:@steve02081504/fount-p2p/files/manifest/acl'
import {
	registerManifestServicer,
	unregisterManifestServicer,
} from 'npm:@steve02081504/fount-p2p/files/manifest/servicer_registry'
import { loadPeerPoolView } from 'npm:@steve02081504/fount-p2p/node/network'

import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'

import { canInChannel, resolveActiveMemberKeyForLocalUser } from '../group/access.mjs'

import { getState } from './dag/materialize.mjs'
import { groupIdFromGroupEntity, groupIdFromManifestMeta } from './lib/groupEntity.mjs'

const OWNER_ID = 'chat'

/**
 * 注册 Chat Shell 提供的群 entity manifest ACL 与跨节点 servicer。
 * @returns {void}
 */
export function registerChatManifestAcl() {
	registerManifestAcl(OWNER_ID, async (context, logicalPath) => {
		const groupId = context.manifest?.transferKeyDescriptor?.groupId
			|| groupIdFromManifestMeta(context.manifest?.meta)
			|| await groupIdFromGroupEntity(context.ownerEntityHash, context.replicaUsername)
		if (!groupId) return false
		const { state } = await getState(context.replicaUsername, groupId)
		const memberKey = await resolveActiveMemberKeyForLocalUser(context.replicaUsername, groupId, state)
		if (!memberKey) return false
		if (logicalPath != null) {
			const member = state.members[memberKey]
			const channelId = state.groupSettings?.defaultChannelId || 'default'
			return canInChannel(state, member, PERMISSIONS.UPLOAD_FILES, channelId)
		}
		return true
	})
	// 跨节点 serve：请求方节点须在群 peer 池内（信任边界；真正的读授权靠群文件主密钥解密）。
	registerManifestServicer(OWNER_ID, async ({ manifest, requesterNodeHash }) => {
		const groupId = manifest?.transferKeyDescriptor?.groupId || groupIdFromManifestMeta(manifest?.meta)
		if (!groupId || !isHex64(requesterNodeHash)) return false
		const view = loadPeerPoolView(groupId)
		return [...view.trustedPeers || [], ...view.explorePeers || []].includes(requesterNodeHash)
	})
}

/** @returns {void} */
export function unregisterChatManifestAcl() {
	unregisterManifestAcl(OWNER_ID)
	unregisterManifestServicer(OWNER_ID)
}
