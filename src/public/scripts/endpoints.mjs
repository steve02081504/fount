// This file will contain wrapper functions for global non-part-related API calls.

export async function pingServer() {
  try {
    const response = await fetch('/api/ping');
    if (response.ok) {
      const data = await response.json();
      return data.is_local_ip;
    }
    return false;
  } catch (error) {
    console.error('Error pinging server:', error);
    return false;
  }
}

export async function generateVerificationCode() {
  try {
    const response = await fetch('/api/register/generateverificationcode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return response;
  } catch (error) {
    console.error('Error generating verification code:', error);
    // Return a mock response object with an error status to allow the caller to handle it
    return {
      ok: false,
      status: 500, // Internal Server Error
      json: async () => ({ message: 'Failed to fetch due to network or server error' })
    };
  }
}

export async function submitAuthForm(isLogin, username, password, deviceid, verificationcode) {
  const endpoint = isLogin ? '/api/login' : '/api/register';
  const body = isLogin
    ? JSON.stringify({ username, password, deviceid })
    : JSON.stringify({ username, password, deviceid, verificationcode });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });
    return response;
  } catch (error) {
    console.error('Error submitting auth form:', error);
    // Return a mock response object with an error status to allow the caller to handle it
     return {
      ok: false,
      status: 500, // Internal Server Error
      json: async () => ({ message: 'Failed to fetch due to network or server error' })
    };
  }
}
