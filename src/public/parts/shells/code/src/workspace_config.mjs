/**
 * code shell 工作区配置：读取 `.agents/fount/code.json`。
 * 支持工作区自定义/覆盖角色（含安装 URL、partname 等），未配置时返回空对象。
 */
import { createTargetExecutor, joinWorkdir } from '../../../plugins/file-operations/src/target.mjs'

/**
 * 读取工作区配置 JSON。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}|undefined} workdir - 目标工作区。
 * @returns {Promise<object>} 配置对象（解析失败/不存在时空对象）。
 */
export async function readWorkspaceConfig(username, workdir) {
	if (!workdir?.path) return {}
	const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
	const text = await executor.readTextFile(joinWorkdir(workdir.path, '.agents/fount/code.json')).catch(() => null)
	if (text == null) return {}
	try {
		const data = JSON.parse(text)
		return data && typeof data === 'object' ? data : {}
	}
	catch { return {} }
}
