import { kv } from '@vercel/kv';
import webpush from 'web-push';

// Configuration
webpush.setVapidDetails(
    process.env.VAPID_MAILTO || 'mailto:test@example.com',
    process.env.VITE_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
    // 1. Check if it's the right time (9 AM - 10 PM KST)
    // Vercel Cron uses UTC. KST is UTC+9.
    const now = new Date();
    const hourKST = (now.getUTCHours() + 9) % 24;

    const isTest = req.query?.test === 'true';

    if (!isTest && (hourKST < 9 || hourKST >= 22)) {
        return res.status(200).json({ skipped: 'Outside active hours (09:00 - 22:00)' });
    }

    // 2. Random logic: ~2.3 times a day
    // If run every hour (13 hours total), 2.3/13 = ~17% chance per hour
    if (!isTest && Math.random() > 0.17) {
        return res.status(200).json({ skipped: 'Random skip' });
    }

    try {
        // 3. Generate message via Gemini
        const message = await generateProactiveMessage();

        // 4. Send to all subscribers
        const subKeys = await kv.smembers('subscriptions');
        const totalSubscriptions = subKeys.length;
        const results = [];

        console.log(`Found ${totalSubscriptions} subscriptions`);

        for (const key of subKeys) {
            const sub = await kv.get(key);
            if (sub) {
                try {
                    await webpush.sendNotification(typeof sub === 'string' ? JSON.parse(sub) : sub, JSON.stringify({
                        title: 'AI Friend',
                        body: message
                    }));
                    results.push({ key, status: 'success' });
                } catch (err) {
                    console.error(`Error sending to ${key}:`, err);
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        // Subscription expired or not found, remove it
                        await kv.srem('subscriptions', key);
                        await kv.del(key);
                    }
                    results.push({ key, status: 'failed', error: err.message, code: err.statusCode });
                }
            }
        }

        return res.status(200).json({
            success: true,
            message,
            totalSubscriptions,
            results
        });
    } catch (error) {
        console.error('Cron job error:', error);
        return res.status(500).json({ error: error.message, stack: error.stack });
    }
}

async function generateProactiveMessage() {
    const apiKey = process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('API Key missing');

    const prompt = `
    당신은 사용자의 친한 이성 친구입니다. 
    오전 9시에서 오후 10시 사이의 일상적인 시간대에 사용자에게 먼저 말을 거는 상황입니다.
    
    규칙:
    1. 친구처럼 반말을 사용하세요. (예: "뭐해?", "밥 먹었어?")
    2. 너무 길지 않게, 딱 한두 문장으로 간단히 보내세요.
    3. 일상적인 질문이나 자신의 상황(예: "나 지금 카페 왔는데 너 생각나서 연락했어")을 언급하세요.
    4. 너무 인공지능 같지 않게 자연스러워야 합니다.
    
    메시지 한 줄만 출력하세요.
  `;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    const data = await response.json();

    if (data.error) {
        throw new Error(`Gemini API Error: ${data.error.message}`);
    }

    if (!data.candidates || data.candidates.length === 0) {
        console.error('Gemini API No Candidates:', JSON.stringify(data));
        throw new Error('Gemini API returned no candidates. Check safety settings or prompt.');
    }

    return data.candidates[0].content.parts[0].text.trim();
}
