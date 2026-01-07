// Supabase Edge Function: Magazine Checkout
// POST /functions/v1/magazine-checkout

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface MagazineItem {
    id: number;          // Magazine issue number (1, 2, 3, 4)
    quantity: number;
    title: string;       // e.g., "Tita! #1"
    unitPrice: number;   // Price per unit (10000)
    lineTotal: number;   // After discount
    hasDiscount: boolean;
}

interface MagazineCheckoutRequest {
    items: MagazineItem[];
    subtotal: number;
    discountAmount: number;
    shippingMethod: 'pickup' | 'delivery';
    shippingCost: number;
    shippingAddress?: {
        address: string;
        postalCode: string;
    };
    userEmail: string;
    userName: string;
    totalAmount: number;
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const body = await req.json() as MagazineCheckoutRequest;

        const { items, subtotal, discountAmount, shippingMethod, shippingCost, shippingAddress, userEmail, userName, totalAmount } = body;

        if (!items || items.length === 0 || !userEmail || !userName) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const mpAccessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
        const baseUrl = Deno.env.get('BASE_URL') || 'https://amorina.club';

        if (!mpAccessToken) {
            console.error('Missing MERCADOPAGO_ACCESS_TOKEN');
            return new Response(
                JSON.stringify({ error: 'Payment service not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Generate unique order ID
        const orderId = `MAG-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`.toUpperCase();

        // Build MercadoPago items array
        const mpItems = items.map(item => ({
            id: `TITA-00${item.id}`,
            title: item.title,
            description: item.hasDiscount ? `${item.quantity}x (20% OFF aplicado)` : `${item.quantity}x`,
            quantity: 1, // We use 1 because lineTotal already has quantity factored in
            currency_id: 'ARS',
            unit_price: item.lineTotal,
        }));

        // Add shipping as a separate item if delivery
        if (shippingMethod === 'delivery' && shippingCost > 0) {
            mpItems.push({
                id: 'SHIPPING',
                title: 'Envío a domicilio',
                description: shippingAddress ? `${shippingAddress.address}, CP: ${shippingAddress.postalCode}` : 'Envío estándar',
                quantity: 1,
                currency_id: 'ARS',
                unit_price: shippingCost,
            });
        }

        console.log('Creating MercadoPago preference for order:', orderId);
        console.log('Items:', JSON.stringify(mpItems));
        console.log('Total:', totalAmount);

        const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${mpAccessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                items: mpItems,
                payer: {
                    email: userEmail,
                    name: userName
                },
                back_urls: {
                    success: `${baseUrl}/#revista?order=${orderId}&status=success`,
                    failure: `${baseUrl}/#revista?order=${orderId}&status=failure`,
                    pending: `${baseUrl}/#revista?order=${orderId}&status=pending`,
                },
                auto_return: 'approved',
                external_reference: orderId,
                metadata: {
                    order_id: orderId,
                    order_type: 'magazine',
                    items: items,
                    subtotal: subtotal,
                    discount_amount: discountAmount,
                    shipping_method: shippingMethod,
                    shipping_cost: shippingCost,
                    shipping_address: shippingAddress || null,
                    user_email: userEmail,
                    user_name: userName,
                    total_amount: totalAmount,
                },
                statement_descriptor: 'AMORINA REVISTAS',
                expires: true,
                expiration_date_from: new Date().toISOString(),
                expiration_date_to: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
            }),
        });

        const mpData = await mpResponse.json();

        if (!mpResponse.ok) {
            console.error('MercadoPago error:', mpData);
            return new Response(
                JSON.stringify({ error: 'Error creating payment', details: mpData }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log('MercadoPago preference created:', mpData.id);

        return new Response(
            JSON.stringify({
                success: true,
                orderId,
                preferenceId: mpData.id,
                initPoint: mpData.init_point,
                sandboxInitPoint: mpData.sandbox_init_point,
                totalAmount,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Magazine checkout error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
