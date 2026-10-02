import fs from 'node:fs'
import path from 'node:path'

/**
 * 在 PATH 中查找第一个真实存在的 bash.exe，不启动 shell。
 * @param {string} searchPath PATH value.
 * @param {(file: string) => boolean} [isFile] File probe.
 * @returns {string|null} Executable path.
 */
export function findWindowsBash(searchPath, isFile = file => {
	try { return fs.statSync(file).isFile() }
	catch { return false }
}) {
	for (const entry of String(searchPath ?? '').split(';')) {
		const dir = entry.trim().replace(/^"|"$/g, '')
		if (!dir) continue
		const candidate = path.win32.join(dir, 'bash.exe')
		if (isFile(candidate)) return candidate
	}
	return null
}

/**
 * 用选定的 Windows shell 安装把 POSIX 风格路径解析为原生路径。
 * 未知根目录直接报错，避免误读当前盘符上的文件。
 * @param {string} value Input path.
 * @param {{bash?: string|null, root?: string, distro?: string|null, home?: string}} [context] Shell context.
 * @returns {string} Native Windows path.
 */
export function mapWindowsPath(value, context = {}) {
	const { bash, distro, home } = context
	const normalized = value.replace(/\\/g, '/')
	if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) return path.win32.normalize(value)
	if (normalized.startsWith('~')) return path.win32.resolve(home || '.', normalized.slice(1).replace(/^\//, ''))
	if (!normalized.startsWith('/')) return path.win32.normalize(value)
	const wsl = /[\\/]Windows[\\/](?:System32|Sysnative)[\\/]bash\.exe$/i.test(bash || '') || Boolean(distro)
	const drive = normalized.match(/^\/(?:cygdrive\/|mnt\/)?([A-Za-z])(?:\/|$)/)
	if (drive) return path.win32.resolve(drive[1].toUpperCase() + ':\\', normalized.slice(drive[0].length))
	if (wsl) {
		if (!distro || /[\\/]/.test(distro)) throw new Error('WSL distribution is unknown; use \\\\wsl.localhost\\<distribution>\\...')
		return path.win32.resolve(`\\\\wsl.localhost\\${distro}\\`, normalized.slice(1))
	}
	let root = null
	if (bash) {
		// Git/MSYS and Cygwin put bash in <root>/bin or <root>/usr/bin.
		const dir = path.win32.dirname(bash)
		if (/[\\/]usr[\\/]bin$/i.test(dir)) root = path.win32.dirname(path.win32.dirname(dir))
		else if (/[\\/]bin$/i.test(dir)) root = path.win32.dirname(dir)
	}
	root ??= context.root
	if (!root) throw new Error('POSIX path has no known Windows bash root')
	return path.win32.resolve(root, normalized.slice(1))
}

/**
 * 目标机本地的路径解析器；与两个映射助手一起序列化，使远程执行器基于自身进程解析，
 * 而不依赖宿主机的 PATH 或 WSL 安装。
 * @param {string} value Input path.
 * @param {string|null} [base] Target workdir.
 * @returns {Promise<string>} Native absolute path.
 */
export async function resolveNativePath(value, base = null) {
	const fs = await import('node:fs')
	const path = await import('node:path')
	const os = await import('node:os')
	const process = await import('node:process')
	if (process.platform !== 'win32') {
		const expanded = value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value
		return path.resolve(base || '.', expanded)
	}
	const bash = findWindowsBash(process.env.PATH ?? process.env.Path, file => {
		try { return fs.statSync(file).isFile() }
		catch { return false }
	})
	// Explicit WSL workdirs carry their own distribution, independent of the default.
	let distro = base?.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)/i)?.[1] || process.env.WSL_DISTRO_NAME || null
	const wsl = /[\\/]Windows[\\/](?:System32|Sysnative)[\\/]bash\.exe$/i.test(bash || '')
	if (wsl && !distro && value.startsWith('/') && !/^\/(?:cygdrive\/|mnt\/)?[A-Za-z](?:\/|$)/.test(value)) {
		// Read only the target user's default distribution; never guess from /home.
		const { execShellWithTimeout } = await import('../../../../../scripts/shell_guard.mjs').catch(async () => {
			// Serialized remote eval has no module-relative URL; use the target's exec package.
			const { execFile } = await import('npm:@steve02081504/exec')
			return { /**
				 * 在远程目标上执行只读注册表探测。
				 * @param {string} shell Shell identifier.
			 * @param {string} code PowerShell source.
			 * @returns {Promise<object>} Captured output.
			 */
				execShellWithTimeout: async (shell, code) => ({ result: await execFile(shell === 'powershell' ? 'powershell.exe' : shell, ['-NoProfile', '-NonInteractive', '-Command', code], { no_ansi_terminal_sequences: true }) }) }
		})
		const code = '$r=Get-ItemProperty -LiteralPath \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\' -ErrorAction Stop; (Get-ItemProperty -LiteralPath (\'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\\'+$r.DefaultDistribution) -ErrorAction Stop).DistributionName'
		resolveNativePath.wslDefaults ??= new Map()
		if (!resolveNativePath.wslDefaults.has(bash)) resolveNativePath.wslDefaults.set(bash, (async () => {
			try {
				const { result } = await execShellWithTimeout('powershell', code, { no_ansi_terminal_sequences: true }, 5000)
				return String(result.stdout || '').trim() || null
			}
			catch { return null }
		})())
		distro = await resolveNativePath.wslDefaults.get(bash)
	}
	const nativeBase = base && /^\/(?!\/)/.test(base) ? await resolveNativePath(base) : base
	return path.win32.resolve(nativeBase || '.', mapWindowsPath(value, { bash, root: process.env.MSYS_ROOT_PATH, distro, home: os.homedir() }))
}
