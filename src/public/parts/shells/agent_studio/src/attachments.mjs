/** 内容寻址的用户本地生成附件（采集快照 + 标记清扫回收）。 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 把附件 payload 复制为不可变字节快照并计算内容哈希。
 * @param {object} file 附件（`buffer` 可为 Buffer / Uint8Array / base64 字符串 / `Buffer.toJSON()` 结果 / evfs 引用）
 * @returns {object} 快照描述（有字节时附带 `buffer` 副本，否则原样保留 `hash` / `byteLength`）
 */
export function snapshotAttachment(file) {
	const { name, mime_type, description } = file
	let bytes = file.buffer
	if (typeof bytes === 'string' && !bytes.startsWith('evfs:')) bytes = Buffer.from(bytes, 'base64')
	else if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes)
	else if (bytes?.type === 'Buffer' && Array.isArray(bytes.data)) bytes = Buffer.from(bytes.data)
	if (!ArrayBuffer.isView(bytes)) return { name, mime_type, description, ...file.hash ? { hash: file.hash, byteLength: file.byteLength } : {} }
	const buffer = Buffer.from(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
	return { name, mime_type, description, hash: createHash('sha256').update(buffer).digest('hex'), byteLength: buffer.length, buffer }
}

/**
 * @param {string} hash 内容哈希
 * @returns {boolean} 是否为合法 blob 键
 */
export function isAttachmentHash(hash) {
	return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)
}

/**
 * 落盘记录子树里的全部附件，返回只含引用的 JSON 安全树。
 * @param {string} directory blob 目录
 * @param {any} value 记录子树
 * @returns {any} 落盘后的子树
 */
export function storeAttachments(directory, value) {
	if (!value || typeof value !== 'object') return value
	if (typeof value.toJSON === 'function') return storeAttachments(directory, value.toJSON())
	if (Array.isArray(value)) return value.map(item => storeAttachments(directory, item))
	const out = {}
	for (const [key, item] of Object.entries(value))
		if (key === 'files' && Array.isArray(item)) out.files = item.map(file => {
			const captured = snapshotAttachment(file)
			const { buffer, ...reference } = captured
			if (buffer) {
				fs.mkdirSync(directory, { recursive: true })
				try { fs.writeFileSync(path.join(directory, reference.hash), buffer, { flag: 'wx' }) }
				catch (error) { if (error.code !== 'EEXIST') throw error }
			}
			return reference
		})
		else out[key] = storeAttachments(directory, item)

	return out
}

/**
 * @param {any} value 记录子树
 * @param {Set<string>} hashes 可达键集合
 * @returns {void}
 */
function collectAttachmentHashes(value, hashes) {
	if (!value || typeof value !== 'object') return
	if (isAttachmentHash(value.hash)) hashes.add(value.hash)
	for (const item of Object.values(value)) collectAttachmentHashes(item, hashes)
}

/**
 * 仅在全部根都成功读出后清扫：损坏的根会中止本轮回收，宁可暂时多留 blob 也不误删。
 * @param {string} directory blob 目录
 * @param {string[]} roots 保留中的记录文件路径
 * @returns {number} 删除的 blob 数
 */
export function sweepAttachments(directory, roots) {
	const reachable = new Set()
	for (const file of roots)
		try { collectAttachmentHashes(JSON.parse(fs.readFileSync(file, 'utf8')), reachable) }
		catch (error) { if (error.code !== 'ENOENT') return 0 }

	if (!fs.existsSync(directory)) return 0
	let removed = 0
	for (const hash of fs.readdirSync(directory))
		if (isAttachmentHash(hash) && !reachable.has(hash)) {
			fs.rmSync(path.join(directory, hash), { force: true })
			removed++
		}
	return removed
}
