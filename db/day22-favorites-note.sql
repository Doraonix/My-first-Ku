-- Day 22 板块①：为收藏 GET/PATCH 准备 note 字段及最小更新权限。
-- 已由学员人工分段执行并读回（见 README“Day 22 续”）；note 已存在时会停止，不要重跑，不要整文件一次运行。
-- 管理员确认 doraonix 环境后，按编号一次执行一段；1–5 是只读前置。
-- 前置全部符合预期、本人另行确认后，才执行第 6 段一次，再逐段读回 7–10。
-- 任一结果不符或报错即停止；不要重跑、删除旧记录或自行补授权。
-- 只新增 note 及其约束、只给已有 service_role 授予 UPDATE(note)。
-- 不授予表级 UPDATE/DELETE，不改变 RLS/策略/角色，不插入或删除测试数据。
--
-- note 允许空字符串；最多 200 个 Unicode 码点，不允许 C0/C1 控制字符。
-- PostgreSQL UTF8 text 本身不接受 NUL 或非法 Unicode；CHECK 排除其余控制符。
-- U& 使用四位十六进制 Unicode 转义；COLLATE "C" 固定正则范围的排序规则。
-- 官方语法依据（PostgreSQL 17；本地没有运行 PostgreSQL，未做真实 SQL 验证）：
-- https://www.postgresql.org/docs/17/sql-syntax-lexical.html#SQL-SYNTAX-STRINGS-UESCAPE
-- https://www.postgresql.org/docs/17/functions-matching.html#POSIX-BRACKET-EXPRESSIONS
-- https://www.postgresql.org/docs/17/functions-string.html
-- https://www.postgresql.org/docs/17/sql-grant.html

-- 1. 只读确认：数据库/管理员必须完全一致，UTF8、standard_conforming_strings=on。
-- favorites_table 应为 public.favorites；不要选择其他数据库或 SET ROLE 绕过检查。
SELECT current_database() AS database_name,
       current_user AS active_role,
       current_setting('server_encoding') AS server_encoding,
       current_setting('standard_conforming_strings') AS standard_conforming_strings,
       to_regclass('public.favorites') AS favorites_table;

-- 2. 只读确认：恰好原有三列，note 尚不存在。
-- user_id/recipe_id 为 text、NOT NULL、无默认值；created_at 为 timestamptz、
-- NOT NULL、默认值 CURRENT_TIMESTAMP。若 note 已存在，停止，不重复迁移。
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'favorites'
ORDER BY ordinal_position;

-- 3. 只读确认：原有主键、UID CHECK、指向 public.recipes(id) 的 RESTRICT 外键。
-- 应有三行；任何额外约束、未验证约束或定义变化都先停止并报告。
SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.favorites'::regclass
ORDER BY conname;

-- 4. 只读确认：普通表，RLS=true、强制 RLS=false、策略数=0。
SELECT c.relkind AS relation_kind,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS forced_rls,
       (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid) AS policy_count
FROM pg_class AS c
WHERE c.oid = 'public.favorites'::regclass;

-- 5. 只读确认有效权限，含继承/列级权限，不把管理员权限当成 API 权限。
-- public/anon/authenticated：下列各项全 false。
-- service_role：表 SELECT/INSERT=true，其余 false。
SELECT identity_name,
       has_table_privilege(identity_name::name, 'public.favorites', 'SELECT') AS table_select,
       has_table_privilege(identity_name::name, 'public.favorites', 'INSERT') AS table_insert,
       has_table_privilege(identity_name::name, 'public.favorites', 'UPDATE') AS table_update,
       has_any_column_privilege(identity_name::name, 'public.favorites', 'UPDATE') AS any_column_update,
       has_table_privilege(identity_name::name, 'public.favorites', 'DELETE') AS table_delete
FROM (VALUES ('public'), ('anon'), ('authenticated'), ('service_role'))
     AS identities(identity_name)
ORDER BY identity_name;

-- 6. 唯一写入段：本人确认后，一次完整选择 DO ... $day22_note$; 执行。
-- 单段原子执行：任意检查/ALTER/GRANT 失败，整段回滚；没有 COMMIT 或吞掉错误。
-- NOWAIT 避免在其他请求持锁时等待；遇到锁错误停止，不自动重试。
DO $day22_note$
DECLARE
    v_favorites regclass;
    v_identity name;
    v_rows_before bigint;
