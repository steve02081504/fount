/**
 * 【文件】public/src/lib/textActions.mjs — prompt 文本块的复制 / 下载按钮
 * 【职责】为任意文本块生成一对图标按钮：复制到剪贴板、导出为 .txt 文件。
 * 【原理】`getText` 为取值函数以支持动态内容；复制失败经 toast 提示；下载用临时 Blob URL。
 * 【关联】views/conversation.mjs、lib/generationDialog.mjs、index.css 的 .section-actions。
 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

/**
 * 清洗下载文件名中的非法字符。
 * @param {string} name 原始文件名
 * @returns {string} 安全文件名
 */
function safeFilename(name) {
	return name.replace(/[\\/:*?"<>|]/g, '_')
}

/**
 * 生成绑定文本块的复制 / 下载按钮组。
 * @param {() => string} getText 返回当前文本
 * @param {{ filename: string }} options 下载文件名
 * @returns {HTMLElement} 按钮组容器
 */
export function textActions(getText, { filename }) {
	const group = document.createElement('span')
	group.className = 'section-actions'
	group.setAttribute('user-content', '')

	const copy = document.createElement('button')
	copy.type = 'button'
	copy.className = 'btn btn-ghost btn-xs'
	copy.title = geti18n('agent_studio.actions.copy')
	copy.setAttribute('aria-label', geti18n('agent_studio.actions.copy'))
	const copyIcon = document.createElement('span')
	copyIcon.className = 'icon icon-copy'
	copyIcon.setAttribute('aria-hidden', 'true')
	const copyLabel = document.createElement('span')
	copyLabel.className = 'section-actions-label'
	copyLabel.textContent = geti18n('agent_studio.actions.copy')
	copy.append(copyIcon, copyLabel)
	copy.addEventListener('click', () => {
		void navigator.clipboard.writeText(String(getText() ?? ''))
			.then(() => showToastI18n('success', 'agent_studio.alerts.copied'))
			.catch(error => showToastI18n('error', 'agent_studio.alerts.copyFailed', { message: error.message }))
	})

	const download = document.createElement('button')
	download.type = 'button'
	download.className = 'btn btn-ghost btn-xs'
	download.title = geti18n('agent_studio.actions.download')
	download.setAttribute('aria-label', geti18n('agent_studio.actions.download'))
	const downloadIcon = document.createElement('span')
	downloadIcon.className = 'icon icon-download'
	downloadIcon.setAttribute('aria-hidden', 'true')
	const downloadLabel = document.createElement('span')
	downloadLabel.className = 'section-actions-label'
	downloadLabel.textContent = geti18n('agent_studio.actions.download')
	download.append(downloadIcon, downloadLabel)
	download.addEventListener('click', () => {
		const blob = new Blob([String(getText() ?? '')], { type: 'text/plain;charset=utf-8' })
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = safeFilename(filename)
		link.click()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	})

	group.append(copy, download)
	return group
}
