import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { git } from '../../../../scripts/git.mjs'
import { loadJsonFile } from '../../../../scripts/json_loader.mjs'
import { GetPartPath } from '../../../../server/parts_loader.mjs'
import { sevenZipDir, zipDir } from '../../../ImportHandlers/fount/zip.mjs'

const LITTERBOX_API_URL = 'https://litterbox.catbox.moe/resources/internals/api.php'

/**
 * Gets the fount.json for a part.
 * @param {string} username
 * @param {string} partType
 * @param {string} partName
 * @returns {Promise<object>}
 */
export async function getFountJson(username, partType, partName) {
	const partPath = GetPartPath(username, partType, partName)
	const fountJsonPath = path.join(partPath, 'fount.json')
	let json
	try {
		json = await loadJsonFile(fountJsonPath)
	}
	catch (error) {
		if (error.code != 'ENOENT') throw error
		json = {
			type: partType,
			dirname: partName,
			data_files: [],
		}
	}

	if (!json.share_link) {
		const partPath = GetPartPath(username, partType, partName)
		const gitPath = path.join(partPath, '.git')

		if (fs.existsSync(gitPath)) try {
			const { stdout: remoteUrl } = await git.withPath(partPath)('remote get-url origin')
			if (remoteUrl.trim()) json.share_link = remoteUrl.trim()
		}
		catch (err) {
			console.warn(`Could not get git remote for ${partName}:`, err)
		}
	}

	return json
}

export async function exportPart(username, partType, partName, withData) {
	const partPath = GetPartPath(username, partType, partName)
	const fountJsonPath = path.join(partPath, 'fount.json')
	let fountJson = {}

	try {
		fountJson = await loadJsonFile(fountJsonPath)
	} catch (error) {
		if (error.code != 'ENOENT') throw error
		fountJson = {
			type: partType,
			dirname: partName,
		}
	}

	const tempDir = path.join(os.tmpdir(), `fount_export_${Date.now()}`)
	await fsp.mkdir(tempDir, { recursive: true })
	try {
		const files = await fsp.readdir(partPath)
		for (const file of files)
			if (withData || !fountJson.data_files?.includes?.(file)) try {
				await fsp.cp(path.join(partPath, file), path.join(tempDir, file), { recursive: true })
			} catch (error) {
				console.error(error)
			}

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

export async function createShareLink(username, partType, partName, expiration, withData) {
	const { buffer, format } = await exportPart(username, partType, partName, withData)

	const formData = new FormData()
	formData.append('reqtype', 'fileupload')
	formData.append('time', expiration)
	formData.append('fileToUpload', new Blob([buffer]), `${partName}.${format}`)

	const response = await fetch(LITTERBOX_API_URL, {
		method: 'POST',
		body: formData,
	})

	if (!response.ok)
		throw new Error(`Failed to upload to litterbox: ${response.statusText}`)

	const link = await response.text()
	return `https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;${link}`
}
