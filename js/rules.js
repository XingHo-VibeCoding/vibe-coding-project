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

  return {
    parseDate: parseDate,
    dateKey: dateKey,
    timeToMin: timeToMin,
    weekdayName: weekdayName,
    isMonday: isMonday,
    isClockTime: isClockTime,
    weeksError: weeksError,
    periodsFromPairs: periodsFromPairs,
    currentWeekNo: currentWeekNo,
    isBeyondSemester: isBeyondSemester,
    matchWeek: matchWeek,
    coursesOfWeek: coursesOfWeek,
    findConflicts: findConflicts,
    todaySummary: todaySummary
  };
})();