BEGIN
    IF current_database() <> 'postgres-c8t0z5ym'
       OR current_user <> 'cloudbase_postgres_postgres_c8t0z5ym' THEN
        RAISE EXCEPTION '停止：数据库或管理员身份不符合 Day 22 迁移要求。';
    END IF;
    IF current_setting('server_encoding') <> 'UTF8'
       OR current_setting('standard_conforming_strings') <> 'on' THEN
        RAISE EXCEPTION '停止：需要 UTF8 与 standard_conforming_strings=on。';
    END IF;

    v_favorites := to_regclass('public.favorites');
    IF v_favorites IS NULL THEN
        RAISE EXCEPTION '停止：public.favorites 不存在，不在本段创建表。';
    END IF;
    LOCK TABLE public.favorites IN ACCESS EXCLUSIVE MODE NOWAIT;

    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = v_favorites AND relkind = 'r' AND relpersistence = 'p'
          AND NOT relispartition AND relrowsecurity AND NOT relforcerowsecurity
          AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
    ) OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_favorites)
      OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = v_favorites OR inhparent = v_favorites) THEN
        RAISE EXCEPTION '停止：表类型、所有者、RLS、策略或继承结构与前置不符。';
    END IF;

    IF (SELECT count(*) FROM pg_attribute WHERE attrelid = v_favorites AND attnum > 0) <> 3
       OR (SELECT count(*) FROM pg_attribute
           WHERE attrelid = v_favorites AND attnum > 0 AND NOT attisdropped
             AND attnotnull AND attidentity = '' AND attgenerated = ''
             AND ((attnum = 1 AND attname = 'user_id' AND atttypid = 'text'::regtype AND NOT atthasdef)
               OR (attnum = 2 AND attname = 'recipe_id' AND atttypid = 'text'::regtype AND NOT atthasdef)
               OR (attnum = 3 AND attname = 'created_at' AND atttypid = 'timestamptz'::regtype AND atthasdef))) <> 3
       OR NOT EXISTS (
           SELECT 1 FROM pg_attrdef
           WHERE adrelid = v_favorites AND adnum = 3
             AND pg_get_expr(adbin, adrelid) = 'CURRENT_TIMESTAMP'
       ) THEN
        RAISE EXCEPTION '停止：原三列结构不符，或 note 已存在；不覆盖、不重跑。';
    END IF;

    IF (SELECT count(*) FROM pg_constraint WHERE conrelid = v_favorites) <> 3
       OR NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conrelid = v_favorites AND conname = 'favorites_pkey' AND contype = 'p'
             AND conkey = ARRAY[1, 2]::smallint[] AND convalidated AND NOT condeferrable
       ) OR NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conrelid = v_favorites AND conname = 'favorites_user_id_format' AND contype = 'c'
             AND conkey = ARRAY[1]::smallint[] AND convalidated
             AND regexp_replace(pg_get_expr(conbin, conrelid), '[[:space:]()]', '', 'g')
                 = 'user_idCOLLATE"C"~''^[A-Za-z0-9_-]{1,128}$''::text'
       ) OR NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conrelid = v_favorites AND conname = 'favorites_recipe_id_fkey' AND contype = 'f'
             AND conkey = ARRAY[2]::smallint[] AND convalidated AND NOT condeferrable
             AND confrelid = to_regclass('public.recipes')
             AND confkey = ARRAY[(SELECT attnum FROM pg_attribute
                                  WHERE attrelid = to_regclass('public.recipes')
                                    AND attname = 'id' AND NOT attisdropped)]::smallint[]
             AND confupdtype = 'r' AND confdeltype = 'r' AND confmatchtype = 's'
       ) THEN
        RAISE EXCEPTION '停止：主键、UID CHECK 或菜品外键与原定义不符。';
    END IF;

    IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls)
       OR NOT pg_has_role(current_user, 'service_role', 'SET')
       OR NOT has_schema_privilege('service_role', 'public', 'USAGE') THEN
        RAISE EXCEPTION '停止：已有内部角色条件不符，不在本段修改角色。';
    END IF;
    FOREACH v_identity IN ARRAY ARRAY['public', 'anon', 'authenticated']::name[] LOOP
        IF has_table_privilege(v_identity, v_favorites, 'SELECT,INSERT,UPDATE,DELETE')
           OR has_any_column_privilege(v_identity, v_favorites, 'SELECT,INSERT,UPDATE') THEN
            RAISE EXCEPTION '停止：身份 % 存在非预期直接收藏权限。', v_identity;
        END IF;
    END LOOP;
    IF NOT has_table_privilege('service_role', v_favorites, 'SELECT')
       OR NOT has_table_privilege('service_role', v_favorites, 'INSERT')
       OR has_table_privilege('service_role', v_favorites, 'UPDATE,DELETE,TRUNCATE')
       OR has_any_column_privilege('service_role', v_favorites, 'UPDATE') THEN
        RAISE EXCEPTION '停止：service_role 原有效权限不符合仅 SELECT/INSERT 的前置。';
    END IF;

    SELECT count(*) INTO v_rows_before FROM public.favorites;
    ALTER TABLE public.favorites ADD COLUMN note text NOT NULL DEFAULT '';
    ALTER TABLE public.favorites ADD CONSTRAINT favorites_note_format CHECK (
        char_length(note) <= 200
        AND note COLLATE "C" !~ U&'[\0001-\001F\007F-\009F]'
    );
    GRANT UPDATE (note) ON TABLE public.favorites TO service_role;

    IF (SELECT count(*) FROM public.favorites) <> v_rows_before
       OR EXISTS (SELECT 1 FROM public.favorites WHERE note <> '')
       OR has_table_privilege('service_role', v_favorites, 'UPDATE,DELETE')
       OR NOT has_column_privilege('service_role', v_favorites, 'note', 'UPDATE')
       OR has_column_privilege('service_role', v_favorites, 'user_id', 'UPDATE')
       OR has_column_privilege('service_role', v_favorites, 'recipe_id', 'UPDATE')
       OR has_column_privilege('service_role', v_favorites, 'created_at', 'UPDATE') THEN
        RAISE EXCEPTION '停止：迁移后行数、默认备注或列级权限不符，整段回滚。';
    END IF;
    RAISE NOTICE 'Day 22 note 迁移完成：原行数 % 保持不变；既有行 note 为空字符串。', v_rows_before;
