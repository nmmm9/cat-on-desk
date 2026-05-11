const koffi = require('koffi');
const path = require('path');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const HWND = 'void *';
const HANDLE = 'void *';

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

function readForegroundApp() {
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
}

function startForegroundMonitor({ intervalMs = 1000, onChange } = {}) {
  let last = { exe: null, title: null };

  const tick = () => {
    const info = readForegroundApp();
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
