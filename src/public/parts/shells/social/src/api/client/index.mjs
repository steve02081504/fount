import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { resolveOperatorEntityHashForUser } from '../../../../chat/src/entity/identity.mjs'
import { resolveSocialEntity } from '../../federation/hosting.mjs'

import { createAlbumsMethods } from './albums.mjs'
import { createDraftsMethods } from './drafts.mjs'
import { createFeedMethods } from './feed.mjs'
import { createFollowMethods } from './follow.mjs'
import { createLiveMethods } from './live.mjs'
import { createNotificationsMethods } from './notifications.mjs'
import { createPostsMethods } from './posts.mjs'
import { createProfileMethods } from './profile.mjs'
import { createSavedMethods } from './saved.mjs'
import { createTasteMethods } from './taste.mjs'
import { createVaultMethods } from './vault.mjs'

/**
 * 解析 SocialClient 绑定实体：缺省 operator；指定时须为本 username 托管的本地实体。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} [entityHash] 缺省 = operator
 * @returns {Promise<{ entityHash: string, charPartName?: string }>} 绑定实体
 */
export async function resolveSocialClientEntity(username, entityHash) {
	const requested = String(entityHash || '').trim().toLowerCase()
	if (requested) {
		const resolved = await resolveSocialEntity(requested, username)
		if (!resolved?.local || resolved.replicaUsername !== username)
			throw httpError(403, 'invalid entityHash')
		return {
			entityHash: resolved.entityHash,
			...resolved.charPartName ? { charPartName: resolved.charPartName } : {},
		}
	}
	const operator = await resolveOperatorEntityHashForUser(username)
	if (!operator)
		throw httpError(403, 'configure Chat federation identity first (same P2P entity as Social)')
	return { entityHash: operator }
}

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} SocialClient 鸭子类型
 */
export function createSocialClient(apiContext) {
	return {
		entityHash: apiContext.entityHash,
		...createPostsMethods(apiContext),
		...createFollowMethods(apiContext),
		...createFeedMethods(apiContext),
		...createNotificationsMethods(apiContext),
		...createLiveMethods(apiContext),
		...createSavedMethods(apiContext),
		...createDraftsMethods(apiContext),
		...createVaultMethods(apiContext),
		...createTasteMethods(apiContext),
		...createProfileMethods(apiContext),
		...createAlbumsMethods(apiContext),
	}
}

/**
 * 获取以指定实体自签的 SocialClient。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} [entityHash] 缺省 = operator
 * @returns {Promise<object>} SocialClient
 */
export async function getSocialClient(username, entityHash) {
	const entity = await resolveSocialClientEntity(username, entityHash)
	return createSocialClient({ username, ...entity })
}
