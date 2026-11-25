// Headless Chrome for the site tests. puppeteer-core comes from this repo's node_modules or the global install;
// Chrome from CHROME_PATH, or the macOS default.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SITE = fileURLToPath(new URL('../../site/', import.meta.url));
const load = () => {
  try { return createRequire(import.meta.url)('puppeteer-core'); } catch {
    return createRequire(execSync('npm root -g').toString().trim() + '/')('puppeteer-core');
  }
};
export const launch = () => load().launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: process.env.CI ? ['--no-sandbox'] : [],
});

/** Make the page see a browser set to this language (navigator.language and navigator.languages). */
export const speak = (page, tag) => page.evaluateOnNewDocument((t) => {
  Object.defineProperty(navigator, 'language', { get: () => t });
  Object.defineProperty(navigator, 'languages', { get: () => [t] });
}, tag);

/** A tiny pass/fail recorder; the process exits non-zero if anything failed. */
export function checks() {
  let pass = 0, fail = 0;
  const ok = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : '')); };
  const done = () => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
  return { ok, done };
}
