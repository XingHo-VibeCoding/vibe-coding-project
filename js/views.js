/* ============================================================
   views.js —— 渲染层（TECH_DESIGN §4.1）
   职责：只负责把数据画成界面。不做计算、不碰存储。
   Day 7 第②步：加入周次状态显示、弹窗开关、学期表单。
   第③④步再接入真实周网格与今日视图。
   ============================================================ */

window.Views = (function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------------- 顶部提示条（错误/提示统一出口，TECH_DESIGN §6） ---------------- */

  function banner(msg, isError) {
    var el = $('banner');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = msg;
    el.hidden = false;
    el.className = 'banner' + (isError ? ' banner--error' : '');
  }

  /* ---------------- 轻提示 ---------------- */

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  /* 冲突提示：第③步接入弹窗，先用轻提示占位 */
  function showConflict(list) {
    toast('检测到时间冲突：' + list.length + ' 处（详情弹窗将在第③步接入）');
  }

  /* ---------------- 顶部周次状态（PRD F1） ---------------- */

  function renderTerm(semester, date) {
    var el = $('term-label');
    if (!el) return;

    if (!semester) {
      el.textContent = '· 未设置学期';
      el.className = 'topbar__week is-empty';
      return;
    }

    var weekNo = Rules.currentWeekNo(semester, date || new Date());
    var text;
    if (weekNo === 0) {
      text = '· 学期未开始';
    } else if (Rules.isBeyondSemester(semester, weekNo)) {
      text = '· 第 ' + weekNo + ' 周（已超出本学期 ' + semester.total_weeks + ' 周）';
    } else {
      text = '· 第 ' + weekNo + ' 周';
    }
    el.textContent = text;
    el.className = 'topbar__week';
  }

  /* ---------------- 弹窗 ---------------- */

  function openModal(html) {
    var mask = $('modal-mask');
    var body = $('modal-body');
    if (!mask || !body) return;
    body.innerHTML = html;
    mask.hidden = false;
    var first = body.querySelector('input, select, textarea, button');
    if (first) first.focus();
  }

  function closeModal() {
    var mask = $('modal-mask');
    var body = $('modal-body');
    if (body) body.innerHTML = '';
    if (mask) mask.hidden = true;
  }

  function isModalOpen() {
    var mask = $('modal-mask');
    return !!mask && !mask.hidden;
  }

  /* 表单字段标红 + 错误文案（TECH_DESIGN §6：必填项缺失，表单内标红不提交） */
  function markField(fieldName, msg) {
    var field = document.querySelector('.field[data-field="' + fieldName + '"]');
    if (!field) return;
    field.className = 'field field--invalid';
    var err = field.querySelector('.field__error');
    if (err) { err.textContent = msg; err.hidden = false; }
  }

  function clearFieldMarks() {
    var fields = document.querySelectorAll('.field--invalid');
    for (var i = 0; i < fields.length; i++) {
      fields[i].className = 'field';
      var err = fields[i].querySelector('.field__error');
      if (err) { err.textContent = ''; err.hidden = true; }
    }
  }

  /* ---------------- 学期设置表单 ---------------- */

  function semesterForm(semester) {
    var s = semester || {};
    return [
      '<form class="form" id="semester-form" novalidate>',
      '  <h2 class="form__title">学期设置</h2>',
      '  <p class="hint">周次换算需要一个锚点：填本学期第一周的周一日期（只能选周一，选别的会提示）。</p>',

      '  <div class="field" data-field="name">',
      '    <label class="field__label" for="f-name">学期名（必填）</label>',
      '    <input id="f-name" type="text" maxlength="30" placeholder="例如：2026 秋" value="' + esc(s.name) + '">',
      '    <div class="field__error" hidden></div>',
      '  </div>',

      '  <div class="field" data-field="first_monday">',
      '    <label class="field__label" for="f-monday">第一周的周一（必填）</label>',
      '    <input id="f-monday" type="date" value="' + esc(s.first_monday) + '">',
      '    <div class="field__error" hidden></div>',
      '  </div>',

      '  <div class="field" data-field="total_weeks">',
      '    <label class="field__label" for="f-weeks">总周数（必填，1–30）</label>',
      '    <input id="f-weeks" type="number" min="1" max="30" step="1" value="' + (s.total_weeks ? esc(s.total_weeks) : '') + '" placeholder="例如：18">',
      '    <div class="field__error" hidden></div>',
      '  </div>',

      '  <div class="form__actions">',
      '    <button type="button" class="btn" data-action="close-modal">取消</button>',
      '    <button type="submit" class="btn btn--primary">保存</button>',
      '  </div>',
      '</form>'
    ].join('\n');
  }

  /* ---------------- 学期摘要条（周视图内） ---------------- */

  function termBar(semester) {
    if (!semester) return '';
    return [
      '<div class="termbar">',
      '  <span class="termbar__name">' + esc(semester.name) + '</span>',
      '  <span class="termbar__meta">开学 ' + esc(semester.first_monday) + ' · 共 ' + esc(semester.total_weeks) + ' 周</span>',
      '  <button type="button" class="btn btn--ghost btn--sm" data-action="open-settings">修改</button>',
      '</div>'
    ].join('\n');
  }

  /* 未设置学期时的引导（TECH_DESIGN §6：引导先完成学期设置） */
  function setupGuide() {
    return [
      '<div class="placeholder">',
      '  <h2>先设置学期</h2>',
      '  <p>还没有学期信息，无法换算「第几周」。填一次学期名和第一周的周一即可。</p>',
      '  <div class="form__actions form__actions--left">',
      '    <button type="button" class="btn btn--primary" data-action="open-settings">去设置学期</button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /* ---------------- 周视图（第③步：真实网格） ---------------- */

  var WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* '08:00' + 90 分钟 → '08:00–09:30'（纯展示格式化） */
  function fmtRange(start, duration) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(start || ''));
    if (!m) return String(start || '');
    var total = Number(m[1]) * 60 + Number(m[2]) + Number(duration || 0);
    return pad2(Number(m[1])) + ':' + m[2] + '–' + pad2(Math.floor(total / 60) % 24) + ':' + pad2(total % 60);
  }

  /* 今天是星期几（1–7） */
  function todayWeekday() {
    var d = new Date().getDay();
    return d === 0 ? 7 : d;
  }

  function ruleBadge(rule) {
    if (rule === 'odd') return '<span class="badge">单周</span>';
    if (rule === 'even') return '<span class="badge">双周</span>';
    return '';
  }

  /* 待办小组件（周视图列内 / 今日视图共用样式基础） */
  function todoChip(t) {
    return [
      '<div class="todo-chip' + (t.done ? ' is-done' : '') + '">',
      '  <button type="button" class="todo-chip__check" data-action="toggle-todo" data-id="' + esc(t.id) + '" title="' + (t.done ? '标记为未完成' : '标记为完成') + '">' + (t.done ? '✓' : '') + '</button>',
      '  <button type="button" class="todo-chip__title" data-action="edit-todo" data-id="' + esc(t.id) + '" title="点击编辑或删除">' + esc(t.title) + '</button>',
      '</div>'
    ].join('');
  }

  /* 第 viewing 周里「星期 d」那天的日期键（YYYY-MM-DD）
     锚点：学期第一周的周一（semester.first_monday） */
  function weekdayDateKey(semester, viewing, d) {
    var monday = Rules.parseDate(semester.first_monday);
    if (!monday) return null;
    monday.setDate(monday.getDate() + (viewing - 1) * 7 + (d - 1));
    return Rules.dateKey(monday);
  }

  /* 按截止日期取待办（未完成的在前） */
  function todosDueOn(todos, dateKeyStr) {
    var out = [];
    if (!Array.isArray(todos)) return out;
    for (var i = 0; i < todos.length; i++) {
      if (todos[i] && todos[i].due_date === dateKeyStr) out.push(todos[i]);
    }
    out.sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0); });
    return out;
  }

  function courseCard(c) {
    return [
      '<button type="button" class="course-card" data-action="edit-course" data-id="' + esc(c.id) + '" title="点击编辑或删除">',
      '  <span class="course-card__top">',
      '    <span class="course-card__time">' + esc(fmtRange(c.start_time, c.duration)) + '</span>',
      ruleBadge(c.week_rule),
      '  </span>',
      '  <span class="course-card__title">' + esc(c.title) + '</span>',
      c.location ? '<span class="course-card__loc">' + esc(c.location) + '</span>' : '',
      '</button>'
    ].join('');
  }

  function renderWeek(state, weekNo) {
    var box = $('view-week');
    if (!box) return;

    var semester = state ? state.semester : null;
    if (!semester) {
      box.innerHTML = setupGuide();
      return;
    }

    var total = Number(semester.total_weeks) || 1;
    var current = Rules.currentWeekNo(semester, new Date());
    var viewing = weekNo || (current > 0 ? current : 1);

    var courses = Rules.coursesOfWeek(state.schedules || [], semester, viewing);
    var today = todayWeekday();
    /* 「今天」高亮只在看的是本周时出现（切到上周/下周不再标蓝） */
    var viewingCurrentWeek = current > 0 && viewing === current;

    /* 周次导航 + 添加课程 */
    var nav = [
      '<div class="weeknav">',
      '  <button type="button" class="btn btn--sm" data-action="week-prev">‹ 上一周</button>',
      '  <span class="weeknav__label">第 ' + viewing + ' 周' + (current > 0 && viewing === current ? '（本周）' : '') + (current === 0 ? '（学期未开始）' : '') + '</span>',
      '  <button type="button" class="btn btn--sm" data-action="week-next">下一周 ›</button>',
      current > 0 && viewing !== current ? '<button type="button" class="btn btn--ghost btn--sm" data-action="week-today">回到本周</button>' : '',
      '  <button type="button" class="btn btn--primary btn--sm" data-action="add-course">＋ 添加课程</button>',
      '</div>'
    ].join('');

    /* 7 列网格：列 = 星期；列内上半是课程卡片，底部是该日截止的待办区（PRD F8） */
    var cols = '';
    for (var d = 1; d <= 7; d++) {
      var dayCourses = [];
      for (var i = 0; i < courses.length; i++) {
        if (Number(courses[i].weekday) === d) dayCourses.push(courses[i]);
      }

      var cards = '';
      for (var j = 0; j < dayCourses.length; j++) cards += courseCard(dayCourses[j]);
      if (!cards) cards = '<div class="day-col__empty">无课</div>';

      var dayKey = weekdayDateKey(semester, viewing, d);
      var dayTodos = dayKey ? todosDueOn(state.todos, dayKey) : [];
      var todoArea = '';
      if (dayTodos.length) {
        todoArea = '<div class="day-col__todos">';
        for (var k = 0; k < dayTodos.length; k++) todoArea += todoChip(dayTodos[k]);
        todoArea += '</div>';
      }

      cols += [
        '<div class="day-col' + (viewingCurrentWeek && d === today ? ' is-today' : '') + '">',
        '  <div class="day-col__head">' + WEEKDAYS[d] + '</div>',
        '  <div class="day-col__body">' + cards + todoArea + '</div>',
        '</div>'
      ].join('');
    }

    box.innerHTML = [
      termBar(semester),
      nav,
      '<div class="weekgrid-wrap"><div class="weekgrid">' + cols + '</div></div>',
      '<p class="hint weekhint">点课程卡片或待办可编辑；待办显示在截止日对应列，点方框打勾。</p>'
    ].join('\n');
  }

  /* ---------------- 课程表单（添加 / 编辑共用，PRD F2 F3） ---------------- */

  function courseForm(c) {
    c = c || {};

    var weekdayOpts = '';
    for (var i = 1; i <= 7; i++) {
      weekdayOpts += '<option value="' + i + '"' + (Number(c.weekday || 1) === i ? ' selected' : '') + '>' + WEEKDAYS[i] + '</option>';
    }
    var rule = c.week_rule || 'every';
    var ruleOpts =
      '<option value="every"' + (rule === 'every' ? ' selected' : '') + '>每周</option>' +
      '<option value="odd"' + (rule === 'odd' ? ' selected' : '') + '>单周（第 1、3、5…周）</option>' +
      '<option value="even"' + (rule === 'even' ? ' selected' : '') + '>双周（第 2、4、6…周）</option>';

    return [
      '<form class="form" id="course-form" novalidate>',
      '  <h2 class="form__title">' + (c.id ? '编辑课程' : '添加课程') + '</h2>',
      '  <input type="hidden" id="f-sch-id" value="' + esc(c.id || '') + '">',

      '  <div class="field" data-field="title">',
      '    <label class="field__label" for="f-title">课程名（必填）</label>',
      '    <input id="f-title" type="text" maxlength="40" placeholder="例如：高等数学" value="' + esc(c.title || '') + '">',
      '    <div class="field__error" hidden></div>',
      '  </div>',

      '  <div class="form__row">',
      '    <div class="field" data-field="weekday">',
      '      <label class="field__label" for="f-weekday">星期</label>',
      '      <select id="f-weekday">' + weekdayOpts + '</select>',
      '      <div class="field__error" hidden></div>',
      '    </div>',
      '    <div class="field" data-field="start">',
      '      <label class="field__label" for="f-start">开始时间</label>',
      '      <input id="f-start" type="time" value="' + esc(c.start_time || '08:00') + '">',
      '      <div class="field__error" hidden></div>',
      '    </div>',
      '    <div class="field" data-field="duration">',
      '      <label class="field__label" for="f-duration">时长（分钟）</label>',
      '      <input id="f-duration" type="number" min="5" max="480" step="5" value="' + esc(c.duration || 90) + '">',
      '      <div class="field__error" hidden></div>',
      '    </div>',
      '  </div>',

      '  <div class="field" data-field="rule">',
      '    <label class="field__label" for="f-rule">周次规则</label>',
      '    <select id="f-rule">' + ruleOpts + '</select>',
      '    <div class="field__error" hidden></div>',
      '  </div>',

      '  <div class="field" data-field="location">',
      '    <label class="field__label" for="f-location">教室 / 地点（选填）</label>',
      '    <input id="f-location" type="text" maxlength="40" placeholder="例如：A101" value="' + esc(c.location || '') + '">',
      '  </div>',

      '  <div class="field" data-field="note">',
      '    <label class="field__label" for="f-note">备注（选填）</label>',
      '    <input id="f-note" type="text" maxlength="80" value="' + esc(c.note || '') + '">',
      '  </div>',

      '  <div class="form__actions form__actions--split">',
      (c.id
        ? '<button type="button" class="btn btn--danger" data-action="delete-course" data-id="' + esc(c.id) + '">删除课程</button>'
        : '<span></span>'),
      '    <span class="form__actions__right">',
      '      <button type="button" class="btn" data-action="close-modal">取消</button>',
      '      <button type="submit" class="btn btn--primary">保存</button>',
      '    </span>',
      '  </div>',
      '</form>'
    ].join('\n');
  }

  /* ---------------- 删除确认弹窗 ----------------
     不用 window.confirm()：内嵌预览浏览器会拦截原生对话框（静默返回取消），
     导致「点删除没反应」。统一走项目自己的弹窗系统。 */

  function confirmDeleteModal(title) {
    return [
      '<div class="confirm-del">',
      '  <h2 class="form__title">确认删除</h2>',
      '  <p class="hint">确定删除「' + esc(title) + '」吗？删除后无法恢复。</p>',
      '  <div class="form__actions">',
      '    <button type="button" class="btn" data-action="close-modal">取消</button>',
      '    <button type="button" class="btn btn--danger" data-action="confirm-delete">确认删除</button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /* ---------------- 冲突确认弹窗（PRD F4：提示但不强制阻止） ---------------- */

  function conflictModal(list) {
    var rows = '';
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      rows += '<li>' + esc(c.title) + '（' + WEEKDAYS[Number(c.weekday)] + ' ' + esc(fmtRange(c.start_time, c.duration)) + '）</li>';
    }

    return [
      '<div class="conflict">',
      '  <h2 class="form__title">检测到时间冲突</h2>',
      '  <p class="hint">这门课与下面已排的课程时间重叠：</p>',
      '  <ul class="conflict__list">' + rows + '</ul>',
      '  <p class="hint">你可以返回修改时间，也可以仍然保存（两门课会同时显示在这格）。</p>',
      '  <div class="form__actions">',
      '    <button type="button" class="btn" data-action="close-modal">取消</button>',
      '    <button type="button" class="btn" data-action="back-to-edit">返回修改</button>',
      '    <button type="button" class="btn btn--primary" data-action="save-anyway">仍要保存</button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /* ---------------- 待办表单（添加 / 编辑共用，PRD F5） ---------------- */

  function todoForm(t) {
    t = t || {};
    return [
      '<form class="form" id="todo-form" novalidate>',
      '  <h2 class="form__title">' + (t.id ? '编辑待办' : '添加待办') + '</h2>',
      '  <input type="hidden" id="f-todo-id" value="' + esc(t.id || '') + '">',

      '  <div class="field" data-field="todo-title">',
      '    <label class="field__label" for="f-t-title">标题（必填）</label>',
      '    <input id="f-t-title" type="text" maxlength="40" placeholder="例如：完成高数作业第 3 章" value="' + esc(t.title || '') + '">',
      '    <div class="field__error" hidden></div>',
      '  </div>',

      '  <div class="field" data-field="todo-due">',
      '    <label class="field__label" for="f-t-due">截止日期（必填）</label>',
      '    <input id="f-t-due" type="date" value="' + esc(t.due_date || '') + '">',
      '    <div class="field__error" hidden></div>',
      '  </div>',

      '  <div class="field" data-field="todo-note">',
      '    <label class="field__label" for="f-t-note">备注（选填）</label>',
      '    <input id="f-t-note" type="text" maxlength="80" value="' + esc(t.note || '') + '">',
      '  </div>',

      '  <div class="form__actions form__actions--split">',
      (t.id
        ? '<button type="button" class="btn btn--danger" data-action="delete-todo" data-id="' + esc(t.id) + '">删除待办</button>'
        : '<span></span>'),
      '    <span class="form__actions__right">',
      '      <button type="button" class="btn" data-action="close-modal">取消</button>',
      '      <button type="submit" class="btn btn--primary">保存</button>',
      '    </span>',
      '  </div>',
      '</form>'
    ].join('\n');
  }

  /* ---------------- 导出 / 备份弹窗（PRD F9） ---------------- */

  function exportModal() {
    return [
      '<div class="confirm-del">',
      '  <h2 class="form__title">导出 / 备份</h2>',
      '  <p class="hint">导出 .ics 导入手机系统日历可获得课前 15 分钟提醒；JSON 备份用于换设备迁移。</p>',
      '  <div class="form__actions form__actions--left">',
      '    <button type="button" class="btn btn--primary" data-action="export-ics">导出 .ics 日历</button>',
      '    <button type="button" class="btn" data-action="export-json">导出 JSON 备份</button>',
      '    <button type="button" class="btn" data-action="import-json">导入 JSON 数据</button>',
      '  </div>',
      '  <p class="hint">修改课程后需重新导出 .ics，系统日历的提醒才会同步更新。</p>',
      '</div>'
    ].join('\n');
  }

  /* ---------------- 今日视图（PRD F7：今日课程 + 到期待办 + 结算条） ---------------- */

  function renderToday(state, date) {
    var box = $('view-today');
    if (!box) return;

    var semester = state ? state.semester : null;
    if (!semester) {
      box.innerHTML = setupGuide();
      return;
    }

    var d = date instanceof Date ? date : new Date();
    var weekNo = Rules.currentWeekNo(semester, d);
    var wd = d.getDay() === 0 ? 7 : d.getDay();
    var todayKey = Rules.dateKey(d);

    /* 今日课程：本周课程里筛出今天星期的（学期未开始 / 超出学期时为空） */
    var courses = weekNo > 0 ? Rules.coursesOfWeek(state.schedules || [], semester, weekNo) : [];
    var todayCourses = [];
    for (var i = 0; i < courses.length; i++) {
      if (Number(courses[i].weekday) === wd) todayCourses.push(courses[i]);
    }

    /* 今日待办（按截止日期） */
    var todayTodos = todosDueOn(state.todos, todayKey);

    /* 结算条（A7：只统计待办） */
    var sum = Rules.todaySummary(state.todos, d);

    var courseHtml = '';
    if (!todayCourses.length) {
      courseHtml = '<div class="day-col__empty">今天没有课</div>';
    } else {
      for (var j = 0; j < todayCourses.length; j++) courseHtml += courseCard(todayCourses[j]);
    }

    var todoHtml = '';
    if (!todayTodos.length) {
      todoHtml = '<div class="day-col__empty">今天没有到期待办</div>';
    } else {
      for (var k = 0; k < todayTodos.length; k++) todoHtml += todoChip(todayTodos[k]);
    }

    box.innerHTML = [
      '<div class="todayhead">',
      '  <span class="todayhead__date">' + esc(todayKey) + ' · ' + WEEKDAYS[wd] + '</span>',
      '  <span class="todayhead__week">' + (weekNo > 0 ? '第 ' + weekNo + ' 周' : '学期未开始') + '</span>',
      '  <button type="button" class="btn btn--primary btn--sm" data-action="add-todo">＋ 添加待办</button>',
      '</div>',

      '<section class="today-sec">',
      '  <h3 class="today-sec__title">今天的课</h3>',
      '  <div class="today-sec__body">' + courseHtml + '</div>',
      '</section>',

      '<section class="today-sec">',
      '  <h3 class="today-sec__title">到期待办</h3>',
      '  <div class="today-sec__body">' + todoHtml + '</div>',
      '</section>',

      '<div class="summary"' + (sum.total === 0 ? ' data-empty="1"' : '') + '>',
      '  今日完成 ' + sum.done + ' 项 / 共 ' + sum.total + ' 项' + (sum.total === 0 ? '（今天没有到期待办）' : ''),
      '</div>'
    ].join('\n');
  }

  return {
    banner: banner,
    toast: toast,
    showConflict: showConflict,
    renderTerm: renderTerm,
    openModal: openModal,
    closeModal: closeModal,
    isModalOpen: isModalOpen,
    markField: markField,
    clearFieldMarks: clearFieldMarks,
    semesterForm: semesterForm,
    courseForm: courseForm,
    todoForm: todoForm,
    confirmDeleteModal: confirmDeleteModal,
    conflictModal: conflictModal,
    exportModal: exportModal,
    renderWeek: renderWeek,
    renderToday: renderToday
  };
})();
