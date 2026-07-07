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

const DRY_RUN = process.argv.includes('--dry-run');

const final4Rows = [
    { label: 1, company: '베누스', name: '1', birth: '25.07.28', gender: 'F', note: '릴잔틱' },
    { label: 2, company: '비송', name: '1', birth: '26.05.05', gender: 'U', note: '' },
    { label: 3, company: '히꼬', name: '1', birth: '26.06.14', gender: 'U', note: '헷초 / 100헷 초초' },
    { label: 4, company: '베누스', name: '3', birth: '26.05.20', gender: 'U', note: '초초 / 점 있음' },
    { label: 5, company: '비송', name: '2', birth: '26.04.22', gender: 'U', note: '' },
    { label: 6, company: '자몽', name: '1', birth: '26.05.14', gender: 'U', note: '' },
    { label: 7, company: '히꼬', name: '3', birth: '26.05.31', gender: 'U', note: '헷초 / 100헷 초초' },
    { label: 8, company: '자몽', name: '3', birth: '26.04.27', gender: 'U', note: '' },
    { label: 9, company: '베누스', name: '2', birth: '25.09.15', gender: 'M', note: '릴헷초 / 릴리 100헷 초초' },
    { label: 10, company: '비송', name: '3', birth: '26.06.16', gender: 'U', note: '' },
    { label: 11, company: '자몽', name: '2', birth: '26.05.28', gender: 'U', note: '점 있음' },
    { label: 12, company: '히꼬', name: '2', birth: '26.06.25', gender: 'U', note: '헷초 / 100헷 초초' },
].map(row => ({ ...row, auctionType: 'tournament', stage: 4 }));

const eventRows = ['달마도', '혜성게코'].flatMap((company, companyIndex) => (
    [1, 2, 3, 4].map((name, index) => ({
        label: 13 + companyIndex * 4 + index,
        company,
        name: String(name),
        birth: '',
        gender: '',
        note: '토너먼트 종료 후 이벤트 매치',
        auctionType: 'event',
        stage: 0,
    }))
));

const targets = [...final4Rows, ...eventRows];

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

function parseChecklist(raw) {
    const result = {};
    String(raw || '').split('|').forEach(part => {
        const index = part.indexOf(':');
        if (index > 0) result[part.slice(0, index)] = part.slice(index + 1);
    });
    return result;
}

function formatChecklist(raw) {
    if (!raw) return '';
    const labels = {
        gender: '성별',
        weight: '무게',
        birth: '출생',
        spot: '점',
        pin: '풀핀',
        size: '도살',
        wall: '월높이',
        color: '색감',
        activity: '활동성',
        feed: '먹이붙임',
        structure: '체형',
        memo: '비고',
    };
    const genderMap = { M: '수컷', F: '암컷', U: '미구분' };
    const yesNo = { O: '있음', X: '없음' };
    return raw.split('|').map(part => {
        const index = part.indexOf(':');
        if (index < 0) return '';
        const key = part.slice(0, index);
        if (key.charAt(0) === '_') return '';
        let value = part.slice(index + 1);
        if (!value) return '';
        if (key === 'gender') value = genderMap[value] || value;
        else if (key === 'spot' || key === 'pin') value = yesNo[value] || value;
        else if (key === 'weight') value = value + 'g';
        return `${labels[key] || key}: ${value}`;
    }).filter(Boolean).join(' / ');
}

function checklistFor(target) {
    const parts = [];
    if (target.gender) parts.push(`gender:${target.gender}`);
    if (target.birth) parts.push(`birth:${target.birth}`);
    if (target.note) parts.push(`memo:${target.note}`);
    parts.push(`_auction:${target.auctionType}`);
    parts.push(`_label:${target.label}`);
    if (target.stage) parts.push(`_stage:${target.stage}`);
    return parts.join('|');
}

function buildPayload(target, physicalNum) {
    const checklist = checklistFor(target);
    return {
        num: physicalNum,
        company: target.company,
        name: target.name,
        start_price: '',
        note: target.note || '',
        announce: '',
        photo_item: '',
        photo_sire: '',
        photo_dam: '',
        photo_sibling: '',
        status: '대기',
        sold_price: null,
        winner: '',
        winner_phone: '',
        start_time: null,
        bid_log: '',
        checklist,
        checklist_parsed: formatChecklist(checklist),
        sire_id: null,
        dam_id: null,
        shipping_type: '',
        shipping_company: '',
        shipping_region: '',
        shipping_cost: 0,
    };
}

function findExisting(rows, target) {
    return rows.find(row => {
        const meta = parseChecklist(row.checklist);
        return row.status !== '낙찰'
            && row.company === target.company
            && String(row.name) === target.name
            && String(meta._auction || '') === target.auctionType
            && String(meta._label || '') === String(target.label);
    }) || rows.find(row => {
        const meta = parseChecklist(row.checklist);
        return row.status !== '낙찰'
            && row.company === target.company
            && String(row.name) === target.name
            && (!meta._auction || String(meta._auction) === target.auctionType)
            && (!meta._label || String(meta._label) === String(target.label));
    });
}

async function main() {
    const rows = await sb('items?select=id,num,company,name,status,checklist&order=num.asc');
    let insertNum = rows.reduce((max, row) => Math.max(max, Number(row.num) || 0), 0);
    const plan = targets.map(target => {
        const existing = findExisting(rows, target);
        const physicalNum = existing ? Number(existing.num) : ++insertNum;
        return {
            action: existing ? 'PATCH' : 'POST',
            id: existing ? existing.id : null,
            physicalNum,
            target,
            payload: buildPayload(target, physicalNum),
        };
    });

    console.table(plan.map(item => ({
        action: item.action,
        id: item.id || '',
        num: item.physicalNum,
        label: item.target.label,
        type: item.target.auctionType,
        stage: item.target.stage || '',
        company: item.target.company,
        name: item.target.name,
        note: item.target.note,
    })));
    console.log(JSON.stringify({
        dryRun: DRY_RUN,
        total: plan.length,
        inserts: plan.filter(item => item.action === 'POST').length,
        updates: plan.filter(item => item.action === 'PATCH').length,
    }, null, 2));

    if (DRY_RUN) return;

    const inserts = plan.filter(item => item.action === 'POST').map(item => item.payload);
    const updates = plan.filter(item => item.action === 'PATCH');
    const changed = [];
    if (inserts.length) {
        const inserted = await sb('items', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(inserts),
        });
        changed.push(...inserted.map(row => ({ action: 'POST', id: row.id, num: row.num, company: row.company, name: row.name })));
    }
    for (const item of updates) {
        const [updated] = await sb(`items?id=eq.${item.id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(item.payload),
        });
        changed.push({ action: 'PATCH', id: updated.id, num: updated.num, company: updated.company, name: updated.name });
    }
    console.log(JSON.stringify({ changed }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
