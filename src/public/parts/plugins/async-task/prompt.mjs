/**
 * 【文件】src/public/parts/plugins/async-task/prompt.mjs
 * 【职责】async-task 插件的 GetPrompt：注入「统一异步任务」工具说明，并把已完成任务的待注入通知带进本次生成。
 * 【原理】根生成时注册活跃频道（供根级任务完成后主动通知），并从根队列取通知；子代理运行中按本次 runId 取后代通知，避免跨生成串扰。
 *   通知队列与频道注册表在 registry.mjs，所有异步生产者共用。
 * 【数据结构】单段提示 = { text: [{ content, description, important }], additional_chat_log, extension }。
 * 【关联】main.mjs 的 interfaces.chat.GetPrompt；registry.mjs 的频道/通知注册表。
 */
import { ownerFromArgs, registerChannel, takePendingNotifications } from './registry.mjs'

/** 统一异步任务工具说明文本（面向模型；标签语法与 handler.mjs 保持一致）。 */
const ASYNC_TASK_PROMPT = `\
耗时的后台操作会登记为「异步任务」，每个任务有一个统一 id。你可以列出进行中的任务，并等待一个或多个任务完成。

**列出进行中的异步任务：**
<list-async/>
- 可选 \`kind="subagent|js|pwsh|…"\` 只看某一类。

**检视一个运行中的异步任务的最新进展（只读，不等待、不消费）：**
<inspect-async id="任务id"/>
- 子代理返回最近的对话；JS 返回控制台输出的最后一段；shell 返回 stdall 的最后一段。
- 只对**运行中**的任务有效；已结束的任务请查看完成通知，或用 \`<await-async>\` 取回结果。

**等待一个或多个异步任务：**
<await-async ids="id1,id2" mode="all" time-limit="5m"/>
- \`ids\`（必填）：逗号分隔的任务 id。
- \`mode="all"\`（默认）等全部完成；\`mode="any"\` 等任一完成。
- \`time-limit\`（可选）：最长等待时长，如 \`90s\`、\`5m\`；缺省 3 分钟。超时会返回已完成任务的结果与仍在进行的任务 id。
- 被 \`<await-async>\` 等待的任务完成时不会再单独发通知；未被等待的任务完成后会以系统消息通知你。

产生异步任务：\`<run-subagent async="true">\`、\`<run-js async="true">\`、\`<run-<shell> async="true">\`。
`

/**
 * async-task 插件的 GetPrompt。
 * @param {object} args chatReplyRequest 上下文
 * @returns {{ text: object[], additional_chat_log: object[], extension: object }} 单段提示
 */
export function getAsyncTaskPrompt(args) {
	const owner = ownerFromArgs(args)
	if (!owner.parentRunId && args.username && args.char_id)
		registerChannel(args.username, args.char_id, args)
	const additionalChatLog = takePendingNotifications(owner)
	return {
		text: [{ content: ASYNC_TASK_PROMPT, description: 'async-task 插件：统一异步任务 XML API', important: 0 }],
		additional_chat_log: additionalChatLog,
		extension: {},
	}
}
