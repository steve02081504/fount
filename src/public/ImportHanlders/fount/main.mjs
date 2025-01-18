import { unzipDirectory } from './zip.mjs'
import { cloneRepo } from './git.mjs'
import { getAvailablePath } from './path.mjs'
import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadJsonFile } from '../../../scripts/json_loader.mjs'

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
	async ImportAsData(username, data) {
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
			await rename(tempDir, targetPath)
		} catch (err) {
			await rm(tempDir, { recursive: true, force: true })
			throw new Error(`loadMeta failed: ${err.message || err}`)
		}
	},
	async ImportByText(username, text) {
		const lines = text.trim().split('\n').map(line => line.trim()).filter(line => line)
		for (const line of lines)
			if (line.startsWith('http')) {
				const tempDir = path.join(tmpdir(), 'fount_import_git_' + Date.now())
				try {
					await cloneRepo(line, tempDir)
					let metaPath = path.join(tempDir, 'fount.json')
					let meta = await loadJsonFile(metaPath)
					let targetPath = await getAvailablePath(username, meta.type, meta.dirname)
					await rename(tempDir, targetPath)
				} catch (err) {
					console.error(`Git clone failed for ${line}:`, err)
					await rm(tempDir, { recursive: true, force: true })
					throw new Error(`Git clone failed for ${line}: ${err.message || err}`)
				}
			}
	}
}
