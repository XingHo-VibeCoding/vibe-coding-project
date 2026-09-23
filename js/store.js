/* ============================================================
   store.js —— 数据层（TECH_DESIGN §4.1）
   职责：localStorage 的唯一出入口。别的文件不许直接碰 localStorage。
   Day 7 第②步：落地真实读写（读取失败先备份再返回空结构）+ 学期/日程/待办增删改。
   规则（AGENTS.md 八.2）：改动字段必须同步文档 + 写旧数据升级方案。
   ============================================================ */

window.Store = (function () {
  'use strict';

  // 存储键命名：sched.v1.<表名>（TECH_DESIGN §3）
  var KEYS = {
    semester:  'sched.v1.semesters',
    schedules: 'sched.v1.schedules',
    todos:     'sched.v1.todos',
    meta:      'sched.v1.meta',
    backup:    'sched.v1.backup'
  };

  var SCHEMA_VERSION = 1;

  // 最近一次读取发现的问题（null = 一切正常），供界面提示用
  var lastIssue = null;

  // 空数据结构：读取失败时返回它，保证页面不崩（TECH_DESIGN §6）
  function emptyState() {
    return { semester: null, schedules: [], todos: [], meta: { schema_version: SCHEMA_VERSION } };
  }

  /* ---------------- 小工具 ---------------- */

  function nowIso() { return new Date().toISOString(); }

  function genId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function isTimeStr(s) { return /^\d{2}:\d{2}$/.test(String(s || '')); }
  function timeToMin(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
  }

  /* ---------------- 上课节次时间（Day 8，方案 A：模板可编辑） ----------------
     每所学校节次时间不同，模板只是默认值，学期设置里可整段修改。
     存储形态：semester.periods = [{ no:1, start:'08:00', end:'08:45' }, ...] */

  function defaultPeriods() {
    return [
      { no: 1,  start: '08:00', end: '08:45' },
      { no: 2,  start: '08:55', end: '09:40' },
      { no: 3,  start: '10:10', end: '10:55' },
      { no: 4,  start: '11:05', end: '11:50' },
      { no: 5,  start: '14:00', end: '14:45' },
      { no: 6,  start: '14:55', end: '15:40' },
      { no: 7,  start: '16:10', end: '16:55' },
      { no: 8,  start: '17:05', end: '17:50' },
      { no: 9,  start: '18:30', end: '19:15' },
      { no: 10, start: '19:25', end: '20:10' }
    ];
  }

  function normalizePeriods(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push({ no: Number(list[i].no), start: String(list[i].start), end: String(list[i].end) });
    }
    out.sort(function (a, b) { return a.no - b.no; });
    return out;
  }

  /* 返回错误文案；null = 合法。允许空数组（不设节次） */
  function validatePeriods(list) {
    if (!Array.isArray(list)) return '上课时间段格式不正确。';
    if (list.length > 15) return '节次数最多 15 节。';
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var no = Number(p && p.no);
      if (!(no >= 1 && no <= 15) || seen[no]) return '节次序号必须是 1–15 且不重复。';
      seen[no] = true;
      if (!isTimeStr(p.start) || !isTimeStr(p.end)) return '第 ' + no + ' 节的时间格式应为 HH:mm。';
      if (timeToMin(p.start) >= timeToMin(p.end)) return '第 ' + no + ' 节的结束时间必须晚于开始时间。';
    }
    return null;
  }

  /* ---------------- 底层读写：全项目只有这里碰 localStorage ---------------- */

  function storage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  // 把损坏内容原样搬到备份键，用户事后还能找回（TECH_DESIGN §6）
  function backupCorrupt(key, raw, err) {
    var s = storage();
    if (!s) return;
    try {
      s.setItem(KEYS.backup, JSON.stringify({
        key: key,
        raw: raw,
        error: String((err && err.message) || err),
        at: nowIso()
      }));
    } catch (e) { /* 备份本身失败也不能让页面崩 */ }
  }

  // 读一张表；内容损坏 → 备份 + 返回兜底值，并把问题记进 lastIssue
  function readTable(key, fallback) {
    var s = storage();
    if (!s) {
      lastIssue = '本机存储不可用（可能开了隐私模式），数据无法保存。';
      return fallback;
    }

    var raw;
    try {
      raw = s.getItem(key);
    } catch (e) {
      lastIssue = '读取本机存储失败：' + e.message;
      return fallback;
    }

    if (raw === null || raw === '') return fallback;

    try {
      var val = JSON.parse(raw);
      if (val === null || typeof val !== 'object') throw new Error('内容不是有效的对象');
      return val;
    } catch (e) {
      backupCorrupt(key, raw, e);
      lastIssue = '数据读取异常，已备份原数据，当前显示为空。';
      return fallback;
    }
  }

  // 写一张表；容量超限等失败一律不破坏已有数据
  function writeTable(key, value) {
    var s = storage();
    if (!s) return { ok: false, error: '本机存储不可用（可能开了隐私模式），保存失败。' };

    try {
      s.setItem(key, JSON.stringify(value));
      return { ok: true };
    } catch (e) {
      var isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
      return {
        ok: false,
        error: isQuota
          ? '保存失败：本机存储空间已满，请先导出备份再清理。'
          : '保存失败：' + ((e && e.message) ? e.message : '本机存储写入被拒绝') + '。'
      };
    }
  }

  function listOf(key) {
    var list = readTable(key, []);
    return Array.isArray(list) ? list : [];
  }

  /* ---------------- 读取 ---------------- */

  /* 一次性读出全部数据（TECH_DESIGN §4.1） */
  function load() {
    lastIssue = null;

    var s = emptyState();

    var semester = readTable(KEYS.semester, null);
    s.semester = (semester && typeof semester === 'object' && !Array.isArray(semester)) ? semester : null;

    s.schedules = listOf(KEYS.schedules);
    s.todos = listOf(KEYS.todos);

    var meta = readTable(KEYS.meta, null);
    s.meta = (meta && typeof meta === 'object' && !Array.isArray(meta))
      ? meta
      : { schema_version: SCHEMA_VERSION };

    return s;
  }

  /* 上一次 load() 是否发现问题（界面用来提示用户） */
  function lastLoadIssue() { return lastIssue; }

  /* ---------------- 学期（一期只有一条） ---------------- */

  function validateSemester(input) {
    if (!input) return { ok: false, error: '没有填写学期信息。' };
    var bad = [];
    if (!String(input.name || '').trim()) bad.push('学期名');
    if (!isDateStr(input.first_monday)) bad.push('第一周周一日期');
    var tw = Number(input.total_weeks);
    if (!(tw >= 1 && tw <= 30)) bad.push('总周数（1–30）');
    if (bad.length) return { ok: false, error: '请检查：' + bad.join('、') };
    /* periods 可选：不传 = 沿用旧值；传了必须合法（Day 8） */
    if (input.periods !== undefined && input.periods !== null) {
      var perr = validatePeriods(input.periods);
      if (perr) return { ok: false, error: perr };
    }
    return { ok: true };
  }

  /* 保存/更新学期（TECH_DESIGN §4.1） */
  function saveSemester(input) {
    var check = validateSemester(input);
    if (!check.ok) return check;

    var old = readTable(KEYS.semester, null);
    if (old && (typeof old !== 'object' || Array.isArray(old))) old = null;

    /* 不传 periods = 沿用旧值（旧数据兼容：老学期没有 periods 也能正常保存） */
    var periods;
    if (input.periods === undefined || input.periods === null) {
      periods = (old && Array.isArray(old.periods)) ? old.periods : [];
    } else {
      periods = normalizePeriods(input.periods);
    }

    var semester = {
      id: (old && old.id) || genId('sem_'),
      name: String(input.name).trim(),
      first_monday: String(input.first_monday),
      total_weeks: Number(input.total_weeks),
      periods: periods,
      created_at: (old && old.created_at) || nowIso()
    };

    var res = writeTable(KEYS.semester, semester);
    if (res.ok) res.semester = semester;
    return res;
  }

  /* ---------------- 日程（课程 / 独立日程） ---------------- */

  function validateSchedule(input) {
    if (!input) return { ok: false, error: '没有填写日程信息。' };
    if (!String(input.title || '').trim()) return { ok: false, error: '请填写日程名称。' };
    if (!isTimeStr(input.start_time)) return { ok: false, error: '请填写开始时间（HH:mm）。' };
    if (!(Number(input.duration) > 0)) return { ok: false, error: '请填写持续时长（分钟）。' };

    if (input.type === 'course') {
      var wd = Number(input.weekday);
      if (!(wd >= 1 && wd <= 7)) return { ok: false, error: '请选择星期。' };
      if (['every', 'odd', 'even'].indexOf(input.week_rule) < 0) {
        return { ok: false, error: '请选择周次规则（每周/单周/双周）。' };
      }
    } else if (input.type === 'event') {
      if (!isDateStr(input.date)) return { ok: false, error: '请选择日期。' };
    } else {
      return { ok: false, error: '未知的日程类型。' };
    }
    return { ok: true };
  }

  function normalizeSchedule(input, createdAt) {
    return {
      id: input.id || genId('sch_'),
      type: input.type,
      title: String(input.title).trim(),
      note: String(input.note || '').trim(),
      location: String(input.location || '').trim(),
      weekday: input.type === 'course' ? Number(input.weekday) : null,
      start_time: String(input.start_time),
      duration: Number(input.duration),
      week_rule: input.type === 'course' ? input.week_rule : null,
      date: input.type === 'event' ? String(input.date) : null,
      color: input.color || '',
      semester_id: input.type === 'course' ? String(input.semester_id || '') : null,
      manual_edited: input.manual_edited !== false,
      created_at: createdAt,
      updated_at: nowIso()
    };
  }

  /* 新增或更新日程（按 id 判断） */
  function saveSchedule(input) {
    var check = validateSchedule(input);
    if (!check.ok) return check;

    var list = listOf(KEYS.schedules);
    var saved = null;
    var updated = false;

    for (var i = 0; i < list.length; i++) {
      if (list[i] && input.id && list[i].id === input.id) {
        list[i] = normalizeSchedule(input, list[i].created_at || nowIso());
        saved = list[i];
        updated = true;
        break;
      }
    }
    if (!updated) {
      saved = normalizeSchedule(input, nowIso());
      list.push(saved);
    }

    var res = writeTable(KEYS.schedules, list);
    if (res.ok) res.schedule = saved;
    return res;
  }

  function deleteSchedule(id) {
    var list = listOf(KEYS.schedules);
    var next = [];
    var hit = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) { hit = true; continue; }
      next.push(list[i]);
    }
    if (!hit) return { ok: false, error: '没找到要删除的日程。' };
    return writeTable(KEYS.schedules, next);
  }

  /* ---------------- 待办 ---------------- */

  function validateTodo(input) {
    if (!input) return { ok: false, error: '没有填写待办信息。' };
    if (!String(input.title || '').trim()) return { ok: false, error: '请填写待办标题。' };
    if (!isDateStr(input.due_date)) return { ok: false, error: '请选择截止日期。' };
    return { ok: true };
  }

  function normalizeTodo(input, createdAt) {
    return {
      id: input.id || genId('todo_'),
      title: String(input.title).trim(),
      note: String(input.note || '').trim(),
      due_date: String(input.due_date),
      done: !!input.done,
      done_at: input.done ? (input.done_at || nowIso()) : null,
      source: input.source || 'manual',
      created_at: createdAt
    };
  }

  function saveTodo(input) {
    var check = validateTodo(input);
    if (!check.ok) return check;

    var list = listOf(KEYS.todos);
    var saved = null;
    var updated = false;

    for (var i = 0; i < list.length; i++) {
      if (list[i] && input.id && list[i].id === input.id) {
        list[i] = normalizeTodo(input, list[i].created_at || nowIso());
        saved = list[i];
        updated = true;
        break;
      }
    }
    if (!updated) {
      saved = normalizeTodo(input, nowIso());
      list.push(saved);
    }

    var res = writeTable(KEYS.todos, list);
    if (res.ok) res.todo = saved;
    return res;
  }

  function deleteTodo(id) {
    var list = listOf(KEYS.todos);
    var next = [];
    var hit = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) { hit = true; continue; }
      next.push(list[i]);
    }
    if (!hit) return { ok: false, error: '没找到要删除的待办。' };
    return writeTable(KEYS.todos, next);
  }

  /* 切换完成状态（PRD F6 打勾） */
  function toggleTodo(id) {
    var list = listOf(KEYS.todos);
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) {
        var done = !list[i].done;
        list[i].done = done;
        list[i].done_at = done ? nowIso() : null;

        var res = writeTable(KEYS.todos, list);
        if (res.ok) res.todo = list[i];
        return res;
      }
    }
    return { ok: false, error: '没找到这条待办。' };
  }

  /* ---------------- 导出 / 导入（PRD F9 场景 D，第⑤步实现） ---------------- */

  /* 全量导出 JSON 字符串（含 schema_version，导入端据此判断兼容性） */
  function exportAll() {
    var s = load();
    return JSON.stringify({
      app: 'sched',
      schema_version: SCHEMA_VERSION,
      exported_at: nowIso(),
      semester: s.semester,
      schedules: s.schedules,
      todos: s.todos
    }, null, 2);
  }

  /* 导入前逐条校验，任何一条不合法都不写入（不覆盖现有数据） */
  function importAll(text) {
    var data;
    try {
      data = JSON.parse(String(text || ''));
    } catch (e) {
      return { ok: false, error: '导入失败：文件不是有效的 JSON。' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: '导入失败：文件结构不对。' };
    }
    if (data.app !== 'sched') {
      return { ok: false, error: '导入失败：这不是本工具导出的备份文件。' };
    }
    if (Number(data.schema_version) !== SCHEMA_VERSION) {
      return { ok: false, error: '导入失败：数据版本不兼容（文件 v' + data.schema_version + '，本应用 v' + SCHEMA_VERSION + '）。' };
    }

    /* 学期：可为空（只导入部分数据时），有则必须通过校验 */
    if (data.semester) {
      var checkSem = validateSemester(data.semester);
      if (!checkSem.ok) return { ok: false, error: '导入失败：学期数据不合法（' + checkSem.error + '）。' };
    }

    /* 日程：必须为数组，逐条校验 */
    if (!Array.isArray(data.schedules)) {
      return { ok: false, error: '导入失败：缺少日程数据。' };
    }
    for (var i = 0; i < data.schedules.length; i++) {
      var checkSch = validateSchedule(data.schedules[i]);
      if (!checkSch.ok) {
        return { ok: false, error: '导入失败：第 ' + (i + 1) + ' 条日程不合法（' + checkSch.error + '）。' };
      }
    }

    /* 待办：必须为数组，逐条校验 */
    if (!Array.isArray(data.todos)) {
      return { ok: false, error: '导入失败：缺少待办数据。' };
    }
    for (var j = 0; j < data.todos.length; j++) {
      var checkTodo = validateTodo(data.todos[j]);
      if (!checkTodo.ok) {
        return { ok: false, error: '导入失败：第 ' + (j + 1) + ' 条待办不合法（' + checkTodo.error + '）。' };
      }
    }

    /* 校验全部通过，才允许整体替换（PRD 场景 D：完整迁移） */
    var r1 = writeTable(KEYS.semester, data.semester || null);
    if (!r1.ok) return r1;
    var r2 = writeTable(KEYS.schedules, data.schedules);
    if (!r2.ok) return r2;
    var r3 = writeTable(KEYS.todos, data.todos);
    if (!r3.ok) return r3;

    return {
      ok: true,
      counts: {
        schedules: data.schedules.length,
        todos: data.todos.length,
        hasSemester: !!data.semester
      }
    };
  }

  /* 清除全部数据并重置（Day 8 错误状态的「重置」出口）。
     backup 键保留：里面是损坏内容的原始备份，事后还能人工找回。 */
  function resetAll() {
    var s = storage();
    if (!s) return { ok: false, error: '本机存储不可用。' };
    try {
      s.removeItem(KEYS.semester);
      s.removeItem(KEYS.schedules);
      s.removeItem(KEYS.todos);
      s.removeItem(KEYS.meta);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: '清除失败：' + ((e && e.message) || e) };
    }
  }

  return {
    KEYS: KEYS,
    SCHEMA_VERSION: SCHEMA_VERSION,
    emptyState: emptyState,
    load: load,
    lastLoadIssue: lastLoadIssue,
    saveSemester: saveSemester,
    saveSchedule: saveSchedule,
    deleteSchedule: deleteSchedule,
    saveTodo: saveTodo,
    deleteTodo: deleteTodo,
    toggleTodo: toggleTodo,
    exportAll: exportAll,
    importAll: importAll,
    defaultPeriods: defaultPeriods,
    resetAll: resetAll
  };
})();
