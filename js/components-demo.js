/* ============================================================
   components-demo.js —— 演示页的挂载与交互（只在这张演示页里跑）
   分工：本文件准备数据、处理交互 → Components 负责拼 HTML。
   ============================================================ */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* 演示数据：故意混入「缺地点」「同一门课两个班」「已完成的待办」，用来看边界表现 */
  var COURSES = [
    { id: 'c1', title: '高等数学', weekday: 1, start: '08:00', duration: 100, place: '教一 101', rule: 'every' },
    { id: 'c2', title: '大学英语', weekday: 3, start: '10:10', duration: 100, place: '文B 202', rule: 'odd' },
    { id: 'c3', title: '数据结构', weekday: 2, start: '14:00', duration: 100, place: '实验楼 304', rule: 'every' },
    { id: 'c4', title: '体育', weekday: 5, start: '14:00', duration: 90, place: '田径场', rule: 'even' },
    { id: 'c5', title: '大学物理', weekday: 4, start: '16:10', duration: 100, place: '', rule: 'every' },
    { id: 'c6', title: '高等数学', weekday: 3, start: '19:25', duration: 90, place: '教一 305', rule: 'odd' }
  ];

  var DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  var TODOS = [
    { id: 't1', title: '交高数作业', due: '今天', done: false },
    { id: 't2', title: '复习数据结构第三章', due: '明天', done: false },
    { id: 't3', title: '打印实验报告', due: '周五', done: true },
    { id: 't4', title: '预约图书馆研讨间', due: '下周一', done: false }
  ];

  /* 同一套组件，换成完全不同的数据用（演示「可复用」不是只给课程用） */
  var NOTES = [
    { title: '读书清单', subtitle: '本周想读完的 3 篇论文', meta: ['进度 1/3'], tone: 'ok' },
    { title: '实验室值班表', subtitle: '周三 18:00–20:00', meta: ['B201'], tone: 'default' },
    { title: '社团例会纪要', subtitle: '待整理上次记录', meta: ['周一', '线上'], tone: 'warn' }
  ];

  function fmtEnd(start, duration) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(start || '');
    if (!m) return start || '';
    var total = Number(m[1]) * 60 + Number(m[2]) + Number(duration || 0);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(Number(m[1])) + ':' + m[2] + '–' + pad(Math.floor(total / 60) % 24) + ':' + pad(total % 60);
  }

  function ruleBadge(rule) {
    if (rule === 'odd') return [{ text: '单周', kind: 'default' }];
    if (rule === 'even') return [{ text: '双周', kind: 'default' }];
    return [];
  }

  /* 数据 → 组件参数：这一步是「适配层」，组件本身不认识课程 / 待办 */
  function courseItems(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      out.push({
        title: c.title,
        subtitle: DAYS[c.weekday] + ' ' + fmtEnd(c.start, c.duration),
        badges: ruleBadge(c.rule),
        meta: c.place ? [c.place] : [],
        trailing: c.place ? '' : '待补地点',
        action: 'tap-course',
        id: c.id,
        accent: c.rule !== 'every'
      });
    }
    return out;
  }

  function todoItems(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      out.push({
        title: t.title,
        meta: ['截止 ' + t.due],
        badges: t.done ? [{ text: '已完成', kind: 'ok' }] : [],
        checked: t.done,
        action: 'toggle-todo',
        id: t.id
      });
    }
    return out;
  }

  function noteItems(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      out.push({
        title: n.title,
        subtitle: n.subtitle,
        badges: n.tone && n.tone !== 'default' ? [{ text: 'note', kind: n.tone }] : [],
        meta: n.meta
      });
    }
    return out;
  }

  /* ---------------- 渲染 ---------------- */

  function currentCourses() {
    var q = String(($('cp-q') || {}).value || '').trim().toLowerCase();
    var by = ($('cp-sort') || {}).value || 'weekday';

    var list = COURSES.filter(function (c) {
      if (!q) return true;
      var hay = (c.title + ' ' + c.place + ' ' + DAYS[c.weekday]).toLowerCase();
      return hay.indexOf(q) >= 0;
    });

    list.sort(function (a, b) {
      if (by === 'title') return a.title.localeCompare(b.title, 'zh');
      return (a.weekday - b.weekday) || (a.start < b.start ? -1 : 1);
    });
    return list;
  }

  function renderCourses() {
    var list = currentCourses();
    $('cp-demo-courses').innerHTML = Components.listHtml({
      title: '我的课表',
      items: courseItems(list),
      divider: true,
      empty: '没有匹配的课程（换个关键词试试）'
    });
  }

  function renderTodos() {
    $('cp-demo-todos').innerHTML = Components.listHtml({
      title: '待办',
      items: todoItems(TODOS),
      divider: true,
      dense: true
    });
    var open = TODOS.filter(function (t) { return !t.done; }).length;
    log('待办剩余 ' + open + ' 条未完成（列表组件的计数是「总条数」，剩余数在这里算）');
  }

  function renderNotes() {
    $('cp-demo-notes').innerHTML = Components.listHtml({
      title: '同一组件换数据',
      items: noteItems(NOTES),
      divider: true
    });
  }

  function renderCardShowcase() {
    $('cp-demo-card').innerHTML = Components.cardHtml({
      title: '高等数学',
      subtitle: '周一 08:00–09:40',
      badges: [{ text: '必修', kind: 'default' }, { text: '期中', kind: 'warn' }],
      meta: ['教一 101', '张三'],
      accent: true,
      body: ['带课本和习题册，本次讲第 4 章。', '作业周四前交。'],
      actions: [
        { text: '编辑', action: 'demo-edit', id: 'c1', kind: 'primary' },
        { text: '删除', action: 'demo-del', id: 'c1', kind: 'danger' }
      ]
    });

    /* 边界：没有标题 → 组件返回空串（调用方不用自己判空） */
    var blank = Components.cardHtml({ subtitle: '只有副标题' });
    $('cp-demo-empty').innerHTML = Components.listHtml({
      title: '边界示例',
      items: [],
      empty: blank === '' ? '没有标题的卡片返回空串，所以这里显示的是空状态文案' : '异常：空卡片没有被拦住'
    });
  }

  function renderApi() {
    var sample = [
      'Components.listHtml({',
      "  title: '我的课表',",
      '  items: [{ title, subtitle, badges, meta, trailing, checked, action, id }],',
      '  divider: true, dense: false,',
      "  empty: '没有匹配的课程'",
      '})',
      '',
      'Components.cardHtml({',
      "  title: '高等数学', subtitle: '周一 08:00–09:40',",
      '  badges: [{ text, kind }], meta: [..], body: [..],',
      '  actions: [{ text, action, id, kind }],',
      '  accent: true, checked: undefined',
      '})',
      '',
      "Components.highlightTags('高等数学', ['数学'])",
      "Components.escape('<b>不解析标签</b>')"
    ].join('\n');
    $('cp-api').textContent = sample;
  }

  /* 演示用的轻提示（与主应用同款观感，演示页自带一份，不依赖主应用） */
  var toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'cp-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2000);
  }

  var logEl = null;
  function log(msg) {
    if (!logEl) logEl = $('cp-log');
    if (!logEl) return;
    logEl.hidden = false;
    var p = document.createElement('p');
    p.className = 'cp-log__line';
    p.textContent = '· ' + msg;
    logEl.appendChild(p);
    while (logEl.children.length > 6) logEl.removeChild(logEl.firstChild);
  }

  /* ---------------- 交互 ---------------- */

  function onClick(e) {
    var el = e.target;
    while (el && el !== document) {
      var action = el.getAttribute && el.getAttribute('data-action');
      if (action) {
        var id = el.getAttribute('data-id');
        if (action === 'tap-course') {
          var c = COURSES.filter(function (x) { return x.id === id; })[0];
          if (c) toast('选中：' + c.title + '（' + DAYS[c.weekday] + '）');
        } else if (action === 'toggle-todo') {
          var box = el.querySelector ? el.querySelector('.cp-check') : null;
          var t = TODOS.filter(function (x) { return x.id === id; })[0];
          if (t) {
            t.done = box ? box.checked : !t.done;
            renderTodos();
            log((t.done ? '已完成：' : '重新打开：') + t.title);
          }
          return;   /* 勾选会重渲染，不再往上冒 */
        } else {
          toast('演示动作：' + action + (id ? '（' + id + '）' : ''));
        }
        return;
      }
      el = el.parentNode;
    }
  }

  function init() {
    renderCourses();
    renderTodos();
    renderNotes();
    renderCardShowcase();
    renderApi();

    var q = $('cp-q');
    if (q) q.addEventListener('input', renderCourses);
    var sort = $('cp-sort');
    if (sort) sort.addEventListener('change', renderCourses);

    document.addEventListener('click', onClick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
