/**
 * mention_getreply_agent 捕获的 GetReply 身份字段（模块级单例）。
 */
export const getReplyIdentityProbe = {
	/** @type {object | null} */
	last: null,
	/** 清空探针状态。 */
	reset() {
		this.last = null
	},
}
