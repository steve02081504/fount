/**
 * 聊天回复请求类型别名。
 * @typedef {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} chatReplyRequest_t
 */
/**
 * 单段提示词类型别名。
 * @typedef {import('../../../../decl/prompt_struct.ts').single_part_prompt_t} single_part_prompt_t
 */

import { takePendingNotification } from './state.mjs'

const TIMER_PROMPT = `\
你可以设置定时器，在指定时间或条件满足时自动触发一次新回复。

定时器操作：<set-timer> 设置（可含多个 <item>）；<list-timers/> 列出；<remove-timer> 每行一个 reason 删除。

设置示例：
<set-timer>
<item>
  <reason>提醒事项</reason>
  <time>3小时</time>
</item>
</set-timer>

- <reason> 必填，作为识别与删除用的唯一说明；<time> 为自然语言时长（如 \`30秒\`、\`2 hours\`），或改用 <trigger>JS 条件表达式</trigger>（每 500ms 检查一次，边沿触发），二选一。
- <repeat>true</repeat> 表示重复触发，省略或为 false 时仅触发一次。

查看：<list-timers/>；删除：<remove-timer>提醒事项</remove-timer>（可分行填写多个 reason）。
`

/**
 * timer 插件的 GetPrompt：注入定时器 XML API 说明，并附加任何待触发的定时器通知。
 * @param {chatReplyRequest_t} args 当前角色的聊天上下文与可用插件信息
 * @returns {single_part_prompt_t} 单段 prompt 结构体，包含定时器说明与待注入的系统消息
 */
export function getCharTimerPrompt(args) {
	const groupId = args.chat_name?.match(/^common_chat_(.+)$/)?.[1]
	const notification = groupId ? takePendingNotification(groupId, args.char_id) : null
	return {
		text: [{ content: TIMER_PROMPT, description: 'timer 插件：定时器 XML API', important: 0 }],
		additional_chat_log: notification ? [notification] : [],
		extension: {},
	}
}
