-- ============================================
-- Staff POS V2 Foundation
-- ============================================
-- Objetivo:
-- - modelar pisos, mesas, sesiones, pedidos y pagos
-- - dejar a Supabase como fuente operativa
-- - reutilizar citizens/dracma_transactions para ABA
--
-- Prerrequisitos esperados en produccion:
-- - public.citizens
-- - public.dracma_transactions
-- - public.record_dracma_transaction(...)

-- ---------- ENUMS ----------

DO $$ BEGIN
    CREATE TYPE public.pos_session_status AS ENUM (
        'open',
        'checkout_requested',
        'partially_paid',
        'paid',
        'closed',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.pos_order_status AS ENUM (
        'draft',
        'sent',
        'served',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.pos_order_source AS ENUM (
        'staff',
        'client'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.pos_payment_method AS ENUM (
        'aba_nfc',
        'aba_wallet',
        'transfer_alias',
        'app_aba',
        'app_transfer'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.pos_payment_status AS ENUM (
        'pending',
        'processing',
        'confirmed',
        'failed',
        'cancelled',
        'expired'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.pos_guest_join_method AS ENUM (
        'qr',
        'nfc',
        'staff'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ---------- UPDATED_AT ----------

CREATE OR REPLACE FUNCTION public.pos_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ---------- FLOORS ----------

CREATE TABLE IF NOT EXISTS public.pos_floors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pos_floors_sort_order_check CHECK (sort_order > 0)
);

DROP TRIGGER IF EXISTS pos_floors_touch_updated_at ON public.pos_floors;
CREATE TRIGGER pos_floors_touch_updated_at
BEFORE UPDATE ON public.pos_floors
FOR EACH ROW
EXECUTE FUNCTION public.pos_touch_updated_at();

-- ---------- TABLES ----------

CREATE TABLE IF NOT EXISTS public.pos_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    floor_id UUID NOT NULL REFERENCES public.pos_floors(id) ON DELETE CASCADE,
    table_number INTEGER NOT NULL,
    label TEXT NOT NULL,
    seats INTEGER NOT NULL DEFAULT 4,
    claim_token TEXT NOT NULL UNIQUE,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pos_tables_number_check CHECK (table_number > 0),
    CONSTRAINT pos_tables_seats_check CHECK (seats > 0),
    CONSTRAINT pos_tables_floor_number_unique UNIQUE (floor_id, table_number)
);

DROP TRIGGER IF EXISTS pos_tables_touch_updated_at ON public.pos_tables;
CREATE TRIGGER pos_tables_touch_updated_at
BEFORE UPDATE ON public.pos_tables
FOR EACH ROW
EXECUTE FUNCTION public.pos_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_pos_tables_floor ON public.pos_tables(floor_id, table_number);
CREATE INDEX IF NOT EXISTS idx_pos_tables_claim_token ON public.pos_tables(claim_token);

-- ---------- MENU ----------

CREATE TABLE IF NOT EXISTS public.pos_menu_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS pos_menu_categories_touch_updated_at ON public.pos_menu_categories;
CREATE TRIGGER pos_menu_categories_touch_updated_at
BEFORE UPDATE ON public.pos_menu_categories
FOR EACH ROW
EXECUTE FUNCTION public.pos_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.pos_menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES public.pos_menu_categories(id) ON DELETE SET NULL,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    unit_price_ars NUMERIC(10,2) NOT NULL DEFAULT 0,
    image_url TEXT,
    is_available BOOLEAN NOT NULL DEFAULT true,
    visible_in_staff BOOLEAN NOT NULL DEFAULT true,
    visible_in_client BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pos_menu_items_price_check CHECK (unit_price_ars >= 0)
);

DROP TRIGGER IF EXISTS pos_menu_items_touch_updated_at ON public.pos_menu_items;
CREATE TRIGGER pos_menu_items_touch_updated_at
BEFORE UPDATE ON public.pos_menu_items
FOR EACH ROW
EXECUTE FUNCTION public.pos_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_pos_menu_items_category ON public.pos_menu_items(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pos_menu_items_staff ON public.pos_menu_items(visible_in_staff, is_available);
CREATE INDEX IF NOT EXISTS idx_pos_menu_items_client ON public.pos_menu_items(visible_in_client, is_available);

-- ---------- TABLE SESSIONS ----------

CREATE TABLE IF NOT EXISTS public.pos_table_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES public.pos_tables(id) ON DELETE RESTRICT,
    status public.pos_session_status NOT NULL DEFAULT 'open',
    opened_by_auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    assigned_waiter_auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    closed_by_auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    guest_count INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    customer_note TEXT,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checkout_requested_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pos_table_sessions_guest_count_check CHECK (guest_count >= 0)
);

DROP TRIGGER IF EXISTS pos_table_sessions_touch_updated_at ON public.pos_table_sessions;
CREATE TRIGGER pos_table_sessions_touch_updated_at
BEFORE UPDATE ON public.pos_table_sessions
FOR EACH ROW
EXECUTE FUNCTION public.pos_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_pos_table_sessions_table ON public.pos_table_sessions(table_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_table_sessions_status ON public.pos_table_sessions(status, opened_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_table_sessions_active_unique
ON public.pos_table_sessions(table_id)
WHERE status IN ('open', 'checkout_requested', 'partially_paid', 'paid');

-- ---------- SESSION GUESTS ----------

CREATE TABLE IF NOT EXISTS public.pos_session_guests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.pos_table_sessions(id) ON DELETE CASCADE,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    citizen_id UUID REFERENCES public.citizens(id) ON DELETE SET NULL,
    display_name TEXT,
    joined_via public.pos_guest_join_method NOT NULL DEFAULT 'qr',
    is_payer BOOLEAN NOT NULL DEFAULT false,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_session_guests_session ON public.pos_session_guests(session_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_pos_session_guests_auth ON public.pos_session_guests(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_pos_session_guests_citizen ON public.pos_session_guests(citizen_id);

-- ---------- ORDERS ----------

CREATE TABLE IF NOT EXISTS public.pos_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.pos_table_sessions(id) ON DELETE CASCADE,
    source public.pos_order_source NOT NULL,
    status public.pos_order_status NOT NULL DEFAULT 'draft',
    created_by_auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_by_citizen_id UUID REFERENCES public.citizens(id) ON DELETE SET NULL,
    note TEXT,
    sent_at TIMESTAMPTZ,
    served_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS pos_orders_touch_updated_at ON public.pos_orders;
CREATE TRIGGER pos_orders_touch_updated_at
BEFORE UPDATE ON public.pos_orders
FOR EACH ROW
EXECUTE FUNCTION public.pos_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_pos_orders_session ON public.pos_orders(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_orders_status ON public.pos_orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pos_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.pos_orders(id) ON DELETE CASCADE,
    menu_item_id UUID REFERENCES public.pos_menu_items(id) ON DELETE SET NULL,
    item_code TEXT,
    item_name TEXT NOT NULL,
    category_code TEXT,
    quantity INTEGER NOT NULL,
    unit_price_ars NUMERIC(10,2) NOT NULL,
    line_total_ars NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price_ars) STORED,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pos_order_items_quantity_check CHECK (quantity > 0),
    CONSTRAINT pos_order_items_unit_price_check CHECK (unit_price_ars >= 0),
    CONSTRAINT pos_order_items_status_check CHECK (status IN ('active', 'voided'))
);

DROP TRIGGER IF EXISTS pos_order_items_touch_updated_at ON public.pos_order_items;
CREATE TRIGGER pos_order_items_touch_updated_at
BEFORE UPDATE ON public.pos_order_items
FOR EACH ROW
EXECUTE FUNCTION public.pos_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_pos_order_items_order ON public.pos_order_items(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pos_order_items_status ON public.pos_order_items(status);

-- ---------- TRANSFER ACCOUNTS ----------

CREATE TABLE IF NOT EXISTS public.pos_transfer_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alias TEXT NOT NULL UNIQUE,
    owner_name TEXT NOT NULL,
    bank_name TEXT,
    cbu_partial TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS pos_transfer_accounts_touch_updated_at ON public.pos_transfer_accounts;
CREATE TRIGGER pos_transfer_accounts_touch_updated_at
BEFORE UPDATE ON public.pos_transfer_accounts
FOR EACH ROW
EXECUTE FUNCTION public.pos_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_pos_transfer_accounts_active ON public.pos_transfer_accounts(is_active);

-- ---------- PAYMENTS ----------

CREATE TABLE IF NOT EXISTS public.pos_payment_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.pos_table_sessions(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.pos_orders(id) ON DELETE SET NULL,
    method public.pos_payment_method NOT NULL,
    status public.pos_payment_status NOT NULL DEFAULT 'pending',
    amount_ars NUMERIC(10,2) NOT NULL,
    amount_aba NUMERIC(10,2),
    tip_ars NUMERIC(10,2) NOT NULL DEFAULT 0,
    citizen_id UUID REFERENCES public.citizens(id) ON DELETE SET NULL,
    created_by_auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    confirmed_by_auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    transfer_account_id UUID REFERENCES public.pos_transfer_accounts(id) ON DELETE SET NULL,
    transfer_alias TEXT,
    transfer_reference TEXT,
    wallet_object_id TEXT,
    nfc_tag_id TEXT,
    proof_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pos_payment_intents_amount_ars_check CHECK (amount_ars >= 0),
    CONSTRAINT pos_payment_intents_amount_aba_check CHECK (amount_aba IS NULL OR amount_aba >= 0),
    CONSTRAINT pos_payment_intents_tip_ars_check CHECK (tip_ars >= 0)
);

DROP TRIGGER IF EXISTS pos_payment_intents_touch_updated_at ON public.pos_payment_intents;
CREATE TRIGGER pos_payment_intents_touch_updated_at
BEFORE UPDATE ON public.pos_payment_intents
FOR EACH ROW
EXECUTE FUNCTION public.pos_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_pos_payment_intents_session ON public.pos_payment_intents(session_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_payment_intents_status ON public.pos_payment_intents(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_payment_intents_method ON public.pos_payment_intents(method, status);
CREATE INDEX IF NOT EXISTS idx_pos_payment_intents_transfer_pending
ON public.pos_payment_intents(transfer_account_id, expires_at)
WHERE method IN ('transfer_alias', 'app_transfer') AND status = 'pending';

CREATE TABLE IF NOT EXISTS public.pos_payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_intent_id UUID NOT NULL REFERENCES public.pos_payment_intents(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_citizen_id UUID REFERENCES public.citizens(id) ON DELETE SET NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_payment_events_payment ON public.pos_payment_events(payment_intent_id, created_at);

-- ---------- VIEWS ----------

CREATE OR REPLACE VIEW public.pos_table_live_status AS
WITH active_sessions AS (
    SELECT DISTINCT ON (s.table_id)
        s.id AS session_id,
        s.table_id,
        s.status AS session_status,
        s.assigned_waiter_auth_id,
        s.opened_at,
        s.checkout_requested_at
    FROM public.pos_table_sessions s
    WHERE s.status IN ('open', 'checkout_requested', 'partially_paid', 'paid')
    ORDER BY s.table_id, s.opened_at DESC
),
session_items AS (
    SELECT
        o.session_id,
        COALESCE(SUM(oi.line_total_ars) FILTER (WHERE oi.status = 'active' AND o.status <> 'cancelled'), 0) AS subtotal_ars,
        COALESCE(SUM(oi.quantity) FILTER (WHERE oi.status = 'active' AND o.status <> 'cancelled'), 0) AS item_count
    FROM public.pos_orders o
    LEFT JOIN public.pos_order_items oi ON oi.order_id = o.id
    GROUP BY o.session_id
),
session_payments AS (
    SELECT
        p.session_id,
        COALESCE(SUM(p.amount_ars + p.tip_ars) FILTER (WHERE p.status = 'confirmed'), 0) AS paid_ars,
        BOOL_OR(p.status = 'pending' AND p.method IN ('transfer_alias', 'app_transfer')) AS has_pending_transfer,
        BOOL_OR(p.status = 'pending' AND p.method IN ('aba_nfc', 'aba_wallet', 'app_aba')) AS has_pending_aba
    FROM public.pos_payment_intents p
    GROUP BY p.session_id
),
session_guests AS (
    SELECT
        g.session_id,
        COUNT(*) FILTER (WHERE g.left_at IS NULL) AS active_guest_count
    FROM public.pos_session_guests g
    GROUP BY g.session_id
)
SELECT
    t.id AS table_id,
    t.floor_id,
    t.label,
    t.table_number,
    t.claim_token,
    t.seats,
    t.is_active,
    a.session_id,
    a.session_status,
    a.assigned_waiter_auth_id,
    a.opened_at,
    a.checkout_requested_at,
    COALESCE(g.active_guest_count, 0) AS guest_count,
    COALESCE(i.item_count, 0) AS item_count,
    COALESCE(i.subtotal_ars, 0)::NUMERIC(10,2) AS subtotal_ars,
    COALESCE(p.paid_ars, 0)::NUMERIC(10,2) AS paid_ars,
    GREATEST(COALESCE(i.subtotal_ars, 0) - COALESCE(p.paid_ars, 0), 0)::NUMERIC(10,2) AS balance_due_ars,
    COALESCE(p.has_pending_transfer, false) AS has_pending_transfer,
    COALESCE(p.has_pending_aba, false) AS has_pending_aba,
    CASE
        WHEN t.is_active = false THEN 'disabled'
        WHEN a.session_id IS NULL THEN 'libre'
        WHEN a.session_status = 'paid' THEN 'pagada'
        WHEN COALESCE(p.has_pending_transfer, false) THEN 'transferencia_pendiente'
        WHEN a.session_status = 'checkout_requested' THEN 'pidiendo_cuenta'
        WHEN a.session_status = 'partially_paid' THEN 'abierta'
        ELSE 'abierta'
    END AS ui_state
FROM public.pos_tables t
LEFT JOIN active_sessions a ON a.table_id = t.id
LEFT JOIN session_items i ON i.session_id = a.session_id
LEFT JOIN session_payments p ON p.session_id = a.session_id
LEFT JOIN session_guests g ON g.session_id = a.session_id;

-- ---------- RLS ----------

ALTER TABLE public.pos_floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_session_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_transfer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_payment_events ENABLE ROW LEVEL SECURITY;

-- Nota:
-- No se agregan policies en esta fase.
-- Resultado: solo service_role puede operar estas tablas hasta definir el acceso final.

-- ---------- SEEDS ----------

INSERT INTO public.pos_floors (code, name, sort_order)
VALUES
    ('pb', 'PB', 1),
    ('p1', 'Piso 1', 2),
    ('p2', 'Piso 2', 3)
ON CONFLICT (code) DO UPDATE
SET
    name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    is_active = true;

INSERT INTO public.pos_menu_categories (code, name, sort_order)
VALUES
    ('cocktails', 'Cocktails', 1),
    ('wine', 'Vinos', 2),
    ('beer', 'Cervezas', 3),
    ('soft', 'Sin alcohol', 4),
    ('food', 'Cocina', 5)
ON CONFLICT (code) DO UPDATE
SET
    name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    is_active = true;

WITH category_map AS (
    SELECT id, code
    FROM public.pos_menu_categories
),
seed_items AS (
    SELECT *
    FROM (VALUES
        ('cocktails', 'hot-summer', 'Hot Summer Nights', 'Gin, durazno, lima y soda.', 12000, 1),
        ('cocktails', 'vesper', 'Vesper Martini', 'Gin, vodka y bitter blanco.', 12500, 2),
        ('cocktails', 'vigilante', 'Vigilante', 'Bourbon, café y cacao.', 12500, 3),
        ('cocktails', 'tonic', 'Acua Tonic', 'Gin, lima, pimientos y tónica.', 11000, 4),
        ('cocktails', 'soshun', 'Soshun', 'Vodka, cassis y lima.', 11000, 5),
        ('wine', 'copa-vino', 'Copa de vino', 'Selección por copa.', 7000, 1),
        ('wine', 'vino-media', 'Vino gama media', 'Botella de vino gama media.', 24000, 2),
        ('beer', 'cerveza-media', 'Cerveza gama media', 'Pinta o botella de línea media.', 8000, 1),
        ('soft', 'limonada', 'Limonada', 'Limonada fresca de la casa.', 6500, 1),
        ('soft', 'gaseosa', 'Gaseosa', 'Línea tradicional.', 5000, 2),
        ('food', 'mediterraneo', 'Mediterráneo', 'Jamón crudo, parmigiano, rúcula y tomates confitados.', 15500, 1),
        ('food', 'pastrami', 'Pastrami', 'Pastrami curado, queso fundido y mostaza.', 16500, 2),
        ('food', 'vegetariana', 'Vegetariana', 'Brie, tomates confitados, rúcula y hummus de palta.', 15000, 3)
    ) AS t(category_code, code, name, description, unit_price_ars, sort_order)
)
INSERT INTO public.pos_menu_items (
    category_id,
    code,
    name,
    description,
    unit_price_ars,
    visible_in_staff,
    visible_in_client,
    sort_order
)
SELECT
    c.id,
    s.code,
    s.name,
    s.description,
    s.unit_price_ars,
    true,
    true,
    s.sort_order
FROM seed_items s
JOIN category_map c ON c.code = s.category_code
ON CONFLICT (code) DO UPDATE
SET
    category_id = EXCLUDED.category_id,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    unit_price_ars = EXCLUDED.unit_price_ars,
    visible_in_staff = true,
    visible_in_client = true,
    is_available = true,
    sort_order = EXCLUDED.sort_order;

WITH floor_map AS (
    SELECT id, code
    FROM public.pos_floors
),
seed_tables AS (
    SELECT
        f.id AS floor_id,
        f.code AS floor_code,
        gs.n AS table_number
    FROM floor_map f
    CROSS JOIN generate_series(1, 30) AS gs(n)
)
INSERT INTO public.pos_tables (
    floor_id,
    table_number,
    label,
    seats,
    claim_token
)
SELECT
    s.floor_id,
    s.table_number,
    'Mesa ' || s.table_number,
    4,
    'AQ-' || UPPER(s.floor_code) || '-' || LPAD(s.table_number::TEXT, 2, '0')
FROM seed_tables s
ON CONFLICT (floor_id, table_number) DO NOTHING;
