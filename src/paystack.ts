import axios from 'axios';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

const paystack = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

export async function initializeTransaction(email: string, amount: number, metadata: any, callbackUrl: string) {
  try {
    const response = await paystack.post('/transaction/initialize', {
      email,
      amount, // in kobo or cents
      metadata,
      callback_url: callbackUrl,
    });
    return response.data.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || 'Paystack initialization failed');
  }
}

export async function verifyTransaction(reference: string) {
  try {
    const response = await paystack.get(`/transaction/verify/${reference}`);
    return response.data.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || 'Paystack verification failed');
  }
}

export async function createSubscription(customerCode: string, planCode: string) {
  try {
    const response = await paystack.post('/subscription', {
      customer: customerCode,
      plan: planCode,
    });
    return response.data.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || 'Paystack subscription creation failed');
  }
}

export async function cancelSubscription(subscriptionCode: string, emailToken: string) {
  try {
    const response = await paystack.post('/subscription/disable', {
      code: subscriptionCode,
      token: emailToken,
    });
    return response.data.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || 'Paystack subscription cancellation failed');
  }
}

export async function getSubscription(subscriptionCode: string) {
  try {
    const response = await paystack.get(`/subscription/${subscriptionCode}`);
    return response.data.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || 'Paystack subscription retrieval failed');
  }
}
