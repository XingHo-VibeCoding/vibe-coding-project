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

  return {
    parseDate: parseDate,
    dateKey: dateKey,
    timeToMin: timeToMin,
    currentWeekNo: currentWeekNo,
    isBeyondSemester: isBeyondSemester,
    matchWeek: matchWeek,
    coursesOfWeek: coursesOfWeek,
    findConflicts: findConflicts,
    todaySummary: todaySummary
  };
})();
