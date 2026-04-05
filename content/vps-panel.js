// content/vps-panel.js — Content script for VPS panel (steps 1, 9)
// Injected on: http://154.26.182.181:8317/*

console.log('[MultiPage:vps-panel] Content script loaded on', location.href);

// Listen for commands from Background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXECUTE_STEP') {
    handleStep(message.step, message.payload).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      reportError(message.step, err.message);
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function handleStep(step, payload) {
  switch (step) {
    case 1: return await step1_getOAuthLink();
    case 9: return await step9_vpsVerify();
    default:
      throw new Error(`vps-panel.js does not handle step ${step}`);
  }
}

// ============================================================
// Step 1: Get OAuth Link
// ============================================================

async function step1_getOAuthLink() {
  log('Step 1: Checking VPS panel state...');

  // --- Selector strategy ---
  // The VPS panel is at management.html#/oauth
  // We need to: 1) find OAuth login section, 2) click Codex login, 3) read auth URL
  // TODO: These selectors MUST be adjusted after inspecting the actual VPS panel DOM
  // The selectors below are best-guess placeholders.

  // Try to find OAuth login button by text content
  log('Step 1: Looking for OAuth login button...');
  let oauthBtn = null;
  try {
    oauthBtn = await waitForElementByText(
      'button, a, [role="button"], .el-button, div[class*="btn"]',
      /oauth|OAuth/i,
      10000
    );
  } catch {
    // Fallback: try common UI framework selectors
    try {
      oauthBtn = await waitForElement('.oauth-login-btn, [data-action="oauth-login"]', 5000);
    } catch {
      throw new Error(
        'Could not find OAuth login button. ' +
        'Please inspect the VPS panel page in DevTools and update the selector in vps-panel.js. ' +
        'URL: ' + location.href
      );
    }
  }

  simulateClick(oauthBtn);
  log('Step 1: Clicked OAuth login, waiting for Codex login option...');
  await sleep(1500);

  // Wait for Codex login option to appear
  let codexBtn = null;
  try {
    codexBtn = await waitForElementByText(
      'button, a, [role="button"], .el-button, div[class*="btn"], span',
      /codex/i,
      10000
    );
  } catch {
    try {
      codexBtn = await waitForElement('[data-action="codex-login"], .codex-login-btn', 5000);
    } catch {
      throw new Error(
        'Could not find Codex login button after clicking OAuth. ' +
        'Check the VPS panel DOM in DevTools. URL: ' + location.href
      );
    }
  }

  simulateClick(codexBtn);
  log('Step 1: Clicked Codex login, waiting for auth URL...');
  await sleep(2000);

  // Extract the auth URL — could be in various elements
  let oauthUrl = null;

  // Strategy 1: Look for an input/textarea with a URL value
  const inputs = document.querySelectorAll('input[readonly], input[type="text"], textarea, code, pre');
  for (const el of inputs) {
    const val = (el.value || el.textContent || '').trim();
    if (val.startsWith('http') && val.length > 30) {
      oauthUrl = val;
      log(`Step 1: Found URL in <${el.tagName}>: ${val.slice(0, 80)}...`);
      break;
    }
  }

  // Strategy 2: Look for any element containing a long URL
  if (!oauthUrl) {
    const allElements = document.querySelectorAll('span, p, div, a, code, pre');
    for (const el of allElements) {
      const text = (el.textContent || '').trim();
      // Match a URL that looks like an OAuth authorization URL
      const urlMatch = text.match(/(https?:\/\/[^\s<>"']{30,})/);
      if (urlMatch) {
        oauthUrl = urlMatch[1];
        log(`Step 1: Found URL in text: ${oauthUrl.slice(0, 80)}...`);
        break;
      }
    }
  }

  // Strategy 3: Check clipboard (if the page auto-copies)
  if (!oauthUrl) {
    try {
      oauthUrl = await navigator.clipboard.readText();
      if (oauthUrl && oauthUrl.startsWith('http') && oauthUrl.length > 30) {
        log(`Step 1: Found URL in clipboard: ${oauthUrl.slice(0, 80)}...`);
      } else {
        oauthUrl = null;
      }
    } catch {
      // Clipboard access may be denied
    }
  }

  if (!oauthUrl) {
    throw new Error(
      'Could not find auth URL. The URL may be displayed in a format we cannot detect. ' +
      'Please check the VPS panel page and copy the URL manually, or update the extraction logic in vps-panel.js. ' +
      'URL: ' + location.href
    );
  }

  log(`Step 1: OAuth URL obtained: ${oauthUrl.slice(0, 80)}...`, 'ok');
  reportComplete(1, { oauthUrl: oauthUrl.trim() });
}

// ============================================================
// Step 9: VPS Verify
// ============================================================

async function step9_vpsVerify() {
  log('Step 9: Getting localhost URL from storage...');

  // Get localhostUrl from storage (via Background)
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  const localhostUrl = state.localhostUrl;
  if (!localhostUrl) {
    throw new Error('No localhost URL found. Complete step 8 first.');
  }

  log(`Step 9: Looking for URL input field on VPS panel...`);

  // Try to find URL input field
  let urlInput = null;
  try {
    urlInput = await waitForElement(
      'input[placeholder*="localhost"], input[placeholder*="callback"], input[placeholder*="URL"], input[placeholder*="url"], input[name*="callback"], input[name*="url"]',
      10000
    );
  } catch {
    // Fallback: find any text input that's visible and empty
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (const input of inputs) {
      if (input.offsetParent !== null && !input.value) {
        urlInput = input;
        log('Step 9: Using fallback empty input field');
        break;
      }
    }
    if (!urlInput) {
      throw new Error(
        'Could not find URL input field on VPS panel. ' +
        'Check DOM structure in DevTools. URL: ' + location.href
      );
    }
  }

  fillInput(urlInput, localhostUrl);
  log(`Step 9: Filled URL input with: ${localhostUrl}`);

  // Find and click verify button
  let verifyBtn = null;
  try {
    verifyBtn = await waitForElementByText(
      'button, [role="button"], .el-button, a',
      /verif|确认|验证|submit|提交/i,
      10000
    );
  } catch {
    throw new Error(
      'Could not find verify/submit button. ' +
      'Check VPS panel DOM in DevTools. URL: ' + location.href
    );
  }

  simulateClick(verifyBtn);
  log('Step 9: Clicked verify button', 'ok');
  reportComplete(9);
}
