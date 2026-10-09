/**
 * 公网代理配置错误提示页：fount 停用 Web 服务后把访客送到这里，并允许就地切换语言。
 */
import { initTranslations, getAvailableLocales, getLocaleNames, primaryLocale, setLanguage } from '../scripts/i18n/index.mjs'

await initTranslations('proxy_exposure')
const language = document.getElementById('language')
const names = getLocaleNames()
for (const locale of getAvailableLocales()) {
	const option = document.createElement('option')
	option.value = locale
	option.textContent = names.get(locale) || locale
	language.appendChild(option)
}
language.value = primaryLocale()
language.addEventListener('change', async () => {
	language.disabled = true
	try { await setLanguage([language.value]) }
	finally { language.disabled = false }
})
