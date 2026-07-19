/**
 * 将 Markdown 正文 HTML（及可选附件）包装为可离线打开的完整文档。
 * 对齐旧 chat `standalone_message`：OG 元数据、DaisyUI、github-markdown-css、暗色跟随、KaTeX/Shiki 条件样式、附件 data URL。
 */
import { geti18n, primaryLocale } from '../../i18n/index.mjs'
import { arrayBufferToBase64 } from '../../lib/base64.mjs'
import { escapeHtml } from '../../lib/escapeHtml.mjs'

import { renderMarkdownAsStandAloneHtmlString } from './index.mjs'

/**
 * @typedef {{ name?: string, mime_type?: string, mimeType?: string, dataUrl?: string, buffer?: string, _blob?: Blob }} StandaloneAttachment
 */

/**
 * @param {string} html 已渲染正文
 * @returns {{ title: string, description: string }} 页面元数据
 */
function deriveMeta(html) {
	const tempDiv = document.createElement('div')
	tempDiv.innerHTML = html
	const rawText = tempDiv.textContent || ''
	const cleanText = rawText.replace(/\s+/g, ' ').trim()
	// 帖子/长文常用 ## 作标题 → h2；旧导出认任意标题，不能只认 h1
	const heading = tempDiv.querySelector('h1, h2, h3, h4, h5, h6')
	const title = heading?.textContent?.trim()
		|| (cleanText ? `${cleanText.slice(0, 30)}${cleanText.length > 30 ? '...' : ''}` : 'Chat Message')
	const description = cleanText ? `${cleanText.slice(0, 150)}${cleanText.length > 150 ? '...' : ''}` : ''
	return { title, description }
}

/**
 * @param {StandaloneAttachment} file 附件
 * @returns {string | null} data URL
 */
function attachmentDataUrl(file) {
	if (file.dataUrl) return file.dataUrl
	const mime = file.mime_type || file.mimeType || 'application/octet-stream'
	if (file.buffer) return `data:${mime};base64,${file.buffer}`
	return null
}

/**
 * @param {string} dataUrl data URL
 * @returns {string} JS 字符串字面量
 */
function jsStringLiteral(dataUrl) {
	return JSON.stringify(dataUrl)
}

/**
 * @param {StandaloneAttachment[]} files 附件列表
 * @param {string} downloadLabel 下载按钮文案
 * @returns {string} 附件区 HTML
 */
function renderAttachmentsHtml(files, downloadLabel) {
	if (!files?.length) return ''
	const items = []
	for (const file of files) {
		const dataUrl = attachmentDataUrl(file)
		if (!dataUrl) continue
		const mime = file.mime_type || file.mimeType || 'application/octet-stream'
		const name = escapeHtml(file.name || 'file')
		const safeUrl = escapeHtml(dataUrl)
		let previewHtml = '<div class="file-placeholder" style="font-size: 40px; text-align: center;">📄</div>'
		if (mime.startsWith('image/'))
			previewHtml = `<img src="${safeUrl}" alt="${name}" style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in;" onclick="openModal(${jsStringLiteral(dataUrl)}, 'image')">`
		else if (mime.startsWith('video/'))
			previewHtml = `<video src="${safeUrl}" controls style="max-width: 100%; max-height: 100%;"></video>`
		else if (mime.startsWith('audio/'))
			previewHtml = `<audio src="${safeUrl}" controls></audio>`
		items.push(`
			<div class="attachment" style="border: 1px solid #ccc; border-radius: 5px; padding: 10px; margin: 5px; display: inline-block; text-align: center; max-width: 200px;">
				<div class="preview" style="min-height: 100px; display: flex; align-items: center; justify-content: center;">
					${previewHtml}
				</div>
				<div class="file-name" style="font-size: 0.8em; margin-top: 5px; word-wrap: break-word;">${name}</div>
				<a href="${safeUrl}" download="${name}" class="download-button" style="margin-top: 5px; display: inline-block; padding: 5px 10px; background-color: #007bff; color: white; text-decoration: none; border-radius: 3px;">${escapeHtml(downloadLabel)}</a>
			</div>`)
	}
	if (!items.length) return ''
	return `<div class="attachments" style="margin-top: 10px; display: flex; flex-wrap: wrap;">${items.join('')}</div>`
}

/**
 * 将已渲染的 Markdown HTML 包装为完整独立文档。
 * @param {string} messageHtml 正文 HTML 片段
 * @param {{ files?: StandaloneAttachment[], locale?: string, downloadLabel?: string }} [options] 选项
 * @returns {string} 完整 HTML 文档
 */
