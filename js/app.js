/* ============================================================
   app.js —— 入口层（TECH_DESIGN §4.1）
   职责：绑定事件，串起「取数据 → 校验 → 存数据 → 重渲染」四步。
   Day 7 第③步：周次切换、课程添加/编辑/删除、冲突确认流程。
   ============================================================ */

window.App = (function () {
  'use strict';

  var state = null;          // 当前数据快照
  var currentView = 'week';
  var viewWeek = null;       // 正在查看第几周；null = 跟随本周
  var pendingCourse = null;  // 冲突确认弹窗里暂存的待保存课程

  function $(id) { return document.getElementById(id); }

  function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function isTimeStr(s) { return /^\d{2}:\d{2}$/.test(String(s || '')); }

  /* ---------------- 视图切换 ---------------- */

  function switchView(name) {
    currentView = name;
    var weekBox = $('view-week');
    var todayBox = $('view-today');
    if (!weekBox || !todayBox) return;

    if (name === 'week') {
      weekBox.hidden = false;
      todayBox.hidden = true;
    } else {
      weekBox.hidden = true;
      todayBox.hidden = false;
    }

    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-view') === name;
      tabs[i].className = 'tab' + (on ? ' is-active' : '');
    }
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    var today = new Date();
    var semester = state ? state.semester : null;
    var currentWeek = Rules.currentWeekNo(semester, today);
    var viewing = viewWeek || (currentWeek > 0 ? currentWeek : 1);

    Views.renderTerm(semester, today);
    Views.renderWeek(state, viewing);
    Views.renderToday(state, today);
    switchView(currentView);
  }

  /* ---------------- 周次切换 ---------------- */

  function shiftWeek(delta) {
    var semester = state && state.semester;
    if (!semester) return;

    var current = Rules.currentWeekNo(semester, new Date());
    var viewing = viewWeek || (current > 0 ? current : 1);
    var total = Number(semester.total_weeks) || 18;
    var next = viewing + delta;

    if (next < 1 || next > total) {
      Views.toast('已经是边界了（共 ' + total + ' 周）');
      return;
    }
    viewWeek = next;
    render();
  }

  /* ---------------- 学期设置 ---------------- */

  function openSettings() {
    Views.clearFieldMarks();
    Views.openModal(Views.semesterForm(state ? state.semester : null));
    Views.banner('');
  }

  function onSemesterSubmit(e) {
    e.preventDefault();
    Views.clearFieldMarks();

    var nameEl = $('f-name');
    var mondayEl = $('f-monday');
    var weeksEl = $('f-weeks');
    if (!nameEl || !mondayEl || !weeksEl) return;

    var input = {
      name: nameEl.value,
      first_monday: mondayEl.value,
      total_weeks: weeksEl.value
    };

    var bad = false;
    if (!String(input.name).trim()) { Views.markField('name', '请填写学期名'); bad = true; }
    if (!isDateStr(input.first_monday)) {
      Views.markField('first_monday', '请选择第一周的周一');
      bad = true;
    } else {
      /* 第一周必须从周一开始，否则周次换算、单双周、.ics 日期全错 */
      var fmDate = Rules.parseDate(input.first_monday);
      if (!fmDate || fmDate.getDay() !== 1) {
        var wdNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        Views.markField('first_monday', '必须选一个周一（你选的是' + wdNames[fmDate ? fmDate.getDay() : 0] + '）');
        bad = true;
      }
    }

    var tw = Number(input.total_weeks);
    if (!(tw >= 1 && tw <= 30)) { Views.markField('total_weeks', '请填 1–30 之间的整数'); bad = true; }
    if (bad) return;

    var res = Store.saveSemester(input);
    if (!res.ok) {
      Views.banner(res.error, true);
      return;
    }

    state = Store.load();
    viewWeek = null;          // 学期变了，查看周回到本周
    render();
    Views.closeModal();
    Views.toast('学期已保存');
  }

  /* ---------------- 课程（添加 / 编辑 / 删除） ---------------- */

  function findCourse(id) {
    var list = (state && state.schedules) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function openCourseForm(course) {
    Views.clearFieldMarks();
    Views.openModal(Views.courseForm(course));
  }

  function onCourseSubmit(e) {
    e.preventDefault();
    Views.clearFieldMarks();

    var input = {
      id: $('f-sch-id') ? $('f-sch-id').value : '',
      type: 'course',
      title: $('f-title') ? $('f-title').value : '',
      weekday: $('f-weekday') ? Number($('f-weekday').value) : 0,
      start_time: $('f-start') ? $('f-start').value : '',
      duration: $('f-duration') ? Number($('f-duration').value) : 0,
      week_rule: $('f-rule') ? $('f-rule').value : '',
      location: $('f-location') ? $('f-location').value : '',
      note: $('f-note') ? $('f-note').value : '',
      semester_id: state && state.semester ? state.semester.id : ''
    };

    var bad = false;
    if (!String(input.title).trim()) { Views.markField('title', '请填写课程名'); bad = true; }
    if (!(input.weekday >= 1 && input.weekday <= 7)) { Views.markField('weekday', '请选择星期'); bad = true; }
    if (!isTimeStr(input.start_time)) { Views.markField('start', '请填写开始时间'); bad = true; }
    if (!(input.duration > 0)) { Views.markField('duration', '请填时长（分钟）'); bad = true; }
    if (['every', 'odd', 'even'].indexOf(input.week_rule) < 0) { Views.markField('rule', '请选择周次规则'); bad = true; }
    if (bad) return;

    /* 冲突检测：提示但不强制阻止（PRD F4） */
    var conflicts = Rules.findConflicts(input, (state && state.schedules) || []);
    if (conflicts.length) {
      pendingCourse = input;
      Views.openModal(Views.conflictModal(conflicts));
      return;
    }

    saveCourse(input);
  }

  function saveCourse(input) {
    var res = Store.saveSchedule(input);
    if (!res.ok) {
      Views.banner(res.error, true);
      return;
    }
    state = Store.load();
    render();
    Views.closeModal();
    Views.toast(input.id ? '课程已更新' : '课程已添加');
  }

  /* 删除改为两段式（原生 confirm 在内嵌预览里被拦截）：
     pendingDelete = { kind: 'course' | 'todo', id } */
  var pendingDelete = null;

  function findTodo(id) {
    var list = (state && state.todos) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function askRemove(kind, id) {
    var item = kind === 'todo' ? findTodo(id) : findCourse(id);
    if (!item) return;
    pendingDelete = { kind: kind, id: id };
    Views.openModal(Views.confirmDeleteModal(item.title || '该项'));
  }

  function confirmRemove() {
    var p = pendingDelete;
    pendingDelete = null;
    if (!p) return;

    var res = p.kind === 'todo' ? Store.deleteTodo(p.id) : Store.deleteSchedule(p.id);
    if (!res.ok) {
      Views.banner(res.error, true);
      return;
    }
    state = Store.load();
    render();
    Views.closeModal();
    Views.toast(p.kind === 'todo' ? '待办已删除' : '课程已删除');
  }

  /* ---------------- 待办提交（PRD F5） ---------------- */

  function onTodoSubmit(e) {
    e.preventDefault();
    Views.clearFieldMarks();

    var input = {
      id: $('f-todo-id') ? $('f-todo-id').value : '',
      title: $('f-t-title') ? $('f-t-title').value : '',
      due_date: $('f-t-due') ? $('f-t-due').value : '',
      note: $('f-t-note') ? $('f-t-note').value : '',
      done: false,
      source: 'manual'
    };

    /* 编辑时保留原完成状态（表单里没有完成开关，不能因为保存把勾洗掉） */
    var old = input.id ? findTodo(input.id) : null;
    if (old) {
      input.done = old.done;
      input.done_at = old.done_at;
    }

    var bad = false;
    if (!String(input.title).trim()) { Views.markField('todo-title', '请填写标题'); bad = true; }
    if (!isDateStr(input.due_date)) { Views.markField('todo-due', '请选择截止日期'); bad = true; }
    if (bad) return;

    var res = Store.saveTodo(input);
    if (!res.ok) {
      Views.banner(res.error, true);
      return;
    }
    state = Store.load();
    render();
    Views.closeModal();
    Views.toast(input.id ? '待办已更新' : '待办已添加');
  }

  /* ---------------- 导出 / 备份（PRD F9，第⑤步接入） ---------------- */

  /* 文件名里的非法字符替换掉 */
  function safeName(s) {
    return String(s || '').replace(/[\\/:*?"<>|]/g, '_') || '未命名';
  }

  function exportIcs() {
    var semester = state && state.semester;
    if (!semester) { Views.toast('请先设置学期，课程才能换算成日期导出'); return; }

    var text = Ics.build((state && state.schedules) || [], semester);
    if (!text) { Views.toast('没有可导出的课程或日程'); return; }

    var ok = Ics.download(
      safeName(semester.name) + '-课程表.ics',
      text,
      'text/calendar'
    );
    if (ok) {
      Views.closeModal();
      Views.toast('已导出 ' + semester.name + ' 的 .ics（课前 15 分钟提醒）');
    } else {
      Views.banner('导出失败：浏览器拦截了下载，请允许本页下载后重试。', true);
    }
  }

  function exportJson() {
    var text = Store.exportAll();
    var ok = Ics.download(
      'sched-backup-' + Rules.dateKey(new Date()) + '.json',
      text,
      'application/json'
    );
    if (ok) {
      Views.closeModal();
      Views.toast('已导出 JSON 备份（含全部数据）');
    } else {
      Views.banner('导出失败：浏览器拦截了下载，请允许本页下载后重试。', true);
    }
  }

  function pickImportFile() {
    var el = $('import-file');
    if (!el) return;
    el.value = ''; // 允许连续导入同一文件
    el.click();
  }

  function onImportFile(e) {
    var file = e.target && e.target.files && e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      var res = Store.importAll(reader.result);
      if (!res.ok) {
        Views.banner(res.error, true);
        return;
      }
      state = Store.load();
      viewWeek = null;
      render();
      Views.closeModal();
      Views.banner('');
      Views.toast('导入成功：课程/日程 ' + res.counts.schedules + ' 条，待办 ' + res.counts.todos + ' 条');
    };
    reader.onerror = function () {
      Views.banner('导入失败：文件读取出错。', true);
    };
    reader.readAsText(file, 'utf-8');
  }

  /* ---------------- 事件（统一委托，动态渲染的按钮也能响应） ---------------- */

  function handleAction(action, id) {
    if (action === 'open-settings') { openSettings(); return; }
    if (action === 'close-modal') { Views.closeModal(); return; }

    if (action === 'week-prev') { shiftWeek(-1); return; }
    if (action === 'week-next') { shiftWeek(1); return; }
    if (action === 'week-today') { viewWeek = null; render(); return; }

    if (action === 'add-course') { openCourseForm(null); return; }
    if (action === 'edit-course') {
      var c = id ? findCourse(id) : null;
      if (c) openCourseForm(c);
      return;
    }
    if (action === 'delete-course') { askRemove('course', id); return; }
    if (action === 'confirm-delete') { confirmRemove(); return; }

    /* ---------------- 待办（PRD F5 F6） ---------------- */
    if (action === 'add-todo') {
      Views.clearFieldMarks();
      Views.openModal(Views.todoForm(null));
      return;
    }
    if (action === 'edit-todo') {
      var t = id ? findTodo(id) : null;
      if (t) { Views.clearFieldMarks(); Views.openModal(Views.todoForm(t)); }
      return;
    }
    if (action === 'toggle-todo') {
      var res2 = Store.toggleTodo(id);
      if (!res2.ok) { Views.banner(res2.error, true); return; }
      state = Store.load();
      render();
      return;
    }
    if (action === 'delete-todo') { askRemove('todo', id); return; }

    /* ---------------- 导出 / 备份（PRD F9） ---------------- */
    if (action === 'open-export') { Views.openModal(Views.exportModal()); return; }
    if (action === 'export-ics') { exportIcs(); return; }
    if (action === 'export-json') { exportJson(); return; }
    if (action === 'import-json') { pickImportFile(); return; }

    if (action === 'save-anyway') {
      var p = pendingCourse;
      pendingCourse = null;
      if (p) saveCourse(p);
      return;
    }
    if (action === 'back-to-edit') {
      var q = pendingCourse;
      if (q) { Views.clearFieldMarks(); Views.openModal(Views.courseForm(q)); }
      return;
    }
  }

  function onClick(e) {
    var el = e.target;
    while (el && el !== document) {
      var action = el.getAttribute && el.getAttribute('data-action');
      if (action) {
        handleAction(action, el.getAttribute('data-id'));
        return;
      }
      el = el.parentNode;
    }
    // 点遮罩空白处也能关闭
    if (e.target && e.target.id === 'modal-mask') Views.closeModal();
  }

  function onSubmit(e) {
    if (!e.target) return;
    if (e.target.id === 'semester-form') onSemesterSubmit(e);
    else if (e.target.id === 'course-form') onCourseSubmit(e);
    else if (e.target.id === 'todo-form') onTodoSubmit(e);
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && Views.isModalOpen()) Views.closeModal();
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    // 全局错误兜底：任何未捕获异常都不许白屏（TECH_DESIGN §6）
    window.onerror = function (msg) {
      Views.banner('页面出现异常：' + msg, true);
      return false;
    };

    state = Store.load();

    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].onclick = function () {
        switchView(this.getAttribute('data-view'));
      };
    }

    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('change', onImportFile);

    render();

    // 读取时发现的问题（数据损坏等）优先提示
    var issue = Store.lastLoadIssue();
    if (issue) {
      Views.banner(issue, true);
    } else if (!state.semester) {
      Views.banner('还没有学期信息，点右上角「学期设置」填一次即可开始。', false);
    }
  }

  return {
    init: init,
    render: render,
    switchView: switchView,
    openSettings: openSettings
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  window.App.init();
});
