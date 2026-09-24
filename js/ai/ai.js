/* ============================================================
   ai.js —— AI 课表识别模块 · 解析层（TECH_DESIGN §「将来新增文件」约定：AI 代码进 js/ai/）
   职责：把「AI 返回的原始文本」解析成规范课程候选数组。
   分层（设计方案「规则优先，AI 兜底」）：
     ① 接口层（recognizeRaw，后接）：原始输入 → AI 原始文本。现在是桩，见 mock。
     ② 解析层（本文件 parseCourses，纯函数）：AI 原始文本 → 课程候选。规则实现，零 AI。
     ③ 确认层（后接）：候选 → 预览确认 → Store.saveSchedule 入库。
   铁律：本文件不碰 DOM、不碰 localStorage（与 rules.js 同级纯函数）。
   课程候选形状与 Store 的 schedules 表（type='course'）对齐：
     { title, weekday(1-7), start_time('HH:mm'), duration(分钟),
       week_rule('every'|'odd'|'even'), location, note, manual_edited:false }
   ============================================================ */

window.Ai = (function () {
  'use strict';

  /* ---------------- 小工具 ---------------- */

  function pad2(n) { n = Number(n); return (n < 10 ? '0' : '') + n; }

  function timeToMin(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
  }

  function minToTime(m) {
    m = Math.round(Number(m));
    if (!(m >= 0 && m < 1440)) return null;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  /* 容错取值：按候选键名顺序取第一个非空值（AI 的键名不稳定，多备几个别名） */
  function pick(o, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = o ? o[keys[i]] : undefined;
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return undefined;
  }

  /* ---------------- ① 从原始文本里抠出 JSON ----------------
     AI 实际返回常常带说明文字、```json 栅栏、前后废话，这里统一剥掉。 */

  function extractJson(raw) {
    var text = String(raw || '').trim();

    var fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    if (fence) text = fence[1].trim();

    var a = text.indexOf('['), b = text.lastIndexOf(']');
    var o = text.indexOf('{'), p = text.lastIndexOf('}');

    /* 数组和对象都可能：先试起始符更靠前的切法，解析失败再换另一种
       （说明文字里可能混着花括号/方括号，一种切法不代表全局） */
    var arr = (a >= 0 && b > a) ? text.slice(a, b + 1) : null;
    var obj = (o >= 0 && p > o) ? text.slice(o, p + 1) : null;
    var first = null, second = null;
    if (arr && obj) {
      if (a < o) { first = arr; second = obj; } else { first = obj; second = arr; }
    } else {
      first = arr || obj;
    }

    var err;
    if (first) { try { return JSON.parse(first); } catch (e) { err = e; } }
    if (second) { try { return JSON.parse(second); } catch (e) { err = e; } }
    throw err || new Error('no json');
  }

  /* 返回课程条目数组；结构不对返回 null */
  function shapeItems(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      var keys = ['courses', 'schedules', 'data', 'list', 'result'];
      for (var i = 0; i < keys.length; i++) {
        if (Array.isArray(data[keys[i]])) return data[keys[i]];
      }
      /* 单个课程对象也接受 */
      if (pick(data, ['title', 'name', '课程', '课程名']) !== undefined) return [data];
    }
    return null;
  }

  /* ---------------- ② 星期：各种写法 → 1-7 ---------------- */

  var WEEK_CN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

  function normWeekdayOne(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') {
      if (v >= 1 && v <= 7) return v;
      if (v === 0) return 7; // 部分系统 0 表示周日
      return null;
    }
    var s = String(v).trim();
    if (!s) return null;
    if (/^\d$/.test(s)) return normWeekdayOne(Number(s));
    var m = /(?:周|星期)\s*([一二三四五六日天])/.exec(s);
    if (m) return WEEK_CN[m[1]];
    if (/^[一二三四五六日天]$/.test(s)) return WEEK_CN[s];
    return null;
  }

  /* 星期字段可能是数组、"周一、周三"、"周一到周五"、"1,3"、"1-3"，统一展开成去重的 1-7 列表 */
  function normWeekdayList(v) {
    if (v === null || v === undefined) return [];
    var out = [];
    function push(n) {
      if (n >= 1 && n <= 7 && out.indexOf(n) < 0) out.push(n);
    }

    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) {
        var n = normWeekdayOne(v[i]);
        if (n) push(n);
      }
      return out.sort(function (x, y) { return x - y; });
    }

    var s = String(v).trim();
    if (!s) return [];

    /* 中文范围：周一到周五（「到」后面可能还带「周」/「星期」字样） */
    var m = /([一二三四五六日天])\s*(?:到|至|～|~|—|–|-)\s*(?:周|星期)?\s*([一二三四五六日天])/.exec(s);
    if (m) {
      var w1 = WEEK_CN[m[1]], w2 = WEEK_CN[m[2]];
      if (w1 && w2) {
        var lo = Math.min(w1, w2), hi = Math.max(w1, w2);
        for (var k = lo; k <= hi; k++) push(k);
        return out;
      }
    }

    /* 按分隔符切开，逐段识别（段里可能还有数字范围 1-3） */
    var parts = s.split(/[、,，\/;；\s]+/);
    for (var j = 0; j < parts.length; j++) {
      var seg = parts[j];
      if (!seg) continue;
      var one = normWeekdayOne(seg);
      if (one) { push(one); continue; }
      var rn = /^(\d)\s*[-–—~]\s*(\d)$/.exec(seg);
      if (rn) {
        var a = Number(rn[1]), b = Number(rn[2]);
        var lo2 = Math.min(a, b), hi2 = Math.max(a, b);
        for (var t = lo2; t <= hi2; t++) push(normWeekdayOne(t));
      }
    }
    return out.sort(function (x, y) { return x - y; });
  }

  /* ---------------- ③ 时间：各种写法 → 'HH:mm' ---------------- */

  function normTimeStr(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    if (!s) return null;

    var m = /^(\d{1,2})\s*[:：]\s*(\d{1,2})\s*分?$/.exec(s);
    if (m) {
      var hh = Number(m[1]), mm = Number(m[2]);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return pad2(hh) + ':' + pad2(mm);
      return null;
    }
    /* 「8点」「8点05」 */
    m = /^(\d{1,2})\s*点\s*(\d{1,2})?\s*分?$/.exec(s);
    if (m) {
      hh = Number(m[1]); mm = m[2] ? Number(m[2]) : 0;
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return pad2(hh) + ':' + pad2(mm);
    }
    return null;
  }

  /* 「08:00-09:40」区间串 → {start, end} */
  function normTimeRange(v) {
    var s = String(v || '').trim();
    var m = /^(\d{1,2}\s*[:：]\s*\d{1,2})\s*[-–—~至]\s*(\d{1,2}\s*[:：]\s*\d{1,2})$/.exec(s);
    if (!m) return null;
    var st = normTimeStr(m[1]), en = normTimeStr(m[2]);
    if (!st || !en) return null;
    return { start: st, end: en };
  }

  function normDuration(v) {
    if (v === null || v === undefined) return null;
    var m = /^(\d{1,3})\s*(?:分钟|分|min|mins)?$/i.exec(String(v).trim());
    if (!m) return null;
    var n = Number(m[1]);
    return (n > 0 && n <= 600) ? n : null;
  }

  /* ---------------- ④ 节次 → 时间（用学期节次表换算，规则优先） ---------------- */

  /* 「3」「3-4」「第3节」「第3-4节」→ {start:no, end:no}；解析不了返回 null */
  function parseSectionRef(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') {
      return (v >= 1 && v <= 15) ? { start: v, end: v } : null;
    }
    var s = String(v).trim();
    var m = /^第?\s*(\d{1,2})\s*(?:[-–—~至]\s*(\d{1,2}))?\s*节?$/.exec(s);
    if (!m) return null;
    var a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (!(a >= 1 && a <= 15 && b >= 1 && b <= 15)) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  /* 按节次表把「第 s 到第 e 节」换算成开始时间 + 时长；换算不了返回 null */
  function sectionToTime(s, e, periodMap) {
    var pa = periodMap[s], pb = periodMap[e];
    if (!pa || !pb) return null;
    var sm = timeToMin(pa.start), em = timeToMin(pb.end);
    if (!(em > sm)) return null;
    return { start_time: minToTime(sm), duration: em - sm };
  }

  function buildPeriodMap(periods) {
    var map = {};
    if (Array.isArray(periods)) {
      for (var i = 0; i < periods.length; i++) {
        var p = periods[i];
        if (p && Number(p.no) >= 1) map[Number(p.no)] = p;
      }
    }
    return map;
  }

  /* ---------------- ⑤ 周次规则 → every | odd | even ---------------- */

  function normWeekRule(v, warns) {
    if (v === null || v === undefined) return 'every';
    var s = String(v).trim();
    if (!s) return 'every';

    if (/单/.test(s) || /odd/i.test(s)) return 'odd';
    if (/双/.test(s) || /even/i.test(s)) return 'even';
    if (/每周|every|all/i.test(s)) return 'every';

    /* 剩下的当数字列表/范围看：全奇 → 单周，全偶 → 双周，混着 → 每周 + 提醒 */
    var nums = [], m, re = /\d{1,2}/g;
    while ((m = re.exec(s))) nums.push(Number(m[0]));
    if (!nums.length) return 'every';

    /* 连续范围（1-16 / 1-16周）：本意就是「每周」，不打扰用户 */
    if (/^\s*\d{1,2}\s*[-–—~]\s*\d{1,2}\s*(?:周|周次)?\s*$/.test(s)) return 'every';

    var allOdd = true, allEven = true;
    for (var i = 0; i < nums.length; i++) {
      if (nums[i] % 2 === 0) allOdd = false; else allEven = false;
    }
    if (allOdd) return 'odd';
    if (allEven) return 'even';

    if (warns) warns.push('周次「' + s + '」单双周混排，本期按「每周」导入，请在确认页核对。');
    return 'every';
  }

  /* ---------------- ⑥ 单条课程归一化 ----------------
     输入：AI 给的一个课程对象 + 节次表
     输出：{ ok:true, list:[候选...], warns:[...] } 或 { ok:false, reason:'...' } */

  function normOne(item, periodMap) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: '不是课程对象' };
    }

    var warns = [];

    /* 课程名 */
    var title = pick(item, ['title', 'name', 'course', '课程', '课程名', 'subject']);
    title = title === undefined ? '' : String(title).trim();
    if (!title) return { ok: false, reason: '缺少课程名' };

    /* 星期 */
    var weekdays = normWeekdayList(pick(item, ['weekday', 'week_day', 'day', '星期', '周']));
    if (!weekdays.length) return { ok: false, reason: '缺少星期' };

    /* 时间：节次 > 开始+结束 > 区间串 > 开始+时长 */
    var time = null;

    var secVal = null;
    var ss = item.section_start !== undefined ? item.section_start : item.start_section;
    var se = item.section_end !== undefined ? item.section_end : item.end_section;
    if (ss !== undefined && ss !== null) {
      var a = parseSectionRef(ss), b = parseSectionRef(se !== undefined ? se : ss);
      if (a && b) secVal = { start: a.start, end: b.end };
    }
    if (!secVal) {
      var secStr = pick(item, ['sections', 'section', 'period_no', '节次']);
      if (secStr !== undefined) secVal = parseSectionRef(secStr);
    }

    if (secVal) {
      time = sectionToTime(secVal.start, secVal.end, periodMap);
      if (!time) return { ok: false, reason: '按节次给出但节次表里没有对应的节（第' + secVal.start + '–' + secVal.end + '节）' };
    } else {
      var startV = pick(item, ['start_time', 'start', 'begin', '开始', 'startTime']);
      var endV = pick(item, ['end_time', 'end', 'finish', '结束', 'endTime']);
      var durV = normDuration(pick(item, ['duration', '时长', 'length']));

      var range = normTimeRange(startV);
      if (range) { startV = range.start; endV = range.end; }

      var st = normTimeStr(startV);

      if (st && endV !== undefined) {
        var en = normTimeStr(endV);
        if (!en) return { ok: false, reason: '结束时间格式不认识：' + endV };
        var sm = timeToMin(st), em = timeToMin(en);
        if (!(em > sm)) return { ok: false, reason: '结束时间不晚于开始时间' };
        time = { start_time: st, duration: em - sm };
      } else if (st && durV) {
        time = { start_time: st, duration: durV };
      } else {
        return { ok: false, reason: '缺少可识别的时间信息' };
      }
    }

    /* 周次规则 */
    var weekRule = normWeekRule(pick(item, ['weeks', 'week_rule', 'weekrule', '周次', '单双周']), warns);

    /* 地点 / 备注 / 教师（没有教师字段，并进备注） */
    var location = pick(item, ['location', 'room', 'place', '教室', '地点', 'campus']);
    location = location === undefined ? '' : String(location).trim();
    var note = pick(item, ['note', 'remark', '备注']);
    note = note === undefined ? '' : String(note).trim();
    var teacher = pick(item, ['teacher', '教师', '老师', 'instructor']);
    if (teacher !== undefined) {
      var t = '任课：' + String(teacher).trim();
      note = note ? (note + '；' + t) : t;
    }

    /* 一个课程对象上多个星期 → 展开成多条候选 */
    var list = [];
    for (var i = 0; i < weekdays.length; i++) {
      list.push({
        title: title,
        weekday: weekdays[i],
        start_time: time.start_time,
        duration: time.duration,
        week_rule: weekRule,
        location: location,
        note: note,
        manual_edited: false
      });
    }
    return { ok: true, list: list, warns: warns };
  }

  /* ============================================================
     主入口：parseCourses(raw, opts)
     raw   —— AI 返回的原始文本（可以是带栅栏/说明文字的 JSON）
     opts  —— { periods: semester.periods }（AI 按「第几节」给时间时必传）
     返回：
       { ok:false, error, raw }                       —— 整体不可解析
       { ok:true, courses:[候选], skipped:[...], warnings:[...] }
     skipped 每条：{ index, reason, raw }（只跳过坏行，不整体失败）
     ============================================================ */

  function parseCourses(raw, opts) {
    opts = opts || {};
    var periodMap = buildPeriodMap(opts.periods);

    var data;
    try {
      data = extractJson(raw);
    } catch (e) {
      return { ok: false, error: 'AI 返回内容里没有可识别的结构化数据（JSON）。', raw: String(raw || '') };
    }

    var items = shapeItems(data);
    if (items === null) {
      return { ok: false, error: 'AI 返回的 JSON 不是课程列表。', raw: String(raw || '') };
    }

    var courses = [], skipped = [], warnings = [];

    for (var i = 0; i < items.length; i++) {
      var r = normOne(items[i], periodMap);
      if (!r.ok) {
        skipped.push({
          index: i,
          reason: r.reason,
          raw: JSON.stringify(items[i]).slice(0, 100)
        });
        continue;
      }
      for (var w = 0; w < r.warns.length; w++) {
        if (warnings.indexOf(r.warns[w]) < 0) warnings.push(r.warns[w]);
      }
      for (var c = 0; c < r.list.length; c++) courses.push(r.list[c]);
    }

    return { ok: true, courses: courses, skipped: skipped, warnings: warnings };
  }

  /* ============================================================
     ① 接口层（现在是指令桩，接真 API 时只换这个函数）
     真实实现（TECH_DESIGN §7：key 只存中转服务端，绝不进前端）：
       fetch(AI_ENDPOINT, { method:'POST', body: … }) → 中转服务 → 多模态大模型
       → 返回「原始文本」（可能带栅栏 / 说明文字），交给 parseCourses。
     桩的行为：忽略输入，轮换返回内置样例文本；故意带 ```json 栅栏、
     说明废话、坏行、节次写法，和真模型的输出一个脾气，用来把
     解析层 → 确认层整条管道先养起来。
     ============================================================ */

  var SAMPLES = [
    '识别结果如下，请人工核对：\n```json\n' + JSON.stringify([
      { name: '高等数学', weekday: '周一', start_time: '08:00', end_time: '09:40', weeks: '1-16', location: '教一 101', teacher: '张三' },
      { title: '大学英语', weekday: [3], sections: '3-4节', weeks: '单周', location: '文B 202' },
      { name: '数据结构', weekday: '周二', start_time: '10:10', end_time: '11:55', weeks: '每周', location: '实验楼 304' },
      { course: '体育', day: '星期五', start: '14:00', duration: '90分钟', weeks: '2-16(双)', location: '田径场' },
      { name: '', weekday: '周一', start_time: '08:00', end_time: '09:40' }
    ], null, 2) + '\n```\n以上内容如有看不清的地方，请在确认页修改。',
    '好的，这是我从课表里提取的课程：\n' + JSON.stringify({
      courses: [
        { name: '大学物理', weekday: '周一、周四', start_time: '14:00', end_time: '15:40', weeks: '1-16', location: '教三 201' },
        { name: '思想道德与法治', weekday: '周四', sections: '6-7', weeks: '每周' },
        { name: '看不清的课程', weekday: '周六', start_time: '25:00', end_time: '26:00' }
      ]
    }, null, 2)
  ];

  function recognizeRaw(input, opts) {
    opts = opts || {};
    var i = typeof opts.sample === 'number' ? opts.sample : Math.floor(Math.random() * SAMPLES.length);
    var text = SAMPLES[i] || SAMPLES[0];
    return Promise.resolve(text);
  }

  /* 供测试脚本深入检查内部函数（不影响正常使用） */
  var _t = {
    extractJson: extractJson,
    shapeItems: shapeItems,
    normWeekdayOne: normWeekdayOne,
    normWeekdayList: normWeekdayList,
    normTimeStr: normTimeStr,
    normTimeRange: normTimeRange,
    normDuration: normDuration,
    parseSectionRef: parseSectionRef,
    sectionToTime: sectionToTime,
    normWeekRule: normWeekRule,
    normOne: normOne
  };

  return { parseCourses: parseCourses, recognizeRaw: recognizeRaw, _t: _t };
})();
