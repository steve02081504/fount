import { Buffer } from 'node:buffer'

import { debugLog } from '../../../../../../../scripts/debug_log.mjs'

/**
 * @param {unknown} error 存储删除错误
 * @returns {boolean} 是否为「对象不存在」类错误
 */
function isAbsentStorageError(error) {
	const err = /** @type {{ code?: string, name?: string, $metadata?: { httpStatusCode?: number } }} */ error
	return err?.code === 'ENOENT'
		|| err?.name === 'NotFound'
		|| err?.$metadata?.httpStatusCode === 404
}

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
 * @param {S3StorageConfig} config 桶与凭证
 * @returns {Promise<import('@aws-sdk/client-s3').S3Client>} S3 客户端
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
 * @param {S3StorageConfig} config 配置
 * @param {string} groupId 群 ID
 * @param {string} chunkHash 分片 hash
 * @returns {string} S3 对象键
 */
function s3ObjectKey(config, groupId, chunkHash) {
	const normalizedPrefix = (config.prefix || '').replace(/\/+$/u, '')
	const base = `groups/${groupId}/chunks/${chunkHash}.bin`
	return normalizedPrefix ? `${normalizedPrefix}/${base}` : base
}

/**
 * @param {string} groupId 群 ID
 * @param {string} chunkHash 分片 hash
 * @returns {string} 联邦规范对象键
 */
function federatedCanonicalKey(groupId, chunkHash) {
	return `groups/${groupId}/chunks/${chunkHash}.bin`
}

/**
 * AWS S3 或兼容端（MinIO 等）。locator：`s3://${bucket}/${key}`
 *
 * @param {S3StorageConfig} config 配置
 * @returns {import('npm:@steve02081504/fount-p2p/node/storage_plugins').GroupStoragePlugin} S3 存储插件
 */
export function createS3StoragePlugin(config) {
	/** @type {import('@aws-sdk/client-s3').S3Client | null} */
	let cached = null
	/**
	 * @returns {Promise<import('@aws-sdk/client-s3').S3Client>} S3 客户端
	 */
	async function client() {
		if (!cached) cached = await createS3Client(config)
		return cached
	}
	return {
		/**
		 * @param {string} groupId 群 ID
		 * @param {string} chunkHash 分片 hash
		 * @param {Uint8Array | Buffer} data 数据
		 * @returns {Promise<{ storageLocator: string }>} 存储定位器
		 */
		async putChunk(groupId, chunkHash, data) {
			const { PutObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const s3Client = await client()
			const objectKey = s3ObjectKey(config, groupId, chunkHash)
			await s3Client.send(new PutObjectCommand({
				Bucket: config.bucket,
				Key: objectKey,
				Body: Buffer.from(data),
			}))
			return { storageLocator: `s3://${config.bucket}/${objectKey}` }
		},
		/**
		 * @param {object} locator 定位器
		 * @returns {Promise<Uint8Array>} 分片数据
		 */
		async getChunk(locator) {
			const { GetObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const s3LocatorMatch = String(locator).match(/^s3:\/\/([^/]+)\/(.+)$/u)
			if (!s3LocatorMatch) throw new Error('Invalid s3 locator')
			const bucket = s3LocatorMatch[1]
			const objectKey = s3LocatorMatch[2]
			const s3Client = await client()
			const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }))
			const body = out.Body
			if (!body) throw new Error('S3 empty body')
			const chunks = []
			for await (const part of body)
				chunks.push(part)
			return new Uint8Array(Buffer.concat(chunks))
		},
		/**
		 * @param {object} locator 定位器
		 * @returns {Promise<void>} 无
		 */
		async deleteChunk(locator) {
			const { DeleteObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const s3LocatorMatch = String(locator).match(/^s3:\/\/([^/]+)\/(.+)$/u)
			if (!s3LocatorMatch) return
			const bucket = s3LocatorMatch[1]
			const objectKey = s3LocatorMatch[2]
			try {
				const s3Client = await client()
				await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }))
			}
			catch (error) {
				if (!isAbsentStorageError(error))
					await debugLog('p2p-chunk-delete', { locator, message: error?.message }).catch(() => {})
			}
		},
	}
}

