const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require('electron');

// macOS: 서명 없는 dev Electron이 system sandbox에서 mach port 등록 실패로
// 렌더러 프로세스가 bootstrap 못 함 (mach_port_rendezvous Permission denied).
// no-sandbox + 추가 플래그로 우회.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-features', 'IOSurfaceCapturer,DesktopCaptureMacV2');
  // 하드웨어 가속은 다시 활성화 (비활성화가 도움 안 됐고 오히려 GPU 프로세스 sandbox 문제 가능)
}

process.on('uncaughtException', (e) => {
  console.log('[diag] uncaughtException:', e && e.stack || e);
});
process.on('unhandledRejection', (e) => {
  console.log('[diag] unhandledRejection:', e && e.stack || e);
});

const http = require('http');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { readIdleMs, readMousePos, isLeftMouseDown } = require('./activity/input-monitor');
const { startForegroundMonitor } = require('./activity/foreground-app');
const { createStateMachine } = require('./state/state-machine');
const { getSiteFavicon, getFaviconForDomain } = require('./mapping/site-favicon');
const { getCachedBrowserUrl, urlToDomain } = require('./activity/browser-url');

let petWindow = null;
let tray = null;

const SELF_EXE_PATH = (app.getPath('exe') || '').toLowerCase();
const SELF_EXE_NAME = path.basename(SELF_EXE_PATH);
const THEME_DIR = path.join(__dirname, 'theme', 'default-cat');
const THEME_PATH = path.join(THEME_DIR, 'theme.json');

const theme = JSON.parse(fs.readFileSync(THEME_PATH, 'utf8'));

// ---------- icon extraction ----------
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const iconCache = new Map();

function extractIconViaPowerShell(exePath) {
  if (!IS_WIN) return Promise.resolve(null);
  return new Promise((resolve) => {
    const escaped = exePath.replace(/'/g, "''");
    const script = `Add-Type -AssemblyName System.Drawing; try { $icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${escaped}'); if (-not $icon) { exit 1 }; $bmp = $icon.ToBitmap(); $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray()); $bmp.Dispose(); $ms.Dispose(); $icon.Dispose() } catch { exit 1 }`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const b64 = String(stdout).trim();
        if (!b64 || b64.length < 200) return resolve(null);
        resolve('data:image/png;base64,' + b64);
      }
    );
  });
}

function extractMacAppIconViaSips(bundlePath) {
  if (!bundlePath) return Promise.resolve(null);
  // .app 번들이 아니면 디렉터리 끝 자르고 다시 확인
  let bp = bundlePath;
  if (!bp.endsWith('.app')) {
    // /Applications/Foo.app/Contents/MacOS/Foo 같은 실행 파일 경로 → 번들 루트 추출
    const idx = bp.indexOf('.app/');
    if (idx > 0) bp = bp.slice(0, idx + 4);
    else return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const escaped = bp.replace(/'/g, "'\\''");
    const cmd = `
set -e
ICON=$(plutil -extract CFBundleIconFile raw '${escaped}/Contents/Info.plist' 2>/dev/null) || exit 1
[ -z "$ICON" ] && exit 1
case "$ICON" in *.icns) ;; *) ICON="$ICON.icns" ;; esac
ICNS='${escaped}/Contents/Resources/'"$ICON"
[ ! -f "$ICNS" ] && exit 1
TMP=$(mktemp -t catondesk)
sips -s format png -z 64 64 "$ICNS" --out "$TMP.png" >/dev/null 2>&1 || exit 1
base64 < "$TMP.png" 2>/dev/null
rm -f "$TMP" "$TMP.png"
`;
    execFile('/bin/bash', ['-c', cmd], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null);
      const b64 = String(stdout).trim().replace(/\s+/g, '');
      if (!b64 || b64.length < 500) return resolve(null);
      resolve('data:image/png;base64,' + b64);
    });
  });
}

