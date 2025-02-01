import { unzipDirectory } from './zip.mjs'
import { cloneRepo } from './git.mjs'
import { getAvailablePath } from './path.mjs'
import { mkdir, rm } from 'node:fs/promises'
import { move } from 'npm:fs-extra@^11.0.0'
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
		const metaPath = path.join(tempDir, 'fount.json')
		const meta = await loadJsonFile(metaPath)
		const targetPath = await getAvailablePath(username, meta.type, meta.dirname)
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
			const errors = []
			if (line.match(/\/\/git/i) || line.match(/.git(#.*|)$/i)) {
				const tempDir = path.join(tmpdir(), 'fount_import_git_' + Date.now())
				try {
					await cloneRepo(line, tempDir)
					const metaPath = path.join(tempDir, 'fount.json')
					const meta = await loadJsonFile(metaPath)
					const targetPath = await getAvailablePath(username, meta.type, meta.dirname)
					await move(tempDir, targetPath, { overwrite: true })
					continue
				} catch (err) {
					errors.push(err)
					console.error(`Git clone failed for ${line}:`, err)
				}
				await rm(tempDir, { recursive: true, force: true })
			}
			// 尝试作为文件导入
			try {
				// 发送head先获取文件类型，不是zip/png/apng/jpng直接跳过
				let request = await fetch(line, { method: 'HEAD' })
				if (request.ok) {
					const type = request.headers.get('content-type')
					const allowedTypes = ['application/zip', 'image/png', 'image/apng', 'image/jpng']
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
			throw new Error(`Failed to import from ${line}: ${errors.map(err => err.message || err).join('\n')}`)
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
