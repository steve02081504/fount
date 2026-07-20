import { createBridgeMethods } from './bridge.mjs'
import { createEntityMethods } from './entity.mjs'
import { createGroupAccessMethods } from './groupAccess.mjs'
import { createHydrationMethods } from './hydration.mjs'
import { createMediaCollectionsMethods } from './mediaCollections.mjs'
import { createNodeMethods } from './node.mjs'
import { createPreferencesMethods } from './preferences.mjs'
import { createPrivateStateMethods } from './privateState.mjs'

/**
 * @param {import('../internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {object} ChatClient 鸭子类型
 */
export function createChatClient(apiContext) {
	return {
		entityHash: apiContext.entityHash,
		...createGroupAccessMethods(apiContext),
		...createPrivateStateMethods(apiContext),
		...createPreferencesMethods(apiContext),
		...createMediaCollectionsMethods(apiContext),
		...createHydrationMethods(apiContext),
		...createEntityMethods(apiContext),
		...createNodeMethods(apiContext),
		...createBridgeMethods(apiContext),
	}
}

/**
 * 获取以指定实体自签的 ChatClient。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} [entityHash] 缺省 = operator
 * @returns {Promise<object>} ChatClient
 */
export async function getChatClient(username, entityHash) {
	const { resolveChatEntity } = await import('../../chat/lib/actor.mjs')
	const entity = await resolveChatEntity(username, entityHash)
	return createChatClient({ username, ...entity })
}

/**
 *
 */
export { createShellJsonNamespace, createChatShellJsonNamespace } from './helpers.mjs'
