/**
 * 【文件】public/src/fountUser.mjs
 * 【职责】在 window 上注册 `fount.user.send`，供消息内 HTML（选项按钮等）代用户回复触发帖的贴主。
 * 【原理】capture 阶段点击追踪最近触发元素 → `resolveTriggerPost` 定位帖子 → 以 `replyTo` 发公开回复。
 */
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { primaryLocale } from '/scripts/i18n/index.mjs'
import { normalizeUserSendPayload } from '/parts/shells:chat/shared/fountUserSend.mjs'
import { resolveTriggerPost } from '../shared/fountUserSend.mjs'

import { createPost, getPost } from './endpoints/posts.mjs'

/** 最近一次被点击的元素（capture 阶段记录；inline onclick 在目标阶段触发，capture 先执行）。 */
let lastClickTarget = null

/**
 * 注册 capture 阶段的点击追踪，供 `fount.user.send` 定位触发帖。
 * @returns {() => void} 解绑函数
 */
export function trackClickTarget() {
	/**
	 * @param {Event} event 点击事件
	 * @returns {void}
	 */
	const onCaptureClick = event => {
		lastClickTarget = event.target instanceof Element ? event.target : null
	}
	document.addEventListener('click', onCaptureClick, { capture: true })
	return () => document.removeEventListener('click', onCaptureClick, { capture: true })
}

/**
 * 读取触发帖的 locale（取不到回退 primaryLocale）。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {Promise<string>} locale
 */
async function postLocaleOf(entityHash, postId) {
	try {
		const { item } = await getPost(entityHash, postId)
		return item?.post?.content?.locale || primaryLocale()
	}
	catch {
		return primaryLocale()
	}
}

/**
 * 代当前用户回复触发帖的贴主。
 * @param {string | object} input 纯文本或近似 `chatLogEntry_t`
 * @returns {Promise<object>} 已发布回复事件
 */
export async function sendAsUser(input) {
	const target = resolveTriggerPost(lastClickTarget)
	if (!target) {
		const message = 'fount.user.send: no trigger post found'
		console.error(message)
		throw new Error(message)
	}
	const { content } = normalizeUserSendPayload(input, { locale: primaryLocale() })
	const text = String(content.content ?? '').trim()
	if (!text) throw new Error('fount.user.send: empty content')
	return createPost({
		text,
		replyTo: { entityHash: target.entityHash, postId: target.postId },
		visibility: 'public',
		locale: await postLocaleOf(target.entityHash, target.postId),
	})
}

/**
 * 注册 `globalThis.fount.user.send`（幂等）。
 * @returns {void}
 */
export function registerFountUserApi() {
	globalThis.fount ??= {}
	globalThis.fount.user ??= {}
	trackClickTarget()
	/**
	 * 代当前用户回复触发帖的贴主。
	 * @param {string | object} input 纯文本或近似 `chatLogEntry_t`
	 * @returns {Promise<object>} 已发布回复事件
	 */
	globalThis.fount.user.send = async input => {
		try {
			return await sendAsUser(input)
		}
		catch (err) {
			showToastI18n('error', 'social.actions.replyFailed', { error: err?.message || String(err) })
			throw err
		}
	}
}
