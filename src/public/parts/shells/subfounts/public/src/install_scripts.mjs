/**
 * subfount 客户端安装脚本（按 OS 分组，供前端 tab 展示与复制）。
 * 公共包管理器同步段来自 `./pkg_mgr_block.mjs`（与 `path/fount` 保持同步）。
 */
import { FOUNT_PKG_MGR_BLOCK } from './pkg_mgr_block.mjs'

/**
 *
 * @param header
 */
/**
 * 拼装 Unix 系（bash）安装脚本：以给定头部注释开头，内嵌同步段并管道到官方 install.sh。
 * @param {string} header 脚本头部注释（如 SUBF_DIR 环境变量提示）。
 * @returns {string} 完整 bash 安装脚本。
 */
const bashInstall = (header) => `${header}
${FOUNT_PKG_MGR_BLOCK}
install_package "bash" "bash gnu-bash"; install_package "curl"
export FOUNT_AUTO_INSTALLED_PACKAGES
curl -fsSL https://steve02081504.github.io/subfount/install.sh | bash
. "$HOME/.profile"`

/**
 * 各 OS 的安装脚本内容。
 * @type {Record<string, string>}
 */
export const INSTALL_SCRIPTS = {
	linux: bashInstall('# If needed, define the environment variable $SUBF_DIR to specify the subfount directory'),
	macos: bashInstall('# If needed, define the environment variable $SUBF_DIR to specify the subfount directory'),
	android: bashInstall('# If needed, define the environment variable $SUBF_DIR to specify the subfount directory'),
	windows: `# If needed, define the environment variable $env:SUBF_DIR to specify the subfount directory
irm https://steve02081504.github.io/subfount/install.ps1 | iex`,
}

/**
 * 根据当前浏览器的平台信息推断目标 OS。
 * @returns {keyof typeof INSTALL_SCRIPTS} 匹配的 OS 键。
 */
export function detectOs() {
	const ua = navigator.userAgent || ''
	if (/android/i.test(ua) || /Android/i.test(navigator.userAgentData?.platform || '')) return 'android'
	const platform = navigator.userAgentData?.platform || navigator.platform || ''
	if (/win/i.test(platform)) return 'windows'
	if (/mac|darwin|ipad|iphone/i.test(platform) || /Macintosh/i.test(ua)) return 'macos'
	return 'linux'
}
