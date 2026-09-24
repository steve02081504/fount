/* global Deno */
// fount 自开发：单个 code agent 生成完毕后的自动检查脚本。
// 由工作区钩子以 `deno run -A --quiet .agents/fount/hooks/agent-finish.mjs` 运行，cwd = 工作区根。
// 退出码 0 = 无事；非 0 = 把 stdout+stderr 回灌给该 agent 并触发重生成（由 code shell 钩子运行器处理）。
// 流程：eslint 存在则 eslint --quiet --fix（失败即退出非 0）→ 查询本会话逐请求缓存命中率 → 低于阈值则拉起 opencode/pi 分析会话。
const decoder = new TextDecoder()
const env = Deno.env.toObject()
const kind = env.FOUNT_CODE_KIND || ''
const cwd = env.FOUNT_CODE_WORKSPACE_PATH || Deno.cwd()
const conversationId = env.FOUNT_CODE_CONVERSATION_ID || ''
const sessionId = env.FOUNT_CODE_SESSION_ID || ''
const generationId = env.FOUNT_CODE_GENERATION_ID || ''

/**
 * 运行命令并捕获输出。
 * @param {string} command 程序
 * @param {string[]} args 参数
 * @param {{cwd?: string}} [options] 选项
 * @returns {Promise<{code: number, stdout: string, stderr: string, missing: boolean}>} 结果（NotFound 时 missing 为 true）
 */
async function runCapture(command, args, options = {}) {
	try {
		const cmd = new Deno.Command(command, {
			args,
			cwd: options.cwd,
			stdin: 'null',
			stdout: 'piped',
			stderr: 'piped',
		})
		const { code, stdout, stderr } = await cmd.output()
		return { code, stdout: decoder.decode(stdout), stderr: decoder.decode(stderr), missing: false }
	}
	catch (error) {
		if (error instanceof Deno.errors.NotFound) return { code: 127, stdout: '', stderr: '', missing: true }
		return { code: 126, stdout: '', stderr: String(error), missing: false }
	}
}

/**
 * 判断命令是否在 PATH 中。
 * @param {string} name 命令名
 * @returns {Promise<boolean>} 是否存在
 */
async function commandExists(name) {
	if (Deno.build.os === 'win32') return (await runCapture('where', [name])).code === 0
	return (await runCapture('sh', ['-c', `command -v ${name}`])).code === 0
}

/**
 * 经 shell 调用 fount CLI（跨平台处理 .cmd/命令解析）。
 * @param {string[]} args fount 子命令与参数
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} 结果
 */
async function fount(args) {
	if (Deno.build.os === 'win32') return await runCapture('cmd', ['/d', '/c', 'fount', ...args], { cwd })
	return await runCapture('sh', ['-c', 'fount "$@"', 'fount', ...args], { cwd })
}

/**
 * 经 shell 运行一条命令行（解析 .cmd/.bat 等）。
 * @param {string} line 命令行
 * @returns {Promise<{code: number, stdout: string, stderr: string, missing: boolean}>} 结果
 */
async function runShellLine(line) {
	if (Deno.build.os === 'win32') return await runCapture('cmd', ['/d', '/c', line], { cwd })
	return await runCapture('sh', ['-c', line], { cwd })
}

/**
 * 以新窗口挂起式启动交互式程序（不阻塞、不随本进程退出被回收）。
 * @param {string} command 程序
 * @param {string[]} args 参数
 * @returns {void}
 */
function spawnVisible(command, args) {
	const options = { cwd, stdin: 'null', stdout: 'null', stderr: 'null' }
	const child = Deno.build.os === 'win32'
		? new Deno.Command('cmd', { ...options, args: ['/d', '/c', 'start', '', command, ...args] }).spawn()
		: new Deno.Command('sh', { ...options, args: ['-c', 'nohup "$0" "$@" >/dev/null 2>&1 &', command, ...args] }).spawn()
	child.unref()
}

/**
 * 汇总报告中的低命中率非压缩轮次。
 * @param {object} report cache-report JSON
 * @returns {string[]} 形如 `轮次 3 命中率 41.2%` 的描述
 */
function offendingRounds(report) {
	const out = []
	for (const generation of report.generations ?? [])
		for (const round of generation.requests ?? [])
			if (round.rate != null && !round.compressed && round.rate < (report.threshold ?? 0.729))
				out.push(`轮次 ${round.index} 命中率 ${(round.rate * 100).toFixed(1)}%`)
	return out
}

/**
 * 组装给分析 agent 的提示词（单行，避免 cmd 参数换行问题）。
 * @param {object} report cache-report JSON
 * @returns {string} 提示词
 */
function buildPrompt(report) {
	const rate = report.minNonCompressedRate == null ? 'n/a' : (report.minNonCompressedRate * 100).toFixed(1) + '%'
	return [
		'fount 自开发自动检查发现一次提示缓存命中率事故，请分析并修复。',
		`会话 ${conversationId}（session ${sessionId}，generation ${generationId}）。`,
		`最低非压缩轮命中率 ${rate}，低于阈值 ${((report.threshold ?? 0.729) * 100).toFixed(1)}%；涉事轮次：${offendingRounds(report).join('，') || '（见 cache-report）'}。`,
		'请先运行 `fount run agent_studio cache-report ' + conversationId + '` 复现并定位命中率下降的 prompt 构造原因（如每轮变动的前缀、系统提示抖动、工具日志注入位置等）。',
		'判断是否需要修复：若需要，直接修改 fount 源码、补充/更新测试，并在完成后运行 `fount reboot`。',
		'不要只给建议，请直接动手完成修复与测试。',
	].join(' ')
}

/**
 * 拉起分析会话：优先 opencode，其次 pi，其次回退 fount code。
 * @param {object} report cache-report JSON
 * @returns {Promise<void>}
 */
async function launchAnalysisAgent(report) {
	const prompt = buildPrompt(report)
	if (await commandExists('opencode')) {
		spawnVisible('opencode', ['--prompt', prompt])
		return
	}
	if (await commandExists('pi')) {
		spawnVisible('pi', ['--', prompt])
		return
	}
	await fount(['run', 'code', '--prompt', prompt])
}

/**
 * 主流程。
 * @returns {Promise<number>} 退出码（0 = 正常，非 0 = 回灌给 agent）
 */
async function main() {
	// 子代理完毕不跑重检查：父 code 会话结束时统一处理
	if (kind && kind !== 'code') return 0

	if (await commandExists('eslint')) {
		const result = await runShellLine('eslint --quiet --fix')
		if (result.code !== 0) {
			console.log(`eslint --quiet --fix 未通过（退出码 ${result.code}）：`)
			console.log(result.stdout)
			console.log(result.stderr)
			return 1
		}
	}

	if (conversationId) {
		const report = await fount(['run', 'agent_studio', 'cache-report', conversationId])
		if (report.code === 0 && report.stdout.trim()) {
			let data = null
			try { data = JSON.parse(report.stdout) }
			catch { data = null }
			if (data?.below) {
				await launchAnalysisAgent(data)
				return 0
			}
		}
	}
	return 0
}

Deno.exit(await main())
