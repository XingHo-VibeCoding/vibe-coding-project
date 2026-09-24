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

  /* ---------------- 自建日期 / 时间面板（Day 8 反馈） ----------------
     为什么自己做：原生 <input type="date|time"> 的浮层是浏览器画的，
     塞不进 ×；「点别处才关」在触屏上极易误触。面板做成底部升起的 sheet：
     右上角 ×、日期点即选、时间两列滚动 + 底部「完成」。
     这里只负责「把 app.js 准备好的数据画出来」，不做任何计算。 */

  var PK_ITEM_H = 44;   /* 时间列每项高度，必须和 css 里 .pk-unit 的高度一致 */
  var DOW_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* 只读「值条」：长相还是输入框（.field input 的样式、标红、.value 取值都照旧），
     但点它开的是我们自己的面板，不再弹原生控件。
     不换成 <button> 的原因：app.js 和各处校验都读 .value，换标签会牵动一大片。 */
  function pickerField(id, opts) {
    var o = opts || {};
    var aria = o.aria || o.label || '';
    return [
      '<span class="wicket">',
      '  <input' + (id ? ' id="' + esc(id) + '"' : '') +
        ' type="text" readonly class="input-picker" data-action="open-picker"' +
        ' data-picker="' + esc(o.type || 'date') + '"' +
        (o.restrict ? ' data-restrict="' + esc(o.restrict) + '"' : '') +
        ' data-label="' + esc(o.label || '') + '"' +
        (o.role ? ' data-role="' + esc(o.role) + '"' : '') +
        ' value="' + esc(o.value || '') + '"' +
        (aria ? ' aria-label="' + esc(aria) + '"' : '') +
        (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
        ' autocomplete="off">',
      '  <span class="wicket__ico" aria-hidden="true">▾</span>',
      '</span>'
    ].join('\n');
  }

  function pickerCol(id, part, list, sel) {
    var html = ['    <div class="pk-col" id="' + id + '">'];
    for (var i = 0; i < list.length; i++) {
      html.push('      <button type="button" class="pk-unit' + (list[i] === sel ? ' is-on' : '') +
        '" data-action="picker-unit" data-part="' + part + '" data-value="' + esc(list[i]) + '">' +
        esc(list[i]) + '</button>');
    }
    html.push('    </div>');
    return html.join('\n');
  }

  function pickerDateHtml(c) {
    var g = c.grid || { title: '', cells: [] };
    var html = [
      '  <div class="pk-cal">',
      '    <div class="pk-cal__nav">',
      '      <button type="button" class="pk-nav" data-action="picker-shift" data-delta="-1" aria-label="上一个月">‹</button>',
      '      <span class="pk-cal__title">' + esc(g.title) + '</span>',
      '      <button type="button" class="pk-nav" data-action="picker-shift" data-delta="1" aria-label="下一个月">›</button>',
      '    </div>',
      '    <div class="pk-cal__dow"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>',
      '    <div class="pk-cal__grid">'
    ];
    for (var i = 0; i < g.cells.length; i++) {
      var cell = g.cells[i];
      var cls = 'pk-day';
      var attr = '';
      if (cell.out) {
        cls += ' is-out';      /* 上/下月的补齐位：灰着，不给点（点它跳月容易迷路） */
      } else {
        if (g.today && cell.key === g.today) cls += ' is-today';
        if (c.value === cell.key) cls += ' is-on';
        if (c.restrict === 'monday' && cell.weekday !== 1) cls += ' is-off';
        attr = ' data-action="picker-day" data-key="' + esc(cell.key) +
          '" aria-label="' + esc(cell.key + ' ' + (DOW_FULL[cell.weekday] || '')) + '"';
      }
      html.push('      <button type="button" class="' + cls + '"' + attr + '>' + cell.day + '</button>');
    }
    html.push('    </div>', '  </div>');
    return html.join('\n');
  }

  function pickerTimeHtml(c) {
    var u = c.units || { hours: [], minutes: [] };
    var v = String(c.value || '');
    return [
      '  <div class="pk-time">',
      '    <div class="pk-value" id="picker-value">' + esc(v || '--:--') + '</div>',
      '    <div class="pk-time__cols">',
      pickerCol('picker-hour', 'hour', u.hours, v.slice(0, 2)),
      pickerCol('picker-minute', 'minute', u.minutes, v.slice(3, 5)),
      '    </div>',
      '  </div>'
    ].join('\n');
  }

  /* 整张 sheet 的 HTML：头（标题 + ×）+ 体 + 脚。
     ctx 由 app.js 备好：{ type, label, value, restrict, grid } 或 { …, units }。 */
  function pickerSheetHtml(ctx) {
    var c = ctx || {};
    var isTime = c.type === 'time';
    var foot = isTime
      ? [
        '  <div class="picker__foot">',
        '    <label class="pk-manual"><span class="pk-manual__lb">也可以直接输入</span>',
        '      <input id="picker-manual" class="pk-manual__in" type="text" maxlength="5" placeholder="08:07" autocomplete="off"></label>',
        '    <button type="button" class="btn btn--primary" data-action="picker-apply">完成</button>',
        '  </div>'
      ].join('\n')
      : [
        '  <div class="picker__foot">',
        '    <span class="picker__note">' +
          esc(c.restrict === 'monday' ? '第一周必须从周一开始，只有周一可以点' : '点一个日期就选好了') +
        '</span>',
        '  </div>'
      ].join('\n');

    return [
      '  <div class="picker__head">',
      '    <span class="picker__title">' + esc(c.label || (isTime ? '选择时间' : '选择日期')) + '</span>',
      '    <button type="button" class="picker__x" data-action="picker-close" aria-label="关闭">×</button>',
      '  </div>',
      '  <div class="picker__body">',
      isTime ? pickerTimeHtml(c) : pickerDateHtml(c),
      '  </div>',
      foot
    ].join('\n');
  }

  function openPickerSheet(ctx) {
    var wrap = $('picker-mask');
    var sheet = $('picker-sheet');
    if (!wrap || !sheet) return false;
    sheet.innerHTML = pickerSheetHtml(ctx);
    wrap.hidden = false;
    if (document.body.classList) document.body.classList.add('pk-lock');
    return true;
  }

  function closePickerSheet() {
    var wrap = $('picker-mask');
    var sheet = $('picker-sheet');
    if (sheet) sheet.innerHTML = '';
    if (wrap) wrap.hidden = true;
    if (document.body.classList) document.body.classList.remove('pk-lock');
  }

  function isPickerOpen() {
    var wrap = $('picker-mask');
    return !!wrap && !wrap.hidden;
  }

  /* 把某一列滚到指定下标（打开时定位、点选后跟随） */
  function scrollPickerCols(hIdx, mIdx) {
    var h = $('picker-hour');
    var m = $('picker-minute');
    if (h && typeof hIdx === 'number') h.scrollTop = hIdx * PK_ITEM_H;
    if (m && typeof mIdx === 'number') m.scrollTop = mIdx * PK_ITEM_H;
  }

  /* 滚动停下后把选中值写回顶部大字与两列高亮。
     只改文字和类名，不动 scrollTop —— 否则会和用户的手指抢滚动位置。 */
  function syncPickerTime(hh, mm) {
    var value = $('picker-value');
    if (value) value.textContent = hh + ':' + mm;
    var units = document.querySelectorAll('.pk-unit');
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      var part = u.getAttribute('data-part');
      var on = (part === 'hour' ? hh : mm) === u.getAttribute('data-value');
      u.className = 'pk-unit' + (on ? ' is-on' : '');
    }
  }

  /* 表单字段标红 + 错误文案（TECH_DESIGN §6：必填项缺失，表单内标红不提交）
     scope 传表单元素：初始设定页和设置弹窗可能同时在 DOM 里，必须限定在提交的那张表里找 */
  function markField(fieldName, msg, scope) {
    var root = scope || document;
    var field = root.querySelector('.field[data-field="' + fieldName + '"]');
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

  /* 节次编辑器（Day 8 反馈：一大段文本太不优雅，改成逐节一行、可增删）
     每行 = 第N节 + 开始时间 + 结束时间 + 删除；容器 id 由调用方给（su-periods / f-periods） */
  function periodRow(no, start, end) {
    return [
      '<div class="periods__row" data-no="' + no + '">',
      '  <span class="periods__no">第 ' + no + ' 节</span>',
      pickerField('', { type: 'time', role: 'start', label: '第 ' + no + ' 节开始时间', value: start || '' }),
      '  <span class="periods__sep">–</span>',
      pickerField('', { type: 'time', role: 'end', label: '第 ' + no + ' 节结束时间', value: end || '' }),
      '  <button type="button" class="btn btn--ghost btn--sm periods__del" data-action="del-period">删除</button>',
      '</div>'
    ].join('');
  }

  /* 【Day 8 补·用户反馈】两种「没有节次」必须分开对待，否则删完保存会「自己长回来」：
       · 缺字段（semester.periods === undefined）：加这个字段之前的老数据 → 回落默认 10 节
       · 空数组（[]）：用户主动删完，意思就是「不设置节次」 → 就该渲染 0 行
     所以这里只看 Array.isArray，**不再看 length**。 */
  function periodsEditor(containerId, semester) {
    var hasField = !!(semester && Array.isArray(semester.periods));
    var list = hasField ? semester.periods : (window.Store ? Store.defaultPeriods() : []);
    var isEmpty = list.length === 0;
    var rows = '';
    for (var i = 0; i < list.length; i++) {
      rows += periodRow(list[i].no || (i + 1), list[i].start, list[i].end);
    }
    /* 辅助输入的默认值从现有数据反推：第一节的时长、第 1→2 节的课间。
       推不出来（比如删空了）才用 45 / 10 兜底。这两个数只在界面上帮着算，
       **不落库** —— 存的仍然只有 periods 表本身。 */
    var defDur = 45, defGap = 10;
    var R0 = window.Rules;
    if (R0 && list.length) {
      var s0 = R0.timeToMin(list[0] && list[0].start);
      var e0 = R0.timeToMin(list[0] && list[0].end);
      if (s0 >= 0 && e0 > s0) defDur = e0 - s0;
      if (list.length > 1) {
        var e0b = R0.timeToMin(list[0] && list[0].end);
        var s1 = R0.timeToMin(list[1] && list[1].start);
        if (e0b >= 0 && s1 >= e0b) defGap = s1 - e0b;
      }
    }
    return [
      '  <div class="field" data-field="periods">',
      '    <label class="field__label">上课节次时间（各校不同，逐节改成你学校的；删完表示不设置）</label>',
      '    <div class="periods__assist">',
      '      <label class="periods__assist-item">每节时长 <input type="number" inputmode="numeric" class="periods__num" id="' + containerId + '-dur" min="10" max="180" step="5" value="' + defDur + '"> 分钟</label>',
      '      <label class="periods__assist-item">课间 <input type="number" inputmode="numeric" class="periods__num" id="' + containerId + '-gap" min="0" max="120" step="5" value="' + defGap + '"> 分钟</label>',
      '      <span class="hint periods__assist-hint">改「每节时长 / 课间」→ 下面整表实时重排（午休等大空档保留）；改某节「开始时间」→ 后面整体顺移；特殊情况直接改「结束时间」就行，不会被动。</span>',
      '    </div>',
      '    <div class="periods" id="' + containerId + '">' + rows + '</div>',
      '    <p class="hint periods__empty"' + (isEmpty ? '' : ' hidden') + '>当前不设置上课节次。需要的话点右边「恢复默认 10 节」，或自己一节节加。</p>',
      '    <div class="periods__actions">',
      '      <button type="button" class="btn btn--sm" data-action="add-period">＋ 添加一节</button>',
      '      <button type="button" class="btn btn--ghost btn--sm periods__restore" data-action="restore-periods"' + (isEmpty ? '' : ' hidden') + '>恢复默认 10 节</button>',
      '    </div>',
      '    <p class="hint">删除后序号自动连续。这里的时间只是「录课时可以带出的参考」，不影响已有课程。</p>',
      '    <div class="field__error" hidden></div>',
      '  </div>'
    ].join('\n');
  }

  /* 学期名：常见叫法做成选项一键选（各校不同，所以永远留「自定义」） */
  function termNameChoices() {
    var now = new Date();
    var m = now.getMonth() + 1;
    var y = now.getFullYear();
    var sy = (m === 1) ? y - 1 : y;   // 1 月仍属上一年开学的那个学年
    var ny = sy + 1;
    return [
      { value: sy + '-' + ny + ' 秋冬', label: sy + '–' + ny + ' 学年 · 秋冬学期（9 月–次年 1 月）' },
      { value: sy + ' 秋', label: sy + ' 年 · 秋季学期' },
      { value: sy + '-' + ny + ' 春夏', label: sy + '–' + ny + ' 学年 · 春夏学期（2 月–7 月）' },
      { value: ny + ' 春', label: ny + ' 年 · 春季学期' },
      { value: ny + ' 夏', label: ny + ' 年 · 夏季 / 小学期' }
    ];
  }

  function defaultTermName() {
    var now = new Date();
    var m = now.getMonth() + 1;
    var y = now.getFullYear();
    var sy = (m === 1) ? y - 1 : y;
    var autumn = (m >= 9 || m <= 1);
    return autumn ? (sy + '-' + (sy + 1) + ' 秋冬') : (sy + '-' + (sy + 1) + ' 春夏');
  }

  /* 学期名字段：select（快速选）+ input（真正的值，也用于自定义）
     注意：input 永远带着当前值，即使被 select 盖住 —— 提交只认它一个来源。 */
  function termNameField(selId, inputId, current) {
    var cur = String(current || '');
    var opts = termNameChoices();
    var matched = false;
    for (var i = 0; i < opts.length; i++) { if (opts[i].value === cur) matched = true; }
    if (!cur) { cur = defaultTermName(); matched = true; }   // 新表单：默认值一定在候选里

    var html = '';
    for (var j = 0; j < opts.length; j++) {
      html += '<option value="' + esc(opts[j].value) + '"' + (opts[j].value === cur ? ' selected' : '') + '>' +
              esc(opts[j].label) + '</option>';
    }
    html += '<option value="__custom__"' + (matched ? '' : ' selected') + '>自定义…（各校叫法不同，直接打字）</option>';

    return [
      '    <label class="field__label" for="' + selId + '">学年 / 学期名（必填）</label>',
      '    <select id="' + selId + '" class="input-select" data-name-target="' + inputId + '">' + html + '</select>',
      '    <input id="' + inputId + '" type="text" maxlength="30" placeholder="例如：2026 秋" value="' + esc(cur) + '"' + (matched ? ' hidden' : '') + '>',
      '    <div class="field__hint" data-hint="name"></div>'
    ].join('\n');
  }

  /* select 变化时把值写进真正的 input（选「自定义」则显示输入框） */
  function applyNameSelect(sel, inputId) {
    var input = document.getElementById(inputId);
    if (!sel || !input) return;
    if (sel.value === '__custom__') {
      input.hidden = false;
      input.value = '';
      input.focus();
    } else {
      input.hidden = true;
      input.value = sel.value;
    }
  }

  /* 第一周周一：选完立刻显示「是星期几 / 行不行」，不用等到提交才知道 */
  function setMondayHint(inputId) {
    var el = document.getElementById(inputId);
    if (!el) return;
    var scope = el.form || document;
    var hint = scope.querySelector('.field[data-field="first_monday"] .field__hint');
    if (!hint) return;
    if (!el.value) { hint.className = 'field__hint'; hint.textContent = ''; return; }
    if (Rules.isMonday(el.value)) {
      hint.className = 'field__hint is-ok';
      hint.textContent = '✓ ' + Rules.weekdayName(el.value) + '，可以用';
    } else {
      hint.className = 'field__hint is-bad';
      hint.textContent = '✗ ' + Rules.weekdayName(el.value) + '，第一周必须从周一开始';
    }
  }

  /* 总周数：边填边判（不用等提交才知道填错），判据来自 Rules.weeksError */
  function setWeeksHint(inputId) {
    var el = document.getElementById(inputId);
    if (!el) return;
    var scope = el.form || document;
    var hint = scope.querySelector('.field[data-field="total_weeks"] .field__hint');
    if (!hint) return;

    if (!String(el.value || '').trim()) {
      hint.className = 'field__hint';
      hint.textContent = '填 1–30 之间的整数，一般学期是 16 / 18 / 20 周';
      return;
    }
    var msg = Rules.weeksError(el.value);
    if (msg) {
      hint.className = 'field__hint is-bad';
      hint.textContent = '✗ ' + msg;
    } else {
      hint.className = 'field__hint is-ok';
      hint.textContent = '✓ ' + Number(el.value) + ' 周，可以';
    }
  }

  function semesterForm(semester) {
    var s = semester || {};
    return [
      '<form class="form" id="semester-form" novalidate>',
      '  <h2 class="form__title">学期设置</h2>',
      '  <p class="hint">周次换算需要一个锚点：第一周的周一。选完会立刻告诉你行不行。</p>',

      '  <div class="field" data-field="name">',
      termNameField('f-name-sel', 'f-name', s.name),
      '    <div class="field__error" hidden></div>',
      '  </div>',

      '  <div class="field" data-field="first_monday">',
      '    <label class="field__label" for="f-monday">第一周的周一（必填）</label>',
      pickerField('f-monday', { type: 'date', restrict: 'monday', label: '第一周的周一', placeholder: '点这里选一个周一', value: s.first_monday }),
      '    <div class="field__hint"></div>',
      '    <div class="field__error" hidden></div>',
      '  </div>',

      '  <div class="field" data-field="total_weeks">',
      '    <label class="field__label" for="f-weeks">总周数（必填，1–30）</label>',
      '    <input id="f-weeks" type="number" min="1" max="30" step="1" value="' + (s.total_weeks ? esc(s.total_weeks) : '') + '" placeholder="例如：18">',
      '    <div class="field__hint"></div>',
      '    <div class="field__error" hidden></div>',
      '  </div>',

      periodsEditor('f-periods', semester),

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

  /* ---------------- 四种页面状态（Day 8：加载中 / 成功 / 空 / 错误） ----------------
     成功态 = 现有的周视图 / 今日视图；这里补齐另外三态的独立呈现。 */

  /* 加载中：骨架屏（脉冲动画）。将来数据来自网络时，这就是真实的等待期 */
  function skeleton() {
    function card(w) {
      return '<div class="sk-card" style="width:' + w + '%"></div>';
    }
    return [
      '<div class="skeleton">',
      '  <p class="skeleton__msg">正在载入你的日程…</p>',
      card(36) + card(72) + card(55) + card(80) + card(46),
      '</div>'
    ].join('\n');
  }

  /* 错误：数据损坏 / 存储不可用。升级为独立卡片，给出重试与重置两条路 */
  function errorCard(issue) {
    return [
      '<div class="state-error">',
      '  <h2>数据加载出错了</h2>',
      '  <p class="state-error__msg">' + esc(issue || '未知错误') + '</p>',
      '  <p class="hint">本地数据可能已损坏。损坏前的原始内容已自动备份；清除重置后备份仍保留，可人工找回。</p>',
      '  <div class="form__actions form__actions--left state-error__actions">',
      '    <button type="button" class="btn btn--primary" data-action="retry-load">重试加载</button>',
      '    <button type="button" class="btn btn--danger" data-action="reset-data">清除数据并重置</button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /* 重置确认（沿用项目自有弹窗，不用原生 confirm） */
  function confirmResetModal() {
    return [
      '<div class="confirm-del">',
      '  <h2 class="form__title">确认清除全部数据</h2>',
      '  <p class="hint">将清空学期、课程、待办，无法恢复（损坏内容的原始备份仍保留）。</p>',
      '  <div class="form__actions">',
      '    <button type="button" class="btn" data-action="close-modal">取消</button>',
      '    <button type="button" class="btn btn--danger" data-action="confirm-reset">确认清除</button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /* 空：初始设定主视图（顶部标题 + 欢迎 + 信息填写 + 提交 + 示例预览入口） */
  function setupPage() {
    return [
      '<div class="setup">',
      '  <div class="setup__hero">',
      '    <h2 class="setup__title">欢迎来到大学生日程助手</h2>',
      '    <p class="setup__sub">把课表和 deadline 收进同一张时间轴。开始只需三步：</p>',
      '    <ol class="setup__steps">',
      '      <li>填写下面的学期信息——它决定「今天是第几周」怎么算</li>',
      '      <li>进入周视图，添加你的课程</li>',
      '      <li>每天打开「今日视图」，看安排、记待办、做结算</li>',
      '    </ol>',
      '  </div>',

      '  <form class="form setup__form" id="setup-form" novalidate>',
      '    <h3 class="form__title">初始设定</h3>',

      '    <div class="field" data-field="name">',
      termNameField('su-name-sel', 'su-name', ''),
      '      <div class="field__error" hidden></div>',
      '    </div>',

      '    <div class="form__row form__row--2">',
      '      <div class="field" data-field="first_monday">',
      '        <label class="field__label" for="su-monday">第一周的周一（必填）</label>',
      pickerField('su-monday', { type: 'date', restrict: 'monday', label: '第一周的周一', placeholder: '点这里选一个周一' }),
      '        <div class="field__hint"></div>',
      '        <div class="field__error" hidden></div>',
      '      </div>',
      '      <div class="field" data-field="total_weeks">',
      '        <label class="field__label" for="su-weeks">总周数（1–30）</label>',
      '        <input id="su-weeks" type="number" min="1" max="30" step="1" placeholder="例如：18">',
      '        <div class="field__hint"></div>',
      '        <div class="field__error" hidden></div>',
      '      </div>',
      '    </div>',

      periodsEditor('su-periods', null),

      '    <div class="form__actions form__actions--left">',
      '      <button type="submit" class="btn btn--primary">保存并开始使用</button>',
      '      <button type="button" class="btn" data-action="load-demo">先看看示例效果</button>',
      '    </div>',
      '  </form>',

      '  <div id="demo-area"></div>',
      '</div>'
    ].join('\n');
  }

  /* 示例预览：mock 数据渲染的卡片列表。纯静态展示（没有 data-action），不写入 Store */
  function renderDemo(courses, todos) {
    var el = $('demo-area');
    if (!el) return;

    /* 课程卡片复用 courseCard()，只是换成静态版（div、无点击动作）——
       不再内联抄一份标记，将来改卡片样式只改一个地方 */
    var cards = '';
    for (var i = 0; i < courses.length; i++) {
      cards += courseCard(courses[i], { static: true });
    }

    var chips = '';
    for (var j = 0; j < todos.length; j++) {
      var t = todos[j];
      chips += [
        '<div class="todo-chip' + (t.done ? ' is-done' : '') + '">',
        '  <span class="todo-chip__check demo__check">' + (t.done ? '✓' : '') + '</span>',
        '  <span class="todo-chip__title">' + esc(t.title) + '<em class="demo__due">' + esc(t.due_date) + ' 截止</em></span>',
        '</div>'
      ].join('');
    }

    el.innerHTML = [
      '<div class="demo">',
      '  <h3 class="demo__title">示例数据预览（假数据，不会被保存）</h3>',
      '  <div class="demo__grid">' + cards + '</div>',
      '  <div class="demo__todos">' + chips + '</div>',
      '</div>'
    ].join('\n');
    el.hidden = false;
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

  /* 课程卡片。两种模式：
     - 默认：流式布局里的完整卡片（初始引导、旧回落布局用）
     - opts.rows = {start, span}：节次网格模式 —— 内联 grid-row 定位 + 紧凑版式，
       地点只在跨 2 节以上时显示（单节行高放不下）
     - opts.static：示例卡片，<div> 且不带点击动作（Day 8 与 courseCard 合并去重） */
  function courseCard(c, opts) {
    var isStatic = !!(opts && opts.static);
    var rows = opts && opts.rows;
    var tag = isStatic ? 'div' : 'button';
    var cls = 'course-card' + (rows ? ' course-card--cell' : '');
    var pos = rows ? ' style="grid-row:' + rows.start + ' / span ' + rows.span + '"' : '';
    var head = isStatic
      ? '<div class="' + cls + '">'
      : '<button type="button" class="' + cls + '" data-action="edit-course" data-id="' + esc(c.id) + '" title="点击编辑或删除"' + pos + '>';
    var showLoc = c.location && (!rows || rows.span >= 2);
    return [
      head,
      '  <span class="course-card__top">',
      '    <span class="course-card__time">' + esc(fmtRange(c.start_time, c.duration)) + '</span>',
      ruleBadge(c.week_rule),
      '  </span>',
      '  <span class="course-card__title">' + esc(c.title) + '</span>',
      showLoc ? '<span class="course-card__loc">' + esc(c.location) + '</span>' : '',
      isStatic ? '</div>' : '</button>'
    ].join('');
  }

  /* 节次时间轴列（周视图第一列 / 今日视图左侧）。行数跟随 periods 长度，
     行高与列内网格共用同一个 CSS 变量，所以天然对齐。 */
  function periodAxisHtml(periods) {
    var rows = '';
    for (var i = 0; i < periods.length; i++) {
      rows += [
        '<div class="axis-row">',
        '  <span class="axis-row__no">' + esc(String((periods[i] && periods[i].no) || (i + 1))) + '</span>',
        '  <span class="axis-row__time">' + esc((periods[i] && periods[i].start) || '') + '</span>',
        '</div>'
      ].join('');
    }
    return [
      '<div class="period-axis" aria-hidden="true">',
      '  <div class="period-axis__head">节次</div>',
      '  <div class="period-axis__rows">' + rows + '</div>',
      '</div>'
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

    /* 节次网格：有生效节次表时按节次分行（B 方案，Day 8）；删空了就回落流式布局 */
    var periods = Rules.effectivePeriods(semester);
    var useGrid = !!periods;
    var axisHtml = useGrid ? periodAxisHtml(periods) : '';
    var todoRow = useGrid ? ' style="grid-row:' + (periods.length + 1) + '"' : '';

    /* 7 列网格：列 = 星期；列内上半是课程卡片，底部是该日截止的待办区（PRD F8） */
    var cols = '';
    for (var d = 1; d <= 7; d++) {
      var dayCourses = [];
      for (var i = 0; i < courses.length; i++) {
        if (Number(courses[i].weekday) === d) dayCourses.push(courses[i]);
      }

      var cards = '';
      for (var j = 0; j < dayCourses.length; j++) {
        var rows = useGrid ? Rules.courseRows(dayCourses[j], periods) : null;
        cards += courseCard(dayCourses[j], rows ? { rows: rows } : null);
      }
      if (!cards) {
        cards = useGrid
          ? '<div class="day-col__empty" style="grid-row:1 / span ' + periods.length + '">无课</div>'
          : '<div class="day-col__empty">无课</div>';
      }

      var dayKey = weekdayDateKey(semester, viewing, d);
      var dayTodos = dayKey ? todosDueOn(state.todos, dayKey) : [];
      var todoArea = '';
      if (dayTodos.length) {
        todoArea = '<div class="day-col__todos"' + (useGrid ? todoRow : '') + '>';
        for (var k = 0; k < dayTodos.length; k++) todoArea += todoChip(dayTodos[k]);
        todoArea += '</div>';
      }

      cols += [
        '<div class="day-col' + (viewingCurrentWeek && d === today ? ' is-today' : '') + '">',
        '  <div class="day-col__head">' + WEEKDAYS[d] + '</div>',
        '  <div class="day-col__body' + (useGrid ? ' is-grid' : '') + '">' + cards + todoArea + '</div>',
        '</div>'
      ].join('');
    }

    box.innerHTML = [
      termBar(semester),
      nav,
      '<div class="weekgrid-wrap"><div class="weekgrid">' + axisHtml + cols + '</div></div>',
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
      pickerField('f-start', { type: 'time', label: '课程开始时间', value: c.start_time || '08:00' }),
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
      pickerField('f-t-due', { type: 'date', label: '截止日期', placeholder: '点这里选日期', value: t.due_date || '' }),
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
      '    <button type="button" class="btn" data-action="open-ai-import">AI 导入课表（示例）</button>',
      '  </div>',
      '  <p class="hint">「AI 导入课表」目前是演示：用内置样例数据走通「识别 → 确认 → 入库」，接入真接口后会变成识别你自己的课表。</p>',
      '  <p class="hint">修改课程后需重新导出 .ics，系统日历的提醒才会同步更新。</p>',
      '  <div class="form__actions form__actions--left">',
      '    <button type="button" class="btn btn--danger" data-action="reset-data">清除数据并重置</button>',
      '  </div>',
      '  <p class="hint">想从头开始（换学期 / 重测）用它：清空学期、课程、待办并回到初始设定，需要再点一次确认，无法恢复。</p>',
      '</div>'
    ].join('\n');
  }

  /* ---------------- AI 课表识别确认弹窗（js/ai/ai.js 解析结果的确认页） ----------------
     勾选制：勾选状态留在 DOM 的 checkbox 里，不用往 app 状态里搬，
     保存时 app.js 直接按 data-idx 从确认结果里取勾中的候选。 */

  function aiRow(c, i) {
    var meta = WEEKDAYS[c.weekday] || ('周' + c.weekday);
    meta += ' ' + fmtRange(c.start_time, c.duration);
    if (c.week_rule !== 'every') meta += ' ' + ruleBadge(c.week_rule);
    if (c.location) meta += ' · ' + esc(c.location);
    return [
      '<label class="ai-row">',
      '  <input type="checkbox" class="ai-row__check" data-idx="' + i + '" checked>',
      '  <span class="ai-row__main"><b class="ai-row__title">' + esc(c.title) + '</b>' +
      '<span class="ai-row__meta">' + meta + '</span></span>',
      '</label>'
    ].join('');
  }

  function aiImportModal(parsed) {
    var rows = '';
    for (var i = 0; i < parsed.courses.length; i++) rows += aiRow(parsed.courses[i], i);

    var warns = '';
    for (var w = 0; w < (parsed.warnings || []).length; w++) {
      warns += '<p class="hint ai-warn">' + esc(parsed.warnings[w]) + '</p>';
    }

    var skips = '';
    if (parsed.skipped.length) {
      skips = '<p class="hint">有 ' + parsed.skipped.length + ' 条没识别出来（不导入）：</p><div class="ai-skips">';
      for (var s = 0; s < parsed.skipped.length; s++) {
        skips += '<p class="ai-skip">' + esc(parsed.skipped[s].reason) +
          (parsed.skipped[s].raw ? ' — ' + esc(parsed.skipped[s].raw) : '') + '</p>';
      }
      skips += '</div>';
    }

    var actions;
    if (!rows) {
      actions = '<div class="form__actions"><button type="button" class="btn" data-action="close-modal">知道了</button></div>';
    } else {
      actions = [
        '<div class="form__actions">',
        '  <button type="button" class="btn" data-action="close-modal">取消</button>',
        '  <button type="button" class="btn btn--primary" data-action="ai-save">导入选中课程</button>',
        '</div>'
      ].join('\n');
    }

    return [
      '<div class="confirm-del ai-import">',
      '  <h2 class="form__title">AI 课表识别（示例数据）</h2>',
      '  <p class="hint">这一步走的是内置样例（真接口还没接）：数据长什么样、怎么确认、怎么入库，就是将来真实课表的样子。勾掉不想导入的再点确认。</p>',
      warns,
      rows ? '<div class="ai-list">' + rows + '</div>' : '<p class="hint">没有识别出课程。</p>',
      skips,
      actions,
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
      /* 有生效节次表 → 节次轴 + 单列网格（与周视图同一套排布规则）；否则流式回落 */
      var periods = Rules.effectivePeriods(semester);
      if (periods) {
        var cells = '';
        for (var j = 0; j < todayCourses.length; j++) {
          var rows = Rules.courseRows(todayCourses[j], periods);
          cells += courseCard(todayCourses[j], rows ? { rows: rows } : null);
        }
        courseHtml = [
          '<div class="today-grid">',
          periodAxisHtml(periods),
          '  <div class="today-grid__col is-grid">' + cells + '</div>',
          '</div>'
        ].join('');
      } else {
        for (var j2 = 0; j2 < todayCourses.length; j2++) courseHtml += courseCard(todayCourses[j2]);
      }
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
    pickerField: pickerField,
    pickerSheetHtml: pickerSheetHtml,
    openPickerSheet: openPickerSheet,
    closePickerSheet: closePickerSheet,
    isPickerOpen: isPickerOpen,
    scrollPickerCols: scrollPickerCols,
    syncPickerTime: syncPickerTime,
    markField: markField,
    clearFieldMarks: clearFieldMarks,
    semesterForm: semesterForm,
    periodRow: periodRow,
    applyNameSelect: applyNameSelect,
    setMondayHint: setMondayHint,
    setWeeksHint: setWeeksHint,
    courseForm: courseForm,
    todoForm: todoForm,
    confirmDeleteModal: confirmDeleteModal,
    confirmResetModal: confirmResetModal,
    conflictModal: conflictModal,
    exportModal: exportModal,
    aiImportModal: aiImportModal,
    skeleton: skeleton,
    errorCard: errorCard,
    setupPage: setupPage,
    renderDemo: renderDemo,
    courseCard: courseCard,
    periodsEditor: periodsEditor,
    renderWeek: renderWeek,
    renderToday: renderToday
  };
})();
