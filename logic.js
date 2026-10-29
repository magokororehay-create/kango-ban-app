// 自動生成：kango_ban_gas/tools/build_web_logic.mjs。直接編集しない（元は kango_ban_gas/Logic.gs）。
var KangoBan = (function () {
// 看護 訪問スケジュール盤の判定（純粋関数のみ。シート・画面には触れない）。
// 画面は tools/build_web_logic.mjs が作る写し webapp/logic.js（KangoBan.*）で同じものを使う。
// 状態 State = {clients, slots, days, events, staff, settings}（形は docs/superpowers/plans/2026-10-29-kango-ban.md の Task 1）。

var T0 = 540, T1 = 1020;          // 盤面は 9:00〜17:00
var LUNCH = [720, 780];           // 昼 12:00〜13:00（空き枠の候補にしない）
var DOWS = ['日', '月', '火', '水', '木', '金', '土'];
var LANE_RE = /^[A-H]$/;
var INS_LABEL = { k: '介護', i: '医療', m: 'その他' };
var TABS = {
  '利用者': ['ID', '氏名', '保険', '新規', '開始日', '終了日', 'メモ', '標準分', '特指示開始', '特指示終了', '特指示時刻', '特指示分', '休止開始', '再開予定', '休止理由'],
  '型': ['ID', '利用者ID', '曜日', '列', '開始', '分', '週'],
  '日の変更': ['日付', 'キー', '種類', '列', '開始', '分', '理由'],
  '日の追加': ['日付', 'ID', '利用者ID', '列', '開始', '分'],
  '日の列': ['日付', '列', '担当'],
  '予定': ['ID', '日付', '内容', '開始', '分', '列'],
  '看護師': ['名前'],
  '設定': ['キー', '値'],
};

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function parseHm(s) {
  var m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(String(s == null ? '' : s));
  if (!m) return null;
  var v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 1440 ? v : null;
}

function fmtHm(m) { return Math.floor(m / 60) + ':' + pad2_(m % 60); }

// '2026-11-04'・'2026/11/4' を 'YYYY-MM-DD' に。読めなければ ''。
function normDate(s) {
  var m = /^\s*(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(String(s == null ? '' : s));
  return m ? m[1] + '-' + pad2_(Number(m[2])) + '-' + pad2_(Number(m[3])) : '';
}

function parseDate_(s) { var p = s.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function dowOf(date) { return parseDate_(date).getDay(); }
function weekOfMonth(date) { return Math.ceil(Number(date.split('-')[2]) / 7); }
function md_(date) { var p = date.split('-'); return Number(p[1]) + '/' + Number(p[2]); }

function lanesOf_(state, date) {
  var d = state.days[date];
  return (d && d.lanes) ? d.lanes.slice() : state.settings.defLanes.slice();
}

// 休止（入院など）の間か。再開予定日の当日からは休止ではない。
function pausedOn_(c, date) {
  var p = c.pause;
  return !!(p && p.from && date >= p.from && (!p.until || date < p.until));
}

// その日に、置く（placed）・未配置（tray）・休み（off）・出ない人（skip）・休止中（paused）を決める。
// 休止中の人は毎週の型を残したまま盤面に出さない（再開すれば元の曜日・時間・列に戻る）。
function itemsFor(state, date) {
  var dow = dowOf(date), wk = weekOfMonth(date), day = state.days[date] || {}, moves = day.moves || {}, lanes = lanesOf_(state, date);
  var byId = {}, out = [], placed = [], tray = [], off = [], skip = [], paused = [];
  state.clients.forEach(function (c) {
    byId[c.id] = c;
    if (pausedOn_(c, date) && !(c.end && date > c.end)) {
      paused.push({ clientId: c.id, why: (c.pause.reason || '休止') + '（' + md_(c.pause.from) + 'から' + (c.pause.until ? '・' + md_(c.pause.until) + '再開予定' : '') + '）' });
    }
  });
  var active = function (c) { return !(c.end && date > c.end) && !(c.start && date < c.start) && !pausedOn_(c, date); };
  state.slots.forEach(function (s) {
    var c = byId[s.clientId];
    if (!c || s.dow !== dow || (c.end && date > c.end) || pausedOn_(c, date)) return;
    if (c.start && date < c.start) { skip.push({ clientId: c.id, why: md_(c.start) + 'から開始' }); return; }
    if (s.weeks && s.weeks.length && s.weeks.indexOf(wk) < 0) { skip.push({ clientId: c.id, why: '第' + s.weeks.join('・') + '週だけ' }); return; }
    out.push({ key: 's:' + s.id, kind: 's', clientId: c.id, slotId: s.id, weeks: s.weeks, lane: s.lane, start: s.start, min: s.min });
  });
  state.clients.forEach(function (c) {
    if (c.sp && active(c) && c.sp.from <= date && date <= c.sp.to)
      out.push({ key: 'p:' + c.id, kind: 'p', clientId: c.id, lane: null, start: c.sp.start, min: c.sp.min });
  });
  var added = {};
  (day.adds || []).forEach(function (a) {
    if (!byId[a.clientId]) return;
    added[a.clientId] = true;
    out.push({ key: 'a:' + a.id, kind: 'a', clientId: a.clientId, addId: a.id, lane: a.lane, start: a.start, min: a.min, moved: true });
  });
  state.events.forEach(function (e) {
    if (e.date === date) out.push({ key: 'e:' + e.id, kind: 'e', eventId: e.id, title: e.title, lane: e.lane, start: e.start, min: e.min });
  });
  out.forEach(function (it) {
    var mv = moves[it.key];
    if (mv) {
      if (mv.off) { it.why = mv.reason || '休み'; off.push(it); return; }
      if (mv.tray) { it.why = 'この日は外した'; tray.push(it); return; }
      it.lane = mv.lane; it.start = mv.start; it.min = mv.min; it.moved = true;
    }
    if (!it.lane) {
      it.why = it.kind === 'p' ? '特指示（' + md_(byId[it.clientId].sp.to) + 'まで毎日）：空いている列へ' : '時間・列が未定';
      tray.push(it); return;
    }
    if (lanes.indexOf(it.lane) < 0) { it.why = it.lane + '列を外したため'; tray.push(it); return; }
    placed.push(it);
  });
  state.clients.forEach(function (c) {
    if (active(c) && !c.sp && !added[c.id] && !state.slots.some(function (s) { return s.clientId === c.id; }))
      tray.push({ key: 'u:' + c.id, kind: 'u', clientId: c.id, min: c.defMin || 60, why: '曜日・時間が未定' });
  });
  conflicts(placed, lanes, state.settings.gapWarn);
  return { placed: placed, tray: tray, off: off, skip: skip, paused: paused, lanes: lanes, wk: wk, dow: dow };
}

// 同じ列で時間が重なれば両方に bad、前の訪問との間が gapWarn 分より短ければ warn。
function conflicts(placed, lanes, gapWarn) {
  lanes.forEach(function (L) {
    var arr = placed.filter(function (i) { return i.lane === L; }).sort(function (a, b) { return a.start - b.start; });
    var prev = null;
    arr.forEach(function (it) {
      if (prev) {
        var pe = prev.start + prev.min;
        if (it.start < pe) { it.bad = true; prev.bad = true; }
        else if (it.start - pe < (gapWarn || 0)) it.warn = true;
      }
      if (!prev || it.start + it.min > prev.start + prev.min) prev = it;
    });
  });
}

// lane に min 分のカードを入れられる開始時刻（10分刻み・空きのかたまりごとに最初の1つ・最大4つ）。
function freeSlots(placed, lane, min, gapWarn, exKey) {
  var g = gapWarn || 0;
  var busy = placed.filter(function (i) { return i.lane === lane && i.key !== exKey; })
    .map(function (i) { return [i.start - g, i.start + i.min + g]; });
  busy.push(LUNCH);
  var res = [], last = -99;
  for (var t = T0 + 10; t + min <= T1; t += 10) {
    var ok = busy.every(function (b) { return t + min <= b[0] || t >= b[1]; });
    if (ok) { if (t - last > 10) res.push(t); last = t; }
  }
  return res.slice(0, 4);
}

// 数として読めなければ dflt（null・空文字も dflt。Number(null) が 0 になるのを避ける）。
function num_(v, dflt) {
  if (v == null || String(v).trim() === '') return dflt;
  var n = Number(v);
  return isFinite(n) ? n : dflt;
}

var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
var KEY_RE = /^[spae]:[A-Za-z0-9_-]{1,40}$/;

// 画面から届いた状態を、欠けた欄を既定値で埋めた形にする。
function normalizeState(o) {
  o = o || {};
  var weeks = function (w) { var a = (w || []).map(Number).filter(function (x) { return x >= 1 && x <= 5; }); return a.length ? a : null; };
  var mv = function (m) {
    if (!m) return null;
    if (m.off) return { off: 1, reason: String(m.reason || '') };
    if (m.tray) return { tray: 1 };
    return { lane: String(m.lane || ''), start: num_(m.start, -1), min: num_(m.min, 0) };
  };
  var days = {};
  Object.keys(o.days || {}).forEach(function (date) {
    var d = o.days[date] || {}, nd = {};
    if (d.lanes) nd.lanes = d.lanes.map(String);
    if (d.staff) { nd.staff = {}; Object.keys(d.staff).forEach(function (k) { if (d.staff[k]) nd.staff[k] = String(d.staff[k]); }); }
    if (d.moves) { nd.moves = {}; Object.keys(d.moves).forEach(function (k) { var m = mv(d.moves[k]); if (m) nd.moves[k] = m; }); }
    if (d.adds) nd.adds = d.adds.map(function (a) { return { id: String(a.id), clientId: String(a.clientId), lane: String(a.lane), start: num_(a.start, -1), min: num_(a.min, 0) }; });
    if (Object.keys(nd).length) days[normDate(date) || date] = nd;
  });
  return {
    clients: (o.clients || []).map(function (c) {
      return { id: String(c.id), name: String(c.name || ''), ins: INS_LABEL[c.ins] ? c.ins : 'k', isNew: !!c.isNew,
        start: normDate(c.start), end: normDate(c.end), note: String(c.note || ''), defMin: num_(c.defMin, 60),
        sp: c.sp ? { from: normDate(c.sp.from), to: normDate(c.sp.to), start: num_(c.sp.start, 960), min: num_(c.sp.min, 30) } : null,
        pause: c.pause && c.pause.from ? { from: normDate(c.pause.from), until: normDate(c.pause.until), reason: String(c.pause.reason || '') } : null };
    }),
    slots: (o.slots || []).map(function (s) {
      return { id: String(s.id), clientId: String(s.clientId), dow: num_(s.dow, 0), lane: String(s.lane || ''), start: num_(s.start, -1), min: num_(s.min, 0), weeks: weeks(s.weeks) };
    }),
    days: days,
    events: (o.events || []).map(function (e) {
      return { id: String(e.id), date: normDate(e.date), title: String(e.title || ''), start: num_(e.start, -1), min: num_(e.min, 0), lane: e.lane ? String(e.lane) : null };
    }),
    staff: (o.staff || []).map(String).filter(function (s) { return s; }),
    settings: {
      defLanes: (o.settings && o.settings.defLanes && o.settings.defLanes.length ? o.settings.defLanes : ['A', 'B', 'C', 'D']).map(String),
      gapWarn: num_(o.settings && o.settings.gapWarn, 0),
    },
  };
}

// 保存してよい形かを確かめる。問題ごとに1行（氏名は書かずIDで示す）。空なら正常。
// ID と列の名前は画面の属性に入るので、決まった形だけを通す（形の悪い ID はそのまま書かずに「形が正しくない」とだけ言う）。
function validateState(state) {
  var errs = [], seen = {}, cid = {};
  var idOk = function (kind, id) {
    if (!ID_RE.test(String(id))) { errs.push(kind + 'のIDの形が正しくない'); return false; }
    var k = kind + '|' + id; if (seen[k]) errs.push(kind + 'のIDが重複: ' + id); seen[k] = true;
    return true;
  };
  var timeOk = function (start, min) {
    return typeof start === 'number' && typeof min === 'number' && start >= 0 && start < 1440 && min > 0 && min <= 600;
  };
  var laneOk = function (l) { return LANE_RE.test(String(l)); };
  state.clients.forEach(function (c) {
    if (!idOk('利用者', c.id)) return;
    cid[c.id] = true;
    if (c.sp && (!c.sp.from || !c.sp.to || c.sp.to < c.sp.from || !timeOk(c.sp.start, c.sp.min))) errs.push('特指示の期間・時刻が正しくない: ' + c.id);
    if (c.pause && (!normDate(c.pause.from) || (c.pause.until && c.pause.until <= c.pause.from))) errs.push('休止の開始日・再開予定日が正しくない: ' + c.id);
  });
  state.slots.forEach(function (s) {
    if (!idOk('枠', s.id)) return;
    if (!cid[s.clientId]) errs.push('枠の利用者が見つからない: ' + s.id);
    else if (!(s.dow >= 1 && s.dow <= 5) || !laneOk(s.lane) || !timeOk(s.start, s.min)) errs.push('枠の曜日・列・時刻が正しくない: ' + s.id);
  });
  Object.keys(state.days).forEach(function (date) {
    var d = state.days[date];
    if (!normDate(date)) { errs.push('日付が正しくない日の変更がある'); return; }
    if (d.lanes && !d.lanes.every(laneOk)) errs.push('列の名前が正しくない: ' + date);
    if (d.staff && !Object.keys(d.staff).every(laneOk)) errs.push('担当の列の名前が正しくない: ' + date);
    Object.keys(d.moves || {}).forEach(function (key) {
      var m = d.moves[key];
      if (!KEY_RE.test(key)) { errs.push('その日の変更のキーが正しくない: ' + date); return; }
      if (!m.off && !m.tray && (!laneOk(m.lane) || !timeOk(m.start, m.min))) errs.push('その日の移動の列・時刻が正しくない: ' + date + ' ' + key);
    });
    (d.adds || []).forEach(function (a) {
      if (!idOk('追加', a.id)) return;
      if (!cid[a.clientId]) errs.push('追加の利用者が見つからない: ' + a.id);
      else if (!laneOk(a.lane) || !timeOk(a.start, a.min)) errs.push('追加の列・時刻が正しくない: ' + a.id);
    });
  });
  state.events.forEach(function (e) {
    if (!idOk('予定', e.id)) return;
    if (!e.date || !timeOk(e.start, e.min) || (e.lane != null && !laneOk(e.lane))) errs.push('予定の日付・時刻・列が正しくない: ' + e.id);
  });
  if (!state.settings.defLanes.length || !state.settings.defLanes.every(laneOk)) errs.push('既定の列の名前が正しくない');
  return errs;
}

// シートを人が手で直して、読めない値が入っていないか（保存すると消えたり 0:00 になったりするので先に止める）。
// 「タブ 行目：列」の形で返す。値そのもの（氏名が混じりうる）は書かない。
function tableProblems(tables) {
  var out = [];
  var check = function (tab, rules) {
    var rows = tables[tab] || [];
    if (!rows.length) return;
    var head = rows[0].map(function (h) { return String(h).trim(); });
    rows.slice(1).forEach(function (r, i) {
      if (!r.some(function (v) { return String(v).trim() !== ''; })) return;
      Object.keys(rules).forEach(function (col) {
        var j = head.indexOf(col);
        var v = j < 0 ? '' : String(r[j] == null ? '' : r[j]).trim();
        if (!rules[col](v, r, head)) out.push(tab + ' ' + (i + 2) + '行目：' + col + 'が読めない');
      });
    });
  };
  var date = function (req) { return function (v) { return v === '' ? !req : !!normDate(v); }; };
  var time = function (req) { return function (v) { return v === '' ? !req : parseHm(v) !== null; }; };
  var minutes = function (req) { return function (v) { return v === '' ? !req : Number(v) > 0 && Number(v) <= 600; }; };
  var weeks = function (v) { return v === '' || v.split(',').every(function (x) { return /^[1-5]$/.test(x.trim()); }); };
  var isMove = function (r, head) { return String(r[head.indexOf('種類')]).trim() === '移動'; };
  check('利用者', { '開始日': date(false), '終了日': date(false), '標準分': minutes(false), '特指示開始': date(false), '特指示終了': date(false), '特指示時刻': time(false), '特指示分': minutes(false),
    '休止開始': date(false), '再開予定': date(false) });
  check('型', { '曜日': function (v) { return DOWS.indexOf(v) >= 1 && DOWS.indexOf(v) <= 5; }, '開始': time(true), '分': minutes(true), '週': weeks });
  check('日の変更', { '日付': date(true), '開始': function (v, r, h) { return !isMove(r, h) || parseHm(v) !== null; }, '分': function (v, r, h) { return !isMove(r, h) || Number(v) > 0; } });
  check('日の追加', { '日付': date(true), '開始': time(true), '分': minutes(true) });
  check('日の列', { '日付': date(true), '担当': function (v) { if (v === '') return true; try { JSON.parse(v); return true; } catch (e) { return false; } } });
  check('予定', { '日付': date(true), '開始': time(true), '分': minutes(true) });
  return out;
}

// 状態 → シートのタブ（見出し行つきの2次元配列。値はすべて文字列）。
function stateToTables(state) {
  var t = {};
  Object.keys(TABS).forEach(function (k) { t[k] = [TABS[k].slice()]; });
  state.clients.forEach(function (c) {
    var sp = c.sp, pz = c.pause;
    t['利用者'].push([c.id, c.name, INS_LABEL[c.ins], c.isNew ? '新規' : '', c.start, c.end, c.note, String(c.defMin),
      sp ? sp.from : '', sp ? sp.to : '', sp ? fmtHm(sp.start) : '', sp ? String(sp.min) : '',
      pz ? pz.from : '', pz ? pz.until : '', pz ? pz.reason : '']);
  });
  state.slots.forEach(function (s) {
    t['型'].push([s.id, s.clientId, DOWS[s.dow], s.lane, fmtHm(s.start), String(s.min), s.weeks ? s.weeks.join(',') : '']);
  });
  Object.keys(state.days).sort().forEach(function (date) {
    var d = state.days[date];
    Object.keys(d.moves || {}).forEach(function (key) {
      var m = d.moves[key];
      if (m.off) t['日の変更'].push([date, key, '休み', '', '', '', m.reason || '']);
      else if (m.tray) t['日の変更'].push([date, key, '未配置', '', '', '', '']);
      else t['日の変更'].push([date, key, '移動', m.lane, fmtHm(m.start), String(m.min), '']);
    });
    (d.adds || []).forEach(function (a) { t['日の追加'].push([date, a.id, a.clientId, a.lane, fmtHm(a.start), String(a.min)]); });
    if (d.lanes || d.staff) t['日の列'].push([date, d.lanes ? d.lanes.join(',') : '', d.staff ? JSON.stringify(d.staff) : '']);
  });
  state.events.forEach(function (e) { t['予定'].push([e.id, e.date, e.title, fmtHm(e.start), String(e.min), e.lane || '']); });
  state.staff.forEach(function (s) { t['看護師'].push([s]); });
  t['設定'].push(['既定の列', state.settings.defLanes.join(',')], ['間の警告分', String(state.settings.gapWarn)]);
  return t;
}

// シートのタブ → 状態。見出しの名前で列を引くので、列の並びが変わっても読める。
function stateFromTables(tables) {
  var recs = function (name) {
    var rows = tables[name] || [];
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return String(h).trim(); });
    return rows.slice(1).filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); })
      .map(function (r) { var o = {}; head.forEach(function (h, i) { o[h] = String(r[i] == null ? '' : r[i]).trim(); }); return o; });
  };
  var insOf = function (label) { var k = Object.keys(INS_LABEL).filter(function (x) { return INS_LABEL[x] === label; })[0]; return k || 'k'; };
  var days = {};
  var day = function (date) { return days[date] || (days[date] = {}); };
  recs('日の変更').forEach(function (r) {
    var date = normDate(r['日付']); if (!date) return;
    var d = day(date), m;
    if (r['種類'] === '休み') m = { off: 1, reason: r['理由'] };
    else if (r['種類'] === '未配置') m = { tray: 1 };
    else m = { lane: r['列'], start: parseHm(r['開始']), min: Number(r['分']) };
    (d.moves || (d.moves = {}))[r['キー']] = m;
  });
  recs('日の追加').forEach(function (r) {
    var date = normDate(r['日付']); if (!date) return;
    var d = day(date);
    (d.adds || (d.adds = [])).push({ id: r['ID'], clientId: r['利用者ID'], lane: r['列'], start: parseHm(r['開始']), min: Number(r['分']) });
  });
  recs('日の列').forEach(function (r) {
    var date = normDate(r['日付']); if (!date) return;
    var d = day(date);
    if (r['列']) d.lanes = r['列'].split(',').map(function (x) { return x.trim(); }).filter(String);
    if (r['担当']) { try { d.staff = JSON.parse(r['担当']); } catch (e) { /* 壊れた担当は読まない */ } }
  });
  var conf = {};
  recs('設定').forEach(function (r) { conf[r['キー']] = r['値']; });
  return {
    clients: recs('利用者').map(function (r) {
      return { id: r['ID'], name: r['氏名'], ins: insOf(r['保険']), isNew: r['新規'] === '新規', start: normDate(r['開始日']), end: normDate(r['終了日']),
        note: r['メモ'], defMin: num_(r['標準分'], 60),
        sp: r['特指示開始'] ? { from: normDate(r['特指示開始']), to: normDate(r['特指示終了']), start: parseHm(r['特指示時刻']), min: Number(r['特指示分']) } : null,
        pause: r['休止開始'] ? { from: normDate(r['休止開始']), until: normDate(r['再開予定'] || ''), reason: r['休止理由'] || '' } : null };
    }),
    slots: recs('型').map(function (r) {
      var w = r['週'] ? r['週'].split(',').map(Number).filter(function (x) { return x >= 1 && x <= 5; }) : [];
      return { id: r['ID'], clientId: r['利用者ID'], dow: DOWS.indexOf(r['曜日']), lane: r['列'], start: parseHm(r['開始']), min: Number(r['分']), weeks: w.length ? w : null };
    }),
    days: days,
    events: recs('予定').map(function (r) {
      return { id: r['ID'], date: normDate(r['日付']), title: r['内容'], start: parseHm(r['開始']), min: Number(r['分']), lane: r['列'] || null };
    }),
    staff: recs('看護師').map(function (r) { return r['名前']; }).filter(String),
    settings: {
      defLanes: conf['既定の列'] ? conf['既定の列'].split(',').map(function (x) { return x.trim(); }).filter(String) : ['A', 'B', 'C', 'D'],
      gapWarn: num_(conf['間の警告分'], 0),
    },
  };
}

