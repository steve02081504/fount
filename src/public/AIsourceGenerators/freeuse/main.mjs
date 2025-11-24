/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import { MarkovGenerator } from './MarkovGenerator.mjs'

const endToken = '<|endofres|>'

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info: {
		'en-UK': {
			name: 'Freeuse',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'Freeuse',
			description_markdown: 'A very simple Markov chain text generator. It produces nonsensical output.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['free', 'local', 'toy'],
			home_page: ''
		},
		'zh-CN': {
			name: '免费使用',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: '免费使用',
			description_markdown: '一个非常简单的马尔可夫链文本生成器。它会产生无意义的输出。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['免费', '本地', '玩具'],
			home_page: ''
		},
		'ar-SA': {
			name: 'استخدام مجاني',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'استخدام مجاني',
			description_markdown: 'مولد نص سلسلة ماركوف بسيط للغاية. ينتج مخرجات لا معنى لها.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['مجاني', 'محلي', 'لعبة'],
			home_page: ''
		},
		'de-DE': {
			name: 'Kostenlose Nutzung',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'Kostenlose Nutzung',
			description_markdown: 'Ein sehr einfacher Markov-Ketten-Textgenerator. Er erzeugt unsinnige Ausgaben.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['kostenlos', 'lokal', 'spielzeug'],
			home_page: ''
		},
		emoji: {
			name: '🤪🔗',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: '🆓🤪🎲',
			description_markdown: '🤪🔗🎲💬',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['🆓', '🎲', '🤪'],
			home_page: ''
		},
		'es-ES': {
			name: 'Uso gratuito',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'Uso gratuito',
			description_markdown: 'Un generador de texto de cadena de Markov muy simple. Produce resultados sin sentido.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['gratis', 'local', 'juguete'],
			home_page: ''
		},
		'fr-FR': {
			name: 'Utilisation gratuite',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'Utilisation gratuite',
			description_markdown: 'Un générateur de texte à chaîne de Markov très simple. Il produit des résultats absurdes.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['gratuit', 'local', 'jouet'],
			home_page: ''
		},
		'hi-IN': {
			name: 'मुफ्त उपयोग',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'मुफ्त उपयोग',
			description_markdown: 'एक बहुत ही सरल मार्कोव श्रृंखला पाठ जनरेटर। यह निरर्थक आउटपुट उत्पन्न करता है।',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['मुफ्त', 'स्थानीय', 'खिलौना'],
			home_page: ''
		},
		'is-IS': {
			name: 'Frjáls notkun',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'Frjáls notkun',
			description_markdown: 'Mjög einfaldur Markov keðju textagenerator. Hann framleiðir bull úttak.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['ókeypis', 'staðbundið', 'leikfang'],
			home_page: ''
		},
		'it-IT': {
			name: 'Uso gratuito',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'Uso gratuito',
			description_markdown: 'Un generatore di testo a catena di Markov molto semplice. Produce un output senza senso.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['gratuito', 'locale', 'giocattolo'],
			home_page: ''
		},
		'ja-JP': {
			name: '無料',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: '無料',
			description_markdown: '非常に単純なマルコフ連鎖テキスト ジェネレーター。無意味な出力を生成します。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['無料', 'ローカル', 'おもちゃ'],
			home_page: ''
		},
		'ko-KR': {
			name: '무료 사용',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: '무료 사용',
			description_markdown: '매우 간단한 마르코프 체인 텍스트 생성기입니다. 의미 없는 출력을 생성합니다.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['무료', '로컬', '장난감'],
			home_page: ''
		},
		lzh: {
			name: '任用',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: '任用',
			description_markdown: '一甚簡之馬爾可夫鏈文生器。其所出無義。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['任用', '本地', '玩物'],
			home_page: ''
		},
		'nl-NL': {
			name: 'Gratis gebruik',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'Gratis gebruik',
			description_markdown: 'Een zeer eenvoudige Markov-keten tekstgenerator. Het produceert onzinnige uitvoer.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['gratis', 'lokaal', 'speelgoed'],
			home_page: ''
		},
		'pt-PT': {
			name: 'Uso gratuito',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'Uso gratuito',
			description_markdown: 'Um gerador de texto de cadeia de Markov muito simples. Ele produz resultados sem sentido.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['gratuito', 'local', 'brinquedo'],
			home_page: ''
		},
		'ru-RU': {
			name: 'Бесплатное использование',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'Бесплатное использование',
			description_markdown: 'Очень простой генератор текста на основе цепи Маркова. Он производит бессмысленный вывод.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['бесплатно', 'локальный', 'игрушка'],
			home_page: ''
		},
		'uk-UA': {
			name: 'Безкоштовне використання',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'Безкоштовне використання',
			description_markdown: 'Дуже простий генератор тексту на основі ланцюга Маркова. Він видає безглуздий результат.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['безкоштовно', 'локальний', 'іграшка'],
			home_page: ''
		},
		'vi-VN': {
			name: 'Sử dụng miễn phí',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: 'Sử dụng miễn phí',
			description_markdown: 'Một trình tạo văn bản chuỗi Markov rất đơn giản. Nó tạo ra kết quả vô nghĩa.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['miễn phí', 'cục bộ', 'đồ chơi'],
			home_page: ''
		},
		'zh-TW': {
			name: '免費使用',
			avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
			description: '免費使用',
			description_markdown: '一個非常簡單的馬可夫鏈文本產生器。它會產生無意義的輸出。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['免費', '本地', '玩具'],
			home_page: ''
		}
	},
	interfaces: {
		AIsource: {
			/**
			 * 获取此 AI 源的配置模板。
			 * @returns {Promise<object>} 配置模板。
			 */
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'freeuse',
	model: 'claude-3-5-sonnet',
}

/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config) {
	const generator = new MarkovGenerator({
		endToken,
	})
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'en-UK': {
				name: config.name || 'Freeuse',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'Freeuse',
				description_markdown: 'A very simple Markov chain text generator. It produces nonsensical output.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['free', 'local', 'toy'],
				provider: 'freeuse',
				home_page: ''
			},
			'zh-CN': {
				name: config.name || '免费使用',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: '免费使用',
				description_markdown: '一个非常简单的马尔可夫链文本生成器。它会产生无意义的输出。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['免费', '本地', '玩具'],
				provider: 'freeuse',
				home_page: ''
			},
			'ar-SA': {
				name: config.name || 'استخدام مجاني',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'استخدام مجاني',
				description_markdown: 'مولد نص سلسلة ماركوف بسيط للغاية. ينتج مخرجات لا معنى لها.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['مجاني', 'محلي', 'لعبة'],
				provider: 'freeuse',
				home_page: ''
			},
			'de-DE': {
				name: config.name || 'Kostenlose Nutzung',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'Kostenlose Nutzung',
				description_markdown: 'Ein sehr einfacher Markov-Ketten-Textgenerator. Er erzeugt unsinnige Ausgaben.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['kostenlos', 'lokal', 'spielzeug'],
				provider: 'freeuse',
				home_page: ''
			},
			emoji: {
				name: '🤪🔗',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: '🆓🤪🎲',
				description_markdown: '🤪🔗🎲💬',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['🆓', '🎲', '🤪'],
				provider: 'freeuse',
				home_page: ''
			},
			'es-ES': {
				name: config.name || 'Uso gratuito',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'Uso gratuito',
				description_markdown: 'Un generador de texto de cadena de Markov muy simple. Produce resultados sin sentido.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['gratis', 'local', 'juguete'],
				provider: 'freeuse',
				home_page: ''
			},
			'fr-FR': {
				name: config.name || 'Utilisation gratuite',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'Utilisation gratuite',
				description_markdown: 'Un générateur de texte à chaîne de Markov très simple. Il produit des résultats absurdes.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['gratuit', 'local', 'jouet'],
				provider: 'freeuse',
				home_page: ''
			},
			'hi-IN': {
				name: config.name || 'मुफ्त उपयोग',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'मुफ्त उपयोग',
				description_markdown: 'एक बहुत ही सरल मार्कोव श्रृंखला पाठ जनरेटर। यह निरर्थक आउटपुट उत्पन्न करता है।',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['मुफ्त', 'स्थानीय', 'खिलौना'],
				provider: 'freeuse',
				home_page: ''
			},
			'is-IS': {
				name: config.name || 'Frjáls notkun',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'Frjáls notkun',
				description_markdown: 'Mjög einfaldur Markov keðju textagenerator. Hann framleiðir bull úttak.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['ókeypis', 'staðbundið', 'leikfang'],
				provider: 'freeuse',
				home_page: ''
			},
			'it-IT': {
				name: config.name || 'Uso gratuito',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'Uso gratuito',
				description_markdown: 'Un generatore di testo a catena di Markov molto semplice. Produce un output senza senso.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['gratuito', 'locale', 'giocattolo'],
				provider: 'freeuse',
				home_page: ''
			},
			'ja-JP': {
				name: config.name || '無料',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: '無料',
				description_markdown: '非常に単純なマルコフ連鎖テキスト ジェネレーター。無意味な出力を生成します。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['無料', 'ローカル', 'おもちゃ'],
				provider: 'freeuse',
				home_page: ''
			},
			'ko-KR': {
				name: config.name || '무료 사용',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: '무료 사용',
				description_markdown: '매우 간단한 마르코프 체인 텍스트 생성기입니다. 의미 없는 출력을 생성합니다.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['무료', '로컬', '장난감'],
				provider: 'freeuse',
				home_page: ''
			},
			lzh: {
				name: config.name || '任用',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: '任用',
				description_markdown: '一甚簡之馬爾可夫鏈文生器。其所出無義。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['任用', '本地', '玩物'],
				provider: 'freeuse',
				home_page: ''
			},
			'nl-NL': {
				name: config.name || 'Gratis gebruik',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'Gratis gebruik',
				description_markdown: 'Een zeer eenvoudige Markov-keten tekstgenerator. Het produceert onzinnige uitvoer.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['gratis', 'lokaal', 'speelgoed'],
				provider: 'freeuse',
				home_page: ''
			},
			'pt-PT': {
				name: config.name || 'Uso gratuito',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'Uso gratuito',
				description_markdown: 'Um gerador de texto de cadeia de Markov muito simples. Ele produz resultados sem sentido.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['gratuito', 'local', 'brinquedo'],
				provider: 'freeuse',
				home_page: ''
			},
			'ru-RU': {
				name: config.name || 'Бесплатное использование',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'Бесплатное использование',
				description_markdown: 'Очень простой генератор текста на основе цепи Маркова. Он производит бессмысленный вывод.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['бесплатно', 'локальный', 'игрушка'],
				provider: 'freeuse',
				home_page: ''
			},
			'uk-UA': {
				name: config.name || 'Безкоштовне використання',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'Безкоштовне використання',
				description_markdown: 'Дуже простий генератор тексту на основі ланцюга Маркова. Він видає безглуздий результат.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['безкоштовно', 'локальний', 'іграшка'],
				provider: 'freeuse',
				home_page: ''
			},
			'vi-VN': {
				name: config.name || 'Sử dụng miễn phí',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: 'Sử dụng miễn phí',
				description_markdown: 'Một trình tạo văn bản chuỗi Markov rất đơn giản. Nó tạo ra kết quả vô nghĩa.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['miễn phí', 'cục bộ', 'đồ chơi'],
				provider: 'freeuse',
				home_page: ''
			},
			'zh-TW': {
				name: config.name || '免費使用',
				avatar: 'https://api.iconify.design/mdi/robot-happy.svg',
				description: '免費使用',
				description_markdown: '一個非常簡單的馬可夫鏈文本產生器。它會產生無意義的輸出。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['免費', '本地', '玩具'],
				provider: 'freeuse',
				home_page: ''
			}
		},
		is_paid: false,
		extension: {},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			return {
				content: generator.generate({
					prompt,
				}),
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			let prompt = structPromptToSingleNoChatLog(prompt_struct)
			prompt += `\
\n${prompt_struct.chat_log.map(item => `${item.name}: ${item.content}\n${endToken}`).join('\n')}
${prompt_struct.Charname}: `
			return {
				content: generator.generate({
					prompt,
				}),
			}
		},
		tokenizer: {
			/**
			 * 释放分词器。
			 * @returns {number} 0
			 */
			free: () => 0,
			/**
			 * 编码提示。
			 * @param {string} prompt - 要编码的提示。
			 * @returns {string} 编码后的提示。
			 */
			encode: prompt => prompt,
			/**
			 * 解码令牌。
			 * @param {string} tokens - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode: tokens => tokens,
			/**
			 * 解码单个令牌。
			 * @param {string} token - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode_single: token => token,
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌的提示。
			 * @returns {number} 令牌数。
			 */
			get_token_count: prompt => prompt.length
		}
	}

	return result
}
