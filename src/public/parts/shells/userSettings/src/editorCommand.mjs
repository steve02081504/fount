import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import { where_command } from 'npm:@steve02081504/exec'

import { getUserDictionary } from '../../../../../server/auth.mjs'

const EDITOR_CONFIG_RELATIVE_PATH = path.join('settings', 'editor-command.json')

const KNOWN_EDITORS = [
	{
		id: 'cursor',
		label: 'Cursor',
		command: 'cursor',
		argsTemplate: '--goto "${file}:${line}:${column}"',
	},
	{
		id: 'vscode',
		label: 'VS Code',
		command: 'code',
		argsTemplate: '--goto "${file}:${line}:${column}"',
	},
	{
		id: 'notepad++',
		label: 'Notepad++',
		command: 'notepad++',
		argsTemplate: '"${file}" -n${line} -c${column}',
	},
]

let cachedAvailableEditors
let detectEditorsPromise

/**
 * 检查命令是否存在于 PATH 中。
 * @param {string} command - 命令名。
 * @returns {Promise<boolean>} - 是否可用。
 */
async function commandOnPath(command) {
	try {
		return Boolean(await where_command(command))
	} catch {
		return false
	}
}

/**
 * 检测内置编辑器可用性（异步、并行探测；结果进程内缓存以避免重复查询）。
 * @param {{ refresh?: boolean }} [options] - refresh 为 true 时忽略缓存重新探测。
 * @returns {Promise<Array<{id: string, label: string, command: string, argsTemplate: string, available: boolean}>>} - 编辑器列表。
 */
export async function detectAvailableEditors(options = {}) {
	const { refresh = false } = options
	if (!refresh && cachedAvailableEditors)
		return cachedAvailableEditors
	if (!refresh && detectEditorsPromise)
		return detectEditorsPromise
	/**
	 * 并行探测各编辑器命令是否在 PATH 上并写入缓存。
	 * @returns {Promise<Array<{ id: string, label: string, command: string, argsTemplate: string, available: boolean }>>} 带 availability 的编辑器列表。
	 */
	const run = async () => {
		const list = await Promise.all(
			KNOWN_EDITORS.map(async editor => ({
				...editor,
				available: await commandOnPath(editor.command),
			}))
		)
		cachedAvailableEditors = list
		return list
	}
	if (refresh) {
		cachedAvailableEditors = undefined
		detectEditorsPromise = undefined
		return run()
	}
	detectEditorsPromise = run().finally(() => {
		detectEditorsPromise = undefined
	})
	return detectEditorsPromise
}

/**
 * 解析参数模板，支持基础引号分词。
 * @param {string} template - 参数模板。
 * @returns {Array<string>} - 参数数组。
 */
function parseArgsTemplate(template) {
	if (!template?.trim()) return []
	const tokens = template.match(/"[^"]*"|'[^']*'|\S+/g) || []
	return tokens.map(token => {
		if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith('\'') && token.endsWith('\'')))
			return token.slice(1, -1)
		return token
	})
}

/**
 * 格式化参数模板占位符。
 * @param {string} template - 参数模板。
 * @param {{file: string, line: number, column: number}} payload - 文件定位参数。
 * @returns {string} - 格式化后的参数字符串。
 */
function formatArgs(template, payload) {
	const values = {
		file: payload.file,
		line: String(payload.line),
		column: String(payload.column),
	}
	return template.replace(/\$\{(file|line|column)\}/g, (_, key) => values[key])
}

/**
 * 获取用户编辑器配置文件路径。
 * @param {string} username - 用户名。
 * @returns {string} - 配置路径。
 */
function getEditorConfigPath(username) {
	return path.join(getUserDictionary(username), EDITOR_CONFIG_RELATIVE_PATH)
}

/**
 * 确保配置目录存在。
 * @param {string} username - 用户名。
 * @returns {Promise<string>} - 配置文件路径。
 */
async function ensureConfigDirectory(username) {
	const configPath = getEditorConfigPath(username)
	await fs.mkdir(path.dirname(configPath), { recursive: true })
	return configPath
}

/**
 * 生成默认编辑器配置。
 * @param {Array<{id: string, label: string, command: string, argsTemplate: string, available: boolean}>} availableEditors - 可用编辑器列表。
 * @returns {{editorId: string, command: string, argsTemplate: string}} - 默认配置。
 */
function buildDefaultConfig(availableEditors) {
	const preferred = availableEditors.find(editor => editor.available) || KNOWN_EDITORS[0]
	return {
		editorId: preferred.id,
		command: preferred.command,
		argsTemplate: preferred.argsTemplate,
	}
}

/**
 * 获取用户编辑器命令配置。
 * @param {string} username - 用户名。
 * @returns {Promise<{editorId: string, command: string, argsTemplate: string, availableEditors: Array<object>}>} - 当前配置和可用编辑器列表。
 */
export async function getEditorCommandConfig(username) {
	const availableEditors = await detectAvailableEditors()
	const defaults = buildDefaultConfig(availableEditors)
	const configPath = getEditorConfigPath(username)
	try {
		const raw = await fs.readFile(configPath, 'utf8')
		const parsed = JSON.parse(raw)
		return {
			...defaults,
			...parsed,
			availableEditors,
		}
	} catch {
		return {
			...defaults,
			availableEditors,
		}
	}
}

/**
 * 保存用户编辑器命令配置。
 * @param {string} username - 用户名。
 * @param {{editorId?: string, command?: string, argsTemplate?: string}} config - 配置项。
 * @returns {Promise<{editorId: string, command: string, argsTemplate: string, availableEditors: Array<object>}>} - 保存后的配置。
 */
export async function setEditorCommandConfig(username, config) {
	const configPath = await ensureConfigDirectory(username)
	const sanitized = {
		editorId: String(config.editorId || '').trim(),
		command: String(config.command || '').trim(),
		argsTemplate: String(config.argsTemplate || '').trim(),
	}
	if (!sanitized.command)
		throw new Error('Editor command is required.')
	await fs.writeFile(configPath, JSON.stringify(sanitized, null, '\t'), 'utf8')
	return getEditorCommandConfig(username)
}

/**
 * 通过 ID 获取内置编辑器预设。
 * @param {string} editorId - 编辑器 ID。
 * @returns {{id: string, label: string, command: string, argsTemplate: string}|null} - 编辑器预设。
 */
export function getAvailableEditorById(editorId) {
	return KNOWN_EDITORS.find(editor => editor.id === editorId) || null
}

/**
 * 根据用户配置打开外部编辑器。
 * @param {string} username - 用户名。
 * @param {string} filePath - 文件路径。
 * @param {number} [line=1] - 行号。
 * @param {number} [column=1] - 列号。
 * @returns {Promise<{success: boolean, command: string, args: Array<string>}>} - 执行信息。
 */
export async function openEditor(username, filePath, line = 1, column = 1) {
	if (!filePath?.trim())
		throw new Error('File path is required.')
	const config = await getEditorCommandConfig(username)
	const payload = {
		file: filePath,
		line: Number.isFinite(Number(line)) ? Math.max(1, Number(line)) : 1,
		column: Number.isFinite(Number(column)) ? Math.max(1, Number(column)) : 1,
	}
	const args = parseArgsTemplate(formatArgs(config.argsTemplate, payload))
	const processRef = spawn(config.command, args, {
		detached: true,
		stdio: 'ignore',
	})
	processRef.unref()
	return {
		success: true,
		command: config.command,
		args,
	}
}
