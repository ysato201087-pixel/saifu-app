'use strict';

/* ================================================================
   定数
   ================================================================ */
const KEY = 'kakeibo_v2';
const OLD_KEY = 'kakeibo_v1';
const DEVICE_KEY = 'kakeibo_device';
const BACKUP_KEY = 'kakeibo_backup_prev';
const VERSION = 2;
const MAX = 9999999;
const COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#30B0C7',
  '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E', '#8E8E93',
];
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const RE_YM = /^\d{4}-\d{2}$/;
const RE_COLOR = /^#[0-9A-Fa-f]{6}$/;
const UNKNOWN = {
  id: '__unknown', name: '不明', color: '#8E8E93', order: 1e9, mode: 'keep',
  startDay: null, budgets: [], createdAt: '0000-01-01', deletedAt: '0000-01-01',
};
const COARSE = window.matchMedia('(pointer: coarse)').matches;

/* ================================================================
   日付ユーティリティ(必ずローカル時刻で扱う)
   ================================================================ */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const thisMonth = () => todayStr().slice(0, 7);
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${y}年${m}月`; };
const dayLabel = s => { const d = parseYmd(s); return `${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})`; };
const md = s => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const isLastDay = s => { const d = parseYmd(s); return d.getDate() === daysIn(s.slice(0, 7)); };
const monthStartMs = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).getTime(); };

/* ================================================================
   表示ユーティリティ
   ================================================================ */
const yen = n => (n < 0 ? '−' : '') + '¥' + Math.abs(n).toLocaleString('ja-JP');
const shortYen = n => {
  if (n >= 1000000) return Math.floor(n / 10000) + '万';
  if (n >= 10000) return (Math.round(n / 1000) / 10).toString().replace(/\.0$/, '') + '万';
  return n.toLocaleString('ja-JP');
};
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const $ = s => document.querySelector(s);

/** DOM 生成。文字列の子要素は必ずテキストノードになる(innerHTML は使わない) */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const colorOf = w => (RE_COLOR.test(w.color) ? w.color : '#8E8E93');

/* ================================================================
   電卓の計算(自前の四則演算パーサ。eval は使わない)
   ================================================================ */
function normalizeExpr(str) {
  return String(str)
    .replace(/[０-９．]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[＋]/g, '+')
    .replace(/[－−ー–]/g, '-')
    .replace(/[×＊xX]/g, '*')
    .replace(/[÷／]/g, '/')
    .replace(/[,，¥￥\s]/g, '');
}
const hasOperator = str => /[+\-*/]/.test(normalizeExpr(str).replace(/^-/, ''));

/** 式を計算して整数(四捨五入)を返す。不正な式・0除算は null */
function evalExpr(str) {
  const s = normalizeExpr(str);
  if (!s || !/^[-+*/\d.]+$/.test(s)) return null;
  let i = 0;
  const num = () => {
    let sign = 1;
    while (s[i] === '-' || s[i] === '+') { if (s[i] === '-') sign = -sign; i++; }
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i));
    if (!m) throw new Error();
    i += m[0].length;
    return sign * parseFloat(m[0]);
  };
  const term = () => {
    let v = num();
    while (s[i] === '*' || s[i] === '/') {
      const op = s[i++];
      const r = num();
      if (op === '*') v *= r;
      else { if (r === 0) throw new Error(); v /= r; }
    }
    return v;
  };
  const expr = () => {
    let v = term();
    while (s[i] === '+' || s[i] === '-') {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = expr();
    if (i !== s.length || !Number.isFinite(v)) return null;
    return Math.round(v);
  } catch {
    return null;
  }
}
const amountOf = (str, min) => { const n = evalExpr(str); return n !== null && n >= min && n <= MAX ? n : null; };

/* ================================================================
   データ層
   ================================================================ */
const emptyData = () => ({ version: VERSION, wallets: [], txs: [], lastWalletId: null, lastExportedAt: null });

/** 旧形式(v1: ジャンル・月予算)→ v2(サイフ)への変換 */
function migrateV1(d) {
  if (!Array.isArray(d.categories) || !Array.isArray(d.expenses)) throw new Error('形式が正しくありません');
  const today = todayStr();
  const wallets = d.categories.map((c, i) => {
    const budgets = (Array.isArray(c.budgets) ? c.budgets : [])
      .filter(b => b && RE_YM.test(b.from))
      .map(b => ({ from: `${b.from}-01`, amount: b.amount }));
    const dates = [
      ...budgets.map(b => b.from),
      ...d.expenses.filter(e => e && e.categoryId === c.id && RE_YMD.test(e.date)).map(e => e.date),
    ].sort();
    return {
      id: c.id, name: c.name, color: c.color, order: typeof c.order === 'number' ? c.order : i,
      mode: 'period', startDay: 1,
      budgets: budgets.length ? budgets : [{ from: `${today.slice(0, 7)}-01`, amount: 0 }],
      createdAt: dates[0] || today,
      deletedAt: c.deletedFrom && RE_YM.test(c.deletedFrom) ? `${c.deletedFrom}-01` : null,
    };
  });
  const txs = d.expenses.map(e => ({
    id: e.id, walletId: e.categoryId, type: 'out', amount: e.amount,
    memo: e.memo || '', date: e.date, createdAt: typeof e.createdAt === 'number' ? e.createdAt : 0,
  }));
  return { version: VERSION, wallets, txs, lastWalletId: d.lastCategoryId ?? null, lastExportedAt: d.lastExportedAt ?? null };
}

class UnknownVersion extends Error {}
function migrate(d) {
  if (!d || typeof d !== 'object') throw new Error('形式が正しくありません');
  if (d.version === VERSION) return d;
  if (d.version === 1) return migrateV1(d);
  throw new UnknownVersion('対応していないバージョンです');
}

function validate(d) {
  if (!Array.isArray(d.wallets) || !Array.isArray(d.txs)) return '形式が正しくありません';
  const isAmt = (v, min) => Number.isInteger(v) && v >= min && v <= MAX;
  const wids = new Set();
  for (const w of d.wallets) {
    if (!w || typeof w.id !== 'string' || wids.has(w.id)) return 'サイフのIDが不正です';
    wids.add(w.id);
    if (typeof w.name !== 'string' || !RE_COLOR.test(w.color)) return 'サイフの名前か色が不正です';
    if (w.mode !== 'keep' && w.mode !== 'period') return 'サイフの種類が不正です';
    if (!RE_YMD.test(w.createdAt)) return 'サイフの作成日が不正です';
    if (w.deletedAt != null && !RE_YMD.test(w.deletedAt)) return 'サイフの削除日が不正です';
    if (w.opening != null && (!Number.isInteger(w.opening.amount) || Math.abs(w.opening.amount) > MAX || typeof w.opening.at !== 'number')) return 'サイフの残高が不正です';
    if (!Array.isArray(w.budgets)) return 'サイフの予算が不正です';
    for (const b of w.budgets) if (!b || !RE_YMD.test(b.from) || !isAmt(b.amount, 0)) return 'サイフの予算が不正です';
    if (w.mode === 'period') {
      if (!Number.isInteger(w.startDay) || w.startDay < 1 || w.startDay > 28) return 'サイフの開始日が不正です';
      if (!w.budgets.length) return 'サイフの予算が不正です';
    }
  }
  const tids = new Set();
  for (const t of d.txs) {
    if (!t || typeof t.id !== 'string' || tids.has(t.id)) return '明細のIDが不正です';
    tids.add(t.id);
    if (typeof t.walletId !== 'string' || (t.type !== 'out' && t.type !== 'in')) return '明細の内容が不正です';
    if (!RE_YMD.test(t.date) || !isAmt(t.amount, 1)) return '明細の日付か金額が不正です';
    if (t.memo != null && typeof t.memo !== 'string') return '明細の内容が不正です';
  }
  return null;
}

function normalize(d) {
  d.wallets.forEach((w, i) => {
    w.budgets.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    if (typeof w.order !== 'number') w.order = i;
    if (w.deletedAt === undefined) w.deletedAt = null;
    if (w.opening === undefined) w.opening = null;
    if (w.mode === 'keep') w.startDay = null;
  });
  d.txs.forEach(t => {
    if (t.memo == null) t.memo = '';
    if (typeof t.createdAt !== 'number') t.createdAt = 0;
  });
  if (d.lastExportedAt === undefined) d.lastExportedAt = null;
  if (d.lastWalletId === undefined) d.lastWalletId = null;
  return d;
}

/** JSON 文字列 → 検証済みデータ(失敗時は例外) */
function parseData(raw) {
  const d = migrate(JSON.parse(raw));
  const err = validate(d);
  if (err) throw new Error(err);
  return normalize(d);
}

let data = emptyData();
let readOnly = false;
let byMonth = new Map();   // "YYYY-MM" -> tx[]
let byWallet = new Map();  // walletId -> tx[]

function load() {
  let raw = null, old = null;
  try { raw = localStorage.getItem(KEY); old = localStorage.getItem(OLD_KEY); } catch { /* 使えない環境 */ }
  if (!raw && !old) return emptyData();
  try {
    const d = parseData(raw ?? old);
    if (!raw) {
      // 旧版のデータを変換して新しいキーへ(旧キーは消さずに残す)
      try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* 保存時に再試行 */ }
    }
    return d;
  } catch (e) {
    // 読めないデータは絶対に上書きしない
    readOnly = true;
    const msg = e instanceof UnknownVersion ? '新しい版のデータのため、読み取り専用で開いています' : '保存データを読めないため、読み取り専用で開いています';
    setTimeout(() => toast(msg), 300);
    return emptyData();
  }
}

function readLatest() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseData(raw) : null;
  } catch {
    return null;
  }
}

function rebuildIndex() {
  byMonth = new Map();
  byWallet = new Map();
  for (const t of data.txs) {
    const k = t.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(t);
    if (!byWallet.has(t.walletId)) byWallet.set(t.walletId, []);
    byWallet.get(t.walletId).push(t);
  }
}

function save() {
  if (readOnly) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    toast('保存できませんでした。データを書き出してください');
    return false;
  }
}

/**
 * 変更は必ずここを通す: 最新を読み直す → 操作を当てる → 保存。
 * fn が false を返したら何もしない。
 */
function mutate(fn) {
  if (readOnly) { toast('読み取り専用のため変更できません'); return false; }
  const fresh = readLatest();
  if (fresh) data = fresh;
  if (fn(data) === false) { rebuildIndex(); render(); return false; }
  rebuildIndex();
  if (save()) {
    try { localStorage.removeItem(BACKUP_KEY); } catch { /* noop */ }
  }
  render();
  return true;
}

/* ---------- 端末ごとの設定(自動バックアップ) ---------- */
const devDefault = () => ({ autoBackup: { enabled: false, enabledAt: null, lastMonth: null, lastAt: null, manualAt: null, error: false } });
function loadDev() {
  try {
    const d = JSON.parse(localStorage.getItem(DEVICE_KEY));
    if (d && d.autoBackup) return { autoBackup: { ...devDefault().autoBackup, ...d.autoBackup } };
  } catch { /* noop */ }
  return devDefault();
}
function updateDev(fn) {
  const dev = loadDev();
  fn(dev.autoBackup);
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(dev)); } catch { /* noop */ }
  return dev;
}

/* ---------- 参照 ---------- */
const walletById = id => data.wallets.find(w => w.id === id);
const walletOf = id => walletById(id) || UNKNOWN;
const isActive = w => !!w && w !== UNKNOWN && !w.deletedAt;
const byOrder = (a, b) => a.order - b.order;
const activeWallets = () => data.wallets.filter(isActive).sort(byOrder);
const allWallets = () => [
  ...data.wallets.filter(isActive).sort(byOrder),
  ...data.wallets.filter(w => !isActive(w)).sort(byOrder),
];
const monthTxs = ym => byMonth.get(ym) || [];
const walletTxs = w => (w === UNKNOWN ? data.txs.filter(t => !walletById(t.walletId)) : byWallet.get(w.id) || []);
const sumOut = txs => txs.reduce((s, t) => s + (t.type === 'out' ? t.amount : 0), 0);
const sumIn = txs => txs.reduce((s, t) => s + (t.type === 'in' ? t.amount : 0), 0);

/* ---------- 期間サイフ ---------- */
/** 日付 date を含む期間 { start, end } */
function periodFor(startDay, date) {
  const d = parseYmd(date);
  const y = d.getFullYear();
  let m = d.getMonth();
  if (d.getDate() < startDay) m -= 1;
  return { start: ymd(new Date(y, m, startDay)), end: ymd(new Date(y, m + 1, startDay - 1)) };
}
function shiftPeriod(startDay, start, n) {
  const d = parseYmd(start);
  return periodFor(startDay, ymd(new Date(d.getFullYear(), d.getMonth() + n, startDay)));
}
const periodLabel = p => `${md(p.start)}〜${md(p.end)}`;

function budgetAt(w, start) {
  let b = null;
  for (const x of w.budgets) if (x.from <= start) b = x.amount;
  return b ?? w.budgets[0]?.amount ?? 0;
}
/** from = F で予算を設定(F 以降の履歴は消してから追加) */
function setBudgetFrom(w, from, amount) {
  w.budgets = w.budgets.filter(b => b.from < from);
  w.budgets.push({ from, amount });
}
const periodTxs = (w, p) => walletTxs(w).filter(t => t.date >= p.start && t.date <= p.end);

function balanceOf(w) {
  if (w.mode === 'period') {
    const p = periodFor(w.startDay, todayStr());
    return budgetAt(w, p.start) - sumOut(periodTxs(w, p));
  }
  let txs = walletTxs(w);
  if (w.opening) {
    // 期間サイフから切り替えた継続サイフ: 切り替え時の残高 + それ以降に登録した明細
    txs = txs.filter(t => t.createdAt > w.opening.at);
    return w.opening.amount + sumIn(txs) - sumOut(txs);
  }
  return sumIn(txs) - sumOut(txs);
}

/** サイフの明細の範囲(最古・最新の日付) */
function txRange(w) {
  let lo = w.createdAt, hi = todayStr();
  for (const t of walletTxs(w)) {
    if (t.date < lo) lo = t.date;
    if (t.date > hi) hi = t.date;
  }
  return { lo, hi };
}

function fixLastWallet(d) {
  const ok = d.wallets.find(w => w.id === d.lastWalletId && !w.deletedAt);
  if (!ok) d.lastWalletId = d.wallets.filter(w => !w.deletedAt).sort(byOrder)[0]?.id ?? null;
}

function recentMemos(walletId) {
  const list = [];
  const seen = new Set();
  for (let i = data.txs.length - 1; i >= 0 && list.length < 50; i--) {
    const t = data.txs[i];
    const m = t.memo.trim();
    if (t.walletId !== walletId || t.type !== 'out' || !m || seen.has(m)) continue;
    seen.add(m);
    list.push(m);
  }
  return list;
}

/* ================================================================
   画面の状態
   ================================================================ */
const st = {
  month: thisMonth(),   // カレンダーの表示月
  calDay: null,         // カレンダーで選択中の日
  wMonth: thisMonth(),  // 継続サイフ詳細の表示月
  wStart: null,         // 期間サイフ詳細の表示期間(開始日)
  today: todayStr(),
  lastHash: '',
  pendingReload: false,
};
const server = { ok: false, folder: null };

/* ================================================================
   共通パーツ
   ================================================================ */
function navArrows(label, { prev, next, onPrev, onNext, onLabel, tag = 'h1' }) {
  return h('div', { class: 'mnav' },
    h('button', { class: 'icon', 'aria-label': '前へ', disabled: !prev, onclick: onPrev }, '‹'),
    h(tag, { onclick: onLabel }, label),
    h('button', { class: 'icon', 'aria-label': '次へ', disabled: !next, onclick: onNext }, '›'),
  );
}

function barEl(spent, budget, color) {
  let pct, cls = 'bar';
  if (budget <= 0) {
    pct = spent > 0 ? 100 : 0;
    if (spent > 0) cls += ' over';
  } else {
    const r = spent / budget;
    pct = Math.min(100, r * 100);
    if (r > 1) cls += ' over';
    else if (r > 0.8) cls += ' warn';
  }
  return h('div', { class: cls, style: { '--c': color } }, h('i', { style: { width: pct + '%' } }));
}

function deletedBadge(w) {
  if (w === UNKNOWN || !w.deletedAt) return null;
  return h('span', { class: 'badge' }, '削除済み');
}

const txAmount = t => (t.type === 'in' ? '+' + yen(t.amount) : yen(t.amount));

function txRow(t, showWallet) {
  const w = walletOf(t.walletId);
  const title = t.memo || (t.type === 'in' ? '入金' : showWallet ? w.name : '—');
  return h('button', { class: 'row', style: { '--c': colorOf(w) }, onclick: () => openTxSheet({ tx: t }) },
    showWallet ? h('span', { class: 'dot' }) : null,
    h('div', { class: 'main' },
      h('div', { class: 'title' }, h('span', {}, title)),
      showWallet && (t.memo || t.type === 'in') ? h('div', { class: 'meta' }, w.name) : null,
    ),
    h('span', { class: 'amt num' + (t.type === 'in' ? ' plus' : '') }, txAmount(t)),
  );
}

function txListByDay(txs, showWallet) {
  if (!txs.length) return h('div', { class: 'empty' }, '記録なし');
  const byDay = new Map();
  for (const t of txs) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }
  const out = h('div');
  for (const d of [...byDay.keys()].sort().reverse()) {
    const items = byDay.get(d).sort((a, b) => b.createdAt - a.createdAt);
    const spent = sumOut(items);
    out.append(
      h('div', { class: 'group-title' }, h('span', {}, dayLabel(d)), spent ? h('span', { class: 'num' }, yen(spent)) : h('span')),
      h('div', { class: 'group' }, items.map(t => txRow(t, showWallet))),
    );
  }
  return out;
}

/* ================================================================
   ホーム
   ================================================================ */
function homeView() {
  const wallets = activeWallets();
  const header = h('div', { class: 'nav' },
    h('span'),
    h('h1', {}, 'サイフ'),
    wallets.length ? h('button', { class: 'link', onclick: () => go('#/manage') }, '編集') : h('span'),
  );

  const grid = h('div', { class: 'cards' });
  for (const w of wallets) {
    const bal = balanceOf(w);
    const until = w.mode === 'period' ? periodFor(w.startDay, todayStr()).end : null;
    grid.append(h('button', {
      class: 'card', style: { '--c': colorOf(w) },
      onclick: () => openWallet(w.id),
    },
      h('div', { class: 'name' }, w.name),
      h('div', {},
        h('div', { class: 'rest num' + (bal < 0 ? ' neg' : '') }, yen(bal)),
        until ? h('div', { class: 'until num' }, `${md(until)}まで`) : null),
    ));
  }
  if (wallets.length) {
    grid.append(h('button', { class: 'card add', 'aria-label': 'サイフを追加', onclick: () => openWalletSheet() }, '+'));
  } else {
    grid.append(h('button', { class: 'card add first', onclick: () => openWalletSheet() }, '+', h('span', {}, 'サイフを追加')));
  }
  return h('div', {}, header, h('div', { style: { height: '8px' } }), grid);
}

/* ================================================================
   サイフ詳細
   ================================================================ */
function openWallet(id, ym) {
  const w = id === UNKNOWN.id ? UNKNOWN : walletById(id);
  const base = ym ? `${ym}-15` : todayStr();
  st.wMonth = (ym || thisMonth());
  st.wStart = w && w.mode === 'period' ? periodFor(w.startDay, base).start : null;
  go(`#/wallet/${id}`);
}

