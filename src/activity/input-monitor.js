const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

const IDLE_THRESHOLD_MS = 3000;

let readIdleMs, readMousePos, isLeftMouseDown;

if (IS_WIN) {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const GetLastInputInfo = user32.func('bool __stdcall GetLastInputInfo(_Inout_ uint8 *plii)');
  const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ uint8 *pt)');
  const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
  const GetTickCount = kernel32.func('uint32 __stdcall GetTickCount()');

  const VK_LBUTTON = 0x01;
  isLeftMouseDown = () => (GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0;

  const liiBuf = Buffer.alloc(8);
  const ptBuf = Buffer.alloc(8);

  readIdleMs = () => {
    liiBuf.writeUInt32LE(8, 0);
    liiBuf.writeUInt32LE(0, 4);
    if (!GetLastInputInfo(liiBuf)) return null;
    const dwTime = liiBuf.readUInt32LE(4);
    if (dwTime === 0) return null;
    return ((GetTickCount() - dwTime) >>> 0);
  };

  readMousePos = () => {
    if (!GetCursorPos(ptBuf)) return null;
    return { x: ptBuf.readInt32LE(0), y: ptBuf.readInt32LE(4) };
  };
} else if (IS_MAC) {
  const { execFile } = require('child_process');
  const { screen } = require('electron');

  // ioreg를 백그라운드 폴링하여 idle ms 캐시
  let cachedIdleMs = 0;
  let lastPolledAt = 0;

  function pollIdle() {
    execFile(
      '/bin/sh',
      ['-c', "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ { print int($NF/1000000); exit }'"],
      { timeout: 800 },
      (err, stdout) => {
        if (err) return;
        const v = parseInt(String(stdout).trim(), 10);
        if (Number.isFinite(v) && v >= 0) {
          cachedIdleMs = v;
          lastPolledAt = Date.now();
        }
      }
    );
  }
  setInterval(pollIdle, 200);
  pollIdle();

  readIdleMs = () => {
    // 마지막 폴링 후 경과 시간을 보정해서 더 부드럽게
    const slack = lastPolledAt ? Date.now() - lastPolledAt : 0;
    return cachedIdleMs + slack;
  };

  readMousePos = () => {
    try {
      const p = screen.getCursorScreenPoint();
      return { x: p.x, y: p.y };
    } catch {
      return null;
    }
  };

  // Mac에서는 OS-level mouse button polling이 비싸서, drag는 mouseup + cursor-stop timeout으로 처리
  // → 항상 true 반환해서 main의 폴링 가드를 통과시키고, 다른 메커니즘이 drag 종료를 담당
  isLeftMouseDown = () => true;
} else {
  // Linux / 기타: 최소한 크래시 안 나게 stub
  readIdleMs = () => 0;
  readMousePos = () => ({ x: 0, y: 0 });
  isLeftMouseDown = () => false;
}

function startInputMonitor({ intervalMs = 500, onChange } = {}) {
  let currentState = null;
  let lastTickInputAge = null;

  const timer = setInterval(() => {
    const idleMs = readIdleMs();
    if (idleMs == null) return;

    const isActive = idleMs < IDLE_THRESHOLD_MS;
    const nextState = isActive ? 'active' : 'idle';

    let kind = null;
    if (isActive && lastTickInputAge !== null && idleMs < lastTickInputAge) {
      kind = 'input-burst';
    }
    lastTickInputAge = idleMs;

    if (nextState !== currentState) {
      currentState = nextState;
      onChange?.({ state: nextState, idleMs, kind });
    } else if (kind) {
      onChange?.({ state: nextState, idleMs, kind });
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

module.exports = { startInputMonitor, readIdleMs, readMousePos, isLeftMouseDown, IDLE_THRESHOLD_MS };
