// content/qq-mail.js — Content script for QQ Mail (steps 4, 7)
// Injected on: mail.qq.com, wx.mail.qq.com
// NOTE: all_frames: true — this script runs in every frame on QQ Mail

const QQ_MAIL_PREFIX = '[MultiPage:qq-mail]';
const isNewVersion = location.hostname === 'wx.mail.qq.com';
const isTopFrame = window === window.top;

console.log(QQ_MAIL_PREFIX, 'Content script loaded on', location.href, 'frame:', isTopFrame ? 'top' : 'child');

// For old QQ Mail with iframes, only report ready from the top frame
// to avoid duplicate registrations. The inbox frame will handle email ops.
if (!isTopFrame && isNewVersion) {
  console.log(QQ_MAIL_PREFIX, 'Skipping non-top frame on new QQ Mail');
  // Don't do anything in child frames of new version
}

// ============================================================
// Frame detection
// ============================================================

function isInboxFrame() {
  if (isNewVersion) return isTopFrame;
  // Old version: check if this frame has email list elements
  return !!document.querySelector(
    '#mailList, .mail-list, [id*="mailList"], #frm_main, .toarea, .mailList'
  );
}

// ============================================================
// Login State Check
// ============================================================

function checkLoginState() {
  if (isNewVersion) {
    // wx.mail.qq.com: look for compose button or folder list
    return !!(
      document.querySelector('[class*="folder"], [class*="compose"], [class*="sidebar"]') ||
      document.querySelector('nav, [role="navigation"]') ||
      document.querySelector('[class*="mail-list"], [class*="mailList"]')
    );
  } else {
    // mail.qq.com: look for known logged-in elements
    return !!(
      document.querySelector('#folder_1, .folder_inbox, #composebtn, #mainFrameContainer')
    );
  }
}

// ============================================================
// Message Handler
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'POLL_EMAIL') {
    // For old QQ Mail, only handle in the inbox frame
    if (!isNewVersion && !isInboxFrame()) {
      sendResponse({ ok: false, reason: 'wrong-frame' });
      return;
    }

    handlePollEmail(message.step, message.payload).then(result => {
      sendResponse(result);
    }).catch(err => {
      reportError(message.step, err.message);
      sendResponse({ error: err.message });
    });
    return true; // async response
  }

  if (message.type === 'CHECK_LOGIN') {
    if (!isTopFrame) {
      sendResponse({ loggedIn: false });
      return;
    }
    sendResponse({ loggedIn: checkLoginState() });
    return;
  }
});

// ============================================================
// Email Polling
// ============================================================

