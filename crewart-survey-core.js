(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.CrewartSurveyCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const SURVEY_VERSION = 'cre-mbti-v1.0';
    const AXES = ['EI', 'SN', 'TF', 'JP'];
    const HOUSE_KEYS = ['SF', 'ST', 'NT', 'NF'];
    const MBTI_TYPES = [
        'ISTJ', 'ISFJ', 'INFJ', 'INTJ',
        'ISTP', 'ISFP', 'INFP', 'INTP',
        'ESTP', 'ESFP', 'ENFP', 'ENTP',
        'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'
    ];

    const QUESTIONS = [
        { id: 'Q01', axis: 'EI', label: '선택을 정리할 때', q: '두 크레 중 어느 쪽이 더 끌리는지 모르겠다. 나는?', options: ['친구와 이야기하며 생각을 정리한다', '혼자 사진을 다시 보며 생각을 정리한다'], scores: ['E', 'I'] },
        { id: 'Q02', axis: 'SN', label: '어린 크레를 볼 때', q: '아직 어린 크레를 고른다면 먼저 눈이 가는 것은?', options: ['지금 확인되는 컨디션과 표현', '가족의 성장 흐름과 앞으로의 가능성'], scores: ['S', 'N'] },
        { id: 'Q03', axis: 'TF', label: '조건이 비슷할 때', q: '건강과 가격이 비슷한 두 크레가 있다. 마지막 기준은?', options: ['미리 정한 조건에 더 잘 맞는 쪽', '계속 마음에 남고 정이 가는 쪽'], scores: ['T', 'F'] },
        { id: 'Q04', axis: 'JP', label: '입양을 준비할 때', q: '새 크레가 오기 전 사육장은 어떻게 준비할까?', options: ['필요한 세팅을 미리 끝내 둔다', '기본만 갖추고 반응을 보며 맞춘다'], scores: ['J', 'P'] },

        { id: 'Q05', axis: 'EI', label: '변화를 발견했을 때', q: '키우던 크레에게 예상 밖의 변화가 생겼다. 먼저 하는 일은?', options: ['사진을 공유하고 다른 경험을 들어본다', '이전 사진과 기록을 혼자 비교해 본다'], scores: ['E', 'I'] },
        { id: 'Q06', axis: 'SN', label: '성장 기록을 볼 때', q: '몇 달치 성장 기록을 펼쳤다. 먼저 찾는 것은?', options: ['체중과 색처럼 실제로 달라진 부분', '변화가 이어지는 방향과 다음 모습'], scores: ['S', 'N'] },
        { id: 'Q07', axis: 'TF', label: '친구를 도울 때', q: '친구가 두 크레 사이에서 고민한다. 나는 어떻게 도울까?', options: ['조건과 장단점을 나란히 비교해 준다', '어느 쪽이 더 오래 마음에 남는지 묻는다'], scores: ['T', 'F'] },
        { id: 'Q08', axis: 'JP', label: '경매를 시작할 때', q: '크레 경매를 보기 시작했다. 나에게 더 편한 방식은?', options: ['후보와 예산을 먼저 정해 놓고 본다', '전체를 둘러보며 후보를 바꿔 간다'], scores: ['J', 'P'] },

        { id: 'Q09', axis: 'EI', label: '새 방법이 궁금할 때', q: '처음 보는 사육 방법이 궁금해졌다. 나는?', options: ['커뮤니티에 질문하며 생각을 넓힌다', '자료를 모아 혼자 이해한 뒤 판단한다'], scores: ['E', 'I'] },
        { id: 'Q10', axis: 'SN', label: '낯선 모프를 볼 때', q: '처음 보는 모프를 만났다. 더 궁금한 것은?', options: ['지금 눈으로 확인되는 특징과 차이', '다른 조합에서 나타날 수 있는 변화'], scores: ['S', 'N'] },
        { id: 'Q11', axis: 'TF', label: '공간이 부족할 때', q: '공간상 한 마리만 더 데려올 수 있다. 무엇을 우선할까?', options: ['현재 사육 환경과 계획에 잘 맞는지', '오래 보고 싶었던 특별한 이유가 있는지'], scores: ['T', 'F'] },
        { id: 'Q12', axis: 'JP', label: '관리를 이어갈 때', q: '급여와 청소를 오래 이어갈 때 편한 방식은?', options: ['정한 요일과 순서를 꾸준히 지킨다', '상태와 일정에 맞춰 그때그때 조절한다'], scores: ['J', 'P'] },

        { id: 'Q13', axis: 'EI', label: '행사장에서 고민할 때', q: '행사장에서 마음에 드는 크레를 발견했다. 나는?', options: ['주변 사람과 이야기하며 확신을 찾는다', '혼자 한 바퀴 더 돌며 생각해 본다'], scores: ['E', 'I'] },
        { id: 'Q14', axis: 'SN', label: '설명을 들을 때', q: '브리더의 설명에서 더 기억에 남는 내용은?', options: ['현재 체중과 먹이 반응 같은 구체적인 정보', '혈통이 앞으로 보여줄 수 있는 성장 이야기'], scores: ['S', 'N'] },
        { id: 'Q15', axis: 'TF', label: '추천이 엇갈릴 때', q: '주변의 추천이 서로 다르다. 마지막에는 무엇을 믿을까?', options: ['같은 조건에서 비교할 수 있는 근거', '내 생활과 취향에 더 잘 맞는 느낌'], scores: ['T', 'F'] },
        { id: 'Q16', axis: 'JP', label: '바쁜 주를 앞두고', q: '다음 주가 바쁠 것 같다. 크레 관리는 어떻게 할까?', options: ['할 일을 미리 나누고 시간을 정해 둔다', '매일 상황을 보고 가능한 순서로 처리한다'], scores: ['J', 'P'] },

        { id: 'Q17', axis: 'EI', label: '좋은 결과가 생겼을 때', q: '새 세팅이 잘 맞아 크레 컨디션이 좋아졌다. 나는?', options: ['과정을 공유하고 다른 반응도 들어본다', '기록을 남기고 다음 변화를 더 지켜본다'], scores: ['E', 'I'] },
        { id: 'Q18', axis: 'SN', label: '여러 사진을 볼 때', q: '같은 크레의 사진 여러 장을 보면 먼저 보이는 것은?', options: ['사진마다 반복해서 확인되는 디테일', '시간에 따라 이어지는 전체 변화의 흐름'], scores: ['S', 'N'] },
        { id: 'Q19', axis: 'TF', label: '선택을 설명할 때', q: '내가 고른 크레를 누군가에게 설명한다면?', options: ['조건과 비교 결과를 중심으로 말한다', '처음 마음이 움직인 장면을 중심으로 말한다'], scores: ['T', 'F'] },
        { id: 'Q20', axis: 'JP', label: '사육장을 바꿀 때', q: '사육장을 업그레이드하려 한다. 나는?', options: ['필요한 것을 정리해 한 번에 완성한다', '한 가지씩 바꾸며 반응에 맞춰 이어간다'], scores: ['J', 'P'] }
    ];

    const QUESTION_IMAGES = [
        'question-c01.webp', 'question-c02.webp', 'question-c04.webp', 'question-c08.webp',
        'question-c05.webp', 'question-c06.webp', 'question-c07.webp', 'question-c03.webp',
        'question-c10.webp', 'question-c10.webp', 'question-c11.webp', 'question-c12.webp',
        'question-c09.webp', 'question-c02.webp', 'question-c07.webp', 'question-c12.webp',
        'question-c05.webp', 'question-c06.webp', 'question-c01.webp', 'question-c08.webp'
    ];

    QUESTIONS.forEach((question, index) => {
        question.image = QUESTION_IMAGES[index];
        question.imageAlt = `${question.label} 상황 삽화`;
    });

    const AXIS_META = {
        EI: {
            title: '생각을 정리하는 방향',
            letters: {
                E: { short: '함께 나누며 정리', description: '사람들과 경험을 주고받을 때 판단이 더 선명해져요.' },
                I: { short: '혼자 관찰하며 정리', description: '조용히 관찰하고 기록을 비교할 때 판단이 더 선명해져요.' }
            }
        },
        SN: {
            title: '크레를 바라보는 시선',
            letters: {
                S: { short: '지금 보이는 정보', description: '현재 확인되는 컨디션과 구체적인 차이를 먼저 봐요.' },
                N: { short: '앞으로의 가능성', description: '성장 흐름과 아직 드러나지 않은 다음 모습을 먼저 그려요.' }
            }
        },
        TF: {
            title: '선택을 결정하는 기준',
            letters: {
                T: { short: '조건과 근거', description: '비교할 수 있는 조건과 이유가 분명할 때 확신해요.' },
                F: { short: '취향과 관계', description: '나와 잘 맞고 오래 마음이 가는지를 중요하게 봐요.' }
            }
        },
        JP: {
            title: '사육을 운영하는 방식',
            letters: {
                J: { short: '미리 정하고 준비', description: '순서와 기준을 먼저 정해 두면 마음이 편해요.' },
                P: { short: '보면서 유연하게 조정', description: '실제 반응을 확인하며 계획을 바꿀 때 자연스러워요.' }
            }
        }
    };

    const CHANGE_MESSAGES = {
        'E>I': '평소보다 크레 앞에서는 혼자 관찰하고 정리하는 시간이 길어져요.',
        'I>E': '평소보다 크레 앞에서는 사람과 경험을 나눌 때 판단이 빨라져요.',
        'S>N': '평소보다 크레 앞에서는 현재 모습보다 성장 흐름과 다음 가능성을 더 봐요.',
        'N>S': '평소보다 크레 앞에서는 가능성보다 지금 확인되는 상태를 더 꼼꼼히 봐요.',
        'T>F': '평소보다 크레를 고를 때 조건보다 취향과 오래 갈 마음을 더 믿어요.',
        'F>T': '평소보다 크레 앞에서는 마음만큼 비교할 수 있는 조건과 근거를 챙겨요.',
        'J>P': '평소보다 크레를 돌볼 때 실제 반응에 맞춰 계획을 유연하게 바꿔요.',
        'P>J': '평소보다 크레 앞에서는 기준과 순서를 미리 정해 두는 편이에요.'
    };

    const TYPE_NAMES = {
        ISTJ: '기록 설계자', ISFJ: '세심한 보호자', INFJ: '성장 관찰자', INTJ: '장기 설계자',
        ISTP: '현장 조율자', ISFP: '감각 돌봄형', INFP: '애착 발견자', INTP: '원리 탐구자',
        ESTP: '즉시 해결사', ESFP: '반응 공유자', ENFP: '가능성 발견자', ENTP: '실험 개척자',
        ESTJ: '루틴 운영자', ESFJ: '함께 돌보는 사람', ENFJ: '방향 연결자', ENTJ: '프로젝트 지휘자'
    };

    const HOUSE_META = {
        SF: { name: 'ALPHA', korean: '알파', color: 'RED', seal: 'A', accent: '#df5a4b' },
        ST: { name: 'BRAVO', korean: '브라보', color: 'GREEN', seal: 'B', accent: '#6f9164' },
        NT: { name: 'CHARLIE', korean: '찰리', color: 'YELLOW', seal: 'C', accent: '#d9a83e' },
        NF: { name: 'DELTA', korean: '델타', color: 'BLUE', seal: 'D', accent: '#567fc4' }
    };

    function cloneQuestions() {
        return QUESTIONS.map(question => ({
            ...question,
            options: question.options.slice(),
            scores: question.scores.slice(),
            flipped: false
        }));
    }

    function randomInt(limit, rng) {
        return Math.floor((rng || Math.random)() * limit);
    }

    function shuffle(items, rng) {
        const result = items.slice();
        for (let index = result.length - 1; index > 0; index -= 1) {
            const target = randomInt(index + 1, rng);
            [result[index], result[target]] = [result[target], result[index]];
        }
        return result;
    }

    function prepareQuestions(rng) {
        const questions = cloneQuestions();
        const axesByFlipCount = shuffle(AXES, rng);
        axesByFlipCount.forEach((axis, axisIndex) => {
            const group = shuffle(questions.filter(question => question.axis === axis), rng);
            const flipCount = axisIndex < 2 ? 3 : 2;
            group.slice(0, flipCount).forEach(question => {
                [question.options[0], question.options[1]] = [question.options[1], question.options[0]];
                [question.scores[0], question.scores[1]] = [question.scores[1], question.scores[0]];
                question.flipped = true;
            });
        });

        let ordered = questions;
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const candidate = shuffle(questions, rng);
            if (candidate.every((question, index) => index === 0 || candidate[index - 1].axis !== question.axis)) {
                ordered = candidate;
                break;
            }
        }
        return ordered;
    }

    function scoreAnswers(questions, answers) {
        const letters = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
        questions.forEach((question, index) => {
            const choice = answers[index];
            const letter = question.scores[choice];
            if (letter in letters) letters[letter] += 1;
        });
        const code = (letters.E > letters.I ? 'E' : 'I')
            + (letters.S > letters.N ? 'S' : 'N')
            + (letters.T > letters.F ? 'T' : 'F')
            + (letters.J > letters.P ? 'J' : 'P');
        const axes = AXES.map((axis, index) => {
            const dominant = code[index];
            const opposite = axis[0] === dominant ? axis[1] : axis[0];
            return {
                axis,
                dominant,
                opposite,
                dominantCount: letters[dominant],
                oppositeCount: letters[opposite],
                confidence: Math.abs(letters[dominant] - letters[opposite]) / 5
            };
        });
        return { letters, code, axes, typeName: TYPE_NAMES[code] || '크레 집사' };
    }

    function buildMbtiComparison(knownType, creType) {
        if (!knownType || !MBTI_TYPES.includes(knownType)) return { knownType: '', creType, changes: [], sameCount: 0 };
        const changes = AXES.map((axis, index) => {
            if (knownType[index] === creType[index]) return null;
            const key = `${knownType[index]}>${creType[index]}`;
            return {
                axis,
                title: AXIS_META[axis].title,
                from: knownType[index],
                to: creType[index],
                message: CHANGE_MESSAGES[key]
            };
        }).filter(Boolean);
        return { knownType, creType, changes, sameCount: 4 - changes.length };
    }

    function median(values) {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function average(values) {
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    }

    function buildTimingStats(entries, questions) {
        const normalized = (entries || []).map((entry, index) => ({
            questionId: entry?.questionId || questions[index]?.id || '',
            axis: entry?.axis || questions[index]?.axis || '',
            elapsedMs: Math.round(Number(entry?.elapsedMs) || 0),
            valid: entry?.valid !== false && Number(entry?.elapsedMs) >= 400 && Number(entry?.elapsedMs) <= 30000
        }));
        const valid = normalized.filter(entry => entry.valid);
        const values = valid.map(entry => entry.elapsedMs);
        const axisMedians = {};
        AXES.forEach(axis => {
            axisMedians[axis] = Math.round(median(valid.filter(entry => entry.axis === axis).map(entry => entry.elapsedMs)));
        });
        const medianMs = Math.round(median(values));
        const style = medianMs < 2500
            ? { key: 'instinct', label: '빠른 직감형', copy: '첫 느낌을 빠르게 붙잡는 편이에요.' }
            : medianMs < 5000
                ? { key: 'balanced', label: '균형 판단형', copy: '직감과 확인 사이의 속도가 균형 잡혀 있어요.' }
                : { key: 'deliberate', label: '신중한 숙고형', copy: '한 번 더 비교한 뒤 선택하는 편이에요.' };
        return {
            entries: normalized,
            validCount: valid.length,
            totalMs: Math.round(values.reduce((sum, value) => sum + value, 0)),
            averageMs: Math.round(average(values)),
            medianMs,
            axisMedians,
            fastest: valid.slice().sort((a, b) => a.elapsedMs - b.elapsedMs)[0] || null,
            slowest: valid.slice().sort((a, b) => b.elapsedMs - a.elapsedMs)[0] || null,
            style
        };
    }

    function buildSpeedBenchmark(medianMs, sampleValues) {
        const samples = (sampleValues || []).map(Number).filter(value => value >= 400 && value <= 30000);
        if (samples.length < 10) {
            return {
                ready: false,
                sampleSize: samples.length,
                needed: 10 - samples.length,
                badge: `기준 데이터 ${samples.length} / 10`,
                message: '초기 응답이 쌓이면 다른 참여자와 선택 속도를 비교해 드려요.'
            };
        }
        const sampleAverage = Math.round(average(samples));
        const deltaMs = Math.abs(medianMs - sampleAverage);
        const fasterCount = samples.filter(value => value < medianMs).length;
        const rank = fasterCount + 1;
        const topPercent = Math.min(100, Math.max(10, Math.ceil((rank / (samples.length + 1)) * 10) * 10));
        const isFaster = medianMs <= sampleAverage;
        return {
            ready: true,
            sampleSize: samples.length,
            sampleAverage,
            deltaMs,
            topPercent,
            badge: isFaster && topPercent <= 50 ? `빠른 응답 상위 ${topPercent}%` : `참여자 ${samples.length}명 기준`,
            message: deltaMs < 250
                ? '현재 참여자 평균과 거의 같은 속도로 골랐어요.'
                : `현재 참여자 평균보다 ${Math.max(0.1, deltaMs / 1000).toFixed(1)}초 ${isFaster ? '빠르게' : '천천히'} 골랐어요.`
        };
    }

    function stableHash(value) {
        let hash = 2166136261;
        String(value || '').split('').forEach(character => {
            hash ^= character.charCodeAt(0);
            hash = Math.imul(hash, 16777619);
        });
        return hash >>> 0;
    }

    function chooseBalancedHouse(result, counts, seed) {
        const safeCounts = Object.fromEntries(HOUSE_KEYS.map(key => [key, Math.max(0, Number(counts?.[key]) || 0)]));
        const minimum = Math.min(...HOUSE_KEYS.map(key => safeCounts[key]));
        const candidates = HOUSE_KEYS.filter(key => safeCounts[key] === minimum);
        const affinity = {
            SF: result.letters.S + result.letters.F,
            ST: result.letters.S + result.letters.T,
            NT: result.letters.N + result.letters.T,
            NF: result.letters.N + result.letters.F
        };
        const bestScore = Math.max(...candidates.map(key => affinity[key]));
        const best = candidates.filter(key => affinity[key] === bestScore);
        return best[stableHash(seed) % best.length];
    }

    return {
        SURVEY_VERSION,
        AXES,
        HOUSE_KEYS,
        HOUSE_META,
        MBTI_TYPES,
        QUESTIONS,
        AXIS_META,
        TYPE_NAMES,
        prepareQuestions,
        scoreAnswers,
        buildMbtiComparison,
        buildTimingStats,
        buildSpeedBenchmark,
        chooseBalancedHouse,
        median,
        average
    };
}));