function walletView(id) {
  const w = id === UNKNOWN.id ? UNKNOWN : walletById(id);
  if (!w) { location.replace('#/home'); return h('div'); }
  const color = colorOf(w);

  const header = h('div', { class: 'nav' },
    h('button', { class: 'link back', onclick: back }, '戻る'),
    h('h1', {}, h('span', {}, w.name), deletedBadge(w)),
    isActive(w)
      ? h('button', { class: 'link', 'aria-label': 'サイフを編集', onclick: () => openWalletSheet(w) }, '•••')
      : h('span'),
  );

  const range = txRange(w);

  if (w.mode === 'period') {
    const cur = periodFor(w.startDay, todayStr());
    if (!st.wStart) st.wStart = cur.start;
    const p = periodFor(w.startDay, st.wStart);
    const lo = periodFor(w.startDay, range.lo).start;
    const hiLatest = periodFor(w.startDay, range.hi).start;
    const hi = hiLatest > cur.start ? hiLatest : cur.start;
    const txs = periodTxs(w, p);
    const spent = sumOut(txs);
    const budget = budgetAt(w, p.start);
    const rest = budget - spent;
    const nav = navArrows(periodLabel(p), {
      prev: p.start > lo, next: p.start < hi, tag: 'h2',
      onPrev: () => { st.wStart = shiftPeriod(w.startDay, p.start, -1).start; render(); },
      onNext: () => { st.wStart = shiftPeriod(w.startDay, p.start, 1).start; render(); },
      onLabel: () => { st.wStart = cur.start; render(); },
    });
    const hero = h('div', { class: 'hero' },
      h('div', { class: 'label' }, '使った'),
      h('div', { class: 'big num' }, yen(spent)),
      h('div', { class: 'sub' },
        '残り ', h('b', { class: 'num' + (rest < 0 ? ' neg' : '') }, yen(rest)),
        h('span', { class: 'num' }, ' / ' + yen(budget))),
      barEl(spent, budget, color),
    );
    return h('div', {}, header, h('div', { class: 'mnav-row' }, nav), hero, txListByDay(txs, w === UNKNOWN));
  }

  // 継続サイフ
  const bal = balanceOf(w);
  const ym = st.wMonth;
  const lo = range.lo.slice(0, 7);
  const hi = range.hi.slice(0, 7) > thisMonth() ? range.hi.slice(0, 7) : thisMonth();
  const txs = walletTxs(w).filter(t => t.date.slice(0, 7) === ym);
  const spent = sumOut(txs);
  const hero = h('div', { class: 'hero' },
    h('div', { class: 'label' }, '残高'),
    h('div', { class: 'big num' + (bal < 0 ? ' neg' : '') }, yen(bal)),
  );
  const nav = navArrows(monthLabel(ym), {
    prev: ym > lo, next: ym < hi, tag: 'h2',
    onPrev: () => { st.wMonth = addMonth(ym, -1); render(); },
    onNext: () => { st.wMonth = addMonth(ym, 1); render(); },
    onLabel: () => { st.wMonth = thisMonth(); render(); },
  });
  const monthSum = h('div', { class: 'month-sum' },
    h('span', { class: 'muted' }, '使った '), h('b', { class: 'num' }, yen(spent)));
  return h('div', {}, header, hero, h('div', { class: 'mnav-row' }, nav), monthSum, txListByDay(txs, w === UNKNOWN));
}

