import { initTranslations, geti18n } from '../scripts/i18n.mjs'

// 获取 DOM 元素
const originalUrlInput = document.getElementById('originalUrlInput')
const newUrlOutput = document.getElementById('newUrlOutput')
const copyButton = document.getElementById('copyButton')
const badgePreview = document.getElementById('badgePreview')
const previewContainer = document.getElementById('previewContainer')

// 监听输入框的输入事件
originalUrlInput.addEventListener('input', () => {
	const originalUrl = originalUrlInput.value.trim()

	// 检查 URL 是否有效
	if (originalUrl && originalUrl.includes('img.shields.io')) {
		// 1. 替换域名
		let newUrl = originalUrl.replace('img.shields.io', 'custom-icon-badges.demolab.com')

		// 2. 附加 logo=fount 参数
		// 检查 URL 是否已经有查询参数
		if (newUrl.includes('?'))
			// 如果有，用 '&' 连接
			newUrl += '&logo=fount'
		else
			// 如果没有，用 '?' 开始
			newUrl += '?logo=fount'


		// 更新输出框和预览
		newUrlOutput.value = newUrl
		badgePreview.src = newUrl
		previewContainer.classList.remove('hidden') // 显示预览
		copyButton.disabled = false // 启用复制按钮
	} else {
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
		const originalText = copyButton.innerText
		copyButton.innerText = geti18n('badges_maker.copied_text')
		setTimeout(() => {
			copyButton.innerText = originalText
		}, 1500) // 1.5秒后恢复原状
	}).catch(err => {
		console.error(geti18n('badges_maker.copy_error'), err)
		alert(geti18n('badges_maker.copy_fail_alert'))
	})
})

async function main() {
	await initTranslations('badges_maker')
}

main()