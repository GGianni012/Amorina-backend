/**
 * Amorina Club - Google Sheets Client
 * Low-level Google Sheets API wrapper
 */

import { google, sheets_v4 } from 'googleapis';
import type { AmorinConfig } from '../core';

export class SheetsClient {
    private sheets: sheets_v4.Sheets;
    private spreadsheetId: string;

    constructor(config: AmorinConfig) {
        const auth = new google.auth.JWT({
            email: config.googleSheets.credentials.client_email,
            key: config.googleSheets.credentials.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        this.sheets = google.sheets({ version: 'v4', auth });
        this.spreadsheetId = config.googleSheets.spreadsheetId;
    }

    /**
     * Get all sheet names in the spreadsheet
     */
    async getSheetNames(): Promise<string[]> {
        const response = await this.sheets.spreadsheets.get({
            spreadsheetId: this.spreadsheetId,
        });

        return response.data.sheets?.map((s) => s.properties?.title || '') || [];
    }

    /**
     * Check if a sheet exists
     */
    async sheetExists(sheetName: string): Promise<boolean> {
        const names = await this.getSheetNames();
        return names.includes(sheetName);
    }

    /**
     * Create a new sheet with headers
     */
    async createSheet(sheetName: string, headers: string[]): Promise<void> {
        // Add the sheet
        await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
                requests: [
                    {
                        addSheet: {
                            properties: {
                                title: sheetName,
                            },
                        },
                    },
                ],
            },
        });

        // Add headers
        if (headers.length > 0) {
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `'${sheetName}'!A1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [headers],
                },
            });
        }
    }

    /**
     * Read all values from a sheet
     */
    async readSheet(sheetName: string): Promise<string[][]> {
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `'${sheetName}'`,
        });

        return (response.data.values as string[][]) || [];
    }

    /**
     * Read a specific range from a sheet
     */
    async readRange(range: string): Promise<string[][]> {
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range,
        });

        return (response.data.values as string[][]) || [];
    }

    /**
     * Append a row to a sheet
     */
    async appendRow(sheetName: string, row: (string | number | null)[]): Promise<void> {
        await this.sheets.spreadsheets.values.append({
            spreadsheetId: this.spreadsheetId,
            range: `'${sheetName}'!A1`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: [row.map((v) => (v === null ? '' : String(v)))],
            },
        });
    }

    /**
     * Update a specific cell
     */
    async updateCell(sheetName: string, cell: string, value: string | number): Promise<void> {
        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `'${sheetName}'!${cell}`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [[String(value)]],
            },
        });
    }

    /**
     * Update multiple cells in a range
     */
    async updateRange(
        sheetName: string,
        startCell: string,
        values: (string | number | null)[][]
    ): Promise<void> {
        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `'${sheetName}'!${startCell}`,
            valueInputOption: 'RAW',
            requestBody: {
                values: values.map((row) => row.map((v) => (v === null ? '' : String(v)))),
            },
        });
    }

    /**
     * Find a row by value in a specific column
     * Returns the row index (1-based) or null if not found
     */
    async findRowByValue(
        sheetName: string,
        columnIndex: number,
        value: string
    ): Promise<number | null> {
        const data = await this.readSheet(sheetName);

        for (let i = 0; i < data.length; i++) {
            if (data[i][columnIndex] === value) {
                return i + 1; // 1-based row number
            }
        }

        return null;
    }

    /**
     * Update a specific row
     */
    async updateRow(
        sheetName: string,
        rowNumber: number,
        values: (string | number | null)[]
    ): Promise<void> {
        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `'${sheetName}'!A${rowNumber}`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [values.map((v) => (v === null ? '' : String(v)))],
            },
        });
    }

    /**
     * Get spreadsheet ID
     */
    getSpreadsheetId(): string {
        return this.spreadsheetId;
    }
}
