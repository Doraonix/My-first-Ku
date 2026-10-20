-- Day 27 板块③：新增三道菜，回应第三方试用反馈 P1“菜太少”。
-- recipe-006 胡萝卜炒鸡蛋、recipe-007 西兰花炒胡萝卜、recipe-008 青椒炒香菇；
-- 资料由 AI 起草，学员于 2026-10-20 审阅后回复“全部批准”（见 README Day 27 ③）。
-- 由学员在 doraonix 环境的 SQL 编辑器以管理员身份，按编号一次执行一段；不要整文件一次运行。
-- 1–2 是只读前置；全部符合预期、本人另行确认后，才执行第 3 段一次，再逐段读回 4–6。
-- 任一结果不符或报错即停止；不要重跑、不要删除或修改原有数据来凑数。
-- 只新增 3 道菜和 13 条材料；不改原有 5 道菜、表结构、权限、RLS 或收藏。
-- 共用说明与 seed.sql 逐字相同；第 3 段会先核对它与线上 recipe-001 一致。
-- 资料已在本机用网页同一套校验代码（recipe-data.mjs）检查；本地没有运行 PostgreSQL，未做真实 SQL 验证。

-- 1. 只读确认：数据库和管理员身份正确，UTF8、standard_conforming_strings=on。
-- 预期：postgres-c8t0z5ym / cloudbase_postgres_postgres_c8t0z5ym / UTF8 / on。
SELECT current_database() AS database_name,
       current_user AS active_role,
       current_setting('server_encoding') AS server_encoding,
       current_setting('standard_conforming_strings') AS standard_conforming_strings;

-- 2. 只读确认：写前数量，以及新编号、新菜名都还不存在。
-- 预期：recipes_before=5、materials_before=25，其余三列都是 0。
SELECT (SELECT count(*) FROM public.recipes) AS recipes_before,
       (SELECT count(*) FROM public.recipe_materials) AS materials_before,
       (SELECT count(*) FROM public.recipes
        WHERE id IN ('recipe-006', 'recipe-007', 'recipe-008')) AS new_ids_in_recipes,
       (SELECT count(*) FROM public.recipe_materials
        WHERE recipe_id IN ('recipe-006', 'recipe-007', 'recipe-008')) AS new_ids_in_materials,
       (SELECT count(*) FROM public.recipes
        WHERE name IN ('胡萝卜炒鸡蛋', '西兰花炒胡萝卜', '青椒炒香菇')) AS same_names;

-- 3. 唯一写入段：本人确认后，一次完整选择 DO ... $day27_recipes$; 执行。
-- 单段原子执行：任一检查或插入失败，整段回滚，不会只写进一半。
-- 成功时控制台可能只显示“执行成功”或“0 行”（Day 22 的 DO 段就是“0 行”），不一定显示 NOTICE；
-- 是否写入以第 4–6 段读回为准。没看到 NOTICE 不要重跑第 3 段，直接执行第 6 段：8/38 表示已写入，5/25 表示没有写入。
-- 没有 COMMIT，也不吞掉错误。
DO $day27_recipes$
DECLARE
    v_notes jsonb := '["用量是一人份单道菜的参考量，不代表一顿完整餐食，尚未实际试做验证。","食用油用量是全程总量，需要时分次使用。","主要食材和调料分开记录；油、盐也要由用户勾选，不默认已有。","清水视为烹调用水，不参与食材匹配。"]'::jsonb;
    v_safety_notes jsonb := '["鸡蛋应炒至凝固、没有流动蛋液。","不要使用发芽土豆。"]'::jsonb;