async function getAppIcon(exePath) {
  if (!exePath) return null;
  const key = exePath.toLowerCase();
  if (iconCache.has(key)) return iconCache.get(key);

  // Mac: .app 번들에서 .icns 직접 추출 (app.getFileIcon이 placeholder만 돌려주는 케이스 회피)
  if (IS_MAC) {
    const macUrl = await extractMacAppIconViaSips(exePath);
    if (macUrl) {
      iconCache.set(key, macUrl);
      return macUrl;
    }
  }

  for (const size of ['large', 'normal', 'small']) {
    try {
      const icon = await app.getFileIcon(exePath, { size });
      if (!icon || icon.isEmpty()) continue;
      const dataUrl = icon.toDataURL();
      if (dataUrl && dataUrl.length > 1500) {
        iconCache.set(key, dataUrl);
        return dataUrl;
      }
    } catch {}
  }

  const psDataUrl = await extractIconViaPowerShell(exePath);
  if (psDataUrl) {
    iconCache.set(key, psDataUrl);
    return psDataUrl;
  }

  iconCache.set(key, null);
  return null;
}

function isDesktop(info) {
  if (!info) return false;
  const exe = (info.exe || '').toLowerCase();
  const title = info.title || '';
  if (IS_WIN) {
    if (exe !== 'explorer.exe') return false;
    if (title === '') return true;
    if (/program\s*manager|프로그램\s*관리자/i.test(title)) return true;
    return false;
  }
  if (IS_MAC) {
    // Finder가 frontmost이면서 window title이 없으면 데스크탑 클릭으로 간주
    if (exe.toLowerCase() !== 'finder' && exe.toLowerCase() !== 'finder.app') return false;
    return title === '';
  }
  return false;
}

function isSelf(info) {
  if (!info) return false;
  const exe = (info.exe || '').toLowerCase();
  const exePath = (info.exePath || '').toLowerCase();
  if (exePath && SELF_EXE_PATH && exePath === SELF_EXE_PATH) return true;
  if (exe && SELF_EXE_NAME && exe === SELF_EXE_NAME) return true;
  if (IS_WIN && exe === 'electron.exe') return true;
  if (IS_MAC && (exe === 'electron' || exe === 'electron.app' || exe === 'cat on desk' || exe === 'cat on desk.app')) return true;
  return false;
}

// ---------- pet window ----------
function createPetWindow() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workArea;

  petWindow = new BrowserWindow({
    width: 160,
    height: 280,
    x: width - 180,
    y: height - 300,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !IS_MAC,
    },
  });

  console.log('[diag] BrowserWindow created');
  petWindow.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver');
  console.log('[diag] setAlwaysOnTop OK');
  // Mac에서는 setIgnoreMouseEvents를 ready-to-show 이후로 미룸
  if (!IS_MAC) {
    petWindow.setIgnoreMouseEvents(true, { forward: true });
    console.log('[diag] setIgnoreMouseEvents OK (win)');
  }

  // 이벤트 리스너를 loadFile 전에 모두 등록
  petWindow.on('closed', () => { petWindow = null; });
  petWindow.on('unresponsive', () => console.log('[diag] window unresponsive'));
  petWindow.on('responsive', () => console.log('[diag] window responsive'));
  petWindow.on('ready-to-show', () => {
    console.log('[diag] ready-to-show');
    if (IS_MAC) {
      try {
        petWindow.setIgnoreMouseEvents(true);
        console.log('[diag] setIgnoreMouseEvents OK (mac, deferred)');
      } catch (e) {
        console.log('[diag] setIgnoreMouseEvents FAIL', e && e.message || e);
      }
    }
  });
  petWindow.on('show', () => console.log('[diag] window show'));

  const wc = petWindow.webContents;
  wc.on('did-start-loading', () => console.log('[diag] did-start-loading'));
  wc.on('dom-ready', () => console.log('[diag] dom-ready'));
  wc.on('did-finish-load', () => console.log('[diag] did-finish-load'));
  wc.on('did-fail-load', (_e, code, desc, url) => {
    console.log('[diag] did-fail-load code=', code, 'desc=', desc, 'url=', url);
  });
  wc.on('did-fail-provisional-load', (_e, code, desc, url) => {
    console.log('[diag] did-fail-provisional-load code=', code, 'desc=', desc, 'url=', url);
  });
  wc.on('render-process-gone', (_e, details) => {
    console.log('[diag] render-process-gone', JSON.stringify(details));
  });
  wc.on('preload-error', (_e, preloadPath, err) => {
    console.log('[diag] preload-error', preloadPath, err && err.message || err);
  });
  wc.on('console-message', (_e, level, message, line, source) => {
    console.log('[renderer console]', level, message, source + ':' + line);
  });
  app.on('child-process-gone', (_e, details) => {
    console.log('[diag] child-process-gone', JSON.stringify(details));
  });
  app.on('render-process-gone', (_e, _wc, details) => {
    console.log('[diag] app.render-process-gone', JSON.stringify(details));
  });

  const indexPath = path.join(__dirname, 'renderer', 'index.html');
  console.log('[diag] loading file:', indexPath);
  petWindow.loadFile(indexPath).then(
    () => console.log('[diag] loadFile resolved'),
    (e) => console.log('[diag] loadFile rejected:', e && e.message || e)
  );
}