// 確定の前後で変わった件数（変更履歴に残す。氏名は含めない）。
function summarizeDiff(before, after) {
  var count = function (a, b) {
    var m = {}, n = 0;
    a.forEach(function (x) { m[x.id] = JSON.stringify(x); });
    b.forEach(function (x) { if (m[x.id] !== JSON.stringify(x)) n++; delete m[x.id]; });
    return n + Object.keys(m).length;
  };
  var dates = {}, dayChanges = 0;
  Object.keys(before.days).concat(Object.keys(after.days)).forEach(function (d) { dates[d] = true; });
  Object.keys(dates).forEach(function (d) { if (JSON.stringify(before.days[d] || {}) !== JSON.stringify(after.days[d] || {})) dayChanges++; });
  return { clients: count(before.clients, after.clients), slots: count(before.slots, after.slots), dayChanges: dayChanges, events: count(before.events, after.events) };
}

  return { T0: T0, T1: T1, LUNCH: LUNCH, DOWS: DOWS, TABS: TABS, parseHm: parseHm, fmtHm: fmtHm, normDate: normDate, dowOf: dowOf, weekOfMonth: weekOfMonth, itemsFor: itemsFor, conflicts: conflicts, freeSlots: freeSlots, normalizeState: normalizeState, validateState: validateState, stateToTables: stateToTables, stateFromTables: stateFromTables, summarizeDiff: summarizeDiff };
})();
