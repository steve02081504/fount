import {
	registerManifestAcl,
	unregisterManifestAcl,
} from '../../../../../../scripts/p2p/entity/files/manifest_acl_registry.mjs'
import { groupIdFromGroupEntity } from '../../../../../../scripts/p2p/entity/group_entity.mjs'
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { canInChannel, resolveActiveMemberKeyForLocalUser } from '../group/access.mjs'

import { getState } from './dag/materialize.mjs'

const OWNER_ID = 'chat'

/**
 * 注册 Chat Shell 提供的群 entity manifest ACL。
 * @returns {void}
 */
export function registerChatManifestAcl() {
	registerManifestAcl('file-master-key-wrap', OWNER_ID, async (manifestContext, logicalPath) => {
		const groupId = manifestContext.manifest?.transferKeyDescriptor?.groupId
			|| await groupIdFromGroupEntity(manifestContext.ownerEntityHash, manifestContext.replicaUsername)
		if (!groupId) return false
		const { state } = await getState(manifestContext.replicaUsername, groupId)
		const memberKey = await resolveActiveMemberKeyForLocalUser(manifestContext.replicaUsername, groupId, state)
		if (!memberKey) return false
		if (logicalPath != null) {
			const member = state.members[memberKey]
			const channelId = state.groupSettings?.defaultChannelId || 'default'
			return canInChannel(state, member, PERMISSIONS.UPLOAD_FILES, channelId)
		}
		return true
	})
}

/** @returns {void} */
export function unregisterChatManifestAcl() {
	unregisterManifestAcl('file-master-key-wrap', OWNER_ID)
}
