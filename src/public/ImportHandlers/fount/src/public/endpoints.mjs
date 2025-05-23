// This file contains wrapper functions for API calls specific to the Fount import handler.

async function handleFetchError(error, url) {
  console.error(`Error fetching ${url}:`, error);
  // Simulate a response object that would indicate an error to the caller
  return {
    ok: false,
    status: 500, // Or another appropriate status code for a network/fetch error
    statusText: error.message || 'Network request failed',
    headers: new Headers(), // Provide a mock Headers object
    json: async () => ({ error: { message: error.message || 'Network request failed' } }),
    text: async () => error.message || 'Network request failed',
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

export async function fetchFountUrlHead(url, options) {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    return handleFetchError(error, url);
  }
}

export async function fetchFountUrlGet(url, options) {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    return handleFetchError(error, url);
  }
}
