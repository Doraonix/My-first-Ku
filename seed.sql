BEGIN;

WITH common_notes AS (
    SELECT '["用量是一人份单道菜的参考量，不代表一顿完整餐食，尚未实际试做验证。","食用油用量是全程总量，需要时分次使用。","主要食材和调料分开记录；油、盐也要由用户勾选，不默认已有。","清水视为烹调用水，不参与食材匹配。"]'::jsonb AS notes,
           '["鸡蛋应炒至凝固、没有流动蛋液。","不要使用发芽土豆。"]'::jsonb AS safety_notes
), reviewed_recipes (id, name, difficulty, steps, difficulty_reason) AS (
    VALUES
    ('recipe-001', '番茄炒蛋', '简单', '["番茄洗净切块，鸡蛋打散。","锅中加入部分油，用中火将蛋液炒至完全凝固，盛出。","加入剩余油，将番茄炒软、炒出汁。","倒回鸡蛋，加盐翻炒均匀、充分热透。"]'::jsonb, NULL::text),
    ('recipe-002', '青椒土豆丝', '简单', '["土豆洗净去皮、切细丝，用清水冲洗后沥干。","青椒洗净去籽，切丝。","锅中加油，用中火翻炒土豆丝；粘锅时可少量加入清水。","加入青椒继续翻炒，至土豆丝熟透、没有生硬内芯，加盐炒匀。"]'::jsonb, NULL::text),
    ('recipe-003', '番茄鸡蛋炖豆腐', '普通', '["番茄洗净切块，豆腐切小块，鸡蛋打散。","用部分油将鸡蛋炒至完全凝固，盛出。","加剩余油，将番茄炒软出汁；放入豆腐和约 100 毫升清水。","煮开后转小火，炖至豆腐内部热透；倒回鸡蛋，加生抽和盐，轻轻翻匀并充分加热。"]'::jsonb, '需要分开炒蛋、炒番茄，再合并炖煮，比单纯翻炒多几个环节。'),
    ('recipe-004', '什锦豆腐', '普通', '["蔬菜洗净；西兰花切小朵，胡萝卜和鲜香菇切薄片，豆腐切块并沥干表面水分。","西兰花、胡萝卜放入沸水煮熟，捞出沥干。","锅中加入部分油，用中小火将豆腐煎至表面浅金黄，盛出。","加剩余油，将香菇炒熟，再加入豆腐、西兰花和胡萝卜。","加生抽和盐，轻轻翻炒均匀，充分热透。"]'::jsonb, '需要焯菜、煎豆腐、合炒，步骤比“简单”档多。'),
    ('recipe-005', '青椒炒鸡蛋', '简单', '["青椒洗净、去籽切丝，鸡蛋打散。","锅中加入部分油，中火将鸡蛋炒至完全凝固，盛出。","加入剩余油，将青椒炒熟。","倒回鸡蛋，加盐炒匀，充分热透。"]'::jsonb, NULL::text)
)
INSERT INTO public.recipes (id, name, difficulty, steps, difficulty_reason, notes, safety_notes)
SELECT r.id, r.name, r.difficulty, r.steps, r.difficulty_reason, n.notes, n.safety_notes
FROM reviewed_recipes AS r CROSS JOIN common_notes AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.recipe_materials (recipe_id, name, material_type, amount, position)
VALUES
    ('recipe-001', '番茄', 'main', '1 个（约 150 克）', 1),
    ('recipe-001', '鸡蛋', 'main', '2 个', 2),
    ('recipe-001', '食用油', 'seasoning', '10 毫升', 1),
    ('recipe-001', '盐', 'seasoning', '1 克', 2),
    ('recipe-002', '土豆', 'main', '1 个（约 150 克）', 1),
    ('recipe-002', '青椒', 'main', '半个（约 40 克）', 2),
    ('recipe-002', '食用油', 'seasoning', '10 毫升', 1),
    ('recipe-002', '盐', 'seasoning', '1 克', 2),
    ('recipe-003', '番茄', 'main', '1 个（约 150 克）', 1),
    ('recipe-003', '北豆腐', 'main', '150 克', 2),
    ('recipe-003', '鸡蛋', 'main', '1 个', 3),
    ('recipe-003', '食用油', 'seasoning', '10 毫升', 1),
    ('recipe-003', '盐', 'seasoning', '0.5 克', 2),
    ('recipe-003', '生抽', 'seasoning', '5 毫升', 3),
    ('recipe-004', '北豆腐', 'main', '150 克', 1),
    ('recipe-004', '西兰花', 'main', '60 克', 2),
    ('recipe-004', '胡萝卜', 'main', '40 克', 3),
    ('recipe-004', '鲜香菇', 'main', '40 克', 4),
    ('recipe-004', '食用油', 'seasoning', '10 毫升', 1),
    ('recipe-004', '盐', 'seasoning', '0.5 克', 2),
    ('recipe-004', '生抽', 'seasoning', '5 毫升', 3),
    ('recipe-005', '青椒', 'main', '1 个（约 80 克）', 1),
    ('recipe-005', '鸡蛋', 'main', '2 个', 2),
    ('recipe-005', '食用油', 'seasoning', '10 毫升', 1),
    ('recipe-005', '盐', 'seasoning', '1 克', 2)
ON CONFLICT DO NOTHING;

COMMIT;
