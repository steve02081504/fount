import { primaryLocale } from '/scripts/i18n/index.mjs'
import { buildMentionLabelMapFromHubState } from '../../shared/expandMentions.mjs'
import { store } from '../core/state.mjs'

import { getMessageText } from './render/text.mjs'

/** 渲染快照绑定在 DOM 节点上，而非会被原地修改的 source 行。 */
const renderedRows = new WeakMap()
const chromeSelectors = ['.chat-image', '.message-hover-bar', '.chat-header', '.chat-footer']

/**
 * @param {object} message 消息行
 * @returns {string} 按签名作者作用域的稳定视觉标识
 */
export function messageRowKey(message) {
	if (message.eventId == null) throw new TypeError('message row missing eventId')
	const clientMessageId = message.content?.extension?.chat?.clientMessageId
	return message.type === 'message' && !message.isRemote && clientMessageId
		? `client:${message.sender}:${clientMessageId}`
		: String(message.eventId)
}

/**
 * @param {HTMLElement} element 新渲染行
 * @param {object} message 消息行
 * @returns {HTMLElement} 同一元素
 */
export function rememberRenderedMessageRow(element, message) {
	const body = element.querySelector('.message-content')
	const { name, avatar, ...bodyContent } = message.content || {}
	const bodySignature = JSON.stringify({
		content: bodyContent,
		locale: primaryLocale(),
		mentionLabels: getMessageText(message).includes('@[')
			? [...buildMentionLabelMapFromHubState(store.context.currentState, store.viewer)]
			: null,
		quote: body?.querySelector('.message-quote')?.outerHTML,
		staticBody: body?.dataset.mdHydrated === '1' ? undefined : body?.innerHTML,
		decryptView: message.decryptView,
		generating: !!message.content?.is_generating,
		sendFailed: !!message.sendFailed,
		author: message.authorPubKeyHash || '',
		remote: !!message.isRemote,
		untrusted: body?.dataset.mdUntrusted,
	}, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
		? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
		: value)
	renderedRows.set(element, {
		bodySignature,
		chrome: chromeSelectors.map(selector => element.querySelector(selector)?.outerHTML ?? ''),
	})
	return element
}

/**
 * 原地打补丁更新投递态/外壳，不卸载未变的 Markdown、媒体与文字选择。
 * @param {HTMLElement} previous 已挂载行
 * @param {HTMLElement} next 新渲染行
 * @returns {HTMLElement} 交由虚拟列表保留的已挂载元素
 */
export function updateRenderedMessageRow(previous, next) {
	const before = renderedRows.get(previous)
	const after = renderedRows.get(next)
	if (!before || !after || before.bodySignature !== after.bodySignature) {
		previous.replaceWith(next)
		return next
	}
	for (const attribute of [...previous.attributes])
		if (!next.hasAttribute(attribute.name)) previous.removeAttribute(attribute.name)
	for (const attribute of next.attributes)
		if (previous.getAttribute(attribute.name) !== attribute.value)
			previous.setAttribute(attribute.name, attribute.value)
	for (const [index, selector] of chromeSelectors.entries()) {
		if (before.chrome[index] === after.chrome[index]) continue
		const oldChrome = previous.querySelector(selector)
		const newChrome = next.querySelector(selector)
		if (oldChrome && newChrome) oldChrome.replaceWith(newChrome)
		else if (oldChrome) oldChrome.remove()
		else if (newChrome) {
			const stack = previous.querySelector('.message-stack-inner')
			if (selector === '.chat-image') previous.prepend(newChrome)
			else if (selector === '.message-hover-bar') stack.prepend(newChrome)
			else stack.append(newChrome)
		}
	}
	renderedRows.set(previous, after)
	return previous
}
