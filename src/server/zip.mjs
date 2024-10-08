import jszip from 'jszip'

export async function zipDirectory(path) {
	const zip = new jszip()
	const dir = await jszip.loadAsync(fs.readFileSync(path))
	for (const name of Object.keys(dir.files)) {
		const file = dir.files[name]
		zip.file(name, await file.async('nodebuffer'))
	}
	return zip.generateAsync({ type: 'nodebuffer' })
}

export async function unzipDirectory(buffer, path) {
	const zip = new jszip()
	await zip.loadAsync(buffer)
	for (const name of Object.keys(zip.files)) {
		const file = zip.files[name]
		await fs.promises.writeFile(path + '/' + name, await file.async('nodebuffer'))
	}
}

export async function readZipfile(buffer, path) {
	const zip = new jszip()
	await zip.loadAsync(buffer)
	const file = zip.files[path]
	return await file.async('nodebuffer')
}

export async function readZipfileAsJSON(buffer, path) {
	let buffer = await readZipfile(buffer, path)
	return JSON.parse(buffer.toString())
}
