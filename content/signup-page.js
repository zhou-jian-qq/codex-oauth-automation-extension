// content/signup-page.js — Content script for OpenAI auth pages (steps 2, 3, 4-receive, 5)
// Injected on: auth0.openai.com, auth.openai.com, accounts.openai.com

console.log('[MultiPage:signup-page] Content script loaded on', location.href);

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
        case 2: return await step2_clickRegister();
        case 3: return await step3_fillEmailPassword(message.payload);
        case 5: return await step5_fillNameBirthday(message.payload);
        default: throw new Error(`signup-page.js does not handle step ${message.step}`);
      }
    case 'FILL_CODE':
      return await step4_fillVerificationCode(message.payload);
  }
}

// ============================================================
// Step 2: Click Register
// ============================================================

async function step2_clickRegister() {
  log('Step 2: Looking for Register/Sign up button...');

  // TODO: Adjust selectors based on actual OpenAI auth page
  let registerBtn = null;
  try {
    registerBtn = await waitForElementByText(
      'a, button, [role="button"], [role="link"]',
      /sign\s*up|register|create\s*account|注册/i,
      10000
    );
  } catch {
    // Some pages may have a direct link
    try {
      registerBtn = await waitForElement('a[href*="signup"], a[href*="register"]', 5000);
    } catch {
      throw new Error(
        'Could not find Register/Sign up button. ' +
        'Check auth page DOM in DevTools. URL: ' + location.href
      );
    }
  }

  simulateClick(registerBtn);
  log('Step 2: Clicked Register button');

  // Wait for page transition
  await sleep(2000);
  reportComplete(2);
}

// ============================================================
// Step 3: Fill Email & Password
// ============================================================

async function step3_fillEmailPassword(payload) {
  const { email } = payload;
  if (!email) throw new Error('No email provided. Paste email in Side Panel first.');

  log(`Step 3: Filling email: ${email}`);

  // Find email input
  let emailInput = null;
  try {
    emailInput = await waitForElement(
      'input[type="email"], input[name="email"], input[name="username"], input[id*="email"], input[placeholder*="email"], input[placeholder*="Email"]',
      10000
    );
  } catch {
    throw new Error('Could not find email input field on signup page. URL: ' + location.href);
  }

  fillInput(emailInput, email);
  log('Step 3: Email filled');

  // Check if password field is on the same page
  let passwordInput = document.querySelector('input[type="password"]');

  if (!passwordInput) {
    // Need to submit email first to get to password page
    log('Step 3: No password field yet, submitting email first...');
    const submitBtn = document.querySelector('button[type="submit"]')
      || await waitForElementByText('button', /continue|next|submit|继续|下一步/i, 5000).catch(() => null);

    if (submitBtn) {
      simulateClick(submitBtn);
      log('Step 3: Submitted email, waiting for password field...');
      await sleep(2000);
    }

    try {
      passwordInput = await waitForElement('input[type="password"]', 10000);
    } catch {
      throw new Error('Could not find password input after submitting email. URL: ' + location.href);
    }
  }

  fillInput(passwordInput, 'mimashisha0.0');
  log('Step 3: Password filled');

  // Submit the form
  await sleep(500);
  const submitBtn = document.querySelector('button[type="submit"]')
    || await waitForElementByText('button', /continue|sign\s*up|submit|注册|创建|create/i, 5000).catch(() => null);

  if (submitBtn) {
    simulateClick(submitBtn);
    log('Step 3: Form submitted');
  }

  await sleep(2000);
  reportComplete(3, { email });
}

// ============================================================
// Step 4 (receiving end): Fill Verification Code
// ============================================================

