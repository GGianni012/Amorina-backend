/**
 * DRACMA Transactions - Google Sheets Sync
 * Syncs DRACMA transactions to Google Sheets for admin visibility
 */

import { SheetsClient } from './sheets-client';
import type { AmorinConfig } from '../core';

const DRACMA_SHEET_NAME = 'DRACMAS';
const DRACMA_HEADERS = [
    'Fecha',
    'Email',
    'Nombre',
    'Tipo',
    'Monto',
    'Descripción',
    'Saldo Resultante',
    'Ciudadanía'
];

export interface DracmaTransaction {
    date: string;
    email: string;
    name: string;
    type: 'acreditacion' | 'consumo' | 'cashback' | 'evaporacion';
    amount: number;
    description: string;
    resultingBalance: number;
    membershipType: string;
}

export class DracmaSyncService {
    private sheetsClient: SheetsClient;

    constructor(config: AmorinConfig) {
        this.sheetsClient = new SheetsClient(config);
    }

    /**
     * Initialize the DRACMAS sheet if it doesn't exist
     */
    async initializeSheet(): Promise<void> {
        const exists = await this.sheetsClient.sheetExists(DRACMA_SHEET_NAME);
        if (!exists) {
            await this.sheetsClient.createSheet(DRACMA_SHEET_NAME, DRACMA_HEADERS);
            console.log(`Created ${DRACMA_SHEET_NAME} sheet`);
        }
    }

    /**
     * Log a DRACMA transaction to the sheet
     */
    async logTransaction(transaction: DracmaTransaction): Promise<void> {
        await this.initializeSheet();

        const typeLabels: Record<string, string> = {
            'acreditacion': '💰 Acreditación',
            'consumo': '🍽️ Consumo',
            'cashback': '↩️ Cashback',
            'evaporacion': '💨 Evaporación'
        };

        const row = [
            transaction.date,
            transaction.email,
            transaction.name || 'N/A',
            typeLabels[transaction.type] || transaction.type,
            transaction.amount.toString(),
            transaction.description,
            transaction.resultingBalance.toString(),
            transaction.membershipType
        ];

        await this.sheetsClient.appendRow(DRACMA_SHEET_NAME, row);
    }

    /**
     * Log multiple transactions (batch)
     */
    async logTransactions(transactions: DracmaTransaction[]): Promise<void> {
        for (const tx of transactions) {
            await this.logTransaction(tx);
        }
    }

    /**
     * Get all transactions from sheet
     */
    async getTransactions(): Promise<DracmaTransaction[]> {
        await this.initializeSheet();

        const data = await this.sheetsClient.readSheet(DRACMA_SHEET_NAME);

        // Skip header row
        return data.slice(1).map(row => ({
            date: row[0] || '',
            email: row[1] || '',
            name: row[2] || '',
            type: row[3] as DracmaTransaction['type'],
            amount: parseFloat(row[4]) || 0,
            description: row[5] || '',
            resultingBalance: parseFloat(row[6]) || 0,
            membershipType: row[7] || ''
        }));
    }
}

export default DracmaSyncService;
