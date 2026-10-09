/** OpenAI 追加式 SSE 输出，明确标记重新生成的分界。 */

/** 两次生成都退化时的错误码，也是 HTTP 层对外回报的错误码。 */
export const OUTPUT_DEGENERATED_CODE = 'output_degenerated'

/**
 * @param {object} options Transport and localized notices.
 * @param {(data: string) => void} options.write Write an SSE frame.
 * @param {string} options.id Completion id.
 * @param {number} options.created Unix timestamp.
 * @param {string} options.model Model id.
 * @param {string} options.restartMessage Regeneration notice.
 * @param {string} options.failureMessage Repeated degeneration notice.
 * @returns {object} Source callbacks and completion / error methods.
 */
export function createChatCompletionStream({ write, id, created, model, restartMessage, failureMessage }) {
	let lastContent = ''
	let sentRole = false
	/**
	 * @param {object} delta Incremental message fields.
	 * @param {string | null} [finish_reason=null] Completion status.
	 * @returns {void}
	 */
	function chunk(delta, finish_reason = null) {
		write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
	}
	/**
	 * @param {string} content New text.
	 * @returns {void}
	 */
	function append(content) {
		if (!content) return
		const delta = { content }
		if (!sentRole) { delta.role = 'assistant'; sentRole = true }
		chunk(delta)
	}
	return {
		/**
		 * @param {{content: string}} result Cumulative source snapshot.
		 * @returns {void}
		 */
		replyPreviewUpdater(result) {
			append(result.content.slice(lastContent.length))
			lastContent = result.content
		},
		/** @returns {void} Start a new source attempt without retracting prior deltas. */
		onGenerationRestart() {
			append(`\n\n---\n${restartMessage}\n\n`)
			lastContent = ''
		},
		/**
		 * @param {{content: string}} result Final result (nonstream upstream may never preview).
		 * @returns {void}
		 */
		finish(result) {
			append(result.content.slice(lastContent.length))
			chunk({}, 'stop')
			write('data: [DONE]\n\n')
		},
		/**
		 * @param {Error & {code?: string}} error Failed generation, never a successful stop.
		 * @returns {void}
		 */
		fail(error) {
			const degenerated = error.code === OUTPUT_DEGENERATED_CODE
			if (degenerated) append(`\n\n---\n${failureMessage}\n`)
			write(`data: ${JSON.stringify({ error: { message: degenerated ? failureMessage : error.message, type: 'api_error', code: error.code ?? 'generation_failed' } })}\n\n`)
			write('data: [DONE]\n\n')
		},
	}
}