/* ================================================================
   カレンダー
   ================================================================ */
function calendarView() {
  const ym = st.month;
  const [y, m] = ym.split('-').map(Number);
  const n = daysIn(ym);
  const today = todayStr();
  const perDay = new Array(n + 1).fill(0);   // 支出
  const inDay = new Array(n + 1).fill(0);    // 入金
  for (const t of monthTxs(ym)) (t.type === 'out' ? perDay : inDay)[Number(t.date.slice(8, 10))] += t.amount;
  const total = perDay.reduce((s, v) => s + v, 0);
  const totalIn = inDay.reduce((s, v) => s + v, 0);

  // 濃さの基準: 支出がある日の上位10%付近の値(大きい1日に引っ張られない)
  const nz = perDay.filter(v => v > 0).sort((a, b) => a - b);
  const ref = nz.length ? nz[Math.min(nz.length - 1, Math.floor(nz.length * 0.9))] : 0;
  const level = v => (v <= 0 || !ref ? 0 : Math.min(4, Math.max(1, Math.ceil((v / ref) * 4))));

  if (!st.calDay || st.calDay.slice(0, 7) !== ym) {
    st.calDay = today.slice(0, 7) === ym ? today : `${ym}-01`;
  }

  const grid = h('div', { class: 'cal-grid' }, WEEK.map(w => h('div', { class: 'wd' }, w)));
  const first = new Date(y, m - 1, 1).getDay();
  for (let i = 0; i < first; i++) grid.append(h('div'));
  for (let d = 1; d <= n; d++) {
    const ds = `${ym}-${pad(d)}`;
    const v = perDay[d];
    let cls = 'day l' + level(v);
    if (ds === today) cls += ' today';
    if (ds > today) cls += ' future';
    if (ds === st.calDay) cls += ' sel';
    grid.append(h('button', {
      class: cls, 'aria-label': `${d}日 ${v ? yen(v) : ''} ${inDay[d] ? '入金' + yen(inDay[d]) : ''}`,
      onclick: () => { st.calDay = ds; render(); },
    },
      h('span', { class: 'd' }, d),
      v ? h('span', { class: 'v num' }, shortYen(v)) : null,
      inDay[d] ? h('span', { class: 'v in num' }, '+' + shortYen(inDay[d])) : null,
    ));
  }

  const dayTxs = monthTxs(ym).filter(t => t.date === st.calDay).sort((a, b) => b.createdAt - a.createdAt);
  const daySum = sumOut(dayTxs);
  const dayIn = sumIn(dayTxs);
  const minM = [...byMonth.keys(), thisMonth()].sort()[0];
  const maxM = [...byMonth.keys(), addMonth(thisMonth(), 1)].sort().pop();

  return h('div', {},
    h('div', { class: 'nav' }, h('span'),
      navArrows(monthLabel(ym), {
        prev: ym > minM, next: ym < maxM,
        onPrev: () => { st.month = addMonth(ym, -1); render(); },
        onNext: () => { st.month = addMonth(ym, 1); render(); },
        onLabel: () => { st.month = thisMonth(); render(); },
      }), h('span')),
    h('div', { class: 'cal-total' },
      h('span', {}, '使った', h('b', { class: 'num' }, yen(total))),
      totalIn ? h('span', {}, '入金', h('b', { class: 'num plus' }, '+' + yen(totalIn))) : null),
    h('div', { class: 'cal' }, grid),
    h('div', { class: 'day-head' },
      h('h2', {}, dayLabel(st.calDay),
        daySum ? h('span', { class: 'muted num' }, '  ' + yen(daySum)) : null,
        dayIn ? h('span', { class: 'plus num small-in' }, '  +' + yen(dayIn)) : null),
    ),
    dayTxs.length
      ? h('div', { class: 'group' }, dayTxs.map(t => txRow(t, true)))
      : h('div', { class: 'empty' }, '記録なし'),
  );
}

/* ================================================================
   記録(月別集計)
   ================================================================ */
