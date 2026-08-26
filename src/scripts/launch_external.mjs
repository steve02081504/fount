import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

/**
 * 隐藏启动用的 wscript 辅助脚本：解码 base64 命令行，隐藏（窗口样式 0）孤儿化拉起目标。
 * 共享一个临时文件即可，无需每次启动重写。
 */
const HIDDEN_HELPER_VBS = `\
Function DecodeB64(ByVal s)
	Dim xmlDoc, bnode, bytes, st
	Set xmlDoc = CreateObject("MSXML2.DOMDocument.6.0")
	Set bnode = xmlDoc.createElement("b64")
	bnode.dataType = "bin.base64"
	bnode.text = s
	bytes = bnode.nodeTypedValue
	Set st = CreateObject("ADODB.Stream")
	st.Type = 1
	st.Open
	st.Write bytes
	st.Position = 0
	st.Type = 2
	st.Charset = "utf-8"
	DecodeB64 = st.ReadText
	st.Close
End Function
Set sh = WScript.CreateObject("WScript.Shell")
If WScript.Arguments.Count > 1 Then
	On Error Resume Next
	sh.CurrentDirectory = WScript.Arguments(1)
End If
sh.Run DecodeB64(WScript.Arguments(0)), 0, False
`

/**
 * 确保隐藏启动用的 wscript 辅助脚本存在（共享一个临时文件）。
 * @returns {string} 辅助脚本路径
 */
function ensureHiddenHelper() {
	const path = join(tmpdir(), 'fount_launch_hidden.vbs')
	if (!existsSync(path)) writeFileSync(path, HIDDEN_HELPER_VBS, 'utf8')
	return path
}

/**
 * 用户主动触发的、与 fount 主进程分离的外部程序启动（编辑器、终端等）。
 * AGENTS.md 中「禁止子进程」规则的唯一定义例外入口。
 *
 * POSIX 用 `detached` 开新 session 即可；Windows 上 `spawn` 的 `detached` 只改
 * console、不改父 PID，子进程仍是启动方进程树的一员——一旦启动方被整树终止
 * （`taskkill /T`、终端按 Job Object 清理），它会被连带带走。故 Windows 经
 * `cmd /c start` 起一个孤儿进程：中间 `cmd` 立即退出后父链断开，树杀追不到它。
 * 其余选项（`cwd` / `windowsHide` 等）直接转发给 `spawn`；后台进程（如测试内核）传
 * `windowsHide: true` 可避免新建的 console 被 Windows Terminal 当作新 tab 显示。
 * 注意：`cmd /c start` 不会把隐藏标志传给目标进程。若要隐藏目标，cmd 在外层 `start`
 * 孤儿化 wscript（GUI 子系统进程，无 console，不闪、无 tab），孤立的 wscript 再用
 * `Shell.Run(cmdline, 0, False)`（窗口样式 0 = 隐藏）拉起目标——隐藏与脱离 Job Object
 * 二者兼得，无需临时 PowerShell/ps12exe。目标本身不再套 `Start-Process`（那会让目标
 * 留在 Job 里被树杀带走，测试内核起不来）。
 * @param {object} options 启动选项
 * @param {string} options.command 程序路径
 * @param {string[]} [options.args] 参数
 * @param {string} [options.cwd] 工作目录
 * @param {Record<string, string>} [options.env] 追加环境变量
 * @param {boolean} [options.windowsHide] Windows 上隐藏新建的 console
 * @returns {Promise<void>}
 */
export function launchDetachedProgram(options = {}) {
	const { command, args = [], ...spawnOptions } = options
	const mergedEnv = spawnOptions.env ? { ...process.env, ...spawnOptions.env } : process.env
	const spawnOnce = process.platform === 'win32'
		? spawnOptions.windowsHide
			? () => {
				const b64 = Buffer.from([command, ...args].join(' '), 'utf8').toString('base64')
				// cmd 在外层 `start` 孤儿化 wscript（GUI 子系统进程，无 console → 不闪、无 tab）；
				// 孤立的 wscript 用 `Shell.Run(cmdline, 0, False)`（窗口样式 0 = 隐藏）拉起目标，
				// 隐藏与脱离 Job Object 二者兼得。base64 传参避开 cmd/Shell.Run 的引号解析。
				return spawn(process.env.ComSpec || 'cmd.exe', [
					'/d', '/c', 'start', '', '/b', 'wscript.exe', '//nologo',
					ensureHiddenHelper(), b64, spawnOptions.cwd || '',
				], { ...spawnOptions, env: mergedEnv, detached: true, stdio: 'ignore' })
			}
			: () => spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '', '/b', command, ...args], {
				...spawnOptions,
				env: mergedEnv,
				detached: true,
				stdio: 'ignore',
			})
		: () => spawn(command, args, { ...spawnOptions, env: mergedEnv, detached: true, stdio: 'ignore' })
	return new Promise((resolve, reject) => {
		const processRef = spawnOnce()
		processRef.once('spawn', () => {
			processRef.unref()
			resolve()
		})
		processRef.once('error', reject)
	})
}
