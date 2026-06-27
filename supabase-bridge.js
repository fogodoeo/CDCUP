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
        checklist: 'checklist', sireId: 'sire_id', damId: 'dam_id'
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

// ── google.script.run 호환 래퍼 제거됨 ──
// 모든 HTML 파일이 이제 Supabase 함수를 직접 호출합니다.

console.log('[Supabase Bridge] Loaded — all functions available globally');

