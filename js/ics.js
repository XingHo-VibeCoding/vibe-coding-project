/* ============================================================
   ics.js —— 导出层（TECH_DESIGN §4.1）
   职责：生成 .ics 日历文件、触发下载。
   Day 7 第⑤步：真实实现。
   提醒提前量固定 15 分钟（PRD F9 / A9）。
   .ics 规范要点：行尾必须 CRLF；时间用本地浮动时间（无时区后缀），
   导入方（手机系统日历）按本地时间解释，与用户直觉一致。
   ============================================================ */

window.Ics = (function () {
  'use strict';

  var REMIND_MINUTES = 15; // PRD F9：课前 15 分钟

  /* ---------------- 小工具 ---------------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* .ics 文本转义：反斜杠、分号、逗号、换行（RFC 5545 §3.3.11） */
  function escText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  /* Date + 'HH:mm' → 'YYYYMMDDTHHMMSS'（本地浮动时间） */
  function icsStamp(date) {
    return pad2(date.getFullYear()) + pad2(date.getMonth() + 1) + pad2(date.getDate()) +
           'T' + pad2(date.getHours()) + pad2(date.getMinutes()) + pad2(date.getSeconds());
  }

  /* 当前时刻的 UTC 时间戳（DTSTAMP 规范要求 Z 结尾） */
  function icsStampNow() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  /* 学期第 weekNo 周里「星期 weekday」的日期（锚点 = 第一周周一） */
  function courseDate(semester, weekNo, weekday) {
    var d = Rules.parseDate(semester && semester.first_monday);
    if (!d) return null;
    d.setDate(d.getDate() + (weekNo - 1) * 7 + (weekday - 1));
    return d;
  }

  /* ---------------- 单个事件的 .ics 片段 ---------------- */

  function vevent(uid, date, startTime, duration, summary, location, description) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(startTime || ''));
    var hh = m ? Number(m[1]) : 0;
    var mm = m ? Number(m[2]) : 0;

    var start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm, 0);
    var end = new Date(start.getTime() + Number(duration || 0) * 60000); // 可能跨 0 点

    var lines = [
      'BEGIN:VEVENT',
      'UID:' + escText(uid),
      'DTSTAMP:' + icsStampNow(),
      'DTSTART:' + icsStamp(start),
      'DTEND:' + icsStamp(end)
    ];

    if (summary) lines.push('SUMMARY:' + escText(summary));
    if (location) lines.push('LOCATION:' + escText(location));
    if (description) lines.push('DESCRIPTION:' + escText(description));

    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT' + REMIND_MINUTES + 'M',
      'DESCRIPTION:' + escText(summary || '日程提醒'),
      'END:VALARM',
      'END:VEVENT'
    );
    return lines;
  }

  /* ---------------- 生成 .ics 全文 ---------------- */

  /* schedules: Store 里的 schedules 表；semester: 学期对象
     课程（type=course）按周次规则逐周展开；独立日程（type=event）展开为单次事件 */
  function build(schedules, semester) {
    var list = Array.isArray(schedules) ? schedules : [];
    var total = semester && Number(semester.total_weeks) ? Number(semester.total_weeks) : 0;

    var out = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//sched-local//大学生日程助手//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];
    if (semester && semester.name) {
      out.push('X-WR-CALNAME:' + escText(semester.name));
    }

    var count = 0;

    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s) continue;

      if (s.type === 'course') {
        if (!total || !semester) continue; // 没有学期锚点，课程无法换算日期

        for (var w = 1; w <= total; w++) {
          if (!Rules.matchWeek(s, w)) continue;
          var d = courseDate(semester, w, Number(s.weekday));
          if (!d) continue;

          var loc = s.location ? (semester.name + ' 第' + w + '周 · ' + s.location) : '';
          var desc = s.note || '';
          Array.prototype.push.apply(out, vevent(
            s.id + '-' + Rules.dateKey(d) + '@sched-local',
            d, s.start_time, s.duration, s.title, loc, desc
          ));
          count++;
        }
      } else if (s.type === 'event') {
        var ed = Rules.parseDate(s.date);
        if (!ed) continue;
        Array.prototype.push.apply(out, vevent(
          s.id + '@sched-local',
          ed, s.start_time, s.duration, s.title, s.location, s.note
        ));
        count++;
      }
    }

    out.push('END:VCALENDAR');

    if (!count) return ''; // 没有可导出的日程，调用方据此提示
    return out.join('\r\n') + '\r\n';
  }

  /* ---------------- 下载 ---------------- */

  /* Blob + <a download> 触发浏览器下载 */
  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    REMIND_MINUTES: REMIND_MINUTES,
    build: build,
    download: download
  };
})();
