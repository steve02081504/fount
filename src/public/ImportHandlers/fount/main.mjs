
import sevenzip from 'npm:7zip-min'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import url from 'node:url'
import { unzip } from '../../../scripts/decompress.mjs'
import { loadJsonFile } from '../../../scripts/loadJsonFile.mjs'
import { moveWithMerge } from '../../../scripts/move.mjs'
import { run_git } from '../../../scripts/run_git.mjs'
import { getAvailablePath, getPartPath } from '../../../server/parts_paths.mjs'
import { isPartLoaded, loadPart } from '../../../server/parts_loader.mjs'
import { cloneRepo } from '../git.mjs'
import info from './info.json' assert { type: 'json' }
/**
 * @typedef {import('../../../decl/part.ts').part_t} part_t
 * @typedef {import('../../../decl/part.ts').parttype_t} parttype_t
 */

/**
 * 通过数据导入。
 * @param {string} username - 用户名。
 * @param {ArrayBuffer} arrayBuffer - 包含数据的 ArrayBuffer。
 * @returns {Promise<part_t[]>} 一个 Promise，解析为导入的部件数组。
 */
async function ImportAsData(username, arrayBuffer) {
	const tempDir = path.join(tmpdir(), `fount_import_${Date.now()}`)
	await mkdir(tempDir, { recursive: true })
	try {
		const buffer = Buffer.from(arrayBuffer)
		let ext
		if (buffer.subarray(0, 2).toString() == 'PK') ext = '.zip'
		else if (buffer.subarray(0, 6).toString() == '7z\\xbc\\xaf\\x27\\x1c') ext = '.7z'
		else throw 'not a zip file'
		const tempFile = path.join(tempDir, `data${ext}`)
		await Deno.writeFile(tempFile, buffer)

		const outpath = path.join(tempDir, 'output')
		if (ext == '.zip')
			await unzip(tempFile, outpath)
		else
			await new Promise((res, rej) => {
				sevenzip.unpack(tempFile, outpath, err => err ? rej(err) : res())
			})

		const metaPath = path.join(outpath, 'fount.json')
		const meta = await loadJsonFile(metaPath)
		const installedParts = []
		if (meta.parts)
			for (const part of meta.parts) {
				const dirname = part.dirname
				const type = part.type
				const needsReload = isPartLoaded(username, type, dirname)
				const targetPath = await getAvailablePath(username, type, dirname)
				const files = await readdir(path.join(outpath, dirname))
				part.data_files ??= []
				if (existsSync(targetPath)) {
					const files = await readdir(targetPath)
					for (const file of files)
						if (!part.data_files.includes(file))
							await rm(path.join(targetPath, file), { recursive: true, force: true })
				}
				await moveWithMerge(path.join(outpath, dirname), targetPath)
				if (needsReload)
					loadPart(username, type, dirname)
				else
					import(url.pathToFileURL(path.join(targetPath, 'main.mjs'))).catch(x => x)
				installedParts.push({ parttype: type, partname: dirname })
			}
		else {
			const type = meta.type
			const dirname = meta.dirname
			const needsReload = isPartLoaded(username, type, dirname)
			const targetPath = await getAvailablePath(username, type, dirname)
			meta.data_files ??= []
			if (existsSync(targetPath)) {
				const files = await readdir(targetPath)
				for (const file of files)
					if (!meta.data_files.includes(file))
						await rm(path.join(targetPath, file), { recursive: true, force: true })
			}
			await moveWithMerge(outpath, targetPath)
			if (needsReload)
				loadPart(username, type, dirname)
			else
				import(url.pathToFileURL(path.join(targetPath, 'main.mjs'))).catch(x => x)
			installedParts.push({ parttype: type, partname: dirname })
		}
		return installedParts
	}
	finally {
		await rm(tempDir, { recursive: true, force: true }).catch(x => x)
	}
}

/**
 * 通过文本导入。
 * @param {string} username - 用户名。
 * @param {string} text - 包含要导入的文本。
 * @returns {Promise<part_t[]>} 一个 Promise，解析为导入的部件数组。
 */
async function ImportByText(username, text) {
	const lines = text.split(/[\r\n]+/).map(line => line.trim()).filter(Boolean)
	const installedParts = []
	for (const line of lines)
		if (line) {
			const errors = []
			// Try importing as a git repo
			if (line.startsWith('http')) {
				const tempDir = path.join(tmpdir(), 'fount_import_git_' + Date.now())
				try {
					await cloneRepo(line, tempDir)
					const metaPath = path.join(tempDir, 'fount.json')
					/**
					 * @type {{type: string, dirname: string, data_files: string[]}}
					 */
					const meta = await loadJsonFile(metaPath)
					const needsReload = isPartLoaded(username, meta.type, meta.dirname)
					const targetPath = await getAvailablePath(username, meta.type, meta.dirname)
					meta.data_files ??= []
					if (existsSync(targetPath)) {
						const files = await readdir(targetPath)
						for (const file of files)
							if (!meta.data_files.includes(file))
								await rm(path.join(targetPath, file), { recursive: true, force: true })
					}
					await moveWithMerge(tempDir, targetPath)
					const git = run_git.withPath(targetPath)
					await git('config core.autocrlf false')
					const remoteBranch = await git('rev-parse --abbrev-ref --symbolic-full-name "@{u}"')
					await git('fetch origin')
					await git('reset --hard ' + remoteBranch)
					if (needsReload)
						loadPart(username, meta.type, meta.dirname)
					else
						import(url.pathToFileURL(path.join(targetPath, 'main.mjs'))).catch(x => x)
					installedParts.push({ parttype: meta.type, partname: meta.dirname })
					continue
				}
				catch (err) {
					errors.push(err)
					console.error(`Git clone failed for ${line}:`, err)
				}
				await rm(tempDir, { recursive: true, force: true }).catch(x => x)
			}
			// Try importing as a file
			try {
				// Send HEAD request to get file type; skip if not zip/png/apng/jpng
				let request = await fetch(line, { method: 'HEAD' })
				if (request.ok) {
					const type = request.headers.get('content-type')
					const allowedTypes = ['application/octet-stream', 'application/zip', 'application/x-7z-compressed', 'image/png', 'image/apng', 'image/jpng']
					if (!allowedTypes.includes(type))
						throw new Error(`Unsupported file type: ${type}`)
				}
				request = await fetch(line)
				if (request.ok) {
					const buffer = await request.arrayBuffer()
					installedParts.push(...await ImportAsData(username, buffer))
					continue
				}
			} catch (err) { errors.push(err) }
			throw new Error(`Failed to import from ${line}: ${errors.map(err => err.stack || err).join('\n')}`)
		}
	return installedParts
}

/**
 * fount 导入器模块定义。
 */
export default {
	info,

	interfaces: {
		import: {
			ImportAsData,
			ImportByText,
		}
	}
}
