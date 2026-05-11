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
  // 어떤 브라우저가 frontmost인지 먼저 알아낸 뒤, 해당 앱에 URL 질의
  // 한 번의 osascript로 처리
  const SCRIPT = `
tell application "System Events"
  set frontName to name of first application process whose frontmost is true
end tell
set theURL to ""
if frontName is "Google Chrome" then
  try
    tell application "Google Chrome" to set theURL to URL of active tab of front window
  end try
else if frontName is "Google Chrome Canary" then
  try
    tell application "Google Chrome Canary" to set theURL to URL of active tab of front window
  end try
else if frontName is "Chromium" then
  try
    tell application "Chromium" to set theURL to URL of active tab of front window
  end try
else if frontName is "Brave Browser" then
  try
    tell application "Brave Browser" to set theURL to URL of active tab of front window
  end try
else if frontName is "Microsoft Edge" then
  try
    tell application "Microsoft Edge" to set theURL to URL of active tab of front window
  end try
else if frontName is "Whale" then
  try
    tell application "Whale" to set theURL to URL of active tab of front window
  end try
else if frontName is "Arc" then
  try
    tell application "Arc" to set theURL to URL of active tab of front window
  end try
else if frontName is "Safari" then
  try
    tell application "Safari" to set theURL to URL of current tab of front window
  end try
end if
return theURL
`;

  readForegroundBrowserUrl = function () {
    return new Promise((resolve) => {
      execFile('osascript', ['-e', SCRIPT], { timeout: 2500 }, (err, stdout) => {
        if (err) return resolve(null);
        const raw = String(stdout).trim();
        if (!raw) return resolve(null);
        resolve(raw);
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
