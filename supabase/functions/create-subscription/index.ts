// Supabase Edge Function: Create Subscription Payment
// POST /functions/v1/create-subscription

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const accessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
        if (!accessToken) {
            return new Response(
                JSON.stringify({ error: 'MercadoPago token no configurado' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const body = await req.json();
        const { plan_type, interval, amount, description, user_email, user_name } = body;

        if (!plan_type || !interval || !amount) {
            return new Response(
                JSON.stringify({ error: 'Faltan datos requeridos' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Create a MercadoPago preference (for now using regular payment)
        // In production, you would use MercadoPago's Subscription API
        const preference = {
            items: [
                {
                    title: description,
                    quantity: 1,
                    unit_price: amount,
                    currency_id: 'ARS',
                }
            ],
            payer: {
                email: user_email || 'cliente@amorina.club',
                name: user_name || 'Socio Amorina'
            },
            back_urls: {
                success: 'https://amorina.club/?membership=success',
                failure: 'https://amorina.club/?membership=failure',
                pending: 'https://amorina.club/?membership=pending'
            },
            auto_return: 'approved',
            external_reference: `membership_${plan_type}_${interval}_${Date.now()}`,
            metadata: {
                plan_type,
                interval,
                user_email,
                user_name,
                membership: true
            },
            notification_url: 'https://iazjntvrxfyxlinkuiwx.supabase.co/functions/v1/webhook-membership'
        };

        const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify(preference),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('MercadoPago error:', data);
            return new Response(
                JSON.stringify({ error: 'Error al crear preferencia de pago', detail: data }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({
                init_point: data.init_point,
                preference_id: data.id
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Subscription error:', error);
        return new Response(
            JSON.stringify({ error: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
