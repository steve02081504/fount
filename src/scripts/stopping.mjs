/** 进程级退出状态：收到退出请求后，agent 循环在轮边界停止启动下一轮。 */
let stopping = false

/** 标记进程进入退出流程。 @returns {void} */
export function markStopping() { stopping = true }

/** @returns {boolean} 是否正在退出。 */
export function isStopping() { return stopping }
