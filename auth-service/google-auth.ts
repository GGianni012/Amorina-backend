/**
 * Amorina Club - Google Authentication Service
 * Handle Google OAuth for user login
 */

import type { SubscriptionType, User, AmorinConfig } from '../core';
import { SubscriptionSyncService } from '../google-sheets-service';

// Google Auth configuration
export interface GoogleAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

// User info from Google
export interface GoogleUserInfo {
    id: string;
    email: string;
    name: string;
    picture?: string;
}

// Auth result after login
export interface AuthResult {
    user: User;
    isNewUser: boolean;
}

export class GoogleAuthService {
    private subscriptionService: SubscriptionSyncService;

    constructor(config: AmorinConfig) {
        this.subscriptionService = new SubscriptionSyncService(config);
    }

    /**
     * Get Google OAuth URL
     * This is typically called from the frontend to redirect the user
     */
    getAuthUrl(clientId: string, redirectUri: string, state?: string): string {
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid email profile',
            access_type: 'offline',
            prompt: 'consent',
        });

        if (state) {
            params.set('state', state);
        }

        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    /**
     * Exchange authorization code for tokens
     * This should be called from the backend
     */
    async exchangeCodeForTokens(
        code: string,
        authConfig: GoogleAuthConfig
    ): Promise<{ accessToken: string; refreshToken?: string; idToken?: string }> {
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: authConfig.clientId,
                client_secret: authConfig.clientSecret,
                code,
                grant_type: 'authorization_code',
                redirect_uri: authConfig.redirectUri,
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to exchange code for tokens');
        }

        const data = await response.json();
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            idToken: data.id_token,
        };
    }

    /**
     * Get user info from Google using access token
     */
    async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new Error('Failed to get user info');
        }

        const data = await response.json();
        return {
            id: data.id,
            email: data.email,
            name: data.name,
            picture: data.picture,
        };
    }

    /**
     * Process login: get user info and subscription status
     */
    async processLogin(googleUserInfo: GoogleUserInfo): Promise<AuthResult> {
        // Get subscription type from Google Sheets
        const subscriptionType = await this.subscriptionService.getUserSubscriptionType(
            googleUserInfo.email
        );

        const user: User = {
            email: googleUserInfo.email,
            name: googleUserInfo.name,
            picture: googleUserInfo.picture,
            subscription: subscriptionType,
            totalReservations: 0, // Would need to query reservations sheet
        };

        return {
            user,
            isNewUser: subscriptionType === 'FREE',
        };
    }

    /**
     * Create a simple JWT-like token for session management
     * In production, use a proper JWT library
     */
    createSessionToken(user: User, secret: string): string {
        const payload = {
            email: user.email,
            name: user.name,
            subscription: user.subscription,
            iat: Date.now(),
            exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        };

        const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
        const signature = this.simpleSign(base64Payload, secret);

        return `${base64Payload}.${signature}`;
    }

    /**
     * Verify and decode a session token
     */
    verifySessionToken(token: string, secret: string): User | null {
        try {
            const [base64Payload, signature] = token.split('.');

            if (this.simpleSign(base64Payload, secret) !== signature) {
                return null;
            }

            const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());

            if (payload.exp < Date.now()) {
                return null;
            }

            return {
                email: payload.email,
                name: payload.name,
                subscription: payload.subscription,
                totalReservations: 0,
            };
        } catch {
            return null;
        }
    }

    /**
     * Simple signing function (use proper HMAC in production)
     */
    private simpleSign(data: string, secret: string): string {
        let hash = 0;
        const combined = data + secret;
        for (let i = 0; i < combined.length; i++) {
            const char = combined.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }
}
