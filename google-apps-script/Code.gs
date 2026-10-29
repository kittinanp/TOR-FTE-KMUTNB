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
 *
 * เข้าสู่ระบบด้วย ICIT Account (KMUTNB SSO) — ตั้งค่าใน Project Settings > Script Properties
 *   SSO_CLIENT_ID       = Client ID ที่ได้จาก https://sso.kmutnb.ac.th (เมนูสำหรับนักพัฒนา)
 *   SSO_CLIENT_SECRET   = Client Secret (เก็บที่นี่ที่เดียว ห้ามใส่ในหน้าเว็บ)
 *   ALLOWED_ACCOUNT_TYPES = personnel            (ไม่บังคับ — ค่าเริ่มต้น personnel, คั่นด้วย , เช่น personnel,student)
 *   ALLOWED_USERS       = user1,user2@kmutnb.ac.th (ไม่บังคับ — ถ้าใส่ จะให้เข้าได้เฉพาะรายชื่อนี้)
 *   ALLOWED_ORG         = ครุศาสตร์อุตสาหกรรม     (ไม่บังคับ — จำกัดเฉพาะหน่วยงานที่มีคำนี้)
 *   REVIEWERS           = รายชื่อ username/อีเมล นักวิชาการพัสดุ (ได้สิทธิ์ผู้ตรวจสอบ)
 *   ADMINS              = รายชื่อผู้ดูแลระบบ (ได้ทุกสิทธิ์)
 * เมื่อใส่ SSO_CLIENT_ID แล้ว ระบบจะบังคับเข้าสู่ระบบด้วย ICIT Account แทนรหัสทีม
 *
 * เข้าสู่ระบบด้วย Google (Gmail / บัญชี Google Workspace เช่น @fte.kmutnb.ac.th)
 *   GOOGLE_CLIENT_ID    = OAuth Client ID (Web) จาก Google Cloud Console — ไม่ต้องใช้ secret
 *   ALLOWED_DOMAINS     = fte.kmutnb.ac.th,email.kmutnb.ac.th   (อนุญาตทุกบัญชีในโดเมนเหล่านี้)
 *   ALLOWED_USERS       = someone@gmail.com,...                 (อนุญาตรายบุคคล — ใช้ร่วมกับ ICIT ได้)
 *   ถ้าไม่ใส่ทั้งสองค่า จะเข้าได้เฉพาะเจ้าของสคริปต์ และรายชื่อใน ADMINS / REVIEWERS เท่านั้น (ปลอดภัยไว้ก่อน)
 * เปิดได้พร้อมกันทั้ง ICIT และ Google — หน้าเข้าสู่ระบบจะแสดงทั้งสองปุ่ม
 */

// ★ เปลี่ยนเป็นรหัสทีมของคุณ (ห้ามใช้ค่าเริ่มต้นนี้) — ผู้ใช้ต้องกรอกรหัสนี้ในระบบจึงจะอ่าน/เขียนได้
const TEAM_KEY = 'CHANGE-ME';

const ROOT_NAME = 'TOR Builder';
const SSO = {
  authorize: 'https://sso.kmutnb.ac.th/auth/authorize',
  token: 'https://sso.kmutnb.ac.th/auth/token',
  userinfo: 'https://sso.kmutnb.ac.th/resources/userinfo',
  scope: 'openid profile email personnel_info'
};
const SESSION_HOURS = 12;
const DATA_FOLDER = 'ข้อมูลระบบ (ห้ามแก้ไขไฟล์ในนี้)';
const WORD_FOLDER = 'เอกสาร Word';

