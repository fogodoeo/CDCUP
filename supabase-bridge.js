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

// ── 경매 개체 분류/블라인드 메타데이터 ──
// DB 스키마를 바꾸지 않고 checklist의 숨김 키로 보관한다.
// _auction: tournament | solo | event | extra | crewart, _visibility: public | blind
// _stage: 8, _slot: A1, _team: A, _label: 1
const AUCTION_TYPES = Object.freeze({ TOURNAMENT: 'tournament', SOLO: 'solo', EVENT: 'event', EXTRA: 'extra', CREWART: 'crewart' });
const VISIBILITY_MODES = Object.freeze({ PUBLIC: 'public', BLIND: 'blind' });

function _checklistPairs(raw) {
    const result = {};
    String(raw || '').split('|').forEach(part => {
        const index = part.indexOf(':');
        if (index > 0) result[part.slice(0, index)] = part.slice(index + 1);
    });
    return result;
}

function getItemAuctionMeta(itemOrChecklist, fallbackName) {
    const item = itemOrChecklist && typeof itemOrChecklist === 'object' ? itemOrChecklist : null;
    const checklist = item ? item.checklist : itemOrChecklist;
    const name = String(item ? (item.name || '') : (fallbackName || '')).trim();
    const pairs = _checklistPairs(checklist);
    const storedType = String(pairs._auction || '').toLowerCase();
    // 일반 경매의 E2 같은 실제 개체명을 예전 팀 코드로 오인하지 않는다.
    const legacy = [AUCTION_TYPES.SOLO, AUCTION_TYPES.EVENT, AUCTION_TYPES.EXTRA, AUCTION_TYPES.CREWART].includes(storedType)
        ? null
        : name.toUpperCase().match(/^([A-P])\s*[-_]?\s*([1-9]\d*)(?=\s|[-·:]|$)/);
    const tournamentCode = String(pairs._slot || (legacy ? legacy[1] + legacy[2] : '')).toUpperCase();
    const teamCode = String(pairs._team || (tournamentCode ? tournamentCode.charAt(0) : '')).toUpperCase();
    const tournamentStage = Number.parseInt(pairs._stage, 10) || 0;
    const publicNumber = Number.parseInt(pairs._label || (item ? item.num : ''), 10) || 0;
    const visibilityMode = Object.values(VISIBILITY_MODES).includes(String(pairs._visibility || '').toLowerCase())
        ? String(pairs._visibility).toLowerCase()
        : '';
    const auctionType = Object.values(AUCTION_TYPES).includes(storedType)
        ? storedType
        : (tournamentCode ? AUCTION_TYPES.TOURNAMENT : AUCTION_TYPES.EXTRA);
    const publicName = legacy ? name.slice(legacy[0].length).replace(/^\s*[-·:]?\s*/, '').trim() : name;
    return { auctionType, visibilityMode, tournamentCode, teamCode, tournamentStage, publicNumber, publicName: publicName || (legacy ? '개체' : (name || '이름 없음')) };
}

function mergeItemAuctionMeta(rawChecklist, meta) {
    const previous = _checklistPairs(rawChecklist);
    const visible = String(rawChecklist || '').split('|').filter(Boolean).filter(part => !/^_(auction|visibility|slot|team|stage|label):/.test(part));
    const auctionType = Object.values(AUCTION_TYPES).includes(String(meta?.auctionType || '').toLowerCase())
        ? String(meta.auctionType).toLowerCase()
        : AUCTION_TYPES.EXTRA;
    visible.push('_auction:' + auctionType);
    const visibilityMode = String(meta?.visibilityMode ?? previous._visibility ?? '').toLowerCase();
    if (Object.values(VISIBILITY_MODES).includes(visibilityMode)) visible.push('_visibility:' + visibilityMode);
    const publicNumber = Number.parseInt(meta?.publicNumber ?? previous._label, 10) || 0;
    if (publicNumber) visible.push('_label:' + publicNumber);
    if (auctionType === AUCTION_TYPES.TOURNAMENT) {
        const slot = String(meta?.tournamentCode ?? previous._slot ?? '').trim().toUpperCase();
        const team = String(meta?.teamCode ?? previous._team ?? (slot ? slot.charAt(0) : '')).trim().toUpperCase();
        const stage = Number.parseInt(meta?.tournamentStage ?? previous._stage, 10) || 0;
        if (stage) visible.push('_stage:' + stage);
        if (slot) visible.push('_slot:' + slot);
        if (team) visible.push('_team:' + team);
    }
    return visible.join('|');
}

function itemAuctionFields(row) {
    return getItemAuctionMeta(row || {});
}

function isTournamentAuctionItem(item) {
    return getItemAuctionMeta(item).auctionType === AUCTION_TYPES.TOURNAMENT;
}

function auctionTypeLabel(itemOrType) {
    const type = typeof itemOrType === 'string' ? itemOrType : getItemAuctionMeta(itemOrType).auctionType;
    if (type === AUCTION_TYPES.TOURNAMENT) return '토너먼트';
    if (type === AUCTION_TYPES.SOLO) return '단독 경매';
    if (type === AUCTION_TYPES.CREWART) return '크레와트';
    if (type === AUCTION_TYPES.EVENT) return '이벤트 경매';
    return '일반 경매';
}

