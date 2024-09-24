class chatLogEntry_t {
	charName: string;
	avatar: string;
	charID: string;
	timeStamp: timeStamp_t;
	role: string;
	content: string;
	extension: {};
}
type chatLog_t = chatLogEntry_t[];
