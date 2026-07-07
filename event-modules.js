/*
 * Event module registry for auction display pages.
 * Keep event-specific labels, themes, and scoring logic here so new auction
 * concepts can be added without rewriting preview/broadcast pages.
 */
(function (global) {
    'use strict';

    const MODULES = Object.freeze({
        cdcup: {
            id: 'cdcup',
            title: 'CDCUP',
            adminTitle: 'CDCUP 관리자',
            navIcon: 'C',
            scoreLabel: '낙찰금 총액',
            unitLabel: '만원',
            participantLabel: '업체',
            groupLabel: '팀',
            itemLabel: '개체',
            page3Label: '대진표',
            scoreboardLabel: 'CRE WORLD CUP',
            rankingMode: 'tournament',
            theme: {
                accent: '#093687',
                accentSoft: 'rgba(9, 54, 135, 0.08)',
                accentText: '#093687',
                gold: '#c39a4a',
                broadcastAccent: '#e4c887',
                darkPanel: 'rgba(10, 15, 28, 0.92)'
            }
        },
        crewart: {
            id: 'crewart',
            title: '크레와트',
            adminTitle: '크레와트 관리자',
            navIcon: 'W',
            scoreLabel: '기숙사 점수',
            unitLabel: '점',
            participantLabel: '입찰 희망자',
            groupLabel: '기숙사',
            itemLabel: '마법 생물',
            page3Label: '기숙사 점수판',
            scoreboardLabel: 'CREWART',
            rankingMode: 'house-score',
            theme: {
                accent: '#6D28D9',
                accentSoft: 'rgba(109, 40, 217, 0.10)',
                accentText: '#5B21B6',
                gold: '#D6B25E',
                broadcastAccent: '#D6B25E',
                darkPanel: 'rgba(20, 14, 35, 0.94)'
            }
        }
    });

    const DEFAULT_HOUSES = Object.freeze([
        { id: 'valor', name: '용맹의 탑', color: '#B91C1C', accent: '#FCA5A5' },
        { id: 'wisdom', name: '지혜의 탑', color: '#1D4ED8', accent: '#93C5FD' },
        { id: 'harmony', name: '조화의 탑', color: '#047857', accent: '#86EFAC' },
        { id: 'ambition', name: '야망의 탑', color: '#6D28D9', accent: '#C4B5FD' }
    ]);

    function normalizeModuleId(value) {
        const id = String(value || '').trim().toLowerCase();
        return MODULES[id] ? id : 'cdcup';
    }

    function getActiveEventModule(config) {
        return MODULES[normalizeModuleId(config && config.active_event_module)];
    }

    function getEventModule(id) {
        return MODULES[normalizeModuleId(id)];
    }

    function parseDelimitedLine(line) {
        const raw = String(line || '').trim();
        if (!raw) return [];
        return raw.split(/\s*[,\t|]\s*/).map(part => part.trim()).filter(Boolean);
    }

    function parseHouseConfig(raw) {
        const text = String(raw || '').trim();
        if (!text) return DEFAULT_HOUSES.map(house => ({ ...house }));
        const rows = text.split(/\r?\n/).map(parseDelimitedLine).filter(parts => parts.length);
        const houses = rows.map((parts, index) => ({
            id: slugify(parts[0] || ('house-' + (index + 1))) || ('house-' + (index + 1)),
            name: parts[0] || ('기숙사 ' + (index + 1)),
            color: parts[1] || DEFAULT_HOUSES[index % DEFAULT_HOUSES.length].color,
            accent: parts[2] || DEFAULT_HOUSES[index % DEFAULT_HOUSES.length].accent
        }));
        return houses.length ? houses : DEFAULT_HOUSES.map(house => ({ ...house }));
    }

    function serializeHouseConfig(houses) {
        return (houses || DEFAULT_HOUSES).map(house => [
            house.name || '',
            house.color || '',
            house.accent || ''
        ].join('|')).join('\n');
    }

    function normalizePerson(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/\([^)]*\)/g, '')
            .replace(/\[[^\]]*\]/g, '')
            .replace(/님$/g, '')
            .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]/gi, '');
    }

    function winnerNameCandidates(value) {
        const raw = String(value || '').trim();
        if (!raw) return [];
        const withoutPhone = raw.replace(/\d{2,4}[-\s.]?\d{3,4}[-\s.]?\d{4}/g, ' ');
        const firstChunk = raw.split(/[,(|/]/)[0];
        const values = [raw, withoutPhone, firstChunk];
        return [...new Set(values.map(normalizePerson).filter(Boolean))];
    }

    function slugify(value) {
        return String(value || '')
            .toLowerCase()
            .trim()
            .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]+/gi, '-')
            .replace(/^-+|-+$/g, '');
    }

    function parseParticipantMap(raw, houses) {
        const houseByName = {};
        (houses || []).forEach(house => {
            houseByName[normalizePerson(house.name)] = house;
            houseByName[slugify(house.name)] = house;
            houseByName[normalizePerson(house.id)] = house;
        });

        const map = {};
        String(raw || '').split(/\r?\n/).forEach(line => {
            const parts = parseDelimitedLine(line);
            if (parts.length < 2) return;
            const name = parts[0];
            const houseToken = parts[1];
            const house = houseByName[normalizePerson(houseToken)] || houseByName[slugify(houseToken)];
            if (!name || !house) return;
            const aliases = [name];
            if (parts[2]) {
                parts[2].split(/[;/]/).forEach(alias => {
                    if (alias.trim()) aliases.push(alias.trim());
                });
            }
            aliases.forEach(alias => {
                const key = normalizePerson(alias);
                if (key) map[key] = house.id;
            });
        });
        return map;
    }

    function amountToNumber(value) {
        const raw = String(value == null ? '' : value).replace(/,/g, '');
        const match = raw.match(/-?\d+(?:\.\d+)?/);
        return match ? Number(match[0]) || 0 : 0;
    }

    function isSoldItem(item) {
        const status = String(item && item.status || '').trim();
        return ['완료', 'sold', '낙찰'].includes(status) || status.indexOf('낙찰') >= 0;
    }

    function itemAuctionType(item) {
        try {
            if (global.getItemAuctionMeta) return global.getItemAuctionMeta(item).auctionType;
        } catch (_) {}
        return item && item.auctionType || '';
    }

    function candidateWinnerKeys(item) {
        const values = [item && item.winner, item && item.winner_name, item && item.bidder];
        try {
            const bids = JSON.parse(item && (item.bid_log || item.bidLog) || '[]');
            if (Array.isArray(bids) && bids[0]) {
                values.push(bids[0].name, bids[0].bidder_key);
            }
        } catch (_) {}
        return values.flatMap(winnerNameCandidates).filter(Boolean);
    }

    function crewartPointsForAmount(amount, config) {
        const scorePerMan = Number.parseFloat(config && config.crewart_score_per_man) || 1;
        const soldBonus = Number.parseFloat(config && config.crewart_sold_bonus) || 0;
        return (Number(amount || 0) * scorePerMan) + soldBonus;
    }

    function resolveCrewartWinnerHouse(winner, config) {
        const houses = parseHouseConfig(config && config.crewart_houses);
        const participantMap = parseParticipantMap(config && config.crewart_participants, houses);
        const byId = Object.fromEntries(houses.map(house => [house.id, house]));
        const keys = winnerNameCandidates(winner);
        const houseId = keys.map(key => participantMap[key]).find(Boolean);
        return houseId && byId[houseId] ? byId[houseId] : null;
    }

    function resolveCrewartItemResult(item, config) {
        if (!item) return null;
        const includeOnlyCrewart = String(config && config.crewart_score_scope || 'crewart').toLowerCase() !== 'all';
        if (includeOnlyCrewart && itemAuctionType(item) !== 'crewart') return null;
        const keys = candidateWinnerKeys(item);
        const houses = parseHouseConfig(config && config.crewart_houses);
        const participantMap = parseParticipantMap(config && config.crewart_participants, houses);
        const byId = Object.fromEntries(houses.map(house => [house.id, house]));
        const houseId = keys.map(key => participantMap[key]).find(Boolean);
        if (!houseId || !byId[houseId]) return null;
        const amount = amountToNumber(item.sold_price || item.soldPrice);
        return {
            house: byId[houseId],
            amount,
            points: crewartPointsForAmount(amount, config),
            winner: String(item.winner || item.winner_name || item.bidder || '').trim()
        };
    }

    function buildCrewartHouseScores(items, config) {
        const houses = parseHouseConfig(config && config.crewart_houses);
        const participantMap = parseParticipantMap(config && config.crewart_participants, houses);
        const scorePerMan = Number.parseFloat(config && config.crewart_score_per_man) || 1;
        const soldBonus = Number.parseFloat(config && config.crewart_sold_bonus) || 0;
        const includeOnlyCrewart = String(config && config.crewart_score_scope || 'crewart').toLowerCase() !== 'all';
        const rows = houses.map(house => ({
            ...house,
            points: 0,
            amount: 0,
            soldCount: 0,
            winners: []
        }));
        const byId = Object.fromEntries(rows.map(row => [row.id, row]));
        const unassigned = [];

        (items || []).forEach(item => {
            if (!isSoldItem(item)) return;
            if (includeOnlyCrewart && itemAuctionType(item) !== 'crewart') return;
            const keys = candidateWinnerKeys(item);
            const houseId = keys.map(key => participantMap[key]).find(Boolean);
            const amount = amountToNumber(item.sold_price || item.soldPrice);
            if (!houseId || !byId[houseId]) {
                unassigned.push({ item, amount });
                return;
            }
            const row = byId[houseId];
            row.amount += amount;
            row.points += crewartPointsForAmount(amount, config);
            row.soldCount += 1;
            if (item.winner) row.winners.push(String(item.winner));
        });

        rows.sort((a, b) => b.points - a.points || b.amount - a.amount || a.name.localeCompare(b.name, 'ko'));
        rows.forEach((row, index) => { row.rank = index + 1; });
        return { houses: rows, unassigned, scorePerMan, soldBonus };
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderCrewartHouseBoardHTML(items, config, options) {
        const result = buildCrewartHouseScores(items, config);
        const maxPoints = Math.max(1, ...result.houses.map(row => row.points));
        const totalPoints = result.houses.reduce((sum, row) => sum + row.points, 0);
        const totalSold = result.houses.reduce((sum, row) => sum + row.soldCount, 0);
        const updatedAt = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        const compact = options && options.compact;
        const rows = result.houses.map(row => {
            const pct = Math.max(4, Math.round((row.points / maxPoints) * 100));
            return `
                <article class="crewart-house-card ${row.rank === 1 ? 'is-leading' : ''}" style="--house:${escapeHtml(row.color)};--house-accent:${escapeHtml(row.accent)};">
                    <div class="crewart-house-rank">${String(row.rank).padStart(2, '0')}</div>
                    <div class="crewart-house-main">
                        <div class="crewart-house-name">${escapeHtml(row.name)}</div>
                        <div class="crewart-house-meter"><span style="width:${pct}%"></span></div>
                        <div class="crewart-house-sub">${row.soldCount}건 낙찰 · ${Number(row.amount || 0).toLocaleString('ko-KR')}만원</div>
                    </div>
                    <strong class="crewart-house-score">${Math.round(row.points).toLocaleString('ko-KR')}<small>점</small></strong>
                </article>
            `;
        }).join('');
        const unassigned = result.unassigned.length
            ? `<div class="crewart-unassigned">기숙사 미지정 낙찰 ${result.unassigned.length}건</div>`
            : '';
        return `
            <section class="crewart-scoreboard ${compact ? 'is-compact' : ''}">
                <header class="crewart-score-head">
                    <span>CREWART HOUSE CUP</span>
                    <h1>크레와트 기숙사 점수판</h1>
                    <p>낙찰자 배정표 기준으로 기숙사 점수를 집계합니다.</p>
                </header>
                <div class="crewart-score-stats">
                    <div><span>총점</span><strong>${Math.round(totalPoints).toLocaleString('ko-KR')}</strong></div>
                    <div><span>낙찰</span><strong>${totalSold}</strong></div>
                    <div><span>업데이트</span><strong>${escapeHtml(updatedAt)}</strong></div>
                </div>
                <div class="crewart-house-list">${rows}</div>
                ${unassigned}
            </section>
        `;
    }

    function ensureModuleStyle() {
        if (document.getElementById('event-module-runtime-style')) return;
        const style = document.createElement('style');
        style.id = 'event-module-runtime-style';
        style.textContent = `
            body[data-event-module="crewart"] {
                --accent: var(--event-accent, #6D28D9);
                --accent-light: var(--event-accent-soft, rgba(109,40,217,.10));
                --accent-glow: rgba(109,40,217,.18);
            }
            .event-module-chip {
                display:inline-flex;align-items:center;gap:8px;min-height:30px;padding:0 10px;
                border:1px solid var(--event-accent, #093687);border-radius:8px;
                color:var(--event-accent, #093687);background:var(--event-accent-soft, rgba(9,54,135,.08));
                font-size:12px;font-weight:800;white-space:nowrap;
            }
            .event-module-panel {
                display:flex;align-items:center;justify-content:space-between;gap:12px;
                width:100%;padding:12px 14px;border:1px solid rgba(148,163,184,.28);
                border-radius:10px;background:rgba(255,255,255,.04);
            }
            .event-module-panel strong { color:var(--text, inherit); }
            .event-module-panel span { color:var(--text2, #94a3b8);font-size:12px; }
            .event-module-panel select {
                min-width:170px;padding:9px 12px;border-radius:8px;border:1px solid var(--border, #334155);
                background:var(--card-bg, #fff);color:inherit;font-weight:800;
            }
            .crewart-scoreboard {
                width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;
                gap:2.6vh;padding:5vh 5vw;box-sizing:border-box;color:#f8fafc;
                background:radial-gradient(circle at 20% 0%, rgba(214,178,94,.22), transparent 30%),
                           linear-gradient(135deg, rgba(12,8,24,.98), rgba(28,18,45,.94));
                border:1px solid rgba(214,178,94,.24);
            }
            .crewart-score-head span {
                color:#d6b25e;font-size:clamp(12px,1.2vw,18px);font-weight:900;letter-spacing:.22em;
            }
            .crewart-score-head h1 {
                margin:.6vh 0 0;font-size:clamp(36px,5vw,84px);line-height:1;font-weight:950;letter-spacing:0;
            }
            .crewart-score-head p { margin:1vh 0 0;color:#b8adc8;font-size:clamp(13px,1.25vw,20px); }
            .crewart-score-stats { display:grid;grid-template-columns:repeat(3,1fr);border:1px solid rgba(255,255,255,.11);background:rgba(255,255,255,.045); }
            .crewart-score-stats div { min-width:0;padding:1.4vh 1.4vw;border-right:1px solid rgba(255,255,255,.08); }
            .crewart-score-stats div:last-child { border-right:0; }
            .crewart-score-stats span { display:block;color:#8f839f;font-size:clamp(9px,.9vw,14px);font-weight:850;letter-spacing:.12em; }
            .crewart-score-stats strong { display:block;margin-top:.4vh;font-size:clamp(22px,2.3vw,42px);font-weight:930; }
            .crewart-house-list { display:grid;gap:1.1vh; }
            .crewart-house-card {
                display:grid;grid-template-columns:minmax(42px,5vw) minmax(0,1fr) auto;align-items:center;gap:1.6vw;
                min-height:clamp(66px,10vh,122px);padding:1.5vh 1.6vw;border:1px solid color-mix(in srgb, var(--house) 55%, transparent);
                background:linear-gradient(90deg, color-mix(in srgb, var(--house) 24%, transparent), rgba(255,255,255,.035));
                box-shadow:inset 4px 0 0 var(--house);
            }
            .crewart-house-card.is-leading { border-color:#d6b25e;box-shadow:inset 4px 0 0 #d6b25e, 0 0 34px rgba(214,178,94,.12); }
            .crewart-house-rank { color:var(--house-accent);font-size:clamp(18px,2vw,34px);font-weight:950;font-variant-numeric:tabular-nums; }
            .crewart-house-name { overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:clamp(20px,2.5vw,44px);font-weight:920; }
            .crewart-house-meter { height:8px;margin-top:.9vh;background:rgba(255,255,255,.09);overflow:hidden; }
            .crewart-house-meter span { display:block;height:100%;background:linear-gradient(90deg,var(--house),var(--house-accent)); }
            .crewart-house-sub { margin-top:.75vh;color:#b8adc8;font-size:clamp(11px,1vw,16px);font-weight:700; }
            .crewart-house-score { color:#fff;font-size:clamp(24px,3.3vw,58px);font-weight:950;font-variant-numeric:tabular-nums;white-space:nowrap; }
            .crewart-house-score small { margin-left:.25em;color:#d6b25e;font-size:.38em;font-weight:850; }
            .crewart-unassigned { color:#fca5a5;font-size:clamp(11px,1vw,16px);font-weight:800;text-align:right; }
            .crewart-scoreboard.is-compact { padding:24px;background:transparent;border:0; }
            @media (max-width: 720px) {
                .event-module-panel { align-items:flex-start;flex-direction:column; }
                .event-module-panel select { width:100%; }
            }
        `;
        document.head.appendChild(style);
    }

    function applyEventModule(config) {
        const module = getActiveEventModule(config || {});
        ensureModuleStyle();
        if (document.body) {
            document.body.dataset.eventModule = module.id;
            document.body.style.setProperty('--event-accent', module.theme.accent);
            document.body.style.setProperty('--event-accent-soft', module.theme.accentSoft);
            document.body.style.setProperty('--event-gold', module.theme.gold);
            document.body.style.setProperty('--event-broadcast-accent', module.theme.broadcastAccent);
        }
        document.querySelectorAll('[data-event-text]').forEach(el => {
            const key = el.dataset.eventText;
            if (module[key] !== undefined) el.textContent = module[key];
        });
        document.querySelectorAll('[data-event-placeholder]').forEach(el => {
            const key = el.dataset.eventPlaceholder;
            if (module[key] !== undefined) el.setAttribute('placeholder', module[key]);
        });
        document.querySelectorAll('.js-event-admin-title').forEach(el => { el.textContent = module.adminTitle; });
        document.querySelectorAll('.js-event-nav-icon').forEach(el => { el.textContent = module.navIcon; });
        return module;
    }

    global.AUCTION_EVENT_MODULES = MODULES;
    global.getAuctionEventModule = getEventModule;
    global.getActiveAuctionEventModule = getActiveEventModule;
    global.applyAuctionEventModule = applyEventModule;
    global.parseCrewartHouses = parseHouseConfig;
    global.serializeCrewartHouses = serializeHouseConfig;
    global.parseCrewartParticipants = parseParticipantMap;
    global.buildCrewartHouseScores = buildCrewartHouseScores;
    global.renderCrewartHouseBoardHTML = renderCrewartHouseBoardHTML;
    global.resolveCrewartWinnerHouse = resolveCrewartWinnerHouse;
    global.resolveCrewartItemResult = resolveCrewartItemResult;
    global.crewartPointsForAmount = crewartPointsForAmount;
})(window);