export function wrapStandaloneMarkdownDocument(messageHtml, options = {}) {
	const locale = options.locale || primaryLocale()
	const { title, description } = deriveMeta(messageHtml)
	const files = options.files || []
	const hasFiles = files.some(file => attachmentDataUrl(file))
	const downloadLabel = hasFiles
		? options.downloadLabel || geti18n('chat.attachment.buttons.download.title') || 'Download'
		: ''
	const hasKatex = messageHtml.includes('katex-mathml')
	const hasCodeBlock = messageHtml.includes('markdown-code-block')
	const hasFigure = messageHtml.includes('figure')
	const attachmentsHtml = hasFiles ? renderAttachmentsHtml(files, downloadLabel) : ''
	const ogTitle = escapeHtml(title)
	const ogDescription = escapeHtml(description)

	return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
	<meta charset="UTF-8">
	<meta property="og:title" content="${ogTitle}" />
	<meta property="og:url" content="https://steve02081504.github.io/fount/protocol?url=fount://page/parts/shells:chat/" />
	<meta property="og:type" content="website" />
	<meta property="og:description" content="${ogDescription}" />
	<meta name="description" content="${ogDescription}" />
	<meta property="og:image" content="https://repository-images.githubusercontent.com/862251163/0ac90205-ae40-4fc6-af67-1e28d074c76b" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="icon" type="image/svg+xml" href="https://steve02081504.github.io/fount/imgs/icon.svg">
	<title>${ogTitle}</title>
	<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4" crossorigin="anonymous"></${'script'}>
	<link href="https://cdn.jsdelivr.net/npm/daisyui/daisyui.css" rel="stylesheet" type="text/css" crossorigin="anonymous" />${hasKatex ? `
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css" crossorigin="anonymous">` : ''}
	<style>
		body {
			margin: 0;
			font-family: sans-serif;
		}

		.markdown-body {
			box-sizing: border-box;
			padding: 45px;
		}

		.markdown-body .join-item,${hasFigure ? `
		.markdown-body figure,` : ''}${hasCodeBlock ? `
		.markdown-code-block,
		.markdown-code-block pre` : ''} {
			margin: 0 !important;
		}

		@media (max-width: 767px) {
			.markdown-body {
				padding: 15px;
			}
		}

		.text-icon {
			color: var(--color-base-content);
		}${hasCodeBlock ? `

		[color-scheme*="light"] [style*="--shiki-light"][style*="--shiki-dark"] {
			color: var(--shiki-light);
		}

		[color-scheme*="dark"] [style*="--shiki-light"][style*="--shiki-dark"] {
			color: var(--shiki-dark);
		}` : ''}
	</style>
</head>

<body class="flex flex-col min-h-screen">
	<script>
		const isDarkMode = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
		const styleLink = document.createElement('link')
		styleLink.rel = 'stylesheet'
		styleLink.crossOrigin = 'anonymous'
		document.documentElement.colorScheme = 'only ' + (document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light')
		styleLink.href = 'https://cdn.jsdelivr.net/npm/github-markdown-css/github-markdown-' + (isDarkMode ? 'dark' : 'light') + '.min.css'
		document.head.appendChild(styleLink)
${hasFiles ? `
		function openModal(src, type) {
			const modal = document.createElement('div')
			modal.style.position = 'fixed'
			modal.style.top = '0'
			modal.style.left = '0'
			modal.style.width = '100%'
			modal.style.height = '100%'
			modal.style.backgroundColor = 'rgba(0,0,0,0.8)'
			modal.style.display = 'flex'
			modal.style.justifyContent = 'center'
			modal.style.alignItems = 'center'
			modal.style.zIndex = '1000'
			modal.onclick = (e) => {
				if (e.target !== modal) return
				const video = modal.querySelector('video')
				if (video) video.pause()
				modal.remove()
			}

			let contentElement
			if (type === 'image') {
				contentElement = document.createElement('img')
				contentElement.src = src
			} else if (type === 'video') {
				contentElement = document.createElement('video')
				contentElement.src = src
				contentElement.controls = true
				contentElement.autoplay = true
			}

			if (contentElement) {
				contentElement.style.maxWidth = '90%'
				contentElement.style.maxHeight = '90%'
				contentElement.style.objectFit = 'contain'
				modal.appendChild(contentElement)
			}

			document.body.appendChild(modal)
		}
` : ''}	</${'script'}>
	<main class="flex-grow markdown-body">
		${messageHtml}${attachmentsHtml}
	</main>
	<footer class="w-full text-center text-xs text-gray-500 p-4">
		<p>Generated by <a class="link" href="https://github.com/steve02081504/fount" target="_blank">fount</a></p>
	</footer>
</body>

</html>`
}

/**
 * Markdown → 完整可离线 HTML 文档。
 * @param {string} markdown Markdown 原文
 * @param {{ cache?: object, files?: StandaloneAttachment[], locale?: string, downloadLabel?: string }} [options] 选项
 * @returns {Promise<string>} 完整 HTML
 */
export async function renderMarkdownAsStandaloneDocument(markdown, options = {}) {
	const messageHtml = await renderMarkdownAsStandAloneHtmlString(markdown || '', options.cache)
	return wrapStandaloneMarkdownDocument(messageHtml, options)
}

/**
 * 将可能含未物化 blob 的附件解析为可内嵌 buffer。
 * @param {StandaloneAttachment[]} files 附件
 * @returns {Promise<StandaloneAttachment[]>} 解析后附件
 */
export async function materializeStandaloneAttachments(files) {
	if (!files?.length) return []
	const out = []
	for (const file of files) {
		if (file.dataUrl || file.buffer) {
			out.push(file)
			continue
		}
		if (file._blob instanceof Blob) 
			out.push({
				name: file.name,
				mime_type: file.mime_type || file.mimeType || file._blob.type || 'application/octet-stream',
				buffer: arrayBufferToBase64(await file._blob.arrayBuffer()),
			})
		
	}
	return out
}

/**
 * 触发浏览器下载 HTML 字符串。
 * @param {string} html HTML 文档
 * @param {string} fileName 文件名
 * @returns {void}
 */
export function downloadHtmlDocument(html, fileName) {
	const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = fileName
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
	URL.revokeObjectURL(url)
}