/** รันครั้งแรกเพื่อสร้างโฟลเดอร์และอนุญาตสิทธิ์ */
function setup() {
  if (!authOn_() && teamKey_() === 'CHANGE-ME') throw new Error('กรุณาเปลี่ยน TEAM_KEY ในบรรทัดบนสุด หรือใส่ GOOGLE_CLIENT_ID / SSO_CLIENT_ID ใน Script Properties ก่อน');
  secret_();
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
  // คำสั่งที่ไม่ต้องยืนยันตัวตน
  if (req.action === 'config') return out_(config_());
  if (req.action === 'login') { try { return out_(login_(req)); } catch (err) { return out_({ ok: false, error: String(err.message || err) }); } }
  if (req.action === 'googleLogin') { try { return out_(googleLogin_(req)); } catch (err) { return out_({ ok: false, error: String(err.message || err) }); } }

  let user = null;
  if (authOn_()) {
    user = verify_(req.session);
    if (!user) return out_({ ok: false, auth: true, relogin: true, error: 'กรุณาเข้าสู่ระบบด้วย ICIT Account อีกครั้ง' });
  } else {
    if (teamKey_() === 'CHANGE-ME') return out_({ ok: false, error: 'ผู้ดูแลยังไม่ได้ตั้ง TEAM_KEY ใน Apps Script' });
    if (req.key !== teamKey_()) return out_({ ok: false, auth: true, error: 'รหัสทีมไม่ถูกต้อง' });
  }

  const writes = ['save', 'delete', 'saveFile'];
  const lock = LockService.getScriptLock();
  try {
    if (writes.indexOf(req.action) >= 0) lock.waitLock(20000);
    switch (req.action) {
      case 'ping':     return out_({ ok: true, folderUrl: root_().getUrl(), wordUrl: sub_(WORD_FOLDER).getUrl(), owner: Session.getEffectiveUser().getEmail() });
      case 'list':     return out_({ ok: true, items: list_() });
      case 'get':      return out_(get_(req.id));
      case 'me':       return out_({ ok: true, user: user });
      case 'save':     return out_(save_(req.doc, req.baseRev, req.force, user));
      case 'delete':   return out_(del_(req.id));
      case 'saveFile': return out_(saveFile_(req));
      case 'ai':       return out_(ai_(req));
      case 'aiModels': return out_(aiModels_());
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
function save_(doc, baseRev, force, user) {
  if (!doc || !doc.id) return { ok: false, error: 'ไม่มีข้อมูลเอกสาร' };
  const f = file_(doc.id);
  let rev = 0, prevStatus = '';
  if (f) {
    const cur = JSON.parse(f.getDescription() || '{}');
    rev = cur.rev || 0; prevStatus = cur.status || '';
    if (!force && baseRev !== rev) return { ok: false, conflict: true, remote: cur };
  }
  if (user) {
    // ชื่อผู้บันทึกมาจากบัญชี ICIT ไม่ใช่ชื่อที่พิมพ์เอง
    doc._savedBy = user.name; doc._savedByUser = user.username;
    // เฉพาะผู้ตรวจสอบ / ผู้ดูแล ที่ให้ “ผ่านการตรวจ” ได้
    if (doc.status === 'done' && prevStatus !== 'done' && user.role === 'maker')
      return { ok: false, error: 'บัญชีของคุณไม่มีสิทธิ์ให้ “ผ่านการตรวจ” — ติดต่อผู้ดูแลเพื่อขอสิทธิ์ผู้ตรวจสอบ' };
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

/* ---------------- AI (OpenRouter หรือบริการที่ใช้รูปแบบ OpenAI) ----------------
 * ตั้งค่าใน Project Settings > Script Properties
 *   AI_KEY   = API key (เช่น key ของ OpenRouter)            ← จำเป็น
 *   AI_BASE  = https://openrouter.ai/api/v1  (ค่าเริ่มต้น)   ← เปลี่ยนได้ เช่น https://api.opentyphoon.ai/v1
 *   AI_MODEL = โมเดลเริ่มต้น ถ้าผู้ใช้ไม่ได้เลือก             ← ไม่บังคับ
 * API key อยู่ฝั่ง Google เท่านั้น ผู้ใช้ในทีมไม่เห็น key
 */
function aiConf_() {
  const p = PropertiesService.getScriptProperties();
  return { key: p.getProperty('AI_KEY'), base: (p.getProperty('AI_BASE') || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''), model: p.getProperty('AI_MODEL') || '' };
}

function ai_(req) {
  const c = aiConf_();
  if (!c.key) return { ok: false, error: 'ผู้ดูแลยังไม่ได้ใส่ AI_KEY ใน Script Properties ของ Apps Script' };
  const model = req.model || c.model;
  if (!model) return { ok: false, error: 'ยังไม่ได้เลือกโมเดล AI' };
  const res = UrlFetchApp.fetch(c.base + '/chat/completions', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + c.key, 'X-Title': 'TOR Builder', 'HTTP-Referer': 'https://github.com/kittinanp/TOR-FTE-KMUTNB' },
    payload: JSON.stringify({ model: model, messages: req.messages || [], temperature: req.temperature == null ? 0.2 : req.temperature, max_tokens: req.max_tokens || 4000 })
  });
  const code = res.getResponseCode();
  let j; try { j = JSON.parse(res.getContentText()); } catch (e) { return { ok: false, error: 'AI ตอบกลับไม่ถูกต้อง (' + code + ')' }; }
  if (code >= 300 || j.error) return { ok: false, error: 'AI: ' + ((j.error && (j.error.message || j.error)) || code) };
  return { ok: true, content: j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '', model: j.model || model, usage: j.usage || null };
}

function aiModels_() {
  const c = aiConf_();
  const res = UrlFetchApp.fetch(c.base + '/models', { muteHttpExceptions: true, headers: c.key ? { Authorization: 'Bearer ' + c.key } : {} });
  let j; try { j = JSON.parse(res.getContentText()); } catch (e) { return { ok: false, error: 'โหลดรายชื่อโมเดลไม่ได้' }; }
  const list = (j.data || []).map(function (m) { return { id: m.id, name: m.name || m.id }; });
  return { ok: true, models: list, hasKey: !!c.key, defaultModel: c.model };
}

/* ---------------- เข้าสู่ระบบด้วย ICIT Account (KMUTNB SSO / OpenID Connect) ---------------- */

function ssoOn_() { return !!prop_('SSO_CLIENT_ID'); }
function googleOn_() { return !!prop_('GOOGLE_CLIENT_ID'); }
function authOn_() { return ssoOn_() || googleOn_(); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function list_prop_(k) { return String(prop_(k) || '').split(/[,\s]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(String); }

function config_() {
  return { ok: true, sso: ssoOn_(), clientId: prop_('SSO_CLIENT_ID') || '', authorize: SSO.authorize, scope: SSO.scope,
    google: googleOn_(), googleClientId: prop_('GOOGLE_CLIENT_ID') || '', auth: authOn_(), teamKey: !authOn_() };
}

function login_(req) {
  if (!ssoOn_()) return { ok: false, error: 'ยังไม่ได้เปิดใช้ SSO' };
  if (!req.code || !req.redirect_uri) return { ok: false, error: 'ข้อมูลเข้าสู่ระบบไม่ครบ' };
  const res = UrlFetchApp.fetch(SSO.token, {
    method: 'post', muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(prop_('SSO_CLIENT_ID') + ':' + prop_('SSO_CLIENT_SECRET')) },
    payload: { grant_type: 'authorization_code', code: req.code, redirect_uri: req.redirect_uri, code_verifier: req.verifier || '' }
  });
  let tok; try { tok = JSON.parse(res.getContentText()); } catch (e) { tok = {}; }
  if (!tok.access_token) return { ok: false, error: 'SSO ปฏิเสธการเข้าสู่ระบบ: ' + (tok.error_description || tok.error || res.getResponseCode()) };

  const ui = JSON.parse(UrlFetchApp.fetch(SSO.userinfo, { headers: { Authorization: 'Bearer ' + tok.access_token }, muteHttpExceptions: true }).getContentText() || '{}');
  const username = String(ui.preferred_username || ui.username || ui.sub || '').toLowerCase();
  if (!username) return { ok: false, error: 'ไม่ได้รับข้อมูลผู้ใช้จาก SSO' };
  const email = String(ui.email || '').toLowerCase();
  const type = String(ui.kmutnb_account_type || ui.account_type || '').toLowerCase();
  const info = ui.kmutnb_personnel_info || ui.personnel_info || {};
  const org = pickOrg_(info);
  const name = ui.name || ui.display_name || [ui.given_name, ui.family_name].filter(String).join(' ') || username;

  const types = list_prop_('ALLOWED_ACCOUNT_TYPES'); if (!types.length) types.push('personnel');
  if (type && types.indexOf(type) < 0) return { ok: false, error: 'บัญชีประเภท “' + type + '” ไม่ได้รับอนุญาตให้ใช้ระบบนี้' };
  const ids = [username, email].filter(String);
  const allowed = list_prop_('ALLOWED_USERS');
  if (allowed.length && !ids.some(function (x) { return allowed.indexOf(x) >= 0; })) return { ok: false, error: 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน — ติดต่อผู้ดูแลระบบ' };
  const needOrg = prop_('ALLOWED_ORG');
  if (needOrg && JSON.stringify(info).indexOf(needOrg) < 0 && org.indexOf(needOrg) < 0) return { ok: false, error: 'ระบบนี้สำหรับบุคลากร' + needOrg + 'เท่านั้น' };

  const inList = function (k) { const l = list_prop_(k); return ids.some(function (x) { return l.indexOf(x) >= 0; }); };
  const role = inList('ADMINS') ? 'admin' : inList('REVIEWERS') ? 'reviewer' : 'maker';
  const user = { username: username, name: name, email: email, type: type, org: org, role: role };
  logLogin_(user);
  return { ok: true, user: user, session: sign_(user) };
}

/** เข้าสู่ระบบด้วย Google: ตรวจ ID token กับ Google แล้วออกเซสชันของระบบ */
function googleLogin_(req) {
  if (!googleOn_()) return { ok: false, error: 'ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วย Google' };
  if (!req.credential) return { ok: false, error: 'ไม่ได้รับข้อมูลจาก Google' };
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(req.credential), { muteHttpExceptions: true });
  let t; try { t = JSON.parse(res.getContentText()); } catch (e) { t = {}; }
  if (res.getResponseCode() !== 200 || !t.email) return { ok: false, error: 'Google ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่' };
  if (t.aud !== prop_('GOOGLE_CLIENT_ID')) return { ok: false, error: 'ข้อมูลเข้าสู่ระบบไม่ได้ออกให้ระบบนี้' };
  if (['accounts.google.com', 'https://accounts.google.com'].indexOf(t.iss) < 0) return { ok: false, error: 'ผู้ออกข้อมูลไม่ถูกต้อง' };
  if (String(t.email_verified) !== 'true') return { ok: false, error: 'อีเมลนี้ยังไม่ได้ยืนยันกับ Google' };
  if (Number(t.exp) * 1000 < Date.now()) return { ok: false, error: 'ข้อมูลเข้าสู่ระบบหมดอายุ กรุณาลองใหม่' };

  const email = String(t.email).toLowerCase(), domain = String(t.hd || email.split('@')[1] || '').toLowerCase();
  const users = list_prop_('ALLOWED_USERS'), domains = list_prop_('ALLOWED_DOMAINS');
  const inList = function (k) { return list_prop_(k).indexOf(email) >= 0; };
  const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const allowed = users.indexOf(email) >= 0 || domains.indexOf(domain) >= 0 || email === owner || inList('ADMINS') || inList('REVIEWERS');
  if (!allowed) return { ok: false, error: 'บัญชี ' + email + ' ยังไม่ได้รับสิทธิ์ใช้งาน — แจ้งผู้ดูแลระบบให้เพิ่มอีเมลนี้' };

  const role = (inList('ADMINS') || email === owner) ? 'admin' : inList('REVIEWERS') ? 'reviewer' : 'maker';
  const user = { username: email, name: t.name || email, email: email, type: 'google', org: t.hd || '', role: role, provider: 'google', picture: t.picture || '' };
  logLogin_(user);
  return { ok: true, user: user, session: sign_(user) };
}

function pickOrg_(info) {
  if (!info || typeof info !== 'object') return '';
  const keys = ['faculty_name', 'faculty', 'department_name', 'department', 'division_name', 'unit_name', 'org_name'];
  for (let i = 0; i < keys.length; i++) { const v = info[keys[i]]; if (v) return typeof v === 'string' ? v : (v.name || v.name_th || ''); }
  return '';
}

function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SESSION_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SESSION_SECRET', s); }
  return s;
}

function sign_(user) {
  const body = Utilities.base64EncodeWebSafe(JSON.stringify({ u: user, exp: Date.now() + SESSION_HOURS * 3600 * 1000 }), Utilities.Charset.UTF_8);
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, secret_()));
  return body + '.' + sig;
}

function verify_(session) {
  if (!session || session.indexOf('.') < 0) return null;
  const parts = session.split('.');
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], secret_()));
  if (sig !== parts[1]) return null;
  try {
    const p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
    return p.exp > Date.now() ? p.u : null;
  } catch (e) { return null; }
}

/** บันทึกประวัติการเข้าสู่ระบบ (ไฟล์ข้อความในโฟลเดอร์ข้อมูลระบบ) */
function logLogin_(user) {
  try {
    const name = 'login-log.txt', folder = sub_(DATA_FOLDER), it = folder.getFilesByName(name);
    const line = new Date().toISOString() + '\t' + user.username + '\t' + user.name + '\t' + user.role + '\n';
    if (it.hasNext()) { const f = it.next(); const t = f.getBlob().getDataAsString('UTF-8'); f.setContent((t + line).slice(-200000)); }
    else folder.createFile(name, line, 'text/plain');
  } catch (e) {}
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
