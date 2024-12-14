import { locale_t, timeStamp_t } from './basedefs.ts';
import { AIsource_t } from './AIsource.ts';
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts';
import { chatReply_t, chatReplyRequest_t } from '../public/shells/chat/decl/chatLog.ts';

import { Client as DiscordClient, GatewayIntentBits as DiscordGatewayIntentBits, Partials as DiscordPartials } from 'npm:discord.js';

export class charState_t {
	InitCount: number;
	StartCount: number;
	LastStart: timeStamp_t;
	memories: {
		extension: {};
	};
}

export class charAPI_t {
	info: Record<locale_t, {
		name: string;
		avatar: string;
		description: string;
		description_markdown: string;
		version: string;
		author: string;
		homepage: string;
		issuepage: string;
		tags: string[];
	}>;
	// calls only on char install, and if fail, all file under this char's folder will be deleted
	Init: (stat: charState_t) => void;
	// calls on every char start, pop a message if fail
	Load: (stat: charState_t) => void;
	// calls on every char unload
	Unload: (reason: string) => void;
	// calls on char uninstall
	Uninstall: (reason: string, from: string) => void;

	// set the source of the AI so that char can use it by `source.Call(prompt)`
	// the type is for extensibility. maybe youll use an API for sfw and an other API for nsfw, idc.
	SetAISource: (source: AIsource_t<any, any>, type: string) => void;
	GetAISource: (type: string) => AIsource_t<any, any>;
	AISourceTypes: { name: string; type: string }[];

	// interface with shell (maybe chat WebUI or cute Live2d or a kill machine, i don't care)
	interfacies: {
		chat: {
			GetGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t>
			GetGroupGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t>
			GetPrompt: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			GetPromptForOther: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			GetReply: (arg: chatReplyRequest_t) => Promise<chatReply_t>
			MessageEdit: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<chatReply_t>
			MessageEditting: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<void>
			MessageDelete: (arg: {
				index: number
				chat_log: chatLogEntry_t[]
				chat_entry: chatLogEntry_t
				extension?: any
			}) => Promise<void>
		},
		discord: {
			Intents?: DiscordGatewayIntentBits[]
			Partials?: DiscordPartials[]
			OnceClientReady: (client: DiscordClient, config: any) => void
		}
	};
}
