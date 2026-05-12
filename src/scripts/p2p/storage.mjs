import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 存储插件接口
 * 默认实现：本地文件系统存储
 */

const STORAGE_BASE = path.join(process.cwd(), 'data', 'p2p_storage')

/**
 * 确保目录存在
 * @param {string} dir - 目录路径
 */
function ensureDir(dir) {
	if (!fs.existsSync(dir)) 
		fs.mkdirSync(dir, { recursive: true })
	
}

/**
 * 本地存储插件
 */
export class LocalStoragePlugin {
	/**
	 * @param {object} [config={}] - 单群与全局配额上限等配置
	 */
	constructor(config = {}) {
		this.maxGroupFileStoragePerGroupBytes = config.maxGroupFileStoragePerGroupBytes || 2 * 1024 * 1024 * 1024
		this.globalMaxBytes = config.globalMaxBytes || 50 * 1024 * 1024 * 1024
		ensureDir(STORAGE_BASE)
	}

	/**
	 * 存储文件块
	 * @param {string} groupId - 群组ID
	 * @param {string} chunkHash - 块哈希
	 * @param {import('node:buffer').Buffer} data - 数据
	 * @returns {Promise<string>} `local://` 存储定位符
	 */
	async putChunk(groupId, chunkHash, data) {
		const groupDir = path.join(STORAGE_BASE, groupId, 'chunks')
		ensureDir(groupDir)

		const chunkPath = path.join(groupDir, chunkHash)
		await fs.promises.writeFile(chunkPath, data)

		return `local://${groupId}/chunks/${chunkHash}`
	}

	/**
	 * 获取文件块
	 * @param {string} storageLocator - 存储定位符
	 * @returns {Promise<import('node:buffer').Buffer>} 块原始字节
	 */
	async getChunk(storageLocator) {
		const match = storageLocator.match(/^local:\/\/(.+)$/)
		if (!match) throw new Error('Invalid storage locator')

		const filePath = path.join(STORAGE_BASE, match[1])
		return await fs.promises.readFile(filePath)
	}

	/**
	 * 删除文件块
	 * @param {string} storageLocator - 存储定位符
	 * @returns {Promise<void>} 无返回值
	 */
	async deleteChunk(storageLocator) {
		const match = storageLocator.match(/^local:\/\/(.+)$/)
		if (!match) return

		const filePath = path.join(STORAGE_BASE, match[1])
		if (fs.existsSync(filePath)) 
			await fs.promises.unlink(filePath)
		
	}

	/**
	 * 获取群组存储使用量
	 * @param {string} groupId - 群组ID
	 * @returns {Promise<number>} 目录下文件总字节数
	 */
	async getGroupUsage(groupId) {
		const groupDir = path.join(STORAGE_BASE, groupId)
		if (!fs.existsSync(groupDir)) return 0

		let totalSize = 0
		/**
		 * 递归累计目录体积。
		 * @param {string} dir - 当前目录绝对路径
		 * @returns {void}
		 */
		const walk = (dir) => {
			const files = fs.readdirSync(dir)
			for (const file of files) {
				const filePath = path.join(dir, file)
				const stat = fs.statSync(filePath)
				if (stat.isDirectory()) 
					walk(filePath)
				 else 
					totalSize += stat.size
				
			}
		}

		walk(groupDir)
		return totalSize
	}

	/**
	 * 检查是否可以存储
	 * @param {string} groupId - 群组ID
	 * @param {number} size - 文件大小
	 * @returns {Promise<boolean>} 是否在单群配额内可写入
	 */
	async canStore(groupId, size) {
		const currentUsage = await this.getGroupUsage(groupId)
		return (currentUsage + size) <= this.maxGroupFileStoragePerGroupBytes
	}
}

/**
 * S3 存储插件（可选）
 */
export class S3StoragePlugin {
	/**
	 * @param {object} config - S3 连接参数（bucket、密钥等）
	 */
	constructor(config) {
		this.bucket = config.bucket
		this.region = config.region
		this.accessKeyId = config.accessKeyId
		this.secretAccessKey = config.secretAccessKey
		this.endpoint = config.endpoint
	}

	/**
	 * @param {string} groupId - 群组ID
	 * @param {string} chunkHash - 块哈希
	 * @param {import('node:buffer').Buffer} data - 块数据
	 * @returns {Promise<string>} 存储定位符（未实现则抛错）
	 */
	async putChunk(groupId, chunkHash, data) {
		// S3 上传实现
		throw new Error('S3 storage not implemented yet')
	}

	/**
	 * @param {string} storageLocator - 存储定位符
	 * @returns {Promise<import('node:buffer').Buffer>} 块字节（未实现则抛错）
	 */
	async getChunk(storageLocator) {
		throw new Error('S3 storage not implemented yet')
	}

