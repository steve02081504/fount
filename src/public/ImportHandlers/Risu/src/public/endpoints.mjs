// This file contains wrapper functions for API calls specific to the Risu import handler.

export async function fetchRisuDynamic(url, headers) {
  try {
    const response = await fetch(url, { headers });
    return response;
  } catch (error) {
    console.error('Error in fetchRisuDynamic:', error);
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
}

export async function fetchRisuPng(url) {
  try {
    const response = await fetch(url);
    return response;
  } catch (error) {
    console.error('Error in fetchRisuPng:', error);
    return {
      ok: false,
      status: 500,
      statusText: error.message || 'Network request failed',
      json: async () => ({ error: { message: error.message || 'Network request failed' } }),
      text: async () => error.message || 'Network request failed',
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  }
}

export async function fetchGenericAsset(url) {
  try {
    const response = await fetch(url);
    return response;
  } catch (error) {
    console.error('Error in fetchGenericAsset:', error);
    return {
      ok: false,
      status: 500,
      statusText: error.message || 'Network request failed',
      json: async () => ({ error: { message: error.message || 'Network request failed' } }),
      text: async () => error.message || 'Network request failed',
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  }
}
