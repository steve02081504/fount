import { info_t, locale_t } from './basedefs.ts'

/**
 * 语音识别服务源类型定义。
 */

/** 增量识别结果。 */
export class SpeechRecognitionPartial_t {
	/** 当前累计全文（每次回调都是从头开始的完整文本，非增量片段） */
	text!: string
	/** 是否为最终结果片段 */
	isFinal?: boolean
}

/** 一次识别会话的最终结果。 */
export class SpeechRecognitionResult_t {
	/** 最终文本 */
	text!: string
	/** 检测到的语言（若有） */
	language?: string
}

/** 实时喂音频控制面。 */
export class SpeechRecognitionFeedControl_t {
	/**
	 * 推送一帧音频（PCM 或源约定格式）。
	 * @param chunk 音频字节
	 */
	send!: (chunk: Uint8Array) => Promise<void>
	/**
	 * 声明输入结束并等待收尾。
	 */
	end!: () => Promise<void>
}

/** Recognize 选项。 */
export class SpeechRecognitionOptions_t {
	language?: string
	hotwords?: string[]
	signal?: AbortSignal
	/** 实时 / 增量结果回调 */
	onResult?: (partial: SpeechRecognitionPartial_t) => void
	/**
	 * 便捷：一次传入完整音频。与 `feed` 二选一。
	 */
	audio?: { buffer: Uint8Array, mime_type: string, name?: string }
	/**
	 * 实时输入：在回调里 `await send(chunk)`，结束时 `await end()`。与 `audio` 二选一。
	 */
	feed?: (ctl: SpeechRecognitionFeedControl_t) => Promise<void>
}

/**
 * 语音识别数据源接口。
 */
export class SpeechRecognitionSource_t {
	filename!: string
	type!: 'speech-recognition' | string
	info!: info_t<{
		provider: string;
	}>
	is_paid!: boolean
	extension!: object

	Unload?: () => Promise<void>
	/**
	 * 执行识别。`audio` 与 `feed` 二选一；流式源在 `feed`/`send` 时立即上行并经 `onResult` 出字。
	 */
	Recognize!: (options: SpeechRecognitionOptions_t) => Promise<SpeechRecognitionResult_t>
	interfaces!: {
		info?: {
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
	}
}
