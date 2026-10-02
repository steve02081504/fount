/** 内置且惰性的附件预览：只渲染可安全展示的媒体，其余一律按文本处理并保留下载入口。 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { attachmentUrl, readAttachmentText } from '../endpoints.mjs'

/** 内容寻址 blob 键（与后端 `isAttachmentHash` 同构）。 */
const validHash = /^[a-f0-9]{64}$/
/** 可内联播放 / 展示的媒体类型。 */
const mediaMime = /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp)|audio\/|video\/)/
/** 可按文本预览的类型与扩展名。 */
const textMime = /^(?:text\/|application\/(?:json|xml|javascript|x-yaml|toml)$)/
const textExtension = /\.(?:txt|md|csv|tsv|log|json|xml|ya?ml|toml|[cm]?js|ts|py|sh|ps1|tex)$/i

/**
 * 构造惰性加载的文本预览：展开时才拉取有限长度的内容。
 * @param {object} file 附件引用
 * @returns {HTMLDetailsElement} 预览节点
 */
function textPreview(file) {
	const details = document.createElement('details')
	const summary = document.createElement('summary')
	summary.textContent = geti18n('agent_studio.attachments.preview')
	const pre = document.createElement('pre')
	pre.setAttribute('prompt-content', '')
	details.append(summary, pre)
	/** 是否已在拉取（失败时复位以允许重试）。 */
	let loading = false
	details.addEventListener('toggle', () => {
		if (!details.open || loading) return
		loading = true
		void readAttachmentText(file.hash, file.name).then(({ text, truncated }) => {
			pre.textContent = text
			if (truncated) pre.append(document.createTextNode('\n' + geti18n('agent_studio.attachments.truncated')))
		}).catch(() => {
			loading = false
			pre.textContent = geti18n('agent_studio.attachments.unavailable')
		})
	})
	return details
}

/**
 * 按 MIME 构造内联媒体节点。
 * @param {object} file 附件引用
 * @param {string} mime 归一化 MIME
 * @returns {HTMLImageElement | HTMLAudioElement | HTMLVideoElement | null} 媒体节点；非可展示媒体时 null
 */
function mediaPreview(file, mime) {
	if (!mediaMime.test(mime)) return null
	const tag = mime.startsWith('image/') ? 'img' : mime.startsWith('audio/') ? 'audio' : 'video'
	const media = document.createElement(tag)
	media.src = attachmentUrl(file.hash, { name: file.name })
	media.setAttribute('prompt-content', '')
	if (tag === 'img') {
		media.alt = file.name || ''
		media.loading = 'lazy'
	}
	else {
		media.controls = true
		media.preload = 'none'
		media.setAttribute('aria-label', file.name || mime)
	}
	return media
}

/**
 * 渲染一组附件预览（每项都带下载入口）。
 * @param {object[]} files 附件引用
 * @returns {HTMLElement} 预览容器
 */
export function attachmentList(files = []) {
	const list = document.createElement('div')
	list.className = 'studio-attachments'
	for (const file of files) {
		const card = document.createElement('section')
		card.className = 'studio-attachment'
		const title = document.createElement('span')
		title.setAttribute('prompt-content', '')
		title.textContent = file.name || file.hash || ''
		card.append(title)
		if (!validHash.test(file.hash ?? '')) {
			const hint = document.createElement('span')
			hint.textContent = geti18n('agent_studio.attachments.unavailable')
			card.append(hint)
			list.append(card)
			continue
		}
		const link = document.createElement('a')
		link.className = 'btn btn-ghost btn-xs'
		link.href = attachmentUrl(file.hash, { download: true, name: file.name })
		link.download = file.name || file.hash
		link.textContent = geti18n('agent_studio.actions.download')
		card.append(link)
		const mime = (file.mime_type || '').split(';')[0].trim().toLowerCase()
		const media = mediaPreview(file, mime)
		if (media) card.append(media)
		else if (textMime.test(mime) || textExtension.test(file.name || '')) card.append(textPreview(file))
		list.append(card)
	}
	return list
}
