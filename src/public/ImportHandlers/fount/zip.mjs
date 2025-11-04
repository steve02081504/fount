import { Buffer } from 'node:buffer'
import { writeFile, mkdir, readdir, stat, readFile, rm } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import path from 'node:path'

import jszip from 'npm:jszip'
import seven from 'npm:node-7z'

import { exec } from '../../../scripts/exec.mjs'

let sevenZipPathCache
/**
 * 检测 7z 可执行文件的路径。它会首先在系统 PATH 中查找，如果找不到则回退使用 npm 上的 '7zip-bin-full' 模块。
 * @returns {Promise<string>} - 返回 7z 可执行文件的路径。
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

/**
 * 递归地将目录内容添加到 zip 对象。
 * @param {string} dirPath - 目录路径。
 * @param {jszip} zip - jszip 实例。
 */
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

/**
 * 检查缓冲区是否为有效的 fount 部件。
 * @param {Buffer} buffer - 缓冲区。
 * @returns {Promise<boolean>} - 如果是有效的 fount 部件则返回 true，否则返回 false。
 */
export async function isFountPart(buffer) {
	// Try zip first - it works in memory and is likely more common.
	try {
		const zip = new jszip()
		await zip.loadAsync(buffer)
		const file = zip.files['fount.json']
		// If it's a valid zip, we have our answer.
		return !!(file && !file.dir)
	}
	catch (zipErr) {
		// Zip failed, let's try 7z. This requires a temp file.
		const tempFilePath7z = path.join(tmpdir(), `fount_import_check_${Date.now()}.tmp`)
		try {
			await writeFile(tempFilePath7z, Buffer.from(buffer))
			const sevenZipPath = await get7zPath()
			return await new Promise((resolve, reject) => {
				const stream = seven.list(tempFilePath7z, { $bin: sevenZipPath })
				stream.on('data', file => {
					const normalizedPath = path.normalize(file.file).replace(/\\/g, '/')
					if (normalizedPath == 'fount.json') resolve(true)
				})
				stream.on('end', () => resolve(false))
				stream.on('error', err => reject(err))
			})
		}
		catch (err7z) {
			// Both failed
			console.error('isFountPart check failed for both zip and 7z.', { zip_error: zipErr, '7z_error': err7z })
			return false
		}
		finally {
			await rm(tempFilePath7z, { force: true }).catch(() => { })
		}
	}
}

/**
 * 压缩目录。
 * @param {string} dirPath - 目录路径。
 * @returns {Promise<Buffer>} - 压缩后的缓冲区。
 */
export async function zipDir(dirPath) {
	const zip = new jszip()
	await zipDirectory(dirPath, zip)
	return zip.generateAsync({ type: 'nodebuffer' })
}

/**
 * 解压目录。
 * @param {Buffer} buffer - 缓冲区。
 * @param {string} targetPath - 目标路径。
 */
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
	}
	catch {
		// Zip failed, let's try 7z. This requires a temp file.
		tempFilePath7z = path.join(tmpdir(), `fount_import_extract_${Date.now()}.tmp`)
		try {
			await writeFile(tempFilePath7z, Buffer.from(buffer))
			const sevenZipPath = await get7zPath()
			await new Promise((resolve, reject) => {
				const stream = seven.extractFull(tempFilePath7z, targetPath, { $bin: sevenZipPath })
				stream.on('end', () => resolve())
				stream.on('error', err => reject(err))
			})
		}
		catch (err7z) {
			// Both failed.
			throw new Error(`Failed to extract archive: Not a supported zip or 7z file. Details: ${err7z.message || err7z}`)
		}
	}
	finally {
		if (tempFilePath7z) await rm(tempFilePath7z, { force: true }).catch(() => { })
	}
}

/**
 * 读取 zip 文件中的文件。
 * @param {Buffer} buffer - zip 文件缓冲区。
 * @param {string} zipPath - zip 文件中的文件路径。
 * @returns {Promise<Buffer>} - 文件内容缓冲区。
 */
export async function readZipfile(buffer, zipPath) {
	const zip = new jszip()
	await zip.loadAsync(buffer)
	const file = zip.files[zipPath]
	if (!file || file.dir)
		throw new Error(`File not found in ZIP: ${zipPath}`)

	return await file.async('nodebuffer')
}

/**
 * 以 JSON 格式读取 zip 文件中的文件。
 * @param {Buffer} buffer - zip 文件缓冲区。
 * @param {string} zipPath - zip 文件中的文件路径。
 * @returns {Promise<any>} - 解析后的 JSON 对象。
 */
export async function readZipfileAsJSON(buffer, zipPath) {
	try {
		const filebuffer = await readZipfile(buffer, zipPath)
		return JSON.parse(filebuffer.toString())
	}
	catch (err) {
		throw new Error(`Failed to parse JSON file in ZIP ${zipPath}, ${err.message || err}`)
	}
}

/**
 * 使用 7z 压缩目录。
 * @param {string} dirPath - 目录路径。
 * @returns {Promise<Buffer>} - 压缩后的缓冲区。
 */
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
