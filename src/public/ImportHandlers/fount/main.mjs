import { unzipDirectory } from './zip.mjs'
import { cloneRepo } from './git.mjs'
import { getAvailablePath } from './path.mjs'
import { mkdir, rm, stat, readdir } from 'node:fs/promises'
import { move, remove } from 'npm:fs-extra@^11.0.0'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadJsonFile } from '../../../scripts/json_loader.mjs'
import { exec } from '../../../scripts/exec.mjs'
import { isPartLoaded } from '../../../server/parts_loader.mjs'
import { loadPart } from '../../../server/managers/index.mjs'
import { existsSync } from 'node:fs'

async function moveWithMerge(src, dest) {
	if (!existsSync(dest)) return await move(src, dest)

	const srcStat = await stat(src)
	const destStat = await stat(dest)

	// Source is a file
	if (srcStat.isFile())
		if (destStat.isFile())
			await move(src, dest, { overwrite: true })
		 else
			throw new Error(`Cannot move file to directory: ${dest}`)
	// Source is a directory
	else if (srcStat.isDirectory())
		if (destStat.isDirectory())
			await mergeDirectories(src, dest)
		 else
			throw new Error(`Cannot move directory to file: ${dest}`)
}

async function mergeDirectories(srcDir, destDir) {
	const items = await readdir(srcDir)
	for (const item of items) {
		const srcPath = path.join(srcDir, item)
		const destPath = path.join(destDir, item)
		const srcStat = await stat(srcPath)

		if (srcStat.isFile())
			await move(srcPath, destPath, { overwrite: true })
		 else if (srcStat.isDirectory())
			if (!existsSync(destPath))
				await move(srcPath, destPath)
			 else
				await mergeDirectories(srcPath, destPath)
	}
	await remove(srcDir)
}

async function ImportAsData(username, data) {
	const tempDir = path.join(tmpdir(), 'fount_import_' + Date.now())
	await mkdir(tempDir, { recursive: true })
	try {
		await unzipDirectory(data, tempDir)
	} catch (err) {
		console.error('Unzip failed:', err)
		await rm(tempDir, { recursive: true, force: true })
		throw new Error(`Unzip failed: ${err.stack || err}`)
	}
	try {
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
		if (needsReload)
			loadPart(username, meta.type, meta.dirname)
		else
			import(path.join(targetPath, 'main.mjs')).catch(x => x)
	} catch (err) {
		rm(tempDir, { recursive: true, force: true }).catch(x => x)
		throw new Error(`loadMeta failed: ${err.message || err}`)
	}
}

async function ImportByText(username, text) {
	const lines = text.trim().split('\n').map(line => line.trim()).filter(line => line)
	for (const line of lines)
		if (line.startsWith('http')) {
			const errors = []
			if (line.match(/\/\/git/i) || line.match(/.git(#.*|)$/i)) {
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
					/**
					 * Executes a git command within the part's directory.
					 * @param {...string} args - Git command arguments.
					 * @returns {Promise<string>} - Promise resolving to the trimmed stdout of the git command.
					 */
					async function git(...args) {
						return (await exec('git -C "' + targetPath + '" ' + args.join(' '))).stdout.trim()
					}
					const remoteBranch = await git('rev-parse --abbrev-ref --symbolic-full-name "@{u}"')
					await git('fetch origin')
					await git('reset --hard ' + remoteBranch)
					if (needsReload)
						loadPart(username, meta.type, meta.dirname)
					else
						import(path.join(targetPath, 'main.mjs')).catch(x => x)
					continue
				} catch (err) {
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
					const allowedTypes = ['application/octet-stream', 'application/zip', 'image/png', 'image/apng', 'image/jpng']
					if (!allowedTypes.includes(type))
						throw new Error(`Unsupported file type: ${type}`)
				}
				request = await fetch(line)
				if (request.ok) {
					const buffer = await request.arrayBuffer()
					await ImportAsData(username, buffer)
					continue
				}
			} catch (err) {
				errors.push(err)
			}
			throw new Error(`Failed to import from ${line}: ${errors.map(err => err.stack || err).join('\n')}`)
		}
}

export default {
	info: {
		'': {
			name: 'fount',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			homepage: '',
			tags: []
		}
	},

	interfaces: {
		import: {
			ImportAsData,
			ImportByText,
		}
	}
}
