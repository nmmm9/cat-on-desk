const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

let readForegroundBrowserUrl;

if (IS_WIN) {
  const URL_PS_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();}'
try {
  $h = [W]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero) { exit 1 }
  $e = [System.Windows.Automation.AutomationElement]::FromHandle($h)
  if (-not $e) { exit 1 }
  $ec = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
  $b = $e.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $ec)
  if (-not $b) { exit 1 }
  $vp = $null
  try { $vp = $b.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch { exit 1 }
  if (-not $vp) { exit 1 }
  $val = $vp.Current.Value
  if ([string]::IsNullOrWhiteSpace($val)) { exit 1 }
  Write-Output $val
} catch {
  exit 1
}
`;

  readForegroundBrowserUrl = function () {
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', URL_PS_SCRIPT],
        { timeout: 3500, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve(null);
          const raw = String(stdout).trim();
          if (!raw) return resolve(null);
          resolve(raw);
        }
      );
    });
  };
} else if (IS_MAC) {
  // 앱별 URL 조회 스크립트. 통합 if/else 구조면 설치 안 된 앱의 tell이 컴파일 실패시켜
  // 전체 스크립트가 syntax error로 죽음. 그래서 앱별로 분리.
  const APP_URL_SCRIPTS = {
    'Google Chrome': 'tell application "Google Chrome" to get URL of active tab of front window',
    'Google Chrome Canary': 'tell application "Google Chrome Canary" to get URL of active tab of front window',
    'Chromium': 'tell application "Chromium" to get URL of active tab of front window',
    'Brave Browser': 'tell application "Brave Browser" to get URL of active tab of front window',
    'Microsoft Edge': 'tell application "Microsoft Edge" to get URL of active tab of front window',
    'Whale': 'tell application "Whale" to get URL of active tab of front window',
    'Arc': 'tell application "Arc" to get URL of active tab of front window',
    'Safari': 'tell application "Safari" to get URL of current tab of front window',
  };

  function getFrontmostName() {
    return new Promise((resolve) => {
      execFile(
        'osascript',
        ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
        { timeout: 1500 },
        (err, stdout) => {
          if (err) return resolve(null);
          resolve(String(stdout).trim() || null);
        }
      );
    });
  }

  readForegroundBrowserUrl = async function () {
    const name = await getFrontmostName();
    if (!name) return null;
    const script = APP_URL_SCRIPTS[name];
    if (!script) {
      // 알려진 브라우저가 아님
      return null;
    }
    return new Promise((resolve) => {
      execFile('osascript', ['-e', script], { timeout: 2500 }, (err, stdout, stderr) => {
        if (err) {
          console.log('[browser-url-mac] tell error for', name, ':', err.message);
          const errOut = String(stderr || '').trim().slice(0, 200);
          if (errOut) console.log('[browser-url-mac] stderr:', errOut);
          return resolve(null);
        }
        const url = String(stdout).trim();
        if (!url) return resolve(null);
        resolve(url);
      });
    });
  };
} else {
  readForegroundBrowserUrl = async () => null;
}

const cache = new Map();
const TTL_MS = 800;

async function getCachedBrowserUrl(hwndKey) {
  const now = Date.now();
  const cached = cache.get(hwndKey);
  if (cached && cached.expireAt > now) return cached.url;
  const url = await readForegroundBrowserUrl();
  cache.set(hwndKey, { url, expireAt: now + TTL_MS });
  return url;
}

function urlToDomain(text) {
  if (!text || typeof text !== 'string') return null;
  if (!/^https?:\/\//i.test(text)) {
    if (/^[a-z]+:/i.test(text)) return null;
    text = 'http://' + text;
  }
  try {
    const u = new URL(text);
    const host = u.hostname.replace(/^www\./i, '');
    if (!host || !host.includes('.')) return null;
    return host;
  } catch {
    return null;
  }
}

module.exports = { readForegroundBrowserUrl, getCachedBrowserUrl, urlToDomain };
