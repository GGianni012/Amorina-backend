// Supabase Edge Function: Checkout
// POST /functions/v1/checkout

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CheckoutRequest {
    showtime: {
        title: string;
        showtime: string;
        price: string;
        poster: string;
    };
    quantity: number;
    userEmail: string;
    userName: string;
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { showtime, quantity, userEmail, userName } = await req.json() as CheckoutRequest;

        if (!showtime || !userEmail || !userName) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const mpAccessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
        const baseUrl = Deno.env.get('BASE_URL') || 'https://amorina.club';
        const basePrice = parseInt(Deno.env.get('BASE_PRICE') || '6000', 10);

        const qty = quantity || 1;
        const originalPrice = parseInt(showtime.price, 10) || basePrice;
        const finalPrice = originalPrice;

        const reservationId = `AMO-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`.toUpperCase();

        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let ticketCode = 'AMO-';
        for (let i = 0; i < 8; i++) {
            ticketCode += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${mpAccessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                items: [{
                    title: `Entrada: ${showtime.title}`,
                    description: `Función: ${new Date(showtime.showtime).toLocaleString('es-AR')}`,
                    picture_url: showtime.poster,
                    quantity: qty,
                    currency_id: 'ARS',
                    unit_price: finalPrice,
                }],
                payer: { email: userEmail, name: userName },
                back_urls: {
                    success: `${baseUrl}/reserva/exito`,
                    failure: `${baseUrl}/reserva/error`,
                    pending: `${baseUrl}/reserva/pendiente`,
                },
                auto_return: 'approved',
                external_reference: reservationId,
                metadata: {
                    reservation_id: reservationId,
                    ticket_code: ticketCode,
                    movie_title: showtime.title,
                    show_datetime: showtime.showtime,
                    quantity: qty,
                    user_email: userEmail,
                    user_name: userName,
                },
            }),
        });

        const mpData = await mpResponse.json();

        if (!mpResponse.ok) {
            console.error('MercadoPago error:', mpData);
            return new Response(
                JSON.stringify({ error: 'Error creating payment' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({
                success: true,
                reservationId,
                ticketCode,
                preferenceId: mpData.id,
                initPoint: mpData.init_point,
                sandboxInitPoint: mpData.sandbox_init_point,
                finalPrice,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Checkout error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
