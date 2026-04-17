import { Buffer } from 'node:buffer'
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @typedef {{
 *   putChunk: (groupId: string, chunkHash: string, data: Uint8Array) => Promise<{ storageLocator: string }>,
 *   getChunk: (locator: string) => Promise<Uint8Array>,
 *   deleteChunk: (locator: string) => Promise<void>,
 * }} GroupStoragePlugin
 */

/**
 * @typedef {{
 *   region?: string,
 *   bucket: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   endpoint?: string,
 *   forcePathStyle?: boolean,
 *   prefix?: string,
 * }} S3StorageConfig
 */

/**
 * 默认：本地目录 {baseDir}/groups/{groupId}/chunks/（baseDir 一般为用户 shells/chat）
 *
 * @param {string} baseDir 绝对路径
 * @returns {GroupStoragePlugin} 本地文件系统实现的 put/get/delete
 */
export function createLocalStoragePlugin(baseDir) {
	return {
		/**
		 * 写入分块二进制文件
		 *
		 * @param {string} groupId 群组 id
		 * @param {string} chunkHash 分块内容哈希（文件名）
		 * @param {Uint8Array} data 原始字节
		 * @returns {Promise<{ storageLocator: string }>} `local:` 前缀的定位符
		 */
		async putChunk(groupId, chunkHash, data) {
			const dir = join(baseDir, 'groups', groupId, 'chunks')
			await mkdir(dir, { recursive: true })
			const name = `${chunkHash}.bin`
			const path = join(dir, name)
			await writeFile(path, data)
			return { storageLocator: `local:${groupId}/chunks/${name}` }
		},
		/**
		 * 按 locator 读取分块
		 *
		 * @param {string} locator `local:...` 格式
		 * @returns {Promise<Uint8Array>} 文件内容
		 */
		async getChunk(locator) {
			const m = String(locator).match(/^local:([^/]+)\/chunks\/(.+)$/)
			if (!m) throw new Error('Invalid local locator')
			const path = join(baseDir, 'groups', m[1], 'chunks', m[2])
			return new Uint8Array(await readFile(path))
		},
		/**
		 * 删除本地分块文件（忽略不存在）
		 *
		 * @param {string} locator `local:...` 格式
		 * @returns {Promise<void>}
		 */
		async deleteChunk(locator) {
			const m = String(locator).match(/^local:([^/]+)\/chunks\/(.+)$/)
			if (!m) return
			const path = join(baseDir, 'groups', m[1], 'chunks', m[2])
			try {
				await unlink(path)
			}
			catch { /* ignore */ }
		},
	}
}

/**
 * 懒加载构造 AWS SDK S3Client
 *
 * @param {S3StorageConfig} config 桶与凭证
 * @returns {Promise<import('@aws-sdk/client-s3').S3Client>} 已配置好的客户端实例
 */
async function createS3Client(config) {
	if (!config.bucket || !config.accessKeyId || !config.secretAccessKey)
		throw new Error('S3: bucket, accessKeyId, secretAccessKey are required')
	const { S3Client } = await import('npm:@aws-sdk/client-s3')
	return new S3Client({
		region: config.region || 'us-east-1',
		endpoint: config.endpoint || undefined,
		forcePathStyle: !!config.forcePathStyle,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	})
}

/**
 * 计算带可选 prefix 的 S3 object key
 *
 * @param {S3StorageConfig} config 含 prefix 等
 * @param {string} groupId 群组 id
 * @param {string} chunkHash 分块哈希
 * @returns {string} Put/Get 共用的 Key
 */
function s3ObjectKey(config, groupId, chunkHash) {
	const p = (config.prefix || '').replace(/\/+$/u, '')
	const base = `groups/${groupId}/chunks/${chunkHash}.bin`
	return p ? `${p}/${base}` : base
}

/**
 * 联邦副本共用的相对路径（不含各副本 prefix），用于 fed: locator
 *
 * @param {string} groupId 群组 id
 * @param {string} chunkHash 分块哈希
 * @returns {string} canonical 相对 key
 */
function federatedCanonicalKey(groupId, chunkHash) {
	return `groups/${groupId}/chunks/${chunkHash}.bin`
}

/**
 * AWS S3 或兼容端（MinIO 等）。locator：`s3://${bucket}/${key}`
 *
 * @param {S3StorageConfig} config 桶、凭证与可选 endpoint
 * @returns {GroupStoragePlugin} S3 实现的存储插件
 */
