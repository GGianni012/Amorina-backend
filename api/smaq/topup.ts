/**
 * SMAQ API - Unified Top-Up/Purchase Endpoint
 * POST /api/smaq/topup
 * 
 * This is the main entry point for all SMAQ purchases.
 * It checks balance and either:
 * 1. Charges directly if balance is sufficient
 * 2. Creates a purchase intent + MP checkout if balance is insufficient
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
    SmaqBank,
    PurchaseIntentService,
    TopupCheckoutService,
    WalletSyncService,
    type ProductType
} from '../../smaq-service';
import { loadConfig } from '../../core';

interface TopupRequest {
    email: string;
    userName?: string;
    productType: ProductType;
    productData: Record<string, any>;
    smaqPrice: number;              // Price in SMAQ for the product
    walletObjectId?: string;
    suggestExtraSmaqs?: number;     // Suggest buying extra SMAQS (default: 0)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const {
            email,
            userName,
            productType,
            productData,
            smaqPrice,
            walletObjectId,
            suggestExtraSmaqs = 0
        } = req.body as TopupRequest;

        // Validation
        if (!email) {
            return res.status(400).json({ error: 'Email requerido' });
        }
        if (!productType) {
            return res.status(400).json({ error: 'Tipo de producto requerido' });
        }
        if (!smaqPrice || smaqPrice <= 0) {
            return res.status(400).json({ error: 'Precio SMAQ inválido' });
        }

        const config = loadConfig();
        const smaqBank = new SmaqBank(config);

        // Check current balance
        const currentBalance = await smaqBank.getBalance(email);

        // If balance is sufficient, charge directly
        if (currentBalance >= smaqPrice) {
            const chargeResult = await smaqBank.charge(
                email,
                smaqPrice,
                productType as any, // ProductType matches AppSource
                `Compra: ${productType}`,
                walletObjectId
            );

            if (chargeResult.success) {
                // Sync to Google Wallet if available
                if (walletObjectId && process.env.GOOGLE_WALLET_ISSUER_ID) {
                    try {
                        const walletSync = new WalletSyncService({
                            issuerId: process.env.GOOGLE_WALLET_ISSUER_ID,
                            serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
                            serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || ''
                        });
                        await walletSync.updateBalance(walletObjectId, chargeResult.newBalance);
                    } catch (e) {
                        console.error('Wallet sync failed:', e);
                    }
                }

                return res.status(200).json({
                    success: true,
                    action: 'charged',
                    newBalance: chargeResult.newBalance,
                    message: `Compra exitosa. Nuevo saldo: ${chargeResult.newBalance} SMAQ`
                });
            } else {
                return res.status(400).json({
                    success: false,
                    error: chargeResult.error
                });
            }
        }

        // Balance insufficient - create purchase intent and MP checkout
        const smaqNeeded = smaqPrice - currentBalance;
        const smaqToTopup = smaqNeeded + suggestExtraSmaqs;

        const intentService = new PurchaseIntentService(config);
        const intent = await intentService.createIntent({
            userEmail: email,
            userName,
            productType,
            productData,
            smaqRequired: smaqPrice,
            smaqTopup: smaqToTopup,
            walletObjectId
        });

        // Create MercadoPago preference
        const checkoutService = new TopupCheckoutService(config);
        const checkout = await checkoutService.createTopupPreference({
            intentId: intent.id,
            userEmail: email,
            userName,
            smaqAmount: smaqToTopup,
            productDescription: `${smaqToTopup} SMAQ para comprar ${productType}`
        });

        // Store MP preference ID in intent
        await intentService.setMpPreferenceId(intent.id, checkout.preferenceId);

        return res.status(200).json({
            success: true,
            action: 'topup_required',
            intentId: intent.id,
            currentBalance,
            smaqNeeded,
            smaqToTopup,
            arsAmount: checkout.arsAmount,
            checkoutUrl: checkoutService.isSandbox()
                ? checkout.sandboxInitPoint
                : checkout.initPoint,
            message: `Necesitás ${smaqNeeded} SMAQ más. Redirigiendo a MercadoPago...`
        });

    } catch (error) {
        console.error('SMAQ topup error:', error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Error interno'
        });
    }
}
