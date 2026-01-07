-- Supabase Database Schema for Amorina Cine Bar
-- Run this in the Supabase SQL Editor

-- =============================================
-- USERS TABLE (extends auth.users)
-- =============================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    avatar_url TEXT,
    membership_level TEXT DEFAULT 'free' CHECK (membership_level IN ('free', 'aquilea', 'honorifico')),
    membership_expires_at TIMESTAMPTZ,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

-- Users can update their own data (except admin status)
CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- Service role can do anything
CREATE POLICY "Service role full access" ON public.users
    FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- PURCHASES TABLE (tickets bought)
-- =============================================
CREATE TABLE IF NOT EXISTS public.purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    user_email TEXT NOT NULL,
    user_name TEXT,
    movie_title TEXT NOT NULL,
    movie_poster TEXT,
    showtime TIMESTAMPTZ NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price INTEGER NOT NULL,
    total_amount INTEGER NOT NULL,
    discount_applied INTEGER DEFAULT 0,
    ticket_code TEXT UNIQUE NOT NULL,
    qr_payload TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired', 'cancelled')),
    payment_id TEXT,
    payment_status TEXT,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

-- Users can view their own purchases
CREATE POLICY "Users can view own purchases" ON public.purchases
    FOR SELECT USING (auth.uid() = user_id);

-- Authenticated users can insert purchases (for their own user_id)
CREATE POLICY "Users can insert own purchases" ON public.purchases
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role can do anything
CREATE POLICY "Service role full access purchases" ON public.purchases
    FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- MEMBERSHIPS TABLE (subscription history)
-- =============================================
CREATE TABLE IF NOT EXISTS public.memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    plan_type TEXT NOT NULL CHECK (plan_type IN ('aquilea', 'honorifico')),
    interval TEXT NOT NULL CHECK (interval IN ('monthly', 'annual')),
    amount_paid INTEGER NOT NULL,
    payment_id TEXT,
    payment_status TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'cancelled', 'expired')),
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- Users can view their own memberships
CREATE POLICY "Users can view own memberships" ON public.memberships
    FOR SELECT USING (auth.uid() = user_id);

-- Service role can do anything
CREATE POLICY "Service role full access memberships" ON public.memberships
    FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- FUNCTION: Auto-create user profile on signup
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = COALESCE(EXCLUDED.name, public.users.name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- FUNCTION: Generate unique ticket code
-- =============================================
CREATE OR REPLACE FUNCTION public.generate_ticket_code()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    result TEXT := 'AMO-';
    i INTEGER;
BEGIN
    FOR i IN 1..4 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- SET ADMIN USER: giannirolontoro@gmail.com
-- =============================================
-- This will be run after the user logs in for the first time
INSERT INTO public.users (id, email, name, is_admin, membership_level)
SELECT 
    id, 
    email, 
    raw_user_meta_data->>'full_name',
    TRUE,
    'honorifico'
FROM auth.users 
WHERE email = 'giannirolontoro@gmail.com'
ON CONFLICT (id) DO UPDATE SET 
    is_admin = TRUE,
    membership_level = 'honorifico',
    updated_at = NOW();

-- =============================================
-- INDEXES for performance
-- =============================================
CREATE INDEX IF NOT EXISTS idx_purchases_user_id ON public.purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_ticket_code ON public.purchases(ticket_code);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON public.purchases(status);
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_status ON public.memberships(status);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_membership ON public.users(membership_level);

-- =============================================
-- PRODUCTS TABLE (magazines, merchandise, etc.)
-- =============================================
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL CHECK (category IN ('magazine', 'merchandise', 'membership')),
    price INTEGER NOT NULL, -- Price in cents/pesos
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    stock INTEGER, -- NULL for unlimited
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert Magazine Products
INSERT INTO public.products (sku, name, description, category, price, image_url, metadata) VALUES
('TITA-001', 'Tita! #1 - Octubre 2024', 'Especial Cine Argentino', 'magazine', 10000, 'revistas/tita-1.jpg', '{"issue_number": 1, "release_date": "2024-10"}'),
('TITA-002', 'Tita! #2 - Diciembre 2024', 'Hollywood: El Imperio del Cine', 'magazine', 10000, 'revistas/tita-2.jpg', '{"issue_number": 2, "release_date": "2024-12"}'),
('TITA-003', 'Tita! #3 - Marzo 2025', 'Especial Mujeres en el Cine', 'magazine', 10000, 'revistas/tita-3.jpg', '{"issue_number": 3, "release_date": "2025-03"}'),
('TITA-004', 'Tita! #4 - Diciembre 2025', 'Nueva Mitología Argentina', 'magazine', 10000, 'revistas/tita-4.jpg', '{"issue_number": 4, "release_date": "2025-12"}')
ON CONFLICT (sku) DO UPDATE SET 
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    updated_at = NOW();

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Anyone can view active products
CREATE POLICY "Anyone can view products" ON public.products
    FOR SELECT USING (is_active = TRUE);

-- Service role can manage products
CREATE POLICY "Service role full access products" ON public.products
    FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- MAGAZINE ORDERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.magazine_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    user_email TEXT NOT NULL,
    user_name TEXT,
    items JSONB NOT NULL, -- Array of {sku, name, quantity, unit_price, total}
    subtotal INTEGER NOT NULL,
    discount_amount INTEGER DEFAULT 0,
    shipping_cost INTEGER DEFAULT 0,
    total_amount INTEGER NOT NULL,
    shipping_method TEXT CHECK (shipping_method IN ('pickup', 'delivery')),
    shipping_address JSONB, -- {address, postal_code, city, etc.}
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled')),
    payment_id TEXT,
    payment_status TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.magazine_orders ENABLE ROW LEVEL SECURITY;

-- Users can view their own orders
CREATE POLICY "Users can view own magazine orders" ON public.magazine_orders
    FOR SELECT USING (auth.uid() = user_id);

-- Authenticated users can insert orders
CREATE POLICY "Users can insert magazine orders" ON public.magazine_orders
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role can manage all orders
CREATE POLICY "Service role full access magazine_orders" ON public.magazine_orders
    FOR ALL USING (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(sku);
CREATE INDEX IF NOT EXISTS idx_magazine_orders_user ON public.magazine_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_magazine_orders_status ON public.magazine_orders(status);
