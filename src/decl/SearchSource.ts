import { info_t, locale_t } from './basedefs.ts'

/**
 * 搜索结果项
 */
export class SearchResultItem_t {
	/** 标题 */
	title: string
	/** 链接 */
	link: string
	/** 描述 */
	description?: string
	/** 来源 */
	source?: string
	/** 是否为广告 */
	isAd?: boolean
}

/**
 * 搜索结果
 */
export class SearchResults_t {
	/** 搜索结果项列表 */
	results: SearchResultItem_t[]
	/** 查询字符串 */
	query: string
}

/**
 * @class SearchSource_t
 * 定义了搜索数据源的基本结构，用于与不同类型的搜索服务进行交互。
 */
export class SearchSource_t {
	/**
	 * 搜索数据源的文件名。
	 */
	filename: string
	/**
	 * 搜索数据源的类型，例如 'web-search'。
	 */
	type: 'web-search' | string
	/**
	 * 搜索数据源的详细信息。
	 */
	info: info_t<{
		/**
		 * 提供者。
		 */
		provider: string;
	}>
	/**
	 * 指示该搜索数据源是否为付费服务。
	 */
	is_paid: boolean
	/**
	 * 用于存储扩展功能的对象。
	 */
	extension: object

	/**
	 * 卸载搜索数据源并释放资源。
	 * @returns {Promise<void>}
	 */
	Unload?: () => Promise<void>
	/**
	 * 执行搜索。
	 * @param {string} query - 搜索查询字符串。
	 * @param {object} [options] - 搜索选项。
	 * @returns {Promise<SearchResults_t>} - 搜索结果。
	 */
	Search: (query: string, options?: { limit?: number }) => Promise<SearchResults_t>
	/**
	 * 搜索数据源支持的接口。
	 */
	interfaces: {
		/**
		 * 信息接口，用于更新搜索数据源的信息。
		 */
		info?: {
			/**
			 * 更新搜索数据源的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的搜索数据源信息。
			 */
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
	}
}
