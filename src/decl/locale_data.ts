// 此文件由本地化文件自动生成。
// 请勿手动编辑此文件，因为它将被覆盖。
// 此文件为 i18n 键提供类型定义，实现自动补全。

/**
 * 表示所有可能的语言环境数据类型。
 */
export type LocaleData = {
	lang: string
	name: string
	fountConsole: {
		server: {
			start: string
			starting: string
			ready: string
			standingBy: string
			showUrl: {
				https: string
				http: string
			}
			mdns: {
				description: string
				failed: string
				bonjourFailed: string
			}
			localUrl: string
			update: {
				restarting: string
			}
		}
		jobs: {
			restartingJob: string
			preloadingParts: string
		}
		ipc: {
			serverStarted: string
			instanceRunning: string
			runPartLog: string
			invokePartLog: string
			invalidCommand: string
			invalidCommandFormat: string
			unsupportedCommand: string
			processMessageError: string
			sendCommandFailed: string
			socketError: string
			parseResponseFailed: string
			cannotParseResponse: string
			unknownError: string
		}
		partManager: {
			partInited: string
			partLoaded: string
			git: {
				updating: string
				upToDate: string
				localAhead: string
				noUpstream: string
				dirtyWorkingDirectory: string
				diverged: string
				updateFailed: string
			}
		}
		web: {
			requestReceived: string
			frontendFilesChanged: string
		}
		route: {
			setLanguagePreference: string
		}
		auth: {
			accountLockedLog: string
			tokenVerifyError: string
			refreshTokenError: string
			logoutRefreshTokenProcessError: string
			revokeTokenNoJTI: string
		}
		verification: {
			codeGeneratedLog: string
			codeNotifyTitle: string
			codeNotifyBody: string
		}
		tray: {
			title: string
			tooltip: string
			readIconFailed: string
			createTrayFailed: string
			items: {
				open: {
					title: string
					tooltip: string
				}
				github: {
					title: string
					tooltip: string
				}
				discord: {
					title: string
					tooltip: string
				}
				restart: {
					title: string
					tooltip: string
				}
				exit: {
					title: string
					tooltip: string
				}
			}
		}
		discordbot: {
			botStarted: string
		}
		telegrambot: {
			botStarted: string
		}
		path: {
			protocol: {
				description: string
				registerFailed: string
				noUrl: string
			}
			update: {
				skippingFountUpdate: string
				skippingDenoUpgradeDocker: string
			}
			shortcut: {
				desktopShortcutCreated: string
				startMenuShortcutCreated: string
				protocolHandlerRegistered: string
				shortcutNotSupported: string
				osacompileNotFound: string
				lsregisterFailed: string
				createDesktopAppFailed: string
			}
			git: {
				repoNotFound: string
				fetchingAndResetting: string
				localChangesDetected: string
				backupSavedTo: string
				updatingFromRemote: string
				alreadyUpToDate: string
				localBranchAhead: string
				branchesDiverged: string
				notOnBranch: string
				noUpstreamBranch: string
				dirtyWorkingDirectory: string
				notInstalled: string
				notInstalledSkippingPull: string
				repoNotFoundSkippingPull: string
				fetchFailed: string
				installFailedWinget: string
				installFailedManual: string
			}
			deno: {
				missing: string
				isRequired: string
				installingTermux: string
				installFailedFallback: string
				notWorking: string
				upgradeFailed: string
				upgradeFailedTermux: string
				patchMissing: string
				patchUnsupportedArch: string
				patchFailed: string
			}
			install: {
				installingDependencies: string
				packageFailed: string
				browserMissing: string
				untrustedPartsWarning: string
				rootWarning1: string
				rootWarning2: string
			}
			clean: {
				removingCaches: string
				reinstallingDependencies: string
				cleaningDenoCaches: string
				cleaningOldPwshModules: string
			}
			keepalive: {
				initComplete: string
				autoInitDisabled: string
				restartingTooFast: string
				failedToStart: string
				initFailed: string
			}
			remove: {
				removingFount: string
				fountUninstallationComplete: string
				removingFountInstallationDir: string
				fountInstallationDirRemoved: string
				removingFountFromPath: string
				removingProtocolHandler: string
				protocolHandlerRemoved: string
				removeProtocolHandlerFailed: string
				removingFountFromGitSafeDir: string
				removingInstalledSystemPackages: string
				uninstallingDeno: string
				removeDenoFailed: string
				removingFountPwshFromProfile: string
				fountPwshRemovedFromProfile: string
				pwshProfileNotFound: string
				uninstallingFountPwsh: string
				uninstallFountPwshFailed: string
				removingTerminalProfile: string
				terminalProfileRemoved: string
				terminalProfileNotFound: string
				desktopShortcutRemoved: string
				desktopShortcutNotFound: string
				removingStartMenuShortcut: string
				startMenuShortcutRemoved: string
				startMenuShortcutNotFound: string
				removingInstalledPwshModules: string
				moduleRemoved: string
				removeModuleFailed: string
				uninstallingGit: string
				uninstallingChrome: string
				uninstallingWinget: string
				removingBackgroundRunner: string
				removeBackgroundRunnerFailed: string
			}
		}
	}
	installer_wait_screen: {
		title: string
		description: string
		hero: {
			title: string
			description: string
		}
		feature1: {
			title: string
			description: string
		}
		feature2: {
			title: string
			description: string
		}
		feature3: {
			title: string
			description: string
		}
		feature4: {
			title: string
			description: string
		}
		language_selector: {
			button: {
				'aria-label': string
			}
			search: {
				placeholder: string
			}
		}
		theme_selector: {
			title: string
			description: string
			search: {
				placeholder: string
			}
		}
		mini_game: {
			title: string
			description1: string
			description2: string
		}
		data_showcase: {
			title_prefix: string
			title_of: string
			active_users: string
			stars: string
		}
		footer: {
			ready_text: string
			wait_text: string
			open_fount: string
			open_or_install_fount: string
			error_message: string
		}
		error: {
			title: string
			description: string
			connection_failed: string
			description1: string
			description2: string
			close_page: string
		}
	}
	protocolhandler: {
		title: string
		description: string
		processing: string
		shellCommandSent: string
		runPartConfirm: {
			title: string
			message: string
			confirm: string
			cancel: string
		}
		offline_dialog: {
			title: string
			message: string
			buttons: {
				start: string
				retry: string
			}
		}
		fountNotFound: string
		invalidProtocol: string
		insufficientParams: string
		unknownCommand: string
		shellCommandFailed: string
		shellCommandError: string
		unknownError: string
	}
	startPage: {
		title: string
		description: string
	}
	tutorial: {
		title: string
		description: string
		modal: {
			title: string
			instruction: string
			buttons: {
				start: string
				skip: string
			}
		}
		endScreen: {
			title: string
			subtitle: string
			endButton: string
		}
		progressMessages: {
			mouseMove: string
			keyboardPress: string
			mobileTouchMove: string
			mobileClick: string
		}
		achievements: {
			complete_tutorial: {
				name: string
				description: string
				locked_description: string
			}
			skip_tutorial: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			other: {
				title: string
				sub_items: {
					replay: {
						title: string
					}
				}
			}
		}
	}
	auth: {
		title: string
		subtitle: string
		description: string
		usernameLabel: string
		usernameInput: {
			placeholder: string
		}
		passwordLabel: string
		passwordInput: {
			placeholder: string
		}
		confirmPasswordLabel: string
		confirmPasswordInput: {
			placeholder: string
		}
		verificationCodeLabel: string
		verificationCodeInput: {
			placeholder: string
		}
		sendCodeButton: string
		login: {
			title: string
			submitButton: string
			toggleLink: {
				textContent: string
				link: string
			}
		}
		register: {
			title: string
			submitButton: string
			toggleLink: {
				textContent: string
				link: string
			}
		}
		passwordStrength: {
			veryWeak: string
			weak: string
			normal: string
			strong: string
			veryStrong: string
		}
		error: {
			passwordMismatch: string
			loginError: string
			registrationError: string
			verificationCodeError: string
			verificationCodeSent: string
			verificationCodeSendError: string
			verificationCodeRateLimit: string
			lowPasswordStrength: string
			accountAlreadyExists: string
			powNotSolved: string
			powError: string
		}
	}
	login_info: {
		title: string
		description: string
		modal: {
			title: string
			retrieve_error: string
			transfer_error: string
			no_credentials: string
			missing_params: string
			buttons: {
				ignore: string
				retry: string
			}
		}
	}
	home: {
		title: string
		description: string
		sidebarTitle: string
		itemDescription: string
		noDescription: string
		filterInput: {
			placeholder: string
			'aria-label': string
		}
		sfwToggle: string
		partTypeDropdown: {
			button: {
				title: string
			}
			icon: {
				alt: string
			}
		}
		functionMenu: {
			search: {
				placeholder: string
			}
			button: {
				title: string
			}
			icon: {
				alt: string
			}
		}
		emptyList: {
			message: string
		}
		part_pages: {
			default: {
				title: string
				subtitle: string
				card: {
					noTags: string
					version: string
					author: string
					home_page: string
					issue_page: string
					refreshButton: {
						alt: string
						title: string
					}
					defaultCheckbox: {
						title: string
					}
				}
			}
			chars: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			worlds: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			personas: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			plugins: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			ImportHandlers: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			serviceGenerators: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceGenerators/AI': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceGenerators/search': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceGenerators/translate': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			serviceSources: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceSources/AI': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceSources/search': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceSources/translate': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			shells: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
		}
		escapeConfirm: string
		alerts: {
			fetchHomeRegistryFailed: string
		}
		achievements: {
			first_login: {
				name: string
				description: string
				locked_description: string
			}
			sfw_mode_on: {
				name: string
				description: string
				locked_description: string
			}
			sfw_mode_off: {
				name: string
				description: string
				locked_description: string
			}
			open_function_list: {
				name: string
				description: string
				locked_description: string
			}
			set_default_persona: {
				name: string
				description: string
				locked_description: string
			}
		}
		dragAndDrop: {
			dropSuccess: string
			dropError: string
			noHandler: string
		}
		home_common_interfaces: {
			open: {
				title: string
			}
		}
		home_drag_out_generators: {
			generateXFountPart: {
				description: string
			}
		}
	}
	chat: {
		title: string
		description: string
		new: {
			title: string
			description: string
		}
		typingIndicator: {
			isTyping: string
			multipleMembers: string
		}
		sidebar: {
			noSelection: string
			noDescription: string
			world: {
				icon: {
					alt: string
				}
				title: string
			}
			persona: {
				icon: {
					alt: string
				}
				title: string
			}
			charList: {
				icon: {
					alt: string
				}
				title: string
				buttons: {
					addChar: {
						title: string
					}
					addCharIcon: {
						alt: string
					}
				}
			}
			pluginList: {
				icon: {
					alt: string
				}
				title: string
				buttons: {
					addPlugin: {
						title: string
					}
					addPluginIcon: {
						alt: string
					}
				}
			}
		}
		rightSidebar: {
			title: string
		}
		chatArea: {
			title: string
			input: {
				placeholder: string
			}
			menuButton: {
				title: string
			}
			menuButtonIcon: {
				alt: string
			}
			sendButton: {
				title: string
			}
			sendButtonIcon: {
				alt: string
			}
			uploadButton: {
				title: string
			}
			uploadButtonIcon: {
				alt: string
			}
			voiceButton: {
				title: string
			}
			voiceButtonIcon: {
				alt: string
			}
			photoButton: {
				title: string
			}
			photoButtonIcon: {
				alt: string
			}
		}
		messageList: {
			confirmDeleteMessage: string
		}
		voiceRecording: {
			errorAccessingMicrophone: string
		}
		messageView: {
			buttons: {
				edit: {
					title: string
				}
				editIcon: {
					alt: string
				}
				more: {
					title: string
				}
				moreIcon: {
					alt: string
				}
				delete: {
					alt: string
				}
				deleteIcon: {
					alt: string
				}
				downloadHtml: {
					alt: string
				}
				downloadHtmlIcon: {
					alt: string
				}
			}
			dropdown: {
				delete: string
				deleteIcon: {
					alt: string
				}
				copyMarkdown: string
				copyMarkdownIcon: {
					alt: string
				}
				copyText: string
				copyTextIcon: {
					alt: string
				}
				copyHtml: string
				copyHtmlIcon: {
					alt: string
				}
				downloadHtml: string
				downloadHtmlIcon: {
					alt: string
				}
				share: {
					textContent: string
					'1h': string
					'12h': string
					'24h': string
					'72h': string
				}
				shareIcon: {
					alt: string
				}
			}
			share: {
				uploading: string
				success: string
			}
			commonToolCalling: string
			noReplyContent: string
		}
		messageEdit: {
			input: {
				placeholder: string
			}
			buttons: {
				confirm: {
					title: string
				}
				confirmIcon: {
					alt: string
				}
				cancel: {
					title: string
				}
				cancelIcon: {
					alt: string
				}
				upload: {
					title: string
				}
				uploadIcon: {
					alt: string
				}
			}
		}
		messageGenerating: {
			stop: string
			stopIcon: {
				alt: string
			}
		}
		attachment: {
			buttons: {
				download: {
					title: string
				}
				downloadIcon: {
					alt: string
				}
				delete: {
					title: string
				}
				deleteIcon: {
					alt: string
				}
			}
		}
		charCard: {
			frequencyLabel: string
			buttons: {
				removeChar: {
					title: string
				}
				removeCharIcon: {
					alt: string
				}
				forceReply: {
					title: string
				}
				forceReplyIcon: {
					alt: string
				}
			}
		}
		pluginCard: {
			buttons: {
				removePlugin: {
					title: string
				}
				removePluginIcon: {
					alt: string
				}
			}
		}
		achievements: {
			first_chat: {
				name: string
				description: string
				locked_description: string
			}
			multiplayer_chat: {
				name: string
				description: string
				locked_description: string
			}
			photo_chat: {
				name: string
				description: string
				locked_description: string
			}
			code_greeting: {
				name: string
				description: string
				locked_description: string
			}
		}
		dragAndDrop: {
			invalidPartData: string
			charAdded: string
			personaSet: string
			worldSet: string
			pluginAdded: string
			unsupportedPartType: string
			errorAddingPart: string
		}
		home_char_interfaces: {
			main: {
				title: string
			}
		}
		home_function_buttons: {
			viewHistory: {
				title: string
			}
		}
	}
	chat_history: {
		title: string
		pageTitle: string
		description: string
		filterInput: {
			placeholder: string
		}
		sortOptions: {
			time_desc: string
			time_asc: string
		}
		sortBy: {
			'aria-label': string
		}
		selectAll: string
		buttons: {
			reverseSelect: string
			deleteSelected: string
			exportSelected: string
			import: string
		}
		chatItemButtons: {
			continue: string
			copy: string
			export: string
			delete: string
		}
		confirmDeleteChat: string
		confirmDeleteMultiChats: string
		alerts: {
			noChatSelectedForDeletion: string
			noChatSelectedForExport: string
			copyError: string
			deleteError: string
			exportError: string
			dragExportError: string
			importSuccess: string
			importError: string
			invalidImportFile: string
		}
		select_checkbox: {
			'aria-label': string
		}
	}
	easynew: {
		title: string
		description: string
		info: {
			description: string
		}
		cardTitle: string
		templateSelect: {
			label: string
		}
		alerts: {
			success: string
			error: string
		}
		form: {
			partName: {
				label: string
				placeholder: string
			}
			description: {
				label: string
				placeholder: string
			}
			descriptionMarkdown: {
				label: string
				placeholder: string
			}
			imageUpload: {
				label: string
			}
			charDef: {
				heading: string
			}
			personality: {
				label: string
				placeholder: string
			}
			scenario: {
				label: string
				placeholder: string
			}
			mesExample: {
				label: string
				placeholder: string
			}
			firstMessage: {
				label: string
				placeholder: string
			}
			personaDef: {
				heading: string
			}
			personaUserName: {
				label: string
				placeholder: string
			}
			personaAppearance: {
				label: string
				placeholder: string
			}
			personaPersonality: {
				label: string
				placeholder: string
			}
			worldDef: {
				heading: string
			}
			worldPrompt: {
				label: string
				placeholder: string
			}
			worldGreeting: {
				label: string
				placeholder: string
			}
			author: {
				label: string
				placeholder: string
			}
			version: {
				label: string
				placeholder: string
			}
			tags: {
				label: string
				placeholder: string
			}
			homePage: {
				label: string
				placeholder: string
			}
			issuePage: {
				label: string
				placeholder: string
			}
			createButton: string
		}
		achievements: {
			create_part: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			component_related: {
				title: string
				sub_items: {
					quickCreate: {
						title: string
					}
				}
			}
		}
	}
	import: {
		title: string
		description: string
		tabs: {
			fileImport: string
			textImport: string
		}
		dropArea: {
			icon: {
				alt: string
			}
			textContent: string
		}
		textArea: {
			placeholder: string
		}
		buttons: {
			import: string
		}
		fileItem: {
			removeButton: {
				title: string
			}
			removeButtonIcon: {
				alt: string
			}
		}
		alerts: {
			importSuccess: string
			importFailed: string
			unknownError: string
		}
		errors: {
			noFileSelected: string
			fileImportFailed: string
			noTextContent: string
			textImportFailed: string
			handler: string
			error: string
			unknownError: string
		}
		dragAndDrop: {
			fileDropDescription: string
			textDropDescription: string
		}
		home_function_buttons: {
			component_related: {
				title: string
				sub_items: {
					import: {
						title: string
					}
				}
			}
		}
		home_drag_in_handlers: {
			handleTextDrop: {
				description: string
			}
			handleFileDrop: {
				description: string
			}
		}
	}
	export: {
		title: string
		pageTitle: string
		pageSubtitle: string
		description: string
		steps: {
			part: string
			action: string
		}
		labels: {
			part: string
		}
		placeholders: {
			partTypeSelect: string
			partSelect: string
		}
		partSelectDropdown: {
			placeholder: string
		}
		partSearch: {
			placeholder: string
		}
		options: {
			withData: string
			withDataDescription: string
		}
		export: {
			title: string
		}
		editor: {
			disabledIndicator: string
			disabledIndicatorHint: string
		}
		buttons: {
			export: string
			exportWithData: string
			copyShareLink: string
			generateShareLink: string
			generateShareLinkWithData: string
		}
		shareMenu: {
			title: string
			'1h': string
			'12h': string
			'24h': string
			'72h': string
			cancel: string
		}
		litterbox: {
			poweredBy: string
			sponsorLink: string
		}
		errorMessage: {
			icon: {
				alt: string
			}
		}
		alerts: {
			fetchPartTypesFailed: string
			fetchPartsFailed: string
			loadPartDetailsFailed: string
			exportFailed: string
			shareLinkCopied: string
			shareFailed: string
		}
		achievements: {
			share_part: {
				name: string
				description: string
				locked_description: string
			}
		}
		dragAndDrop: {
			downloadPartDescription: string
		}
		home_function_buttons: {
			component_related: {
				title: string
				sub_items: {
					exportPart: {
						title: string
					}
				}
			}
		}
		home_drag_out_generators: {
			generateDownloadUrl: {
				description: string
			}
		}
		home_common_interfaces: {
			main: {
				title: string
			}
		}
	}
	uninstall: {
		title: string
		description: string
		titleWithName: string
		confirmMessage: string
		invalidParamsTitle: string
		infoMessage: {
			icon: {
				alt: string
			}
		}
		buttons: {
			confirm: string
			cancel: string
			back: string
		}
		alerts: {
			success: string
			failed: string
			invalidParams: string
			pathNotFound: string
			httpError: string
		}
		errorMessage: {
			icon: {
				alt: string
			}
		}
		home_common_interfaces: {
			delete: {
				title: string
			}
		}
	}
	userSettings: {
		title: string
		PageTitle: string
		description: string
		userInfo: {
			title: string
			usernameLabel: string
			creationDateLabel: string
			folderSizeLabel: string
			folderPathLabel: string
			copyPathBtn: {
				title: string
			}
			copyPathBtnIcon: {
				alt: string
			}
			copiedAlert: string
		}
		changePassword: {
			title: string
			currentPasswordLabel: string
			newPasswordLabel: string
			confirmNewPasswordLabel: string
			submitButton: string
			errorMismatch: string
			success: string
		}
		renameUser: {
			title: string
			newUsernameLabel: string
			submitButton: string
			confirmMessage: string
			success: string
		}
		userDevices: {
			title: string
			noDevicesFound: string
			deviceInfo: string
			thisDevice: string
			deviceDetails: string
			revokeButton: string
			revokeConfirm: string
			revokeSuccess: string
			refreshButton: {
				title: string
			}
			refreshButtonIcon: {
				alt: string
			}
		}
		apiKeys: {
			title: string
			description: string
			input: {
				placeholder: string
			}
			createButton: string
			noKeysFound: string
			keyDetails: string
			neverUsed: string
			revokeButton: string
			revokeConfirm: string
			revokeSuccess: string
			errorDescriptionRequired: string
			createSuccess: string
			refreshButton: {
				title: string
			}
			refreshButtonIcon: {
				alt: string
			}
		}
		newApiKey: {
			title: string
			warning: string
			closeButton: string
			copyButton: {
				title: string
			}
			copiedAlert: string
		}
		logout: {
			title: string
			description: string
			buttonText: string
			confirmMessage: string
			successMessage: string
		}
		deleteAccount: {
			title: string
			warning: string
			submitButton: string
			confirmMessage1: string
			confirmMessage2: string
			usernameMismatch: string
			success: string
		}
		passwordConfirm: {
			title: string
			message: string
			passwordLabel: string
			confirmButton: string
			cancelButton: string
		}
		apiError: string
		generalError: string
		home_function_buttons: {
			settings: {
				title: string
				sub_items: {
					main: {
						title: string
					}
				}
			}
		}
	}
	subfounts: {
		title: string
		pageTitle: string
		description: string
		hostConnectionCode: {
			title: string
			connectionCodeLabel: string
			passwordLabel: string
			copyButton: string
			regenerateButton: string
			infoMessage: string
			connectionCodeCopied: string
			passwordCopied: string
			regenerateSuccess: string
		}
		connectedSubfounts: {
			title: string
			noSubfountsConnected: string
			table: {
				id: string
				description: string
				deviceId: string
				connectedAt: string
				status: string
				actions: string
				connected: string
				disconnected: string
				save: string
				na: string
			}
			descriptionSaved: string
			descriptionSaveFailed: string
		}
		codeExecution: {
			title: string
			description: string
			selectSubfountLabel: string
			selectSubfountPlaceholder: string
			hostOption: string
			subfountOption: string
			scriptLabel: string
			executeButton: string
			executing: string
			noSubfountSelected: string
			noScriptProvided: string
			executionSuccess: string
			executionFailed: string
		}
		downloadClient: {
			title: string
			description: string
			downloadButton: string
		}
		errors: {
			loadConnectionCodeFailed: string
			regenerateConnectionCodeFailed: string
			generalError: string
		}
		home_function_buttons: {
			in_dev: {
				title: string
				sub_items: {
					subfounts_related: {
						title: string
						sub_items: {
							main: {
								title: string
							}
						}
					}
				}
			}
		}
	}
	languageSettings: {
		title: string
		pageTitle: string
		description: string
		pageDescription: string
		availableLanguages: string
		preferredLanguages: string
		resetButton: string
		saveButton: string
		select: {
			placeholder: string
		}
		search: {
			placeholder: string
		}
		noPreferredLanguages: string
		savedMessage: string
		resetMessage: string
		fetchLocalesFailed: string
		home_function_buttons: {
			settings: {
				title: string
				sub_items: {
					main: {
						title: string
					}
				}
			}
		}
	}
	themeManage: {
		title: string
		description: string
		instruction: string
		search: {
			placeholder: string
			noResult: string
		}
		createButton: string
		preview: {
			editButton: {
				title: string
			}
			editButtonIcon: {
				alt: string
			}
			deleteButton: {
				title: string
			}
			deleteButtonIcon: {
				alt: string
			}
			cloneButton: {
				title: string
			}
			cloneButtonIcon: {
				alt: string
			}
		}
		editor: {
			title: string
			cancelButton: string
			saveApplyButton: string
			themeName: string
			autoPaletteTitle: string
			autoPaletteInstruction: string
			coreColors: string
			baseBackground: string
			variables: string
			borderRadius: string
			borderWidth: string
			advancedCustomization: string
			customCSS: string
			customMjsScript: string
			mjsSyntaxHint: string
			themeIdRequired: string
			newThemeName: string
			deleteConfirm: string
			saved: string
			failedToSave: string
		}
		themes: {
			auto: string
			light: string
			dark: string
			cupcake: string
			bumblebee: string
			emerald: string
			corporate: string
			synthwave: string
			retro: string
			cyberpunk: string
			valentine: string
			halloween: string
			garden: string
			forest: string
			aqua: string
			lofi: string
			pastel: string
			fantasy: string
			wireframe: string
			black: string
			luxury: string
			dracula: string
			cmyk: string
			autumn: string
			business: string
			acid: string
			lemonade: string
			night: string
			coffee: string
			winter: string
			dim: string
			nord: string
			sunset: string
			caramellatte: string
			abyss: string
			silk: string
		}
		achievements: {
			change_theme: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			settings: {
				title: string
				sub_items: {
					switchTheme: {
						title: string
					}
				}
			}
		}
	}
	part_config: {
		title: string
		pageTitle: string
		description: string
		labels: {
			part: string
		}
		placeholders: {
			partTypeSelect: string
			partSelect: string
		}
		editor: {
			title: string
			disabledIndicator: string
			jsonEditor: {
				'aria-label': string
			}
			buttons: {
				save: string
			}
		}
		errorMessage: {
			icon: {
				alt: string
			}
		}
		alerts: {
			fetchPartTypesFailed: string
			fetchPartsFailed: string
			loadEditorFailed: string
			saveConfigFailed: string
			saveConfigSuccess: string
			noPartSelected: string
			unsavedChanges: string
			beforeUnload: string
		}
		home_function_buttons: {
			component_related: {
				title: string
				sub_items: {
					componentConfigLink: {
						title: string
					}
				}
			}
		}
		home_common_interfaces: {
			main: {
				title: string
			}
		}
	}
	serviceSource_manager: {
		title: string
		description: string
		fileList: {
			title: string
			addButton: {
				title: string
			}
		}
		configTitle: string
		subtypeSelect: {
			label: string
			placeholder: string
		}
		generatorSelect: {
			label: string
			placeholder: string
		}
		paths: {
			serviceSource: string
			generator: string
		}
		editor: {
			disabledIndicator: string
		}
		common_config_interface: {
			empty_generator: string
			loadingModels: string
			availableModels: string
			copied: string
			apiKeyRequired: string
			copyModelIdTooltip: string
			loadModelsFailed: string
		}
		prompts: {
			newFileName: string
		}
		buttons: {
			save: string
			delete: string
			setDefault: {
				dataset: {
					tip: string
				}
				'aria-label': string
			}
		}
		confirm: {
			unsavedChanges: string
			deleteFile: string
			unsavedChangesBeforeUnload: string
		}
		alerts: {
			fetchFileListFailed: string
			fetchGeneratorListFailed: string
			fetchDefaultsFailed: string
			fetchFileDataFailed: string
			fetchConfigTemplateFailed: string
			saveFileFailed: string
			deleteFileFailed: string
			addFileFailed: string
			setDefaultFailed: string
			fetchBranchesFailed: string
			noFileSelectedSave: string
			noFileSelectedDelete: string
			noGeneratorSelectedSave: string
			invalidFileName: string
		}
		achievements: {
			set_default_aisource: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			manage: {
				title: string
			}
		}
	}
	discord_bots: {
		title: string
		description: string
		cardTitle: string
		botSelectDropdown: {
			placeholder: string
		}
		botSearch: {
			placeholder: string
		}
		charSelectDropdown: {
			placeholder: string
		}
		charSearch: {
			placeholder: string
		}
		configCard: {
			title: string
			labels: {
				character: string
				apiKey: string
				config: string
			}
			charSelectPlaceholder: string
			apiKeyInput: {
				placeholder: string
			}
			toggleApiKeyButton: {
				'aria-label': string
			}
			toggleApiKeyIcon: {
				alt: string
			}
			buttons: {
				saveConfig: string
				startBot: string
				stopBot: string
			}
		}
		prompts: {
			newBotName: string
		}
		buttons: {
			newBot: string
			deleteBot: string
		}
		alerts: {
			configSaved: string
			botExists: string
			unsavedChanges: string
			httpError: string
			beforeUnload: string
		}
		achievements: {
			start_bot: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			bot_related: {
				title: string
				sub_items: {
					manage: {
						title: string
					}
				}
			}
		}
		home_char_interfaces: {
			configure: {
				title: string
			}
		}
	}
	telegram_bots: {
		title: string
		description: string
		cardTitle: string
		botSelectDropdown: {
			placeholder: string
		}
		botSearch: {
			placeholder: string
		}
		charSelectDropdown: {
			placeholder: string
		}
		charSearch: {
			placeholder: string
		}
		configCard: {
			title: string
			labels: {
				character: string
				botToken: string
				config: string
			}
			charSelectPlaceholder: string
			botTokenInput: {
				placeholder: string
			}
			toggleBotTokenButton: {
				'aria-label': string
			}
			toggleBotTokenIcon: {
				alt: string
			}
			buttons: {
				saveConfig: string
				startBot: string
				stopBot: string
			}
		}
		prompts: {
			newBotName: string
		}
		buttons: {
			newBot: string
			deleteBot: string
		}
		alerts: {
			configSaved: string
			botExists: string
			unsavedChanges: string
			httpError: string
			beforeUnload: string
		}
		achievements: {
			start_bot: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			bot_related: {
				title: string
				sub_items: {
					manage: {
						title: string
					}
				}
			}
		}
		home_char_interfaces: {
			configure: {
				title: string
			}
		}
	}
	browser_integration: {
		title: string
		description: string
		pageHeader: string
		pageDescription: string
		install_script_title: string
		install_script_description: string
		install_button: string
		install_from_url_tip: string
		what_is_manager: string
		manager_explanation: string
		popular_managers: string
		csp_warning: string
		connected_pages_title: string
		fetch_pages_error: string
		page_title: string
		page_url: string
		page_status: string
		status_focused: string
		status_unfocused: string
		copy_button: string
		copied_message: string
		no_pages_connected: {
			title: string
			description: string
		}
		autorun: {
			title: string
			description: string
			form_title: string
			comment_label: string
			url_regex_label: string
			script_label: string
			add_button: string
			list_title: string
			view_script_button: string
			delete_button: string
			confirm_delete: string
			add_success: string
			delete_success: string
			no_scripts: {
				title: string
				description: string
			}
			table: {
				comment: string
				url_regex: string
				created_at: string
			}
			view_script_modal_title: string
			view_script_modal_close_button: string
		}
		error: {
			load_failed: string
			add_failed: string
			delete_failed: string
		}
		achievements: {
			install_script: {
				name: string
				description: string
				locked_description: string
			}
			run_js: {
				name: string
				description: string
				locked_description: string
			}
			star_fount: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			integration_related: {
				title: string
				sub_items: {
					browserIntegrationLink: {
						title: string
					}
				}
			}
		}
	}
	browser_integration_script: {
		update: {
			prompt: string
		}
		csp_warning: string
		hostChange: {
			securityWarningTitle: string
			message: string
			uuidMismatchError: string
			verificationError: string
		}
	}
	terminal_assistant: {
		title: string
		description: string
		initialMessage: string
		initialMessageLink: string
		achievements: {
			invoke_shell_assist: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			integration_related: {
				title: string
				sub_items: {
					terminalAssist: {
						title: string
					}
				}
			}
		}
	}
	deskpet: {
		title: string
		description: string
		launcherCard: {
			title: string
			buttons: {
				start: string
			}
		}
		charSelectDropdown: {
			placeholder: string
		}
		charSearch: {
			placeholder: string
		}
		runningCard: {
			title: string
			noPets: string
			buttons: {
				stop: string
			}
		}
		toasts: {
			started: string
			stopped: string
			start_failed: string
			stop_failed: string
		}
		achievements: {
			start_deskpet: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_char_interfaces: {
			launch: {
				title: string
			}
		}
		home_function_buttons: {
			in_dev: {
				title: string
				sub_items: {
					deskpet_related: {
						title: string
						sub_items: {
							main: {
								title: string
							}
						}
					}
				}
			}
		}
	}
	access: {
		title: string
		description: string
		heading: string
		instruction: {
			sameLAN: string
			accessthis: string
		}
		QRcode: {
			alt: string
		}
		urlInput: {
			'aria-label': string
		}
		copyButton: string
		copied: string
		home_function_buttons: {
			main: {
				title: string
			}
		}
	}
	proxy: {
		title: string
		description: string
		heading: string
		instruction: string
		endpointSectionTitle: string
		endpointInstruction: string
		apiUrlInput: {
			'aria-label': string
		}
		usageExampleTitle: string
		usageExampleInstruction: string
		copyButton: string
		copied: string
		apiKeySectionTitle: string
		apiKey: string
		noApiKey: string
		generateApiKeyButton: string
		copyApiKeyButton: string
		apiKeyCopied: string
		queryStringSectionTitle: string
		queryStringWarning: string
		copyQueryStringUrlButton: string
		home_function_buttons: {
			other: {
				title: string
				sub_items: {
					asProxy: {
						title: string
					}
				}
			}
		}
	}
	ide_integration: {
		description: string
		title: string
		heading: string
		instruction: string
		supportedEditorsTitle: string
		supportedEditorsIntro: string
		supportedEditorsLoading: string
		supportedEditorsError: string
		acpTitle: string
		acpDesc: string
		acpCharLabel: string
		acpCharPlaceholder: string
		charListError: string
		acpScriptLabel: string
		acpConfigPlaceholder: string
		acpConfigSample: string
		acpConfigHint: string
		copyButton: string
		copied: string
		apiKeySectionTitle: string
		apiKeyHint: string
		generateApiKeyButton: string
		apiKeyCopied: string
		apiKeyCreateError: string
		apiKeyInput: {
			'aria-label': string
		}
		home_function_buttons: {
			integration_related: string
			ide_integration_config: {
				title: string
			}
		}
		achievements: {
			first_ide_use: {
				name: string
				description: string
				locked_description: string
			}
		}
	}
	achievements: {
		title: string
		description: string
		pageHeader: string
		pageDescription: string
		unlocked_on: string
		locked: string
		toast_title: string
		error: {
			load_failed: string
		}
		achievements: {
			open_achievements_page: {
				name: string
				description: string
				locked_description: string
			}
			relock_by_clicking: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			main: {
				title: string
			}
		}
	}
	debug_info: {
		title: string
		description: string
		heading: string
		copyButton: string
		versionStatus: {
			title: string
			checking: string
			local: string
			remote: string
			upToDate: string
			outdated: string
			checkFailed: string
		}
		systemInfo: {
			title: string
			failed: string
		}
		connectivity: {
			backend: string
			frontend: string
		}
		loading: string
		checking: string
		failed: string
		copySuccess: string
		copyFailed: string
		home_function_buttons: {
			debug: {
				main: {
					title: string
				}
			}
		}
	}
	badges_maker: {
		title: string
		description: string
		card_title: string
		original_url_label: string
		original_url: {
			placeholder: string
		}
		new_url_label: string
		new_url: {
			placeholder: string
		}
		preview_label: string
		copy_button: string
		copied_text: string
		preview: {
			alt: string
		}
		copy_error: string
		copy_fail_alert: string
	}
	'404': {
		title: string
		description: string
		pageNotFoundText: string
		homepageButton: string
	}
	directoryListing: {
		title: string
		description: string
		indexOf: string
		name: string
		mimeType: string
		size: string
		parentLink: string
	}
	code_block: {
		copy: {
			dataset: {
				tip: string
			}
			'aria-label': string
		}
		copied: {
			dataset: {
				tip: string
			}
		}
		download: {
			dataset: {
				tip: string
			}
			'aria-label': string
		}
		execute: {
			dataset: {
				tip: string
			}
			'aria-label': string
		}
		preview: {
			dataset: {
				tip: string
			}
			'aria-label': string
		}
		copy_failed: string
	}
	pow_captcha: {
		initial: string
		verifying: string
		solved: string
		wasm_disabled: string
		error: string
		errorMessage: string
	}
	breadcrumb: {
		clickToNavigate: string
	}
	zxcvbn: {
		warnings: {
			straightRow: string
			keyPattern: string
			simpleRepeat: string
			extendedRepeat: string
			sequences: string
			recentYears: string
			dates: string
			topTen: string
			topHundred: string
			common: string
			similarToCommon: string
			wordByItself: string
			namesByThemselves: string
			commonNames: string
			userInputs: string
			pwned: string
		}
		suggestions: {
			l33t: string
			reverseWords: string
			allUppercase: string
			capitalization: string
			dates: string
			recentYears: string
			associatedYears: string
			sequences: string
			repeated: string
			longerKeyboardPattern: string
			anotherWord: string
			useWords: string
			noNeed: string
			pwned: string
		}
		timeEstimation: {
			ltSecond: string
			second: string
			seconds: string
			minute: string
			minutes: string
			hour: string
			hours: string
			day: string
			days: string
			month: string
			months: string
			year: string
			years: string
			centuries: string
		}
	}
}
// 用于从嵌套对象生成点表示法键的实用类型。
type Prev = [never, 0, 1, 2, 3, 4, 5, ...0[]]

type Paths<T, D extends number = 5> = [D] extends [never]
	? never
	: T extends object
		? { [K in keyof T]-?: K extends string | number
			? `${K}` | Join<K, Paths<T[K], Prev[D]>>
			: never
		}[keyof T]
		: ''

type Join<K, P> = K extends string | number
	? P extends string | number
		? `${K}${'' extends P ? '' : '.'}${P}`
		: never
	: never

/**
 * 表示语言环境数据所有可能的点表示法键。
 * 这为在 `geti18n` 中使用的键提供自动补全。
 *
 * @example
 * 'home.title'
 * 'login.errors.password_mismatch'
 */
export type LocaleKey = Paths<LocaleData>

/**
 * 将语言环境键映射到其预期参数对象的类型。
 * 如果键不需要参数，则不包含在此类型中。
 */
export type LocaleKeyParams = {
	'achievements.error.load_failed': { message: string | number }
	'achievements.unlocked_on': { date: string | number }
	'badges_maker.copy_error': { error: string | number }
	'breadcrumb.clickToNavigate': { path: string | number }
	'browser_integration.csp_warning': { browser: string | number; link: string | number }
	'browser_integration.error.add_failed': { message: string | number }
	'browser_integration.error.delete_failed': { message: string | number }
	'browser_integration.error.load_failed': { message: string | number }
	'browser_integration_script.hostChange.message': { newHost: string | number; origin: string | number }
	'browser_integration_script.hostChange.uuidMismatchError': { newHost: string | number }
	'browser_integration_script.hostChange.verificationError': { newHost: string | number }
	'chat.dragAndDrop.charAdded': { partName: string | number }
	'chat.dragAndDrop.errorAddingPart': { error: string | number; partName: string | number }
	'chat.dragAndDrop.personaSet': { partName: string | number }
	'chat.dragAndDrop.pluginAdded': { partName: string | number }
	'chat.dragAndDrop.unsupportedPartType': { partType: string | number }
	'chat.dragAndDrop.worldSet': { partName: string | number }
	'chat.messageView.share.success': { provider: string | number; sponsorLink: string | number }
	'chat.typingIndicator.isTyping': { names: string | number }
	'chat_history.confirmDeleteChat': { chars: string | number }
	'chat_history.confirmDeleteMultiChats': { count: string | number }
	'chat_history.select_checkbox.aria-label': { chars: string | number }
	'code_block.copy_failed': { error: string | number }
	'deskpet.toasts.start_failed': { charname: string | number; message: string | number }
	'deskpet.toasts.started': { charname: string | number }
	'deskpet.toasts.stop_failed': { charname: string | number; message: string | number }
	'deskpet.toasts.stopped': { charname: string | number }
	'directoryListing.indexOf': { path: string | number }
	'discord_bots.alerts.botExists': { botname: string | number }
	'easynew.alerts.error': { message: string | number }
	'easynew.alerts.success': { partName: string | number }
	'export.alerts.exportFailed': { message: string | number }
	'export.alerts.loadPartDetailsFailed': { message: string | number }
	'export.alerts.shareFailed': { message: string | number }
	'fountConsole.auth.accountLockedLog': { username: string | number }
	'fountConsole.auth.logoutRefreshTokenProcessError': { error: string | number }
	'fountConsole.auth.refreshTokenError': { error: string | number }
	'fountConsole.auth.tokenVerifyError': { error: string | number }
	'fountConsole.discordbot.botStarted': { botusername: string | number; charname: string | number }
	'fountConsole.ipc.invokePartLog': { invokedata: string | number; partpath: string | number; username: string | number }
	'fountConsole.ipc.parseResponseFailed': { error: string | number }
	'fountConsole.ipc.processMessageError': { error: string | number }
	'fountConsole.ipc.runPartLog': { args: string | number; partpath: string | number; username: string | number }
	'fountConsole.ipc.sendCommandFailed': { error: string | number }
	'fountConsole.ipc.socketError': { error: string | number }
	'fountConsole.jobs.preloadingParts': { count: string | number }
	'fountConsole.jobs.restartingJob': { partpath: string | number; uid: string | number; username: string | number }
	'fountConsole.partManager.git.noUpstream': { currentBranch: string | number }
	'fountConsole.partManager.git.updateFailed': { error: string | number }
	'fountConsole.partManager.partInited': { partpath: string | number }
	'fountConsole.partManager.partLoaded': { partpath: string | number }
	'fountConsole.path.deno.patchUnsupportedArch': { arch: string | number }
	'fountConsole.path.git.backupSavedTo': { path: string | number }
	'fountConsole.path.git.noUpstreamBranch': { branch: string | number }
	'fountConsole.path.install.packageFailed': { package: string | number }
	'fountConsole.path.protocol.registerFailed': { message: string | number }
	'fountConsole.path.remove.moduleRemoved': { module: string | number }
	'fountConsole.path.remove.removeBackgroundRunnerFailed': { message: string | number }
	'fountConsole.path.remove.removeDenoFailed': { message: string | number }
	'fountConsole.path.remove.removeModuleFailed': { message: string | number; module: string | number }
	'fountConsole.path.remove.removeProtocolHandlerFailed': { message: string | number }
	'fountConsole.path.remove.uninstallFountPwshFailed': { message: string | number }
	'fountConsole.path.shortcut.desktopShortcutCreated': { path: string | number }
	'fountConsole.path.shortcut.shortcutNotSupported': { os: string | number }
	'fountConsole.path.shortcut.startMenuShortcutCreated': { path: string | number }
	'fountConsole.route.setLanguagePreference': { preferredLanguages: string | number; username: string | number }
	'fountConsole.server.localUrl': { url: string | number }
	'fountConsole.server.mdns.bonjourFailed': { error: string | number }
	'fountConsole.server.mdns.failed': { error: string | number }
	'fountConsole.server.showUrl.http': { url: string | number }
	'fountConsole.server.showUrl.https': { url: string | number }
	'fountConsole.telegrambot.botStarted': { botusername: string | number; charname: string | number }
	'fountConsole.tray.createTrayFailed': { error: string | number }
	'fountConsole.tray.readIconFailed': { error: string | number }
	'fountConsole.verification.codeGeneratedLog': { code: string | number }
	'fountConsole.verification.codeNotifyBody': { code: string | number }
	'fountConsole.web.frontendFilesChanged': { path: string | number }
	'fountConsole.web.requestReceived': { method: string | number; url: string | number }
	'home.dragAndDrop.dropError': { error: string | number }
	'home.emptyList.message': { discordLink: string | number; newpartLink: string | number }
	'ide_integration.apiKeyCreateError': { message: string | number }
	'ide_integration.supportedEditorsError': { message: string | number }
	'import.alerts.importFailed': { error: string | number }
	'import.errors.fileImportFailed': { message: string | number }
	'import.errors.textImportFailed': { message: string | number }
	'installer_wait_screen.footer.error_message': { error: string | number }
	'login_info.modal.retrieve_error': { error: string | number }
	'login_info.modal.transfer_error': { error: string | number }
	'part_config.alerts.loadEditorFailed': { message: string | number }
	'part_config.alerts.saveConfigFailed': { message: string | number }
	'pow_captcha.errorMessage': { error: string | number }
	'protocolhandler.offline_dialog.message': { hostUrl: string | number }
	'protocolhandler.runPartConfirm.message': { partpath: string | number }
	'protocolhandler.unknownError': { error: string | number }
	'serviceSource_manager.alerts.addFileFailed': { error: string | number }
	'serviceSource_manager.alerts.deleteFileFailed': { error: string | number }
	'serviceSource_manager.alerts.fetchBranchesFailed': { error: string | number }
	'serviceSource_manager.alerts.fetchDefaultsFailed': { error: string | number }
	'serviceSource_manager.alerts.fetchFileDataFailed': { error: string | number }
	'serviceSource_manager.alerts.fetchFileListFailed': { error: string | number }
	'serviceSource_manager.alerts.fetchGeneratorListFailed': { error: string | number }
	'serviceSource_manager.alerts.saveFileFailed': { error: string | number }
	'serviceSource_manager.alerts.setDefaultFailed': { error: string | number }
	'serviceSource_manager.buttons.setDefault.aria-label': { fileName: string | number }
	'serviceSource_manager.common_config_interface.loadModelsFailed': { message: string | number }
	'subfounts.codeExecution.executionFailed': { message: string | number }
	'subfounts.codeExecution.hostOption': { id: string | number }
	'subfounts.codeExecution.subfountOption': { deviceId: string | number; id: string | number }
	'subfounts.connectedSubfounts.descriptionSaveFailed': { message: string | number }
	'subfounts.errors.generalError': { message: string | number }
	'subfounts.errors.loadConnectionCodeFailed': { message: string | number }
	'subfounts.errors.regenerateConnectionCodeFailed': { message: string | number }
	'telegram_bots.alerts.botExists': { botname: string | number }
	'themeManage.editor.deleteConfirm': { id: string | number }
	'themeManage.editor.mjsSyntaxHint': { asyncDocLink: string | number }
	'tutorial.progressMessages.keyboardPress': { keyboardIcon: string | number }
	'tutorial.progressMessages.mobileClick': { phoneIcon: string | number }
	'tutorial.progressMessages.mobileTouchMove': { phoneIcon: string | number }
	'tutorial.progressMessages.mouseMove': { mouseIcon: string | number }
	'uninstall.alerts.failed': { error: string | number }
	'uninstall.alerts.httpError': { status: string | number }
	'uninstall.alerts.success': { name: string | number; type: string | number }
	'uninstall.confirmMessage': { name: string | number; type: string | number }
	'uninstall.titleWithName': { name: string | number; type: string | number }
	'userSettings.apiError': { message: string | number }
	'userSettings.apiKeys.keyDetails': { createdAt: string | number; description: string | number; lastUsed: string | number }
	'userSettings.deleteAccount.confirmMessage2': { username: string | number }
	'userSettings.generalError': { message: string | number }
	'userSettings.renameUser.success': { newUsername: string | number }
	'userSettings.userDevices.deviceDetails': { ipAddress: string | number; lastSeen: string | number; userAgent: string | number }
	'userSettings.userDevices.deviceInfo': { deviceId: string | number }
}

/**
 * 表示所有需要参数的语言环境键的类型。
 */
export type LocaleKeyWithParams = keyof LocaleKeyParams

/**
 * 表示所有不需要参数的语言环境键的类型。
 */
export type LocaleKeyWithoutParams = Exclude<LocaleKey, LocaleKeyWithParams>
