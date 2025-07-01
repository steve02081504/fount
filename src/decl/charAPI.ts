import { info_t, locale_t, role_t, timeStamp_t } from './basedefs'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'
import { chatReply_t, chatReplyRequest_t } from '../public/shells/chat/decl/chatLog.ts'

import { Client as DiscordClient, GatewayIntentBits as DiscordGatewayIntentBits, Partials as DiscordPartials } from 'npm:discord.js'
import { Telegraf } from 'npm:telegraf'
import { createSafeDiscordClient } from './discordSafeClient.ts'

export class charState_t {
	init_count: number
	start_count: number
	last_start_time_stamp: timeStamp_t
}

export class charInit_t {
	state: charState_t
	username: string
	charname: string
}

export class CharAPI_t {
	info: info_t
	// calls only on char install, and if fail, all file under this char's folder will be deleted
	Init: (stat: charInit_t) => Promise<void>
	// calls on every char start, pop a message if fail
	Load: (stat: charInit_t) => Promise<void>
	// calls on every char unload
	Unload: (reason: string) => Promise<void>
	// calls on char uninstall
	Uninstall: (reason: string, from: string) => Promise<void>

	// interface with shell (maybe chat WebUI or cute Live2d or a kill machine, i don't care)
	interfaces: {
		info?: {
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		config?: {
			GetData: () => Promise<any>
			SetData: (data: any) => Promise<void>
		},
		chat?: {
			GetGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
			GetGroupGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
			GetPrompt: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			GetPromptForOther: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			GetReply: (arg: chatReplyRequest_t) => Promise<chatReply_t | null>
			GetReplyFrequency?: (arg: chatReplyRequest_t) => Promise<number>
			MessageEdit?: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<chatReply_t>
			MessageEditing?: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<void>
			MessageDelete?: (arg: {
				index: number
				chat_log: chatLogEntry_t[]
				chat_entry: chatLogEntry_t
				extension?: any
			}) => Promise<void>
		},
		discord?: {
			Intents?: DiscordGatewayIntentBits[]
			Partials?: DiscordPartials[]
			OnceClientReady: (client: DiscordClient, config: any) => Promise<void>
			GetBotConfigTemplate: () => Promise<any>
		},
		telegram?: {
			BotSetup?: (bot: Telegraf, config: any) => Promise<void>;
			GetBotConfigTemplate?: () => Promise<any>;
		}
		shellassist?: {
			Assist: (data: {
				username: string
				UserCharname: string
				shelltype: string
				shellhistory: ({
					command: string
					output: string
					error: string
					time: timeStamp_t
				} | {
					role: role_t
					content: string
				})[]
				pwd: string
				command_now: string
				command_output: string
				command_error: string
				rejected_commands: string[]
				chat_scoped_char_memory: {}
			}) => Promise<{
				name: string
				avatar: string
				recommend_command: string
				content: string
				chat_scoped_char_memory: {}
			}>
		}
	}
}

/**
 * Utility function to safely initialize a Discord client with error handling.
 * Should be used by the runtime system when creating and passing Discord clients to characters.
 */
export function initializeDiscordClientSafely(char: CharAPI_t, config: any): DiscordClient | null {
	if (!char.interfaces.discord?.OnceClientReady) {
		return null;
	}

	try {
		const client = new DiscordClient({
			intents: char.interfaces.discord.Intents || [],
			partials: char.interfaces.discord.Partials || [],
		});
		
		// Wrap the client with safe error handling before passing to character
		const safeClient = createSafeDiscordClient(client);
		
		// Call the character's initialization with the safe client
		char.interfaces.discord.OnceClientReady(safeClient, config).catch((error) => {
			console.error(`[CharRuntime] Error in character Discord initialization:`, error);
		});
		
		return safeClient;
	} catch (error) {
		console.error(`[CharRuntime] Failed to initialize Discord client:`, error);
		return null;
	}
}
