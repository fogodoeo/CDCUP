const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, 'supabase-bridge.js'), 'utf8');
const SUPABASE_URL = bridge.match(/const SUPABASE_URL = '([^']+)'/)[1];
const SUPABASE_KEY = bridge.match(/const SUPABASE_KEY = '([^']+)'/)[1];
const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
};

async function sb(pathname, options = {}) {
    const optionHeaders = options.headers || {};
    const requestOptions = { ...options };
    delete requestOptions.headers;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
        ...requestOptions,
        headers: { ...headers, ...optionHeaders },
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

function setLabel(checklist, label) {
    const parts = String(checklist || '')
        .split('|')
        .filter(Boolean)
        .filter(part => !part.startsWith('_label:'));
    const auctionIndex = parts.findIndex(part => part.startsWith('_auction:'));
    if (auctionIndex >= 0) parts.splice(auctionIndex + 1, 0, `_label:${label}`);
    else parts.push(`_label:${label}`);
    return parts.join('|');
}

async function main() {
    const rows = await sb('items?select=id,num,company,name,status,checklist,winner,winner_phone,sold_price&order=num.asc');
    const byKey = new Map(rows.map(row => [`${row.company}|${row.name}`, row]));
    const plan = [
        { company: '달마도', name: '1', label: 13 },
        { company: '혜성게코', name: '1', label: 14 },
        { company: '달마도', name: '2', label: 15 },
        { company: '혜성게코', name: '2', label: 16 },
        { company: '달마도', name: '3', label: 17 },
        { company: '혜성게코', name: '3', label: 18 },
        { company: '달마도', name: '4', label: 19 },
        { company: '혜성게코', name: '4', label: 20 },
    ];

    for (const item of plan) {
        const row = byKey.get(`${item.company}|${item.name}`);
        if (!row) throw new Error(`missing ${item.company} ${item.name}`);
        await sb(`items?id=eq.${row.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
                num: item.label,
                checklist: setLabel(row.checklist, item.label),
            }),
        });
    }

    const after = await sb('items?select=id,num,company,name,status,checklist,winner,winner_phone,sold_price&num=gte.13&num=lte.20&order=num.asc');
    console.table(after.map(row => ({
        id: row.id,
        num: row.num,
        company: row.company,
        name: row.name,
        status: row.status,
        hasSoldInfo: Boolean(row.winner || row.winner_phone || row.sold_price),
        checklist: row.checklist,
    })));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
