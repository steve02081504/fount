import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { addServiceSourceFile, saveServiceSourceFile } from '../../../../shells/serviceSourceManage/src/manager.mjs'

import { downloadModel, deriveSourceName, isHttpUrl, isHfUri, normalizeModelUri } from './modelDownload.mjs'

const SERVICE_SOURCE_PATH = 'serviceSources/AI'
const GENERATOR_NAME = 'local'

/**
 * 从现有本地路径创建 AI 源。
 * @param {string} user - 用户名。
 * @param {string} modelPath - 模型文件的本地路径。
 * @param {string} [sourceName] - AI 源名称，默认从文件名推导。
 * @param {string} [cwd] - 解析相对路径时的当前工作目录。
 * @returns {Promise<string>} 操作结果描述。
 */
async function createSourceFromPath(user, modelPath, sourceName, cwd) {
	const resolvedPath = path.isAbsolute(modelPath) ? modelPath : path.resolve(cwd || process.cwd(), modelPath)
	if (!fs.existsSync(resolvedPath))
		throw new Error(`Model file not found: ${resolvedPath}`)

	const name = sourceName || path.basename(resolvedPath, '.gguf')
	await addServiceSourceFile(user, name, SERVICE_SOURCE_PATH)
	await saveServiceSourceFile(user, name, {
		generator: GENERATOR_NAME,
		config: {
			name,
			model_path: resolvedPath,
		}
	}, SERVICE_SOURCE_PATH)

	return `AI source '${name}' created with model: ${resolvedPath}`
}

/**
 * 定义了 Local AI 生成器的可用操作。
 */
export const actions = {
	/**
	 * 从 URL 或 HuggingFace URI 下载模型并自动创建 AI 源。
	 * 支持以下 URI 格式：
	 *   - https://example.com/model.gguf（HTTP 直链）
	 *   - hf:owner/model:Q4_K_M（HuggingFace，带量化标签）
	 *   - hf:owner/model/filename.gguf（HuggingFace，指定文件）
	 *   - hf.co/owner/model:Q4_K_M（hf.co 前缀，自动转换）
	 *
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.uri - 模型 URI。
	 * @param {string} [root0.sourceName] - 可选的 AI 源名称，默认从 URI 推导。
	 * @param {string} [root0.cwd] - 解析相对路径时的当前工作目录。
	 * @returns {Promise<string>} 操作结果描述。
	 */
	install: async ({ user, uri, sourceName, cwd }) => {
		if (!uri) throw new Error('Model URI is required.')
		const normalizedUri = normalizeModelUri(uri)

		if (!isHttpUrl(normalizedUri) && !isHfUri(normalizedUri))
			return createSourceFromPath(user, uri, sourceName, cwd)

		console.log(`Downloading model: ${uri}`)
		const modelPath = await downloadModel(user, uri)
		console.log(`Model downloaded to: ${modelPath}`)

		const name = sourceName || deriveSourceName(uri)
		await addServiceSourceFile(user, name, SERVICE_SOURCE_PATH)
		await saveServiceSourceFile(user, name, {
			generator: GENERATOR_NAME,
			config: {
				name,
				model_path: modelPath,
			}
		}, SERVICE_SOURCE_PATH)

		return `AI source '${name}' created with model: ${modelPath}`
	},

	/**
	 * 从已有的本地路径创建 AI 源（不下载）。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.modelPath - 模型文件的本地绝对或相对路径。
	 * @param {string} [root0.sourceName] - 可选的 AI 源名称。
	 * @param {string} [root0.cwd] - 解析相对路径时的当前工作目录。
	 * @returns {Promise<string>} 操作结果描述。
	 */
	'create-from-path': async ({ user, modelPath, sourceName, cwd }) => {
		if (!modelPath) throw new Error('modelPath is required.')
		return createSourceFromPath(user, modelPath, sourceName, cwd)
	},
}
