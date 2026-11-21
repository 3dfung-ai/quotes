/**
 * Quotes sync: keeps the shared copy of your Quotes library in your own Google Drive.
 *
 *   Data file : My Drive / 00_Apps / Quotes / quotes-sync.json
 *   Backups   : My Drive / 00_Apps / Quotes / backups /  (rolling, newest 40 kept; older ones go to Drive Trash)
 *
 * One-time setup
 *   1. Run "setup" once (Run button). Allow access when Google asks.
 *   2. Copy the sync key from the Execution log.
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *   4. Paste the Web app link (ends in /exec) and the key into Quotes > Drive sync.
 *
 * The script answers only requests that carry your sync key. The key lives in this
 * script's properties, never in the public Quotes page.
 *
 * Each quote is stored as its own record with a revision number. A device sends a changed
 * quote together with the revision it was based on. If the other PC changed that quote in
 * the meantime, the script refuses the write and returns the current copy, so the device
 * can merge field by field and ask you only when the same field was changed on both.
 */
var APP = 'quotes-sync', VERSION = 1;
var FOLDERS = ['00_Apps', 'Quotes'];
var DATA_FILE = 'quotes-sync.json';
var BACKUP_FOLDER = 'backups';
var KEEP_BACKUPS = 40;
var AUTO_BACKUP_HOURS = 20;

function setup() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('SYNC_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SYNC_KEY', key);
  }
  var file = dataFile_();
  backupFolder_();
  Logger.log('Quotes sync is ready.');
  Logger.log('Sync key: ' + key);
  Logger.log('Data file: ' + file.getUrl());
  Logger.log('Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone). Paste the Web app link and this key into Quotes.');
}

/* Run this only if a setup link was shared by mistake. Every device then needs the new key. */
function newKey() {
  PropertiesService.getScriptProperties().deleteProperty('SYNC_KEY');
  setup();
}

