// src/public/shells/telegrambot/src/public/endpoints.mjs
async function fetchDataWithHandling(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const data = await response.json().catch(() => null);
        // Using a generic error message base from telegram_bots.alerts.httpError
        // This assumes geti18n is available globally or passed/imported,
        // which is not the case for this file.
        // For simplicity, we'll throw a generic error.
        // The original file had access to geti18n.
        // Consider making geti18n available here or pass error messages if needed.
        throw new Error(data?.message || `HTTP error! status: ${response.status}`);
    }
    return response.json();
}

export async function getBotList() {
    return fetchDataWithHandling('/api/shells/telegrambot/getbotlist');
}

export async function getBotConfig(botname) {
    return fetchDataWithHandling(`/api/shells/telegrambot/getbotconfig?botname=${encodeURIComponent(botname)}`);
}

export async function setBotConfig(botname, config) {
    return fetchDataWithHandling('/api/shells/telegrambot/setbotconfig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botname, config }),
    });
}

export async function deleteBotConfig(botname) {
    return fetchDataWithHandling('/api/shells/telegrambot/deletebotconfig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botname }),
    });
}

export async function newBotConfig(botname) {
    return fetchDataWithHandling('/api/shells/telegrambot/newbotconfig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botname }),
    });
}

export async function startBot(botname) {
    return fetchDataWithHandling('/api/shells/telegrambot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botname }),
    });
}

export async function stopBot(botname) {
    return fetchDataWithHandling('/api/shells/telegrambot/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botname }),
    });
}

export async function getRunningBotList() {
    return fetchDataWithHandling('/api/shells/telegrambot/getrunningbotlist');
}

export async function getBotConfigTemplate(charname) {
    // Original fetch for this in telegram_bots/index.mjs:
    // const response = await fetch(`/api/shells/telegrambot/getbotConfigTemplate?charname=${charname}`)
    // if (!response.ok) {
    //     const message = await response.text()
    //     throw new Error(`HTTP error! status: ${response.status}, message: ${message}`)
    // }
    // return await response.json()
    // This specific error handling (response.text() for message) is slightly different.
    // We'll use a slightly modified fetch for this one.
    const response = await fetch(`/api/shells/telegrambot/getbotConfigTemplate?charname=${encodeURIComponent(charname)}`);
    if (!response.ok) {
        const message = await response.text(); // Get text for more detailed error
        throw new Error(`HTTP error! status: ${response.status}, message: ${message}`);
    }
    return response.json();
}