function pushToRenderer(channel, payload) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const wc = petWindow.webContents;
  if (!wc || wc.isDestroyed()) return;
  // 렌더러가 아직 로딩 중이면 IPC 무시 (Mac에서 NOTREACHED 회피)
  if (wc.isLoading()) return;
  try { wc.send(channel, payload); } catch {}
}

function broadcastState(state, extra = {}) {
  const def = theme.states[state];
  if (!def) return;
  pushToRenderer('pet:state', {
    state,
    frames: def.frames,
    frameIntervalMs: theme.frameIntervalMs || 400,
    ...extra,
  });
}

// ---------- state machine + walking ----------
let currentWalkFacing = 1;

const stateMachine = createStateMachine({
  playStates: theme.playStates || [],
  sleepStates: theme.sleepStates || [],
  onChange: ({ state, phase, direction }) => {
    console.log('[state]', state, '(' + phase + ')');
    if (typeof direction === 'number') currentWalkFacing = direction;
    broadcastState(state, { direction });
  },
});

// 윈도우 안에서 시각적으로 보이는 고양이/카드 영역의 패딩.
// X: 윈도우 160 vs 고양이 140 → 좌우 10px가 투명. 그만큼 화면 밖으로 더 갈 수 있게.
// Y: 윈도우 상단의 말풍선 영역(약 80px)과 하단의 카드 영역(약 35px)이 비어 있을 수 있으니
//    그 범위만큼 윈도우가 화면 밖으로 나가도 고양이는 여전히 보임.
const VISIBLE_INSET_X = 10;
const VISIBLE_INSET_TOP = 80;
const VISIBLE_INSET_BOTTOM = 35;

function clampToScreens(x, y, w, h) {
  const center = { x: Math.round(x + w / 2), y: Math.round(y + h / 2) };
  const display = screen.getDisplayNearestPoint(center);
  const b = display.bounds;
  const minX = b.x - VISIBLE_INSET_X;
  const maxX = b.x + b.width - w + VISIBLE_INSET_X;
  const minY = b.y - VISIBLE_INSET_TOP;
  const maxY = b.y + b.height - h + VISIBLE_INSET_BOTTOM;
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

let walker = null;
function startWalk(onComplete) {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (walker) return;

  const [x0, y0] = petWindow.getPosition();
  const [w, h] = petWindow.getSize();

  const dir = currentWalkFacing;
  const totalDx = (90 + Math.random() * 80) * dir;
  const dirY = Math.random() < 0.5 ? -1 : 1;
  const totalDy = dirY * (60 + Math.random() * 60);
  const durationMs = 3000;
  const startedAt = Date.now();

  walker = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) {
      clearInterval(walker);
      walker = null;
      return;
    }
    const t = Math.min(1, (Date.now() - startedAt) / durationMs);
    const nxRaw = x0 + totalDx * t;
    const nyRaw = y0 + totalDy * t;
    const c = clampToScreens(nxRaw, nyRaw, w, h);
    petWindow.setBounds({ x: Math.round(c.x), y: Math.round(c.y), width: w, height: h });
    if (t >= 1) {
      clearInterval(walker);
      walker = null;
      if (typeof onComplete === 'function') onComplete();
      flushPendingNotifyResize();
    }
  }, 30);
}

function stopWalk() {
  if (walker) {
    clearInterval(walker);
    walker = null;
  }
}

const MOUSE_MOVE_THRESHOLD_PX = 5;
const FRAME_ADVANCE_COOLDOWN_MS = 195;
const KEYBOARD_COOLDOWN_MS = 40;

let forcedWalkUntil = 0;

