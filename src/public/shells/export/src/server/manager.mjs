import { GetPartPath } from '../../../../../server/parts_loader.mjs'
import { loadJsonFile, saveJsonFile } from '../../../../../scripts/json_loader.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { zipDir } from "../../../../ImportHandlers/fount/zip.mjs";

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
		if (error.code === 'ENOENT') {
			return {
				type: partType,
				dirname: partName,
				data_files: [],
			}
		}
		throw error
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

		return await zipDir(tempDir)
	}
	finally {
		await fs.rm(tempDir, { recursive: true, force: true })
	}
}
