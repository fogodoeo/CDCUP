/**
 * supabase-bridge.js
 * Google Apps Script 서버 호출을 Supabase REST API 호출로 대체하는 브릿지 레이어.
 * 기존 HTML 파일에서 google.script.run.XXX() 호출을 supabase.XXX() 로 교체하면 동작.
 */

const SUPABASE_URL = 'https://iuwqjeecwepqyqqlzprf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1d3FqZWVjd2VwcXlxcWx6cHJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMTA3OTIsImV4cCI6MjA5Nzc4Njc5Mn0.psiAk4cqzjHqT6gP46m6nQM97nNsLEgc-a7K8BEAd_Y';

const _sbHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
};

async function _sbFetch(path, options = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const resp = await fetch(url, {
        headers: { ..._sbHeaders, ...(options.headers || {}) },
        ...options,
    });
    if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${await resp.text()}`);
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
}

// ── 체크리스트 포맷 변환 (GAS의 formatChecklist 이식) ──
function formatChecklist(raw) {
    if (!raw) return "";
    const labels = {
        gender: "성별", weight: "무게", birth: "출생", spot: "점", pin: "풀핀",
        size: "도살", wall: "월높이", color: "색감", activity: "활동성", feed: "먹이붙임", structure: "체형", memo: "비고"
    };
    const genderMap = { M: "수컷", F: "암컷", U: "미구분" };
    const yesNo = { O: "있음", X: "없음" };
    const parts = raw.split("|");
    const result = [];
    for (let i = 0; i < parts.length; i++) {
        const idx = parts[i].indexOf(":");
        if (idx < 0) continue;
        const k = parts[i].substring(0, idx);
        let v = parts[i].substring(idx + 1);
        const label = labels[k] || k;
        if (k === "gender") v = genderMap[v] || v;
        else if (k === "spot" || k === "pin") v = yesNo[v] || v;
        else if (["size", "wall", "color", "activity", "feed", "structure"].indexOf(k) >= 0) {
            const n = parseInt(v);
            let stars = "";
            for (let j = 0; j < 5; j++) stars += (j < n ? "★" : "☆");
            v = stars;
        }
        else if (k === "weight") v = v + "g";
        result.push(label + ": " + v);
    }
    return result.join(" / ");
}

// ── GAS 호환 함수들 ──

/**
 * 모든 개체 목록 가져오기 (= GAS getItems)
 */
async function getItems() {
    const rows = await _sbFetch('items?order=num.asc');
    
    // 부모 개체 정보 매핑
    const parents = await getParents();
    const parentMap = {};
    for (const p of parents) {
        parentMap[p.id] = p;
    }

    return (rows || []).map(r => ({
        row: r.id,
        company: r.company || '',
        num: r.num || 0,
        name: r.name || '',
        price: r.start_price || '',
        note: r.note || '',
        announce: r.announce || '',
        photoItem: r.photo_item || '',
        photoSire: r.photo_sire || (r.sire_id && parentMap[r.sire_id] ? parentMap[r.sire_id].photo_url : ''),
        photoDam: r.photo_dam || (r.dam_id && parentMap[r.dam_id] ? parentMap[r.dam_id].photo_url : ''),
        photoSibling: r.photo_sibling || '',
        status: r.status || '대기',
        sold_price: r.sold_price || '',
        winner: r.winner || '',
        winner_phone: r.winner_phone || '',
        start_time: r.start_time || '',
        bid_log: r.bid_log || '',
        checklist: r.checklist || '',
        checklist_parsed: r.checklist_parsed || '',
        sireId: r.sire_id || '',
        sire_id: r.sire_id || '',
        damId: r.dam_id || '',
        dam_id: r.dam_id || '',
        startPrice: r.start_price || '',
        soldPrice: r.sold_price || '',
        sireName: r.sire_id && parentMap[r.sire_id] ? parentMap[r.sire_id].name : '',
        damName: r.dam_id && parentMap[r.dam_id] ? parentMap[r.dam_id].name : '',
        shipping_type: r.shipping_type || '',
        shipping_company: r.shipping_company || '',
        shipping_region: r.shipping_region || '',
        shipping_cost: r.shipping_cost || 0,
        updated_at: r.updated_at || '',
        updatedAt: r.updated_at || ''
    }));
}

/**
 * 현재 진행 중인 경매 개체 (= GAS getActiveItem)
 */
async function getActiveItem() {
    const rows = await _sbFetch("items?status=eq.진행중&order=num.asc&limit=1");
    if (!rows || rows.length === 0) return null;
    const r = rows[0];

    const parents = await getParents();
    const parentMap = {};
    for (const p of parents) {
        parentMap[p.id] = p;
    }

    const hiddenPhotos = await getHiddenPhotos();

    return {
        row: r.id,
        num: r.num || 0,
        name: r.name || '',
        displayName: r.name || '',
        company: r.company || '',
        price: r.start_price || '',
        startPrice: r.start_price || '',
        note: r.note || '',
        announce: r.announce || '',
        photoItem: r.photo_item || '',
        photoSire: r.photo_sire || (r.sire_id && parentMap[r.sire_id] ? parentMap[r.sire_id].photo_url : ''),
        photoDam: r.photo_dam || (r.dam_id && parentMap[r.dam_id] ? parentMap[r.dam_id].photo_url : ''),
        photoSibling: r.photo_sibling || '',
        status: r.status || '',
        soldPrice: r.sold_price || '',
        sold_price: r.sold_price || '',
        winner: r.winner || '',
        winner_phone: r.winner_phone || '',
        start_time: r.start_time || '',
        bid_log: r.bid_log || '',
        checklist: r.checklist || '',
        checklist_parsed: r.checklist_parsed || '',
        sireId: r.sire_id || '',
        damId: r.dam_id || '',
        sireName: r.sire_id && parentMap[r.sire_id] ? parentMap[r.sire_id].name : '',
        damName: r.dam_id && parentMap[r.dam_id] ? parentMap[r.dam_id].name : '',
        hiddenPhotos: hiddenPhotos
    };
}

// ── 방송 송출 전용 경량 조회 ──
// 대기 중에는 updated_at 한 행만 확인하고, 경매 활동이 감지된 동안에만 전체 상태를 읽는다.
let _broadcastParentsCache = [];
let _broadcastParentsCacheAt = 0;
let _broadcastHiddenPhotosCache = [];
let _broadcastHiddenPhotosCacheAt = 0;

async function getAuctionPulse() {
    const rows = await _sbFetch('items?select=id,status,updated_at&order=updated_at.desc&limit=1');
    const row = rows && rows[0];
    return row ? {
        id: row.id,
        status: row.status || '',
        updatedAt: row.updated_at || ''
    } : { id: null, status: '', updatedAt: '' };
}

function _mapBroadcastItem(r) {
    return {
        row: r.id,
        company: r.company || '',
        num: r.num || 0,
        name: r.name || '',
        displayName: r.name || '',
        price: r.start_price || '',
        startPrice: r.start_price || '',
        note: r.note || '',
        announce: r.announce || '',
        photoItem: r.photo_item || '',
        photoSire: r.photo_sire || '',
        photoDam: r.photo_dam || '',
        photoSibling: r.photo_sibling || '',
        status: r.status || '대기',
        sold_price: r.sold_price || '',
        soldPrice: r.sold_price || '',
        winner: r.winner || '',
        winner_phone: r.winner_phone || '',
        start_time: r.start_time || '',
        startTime: r.start_time || '',
        bid_log: r.bid_log || '',
        bidLog: r.bid_log || '',
        checklist: r.checklist || '',
        checklist_parsed: r.checklist_parsed || '',
        sireId: r.sire_id || '',
        sire_id: r.sire_id || '',
        damId: r.dam_id || '',
        dam_id: r.dam_id || '',
        shipping_type: r.shipping_type || '',
        shipping_company: r.shipping_company || '',
        shipping_region: r.shipping_region || '',
        shipping_cost: r.shipping_cost || 0,
        updated_at: r.updated_at || '',
        updatedAt: r.updated_at || ''
    };
}

async function getBroadcastItems() {
    const rows = await _sbFetch('items?order=num.asc');
    return (rows || []).map(_mapBroadcastItem);
}

async function _getBroadcastParentsCached() {
    const now = Date.now();
    if (_broadcastParentsCacheAt && now - _broadcastParentsCacheAt < 60000) {
        return _broadcastParentsCache;
    }
    _broadcastParentsCache = await getParents();
    _broadcastParentsCacheAt = now;
    return _broadcastParentsCache;
}

async function _getBroadcastHiddenPhotosCached() {
    const now = Date.now();
    if (_broadcastHiddenPhotosCacheAt && now - _broadcastHiddenPhotosCacheAt < 5000) {
        return _broadcastHiddenPhotosCache;
    }
    _broadcastHiddenPhotosCache = await getHiddenPhotos();
    _broadcastHiddenPhotosCacheAt = now;
    return _broadcastHiddenPhotosCache;
}

async function enrichBroadcastItem(item) {
    if (!item) return null;
    const [parents, hiddenPhotos] = await Promise.all([
        _getBroadcastParentsCached(),
        _getBroadcastHiddenPhotosCached()
    ]);
    const parentMap = {};
    (parents || []).forEach(parent => { parentMap[parent.id] = parent; });
    const sire = item.sire_id ? parentMap[item.sire_id] : null;
    const dam = item.dam_id ? parentMap[item.dam_id] : null;
    return {
        ...item,
        photoSire: item.photoSire || (sire ? sire.photoUrl : '') || '',
        photoDam: item.photoDam || (dam ? dam.photoUrl : '') || '',
        sireName: sire ? sire.name : '',
        damName: dam ? dam.name : '',
        hiddenPhotos: hiddenPhotos || []
    };
}

/**
 * 비밀번호 상태 확인 (= GAS getAdminPwStatus)
 */
async function getAdminPwStatus() {
    const rows = await _sbFetch('config?key=eq.admin_pw');
    return { isSet: (rows && rows.length > 0 && !!rows[0].value) };
}

/**
 * 비밀번호 검증 (= GAS verifyAdmin)
 */
async function verifyAdmin(pw) {
    const rows = await _sbFetch('config?key=eq.admin_pw');
    if (!rows || rows.length === 0 || !rows[0].value) return true; // 비번 미설정 시 프리패스
    return rows[0].value === pw;
}

/**
 * 비밀번호 설정 (= GAS setAdminPw)
 */
async function setAdminPw(currentPw, newPw) {
    const status = await getAdminPwStatus();
    if (status.isSet) {
        const verified = await verifyAdmin(currentPw);
        if (!verified) return { success: false, error: "현재 비밀번호가 틀립니다" };
    }
    if (!newPw || newPw.length < 2) {
        return { success: false, error: "비밀번호는 2자 이상이어야 합니다" };
    }
    await _sbFetch('config', {
        method: 'POST',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify({ key: 'admin_pw', value: newPw }),
    });
    return { success: true };
}

/**
 * 개체 정보 업데이트 (= GAS updateItem)
 */
async function updateItem(row, data, pw) {
    const verified = await verifyAdmin(pw);
    if (!verified) return { success: false, error: "비밀번호 불일치" };

    const mapping = {
        company: 'company', num: 'num', name: 'name',
        price: 'start_price', startPrice: 'start_price', start_price: 'start_price',
        note: 'note', announce: 'announce',
        photoItem: 'photo_item', photo_item: 'photo_item',
        photoSire: 'photo_sire', photo_sire: 'photo_sire',
        photoDam: 'photo_dam', photo_dam: 'photo_dam',
        photoSibling: 'photo_sibling', photo_sibling: 'photo_sibling',
        status: 'status', soldPrice: 'sold_price', sold_price: 'sold_price',
        winner: 'winner', winner_phone: 'winner_phone',
        checklist: 'checklist', sireId: 'sire_id', damId: 'dam_id',
        shipping_type: 'shipping_type', shipping_company: 'shipping_company',
        shipping_region: 'shipping_region', shipping_cost: 'shipping_cost'
    };
    const payload = {};
    for (const [k, v] of Object.entries(data)) {
        if (mapping[k]) payload[mapping[k]] = v;
    }
    
    // checklist가 변경되었으면 파싱본도 자동 반영
    if (data.checklist !== undefined) {
        payload.checklist_parsed = formatChecklist(data.checklist);
    }

    await _sbFetch(`items?id=eq.${row}`, {
        method: 'PATCH',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(payload),
    });
    return { success: true };
}

/**
 * 배송 정보 업데이트 (낙찰자용 패스워드 없는 버전)
 */
async function updateItemShipping(row, shippingData) {
    const mapping = {
        shipping_type: 'shipping_type',
        shipping_company: 'shipping_company',
        shipping_region: 'shipping_region',
        shipping_cost: 'shipping_cost',
        status: 'status'
    };
    const payload = {};
    for (const [k, v] of Object.entries(shippingData)) {
        if (mapping[k] !== undefined) payload[mapping[k]] = v;
    }
    await _sbFetch(`items?id=eq.${row}`, {
        method: 'PATCH',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(payload),
    });
    return { success: true };
}

/**
 * 부모개체 ID 업데이트 (= GAS updateParentIds)
 */
async function updateParentIds(row, sireId, damId) {
    await _sbFetch(`items?id=eq.${row}`, {
        method: 'PATCH',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ sire_id: sireId || '', dam_id: damId || '' }),
    });
    return true;
}

/**
 * 단일 개체 삭제 (= GAS deleteItem)
 */
async function deleteItem(rowNum, pw) {
    const verified = await verifyAdmin(pw);
    if (!verified) return { success: false, error: "비밀번호 불일치" };

    // 진행중인 경매 검증
    const active = await _sbFetch("items?status=eq.진행중");
    if (active && active.length > 0) {
        return { success: false, error: '경매 진행중에는 삭제할 수 없습니다. 먼저 경매를 종료해주세요.' };
    }

    await _sbFetch(`items?id=eq.${rowNum}`, {
        method: 'DELETE',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal' }
    });
    return { success: true };
}

/**
 * 선택 개체 다중 삭제 (= GAS deleteItems)
 */
async function deleteItems(rows, pw) {
    const verified = await verifyAdmin(pw);
    if (!verified) return { success: false, error: "비밀번호 불일치" };
    if (!rows || rows.length === 0) return { success: true, count: 0 };

    const active = await _sbFetch("items?status=eq.진행중");
    if (active && active.length > 0) {
        return { success: false, error: '경매 진행중에는 삭제할 수 없습니다. 먼저 경매를 종료해주세요.' };
    }

    let count = 0;
    for (const r of rows) {
        await _sbFetch(`items?id=eq.${r}`, {
            method: 'DELETE',
            headers: { ..._sbHeaders, 'Prefer': 'return=minimal' }
        });
        count++;
    }
    return { success: true, count: count };
}

/**
 * 전체 개체 삭제 (= GAS deleteAll)
 */
async function deleteAll(pw) {
    const verified = await verifyAdmin(pw);
    if (!verified) return { success: false, error: "비밀번호 불일치" };

    const active = await _sbFetch("items?status=eq.진행중");
    if (active && active.length > 0) {
        return { success: false, error: '경매 진행중에는 전체 삭제를 할 수 없습니다. 먼저 경매를 종료해주세요.' };
    }

    // truncate/전체 삭제 수행을 위해 id가 0보다 큰 것 삭제
    await _sbFetch(`items?id=gt.0`, {
        method: 'DELETE',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal' }
    });
    return { success: true };
}

/**
 * 개체 일괄 등록 (= GAS registerBatch)
 */
async function registerBatch(itemsArray) {
    try {
        const existing = await _sbFetch('items?select=num');
        let maxNum = 0;
        if (existing && existing.length > 0) {
            maxNum = Math.max(...existing.map(r => parseInt(r.num) || 0));
        }

        const payloads = itemsArray.map((d, idx) => {
            const num = maxNum + idx + 1;
            return {
                company: d.company || "",
                num: num,
                name: d.name || "",
                start_price: d.startPrice || "",
                note: d.note || "",
                announce: d.announce || "",
                photo_item: d.photoItem || "",
                photo_sire: d.photoSire || "",
                photo_dam: d.photoDam || "",
                photo_sibling: d.photoSibling || "",
                status: "대기",
                checklist: d.checklist || "",
                checklist_parsed: formatChecklist(d.checklist || ""),
                sire_id: d.sireId || null,
                dam_id: d.damId || null
            };
        });

        if (payloads.length > 0) {
            await _sbFetch('items', {
                method: 'POST',
                headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
                body: JSON.stringify(payloads)
            });
        }
        return { success: true, count: payloads.length };
    } catch (e) {
        console.error("registerBatch error:", e);
        return { success: false, error: "데이터베이스 기록 중 오류가 발생했습니다." };
    }
}

/**
 * 균등 분산 순서 배정 (= GAS shuffleRoundRobin)
 */
async function shuffleRoundRobin(pw) {
    const verified = await verifyAdmin(pw);
    if (!verified) return { success: false, error: "비밀번호 불일치" };

    const active = await _sbFetch("items?status=eq.진행중");
    if (active && active.length > 0) {
        return { success: false, error: "경매 진행중에는 순서를 변경할 수 없습니다. 먼저 경매를 종료해주세요." };
    }

    const items = await _sbFetch('items');
    if (!items || items.length < 2) return { success: true, count: 0 };

    const total = items.length;
    const groups = {};
    const companies = [];
    for (let i = 0; i < total; i++) {
        const co = String(items[i].company || "");
        if (!groups[co]) { groups[co] = []; companies.push(co); }
        groups[co].push(items[i]);
    }

    const slots = [];
    for (const co of companies) {
        const coItems = groups[co];
        const cnt = coItems.length;
        const interval = total / cnt;
        const offset = Math.random() * interval;
        for (let j = 0; j < cnt; j++) {
            const pos = (j * interval + offset) % total;
            const jitter = (Math.random() - 0.5) * 0.8;
            slots.push({ pos: Math.max(0, pos + jitter), item: coItems[j] });
        }
    }

    slots.sort((a, b) => a.pos - b.pos);

    for (let idx = 0; idx < slots.length; idx++) {
        const it = slots[idx].item;
        await _sbFetch(`items?id=eq.${it.id}`, {
            method: 'PATCH',
            headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ num: idx + 1 }),
        });
    }

    return { success: true, count: total, companies: companies.length };
}

/**
 * 대진 슬롯 기준으로 경매 개체 목록을 다시 구성한다.
 * 선택된 개체의 상세/사진은 보존하고 코드·순서·경매/배송 상태만 초기화한다.
 */
async function rebuildTournamentItems(assignments, pw) {
    const verified = await verifyAdmin(pw);
    if (!verified) return { success: false, error: "비밀번호 불일치" };
    if (!Array.isArray(assignments) || assignments.length === 0) {
        return { success: false, error: "편성할 개체가 없습니다." };
    }

    const active = await _sbFetch("items?status=eq.진행중&select=id&limit=1");
    if (active && active.length > 0) {
        return { success: false, error: "경매 진행중에는 목록을 재구성할 수 없습니다. 먼저 경매를 종료해주세요." };
    }

    const ids = [];
    const seenIds = new Set();
    const seenCodes = new Set();
    const payloads = [];
    for (let idx = 0; idx < assignments.length; idx++) {
        const assignment = assignments[idx] || {};
        const id = Number(assignment.row);
        const code = String(assignment.code || "").trim().toUpperCase();
        if (!Number.isInteger(id) || id <= 0 || !/^[A-Z][1-4]$/.test(code)) {
            return { success: false, error: "개체 편성 데이터가 올바르지 않습니다." };
        }
        if (seenIds.has(id) || seenCodes.has(code)) {
            return { success: false, error: "같은 개체 또는 코드가 중복 선택되었습니다." };
        }
        seenIds.add(id);
        seenCodes.add(code);
        ids.push(id);
        payloads.push({
            id: id,
            company: String(assignment.company || "").trim(),
            num: idx + 1,
            name: code,
            status: "대기",
            sold_price: null,
            winner: "",
            winner_phone: "",
            start_time: null,
            bid_log: "",
            shipping_type: "",
            shipping_company: "",
            shipping_region: "",
            shipping_cost: 0
        });
    }

    const existing = await _sbFetch(`items?id=in.(${ids.join(',')})&select=id`);
    if (!existing || existing.length !== ids.length) {
        return { success: false, error: "선택한 개체 중 현재 목록에서 찾을 수 없는 항목이 있습니다. 새로고침 후 다시 시도해주세요." };
    }

    // 선택된 행을 한 번에 갱신한 뒤, 성공한 경우에만 나머지 행을 제거한다.
    await _sbFetch('items?on_conflict=id', {
        method: 'POST',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify(payloads)
    });
    await _sbFetch(`items?id=not.in.(${ids.join(',')})`, {
        method: 'DELETE',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal' }
    });
    return { success: true, count: payloads.length };
}

/**
 * 부모 개체 등록 (= GAS registerParent)
 */
async function registerParent(parentObj) {
    try {
        const payload = {
            id: parentObj.id,
            name: parentObj.name || "",
            morph: parentObj.morph || "",
            photo_url: parentObj.photoUrl || "",
            gender: parentObj.gender || "U",
            memo: parentObj.memo || "",
            company: parentObj.company || ""
        };
        await _sbFetch('parents', {
            method: 'POST',
            headers: { ..._sbHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
            body: JSON.stringify(payload)
        });
        return { success: true };
    } catch (e) {
        console.error("registerParent error:", e);
        return { success: false, error: e.message };
    }
}

/**
 * 숨김 사진 목록 가져오기 (= GAS getHiddenPhotos)
 */
async function getHiddenPhotos() {
    const rows = await _sbFetch('config?key=eq.hiddenPhotos&select=value');
    if (!rows || rows.length === 0) return [];
    const val = rows[0].value || '';
    return val ? val.split(',').filter(Boolean) : [];
}

/**
 * 숨김 사진 목록 저장 (= GAS setHiddenPhotos)
 */
async function setHiddenPhotos(keys) {
    const value = Array.isArray(keys) ? keys.join(',') : String(keys || '');
    await _sbFetch('config', {
        method: 'POST',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify({ key: 'hiddenPhotos', value }),
    });
}

/**
 * 호스트 설정 가져오기 (= GAS getHostConfig)
 */
async function getHostConfig() {
    const rows = await _sbFetch('config?key=eq.hostConfig&select=value');
    if (!rows || rows.length === 0) return {};
    try { return JSON.parse(rows[0].value || '{}'); } catch { return {}; }
}

/**
 * 호스트 설정 저장 (= GAS setHostConfig)
 */
async function setHostConfig(cfg) {
    await _sbFetch('config', {
        method: 'POST',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify({ key: 'hostConfig', value: JSON.stringify(cfg) }),
    });
}

/**
 * 사진 업로드 (= GAS uploadPhotos)
 * base64 데이터를 Supabase Storage에 업로드
 */
async function uploadPhotos(photos) {
    const results = [];
    for (const photo of photos) {
        const { data, filename, mimeType } = photo;
        let b64 = data || "";
        let mime = mimeType || 'image/jpeg';
        
        // data:image/... 접두어가 있으면 분리
        if (b64.indexOf(',') >= 0) {
            const parts = b64.split(',');
            const mimeMatch = parts[0].match(/:(.*?);/);
            if (mimeMatch) mime = mimeMatch[1];
            b64 = parts[1];
        }

        const ext = (filename || 'img.jpg').split('.').pop();
        const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

        // base64 → Blob
        const byteChars = atob(b64);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArray], { type: mime });

        const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/auction-photos/${name}`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': mime,
            },
            body: blob,
        });

        if (resp.ok) {
            const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/auction-photos/${name}`;
            results.push(publicUrl);
        } else {
            results.push('');
        }
    }
    return results;
}

/**
 * 배너 숨김 설정 (= GAS getBannerHidden / setBannerHidden)
 */
async function getBannerHidden() {
    const rows = await _sbFetch('config?key=eq.banner_hidden&select=value');
    return (rows && rows.length > 0) ? rows[0].value : '0';
}

async function setBannerHidden(hidden) {
    await _sbFetch('config', {
        method: 'POST',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify({ key: 'banner_hidden', value: String(hidden) }),
    });
}

async function getConfigMap() {
    const rows = await _sbFetch('config?select=*');
    const map = {};
    if (rows && rows.length > 0) {
        rows.forEach(r => {
            map[r.key] = r.value;
        });
    }
    return map;
}

async function updateConfigs(configMap) {
    const payloads = Object.keys(configMap).map(k => ({
        key: k,
        value: String(configMap[k])
    }));
    await _sbFetch('config', {
        method: 'POST',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify(payloads),
    });
}

/**
 * 부모개체 목록 (= GAS getParents)
 */
async function getParents() {
    const rows = await _sbFetch('parents?select=*');
    return (rows || []).map(r => ({
        id: r.id,
        name: r.name || "",
        morph: r.morph || "",
        photoUrl: r.photo_url || "",
        gender: r.gender || "U",
        memo: r.memo || "",
        company: r.company || ""
    }));
}

/**
 * 도도시 가격표 데이터 조회
 */
async function getDodosiData() {
    try {
        const resp = await fetch('dodosi_data.json');
        if (!resp.ok) throw new Error('dodosi_data.json 로드 실패');
        const data = await resp.json();
        return { success: true, data: data.items, updated: data.updated };
    } catch (e) {
        console.error('[SB] getDodosiData failed:', e);
        return { success: false, error: '도도시 가격표 로딩 오류: ' + e.message };
    }
}

/**
 * 파르게 가격표 데이터 조회
 */
async function getPargeData() {
    try {
        const resp = await fetch('parge_data.json');
        if (!resp.ok) throw new Error('parge_data.json 로드 실패');
        const data = await resp.json();
        return { success: true, data: data.data, updated: data.updated };
    } catch (e) {
        console.error('[SB] getPargeData failed:', e);
        return { success: false, error: '파르게 가격표 로딩 오류: ' + e.message };
    }
}

/**
 * 랩팡 가격표 데이터 조회
 */
async function getWrapangData() {
    try {
        const resp = await fetch('wrapang_data.json');
        if (!resp.ok) throw new Error('wrapang_data.json 로드 실패');
        const data = await resp.json();
        return { success: true, data: data.data, updated: data.updated };
    } catch (e) {
        console.error('[SB] getWrapangData failed:', e);
        return { success: false, error: '랩팡 가격표 로딩 오류: ' + e.message };
    }
}

// ── google.script.run 호환 래퍼 제거됨 ──
// 모든 HTML 파일이 이제 Supabase 함수를 직접 호출합니다.

console.log('[Supabase Bridge] Loaded — all functions available globally');
