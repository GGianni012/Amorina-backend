/**
 * Amorina Club - Subscription Payments
 * Handle recurring payments for subscriptions
 */

import { MercadoPagoConfig, PreApproval } from 'mercadopago';
import type { AmorinConfig, SubscriptionType } from '../core';
import { DEFAULT_PRICING } from '../core';

export interface SubscriptionPlan {
    type: SubscriptionType;
    name: string;
    price: number;
    benefits: string[];
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
    {
        type: 'SUPPORTER',
        name: 'Supporter',
        price: DEFAULT_PRICING.subscriptions.SUPPORTER.monthlyPrice,
        benefits: ['20% de descuento en todas las entradas', 'Acceso anticipado a reservas'],
    },
    {
        type: 'VIP',
        name: 'VIP',
        price: DEFAULT_PRICING.subscriptions.VIP.monthlyPrice,
        benefits: ['Entradas gratis ilimitadas', 'Acceso anticipado a reservas', 'Asiento preferencial'],
    },
];

export interface SubscriptionResult {
    preApprovalId: string;
    initPoint: string;
    subscriptionType: SubscriptionType;
}

export class SubscriptionPaymentService {
    private client: MercadoPagoConfig;
    private config: AmorinConfig;

    constructor(config: AmorinConfig) {
        this.config = config;
        this.client = new MercadoPagoConfig({
            accessToken: config.mercadopago.accessToken,
        });
    }

    /**
     * Create a subscription (preapproval) for a user
     */
    async createSubscription(
        userEmail: string,
        userName: string,
        subscriptionType: SubscriptionType
    ): Promise<SubscriptionResult> {
        if (subscriptionType === 'FREE') {
            throw new Error('Cannot create a paid subscription for FREE type');
        }

        const plan = SUBSCRIPTION_PLANS.find((p) => p.type === subscriptionType);
        if (!plan) {
            throw new Error(`Invalid subscription type: ${subscriptionType}`);
        }

        const preApproval = new PreApproval(this.client);

        const result = await preApproval.create({
            body: {
                payer_email: userEmail,
                back_url: `${this.config.urls.baseUrl}/suscripcion/resultado`,
                reason: `Suscripción ${plan.name} - Amorina Club`,
                auto_recurring: {
                    frequency: 1,
                    frequency_type: 'months',
                    transaction_amount: plan.price,
                    currency_id: 'ARS',
                },
                external_reference: `SUB-${userEmail}-${subscriptionType}`,
            },
        });

        return {
            preApprovalId: result.id!,
            initPoint: result.init_point!,
            subscriptionType,
        };
    }

    /**
     * Cancel a subscription
     */
    async cancelSubscription(preApprovalId: string): Promise<void> {
        const preApproval = new PreApproval(this.client);

        await preApproval.update({
            id: preApprovalId,
            body: {
                status: 'cancelled',
            },
        });
    }

    /**
     * Get subscription status
     */
    async getSubscriptionStatus(preApprovalId: string): Promise<string> {
        const preApproval = new PreApproval(this.client);
        const result = await preApproval.get({ id: preApprovalId });
        return result.status || 'unknown';
    }

    /**
     * Get available plans
     */
    getPlans(): SubscriptionPlan[] {
        return SUBSCRIPTION_PLANS;
    }
}