function monthSummary(ym) {
  const spent = new Map();
  for (const t of monthTxs(ym)) if (t.type === 'out') spent.set(t.walletId, (spent.get(t.walletId) || 0) + t.amount);
  const rows = [];
  for (const w of allWallets()) {
    const v = spent.get(w.id);
    if (!v) continue;
    rows.push({ w, spent: v });
    spent.delete(w.id);
  }
  let unknown = 0;
  for (const v of spent.values()) unknown += v;
  if (unknown) rows.push({ w: UNKNOWN, spent: unknown });
  return { rows, total: rows.reduce((s, r) => s + r.spent, 0) };
}
const monthTotal = ym => sumOut(monthTxs(ym));

function settingsDot() {
  return exportStale() || loadDev().autoBackup.error;
}

function recordsView() {
  const cur = thisMonth();
  const months = new Set([...byMonth.keys()].filter(k => monthTotal(k) > 0));
  months.add(cur);
  const list = [...months].sort().reverse();

  const header = h('div', { class: 'nav' },
    h('span'), h('h1', {}, '記録'),
    h('button', { class: 'link', onclick: () => go('#/settings') },
      '設定', settingsDot() ? h('span', { class: 'stale' }) : null),
  );

  const rows = list.map(ym => {
    const total = monthTotal(ym);
    const prev = addMonth(ym, -1);
    let diff = null;
    if (monthTotal(prev) > 0) {
      const d = total - monthTotal(prev);
      diff = `前月比 ${d > 0 ? '+' : d < 0 ? '−' : '±'}¥${Math.abs(d).toLocaleString('ja-JP')}`;
    }
    return h('button', { class: 'row month-row', onclick: () => go(`#/rec/${ym}`) },
      h('div', { class: 'main' },
        h('div', { class: 'title' }, monthLabel(ym)),
        diff ? h('div', { class: 'meta num' }, diff) : null,
      ),
      h('span', { class: 'amt num' }, yen(total)),
      h('span', { class: 'chev' }),
    );
  });

  return h('div', {}, header, monthChart(), h('div', { class: 'group' }, rows));
}

/** 直近12ヶ月の月別支出合計(単一系列の棒グラフ) */
function monthChart() {
  const cur = thisMonth();
  const months = Array.from({ length: 12 }, (_, i) => addMonth(cur, i - 11));
  const vals = months.map(monthTotal);
  const maxV = Math.max(...vals, 1);
  const W = 600, H = 150, top = 6, base = 128, slot = W / 12, bw = Math.min(28, slot - 10);

  const readM = h('span', { class: 'm' });
  const readV = h('span', { class: 'v num' });
  const setRead = i => { readM.textContent = monthLabel(months[i]); readV.textContent = yen(vals[i]); };

  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '直近12ヶ月の使った合計', preserveAspectRatio: 'none' });
  s.append(svg('line', { class: 'base', x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5 }));
  const bars = [];
  months.forEach((ym, i) => {
    const x = i * slot + (slot - bw) / 2;
    const bh = vals[i] ? Math.max(3, ((base - top) * vals[i]) / maxV) : 0;
    const yTop = base - bh;
    const r = Math.min(4, bh);
    const p = svg('path', {
      class: 'b' + (ym === cur ? ' on' : ''),
      d: bh ? `M${x},${base}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + bw - r}Q${x + bw},${yTop} ${x + bw},${yTop + r}V${base}Z` : '',
    });
    bars.push(p);
    const lbl = svg('text', { class: 'lbl', x: i * slot + slot / 2, y: H - 4 });
    lbl.textContent = Number(ym.slice(5)) + '月';
    const hit = svg('rect', { class: 'hit', x: i * slot, y: 0, width: slot, height: H });
    const title = svg('title');
    title.textContent = `${monthLabel(ym)} ${yen(vals[i])}`;
    hit.append(title);
    const on = () => { bars.forEach((b, j) => b.classList.toggle('on', j === i)); setRead(i); };
    hit.addEventListener('pointerenter', on);
    hit.addEventListener('click', () => go(`#/rec/${ym}`));
    s.append(p, lbl, hit);
  });
  s.addEventListener('pointerleave', () => {
    bars.forEach((b, j) => b.classList.toggle('on', j === 11));
    setRead(11);
  });
  setRead(11);

  return h('div', { class: 'chart' }, h('div', { class: 'readout' }, readV, readM), s);
}

function recordDetailView(ym) {
  const s = monthSummary(ym);
  const header = h('div', { class: 'nav' },
    h('button', { class: 'link back', onclick: () => go('#/rec') }, '記録'),
    h('h1', {}, monthLabel(ym)), h('span'),
  );
  const hero = h('div', { class: 'hero' },
    h('div', { class: 'label' }, '使った合計'),
    h('div', { class: 'big num' }, yen(s.total)),
  );

  const share = s.total
    ? h('div', { class: 'share', role: 'img', 'aria-label': 'サイフ別の比率' },
      s.rows.map(r => h('i', { style: { '--c': colorOf(r.w), flex: String(r.spent) }, title: `${r.w.name} ${Math.round((r.spent / s.total) * 100)}%` })))
    : null;

  const rows = s.rows.map(r => {
    const w = r.w;
    const pct = Math.round((r.spent / s.total) * 100);
    const restore = w !== UNKNOWN && w.deletedAt
      ? h('button', {
        class: 'mini-btn', onclick: ev => {
          ev.stopPropagation();
          mutate(d => {
            const x = d.wallets.find(v => v.id === w.id);
            if (!x) return false;
            x.deletedAt = null;
            x.order = Math.max(-1, ...d.wallets.filter(v => !v.deletedAt && v !== x).map(v => v.order)) + 1;
          });
          toast(`「${w.name}」を元に戻しました`);
        },
      }, '元に戻す')
      : null;
    return h('div', {
      class: 'row tap' + (w.deletedAt ? ' deleted' : ''), role: 'button', tabindex: 0,
      style: { '--c': colorOf(w), cursor: 'pointer' },
      onclick: () => openWallet(w.id, ym),
    },
      h('span', { class: 'dot' }),
      h('div', { class: 'main' },
        h('div', { class: 'title' }, h('span', {}, w.name), deletedBadge(w)),
        h('div', { class: 'meta num' }, `${yen(r.spent)}・${pct}%`),
      ),
      restore,
    );
  });

  return h('div', {}, header, hero, share,
    rows.length ? h('div', { class: 'group' }, rows) : h('div', { class: 'empty' }, '記録なし'));
}

/* ================================================================
   サイフ管理(並べ替え・削除)
   ================================================================ */
function walletMeta(w) {
  if (w.mode === 'keep') return `継続・残高 ${yen(balanceOf(w))}`;
  const s = w.startDay;
  const endLabel = s === 1 ? '月末' : `${s - 1}日`;
  return `期間 ${s}日〜${endLabel}・${yen(budgetAt(w, periodFor(s, todayStr()).start))}`;
}

function manageView() {
  const wallets = activeWallets();
  const header = h('div', { class: 'nav' },
    h('button', { class: 'link back', onclick: () => go('#/home') }, 'ホーム'),
    h('h1', {}, 'サイフ'),
    h('button', { class: 'link', 'aria-label': 'サイフを追加', onclick: () => openWalletSheet(), style: { 'font-size': '26px' } }, '+'),
  );
  if (!wallets.length) return h('div', {}, header, h('div', { class: 'empty' }, 'サイフがありません'));

  const list = h('div', { class: 'group manage' });
  for (const w of wallets) {
    const handle = h('span', { class: 'handle', 'aria-label': '並べ替え', onclick: ev => ev.stopPropagation() }, '≡');
    const row = h('div', {
      class: 'row tap', role: 'button', tabindex: 0, style: { '--c': colorOf(w), cursor: 'pointer' },
      onclick: () => openWalletSheet(w),
    },
      h('button', {
        class: 'del-btn', 'aria-label': `${w.name}を削除`,
        onclick: ev => { ev.stopPropagation(); confirmDeleteWallet(w); },
      }, '−'),
      h('span', { class: 'dot' }),
      h('div', { class: 'main' },
        h('div', { class: 'title' }, h('span', {}, w.name)),
        h('div', { class: 'meta num' }, walletMeta(w)),
      ),
      handle,
    );
    row.dataset.id = w.id;
    enableDrag(handle, row, list);
    list.append(row);
  }
  return h('div', {}, header, list);
}

