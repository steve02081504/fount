import { info_t, locale_t } from './basedefs.ts'

/**
 * 翻译结果
 */
export class TranslateResult_t {
	/** 翻译后的文本 */
	text: string
	/** 源语言 */
	from?: string
	/** 目标语言 */
	to?: string
}

/**
 * @class TranslateSource_t
 * 定义了翻译数据源的基本结构，用于与不同类型的翻译服务进行交互。
 */
export class TranslateSource_t {
	/**
	 * 翻译数据源的文件名。
	 */
	filename: string
	/**
	 * 翻译数据源的类型，例如 'web-translate'。
	 */
	type: 'web-translate' | string
	/**
	 * 翻译数据源的详细信息。
	 */
	info: info_t<{
		/**
		 * 提供者。
		 */
		provider: string;
	}>
	/**
	 * 指示该翻译数据源是否为付费服务。
	 */
	is_paid: boolean
	/**
	 * 用于存储扩展功能的对象。
	 */
	extension: object

	/**
	 * 卸载翻译数据源并释放资源。
	 * @returns {Promise<void>}
	 */
	Unload?: () => Promise<void>
	/**
	 * 执行翻译。
	 * @param {string} text - 要翻译的文本。
	 * @param {object} [options] - 翻译选项。
	 * @param {string} [options.from] - 源语言代码，'auto' 表示自动检测。
	 * @param {string} [options.to] - 目标语言代码。
	 * @returns {Promise<TranslateResult_t>} - 翻译结果。
	 */
	Translate: (text: string, options?: { from?: string, to?: string }) => Promise<TranslateResult_t>
	/**
	 * 翻译数据源支持的接口。
	 */
	interfaces: {
		/**
		 * 信息接口，用于更新翻译数据源的信息。
		 */
		info?: {
			/**
			 * 更新翻译数据源的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的翻译数据源信息。
			 */
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
	}
}
