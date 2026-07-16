import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { createFsEntityStore } from 'npm:@steve02081504/fount-p2p/node/entity_store'
import { readJsonFile, writeJsonFile } from 'npm:@steve02081504/fount-p2p/utils/json_io'

import { getAllUserNames, getUserDictionary } from '../../../../../../server/auth/index.mjs'

/**
 * fount 多用户 EntityStore：实体仍存于各用户 `{userDict}/entities/{entityHash}/`。
 * @returns {import('npm:@steve02081504/fount-p2p/node/entity_store').EntityStore} 跨用户路由的 EntityStore
 */
export function createFountEntityStore() {
	const fsStores = new Map()

	/**
	 * @param {string} username fount 登录名
	 * @returns {import('npm:@steve02081504/fount-p2p/node/entity_store').EntityStore} 该用户目录下的 fs store
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
		const want = parsed.entityHash
		for (const username of getAllUserNames()) {
			const store = storeForUser(username)
			if (await store.readEntityJson(want, 'profile.json')) return username
			// 逻辑实体（群 / 共享柜）通常无 profile，仅有 EVFS 目录
			const hashes = await store.listEntityHashes()
			if (hashes.includes(want)) return username
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
			if (host) return storeForUser(host).readManifest(entityHash, logicalPath)
			// 首次写入后目录已在某用户下，但尚无 profile：扫一遍
			for (const username of getAllUserNames()) {
				const data = await storeForUser(username).readManifest(entityHash, logicalPath)
				if (data) return data
			}
			return null
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
 * @returns {string} 用户 entities 根目录
 */
export function entitiesRoot(username) {
	return path.join(getUserDictionary(username), 'entities')
}

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @returns {string} identity.json 绝对路径
 */
export function entityIdentityPath(username, entityHash) {
	return path.join(entitiesRoot(username), String(entityHash).toLowerCase(), 'identity.json')
}

/**
 * 旧路径：settings/operator.json（一次性搬迁源）。
 * @param {string} username fount 登录名
 * @returns {string} 旧 operator.json 路径
 */
export function legacyOperatorJsonPath(username) {
	return path.join(getUserDictionary(username), 'settings', 'operator.json')
}

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @returns {Promise<object | null>} 实体身份行
 */
export async function readEntityIdentity(username, entityHash) {
	return readJsonFile(entityIdentityPath(username, entityHash))
}

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @param {object} data 身份对象
 * @returns {Promise<void>}
 */
export async function writeEntityIdentity(username, entityHash, data) {
	const filePath = entityIdentityPath(username, entityHash)
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeJsonFile(filePath, data)
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<object[]>} 该用户全部实体身份行（含 entityHash）
 */
export async function listEntityIdentities(username) {
	const root = entitiesRoot(username)
	const { readdir } = await import('node:fs/promises')
	let dirs
	try {
		dirs = await readdir(root, { withFileTypes: true })
	}
	catch {
		return []
	}
	/** @type {object[]} */
	const rows = []
	for (const ent of dirs) {
		if (!ent.isDirectory()) continue
		const row = await readEntityIdentity(username, ent.name)
		if (row) rows.push({ ...row, entityHash: String(ent.name).toLowerCase() })
	}
	return rows
}