function enableDrag(handle, row, list) {
  handle.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    const rows = [...list.children];
    const from = rows.indexOf(row);
    const step = row.getBoundingClientRect().height;
    const startY = ev.clientY;
    let to = from;
    row.classList.add('dragging');

    const move = e => {
      const dy = e.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;
      to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / step)));
      rows.forEach((r, i) => {
        if (r === row) return;
        let s = 0;
        if (from < to && i > from && i <= to) s = -step;
        if (from > to && i < from && i >= to) s = step;
        r.style.transform = s ? `translateY(${s}px)` : '';
      });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (to === from) {
        row.classList.remove('dragging');
        rows.forEach(r => { r.style.transform = ''; });
        return;
      }
      const ids = rows.map(r => r.dataset.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      mutate(d => { ids.forEach((id, i) => { const w = d.wallets.find(x => x.id === id); if (w) w.order = i; }); });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

function confirmDeleteWallet(w) {
  confirmDialog(`「${w.name}」を削除しますか？\n過去の記録は残ります。`, '削除', () => {
    const ok = mutate(d => {
      const x = d.wallets.find(v => v.id === w.id);
      if (!x) return false;
      x.deletedAt = todayStr();
      fixLastWallet(d);
    });
    if (!ok) return;
    if (location.hash.startsWith('#/wallet/')) go('#/home');
    toast(`「${w.name}」を削除しました`, () => {
      mutate(d => {
        const x = d.wallets.find(v => v.id === w.id);
        if (!x) return false;
        x.deletedAt = null;
        fixLastWallet(d);
      });
    });
  }, true);
}

/* ================================================================
   設定
   ================================================================ */
function exportStale() {
  if (!data.txs.length) return false;
  return !data.lastExportedAt || Date.now() - data.lastExportedAt > 30 * 864e5;
}

const fmtDate = ms => { const d = new Date(ms); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };

function settingsView() {
  const header = h('div', { class: 'nav' },
    h('button', { class: 'link back', onclick: () => go('#/rec') }, '記録'),
    h('h1', {}, '設定'), h('span'),
  );
  const file = h('input', {
    type: 'file', accept: 'application/json,.json', style: { display: 'none' },
    onchange: ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) importFile(f); },
  });
  let hasBackup = false;
  try { hasBackup = !!localStorage.getItem(BACKUP_KEY); } catch { /* noop */ }

  // 自動バックアップ
  const ab = loadDev().autoBackup;
  const can = server.ok;
  const toggle = h('button', {
    class: 'switch' + (ab.enabled ? ' on' : ''), role: 'switch', 'aria-checked': String(ab.enabled),
    'aria-label': '自動バックアップ', disabled: !can,
    onclick: () => {
      updateDev(a => {
        a.enabled = !a.enabled;
        a.error = false;
        if (a.enabled) a.enabledAt = todayStr();
      });
      render();
      checkAutoBackup();
    },
  }, h('i'));
  const status = ab.error ? h('span', { class: 'neg' }, '失敗', h('span', { class: 'stale' }))
    : ab.lastMonth ? `${monthLabel(ab.lastMonth)}分` : '—';

  const local = location.hostname === '127.0.0.1'; // iPhone(公開版)ではフォルダ保存は使えないので出さない
  const autoGroup = h('div', { class: 'group' + (can ? '' : ' disabled') },
    h('div', { class: 'row' }, h('div', { class: 'main' }, '毎月自動で保存'), toggle),
    h('button', { class: 'row action', disabled: !can, onclick: pickFolder },
      h('span', { class: 'label' }, '保存先'),
      h('span', { class: 'path muted', title: server.folder || '' }, server.folder || '—')),
    h('button', { class: 'row action', disabled: !can, onclick: backupNow },
      h('span', {}, '今すぐ保存'),
      h('span', { class: 'muted num small' }, ab.manualAt ? fmtDate(ab.manualAt) : '')),
    h('div', { class: 'row' }, h('div', { class: 'main muted small' }, '最後の自動保存'), h('span', { class: 'muted num small' }, status)),
  );

  return h('div', {}, header,
    local ? h('div', { class: 'group-title' }, h('span', {}, '自動バックアップ'), can ? null : h('span', {}, 'サーバー未起動')) : null,
    local ? autoGroup : null,
    h('div', { class: 'group-title' }, h('span', {}, 'データ')),
    h('div', { class: 'group' },
      h('button', { class: 'row action', onclick: exportData },
        h('span', {}, '書き出す'),
        h('span', { class: 'muted num small' }, '最終: ' + (data.lastExportedAt ? fmtDate(data.lastExportedAt) : '未実施'), exportStale() ? h('span', { class: 'stale' }) : null)),
      h('button', { class: 'row action', onclick: () => file.click() }, h('span', {}, '読み込む')),
      hasBackup ? h('button', { class: 'row action', onclick: restoreBackup }, h('span', {}, '読み込み前に戻す')) : null,
    ),
    h('div', { class: 'group' },
      h('button', { class: 'row action danger', onclick: deleteAll }, h('span', {}, 'すべてのデータを削除')),
    ),
    file,
  );
}

async function exportData() {
  const json = JSON.stringify(data);
  const name = `saifu-${todayStr()}.json`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const mobile = /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
  try {
    const f = new File([json], name, { type: 'application/json' });
    if (mobile && navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f] });
    else download();
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    download();
  }
  if (!readOnly) {
    const fresh = readLatest();
    if (fresh) data = fresh;
    data.lastExportedAt = Date.now();
    save();
  }
  render();
  toast('書き出しました');
}

function replaceData(d) {
  data = d;
  readOnly = false;
  rebuildIndex();
  save();
}

function importFile(f) {
  const reader = new FileReader();
  reader.onload = () => {
    let d;
    try {
      d = parseData(reader.result);
    } catch (e) {
      toast(e instanceof SyntaxError ? '読み込めないファイルです' : e.message);
      return;
    }
    confirmDialog(`明細 ${d.txs.length}件・サイフ ${d.wallets.length}件のデータに置き換えますか？`, '置き換える', () => {
      const run = () => { replaceData(d); go('#/home'); render(); toast('読み込みました'); };
      try {
        if (!readOnly) localStorage.setItem(BACKUP_KEY, JSON.stringify(data));
        run();
      } catch {
        try { localStorage.removeItem(BACKUP_KEY); } catch { /* noop */ }
        confirmDialog('容量が足りず、今のデータを退避できません。\n退避せずに置き換えますか？', '置き換える', run, true);
      }
    }, true);
  };
  reader.readAsText(f);
}

function restoreBackup() {
  confirmDialog('読み込み前のデータに戻しますか？', '戻す', () => {
    try {
      replaceData(parseData(localStorage.getItem(BACKUP_KEY)));
      localStorage.removeItem(BACKUP_KEY);
      render();
      toast('元に戻しました');
    } catch {
      toast('戻せませんでした');
    }
  });
}

function deleteAll() {
  confirmDialog('すべてのデータを削除しますか？\nこの操作は取り消せません。', '削除', () => {
    replaceData(emptyData());
    st.month = thisMonth();
    go('#/home');
    render();
    toast('削除しました');
  }, true);
}

/* ---------- 自動バックアップ(server.py 経由) ---------- */
async function api(path, body) {
  const r = await fetch('/api/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `エラー (${r.status})`);
  return j;
}

async function probeServer() {
  if (location.hostname !== '127.0.0.1') return;
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    const j = await r.json();
    if (j && j.app === 'saifu') { server.ok = true; server.folder = j.folder; }
  } catch { /* server.py 以外で開いている */ }
}

/**
 * 旧 URL(http://localhost:8080)のデータを引き継ぐ。
 * この URL にまだデータが無いときだけ、旧 URL に一度寄ってデータを受け取る。
 */
async function takeHandoff() {
  if (!server.ok) return;
  let hasLocal = false;
  try { hasLocal = !!(localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY)); } catch { /* noop */ }
  let j;
  try { j = await (await fetch('/api/handoff', { cache: 'no-store' })).json(); } catch { return; }
  if (j.handoff && j.handoff.data) {
    if (!hasLocal) {
      try {
        replaceData(parseData(j.handoff.data));
        if (j.handoff.device) localStorage.setItem(DEVICE_KEY, j.handoff.device);
        toast('前のデータを引き継ぎました');
      } catch {
        toast('前のデータを引き継げませんでした');
        return; // 受け取ったデータは server に残しておく
      }
    }
    try { await api('handoff/done'); } catch { /* noop */ }
    return;
  }
  if (j.pending && !hasLocal) {
    let tried = false;
    try { tried = sessionStorage.getItem('saifu_handoff') === '1'; sessionStorage.setItem('saifu_handoff', '1'); } catch { /* noop */ }
    if (!tried && /^http:\/\/localhost:\d+\/$/.test(j.legacy)) location.replace(j.legacy);
  }
}

/** 今保存すべき月(不要なら null)。仕様 §3.9 の判定式 */
function backupTarget(a) {
  if (!a.enabled || !a.enabledAt) return null;
  const C = thisMonth();
  const P = addMonth(C, -1);
  const last = a.lastMonth || '';
  if (a.enabledAt.slice(0, 7) <= P && (last < P || (last === P && (a.lastAt || 0) < monthStartMs(C)))) return P;
  if (isLastDay(todayStr()) && last < C) return C;
  return null;
}

