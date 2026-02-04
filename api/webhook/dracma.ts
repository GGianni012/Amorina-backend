/**
 * DRACMA Transaction Webhook
 * Called by Supabase when a transaction is recorded
 * Syncs the transaction to Google Sheets
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { DracmaSyncService, type DracmaTransaction } from '../../google-sheets-service/dracma-sync';
import { getConfig } from '../../core';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const config = getConfig();
        const dracmaSync = new DracmaSyncService(config);

        // Supabase webhook payload format
        const { type, table, record, old_record } = req.body;

        // Only process inserts to dracma_transactions table
        if (table !== 'dracma_transactions' || type !== 'INSERT') {
            return res.status(200).json({ message: 'Ignored - not a dracma transaction insert' });
        }

        // Get citizen info (would need to query Supabase or include in webhook)
        const transaction: DracmaTransaction = {
            date: new Date(record.created_at).toLocaleString('es-AR'),
            email: record.citizen_email || 'N/A',
            name: record.citizen_name || 'N/A',
            type: record.transaction_type,
            amount: parseFloat(record.amount),
            description: record.description || '',
            resultingBalance: parseFloat(record.resulting_balance) || 0,
            membershipType: record.membership_type || 'N/A'
        };

        await dracmaSync.logTransaction(transaction);

        return res.status(200).json({
            success: true,
            message: 'Transaction logged to Google Sheets'
        });

    } catch (error) {
        console.error('DRACMA webhook error:', error);
        return res.status(500).json({
            error: 'Failed to sync transaction',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
