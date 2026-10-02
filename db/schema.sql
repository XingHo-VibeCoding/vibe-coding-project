-- ============================================================
-- 大学生日程助手 · 后端建表脚本（Day 16）—— PostgreSQL 版
-- 字段来源：TECH_DESIGN.md §3「数据对象及字段」（一期数据模型）
-- 跑法：控制台 → 数据库 → SQL 执行窗口，选中库后整体粘贴执行
--
-- 为什么长得跟 MySQL 版不一样（2026-10-02 确认环境只有 PostgreSQL）：
--   1) 去掉 ENGINE=InnoDB / CHARSET=utf8mb4 —— PG 没这语法，建库时选 UTF-8 即可
--   2) 字段注释不支持写在列定义里，全部挪到文件尾的 COMMENT ON
--   3) 索引不能写在 CREATE TABLE 里，单独 CREATE INDEX
--   4) TINYINT(1) → BOOLEAN；TINYINT → SMALLINT；DATETIME → TIMESTAMP
--   5) PG 没有「ON UPDATE CURRENT_TIMESTAMP」，updated_at 的自动更新
--      和 type 取值校验一样放应用层（接口层负责写入）
--   6) 全部带 IF NOT EXISTS / IF EXISTS，整份重复执行不报错
--
-- 三条设计口径（与本地版对齐，别改）：
--   1. 主键沿用本地那套字符串 id（sem_ / sch_ / evt_ / rout_ / todo_ 前缀），
--      不换成自增整数 —— 后端要能原样接住前端导出的 JSON，换了就得做一层映射。
--   2. type / week_rule / source 用 VARCHAR 不加枚举约束：
--      三期已经给 type 加过一次 routine（后面还有 lectures、reviews），
--      加取值就得改表，VARCHAR + 注释把取值写清楚更省事；
--      取值合法性由应用层校验（对应本地版的 validateSchedule）。
--   3. 不加外键，只加索引。云数据库常关外键约束，且写入顺序（先日程后学期）会互相绊住；
--      「schedules.semester_id 必须存在于 semesters.id」由应用层保证。
-- ============================================================

-- ------------------------------------------------------------
-- 1. semesters：学期（周次换算的锚点）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS semesters (
  id           VARCHAR(40)  NOT NULL,
  name         VARCHAR(80)  NOT NULL,
  first_monday DATE         NOT NULL,
  total_weeks  INTEGER      NOT NULL DEFAULT 18,
  periods      JSONB        NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT semesters_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_semesters_first_monday ON semesters (first_monday);

-- ------------------------------------------------------------
-- 2. schedules：日程（课程 / 独立日程 / 固定循环日程，三类共用一张表，靠 type 区分）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
  id            VARCHAR(40)  NOT NULL,
  semester_id   VARCHAR(40)  NULL,
  type          VARCHAR(20)  NOT NULL,
  title         VARCHAR(120) NOT NULL,
  note          VARCHAR(255) NULL,
  location      VARCHAR(120) NULL,
  weekday       SMALLINT     NULL,
  start_time    TIME         NOT NULL,
  duration      INTEGER      NOT NULL,
  week_rule     VARCHAR(10)  NULL,
  date          DATE         NULL,
  color         VARCHAR(20)  NULL,
  manual_edited BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT schedules_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_schedules_semester_type      ON schedules (semester_id, type);
CREATE INDEX IF NOT EXISTS idx_schedules_type_weekday_start ON schedules (type, weekday, start_time);
CREATE INDEX IF NOT EXISTS idx_schedules_date               ON schedules (date);

-- ------------------------------------------------------------
-- 3. todos：待办
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todos (
  id         VARCHAR(40)  NOT NULL,
  title      VARCHAR(200) NOT NULL,
  note       VARCHAR(255) NULL,
  due_date   DATE         NOT NULL,
  done       BOOLEAN      NOT NULL DEFAULT FALSE,
  done_at    TIMESTAMP    NULL,
  source     VARCHAR(20)  NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT todos_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos (due_date);
CREATE INDEX IF NOT EXISTS idx_todos_done_due ON todos (done, due_date);

-- ------------------------------------------------------------
-- 4. 注释（PG 只能用 COMMENT ON，逐字段写清楚，控制台里点开表就能看到）
-- ------------------------------------------------------------
COMMENT ON TABLE semesters IS '学期（周次换算的锚点）';
COMMENT ON COLUMN semesters.id           IS '学期 id，形如 sem_1735689600000';
COMMENT ON COLUMN semesters.name         IS '学期名，如「2026 秋」';
COMMENT ON COLUMN semesters.first_monday IS '第一周周一日期——周次换算的锚点';
COMMENT ON COLUMN semesters.total_weeks  IS '总周数';
COMMENT ON COLUMN semesters.periods      IS '各节次起止时间表 [{no,start,end}]；NULL=没设置过（回落到默认节次），[]=用户主动删空（两者含义不同，别合并）';
COMMENT ON COLUMN semesters.created_at   IS '创建时间';
COMMENT ON COLUMN semesters.updated_at   IS '最后更新时间（由应用层写入）';

COMMENT ON TABLE schedules IS '日程（课程/独立日程/循环日程）';
COMMENT ON COLUMN schedules.id            IS '日程 id，sch_ / evt_ / rout_ 前缀';
COMMENT ON COLUMN schedules.semester_id   IS '所属学期；event 可空、routine 跨学期常驻也为空';
COMMENT ON COLUMN schedules.type          IS 'course=课程 / event=独立日程 / routine=固定循环日程';
COMMENT ON COLUMN schedules.title         IS '名称（课程名 / 日程名）';
COMMENT ON COLUMN schedules.note          IS '备注';
COMMENT ON COLUMN schedules.location      IS '教室 / 地点';
COMMENT ON COLUMN schedules.weekday       IS '1=周一 … 7=周日；course / routine 必填，event 为 NULL';
COMMENT ON COLUMN schedules.start_time    IS '开始时间';
COMMENT ON COLUMN schedules.duration      IS '持续时长（分钟）；结束时间 = start_time + duration，不单独存';
COMMENT ON COLUMN schedules.week_rule     IS 'every / odd / even；course / routine 用，event 为 NULL';
COMMENT ON COLUMN schedules.date          IS '独立日程的具体日期；event 必填，其余为 NULL';
COMMENT ON COLUMN schedules.color         IS '视觉标识色';
COMMENT ON COLUMN schedules.manual_edited IS '手动改过则重新导入课表时不覆盖（为 AI 识别预留）';
COMMENT ON COLUMN schedules.created_at    IS '创建时间';
COMMENT ON COLUMN schedules.updated_at    IS '最后更新时间（由应用层写入）';

COMMENT ON TABLE todos IS '待办';
COMMENT ON COLUMN todos.id         IS '待办 id，形如 todo_1735689600000';
COMMENT ON COLUMN todos.title      IS '标题';
COMMENT ON COLUMN todos.note       IS '备注';
COMMENT ON COLUMN todos.due_date   IS '截止日期（决定它出现在哪一天）';
COMMENT ON COLUMN todos.done       IS '是否完成';
COMMENT ON COLUMN todos.done_at    IS '完成时间（供后续复盘用）';
COMMENT ON COLUMN todos.source     IS '来源：manual / lecture / review（一期固定 manual，为二期录音纪要与五期复盘预留）';
COMMENT ON COLUMN todos.created_at IS '创建时间';
COMMENT ON COLUMN todos.updated_at IS '最后更新时间（由应用层写入）';
