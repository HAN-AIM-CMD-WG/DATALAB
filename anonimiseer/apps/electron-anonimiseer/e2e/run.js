// End-to-end test of the desktop app, driven by Playwright.
//
// Walks through onboarding and all four wizard steps like a user would, with
// a Markdown dossier and a Word intake form, then checks what actually landed
// on disk: no personal data in the text, none in the document properties, and
// files readable only by the user.
//
// Only the two native dialogs (pick files, pick folder) are replaced, in the
// main process. See README.md for how to run it.
const { _electron } = require('playwright-core');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(__dirname, '.tmp');
const INPUT = path.join(TMP, 'input');
const OUTDIR = path.join(TMP, 'output');
const SHOTS = path.join(TMP, 'shots');
const DEV_DOC = path.resolve(APP, '../../docs/examples/test-document.md');
const DEV_GOLD = DEV_DOC.replace(/\.md$/, '.expected.jsonl');
const SCOPE = new Set([
  'PERSON', 'LOCATION', 'NL_POSTCODE', 'NL_PHONE_NUMBER', 'EMAIL_ADDRESS', 'NL_BSN', 'IBAN_CODE',
]);
// Dates in the test document that follow "geboren" or "Geboortedatum".
const BIRTH_DATES = [
  '14-03-1985', '02/11/1992', '30 juni 1978', '1990-08-22', '7 mei 1995', '1962-12-01', '11.04.1975', '07-05-1995',
];

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let shotNr = 0;
async function shot(page, name) {
  shotNr += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(shotNr).padStart(2, '0')}-${name}.png`) });
}

async function clickNext(page) {
  const next = page.getByRole('button', { name: 'Volgende', exact: true });
  await next.waitFor({ state: 'visible' });
  await next.click();
}

async function waitNextEnabled(page, timeout) {
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Volgende');
      return b && !b.disabled;
    },
    null,
    { timeout },
  );
}

function prepareInputs() {
  const docx = path.join(INPUT, 'intake.docx');
  if (!fs.existsSync(docx)) {
    throw new Error('Word fixture missing: run e2e/make_fixture.py first (see e2e/README.md).');
  }
  fs.rmSync(OUTDIR, { recursive: true, force: true });
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.copyFileSync(DEV_DOC, path.join(INPUT, 'test-document.md'));
  return [path.join(INPUT, 'test-document.md'), docx];
}

async function driveApp(inputs) {
  const packaged = process.env.E2E_EXECUTABLE;
  const userData = path.join(TMP, packaged ? 'userdata-packaged' : 'userdata');
  fs.rmSync(userData, { recursive: true, force: true });
  // Started from Finder, the app has no npm_* variables; started from here it would.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('npm_')));
  const app = await _electron.launch(
    packaged
      ? { executablePath: packaged, args: [`--user-data-dir=${userData}`], env, timeout: 120_000 }
      : {
          executablePath: require(path.join(APP, 'node_modules', 'electron')),
          args: [APP, `--user-data-dir=${userData}`],
          cwd: APP,
          env,
          timeout: 60_000,
        },
  );
  const consoleErrors = [];
  const page = await app.firstWindow();
  const shownVersion = await page.evaluate(() => window.anonimiseer.version.app);
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  try {
    await app.evaluate(
      ({ dialog }, { files, outdir }) => {
        dialog.showOpenDialog = async (...args) => {
          const opts = args.find((a) => a && Array.isArray(a.properties)) || { properties: [] };
          return opts.properties.includes('openDirectory')
            ? { canceled: false, filePaths: [outdir] }
            : { canceled: false, filePaths: files };
        };
      },
      { files: inputs, outdir: OUTDIR },
    );

    await page.getByText('Welkom bij Anonimiseer').waitFor({ timeout: 30_000 });
    await shot(page, 'onboarding');
    await clickNext(page);
    await page.getByRole('checkbox').check();
    await clickNext(page);
    await page.getByRole('button', { name: /Afronden en openen/ }).click();

    await page.getByRole('button', { name: /Kies bestanden/ }).click();
    await page.getByText('intake.docx').first().waitFor({ timeout: 10_000 });
    await shot(page, 'step1-files');
    await clickNext(page);
    await shot(page, 'step2-settings');
    await clickNext(page);

    await waitNextEnabled(page, 240_000);
    await shot(page, 'step3-review');
    await clickNext(page);

    await page.getByRole('button', { name: /Kies map/ }).click();
    const boxes = page.locator('input[type=checkbox]');
    for (let i = 0; i < (await boxes.count()); i += 1) {
      if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
    }
    await page.getByRole('button', { name: 'Opslaan', exact: true }).click();

    const runDir = await waitForDir(page, 'anonimiseer-2', 'DISCLAIMER.txt');
    await page.waitForTimeout(1000);
    await shot(page, 'step4-result');

    // Put the pseudonyms back with this run's mapping.
    const pseudonymised = ['test-document.anon.md', 'intake.anon.docx'].map((f) => path.join(runDir, f));
    await app.evaluate(
      ({ dialog }, { mapping, files, outdir }) => {
        dialog.showOpenDialog = async (...args) => {
          const opts = args.find((a) => a && Array.isArray(a.properties)) || { properties: [] };
          if (opts.properties.includes('openDirectory')) return { canceled: false, filePaths: [outdir] };
          const exts = (opts.filters || []).flatMap((f) => f.extensions);
          return { canceled: false, filePaths: exts.includes('bin') ? [mapping] : files };
        };
      },
      { mapping: path.join(runDir, 'mapping.bin'), files: pseudonymised, outdir: OUTDIR },
    );
    await page.getByRole('button', { name: 'Pseudoniemen terugzetten' }).click();
    const panel = page.getByRole('dialog', { name: 'Pseudoniemen terugzetten' });
    await panel.getByRole('button', { name: /Kies mapping/ }).click();
    await panel.getByText(/vervangingen?,? /).waitFor({ timeout: 10_000 });
    await panel.getByRole('button', { name: /Kies bestanden/ }).click();
    await panel.getByRole('button', { name: 'Kies map', exact: true }).click();
    await panel.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Terugzetten', exact: true }).click();
    const restoreDir = await waitForDir(page, 'anonimiseer-teruggezet-', 'intake.teruggezet.docx');
    await panel.getByText(/teruggezet/).first().waitFor();
    await shot(page, 'restore-result');

    return { runDir, restoreDir, consoleErrors, shownVersion };
  } finally {
    await app.close();
  }
}

async function waitForDir(page, prefix, marker) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const dir = fs.readdirSync(OUTDIR).find((d) => d.startsWith(prefix));
    if (dir && fs.existsSync(path.join(OUTDIR, dir, marker))) return path.join(OUTDIR, dir);
    await page.waitForTimeout(500);
  }
  throw new Error(`no ${prefix}* directory with ${marker} appeared within 120 s`);
}

// ------------------------------------------------------------------ checks

function containsWord(text, fragment) {
  const esc = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pre = /^\w/.test(fragment) ? '(?<![\\p{L}\\p{N}_])' : '';
  const suf = /\w$/.test(fragment) ? '(?![\\p{L}\\p{N}_])' : '';
  return new RegExp(pre + esc + suf, 'u').test(text);
}

function docxPart(file, part) {
  const xml = execFileSync('unzip', ['-p', file, part], { encoding: 'utf8' });
  return xml.replace(/<[^>]+>/g, ' ');
}

function checks(runDir) {
  const results = [];
  const add = (name, problems) => results.push({ name, ok: problems.length === 0, problems });

  const mode = (p) => (fs.statSync(p).mode & 0o777).toString(8);
  add('run directory only readable by the user', mode(runDir) === '700' ? [] : [`mode ${mode(runDir)}`]);
  add(
    'every output file only readable by the user',
    fs.readdirSync(runDir).filter((f) => mode(path.join(runDir, f)) !== '600').map((f) => `${f}: ${mode(path.join(runDir, f))}`),
  );

  const md = fs.readFileSync(path.join(runDir, 'test-document.anon.md'), 'utf8');
  const gold = fs.readFileSync(DEV_GOLD, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  add(
    'Markdown: no personal data left (categories on by default)',
    gold.filter((g) => g.should_match && SCOPE.has(g.type) && containsWord(md, g.text)).map((g) => `${g.text} (${g.type})`),
  );
  add(
    'Markdown: birth dates and links to a person masked by default',
    [...BIRTH_DATES, 'linkedin.com/in/fatima-el-amrani-8812'].filter((v) => containsWord(md, v)),
  );

  const originals = JSON.parse(fs.readFileSync(path.join(INPUT, 'intake.originals.json'), 'utf8'));
  const docx = path.join(runDir, 'intake.anon.docx');
  const body = docxPart(docx, 'word/document.xml');
  add('Word: no personal data left in the text', originals.body.filter((o) => body.includes(o)));
  const props = docxPart(docx, 'docProps/core.xml');
  add('Word: no personal data left in the document properties', originals.properties.filter((o) => props.includes(o)));

  const auditText = fs.readFileSync(path.join(runDir, 'audit.jsonl'), 'utf8');
  add(
    'audit log holds file names, not full paths',
    [INPUT, OUTDIR, os.homedir()].filter((p) => auditText.includes(p)),
  );
  const audit = auditText.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  add(
    'every accepted replacement was applied',
    audit.filter((a) => a.type === 'file' && a.unreplaced > 0).map((a) => `${a.sourceName}: ${a.unreplaced}`),
  );
  return results;
}

(async () => {
  const inputs = prepareInputs();
  log(process.env.E2E_EXECUTABLE ? `packaged app: ${process.env.E2E_EXECUTABLE}` : 'dev build (out/)');
  const { runDir, restoreDir, consoleErrors, shownVersion } = await driveApp(inputs);
  log(`run directory: ${runDir}`);

  const results = checks(runDir);
  const mode = (p) => (fs.statSync(p).mode & 0o777).toString(8);
  results.push({
    name: 'restore: folder 0700 and every file 0600',
    ok: mode(restoreDir) === '700' && fs.readdirSync(restoreDir).every((f) => mode(path.join(restoreDir, f)) === '600'),
    problems: [restoreDir, ...fs.readdirSync(restoreDir)].map((f) => `${path.basename(f)}: ${mode(path.resolve(restoreDir, f))}`),
  });
  const restoredMd = fs.readFileSync(path.join(restoreDir, 'test-document.teruggezet.md'), 'utf8');
  results.push({
    name: 'restore: Markdown is identical to the original',
    ok: restoredMd === fs.readFileSync(DEV_DOC, 'utf8'),
    problems: ['restored text differs from docs/examples/test-document.md'],
  });
  const wordText = (file) => docxPart(file, 'word/document.xml').replace(/\s+/g, ' ').trim();
  const restoredWord = wordText(path.join(restoreDir, 'intake.teruggezet.docx'));
  results.push({
    name: 'restore: Word text is identical to the original, without the watermark',
    ok: restoredWord === wordText(path.join(INPUT, 'intake.docx')),
    problems: [restoredWord.slice(0, 200)],
  });
  results.push({ name: 'no errors in the renderer console', ok: consoleErrors.length === 0, problems: consoleErrors });
  const version = require(path.join(APP, 'package.json')).version;
  results.push({
    name: 'app shows its own version',
    ok: shownVersion === version,
    problems: [`shows ${shownVersion}, package.json says ${version}`],
  });
  console.log('');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `: ${r.problems.join(', ')}`}`);
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
})().catch((err) => {
  console.error(`E2E aborted: ${err.message}`);
  process.exitCode = 2;
});