async function step4_fillVerificationCode(payload) {
  const { code } = payload;
  if (!code) throw new Error('No verification code provided.');

  log(`Step 4: Filling verification code: ${code}`);

  // Find code input — could be a single input or multiple separate inputs
  let codeInput = null;
  try {
    codeInput = await waitForElement(
      'input[name="code"], input[name="otp"], input[type="text"][maxlength="6"], input[aria-label*="code"], input[placeholder*="code"], input[placeholder*="Code"], input[inputmode="numeric"]',
      10000
    );
  } catch {
    // Check for multiple single-digit inputs (common pattern)
    const singleInputs = document.querySelectorAll('input[maxlength="1"]');
    if (singleInputs.length >= 6) {
      log('Step 4: Found single-digit code inputs, filling individually...');
      for (let i = 0; i < 6 && i < singleInputs.length; i++) {
        fillInput(singleInputs[i], code[i]);
        await sleep(100);
      }
      await sleep(1000);
      reportComplete(4);
      return;
    }
    throw new Error('Could not find verification code input. URL: ' + location.href);
  }

  fillInput(codeInput, code);
  log('Step 4: Code filled');

  // Submit
  await sleep(500);
  const submitBtn = document.querySelector('button[type="submit"]')
    || await waitForElementByText('button', /verify|confirm|submit|continue|确认|验证/i, 5000).catch(() => null);

  if (submitBtn) {
    simulateClick(submitBtn);
    log('Step 4: Verification submitted');
  }

  // Wait for page transition
  await sleep(2000);
  reportComplete(4);
}

// ============================================================
// Step 5: Fill Name & Birthday
// ============================================================

async function step5_fillNameBirthday(payload) {
  const { firstName, lastName, year, month, day } = payload;
  if (!firstName || !lastName) throw new Error('No name data provided.');

  log(`Step 5: Filling name: ${firstName} ${lastName}, Birthday: ${year}-${month}-${day}`);

  // --- First name ---
  let firstNameInput = null;
  try {
    firstNameInput = await waitForElement(
      'input[name="firstName"], input[name="first_name"], input[name="fname"], input[placeholder*="first" i], input[placeholder*="First"], input[id*="first" i]',
      10000
    );
  } catch {
    throw new Error('Could not find first name input. URL: ' + location.href);
  }
  fillInput(firstNameInput, firstName);
  log(`Step 5: First name filled: ${firstName}`);

  // --- Last name ---
  let lastNameInput = null;
  try {
    lastNameInput = await waitForElement(
      'input[name="lastName"], input[name="last_name"], input[name="lname"], input[placeholder*="last" i], input[placeholder*="Last"], input[id*="last" i]',
      5000
    );
  } catch {
    throw new Error('Could not find last name input. URL: ' + location.href);
  }
  fillInput(lastNameInput, lastName);
  log(`Step 5: Last name filled: ${lastName}`);

  // --- Birthday ---
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Try single date input first
  const dateInput = document.querySelector('input[type="date"], input[name="birthday"], input[name="dob"], input[name="birthdate"]');
  if (dateInput) {
    fillInput(dateInput, dateStr);
    log(`Step 5: Birthday filled (single input): ${dateStr}`);
  } else {
    // Try separate fields (month/day/year selects or inputs)
    log('Step 5: Looking for separate birthday fields...');

    const monthEl = document.querySelector('select[name*="month" i], input[name*="month" i], input[placeholder*="month" i], select[id*="month" i]');
    const dayEl = document.querySelector('select[name*="day" i], input[name*="day" i], input[placeholder*="day" i], select[id*="day" i]');
    const yearEl = document.querySelector('select[name*="year" i], input[name*="year" i], input[placeholder*="year" i], select[id*="year" i]');

    if (monthEl) {
      if (monthEl.tagName === 'SELECT') fillSelect(monthEl, String(month));
      else fillInput(monthEl, String(month).padStart(2, '0'));
    }
    if (dayEl) {
      if (dayEl.tagName === 'SELECT') fillSelect(dayEl, String(day));
      else fillInput(dayEl, String(day).padStart(2, '0'));
    }
    if (yearEl) {
      if (yearEl.tagName === 'SELECT') fillSelect(yearEl, String(year));
      else fillInput(yearEl, String(year));
    }

    if (!monthEl && !dayEl && !yearEl) {
      log('Step 5: WARNING - Could not find any birthday fields. May need to adjust selectors.', 'warn');
    } else {
      log(`Step 5: Birthday filled (separate fields): ${year}-${month}-${day}`);
    }
  }

  // Submit / Complete
  await sleep(500);
  const completeBtn = document.querySelector('button[type="submit"]')
    || await waitForElementByText('button', /complete|continue|finish|done|create|agree|完成|创建|同意/i, 5000).catch(() => null);

  if (completeBtn) {
    simulateClick(completeBtn);
    log('Step 5: Profile form submitted');
  }

  await sleep(2000);
  reportComplete(5);
}
