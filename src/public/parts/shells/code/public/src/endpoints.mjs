/**
 * code shell 前端 HTTP 客户端（具名导出，唯一 fetch 入口）。
 */

const API_BASE = '/api/parts/shells:code'

/**
 * 统一 JSON 请求。
 * @param {string} url - 请求地址。
 * @param {RequestInit} [options] - fetch 选项。
 * @returns {Promise<any>} 解析后的 JSON。
 */
async function requestJson(url, options) {
	const response = await fetch(url, options)
	if (!response.ok) {
		const text = await response.text().catch(() => '')
		throw new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ''}`)
	}
	return response.json()
}

/**
 * 获取当前用户信息。
 * @returns {Promise<{username: string}>} 用户信息。
 */
export async function whoami() {
	return requestJson('/api/whoami')
}

/**
 * 列出机器（本机 + subfount）。
 * @returns {Promise<{machines: Array<{id: number, description: string, isConnected: boolean, deviceInfo: object|null}>} >} 机器列表。
 */
export async function getMachines() {
	return requestJson(`${API_BASE}/machines`)
}

/**
 * 列出机器可用 shell。
 * @param {number} machine - 机器 id。
 * @returns {Promise<{shells: string[]}>} shell 列表。
 */
export async function getMachineShells(machine) {
	return requestJson(`${API_BASE}/machines/${machine}/shells`)
}

/**
 * 浏览机器目录。
 * @param {number} machine - 机器 id。
 * @param {string} [path] - 目录（空 = 根）。
 * @returns {Promise<{path: string, roots: string[], entries: Array<{name: string, path: string, isDirectory: boolean, isFile: boolean}>}>} 目录内容。
 */
export async function browseMachine(machine, path = '') {
	return requestJson(`${API_BASE}/machines/${machine}/browse?path=${encodeURIComponent(path)}`)
}

/**
 * 读取保存的工作区列表。
 * @returns {Promise<{list: Array<{id: string, name: string, machine: number, path: string}>}>} 工作区列表。
 */
export async function getWorkspaces() {
	return requestJson(`${API_BASE}/workspaces`)
}

/**
 * 新增保存的工作区。
 * @param {{name?: string, machine: number, path: string}} workspace - 工作区。
 * @returns {Promise<{list: Array<object>}>} 更新后的列表。
 */
export async function addWorkspace(workspace) {
	return requestJson(`${API_BASE}/workspaces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(workspace) })
}

/**
 * 删除保存的工作区。
 * @param {string} id - 工作区 id。
 * @returns {Promise<{list: Array<object>}>} 更新后的列表。
 */
export async function removeWorkspace(id) {
	return requestJson(`${API_BASE}/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * `!` 模式 shell 执行。
 * @param {{machine: number, workdir: string, shell?: string, command: string}} options - 执行参数。
 * @returns {Promise<{code?: number, stdout?: string, stderr?: string, stdall?: string}>} 执行结果。
 */
export async function execShell(options) {
	return requestJson(`${API_BASE}/exec`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options) })
}

/**
 * 工作区内文件搜索（@ 补全）。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @param {string} query - 查询子串。
 * @returns {Promise<{files: string[]}>} 匹配文件（相对路径）。
 */
export async function searchFiles(target, query) {
	return requestJson(`${API_BASE}/files/search?machine=${target.machine}&workdir=${encodeURIComponent(target.workdir)}&q=${encodeURIComponent(query)}`)
}

/**
 * 读取工作区内文件（附向上上下文）。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @param {string} path - 文件路径。
 * @returns {Promise<{content: string, context: string}>} 文件内容。
 */
export async function readFile(target, path) {
	return requestJson(`${API_BASE}/file?machine=${target.machine}&workdir=${encodeURIComponent(target.workdir)}&path=${encodeURIComponent(path)}`)
}

/**
 * 列出合并后的 profiles 与 commands。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @returns {Promise<{profiles: Array<{name: string, source: string, description: string}>, commands: Array<object>}>} 合并列表。
 */
export async function getProfiles(target) {
	return requestJson(`${API_BASE}/profiles?machine=${target.machine}&workdir=${encodeURIComponent(target.workdir)}`)
}

/**
 * 渲染命令模板。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @param {string} name - 命令名。
 * @param {Record<string, string>} argv - 参数。
 * @returns {Promise<{content: string}>} 渲染结果。
 */
export async function renderCommand(target, name, argv) {
	return requestJson(`${API_BASE}/commands/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, name, argv }) })
}

