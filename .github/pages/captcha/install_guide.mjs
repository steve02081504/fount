/**
 * 从浏览器信息推断操作系统。
 * @param {string} userAgent 浏览器 User-Agent
 * @param {string} platform navigator.platform 或 User-Agent Client Hints platform
 * @returns {'android'|'windows'|'mac'|'linux'|'unknown'} 平台类别
 */
export function detectPlatform(userAgent = '', platform = '') {
	if (/Android/i.test(userAgent)) return 'android'
	if (/Windows/i.test(platform) || /Windows/i.test(userAgent)) return 'windows'
	if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(userAgent)) return 'mac'
	if (/Linux|X11/i.test(platform) || /Linux/i.test(userAgent)) return 'linux'
	return 'unknown'
}

/**
 * 返回平台对应的 subfount 安装指引。
 * @param {'android'|'windows'|'mac'|'linux'|'unknown'} platform 操作系统
 * @returns {{command:string}} 安装指引
 */
export function getInstallGuide(platform) {
	return {
		command: platform === 'windows'
			? 'pwsh.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://steve02081504.github.io/subfount/install.ps1))) background keepalive"'
			: 'curl -fsSL https://steve02081504.github.io/subfount/install.sh | bash -s -- background keepalive',
	}
}

/**
 * 合并本机 fount 与 subfount 的验证结果，任一有效证明成功即通过。
 * @param {PromiseSettledResult<{status:string,nodeHash?:string,reason?:string}>[]} results 并行探测结果
 * @param {(value:unknown)=>boolean} isValidNodeHash 节点哈希校验函数
 * @returns {{status:string,nodeHash?:string,reason?:string}} 可展示的验证结果
 */
export function selectLocalVerificationResponse(results, isValidNodeHash) {
	const responses = results.filter(result => result.status === 'fulfilled').map(result => result.value)
	const verified = responses.find(result => result?.status === 'verified' && isValidNodeHash(result.nodeHash))
	if (verified) return verified
	const failed = responses.find(result => result?.status === 'failed')
	if (failed) return failed
	const error = results.find(result => result.status === 'rejected')
	throw error?.reason || new Error('找不到本机服务')
}
