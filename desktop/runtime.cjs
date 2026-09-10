const fs = require('node:fs');
const path = require('node:path');

// Explicit allowlist: never ship local.env, booking logs or screenshots.
function copyRuntime(source, destination) {
  const files = ['unlock.mjs', 'ext/inject.js', 'ui/public/index.html',
    'ui/server.mjs', 'ui/runner.mjs', 'ui/lib.mjs', 'ui/sites.mjs', 'ui/dps.mjs', 'ui/zw-submit.mjs', 'ui/naver.mjs', 'ui/naver-browser.mjs', 'ui/naver-products.json', 'ui/unlock-status.mjs'];
  for (const file of files) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, file), target);
  }
  const cache = path.join(destination, 'ui/zw-open-times.json');
  if (!fs.existsSync(cache)) fs.copyFileSync(path.join(source, 'ui/zw-open-times.json'), cache);
}

function browserCandidates(platform, env = process.env) {
  if (platform === 'darwin') return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
    .filter(Boolean).flatMap(base => [path.join(base, 'Google/Chrome/Application/chrome.exe'),
      path.join(base, 'Microsoft/Edge/Application/msedge.exe')]);
}
module.exports = { copyRuntime, browserCandidates };
