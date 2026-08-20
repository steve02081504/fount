/**
 * 解析可用的 shellcheck：where_command 找 PATH；缺失或过旧则拉 GitHub 最新
 * stable release（资源布局同 vscode-shellcheck bindl）。
 * @see https://github.com/vscode-shellcheck/vscode-shellcheck/blob/master/bindl.config.js
 */
/* global Deno */
import { mkdir, access, chmod, copyFile, rename, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'

import { execFile, where_command } from 'npm:@steve02081504/exec'

import { ms } from '../../src/scripts/ms.mjs'
import { testDataRoot } from '../../src/scripts/test/core/paths.mjs'
import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

/** latest.json 复用窗口（ms）。 */
const LATEST_CACHE_MS = ms('1d')
const RELEASES_LATEST = 'https://api.github.com/repos/koalaman/shellcheck/releases/latest'

/**
 * @param {string} versionA 版本
 * @param {string} versionB 版本
 * @returns {number} versionA 小于 versionB 为负；相等为 0；versionA 大于 versionB 为正
 */
export function compareVersions(versionA, versionB) {
	const segmentsA = versionA.replace(/^v/i, '').split('.').map(segment => Number(segment) || 0)
	const segmentsB = versionB.replace(/^v/i, '').split('.').map(segment => Number(segment) || 0)
	for (let index = 0; index < Math.max(segmentsA.length, segmentsB.length); index++) {
		const difference = (segmentsA[index] || 0) - (segmentsB[index] || 0)
		if (difference) return difference
	}
	return 0
}

/**
 * @param {string} version 无 v 前缀
 * @returns {{ url: string, archiveName: string, binaryName: string, stripPrefix: string | null }} 当前平台资源
 */
export function shellcheckReleaseAsset(version) {
	const { os, arch } = Deno.build
	const base = `https://github.com/koalaman/shellcheck/releases/download/v${version}/shellcheck-v${version}`
	const binaryName = os === 'windows' ? 'shellcheck.exe' : 'shellcheck'
	if (os === 'windows')
		return {
			url: `${base}.zip`,
			archiveName: `shellcheck-v${version}.zip`,
			binaryName,
			stripPrefix: null,
		}

	const scArch = arch === 'aarch64' ? 'aarch64'
		: arch === 'x86_64' ? 'x86_64'
			: null
	if (!scArch)
		throw new Error(`shellcheck: unsupported arch ${arch}`)
	if (os !== 'linux' && os !== 'darwin')
		throw new Error(`shellcheck: unsupported os ${os}`)
	const platform = os === 'darwin' ? 'darwin' : 'linux'
	// tar.gz：系统 tar 即可；bindl 用 tar.xz
	return {
		url: `${base}.${platform}.${scArch}.tar.gz`,
		archiveName: `shellcheck-v${version}.${platform}.${scArch}.tar.gz`,
		binaryName,
		stripPrefix: `shellcheck-v${version}`,
	}
}

/**
 * @param {string} path 路径
 * @returns {Promise<boolean>} 是否存在
 */
const exists = async (path) => {
	try {
		await access(path)
		return true
	}
	catch {
		return false
	}
}

/**
 * 读 shellcheck --version 中的版本号。
 * @param {string} exe 可执行路径
 * @returns {Promise<string | null>} 如 0.11.0
 */
export async function readShellcheckVersion(exe) {
	try {
		const result = await execFile(exe, ['--version'])
		if ((result.code ?? 1) !== 0) return null
		const match = String(result.stdout ?? '').match(/version:\s*(\S+)/i)
		return match?.[1] ?? null
	}
	catch {
		return null
	}
}

/**
 * 查询 GitHub 最新 stable tag（带本地缓存）。
 * @returns {Promise<string>} 无 v 前缀的版本号
 */
export async function fetchLatestShellcheckVersion() {
	const metaPath = join(testDataRoot(REPO_ROOT), 'shellcheck', 'latest.json')
	try {
		const cached = JSON.parse(await readFile(metaPath, 'utf8'))
		if (cached?.version && cached?.checkedAt
			&& Date.now() - cached.checkedAt < LATEST_CACHE_MS)
			return String(cached.version).replace(/^v/i, '')
	}
	catch { /* miss */ }

	const res = await fetch(RELEASES_LATEST, {
		headers: {
			Accept: 'application/vnd.github+json',
			'User-Agent': 'fount-path-shellcheck',
		},
	})
	if (!res.ok)
		throw new Error(`shellcheck latest release: ${res.status}`)
	const data = await res.json()
	const tag = String(data.tag_name || '')
	const version = tag.replace(/^v/i, '')
	if (!/^\d+\.\d+/.test(version))
		throw new Error(`shellcheck latest: unexpected tag ${tag}`)
	await mkdir(dirname(metaPath), { recursive: true })
	await writeFile(metaPath, JSON.stringify({ version, checkedAt: Date.now(), tag }, null, '\t'))
	return version
}

/**
 * @param {string} cacheDir 解压目录
 * @param {{ url: string, archiveName: string, binaryName: string, stripPrefix: string | null }} asset 资源
 * @returns {Promise<string>} 二进制绝对路径
 */
async function downloadShellcheck(cacheDir, asset) {
	await mkdir(cacheDir, { recursive: true })
	const archivePath = join(cacheDir, asset.archiveName)
	const res = await fetch(asset.url)
	if (!res.ok)
		throw new Error(`shellcheck download failed: ${res.status} ${asset.url}`)
	await Deno.writeFile(archivePath, new Uint8Array(await res.arrayBuffer()))

	const extractDir = join(cacheDir, 'extract')
	await mkdir(extractDir, { recursive: true })
	const tarArgs = asset.archiveName.endsWith('.tar.gz')
		? ['-xzf', archivePath, '-C', extractDir]
		: ['-xf', archivePath, '-C', extractDir]
	const tar = await execFile('tar', tarArgs)
	if ((tar.code ?? 1) !== 0)
		throw new Error(`shellcheck extract failed: ${tar.stderr || tar.stdout}`)

	const extracted = asset.stripPrefix
		? join(extractDir, asset.stripPrefix, asset.binaryName)
		: join(extractDir, asset.binaryName)
	const dest = join(cacheDir, asset.binaryName)
	try {
		await rename(extracted, dest)
	}
	catch {
		await copyFile(extracted, dest)
	}
	if (Deno.build.os !== 'windows')
		await chmod(dest, 0o755)
	const ver = await readShellcheckVersion(dest)
	if (!ver)
		throw new Error(`downloaded shellcheck does not run: ${dest}`)
	return dest
}

/**
 * 确保缓存中有指定版本的二进制。
 * @param {string} version 版本
 * @returns {Promise<string>} 可执行路径
 */
async function ensureCachedVersion(version) {
	const asset = shellcheckReleaseAsset(version)
	const cacheDir = join(testDataRoot(REPO_ROOT), 'shellcheck', `v${version}`)
	const cached = join(cacheDir, asset.binaryName)
	if (await exists(cached) && await readShellcheckVersion(cached))
		return cached
	return downloadShellcheck(cacheDir, asset)
}

/**
 * 若 PATH 上的二进制可写且落后，就地换成最新版。
 * @param {string} pathExe PATH 解析路径
 * @param {string} latestExe 已下载的最新二进制
 * @param {string} latest 最新版本
 * @returns {Promise<boolean>} 是否已替换
 */
async function tryUpgradePathBinary(pathExe, latestExe, latest) {
	if (pathExe === latestExe) return false
	try {
		await copyFile(latestExe, pathExe)
		const ver = await readShellcheckVersion(pathExe)
		return ver === latest
	}
	catch {
		return false
	}
}

/**
 * 返回尽量新的 shellcheck 可执行路径（PATH 最新 / 缓存下载；可写则升级 PATH）。
 * @returns {Promise<string>} 可执行路径
 */
export async function ensureShellcheck() {
	const latest = await fetchLatestShellcheckVersion()
	const pathExe = await where_command('shellcheck')
	if (pathExe) {
		const pathVer = await readShellcheckVersion(pathExe)
		if (pathVer && compareVersions(pathVer, latest) >= 0)
			return pathExe
	}

	const cached = await ensureCachedVersion(latest)
	if (pathExe)
		await tryUpgradePathBinary(pathExe, cached, latest)
	const upgraded = pathExe && await readShellcheckVersion(pathExe)
	if (upgraded && compareVersions(upgraded, latest) >= 0)
		return pathExe
	return cached
}

/**
 * 跑 shellcheck，返回聚合结果。
 * @param {string} exe shellcheck 路径
 * @param {string[]} files 脚本路径（相对仓库根或绝对）
 * @param {string[]} [extraArgs] 额外参数
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} 结果
 */
export async function runShellcheck(exe, files, extraArgs = []) {
	const result = await execFile(exe, [...extraArgs, ...files], {
		cwd: REPO_ROOT,
		env: {
			...process.env,
			PYTHONUTF8: '1',
		}
	})
	return {
		code: result.code ?? 1,
		stdout: String(result.stdout ?? ''),
		stderr: String(result.stderr ?? ''),
	}
}