END;
$day22_note$;

-- 7. 只读确认：原三列不变，新增 note=text、NOT NULL、默认空字符串。
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'favorites'
ORDER BY ordinal_position;

-- 8. 只读确认：原三个约束保留，新增 favorites_note_format，四行全部 validated=true。
SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.favorites'::regclass
ORDER BY conname;

-- 9. 只读确认：只有 service_role 的 note_update=true；原列 UPDATE 与表 DELETE 全 false。
-- service_role 的 table_update=false 是正常的：这里只授予 note 列级权限。
SELECT identity_name,
       has_table_privilege(identity_name::name, 'public.favorites', 'SELECT') AS table_select,
       has_table_privilege(identity_name::name, 'public.favorites', 'INSERT') AS table_insert,
       has_table_privilege(identity_name::name, 'public.favorites', 'UPDATE') AS table_update,
       has_column_privilege(identity_name::name, 'public.favorites', 'note', 'UPDATE') AS note_update,
       has_column_privilege(identity_name::name, 'public.favorites', 'user_id', 'UPDATE') AS user_id_update,
       has_column_privilege(identity_name::name, 'public.favorites', 'recipe_id', 'UPDATE') AS recipe_id_update,
       has_column_privilege(identity_name::name, 'public.favorites', 'created_at', 'UPDATE') AS created_at_update,
       has_table_privilege(identity_name::name, 'public.favorites', 'DELETE') AS table_delete
FROM (VALUES ('public'), ('anon'), ('authenticated'), ('service_role'))
     AS identities(identity_name)
ORDER BY identity_name;

-- 10. 只读确认：RLS 和零策略保持不变；行数与第 6 段 NOTICE 对照，非空备注数应为 0。
-- 这是管理员迁移读回，不是 GET/PATCH API 已上线或身份隔离通过的证据。
SELECT c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS forced_rls,
       (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid) AS policy_count,
       (SELECT count(*) FROM public.favorites) AS favorites_count,
       (SELECT count(*) FROM public.favorites WHERE note <> '') AS nonempty_notes
FROM pg_class AS c
WHERE c.oid = 'public.favorites'::regclass;
