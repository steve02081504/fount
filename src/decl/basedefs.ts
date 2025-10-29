/**
 * @description 定义了时间戳的类型。
 */
export type timeStamp_t = number;
/**
 * @description 定义了本地化标识符的类型。
 */
export type locale_t = string;
/**
 * @description 定义了角色的类型。
 */
export type role_t = 'user' | 'char' | 'system' | 'world' | 'tool';
/**
 * @description 定义了包含详细信息的对象的类型。
 */
export type info_t = Record<locale_t, {
	/**
	 * @description 名称。
	 */
	name: string;
	/**
	 * @description 头像的 URL。
	 */
	avatar: string;
	/**
	 * @description 纯文本格式的描述。
	 */
	description: string;
	/**
	 * @description Markdown 格式的描述。
	 */
	description_markdown: string;
	/**
	 * @description 版本号。
	 */
	version: string;
	/**
	 * @description 作者。
	 */
	author: string;
	/**
	 * @description 主页的 URL。
	 */
	home_page: string;
	/**
	 * @description 问题页面的 URL。
	 */
	issue_page: string;
	/**
	 * @description 标签数组。
	 */
	tags: string[];
}>
