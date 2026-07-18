(function (global) {
    'use strict';

    const OFFICIAL_ROUND_RESULTS = Object.freeze([
        { name: '자몽', round16: 67, round8: 101 },
        { name: '아틀리에', round16: 54 },
        { name: '니코게코', round16: 60, round8: 67 },
        { name: '아쿠', round16: 16 },
        { name: '비송', round16: 175, round8: 252 },
        { name: '미야게코', round16: 87 },
        { name: '해치랩', round16: 24 },
        { name: '헤넥톤', round16: 60, round8: 74 },
        { name: '베누스', round16: 321, round8: 165 },
        { name: '라이카', round16: 40 },
        { name: '렙타일갤러리', round16: 155, round8: 122 },
        { name: '크레빌딩', round16: 72 },
        { name: '히꼬', round16: 175, round8: 174 },
        { name: '크레용', round16: 51 },
        { name: '앙크레', round16: 23 },
        { name: '어비스', round16: 100, round8: 91 }
    ]);

    const ROUND_OF_16_MATCHUPS = Object.freeze([
        { left: '자몽', right: '아틀리에' },
        { left: '니코게코', right: '아쿠' },
        { left: '비송', right: '미야게코' },
        { left: '해치랩', right: '헤넥톤' },
        { left: '베누스', right: '라이카' },
        { left: '렙타일갤러리', right: '크레빌딩' },
        { left: '히꼬', right: '크레용' },
        { left: '앙크레', right: '어비스' }
    ]);

    const QUARTERFINAL_MATCHUPS = Object.freeze([
        { left: '히꼬', right: '어비스' },
        { left: '자몽', right: '니코게코' },
        { left: '비송', right: '헤넥톤' },
        { left: '베누스', right: '렙타일갤러리' }
    ]);

    const SOLD_STATUSES = new Set(['완료', 'sold', '낙찰']);
    const ROUND_SCALES = Object.freeze([16, 8, 4, 2]);

    function parseAmount(value) {
        const normalized = String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, '');
        return Number.parseFloat(normalized) || 0;
    }

    function parseBracket(map, scale) {
        try {
            const parsed = JSON.parse(map?.['tournament_bracket_' + scale] || '{"matches":{}}');
            return parsed && typeof parsed === 'object' ? parsed : { matches: {} };
        } catch (_) {
            return { matches: {} };
        }
    }

    function checklistMeta(item) {
        const pairs = {};
        String(item?.checklist || '').split('|').forEach(part => {
            const index = part.indexOf(':');
            if (index > 0) pairs[part.slice(0, index)] = part.slice(index + 1);
        });
        return {
            auctionType: String(pairs._auction || '').toLowerCase(),
            tournamentStage: Number.parseInt(pairs._stage, 10) || 0
        };
    }

    function itemMeta(item) {
        return typeof global.getItemAuctionMeta === 'function'
            ? global.getItemAuctionMeta(item || {})
            : checklistMeta(item);
    }

    function isTournamentItem(item) {
        const meta = itemMeta(item);
        return meta.auctionType === 'tournament';
    }

    function isSoldItem(item) {
        return SOLD_STATUSES.has(String(item?.status || '').trim());
    }

    function officialPrice(name, round) {
        const result = OFFICIAL_ROUND_RESULTS.find(entry => entry.name === name);
        if (!result) return undefined;
        if (Number(round) === 16) return result.round16;
        if (Number(round) === 8) return result.round8;
        return undefined;
    }

    function storedWinner(match) {
        return match && (match.winner === 'left' || match.winner === 'right')
            ? String(match[match.winner] || '').trim()
            : '';
    }

    function roundAmount(roundAmounts, name, round) {
        const value = roundAmounts?.[round]?.[String(name || '').trim()];
        return value === undefined || value === null ? undefined : Number(value);
    }

    function winnerByAmount(match, roundAmounts, round) {
        if (!match?.left || !match?.right) return '';
        const saved = storedWinner(match);
        if (saved) return saved;
        const left = roundAmount(roundAmounts, match.left, round);
        const right = roundAmount(roundAmounts, match.right, round);
        if (left === undefined || right === undefined || left === right) return '';
        return left > right ? match.left : match.right;
    }

    function configuredStageTeams(map, stage) {
        const primary = parseBracket(map || {}, stage).matches || {};
        const fallback = stage === 2 ? (parseBracket(map || {}, 4).matches || {}) : {};
        const keys = stage === 4 ? ['4_1', '4_2'] : stage === 2 ? ['2_1', '2_2'] : [];
        return [...new Set(keys.flatMap(key => {
            const match = primary[key] || fallback[key] || {};
            return [match.left, match.right].map(value => String(value || '').trim()).filter(Boolean);
        }))];
    }

    function sumStageItems(items, stage, expectedTeams) {
        const expected = new Set((expectedTeams || []).map(name => String(name || '').trim()).filter(Boolean));
        return (items || []).reduce((result, item) => {
            const meta = itemMeta(item);
            const name = String(item?.company || '').trim();
            if (!name
                || !isTournamentItem(item)
                || Number(meta.tournamentStage) !== Number(stage)
                || !isSoldItem(item)
                || (expected.size && !expected.has(name))) {
                return result;
            }
            result[name] = (result[name] || 0) + parseAmount(item.sold_price ?? item.soldPrice);
            return result;
        }, {});
    }

    function archivedStageAmounts(map, stage, expectedTeams) {
        let index = [];
        try {
            const parsed = JSON.parse(map?.auction_archive_index || '[]');
            if (Array.isArray(parsed)) index = parsed;
        } catch (_) {}
        const expected = new Set((expectedTeams || []).filter(Boolean));
        for (const summary of index) {
            let snapshot = null;
            try {
                snapshot = JSON.parse(map?.[`auction_archive_${summary?.id}`] || 'null');
            } catch (_) {}
            const amounts = sumStageItems(snapshot?.items || [], stage, expectedTeams);
            const teams = Object.keys(amounts);
            if (!teams.length) continue;
            if (expected.size && [...expected].some(team => amounts[team] === undefined)) continue;
            return amounts;
        }
        return {};
    }

    function storedStageAmounts(map, stage, expectedTeams) {
        let parsed = null;
        try {
            parsed = JSON.parse(map?.[`tournament_round_amounts_${stage}`] || 'null');
        } catch (_) {}
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

        const expected = new Set((expectedTeams || []).map(name => String(name || '').trim()).filter(Boolean));
        const amounts = Object.entries(parsed).reduce((result, [name, value]) => {
            const team = String(name || '').trim();
            if (!team || (expected.size && !expected.has(team))) return result;
            result[team] = parseAmount(value);
            return result;
        }, {});
        if (expected.size && [...expected].some(team => amounts[team] === undefined)) return {};
        return amounts;
    }

    function buildRoundAmounts(map, items) {
        const result = { 16: {}, 8: {}, 4: {}, 2: {} };
        OFFICIAL_ROUND_RESULTS.forEach(entry => {
            result[16][entry.name] = entry.round16;
            if (entry.round8 !== undefined) result[8][entry.name] = entry.round8;
        });
        [4, 2].forEach(stage => {
            const expectedTeams = configuredStageTeams(map || {}, stage);
            const current = sumStageItems(items || [], stage, expectedTeams);
            const stored = storedStageAmounts(map || {}, stage, expectedTeams);
            result[stage] = Object.keys(current).length
                ? current
                : (Object.keys(stored).length
                    ? stored
                    : archivedStageAmounts(map || {}, stage, expectedTeams));
        });
        return result;
    }

    function teamTotal(roundAmounts, name) {
        return ROUND_SCALES.reduce((sum, round) => sum + (roundAmount(roundAmounts, name, round) || 0), 0);
    }

    function allTeamTotals(roundAmounts) {
        const names = new Set(OFFICIAL_ROUND_RESULTS.map(entry => entry.name));
        ROUND_SCALES.forEach(round => Object.keys(roundAmounts?.[round] || {}).forEach(name => names.add(name)));
        return [...names].reduce((result, name) => {
            result[name] = teamTotal(roundAmounts, name);
            return result;
        }, {});
    }

    global.CdcupTournamentData = Object.freeze({
        OFFICIAL_ROUND_RESULTS,
        ROUND_OF_16_MATCHUPS,
        QUARTERFINAL_MATCHUPS,
        ROUND_SCALES,
        parseAmount,
        parseBracket,
        officialPrice,
        storedWinner,
        roundAmount,
        winnerByAmount,
        configuredStageTeams,
        archivedStageAmounts,
        buildRoundAmounts,
        teamTotal,
        allTeamTotals
    });
})(window);
