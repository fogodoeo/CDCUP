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
        { id: 'sensory', name: '감각형', color: '#B91C1C', accent: '#FCA5A5' },
        { id: 'care', name: '관리형', color: '#047857', accent: '#86EFAC' },
        { id: 'analysis', name: '분석형', color: '#1D4ED8', accent: '#93C5FD' },
        { id: 'vision', name: '비전형', color: '#6D28D9', accent: '#C4B5FD' }
    ]);

    const LEGACY_HOUSE_NAMES = Object.freeze({
        '용맹의 탑': '감각형',
        '지혜의 탑': '관리형',
        '조화의 탑': '분석형',
        '야망의 탑': '비전형',
        '루멘크라운': '감각형',
        '모스그로브': '관리형',
        '세이블퀼': '분석형',
        '오닉스테일': '비전형'
    });

    function normalizeModuleId(value) {
        const raw = String(value || '').trim().toLowerCase();
        const id = raw === 'crewarts' ? 'crewart' : raw;
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
            name: LEGACY_HOUSE_NAMES[parts[0]] || parts[0] || ('기숙사 ' + (index + 1)),
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
        const phoneMatches = raw.match(/\d{2,4}[-\s.]?\d{3,4}[-\s.]?\d{4}/g) || [];
        const withoutPhone = raw.replace(/\d{2,4}[-\s.]?\d{3,4}[-\s.]?\d{4}/g, ' ');
        const firstChunk = raw.split(/[,(|/]/)[0];
        const values = [raw, withoutPhone, firstChunk, ...phoneMatches];
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
            Object.entries(LEGACY_HOUSE_NAMES).forEach(([legacyName, currentName]) => {
                if (currentName === house.name) houseByName[normalizePerson(legacyName)] = house;
            });
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
            const sigil = String(row.name || '?').trim().slice(0, 1) || '?';
            return `
                <article class="crewart-house-card ${row.rank === 1 ? 'is-leading' : ''}" style="--house:${escapeHtml(row.color)};--house-accent:${escapeHtml(row.accent)};">
                    <div class="crewart-house-rank"><span>RANK</span><strong>${String(row.rank).padStart(2, '0')}</strong></div>
                    <div class="crewart-house-sigil"><span>${escapeHtml(sigil)}</span></div>
                    <div class="crewart-house-main">
                        <div class="crewart-house-name">${escapeHtml(row.name)}</div>
                        <div class="crewart-house-meter"><span style="width:${pct}%"></span></div>
                        <div class="crewart-house-sub">${row.soldCount}건 낙찰 · ${Number(row.amount || 0).toLocaleString('ko-KR')}만원 · 기숙사 컵 집계</div>
                    </div>
                    <strong class="crewart-house-score">${Math.round(row.points).toLocaleString('ko-KR')}<small>pts</small></strong>
                </article>
            `;
        }).join('');
        const unassigned = result.unassigned.length
            ? `<div class="crewart-unassigned">기숙사 미지정 낙찰 ${result.unassigned.length}건</div>`
            : '';
        return `
            <section class="crewart-scoreboard ${compact ? 'is-compact' : ''}">
                <header class="crewart-score-head">
                    <span>CREWART MAGICAL HOUSE CUP</span>
                    <h1>기숙사 컵 점수판</h1>
                    <p>낙찰자의 기숙사 배정에 따라 점수가 즉시 반영됩니다.</p>
                </header>
                <div class="crewart-score-stats">
                    <div><span>TOTAL POINTS</span><strong>${Math.round(totalPoints).toLocaleString('ko-KR')}</strong></div>
                    <div><span>SOLD LOTS</span><strong>${totalSold}</strong></div>
                    <div><span>LAST CHARM</span><strong>${escapeHtml(updatedAt)}</strong></div>
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
                gap:2.3vh;padding:5vh 5vw;box-sizing:border-box;color:#fff4d5;position:relative;overflow:hidden;
                background:
                    radial-gradient(circle at 50% -18%, rgba(224,184,90,.28), transparent 34%),
                    radial-gradient(circle at 10% 20%, rgba(143,31,45,.22), transparent 26%),
                    radial-gradient(circle at 90% 16%, rgba(33,79,136,.18), transparent 28%),
                    linear-gradient(180deg, rgba(8,5,13,.98), rgba(18,10,20,.96));
                border:1px solid rgba(224,184,90,.28);
            }
            .crewart-scoreboard::before {
                content:'';position:absolute;inset:0;pointer-events:none;opacity:.5;
                background:
                    radial-gradient(circle, rgba(255,244,213,.9) 0 1px, transparent 1.8px) 6% 10% / 130px 120px,
                    radial-gradient(circle, rgba(224,184,90,.65) 0 1px, transparent 1.7px) 72% 14% / 160px 135px,
                    repeating-linear-gradient(90deg, transparent 0 10vw, rgba(224,184,90,.08) 10vw 10.1vw, transparent 10.1vw 16vw);
            }
            .crewart-scoreboard::after {
                content:'';position:absolute;left:5vw;right:5vw;top:3vh;height:1px;
                background:linear-gradient(90deg, transparent, rgba(224,184,90,.75), transparent);
            }
            .crewart-score-head span {
                position:relative;color:#e0b85a;font-size:clamp(12px,1.1vw,18px);font-weight:950;letter-spacing:.26em;
            }
            .crewart-score-head h1 {
                position:relative;margin:.7vh 0 0;color:#fff8df;font-size:clamp(40px,5.2vw,90px);line-height:.98;font-weight:980;letter-spacing:0;
                text-shadow:0 8px 38px rgba(0,0,0,.55), 0 0 24px rgba(224,184,90,.14);
            }
            .crewart-score-head p { position:relative;margin:1vh 0 0;color:#cab98b;font-size:clamp(13px,1.2vw,20px);font-weight:720; }
            .crewart-score-stats {
                position:relative;display:grid;grid-template-columns:repeat(3,1fr);
                border:1px solid rgba(224,184,90,.34);
                background:linear-gradient(180deg, rgba(246,232,185,.11), rgba(255,255,255,.035));
                box-shadow:inset 0 0 0 1px rgba(255,255,255,.045);
            }
            .crewart-score-stats div { min-width:0;padding:1.35vh 1.4vw;border-right:1px solid rgba(224,184,90,.14); }
            .crewart-score-stats div:last-child { border-right:0; }
            .crewart-score-stats span { display:block;color:#e0b85a;font-size:clamp(9px,.82vw,13px);font-weight:950;letter-spacing:.16em; }
            .crewart-score-stats strong { display:block;margin-top:.35vh;color:#fff8df;font-size:clamp(22px,2.3vw,42px);font-weight:950;font-variant-numeric:tabular-nums; }
            .crewart-house-list { position:relative;display:grid;gap:1.05vh; }
            .crewart-house-card {
                position:relative;display:grid;grid-template-columns:minmax(58px,5vw) minmax(58px,5.6vw) minmax(0,1fr) auto;align-items:center;gap:1.3vw;
                min-height:clamp(72px,10.5vh,126px);padding:1.45vh 1.55vw;
                border:1px solid color-mix(in srgb, var(--house) 58%, rgba(224,184,90,.25));
                background:
                    linear-gradient(90deg, color-mix(in srgb, var(--house) 34%, rgba(0,0,0,.22)), rgba(20,10,20,.78) 45%, rgba(9,5,12,.82)),
                    linear-gradient(180deg, rgba(255,244,213,.07), transparent);
                box-shadow:inset 6px 0 0 var(--house), 0 12px 36px rgba(0,0,0,.22);
                overflow:hidden;
            }
            .crewart-house-card::after {
                content:'';position:absolute;top:0;bottom:0;right:0;width:18%;
                background:linear-gradient(90deg, transparent, color-mix(in srgb, var(--house-accent) 18%, transparent));
                opacity:.72;pointer-events:none;
            }
            .crewart-house-card.is-leading {
                border-color:#e0b85a;
                box-shadow:inset 6px 0 0 #e0b85a, 0 0 42px rgba(224,184,90,.17), 0 14px 42px rgba(0,0,0,.28);
            }
            .crewart-house-rank { position:relative;z-index:1;color:#cab98b;font-variant-numeric:tabular-nums; }
            .crewart-house-rank span { display:block;font-size:clamp(8px,.7vw,11px);font-weight:950;letter-spacing:.16em; }
            .crewart-house-rank strong { display:block;color:var(--house-accent);font-size:clamp(20px,2.1vw,36px);font-weight:980;line-height:1; }
            .crewart-house-sigil {
                position:relative;z-index:1;display:grid;place-items:center;aspect-ratio:1;
                border:1px solid color-mix(in srgb, var(--house-accent) 72%, rgba(224,184,90,.35));
                background:radial-gradient(circle at 50% 32%, rgba(255,244,213,.16), transparent 48%), color-mix(in srgb, var(--house) 48%, rgba(8,5,13,.78));
                box-shadow:inset 0 0 0 3px rgba(255,255,255,.035);
                clip-path:polygon(50% 0, 94% 22%, 84% 88%, 50% 100%, 16% 88%, 6% 22%);
            }
            .crewart-house-sigil span { color:#fff8df;font-size:clamp(22px,2.3vw,40px);font-weight:980;text-shadow:0 2px 12px rgba(0,0,0,.55); }
            .crewart-house-main { position:relative;z-index:1;min-width:0; }
            .crewart-house-name { overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff8df;font-size:clamp(22px,2.55vw,46px);font-weight:950; }
            .crewart-house-meter { height:10px;margin-top:.9vh;background:rgba(255,244,213,.1);overflow:hidden;border:1px solid rgba(255,255,255,.08); }
            .crewart-house-meter span { display:block;height:100%;background:linear-gradient(90deg,var(--house),var(--house-accent),#f7df97);box-shadow:0 0 22px color-mix(in srgb, var(--house-accent) 44%, transparent); }
            .crewart-house-sub { margin-top:.75vh;color:#cab98b;font-size:clamp(11px,.95vw,16px);font-weight:780; }
            .crewart-house-score { position:relative;z-index:1;color:#fff8df;font-size:clamp(28px,3.55vw,64px);font-weight:980;font-variant-numeric:tabular-nums;white-space:nowrap;text-shadow:0 5px 24px rgba(0,0,0,.42); }
            .crewart-house-score small { margin-left:.3em;color:#e0b85a;font-size:.32em;font-weight:950;letter-spacing:.08em;text-transform:uppercase; }
            .crewart-unassigned { position:relative;color:#fca5a5;font-size:clamp(11px,1vw,16px);font-weight:850;text-align:right; }
            .crewart-scoreboard.is-compact { padding:24px;background:transparent;border:0;gap:14px; }
            .crewart-scoreboard.is-compact .crewart-score-head h1 { font-size:clamp(28px,3.6vw,56px); }
            .crewart-scoreboard.is-compact .crewart-house-card { grid-template-columns:42px 46px minmax(0,1fr) auto;min-height:76px; }
            @media (max-width: 720px) {
                .event-module-panel { align-items:flex-start;flex-direction:column; }
                .event-module-panel select { width:100%; }
                .crewart-scoreboard { padding:28px 18px;gap:14px;justify-content:flex-start;overflow:auto; }
                .crewart-score-stats { grid-template-columns:1fr; }
                .crewart-score-stats div { border-right:0;border-bottom:1px solid rgba(224,184,90,.14); }
                .crewart-score-stats div:last-child { border-bottom:0; }
                .crewart-house-card,
                .crewart-scoreboard.is-compact .crewart-house-card { grid-template-columns:42px minmax(0,1fr) auto;gap:12px; }
                .crewart-house-sigil { display:none; }
                .crewart-house-sub { white-space:normal; }
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
        document.querySelectorAll('.js-event-admin-title').forEach(el => {
            if (!el.dataset.defaultTitle) el.dataset.defaultTitle = el.textContent || '';
            el.textContent = el.dataset.eventAdminScope === 'module' ? module.adminTitle : el.dataset.defaultTitle;
        });
        document.querySelectorAll('.js-event-nav-icon').forEach(el => { el.textContent = module.navIcon; });
        return module;
    }

    let activeNavDropdown = null;
    let activeNavButton = null;

    function ensureNavPortalMenu() {
        let portal = document.getElementById('cdcup-nav-portal-menu');
        if (!portal) {
            portal = document.createElement('div');
            portal.id = 'cdcup-nav-portal-menu';
            portal.className = 'cdcup-nav-portal-menu';
            portal.setAttribute('role', 'menu');
            document.body.appendChild(portal);
        }
        return portal;
    }

    function closeNavPortalMenu() {
        const portal = document.getElementById('cdcup-nav-portal-menu');
        if (portal) {
            portal.classList.remove('is-open');
            portal.replaceChildren();
        }
        if (activeNavDropdown) activeNavDropdown.classList.remove('is-open');
        if (activeNavButton) activeNavButton.setAttribute('aria-expanded', 'false');
        activeNavDropdown = null;
        activeNavButton = null;
    }

    function positionNavPortalMenu(portal, button) {
        const margin = 12;
        const rect = button.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth || global.innerWidth || 0;
        const viewportHeight = document.documentElement.clientHeight || global.innerHeight || 0;
        const minWidth = Math.max(220, Math.ceil(rect.width));
        portal.style.minWidth = `${minWidth}px`;
        portal.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
        portal.style.left = `${Math.max(margin, Math.round(rect.left))}px`;
        portal.style.top = `${Math.round(rect.bottom + 6)}px`;
        portal.style.maxHeight = `${Math.max(160, viewportHeight - rect.bottom - 18)}px`;

        requestAnimationFrame(() => {
            const portalRect = portal.getBoundingClientRect();
            const width = Math.min(portalRect.width || minWidth, viewportWidth - margin * 2);
            let left = rect.left;
            if (left + width > viewportWidth - margin) left = viewportWidth - margin - width;
            if (left < margin) left = margin;
            portal.style.left = `${Math.round(left)}px`;
        });
    }

    function openNavPortalMenu(dropdown, button) {
        const sourceMenu = dropdown.querySelector('.cdcup-nav__dropdown-menu');
        if (!sourceMenu) return;
        const portal = ensureNavPortalMenu();
        portal.replaceChildren();
        sourceMenu.querySelectorAll('.cdcup-nav__dropdown-item').forEach(item => {
            const clone = item.cloneNode(true);
            clone.setAttribute('role', 'menuitem');
            clone.addEventListener('click', () => {
                setTimeout(closeNavPortalMenu, 0);
            });
            portal.appendChild(clone);
        });

        activeNavDropdown = dropdown;
        activeNavButton = button;
        dropdown.classList.add('is-open');
        button.setAttribute('aria-expanded', 'true');
        portal.classList.add('is-open');
        positionNavPortalMenu(portal, button);
    }

    function initNavDropdowns() {
        const nav = document.querySelector('.cdcup-nav');
        if (!nav) return;
        if (document.body) document.body.classList.add('nav-dropdown-portal-ready');
        const dropdowns = Array.from(nav.querySelectorAll('.cdcup-nav__dropdown'));
        const closeDropdowns = except => {
            dropdowns.forEach(dropdown => {
                if (dropdown === except) return;
                dropdown.classList.remove('is-open');
                const button = dropdown.querySelector('button.cdcup-nav__link');
                if (button) button.setAttribute('aria-expanded', 'false');
            });
            if (!except) closeNavPortalMenu();
        };

        dropdowns.forEach(dropdown => {
            const button = dropdown.querySelector('button.cdcup-nav__link');
            if (!button || button.dataset.navDropdownBound === '1') return;
            button.dataset.navDropdownBound = '1';
            button.setAttribute('aria-haspopup', 'true');
            button.setAttribute('aria-expanded', 'false');
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const shouldOpen = activeNavDropdown !== dropdown;
                closeDropdowns(dropdown);
                if (shouldOpen) openNavPortalMenu(dropdown, button);
                else closeNavPortalMenu();
            });
        });

        if (nav.dataset.navDropdownGlobalBound === '1') return;
        nav.dataset.navDropdownGlobalBound = '1';
        document.addEventListener('click', event => {
            const portal = document.getElementById('cdcup-nav-portal-menu');
            if (!nav.contains(event.target) && !portal?.contains(event.target)) closeDropdowns();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeDropdowns();
        });
        global.addEventListener('resize', closeNavPortalMenu);
        global.addEventListener('scroll', closeNavPortalMenu, true);
    }

    async function setActiveEventModule(moduleId, href) {
        const next = normalizeModuleId(moduleId);
        if (global.updateConfigs) await global.updateConfigs({ active_event_module: next });
        if (href) global.location.href = href;
        return next;
    }

    function handleEventModuleLink(event, moduleId, href) {
        if (event && event.preventDefault) event.preventDefault();
        setActiveEventModule(moduleId, href).catch(error => {
            if (global.alert) global.alert('방송 모듈 전환 실패: ' + (error.message || error));
            else throw error;
        });
        return false;
    }

    global.AUCTION_EVENT_MODULES = MODULES;
    global.getAuctionEventModule = getEventModule;
    global.getActiveAuctionEventModule = getActiveEventModule;
    global.applyAuctionEventModule = applyEventModule;
    global.setActiveAuctionEventModule = setActiveEventModule;
    global.handleAuctionEventModuleLink = handleEventModuleLink;
    global.parseCrewartHouses = parseHouseConfig;
    global.serializeCrewartHouses = serializeHouseConfig;
    global.parseCrewartParticipants = parseParticipantMap;
    global.buildCrewartHouseScores = buildCrewartHouseScores;
    global.renderCrewartHouseBoardHTML = renderCrewartHouseBoardHTML;
    global.resolveCrewartWinnerHouse = resolveCrewartWinnerHouse;
    global.resolveCrewartItemResult = resolveCrewartItemResult;
    global.crewartPointsForAmount = crewartPointsForAmount;
    global.initAuctionNavDropdowns = initNavDropdowns;

    if (global.document) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNavDropdowns);
        else initNavDropdowns();
    }
})(window);