/**
 * 获取 AI 源列表与可见性。
 * @returns {Promise<{sources: string[], defaults: string[], hidden: string[]}>} AI 源信息。
 */
export async function getAiSources() {
	return requestJson(`${API_BASE}/aisources`)
}

/**
 * 保存 AI 源可见性。
 * @param {string[]} hidden - 隐藏的源名列表。
 * @returns {Promise<{hidden: string[]}>} 保存结果。
 */
export async function setAiSourceVisibility(hidden) {
	return requestJson(`${API_BASE}/aisources/visibility`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden }) })
}

/**
 * 读取输入历史（自有 + 原生 shell 历史）。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @param {'shell'|'message'} kind - 历史类型。
 * @param {string} [shell] - shell 名（kind 为 shell 时读取原生历史）。
 * @returns {Promise<{own: string[], native: string[]}>} 历史列表。
 */
export async function getHistory(target, kind, shell = '') {
	return requestJson(`${API_BASE}/history?machine=${target.machine}&workdir=${encodeURIComponent(target.workdir)}&kind=${kind}&shell=${encodeURIComponent(shell)}`)
}

/**
 * 追加一条输入历史。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @param {'shell'|'message'} kind - 历史类型。
 * @param {string} command - 条目内容。
 * @returns {Promise<{own: string[]}>} 追加后的历史。
 */
export async function appendHistory(target, kind, command) {
	return requestJson(`${API_BASE}/history`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, kind, command }) })
}

/**
 * 读取工作区配置（.agents/fount/code.json）。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @returns {Promise<object>} 配置对象。
 */
export async function getWorkspaceConfig(target) {
	return requestJson(`${API_BASE}/workspace-config?machine=${target.machine}&workdir=${encodeURIComponent(target.workdir)}`)
}

/**
 * 跨工作区聚合会话（顶部对话选择器 / 工作区一览）。
 * @returns {Promise<{sessions: Array<object>}>} 聚合会话（含 workspaceId/workspaceName）。
 */
export async function listAllSessions() {
	return requestJson(`${API_BASE}/sessions/all`)
}

/**
 * 列出工作区会话。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @returns {Promise<{sessions: Array<object>}>} 会话摘要列表。
 */
export async function listSessions(target) {
	return requestJson(`${API_BASE}/sessions?machine=${target.machine}&workdir=${encodeURIComponent(target.workdir)}`)
}

/**
 * 新建/保存会话。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @param {object} session - 会话对象。
 * @returns {Promise<object>} 保存结果。
 */
export async function saveSession(target, session) {
	return requestJson(`${API_BASE}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, session }) })
}

/**
 * 读取会话。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @param {string} id - 会话 id。
 * @returns {Promise<object>} 会话对象。
 */
export async function loadSession(target, id) {
	return requestJson(`${API_BASE}/sessions/${encodeURIComponent(id)}?machine=${target.machine}&workdir=${encodeURIComponent(target.workdir)}`)
}

/**
 * 保存会话（flush）。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @param {object} session - 会话对象。
 * @returns {Promise<object>} 保存结果。
 */
export async function putSession(target, session) {
	return requestJson(`${API_BASE}/sessions/${encodeURIComponent(session.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, session }) })
}

/**
 * 删除会话。
 * @param {{machine: number, workdir: string}} target - 目标。
 * @param {string} id - 会话 id。
 * @returns {Promise<object>} 删除结果。
 */
export async function deleteSession(target, id) {
	return requestJson(`${API_BASE}/sessions/${encodeURIComponent(id)}?machine=${target.machine}&workdir=${encodeURIComponent(target.workdir)}`, { method: 'DELETE' })
}
