// Runs the packaged GUI executable; no Electron development launcher or booking automation.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function validateSmoke(stdout, stderr, code, signal) {
  if (code !== 0 || signal) throw new Error(`Executable did not exit normally: code=${code}, signal=${signal}`);
  if (/DESKTOP_SMOKE_ERROR|Uncaught (?:Exception|Error)|UnhandledPromiseRejection|FATAL ERROR/i.test(stdout + '\n' + stderr)) {
    throw new Error('Runtime error detected; see stdout.log and stderr.log');
  }
  const lines = stdout.split(/\r?\n/).filter(line => line.startsWith('DESKTOP_SMOKE_OK '));
  if (lines.length !== 1) throw new Error('Expected exactly one DESKTOP_SMOKE_OK result');
  const result = JSON.parse(lines[0].slice('DESKTOP_SMOKE_OK '.length));
  if (result.browserRecovered !== true || typeof result.title !== 'string' || !result.title.trim() ||
      !Number.isInteger(result.inputs) || result.inputs < 1 || result.nodeExposed !== false || result.naverTheme !== '6627331') {
    throw new Error('Invalid UI/isolation/recovery result: ' + JSON.stringify(result));
  }
  return result;
}

async function runSmoke(executable, { output = '.local/desktop-smoke', timeout = 90000, args = [] } = {}) {
  if (!Number.isInteger(timeout) || timeout < 1) throw new Error('Timeout must be a positive integer');
  executable = path.resolve(executable);
  if (!fs.statSync(executable).isFile()) throw new Error('Executable is not a file');
  output = path.resolve(output);
  fs.mkdirSync(output, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kkul-exe-test-'));
  const env = { ...process.env, KKUL_SMOKE_TEMP: temporary, KKUL_NAVER_BANK: '0' };
  for (const key of Object.keys(env)) {
    if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH'].includes(key.toUpperCase())) delete env[key];
  }
  let stdout = '', stderr = '', report;
  const started = Date.now();
  try {
    const child = spawn(executable, [...args, '--desktop-smoke'], {
      cwd: path.dirname(executable), env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const status = await new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        // Target only the process tree created by this test, never all Electron/Chrome processes.
        if (process.platform === 'win32' && child.pid) {
          spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000, windowsHide: true });
        } else child.kill('SIGKILL');
        clearTimeout(timer);
        reject(new Error(`Executable timed out after ${timeout} ms`));
      }, timeout);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', err => { clearTimeout(timer); reject(err); });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (!timedOut) resolve({ code, signal });
      });
    });
    report = { ok: true, executable, ...status, result: validateSmoke(stdout, stderr, status.code, status.signal) };
    return report;
  } catch (err) {
    report = { ok: false, executable, error: err.message };
    throw err;
  } finally {
    fs.writeFileSync(path.join(output, 'stdout.log'), stdout);
    fs.writeFileSync(path.join(output, 'stderr.log'), stderr);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ...report, durationMs: Date.now() - started }, null, 2) + '\n');
    for (const entry of fs.readdirSync(temporary)) {
      const log = path.join(temporary, entry, 'desktop.log');
      if (fs.existsSync(log)) fs.copyFileSync(log, path.join(output, entry + '-backend.log'));
    }
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

if (require.main === module) {
  if (process.platform !== 'win32') { console.error('Windows is required to test the packaged EXE.'); process.exitCode = 1; }
  else {
    const executable = process.argv[2];
    if (!executable || !executable.toLowerCase().endsWith('.exe')) {
      console.error('Usage: npm run test:desktop:win -- "path/to/예약도우미.exe" [log-directory]');
      process.exitCode = 1;
    } else runSmoke(executable, { output: process.argv[3] }).then(
      result => console.log('WINDOWS_PACKAGED_SMOKE_OK ' + JSON.stringify(result)),
      err => { console.error(err); process.exitCode = 1; },
    );
  }
}
module.exports = { runSmoke, validateSmoke };
