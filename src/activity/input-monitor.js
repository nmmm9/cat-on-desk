const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// Use raw uint8 pointer instead of struct so koffi reliably writes back into the buffer.
const GetLastInputInfo = user32.func(
  'bool __stdcall GetLastInputInfo(_Inout_ uint8 *plii)'
);
const GetCursorPos = user32.func(
  'bool __stdcall GetCursorPos(_Out_ uint8 *pt)'
);
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
const GetTickCount = kernel32.func('uint32 __stdcall GetTickCount()');

const VK_LBUTTON = 0x01;
function isLeftMouseDown() {
  return (GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0;
}

const liiBuf = Buffer.alloc(8);
const ptBuf = Buffer.alloc(8);

function readIdleMs() {
  liiBuf.writeUInt32LE(8, 0); // cbSize
  liiBuf.writeUInt32LE(0, 4); // dwTime placeholder
  const ok = GetLastInputInfo(liiBuf);
  if (!ok) return null;
  const dwTime = liiBuf.readUInt32LE(4);
  if (dwTime === 0) return null;
  return ((GetTickCount() - dwTime) >>> 0);
}

function readMousePos() {
  if (!GetCursorPos(ptBuf)) return null;
  return { x: ptBuf.readInt32LE(0), y: ptBuf.readInt32LE(4) };
}

const IDLE_THRESHOLD_MS = 3000;

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
