/**
 * 在服务源配置区渲染 OAuth 登录按钮。
 * @param {object} args - 配置 UI 参数。
 * @param {object} args.data - 当前 config。
 * @param {{ generatorDisplay: HTMLElement }} args.containers - 容器。
 * @param {{ json?: { getJson: () => object, set: (content: object) => void } }} [args.editors] - 编辑器。
 * @param {string} args.provider - oauth_handler provider id。
 * @param {string} args.sourceName - 服务源文件名。
 * @param {string} [args.serviceSourcePath] - 服务源路径。
 * @param {object} args.cache - 生成器 display cache。
 * @returns {Promise<void>}
 */
export async function renderOauthPanel({ data, containers, editors, provider, sourceName, serviceSourcePath, cache }) {
	const { cancelOAuth, oauthStatus, startOAuth } = await import('/parts/shells:oauth_handler/src/endpoints.mjs')
	const div = containers.generatorDisplay
	const panel = document.createElement('div')
	panel.className = 'flex flex-col gap-2 mb-4'
	const row = document.createElement('div')
	row.className = 'flex gap-2 items-center flex-wrap'
	const status = document.createElement('span')
	const loginBtn = document.createElement('button')
	loginBtn.type = 'button'
	loginBtn.className = 'btn btn-primary btn-sm'
	loginBtn.dataset.i18n = 'serviceSource_manager.common_config_interface.oauth.login'
	const logoutBtn = document.createElement('button')
	logoutBtn.type = 'button'
	logoutBtn.className = 'btn btn-sm'
	logoutBtn.dataset.i18n = 'serviceSource_manager.common_config_interface.oauth.logout'
	const hint = document.createElement('p')
	hint.className = 'text-sm opacity-80'
	row.append(status, loginBtn, logoutBtn)
	panel.append(row, hint)

	/**
	 * 按当前 config.oauth 刷新状态文案。
	 * @returns {void}
	 */
	function paint() {
		const loggedIn = Boolean(data.oauth?.access)
		status.dataset.i18n = loggedIn
			? 'serviceSource_manager.common_config_interface.oauth.loggedIn'
			: 'serviceSource_manager.common_config_interface.oauth.notLoggedIn'
		logoutBtn.disabled = !loggedIn
		if (!hint.dataset.i18n?.includes('deviceCode') && !hint.dataset.i18n?.includes('failed'))
			hint.hidden = true
	}

	loginBtn.addEventListener('click', async () => {
		loginBtn.disabled = true
		try {
			const started = await startOAuth({
				provider,
				sourceName,
				serviceSourcePath,
				enterpriseUrl: data.enterpriseUrl,
			})
			cache.oauthState = started.state
			if (started.mode === 'device') {
				hint.hidden = false
				hint.dataset.uri = started.verificationUri
				hint.dataset.code = started.userCode
				hint.dataset.i18n = 'serviceSource_manager.common_config_interface.oauth.deviceCode'
				window.open(started.verificationUri, '_blank', 'noopener')
			}
			else
				status.dataset.i18n = 'serviceSource_manager.common_config_interface.oauth.waiting'
			while (cache.oauthState === started.state) {
				const snap = await oauthStatus(started.state)
				if (snap.status === 'completed') {
					data.oauth = snap.oauth
					editors?.json?.set({ json: data })
					break
				}
				if (snap.status === 'failed') throw new Error(snap.error)
				await new Promise(resolve => setTimeout(resolve, 1500))
			}
		}
		catch (error) {
			hint.hidden = false
			hint.dataset.message = error.message
			hint.dataset.i18n = 'serviceSource_manager.common_config_interface.oauth.failed'
		}
		finally {
			loginBtn.disabled = false
			paint()
		}
	})

	logoutBtn.addEventListener('click', async () => {
		if (cache.oauthState) await cancelOAuth(cache.oauthState).catch(() => { })
		delete data.oauth
		editors?.json?.set({ json: data })
		paint()
	})

	div.replaceChildren(panel)
	paint()
}
