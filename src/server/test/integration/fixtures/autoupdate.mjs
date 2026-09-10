/** 自动更新模块的进程、文件系统和服务依赖替身。 */
export const updateFixture = {
	termux: false,
	updateFails: false,
	nextVersion: '2.9.6',
	resolvedPath: '',
	realpathError: null,
	calls: [],
	restarts: 0,
	realpaths: [],
	warnings: [],
	cacheInvalidations: 0,
	gitCalls: [],
	hasGitRepo: false,
}

/** 脚本化的 git 子命令结果；未命中的子命令返回 null。 */
export const gitScript = new Map()

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
	if (updateFixture.updateFails && args.some(arg => arg.includes('update-deno'))) throw new Error('Update failed')
	return { code: 0, stdout: args[0] === '-V' ? `deno ${updateFixture.nextVersion}\n` : '' }
}

/**
 * 记录 Windows 沿用的 PowerShell 调用字符串，不启动实际进程。
 * @param {string} code 传给 powershell_exec 的代码。
 * @returns {Promise<{code: number, stdout: string}>} 模拟退出码和标准输出。
 */
export async function powershell_exec(code) {
	updateFixture.calls.push(['powershell_exec', code])
	return { code: 0, stdout: '' }
}

/**
 * 记录非 Linux 平台沿用的命令字符串，不启动实际进程。
 * @param {string} command 要执行的完整命令。
 * @returns {Promise<{code: number, stdout: string}>} 模拟退出码和标准输出。
 */
export async function exec(command) {
	updateFixture.calls.push(command)
	return { code: 0, stdout: command === 'deno -V' ? `deno ${updateFixture.nextVersion}\n` : '' }
}

/**
 * 脚本化回答 git 子命令；未命中的子命令返回 null（模拟没有仓库引用）。
 * @param {...string} args - git 子命令与参数。
 * @returns {Promise<string|null>} 脚本命中的标准输出，否则 null。
 */
export async function git(...args) {
	const key = args.join(' ')
	updateFixture.gitCalls.push(key)
	return gitScript.has(key) ? gitScript.get(key) : null
}

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

/**
 * 记录 part 树缓存失效请求，不触碰真实缓存。
 * @returns {void}
 */
export function invalidateAllPartTreeCaches() { updateFixture.cacheInvalidations++ }

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
	 * 只模拟 Termux 标志目录与脚本指定的 Git 仓库根，不访问真实文件系统。
	 * @param {string} path 要检查的目录。
	 * @returns {boolean} 是否存在模拟的目录。
	 */
	existsSync(path) {
		if (path === '/data/data/com.termux') return updateFixture.termux
		if (path === '/autoupdate-fixture/.git') return updateFixture.hasGitRepo
		return false
	},
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