function auctionStageLabel(item) {
    const meta = getItemAuctionMeta(item);
    if (meta.auctionType === AUCTION_TYPES.TOURNAMENT) {
        if (meta.tournamentStage === 2) return '결승·3·4위전';
        return meta.tournamentStage ? meta.tournamentStage + '강' : '토너먼트';
    }
    if (meta.auctionType === AUCTION_TYPES.CREWART) return '크레와트';
    if (meta.auctionType === AUCTION_TYPES.SOLO) return '단독 경매';
    if (meta.auctionType === AUCTION_TYPES.EVENT) return '이벤트 경매';
    return '일반 경매';
}

function auctionNumber(itemOrNumber) {
    const value = itemOrNumber && typeof itemOrNumber === 'object'
        ? (getItemAuctionMeta(itemOrNumber).publicNumber || itemOrNumber.num)
        : itemOrNumber;
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) && number > 0 ? String(number).padStart(3, '0') : '---';
}

function auctionItemLabel(item, options = {}) {
    const meta = getItemAuctionMeta(item);
    const prefix = auctionNumber(item);
    const team = options.includeTeam && meta.teamCode ? ' · ' + meta.teamCode + '팀' : '';
    return prefix + (meta.publicName ? ' · ' + meta.publicName : '') + team;
}

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
        if (k.charAt(0) === '_') continue;
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
        updatedAt: r.updated_at || '',
        ...itemAuctionFields(r)
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
        hiddenPhotos: hiddenPhotos,
        ...itemAuctionFields(r)
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
        updatedAt: r.updated_at || '',
        _broadcastPhotosLoaded: Object.prototype.hasOwnProperty.call(r, 'photo_item')
            || Object.prototype.hasOwnProperty.call(r, 'photo_sire')
            || Object.prototype.hasOwnProperty.call(r, 'photo_dam')
            || Object.prototype.hasOwnProperty.call(r, 'photo_sibling'),
        ...itemAuctionFields(r)
    };
}

async function getBroadcastItems() {
    const rows = await _sbFetch('items?order=num.asc');
    return (rows || []).map(_mapBroadcastItem);
}

const BROADCAST_LITE_COLUMNS = [
    'id', 'company', 'num', 'name', 'start_price', 'note', 'announce',
    'status', 'sold_price', 'winner', 'start_time', 'bid_log', 'checklist',
    'checklist_parsed', 'sire_id', 'dam_id', 'shipping_type',
    'shipping_company', 'shipping_region', 'shipping_cost', 'updated_at'
].join(',');

let _broadcastLiteCache = [];
let _broadcastLiteCacheAt = 0;
let _broadcastLitePulseKey = '';
let _broadcastLiteRequest = null;
let _broadcastLiteReady = false;
const _broadcastPhotoCache = new Map();

async function getBroadcastItemsLite() {
    const rows = await _sbFetch(`items?select=${BROADCAST_LITE_COLUMNS}&order=num.asc`);
    return (rows || []).map(_mapBroadcastItem);
}

async function getBroadcastItemsCached(force = false, maxAgeMs = 30000) {
    if (_broadcastLiteRequest) return _broadcastLiteRequest;
    _broadcastLiteRequest = (async () => {
        const pulse = await getAuctionPulse();
        const pulseKey = [pulse?.id ?? '', pulse?.status || '', pulse?.updatedAt || ''].join('|');
        const cacheExpired = Date.now() - _broadcastLiteCacheAt >= Math.max(5000, Number(maxAgeMs) || 30000);
        const needsItems = force
            || !_broadcastLiteReady
            || cacheExpired
            || (_broadcastLitePulseKey && pulseKey !== _broadcastLitePulseKey);
        _broadcastLitePulseKey = pulseKey;
        if (needsItems) {
            _broadcastLiteCache = await getBroadcastItemsLite();
            _broadcastLiteCacheAt = Date.now();
            _broadcastLiteReady = true;
        }
        return _broadcastLiteCache;
    })().finally(() => {
        _broadcastLiteRequest = null;
    });
    return _broadcastLiteRequest;
}

