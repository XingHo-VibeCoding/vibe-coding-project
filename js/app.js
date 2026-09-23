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

  /* 第一周必须是周一，否则周次换算、单双周、.ics 日期全错 */
  function mondayErrMsg(s) {
    if (!Rules.parseDate(s)) return null;
    /* 修 bug：这里原本漏了「是周一就通过」的判断，导致选周一也被拒， */
    /* 而且文案照实说「你选的是周一」，自相矛盾。 */
    if (Rules.isMonday(s)) return null;
    return '必须选一个周一（你选的是' + Rules.weekdayName(s) + '）';
  }

  /* 节次：从 DOM 逐行收集 [{start,end}] → Rules 校验并重排序号 */
  function collectPeriods(containerId) {
    var box = $(containerId);
    if (!box) return { ok: true, periods: [] };
    var rows = box.querySelectorAll('.periods__row');
    var pairs = [];
    for (var i = 0; i < rows.length; i++) {
      var st = rows[i].querySelector('[data-role="start"]');
      var en = rows[i].querySelector('[data-role="end"]');
      pairs.push({ start: st ? st.value : '', end: en ? en.value : '' });
    }
    return Rules.periodsFromPairs(pairs);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function minToTime(m) {
    m = ((m % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  /* 从点击的元素往上找最近的某类祖先（不用 closest，保持兼容）
     注意：必须「整个类名相等」才算命中，不能用 indexOf 子串判断——
     .periods__actions / .periods__row / .periods__del 里都含 "periods" 字样，
     子串匹配会把「添加一节」按钮的父容器误认成节次容器（Day 8 实测踩到）。 */
  function closestByClass(el, cls) {
    while (el && el !== document) {
      if (el.classList && el.classList.contains(cls)) return el;
      if (!el.classList && el.className) {
        var parts = String(el.className).split(/\s+/);
        for (var i = 0; i < parts.length; i++) {
          if (parts[i] === cls) return el;
        }
      }
      el = el.parentNode;
    }
    return null;
  }

  /* 找出某个元素所属的「节次容器」（就是那一串 .periods__row 的父节点）。
     为什么不能靠 closestByClass 往上找 .periods：
     .periods__actions（放「添加一节」按钮的那条）和 .periods 是**兄弟**关系，
     按钮往上永远走不到 .periods。所以改为先找到包裹它们的 .field[data-field="periods"]，
     再在它里面取 .periods。 */
  function periodsBoxOf(el) {
    while (el && el !== document) {
      if (el.getAttribute && el.getAttribute('data-field') === 'periods') {
        return el.querySelector('.periods');
      }
      el = el.parentNode;
    }
    return null;
  }

  /* 到 15 节上限时把「添加一节」按钮变灰。
     为什么用轻提示（底部浮动）而不是顶部提示条：
     表单在页面下方、手机上一屏只看到一截，提示条跑到页面最上面根本看不见。
     toast 固定在视口底部，正好落在手指附近。 */
  function periodsCapState(box) {
    var field = box && box.parentNode;
    if (!field) return false;
    var btn = field.querySelector('[data-action="add-period"]');
    var full = box.querySelectorAll('.periods__row').length >= 15;
    if (btn) btn.className = full ? 'btn btn--sm is-dim' : 'btn btn--sm';
    return full;
  }

  /* 增删节次后重排序号（界面上「第N节」与实际顺序始终一致） */
  function renumberPeriods(box) {
    if (!box) return;
    var rows = box.querySelectorAll('.periods__row');
    for (var i = 0; i < rows.length; i++) {
      rows[i].setAttribute('data-no', i + 1);
      var label = rows[i].querySelector('.periods__no');
      if (label) label.textContent = '第 ' + (i + 1) + ' 节';
      var st = rows[i].querySelector('[data-role="start"]');
      var en = rows[i].querySelector('[data-role="end"]');
      if (st) st.setAttribute('aria-label', '第' + (i + 1) + '节开始时间');
      if (en) en.setAttribute('aria-label', '第' + (i + 1) + '节结束时间');
    }
    periodsCapState(box);
  }

  function addPeriodRow(btn) {
    var box = periodsBoxOf(btn);
    if (!box) return;
    var rows = box.querySelectorAll('.periods__row');
    if (rows.length >= 15) { Views.toast('一天最多 15 节，删掉一节才能再加。'); return; }

    var start = '08:00', end = '08:45';
    if (rows.length) {
      var lastEnd = rows[rows.length - 1].querySelector('[data-role="end"]');
      var base = lastEnd && lastEnd.value ? Rules.timeToMin(lastEnd.value) : 8 * 60;
      if (base < 0) base = 8 * 60;
      start = minToTime(base + 10);          // 上一节结束后歇 10 分钟
      end = minToTime(base + 10 + 45);       // 默认一节课 45 分钟
    }
    /* 插到「最后一个节次行」之后：box 里只有 .periods__row，
       「添加一节」按钮在 box 外面（.periods__actions 里），所以不会插到按钮下方 */
    box.insertAdjacentHTML('beforeend', Views.periodRow(rows.length + 1, start, end));
    renumberPeriods(box);
    Views.clearFieldMarks();
  }

  function removePeriodRow(btn) {
    var row = closestByClass(btn, 'periods__row');
    var box = periodsBoxOf(btn);
    if (!row || !box) return;
    row.parentNode.removeChild(row);
    renumberPeriods(box);
    Views.clearFieldMarks();
  }

  /* ---------------- 四种页面状态（Day 8） ----------------
     appState: 'loading' | 'empty' | 'error' | 'success'
     fetchState 是数据获取的唯一入口：现在是「模拟延迟 + 本地读取」，
     第 3 周接真实 API 时只改这个函数，渲染层不动。 */
  var appState = 'loading';

  /* 模拟等待时长。本地读 localStorage 其实是瞬时的，300ms 根本看不见骨架屏，
     所以调到 600ms —— 足够肉眼确认「加载中」这一态存在。接真实 API 后删掉这个常量。 */
  var MOCK_LATENCY_MS = 600;

  function fetchState() {
    return new Promise(function (resolve) {
      setTimeout(function () {
        var s = Store.load();
        resolve({ state: s, issue: Store.lastLoadIssue() });
      }, MOCK_LATENCY_MS);
    });
  }

  function showOnly(name) {
    appState = name;
    var sk = $('app-skeleton');
    var setup = $('view-setup');
    var week = $('view-week');
    var today = $('view-today');
    if (sk) sk.hidden = name !== 'loading';
    if (setup) setup.hidden = !(name === 'empty' || name === 'error');
    var success = name === 'success';
    if (week) week.hidden = !success || currentView !== 'week';
    if (today) today.hidden = !success || currentView !== 'today';
    var tabs = document.querySelector('.tabs');
    if (tabs) tabs.hidden = !success;   // 还没有数据时，视图切换没意义

    /* 已有 15 节（例如上次存过）时，按钮上来就该是灰的，不用等点到才知道 */
    if (setup && !setup.hidden) {
      var pbox = setup.querySelector('.periods');
      if (pbox) periodsCapState(pbox);
    }
  }

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
    /* 打开就把已有值的判定显示出来，别等用户改动才提示 */
    Views.setWeeksHint('f-weeks');
    Views.setMondayHint('f-monday');
    Views.banner('');
  }

  function onSemesterSubmit(e) {
    e.preventDefault();
    Views.clearFieldMarks();
    var form = e.target;

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
    if (!String(input.name).trim()) { Views.markField('name', '请填写学期名', form); bad = true; }
    if (!isDateStr(input.first_monday)) {
      Views.markField('first_monday', '请选择第一周的周一', form);
      bad = true;
    } else {
      var mErr = mondayErrMsg(input.first_monday);
      if (mErr) { Views.markField('first_monday', mErr, form); bad = true; }
    }

    /* 总周数：与实时提示共用 Rules.weeksError，说法不会两处不一致 */
    var wErr = Rules.weeksError(input.total_weeks);
    if (wErr) { Views.markField('total_weeks', wErr, form); bad = true; }

    /* 节次时间（Day 8）：逐节编辑，全删 = 不设节次 */
    if ($('f-periods')) {
      var pRes = collectPeriods('f-periods');
      if (!pRes.ok) { Views.markField('periods', pRes.error, form); bad = true; }
      else input.periods = pRes.periods;
    }

    if (bad) return;

    var res = Store.saveSemester(input);
    if (!res.ok) {
      Views.banner(res.error, true);
      return;
    }

    state = Store.load();
    viewWeek = null;          // 学期变了，查看周回到本周
    render();
    switchView(currentView);
    Views.closeModal();
    Views.toast('学期已保存');
  }

  /* ---------------- 初始设定页提交（Day 8 空状态主入口） ---------------- */

  function onSetupSubmit(e) {
    e.preventDefault();
    Views.clearFieldMarks();
    var form = e.target;

    var nameEl = $('su-name');
    var mondayEl = $('su-monday');
    var weeksEl = $('su-weeks');
    if (!nameEl || !mondayEl || !weeksEl) return;

    var input = {
      name: nameEl.value,
      first_monday: mondayEl.value,
      total_weeks: weeksEl.value
    };

    var bad = false;
    if (!String(input.name).trim()) { Views.markField('name', '请填写学期名', form); bad = true; }
    if (!isDateStr(input.first_monday)) {
      Views.markField('first_monday', '请选择第一周的周一', form);
      bad = true;
    } else {
      var mErr = mondayErrMsg(input.first_monday);
      if (mErr) { Views.markField('first_monday', mErr, form); bad = true; }
    }

    /* 总周数：与实时提示共用 Rules.weeksError，说法不会两处不一致 */
    var wErr = Rules.weeksError(input.total_weeks);
    if (wErr) { Views.markField('total_weeks', wErr, form); bad = true; }

    var pRes = collectPeriods('su-periods');
    if (!pRes.ok) { Views.markField('periods', pRes.error, form); bad = true; }
    else input.periods = pRes.periods;

    if (bad) return;

    var res = Store.saveSemester(input);
    if (!res.ok) {
      Views.banner(res.error, true);
      return;
    }

    state = Store.load();
    viewWeek = null;
    render();
    showOnly('success');
    Views.toast('学期已保存，开始使用');
    Views.banner('下一步：在周视图点「＋ 添加课程」，把课表录进来。', false);
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

  /* 表单里的即时联动（Day 8 反馈）：学期名下拉、第一周周一的星期提示 */
  function onFormChange(e) {
    var t = e.target;
    if (!t || !t.id) return;
    if (t.id === 'import-file') return;                  // 导入文件由 onImportFile 处理

    var target = t.getAttribute && t.getAttribute('data-name-target');
    if (target) { Views.applyNameSelect(t, target); return; }

    if (t.id === 'su-monday' || t.id === 'f-monday') Views.setMondayHint(t.id);
    if (t.id === 'su-weeks' || t.id === 'f-weeks') Views.setWeeksHint(t.id);
  }

  /* 输入过程中就提示（input 每敲一个字符就触发；change 要失焦才触发，太晚） */
  function onInput(e) {
    var t = e.target;
    if (!t || !t.id) return;
    if (t.id === 'su-weeks' || t.id === 'f-weeks') Views.setWeeksHint(t.id);
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

  /* trigger = 被点的那个元素本身。
     节次行的增删要从「按钮」往上找它所在的行/容器，所以必须把元素传进来。
     （Day 8 实测 bug：这里原来直接用了 e.target，但本函数没有 e 这个参数，
       一点「添加一节」就抛 ReferenceError: e is not defined。） */
  function handleAction(action, id, trigger) {
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

    /* ---------------- 节次行增删（Day 8 反馈） ----------------
       传 trigger（被点的按钮）而不是 e.target：本函数没有事件对象 e。
       取不到按钮时 addPeriodRow/removePeriodRow 内部会安全返回，不会抛错。 */
    if (action === 'add-period') { addPeriodRow(trigger); return; }
    if (action === 'del-period') { removePeriodRow(trigger); return; }

    /* ---------------- 四种页面状态的动作（Day 8） ---------------- */
    if (action === 'load-demo') {
      if (window.Mock) Views.renderDemo(Mock.courses, Mock.todos);
      return;
    }
    if (action === 'retry-load') { location.reload(); return; }
    if (action === 'reset-data') { Views.openModal(Views.confirmResetModal()); return; }
    if (action === 'confirm-reset') {
      var rr = Store.resetAll();
      if (!rr.ok) { Views.banner(rr.error, true); return; }
      Views.closeModal();
      location.reload();
      return;
    }
  }

  function onClick(e) {
    var el = e.target;
    while (el && el !== document) {
      var action = el.getAttribute && el.getAttribute('data-action');
      if (action) {
        handleAction(action, el.getAttribute('data-id'), el);
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
    else if (e.target.id === 'setup-form') onSetupSubmit(e);
    else if (e.target.id === 'course-form') onCourseSubmit(e);
    else if (e.target.id === 'todo-form') onTodoSubmit(e);
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && Views.isModalOpen()) Views.closeModal();
  }

  /* ---------------- 启动 ---------------- */

  /* ---------------- 启动自检（Day 8 实测反馈）----------------
     浏览器会缓存 js：可能出现「新的 views.js + 旧的 rules.js」这种混载，
     报出来的是「Rules.isMonday is not a function」——看着像代码写错，
     其实是缓存。这里启动时点一遍各层必须有的函数，缺了就直接告诉他强刷。 */
  var LAYER_API = [
    { file: 'store.js', obj: 'Store', need: ['load', 'saveSemester', 'saveSchedule', 'toggleTodo', 'exportAll', 'importAll', 'defaultPeriods', 'resetAll'] },
    { file: 'rules.js', obj: 'Rules', need: ['parseDate', 'isMonday', 'weekdayName', 'weeksError', 'periodsFromPairs', 'currentWeekNo', 'coursesOfWeek', 'findConflicts', 'todaySummary'] },
    { file: 'ics.js', obj: 'Ics', need: ['build', 'download'] },
    { file: 'mock.js', obj: 'Mock', need: ['courses', 'todos'] },
    { file: 'views.js', obj: 'Views', need: ['setupPage', 'skeleton', 'errorCard', 'semesterForm', 'setMondayHint', 'setWeeksHint', 'renderWeek', 'renderToday'] }
  ];

  /* 返回缺失清单；空数组 = 各层齐全 */
  function missingLayers() {
    var bad = [];
    for (var i = 0; i < LAYER_API.length; i++) {
      var spec = LAYER_API[i];
      var layer = window[spec.obj];
      if (!layer) { bad.push(spec.file + '（没加载）'); continue; }
      for (var j = 0; j < spec.need.length; j++) {
        /* 只看「有没有」：函数和 Mock 的数组都算，旧版文件里没有就是 undefined */
        if (layer[spec.need[j]] === undefined || layer[spec.need[j]] === null) {
          bad.push(spec.file + ' 缺 ' + spec.need[j]);
          break;
        }
      }
    }
    return bad;
  }

  /* 自检失败时直接摊开说，不依赖 Views（它可能正是旧的那个） */
  function reportStaleLayers(bad) {
    var msg = '页面脚本版本不一致：' + bad.join('、') +
      '。这是浏览器缓存了旧文件导致的，不是数据坏了——按 Ctrl+Shift+R 强制刷新即可（Mac 用 Cmd+Shift+R）。';

    var el = $('banner');
    if (el) { el.className = 'banner banner--error'; el.textContent = msg; el.hidden = false; }

    var sk = $('app-skeleton');
    if (sk) sk.hidden = true;

    var box = $('view-setup');
    if (box) {
      box.hidden = false;
      /* 用 window.Views 而不是裸 Views：万一 views.js 是旧版，这里也不能再抛一次错 */
      var V = window.Views;
      box.innerHTML = (V && typeof V.errorCard === 'function')
        ? V.errorCard(msg)
        : '<div class="placeholder"><h2>脚本没加载全</h2><p>' + msg + '</p></div>';
    }
  }

  function init() {
    // 全局错误兜底：任何未捕获异常都不许白屏（TECH_DESIGN §6）
    window.onerror = function (msg) {
      Views.banner('页面出现异常：' + msg, true);
      return false;
    };

    /* 先自检：混载了旧文件就当场说清楚，不再让用户看到天书报错 */
    var stale = missingLayers();
    if (stale.length) {
      reportStaleLayers(stale);
      return;
    }

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
    document.addEventListener('change', onFormChange);
    document.addEventListener('input', onInput);

    /* 四态分流：加载中 → 错误 / 空（初始设定页）/ 成功 */
    /* 骨架屏内容必须先填进去，否则那 0.6 秒只是一片空白（Day 8 反馈修复） */
    var skBox = $('app-skeleton');
    if (skBox) skBox.innerHTML = Views.skeleton();
    showOnly('loading');
    fetchState().then(function (r) {
      state = r.state;

      if (r.issue) {
        var setupBox = $('view-setup');
        if (setupBox) setupBox.innerHTML = Views.errorCard(r.issue);
        Views.banner('');
        showOnly('error');
        return;
      }

      if (!state.semester) {
        var setupBox2 = $('view-setup');
        if (setupBox2) setupBox2.innerHTML = Views.setupPage();
        Views.banner('');
        showOnly('empty');
        return;
      }

      render();
      showOnly('success');
    });
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
