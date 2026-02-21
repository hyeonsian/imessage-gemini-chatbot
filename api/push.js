import { process } from 'node:process';
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    if (req.method === 'POST') {
        const subscription = req.body;

        // Store subscription in Vercel KV
        // We use a SET to store unique subscriptions
        const subKey = `sub:${subscription.endpoint}`;
        await kv.set(subKey, JSON.stringify(subscription));
        // Also add to a list of all subscriptions for the cron job
        await kv.sadd('subscriptions', subKey);

        return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
