import { GetPartPath } from '../../../../../server/parts_loader.mjs'
import { loadJsonFile } from '../../../../../scripts/json_loader.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { zipDir } from '../../../../ImportHandlers/fount/zip.mjs'
import { nicerWriteFileSync } from '../../../../../scripts/nicerWriteFile.mjs'

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
	try {
		return await loadJsonFile(fountJsonPath)
	}
	catch (error) {
		if (error.code != 'ENOENT') throw error
		return {
			type: partType,
			dirname: partName,
			data_files: [],
		}
	}
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
	await fs.mkdir(tempDir, { recursive: true })
	try {
		const files = await fs.readdir(partPath)
		for (const file of files)
			if (withData || !fountJson.data_files?.includes?.(file)) try {
				await fs.cp(path.join(partPath, file), path.join(tempDir, file), { recursive: true })
			} catch (error) {
				console.error(error)
			}

		nicerWriteFileSync(path.join(tempDir, 'fount.json'), JSON.stringify(fountJson, null, '\t') + '\n', 'utf8')

		return await zipDir(tempDir)
	}
	finally {
		await fs.rm(tempDir, { recursive: true, force: true })
	}
}

export async function createShareLink(username, partType, partName, expiration, withData) {
	const zipBuffer = await exportPart(username, partType, partName, withData)

	const formData = new FormData()
	formData.append('reqtype', 'fileupload')
	formData.append('time', expiration)
	formData.append('fileToUpload', new Blob([zipBuffer]), `${partName}.zip`)

	const response = await fetch(LITTERBOX_API_URL, {
		method: 'POST',
		body: formData,
	})

	if (!response.ok)
		throw new Error(`Failed to upload to litterbox: ${response.statusText}`)

	const link = await response.text()
	return `https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;${link}`
}