export function createS3StoragePlugin(config) {
	/** @type {import('@aws-sdk/client-s3').S3Client | null} */
	let cached = null
	/**
	 * 单例缓存的 S3 客户端
	 *
	 * @returns {Promise<import('@aws-sdk/client-s3').S3Client>} 懒加载并缓存的 S3 客户端
	 */
	async function client() {
		if (!cached) cached = await createS3Client(config)
		return cached
	}
	return {
		/**
		 * 上传对象至配置桶
		 *
		 * @param {string} groupId 群组 id
		 * @param {string} chunkHash 分块哈希
		 * @param {Uint8Array} data 原始字节
		 * @returns {Promise<{ storageLocator: string }>} `s3://` 定位符
		 */
		async putChunk(groupId, chunkHash, data) {
			const { PutObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const c = await client()
			const Key = s3ObjectKey(config, groupId, chunkHash)
			await c.send(new PutObjectCommand({
				Bucket: config.bucket,
				Key,
				Body: Buffer.from(data),
			}))
			return { storageLocator: `s3://${config.bucket}/${Key}` }
		},
		/**
		 * 自 S3 拉取对象体并拼为 Uint8Array
		 *
		 * @param {string} locator `s3://bucket/key`
		 * @returns {Promise<Uint8Array>} 对象字节
		 */
		async getChunk(locator) {
			const { GetObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const m = String(locator).match(/^s3:\/\/([^/]+)\/(.+)$/u)
			if (!m) throw new Error('Invalid s3 locator')
			const Bucket = m[1]
			const Key = m[2]
			const c = await client()
			const out = await c.send(new GetObjectCommand({ Bucket, Key }))
			const body = out.Body
			if (!body) throw new Error('S3 empty body')
			const chunks = []
			for await (const part of body)
				chunks.push(part)
			return new Uint8Array(Buffer.concat(chunks))
		},
		/**
		 * 删除 S3 对象（忽略错误）
		 *
		 * @param {string} locator `s3://bucket/key`
		 * @returns {Promise<void>}
		 */
		async deleteChunk(locator) {
			const { DeleteObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const m = String(locator).match(/^s3:\/\/([^/]+)\/(.+)$/u)
			if (!m) return
			const Bucket = m[1]
			const Key = m[2]
			try {
				const c = await client()
				await c.send(new DeleteObjectCommand({ Bucket, Key }))
			}
			catch { /* ignore */ }
		},
	}
}

/**
 * 联邦分块：同一 object key 写入多个 S3 副本（多桶 / 多区域 / MinIO + 云），读取按顺序回退。
 * locator：`fed:${key}`（key 不含 bucket，与各副本的 prefix 组合）。
 *
 * @param {{ replicas: S3StorageConfig[] }} config 非空副本配置列表
 * @returns {GroupStoragePlugin} 多副本读写插件
 */
export function createFederatedChunksPlugin(config) {
	const replicas = config?.replicas
	if (!Array.isArray(replicas) || replicas.length === 0)
		throw new Error('federated_chunks: replicas[] required (non-empty S3StorageConfig[])')

	/** @type {import('@aws-sdk/client-s3').S3Client[]} */
	const clients = []

	/**
	 * 按副本索引懒建客户端
	 *
	 * @param {number} i `replicas` 下标
	 * @returns {Promise<import('@aws-sdk/client-s3').S3Client>} 对应副本索引的 S3 客户端
	 */
	async function clientAt(i) {
		if (!clients[i]) clients[i] = await createS3Client(replicas[i])
		return clients[i]
	}

	return {
		/**
		 * 向所有副本写入同一 canonical key
		 *
		 * @param {string} groupId 群组 id
		 * @param {string} chunkHash 分块哈希
		 * @param {Uint8Array} data 原始字节
		 * @returns {Promise<{ storageLocator: string }>} `fed:` 定位符
		 */
		async putChunk(groupId, chunkHash, data) {
			const { PutObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const buf = Buffer.from(data)
			const canonical = federatedCanonicalKey(groupId, chunkHash)
			for (let i = 0; i < replicas.length; i++) {
				const cfg = replicas[i]
				const objectKey = s3ObjectKey(cfg, groupId, chunkHash)
				const c = await clientAt(i)
				await c.send(new PutObjectCommand({
					Bucket: cfg.bucket,
					Key: objectKey,
					Body: buf,
				}))
			}
			return { storageLocator: `fed:${canonical}` }
		},
		/**
		 * 依次尝试各副本直到成功
		 *
		 * @param {string} locator `fed:canonicalKey`
		 * @returns {Promise<Uint8Array>} 首个成功副本的对象字节
		 */
		async getChunk(locator) {
			const { GetObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const m = String(locator).match(/^fed:(.+)$/u)
			if (!m) throw new Error('Invalid federated locator')
			const canonical = m[1]
			let lastErr
			for (let i = 0; i < replicas.length; i++) {
				const cfg = replicas[i]
				const p = (cfg.prefix || '').replace(/\/+$/u, '')
				const Key = p ? `${p}/${canonical}` : canonical
				try {
					const c = await clientAt(i)
					const out = await c.send(new GetObjectCommand({
						Bucket: cfg.bucket,
						Key,
					}))
					const body = out.Body
					if (!body) continue
					const chunks = []
					for await (const part of body)
						chunks.push(part)
					return new Uint8Array(Buffer.concat(chunks))
				}
				catch (e) {
					lastErr = e
				}
			}
			throw lastErr || new Error('federated getChunk: all replicas failed')
		},
		/**
		 * 尽力删除所有副本上的同一对象
		 *
		 * @param {string} locator `fed:canonicalKey`
		 * @returns {Promise<void>}
		 */
		async deleteChunk(locator) {
			const { DeleteObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const m = String(locator).match(/^fed:(.+)$/u)
			if (!m) return
			const canonical = m[1]
			for (let i = 0; i < replicas.length; i++) {
				const cfg = replicas[i]
				const p = (cfg.prefix || '').replace(/\/+$/u, '')
				const Key = p ? `${p}/${canonical}` : canonical
				try {
					const c = await clientAt(i)
					await c.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key }))
				}
				catch { /* ignore */ }
			}
		},
	}
}
