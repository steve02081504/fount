/** 自动更新模块的进程、文件系统和服务依赖替身。 */
export const updateFixture = {
	managed: false,
	missingPacman: false,
	nextVersion: '2.9.6',
	resolvedPath: '',
	calls: [],
	restarts: 0,
	realpaths: [],
}

/** 真实自动更新模块注册的空闲回调。 */
export const idleHandlers = new Set()

/** 避免访问真实仓库目录。 */
export const __dirname = '/autoupdate-fixture'

/**
 * 在内存中回答进程调用，不启动包管理器或运行时。
 * @param {string} command 要执行的程序路径或名称。
 * @param {string[]} args 传给程序的独立参数。
 * @returns {Promise<{code: number, stdout: string}>} 模拟退出码和标准输出。
 */
export async function execFile(command, args) {
	updateFixture.calls.push([command, args])
	if (command === 'pacman') {
		if (updateFixture.missingPacman) throw new Error('ENOENT')
		return { code: updateFixture.managed ? 0 : 1, stdout: '' }
	}
	return { code: 0, stdout: args[0] === '-V' ? `deno ${updateFixture.nextVersion}\n` : '' }
}

/**
 * 初始 Git 引用查询不访问实际仓库。
 * @returns {Promise<null>} 表示没有可用的仓库引用。
 */
export async function git() { return null }

/** 不向外部错误跟踪服务发送标签。 */
export function setTag() {}

/**
 * 保存真实模块注册的空闲回调。
 * @param {() => Promise<void>} handler 自动更新模块的空闲回调。
 */
export function onIdle(handler) { idleHandlers.add(handler) }

/**
 * 注销空闲回调，不留下跨测试状态。
 * @param {() => Promise<void>} handler 要注销的空闲回调。
 */
export function offIdle(handler) { idleHandlers.delete(handler) }

/**
 * 记录重启请求，不停止测试进程。
 * @returns {Promise<void>} 重启请求记录完成。
 */
export async function restartor() { updateFixture.restarts++ }

/** 不向客户端发送实际事件。 */
export function sendEventToAll() {}

/** 自动更新模块的国际化日志替身。 */
export const console = {
	/** 忽略预期的重启提示。 */
	logI18n() {},
}

/** 限定自动更新模块使用的文件系统替身。 */
export default {
	/**
	 * 测试不检查上游代码，避免触发 Git 更新路径。
	 * @returns {boolean} 始终视为没有 Git 目录。
	 */
	existsSync() { return false },
	/**
	 * 记录并解析当前运行时路径，不访问真实文件系统。
	 * @param {string} path 运行时报告的可执行文件路径。
	 * @returns {string} 本用例指定的符号链接解析结果。
	 */
	realpathSync(path) {
		updateFixture.realpaths.push(path)
		if (path === '/usr/bin/deno (deleted)') throw new Error('ENOENT')
		return updateFixture.resolvedPath
	},
}
