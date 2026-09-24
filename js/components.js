/* ============================================================
   components.js —— 可复用卡片 / 列表组件（Day 9 附加任务，独立演示用）
   职责：一套「配置驱动」的展示组件，纯函数生成 HTML 字符串，不碰 DOM、不碰存储。
   分层同主应用：components.js（只拼 HTML）→ components-demo.html（只管挂载与交互）。
   为什么配置驱动：调用方只描述「显示什么」，不关心 class 与结构；样式改版只动组件。
   提供：
     Components.cardHtml(opts)      单张卡片（可选头部 / 徽章 / 元信息 / 正文 / 底部操作）
     Components.listHtml(opts)      列表（组标题 + 计数 / 空状态 / 分隔 / 可点/可勾选行）
     Components.highlightTags(html, [词])  纯文本高亮（先转义，防 XSS）
     Components.escape(s)           转义
   所有插值都经过 escape()，属性用单引号包裹并转义引号，避免注入。
   ============================================================ */

window.Components = (function () {
  'use strict';

  function escape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* 高亮：先整体转义，再把命中的关键词套 mark（顺序不能反，否则 mark 自己会被转义） */
  function highlightTags(text, words) {
    var out = escape(text);
    if (!Array.isArray(words) || !words.length) return out;
    for (var i = 0; i < words.length; i++) {
      var w = String(words[i] || '');
      if (!w) continue;
      var safe = escape(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(safe, 'g'), '<mark class="cp-mark">' + escape(w) + '</mark>');
    }
    return out;
  }

  function badgesHtml(list) {
    if (!Array.isArray(list) || !list.length) return '';
    var out = '';
    for (var i = 0; i < list.length; i++) {
      var b = list[i] || {};
      var kind = b.kind || 'default';
      out += '<span class="cp-badge cp-badge--' + escape(kind) + '">' + escape(b.text) + '</span>';
    }
    return '<span class="cp-card__badges">' + out + '</span>';
  }

  function metaHtml(list) {
    if (!Array.isArray(list) || !list.length) return '';
    var out = '';
    for (var i = 0; i < list.length; i++) {
      if (list[i] == null || list[i] === '') continue;
      if (out) out += '<span class="cp-dot">·</span>';
      out += '<span class="cp-meta__item">' + escape(list[i]) + '</span>';
    }
    return out ? '<span class="cp-card__meta">' + out + '</span>' : '';
  }

  function actionsHtml(list) {
    if (!Array.isArray(list) || !list.length) return '';
    var out = '<div class="cp-card__actions">';
    for (var i = 0; i < list.length; i++) {
      var a = list[i] || {};
      var kind = a.kind ? ' cp-btn--' + escape(a.kind) : '';
      var idAttr = a.id ? ' data-id="' + escape(a.id) + '"' : '';
      var actAttr = a.action ? ' data-action="' + escape(a.action) + '"' : '';
      out += '<button type="button" class="cp-btn' + kind + '"' + idAttr + actAttr + '>' + escape(a.text) + '</button>';
    }
    return out + '</div>';
  }

  /* ---------------- 卡片 ----------------
     opts:
       id        DOM id（可选）
       title     标题（必填，没有标题的卡片退化成纯文本块，这里直接返回空串）
       subtitle  副标题
       badges    [{ text, kind:'default'|'ok'|'warn'|'danger' }]
       meta      ['08:00–09:40', '教一 101']
       accent    true = 左侧色条
       body      正文（纯文本；数组则每项一段）
       actions   [{ text, action, id, kind:'primary'|'danger' }]
       checked   传入布尔值时才渲染勾选框
       clickable 配合 action/id 生成整卡可点
   */
  function cardHtml(opts) {
    var o = opts || {};
    if (!o.title) return '';

    var clickable = !!o.clickable && !!o.action;
    var tag = clickable ? 'button' : 'div';
    var attrs = '';
    if (o.id) attrs += ' id="' + escape(o.id) + '"';
    if (clickable) {
      attrs += ' type="button" data-action="' + escape(o.action) + '"';
      if (o.cardId) attrs += ' data-id="' + escape(o.cardId) + '"';
    } else {
      attrs += ' type="button"';   /* div 上多余，但保持模板统一；下面 tag 为 div 时会被去掉 */
    }
    if (!clickable) attrs = attrs.replace(' type="button"', '');

    var cls = 'cp-card' + (o.accent ? ' cp-card--accent' : '') + (clickable ? ' cp-card--tappable' : '');

    var head = '';
    if (o.checked !== undefined) {
      head += '<input type="checkbox" class="cp-check"' + (o.checked ? ' checked' : '') + ' aria-label="' + escape(o.title) + '">';
    }
    head += '<span class="cp-card__head">';
    head += '  <span class="cp-card__titles">';
    head += '    <span class="cp-card__title">' + escape(o.title) + '</span>';
    if (o.subtitle) head += '<span class="cp-card__sub">' + escape(o.subtitle) + '</span>';
    head += '  </span>';
    head += badgesHtml(o.badges);
    head += '</span>';

    var meta = metaHtml(o.meta);

    var body = '';
    if (o.body) {
      var paras = Array.isArray(o.body) ? o.body : [o.body];
      body = '<div class="cp-card__body">';
      for (var i = 0; i < paras.length; i++) body += '<p>' + escape(paras[i]) + '</p>';
      body += '</div>';
    }

    return [
      '<' + tag + ' class="' + cls + '"' + attrs + '>',
      '  <span class="cp-card__top">' + head + '</span>',
      '  ' + meta,
      '  ' + body,
      '  ' + actionsHtml(o.actions),
      '</' + tag + '>'
    ].join('');
  }

  /* ---------------- 列表 ----------------
     opts:
       title    组标题（可选）
       items    [{ title, subtitle, badges, meta, body, action, id, checked, accent }]
       empty    空状态文案（items 为空时显示，默认「暂无内容」）
       divider  true = 行间带分隔线
       dense    true = 行内边距收紧
   */
  function listHtml(opts) {
    var o = opts || {};
    var items = Array.isArray(o.items) ? o.items : [];

    var head = '';
    if (o.title) {
      head = '<div class="cp-list__head"><span class="cp-list__title">' + escape(o.title) + '</span>' +
        '<span class="cp-list__count">' + items.length + '</span></div>';
    }

    var cls = 'cp-list' + (o.divider ? ' cp-list--divider' : '') + (o.dense ? ' cp-list--dense' : '');

    if (!items.length) {
      return head + '<div class="' + cls + '"><p class="cp-list__empty">' + escape(o.empty || '暂无内容') + '</p></div>';
    }

    var rows = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var clickable = !!it.action;
      var tag = clickable ? 'button' : 'div';
      var attrs = clickable
        ? ' type="button" data-action="' + escape(it.action) + '"' + (it.id ? ' data-id="' + escape(it.id) + '"' : '')
        : '';
      var rowCls = 'cp-row' + (clickable ? ' cp-row--tappable' : '') + (it.accent ? ' cp-row--accent' : '');

      var check = it.checked !== undefined
        ? '<input type="checkbox" class="cp-check"' + (it.checked ? ' checked' : '') + ' aria-label="' + escape(it.title) + '">'
        : '';

      rows += [
        '<' + tag + ' class="' + rowCls + '"' + attrs + '>',
        '  ' + check,
        '  <span class="cp-row__main">',
        '    <span class="cp-row__line">',
        '      <span class="cp-row__title">' + escape(it.title) + '</span>',
        badgesHtml(it.badges),
        '    </span>',
        it.subtitle ? '<span class="cp-row__sub">' + escape(it.subtitle) + '</span>' : '',
        metaHtml(it.meta),
        '  </span>',
        it.trailing ? '<span class="cp-row__trail">' + escape(it.trailing) + '</span>' : '',
        '</' + tag + '>'
      ].join('');
    }

    return head + '<div class="' + cls + '">' + rows + '</div>';
  }

  return {
    escape: escape,
    highlightTags: highlightTags,
    cardHtml: cardHtml,
    listHtml: listHtml
  };
})();