BEGIN
    IF current_database() <> 'postgres-c8t0z5ym'
       OR current_user <> 'cloudbase_postgres_postgres_c8t0z5ym' THEN
        RAISE EXCEPTION '停止：数据库或管理员身份不符合 Day 27 加菜要求。';
    END IF;
    IF current_setting('server_encoding') <> 'UTF8'
       OR current_setting('standard_conforming_strings') <> 'on' THEN
        RAISE EXCEPTION '停止：需要 UTF8 与 standard_conforming_strings=on。';
    END IF;
    IF (SELECT count(*) FROM public.recipes) <> 5
       OR (SELECT count(*) FROM public.recipe_materials) <> 25 THEN
        RAISE EXCEPTION '停止：当前不是 5 道菜、25 条材料，本次没有写入任何内容。若第 3 段之前已成功执行过，这是正常的，不要再跑，直接执行第 6 段核对是否为 8/38。';
    END IF;
    IF EXISTS (SELECT 1 FROM public.recipes
               WHERE id IN ('recipe-006', 'recipe-007', 'recipe-008')
                  OR name IN ('胡萝卜炒鸡蛋', '西兰花炒胡萝卜', '青椒炒香菇'))
       OR EXISTS (SELECT 1 FROM public.recipe_materials
                  WHERE recipe_id IN ('recipe-006', 'recipe-007', 'recipe-008')) THEN
        RAISE EXCEPTION '停止：新编号或新菜名已存在，不覆盖、不重跑。';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.recipes
                   WHERE id = 'recipe-001' AND notes = v_notes AND safety_notes = v_safety_notes) THEN
        RAISE EXCEPTION '停止：共用说明与线上 recipe-001 不一致，未写入。';
    END IF;

    INSERT INTO public.recipes (id, name, difficulty, steps, difficulty_reason, notes, safety_notes)
    VALUES
        ('recipe-006', '胡萝卜炒鸡蛋', '简单', '["胡萝卜洗净去皮、切细丝，鸡蛋打散。","锅中加入部分油，用中火将蛋液炒至完全凝固，盛出。","加入剩余油，将胡萝卜丝炒软；粘锅时可少量加入清水。","倒回鸡蛋，加盐翻炒均匀，充分热透。"]'::jsonb, NULL::text, v_notes, v_safety_notes),
        ('recipe-007', '西兰花炒胡萝卜', '简单', '["西兰花切小朵后洗净，胡萝卜洗净去皮、切薄片。","锅中烧开能没过菜的清水，放入西兰花和胡萝卜煮约 1 分钟，捞出沥干。","倒掉锅中的水，把锅烧干后加油，用中火翻炒西兰花和胡萝卜。","炒至胡萝卜变软、西兰花梗用筷子能轻松戳透，加盐炒匀。"]'::jsonb, NULL::text, v_notes, v_safety_notes),
        ('recipe-008', '青椒炒香菇', '简单', '["青椒洗净去籽、切块；鲜香菇快速冲洗并沥干，切掉伞下面的硬柄，伞盖切薄片。","锅中加油，用中火将香菇片炒软。","加入青椒继续翻炒，至青椒变软，香菇片全部变软、颜色变深，没有发白发硬的部分。","加生抽和盐炒匀，充分热透。"]'::jsonb, NULL::text, v_notes, v_safety_notes);

    INSERT INTO public.recipe_materials (recipe_id, name, material_type, amount, position)
    VALUES
        ('recipe-006', '胡萝卜', 'main', '1 小根（约 100 克）', 1),
        ('recipe-006', '鸡蛋', 'main', '2 个', 2),
        ('recipe-006', '食用油', 'seasoning', '10 毫升', 1),
        ('recipe-006', '盐', 'seasoning', '1 克', 2),
        ('recipe-007', '西兰花', 'main', '150 克', 1),
        ('recipe-007', '胡萝卜', 'main', '半小根（约 50 克）', 2),
        ('recipe-007', '食用油', 'seasoning', '10 毫升', 1),
        ('recipe-007', '盐', 'seasoning', '1 克', 2),
        ('recipe-008', '青椒', 'main', '1 个（约 80 克）', 1),
        ('recipe-008', '鲜香菇', 'main', '中等大小 4 朵（约 80 克）', 2),
        ('recipe-008', '食用油', 'seasoning', '10 毫升', 1),
        ('recipe-008', '盐', 'seasoning', '0.5 克', 2),
        ('recipe-008', '生抽', 'seasoning', '5 毫升', 3);

    IF (SELECT count(*) FROM public.recipes) <> 8
       OR (SELECT count(*) FROM public.recipe_materials) <> 38 THEN
        RAISE EXCEPTION '停止：写入后不是 8 道菜、38 条材料，整段回滚。';
    END IF;
    RAISE NOTICE '已新增 3 道菜、13 条材料（现在共 8 道菜、38 条材料）。';
