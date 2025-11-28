/**
 * 定义了时间戳的类型。
 */
export type timeStamp_t = number;
/**
 * 定义了本地化标识符的类型。
 */
export type locale_t = string;
/**
 * 定义了角色的类型。
 */
export type role_t = 'user' | 'char' | 'system' | 'world' | 'tool';
/**
 * 定义了包含单个语言详细信息的对象的类型。
 */
export type single_lang_info_t = {
	/**
	 * 名称。
	 */
	name: string;
	/**
	 * 头像的 URL。
	 */
	avatar: string;
	/**
	 * 纯文本格式的描述。
	 */
	description: string;
	/**
	 * Markdown 格式的描述。
	 */
	description_markdown: string;
	/**
	 * 版本号。
	 */
	version: string;
	/**
	 * 作者。
	 */
	author: string;
	/**
	 * 主页的 URL。
	 */
	home_page: string;
	/**
	 * 问题页面的 URL。
	 */
	issue_page: string;
	/**
	 * 标签数组。
	 */
	tags: string[];
}
/**
 * 定义了包含详细信息的对象的类型。
 */
export type info_t<T = Record<locale_t, never>> = Record<locale_t, single_lang_info_t & T>

/**
 * 每一帧的数据包定义
 */
export type StreamPayload<T, slice_t = T, remove_t = T> = {
	/**
	 * 增量更新信息
	 */
	diff: {
		type: 'clear'
		value?: T
	} | {
		type: 'append'
		add: slice_t
	} | {
		type: 'remove'
		remove: remove_t
	}
}

/**
 * 流的控制器定义
 * 使用标准 AsyncGenerator，或者返回一个带 cancel 的对象
 */
export type StreamResponse<T, slice_t = T, remove_t = T> = {
	/**
	 * 这是一个异步可迭代对象，可以使用 for await ... of 循环
	 */
	iterator: AsyncIterable<StreamPayload<T, slice_t, remove_t>>

	/**
	 * 用于中断流
	 */
	cancel: () => void
}
