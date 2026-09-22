/**
 * 【文件】src/public/parts/plugins/sub-agent/prompt.mjs
 * 【职责】sub-agent 插件的 GetPrompt：注入子代理工具说明，并在子代理运行中注入「Round/Elapsed」预算条目，同时把待注入的异步完成通知带进父代生成。
 * 【原理】父代普通生成时注册活跃频道（供异步通知回投），并从根队列取通知；子代理运行中则按本次 runId 取后代完成通知，避免跨生成串扰。
 *   轮次预算采用「追加一条 system additional_chat_log」的方式注入（已文档化、不改写生成结果），而不是改写 `plugin_prompts['sub-agent'].text`。
 *   频道/通知队列由通用 `plugins/async-task/registry.mjs` 持有；async-task 插件的 GetPrompt 亦会取走同一队列，先到先得、不会重复注入。
 * 【数据结构】单段提示 = { text: [{ content, description, important }], additional_chat_log, extension }。
 * 【关联】main.mjs 的 interfaces.chat.GetPrompt；state.mjs 的运行注册表；async-task/registry.mjs。
 */
import { ownerFromArgs, registerChannel, takePendingNotifications } from '../async-task/registry.mjs'

import { getRun } from './state.mjs'

/** 子代理工具说明文本（面向模型；标签语法与 handler.mjs 保持一致）。 */
const SUB_AGENT_PROMPT = `\
你可以派生「子代理」来隔离上下文、并行完成复杂任务。子代理复用你的人格与世界设定，但拥有独立对话与独立预算（工作目录/文件系统与父代共享）。

**创建批次（可选，用于多个子代理共享同一段背景上下文）：**
<create-subagent-batch plugins="code-execution,file-operations" round-limit="16" time-limit="10m" ai-source="某AI源名">
这里是该批次所有子代理都能看到的共享背景文本。
</create-subagent-batch>
- 批次体内为共享上下文；属性为该批次的默认值，可被单次 \`run-subagent\` 覆盖。

**派生子代理：**
<run-subagent plugins="code-execution,file-operations" round-limit="12" time-limit="5m" ai-source="某AI源名" async="true" batch="批次id">
这里是要交给子代理的任务描述。
</run-subagent>
- \`plugins\`：子代理可用的插件，逗号分隔。**该列表完全替换默认列表**（默认：code-execution、file-operations、sub-agent、context-compress、async-task），不会与你的插件合并；\`sub-agent\` 与 \`async-task\` 永远会被强制加入。\`fount_chat\` 永远不会被加载。
- \`round-limit\`（必填，除非批次已提供）：子代理最多生成几轮。
- \`time-limit\`（必填，除非批次已提供）：子代理最多运行多久，如 \`90s\`、\`5m\`、\`1h\`。
- \`ai-source\`（可选）：指定 AI 源名；缺省继承你的 AI 源，再缺省用默认 AI 源。
- \`async="true"\`（可选）：异步运行，立即返回 backgroundId；它同时会登记为一个统一异步任务，可用 \`<await-async>\` 等待或 \`<list-async>\` 查看，未被等待时完成后以系统消息通知你。
- \`batch="id"\`（可选）：加入某批次，沿用其共享上下文与默认值。
- 同步调用会直接返回子代理的最终结果文本。

**列出可用 AI 源：**
<list-ai-sources/>

**查看某个子代理最近的对话：**
<check-subagent id="runId 或 backgroundId"/>

**终止某个子代理（软取消：在当前工具调用结束后、下一轮开始前生效并进入摘要）：**
<terminate-subagent id="runId 或 backgroundId"/>

约束：
- 子代理的父代聊天档案会写入一个临时 JSON 文件，其路径在子代理开场上下文中给出；需要父代细节时让它自己用文件工具检索。
- 子代理若加载了 code-execution，会拥有**独立的新 workspace**（不继承父代变量）与**它自己的 chat_log**。
- 调用\`<run-subagent>\`时必须给出\`round-limit\`与\`time-limit\`（或先建立带默认值的批次），否则会被拒绝。
`

/**
 * 计算运行预算文本。
 * @param {object} run 运行
 * @param {number} [now] 当前时间
 * @returns {string} 形如 `Round: 2/12 | Elapsed: 15s/300s`
 */
export function formatRoundBudget(run, now = Date.now()) {
	const rounds = run.rounds ?? 0
	const roundLimit = run.roundLimit ?? '∞'
	const elapsed = Math.max(0, Math.round((now - (run.startedAt ?? run.createdAt ?? now)) / 1000))
	const total = run.timeLimitMs != null ? Math.round(run.timeLimitMs / 1000) : '∞'
	return `Round: ${rounds}/${roundLimit} | Elapsed: ${elapsed}s/${total}s`
}

/**
 * 构造子代理运行中的预算系统条目。
 * @param {object} run 运行
 * @param {number} [now] 当前时间
 * @returns {object} chatLogEntry 形状的系统条目
 */
export function makeRoundBudgetEntry(run, now = Date.now()) {
	return {
		name: 'system',
		uid: 'system',
		role: 'system',
		content: `[sub-agent ${run.runId}] ${formatRoundBudget(run, now)}`,
		files: [],
	}
}

/**
 * sub-agent 插件的 GetPrompt。
 * @param {object} args chatReplyRequest 上下文
 * @returns {{ text: object[], additional_chat_log: object[], extension: object }} 单段提示
 */
export function getSubAgentPrompt(args) {
	const owner = ownerFromArgs(args)
	const parentRunId = owner.parentRunId
	const additionalChatLog = []

	if (parentRunId) {
		const run = getRun(parentRunId)
		if (run) additionalChatLog.push(makeRoundBudgetEntry(run))
	}
	else if (args.username && args.char_id)
		registerChannel(args.username, args.char_id, args)

	additionalChatLog.push(...takePendingNotifications(owner))

	return {
		text: [{ content: SUB_AGENT_PROMPT, description: 'sub-agent 插件：子代理 XML API', important: 0 }],
		additional_chat_log: additionalChatLog,
		extension: {},
	}
}
