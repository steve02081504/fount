import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 读取 JSONL 文件并解析为对象数组；缺失或读失败时返回空数组。
 * @param {string} filePath 文件系统路径
 * @returns {Promise<object[]>} 各行解析后的对象列表
 */
export async function readJsonl(filePath) {
	try {
		const text = await readFile(filePath, 'utf8')
		return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
	}
	catch {
		return []
	}
}

/**
 * 将单个 JSON 对象作为一行追加写入 JSONL（必要时创建父目录）。
 * @param {string} filePath 目标文件路径
 * @param {object} record 要序列化写入的对象
 * @returns {Promise<void>} 写入完成，无业务返回值
 */
export async function appendJsonl(filePath, record) {
	await mkdir(dirname(filePath), { recursive: true })
	await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
}
