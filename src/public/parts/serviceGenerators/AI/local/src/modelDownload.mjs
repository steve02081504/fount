import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { createModelDownloader } from 'npm:node-llama-cpp@3.18.1'

/**
 * 将各种 URI 格式规范化为 node-llama-cpp 兼容的 URI。
 * 支持 hf.co/ 前缀转换为 hf: 前缀。
 * @param {string} uri - 原始模型 URI。
 * @returns {string} 规范化后的 URI。
 */
export function normalizeModelUri(uri) {
	if (uri.startsWith('hf.co/')) return 'hf:' + uri.slice(6)
	return uri
}

/**
 * 判断是否为 HuggingFace URI。
 * @param {string} uri - 规范化后的 URI。
 * @returns {boolean}
 */
export function isHfUri(uri) {
	return uri.startsWith('hf:') || uri.startsWith('hf.co/')
}

/**
 * 判断是否为 HTTP/HTTPS URL。
 * @param {string} uri - URI 字符串。
 * @returns {boolean}
 */
export function isHttpUrl(uri) {
	return uri.startsWith('http://') || uri.startsWith('https://')
}

/**
 * 从 URI 推导 AI 源名称。
 * @param {string} uri - 原始模型 URI。
 * @returns {string} 推导出的名称。
 */
export function deriveSourceName(uri) {
	const normalized = normalizeModelUri(uri)
	if (isHfUri(normalized)) {
		// hf:owner/model:Q4_K_M -> model-Q4_K_M
		// hf:owner/model/file.gguf -> file（去掉扩展名）
		const part = normalized.replace(/^hf:/, '')
		const colonIdx = part.indexOf(':')
		if (colonIdx !== -1) {
			const modelPart = part.slice(0, colonIdx)
			const quant = part.slice(colonIdx + 1)
			const modelName = modelPart.split('/').pop()
			return quant ? `${modelName}-${quant}` : modelName
		}
		const segments = part.split('/')
		const last = segments.pop() || ''
		return last.endsWith('.gguf') ? path.basename(last, '.gguf') : last || segments.pop() || 'local-model'
	}
	if (isHttpUrl(normalized)) {
		try {
			const filename = new URL(normalized).pathname.split('/').pop() || 'model.gguf'
			return path.basename(filename, '.gguf') || 'local-model'
		}
		catch {
			return 'local-model'
		}
	}
	return path.basename(uri, '.gguf') || 'local-model'
}

/**
 * 获取 HuggingFace Hub 缓存目录。
 * 优先级：HF_HUB_CACHE > HF_HOME/hub > 平台默认路径。
 * 平台默认：Linux/macOS 为 ~/.cache/huggingface/hub，Windows 为 %USERPROFILE%\.cache\huggingface\hub。
 * @returns {string} 缓存目录的绝对路径。
 */
export function getHfHubCacheDir() {
	if (process.env.HF_HUB_CACHE) return process.env.HF_HUB_CACHE
	if (process.env.HF_HOME) return path.join(process.env.HF_HOME, 'hub')
	return path.join(os.homedir(), '.cache', 'huggingface', 'hub')
}

/**
 * 从指定 URI 下载模型文件，存入 HuggingFace Hub 缓存目录。
 * 支持：
 *   - HTTP/HTTPS 直链（.gguf 文件）
 *   - HuggingFace URI（hf:owner/model[:quant] 或 hf:owner/model/file.gguf）
 *   - hf.co/ 前缀（自动转换为 hf: 格式）
 *
 * 若目标文件已存在则跳过下载，直接返回本地路径。
 * 下载进度通过 process.stdout 实时显示。
 *
 * @param {string} _user - 用户名（保留参数，暂未使用）。
 * @param {string} uri - 模型 URI。
 * @returns {Promise<string>} 模型文件的本地绝对路径。
 */
export async function downloadModel(_user, uri) {
	const normalizedUri = normalizeModelUri(uri)

	if (!isHfUri(normalizedUri) && !isHttpUrl(normalizedUri))
		throw new Error(`Unsupported model URI: ${uri}. Use an HTTP/HTTPS URL or a HuggingFace URI with the hf: prefix.`)

	const cacheDir = getHfHubCacheDir()
	await fs.promises.mkdir(cacheDir, { recursive: true })

	let lastPercent = -1
	const downloader = await createModelDownloader({
		modelUri: normalizedUri,
		dirPath: cacheDir,
		skipExisting: true,
		onProgress: ({ downloadedSize, totalSize }) => {
			if (totalSize == null) return
			const percent = Math.floor((downloadedSize / totalSize) * 100)
			if (percent !== lastPercent) {
				lastPercent = percent
				process.stdout.write(`\rDownloading: ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(1)} MB / ${(totalSize / 1024 / 1024).toFixed(1)} MB)`)
			}
		},
	})

	const modelPath = await downloader.download()
	if (lastPercent >= 0)
		process.stdout.write('\n')
	else
		console.log(`Using cached model: ${modelPath}`)
	return modelPath
}
