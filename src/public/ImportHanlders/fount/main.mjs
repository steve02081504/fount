import { unzipDirectory } from './zip.mjs'
import { cloneRepo } from './git.mjs'
import { getAvailablePath } from './path.mjs'
import { mkdir, rm } from 'node:fs/promises'
import { move } from 'npm:fs-extra'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadJsonFile } from '../../../scripts/json_loader.mjs'

async function ImportAsData(username, data) {
	const tempDir = path.join(tmpdir(), 'fount_import_' + Date.now())
	await mkdir(tempDir, { recursive: true })
	try {
		await unzipDirectory(data, tempDir)
	} catch (err) {
		console.error('Unzip failed:', err)
		await rm(tempDir, { recursive: true, force: true })
		throw new Error(`Unzip failed: ${err.message || err}`)
	}
	try {
		let metaPath = path.join(tempDir, 'fount.json')
		let meta = await loadJsonFile(metaPath)
		let targetPath = await getAvailablePath(username, meta.type, meta.dirname)
		await move(tempDir, targetPath, { overwrite: true })
	} catch (err) {
		await rm(tempDir, { recursive: true, force: true })
		throw new Error(`loadMeta failed: ${err.message || err}`)
	}
}
async function ImportByText(username, text) {
	const lines = text.trim().split('\n').map(line => line.trim()).filter(line => line)
	for (const line of lines)
		if (line.startsWith('http')) {
			const tempDir = path.join(tmpdir(), 'fount_import_git_' + Date.now())
			try {
				await cloneRepo(line, tempDir)
				let metaPath = path.join(tempDir, 'fount.json')
				let meta = await loadJsonFile(metaPath)
				let targetPath = await getAvailablePath(username, meta.type, meta.dirname)
				await move(tempDir, targetPath, { overwrite: true })
			} catch (err) {
				console.error(`Git clone failed for ${line}:`, err)
				await rm(tempDir, { recursive: true, force: true })
				// 尝试作为文件导入
				try {
					let request = await fetch(line)
					if (request.ok) {
						let buffer = await request.arrayBuffer()
						await ImportAsData(username, buffer)
					}
				} catch (err1) {
					console.error(`Fetch and install as file failed for ${line}:`, err1)
					throw new Error(`${line} failed as git clone: ${err.message || err}\nand filed as file: ${err1.message || err1}`)
				}
			}
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

	ImportAsData,
	ImportByText
}
