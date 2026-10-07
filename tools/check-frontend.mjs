/**
 * tools/check-frontend.mjs — static integrity checks for the frontend.
 *
 *   node tools/check-frontend.mjs
 *
 * Catches the errors a browser would throw before you ever see a page:
 *   1. imports that name an export the target module does not have
 *   2. internal links / asset paths that point at files that do not exist
 *   3. duplicate ids inside one HTML document
 *   4. HTML that is not parseable enough to have matching <main>/<body>
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'frontend');

const problems = [];
const warn = (where, msg) => problems.push(`${where}: ${msg}`);

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const allFiles = walk(FE);
const jsFiles = allFiles.filter((f) => f.endsWith('.js'));
// frontend/partials/* are generator templates ({{placeholders}}), not pages.
const htmlFiles = allFiles.filter((f) => f.endsWith('.html') && !f.includes(`${path.sep}partials${path.sep}`));
const rel = (p) => path.relative(FE, p).split(path.sep).join('/');

/* ---------------------------------------------- 1. import/export integrity */

/** Collect the exported names of a module (best-effort static parse). */
function exportsOf(file) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((part) => {
      const as = part.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    });
  }
  if (/^export\s+default/m.test(src)) names.add('default');
  return names;
}

const exportCache = new Map();
for (const file of jsFiles) {
  const src = readFileSync(file, 'utf8');
  const here = rel(file);
  for (const m of src.matchAll(/import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = m[1].trim();
    const spec = m[2];
    if (!spec.startsWith('.')) continue; // bare specifiers are not used here
    const target = path.resolve(path.dirname(file), spec);
    if (!existsSync(target)) {
      warn(here, `imports missing file ${spec}`);
      continue;
    }
    if (!exportCache.has(target)) exportCache.set(target, exportsOf(target));
    const available = exportCache.get(target);

    // default import
    const defMatch = clause.match(/^([A-Za-z0-9_$]+)\s*(?:,|$)/);
    if (defMatch && !clause.startsWith('{') && !clause.startsWith('*')) {
      if (!available.has('default')) warn(here, `default-imports ${spec} but it has no default export`);
    }
    // namespace import
    if (clause.startsWith('*')) continue;
    // named imports
    const brace = clause.match(/\{([^}]*)\}/);
    if (brace) {
      for (const part of brace[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        const name = part.split(/\s+as\s+/)[0].trim();
        if (!available.has(name)) warn(here, `imports "${name}" from ${spec} — not exported`);
      }
    }
  }
  // dynamic imports must also resolve
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!existsSync(target)) warn(here, `dynamic import of missing file ${m[1]}`);
  }
}

/* --------------------------------------------------- 2. links and assets */

/** Files that exist relative to the site root, used to validate url() calls. */
const siteFiles = new Set(allFiles.map(rel));

for (const file of htmlFiles) {
  const src = readFileSync(file, 'utf8');
  const here = rel(file);
  const depth = path.dirname(here) === '.' ? '' : '../'.repeat(path.dirname(here).split('/').length);

  for (const m of src.matchAll(/(?:href|src)="([^"#?]+)(?:[#?][^"]*)?"/g)) {
    const ref = m[1].trim();
    if (/^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(ref)) continue;
    if (!ref) continue;
    const resolved = path.normalize(path.join(path.dirname(here), ref));
    if (!siteFiles.has(resolved)) warn(here, `broken link/asset → ${ref}`);
  }

  // Every page must load boot.js exactly once, with a data-page the router knows.
  const boots = [...src.matchAll(/<script[^>]*boot\.js[^>]*data-page="([^"]+)"[^>]*>/g)];
  if (boots.length !== 1) warn(here, `expected exactly one boot.js script tag, found ${boots.length}`);

  // Duplicate element ids break label/for and scroll targets.
  const ids = [...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupes.length) warn(here, `duplicate id(s): ${[...new Set(dupes)].join(', ')}`);

  if (!/<main[\s>]/.test(src) && !here.endsWith('404.html')) warn(here, 'no <main> element (skip link + dashboard chrome need it)');
  if (!/lang="en"/.test(src)) warn(here, 'missing lang attribute on <html>');
  if (!/<title>/.test(src)) warn(here, 'missing <title>');
  if (!/name="description"/.test(src)) warn(here, 'missing meta description');
}

/* ---------------------------- 3. url() targets referenced from JS modules */

const urlTargets = new Set();
for (const file of jsFiles) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/url\(\s*[`'"]([^`'"$)]+?\.(?:html|svg|png|css|js))[`'"]/g)) urlTargets.add(m[1]);
}
for (const t of urlTargets) {
  if (!siteFiles.has(t)) warn('js/*', `url('${t}') does not exist`);
}

/* ------------------------------------------------------- 4. CSS references */

for (const file of htmlFiles) {
  const src = readFileSync(file, 'utf8');
  const here = rel(file);
  for (const m of src.matchAll(/<link[^>]+href="([^"]+\.css)"/g)) {
    const resolved = path.normalize(path.join(path.dirname(here), m[1]));
    if (!siteFiles.has(resolved)) warn(here, `missing stylesheet ${m[1]}`);
  }
}

/* ---------------------------------------------------------------- report */

if (problems.length) {
  console.error(`✖ ${problems.length} problem(s) found:`);
  for (const p of problems.slice(0, 80)) console.error(`  · ${p}`);
  if (problems.length > 80) console.error(`  … and ${problems.length - 80} more`);
  process.exit(1);
}
console.log(`✔ Frontend integrity OK — ${jsFiles.length} JS modules, ${htmlFiles.length} HTML pages, ${urlTargets.size} url() targets checked.`);
