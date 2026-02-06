/**
 * SMAQ API - Webhook Handler for MercadoPago Top-Up Payments
 * POST /api/smaq/webhook
 * 
 * Processes payment confirmations from MercadoPago:
 * 1. Validates the payment
 * 2. Credits SMAQ to user
 * 3. Executes the pending purchase intent
 * 4. Updates Google Wallet balance
 */

import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { WebhookHandler } from '../../mercadopago-service/index.js';
import { SmaqsBankService, PurchaseIntentService, WalletSyncService } from '../../smaq-service/index.js';
import { GoogleSheetsClient } from '../../google-sheets-service/index.js';

// Setup Supabase (optional, only if env vars present)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;
import { loadConfig } from '../../core';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // MercadoPago expects 200 OK quickly
    if (req.method !== 'POST') {
        return res.status(200).end();
    }

    console.log('📥 SMAQ Webhook received:', JSON.stringify(req.body));

    try {
        const config = loadConfig();
        const payload = req.body as WebhookPayload;

        // Only process payment notifications
        if (payload.type !== 'payment') {
            console.log(`Ignoring webhook type: ${payload.type}`);
            return res.status(200).end();
        }

        // Get payment details from MercadoPago
        const webhookHandler = new WebhookHandler(config);
        const paymentInfo = await webhookHandler.processWebhook(payload);

        if (!paymentInfo) {
            console.log('No payment info returned');
            return res.status(200).end();
        }

        console.log(`💳 Payment ${paymentInfo.id}: ${paymentInfo.status}`);
        console.log(`📋 External ref: ${paymentInfo.externalReference}`);

        // Only process approved payments
        if (paymentInfo.status !== 'APPROVED') {
            console.log(`Payment not approved: ${paymentInfo.status}`);
            return res.status(200).end();
        }

        // Check if this is a SMAQ top-up (external_reference starts with "SMAQ-")
        const externalRef = paymentInfo.externalReference;
        if (!externalRef || !externalRef.startsWith('SMAQ-')) {
            console.log('Not a SMAQ top-up payment');
            return res.status(200).end();
        }

        // Get the purchase intent
        const intentService = new PurchaseIntentService(config);
        const intent = await intentService.getIntentByExternalRef(externalRef);

        if (!intent) {
            console.error(`❌ Purchase intent not found: ${externalRef}`);
            return res.status(200).end();
        }

        if (intent.status !== 'pending') {
            console.log(`Intent already processed: ${intent.status}`);
            return res.status(200).end();
        }

        console.log(`✅ Processing intent ${intent.id} for ${intent.userEmail}`);

        // 1. Mark intent as paid
        await intentService.markPaid(intent.id);

        // 2. Credit SMAQ to user
        const smaqBank = new SmaqBank(config);
        const creditResult = await smaqBank.credit(
            intent.userEmail,
            intent.smaqTopup,
            'compra',
            'mercadopago',
            `Top-up de ${intent.smaqTopup} SMAQ via MercadoPago`,
            intent.walletObjectId
        );

        console.log(`💰 Credited ${intent.smaqTopup} SMAQ. New balance: ${creditResult.newBalance}`);

        // 3. Execute the original purchase
        const chargeResult = await smaqBank.charge(
            intent.userEmail,
            intent.smaqRequired,
            intent.productType as any,
            `Compra automática: ${intent.productType}`,
            intent.walletObjectId
        );

        if (chargeResult.success) {
            // Execute purchase logic
            if (intent.productType === 'cine') {
                // Already handled by frontend redirection usually, but we could add ticket logic here
                // For now, sheet update is enough
            } else if (intent.productType === 'credits') {
                // Add credits to Subdivx/Amorina Sub user
                if (supabase && intent.productData?.credits) {
                    const { error } = await supabase.rpc('add_credits', {
                        target_user_id: intent.userId || intent.userEmail, // Assume userId is stored in intent if available, otherwise email might fail if RPC expects UUID
                        credit_amount: intent.productData.credits,
                        txn_provider: 'smaq_topup',
                        txn_payment_id: intent.id
                    });

                    if (error) {
                        console.error('Error adding credits:', error);
                        // Don't fail the whole webhook provided SMAQ was charged
                    } else {
                        console.log(`✅ Credits added: ${intent.productData.credits}`);
                    }
                } else {
                    console.warn('Skipping credit addition: Supabase not configured or missing credit data');
                }
            }
            console.log(`🛒 Purchase executed. Final balance: ${chargeResult.newBalance}`);
            await intentService.markCompleted(intent.id);

            // 4. Sync final balance to Google Wallet
            if (intent.walletObjectId && process.env.GOOGLE_WALLET_ISSUER_ID) {
                try {
                    const walletSync = new WalletSyncService({
                        issuerId: process.env.GOOGLE_WALLET_ISSUER_ID,
                        serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
                        serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || ''
                    });
                    await walletSync.updateBalance(intent.walletObjectId, chargeResult.newBalance);
                    console.log(`📱 Wallet synced: ${chargeResult.newBalance} SMAQ`);
                } catch (e) {
                    console.error('Wallet sync failed:', e);
                }
            }
        } else {
            console.error(`❌ Purchase failed: ${chargeResult.error}`);
            // Intent stays as 'paid' - user has SMAQ but purchase failed
            // This needs manual intervention
        }

        return res.status(200).end();

    } catch (error) {
        console.error('SMAQ webhook error:', error);
        // Always return 200 to MP to avoid retries
        return res.status(200).end();
    }
}
