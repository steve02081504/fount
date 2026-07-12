import {
	registerAgentCharResolver,
	registerListLocalAgentsProvider,
	unregisterAgentCharResolver,
	unregisterListLocalAgentsProvider,
} from '../../../../../../../scripts/p2p/entity/hosting_registry.mjs'

import { resolveAgentCharPartName, scanLocalAgentEntitiesFromChars } from './entity.mjs'

/**
 * @returns {Promise<void>}
 */
export async function registerDefaultAgentHosting() {
	const fs = await import('node:fs')
	const path = await import('node:path')
	const { getUserDictionary } = await import('../../../../../../../server/auth/index.mjs')
	registerAgentCharResolver((username, entityHash) =>
		resolveAgentCharPartName(username, entityHash, getUserDictionary, fs, path))
	registerListLocalAgentsProvider(username =>
		scanLocalAgentEntitiesFromChars(username, getUserDictionary, fs, path))
}

/** @returns {void} */
export function unregisterDefaultAgentHosting() {
	unregisterAgentCharResolver()
	unregisterListLocalAgentsProvider()
}
