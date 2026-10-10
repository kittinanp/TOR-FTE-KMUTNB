/**
 * TOR Builder — ตัวเชื่อม Google Drive (Google Apps Script Web App)
 *
 * วิธีติดตั้งโดยย่อ (ดูละเอียดใน README.md):
 *  1) วางโค้ดนี้ใน https://script.google.com (โปรเจกต์ใหม่)
 *  2) เปลี่ยน TEAM_KEY ด้านล่างเป็นรหัสทีมของคุณ
 *  3) เลือกฟังก์ชัน setup แล้วกด Run (อนุญาตสิทธิ์ครั้งแรก)
 *  4) Deploy > New deployment > Web app
 *     - Execute as: Me   - Who has access: Anyone
 *  5) คัดลอก Web app URL (ลงท้ายด้วย /exec) ไปใส่ในหน้า “ตั้งค่า > Google Drive” ของระบบ
 *
 * ข้อมูลทั้งหมดถูกเก็บในโฟลเดอร์ “TOR Builder” บน Google Drive ของบัญชีที่ Deploy
 */

// ★ เปลี่ยนเป็นรหัสทีมของคุณ (ห้ามใช้ค่าเริ่มต้นนี้) — ผู้ใช้ต้องกรอกรหัสนี้ในระบบจึงจะอ่าน/เขียนได้
const TEAM_KEY = 'CHANGE-ME';

const ROOT_NAME = 'TOR Builder';
const DATA_FOLDER = 'ข้อมูลระบบ (ห้ามแก้ไขไฟล์ในนี้)';
const WORD_FOLDER = 'เอกสาร Word';

/** รันครั้งแรกเพื่อสร้างโฟลเดอร์และอนุญาตสิทธิ์ */
function setup() {
  if (teamKey_() === 'CHANGE-ME') throw new Error('กรุณาเปลี่ยน TEAM_KEY ในบรรทัดบนสุดก่อน');
  const root = root_();
  sub_(DATA_FOLDER);
  sub_(WORD_FOLDER);
  Logger.log('พร้อมใช้งาน — โฟลเดอร์: ' + root.getUrl());
}

function doGet() {
  return out_({ ok: true, app: 'TOR Builder Drive', message: 'ตัวเชื่อมทำงานปกติ (ระบบเรียกใช้ผ่าน POST)' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' }); }
  if (teamKey_() === 'CHANGE-ME') return out_({ ok: false, error: 'ผู้ดูแลยังไม่ได้ตั้ง TEAM_KEY ใน Apps Script' });
  if (req.key !== teamKey_()) return out_({ ok: false, auth: true, error: 'รหัสทีมไม่ถูกต้อง' });

  const writes = ['save', 'delete', 'saveFile'];
  const lock = LockService.getScriptLock();
  try {
    if (writes.indexOf(req.action) >= 0) lock.waitLock(20000);
    switch (req.action) {
      case 'ping':     return out_({ ok: true, folderUrl: root_().getUrl(), wordUrl: sub_(WORD_FOLDER).getUrl(), owner: Session.getEffectiveUser().getEmail() });
      case 'list':     return out_({ ok: true, items: list_() });
      case 'get':      return out_(get_(req.id));
      case 'save':     return out_(save_(req.doc, req.baseRev, req.force));
      case 'delete':   return out_(del_(req.id));
      case 'saveFile': return out_(saveFile_(req));
      default:         return out_({ ok: false, error: 'ไม่รู้จักคำสั่ง ' + req.action });
    }
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* ---------------- งานเอกสาร ---------------- */

function list_() {
  const items = [];
  const it = sub_(DATA_FOLDER).getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (!/\.json$/.test(f.getName())) continue;
    try { const s = JSON.parse(f.getDescription() || '{}'); if (s.id) items.push(s); } catch (e) {}
  }
  return items;
}

function get_(id) {
  const f = file_(id);
  if (!f) return { ok: false, error: 'ไม่พบเอกสารใน Google Drive (อาจถูกลบแล้ว)' };
  const s = JSON.parse(f.getDescription() || '{}');
  return { ok: true, doc: JSON.parse(f.getBlob().getDataAsString('UTF-8')), rev: s.rev || 0, summary: s };
}

/** บันทึกโดยตรวจว่ามีคนอื่นบันทึกแทรกหรือไม่ (เทียบเลขรุ่น rev) */
function save_(doc, baseRev, force) {
  if (!doc || !doc.id) return { ok: false, error: 'ไม่มีข้อมูลเอกสาร' };
  const f = file_(doc.id);
  let rev = 0;
  if (f) {
    const cur = JSON.parse(f.getDescription() || '{}');
    rev = cur.rev || 0;
    if (!force && baseRev !== rev) return { ok: false, conflict: true, remote: cur };
  }
  const s = {
    id: doc.id, name: doc.name || '', type: doc.type || '', status: doc.status || 'draft',
    budget: doc.budget || '', place: doc.place || '', updated: doc.updated || Date.now(),
    updatedBy: doc._savedBy || '', savedAt: Date.now(), rev: rev + 1
  };
  const body = JSON.stringify(doc);
  if (f) { f.setContent(body); f.setDescription(JSON.stringify(s)); }
  else { sub_(DATA_FOLDER).createFile(doc.id + '.json', body, 'application/json').setDescription(JSON.stringify(s)); }
  return { ok: true, summary: s };
}

/** ย้ายไปถังขยะของ Drive (กู้คืนได้ภายใน 30 วัน) */
function del_(id) {
  const f = file_(id);
  if (f) f.setTrashed(true);
  return { ok: true };
}

/** บันทึกไฟล์ Word ลงโฟลเดอร์ “เอกสาร Word” (ไฟล์ชื่อเดิมจะถูกย้ายไปถังขยะ) */
function saveFile_(req) {
  if (!req.name || !req.base64) return { ok: false, error: 'ไม่มีไฟล์' };
  const folder = sub_(WORD_FOLDER);
  const old = folder.getFilesByName(req.name);
  while (old.hasNext()) old.next().setTrashed(true);
  const blob = Utilities.newBlob(Utilities.base64Decode(req.base64), req.mime || 'application/octet-stream', req.name);
  const f = folder.createFile(blob);
  if (req.docId) f.setDescription('TOR Builder · ' + req.docId);
  return { ok: true, url: f.getUrl(), id: f.getId() };
}

/* ---------------- ตัวช่วย ---------------- */

function teamKey_() {
  return PropertiesService.getScriptProperties().getProperty('TEAM_KEY') || TEAM_KEY;
}

function root_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ROOT_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  const folder = DriveApp.createFolder(ROOT_NAME);
  props.setProperty('ROOT_ID', folder.getId());
  return folder;
}

function sub_(name) {
  const root = root_();
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function file_(id) {
  if (!id || !/^[a-z0-9]+$/i.test(id)) return null;
  const it = sub_(DATA_FOLDER).getFilesByName(id + '.json');
  return it.hasNext() ? it.next() : null;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
