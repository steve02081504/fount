/** 自动更新模块的进程、文件系统和服务依赖替身。 */
export const updateFixture = {
	managed: false,
	missingPacman: false,
	termux: false,
	upgradeFails: false,
	nextVersion: '2.9.6',
	resolvedPath: '',
	realpathError: null,
	calls: [],
	restarts: 0,
	realpaths: [],
	warnings: [],
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
	if (updateFixture.upgradeFails && args[0] === 'upgrade') throw new Error('Upgrade failed')
	return { code: 0, stdout: args[0] === '-V' ? `deno ${updateFixture.nextVersion}\n` : '' }
}

/**
 * 记录非 Linux 平台沿用的命令字符串，不启动实际进程。
 * @param {string} command 要执行的完整命令。
 * @returns {Promise<{code: number, stdout: string}>} 模拟退出码和标准输出。
 */
export async function exec(command) {
	updateFixture.calls.push(command)
	if (updateFixture.upgradeFails && command.startsWith('deno upgrade')) throw new Error('Upgrade failed')
	return { code: 0, stdout: command === 'deno -V' ? `deno ${updateFixture.nextVersion}\n` : '' }
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
	/**
	 * 记录可执行文件失效的提示，不污染测试输出。
	 * @param {string} message 更新跳过原因。
	 */
	warn(message) { updateFixture.warnings.push(message) },
}

/** 限定自动更新模块使用的文件系统替身。 */
export default {
	/**
	 * 只模拟 Termux 标志目录，不触发 Git 更新路径。
	 * @param {string} path 要检查的目录。
	 * @returns {boolean} 是否存在模拟的 Termux 目录。
	 */
	existsSync(path) { return path === '/data/data/com.termux' && updateFixture.termux },
	/**
	 * 记录并解析当前运行时路径，不访问真实文件系统。
	 * @param {string} path 运行时报告的可执行文件路径。
	 * @returns {string} 本用例指定的符号链接解析结果。
	 */
	realpathSync(path) {
		updateFixture.realpaths.push(path)
		if (updateFixture.realpathError) throw Object.assign(new Error(updateFixture.realpathError), { code: updateFixture.realpathError })
		if (path === '/usr/bin/deno (deleted)') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
		return updateFixture.resolvedPath
	},
}
