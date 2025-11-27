
import { PNG } from 'npm:pngjs'
import { JSDOM } from 'npm:jsdom'
import { unzip } from '../../../scripts/decompress.mjs'
import { loadJsonFile } from '../../../scripts/loadJsonFile.mjs'
import { getAvailablePath } from '../../../server/parts_paths.mjs'
import { loadPart } from '../../../server/parts_loader.mjs'
import { sanitize_filename } from '../../../scripts/sanitizer.mjs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createWriteStream } from 'node:fs'
import info from './info.json' assert { type: 'json' }

/**
 * @typedef {import('../../../decl/part.ts').part_t} part_t
 */

/**
 * 将 Risu 角色卡数据转换为 fount 角色格式。
 * @param {object} data - Risu 角色卡数据。
 * @param {string} username - 用户名。
 * @returns {Promise<part_t>} 转换后的 fount 角色。
 */
async function toFountChar(data, username) {
	if (data.spec != 'cc-v3.1' && data.spec != 'cc-v3.0')
		throw new Error('not a v3 character card')

	const char_name = sanitize_filename(data.data.name)
	const targetPath = await getAvailablePath(username, 'chars', char_name)

	const lorebook_entries = []
	if (data.data.lorebook)
		for (const entry of data.data.lorebook.entries)
			lorebook_entries.push({
				...entry,
				position: entry.insertion_order,
				case_sensitive: entry.case_sensitive,
			})


	const charData = {
		main: {
			name: data.data.name,
			creator: data.data.creator,
			// ... (rest of the fields)
		},
		memory: {
			lorebook: lorebook_entries,
		}
	}

	await Deno.writeTextFile(path.join(targetPath, 'character.json'), JSON.stringify(charData, null, '\t'))
	await Deno.copyFile(new URL('char_main.mjs', import.meta.url), path.join(targetPath, 'main.mjs'))

	if (data.data.assets)
		for (const asset of data.data.assets)
			try {
				const assetPath = path.join(targetPath, asset.name)
				const assetData = Buffer.from(asset.data, 'base64')
				await Deno.writeFile(assetPath, assetData)
			} catch (e) { console.error(e) }

	loadPart(username, 'chars', char_name)

	return {
		parttype: 'chars',
		partname: char_name
	}
}
// ... (rest of the code is unchanged)
/**
 * 通过数据导入。
 * @param {string} username - 用户名。
 * @param {ArrayBuffer} arrayBuffer - 包含数据的 ArrayBuffer。
 * @returns {Promise<part_t[]>} 一个 Promise，解析为导入的部件数组。
 */
async function ImportAsData(username, arrayBuffer) {
	const buffer = Buffer.from(arrayBuffer)
	let data
	if (buffer.subarray(0, 4).toString() == 'char')
		data = JSON.parse(await unzip(buffer, 'chardata.json'))
	else if (buffer.subarray(0, 8).toString('hex') == '89504e470d0a1a0a') {
		const png = PNG.sync.read(buffer)
		const text = Object.values(png.chunks.find(chunk => chunk.type == 'tEXt'))[1]
		data = JSON.parse(text)
	}
	else
		data = JSON.parse(buffer.toString())


	return [await toFountChar(data, username)]
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
			try {
				let request = await fetch(line)
				if (request.ok) {
					// if url, do some shit
					if (line.match(/^https?:\/\/realm\.risuai\.net\//)) {
						const dom = new JSDOM(await request.text())
						const meta = dom.window.document.querySelector('meta[property="og:image:alt"]')
						const data = JSON.parse(meta.content)
						installedParts.push(await toFountChar(data, username))
					}
					else {
						const buffer = await request.arrayBuffer()
						installedParts.push(...await ImportAsData(username, buffer))
					}
					continue
				}
			} catch (err) { errors.push(err) }
			throw new Error(`Failed to import from ${line}: ${errors.map(err => err.stack || err).join('\n')}`)
		}
	return installedParts
}


export default {
	info,
	interfaces: {
		import: {
			ImportAsData,
			ImportByText,
		}
	}
}