END;
$day27_recipes$;

-- 4. 只读读回：三道新菜。
-- 预期 3 行：difficulty=简单、step_count=4、no_reason=true、notes_same=true、safety_same=true。
SELECT r.id, r.name, r.difficulty,
       jsonb_array_length(r.steps) AS step_count,
       r.difficulty_reason IS NULL AS no_reason,
       r.notes = base.notes AS notes_same,
       r.safety_notes = base.safety_notes AS safety_same
FROM public.recipes AS r
CROSS JOIN (SELECT notes, safety_notes FROM public.recipes WHERE id = 'recipe-001') AS base
WHERE r.id IN ('recipe-006', 'recipe-007', 'recipe-008')
ORDER BY r.id;

-- 5. 只读读回：新材料。
-- 预期：13 行，与第 3 段逐字一致。
SELECT recipe_id, material_type, position, name, amount
FROM public.recipe_materials
WHERE recipe_id IN ('recipe-006', 'recipe-007', 'recipe-008')
ORDER BY recipe_id, material_type, position;

-- 6. 只读读回：写入后的总数。
-- 预期：recipes_after=8、materials_after=38。
SELECT (SELECT count(*) FROM public.recipes) AS recipes_after,
       (SELECT count(*) FROM public.recipe_materials) AS materials_after;

/*
撤销段（备查，平时不要执行）：
只在第 3 段成功后、公网页面隔几秒刷新 2–3 次仍然每次都加载失败、需要立刻止血时，先停下来报告，另获学员确认才执行一次。
（只失败一次，可能是写入那一刻两个读接口读到了新旧不同的资料，或者是已知的 3 秒超时，不一定是新资料的问题。）
注意：
- 已经在网页上收藏了这三道菜的浏览器，删除后整个收藏功能都会停用：“我的收藏”读取失败，所有菜的收藏按钮都变成“收藏状态未读取”、不能点；
  刷新或点“重试读取”都恢复不了，只有这三道菜重新上线、或访客自己清除该网站数据后才恢复（网页收藏里有未知菜品编号时会停止读写，保护原记录）。
  所以发现问题要尽快撤销，越晚影响的人越多。
- 云端收藏表 favorites 若已引用这三道菜，外键会拒绝删除，整段回滚；那时先停下来报告，不要先删收藏。
- 撤销后公网刷新应恢复“本次加载 5 道菜”。

DO $day27_undo$
BEGIN
    IF current_database() <> 'postgres-c8t0z5ym'
       OR current_user <> 'cloudbase_postgres_postgres_c8t0z5ym' THEN
        RAISE EXCEPTION '停止：数据库或管理员身份不符。';
    END IF;
    IF (SELECT count(*) FROM public.recipes) <> 8
       OR (SELECT count(*) FROM public.recipe_materials) <> 38 THEN
        RAISE EXCEPTION '停止：当前不是 8 道菜、38 条材料，不执行撤销。';
    END IF;
    DELETE FROM public.recipe_materials WHERE recipe_id IN ('recipe-006', 'recipe-007', 'recipe-008');
    DELETE FROM public.recipes WHERE id IN ('recipe-006', 'recipe-007', 'recipe-008');
    IF (SELECT count(*) FROM public.recipes) <> 5
       OR (SELECT count(*) FROM public.recipe_materials) <> 25 THEN
        RAISE EXCEPTION '停止：撤销后不是 5 道菜、25 条材料，整段回滚。';
    END IF;
    RAISE NOTICE '已撤销 Day 27 新增的 3 道菜和 13 条材料。';
END;
$day27_undo$;
*/
