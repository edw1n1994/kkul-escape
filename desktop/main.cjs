const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { copyRuntime, browserCandidates } = require('./runtime.cjs');

const smoke = process.argv.includes('--desktop-smoke');
if (smoke) app.setPath('userData', path.join(app.getPath('temp'), `kkul-smoke-${process.pid}`));
let win, backend, quitting = false, origin;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function browserPort() {
  const profile = path.join(app.getPath('userData'), 'booking-browser');
  const activeFile = path.join(profile, 'DevToolsActivePort');
  async function existing() {
    try {
      const [port, endpoint] = fs.readFileSync(activeFile, 'utf8').trim().split(/\r?\n/);
      if (!/^\d+$/.test(port)) return null;
      const info = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) }).then(r => r.json());
      return new URL(info.webSocketDebuggerUrl).pathname === endpoint ? Number(port) : null;
    } catch { return null; }
  }
  const running = await existing();
  if (running) return running;
  const binary = browserCandidates(process.platform).find(file => fs.existsSync(file));
  if (!binary) throw new Error('Google Chrome 또는 Microsoft Edge를 설치한 후 앱을 다시 실행해 주세요.');
  fs.mkdirSync(profile, { recursive: true });
  fs.rmSync(activeFile, { force: true });
  const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank'];
  const child = process.platform === 'darwin'
    ? spawn('/usr/bin/open', ['-n', '-a', binary.split('/Contents/')[0], '--args', ...args], { detached: true, stdio: 'ignore' })
    : spawn(binary, args, { detached: true, stdio: 'ignore' });
  let launchError;
  child.on('error', err => { launchError = err; });
  child.unref();
  for (let i = 0; i < 80; i++) {
    if (launchError) throw launchError;
    const port = await existing();
    if (port) return port;
    await pause(250);
  }
  throw new Error('예약용 브라우저 연결 시간이 초과되었습니다. 앱을 다시 실행해 주세요.');
}

async function start() {
  const runtime = path.join(app.getPath('userData'), 'runtime');
  copyRuntime(app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(__dirname, '..'), runtime);
  const cdpPort = smoke ? 1 : await browserPort();
  const log = fs.openSync(path.join(app.getPath('userData'), 'desktop.log'), 'a');
  backend = spawn(process.execPath, [path.join(runtime, 'ui/server.mjs')], {
    cwd: path.join(runtime, 'ui'),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: smoke ? '0' : '18899', BIND: '127.0.0.1', CDP_PORT: String(cdpPort) },
    stdio: ['ignore', log, log, 'ipc'], windowsHide: true,
  });
  fs.closeSync(log);
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('앱 서버를 시작하지 못했습니다. desktop.log를 확인해 주세요.')), 15000);
    backend.once('error', err => { clearTimeout(timer); reject(err); });
    backend.once('exit', code => { clearTimeout(timer); reject(new Error(`앱 서버가 종료되었습니다 (${code}). 포트 18899 사용 여부와 desktop.log를 확인해 주세요.`)); });
    backend.once('message', msg => { clearTimeout(timer); resolve(msg.port); });
  });
  origin = `http://127.0.0.1:${port}`;
  backend.on('exit', () => { if (!quitting) { dialog.showErrorBox('서버 종료', '앱 서버가 종료되었습니다. 앱을 다시 실행해 주세요.'); app.quit(); } });
  win = new BrowserWindow({ width: 1280, height: 900, minWidth: 900, minHeight: 650,
    title: '예약도우미', show: false,
    icon: path.join(__dirname, 'assets', 'honey-pot-transparent.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const external = url => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) { event.preventDefault(); external(url); }
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.on('close', event => {
    if (!quitting && !smoke) {
      const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['계속 사용', '앱 종료'], defaultId: 0, cancelId: 0,
        message: '앱을 종료할까요?', detail: '진행 중인 예약 대기는 중단됩니다. 예약용 브라우저는 그대로 유지됩니다.' });
      if (choice === 0) event.preventDefault();
    }
  });
  await win.loadURL(origin);
  if (smoke) {
    const result = await win.webContents.executeJavaScript(`(async () => { await setSite('naver'); return { title: document.title, inputs: document.querySelectorAll('input').length, nodeExposed: typeof require !== 'undefined', naverTheme: document.getElementById('theme').value }; })()`);
    if (!result.title || !result.inputs || result.nodeExposed || result.naverTheme !== '6627331') throw new Error('화면 검증 실패: ' + JSON.stringify(result));
    console.log('DESKTOP_SMOKE_OK ' + JSON.stringify(result));
    app.quit();
  } else { win.show(); }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: '예약도우미', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
      { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '보기', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: '도움말', submenu: [{ label: '앱 데이터 폴더 열기', click: () => shell.openPath(app.getPath('userData')) }] },
    ]));
    await start();
  }).catch(err => { if (smoke) console.error(err); else dialog.showErrorBox('실행할 수 없습니다', err.message); process.exitCode = 1; app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (backend && backend.exitCode === null && !quitting) {
      event.preventDefault(); quitting = true;
      backend.once('exit', () => app.quit());
      if (backend.connected) backend.send({ type: 'shutdown' });
      else backend.kill();
      setTimeout(() => { if (backend.exitCode === null) backend.kill(); app.quit(); }, 4000).unref();
    } else { quitting = true; }
  });
}
