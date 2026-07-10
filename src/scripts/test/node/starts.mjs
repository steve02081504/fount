/**
 * 测试节点 server starts 预设（轻量模块，不导入 server.mjs）。
 */

/**
 * server starts 预设选项。
 * @typedef {{ Web?: boolean | object, IPC?: boolean | { port?: number }, Tray?: boolean, DiscordRPC?: boolean, Base?: boolean | object, P2P?: boolean }} TestStarts
 */

/**
 * 测试用 server starts 预设。
 * @param {object} [options] 选项
 * @param {boolean} [options.web=false] 是否启动 Web
 * @param {boolean} [options.p2p=false] 是否启动 P2P
 * @param {boolean} [options.jobs=false] Base.Jobs（仅 web 时有效）
 * @returns {TestStarts} starts 对象
 */
export function defaultTestStarts({ web = false, p2p = false, jobs = false } = {}) {
	if (!web)
		return {
			IPC: false,
			Tray: false,
			DiscordRPC: false,
			Web: false,
			P2P: p2p,
			Base: false,
		}
	return {
		IPC: false,
		Tray: false,
		DiscordRPC: false,
		Web: true,
		P2P: p2p,
		Base: {
			Jobs: jobs,
			Timers: false,
			Idle: false,
			AutoUpdate: false,
		},
	}
}

/**
 * `init()` 是否会启动 IPC（与 `server.mjs` 中 `starts.IPC ??= true` 一致）。
 * @param {TestStarts} starts 已解析的 starts（`defaultTestStarts` 或调用方透传）
 * @returns {boolean} 是否启用 IPC
 */
export function ipcStartsEnabled(starts) {
	return starts.IPC !== false
}

/**
 * 读取 starts 里已指定的 IPC 端口。
 * @param {TestStarts} starts starts 对象
 * @returns {number | undefined} 已指定端口；未指定时 undefined
 */
export function ipcPortFromStarts(starts) {
	if (!ipcStartsEnabled(starts)) return undefined
	const { IPC: ipc } = starts
	if (ipc === true || ipc == null) return undefined
	if (typeof ipc === 'object' && ipc.port != null) return Number(ipc.port)
	return undefined
}

/**
 * 将 IPC 端口写入 starts（`true` / 省略 → `{ port }`；已有对象则补 `port`）。
 * @param {TestStarts} starts starts 对象（就地修改）
 * @param {number} port TCP 端口
 * @returns {number} 写入的端口
 */
export function assignIpcPort(starts, port) {
	if (starts.IPC === true || starts.IPC == null)
		starts.IPC = { port }
	else
		starts.IPC.port = port
	return port
}
