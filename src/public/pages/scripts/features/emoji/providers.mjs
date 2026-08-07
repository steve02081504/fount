/**
 * 聚合 registries.emoji 全部 provider。
 */
import { importRegistryModules } from '../../endpoints/registries.mjs'

/**
 * @returns {Promise<object[]>} 全部可用 emoji provider
 */
export async function listEmojiProviders() {
	const modules = await importRegistryModules('emoji')
	/** @type {object[]} */
	const providers = []
	for (const { module } of modules) {
		const provider = module?.default ?? module
		if (!provider) continue
		if (provider.listPacks || (provider.listTabs && provider.loadTabItems))
			providers.push(provider)
	}
	return providers
}

/**
 * 合并各 provider 的 listPacks；附带来源 provider 引用。
 * @param {object} [context] 选择器上下文
 * @param {string} [context.groupId] 当前群 ID
 * @param {string} [context.replyToEntityHash] 回复对象实体哈希
 * @returns {Promise<{ packs: object[], providers: object[], usage: object | null, collection: object | null }>} 聚合结果
 */
export async function aggregateEmojiPacks(context = {}) {
	const providers = await listEmojiProviders()
	/** @type {object[]} */
	const packs = []
	/** @type {object | null} */
	let usage = null
	/** @type {object | null} */
	let collection = null

	for (const provider of providers) {
		if (provider.usage && !usage) usage = provider.usage
		if (provider.collection && !collection) collection = provider.collection
		if (!provider.listPacks) continue
		try {
			const list = await provider.listPacks(context)
			for (const pack of list || [])
				packs.push({ ...pack, _provider: provider })
		}
		catch (error) {
			console.warn('[emoji] provider.listPacks failed', provider, error)
		}
	}

	return { packs, providers, usage, collection }
}

/**
 * @param {object[]} providers 已加载的 emoji provider
 * @returns {object | null} 首个带 usage 能力的 provider，或 null
 */
export function findUsageCapability(providers) {
	for (const provider of providers || [])
		if (provider.usage) return provider.usage
	return null
}

/**
 * @param {object[]} providers 已加载的 emoji provider
 * @returns {object | null} 首个带 collection 能力的 provider，或 null
 */
export function findCollectionCapability(providers) {
	for (const provider of providers || [])
		if (provider.collection) return provider.collection
	return null
}
