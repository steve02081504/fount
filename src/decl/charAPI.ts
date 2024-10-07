import { timeStamp_t } from './basedefs.ts';
import { AIsource_t } from './AIsource.ts';
import { prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts';
import { chatLogEntry_t } from '../public/shells/chat/decl/chatLog.ts';
import { WorldAPI_t } from './WorldAPI.ts';
import { UserAPI_t } from './UserAPI.ts';

export class charState_t {
	InitCount: number;
	StartCount: number;
	LastStart: timeStamp_t;
	memorys: {
		extension: {};
	};
}

export class charAPI_t {
	name: string;
	avatar: string;
	description: string;
	description_markdown: string;
	version: string;
	author: string;
	homepage: string;
	tags: string[];
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
	AISourceTypes: string[];

	// interface with shell (maybe chat WebUI or cute Live2d or a kill machine, i don't care)
	interfacies: {
		chat: {
			GetGreetings: (langCode: string, time: timeStamp_t) => { content: string }[]
			GetGroupGreetings: (langCode: string, time: timeStamp_t) => { content: string }[]
			GetPrompt: (prompt_struct: prompt_struct_t) => single_part_prompt_t;
			GetPromptForOther: (prompt_struct: prompt_struct_t) => single_part_prompt_t;
			GetReply: (arg: {
				langCode: string
				time: timeStamp_t
				chat_log: chatLogEntry_t[]
				world: WorldAPI_t
				user: UserAPI_t
				chat_summary: string
				chat_scoped_char_memory: {}
			}) => Promise<{ content: string }>
		}
	};
}
