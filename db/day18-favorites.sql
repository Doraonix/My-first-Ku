-- Day 18 板块①：创建空收藏表，供验证 CloudBase 用户 UID 后的 POST 使用。
-- 板块①编写时尚未执行；后续人工操作和实际验收结果见 README.md、api-contract.md。
-- 下面的“应为”是核对标准，不是重跑授权；已存在表时不要重新执行创建语句。
-- 管理员先选择 doraonix 环境；所有语句按编号一次执行一条。
-- 任一语句报错或核对结果不符，即停止、保留结果，不重复执行或覆盖已有配置。
-- 先完成 1、2 的只读前置核对，再执行 3–6；全部核对通过前不要部署收藏路由。
--
-- user_id 是经 CloudBase 身份服务核验的外部 UID，不是 PostgreSQL 登录角色，
-- 因此不建立 auth.users 外键。API 必须验证请求身份且 UID 与 user_id 一致。
-- service_role 是已有的高权限内部身份，BYPASSRLS 会绕过本表 RLS；
-- 用户归属由云函数的身份核验、固定 SQL 和已验 UID 保障，不能让浏览器选择角色。
-- 本文件不创建角色、不修改既有两表/策略、不开放匿名收藏策略、不插入测试资料。

-- 1. 管理员只读确认所在数据库/身份，以及 public.favorites 不存在。
-- favorites_table 应为 NULL；不是 NULL 时停止，不删除、不覆盖该表。
SELECT current_database() AS database_name,
       current_user AS active_role,
       to_regclass('public.favorites') AS favorites_table;

-- 2. 管理员只读确认三个已有角色都在，且下列 service_role 条件全部为 true。
-- API 数据库账号沿用 Day 17 实际返回的 cloudbase_postgres_postgres_c8t0z5ym；
-- pg_has_role(..., 'SET') 核对的是该账号切换权限，不是管理员自身切换权限。
-- 未返回 service_role 那一行，或任何条件为 false/NULL，都先停止并核对现有配置。
-- 不在这里新建角色、授予角色成员资格或补 recipes 权限。
SELECT r.rolname,
       r.rolbypassrls AS bypass_rls,
       CASE WHEN r.rolname = 'service_role' THEN
           pg_has_role('cloudbase_postgres_postgres_c8t0z5ym', r.oid, 'SET')
       END AS api_account_can_set,
       CASE WHEN r.rolname = 'service_role' THEN
           has_schema_privilege(r.oid, 'public', 'USAGE')
       END AS public_usage,
       CASE WHEN r.rolname = 'service_role' THEN
           has_table_privilege(r.oid, 'public.recipes', 'SELECT')
       END AS recipes_select
FROM pg_roles AS r
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY r.rolname;

-- 3. 创建空表。相同 UID 与菜品只能有一行；重复 INSERT 会由主键拒绝。
-- UID 仅允许 1–128 个 ASCII 字母、数字、下划线或连字符，与 API 校验一致。
-- COLLATE "C" 让字母范围按 ASCII 比较，避免数据库区域设置扩大允许字符。
CREATE TABLE public.favorites (
    user_id text NOT NULL,
    recipe_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT favorites_pkey PRIMARY KEY (user_id, recipe_id),
    CONSTRAINT favorites_user_id_format CHECK (
        user_id COLLATE "C" ~ '^[A-Za-z0-9_-]{1,128}$'
    ),
    CONSTRAINT favorites_recipe_id_fkey FOREIGN KEY (recipe_id)
        REFERENCES public.recipes (id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- 4. 启用 RLS，不添加任何允许 anon/authenticated 直接访问收藏行的策略。
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- 5. 清除本次新表可能从默认授权获得的四类直接权限，仅作用于 favorites。
-- REVOKE 不保证清除从其他角色继承的有效权限，所以还必须执行第 7 项读回。
REVOKE ALL PRIVILEGES ON TABLE public.favorites
FROM PUBLIC, anon, authenticated, service_role;

-- 6. 只向内部 service_role 授予本表 SELECT、INSERT，不授予 UPDATE/DELETE。
GRANT SELECT, INSERT ON TABLE public.favorites TO service_role;

-- 7. 管理员逐项核对有效权限：四行，不把逗号组合权限当作“全部满足”。
-- public、anon、authenticated：四项都应为 false。
-- service_role：SELECT/INSERT 应为 true；UPDATE/DELETE 应为 false。
-- 如有非预期有效权限，停止并报告继承/默认授权现状；不要自行改其他表或角色。
SELECT identity_name,
       has_table_privilege(identity_name::name, 'public.favorites', 'SELECT') AS can_select,
       has_table_privilege(identity_name::name, 'public.favorites', 'INSERT') AS can_insert,
       has_table_privilege(identity_name::name, 'public.favorites', 'UPDATE') AS can_update,
       has_table_privilege(identity_name::name, 'public.favorites', 'DELETE') AS can_delete
FROM (VALUES ('public'), ('anon'), ('authenticated'), ('service_role'))
     AS identities(identity_name)
ORDER BY identity_name;

-- 8. 管理员只读核对本表已启用 RLS：应返回一行、rls_enabled=true。
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'favorites';

-- 9. 管理员只读核对本表没有公开策略：应返回 0 行。
SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'favorites'
ORDER BY policyname;

-- 10. 管理员只读核对三列类型、非空与 created_at 的 CURRENT_TIMESTAMP 默认值。
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'favorites'
ORDER BY ordinal_position;

-- 11. 管理员只读核对主键、UID CHECK 与 recipes 外键及 RESTRICT 行为。
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.favorites'::regclass
ORDER BY conname;

-- 12. 管理员读回收藏行。首次建表应为空；真实 POST 后再核对 UID、菜品与时间。
-- 此查询是管理员结果，不单独证明 API 身份或浏览器访问限制通过。
SELECT user_id, recipe_id, created_at
FROM public.favorites
ORDER BY created_at DESC, user_id, recipe_id
LIMIT 5;
