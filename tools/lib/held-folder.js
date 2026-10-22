/* Slaughter Cataloger 3 — a library folder for browser tests, held by the test process (Node), not by
   the page. The page reads it the first time the app touches the folder and sends every change back,
   awaited, so a write is in Node before the app is told it is done; a reload or a new browser
   profile always finds what was last written. (Kept in the page's localStorage instead, a write made
   just before a reload was sometimes missing after it: A3 batch 2, exception X-8.)

   const H = require('./lib/held-folder');
   const run = await H.open(browser, appHtmlPath, { 'name.csv': text, … }, { onPage, noOpen })
     run.page, run.context        the page, with the folder opened in the app (noOpen: the app at its
                                  welcome screen, the folder not yet opened)
     run.folder()                 { files: { name: { text, lastModified } }, dirs: { name: folder } }
     run.reopen(files?)           a new browser profile on the folder as it is now (or on these files),
                                  the folder opened there; returns the new run
     run.close()
   The page side is window.__SC_TEST_FS__, the app's only test hook (js/platform/storage.js). */
'use strict';

function pageFolder() {
  if (window.top !== window) return;               // not inside the Compiler's sandboxed preview frame
  let tree = null;
  const load = async () => { if (!tree) tree = JSON.parse(await window.__heldLoad()); return tree; };
  const persist = () => window.__heldStore(JSON.stringify(tree));
  const notFound = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; };
  const fh = (node, name) => ({ kind: 'file', name, getFile: async () => ({ name, lastModified: node.files[name].lastModified, text: async () => node.files[name].text }),
    createWritable: async () => { let b = ''; return { write: async t => { b += t; }, close: async () => { node.files[name] = { text: b, lastModified: Date.now() }; await persist(); }, abort: async () => {} }; } });
  const dh = (get, name) => ({ kind: 'directory', name, queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    values: async function* () { const node = await get(); for (const n of Object.keys(node.files)) yield fh(node, n); for (const d of Object.keys(node.dirs)) yield dh(async () => node.dirs[d], d); },
    getFileHandle: async (n, o) => { const node = await get(); if (!node.files[n]) { if (!(o && o.create)) throw notFound(); node.files[n] = { text: '', lastModified: Date.now() }; await persist(); } return fh(node, n); },
    getDirectoryHandle: async (n, o) => { const node = await get(); if (!node.dirs[n]) { if (!(o && o.create)) throw notFound(); node.dirs[n] = { files: {}, dirs: {} }; await persist(); } return dh(async () => node.dirs[n], n); },
    removeEntry: async n => { const node = await get(); delete node.files[n]; delete node.dirs[n]; await persist(); } });
  window.__SC_TEST_FS__ = { root: dh(load, 'Test Library'), tree: () => tree };
}

const folderOf = files => ({ files: Object.fromEntries(Object.keys(files).map(n => [n, { text: files[n], lastModified: 1000 }])), dirs: {} });
const textsOf = folder => Object.fromEntries(Object.keys(folder.files).map(n => [n, folder.files[n].text]));

async function open(browser, app, filesOrFolder, opts) {
  opts = opts || {};
  const held = { disk: filesOrFolder && filesOrFolder.files && filesOrFolder.dirs ? JSON.parse(JSON.stringify(filesOrFolder)) : folderOf(filesOrFolder) };
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1360, height: 900 } });
  await context.exposeFunction('__heldLoad', () => JSON.stringify(held.disk));
  await context.exposeFunction('__heldStore', t => { held.disk = JSON.parse(t); });
  const page = await context.newPage();
  if (opts.onPage) opts.onPage(page);
  await page.addInitScript(pageFolder);
  await page.goto('file://' + app);
  if (opts.noOpen) await page.waitForSelector('text=Open library folder');
  else {
    await page.click('text=Open library folder');
    await page.waitForFunction(() => SC.session.ui.mode === 'folder' && !SC.session.ui.busy);
  }
  const run = {
    page, context,
    folder: () => held.disk,
    texts: () => textsOf(held.disk),
    reopen: async files => { const f = files ? folderOf(files) : held.disk; await context.close(); return open(browser, app, f, Object.assign({}, opts, { noOpen: false })); },
    close: () => context.close()
  };
  return run;
}

module.exports = { pageFolder, open, folderOf, textsOf };
