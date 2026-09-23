/* ============================================================
   mock.js —— 示例数据（Day 8 · mock 数据渲染）
   职责：提供一套假数据，供「空状态」下的示例预览渲染。
   纪律：mock 数据只用于展示，绝不写入 Store（store.js 仍是唯一闸门）。
   第 3 周接真实 API 时，本文件由真实数据源替代。
   ============================================================ */

window.Mock = (function () {
  'use strict';

  /* 今天 + n 天的日期键（让示例待办永远「快到期」，演示效果稳定） */
  function dateKeyAfter(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  var courses = [
    { id: 'mock_c1', type: 'course', title: '高等数学', weekday: 1, start_time: '08:00', duration: 90, week_rule: 'every', location: 'A101' },
    { id: 'mock_c2', type: 'course', title: '大学英语', weekday: 2, start_time: '10:00', duration: 90, week_rule: 'odd',  location: 'B202' },
    { id: 'mock_c3', type: 'course', title: '数据结构', weekday: 3, start_time: '14:00', duration: 90, week_rule: 'every', location: 'C303' },
    { id: 'mock_c4', type: 'course', title: '体育',     weekday: 4, start_time: '16:00', duration: 45, week_rule: 'even', location: '田径场' },
    { id: 'mock_c5', type: 'course', title: '大学物理', weekday: 5, start_time: '10:00', duration: 90, week_rule: 'every', location: 'D404' }
  ];

  var todos = [
    { id: 'mock_t1', title: '完成高数作业第 3 章',   due_date: dateKeyAfter(0), done: false },
    { id: 'mock_t2', title: '准备英语口语展示',       due_date: dateKeyAfter(2), done: false },
    { id: 'mock_t3', title: '交数据结构实验报告',     due_date: dateKeyAfter(-1), done: true }
  ];

  return {
    courses: courses,
    todos: todos
  };
})();
