-- Day 16：下一餐两表结构（PostgreSQL）。
-- 只创建空表；不插入菜品，不修改前端，不开放匿名读写。
-- 执行前确认选中了 doraonix 环境的 PostgreSQL 数据库，且 public 下
-- 不存在 recipes / recipe_materials。同名表已存在时停止，不删除或覆盖。
-- 本文件用于首次建表；需要重复执行的是后续 seed.sql，不是本文件。
-- 在控制台 SQL 编辑器中以管理员身份执行完整文件。

BEGIN;

CREATE TABLE public.recipes (
    -- text 沿用 recipe-001 这样的固定编号，不改成列表位置或自增编号。
    id text PRIMARY KEY,
    name text NOT NULL,
    difficulty text NOT NULL,

    -- jsonb 数组保留做法顺序；具体文字仍须经过菜品审核。
    steps jsonb NOT NULL,
    difficulty_reason text,

    -- 将原 JSON 顶层的用量说明和安全说明保留在各菜品记录中，
    -- 不新增第三张表；种子阶段核对来源，不在这里生成菜品内容。
    notes jsonb NOT NULL DEFAULT '[]'::jsonb,
    safety_notes jsonb NOT NULL DEFAULT '[]'::jsonb,

    CONSTRAINT recipes_id_not_blank CHECK (btrim(id) <> ''),
    CONSTRAINT recipes_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT recipes_difficulty_allowed CHECK (difficulty IN ('简单', '普通')),
    CONSTRAINT recipes_steps_nonempty_array CHECK (
        CASE
            WHEN jsonb_typeof(steps) = 'array' THEN jsonb_array_length(steps) > 0
            ELSE false
        END
    ),
    CONSTRAINT recipes_notes_array CHECK (jsonb_typeof(notes) = 'array'),
    CONSTRAINT recipes_safety_notes_array CHECK (jsonb_typeof(safety_notes) = 'array')
);

CREATE TABLE public.recipe_materials (
    -- recipe_id 指向 recipes.id：一张菜品记录对应多条材料明细。
    recipe_id text NOT NULL,
    name text NOT NULL,

    -- main = 主要食材；seasoning = 调料，不混成同一类缺料。
    material_type text NOT NULL,

    -- text 保留“1 个（约 150 克）”等审核过的文字，不假装已换算用量。
    amount text NOT NULL,

    -- integer 记录材料在当前分组中的排列顺序，从 1 开始。
    position integer NOT NULL,

    -- 同一道菜、同一材料只记录一次，也不能跨两个分组重复记录。
    CONSTRAINT recipe_materials_pkey PRIMARY KEY (recipe_id, name),
    CONSTRAINT recipe_materials_recipe_id_fkey FOREIGN KEY (recipe_id)
        REFERENCES public.recipes (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT recipe_materials_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT recipe_materials_type_allowed CHECK (material_type IN ('main', 'seasoning')),
    CONSTRAINT recipe_materials_amount_not_blank CHECK (btrim(amount) <> ''),
    CONSTRAINT recipe_materials_position_positive CHECK (position > 0),
    CONSTRAINT recipe_materials_group_position_key UNIQUE (recipe_id, material_type, position)
);

-- 只对本次新建的两表启用行级安全，不设置公开访问策略或授予匿名权限。
-- 无策略时普通角色默认不能访问行；表所有者/管理员仍可在控制台管理。
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_materials ENABLE ROW LEVEL SECURITY;

COMMIT;