let stateTickTimer = null;
function startStateLoop() {
  let prevWalking = false;
  let prevIdleMs = null;
  let prevMouse = null;
  let lastRealInputAt = Date.now();
  let lastFrameAdvanceAt = 0;

  stateTickTimer = setInterval(() => {
    if (Date.now() < forcedWalkUntil) return;
    const rawIdleMs = readIdleMs();
    if (rawIdleMs == null) return;
    const mouse = readMousePos();

    const dwAdvanced = prevIdleMs != null && rawIdleMs < prevIdleMs;
    let mouseDist = 0;
    if (prevMouse && mouse) {
      mouseDist = Math.hypot(mouse.x - prevMouse.x, mouse.y - prevMouse.y);
    }
    prevMouse = mouse;
    prevIdleMs = rawIdleMs;

    let isRealInput = false;
    let isKeyboardLike = false;
    if (mouseDist >= MOUSE_MOVE_THRESHOLD_PX) {
      isRealInput = true;
    } else if (dwAdvanced) {
      isRealInput = true;
      isKeyboardLike = true;
    }

    const now = Date.now();
    if (isRealInput) lastRealInputAt = now;
    const effectiveIdleMs = now - lastRealInputAt;

    const result = stateMachine.tick(effectiveIdleMs);

    if (result.state === 'laptop' && isRealInput) {
      const cd = isKeyboardLike ? KEYBOARD_COOLDOWN_MS : FRAME_ADVANCE_COOLDOWN_MS;
      if (now - lastFrameAdvanceAt >= cd) {
        lastFrameAdvanceAt = now;
        pushToRenderer('pet:frame-advance', null);
      }
    }

    if (result.walkActive && !prevWalking) startWalk();
    else if (!result.walkActive && prevWalking) stopWalk();
    prevWalking = !!result.walkActive;
  }, 40);
}

// ---------- tray ----------
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'tray.png');
  let trayImage;
  try {
    trayImage = nativeImage.createFromPath(iconPath);
    if (!trayImage || trayImage.isEmpty()) trayImage = nativeImage.createEmpty();
  } catch {
    trayImage = nativeImage.createEmpty();
  }
  tray = new Tray(trayImage);
  tray.setToolTip('Cat on Desk');

  const togglePet = () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    if (petWindow.isVisible()) petWindow.hide();
    else petWindow.show();
  };

  const menu = Menu.buildFromTemplate([
    { label: '펫 보이기/숨기기', click: togglePet },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', togglePet);
}

// ---------- HTTP server (extension events) ----------
const HTTP_PORT = 23461;

const sseClients = new Set();

function broadcastSse(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch {}
  }
}