async function handlePollEmail(step, payload) {
  const { filterAfterTimestamp, senderFilters, subjectFilters, maxAttempts, intervalMs } = payload;

  // Check login state first
  if (isTopFrame && !checkLoginState()) {
    throw new Error('QQ Mail not logged in. Please log in to QQ Mail and retry.');
  }

  log(`Step ${step}: Starting email poll (max ${maxAttempts} attempts, every ${intervalMs / 1000}s)`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Polling QQ Mail... attempt ${attempt}/${maxAttempts}`);

    // Try to refresh inbox
    await refreshInbox();
    await sleep(800); // Wait for refresh to take effect

    // Search for matching email
    const result = await findMatchingEmail(senderFilters, subjectFilters);

    if (result) {
      log(`Step ${step}: Found matching email! Extracting code...`);
      const code = extractVerificationCode(result.content);
      if (code) {
        log(`Step ${step}: Verification code found: ${code}`, 'ok');
        return { ok: true, code, emailTimestamp: Date.now() };
      } else {
        log(`Step ${step}: Email found but no 6-digit code in content. Preview: ${result.content.slice(0, 100)}`, 'warn');
      }
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `No matching email found after ${(maxAttempts * intervalMs / 1000).toFixed(0)}s. ` +
    'Check QQ Mail manually. Email may be in spam folder.'
  );
}

// ============================================================
// Inbox Refresh
// ============================================================

async function refreshInbox() {
  if (isNewVersion) {
    // wx.mail.qq.com: try multiple refresh selectors
    const refreshBtn = document.querySelector(
      '[class*="refresh"], [title*="刷新"], button[aria-label*="refresh"], ' +
      '[data-action="refresh"], .toolbar-refresh'
    );
    if (refreshBtn) {
      simulateClick(refreshBtn);
      console.log(QQ_MAIL_PREFIX, 'Clicked refresh button (new version)');
    } else {
      // Fallback: click on "Inbox" folder to force reload
      const inboxLink = document.querySelector(
        '[class*="inbox"], [title*="收件箱"], a[href*="inbox"]'
      );
      if (inboxLink) {
        simulateClick(inboxLink);
        console.log(QQ_MAIL_PREFIX, 'Clicked inbox link to refresh');
      }
    }
  } else {
    // mail.qq.com: old version
    const refreshBtn = document.querySelector(
      '#refresh, .refresh_btn, [id*="refresh"], a[title*="刷新"]'
    );
    if (refreshBtn) {
      simulateClick(refreshBtn);
      console.log(QQ_MAIL_PREFIX, 'Clicked refresh button (old version)');
    }
  }
}

// ============================================================
// Find Matching Email
// ============================================================

async function findMatchingEmail(senderFilters, subjectFilters) {
  let emailItems;

  if (isNewVersion) {
    // wx.mail.qq.com: email list items
    emailItems = document.querySelectorAll(
      '[class*="mail-item"], [class*="list-item"], [class*="mail_item"], ' +
      'tr[class*="mail"], div[class*="letter"], [class*="thread"]'
    );
  } else {
    // mail.qq.com: email list inside table
    emailItems = document.querySelectorAll(
      '.toarea tr, #mailList tr, .mail_list tr, [id*="mail_"] tr'
    );
  }

  console.log(QQ_MAIL_PREFIX, `Found ${emailItems.length} email items to scan`);

  for (const item of emailItems) {
    const text = (item.textContent || '').toLowerCase();

    const senderMatch = senderFilters.some(f => text.includes(f.toLowerCase()));
    const subjectMatch = subjectFilters.some(f => text.includes(f.toLowerCase()));

    if (senderMatch || subjectMatch) {
      console.log(QQ_MAIL_PREFIX, 'Found matching email item:', text.slice(0, 100));

      // Try to get content from the visible text first
      let content = item.textContent || '';

      // Check if we can already extract a code from the preview
      if (extractVerificationCode(content)) {
        return { content };
      }

      // Need to click into the email for full body
      log('Clicking email to read full content...');
      simulateClick(item);
      await sleep(1500);

      // Read email body
      const bodyEl = document.querySelector(
        '[class*="mail-body"], [class*="mail_body"], [class*="letter-body"], ' +
        '.body_content, #contentDiv, [class*="read-content"], [class*="mail-detail"]'
      );

      if (bodyEl) {
        content = bodyEl.textContent || bodyEl.innerText || '';
        console.log(QQ_MAIL_PREFIX, 'Email body content:', content.slice(0, 200));
      }

      // Go back to inbox after reading
      await goBackToInbox();

      return { content };
    }
  }

  return null;
}

async function goBackToInbox() {
  if (isNewVersion) {
    // Click back or inbox link
    const backBtn = document.querySelector(
      '[class*="back"], [aria-label*="back"], [title*="返回"], [class*="return"]'
    );
    if (backBtn) {
      simulateClick(backBtn);
      await sleep(500);
    }
  }
  // Old version typically uses frames, no need to go back
}

// ============================================================
// Verification Code Extraction
// ============================================================

function extractVerificationCode(text) {
  // Try various patterns for 6-digit verification codes
  // Pattern 1: standalone 6 digits
  const match6 = text.match(/\b(\d{6})\b/);
  if (match6) return match6[1];

  // Pattern 2: code/verification followed by digits
  const matchLabeled = text.match(/(?:code|验证码|verification|verify)[:\s]*(\d{4,8})/i);
  if (matchLabeled) return matchLabeled[1];

  // Pattern 3: digits followed by "code" label (Chinese: 是您的验证码)
  const matchReverse = text.match(/(\d{4,8})\s*(?:是|为|is)?\s*(?:您的)?(?:验证码|code)/i);
  if (matchReverse) return matchReverse[1];

  return null;
}
