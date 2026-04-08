UPDATE public.pos_tables
SET
    label = LPAD(table_number::TEXT, 2, '0'),
    is_active = CASE WHEN table_number <= 10 THEN true ELSE false END,
    updated_at = NOW()
WHERE label IS DISTINCT FROM LPAD(table_number::TEXT, 2, '0')
   OR is_active IS DISTINCT FROM (table_number <= 10);
