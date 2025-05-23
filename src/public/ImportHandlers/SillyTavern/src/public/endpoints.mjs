// This file contains wrapper functions for API calls specific to the SillyTavern import handler.

async function handleFetchError(error, url) {
  console.error(`Error fetching ${url}:`, error);
  // Simulate a response object that would indicate an error to the caller
  return {
    ok: false,
    status: 500, // Or another appropriate status code for a network/fetch error
    statusText: error.message || 'Network request failed',
    json: async () => ({ error: { message: error.message || 'Network request failed' } }),
    text: async () => error.message || 'Network request failed',
    arrayBuffer: async () => new ArrayBuffer(0), // Provide a mock ArrayBuffer
  };
}

export async function fetchChubCharacterApi(apiUrl, options) {
  try {
    const response = await fetch(apiUrl, options);
    return response;
  } catch (error) {
    return handleFetchError(error, apiUrl);
  }
}

export async function fetchChubDownload(downloadUrl) {
  try {
    const response = await fetch(downloadUrl);
    return response;
  } catch (error) {
    return handleFetchError(error, downloadUrl);
  }
}

export async function fetchPygmalionApi(apiUrl) {
  try {
    const response = await fetch(apiUrl);
    return response;
  } catch (error) {
    return handleFetchError(error, apiUrl);
  }
}

export async function fetchPygmalionAvatar(avatarUrl) {
  try {
    const response = await fetch(avatarUrl);
    return response;
  } catch (error) {
    return handleFetchError(error, avatarUrl);
  }
}

export async function fetchJannyApi(apiUrl, options) {
  try {
    const response = await fetch(apiUrl, options);
    return response;
  } catch (error) {
    return handleFetchError(error, apiUrl);
  }
}

export async function fetchJannyDownload(downloadUrl) {
  try {
    const response = await fetch(downloadUrl);
    return response;
  } catch (error) {
    return handleFetchError(error, downloadUrl);
  }
}

export async function fetchAiccApi(apiUrl) {
  try {
    const response = await fetch(apiUrl);
    return response;
  } catch (error) {
    return handleFetchError(error, apiUrl);
  }
}

export async function fetchGenericPngDownload(url, options) {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    return handleFetchError(error, url);
  }
}

export async function fetchRisuDownloadApi(apiUrl) {
  try {
    // Note: The original code for Risu within SillyTavern didn't pass specific headers here
    // unlike the dedicated Risu handler. If headers are needed, they should be added.
    const response = await fetch(apiUrl);
    return response;
  } catch (error) {
    return handleFetchError(error, apiUrl);
  }
}

export async function fetchGithubApi(apiUrl, options) {
  try {
    const response = await fetch(apiUrl, options);
    return response;
  } catch (error) {
    return handleFetchError(error, apiUrl);
  }
}

export async function fetchGithubAsset(assetUrl) {
  try {
    const response = await fetch(assetUrl);
    return response;
  } catch (error)
 {
    return handleFetchError(error, assetUrl);
  }
}
