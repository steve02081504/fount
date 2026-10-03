/**
 * 【文件】src/public/parts/shells/code/src/tgrep_binary.mjs
 * 【职责】把当前平台的官方 tgrep 发布版装进共享临时 bin 目录。
 * 【原理】按 `平台-架构` 映射 release 目标三元组，取 latest release 中对应归档，校验 sha256 后解出可执行文件；
 *   并发调用共享同一个安装 Promise，写入用临时文件 + rename 落位。
 * 【关联】search_index.mjs 启动索引服务时调用；失败只在控制台告警，不阻塞工作区打开。
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const pending = new Map()
const RELEASE_URL = 'https://api.github.com/repos/microsoft/tgrep/releases/latest'

/**
 * 当前平台对应的 GitHub release 目标三元组。
 * @returns {string|null} 目标三元组；不支持的平台返回 null。
 */
function targetTriple() {
	const pairs = {
		'win32-x64': 'x86_64-pc-windows-msvc',
		'win32-arm64': 'aarch64-pc-windows-msvc',
		'darwin-x64': 'x86_64-apple-darwin',
		'darwin-arm64': 'aarch64-apple-darwin',
		'linux-x64': 'x86_64-unknown-linux-musl',
		'linux-arm64': 'aarch64-unknown-linux-musl',
	}
	return pairs[`${process.platform}-${process.arch}`] || null
}

/**
 * 从 tar 归档中取出 tgrep 可执行文件。
 * @param {Uint8Array} bytes - 已解压的 tar 数据。
 * @returns {Uint8Array|null} 可执行文件内容。
 */
function extractFromTar(bytes) {
	const decoder = new TextDecoder()
	for (let offset = 0; offset + 512 <= bytes.length;) {
		const header = bytes.subarray(offset, offset + 512)
		if (header.every(byte => byte === 0)) break
		const name = decoder.decode(header.subarray(0, 100)).split('\0')[0]
		const size = Number.parseInt(decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim(), 8)
		if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length) throw new Error('Invalid tgrep tar archive')
		// tar 的类型标志：普通文件（0 / '0'）才可能是可执行文件。
		if (path.posix.basename(name) === 'tgrep' && (header[156] === 0 || header[156] === 48))
			return bytes.slice(offset + 512, offset + 512 + size)
		offset += 512 + Math.ceil(size / 512) * 512
	}
	return null
}

/**
 * 从 zip 归档中取出 tgrep.exe。
 * @param {Uint8Array} bytes - zip 数据。
 * @param {(input: Uint8Array) => Record<string, Uint8Array>} unzipSync - fflate 的同步解压函数。
 * @returns {Uint8Array|null} 可执行文件内容。
 */
function extractFromZip(bytes, unzipSync) {
	return Object.entries(unzipSync(bytes)).find(([name]) => path.posix.basename(name) === 'tgrep.exe')?.[1] || null
}

/**
 * 请求 GitHub API 或资源地址。
 * @param {string} url - GitHub API 或资源地址。
 * @returns {Promise<Response>} 已确认成功状态的响应。
 */
async function githubFetch(url) {
	const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'fount-tgrep' } })
	if (!response.ok) throw new Error(`tgrep download failed: HTTP ${response.status}`)
	return response
}

/**
 * 解析 release 给出的校验和：优先用资源自带的 digest，否则读 checksums.txt。
 * @param {object} asset - 归档资源对象。
 * @param {object|undefined} checksums - checksums.txt 资源对象。
 * @param {string} archiveName - 归档文件名。
 * @returns {Promise<string>} 期望的 sha256 十六进制串；取不到时为空串。
 */
async function readExpectedChecksum(asset, checksums, archiveName) {
	if (asset.digest?.startsWith('sha256:')) return asset.digest.slice(7)
	if (!checksums) return ''
	const text = await (await githubFetch(checksums.browser_download_url)).text()
	return text.split(/\r?\n/).find(line => line.trim().endsWith(archiveName))?.trim().split(/\s+/)[0] || ''
}

/**
 * 确保本机存在 tgrep 可执行文件，缺失时下载安装。
 * @returns {Promise<string|null>} 可执行文件路径；当前平台不支持或安装失败时为 null。
 */
export async function ensureTgrepBinary() {
	const triple = targetTriple()
	if (!triple) return null
	const binDir = path.join(os.tmpdir(), 'fount', 'bin')
	const target = path.join(binDir, process.platform === 'win32' ? 'tgrep.exe' : 'tgrep')
	try { await fs.access(target); return target } catch { /* 未安装，走下面的下载 */ }
	if (pending.has(target)) return pending.get(target)
	const install = (async () => {
		const release = await (await githubFetch(RELEASE_URL)).json()
		const extension = process.platform === 'win32' ? 'zip' : 'tar.gz'
		const archiveName = `tgrep-${release.tag_name}-${triple}.${extension}`
		const asset = release.assets?.find(item => item.name === archiveName)
		if (!asset) throw new Error(`No tgrep release for ${triple}`)
		const expected = await readExpectedChecksum(asset, release.assets?.find(item => item.name === 'checksums.txt'), archiveName)
		if (!/^[a-f\d]{64}$/i.test(expected)) throw new Error(`Missing tgrep checksum for ${archiveName}`)
		const archive = new Uint8Array(await (await githubFetch(asset.browser_download_url)).arrayBuffer())
		if (createHash('sha256').update(archive).digest('hex') !== expected.toLowerCase()) throw new Error(`tgrep checksum mismatch for ${archiveName}`)
		const { gunzipSync, unzipSync } = await import('npm:fflate')
		const binary = extension === 'zip' ? extractFromZip(archive, unzipSync) : extractFromTar(gunzipSync(archive))
		if (!binary?.length) throw new Error(`Missing tgrep binary in ${archiveName}`)
		await fs.mkdir(binDir, { recursive: true })
		const staging = `${target}.${process.pid}.${randomUUID()}.tmp`
		try {
			await fs.writeFile(staging, binary, { mode: 0o755 })
			await fs.chmod(staging, 0o755)
			try { await fs.rename(staging, target) }
			catch (error) {
				// 并发安装时另一个进程可能已先落位，那就算成功。
				try { await fs.access(target) } catch { throw error }
			}
		}
		finally { await fs.rm(staging, { force: true }) }
		return target
	})().catch(error => {
		console.warn('code shell: tgrep unavailable', error)
		return null
	}).finally(() => pending.delete(target))
	pending.set(target, install)
	return install
}
