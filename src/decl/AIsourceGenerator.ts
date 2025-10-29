import { AIsource_t } from './AIsource.ts'
import { locale_t, info_t } from './basedefs.ts'

/**
 * @class AIsourceGenerator_t
 * @description 定义了 AI 数据源生成器的结构，用于创建和管理 AI 数据源。
 */
export class AIsourceGenerator_t {
	/**
	 * @description AI 数据源生成器的详细信息。
	 */
	info: info_t

	/**
	 * @description 初始化 AI 数据源生成器。
	 * @returns {Promise<void>}
	 */
	Init?: () => Promise<void>
	/**
	 * @description 加载 AI 数据源生成器。
	 * @returns {Promise<void>}
	 */
	Load?: () => Promise<void>
	/**
	 * @description 卸载 AI 数据源生成器。
	 * @returns {Promise<void>}
	 */
	Unload?: () => Promise<void>
	/**
	 * @description 卸载 AI 数据源生成器及其相关资源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: () => Promise<void>

	/**
	 * @description AI 数据源生成器支持的接口。
	 */
	interfaces: {
		/**
		 * @description 信息接口，用于更新 AI 数据源生成器的信息。
		 */
		info?: {
			/**
			 * @description 更新 AI 数据源生成器的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的 AI 数据源生成器信息。
			 */
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		/**
		 * @description 配置接口，用于获取和设置配置数据。
		 */
		config?: {
			/**
			 * @description 获取配置数据。
			 * @returns {Promise<any>} - 配置数据。
			 */
			GetData: () => Promise<any>
			/**
			 * @description 设置配置数据。
			 * @param {any} data - 要设置的配置数据。
			 * @returns {Promise<void>}
			 */
			SetData: (data: any) => Promise<void>
		},
		/**
		 * @description AI 数据源接口，用于与 AI 数据源进行交互。
		 */
		AIsource: {
			/**
			 * @description 获取用于配置界面的 HTML 和 JS 内容。
			 * @returns {Promise<{ html?: string, js?: string }>} - 包含 HTML 和 JS 内容的对​​象。
			 */
			GetConfigDisplayContent: () => Promise<{ html?: string, js?: string }>
			/**
			 * @description 获取配置模板。
			 * @returns {Promise<any>} - 配置模板。
			 */
			GetConfigTemplate: () => Promise<any>
			/**
			 * @description 根据配置获取 AI 数据源实例。
			 * @param {any} config - AI 数据源的配置。
			 * @param {{ username: string, SaveConfig: () => Promise<void> }} args - 包含用户名和保存配置函数的参数。
			 * @returns {Promise<AIsource_t<any, any>>} - AI 数据源实例。
			 */
			GetSource: (config: any, args: { username: string, SaveConfig: () => Promise<void> }) => Promise<AIsource_t<any, any>>
		}
	}
}
