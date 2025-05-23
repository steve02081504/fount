// src/public/shells/discordbot/src/public/endpoints.mjs
async function fetchDataWithHandling(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const data = await response.json().catch(() => null);
        // Using a generic error message base, specific error can be added by caller
        throw new Error(data?.message || `HTTP error! status: ${response.status}`);
    }
    return response.json();
}

export async function getBotList() {
    return fetchDataWithHandling('/api/shells/discordbot/getbotlist');
}

export async function getBotConfig(botname) {
    return fetchDataWithHandling(`/api/shells/discordbot/getbotconfig?botname=${encodeURIComponent(botname)}`);
}

export async function setBotConfig(botname, config) {
    return fetchDataWithHandling('/api/shells/discordbot/setbotconfig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botname, config }),
    });
}

export async function deleteBotConfig(botname) {
    return fetchDataWithHandling('/api/shells/discordbot/deletebotconfig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botname }),
    });
}

export async function newBotConfig(botname) {
    return fetchDataWithHandling('/api/shells/discordbot/newbotconfig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botname }),
    });
}

export async function startBot(botname) {
    return fetchDataWithHandling('/api/shells/discordbot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botname }),
    });
}

export async function stopBot(botname) {
    return fetchDataWithHandling('/api/shells/discordbot/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botname }),
    });
}

export async function getRunningBotList() {
    return fetchDataWithHandling('/api/shells/discordbot/getrunningbotlist');
}

export async function getBotConfigTemplate(charname) {
    // This one had slightly different error handling in the original,
    // returning null on error. We can adapt or keep it consistent.
    // For now, using fetchDataWithHandling for consistency.
    // The caller might need to adjust if null was specifically expected.
    return fetchDataWithHandling(`/api/shells/discordbot/getbotConfigTemplate?charname=${encodeURIComponent(charname)}`);
}
