-- Day 17：为公开菜品及材料增加 anon 的行级只读策略。
-- 2026-10-09 实际诊断：两表已启用 RLS；anon 已有 SELECT、无所查表级写权限；
-- Role=anon 查询成功，但可见行数为 0/0，pg_policies 返回空数组。
-- 学员在告知匿名读取范围后回复“继续”；云端执行仍由学员操作。
-- 此策略允许有效 anon 身份读取两表全部行，包括今后新增行；
-- 也适用于其他采用 anon 的 CloudBase 数据入口，不限于自建 GET 接口。
-- 本脚本不新增写权限、不关闭 RLS、不改字段、数据或其他表的策略。
--
-- 操作：在 doraonix 环境的 SQL 编辑器中，保持管理员角色，
-- 按顺序分别执行下面两条 CREATE POLICY（一次一条）。
-- 任一条报错即停止并保留错误；不要循环执行、删除或覆盖已有策略。
-- 已存在同名策略时会报错，本脚本不以 DROP/重建方式掩盖既有配置。

CREATE POLICY recipes_anon_select
ON public.recipes
FOR SELECT
TO anon
USING (true);

CREATE POLICY recipe_materials_anon_select
ON public.recipe_materials
FOR SELECT
TO anon
USING (true);

-- 两条均成功后，再单独执行下面这条只读查询核对策略。
-- 应为两行：roles={anon}、cmd=SELECT、qual=true、with_check=NULL。
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('recipes', 'recipe_materials')
ORDER BY tablename, policyname;

-- 行数验证必须另在 API Explorer 指定 Role="anon"，使用下面的 SELECT。
-- 管理员角色的计数不能作为 anon 可见行数证据。
-- SELECT current_user AS active_role,
--        (SELECT count(*) FROM public.recipes) AS recipes_count,
--        (SELECT count(*) FROM public.recipe_materials) AS materials_count;
-- 预期为 anon / 5 / 25；取得结果后再部署 recipes-diag-v5 并验证云函数。
