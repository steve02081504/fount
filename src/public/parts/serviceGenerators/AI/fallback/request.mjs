/**
 * 依次尝试来源，保留不可继续回退的输出异常和取消信号。
 * @param {object[]} sources Configured sources.
 * @param {(source: object) => Promise<object>} invoke Source operation.
 * @param {{signal?: AbortSignal}} [options] Generation cancellation.
 * @returns {Promise<object>} First successful source result.
 */
export async function callWithFallback(sources, invoke, options = {}) {
	if (!sources.length) throw new Error('no source selected')
	for (const [index, source] of sources.entries()) {
		options.signal?.throwIfAborted()
		try { return await invoke(source) }
		catch (error) {
			if (options.signal?.aborted || error?.code === 'output_degenerated' || error?.name === 'AbortError') throw error
			if (index === sources.length - 1) throw new Error('all sources failed', { cause: error })
			console.error(error)
		}
	}
}
