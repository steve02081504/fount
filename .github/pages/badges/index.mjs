import { showToastI18n } from '../scripts/features/toast.mjs'
import { initTranslations, console } from '../scripts/i18n/index.mjs'

// 获取 DOM 元素
const originalUrlInput = document.getElementById('originalUrlInput')
const newUrlOutput = document.getElementById('newUrlOutput')
const copyButton = document.getElementById('copyButton')
const badgePreview = document.getElementById('badgePreview')
const previewContainer = document.getElementById('previewContainer')

/**
 * 解析 shields.io 徽章 URL，仅接受 `img.shields.io` 主机（避免子串匹配绕过）。
 * 缺省协议时按 https 处理。
 * @param {string} value - 用户输入。
 * @returns {URL | null} 主机匹配时返回 URL，否则 null。
 */
function parseShieldsUrl(value) {
	if (!value) return null
	try {
		const url = new URL(/^[a-z][\w+.-]*:\/\//i.test(value) ? value : `https://${value}`)
		return url.hostname === 'img.shields.io' ? url : null
	}
	catch {
		return null
	}
}

// 监听输入框的输入事件
originalUrlInput.addEventListener('input', () => {
	const parsed = parseShieldsUrl(originalUrlInput.value.trim())

	if (parsed) {
		// 1. 替换域名
		parsed.hostname = 'custom-icon-badges.demolab.com'

		// 2. 附加 logo=fount 参数
		parsed.searchParams.set('logo', 'fount')

		// 更新输出框和预览
		newUrlOutput.value = parsed.href
		badgePreview.src = parsed.href
		previewContainer.classList.remove('hidden') // 显示预览
		copyButton.disabled = false // 启用复制按钮
	}
	else {
		// 如果输入无效或为空，则清空输出和预览
		newUrlOutput.value = ''
		badgePreview.src = ''
		previewContainer.classList.add('hidden') // 隐藏预览
		copyButton.disabled = true // 禁用复制按钮
	}
})

// 监听复制按钮的点击事件
copyButton.addEventListener('click', () => {
	const urlToCopy = newUrlOutput.value
	if (!urlToCopy) return

	// 使用现代的 Clipboard API
	navigator.clipboard.writeText(urlToCopy).then(() => {
		// 提供视觉反馈
		const originalText = copyButton.dataset.i18n
		copyButton.dataset.i18n = 'badges_maker.copied_text'
		setTimeout(() => {
			copyButton.dataset.i18n = originalText
		}, 1500) // 1.5秒后恢复原状
	}).catch(err => {
		console.errorI18n('badges_maker.copy_error', { error: err })
		showToastI18n('error', 'badges_maker.copy_fail_alert')
	})
})

/**
 * 主函数
 * @returns {Promise<void>}
 */
async function main() {
	await initTranslations('badges_maker')
}

main()
