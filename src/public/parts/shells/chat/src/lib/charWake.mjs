/**
 * 【文件】src/public/parts/shells/chat/src/lib/charWake.mjs
 * 【职责】把「追加一条日志条目」与「请求一次角色生成」组合为一次先写后唤醒的调用，供角色/插件便捷使用。
 * 【原理】`AppendChatLogEntry` 纯写入、`RequestCharReply` 纯唤醒，本助手按序调用；任一方法缺失时优雅降级（保持 no-op 语义），
 *   使不支持运行时追加/唤醒的 shell 也能安全调用。
 * 【关联】decl/chatLog.ts（chatReplyRequest_t.AppendChatLogEntry / RequestCharReply）、reply/wakeScheduler.mjs（唤醒实际调度在 shell 内）。
 */

/**
 * 追加日志条目并在可能时请求一次角色生成。先写后唤醒。
 * @param {object} channel chatReplyRequest_t（可缺方法）
 * @param {object} entry chatLogEntry_t 形状
 * @returns {Promise<{ entry: object | undefined, woke: boolean }>} 写入结果与是否已发出唤醒
 */
export async function appendAndWake(channel, entry) {
	const written = typeof channel?.AppendChatLogEntry === 'function'
		? await channel.AppendChatLogEntry(entry)
		: undefined
	let woke = false
	if (typeof channel?.RequestCharReply === 'function') {
		await channel.RequestCharReply()
		woke = true
	}
	return { entry: written, woke }
}
