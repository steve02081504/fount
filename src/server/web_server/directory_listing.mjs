import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

import { fileTypeFromBuffer } from 'npm:file-type'
import mimetype from 'npm:mime-types'

import { __dirname } from '../base.mjs'

const TEMPLATE_PATH = path.join(__dirname, 'src/public/pages/directory-listing/index.html')

/**
 * 根据文件内容（Buffer）和文件名推断 MIME 类型。
 * @param {Buffer} buffer - 文件内容（或前 N 字节）。
 * @param {string} name - 文件名。
 * @returns {Promise<string>} 推断出的 MIME 类型。
 */
async function mimetypeFromBufferAndName(buffer, name) {
	let result = (await fileTypeFromBuffer(buffer))?.mime
	result ||= mimetype.lookup(name)
	result ||= buffer.toString('utf-8').isWellFormed() ? 'text/plain' : undefined
	result ||= 'application/octet-stream'
	return result
}

/**
 * 格式化文件大小。
 * @param {number} bytes - 文件大小（字节）。
 * @returns {string} 格式化后的文件大小。
 */
function formatSize(bytes) {
	if (bytes === 0) return '0 B'
	const k = 1024
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
	let i = 0
	let size = Number(bytes)
	while (size >= k && i < units.length - 1) {
		size /= k
		i += 1
	}
	return `${size.toFixed(i > 0 ? 2 : 0)} ${units[i]}`
}

/**
 * 根据 URL 路径和实际文件夹路径生成目录列表 HTML。
 * 从 pages 下的模板读取 HTML，将 {{DIRECTORY_PATH}} 和 {{DIRECTORY_DATA}} 替换为注入数据。
 * @param {string} urlPath - 当前目录的 URL 路径（如 /parts/chars:GentianAphrodite/imgs/），用于标题与构建子项链接。
 * @param {string} dirPath - 实际文件系统上的目录绝对路径，用于读取子项。
 * @returns {Promise<string>} 完整 HTML 字符串。
 */
export async function renderDirectoryListingHtml(urlPath, dirPath) {
	const normalizedUrl = urlPath.replace(/\/$/, '') || urlPath
	const baseUrl = normalizedUrl || '/'
	const parentUrl = baseUrl.includes('/') ? baseUrl.replace(/\/[^/]+$/, '') + '/' : null

	const dirents = fs.readdirSync(dirPath, { withFileTypes: true })
	const sorted = dirents.sort((a, b) => a.isDirectory() === b.isDirectory() ? 0 : a.isDirectory() ? -1 : 1)

	const entries = await Promise.all(sorted.map(async dirent => {
		const name = dirent.name + (dirent.isDirectory() ? '/' : '')
		const href = baseUrl + '/' + encodeURIComponent(dirent.name) + (dirent.isDirectory() ? '/' : '')
		let mimeType = null
		let sizeFormatted = null
		if (!dirent.isDirectory()) try {
			const fullPath = path.join(dirPath, dirent.name)
			const stat = fs.statSync(fullPath)
			sizeFormatted = formatSize(stat.size)
			const sizeToRead = 1024
			const buffer = Buffer.alloc(sizeToRead)
			const fd = fs.openSync(fullPath, 'r')
			try {
				fs.readSync(fd, buffer, 0, sizeToRead, 0)
			} finally {
				fs.closeSync(fd)
			}
			mimeType = await mimetypeFromBufferAndName(buffer, dirent.name)
		} catch {
			sizeFormatted = '—'
		}
		return { name, href, isDirectory: dirent.isDirectory(), mimeType, sizeFormatted }
	}))

	const data = { path: urlPath, parentUrl, entries }
	const jsonStr = JSON.stringify(data)
	const safeJson = jsonStr.replace(/<\/script/gi, '\\u003c/script')

	let template = fs.readFileSync(TEMPLATE_PATH, 'utf8')
	template = template.replace(/{{DIRECTORY_PATH}}/g, urlPath)
	template = template.replace(/{{DIRECTORY_DATA}}/g, safeJson)

	return template
}
