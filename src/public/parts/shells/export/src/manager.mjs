import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { git } from '../../../../../scripts/git.mjs'
import { loadJsonFile } from '../../../../../scripts/json_loader.mjs'
import { GetPartPath } from '../../../../../server/parts_loader.mjs'
import { sevenZipDir, zipDir } from '../../../ImportHandlers/fount/zip.mjs'
import { unlockAchievement } from '../../achievements/src/api.mjs'

const LITTERBOX_API_URL = 'https://litterbox.catbox.moe/resources/internals/api.php'

/**
 * 获取部件的fount.json。
 * @param {string} username - 用户名。
 * @param {string} partpath - 部件路径。
 * @returns {Promise<object>} - fount.json内容。
 */
export async function getFountJson(username, partpath) {
	const normalized = partpath?.replace(/^\/+|\/+$/g, '')
	if (!normalized) throw new Error('partpath is required')
	const partPath = GetPartPath(username, normalized)
	const fountJsonPath = path.join(partPath, 'fount.json')
	let json
	try {
		json = await loadJsonFile(fountJsonPath)
	}
	catch (error) {
		if (error.code != 'ENOENT') throw error
		json = {
			type: normalized.split('/')[0],
			dirname: normalized.split('/').slice(1).join('/'),
			data_files: [],
		}
	}

	if (!json.share_link) {
		const gitPath = path.join(partPath, '.git')

		if (fs.existsSync(gitPath)) try {
			const remoteUrl = await git.withPath(partPath)('remote get-url origin')
			if (remoteUrl.trim()) json.share_link = remoteUrl.trim()
		}
			catch (err) {
				console.warn(`Could not get git remote for ${normalized}:`, err)
			}
	}

	return json
}

/**
 * 导出部件。
 * @param {string} username - 用户名。
 * @param {string} partpath - 部件路径。
 * @param {boolean} withData - 是否包含数据。
 * @returns {Promise<{buffer: Buffer, format: string}>} - 导出的文件buffer和格式。
 */
export async function exportPart(username, partpath, withData) {
	const normalized = partpath?.replace(/^\/+|\/+$/g, '')
	if (!normalized) throw new Error('partpath is required')
	const partPath = GetPartPath(username, normalized)
	const fountJsonPath = path.join(partPath, 'fount.json')
	let fountJson = {}

	try {
		fountJson = await loadJsonFile(fountJsonPath)
	}
	catch (error) {
		if (error.code != 'ENOENT') throw error
		fountJson = {
			type: normalized.split('/')[0],
			dirname: normalized.split('/').slice(1).join('/'),
		}
	}

	const tempDir = path.join(os.tmpdir(), `fount_export_${Date.now()}`)
	await fsp.mkdir(tempDir, { recursive: true })
	try {
		const files = await fsp.readdir(partPath)
		for (const file of files)
			if (withData || !fountJson.data_files?.includes?.(file)) try {
				await fsp.cp(path.join(partPath, file), path.join(tempDir, file), { recursive: true })
			} catch (error) { console.error(error) }

		if (!fs.existsSync(fountJsonPath)) fs.writeFileSync(path.join(tempDir, 'fount.json'), JSON.stringify(fountJson, null, '\t') + '\n', 'utf8')

		try {
			const buffer = await sevenZipDir(tempDir)
			return { buffer, format: '7z' }
		}
		catch (err) {
			console.warn('7z compression failed, falling back to zip. Error:', err)
			const buffer = await zipDir(tempDir)
			return { buffer, format: 'zip' }
		}
	}
	finally {
		await fsp.rm(tempDir, { recursive: true, force: true })
	}
}

/**
 * 创建分享链接。
 * @param {string} username - 用户名。
 * @param {string} partpath - 部件路径。
 * @param {string} expiration - 过期时间。
 * @param {boolean} withData - 是否包含数据。
 * @returns {Promise<string>} - 分享链接。
 */
export async function createShareLink(username, partpath, expiration, withData) {
	const normalized = partpath?.replace(/^\/+|\/+$/g, '')
	if (!normalized) throw new Error('partpath is required')
	const { buffer, format } = await exportPart(username, normalized, withData)

	const formData = new FormData()
	formData.append('reqtype', 'fileupload')
	formData.append('time', expiration)
	formData.append('fileToUpload', new Blob([buffer]), `${normalized.split('/').pop()}.${format}`)

	const response = await fetch(LITTERBOX_API_URL, {
		method: 'POST',
		body: formData,
	})

	if (!response.ok)
		throw new Error(`Failed to upload to litterbox: ${response.statusText}`)

	const link = await response.text()
	unlockAchievement(username, 'shells/export', 'share_part')
	return `https://steve02081504.github.io/fount/protocol?url=fount://run/parts/shells:install/install;${link}`
}
