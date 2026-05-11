const path = require('path');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

let readForegroundApp;
let _macReadAsync = null;

if (IS_WIN) {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
  const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hWnd, _Out_ wchar_t *lpString, int nMaxCount)');
  const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(void *hWnd)');
  const GetWindowThreadProcessId = user32.func(
    'uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)'
  );

  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const OpenProcess = kernel32.func('void* __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)');
  const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *hObject)');
  const QueryFullProcessImageNameW = kernel32.func(
    'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, _Out_ wchar_t *lpExeName, _Inout_ uint32 *lpdwSize)'
  );

  readForegroundApp = function () {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return null;

    const titleLen = GetWindowTextLengthW(hwnd);
    let title = '';
    if (titleLen > 0) {
      const buf = ['\0'.repeat(titleLen + 1)];
      const written = GetWindowTextW(hwnd, buf, titleLen + 1);
      if (written > 0) title = buf[0].slice(0, written);
    }

    const pidBox = [0];
    GetWindowThreadProcessId(hwnd, pidBox);
    const pid = pidBox[0];
    if (!pid) return { title, pid: 0, exe: '', exePath: '' };

    const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!handle) return { title, pid, exe: '', exePath: '' };

    let exePath = '';
    try {
      const sizeBox = [1024];
      const buf = ['\0'.repeat(1024)];
      const ok = QueryFullProcessImageNameW(handle, 0, buf, sizeBox);
      if (ok) exePath = buf[0].slice(0, sizeBox[0]);
    } finally {
      CloseHandle(handle);
    }

    const exe = exePath ? path.basename(exePath) : '';
    return { title, pid, exe, exePath };
  };
} else if (IS_MAC) {
  const { execFile } = require('child_process');

  // osascript로 frontmost 앱 정보 + window title + bundle path 조회
  // 한 번의 osascript 호출로 묶어서 비용 줄임
  const SCRIPT = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set appPid to unix id of frontApp
  set appPath to ""
  try
    set appPath to POSIX path of (file of frontApp as alias)
  on error
    set appPath to ""
  end try
  set winTitle to ""
  try
    set winTitle to name of front window of frontApp
  on error
    set winTitle to ""
  end try
end tell
return appName & "\\n" & appPid & "\\n" & appPath & "\\n" & winTitle
`;

  let cached = null;

  function pollOnce() {
    return new Promise((resolve) => {
      execFile('osascript', ['-e', SCRIPT], { timeout: 1500 }, (err, stdout) => {
        if (err) return resolve(null);
        const lines = String(stdout).split('\n');
        const appName = (lines[0] || '').trim();
        const pid = parseInt((lines[1] || '').trim(), 10) || 0;
        let exePath = (lines[2] || '').trim();
        const title = (lines[3] || '').trim();

        // appPath가 .app 번들 경로면 그대로, 아니면 비어있을 수 있음
        if (exePath && exePath.endsWith('/')) exePath = exePath.slice(0, -1);

        const exe = exePath ? path.basename(exePath) : appName;
        const result = { title, pid, exe, exePath };
        cached = result;
        resolve(result);
      });
    });
  }

  _macReadAsync = pollOnce;
  // 동기 호출용: 캐시 반환 (없으면 null)
  readForegroundApp = function () {
    return cached;
  };
} else {
  readForegroundApp = () => null;
}

function startForegroundMonitor({ intervalMs = 1000, onChange } = {}) {
  let last = { exe: null, title: null };

  const tick = async () => {
    let info;
    if (IS_MAC && _macReadAsync) {
      info = await _macReadAsync();
    } else {
      info = readForegroundApp();
    }
    if (!info) return;
    if (info.exe !== last.exe || info.title !== last.title) {
      last = { exe: info.exe, title: info.title };
      onChange?.(info);
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { readForegroundApp, startForegroundMonitor };
