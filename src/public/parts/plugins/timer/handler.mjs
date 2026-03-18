/** @typedef {import('../../../../decl/pluginAPI.ts').ReplyHandler_t} ReplyHandler_t */

import { getTimers, removeTimer, setTimer } from '../../../../server/timers.mjs'

import { registerChannel } from './state.mjs'

/**
 * timer 插件的 PATH
 */
export const PLUGIN_PATH = 'plugins/timer'

/**
 * 将自然语言时间字符串解析为毫秒数。
 * @param {string} durationString - 时间字符串，例如 "3天2小时" 或 "3 days 2 hours"。
 * @returns {number} 毫秒数。
 */
function parseDuration(durationString) {
	const dict = {
		seconds: 1000, sec: 1000, s: 1000,
		minutes: 60_000, min: 60_000, m: 60_000,
		hours: 3_600_000, hour: 3_600_000, h: 3_600_000,
		days: 86_400_000, day: 86_400_000, d: 86_400_000,
		weeks: 604_800_000, week: 604_800_000, wk: 604_800_000, w: 604_800_000,
		months: 2_592_000_000, month: 2_592_000_000, mo: 2_592_000_000,
		years: 31_536_000_000, year: 31_536_000_000, y: 31_536_000_000,
		century: 3_153_600_000_000, cent: 3_153_600_000_000, c: 3_153_600_000_000,
		秒: 1000,
		分钟: 60_000, 分: 60_000,
		小时: 3_600_000, 时: 3_600_000, 时辰: 7_200_000,
		天: 86_400_000, 日: 86_400_000,
		星期: 604_800_000, 周: 604_800_000,
		月: 2_592_000_000,
		年: 31_536_000_000,
		世纪: 3_153_600_000_000,
	}

	let duration = 0
	for (const unit in dict) {
		const match = durationString.match(new RegExp(`(?<value>\\d+)${unit}`))
		if (match?.groups?.value) {
			duration += Number(match.groups.value) * dict[unit]
			durationString = durationString.replace(match[0], '')
		}
	}
	if (durationString.trim())
		throw new Error(`无法解析的时间字段: "${durationString.trim()}"`)

	return duration
}

/**
 * 将聊天记录数组压平为文本片段。
 * @param {Array} chatLog 聊天记录数组（最近若干条对话）
 * @returns {string} 压平后的聊天记录文本，用于保存到定时器负载中
 */
function flattenChatLog(chatLog) {
	return chatLog.map(e => `${e.name}: ${e.content}`).join('\n')
}

/**
 * timer 插件的 ReplyHandler：解析 AI 回复中的定时器 XML 指令，并注册活跃频道。
 * @type {ReplyHandler_t} timer 插件的 ReplyHandler
 */
