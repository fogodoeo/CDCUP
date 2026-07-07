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

function pairs(raw) {
    const result = {};
    String(raw || '').split('|').forEach(part => {
        const index = part.indexOf(':');
        if (index > 0) result[part.slice(0, index)] = part.slice(index + 1);
    });
    return result;
}

function stamp() {
    const now = new Date();
    return now.toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
}

async function main() {
    const rows = await sb('items?select=*&order=num.asc');
    const legacySold = rows.filter(row => {
        const meta = pairs(row.checklist);
        const hasSoldInfo = row.status === '낙찰' || row.sold_price || row.winner || row.winner_phone;
        return hasSoldInfo && !meta._auction && Number(row.num) <= 32;
    });
    const activeRows = rows.filter(row => {
        const meta = pairs(row.checklist);
        return ['tournament', 'event'].includes(meta._auction) && Number(meta._label) >= 1 && Number(meta._label) <= 20;
    });

    if (legacySold.length) {
        const backupPath = path.join(__dirname, `cdcup-previous-sold-backup-${stamp()}.json`);
        fs.writeFileSync(backupPath, JSON.stringify({
            createdAt: new Date().toISOString(),
            reason: 'Removed previous CDCUP sold rows from the current 4강/event operating list.',
            rows: legacySold,
        }, null, 2), 'utf8');
        console.log(`backup=${backupPath}`);
    }

    for (const row of legacySold) {
        await sb(`items?id=eq.${row.id}`, { method: 'DELETE' });
    }

    const sortedActive = activeRows
        .map(row => ({ row, meta: pairs(row.checklist) }))
        .sort((a, b) => Number(a.meta._label) - Number(b.meta._label));
    for (const { row, meta } of sortedActive) {
        const label = Number(meta._label);
        if (Number(row.num) !== label) {
            await sb(`items?id=eq.${row.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ num: label }),
            });
        }
    }

    const after = await sb('items?select=id,num,company,name,status,sold_price,winner,winner_phone,checklist&order=num.asc');
    const summary = after.map(row => {
        const meta = pairs(row.checklist);
        return {
            id: row.id,
            num: row.num,
            label: meta._label || '',
            type: meta._auction || '',
            stage: meta._stage || '',
            company: row.company,
            name: row.name,
            status: row.status,
            sold_price: row.sold_price,
            winner: row.winner,
            winner_phone: row.winner_phone,
        };
    });
    console.table(summary);
    console.log(JSON.stringify({
        removedLegacySold: legacySold.length,
        currentRows: after.length,
        rowsWithSoldInfo: after.filter(row => row.status === '낙찰' || row.sold_price || row.winner || row.winner_phone).length,
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
