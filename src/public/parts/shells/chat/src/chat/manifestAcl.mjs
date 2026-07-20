import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import {
	registerManifestAcl,
	registerManifestAclMatcher,
	unregisterManifestAcl,
	unregisterManifestAclMatcher,
} from 'npm:@steve02081504/fount-p2p/files/manifest_acl_registry'

import { canInChannel, resolveActiveMemberKeyForLocalUser } from '../group/access.mjs'

import { getState } from './dag/materialize.mjs'
import { groupIdFromGroupEntity, isGroupEntityHash } from './lib/groupEntity.mjs'

const OWNER_ID = 'chat'

/**
 * 注册 Chat Shell 提供的群 entity manifest ACL。
 * @returns {void}
 */
export function registerChatManifestAcl() {
	registerManifestAclMatcher(OWNER_ID, (_manifest, ownerEntityHash) =>
		isGroupEntityHash(ownerEntityHash) ? 'file-master-key-wrap' : null,
	)
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
	unregisterManifestAclMatcher(OWNER_ID)
	unregisterManifestAcl('file-master-key-wrap', OWNER_ID)
}
