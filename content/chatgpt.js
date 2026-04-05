// content/chatgpt.js — Content script for ChatGPT (steps 6, 7-receive, 8)
// Injected on: chatgpt.com

console.log('[MultiPage:chatgpt] Content script loaded on', location.href);

// Listen for commands from Background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXECUTE_STEP' || message.type === 'FILL_CODE') {
    handleCommand(message).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      reportError(message.step, err.message);
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function handleCommand(message) {
  switch (message.type) {
    case 'EXECUTE_STEP':
      switch (message.step) {
        case 6: return await step6_loginChatGPT();
        case 8: return await step8_navigateOAuth();
        default: throw new Error(`chatgpt.js does not handle step ${message.step}`);
      }
    case 'FILL_CODE':
      return await step7_fillLoginCode(message.payload);
  }
}

// ============================================================
// Step 6: Login ChatGPT
// ============================================================

async function step6_loginChatGPT() {
  log('Step 6: Looking for login button on ChatGPT...');

  // Get state for email and password
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  const email = state.email;
  const password = state.password || 'mimashisha0.0';

  if (!email) throw new Error('No email found in state. Complete earlier steps first.');

  // Find login button on ChatGPT homepage
  let loginBtn = null;
  try {
    loginBtn = await waitForElementByText(
      'a, button, [role="button"], [role="link"]',
      /log\s*in|sign\s*in|登录/i,
      10000
    );
  } catch {
    try {
      loginBtn = await waitForElement(
        '[data-testid="login-button"], a[href*="auth"], a[href*="login"]',
        5000
      );
    } catch {
      throw new Error('Could not find Login button on ChatGPT. URL: ' + location.href);
    }
  }

  simulateClick(loginBtn);
  log('Step 6: Clicked Login button, waiting for auth page...');
  await sleep(3000);

  // We may be redirected to an auth page (auth0.openai.com etc.)
  // Or the login form may appear on the same page
  // Try to find email input
  let emailInput = null;
  try {
    emailInput = await waitForElement(
      'input[type="email"], input[name="email"], input[name="username"], input[id*="email"], input[placeholder*="email" i]',
      15000
    );
  } catch {
    throw new Error('Could not find email input on login page. URL: ' + location.href);
  }

  fillInput(emailInput, email);
  log(`Step 6: Filled email: ${email}`);

  // Submit email
  await sleep(500);
  const submitBtn1 = document.querySelector('button[type="submit"]')
    || await waitForElementByText('button', /continue|next|submit|继续/i, 5000).catch(() => null);
  if (submitBtn1) {
    simulateClick(submitBtn1);
    log('Step 6: Submitted email');
  }

  await sleep(2000);

  // Check: password field or OTP?
  const passwordInput = document.querySelector('input[type="password"]');
  if (passwordInput) {
    log('Step 6: Password field found, filling password...');
    fillInput(passwordInput, password);

    await sleep(500);
    const submitBtn2 = document.querySelector('button[type="submit"]')
      || await waitForElementByText('button', /continue|log\s*in|submit|sign\s*in|登录/i, 5000).catch(() => null);
    if (submitBtn2) {
      simulateClick(submitBtn2);
      log('Step 6: Submitted password');
    }

    await sleep(3000);

    // Check if we need OTP after password
    const codeInput = document.querySelector(
      'input[name="code"], input[maxlength="6"], input[inputmode="numeric"], input[type="text"][maxlength="6"]'
    );
    if (codeInput) {
      log('Step 6: OTP code input found after password. Waiting for step 7...');
      reportComplete(6, { needsOTP: true });
    } else {
      // Check if we're actually logged in (redirected to chatgpt.com main page)
      log('Step 6: Login appears successful (no OTP needed)');
      reportComplete(6, { needsOTP: false });
    }
  } else {
    // No password field — check for OTP input or "check your email" message
    const codeInput = document.querySelector(
      'input[name="code"], input[maxlength="6"], input[inputmode="numeric"]'
    );
    if (codeInput) {
      log('Step 6: OTP flow detected (no password). Waiting for step 7...');
      reportComplete(6, { needsOTP: true });
    } else {
      // Maybe the page is still loading or transitioning
      log('Step 6: No password or OTP field found. May need email verification. Waiting for step 7...');
      reportComplete(6, { needsOTP: true });
    }
  }
}

// ============================================================
// Step 7 (receiving end): Fill Login Verification Code
// ============================================================

async function step7_fillLoginCode(payload) {
  const { code } = payload;
  if (!code) throw new Error('No verification code provided.');

  log(`Step 7: Filling login verification code: ${code}`);

  // Find code input — single input or multiple single-digit inputs
  let codeInput = null;
  try {
    codeInput = await waitForElement(
      'input[name="code"], input[name="otp"], input[maxlength="6"], input[type="text"][inputmode="numeric"], input[aria-label*="code" i], input[placeholder*="code" i]',
      10000
    );
  } catch {
    // Check for multiple single-digit inputs
    const singleInputs = document.querySelectorAll('input[maxlength="1"]');
    if (singleInputs.length >= 6) {
      log('Step 7: Found single-digit code inputs, filling individually...');
      for (let i = 0; i < 6 && i < singleInputs.length; i++) {
        fillInput(singleInputs[i], code[i]);
        await sleep(100);
      }
      await sleep(1000);

      // Auto-submit may happen; if not, try clicking submit
      const submitBtn = document.querySelector('button[type="submit"]')
        || await waitForElementByText('button', /continue|verify|submit|confirm/i, 3000).catch(() => null);
      if (submitBtn) simulateClick(submitBtn);

      await sleep(3000);
      reportComplete(7);
      return;
    }

    throw new Error('Could not find verification code input on ChatGPT login. URL: ' + location.href);
  }

  fillInput(codeInput, code);

  await sleep(500);
  const submitBtn = document.querySelector('button[type="submit"]')
    || await waitForElementByText('button', /continue|verify|submit|confirm|确认/i, 5000).catch(() => null);
  if (submitBtn) {
    simulateClick(submitBtn);
    log('Step 7: Login verification code submitted');
  }

  await sleep(3000);
  reportComplete(7);
}

// ============================================================
// Step 8: Navigate to OAuth URL
// ============================================================

async function step8_navigateOAuth() {
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  const oauthUrl = state.oauthUrl;
  if (!oauthUrl) throw new Error('No OAuth URL found. Complete step 1 first.');

  log(`Step 8: Navigating to OAuth URL: ${oauthUrl.slice(0, 80)}...`);
  log('Step 8: Waiting for localhost redirect (captured by background)...');

  // Navigate — the webNavigation listener in background will capture localhost redirect
  window.location.href = oauthUrl;

  // Don't reportComplete here — background handles it via webNavigation
}
