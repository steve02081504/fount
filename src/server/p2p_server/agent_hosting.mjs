/**
 * Chat / Social Load 共用：注册本机 agent 解析与枚举。
 */
import {
	registerAgentCharResolver,
	registerListLocalAgentsProvider,
	unregisterAgentCharResolver,
	unregisterListLocalAgentsProvider,
} from '../../scripts/p2p/entity/hosting_registry.mjs'
import { scanLocalAgentEntitiesFromChars } from '../../scripts/p2p/entity/hosting.mjs'

/**
 * @returns {Promise<void>}
 */
export async function registerDefaultAgentHosting() {
	const fs = await import('node:fs')
	const path = await import('node:path')
	const { resolveAgentCharPartName } = await import('./agent_resolve.mjs')
	const { getUserDictionary } = await import('../auth/index.mjs')
	registerAgentCharResolver(resolveAgentCharPartName)
	registerListLocalAgentsProvider(username =>
		scanLocalAgentEntitiesFromChars(username, getUserDictionary, fs, path))
}

/** @returns {void} */
export function unregisterDefaultAgentHosting() {
	unregisterAgentCharResolver()
	unregisterListLocalAgentsProvider()
}