export async function timerReplyHandler(result, args) {
	const { AddLongTimeLog, username, char_id, chat_name, chat_log, Charname } = args
	// 仅注册支持追加消息的频道供定时器回调使用
	if (args.supported_functions?.add_message) registerChannel(username, char_id, args)

	// 尝试从 common_chat_* 格式提取 chatid（非聊天场景下为 undefined）
	const chatid = chat_name?.match(/^common_chat_(.+)$/)?.[1]

	let processed = false

	const toolCallLog = { name: Charname, role: 'char', content: '', files: [] }
	let logAdded = false

	/**
	 * 添加工具调用日志
	 */
	const addToolLog = () => {
		if (!logAdded) {
			AddLongTimeLog(toolCallLog)
			logAdded = true
		}
	}

	// ── <set-timer> ───────────────────────────────────────────────────────────
	for (const match of [...result.content.matchAll(/<set-timer>(?<content>[\S\s]*?)<\/set-timer>/gis)]) {
		if (!match?.groups?.content) continue
		processed = true
		toolCallLog.content += match[0] + '\n'
		addToolLog()

		const timerContent = match.groups.content
		let systemLog = ''
		const itemsToSet = []

		const itemRegex = /<item>([\S\s]*?)<\/item>/gis
		let itemMatch
		while ((itemMatch = itemRegex.exec(timerContent)) !== null) {
			const c = itemMatch[1]
			const time = c.match(/<time>(.*?)<\/time>/is)?.[1]?.trim()
			const trigger = c.match(/<trigger>(.*?)<\/trigger>/is)?.[1]?.trim()
			const reason = c.match(/<reason>(.*?)<\/reason>/is)?.[1]?.trim()
			const repeat = c.match(/<repeat>(.*?)<\/repeat>/is)?.[1]?.trim().toLowerCase() === 'true'

			if (!reason) {
				systemLog += '跳过无效条目：缺少 <reason>。\n'
				console.warn('timer: 解析定时器时出错：缺少 <reason>', c)
				continue
			}
			if (!time && !trigger) {
				systemLog += `跳过"${reason}"：必须提供 <time> 或 <trigger>。\n`
				console.warn('timer: 解析定时器时出错：缺少 <time> 或 <trigger>', c)
				continue
			}
			if (time && trigger) {
				systemLog += `跳过"${reason}"：不能同时提供 <time> 和 <trigger>。\n`
				console.warn('timer: 解析定时器时出错：同时提供了 <time> 和 <trigger>', c)
				continue
			}

			let finalTrigger = trigger
			if (time)
				try {
					const ms = parseDuration(time)
					finalTrigger = repeat
						? `Date.now() - ${Date.now() + ms} % ${ms} <= 1000`
						: `Date.now() >= ${Date.now() + ms}`
				}
				catch (e) {
					systemLog += `跳过"${reason}"：时间解析失败——${e.message}\n`
					console.warn('timer: 解析定时器时间时出错', time, e)
					continue
				}

			itemsToSet.push({ trigger: finalTrigger, reason, repeat })
		}

		const chatLogSnip = flattenChatLog(chat_log.slice(-5))
		let successCount = 0
		for (const item of itemsToSet)
			try {
				const currentTimers = getTimers(username, PLUGIN_PATH)
				let uid = 0
				while (Object.keys(currentTimers).includes(uid.toString())) uid++

				setTimer(username, PLUGIN_PATH, uid.toString(), {
					trigger: item.trigger,
					callbackdata: {
						type: 'timer',
						char_id,
						chatid,
						reason: item.reason,
						trigger: item.trigger,
						chat_log_snip: chatLogSnip,
					},
					repeat: item.repeat,
				})
				console.info('timer: 已设置定时器', { trigger: item.trigger, reason: item.reason, repeat: item.repeat })
				successCount++
			}
			catch (e) {
				systemLog += `设置"${item.reason}"失败：${e.message}\n`
				console.error('timer: 设置定时器失败', e)
			}

		systemLog += `已设置 ${successCount} 个定时器。\n届时将触发新回复，现在你可以继续当前对话。\n`
		AddLongTimeLog({ name: 'timer', role: 'tool', content: systemLog, files: [] })
	}

	// ── <list-timers></list-timers> ───────────────────────────────────────────
	if (result.content.match(/<list-timers>\s*<\/list-timers>/is)) {
		processed = true
		toolCallLog.content += '<list-timers></list-timers>\n'
		addToolLog()

		const charTimers = Object.values(getTimers(username, PLUGIN_PATH))
			.filter(t => t.callbackdata?.char_id === char_id)
		const listText = charTimers.length
			? charTimers.map(t => `- "${t.callbackdata.reason}"：${t.callbackdata.trigger}`).join('\n')
			: '无'
		AddLongTimeLog({ name: 'timer', role: 'tool', content: `当前定时器列表：\n${listText}`, files: [] })
	}

	// ── <remove-timer> ────────────────────────────────────────────────────────
	for (const match of [...result.content.matchAll(/<remove-timer>(?<reasons>[\S\s]*?)<\/remove-timer>/gis)]) {
		if (!match?.groups?.reasons) continue
		processed = true
		toolCallLog.content += match[0] + '\n'
		addToolLog()

		const reasons = match.groups.reasons.trim().split('\n').map(r => r.trim()).filter(Boolean)
		let systemLog = ''
		for (const reason of reasons) {
			const currentTimers = getTimers(username, PLUGIN_PATH)
			const uid = Object.keys(currentTimers).find(k =>
				currentTimers[k]?.callbackdata?.reason === reason &&
				currentTimers[k]?.callbackdata?.char_id === char_id
			)
			if (uid)
				try {
					removeTimer(username, PLUGIN_PATH, uid)
					systemLog += `已删除"${reason}"。\n`
					console.info('timer: 已删除定时器', reason)
				}
				catch (e) {
					systemLog += `删除"${reason}"失败：${e.message}\n`
					console.error('timer: 删除定时器失败', e)
				}
			else
				systemLog += `未找到定时器"${reason}"。\n`
		}
		AddLongTimeLog({ name: 'timer', role: 'tool', content: systemLog, files: [] })
	}

	toolCallLog.content = toolCallLog.content.trim()
	return processed
}