async function _getBroadcastPhotosCached(row) {
    const itemId = row?.row ?? row?.id;
    if (itemId === undefined || itemId === null || itemId === '') return {};
    const cacheKey = String(itemId);
    if (_broadcastPhotoCache.has(cacheKey)) return _broadcastPhotoCache.get(cacheKey);
    const rows = await _sbFetch(`items?id=eq.${encodeURIComponent(itemId)}&select=photo_item,photo_sire,photo_dam,photo_sibling&limit=1`);
    const source = rows && rows[0] ? rows[0] : {};
    const photos = {
        photoItem: source.photo_item || '',
        photoSire: source.photo_sire || '',
        photoDam: source.photo_dam || '',
        photoSibling: source.photo_sibling || ''
    };
    if (_broadcastPhotoCache.size >= 200) {
        _broadcastPhotoCache.delete(_broadcastPhotoCache.keys().next().value);
    }
    _broadcastPhotoCache.set(cacheKey, photos);
    return photos;
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
    const [parents, hiddenPhotos, itemPhotos] = await Promise.all([
        _getBroadcastParentsCached(),
        _getBroadcastHiddenPhotosCached(),
        item._broadcastPhotosLoaded ? Promise.resolve({
            photoItem: item.photoItem || '',
            photoSire: item.photoSire || '',
            photoDam: item.photoDam || '',
            photoSibling: item.photoSibling || ''
        }) : _getBroadcastPhotosCached(item)
    ]);
    const parentMap = {};
    (parents || []).forEach(parent => { parentMap[parent.id] = parent; });
    const sire = item.sire_id ? parentMap[item.sire_id] : null;
    const dam = item.dam_id ? parentMap[item.dam_id] : null;
    return {
        ...item,
        photoItem: itemPhotos.photoItem || item.photoItem || '',
        photoSire: itemPhotos.photoSire || item.photoSire || (sire ? sire.photoUrl : '') || '',
        photoDam: itemPhotos.photoDam || item.photoDam || (dam ? dam.photoUrl : '') || '',
        photoSibling: itemPhotos.photoSibling || item.photoSibling || '',
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
    if (data.checklist !== undefined || data.auctionType !== undefined || data.tournamentCode !== undefined || data.teamCode !== undefined || data.tournamentStage !== undefined || data.publicNumber !== undefined) {
        const currentRows = await _sbFetch(`items?id=eq.${row}&select=checklist,num,name&limit=1`);
        const current = currentRows && currentRows[0] ? currentRows[0] : {};
        const currentMeta = getItemAuctionMeta(current);
        const baseChecklist = data.checklist !== undefined ? data.checklist : (current.checklist || '');
        payload.checklist = mergeItemAuctionMeta(baseChecklist, {
            auctionType: data.auctionType ?? currentMeta.auctionType,
            tournamentCode: data.tournamentCode ?? currentMeta.tournamentCode,
            teamCode: data.teamCode ?? currentMeta.teamCode,
            tournamentStage: data.tournamentStage ?? currentMeta.tournamentStage,
            publicNumber: data.publicNumber ?? data.num ?? currentMeta.publicNumber ?? current.num
        });
        payload.checklist_parsed = formatChecklist(payload.checklist);
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
function _shippingAuditSnapshot(row) {
    return {
        shipping_type: row?.shipping_type || '',
        shipping_company: row?.shipping_company || '',
        shipping_region: row?.shipping_region || '',
        shipping_cost: Number(row?.shipping_cost || 0),
        status: row?.status || ''
    };
}

function _shippingAuditCompareValue(value) {
    return String(value == null ? '' : value).trim();
}

function _shippingAuditChangedFields(before, after) {
    return ['shipping_type', 'shipping_company', 'shipping_region', 'shipping_cost', 'status']
        .filter(field => _shippingAuditCompareValue(before[field]) !== _shippingAuditCompareValue(after[field]));
}

function _shippingAuditMaskedName(value) {
    const clean = String(value || '').replace(/[\[\]]/g, '').split('/').map(v => v.trim()).filter(Boolean)[0] || '';
    if (!clean) return '';
    if (clean.length <= 1) return clean;
    if (clean.length === 2) return clean.charAt(0) + '*';
    return clean.charAt(0) + '*' + clean.slice(-1);
}

function _shippingAuditPhoneLast4(value) {
    const digits = String(value || '').replace(/[^0-9]/g, '');
    return digits ? digits.slice(-4) : '';
}

function _shippingAuditActor(meta = {}, current = {}) {
    const type = String(meta.actor_type || meta.actorType || 'unknown');
    const source = String(meta.source || '');
    const actorName = meta.actor_name || meta.actorName || (type === 'buyer' ? current.winner : '') || '';
    const actorPhone = meta.actor_phone || meta.actorPhone || (type === 'buyer' ? current.winner_phone : '') || '';
    return {
        type,
        source,
        label: meta.actor_label || meta.actorLabel || (type === 'buyer' ? '낙찰자 셀프입력' : type === 'operator' ? '운영자 화면' : '미확인'),
        name_masked: _shippingAuditMaskedName(actorName),
        phone_last4: _shippingAuditPhoneLast4(actorPhone)
    };
}

function _shippingAuditKey(row) {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
    const suffix = Math.random().toString(36).slice(2, 8);
    return `shipping_log_${stamp}_${row}_${suffix}`;
}

async function _insertShippingAuditLog(log) {
    await _sbFetch('config', {
        method: 'POST',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ key: log.key, value: JSON.stringify(log) })
    });
}

async function _markShippingAuditLog(log, status, errorMessage = '') {
    const nextLog = {
        ...log,
        status,
        applied_at: status === 'applied' ? new Date().toISOString() : log.applied_at || '',
        error: errorMessage ? String(errorMessage).slice(0, 500) : ''
    };
    await _sbFetch(`config?key=eq.${encodeURIComponent(log.key)}`, {
        method: 'PATCH',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ value: JSON.stringify(nextLog) })
    });
}

async function getShippingAuditLogs(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 300));
    const rows = await _sbFetch(`config?select=key,value&key=like.shipping_log_%25&order=key.desc&limit=${safeLimit}`);
    return (rows || []).map(row => {
        try {
            return JSON.parse(row.value || '{}');
        } catch (e) {
            return null;
        }
    }).filter(Boolean).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

