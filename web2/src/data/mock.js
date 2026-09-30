// 概念版示例数据——形态对齐主项目的学期/课程/待办概念，先假后真

export const semester = {
  name: '2026 秋季学期',
  week: 4,
  totalWeeks: 18,
}

export const courses = [
  { id: 1, name: '高等数学', teacher: '张明', location: '教三 302', start: '08:00', end: '09:40', tag: '必修' },
  { id: 2, name: '大学英语', teacher: '李芳', location: '外语楼 205', start: '10:00', end: '11:40', tag: '必修' },
  { id: 3, name: '数据结构', teacher: '王强', location: '机房 401', start: '14:00', end: '15:40', tag: '专业' },
  { id: 4, name: '体育（羽毛球）', teacher: '刘洋', location: '体育馆', start: '16:00', end: '17:10', tag: '公体' },
]

export const todos = [
  { id: 1, title: '高数作业：第三章习题 1-10', due: '今天', done: false },
  { id: 2, title: '英语口语小组展示准备', due: '今天', done: true },
  { id: 3, title: '数据结构实验报告提交', due: '明天', done: false },
  { id: 4, title: '归还图书馆书籍', due: '周五', done: false },
]

// 整周课表（weekday: 1=周一 … 7=周日），供周视图使用
export const weekCourses = [
  { id: 11, weekday: 1, name: '高等数学', teacher: '张明', location: '教三 302', start: '08:00', end: '09:40', tag: '必修' },
  { id: 12, weekday: 1, name: '大学英语', teacher: '李芳', location: '外语楼 205', start: '10:00', end: '11:40', tag: '必修' },
  { id: 13, weekday: 1, name: '线性代数', teacher: '赵敏', location: '教二 110', start: '14:00', end: '15:40', tag: '必修' },
  { id: 21, weekday: 2, name: '数据结构', teacher: '王强', location: '机房 401', start: '08:00', end: '09:40', tag: '专业' },
  { id: 22, weekday: 2, name: '高等数学', teacher: '张明', location: '教三 302', start: '10:00', end: '11:40', tag: '必修' },
  { id: 23, weekday: 2, name: '大学物理', teacher: '陈斌', location: '实验楼 203', start: '14:00', end: '15:40', tag: '必修' },
  { id: 31, weekday: 3, name: '大学英语', teacher: '李芳', location: '外语楼 205', start: '08:00', end: '09:40', tag: '必修' },
  { id: 32, weekday: 3, name: '数据结构', teacher: '王强', location: '机房 401', start: '14:00', end: '15:40', tag: '专业' },
  { id: 33, weekday: 3, name: '心理健康', teacher: '孙悦', location: '教一 105', start: '16:00', end: '17:10', tag: '通识' },
  { id: 41, weekday: 4, name: '高等数学', teacher: '张明', location: '教三 302', start: '08:00', end: '09:40', tag: '必修' },
  { id: 42, weekday: 4, name: '大学物理', teacher: '陈斌', location: '实验楼 203', start: '10:00', end: '11:40', tag: '必修' },
  { id: 43, weekday: 4, name: '线性代数', teacher: '赵敏', location: '教二 110', start: '14:00', end: '15:40', tag: '必修' },
  { id: 51, weekday: 5, name: '数据结构', teacher: '王强', location: '机房 401', start: '08:00', end: '09:40', tag: '专业' },
  { id: 52, weekday: 5, name: '大学英语', teacher: '李芳', location: '外语楼 205', start: '10:00', end: '11:40', tag: '必修' },
  { id: 53, weekday: 5, name: '体育（羽毛球）', teacher: '刘洋', location: '体育馆', start: '16:00', end: '17:10', tag: '公体' },
  { id: 61, weekday: 6, name: '创新创业讲座', teacher: '外请', location: '报告厅', start: '10:00', end: '11:40', tag: '选修' },
]
