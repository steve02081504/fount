import jszip from 'npm:jszip'
import { writeFile, mkdir, readdir, stat, readFile } from 'node:fs/promises'
import path from 'node:path'

async function zipDirectory(dirPath, zip) {

	const items = await readdir(dirPath)

	for (const item of items) {
		const itemPath = path.join(dirPath, item)
		const itemStat = await stat(itemPath)

		if (itemStat.isDirectory())
			await zipDirectory(itemPath, zip.folder(item)) // 递归压缩目录
		else {
			const content = await readFile(itemPath)
			zip.file(item, content)
		}
	}
}

export async function zipDir(dirPath) {
	const zip = new jszip()
	await zipDirectory(dirPath, zip)
	return zip.generateAsync({ type: 'nodebuffer' })
}

export async function unzipDirectory(buffer, targetPath) {
	try {
		const zip = new jszip()
		await zip.loadAsync(buffer)

		for (const zipEntry of Object.values(zip.files))
			if (zipEntry.dir) {
				// 如果是目录，则创建目录
				const dirPath = path.join(targetPath, zipEntry.name)
				await mkdir(dirPath, { recursive: true })
				console.log(`Created directory: ${dirPath}`)
			} else {
				// 如果是文件，则写入文件
				const filePath = path.join(targetPath, zipEntry.name)
				const fileBuffer = await zipEntry.async('nodebuffer')
				await mkdir(path.dirname(filePath), { recursive: true })
				await writeFile(filePath, fileBuffer)
				console.log(`Wrote file: ${filePath}`)
			}
	} catch (err) {
		console.error('unzip error:', err)
		throw err
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