async function updateItemShipping(row, shippingData, auditMeta = {}) {
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

    let current = null;
    let auditLog = null;
    const currentRows = await _sbFetch(`items?id=eq.${encodeURIComponent(row)}&select=id,num,company,name,winner,winner_phone,shipping_type,shipping_company,shipping_region,shipping_cost,status,updated_at&limit=1`);
    current = currentRows && currentRows[0] ? currentRows[0] : null;

    if (current) {
        const before = _shippingAuditSnapshot(current);
        const after = { ...before, ...payload };
        const changedFields = _shippingAuditChangedFields(before, after);
        if (changedFields.length > 0) {
            auditLog = {
                key: _shippingAuditKey(row),
                status: 'requested',
                created_at: new Date().toISOString(),
                item_id: current.id || row,
                item_num: current.num || '',
                item_company: current.company || '',
                item_name: current.name || '',
                winner: {
                    name_masked: _shippingAuditMaskedName(current.winner || ''),
                    phone_last4: _shippingAuditPhoneLast4(current.winner_phone || '')
                },
                actor: _shippingAuditActor(auditMeta, current),
                before,
                after,
                changed_fields: changedFields
            };
            await _insertShippingAuditLog(auditLog);
        }
    }

    try {
        await _sbFetch(`items?id=eq.${encodeURIComponent(row)}`, {
            method: 'PATCH',
            headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify(payload),
        });
    } catch (e) {
        if (auditLog) {
            try { await _markShippingAuditLog(auditLog, 'failed', e.message); } catch (logErr) { console.warn('[SB] shipping audit failure mark failed:', logErr); }
        }
        throw e;
    }

    if (auditLog) {
        try { await _markShippingAuditLog(auditLog, 'applied'); } catch (logErr) { console.warn('[SB] shipping audit apply mark failed:', logErr); }
    }
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
            const checklist = mergeItemAuctionMeta(d.checklist || '', {
                auctionType: d.auctionType || AUCTION_TYPES.TOURNAMENT,
                tournamentCode: d.tournamentCode || '',
                teamCode: d.teamCode || '',
                tournamentStage: d.tournamentStage || 0,
                publicNumber: d.publicNumber || num
            });
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
                checklist: checklist,
                checklist_parsed: formatChecklist(checklist),
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
    const assignmentRows = [];
    let tournamentStage = 0;
    for (let idx = 0; idx < assignments.length; idx++) {
        const assignment = assignments[idx] || {};
        const id = Number(assignment.row);
        const code = String(assignment.code || "").trim().toUpperCase();
        const stage = Number.parseInt(assignment.stage, 10) || 0;
        if (!Number.isInteger(id) || id <= 0 || !/^[A-Z][1-9]\d*$/.test(code)) {
            return { success: false, error: "개체 편성 데이터가 올바르지 않습니다." };
        }
        if (seenIds.has(id) || seenCodes.has(code)) {
            return { success: false, error: "같은 개체 또는 코드가 중복 선택되었습니다." };
        }
        if (!stage || ![2, 4, 8, 16].includes(stage) || (tournamentStage && tournamentStage !== stage)) {
            return { success: false, error: "토너먼트 단계 정보가 올바르지 않습니다." };
        }
        tournamentStage = stage;
        seenIds.add(id);
        seenCodes.add(code);
        ids.push(id);
        assignmentRows.push({ id, code, company: String(assignment.company || '').trim() });
    }

    const allExisting = await _sbFetch('items?order=num.asc');
    const existing = (allExisting || []).filter(item => seenIds.has(Number(item.id)));
    if (!existing || existing.length !== ids.length) {
        return { success: false, error: "선택한 개체 중 현재 목록에서 찾을 수 없는 항목이 있습니다. 새로고침 후 다시 시도해주세요." };
    }

    const existingMap = Object.fromEntries(existing.map(item => [Number(item.id), item]));
    const byCode = Object.fromEntries(assignmentRows.map(item => [item.code, item]));
    const letters = [...new Set(assignmentRows.map(item => item.code.charAt(0)))].sort();
    const rounds = Math.max(...assignmentRows.map(item => Number(item.code.slice(1)) || 1));
    const matchCount = Math.ceil(letters.length / 2);
    const publicOrder = [];
    if (tournamentStage === 2 && matchCount === 2) {
        // 메달 결정전은 3·4위전(C·D)을 먼저 끝낸 뒤 결승(A·B)을 진행한다.
        [1, 0].forEach(group => {
            for (let round = 1; round <= rounds; round++) {
                const left = letters[group * 2];
                const right = letters[group * 2 + 1];
                if (left && byCode[left + round]) publicOrder.push(byCode[left + round]);
                if (right && byCode[right + round]) publicOrder.push(byCode[right + round]);
            }
        });
    } else {
        for (let round = 1; round <= rounds; round++) {
            const startGroup = matchCount ? ((round - 1) % matchCount) : 0;
            for (let offset = 0; offset < matchCount; offset++) {
                const group = (startGroup + offset) % matchCount;
                const left = letters[group * 2];
                const right = letters[group * 2 + 1];
                if (left && byCode[left + round]) publicOrder.push(byCode[left + round]);
                if (right && byCode[right + round]) publicOrder.push(byCode[right + round]);
            }
        }
    }

    const extras = (allExisting || []).filter(item => !seenIds.has(Number(item.id)));
    const soloExtras = tournamentStage === 2
        ? extras.filter(item => getItemAuctionMeta({ name: item.name, checklist: item.checklist, num: item.num }).auctionType === AUCTION_TYPES.SOLO)
        : [];
    const soloIds = new Set(soloExtras.map(item => Number(item.id)));
    const preservedExtras = extras.filter(item => !soloIds.has(Number(item.id)));
    const maxExistingNum = Math.max(0, ...(allExisting || []).map(item => Number.parseInt(item.num, 10) || 0));
    const assignmentNum = new Map();
    const soloNum = new Map();

    if (tournamentStage === 2 && matchCount === 2) {
        // 실제 운영 큐: 3·4위전(C·D) → 단독 경매 → 결승(A·B).
        let nextNum = Math.max(0, ...preservedExtras.map(item => Number.parseInt(item.num, 10) || 0));
        publicOrder.filter(item => /^[CD]/.test(item.code)).forEach(item => assignmentNum.set(item.id, ++nextNum));
        soloExtras.forEach(item => soloNum.set(Number(item.id), ++nextNum));
        publicOrder.filter(item => /^[AB]/.test(item.code)).forEach(item => assignmentNum.set(item.id, ++nextNum));
    } else {
        publicOrder.forEach((item, index) => assignmentNum.set(item.id, maxExistingNum + index + 1));
    }

    const payloads = publicOrder.map((assignment, index) => {
        const original = existingMap[assignment.id];
        const checklist = mergeItemAuctionMeta(original.checklist || '', {
            auctionType: AUCTION_TYPES.TOURNAMENT,
            visibilityMode: tournamentStage === 2 ? VISIBILITY_MODES.PUBLIC : undefined,
            tournamentCode: assignment.code,
            teamCode: assignment.code.charAt(0),
            tournamentStage,
            publicNumber: index + 1
        });
        return {
            id: assignment.id,
            company: assignment.company,
            num: assignmentNum.get(assignment.id) || maxExistingNum + index + 1,
            checklist,
            checklist_parsed: formatChecklist(checklist),
            status: '대기', sold_price: null, winner: '', winner_phone: '', start_time: null, bid_log: '',
            shipping_type: '', shipping_company: '', shipping_region: '', shipping_cost: 0
        };
    });

    const legacyLetters = [...new Set(extras.map(item => getItemAuctionMeta({ name: item.name, checklist: item.checklist, num: item.num })).filter(meta => meta.auctionType === AUCTION_TYPES.TOURNAMENT && !meta.tournamentStage && meta.teamCode).map(meta => meta.teamCode))];
    const legacyScale = [2, 4, 8, 16].find(scale => legacyLetters.length <= scale) || 16;

    // 토너먼트 개체만 상태를 초기화하고 일반 경매는 보존한 채 뒤 번호로 이어 붙인다.
    await _sbFetch('items?on_conflict=id', {
        method: 'POST',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify(payloads)
    });
    for (const item of extras) {
        const meta = getItemAuctionMeta({ name: item.name, checklist: item.checklist, num: item.num });
        const patch = {};
        if (soloNum.has(Number(item.id))) patch.num = soloNum.get(Number(item.id));
        if (meta.auctionType === AUCTION_TYPES.TOURNAMENT && !meta.tournamentStage && meta.tournamentCode) {
            const checklist = mergeItemAuctionMeta(item.checklist || '', {
                auctionType: AUCTION_TYPES.TOURNAMENT,
                tournamentCode: meta.tournamentCode,
                teamCode: meta.teamCode,
                tournamentStage: legacyScale,
                publicNumber: meta.publicNumber || item.num
            });
            patch.checklist = checklist;
            patch.checklist_parsed = formatChecklist(checklist);
        }
        if (!Object.keys(patch).length) continue;
        await _sbFetch(`items?id=eq.${item.id}`, {
            method: 'PATCH', headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify(patch)
        });
    }
    return {
        success: true,
        count: publicOrder.length,
        preserved: extras.length,
        sequence: tournamentStage === 2 && matchCount === 2 ? ['third_place', 'solo', 'final'] : []
    };
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
    await updateConfigs({ hiddenPhotos: value });
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
    await updateConfigs({ hostConfig: JSON.stringify(cfg) });
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
            // Storage 버킷이 없는 배포에서도 사진 등록이 가능하도록
            // 작은 WebP data URL로 압축해 DB 사진 필드에 직접 저장한다.
            try {
                const bitmap = await createImageBitmap(blob);
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const context = canvas.getContext('2d');
                context.drawImage(bitmap, 0, 0);
                if (typeof bitmap.close === 'function') bitmap.close();
                results.push(canvas.toDataURL('image/webp', 0.75));
            } catch (fallbackError) {
                console.error('inline photo fallback failed', fallbackError);
                results.push('');
            }
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
    await updateConfigs({ banner_hidden: String(hidden) });
}

