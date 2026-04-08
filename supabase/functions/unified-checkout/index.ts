// Supabase Edge Function: Unified Checkout
// POST /functions/v1/unified-checkout

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CheckoutItem {
  type: 'movie' | 'magazine';
  title: string;
  quantity: number;
  unit_price: number;
  showtime?: string;
  poster?: string;
}

interface UnifiedCheckoutRequest {
  items: CheckoutItem[];
  userEmail: string;
  userName: string;
  userId?: string;
  smaqApplied?: number | null;
  smaqTotalRequired?: number | null;
  smaqCitizenId?: string | null;
  shippingMethod?: 'pickup' | 'delivery' | null;
  shippingAddress?: {
    address?: string;
    postalCode?: string;
  } | null;
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as UnifiedCheckoutRequest;
    const {
      items,
      userEmail,
      userName,
      userId,
      smaqApplied: rawSmaqApplied,
      smaqTotalRequired: rawSmaqTotalRequired,
      smaqCitizenId,
      shippingMethod,
      shippingAddress,
    } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing items' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!userEmail || !userName) {
      return new Response(
        JSON.stringify({ error: 'Missing user info' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const mpAccessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
    const baseUrl = Deno.env.get('BASE_URL') || 'https://www.amorina.club';

    if (!mpAccessToken) {
      return new Response(
        JSON.stringify({ error: 'Payment service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const orderId = `UNI-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`.toUpperCase();

    const mpItems = items.map((item) => {
      const qty = Math.max(1, Math.floor(toNumber(item.quantity, 1)));
      const unitPrice = Math.max(1, Math.floor(toNumber(item.unit_price, 0)));

      if (item.type === 'movie') {
        const showText = item.showtime
          ? `Función: ${new Date(item.showtime).toLocaleString('es-AR')}`
          : 'Entrada general';

        return {
          title: `Entrada: ${item.title}`,
          description: showText,
          picture_url: item.poster || undefined,
          quantity: qty,
          currency_id: 'ARS',
          unit_price: unitPrice,
        };
      }

      return {
        title: item.title,
        description: `${qty}x`,
        quantity: qty,
        currency_id: 'ARS',
        unit_price: unitPrice,
      };
    });

    const hasMagazine = items.some((i) => i.type === 'magazine');
    const shouldChargeShipping = hasMagazine && shippingMethod === 'delivery';
    const shippingCost = shouldChargeShipping ? 8000 : 0;

    if (shippingCost > 0) {
      mpItems.push({
        title: 'Envío a domicilio',
        description: shippingAddress?.address
          ? `${shippingAddress.address}${shippingAddress.postalCode ? `, CP: ${shippingAddress.postalCode}` : ''}`
          : 'Envío estándar',
        quantity: 1,
        currency_id: 'ARS',
        unit_price: shippingCost,
      });
    }

    const subtotal = mpItems.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
    const normalizedSmaqApplied = Math.max(0, Math.floor(toNumber(rawSmaqApplied, 0)));
    const normalizedSmaqTotalRequired = Math.max(
      normalizedSmaqApplied,
      Math.floor(toNumber(rawSmaqTotalRequired, Math.ceil(subtotal / 1000))),
    );
    const smaqMissing = normalizedSmaqApplied > 0
      ? Math.max(0, normalizedSmaqTotalRequired - normalizedSmaqApplied)
      : 0;
    const isPartialSmaqCheckout = normalizedSmaqApplied > 0 && smaqMissing > 0;

    if (normalizedSmaqApplied > 0 && !isPartialSmaqCheckout) {
      return new Response(
        JSON.stringify({ error: 'El saldo ABA ya cubre el pedido completo.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const checkoutItems = isPartialSmaqCheckout
      ? [{
          title: 'ABA faltantes para tu pedido',
          description: `${smaqMissing} ABA para completar tu compra en Amorina`,
          quantity: 1,
          currency_id: 'ARS',
          unit_price: smaqMissing * 1000,
        }]
      : mpItems;

    const chargeTotal = checkoutItems.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mpAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: checkoutItems,
        payer: {
          email: userEmail,
          name: userName,
        },
        back_urls: {
          success: `${baseUrl}/?checkout=success`,
          failure: `${baseUrl}/?checkout=failure`,
          pending: `${baseUrl}/?checkout=pending`,
        },
        auto_return: 'approved',
        external_reference: orderId,
        metadata: {
          order_id: orderId,
          order_type: 'unified',
          payment_mode: isPartialSmaqCheckout ? 'partial_smaq' : 'full_mercadopago',
          user_id: userId || null,
          user_email: userEmail,
          user_name: userName,
          smaq_applied: isPartialSmaqCheckout ? normalizedSmaqApplied : 0,
          smaq_total_required: isPartialSmaqCheckout ? normalizedSmaqTotalRequired : 0,
          smaq_missing: isPartialSmaqCheckout ? smaqMissing : 0,
          smaq_citizen_id: isPartialSmaqCheckout ? smaqCitizenId || null : null,
          shipping_method: shippingMethod || 'pickup',
          shipping_address: shippingAddress || null,
          items,
          subtotal,
          charge_total: chargeTotal,
        },
        statement_descriptor: 'AMORINA',
      }),
    });

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('MercadoPago unified error:', mpData);
      return new Response(
        JSON.stringify({ error: 'Error creating payment', details: mpData }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        orderId,
        preferenceId: mpData.id,
        initPoint: mpData.init_point,
        sandboxInitPoint: mpData.sandbox_init_point,
        totalAmount: chargeTotal,
        orderSubtotal: subtotal,
        smaqApplied: isPartialSmaqCheckout ? normalizedSmaqApplied : 0,
        smaqMissing: isPartialSmaqCheckout ? smaqMissing : 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Unified checkout error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
