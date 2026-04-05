// sidepanel/sidepanel.js — Side Panel logic

const STATUS_ICONS = {
  pending: '\u2B1A',    // ⬚
  running: '\u23F3',    // ⏳
  completed: '\u2705',  // ✅
  failed: '\u274C',     // ❌
};

const logArea = document.getElementById('log-area');
const displayOauthUrl = document.getElementById('display-oauth-url');
const displayLocalhostUrl = document.getElementById('display-localhost-url');
const displayStatus = document.getElementById('display-status');
const inputEmail = document.getElementById('input-email');
const btnReset = document.getElementById('btn-reset');

// ============================================================
// State Restore on load
// ============================================================

async function restoreState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'sidepanel' });

    // Restore data fields
    if (state.oauthUrl) {
      displayOauthUrl.textContent = state.oauthUrl;
      displayOauthUrl.classList.add('has-value');
    }
    if (state.localhostUrl) {
      displayLocalhostUrl.textContent = state.localhostUrl;
      displayLocalhostUrl.classList.add('has-value');
    }
    if (state.email) {
      inputEmail.value = state.email;
    }

    // Restore step statuses
    if (state.stepStatuses) {
      for (const [step, status] of Object.entries(state.stepStatuses)) {
        updateStepUI(Number(step), status);
      }
    }

    // Restore logs
    if (state.logs) {
      for (const entry of state.logs) {
        appendLog(entry);
      }
    }

    updateStatusDisplay(state);
  } catch (err) {
    console.error('Failed to restore state:', err);
  }
}

// ============================================================
// UI Updates
// ============================================================

function updateStepUI(step, status) {
  const statusEl = document.querySelector(`.step-status[data-step="${step}"]`);
  if (statusEl) statusEl.textContent = STATUS_ICONS[status] || '\u2B1A';

  // Interlock logic
  updateButtonStates();
}

function updateButtonStates() {
  // Get all current statuses from DOM
  const statuses = {};
  document.querySelectorAll('.step-status').forEach(el => {
    const step = Number(el.dataset.step);
    const icon = el.textContent;
    const status = Object.entries(STATUS_ICONS).find(([, v]) => v === icon)?.[0] || 'pending';
    statuses[step] = status;
  });

  // Find if any step is running
  const anyRunning = Object.values(statuses).some(s => s === 'running');

  for (let step = 1; step <= 9; step++) {
    const btn = document.querySelector(`.step-btn[data-step="${step}"]`);
    if (!btn) continue;

    if (anyRunning) {
      // When any step is running, disable all buttons
      btn.disabled = true;
    } else if (step === 1) {
      // Step 1 is always available (unless running)
      btn.disabled = false;
    } else {
      // Steps 2-9: enabled if previous step completed (or current step failed for retry)
      const prevStatus = statuses[step - 1];
      const currentStatus = statuses[step];
      btn.disabled = !(prevStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'completed');
    }
  }
}

function updateStatusDisplay(state) {
  if (!state || !state.stepStatuses) return;
  const running = Object.entries(state.stepStatuses).find(([, s]) => s === 'running');
  if (running) {
    displayStatus.textContent = `Step ${running[0]} running...`;
    displayStatus.classList.add('has-value');
  } else {
    const lastCompleted = Object.entries(state.stepStatuses)
      .filter(([, s]) => s === 'completed')
      .map(([k]) => Number(k))
      .sort((a, b) => b - a)[0];
    if (lastCompleted === 9) {
      displayStatus.textContent = 'All steps completed!';
      displayStatus.classList.add('has-value');
    } else if (lastCompleted) {
      displayStatus.textContent = `Step ${lastCompleted} done. Ready for step ${lastCompleted + 1}.`;
      displayStatus.classList.add('has-value');
    } else {
      displayStatus.textContent = 'Waiting';
      displayStatus.classList.remove('has-value');
    }
  }
}

function appendLog(entry) {
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
  const levelLabel = entry.level.toUpperCase().padEnd(5);
  const line = document.createElement('div');
  line.className = `log-${entry.level}`;
  line.textContent = `${time} [${levelLabel}] ${entry.message}`;
  logArea.appendChild(line);
  logArea.scrollTop = logArea.scrollHeight;
}

// ============================================================
// Button Handlers
// ============================================================

document.querySelectorAll('.step-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const step = Number(btn.dataset.step);

    // Save email if step 3 and email input has value
    if (step === 3) {
      const email = inputEmail.value.trim();
      if (!email) {
        appendLog({ message: 'Please paste email address first', level: 'error', timestamp: Date.now() });
        return;
      }
      await chrome.runtime.sendMessage({
        type: 'EXECUTE_STEP',
        source: 'sidepanel',
        payload: { step, email },
      });
    } else {
      await chrome.runtime.sendMessage({
        type: 'EXECUTE_STEP',
        source: 'sidepanel',
        payload: { step },
      });
    }
  });
});

// Reset button
btnReset.addEventListener('click', async () => {
  if (confirm('Reset all steps and data?')) {
    await chrome.runtime.sendMessage({ type: 'RESET', source: 'sidepanel' });
    // Clear UI
    displayOauthUrl.textContent = 'Not obtained';
    displayOauthUrl.classList.remove('has-value');
    displayLocalhostUrl.textContent = 'Not captured';
    displayLocalhostUrl.classList.remove('has-value');
    inputEmail.value = '';
    displayStatus.textContent = 'Waiting';
    displayStatus.classList.remove('has-value');
    logArea.innerHTML = '';
    document.querySelectorAll('.step-status').forEach(el => el.textContent = '\u2B1A');
    updateButtonStates();
  }
});

// Save email when user types/pastes
inputEmail.addEventListener('change', async () => {
  const email = inputEmail.value.trim();
  if (email) {
    await chrome.runtime.sendMessage({
      type: 'SAVE_EMAIL',
      source: 'sidepanel',
      payload: { email },
    });
  }
});

// ============================================================
// Listen for Background broadcasts
// ============================================================

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'LOG_ENTRY':
      appendLog(message.payload);
      break;

    case 'STEP_STATUS_CHANGED': {
      const { step, status } = message.payload;
      updateStepUI(step, status);
      // Update status display
      chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'sidepanel' }).then(updateStatusDisplay);
      break;
    }

    case 'DATA_UPDATED': {
      if (message.payload.oauthUrl) {
        displayOauthUrl.textContent = message.payload.oauthUrl;
        displayOauthUrl.classList.add('has-value');
      }
      if (message.payload.localhostUrl) {
        displayLocalhostUrl.textContent = message.payload.localhostUrl;
        displayLocalhostUrl.classList.add('has-value');
      }
      break;
    }
  }
});

// ============================================================
// Init
// ============================================================

restoreState().then(() => {
  updateButtonStates();
});