function doGet() {
  return json_({ ok: true, app: APP, v: VERSION, note: 'Quotes sync is running. Use this link inside Quotes.' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  var key = PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
  if (!key || !req || typeof req.key !== 'string' || req.key !== key) return json_({ ok: false, error: 'bad_key' });
  if (req.op === 'ping') return json_({ ok: true, app: APP, v: VERSION });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ ok: false, error: 'busy' });
  try {
    if (req.op === 'sync') return json_(sync_(req));
    if (req.op === 'info') return json_(info_());
    if (req.op === 'backups') return json_(listBackups_());
    if (req.op === 'restore') return json_(restore_(req));
    return json_({ ok: false, error: 'bad_op' });
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code });
    return json_({ ok: false, error: 'server', detail: String((err && err.message) || err).slice(0, 300) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- sync ---------- */
function sync_(req) {
  var file = dataFile_();
  var store = readStore_(file);
  var recs = store.records;
  var now = Date.now();
  var device = String(req.device || '').slice(0, 60);
  var changes = Array.isArray(req.changes) ? req.changes : [];
  var accepted = [], conflicts = [], apply = [], done = {};

  for (var i = 0; i < changes.length; i++) {
    var ch = changes[i];
    if (!ch || typeof ch.id !== 'string' || !ch.id || ch.id.length > 200 || done[ch.id]) continue;
    done[ch.id] = true;
    if (!ch.purge && (!ch.data || typeof ch.data !== 'object' || ch.data.id !== ch.id)) continue;
    var cur = recs[ch.id];
    var base = ch.baseRev === undefined ? null : ch.baseRev;
    // A quote new to the Drive copy is accepted. Otherwise the device must have seen the latest revision.
    if (cur && cur.rev !== base && !(cur.purged && ch.purge)) {
      conflicts.push({ id: ch.id, rev: cur.rev, purged: !!cur.purged, device: cur.device || '', data: cur.purged ? null : cur.data });
      continue;
    }
    if (!cur && ch.purge) { accepted.push({ id: ch.id, rev: null }); continue; }
    apply.push(ch);
  }

  if (apply.length) {
    var due = !store.lastBackupAt || now - store.lastBackupAt > AUTO_BACKUP_HOURS * 3600 * 1000;
    if ((req.backup || due) && Object.keys(recs).length) {
      backup_(file, typeof req.backup === 'string' ? req.backup : 'daily');
      store.lastBackupAt = now;
    }
    for (var j = 0; j < apply.length; j++) {
      var c = apply[j];
      store.rev += 1;
      recs[c.id] = { rev: store.rev, updated: now, device: device, purged: !!c.purge, data: c.purge ? null : c.data };
      accepted.push({ id: c.id, rev: store.rev });
    }
    store.savedAt = new Date(now).toISOString();
    store.savedBy = device;
    file.setContent(JSON.stringify(store));
  }

  var have = req.have && typeof req.have === 'object' ? req.have : {};
  var skip = {};
  accepted.forEach(function (a) { skip[a.id] = true; });
  conflicts.forEach(function (c) { skip[c.id] = true; });
  var updates = [];
  Object.keys(recs).forEach(function (id) {
    var r = recs[id];
    if (skip[id] || have[id] === r.rev) return;
    if (r.purged && have[id] === undefined) return;   // nothing to remove on a device that never had it
    updates.push({ id: id, rev: r.rev, purged: !!r.purged, device: r.device || '', data: r.purged ? null : r.data });
  });
  return {
    ok: true, accepted: accepted, conflicts: conflicts, updates: updates,
    serverRev: store.rev, count: liveCount_(recs), savedAt: store.savedAt || null, savedBy: store.savedBy || '',
    lastBackupAt: store.lastBackupAt || null,
  };
}

function info_() {
  var file = dataFile_();
  var store = readStore_(file);
  return { ok: true, app: APP, v: VERSION, fileUrl: file.getUrl(), count: liveCount_(store.records), serverRev: store.rev,
    savedAt: store.savedAt || null, savedBy: store.savedBy || '', lastBackupAt: store.lastBackupAt || null };
}

function liveCount_(recs) {
  var n = 0;
  Object.keys(recs).forEach(function (id) { var r = recs[id]; if (!r.purged && r.data && !r.data.deleted_at) n++; });
  return n;
}

/* ---------- backups ---------- */
function backup_(file, label) {
  var folder = backupFolder_();
  var stamp = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
  var tag = label ? '_' + String(label).replace(/[^A-Za-z0-9-]/g, '').slice(0, 30) : '';
  folder.createFile('quotes-sync_' + stamp + tag + '.json', file.getBlob().getDataAsString(), 'application/json');
  prune_(folder);
}

function backupFiles_(folder) {
  var files = [], it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (/^quotes-sync_.*\.json$/.test(f.getName())) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  return files;
}

function prune_(folder) {
  backupFiles_(folder).slice(KEEP_BACKUPS).forEach(function (f) { f.setTrashed(true); });
}

function listBackups_() {
  var files = backupFiles_(backupFolder_());
  return { ok: true, backups: files.map(function (f) {
    return { id: f.getId(), name: f.getName(), size: f.getSize(), created: f.getDateCreated().toISOString() };
  }) };
}

/*
  Restoring makes the Drive copy match a backup without destroying anything:
  the current copy is backed up first, quotes in the backup come back as they were,
  and quotes added since that backup move to Trash (restorable), not deleted.
*/
function restore_(req) {
  var folder = backupFolder_();
  var f;
  try { f = DriveApp.getFileById(String(req.fileId || '')); } catch (err) { return { ok: false, error: 'not_found' }; }
  var inside = false, parents = f.getParents();
  while (parents.hasNext()) { if (parents.next().getId() === folder.getId()) inside = true; }
  if (!inside || !/^quotes-sync_.*\.json$/.test(f.getName())) return { ok: false, error: 'not_a_backup' };
  var snap;
  try { snap = JSON.parse(f.getBlob().getDataAsString()); } catch (err) { return { ok: false, error: 'corrupt_backup' }; }
  var srecs = (snap && snap.records) || {};

  var file = dataFile_();
  var store;
  try { store = readStore_(file); } catch (err) {
    // The live file is unreadable: start clean from the backup. Revisions jump past anything
    // a device could hold, so every PC takes the restored copy.
    store = emptyStore_();
    store.rev = Math.max(Number(snap && snap.rev) || 0, Date.now());
  }
  backup_(file, 'before-restore');
  var now = Date.now(), iso = new Date(now).toISOString(), restored = 0, trashed = 0;
  Object.keys(srecs).forEach(function (id) {
    var b = srecs[id];
    if (!b || b.purged || !b.data) return;
    var cur = store.records[id];
    if (cur && !cur.purged && JSON.stringify(cur.data) === JSON.stringify(b.data)) return;
    store.rev += 1;
    store.records[id] = { rev: store.rev, updated: now, device: 'restore', purged: false, data: b.data };
    restored++;
  });
  Object.keys(store.records).forEach(function (id) {
    var cur = store.records[id];
    if (cur.purged || !cur.data || cur.data.deleted_at) return;
    var b = srecs[id];
    if (b && !b.purged && b.data) return;
    var d = JSON.parse(JSON.stringify(cur.data));
    d.deleted_at = iso;
    store.rev += 1;
    store.records[id] = { rev: store.rev, updated: now, device: 'restore', purged: false, data: d };
    trashed++;
  });
  store.lastBackupAt = now;
  store.savedAt = iso;
  store.savedBy = 'restore';
  file.setContent(JSON.stringify(store));
  return { ok: true, restored: restored, trashed: trashed, serverRev: store.rev, from: f.getName() };
}

/* ---------- storage ---------- */
function emptyStore_() { return { app: APP, schema: 1, rev: 0, records: {} }; }

function readStore_(file) {
  var raw = file.getBlob().getDataAsString();
  if (!raw || !raw.trim()) return emptyStore_();
  var s;
  // Never overwrite a file that can't be read: that would replace your library with nothing.
  try { s = JSON.parse(raw); } catch (err) { throw { code: 'corrupt_store' }; }
  if (!s || typeof s !== 'object' || (s.records && typeof s.records !== 'object')) throw { code: 'corrupt_store' };
  s.records = s.records || {};
  s.rev = s.rev || 0;
  s.app = APP; s.schema = 1;
  return s;
}

function quotesFolder_() {
  var folder = DriveApp.getRootFolder();
  FOLDERS.forEach(function (name) {
    var it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

function dataFile_() {
  var folder = quotesFolder_();
  var it = folder.getFilesByName(DATA_FILE);
  if (it.hasNext()) return it.next();
  return folder.createFile(DATA_FILE, JSON.stringify(emptyStore_()), 'application/json');
}

function backupFolder_() {
  var parent = quotesFolder_();
  var it = parent.getFoldersByName(BACKUP_FOLDER);
  return it.hasNext() ? it.next() : parent.createFolder(BACKUP_FOLDER);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
