import { locale_t, info_t } from './basedefs.ts'
import { TranslateSource_t } from './TranslateSource.ts'

/**
 * @class TranslateSourceGenerator_t
 * 定义了翻译数据源生成器的结构，用于创建和管理翻译数据源。
 */
export class TranslateSourceGenerator_t {
	/**
	 * 翻译数据源生成器的详细信息。
	 */
	info: info_t

	/**
	 * 初始化翻译数据源生成器。
	 * @returns {Promise<void>}
	 */
	Init?: () => Promise<void>
	/**
	 * 加载翻译数据源生成器。
	 * @returns {Promise<void>}
	 */
	Load?: () => Promise<void>
	/**
	 * 卸载翻译数据源生成器。
	 * @returns {Promise<void>}
	 */
	Unload?: () => Promise<void>
	/**
	 * 卸载翻译数据源生成器及其相关资源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: () => Promise<void>

	/**
	 * 翻译数据源生成器支持的接口。
	 */
	interfaces: {
		/**
		 * 信息接口，用于更新翻译数据源生成器的信息。
		 */
		info?: {
			/**
			 * 更新翻译数据源生成器的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的翻译数据源生成器信息。
			 */
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		/**
		 * 配置接口，用于获取和设置配置数据。
		 */
		config?: {
			/**
			 * 获取配置数据。
			 * @returns {Promise<any>} - 配置数据。
			 */
			GetData: () => Promise<any>
			/**
			 * 设置配置数据。
			 * @param {any} data - 要设置的配置数据。
			 * @returns {Promise<void>}
			 */
			SetData: (data: any) => Promise<void>
		},
		/**
		 * 翻译数据源接口，用于与翻译数据源进行交互。
		 */
		serviceGenerator: {
			/**
			 * 获取用于配置界面的 HTML 和 JS 内容。
			 * @returns {Promise<{ html?: string, js?: string }>} - 包含 HTML 和 JS 内容的对象。
			 */
			GetConfigDisplayContent: () => Promise<{ html?: string, js?: string }>
			/**
			 * 获取配置模板。
			 * @returns {Promise<any>} - 配置模板。
			 */
			GetConfigTemplate: () => Promise<any>
			/**
			 * 根据配置获取翻译数据源实例。
			 * @param {any} config - 翻译数据源的配置。
			 * @param {{ username: string, SaveConfig: () => Promise<void> }} args - 包含用户名和保存配置函数的参数。
			 * @returns {Promise<TranslateSource_t>} - 翻译数据源实例。
			 */
			GetSource: (config: any, args: { username: string, SaveConfig: () => Promise<void> }) => Promise<TranslateSource_t>
		}
	}
}
