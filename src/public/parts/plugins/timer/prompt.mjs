/** @typedef {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} chatReplyRequest_t */
/** @typedef {import('../../../../decl/prompt_struct.ts').single_part_prompt_t} single_part_prompt_t */

import { takePendingNotification } from './state.mjs'

const TIMER_PROMPT = `\
你可以设置定时器，在指定时间或条件满足时自动触发一次新回复。

**设置定时器**（每个 <item> 为一条，可以一次设多条）：
<set-timer>
<item>
  <reason>提醒事项或定时器用途（用于识别和删除）</reason>
  <time>3小时</time>
  <!-- 或 <trigger>Date.now() >= 1234567890000</trigger> -->
  <repeat>false</repeat>
</item>
</set-timer>

- <reason>：必填，定时器的唯一说明，用于后续列出或删除。
- <time>：自然语言时长，如 \`30秒\`、\`5分钟\`、\`2小时\`、\`3天\`、\`1周\`、\`2 hours\`、\`3 days\`。
- <trigger>：JS 表达式字符串，每 500ms 求值一次，结果为 truthy 时触发（边沿触发）。
- <repeat>：\`true\` 表示重复触发，\`false\`（默认）表示仅触发一次。
- <time> 和 <trigger> 二选一，不可同时使用。

**查看当前定时器**：
<list-timers></list-timers>

**删除定时器**（每行一个 reason）：
<remove-timer>
定时器说明
</remove-timer>
`

/**
 * timer 插件的 GetPrompt：注入定时器 XML API 说明，并附加任何待触发的定时器通知。
 * @param {chatReplyRequest_t} args 当前角色的聊天上下文与可用插件信息
 * @returns {single_part_prompt_t} 单段 prompt 结构体，包含定时器说明与待注入的系统消息
 */
export function getCharTimerPrompt(args) {
	const chatid = args.chat_name?.match(/^common_chat_(.+)$/)?.[1]
	const notification = chatid ? takePendingNotification(chatid, args.char_id) : null
	return {
		text: [{ content: TIMER_PROMPT, description: 'timer 插件：定时器 XML API', important: 0 }],
		additional_chat_log: notification ? [notification] : [],
		extension: {},
	}
}
