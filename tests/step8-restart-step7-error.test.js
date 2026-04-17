const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const backgroundSource = fs.readFileSync('background.js', 'utf8');
const step8Source = fs.readFileSync('background/steps/fetch-login-code.js', 'utf8');
const step8GlobalScope = {};
const step8Api = new Function('self', `${step8Source}; return self.MultiPageBackgroundStep8;`)(step8GlobalScope);

function extractFunction(source, name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }

  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('ensureStep8VerificationPageReady throws explicit restart-step7 error on login timeout page', async () => {
  const api = new Function(`
function getLoginAuthStateLabel(state) {
  return state === 'login_timeout_error_page' ? '登录超时报错页' : '未知页面';
}

async function getLoginAuthStateFromContent() {
  return {
    state: 'login_timeout_error_page',
    url: 'https://auth.openai.com/log-in',
  };
}

${extractFunction(backgroundSource, 'ensureStep8VerificationPageReady')}

return {
  run() {
    return ensureStep8VerificationPageReady({});
  },
};
`)();

  await assert.rejects(
    () => api.run(),
    /STEP8_RESTART_STEP7::步骤 8：当前认证页进入登录超时报错页/
  );
});

test('step 8 reruns step 7 when auth page enters login timeout retry state', async () => {
  const calls = {
    executeStep7: 0,
    ensureReady: 0,
    logs: [],
    sleeps: [],
    resolveCalls: 0,
  };

  const executor = step8Api.createStep8Executor({
    addLog: async (message, level) => {
      calls.logs.push({ message, level });
    },
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => {
      calls.ensureReady += 1;
      if (calls.ensureReady === 1) {
        throw new Error('STEP8_RESTART_STEP7::步骤 8：当前认证页进入登录超时报错页，请回到步骤 7 重新开始。 URL: https://auth.openai.com/log-in');
      }
      return { state: 'verification_page' };
    },
    executeStep7: async () => {
      calls.executeStep7 += 1;
    },
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret', oauthUrl: 'https://oauth.example/latest' }),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async () => {
      calls.resolveCalls += 1;
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async (ms) => {
      calls.sleeps.push(ms);
    },
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 3,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    email: 'user@example.com',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
  });

  assert.equal(calls.executeStep7, 1);
  assert.equal(calls.ensureReady, 2);
  assert.equal(calls.resolveCalls, 1);
  assert.equal(calls.logs.some(({ message }) => /准备从步骤 7 重新开始/.test(message)), true);
  assert.deepStrictEqual(calls.sleeps, [3000]);
});