/**
 * 联邦分块：同一 object key 写入多个 S3 副本。locator：`fed:${key}`
 *
 * @param {{ replicas: S3StorageConfig[] }} config 联邦副本配置
 * @returns {import('npm:@steve02081504/fount-p2p/node/storage_plugins').GroupStoragePlugin} 联邦多副本存储插件
 */
export function createFederatedChunksPlugin(config) {
	const replicas = config?.replicas
	if (!Array.isArray(replicas) || replicas.length === 0)
		throw new Error('federated_chunks: replicas[] required (non-empty S3StorageConfig[])')

	/** @type {import('@aws-sdk/client-s3').S3Client[]} */
	const clients = []

	/**
	 * @param {number} replicaIndex 副本下标
	 * @returns {Promise<import('@aws-sdk/client-s3').S3Client>} S3 客户端
	 */
	async function clientAt(replicaIndex) {
		if (!clients[replicaIndex]) clients[replicaIndex] = await createS3Client(replicas[replicaIndex])
		return clients[replicaIndex]
	}

	return {
		/**
		 * @param {string} groupId 群 ID
		 * @param {string} chunkHash 分片 hash
		 * @param {Uint8Array | Buffer} data 数据
		 * @returns {Promise<{ storageLocator: string }>} 存储定位器
		 */
		async putChunk(groupId, chunkHash, data) {
			const { PutObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const buf = Buffer.from(data)
			const canonical = federatedCanonicalKey(groupId, chunkHash)
			for (let replicaIndex = 0; replicaIndex < replicas.length; replicaIndex++) {
				const replicaConfig = replicas[replicaIndex]
				const objectKey = s3ObjectKey(replicaConfig, groupId, chunkHash)
				const s3Client = await clientAt(replicaIndex)
				await s3Client.send(new PutObjectCommand({
					Bucket: replicaConfig.bucket,
					Key: objectKey,
					Body: buf,
				}))
			}
			return { storageLocator: `fed:${canonical}` }
		},
		/**
		 * @param {object} locator 定位器
		 * @returns {Promise<Uint8Array>} 分片数据
		 */
		async getChunk(locator) {
			const { GetObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const federatedLocatorMatch = String(locator).match(/^fed:(.+)$/u)
			if (!federatedLocatorMatch) throw new Error('Invalid federated locator')
			const canonical = federatedLocatorMatch[1]
			let lastError
			for (let replicaIndex = 0; replicaIndex < replicas.length; replicaIndex++) {
				const replicaConfig = replicas[replicaIndex]
				const prefix = (replicaConfig.prefix || '').replace(/\/+$/u, '')
				const objectKey = prefix ? `${prefix}/${canonical}` : canonical
				try {
					const s3Client = await clientAt(replicaIndex)
					const out = await s3Client.send(new GetObjectCommand({
						Bucket: replicaConfig.bucket,
						Key: objectKey,
					}))
					const body = out.Body
					if (!body) continue
					const chunks = []
					for await (const part of body)
						chunks.push(part)
					return new Uint8Array(Buffer.concat(chunks))
				}
				catch (error) {
					lastError = error
				}
			}
			throw lastError || new Error('federated getChunk: all replicas failed')
		},
		/**
		 * @param {object} locator 定位器
		 * @returns {Promise<void>} 无
		 */
		async deleteChunk(locator) {
			const { DeleteObjectCommand } = await import('npm:@aws-sdk/client-s3')
			const federatedLocatorMatch = String(locator).match(/^fed:(.+)$/u)
			if (!federatedLocatorMatch) return
			const canonical = federatedLocatorMatch[1]
			for (let replicaIndex = 0; replicaIndex < replicas.length; replicaIndex++) {
				const replicaConfig = replicas[replicaIndex]
				const prefix = (replicaConfig.prefix || '').replace(/\/+$/u, '')
				const objectKey = prefix ? `${prefix}/${canonical}` : canonical
				try {
					const s3Client = await clientAt(replicaIndex)
					await s3Client.send(new DeleteObjectCommand({ Bucket: replicaConfig.bucket, Key: objectKey }))
				}
				catch (error) {
					if (!isAbsentStorageError(error))
						await debugLog('p2p-chunk-delete', { locator, replica: replicaIndex, message: error?.message }).catch(() => {})
				}
			}
		},
	}
}