	/**
	 * @param {string} storageLocator - 存储定位符
	 * @returns {Promise<void>} 无返回值（未实现则抛错）
	 */
	async deleteChunk(storageLocator) {
		throw new Error('S3 storage not implemented yet')
	}

	/**
	 * @param {string} groupId - 群组ID
	 * @returns {Promise<number>} 已用量字节数（占位实现恒为 0）
	 */
	async getGroupUsage(groupId) {
		return 0
	}

	/**
	 * @param {string} groupId - 群组ID
	 * @param {number} size - 拟写入大小
	 * @returns {Promise<boolean>} 占位实现恒为 true
	 */
	async canStore(groupId, size) {
		return true
	}
}

/**
 * 存储管理器
 */
export class StorageManager {
	/**
	 * @param {LocalStoragePlugin|S3StoragePlugin|null} [plugin=null] - 存储后端插件
	 */
	constructor(plugin = null) {
		this.plugin = plugin || new LocalStoragePlugin()
	}

	/**
	 * 存储文件
	 * @param {string} groupId - 群组ID
	 * @param {Buffer} fileData - 文件数据（已加密）
	 * @param {string} fileName - 文件名
	 * @returns {Promise<{ fileHash: string, chunkManifest: Array<{ chunkIndex: number, chunkHash: string, storageLocator: string }> }>} 文件哈希与块清单
	 */
	async storeFile(groupId, fileData, fileName) {
		const chunkSize = 1024 * 1024 // 1MB chunks
		const chunks = []
		const fileHash = await this.hashData(fileData)

		// 检查存储空间
		if (!await this.plugin.canStore(groupId, fileData.length)) 
			throw new Error('Storage quota exceeded')
		

		// 分块存储
		for (let i = 0; i < fileData.length; i += chunkSize) {
			const chunk = fileData.slice(i, i + chunkSize)
			const chunkHash = await this.hashData(chunk)
			const storageLocator = await this.plugin.putChunk(groupId, chunkHash, chunk)

			chunks.push({
				chunkIndex: chunks.length,
				chunkHash,
				storageLocator
			})
		}

		return {
			fileHash,
			chunkManifest: chunks
		}
	}

	/**
	 * 获取文件
	 * @param {Array<{ storageLocator: string }>} chunkManifest - 块清单
	 * @returns {Promise<import('node:buffer').Buffer>} 拼接后的完整文件缓冲
	 */
	async getFile(chunkManifest) {
		const chunks = []

		for (const chunk of chunkManifest) {
			const data = await this.plugin.getChunk(chunk.storageLocator)
			chunks.push(data)
		}

		return Buffer.concat(chunks)
	}

	/**
	 * 删除文件
	 * @param {Array<{ storageLocator: string }>} chunkManifest - 块清单
	 * @returns {Promise<void>} 无返回值
	 */
	async deleteFile(chunkManifest) {
		for (const chunk of chunkManifest) 
			await this.plugin.deleteChunk(chunk.storageLocator)
		
	}

	/**
	 * 计算数据哈希
	 * @param {import('node:buffer').Buffer} data - 数据
	 * @returns {Promise<string>} 小写十六进制 SHA-256
	 */
	async hashData(data) {
		const hash = await crypto.subtle.digest('SHA-256', data)
		return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
	}

	/**
	 * 加密文件
	 * @param {import('node:buffer').Buffer} data - 原始数据
	 * @param {Uint8Array} aesKey - AES 密钥
	 * @returns {Promise<import('node:buffer').Buffer>} IV 与密文拼接后的缓冲
	 */
	async encryptFile(data, aesKey) {
		const iv = crypto.getRandomValues(new Uint8Array(12))
		const key = await crypto.subtle.importKey(
			'raw',
			aesKey,
			{ name: 'AES-GCM' },
			false,
			['encrypt']
		)

		const encrypted = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			key,
			data
		)

		// 将 IV 和密文合并
		const result = new Uint8Array(iv.length + encrypted.byteLength)
		result.set(iv, 0)
		result.set(new Uint8Array(encrypted), iv.length)

		return Buffer.from(result)
	}

	/**
	 * 解密文件
	 * @param {import('node:buffer').Buffer} encryptedData - 加密数据
	 * @param {Uint8Array} aesKey - AES 密钥
	 * @returns {Promise<import('node:buffer').Buffer>} 解密后的明文缓冲
	 */
	async decryptFile(encryptedData, aesKey) {
		const iv = encryptedData.slice(0, 12)
		const ciphertext = encryptedData.slice(12)

		const key = await crypto.subtle.importKey(
			'raw',
			aesKey,
			{ name: 'AES-GCM' },
			false,
			['decrypt']
		)

		const decrypted = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv },
			key,
			ciphertext
		)

		return Buffer.from(decrypted)
	}
}
