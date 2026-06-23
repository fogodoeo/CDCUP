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

// ── GAS 호환 함수들 ──

/**
 * 모든 개체 목록 가져오기 (= GAS getItems)
 */
async function getItems() {
    const rows = await _sbFetch('items?order=num.asc');
    return (rows || []).map(r => ({
        row: r.id,
        company: r.company || '',
        num: r.num || 0,
        name: r.name || '',
        price: r.start_price || '',
        note: r.note || '',
        announce: r.announce || '',
        photoItem: r.photo_item || '',
        photoSire: r.photo_sire || '',
        photoDam: r.photo_dam || '',
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
    }));
}

/**
 * 현재 진행 중인 경매 개체 (= GAS getActiveItem)
 */
async function getActiveItem() {
    const rows = await _sbFetch("items?status=eq.진행&order=num.asc&limit=1");
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
        row: r.id,
        company: r.company || '',
        num: r.num || 0,
        name: r.name || '',
        price: r.start_price || '',
        note: r.note || '',
        announce: r.announce || '',
        photoItem: r.photo_item || '',
        photoSire: r.photo_sire || '',
        photoDam: r.photo_dam || '',
        photoSibling: r.photo_sibling || '',
        status: r.status || '',
        sold_price: r.sold_price || '',
        winner: r.winner || '',
        winner_phone: r.winner_phone || '',
        start_time: r.start_time || '',
        bid_log: r.bid_log || '',
        checklist: r.checklist || '',
        checklist_parsed: r.checklist_parsed || '',
        sireId: r.sire_id || '',
        damId: r.dam_id || '',
    };
}

/**
 * 개체 정보 업데이트 (= GAS updateItem)
 */
async function updateItem(row, data, pw) {
    const mapping = {
        company: 'company', num: 'num', name: 'name',
        price: 'start_price', start_price: 'start_price',
        note: 'note', announce: 'announce',
        photoItem: 'photo_item', photo_item: 'photo_item',
        photoSire: 'photo_sire', photo_sire: 'photo_sire',
        photoDam: 'photo_dam', photo_dam: 'photo_dam',
        photoSibling: 'photo_sibling', photo_sibling: 'photo_sibling',
        status: 'status', sold_price: 'sold_price',
        winner: 'winner', winner_phone: 'winner_phone',
        checklist: 'checklist', checklist_parsed: 'checklist_parsed',
    };
    const payload = {};
    for (const [k, v] of Object.entries(data)) {
        if (mapping[k]) payload[mapping[k]] = v;
    }
    await _sbFetch(`items?id=eq.${row}`, {
        method: 'PATCH',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(payload),
    });
    return true;
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
        const ext = (filename || 'img.jpg').split('.').pop();
        const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const mime = mimeType || 'image/jpeg';

        // base64 → Blob
        const byteChars = atob(data);
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

/**
 * 부모개체 목록 (= GAS getParents)
 */
async function getParents() {
    return await _sbFetch('parents?order=created_at.desc') || [];
}

// ── google.script.run 호환 래퍼 ──
// 기존 HTML에서 google.script.run.withSuccessHandler(fn).functionName(args) 패턴 지원

if (typeof google === 'undefined') window.google = {};
if (!google.script) google.script = {};
if (!google.script.url) {
    google.script.url = {
        getLocation: function(cb) {
            cb({ parameter: Object.fromEntries(new URLSearchParams(window.location.search)) });
        }
    };
}
if (!google.script.run) {
    const _fns = {
        getItems, getActiveItem, updateItem, updateParentIds,
        getHiddenPhotos, setHiddenPhotos, getHostConfig, setHostConfig,
        uploadPhotos, getBannerHidden, setBannerHidden, getParents,
    };

    google.script.run = new Proxy({}, {
        get(target, prop) {
            if (prop === 'withSuccessHandler') {
                return function(successFn) {
                    return new Proxy({}, {
                        get(_, fnName) {
                            if (fnName === 'withFailureHandler') {
                                return function(failFn) {
                                    return new Proxy({}, {
                                        get(_, fnName2) {
                                            return function(...args) {
                                                const fn = _fns[fnName2];
                                                if (fn) fn(...args).then(successFn).catch(failFn);
                                                else failFn(new Error(`Unknown function: ${fnName2}`));
                                            };
                                        }
                                    });
                                };
                            }
                            return function(...args) {
                                const fn = _fns[fnName];
                                if (fn) fn(...args).then(successFn).catch(e => console.error(`[SB] ${fnName} error:`, e));
                                else console.error(`[SB] Unknown function: ${fnName}`);
                            };
                        }
                    });
                };
            }
            if (prop === 'withFailureHandler') {
                return function(failFn) {
                    return new Proxy({}, {
                        get(_, fnName) {
                            if (fnName === 'withSuccessHandler') {
                                return function(successFn) {
                                    return new Proxy({}, {
                                        get(_, fnName2) {
                                            return function(...args) {
                                                const fn = _fns[fnName2];
                                                if (fn) fn(...args).then(successFn).catch(failFn);
                                                else failFn(new Error(`Unknown function: ${fnName2}`));
                                            };
                                        }
                                    });
                                };
                            }
                            return function(...args) {
                                const fn = _fns[fnName];
                                if (fn) fn(...args).then(r => {}).catch(failFn);
                                else failFn(new Error(`Unknown function: ${fnName}`));
                            };
                        }
                    });
                };
            }
            // Direct call: google.script.run.functionName(args)
            const fn = _fns[prop];
            if (fn) return function(...args) { fn(...args).catch(e => console.error(`[SB] ${prop}:`, e)); };
            return function() { console.warn(`[SB] Unknown: ${prop}`); };
        }
    });
}

console.log('[Supabase Bridge] Loaded — all google.script.run calls redirected to Supabase');
