/**
 * 测试节点 server starts 预设（轻量模块，不导入 server.mjs）。
 */

/**
 * server starts 预设选项。
 * @typedef {{ Web?: boolean, IPC?: boolean, Tray?: boolean, DiscordRPC?: boolean, Base?: boolean | object, P2P?: boolean }} TestStarts
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