const CREWART_PARTICIPANT_ENTRY_PREFIX = 'crewart_participant_entry_';
const CREWART_RESPONSE_ENTRY_PREFIX = 'crewart_survey_response_entry_';
const RUNTIME_CONFIG_VERSION_KEY = 'runtime_config_version';
const RUNTIME_CONFIG_MAX_AGE_MS = 60000;
const RUNTIME_CONFIG_PULSE_INTERVAL_MS = 1000;
let _runtimeConfigCache = null;
let _runtimeConfigCacheAt = 0;
let _runtimeConfigVersion = '';
let _runtimeConfigLastPulseAt = 0;
let _runtimeConfigRequest = null;

function _mergeCrewartSurveyEntries(map) {
    const participantLines = new Map();
    String(map.crewart_participants || '').split(/\r?\n/).filter(Boolean).forEach((line, index) => {
        const identity = String(line.split(/[,\t|]/)[0] || `legacy-${index}`).trim().toLowerCase();
        participantLines.set(identity, line);
    });
    Object.entries(map).forEach(([key, value]) => {
        if (!key.startsWith(CREWART_PARTICIPANT_ENTRY_PREFIX) || !value) return;
        const identity = String(value).split(/[,\t|]/)[0].trim().toLowerCase() || key;
        participantLines.set(identity, String(value));
    });
    map.crewart_participants = Array.from(participantLines.values()).join('\n');

    let legacyResponses = [];
    try {
        const parsed = JSON.parse(map.crewart_survey_responses || '[]');
        legacyResponses = Array.isArray(parsed) ? parsed : [];
    } catch (_) {}
    const responses = new Map();
    legacyResponses.forEach((response, index) => {
        responses.set(response?.participantKey || `legacy-${index}`, response);
    });
    Object.entries(map).forEach(([key, value]) => {
        if (!key.startsWith(CREWART_RESPONSE_ENTRY_PREFIX) || !value) return;
        try {
            const response = JSON.parse(value);
            responses.set(response?.participantKey || key.slice(CREWART_RESPONSE_ENTRY_PREFIX.length), response);
        } catch (_) {}
    });
    map.crewart_survey_responses = JSON.stringify(Array.from(responses.values())
        .sort((a, b) => String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')))
        .slice(-500));
    return map;
}

async function getConfigMap() {
    const rows = await _sbFetch('config?select=*');
    const map = {};
    if (rows && rows.length > 0) {
        rows.forEach(r => {
            map[r.key] = r.value;
        });
    }
    return _mergeCrewartSurveyEntries(map);
}

async function getConfigPulse() {
    const rows = await _sbFetch(`config?key=eq.${RUNTIME_CONFIG_VERSION_KEY}&select=value&limit=1`);
    return rows && rows[0] ? String(rows[0].value || '') : '';
}

async function getRuntimeConfigMap(force = false) {
    if (_runtimeConfigRequest) return _runtimeConfigRequest;
    _runtimeConfigRequest = (async () => {
        const now = Date.now();
        let needsFull = force
            || !_runtimeConfigCache
            || now - _runtimeConfigCacheAt >= RUNTIME_CONFIG_MAX_AGE_MS;

        if (!needsFull && now - _runtimeConfigLastPulseAt >= RUNTIME_CONFIG_PULSE_INTERVAL_MS) {
            const version = await getConfigPulse();
            _runtimeConfigLastPulseAt = Date.now();
            if (version && version !== _runtimeConfigVersion) needsFull = true;
        }
        if (!needsFull) return _runtimeConfigCache;

        const rows = await _sbFetch('config?select=key,value&and=(key.neq.admin_pw,key.not.like.shipping_log_*,key.not.like.auction_archive_*)');
        const map = {};
        (rows || []).forEach(row => { map[row.key] = row.value; });
        _runtimeConfigCache = _mergeCrewartSurveyEntries(map);
        _runtimeConfigCacheAt = Date.now();
        _runtimeConfigVersion = String(map[RUNTIME_CONFIG_VERSION_KEY] || '');
        _runtimeConfigLastPulseAt = Date.now();
        return _runtimeConfigCache;
    })().finally(() => {
        _runtimeConfigRequest = null;
    });
    return _runtimeConfigRequest;
}

async function updateConfigs(configMap) {
    const version = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const payloads = Object.keys(configMap).map(k => ({
        key: k,
        value: String(configMap[k])
    }));
    if (!Object.prototype.hasOwnProperty.call(configMap, RUNTIME_CONFIG_VERSION_KEY)) {
        payloads.push({ key: RUNTIME_CONFIG_VERSION_KEY, value: version });
    }
    await _sbFetch('config', {
        method: 'POST',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify(payloads),
    });
    _runtimeConfigCache = null;
    _runtimeConfigCacheAt = 0;
}

async function saveCrewartSurveyEntry(participantKey, participantLine, response) {
    const safeKey = String(participantKey || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48);
    if (!safeKey) throw new Error('참여자 식별값을 만들지 못했습니다.');
    await updateConfigs({
        [`${CREWART_PARTICIPANT_ENTRY_PREFIX}${safeKey}`]: participantLine,
        [`${CREWART_RESPONSE_ENTRY_PREFIX}${safeKey}`]: JSON.stringify(response)
    });
}

// ── 회차/라운드 아카이브 ──
// 별도 테이블 없이 config에 스냅샷을 저장한다. admin_pw와 아카이브 자체는 재귀 저장하지 않는다.
const AUCTION_ARCHIVE_INDEX_KEY = 'auction_archive_index';
const AUCTION_ARCHIVE_KEY_PREFIX = 'auction_archive_';

function _archiveSafeConfigs(configMap) {
    const result = {};
    Object.entries(configMap || {}).forEach(([key, value]) => {
        if (key === 'admin_pw' || key === RUNTIME_CONFIG_VERSION_KEY || key === AUCTION_ARCHIVE_INDEX_KEY || key.startsWith(AUCTION_ARCHIVE_KEY_PREFIX)) return;
        result[key] = value;
    });
    return result;
}

function _archiveWonAmount(row) {
    const value = String(row?.sold_price ?? '').replace(/[^0-9.-]/g, '');
    const number = Number.parseFloat(value) || 0;
    // 현재 DB의 낙찰가는 만원 단위다. 아카이브 요약도 기존 화면과 같은 단위를 유지한다.
    return number;
}

function _archiveSummary(snapshot) {
    const items = snapshot?.items || [];
    const sold = items.filter(item => ['완료', 'sold', '낙찰'].includes(String(item.status || '').trim()));
    const stageCounts = {};
    const roundAmounts = {};
    items.forEach(item => {
        const meta = getItemAuctionMeta(item);
        const key = meta.auctionType === AUCTION_TYPES.TOURNAMENT
            ? (meta.tournamentStage === 2 ? '결승·3·4위전' : (meta.tournamentStage ? meta.tournamentStage + '강' : '토너먼트'))
            : auctionTypeLabel(meta.auctionType);
        stageCounts[key] = (stageCounts[key] || 0) + 1;
        const company = String(item.company || '').trim();
        if (company
            && meta.auctionType === AUCTION_TYPES.TOURNAMENT
            && [2, 4, 8, 16].includes(Number(meta.tournamentStage))
            && ['완료', 'sold', '낙찰'].includes(String(item.status || '').trim())) {
            const stage = String(meta.tournamentStage);
            if (!roundAmounts[stage]) roundAmounts[stage] = {};
            roundAmounts[stage][company] = (roundAmounts[stage][company] || 0) + _archiveWonAmount(item);
        }
    });
    return {
        id: snapshot.id,
        title: snapshot.title,
        createdAt: snapshot.createdAt,
        itemCount: items.length,
        soldCount: sold.length,
        totalSoldAmount: sold.reduce((sum, item) => sum + _archiveWonAmount(item), 0),
        stageCounts,
        roundAmounts
    };
}

async function _readArchiveIndex() {
    const rows = await _sbFetch(`config?key=eq.${AUCTION_ARCHIVE_INDEX_KEY}&select=value`);
    if (!rows || !rows.length) return [];
    try {
        const parsed = JSON.parse(rows[0].value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

async function listAuctionArchives() {
    return _readArchiveIndex();
}

async function getAuctionArchive(id) {
    const safeId = encodeURIComponent(String(id || ''));
    const rows = await _sbFetch(`config?key=eq.${AUCTION_ARCHIVE_KEY_PREFIX}${safeId}&select=value`);
    if (!rows || !rows.length) return null;
    try { return JSON.parse(rows[0].value || 'null'); } catch (_) { return null; }
}

async function _createAuctionArchive(title) {
    const [items, parents, configMap] = await Promise.all([
        _sbFetch('items?select=*&order=num.asc'),
        _sbFetch('parents?select=*'),
        getConfigMap()
    ]);
    const now = new Date();
    const id = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '_' + Math.random().toString(36).slice(2, 7);
    const snapshot = {
        version: 1,
        id,
        title: String(title || '').trim() || `경매 기록 ${now.toLocaleDateString('ko-KR')}`,
        createdAt: now.toISOString(),
        items: items || [],
        parents: parents || [],
        configs: _archiveSafeConfigs(configMap)
    };
    const summary = _archiveSummary(snapshot);
    const index = await _readArchiveIndex();
    index.unshift(summary);
    const roundAmountRows = Object.entries(summary.roundAmounts || {})
        .filter(([, amounts]) => amounts && Object.keys(amounts).length)
        .map(([stage, amounts]) => ({
            key: `tournament_round_amounts_${stage}`,
            value: JSON.stringify(amounts)
        }));
    const version = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await _sbFetch('config', {
        method: 'POST',
        headers: { ..._sbHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify([
            { key: AUCTION_ARCHIVE_KEY_PREFIX + id, value: JSON.stringify(snapshot) },
            { key: AUCTION_ARCHIVE_INDEX_KEY, value: JSON.stringify(index.slice(0, 100)) },
            ...roundAmountRows,
            { key: RUNTIME_CONFIG_VERSION_KEY, value: version }
        ])
    });
    _runtimeConfigCache = null;
    _runtimeConfigCacheAt = 0;
    return summary;
}

async function createAuctionArchive(title, pw) {
    if (!(await verifyAdmin(pw))) return { success: false, error: '비밀번호 불일치' };
    try {
        const archive = await _createAuctionArchive(title);
        return { success: true, archive };
    } catch (error) {
        console.error('createAuctionArchive error:', error);
        return { success: false, error: '아카이브 저장 중 오류가 발생했습니다: ' + error.message };
    }
}

async function archiveAndPrepareMedalDay(title, pw) {
    if (!(await verifyAdmin(pw))) return { success: false, error: '비밀번호 불일치' };
    const active = await _sbFetch('items?status=eq.진행중&select=id&limit=1');
    if (active && active.length) return { success: false, error: '진행 중인 경매를 먼저 종료해주세요.' };
    try {
        // 4강 낙찰·배송 기록은 먼저 보관하고 현재 경매 목록만 비운다.
        // 4강 대진표는 결승·3·4위전 자동 편성에 필요하므로 유지한다.
        const archive = await _createAuctionArchive(title);
        await _sbFetch('items?id=gt.0', {
            method: 'DELETE',
            headers: { ..._sbHeaders, 'Prefer': 'return=minimal' }
        });
        await updateConfigs({
            active_tournament: 'none',
            tournament_bracket_2: JSON.stringify({ matches: {} }),
            event_match_show: '0',
            battle_current_match: '',
            battle_state: ''
        });
        return { success: true, archive };
    } catch (error) {
        console.error('archiveAndPrepareMedalDay error:', error);
        return { success: false, error: '결승일 목록 준비 중 오류가 발생했습니다: ' + error.message };
    }
}

async function archiveAndResetAuction(title, pw) {
    if (!(await verifyAdmin(pw))) return { success: false, error: '비밀번호 불일치' };
    const active = await _sbFetch('items?status=eq.진행중&select=id&limit=1');
    if (active && active.length) return { success: false, error: '진행 중인 경매를 먼저 종료해주세요.' };
    try {
        // 저장 성공 전에는 현재 데이터를 절대 지우지 않는다.
        const archive = await _createAuctionArchive(title);
        await _sbFetch('items?id=gt.0', {
            method: 'DELETE',
            headers: { ..._sbHeaders, 'Prefer': 'return=minimal' }
        });
        await updateConfigs({
            active_tournament: 'none',
            tournament_bracket_16: JSON.stringify({ matches: {} }),
            tournament_bracket_8: JSON.stringify({ matches: {} }),
            tournament_bracket_4: JSON.stringify({ matches: {} }),
            tournament_bracket_2: JSON.stringify({ matches: {} }),
            tournament_round_amounts_16: '{}',
            tournament_round_amounts_8: '{}',
            tournament_round_amounts_4: '{}',
            tournament_round_amounts_2: '{}',
            battle_current_match: '',
            battle_state: ''
        });
        return { success: true, archive };
    } catch (error) {
        console.error('archiveAndResetAuction error:', error);
        return { success: false, error: '새 회차 준비 중 오류가 발생했습니다: ' + error.message };
    }
}

const _ARCHIVE_ITEM_COLUMNS = [
    'company', 'num', 'name', 'start_price', 'note', 'announce',
    'photo_item', 'photo_sire', 'photo_dam', 'photo_sibling', 'status',
    'sold_price', 'winner', 'winner_phone', 'start_time', 'bid_log',
    'checklist', 'checklist_parsed', 'sire_id', 'dam_id',
    'shipping_type', 'shipping_company', 'shipping_region', 'shipping_cost'
];

function _archiveItemPayload(row) {
    const payload = {};
    _ARCHIVE_ITEM_COLUMNS.forEach(key => {
        if (row && row[key] !== undefined) payload[key] = row[key];
    });
    return payload;
}

async function restoreAuctionArchive(id, pw) {
    if (!(await verifyAdmin(pw))) return { success: false, error: '비밀번호 불일치' };
    const active = await _sbFetch('items?status=eq.진행중&select=id&limit=1');
    if (active && active.length) return { success: false, error: '진행 중인 경매를 먼저 종료해주세요.' };
    const snapshot = await getAuctionArchive(id);
    if (!snapshot) return { success: false, error: '아카이브를 찾을 수 없습니다.' };
    try {
        const current = await _sbFetch('items?select=id&limit=1');
        let safetyArchive = null;
        if (current && current.length) safetyArchive = await _createAuctionArchive('복원 전 자동 백업');
        await _sbFetch('items?id=gt.0', {
            method: 'DELETE',
            headers: { ..._sbHeaders, 'Prefer': 'return=minimal' }
        });
        const payloads = (snapshot.items || []).map(_archiveItemPayload);
        if (payloads.length) {
            await _sbFetch('items', {
                method: 'POST',
                headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
                body: JSON.stringify(payloads)
            });
        }
        await updateConfigs(_archiveSafeConfigs(snapshot.configs || {}));
        return { success: true, count: payloads.length, safetyArchive };
    } catch (error) {
        console.error('restoreAuctionArchive error:', error);
        return { success: false, error: '아카이브 복원 중 오류가 발생했습니다: ' + error.message };
    }
}

async function copyAuctionArchiveItems(id, selectedIndexes, pw) {
    if (!(await verifyAdmin(pw))) return { success: false, error: '비밀번호 불일치' };
    const snapshot = await getAuctionArchive(id);
    if (!snapshot) return { success: false, error: '아카이브를 찾을 수 없습니다.' };
    const indexes = [...new Set((selectedIndexes || []).map(Number).filter(Number.isInteger))];
    const selected = indexes.map(index => snapshot.items?.[index]).filter(Boolean);
    if (!selected.length) return { success: false, error: '재사용할 개체를 선택해주세요.' };
    try {
        const existing = await _sbFetch('items?select=num');
        let maxNum = Math.max(0, ...(existing || []).map(row => Number.parseInt(row.num, 10) || 0));
        const payloads = selected.map((row, index) => {
            const payload = _archiveItemPayload(row);
            const num = maxNum + index + 1;
            const meta = getItemAuctionMeta(row);
            payload.num = num;
            payload.status = '대기';
            payload.sold_price = null;
            payload.winner = '';
            payload.winner_phone = '';
            payload.start_time = null;
            payload.bid_log = '';
            payload.shipping_type = '';
            payload.shipping_company = '';
            payload.shipping_region = '';
            payload.shipping_cost = 0;
            payload.checklist = mergeItemAuctionMeta(row.checklist || '', {
                auctionType: meta.auctionType,
                tournamentCode: '',
                teamCode: '',
                tournamentStage: 0,
                publicNumber: num
            });
            payload.checklist_parsed = formatChecklist(payload.checklist);
            return payload;
        });
        await _sbFetch('items', {
            method: 'POST',
            headers: { ..._sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify(payloads)
        });
        return { success: true, count: payloads.length };
    } catch (error) {
        console.error('copyAuctionArchiveItems error:', error);
        return { success: false, error: '개체 재사용 중 오류가 발생했습니다: ' + error.message };
    }
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
