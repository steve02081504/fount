import { writeFile, mkdir, readdir, stat, readFile, rm } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import path from 'node:path'

import jszip from 'npm:jszip'
import seven from 'npm:node-7z'

import { exec } from '../../../scripts/exec.mjs'

let sevenZipPathCache
/**
 * Detects the path to the 7z executable using Node.js core 'exec'.
 * It first checks for a system-wide '7z' command in the PATH.
 * If not found (ENOENT), it dynamically imports and uses 'npm:7zip-bin-full' as a fallback.
 * The result is cached to avoid repeated detections.
 * @returns {Promise<string>} A promise that resolves to the path of the 7z executable.
 */
async function get7zPath() {
	if (sevenZipPathCache) return sevenZipPathCache
	try {
		await exec('7z')
		return sevenZipPathCache = '7z'
	}
	catch (_err) {
		const sevenBin = await import('npm:7zip-bin-full')
		return sevenZipPathCache = sevenBin.default?.path7z
	}
}

async function zipDirectory(dirPath, zip) {
	const items = await readdir(dirPath)
	for (const item of items) {
		const itemPath = path.join(dirPath, item)
		const itemStat = await stat(itemPath)
		if (itemStat.isDirectory())
			await zipDirectory(itemPath, zip.folder(item))
		else {
			const content = await readFile(itemPath)
			zip.file(item, content)
		}
	}
}

export async function isFountPart(buffer) {
	// Try zip first - it works in memory and is likely more common.
	try {
		const zip = new jszip()
		await zip.loadAsync(buffer)
		const file = zip.files['fount.json']
		// If it's a valid zip, we have our answer.
		return !!(file && !file.dir)
	} catch (zipErr) {
		// Zip failed, let's try 7z. This requires a temp file.
		const tempFilePath7z = path.join(tmpdir(), `fount_import_check_${Date.now()}.tmp`)
		try {
			await writeFile(tempFilePath7z, Buffer.from(buffer))
			const sevenZipPath = await get7zPath()
			return await new Promise((resolve, reject) => {
				const stream = seven.list(tempFilePath7z, { $bin: sevenZipPath })
				stream.on('data', (file) => {
					const normalizedPath = path.normalize(file.file).replace(/\\/g, '/')
					if(normalizedPath == 'fount.json') resolve(true)
				})
				stream.on('end', () => resolve(false))
				stream.on('error', (err) => reject(err))
			})
		} catch (err7z) {
			// Both failed
			console.error('isFountPart check failed for both zip and 7z.', { 'zip_error': zipErr, '7z_error': err7z })
			return false
		} finally {
			await rm(tempFilePath7z, { force: true }).catch(() => { })
		}
	}
}

export async function zipDir(dirPath) {
	const zip = new jszip()
	await zipDirectory(dirPath, zip)
	return zip.generateAsync({ type: 'nodebuffer' })
}

export async function unzipDirectory(buffer, targetPath) {
	// Try zip first - it works in memory.
	let tempFilePath7z
	try {
		const zip = new jszip()
		await zip.loadAsync(buffer)
		for (const zipEntry of Object.values(zip.files)) {
			const fullPath = path.join(targetPath, zipEntry.name)
			if (zipEntry.dir)
				await mkdir(fullPath, { recursive: true })
			else {
				const fileBuffer = await zipEntry.async('nodebuffer')
				await mkdir(path.dirname(fullPath), { recursive: true })
				await writeFile(fullPath, fileBuffer)
			}
		}
	} catch (_zipErr) {
		// Zip failed, let's try 7z. This requires a temp file.
		tempFilePath7z = path.join(tmpdir(), `fount_import_extract_${Date.now()}.tmp`)
		try {
			await writeFile(tempFilePath7z, Buffer.from(buffer))
			const sevenZipPath = await get7zPath()
			await new Promise((resolve, reject) => {
				const stream = seven.extractFull(tempFilePath7z, targetPath, { $bin: sevenZipPath })
				stream.on('end', () => resolve())
				stream.on('error', (err) => reject(err))
			})
		} catch (err7z) {
			// Both failed.
			throw new Error(`Failed to extract archive: Not a supported zip or 7z file. Details: ${err7z.message || err7z}`)
		}
	} finally {
		if (tempFilePath7z) await rm(tempFilePath7z, { force: true }).catch(() => { })
	}
}

export async function readZipfile(buffer, zipPath) {
	const zip = new jszip()
	await zip.loadAsync(buffer)
	const file = zip.files[zipPath]
	if (!file || file.dir)
		throw new Error(`File not found in ZIP: ${zipPath}`)

	return await file.async('nodebuffer')
}

export async function readZipfileAsJSON(buffer, zipPath) {
	try {
		const filebuffer = await readZipfile(buffer, zipPath)
		return JSON.parse(filebuffer.toString())
	} catch (err) {
		throw new Error(`Failed to parse JSON file in ZIP ${zipPath}, ${err.message || err}`)
	}
}

export async function sevenZipDir(dirPath) {
	const tempArchiveDir = os.tmpdir()
	const tempArchiveName = `fount_export_${Date.now()}.7z`
	const tempArchiveFullPath = path.join(tempArchiveDir, tempArchiveName)

	try {
		const sevenZipPath = await get7zPath()
		await new Promise((resolve, reject) => {
			// Add all files from the directory to the archive
			const stream = seven.add(tempArchiveFullPath, `${dirPath}${path.sep}*`, { $bin: sevenZipPath })
			stream.on('end', () => resolve())
			stream.on('error', reject)
		})

		const buffer = await readFile(tempArchiveFullPath)
		return buffer
	}
	finally {
		await rm(tempArchiveFullPath, { force: true }).catch(() => { })
	}
}