let backupRunning = false;
async function checkAutoBackup() {
  if (!server.ok || backupRunning || readOnly) return;
  const month = backupTarget(loadDev().autoBackup);
  if (!month) return;
  const fresh = readLatest() || data;
  if (!fresh.wallets.length && !fresh.txs.length) return;
  backupRunning = true;
  try {
    if (backupTarget(loadDev().autoBackup) !== month) return; // 他のタブが先に保存した
    await api('backup', { month, data: fresh });
    updateDev(a => { a.lastMonth = month; a.lastAt = Date.now(); a.error = false; });
  } catch {
    updateDev(a => { a.error = true; });
  } finally {
    backupRunning = false;
    if (location.hash.startsWith('#/settings') || location.hash.startsWith('#/rec')) render();
  }
}

async function backupNow() {
  try {
    const res = await api('backup', { month: thisMonth(), data: readLatest() || data });
    updateDev(a => { a.manualAt = Date.now(); });
    render();
    toast('保存しました');
    return res;
  } catch (e) {
    toast(e.message);
  }
}

async function pickFolder() {
  try {
    const j = await api('pick-folder');
    if (j.folder) {
      server.folder = j.folder;
      updateDev(a => { a.error = false; });
      render();
      toast('保存先を変更しました');
    }
  } catch (e) {
    toast(e.message === 'busy' ? 'フォルダ選択画面が開いています' : e.message);
  }
}

/* ================================================================
   シート・ダイアログ・トースト
   ================================================================ */
let closeCurrent = null;

function openSheet(build, cls = '') {
  if (closeCurrent) closeCurrent(true);
  const panel = h('div', { class: 'sheet ' + cls, role: 'dialog', 'aria-modal': 'true' });
  const overlay = h('div', { class: 'overlay' }, panel);
  overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
  const onKey = e => { if (e.key === 'Escape') close(); };

  // iPhone でキーボードが開いたときにシートが隠れないようにする
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv) return;
    overlay.style.paddingBottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px';
  };

  function close(instant) {
    if (closeCurrent !== close) return;
    closeCurrent = null;
    document.removeEventListener('keydown', onKey);
    vv?.removeEventListener('resize', fit);
    if (instant) overlay.remove();
    else {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 220);
    }
    if (st.pendingReload) { st.pendingReload = false; reloadFromStorage(); }
  }
  closeCurrent = close;
  document.addEventListener('keydown', onKey);
  vv?.addEventListener('resize', fit);

  if (!cls.includes('alert')) panel.append(h('div', { class: 'grabber' }));
  build(panel, close);
  $('#sheet-root').append(overlay);
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')));
  return close;
}

function confirmDialog(msg, okLabel, onOk, danger = false) {
  openSheet((p, close) => {
    const ok = h('button', { class: danger ? 'danger' : 'primary', onclick: () => { close(true); onOk(); } }, okLabel);
    p.append(
      h('p', {}, msg),
      h('div', { class: 'btns' }, h('button', { onclick: () => close() }, 'キャンセル'), ok),
    );
    setTimeout(() => ok.focus(), 50);
  }, 'alert');
}

let toastTimer = null;
function toast(msg, undo) {
  const t = $('#toast');
  const hide = () => t.classList.remove('show');
  t.replaceChildren(h('span', {}, msg));
  if (undo) t.append(h('button', { onclick: () => { hide(); undo(); } }, '元に戻す'));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, undo ? 5000 : 2200);
}

/* ---------- 金額欄 + 小さい電卓 ---------- */
/**
 * 金額欄を作る。always=true なら電卓を最初から表示、false なら金額欄を触ったときに表示。
 * 電卓は下部の横長ボタンでしまえて、金額欄の電卓ボタンでまた出せる。
 * value() は min〜MAX の整数、範囲外や不正な式なら null。
 */
function amountField({ value = '', min = 1, always = false, big = true, onChange = () => {} }) {
  const input = h('input', {
    class: 'amount-input', inputmode: COARSE ? 'none' : 'decimal', autocomplete: 'off',
    placeholder: '0', 'aria-label': '金額', value,
  });
  const preview = h('span', { class: 'preview num' });
  const value_ = () => {
    const n = evalExpr(input.value);
    return n !== null && n >= min && n <= MAX ? n : null;
  };
  const refresh = () => {
    const n = evalExpr(input.value);
    preview.textContent = hasOperator(input.value) && n !== null ? '= ' + n.toLocaleString('ja-JP') : '';
    onChange(value_());
  };
  input.addEventListener('input', refresh);

  const insert = s => {
    const v = input.value;
    const a = input.selectionStart ?? v.length;
    const b = input.selectionEnd ?? v.length;
    input.value = v.slice(0, a) + s + v.slice(b);
    const pos = a + s.length;
    try { input.setSelectionRange(pos, pos); } catch { /* noop */ }
    refresh();
  };
  const key = (label, action, cls = '', aria) => h('button', {
    type: 'button', class: 'k ' + cls, tabindex: -1, 'aria-label': aria,
    onpointerdown: e => e.preventDefault(), // 金額欄のフォーカスを外さない
    onclick: () => { action(); if (!COARSE && calc.classList.contains('show')) input.focus(); },
  }, label);
  const backspace = () => {
    const v = input.value;
    const a = input.selectionStart ?? v.length;
    const b = input.selectionEnd ?? v.length;
    if (a !== b) { input.value = v.slice(0, a) + v.slice(b); try { input.setSelectionRange(a, a); } catch { /* noop */ } }
    else if (a > 0) { input.value = v.slice(0, a - 1) + v.slice(a); try { input.setSelectionRange(a - 1, a - 1); } catch { /* noop */ } }
    refresh();
  };
  const equals = () => {
    const n = evalExpr(input.value);
    if (n !== null) { input.value = String(n); refresh(); }
  };

  const toggleBtn = h('button', {
    type: 'button', class: 'calc-toggle', 'aria-label': '電卓を出す', tabindex: -1,
    onpointerdown: e => e.preventDefault(),
    onclick: e => { e.preventDefault(); showCalc(); },
  }, calcIcon());
  const box = h('label', { class: 'amount-box' + (big ? '' : ' small') }, h('span', { class: 'yen' }, '¥'), input, preview, toggleBtn);

  const calc = h('div', { class: 'calc' },
    key('C', () => { input.value = ''; refresh(); }, 'fn'), key('÷', () => insert('÷'), 'op'), key('×', () => insert('×'), 'op'), key('⌫', backspace, 'fn', '1文字消す'),
    key('7', () => insert('7')), key('8', () => insert('8')), key('9', () => insert('9')), key('−', () => insert('−'), 'op'),
    key('4', () => insert('4')), key('5', () => insert('5')), key('6', () => insert('6')), key('+', () => insert('+'), 'op'),
    key('1', () => insert('1')), key('2', () => insert('2')), key('3', () => insert('3')), key('=', equals, 'eq'),
    key('0', () => insert('0'), 'zero'), key('00', () => insert('00')),
    key(chevronIcon('up'), () => hideCalc(), 'hide-bar', '電卓をしまう'),
  );
  const showCalc = () => {
    if (input.disabled) return;
    calc.classList.add('show');
    box.classList.add('calc-on');
    if (!COARSE) input.focus();
  };
  const hideCalc = () => { calc.classList.remove('show'); box.classList.remove('calc-on'); };
  if (always) { calc.classList.add('show'); box.classList.add('calc-on'); }
  // タッチ端末では金額欄を押したら電卓を出す(OS キーボードは出さない)
  input.addEventListener('click', () => { if (COARSE || !always) showCalc(); });
  if (!always) input.addEventListener('focus', showCalc);

  const setValue = v => { input.value = v; refresh(); };
  requestAnimationFrame(refresh);
  return { box, calc, input, value: value_, equals, showCalc, hideCalc, setValue };
}

function chevronIcon(dir) {
  const s = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  s.append(svg('path', { d: dir === 'up' ? 'M6 14.5l6-6 6 6' : 'M6 9.5l6 6 6-6' }));
  return s;
}

function calcIcon() {
  const s = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  s.append(
    svg('rect', { x: 5, y: 3, width: 14, height: 18, rx: 2.5 }),
    svg('path', { d: 'M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01' }),
  );
  return s;
}

/* ---------- 日付欄(押すと年・月・日のスロットを回して選ぶ) ---------- */
const ROW_H = 36; // スロット1行の高さ(style.css の .wheel .it と合わせる)

