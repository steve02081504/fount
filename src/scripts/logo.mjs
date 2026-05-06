import { Buffer } from 'node:buffer'
import process from 'node:process'
/**
 * 打印自云端拉取的fount logo图像。
 * @returns {Promise<void>} 打印fount logo图像的承诺。
 */
export async function printTerminalImage() {
	const terminalImage = await import('npm:terminal-image')
	await fetch('https://repository-images.githubusercontent.com/862251163/0ac90205-ae40-4fc6-af67-1e28d074c76b').
		then(res => res.arrayBuffer()).
		then(buffer => terminalImage.default.buffer(Buffer.from(buffer))).
		then(text => process.stdout.write(text))
}
