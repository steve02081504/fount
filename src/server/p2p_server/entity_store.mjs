import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { parseEntityHash } from '../../scripts/p2p/entity_id.mjs'
import { createFsEntityStore } from '../../scripts/p2p/entity_store.mjs'
import { readJsonFile, writeJsonFile } from '../../scripts/p2p/utils/json_io.mjs'
import { getAllUserNames, getUserDictionary } from '../auth/index.mjs'

/**
 * fount 多用户 EntityStore：实体仍存于各用户 `{userDict}/entities/{entityHash}/`。
 * @returns {import('../../scripts/p2p/entity_store.mjs').EntityStore} 跨用户路由的 EntityStore
 */
export function createFountEntityStore() {
	const fsStores = new Map()

	/**
	 * @param {string} username fount 登录名
	 * @returns {import('../../scripts/p2p/entity_store.mjs').EntityStore} 该用户目录下的 fs store
	 */
	function storeForUser(username) {
		let store = fsStores.get(username)
		if (!store) {
			store = createFsEntityStore(path.join(getUserDictionary(username), 'entities'))
			fsStores.set(username, store)
		}
		return store
	}

	/**
	 * @param {string} entityHash 128 hex
	 * @returns {Promise<string | null>} 托管该实体的用户名
	 */
	async function findHostingUser(entityHash) {
		const parsed = parseEntityHash(entityHash)
		if (!parsed) return null
		for (const username of getAllUserNames()) {
			const profile = await storeForUser(username).readEntityJson(parsed.entityHash, 'profile.json')
			if (profile) return username
		}
		return null
	}

	return {
		/**
		 * @returns {Promise<string[]>} 全部已知 entityHash
		 */
		async listEntityHashes() {
			/** @type {Set<string>} */
			const hashes = new Set()
			for (const username of getAllUserNames()) 
				for (const hash of await storeForUser(username).listEntityHashes())
					hashes.add(hash)
			
			return [...hashes]
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} name 相对 JSON 名
		 * @returns {Promise<object | null>} JSON 或 null
		 */
		async readEntityJson(entityHash, name) {
			const host = await findHostingUser(entityHash)
			if (!host) return null
			return storeForUser(host).readEntityJson(entityHash, name)
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} name 相对 JSON 名
		 * @param {object} data 写入对象
		 * @returns {Promise<void>}
		 */
		async writeEntityJson(entityHash, name, data) {
			const parsed = parseEntityHash(entityHash)
			if (!parsed) throw new Error('invalid entityHash')
			for (const username of getAllUserNames()) {
				const store = storeForUser(username)
				const existing = await store.readEntityJson(entityHash, 'profile.json')
				if (existing) {
					await store.writeEntityJson(entityHash, name, data)
					return
				}
			}
			const firstUser = getAllUserNames()[0]
			if (!firstUser) throw new Error('no users')
			await storeForUser(firstUser).writeEntityJson(entityHash, name, data)
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @returns {Promise<Buffer | null>} 明文或 null
		 */
		async readEntityFile(entityHash, logicalPath) {
			const host = await findHostingUser(entityHash)
			if (!host) return null
			return storeForUser(host).readEntityFile(entityHash, logicalPath)
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @param {Buffer | Uint8Array} data 明文
		 * @returns {Promise<void>}
		 */
		async writeEntityFile(entityHash, logicalPath, data) {
			const host = await findHostingUser(entityHash)
			if (!host) throw new Error('entity host not found')
			return storeForUser(host).writeEntityFile(entityHash, logicalPath, data)
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @returns {Promise<boolean>} 是否存在
		 */
		async statEntityFile(entityHash, logicalPath) {
			const host = await findHostingUser(entityHash)
			if (!host) return false
			return storeForUser(host).statEntityFile(entityHash, logicalPath)
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @returns {Promise<string[]>} 逻辑路径列表
		 */
		async listEntityFiles(entityHash) {
			const host = await findHostingUser(entityHash)
			if (!host) return []
			return storeForUser(host).listEntityFiles(entityHash)
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @returns {Promise<object | null>} manifest 或 null
		 */
		async readManifest(entityHash, logicalPath) {
			const host = await findHostingUser(entityHash)
			if (!host) return null
			return storeForUser(host).readManifest(entityHash, logicalPath)
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @param {object} data manifest
		 * @returns {Promise<void>}
		 */
		async writeManifest(entityHash, logicalPath, data) {
			const parsed = parseEntityHash(entityHash)
			if (!parsed) throw new Error('invalid entityHash')
			for (const username of getAllUserNames()) {
				const store = storeForUser(username)
				if (await store.statManifest(entityHash, logicalPath) || await store.readEntityJson(entityHash, 'profile.json')) {
					await store.writeManifest(entityHash, logicalPath, data)
					return
				}
			}
			const firstUser = getAllUserNames()[0]
			if (!firstUser) throw new Error('no users')
			await storeForUser(firstUser).writeManifest(entityHash, logicalPath, data)
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @returns {Promise<boolean>} manifest 是否存在
		 */
		async statManifest(entityHash, logicalPath) {
			const host = await findHostingUser(entityHash)
			if (!host) return false
			return storeForUser(host).statManifest(entityHash, logicalPath)
		},

		findHostingUser,
		storeForUser,
	}
}

/**
 * @param {string} username fount 登录名
 * @returns {string} operator.json 绝对路径
 */
export function operatorJsonPath(username) {
	return path.join(getUserDictionary(username), 'settings', 'operator.json')
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<{ recoveryPubKeyHex: string, activePubKeyHex: string, activeSecretKeyHex?: string } | null>} operator 身份
 */
export async function readOperatorIdentity(username) {
	return readJsonFile(operatorJsonPath(username))
}

/**
 * @param {string} username fount 登录名
 * @param {object} data operator 身份对象
 * @returns {Promise<void>}
 */
export async function writeOperatorIdentity(username, data) {
	const filePath = operatorJsonPath(username)
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeJsonFile(filePath, data)
}