/** 1列のスロット。items: [{ value, label }] */
function wheelColumn(items, onPick) {
  const col = h('div', { class: 'wheel', role: 'listbox' });
  const nodes = items.map((it, i) => h('div', {
    class: 'it num', role: 'option', 'data-i': String(i),
    onclick: () => scrollTo(i, true),
  }, it.label));
  col.append(h('div', { class: 'pad' }), ...nodes, h('div', { class: 'pad' }));

  let index = 0, timer = null, raf = 0;
  const clampIdx = i => Math.max(0, Math.min(items.length - 1, i));
  // 中央からの距離に応じて少し傾けて、ドラムが回っている見た目にする
  const paint = () => {
    raf = 0;
    const mid = col.scrollTop + col.clientHeight / 2;
    nodes.forEach((n, i) => {
      const d = (ROW_H * 2 + i * ROW_H + ROW_H / 2 - mid) / ROW_H;
      if (Math.abs(d) > 3.5) { n.style.transform = ''; return; }
      n.style.transform = `rotateX(${(-d * 14).toFixed(1)}deg) scale(${(1 - Math.abs(d) * 0.06).toFixed(3)})`;
      n.style.opacity = String(Math.max(0.25, 1 - Math.abs(d) * 0.28));
    });
  };
  const scrollTo = (i, smooth) => {
    index = clampIdx(i);
    col.scrollTo({ top: index * ROW_H, behavior: smooth ? 'smooth' : 'auto' });
    if (!smooth) paint();
  };
  col.addEventListener('scroll', () => {
    if (!raf) raf = requestAnimationFrame(paint);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const i = clampIdx(Math.round(col.scrollTop / ROW_H));
      if (i !== index) { index = i; onPick(items[i].value); }
    }, 120);
  }, { passive: true });

  return {
    el: col,
    set(value) { const i = items.findIndex(it => it.value === value); if (i >= 0) scrollTo(i, false); },
    mark(fn) { nodes.forEach((n, i) => n.classList.toggle('off', !fn(items[i].value))); },
  };
}

function dateField(value, disabled, onChange = () => {}, onOpen = () => {}) {
  let cur = RE_YMD.test(value) ? value : todayStr();
  const label = s => {
    const d = parseYmd(s);
    const y = d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}年` : '';
    return `${y}${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})`;
  };
  const btn = h('button', { type: 'button', id: 'date', class: 'date-btn num', disabled });
  const todayBtn = h('button', { type: 'button', class: 'mini-btn', disabled }, '今日');

  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = Math.min(2020, thisYear - 3); y <= thisYear + 1; y++) years.push({ value: y, label: `${y}年` });
  const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}月` }));
  const days = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: `${i + 1}日` }));

  const parts = () => cur.split('-').map(Number);
  const setParts = (y, m, d) => {
    const max = new Date(y, m, 0).getDate();
    const dd = Math.min(d, max);
    cur = `${y}-${pad(m)}-${pad(dd)}`;
    wd.mark(v => v <= max);
    if (dd !== d) wd.set(dd); // 存在しない日(2/30など)は月末に合わせる
    draw();
    onChange();
  };
  const wy = wheelColumn(years, y => { const [, m, d] = parts(); setParts(y, m, d); });
  const wm = wheelColumn(months, m => { const [y, , d] = parts(); setParts(y, m, d); });
  const wd = wheelColumn(days, d => { const [y, m] = parts(); setParts(y, m, d); });
  const doneBtn = h('button', { type: 'button', class: 'wheels-done' }, '完了');
  const wheels = h('div', { class: 'wheels-wrap' },
    h('div', { class: 'wheels-bar' }, doneBtn),
    h('div', { class: 'wheels' }, wy.el, wm.el, wd.el));

  const syncWheels = () => {
    const [y, m, d] = parts();
    wy.set(y); wm.set(m); wd.set(d);
    wd.mark(v => v <= new Date(y, m, 0).getDate());
  };
  const draw = () => {
    btn.textContent = label(cur);
    todayBtn.hidden = cur === todayStr();
  };
  const open = () => {
    wheels.classList.add('show');
    btn.classList.add('open');
    syncWheels(); // 表示されてから位置を合わせる
    onOpen();
  };
  const close = () => { wheels.classList.remove('show'); btn.classList.remove('open'); };
  btn.addEventListener('click', () => (wheels.classList.contains('show') ? close() : open()));
  doneBtn.addEventListener('click', close);
  todayBtn.addEventListener('click', () => {
    cur = todayStr();
    draw();
    if (wheels.classList.contains('show')) syncWheels();
    onChange();
  });

  draw();
  const el = h('div', { class: 'date-ctl' }, btn, todayBtn);
  return { el, wheels, value: () => cur, close };
}

/* ---------- 支出・入金の登録/編集 ---------- */
function openTxSheet({ tx, date, walletId } = {}) {
  // 明細は開いているサイフだけに記録する(サイフの選択はしない)
  const w = tx ? walletOf(tx.walletId) : walletById(walletId);
  if (!w || (!tx && !isActive(w))) return;
  const locked = !!tx && !isActive(w); // 削除済み・不明サイフは読み取り専用
  const sel = w.id;

  openSheet((p, close) => {
    let kind = tx ? tx.type : 'out'; // 新規はいつも支出から

    const ok = h('button', { class: 'btn-primary', type: 'submit' });
    const setLabel = () => { ok.textContent = tx ? '保存' : kind === 'in' ? '入金' : '登録'; };
    let dateF = null, amt = null;
    const validate_ = () => { if (amt && dateF) ok.disabled = locked || amt.value() === null; };
    // 日付のスロットを開いたら電卓はしまう(画面に収めるため)
    dateF = dateField(tx ? tx.date : (date || todayStr()), locked, validate_, () => amt && amt.hideCalc());
    amt = amountField({ value: tx ? String(tx.amount) : '', min: 1, always: !locked, onChange: validate_ });
    amt.input.addEventListener('click', () => dateF.close());
    amt.box.querySelector('.calc-toggle').addEventListener('click', () => dateF.close());
    if (locked) amt.input.disabled = true;

    // 内容(このサイフで使った内容を候補に出す)
    const dl = h('datalist', { id: 'memo-list' }, recentMemos(sel).map(m => h('option', { value: m })));
    const memo = h('input', {
      id: 'memo', type: 'text', maxlength: '40', autocomplete: 'off', class: 'memo',
      value: tx ? tx.memo : '', disabled: locked,
    });
    memo.addEventListener('focus', () => dateF.close());
    const setMemo = () => {
      memo.placeholder = kind === 'in' ? '入金' : '任意';
      if (kind === 'out') memo.setAttribute('list', 'memo-list');
      else memo.removeAttribute('list');
    };

    // 支出 / 入金 の切り替え。継続サイフの新規登録のときだけ出す(期間サイフでは入金は出さない)
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '種類' });
    const drawSeg = () => {
      seg.hidden = !!tx || w.mode !== 'keep';
      seg.replaceChildren(...[['out', '支出'], ['in', '入金']].map(([k, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(kind === k), class: kind === k ? 'on' : '',
        onclick: () => {
          if (kind === k) return;
          kind = k;
          drawSeg(); setLabel(); setMemo();
          if (!COARSE) amt.input.focus();
        },
      }, label)));
    };

    const head = h('div', { class: 'sheet-wallet', style: { '--c': colorOf(w) } },
      h('span', { class: 'dot' }), h('span', {}, w.name), deletedBadge(w));

    const form = h('form', {
      onsubmit: e => {
        e.preventDefault();
        if (locked) return;
        const n = amt.value();
        const dt = dateF.value();
        if (n === null || !RE_YMD.test(dt)) return;
        const fields = { amount: n, walletId: sel, memo: memo.value.trim(), date: dt };
        const done = mutate(d => {
          if (tx) {
            const t = d.txs.find(x => x.id === tx.id);
            if (!t) return false;
            Object.assign(t, fields);
          } else {
            d.txs.push({ id: newId(), type: kind, ...fields, createdAt: Date.now() });
          }
          if (kind === 'out' && d.wallets.some(w => w.id === sel && !w.deletedAt)) d.lastWalletId = sel;
        });
        close();
        if (done && !tx) toast(`${walletOf(sel).name}  ${kind === 'in' ? '+' : ''}${yen(n)}`);
      },
    },
      head,
      seg,
      h('div', { class: 'amount-row' }, amt.box, ok),
      amt.calc,
      h('div', { class: 'fields' },
        h('div', { class: 'field' }, h('label', { for: 'memo' }, '内容'), memo),
        h('div', { class: 'field' }, h('label', { for: 'date' }, '日付'), dateF.el),
      ),
      dateF.wheels,
      dl,
      tx ? h('button', {
        type: 'button', class: 'btn-wide danger', onclick: () => {
          const snapshot = { ...tx };
          close();
          const done = mutate(d => {
            const i = d.txs.findIndex(x => x.id === tx.id);
            if (i < 0) return false;
            d.txs.splice(i, 1);
          });
          if (done) {
            toast('削除しました', () => mutate(d => {
              if (d.txs.some(x => x.id === snapshot.id)) return false;
              d.txs.push(snapshot);
            }));
          }
        },
      }, '削除') : null,
    );
    // 日本語変換中の Enter では登録しない
    form.addEventListener('keydown', e => { if (e.key === 'Enter' && e.isComposing) e.preventDefault(); });

    drawSeg(); setLabel(); setMemo();
    p.append(form);
    ok.disabled = true;
    if (!locked) setTimeout(() => { amt.input.focus(); amt.input.select(); }, 60);
  });
}