function startHttpServer() {
  const server = http.createServer((req, res) => {
    const setCors = () => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    };
    setCors();
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      console.log('[sse] client connected, total=', sseClients.size);
      req.on('close', () => {
        sseClients.delete(res);
        console.log('[sse] client closed, total=', sseClients.size);
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/ai-response-done') {
      const chunks = [];
      let total = 0;
      req.on('data', (c) => {
        total += c.length;
        if (total > 5000) { req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', async () => {
        let payload = {};
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        const site = (payload.site || 'AI').toString().slice(0, 30);
        const message = (payload.message || `${site} 응답 완료`).toString().slice(0, 60);
        const url = (payload.url || '').toString().slice(0, 500);
        let iconDataUrl = null;
        if (url) {
          const domain = urlToDomain(url);
          if (domain) iconDataUrl = await getFaviconForDomain(domain);
        }
        console.log('[ai-done]', site, '-', message, url ? '(' + url.slice(0, 60) + ')' : '');
        pushToRenderer('pet:notify', { site, message, url, iconDataUrl });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log('[http] listening on 127.0.0.1:' + HTTP_PORT);
  });
  server.on('error', (e) => console.log('[http] error', e.message));

  setInterval(() => {
    for (const c of sseClients) {
      try { c.write(': keepalive\n\n'); } catch {}
    }
  }, 25000);
}

// ---------- app lifecycle ----------
let stopForeground = null;

app.whenReady().then(() => {
  console.log('[diag] app ready, platform=', process.platform, 'electron=', process.versions.electron);
  if (IS_MAC && app.dock) {
    try { app.dock.hide(); } catch {}
    console.log('[diag] dock hidden');
  }
  createPetWindow();
  console.log('[diag] createPetWindow done');
  createTray();
  console.log('[diag] createTray done');
  startHttpServer();
  console.log('[diag] startHttpServer called');

  // 렌더러가 완전히 로드된 뒤에 state loop / 첫 broadcast 시작.
  // Mac에서는 페이지 로드 전 webContents.send가 NOTREACHED를 일으킨다는 보고가 있어 명시적으로 대기.
  const startWhenReady = () => {
    console.log('[lifecycle] renderer ready, starting state loop');
    broadcastState('basic');
    startStateLoop();
  };
  if (petWindow.webContents.isLoading()) {
    petWindow.webContents.once('did-finish-load', startWhenReady);
  } else {
    startWhenReady();
  }

  stopForeground = startForegroundMonitor({
    intervalMs: 800,
    onChange: async (info) => {
      if (isSelf(info)) return;
      if (isDesktop(info)) {
        pushToRenderer('activity:foreground', { exe: '', title: '', exePath: '', iconDataUrl: null });
        return;
      }
      const exe = (info.exe || '').toLowerCase();
      const isBrowser =
        exe.includes('chrome') ||
        exe.includes('msedge') ||
        exe.includes('edge') ||
        exe.includes('whale') ||
        exe.includes('firefox') ||
        exe.includes('safari') ||
        exe.includes('brave') ||
        exe.includes('arc');
      let iconDataUrl = null;
      let source = '-';
      if (isBrowser) {
        const url = await getCachedBrowserUrl(info.pid || 'last');
        const domain = urlToDomain(url);
        if (domain) {
          iconDataUrl = await getFaviconForDomain(domain);
          if (iconDataUrl) source = 'url:' + domain;
        }
        if (!iconDataUrl) {
          iconDataUrl = await getSiteFavicon(info.title);
          if (iconDataUrl) source = 'title-map';
        }
      }
      if (!iconDataUrl) {
        iconDataUrl = await getAppIcon(info.exePath);
        if (iconDataUrl && source === '-') source = isBrowser ? 'browser-fallback' : 'exe';
      }
      const iconLen = iconDataUrl ? iconDataUrl.length : 0;
      console.log('[foreground]', { exe: info.exe, title: info.title.slice(0, 60), source, iconLen });
      pushToRenderer('activity:foreground', { ...info, iconDataUrl });
    },
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

ipcMain.handle('app:quit', () => app.quit());

const BRING_FRONT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WL {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool fAlt);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
$SPI_SETFOREGROUNDLOCKTIMEOUT = 0x2001
[WL]::SystemParametersInfo($SPI_SETFOREGROUNDLOCKTIMEOUT, 0, [IntPtr]::Zero, 0) | Out-Null

# Alt 키 가짜 입력 → foreground lock 우회
[WL]::keybd_event(0x12, 0, 0, [IntPtr]::Zero)
[WL]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)

$names = $args
foreach ($n in $names) {
  $p = Get-Process | Where-Object { $_.ProcessName -eq $n -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    $h = $p.MainWindowHandle
    if ([WL]::IsIconic($h)) { [WL]::ShowWindow($h, 9) | Out-Null }
    [WL]::ShowWindow($h, 5) | Out-Null
    $fg = [WL]::GetForegroundWindow()
    $fgPid = 0
    $fgT = [WL]::GetWindowThreadProcessId($fg, [ref]$fgPid)
    $my = [WL]::GetCurrentThreadId()
    [WL]::AttachThreadInput($my, $fgT, $true) | Out-Null
    [WL]::BringWindowToTop($h) | Out-Null
    [WL]::SetForegroundWindow($h) | Out-Null
    [WL]::AttachThreadInput($my, $fgT, $false) | Out-Null
    [WL]::SwitchToThisWindow($h, $true)
    exit 0
  }
}
exit 1
`;

const MAC_BRING_FRONT_SCRIPT = `
on activateIfRunning(appName)
  tell application "System Events"
    if exists (processes where name is appName) then
      tell application appName to activate
      return true
    end if
  end tell
  return false
end activateIfRunning

set candidates to {"Google Chrome", "Microsoft Edge", "Whale", "Brave Browser", "Arc", "Safari", "Firefox"}
repeat with appName in candidates
  if my activateIfRunning(appName as string) then return
end repeat
`;

function bringBrowserToFront() {
  if (IS_WIN) {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', BRING_FRONT_SCRIPT, 'chrome', 'msedge', 'whale', 'firefox'],
      { timeout: 3000, windowsHide: true },
      () => {}
    );
  } else if (IS_MAC) {
    execFile('osascript', ['-e', MAC_BRING_FRONT_SCRIPT], { timeout: 2500 }, () => {});
  }
}

ipcMain.on('pet:open-url', (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  console.log('[click] activate', url, 'sse-clients=', sseClients.size);
  if (petWindow && !petWindow.isDestroyed()) {
    try { petWindow.focus(); } catch {}
  }
  broadcastSse({ type: 'activate-tab', url });
  setTimeout(bringBrowserToFront, 250);
});

// ---------- drag ----------
let dragOrigin = null;
let dragTimer = null;

function stopDrag() {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  dragOrigin = null;
}

ipcMain.on('pet:drag-begin', () => {
  if (!petWindow || petWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = petWindow.getPosition();
  const [w, h] = petWindow.getSize();
  dragOrigin = { mx: cursor.x, my: cursor.y, wx, wy, w, h, lastMoveAt: Date.now(), lastX: cursor.x, lastY: cursor.y };
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!dragOrigin || !petWindow || petWindow.isDestroyed()) {
      stopDrag();
      return;
    }
    if (!isLeftMouseDown()) {
      stopDrag();
      return;
    }
    const c = screen.getCursorScreenPoint();
    // Mac fallback: 커서가 1.5초간 멈춰 있으면 drag 종료 (mouseup이 안 잡힌 케이스)
    if (IS_MAC) {
      if (c.x !== dragOrigin.lastX || c.y !== dragOrigin.lastY) {
        dragOrigin.lastX = c.x;
        dragOrigin.lastY = c.y;
        dragOrigin.lastMoveAt = Date.now();
      } else if (Date.now() - dragOrigin.lastMoveAt > 1500) {
        stopDrag();
        return;
      }
    }
    const dx = c.x - dragOrigin.mx;
    const dy = c.y - dragOrigin.my;
    const targetX = dragOrigin.wx + dx;
    const targetY = dragOrigin.wy + dy;
    const clamped = clampToScreens(targetX, targetY, dragOrigin.w, dragOrigin.h);
    petWindow.setBounds({ x: clamped.x, y: clamped.y, width: dragOrigin.w, height: dragOrigin.h });
  }, 16);
});

ipcMain.on('pet:drag-end', () => {
  stopDrag();
  flushPendingNotifyResize();
});

ipcMain.on('pet:set-passthrough', (_e, passthrough) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (IS_MAC) {
    petWindow.setIgnoreMouseEvents(!!passthrough);
  } else {
    petWindow.setIgnoreMouseEvents(!!passthrough, { forward: true });
  }
});

const NOTIFY_BASE_HEIGHT = 280;
const NOTIFY_PER_CARD_PX = 42;

let pendingNotifyCount = null;

function applyNotifyResize(count) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const n = Math.max(0, Math.min(5, Number(count) || 0));
  const extra = Math.max(0, n - 1);
  const newHeight = NOTIFY_BASE_HEIGHT + extra * NOTIFY_PER_CARD_PX;
  const [x, y] = petWindow.getPosition();
  const [w, h] = petWindow.getSize();
  if (newHeight === h) return;
  const bottomY = y + h;
  const newY = bottomY - newHeight;
  const clamped = clampToScreens(x, newY, w, newHeight);
  petWindow.setBounds({ x: clamped.x, y: clamped.y, width: w, height: newHeight });
}

function flushPendingNotifyResize() {
  if (pendingNotifyCount === null) return;
  const c = pendingNotifyCount;
  pendingNotifyCount = null;
  applyNotifyResize(c);
}

ipcMain.on('pet:notify-resize', (_e, count) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (dragOrigin) return;
  if (walker) {
    pendingNotifyCount = count;
    return;
  }
  applyNotifyResize(count);
});

ipcMain.on('pet:test-walk', () => {
  stopDrag();
  if (walker) stopWalk();
  forcedWalkUntil = Date.now() + 5000;
  currentWalkFacing = Math.random() < 0.5 ? -1 : 1;
  console.log('[test] forced walk dir=', currentWalkFacing);
  stateMachine.syncState('walk');
  broadcastState('walk', { direction: currentWalkFacing });
  startWalk(() => {
    forcedWalkUntil = 0;
    stateMachine.syncState('basic');
    broadcastState('basic');
  });
});
