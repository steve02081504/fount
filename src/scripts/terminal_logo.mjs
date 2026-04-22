import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { Buffer } from "node:buffer";

/**
 * 打印自云端拉取的fount logo图像。
 * @returns {Promise<void>} 打印fount logo图像的承诺。
 */
export async function printTerminalLogoImage() {
	const terminalImage = await import('npm:terminal-image')
	const cachePath = path.join(os.tmpdir(), 'fount-repo-logo.png')
	if (!fs.existsSync(cachePath))
		await fs.promises.writeFile(cachePath, Buffer.from(await fetch('https://repository-images.githubusercontent.com/862251163/0ac90205-ae40-4fc6-af67-1e28d074c76b').then(res => res.arrayBuffer())))
	const image = await terminalImage.default.buffer(fs.readFileSync(cachePath))
	console.noBreadcrumb.log(image)
}