/* ---------- サイフの追加・編集 ---------- */
function openWalletSheet(wallet) {
  openSheet((p, close) => {
    const used = new Set(activeWallets().map(w => w.color));
    let color = wallet ? wallet.color : (COLORS.find(c => !used.has(c)) || COLORS[0]);
    const orig = wallet ? wallet.mode : null;
    let mode = orig || 'keep';
    const today = todayStr();
    const cur = orig === 'period' ? periodFor(wallet.startDay, today) : null;

    // 種類ごとの金額欄の初期値
    const initial = {
      period: orig === 'period' ? String(budgetAt(wallet, cur.start)) : wallet && wallet.budgets.length ? String(wallet.budgets[wallet.budgets.length - 1].amount) : '',
      keep: orig === 'period' ? String(balanceOf(wallet)) : '',
    };
    // 金額欄の意味: 期間=予算 / 継続(新規)=最初の金額 / 期間→継続=今の残高 / 継続のまま=なし
    const amountKind = () => (mode === 'period' ? 'budget' : !wallet ? 'first' : orig === 'period' ? 'balance' : null);

    const name = h('input', { id: 'w-name', type: 'text', maxlength: '20', placeholder: '例: おこづかい', autocomplete: 'off', value: wallet ? wallet.name : '' });
    const ok = h('button', { class: 'btn-wide primary', type: 'submit' }, wallet ? '保存' : '追加');

    let amt = null;
    const amountValue = () => {
      const k = amountKind();
      if (!k) return 0;
      const n = amt.value(); // -MAX〜MAX
      if (k === 'first' && amt.input.value.trim() === '') return 0;
      if (n === null) return null;
      if ((k === 'budget' || k === 'first') && n < 0) return null;
      return n;
    };
    const refresh = () => { ok.disabled = !name.value.trim() || amountValue() === null; };
    amt = amountField({ value: initial[mode], min: -MAX, always: false, big: false, onChange: () => refresh() });
    amt.input.id = 'w-amt';

    const startSel = h('select', { id: 'w-start', class: 'select' },
      Array.from({ length: 28 }, (_, i) => h('option', { value: String(i + 1) }, `${i + 1}日`)));
    startSel.value = String(wallet?.startDay || 1);
    const endLabel = h('span', { class: 'muted small' });
    const drawEnd = () => {
      const s = Number(startSel.value);
      endLabel.textContent = `締め日 ${s === 1 ? '月末' : `翌月${s - 1}日`}`;
    };
    startSel.addEventListener('change', drawEnd);
    drawEnd();

    const amountLabel = h('label', { for: 'w-amt', class: 'wide' });
    const amountRow = h('div', { class: 'field' }, amountLabel, amt.box);
    const startRow = h('div', { class: 'field' }, h('label', { for: 'w-start', class: 'wide' }, '開始日'), startSel, endLabel);
    const fields = h('div', { class: 'fields' },
      h('div', { class: 'field' }, h('label', { for: 'w-name', class: 'wide' }, '名前'), name),
      amountRow, startRow);

    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '種類' });
    const drawMode = () => {
      seg.replaceChildren(...[['keep', '継続'], ['period', '期間']].map(([k, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(mode === k), class: mode === k ? 'on' : '',
        onclick: () => {
          if (mode === k) return;
          mode = k;
          amt.setValue(initial[mode]);
          drawMode();
        },
      }, label)));
      const k = amountKind();
      amountLabel.textContent = { budget: '予算', first: '最初の金額', balance: '今の残高' }[k] || '';
      amountRow.hidden = !k;
      startRow.hidden = mode !== 'period';
      if (!k) amt.hideCalc();
      refresh();
    };
    name.addEventListener('input', refresh);
    name.addEventListener('focus', () => amt.hideCalc());
    startSel.addEventListener('focus', () => amt.hideCalc());

    const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': '色' });
    const drawSw = () => sw.replaceChildren(...COLORS.map(c => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(c === color), 'aria-label': c,
      class: 'swatch' + (c === color ? ' on' : ''), style: { '--c': c },
      onpointerdown: () => amt.hideCalc(),
      onclick: () => { color = c; drawSw(); },
    })));
    drawSw();

    const form = h('form', {
      onsubmit: e => {
        e.preventDefault();
        const nm = name.value.trim();
        const amount = amountValue();
        if (!nm || amount === null) return;
        const s = Number(startSel.value);
        let msg = null;
        mutate(d => {
          if (wallet) {
            const w = d.wallets.find(x => x.id === wallet.id);
            if (!w) return false;
            w.name = nm;
            w.color = color;
            if (w.mode === 'period' && mode === 'keep') {
              // 期間 → 継続: 今の残高から続ける
              w.mode = 'keep';
              w.startDay = null;
              w.opening = { amount, at: Date.now() };
              msg = '継続に変更しました';
            } else if (w.mode === 'keep' && mode === 'period') {
              // 継続 → 期間: 今の期間から予算を適用
              w.mode = 'period';
              w.startDay = s;
              setBudgetFrom(w, periodFor(s, today).start, amount);
              msg = '期間に変更しました';
            } else if (w.mode === 'period') {
              const nowStart = periodFor(w.startDay, today).start;
              if (s !== w.startDay) {
                w.startDay = s;
                setBudgetFrom(w, periodFor(s, today).start, amount);
              } else if (amount !== budgetAt(w, nowStart)) {
                setBudgetFrom(w, nowStart, amount);
              }
            }
          } else {
            const w = {
              id: newId(), name: nm, color, mode,
              order: Math.max(-1, ...d.wallets.filter(x => !x.deletedAt).map(x => x.order)) + 1,
              startDay: mode === 'period' ? s : null,
              budgets: mode === 'period' ? [{ from: periodFor(s, today).start, amount }] : [],
              createdAt: today, deletedAt: null, opening: null,
            };
            d.wallets.push(w);
            if (mode === 'keep' && amount > 0) {
              d.txs.push({ id: newId(), walletId: w.id, type: 'in', amount, memo: '入金', date: today, createdAt: Date.now() });
            }
            fixLastWallet(d);
          }
        });
        close();
        if (msg) { st.wStart = null; st.wMonth = thisMonth(); toast(msg); }
      },
    },
      h('div', { class: 'sheet-head' },
        h('button', { type: 'button', class: 'link', onclick: () => close() }, 'キャンセル'),
        h('h2', {}, wallet ? 'サイフを編集' : '新しいサイフ'),
        h('span', { style: { width: '72px' } })),
      seg,
      fields,
      amt.calc,
      sw,
      ok,
      wallet ? h('button', { type: 'button', class: 'btn-wide danger', onclick: () => { close(true); confirmDeleteWallet(wallet); } }, 'サイフを削除') : null,
    );
    form.addEventListener('keydown', e => { if (e.key === 'Enter' && e.isComposing) e.preventDefault(); });
    p.append(form);
    drawMode();
    setTimeout(() => name.focus(), 60);
  });
}

/* ================================================================
   ルーティング
   ================================================================ */
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
function back() {
  if (history.length > 1 && st.lastHash) history.back();
  else go('#/home');
}

function render() {
  const [p, a] = location.hash.replace(/^#\/?/, '').split('/');
  let tab = 'home', node, fab = null; // ＋はサイフ詳細でだけ出す

  switch (p) {
    case 'cal':
      tab = 'cal'; node = calendarView(); fab = null; break;
    case 'rec':
      tab = 'rec';
      node = a && RE_YM.test(a) ? recordDetailView(a) : recordsView();
      break;
    case 'settings':
      tab = 'rec'; node = settingsView(); fab = null; break;
    case 'wallet': {
      node = walletView(a);
      fab = isActive(walletById(a)) ? { walletId: a } : null;
      tab = null;
      break;
    }
    case 'manage':
      tab = null; node = manageView(); fab = null; break;
    default:
      node = homeView();
  }

  $('#view').replaceChildren(node);
  document.querySelectorAll('#tabbar a').forEach(el => el.classList.toggle('on', el.dataset.tab === tab));
  const fabEl = $('#fab');
  fabEl.hidden = !fab || readOnly;
  fabEl.onclick = () => openTxSheet(fab || {});
}

function reloadFromStorage() {
  const fresh = readLatest();
  if (fresh) { data = fresh; readOnly = false; }
  rebuildIndex();
  render();
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
  st.lastHash = location.hash;
});

// 日付が変わったら「今日」を計算し直す(締め日を過ぎたら次の期間になる)
function onWake() {
  const t = todayStr();
  if (t !== st.today) {
    const oldMonth = st.today.slice(0, 7);
    st.today = t;
    if (st.month === oldMonth) st.month = thisMonth();
    st.wStart = null;
    render();
  }
  checkAutoBackup();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) onWake(); });
setInterval(onWake, 60 * 60 * 1000);

// 別タブで保存されたら読み直す(入力中はシートを閉じてから)
window.addEventListener('storage', e => {
  if (e.key !== KEY && e.key !== DEVICE_KEY && e.key !== null) return;
  if (closeCurrent) { st.pendingReload = true; return; }
  reloadFromStorage();
});

/* ================================================================
   起動
   ================================================================ */
data = load();
rebuildIndex();
navigator.storage?.persist?.().catch(() => {});
// オフラインでも開けるようにする(https か 127.0.0.1 のときだけ使える)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (!location.hash) location.replace('#/home');
render();
probeServer().then(async () => { await takeHandoff(); render(); checkAutoBackup(); });
