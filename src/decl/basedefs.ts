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
export type info_t<T=Record<locale_t, never>> = Record<locale_t, single_lang_info_t & T>
