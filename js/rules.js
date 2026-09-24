/* ============================================================
   rules.js —— 规则层（TECH_DESIGN §4.1）
   职责：纯计算。不碰 DOM、不碰存储。
   Day 7 第②步：落地周次换算 currentWeekNo（学期设置要用）。
   原则（research.md 第六节）：答案唯一的事一律用规则，不交给 AI。
   ============================================================ */

window.Rules = (function () {
  'use strict';

  /* ---------------- 日期小工具（纯函数） ---------------- */

  /* 把 'YYYY-MM-DD' 解析为本地时间的当天 00:00
     注意：不能用 new Date('2026-09-21')——那会按 UTC 解析，东八区会差一天 */
  function parseDate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  var DAY_MS = 24 * 60 * 60 * 1000;

  /* 'HH:mm' → 当天第几分钟（解析失败返回 -1） */
  function timeToMin(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    return m ? (Number(m[1]) * 60 + Number(m[2])) : -1;
  }

  /* 分钟 → 'HH:mm'。跨午夜回绕（1440 → 00:00），与 app.js 里的 minToTime 同一套语义 ——
     两个实现必须一致，否则「添加一节」过午夜时会出现 23:59–23:59 这种非法行 */
  function minToTime(m) {
    m = ((Math.round(Number(m) || 0) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' + h : '' + h) + ':' + (mm < 10 ? '0' + mm : '' + mm);
  }

  /* ---------------- 节次编辑器的自动推算（Day 8 用户需求） ---------------- */

  /* 从第 idx 节（0 基）改开始时间为 newStart 后的整表推算：
     · 该节结束时间 = 新开始 + dur（每节时长，分钟）
     · 其后每节起止 = 原值 + 相同偏移 —— 「整体平移」，午休等大空档原样保留
     prevStart = 改动前那一节的开始时间（调用方必须在覆盖前记下来传入）；
     不传则按 list[idx].start 算（此时偏移为 0，只重算该节结束）。
     返回 { ok:true, periods:[…] }；输入非法 → { ok:false, reason:'input' }；
     平移会让某节跨过午夜 → { ok:false, reason:'midnight' } —— 跨天的课表没有意义，
     硬移只会造出 end<start 的非法行，调用方提示后保持原表不动。 */
  function shiftPeriodsAfter(list, idx, newStart, dur, prevStart) {
    if (!Array.isArray(list) || !list.length) return { ok: false, reason: 'input' };
    if (!(idx >= 0 && idx < list.length)) return { ok: false, reason: 'input' };
    var s = timeToMin(newStart);
    var d = Number(dur);
    if (s < 0 || !(d > 0)) return { ok: false, reason: 'input' };
    var old = timeToMin(prevStart !== undefined ? prevStart : (list[idx] && list[idx].start));
    var delta = old >= 0 ? s - old : 0;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      if (i === idx) { out.push({ start: minToTime(s), end: minToTime(s + d) }); continue; }
      var st = timeToMin(r.start);
      var en = timeToMin(r.end);
      if (i > idx && delta) {
        if (st >= 0 && (st + delta < 0 || st + delta > 1439)) return { ok: false, reason: 'midnight' };
        if (en >= 0 && (en + delta < 0 || en + delta > 1439)) return { ok: false, reason: 'midnight' };
        st += delta;
        en += delta;
      }
      out.push({
        start: st >= 0 ? minToTime(st) : String(r.start || ''),
        end: en >= 0 ? minToTime(en) : String(r.end || '')
      });
    }
    return { ok: true, periods: out };
  }

  /* 「添加一节」的默认时间：上一节结束 + 课间 gap，上 dur 分钟。
     prevEnd 解析不了时返回 null，调用方回落 08:00。 */
  function nextPeriodAfter(prevEnd, gap, dur) {
    var e = timeToMin(prevEnd);
    var g = Number(gap), d = Number(dur);
    if (e < 0 || !(g >= 0) || !(d > 0)) return null;
    var s = e + g;
    return { start: minToTime(s), end: minToTime(s + d) };
  }

  /* 改「每节时长 / 课间」后的整表重排（Day 8 用户需求）：
     · 第 1 节开始时间是锚点，不动；
     · 每节结束 = 该节开始 + dur（时长全表统一）；
     · 相邻间隔 = 上一节结束到下一节开始的空档：
         空档等于 oldGap（改动前的普通课间）→ 换成新 gap；
         空档不等于 oldGap（午休、大课间这类特殊空档）→ 原样保留。
       所以改完后所有节都会顺移，但午休不会被抹平 —— 与「整体平移」的语义一致。
     opts = { dur, gap, oldGap }；oldGap 不传或解析不了 = 所有空档原样保留（保守，
       识别不了基准就不乱动空档；某处空档本身解析失败才回落用 gap）。
     返回 { ok, periods } 或 { ok:false, reason:'midnight'|'input' }（不改入参）。 */
  function reperiod(list, opts) {
    if (!Array.isArray(list) || !list.length) return { ok: false, reason: 'input' };
    var o = opts || {};
    var d = Number(o.dur), g = Number(o.gap);
    var og = (o.oldGap !== undefined && Number(o.oldGap) >= 0) ? Math.round(Number(o.oldGap)) : null;
    if (!(d > 0) || !(g >= 0)) return { ok: false, reason: 'input' };
    var anchor = timeToMin(list[0] && list[0].start);
    if (anchor < 0) return { ok: false, reason: 'input' };

    /* 先记下每处旧空档（用旧表的 start/end），再从锚点重排 */
    var gaps = [];
    for (var i = 0; i < list.length - 1; i++) {
      var en = timeToMin(list[i] && list[i].end);
      var st = timeToMin(list[i + 1] && list[i + 1].start);
      gaps.push(en >= 0 && st >= 0 ? st - en : null);
    }
    var out = [];
    var t = anchor;
    for (var j = 0; j < list.length; j++) {
      if (t + d > 1439) return { ok: false, reason: 'midnight' };
      out.push({ start: minToTime(t), end: minToTime(t + d) });
      if (j < list.length - 1) {
        var gp = gaps[j];
        if (og !== null && gp !== null && gp === og) gp = Math.round(g);
        if (gp === null || gp < 0) gp = Math.round(g);   /* 表本身乱 / 只有一节 → 按普通课间接 */
        t = t + d + gp;
      }
    }
    return { ok: true, periods: out };
  }

  /* ---------------- 节次排布（Day 8：周/日视图节次轴） ---------------- */

  /* 学期「实际生效」的节次表。
     返回数组 = 拿它画格子；返回 null = 不画格子（视图回落到旧的流式布局）。
     与空数组语义（Day 8 修复）对齐：
       periods 缺字段（老数据）        → 用默认 10 节
       periods 是空数组（用户删空了）  → null，表示「不设置节次」 */
  function effectivePeriods(semester) {
    if (!semester) return null;
    if (Array.isArray(semester.periods)) {
      return semester.periods.length ? semester.periods : null;
    }
    return window.Store ? Store.defaultPeriods() : null;
  }

  /* 一门课落在节次格子的第几行、占几行。
     正常情况：课程开始时间就填的节次表的某个 start，精确匹配。
     兜底（填错了也不崩）：起点就近吸附到某节；卡片上仍显示真实时间。
     返回 { start: 起始节(1起), span: 占几节 }；periods 无效时返回 null。 */
  function courseRows(course, periods) {
    if (!course || !Array.isArray(periods) || !periods.length) return null;

    var s = timeToMin(course.start_time);
    if (s < 0) return null;
    var e = s + (Number(course.duration) || 0);

    var mins = [];
    for (var i = 0; i < periods.length; i++) {
      mins.push({
        start: timeToMin(periods[i] && periods[i].start),
        end: timeToMin(periods[i] && periods[i].end)
      });
    }

    /* 起始行：① 精确等于某节 start → ② 落在某节区间内 → ③ 就近吸附 */
    var startRow = 0;
    for (var j = 0; j < mins.length; j++) {
      if (s === mins[j].start) { startRow = j + 1; break; }
    }
    if (!startRow) {
      for (var k = 0; k < mins.length; k++) {
        if (s >= mins[k].start && s < mins[k].end) { startRow = k + 1; break; }
      }
    }
    if (!startRow) {
      var best = Infinity;
      for (var m = 0; m < mins.length; m++) {
        if (mins[m].start < 0) continue;
        var d = Math.abs(s - mins[m].start);
        if (d < best) { best = d; startRow = m + 1; }
      }
    }
    if (!startRow) return null;

    /* 结束行：找「包含结束时刻」的节（start < e ≤ end）；
       结束落在节间空档时，退到 start 在 e 之前的最后一节。 */
    var endRow = startRow;
    for (var n = 0; n < mins.length; n++) {
      if (mins[n].start < e && e <= mins[n].end) { endRow = n + 1; break; }
    }
    if (endRow === startRow) {
      for (var p = mins.length - 1; p >= 0; p--) {
        if (mins[p].start >= 0 && mins[p].start < e) { endRow = p + 1; break; }
      }
    }

    return { start: startRow, span: Math.max(1, endRow - startRow + 1) };
  }

  /* 当前是第几周（学期未设置或还没开学 → 0）
     算法：目标日期与第一周周一相差几天 ÷ 7 向下取整，再 +1 */
  function currentWeekNo(semester, date) {
    if (!semester || !semester.first_monday) return 0;

    var start = parseDate(semester.first_monday);
    if (!start) return 0;

    var target = startOfDay(date instanceof Date ? date : new Date());
    var diffDays = Math.round((target - start) / DAY_MS);

    if (diffDays < 0) return 0;                       // 还没开学

    return Math.floor(diffDays / 7) + 1;
  }

  /* 该周次是否超出学期总周数 */
  function isBeyondSemester(semester, weekNo) {
    if (!semester || !semester.total_weeks) return false;
    return weekNo > Number(semester.total_weeks);
  }

  /* 该日程在第 weekNo 周是否发生（every / odd / even 三档） */
  function matchWeek(schedule, weekNo) {
    if (!schedule || schedule.type !== 'course') return false;
    if (!(weekNo > 0)) return false;

    var rule = schedule.week_rule || 'every';
    if (rule === 'every') return true;
    if (rule === 'odd') return weekNo % 2 === 1;      // 第 1、3、5… 周
    if (rule === 'even') return weekNo % 2 === 0;     // 第 2、4、6… 周
    return false;
  }

  /* 本周课程数组（只取课程类、只取本学期，按星期与开始时间排序） */
  function coursesOfWeek(schedules, semester, weekNo) {
    var out = [];
    if (!Array.isArray(schedules)) return out;

    for (var i = 0; i < schedules.length; i++) {
      var s = schedules[i];
      if (!s || s.type !== 'course') continue;
      if (semester && s.semester_id && s.semester_id !== semester.id) continue;
      if (!matchWeek(s, weekNo)) continue;
      out.push(s);
    }

    out.sort(function (a, b) {
      return (Number(a.weekday) - Number(b.weekday)) ||
             (timeToMin(a.start_time) - timeToMin(b.start_time));
    });
    return out;
  }

  /* 两条周次规则是否可能撞上同一周：每周 × 任何 = 相交；单周与双周永不相交 */
  function weekRulesIntersect(a, b) {
    if (!a || a === 'every' || !b || b === 'every') return true;
    return a === b;
  }

  /* 冲突检测：同一天、时间区间重叠、且周次可能相交（编辑自己不算冲突） */
  function findConflicts(target, list) {
    var out = [];
    if (!target || !Array.isArray(list)) return out;

    var tStart = timeToMin(target.start_time);
    var tEnd = tStart + Number(target.duration || 0);
    if (tStart < 0) return out;

    for (var i = 0; i < list.length; i++) {
      var other = list[i];
      if (!other || other.type !== 'course') continue;
      if (target.id && other.id === target.id) continue;                     // 自己
      if (Number(other.weekday) !== Number(target.weekday)) continue;        // 不同天
      if (!weekRulesIntersect(target.week_rule, other.week_rule)) continue;  // 单双周错开

      var oStart = timeToMin(other.start_time);
      var oEnd = oStart + Number(other.duration || 0);
      if (tStart < oEnd && oStart < tEnd) out.push(other);                   // 区间重叠
    }
    return out;
  }

  /* Date → 'YYYY-MM-DD'（本地时间，不用 toISOString——那会按 UTC 差一天） */
  function dateKey(date) {
    var d = date instanceof Date ? date : new Date();
    return d.getFullYear() + '-' +
           ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
           ('0' + d.getDate()).slice(-2);
  }

  /* 今日结算：只统计待办（PRD A7：课程不计入）
     total = 截止日期是今天的待办数；done = 其中已打勾数 */
  function todaySummary(todos, date) {
    var key = dateKey(date instanceof Date ? date : new Date());
    var done = 0, total = 0;

    if (Array.isArray(todos)) {
      for (var i = 0; i < todos.length; i++) {
        var t = todos[i];
        if (!t || t.due_date !== key) continue;
        total++;
        if (t.done) done++;
      }
    }
    return { done: done, total: total };
  }

  /* ---------------- 表单校验用的纯函数（Day 8 反馈修复）----------------
     这两件事以前散在 app.js 里手写，出过一次「选周一却说『你选的是周一』」的错，
     移到这里集中 + 可被测试覆盖。 */

  var WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* 'YYYY-MM-DD' → '周一'…'周日'；非法日期返回空字符串 */
  function weekdayName(str) {
    var d = parseDate(str);
    return d ? WEEKDAY_NAMES[d.getDay()] : '';
  }

  /* 第一周必须落在周一（parseDate 认可且 getDay()===1） */
  function isMonday(str) {
    var d = parseDate(str);
    return !!d && d.getDay() === 1;
  }

  /* 'HH:mm' 严格时钟格式（00:00–23:59），比只数位数更严 */
  function isClockTime(t) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));
  }

  /* 总周数：1–30 的整数。合法返回 ''，不合法返回提示文案。
     实时提示（填完立刻显示）与提交校验都用它，两处口径永远一致。 */
  function weeksError(v) {
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (!s) return '总周数还没填，填 1–30 之间的整数';
    if (!/^\d+$/.test(s)) return '总周数要填整数（1–30），不能带小数或其它字符';
    var n = Number(s);
    if (n < 1 || n > 30) return '总周数要在 1–30 之间（你填的是 ' + n + '）';
    return '';
  }

  /* 节次行（从 DOM 收来的 [{start,end}]）→ store 需要的 [{no,start,end}]
     · 序号按行序重排（删掉中间一节也不会跳号）
     · 整行留空 = 跳过；一行都没有 = 合法（表示不设置节次）
     · 时间格式错 / 结束不晚于开始 → 报第几节出问题 */
  function periodsFromPairs(pairs) {
    var arr = Array.isArray(pairs) ? pairs : [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var st = String((arr[i] && arr[i].start) || '').trim();
      var en = String((arr[i] && arr[i].end) || '').trim();
      if (!st && !en) continue;
      var nth = out.length + 1;
      if (!isClockTime(st) || !isClockTime(en)) return { ok: false, error: '第 ' + nth + ' 节的时间没填完整' };
      if (timeToMin(st) >= timeToMin(en)) return { ok: false, error: '第 ' + nth + ' 节的结束时间要晚于开始时间' };
      out.push({ no: nth, start: st, end: en });
    }
    if (out.length > 15) return { ok: false, error: '节次最多 15 节' };
    return { ok: true, periods: out };
  }

  /* ---------------- 自建日期 / 时间面板要用的纯函数（Day 8 反馈）----------------
     背景：原生 <input type="date|time"> 的浮层是浏览器自己画的，加不了 ×，
     触屏上「点别处才关」很容易误触。所以改成自建面板 —— 面板要用到的
     月历排布、时/分候选这些东西全是「答案唯一」的，按 research.md 第六节
     的原则放规则层，既不碰 DOM 也能被测试覆盖。 */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* 某年某月排成「周一起始」的 7 列格子。
     返回 [{ key:'YYYY-MM-DD', day:8, out:false, weekday:2 }, …]
     out=true 表示上/下月补齐的空位（面板里显示成灰色、不给点）。 */
  function monthGrid(year, month) {
    var y = Number(year), m = Number(month);
    if (!(y > 1900) || !(m >= 1 && m <= 12)) return [];

    var first = new Date(y, m - 1, 1);
    var lead = (first.getDay() + 6) % 7;                // 周一起始：周一=0、周日=6
    var days = new Date(y, m, 0).getDate();             // 「下月 0 号」= 本月最后一天
    var cells = [];
    var i, dt;

    for (i = 0; i < lead; i++) {                        // 上月补齐
      dt = new Date(y, m - 1, i - lead + 1);
      cells.push({ key: dateKey(dt), day: dt.getDate(), out: true, weekday: dt.getDay() });
    }
    for (i = 1; i <= days; i++) {                       // 本月
      dt = new Date(y, m - 1, i);
      cells.push({ key: dateKey(dt), day: i, out: false, weekday: dt.getDay() });
    }
    var tail = (7 - (cells.length % 7)) % 7;
    for (i = 1; i <= tail; i++) {                       // 下月补齐
      dt = new Date(y, m - 1, days + i);
      cells.push({ key: dateKey(dt), day: dt.getDate(), out: true, weekday: dt.getDay() });
    }
    return cells;
  }

  /* 月份加减（跨年自动进位）：shiftMonth(2026, 12, 1) → {year:2027, month:1} */
  function shiftMonth(year, month, delta) {
    var d = new Date(Number(year), Number(month) - 1 + Number(delta || 0), 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  /* 时/分两列的候选项。step = 分钟粒度（默认 5）：分钟列是 00 05 … 55 */
  function timeUnits(step) {
    var s = Number(step) > 0 ? Number(step) : 5;
    var hours = [], minutes = [], i;
    for (i = 0; i < 24; i++) hours.push(pad2(i));
    for (i = 0; i < 60; i += s) minutes.push(pad2(i));
    return { hours: hours, minutes: minutes, step: s };
  }

  /* 在候选里找最接近的一项（'07' 在 00/05/10… 里 → 05 的下标 1）。
     用途：面板打开时把某一列滚到当前值附近；值不在网格上也不至于没反应。 */
  function nearestIndex(list, value) {
    if (!Array.isArray(list) || !list.length) return 0;
    var target = Number(value);
    if (isNaN(target)) return 0;
    var best = 0, bestDiff = Infinity, i, d;
    for (i = 0; i < list.length; i++) {
      d = Math.abs(Number(list[i]) - target);
      if (d < bestDiff) { bestDiff = d; best = i; }
    }
    return best;
  }

  /* 年份 + 月号 → '2026 年 9 月' */
  function monthLabel(year, month) {
    return Number(year) + ' 年 ' + Number(month) + ' 月';
  }

  /* AI 课表识别的重导去重（Day 9 前置，TECH_DESIGN §2 补记）：
     在现有日程里找「AI 导入且未手动改过」的同名同星期课程 → 原地更新它；
     手动建的 / 手动改过的一律不匹配（永不覆盖，manual_edited 语义）。
     返回匹配到的日程或 null。 */
  function aiDuplicateOf(list, candidate) {
    if (!Array.isArray(list) || !candidate) return null;
    var title = String(candidate.title || '');
    var wd = Number(candidate.weekday);
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (!x || x.type !== 'course') continue;
      if (x.manual_edited !== false) continue;          // 手动建 / 手动改过 → 不碰
      if (String(x.title) !== title) continue;
      if (Number(x.weekday) !== wd) continue;
      return x;
    }
    return null;
  }

  return {
    parseDate: parseDate,
    dateKey: dateKey,
    timeToMin: timeToMin,
    minToTime: minToTime,
    shiftPeriodsAfter: shiftPeriodsAfter,
    nextPeriodAfter: nextPeriodAfter,
    reperiod: reperiod,
    aiDuplicateOf: aiDuplicateOf,
    weekdayName: weekdayName,
    isMonday: isMonday,
    isClockTime: isClockTime,
    weeksError: weeksError,
    periodsFromPairs: periodsFromPairs,
    monthGrid: monthGrid,
    shiftMonth: shiftMonth,
    timeUnits: timeUnits,
    nearestIndex: nearestIndex,
    monthLabel: monthLabel,
    currentWeekNo: currentWeekNo,
    isBeyondSemester: isBeyondSemester,
    matchWeek: matchWeek,
    coursesOfWeek: coursesOfWeek,
    effectivePeriods: effectivePeriods,
    courseRows: courseRows,
    findConflicts: findConflicts,
    todaySummary: todaySummary
  };
})();
