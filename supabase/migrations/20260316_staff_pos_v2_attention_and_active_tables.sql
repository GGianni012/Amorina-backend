DO $$
BEGIN
    ALTER TYPE public.pos_payment_method ADD VALUE 'mercadopago_webhook';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

UPDATE public.pos_tables
SET
    is_active = false,
    updated_at = NOW()
WHERE table_number > 15
  AND is_active = true;
