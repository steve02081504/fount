import fs from 'node:fs'
import path from 'node:path'

import { nicerWriteFileSync } from '../../../../scripts/nicerWriteFile.mjs'
import { getUserDictionary } from '../../../../server/auth.mjs'

/**
 * 获取用户自定义主题的存储目录路径，如果不存在则创建。
 * @param {string} username - 用户名。
 * @returns {string} - 用户自定义主题目录的路径。
 */
function getThemeDir(username) {
	const dir = path.join(
		getUserDictionary(username),
		'shells',
		'themeManage',
		'themes',
	)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
	return dir
}

/**
 * 获取指定用户的所有自定义主题列表。
 * @param {string} username - 用户名。
 * @returns {Array<object>} - 用户自定义主题的列表。
 */
export function getCustomThemes(username) {
	const dir = getThemeDir(username)
	return fs.readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => {
			try {
				return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
			} catch {
				return null
			}
		})
		.filter(Boolean)
}

/**
 * 根据用户名和主题ID获取单个自定义主题。
 * @param {string} username - 用户名。
 * @param {string} id - 主题的ID。
 * @returns {object|null} - 找到的主题数据，如果未找到则为null。
 */
export function getTheme(username, id) {
	const filepath = path.join(getThemeDir(username), `${id}.json`)
	if (!fs.existsSync(filepath)) return null
	return JSON.parse(fs.readFileSync(filepath, 'utf-8'))
}

/**
 * 保存或更新用户的自定义主题。
 * @param {string} username - 用户名。
 * @param {object} themeData - 要保存的主题数据。
 * @returns {string} - 保存主题的ID。
 */
export function saveTheme(username, themeData) {
	const id = themeData.id || Date.now().toString(36)
	themeData.id = id
	themeData.lastModified = Date.now()
	const filepath = path.join(getThemeDir(username), `${id}.json`)
	nicerWriteFileSync(filepath, JSON.stringify(themeData, null, 2))
	return id
}

/**
 * 删除指定用户的自定义主题。
 * @param {string} username - 用户名。
 * @param {string} id - 要删除的主题的ID。
 */
export function deleteTheme(username, id) {
	const filepath = path.join(getThemeDir(username), `${id}.json`)
	if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
}
