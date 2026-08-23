(function () {
    'use strict';

    const Core = window.CrewartSurveyCore;
    const SURVEY_URL = 'https://creok.onrender.com/crewart-survey.html';
    const DEFAULT_BAND_URL = 'https://www.band.us/band/101992972/post';
    const BAND_MEMBER_API = '/api/band-membership';
    const REFERRAL_API = '/api/crewart-survey/shares';
    const REFERRAL_STORAGE_KEY = 'crewart_referral_source_v1';
    const KAKAO_JS_KEY = 'db7ffc8d6b9b7601b792ed69be4658fc';
    const TYPE_CHARACTER_ROOT = 'assets/crewart-types/';
    const TYPE_CHARACTER_VERSION = '20260815-character-webp-v2';
    const MEMBERSHIP_STORAGE_KEY = 'crewart_band_member_access_v1';
    const MEMBERSHIP_PHONE_STORAGE_KEY = 'crewart_band_member_phone_mask_v1';
    const LAST_RESULT_STORAGE_KEY = 'crewart_last_result_v3';
    const LEGACY_RESULT_STORAGE_KEYS = Object.freeze(['crewart_last_result_v1', 'crewart_last_result_v2']);
    const LAST_RESULT_VERSION = 3;
    const LEGACY_RESULT_QUESTION_VERSIONS = Object.freeze([
        'crewart-tendency-v8.1',
        'crewart-tendency-v8.0'
    ]);
    const isCompatibleResultQuestionVersion = version => (
        version === Core.SURVEY_VERSION || LEGACY_RESULT_QUESTION_VERSIONS.includes(version)
    );
    const MEMBERSHIP_RECHECK_VISIBLE_MS = 1000;
    const MEMBERSHIP_RECHECK_HIDDEN_MS = 10000;
    const MEMBERSHIP_RECHECK_TIMEOUT_MS = 15 * 60 * 1000;
    const CONTENT_CONFIG_KEY = 'crewart_mbti_content_v1';
    const BAND_INTEGRATION_ENABLED = true;
    const APP_HISTORY_KEY = 'crewartTab';
    const APP_TABS = Object.freeze(['home', 'result']);
    const AXIS_REPORT_COPY = Object.freeze({
        EI: { title: '생각 정리', left: '함께 정리', right: '혼자 정리' },
        SN: { title: '관찰 초점', left: '현재 정보', right: '성장 가능성' },
        TF: { title: '선택 기준', left: '조건·근거', right: '취향·관계' },
        JP: { title: '사육 방식', left: '계획·준비', right: '유연·조정' }
    });
    const TYPE_READINGS = Object.freeze({
        ISTJ: '당신이 돌본 크레의 변화는 기억보다 기록에 오래 남습니다. 어제와 비슷해 보이는 하루에서도 작은 차이를 찾아내고, 문제가 생기면 감으로 넘기기보다 언제부터 무엇이 달라졌는지 차분히 되짚어요. 덕분에 주변에서는 흔들릴 때 기준을 잡아주는 사람으로 기억하지만, 한 번 세운 방식이 잘 맞았던 만큼 새로운 신호를 기존 기록 안에서만 찾으려 할 때도 있습니다. 익숙한 기준 밖에서 들어온 작은 예외 하나가 오히려 다음 돌봄을 더 단단하게 만들어줄 수 있어요.',
        ISFJ: '당신 곁의 크레는 평소와 다른 작은 움직임도 쉽게 지나치지 않습니다. 말로 크게 드러내지는 않아도 어느 아이가 무엇을 좋아하고 언제 편안해지는지 오래 기억해두었다가 필요한 순간에 먼저 챙겨줘요. 그래서 함께 있는 사람들은 당신의 돌봄 안에서 안정감을 느끼지만, 모두가 편안하기를 바라는 마음 때문에 자신의 피로를 뒤늦게 알아차리기도 합니다. 오래 돌보기 위해 잠시 쉬는 것 역시 당신다운 책임의 한 부분이에요.',
        INFJ: '처음 만난 크레를 볼 때 당신의 시선은 지금 모습에서 오래 머물지 않습니다. 작은 반응과 지나온 기록을 천천히 이어보며 이 아이가 앞으로 어떤 모습으로 자랄지, 어떤 환경에서 가장 편안할지를 마음속에 그려요. 주변에서는 미처 말로 설명하지 못한 변화까지 먼저 알아채는 사람으로 느끼지만, 한 번 의미를 발견한 뒤에는 그 흐름을 너무 오래 믿고 싶어질 때도 있습니다. 가끔은 오늘 눈앞의 상태만 다시 바라보는 일이 당신의 깊은 직감을 더 정확하게 지켜줍니다.',
        INTJ: '한 마리를 데려오는 일도 당신에게는 오늘의 선택으로 끝나지 않습니다. 성장한 뒤의 모습과 관리가 이어질 방식까지 미리 그려본 다음, 오래 흔들리지 않을 구조를 조용히 만들어가요. 처음에는 혼자 멀리 보는 것처럼 보여도 시간이 지나면 주변 사람들은 당신이 왜 그 순서를 택했는지 뒤늦게 이해하게 됩니다. 다만 완성도 높은 그림일수록 예상 밖의 반응이 끼어들 자리가 좁아질 수 있으니, 계획 속에 작은 빈칸 하나를 남겨두는 편이 오히려 더 멀리 가게 해줘요.',
        ISTP: '예상하지 못한 문제가 생긴 순간, 당신은 걱정을 길게 설명하기보다 먼저 손이 움직이는 사람입니다. 눈앞의 상태를 빠르게 살피고 지금 바꿀 수 있는 것부터 건드리면서 가장 단순한 해결점을 찾아내요. 평소에는 존재감이 크지 않아 보여도 급한 순간이 오면 주변에서 자연스럽게 당신을 찾게 됩니다. 다만 문제가 해결된 뒤 기록을 남기는 일은 뒤로 밀릴 수 있으니, 짧은 한 줄만 남겨도 다음번의 빠른 감각이 훨씬 강해질 거예요.',
        ISFP: '당신은 설명을 오래 듣기 전부터 크레가 편안한지 아닌지를 먼저 느끼는 사람입니다. 남들이 비슷하다고 넘긴 색과 움직임에서도 그 아이만의 분위기를 발견하고, 정해진 방식보다 지금 필요한 돌봄을 조용히 건네요. 그래서 당신 곁의 개체는 비교의 대상보다 하나의 고유한 존재로 남지만, 마음이 깊어진 뒤에는 불편한 현실을 쉽게 끊어내지 못할 때도 있습니다. 좋아하는 마음을 오래 지키려면 때때로 거리와 기준도 돌봄의 일부가 되어야 해요.',
        INFP: '남들이 잠깐 보고 지나친 크레가 이상하게 오래 마음에 남는다면, 당신에게는 이미 작은 이야기가 시작된 것입니다. 지금 드러난 조건보다 그 아이가 앞으로 보여줄 모습과 함께 쌓일 시간을 떠올리며 천천히 애착을 키워가요. 그래서 익숙한 기준 밖에 있는 개체에서도 누구도 알아보지 못한 매력을 발견하지만, 마음속 이야기가 깊어질수록 현실적인 부담을 나중에 계산하기도 합니다. 그 이야기를 오래 이어가고 싶다면 시작 전에 생활 속 자리를 먼저 마련해주는 것이 좋아요.',
        INTP: '이상한 변화 하나가 보이면 당신의 머릿속에는 곧 여러 개의 가설이 생깁니다. 단순히 원인을 찾는 데서 멈추지 않고 기록과 환경을 다시 연결하며 왜 이런 반응이 나타났는지 스스로 납득할 때까지 파고들어요. 주변에서는 복잡한 문제를 새로운 관점으로 풀어내는 사람으로 보지만, 답이 거의 보이는 순간에도 더 나은 설명을 찾느라 행동이 늦어질 수 있습니다. 완벽한 해답보다 지금 시험할 수 있는 작은 한 가지를 고르면 탐구가 실제 변화로 이어져요.',
        ESTP: '문제가 생긴 자리에서 가장 먼저 상황을 읽고 움직이는 사람은 대개 당신입니다. 긴 설명을 기다리기보다 눈앞의 반응을 확인하며 지금 효과가 있는 방법을 빠르게 찾아내고, 분위기가 굳기 전에 다음 선택을 만들어내요. 덕분에 주변에서는 함께 있으면 어떻게든 풀릴 것 같은 사람으로 느끼지만, 해결이 빨랐던 만큼 원인을 기록하는 일은 가볍게 지나칠 수 있습니다. 일이 끝난 뒤 단 한 번만 되짚어봐도 타고난 대응력이 반복 가능한 실력으로 남게 됩니다.',
        ESFP: '좋은 변화를 발견한 순간 당신의 기쁨은 혼자 있는 법이 없습니다. 사진 한 장과 짧은 이야기만으로도 그 아이의 매력을 생생하게 전하고, 주변 사람들까지 자연스럽게 같은 순간을 즐기게 만들어요. 그래서 당신이 있는 자리에서는 작은 성장도 모두가 기억하는 장면이 되지만, 즐거운 반응이 클수록 다음 관리의 부담은 잠시 뒤로 밀릴 때가 있습니다. 설렘이 가장 클 때 필요한 것 하나만 먼저 확인해두면 즐거움도 훨씬 오래갑니다.',
        ENFP: '아직 작고 평범해 보이는 크레에게서 남들이 보지 못한 다음 모습을 먼저 발견하는 사람이 있습니다. 당신은 그 작은 가능성에 이야기를 붙이고 주변과 나누는 동안, 처음의 호기심을 모두가 기다리는 기대감으로 바꿔놓아요. 새로운 매력을 만날 때마다 세계가 조금씩 넓어지는 듯하지만, 마음을 끄는 가능성이 많아질수록 이미 시작한 돌봄의 무게가 흐릿해질 때도 있습니다. 새로 열린 문 하나를 고르기 전에 지금 품고 있는 이야기부터 돌아보면 당신의 발견은 더 오래 빛날 거예요.',
        ENTP: '모두가 익숙한 방법을 따를 때 당신은 자연스럽게 다른 가능성을 떠올립니다. 크레의 작은 반응 하나에서도 새로운 가설을 만들고, 사람들과 의견을 주고받으며 금세 다음 실험으로 이어가요. 정답이 없는 문제일수록 오히려 눈빛이 살아나 주변의 생각까지 움직이게 하지만, 흥미로운 다음 시도가 나타나면 이전 결과를 끝까지 정리하는 일은 지루해질 수 있습니다. 발견한 것을 한 줄이라도 남겨두면 당신의 호기심은 순간의 아이디어가 아니라 모두가 활용할 수 있는 길이 됩니다.',
        ESTJ: '개체가 늘고 해야 할 일이 겹쳐도 당신이 있는 곳에서는 곧 흐름이 생깁니다. 누가 무엇을 언제까지 해야 하는지 빠르게 정리하고, 복잡한 돌봄을 누구나 따라갈 수 있는 방식으로 바꾸는 힘이 있어요. 주변에서는 일이 흔들릴 때 믿고 맡길 수 있는 사람으로 느끼지만, 잘 돌아가던 기준일수록 개체마다 다른 작은 예외가 불편하게 보일 수 있습니다. 원칙을 버리지 않고도 예외 하나를 받아들일 자리를 만들면 당신의 운영은 더 오래 단단하게 유지됩니다.',
        ESFJ: '누가 어떤 크레를 아끼는지, 어느 아이가 평소와 조금 다른지를 당신은 생각보다 오래 기억합니다. 필요한 일을 먼저 발견하고도 혼자 처리한 티를 내기보다 주변이 함께 돌볼 수 있도록 자연스럽게 사람을 불러 모아요. 덕분에 당신이 있는 곳에서는 개체도 사람도 쉽게 소외되지 않지만, 모두의 필요를 챙기다 보면 자신의 여유가 가장 마지막에 남기도 합니다. 당신이 편안해야 돌봄의 분위기도 오래 유지된다는 사실을 잊지 않는 것이 좋아요.',
        ENFJ: '당신이 마음에 둔 크레는 이상하게 주변 사람들의 기억에도 오래 남습니다. 처음에는 사진 한 장을 보여줬을 뿐인데, 이야기를 나누는 사이 그 아이의 매력과 앞으로 달라질 모습이 점점 선명해지고 어느새 모두가 함께 성장을 기다리게 돼요. 무언가를 혼자 좋아하는 데서 끝내기보다 그 마음이 사람들 사이에 머물 자리를 만들어주는 사람에 가깝습니다. 다만 기대가 커질수록 현실적인 부담은 조금 늦게 보일 수 있으니, 마지막에는 지금의 생활과 오래 맞을지만 조용히 확인해보세요.',
        ENTJ: '마음에 드는 크레를 발견하면 당신의 관심은 한 마리에서 곧 더 큰 그림으로 이어집니다. 어떻게 관리해야 오래 안정적으로 성장할지, 필요한 사람과 자원을 어디에 놓아야 할지 자연스럽게 구조를 만들어요. 처음에는 속도가 빠르고 기준이 분명해 보이지만 결국 주변 사람들까지 같은 목표를 바라보게 만드는 힘이 있습니다. 다만 목표가 선명할수록 개체가 보내는 느린 신호를 일정의 변수처럼 볼 수 있으니, 계획이 잠시 멈추는 순간도 과정 안에 남겨두는 것이 좋아요.'
    });
    const IS_LOCAL_QA = ['127.0.0.1', 'localhost'].includes(location.hostname);
    const IS_QA_MODE = IS_LOCAL_QA;

    let config = {};
    let cohortSummary = {
        houseCounts: Object.fromEntries(Core.HOUSE_KEYS.map(key => [key, 0])),
        timingMedians: [],
        sampleSize: 0
    };
    let questions = [];
    let answers = [];
    let displayedChoices = [];
    let responseTimings = [];
    let current = 0;
    let selectedMbti = '';
    let surveySessionId = '';
    let sessionCreatedAt = '';
    let assignedHouseKey = '';
    let result = null;
    let resultSavedAt = '';
    let timingStats = null;
    let activeTimer = null;
    let advancing = false;
    let saveInFlight = false;
    let lastSavedSignature = '';
    let toastTimer = null;
    let choiceLockTimer = null;
    let choiceLockAttempted = false;

    let bandAuthReady = false;
    let bandAuthConfigured = false;
    let bandAuthToken = '';
    let bandAuthUser = null;
    let bandAuthPhoneMask = '';
    let bandTargetUrl = DEFAULT_BAND_URL;
    let pendingResultReveal = false;
    let editingMembership = false;
    let pendingMemberPhone = '';
    let membershipRecheckTimer = null;
    let membershipRecheckStartedAt = 0;
    let membershipCheckInFlight = false;
    let showingStoredResult = false;
    let memberKeyboardTimer = null;
    let preparedSaveFile = null;
    let preparedSaveUrl = '';
    let preparedKakaoShareFile = null;
    let preparedKakaoShareUrl = '';
    let resultExperienceCleanup = null;
    let referralId = '';

    function validReferralId(value) {
        const normalized = String(value || '').trim();
        return /^[a-zA-Z0-9_-]{16,64}$/.test(normalized) ? normalized : '';
    }

    function createReferralId() {
        if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
        if (globalThis.crypto?.getRandomValues) {
            const bytes = new Uint8Array(18);
            globalThis.crypto.getRandomValues(bytes);
            return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        }
        return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 24)}`;
    }

    function referralShareUrl(id) {
        const url = new URL(SURVEY_URL);
        url.searchParams.set('src', 'kakao');
        url.searchParams.set('sid', id);
        return url.toString();
    }

    function trackReferral(eventName, options = {}) {
        const id = validReferralId(options.id || referralId);
        if (!id) return;
        const headers = { 'Content-Type': 'application/json' };
        if (options.authenticated && bandAuthToken) headers.Authorization = `Bearer ${bandAuthToken}`;
        void fetch(REFERRAL_API, {
            method: 'POST',
            cache: 'no-store',
            keepalive: true,
            headers,
            body: JSON.stringify({ shareId: id, event: eventName, source: 'kakao' })
        }).catch(() => undefined);
    }

    function createTrackedShareUrl() {
        const id = createReferralId();
        trackReferral('share', { id });
        return referralShareUrl(id);
    }

    function initializeReferral() {
        const params = new URLSearchParams(window.location.search);
        const incoming = params.get('src') === 'kakao' ? validReferralId(params.get('sid')) : '';
        if (incoming) {
            referralId = incoming;
            try { sessionStorage.setItem(REFERRAL_STORAGE_KEY, incoming); } catch (_) { }
            trackReferral('landing');
            return;
        }
        try { referralId = validReferralId(sessionStorage.getItem(REFERRAL_STORAGE_KEY)); } catch (_) { }
    }

    function element(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[character]));
    }

    function typeCharacterPath(code) {
        const normalized = String(code || '').toLowerCase();
        return `${TYPE_CHARACTER_ROOT}crewart-type-${normalized}.webp?v=${TYPE_CHARACTER_VERSION}`;
    }

    function maskPhone(phone) {
        const digits = String(phone || '').replace(/\D/g, '');
        return /^010\d{8}$/.test(digits) ? `${digits.slice(0, 3)}-****-${digits.slice(-4)}` : '';
    }

    function loadLastResult() {
        try {
            const snapshot = JSON.parse(localStorage.getItem(LAST_RESULT_STORAGE_KEY) || 'null');
            if (snapshot?.version !== LAST_RESULT_VERSION || !isCompatibleResultQuestionVersion(snapshot.questionVersion)) return null;
            if (!Core.MBTI_TYPES.includes(snapshot.result?.code)) return null;
            if (!Core.HOUSE_KEYS.includes(snapshot.assignedHouseKey)) return null;
            if (!Array.isArray(snapshot.result?.axes) || snapshot.result.axes.length !== 4) return null;
            return snapshot;
        } catch (_) {
            return null;
        }
    }

    function saveLastResult() {
        if (!result || !Core.MBTI_TYPES.includes(result.code) || !Core.HOUSE_KEYS.includes(assignedHouseKey)) return;
        const savedAt = new Date().toISOString();
        resultSavedAt = savedAt;
        const snapshot = {
            version: LAST_RESULT_VERSION,
            questionVersion: Core.SURVEY_VERSION,
            savedAt,
            selectedMbti: Core.MBTI_TYPES.includes(selectedMbti) ? selectedMbti : '',
            assignedHouseKey,
            result: {
                code: result.code,
                typeName: result.typeName,
                letters: { ...result.letters },
                axes: result.axes.map(axis => ({ ...axis }))
            },
            timingStats: timingStats ? {
                validCount: timingStats.validCount,
                totalMs: timingStats.totalMs,
                averageMs: timingStats.averageMs,
                medianMs: timingStats.medianMs,
                axisMedians: { ...timingStats.axisMedians },
                style: { ...timingStats.style },
                fastest: timingStats.fastest ? { ...timingStats.fastest } : null,
                slowest: timingStats.slowest ? { ...timingStats.slowest } : null
            } : null
        };
        try { localStorage.setItem(LAST_RESULT_STORAGE_KEY, JSON.stringify(snapshot)); } catch (_) { }
        renderHome();
    }

    function renderHome() {
        const snapshot = loadLastResult();
        const card = element('home-result-card');
        const startCard = element('home-start-card');
        const intro = element('intro-screen');
        if (!card || !startCard) return;
        card.hidden = !snapshot;
        startCard.hidden = Boolean(snapshot);
        intro?.classList.toggle('has-result', Boolean(snapshot));
        if (!snapshot) return;
        const detailed = hasDetailedAccess();
        const house = detailed ? Core.HOUSE_META[snapshot.assignedHouseKey] : null;
        element('home-result-code').textContent = snapshot.result.code;
        element('home-result-heading').textContent = snapshot.result.typeName;
        const housePanel = element('home-house-name')?.closest('.cw-home-house');
        if (housePanel) housePanel.hidden = !detailed;
        element('home-house-name').textContent = house ? `${house.korean} 기숙사` : '';
        card.style.setProperty('--house-accent', house?.accent || '#16814b');
    }

    function restoreLastResult(options = {}) {
        const snapshot = loadLastResult();
        if (!snapshot) {
            renderHome();
            renderEmptyResult();
            setScreen('result-screen');
            return;
        }
        pauseTimer();
        activeTimer = null;
        questions = [];
        answers = [];
        displayedChoices = [];
        responseTimings = [];
        selectedMbti = snapshot.selectedMbti || '';
        surveySessionId = '';
        sessionCreatedAt = '';
        result = snapshot.result;
        resultSavedAt = snapshot.savedAt || '';
        assignedHouseKey = snapshot.assignedHouseKey;
        timingStats = snapshot.timingStats;
        showingStoredResult = true;
        renderResult({ animate: Boolean(options.animate) });
        setScreen('result-screen');
    }

    function updateBandState() {
        const form = element('member-check-form');
        const verified = element('band-verified-state');
        const number = element('auth-phone-number');
        const connection = element('band-connection-status');
        const bandScreen = element('home-band-section');
        const authenticated = Boolean(bandAuthUser?.isTargetMember);
        const state = authenticated && editingMembership
            ? 'editing'
            : authenticated
                ? 'connected'
                : pendingMemberPhone
                    ? 'pending'
                    : bandAuthReady
                        ? 'disconnected'
                        : 'loading';
        if (form) form.hidden = authenticated && !editingMembership;
        if (verified) verified.hidden = !authenticated || editingMembership;
        if (number) number.textContent = bandAuthPhoneMask || '확인된 회원';
        const homeButton = element('home-auth-button');
        const homeTitle = element('home-band-title');
        const startButton = element('start-button');
        const startSpan = startButton?.querySelector('span');
        if (authenticated) {
            if (startSpan) startSpan.textContent = '다시 검사하기';
            if (homeTitle) homeTitle.textContent = bandAuthPhoneMask ? `BAND 회원 확인 완료 · ${bandAuthPhoneMask}` : 'BAND 회원 확인 완료';
            if (homeButton) {
                homeButton.textContent = '관리';
                homeButton.classList.add('is-connected');
            }
        } else {
            if (startSpan) startSpan.textContent = '성향 테스트 시작';
            if (homeTitle) homeTitle.textContent = '회원 확인 후 기숙사와 전체 분석 보기';
            if (homeButton) {
                homeButton.textContent = '회원 확인';
                homeButton.classList.remove('is-connected');
            }
        }
        if (bandScreen) bandScreen.dataset.membershipState = state;
        const navStatus = element('band-nav-status');
        navStatus?.classList.toggle('is-verified', authenticated);
        navStatus?.classList.toggle('is-pending', state === 'pending');
        if (navStatus) navStatus.hidden = authenticated;
    }

    function toast(message, isError) {
        const target = element('toast');
        if (!target) return;
        target.textContent = message;
        target.style.borderColor = isError ? 'rgba(248,113,113,.55)' : 'rgba(220,196,134,.45)';
        target.classList.add('is-visible');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => target.classList.remove('is-visible'), 2600);
    }

    let wordmarkFontReady;

    function playWordmark() {
        const wordmark = element('crewart-wordmark');
        if (!wordmark) return;
        if (!wordmarkFontReady) {
            const fontLoad = document.fonts?.load
                ? document.fonts.load('900 72px "Pretendard Variable"').catch(() => [])
                : Promise.resolve([]);
            wordmarkFontReady = Promise.race([
                fontLoad,
                new Promise(resolve => setTimeout(resolve, 1400))
            ]);
        }
        void wordmarkFontReady.then(() => {
            wordmark.classList.remove('is-pending', 'is-writing');
            void wordmark.offsetWidth;
            wordmark.classList.add('is-writing');
        });
    }

    function setupIntroVideo() {
        const introVideo = element('intro-video');
        if (!introVideo) return;
        const intro = element('intro-screen');
        let fallbackTimer = 0;
        introVideo.controls = false;
        introVideo.muted = true;
        introVideo.defaultMuted = true;
        introVideo.playsInline = true;
        const reveal = () => {
            window.clearTimeout(fallbackTimer);
            introVideo.classList.add('is-playing');
            intro?.classList.add('is-video-ready');
        };
        const conceal = () => {
            introVideo.classList.remove('is-playing');
            if (!intro?.classList.contains('is-video-ready')) {
                window.clearTimeout(fallbackTimer);
                fallbackTimer = window.setTimeout(() => intro?.classList.add('is-video-ready'), 1400);
            }
        };
        introVideo.addEventListener('playing', reveal);
        introVideo.addEventListener('error', conceal);
        introVideo.addEventListener('emptied', conceal);
        fallbackTimer = window.setTimeout(() => intro?.classList.add('is-video-ready'), 2200);
        if (!introVideo.paused && introVideo.readyState >= 3) reveal();
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            void introVideo.play().then(reveal).catch(conceal);
        }
    }

    function setScreen(screenId) {
        ['intro-screen', 'question-screen', 'mbti-screen', 'result-screen'].forEach(id => {
            const screen = element(id);
            const active = id === screenId;
            screen.hidden = !active;
            screen.classList.toggle('is-active', active);
            if (active) {
                screen.classList.remove('is-entering');
                requestAnimationFrame(() => screen.classList.add('is-entering'));
                if (id === 'intro-screen') playWordmark();
            }
        });
        document.body.classList.toggle('cw-result-experience', screenId === 'result-screen' && Boolean(result));
        const introVideo = element('intro-video');
        if (introVideo) {
            const canPlay = screenId === 'intro-screen' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (canPlay) void introVideo.play().then(() => introVideo.classList.add('is-playing')).catch(() => introVideo.classList.remove('is-playing'));
            else introVideo.pause();
        }
        updatePersistentActions();
        syncThemeColor(screenId);
        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function syncMemberKeyboardState(options = {}) {
        const input = element('member-phone');
        const screen = element('home-band-section');
        const viewport = window.visualViewport;
        const viewportHeight = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight);
        const focused = Boolean(input && screen && !screen.hidden && document.activeElement === input);
        document.documentElement.style.setProperty('--cw-visual-viewport-height', `${viewportHeight}px`);
        document.body.classList.toggle('cw-keyboard-open', focused);
        screen?.classList.toggle('is-keyboard-open', focused);
        if (!focused || options.ensureVisible === false) return;
        if (memberKeyboardTimer) clearTimeout(memberKeyboardTimer);
        memberKeyboardTimer = setTimeout(() => {
            if (document.activeElement !== input || screen?.hidden) return;
            input.closest('.cw-member-form')?.scrollIntoView({
                block: 'center',
                behavior: options.immediate ? 'auto' : 'smooth'
            });
        }, options.immediate ? 20 : 90);
    }

    function createSessionId() {
        return window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    }

    async function hashSessionId(value) {
        const source = new TextEncoder().encode(`crewart-session:${value}`);
        if (window.crypto?.subtle) {
            const digest = await window.crypto.subtle.digest('SHA-256', source);
            return Array.from(new Uint8Array(digest)).slice(0, 12).map(byte => byte.toString(16).padStart(2, '0')).join('');
        }
        let output = '';
        for (let round = 0; round < 3; round += 1) {
            let hash = (2166136261 ^ (round * 2654435761)) >>> 0;
            source.forEach(byte => {
                hash ^= byte + round;
                hash = Math.imul(hash, 16777619);
            });
            output += (hash >>> 0).toString(16).padStart(8, '0');
        }
        return output;
    }

    function applyManagedContent(raw) {
        if (!raw || questions.length) return;
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (parsed?.version !== Core.SURVEY_VERSION) return;
            const items = Array.isArray(parsed) ? parsed : parsed?.questions;
            if (!Array.isArray(items)) return;
            items.forEach(item => {
                const target = Core.QUESTIONS.find(question => question.id === String(item?.id || '').toUpperCase());
                if (!target) return;
                if (String(item.label || '').trim()) target.label = String(item.label).trim();
                if (String(item.q || '').trim()) target.q = String(item.q).trim();
                if (Array.isArray(item.options) && item.options.length >= 4) {
                    const options = item.options.slice(0, 4).map(value => String(value || '').trim());
                    if (options.every(Boolean)) target.options = options;
                }
            });
        } catch (error) {
            console.warn('[Crewart managed questions]', error);
        }
    }

    async function loadConfig() {
        try {
            const response = await bandFetch('/api/crewart-survey/bootstrap', { cache: 'no-store' });
            if (!response.ok) throw new Error('CREWART survey bootstrap unavailable');
            const payload = await response.json();
            config = {
                [CONTENT_CONFIG_KEY]: payload.content || null,
                crewart_mbti_content_updated_at: payload.contentUpdatedAt || null
            };
            applyManagedContent(payload.content);
            cohortSummary = {
                houseCounts: Object.fromEntries(Core.HOUSE_KEYS.map(key => [
                    key,
                    Math.max(0, Number(payload.cohort?.houseCounts?.[key]) || 0)
                ])),
                timingMedians: (Array.isArray(payload.cohort?.timingMedians)
                    ? payload.cohort.timingMedians
                    : []).map(Number).filter(value => value >= Core.MIN_RESPONSE_MS && value <= Core.MAX_RESPONSE_MS),
                sampleSize: Math.max(0, Number(payload.cohort?.sampleSize) || 0)
            };
        } catch (error) {
            console.error('[Crewart config]', error);
            config = {};
            cohortSummary = {
                houseCounts: Object.fromEntries(Core.HOUSE_KEYS.map(key => [key, 0])),
                timingMedians: [],
                sampleSize: 0
            };
        }
    }

    function startTimer(index) {
        clearChoiceLock();
        choiceLockAttempted = false;
        activeTimer = {
            index,
            elapsedMs: 0,
            visibleAt: document.visibilityState === 'visible' ? performance.now() : null
        };
    }

    function pauseTimer() {
        if (!activeTimer || activeTimer.visibleAt === null) return;
        activeTimer.elapsedMs += performance.now() - activeTimer.visibleAt;
        activeTimer.visibleAt = null;
    }

    function resumeTimer() {
        if (!activeTimer || activeTimer.visibleAt !== null || document.visibilityState !== 'visible') return;
        activeTimer.visibleAt = performance.now();
    }

    function captureTiming(index) {
        if (!activeTimer || activeTimer.index !== index) return;
        pauseTimer();
        const rawMs = Math.round(activeTimer.elapsedMs);
        const elapsedMs = Math.max(3100, rawMs);
        responseTimings[index] = {
            questionId: questions[index].id,
            axis: questions[index].axis,
            elapsedMs,
            valid: true
        };
    }

    function activeElapsedMs() {
        if (!activeTimer) return 0;
        const visibleMs = activeTimer.visibleAt === null ? 0 : performance.now() - activeTimer.visibleAt;
        return activeTimer.elapsedMs + visibleMs;
    }

    function clearChoiceLock() {
        if (choiceLockTimer === null) return;
        window.clearInterval(choiceLockTimer);
        choiceLockTimer = null;
    }

    function updateChoiceLock(index) {
        if (!activeTimer || activeTimer.index !== index || current !== index + 1) {
            clearChoiceLock();
            return;
        }
        const remainingMs = Math.max(0, Core.MIN_RESPONSE_MS - activeElapsedMs());
        const locked = remainingMs > 0;
        element('choice-list').querySelectorAll('[data-choice]').forEach(button => {
            button.dataset.timeLocked = String(locked);
        });
        const status = element('choice-lock-status');
        if (status) {
            const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
            status.textContent = locked
                ? choiceLockAttempted
                    ? `아직 선택할 수 없어요 · ${remainingSeconds}초만 더 봐주세요`
                    : `${remainingSeconds}초 후 선택할 수 있어요`
                : '이제 선택할 수 있어요';
            status.classList.toggle('is-ready', !locked);
            status.classList.toggle('is-warning', locked && choiceLockAttempted);
        }
        if (!locked) clearChoiceLock();
    }

    function startChoiceLock(index) {
        updateChoiceLock(index);
        if (choiceLockTimer !== null) return;
        choiceLockTimer = window.setInterval(() => updateChoiceLock(index), 100);
    }

    function startSurvey() {
        clearChoiceLock();
        questions = Core.prepareQuestions();
        answers = [];
        displayedChoices = [];
        responseTimings = [];
        current = 0;
        selectedMbti = '';
        surveySessionId = createSessionId();
        sessionCreatedAt = new Date().toISOString();
        assignedHouseKey = '';
        result = null;
        resultSavedAt = '';
        timingStats = null;
        showingStoredResult = false;
        advancing = false;
        lastSavedSignature = '';
        setScreen('question-screen');
        renderQuestion();
    }

    function closeMemberCheck() {
        const dialog = element('member-dialog');
        if (dialog) {
            if (typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');
        }
    }

    function openMemberCheck(options = {}) {
        pendingResultReveal = Boolean(options.revealResult);
        const status = element('member-check-status');
        const joinLink = element('member-join-link');
        const submit = element('member-check-submit');
        const submitLabel = element('member-check-submit-label');
        if (status && !pendingMemberPhone) {
            status.hidden = true;
            status.textContent = '';
            status.classList.remove('is-error', 'is-success', 'is-action');
        }
        if (joinLink) {
            joinLink.hidden = false;
            joinLink.classList.remove('is-recommended');
        }
        if (submit) {
            submit.disabled = false;
            submit.classList.remove('is-recheck');
        }
        if (submitLabel) submitLabel.textContent = '확인하기';
        if (!hasDetailedAccess()) editingMembership = false;
        updateBandState();
        const dialog = element('member-dialog');
        if (dialog && !dialog.open) {
            if (typeof dialog.showModal === 'function') {
                dialog.showModal();
            } else {
                dialog.setAttribute('open', '');
            }
        }
    }

    function editMembershipAccess() {
        if (!hasDetailedAccess()) return;
        editingMembership = true;
        const status = element('member-check-status');
        if (status) {
            status.hidden = true;
            status.textContent = '';
            status.classList.remove('is-error', 'is-success', 'is-action');
        }
        updateBandState();
        requestAnimationFrame(() => {
            const input = element('member-phone');
            if (!input) return;
            try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
            syncMemberKeyboardState({ immediate: true });
        });
    }

    function clearMembershipAccess() {
        if (!hasDetailedAccess()) return;
        if (!window.confirm('이 기기의 BAND 회원 확인을 해제할까요?')) return;
        stopMembershipRecheck();
        bandAuthToken = '';
        bandAuthUser = null;
        bandAuthPhoneMask = '';
        editingMembership = false;
        try {
            sessionStorage.removeItem(MEMBERSHIP_STORAGE_KEY);
            sessionStorage.removeItem(MEMBERSHIP_PHONE_STORAGE_KEY);
        } catch (_) { }
        updateBandUi();
        toast('회원 확인을 해제했어요.');
    }

    function returnToIntro() {
        const stage = currentStage();
        if ((stage === 'questions' || stage === 'mbti')
            && !window.confirm('진행 중인 테스트를 닫고 처음 화면으로 갈까요?\n\nBAND 회원 확인 상태와 이전에 저장한 결과는 유지됩니다.')) return;
        pauseTimer();
        clearChoiceLock();
        activeTimer = null;
        questions = [];
        answers = [];
        displayedChoices = [];
        responseTimings = [];
        current = 0;
        selectedMbti = '';
        surveySessionId = '';
        sessionCreatedAt = '';
        assignedHouseKey = '';
        result = null;
        timingStats = null;
        showingStoredResult = false;
        advancing = false;
        lastSavedSignature = '';
        element('result-content').replaceChildren();
        renderHome();
        setScreen('intro-screen');
    }

    function renderQuestion() {
        advancing = false;
        const card = element('question-card');
        element('choice-list').classList.remove('is-four-option');
        card.classList.toggle('is-guide', current === 0);
        element('q0-copyright').hidden = current !== 0;
        if (current === 0) {
            clearChoiceLock();
            activeTimer = null;
            element('progress-text').textContent = `0 / ${questions.length}`;
            element('progress-axis').textContent = '안내사항';
            element('progress-bar').style.width = '0%';
            element('question-back').disabled = false;
            element('question-label').hidden = false;
            element('question-label').textContent = 'BEFORE YOU START';
            element('question-title').textContent = '시작 전, 이것만 확인해 주세요';
            element('choice-list').innerHTML = `
                <div class="cw-q0-card">
                    <ol class="cw-q0-list">
                        <li><b>01</b><span>재미를 위한 성향 콘텐츠이며, 과학적·의학적 진단이 아닙니다.</span></li>
                        <li><b>02</b><span>크레 앞에서는 평소 유형과 다른 결과가 나올 수 있습니다.</span></li>
                        <li><b>03</b><span>네 답 모두 괜찮습니다. 평소 먼저 손이 가는 쪽을 골라주세요.</span></li>
                        <li><b>04</b><span>두 답이 끌리면 실제 그 순간 가장 먼저 할 행동을 선택해주세요.</span></li>
                    </ol>
                    <button class="cw-primary-button cw-q0-start-button" type="button" data-q0-start>시작하기</button>
                </div>`;
            element('choice-list').querySelector('[data-q0-start]')?.addEventListener('click', () => {
                if (advancing) return;
                advancing = true;
                current = 1;
                renderQuestion();
            });
            card.classList.remove('is-changing');
            requestAnimationFrame(() => card.classList.add('is-changing'));
            return;
        }

        const qIndex = current - 1;
        const question = questions[qIndex];
        if (!question) return;
        const options = question.options;
        const isFourOption = Array.isArray(question.scorePairs);
        element('progress-text').textContent = `${current} / ${questions.length}`;
        element('progress-axis').textContent = '크레 앞의 나를 찾는 중';
        element('progress-bar').style.width = `${(current / questions.length) * 100}%`;
        element('question-back').disabled = false;
        // Scenario labels are useful for the question editor, but duplicate the actual
        // question for participants and cost valuable vertical space on mobile.
        element('question-label').hidden = true;
        element('question-label').textContent = '';
        element('question-title').textContent = question.q;
        element('choice-list').classList.toggle('is-four-option', isFourOption);
        element('choice-list').innerHTML = options.map((option, index) => `
            <button class="cw-choice-button${(isFourOption ? displayedChoices[qIndex] : answers[qIndex]) === index ? ' is-selected' : ''}" type="button" data-choice="${index}" data-time-locked="false" aria-describedby="choice-lock-status">
                <span>${escapeHtml(option)}</span>
            </button>`).join('') + '<p class="cw-choice-lock-status" id="choice-lock-status" role="status" aria-live="polite"></p>';
        element('choice-list').querySelectorAll('[data-choice]').forEach(button => {
            button.addEventListener('click', () => chooseAnswer(Number(button.dataset.choice)));
        });
        card.classList.remove('is-changing');
        requestAnimationFrame(() => card.classList.add('is-changing'));
        startTimer(qIndex);
        startChoiceLock(qIndex);
    }

    function chooseAnswer(choice) {
        if (advancing || current < 1) return;
        const qIndex = current - 1;
        advancing = true;
        clearChoiceLock();
        const question = questions[qIndex];
        displayedChoices[qIndex] = choice;
        answers[qIndex] = choice;
        captureTiming(qIndex);
        element('choice-list').querySelectorAll('[data-choice]').forEach(button => {
            const selected = Number(button.dataset.choice) === choice;
            button.classList.toggle('is-selected', selected);
            button.disabled = true;
        });
        const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 20 : 260;
        setTimeout(() => {
            if (current < questions.length) {
                current += 1;
                renderQuestion();
            } else {
                finishQuestions();
            }
        }, delay);
    }

    function previousQuestion() {
        if (advancing) return;
        if (current === 0) {
            returnToIntro();
            return;
        }
        current -= 1;
        renderQuestion();
    }

    function finishQuestions() {
        clearChoiceLock();
        activeTimer = null;
        const missing = questions.findIndex((_, index) => answers[index] === undefined);
        if (missing >= 0) {
            current = missing + 1;
            renderQuestion();
            toast('선택하지 않은 질문이 있어요.', true);
            return;
        }
        result = Core.scoreAnswers(questions, answers);
        timingStats = Core.buildTimingStats(responseTimings, questions);
        assignedHouseKey = '';
        renderMbtiOptions();
        setScreen('mbti-screen');
    }

    function renderMbtiOptions() {
        element('mbti-grid').innerHTML = Core.MBTI_TYPES.map(type => `
            <button class="cw-mbti-option${selectedMbti === type ? ' is-selected' : ''}" type="button" data-mbti="${type}">${type}</button>`).join('');
        element('mbti-grid').querySelectorAll('[data-mbti]').forEach(button => {
            button.addEventListener('click', () => {
                selectedMbti = button.dataset.mbti;
                renderMbtiOptions();
                element('show-result').disabled = false;
            });
        });
    }

    function showResult(skipMbti) {
        if (!result) return;
        if (!selectedMbti && !skipMbti) {
            toast('평소 유형을 고르거나 건너뛰기를 눌러주세요.', true);
            return;
        }
        completeResultReveal();
    }

    async function completeResultReveal() {
        showingStoredResult = false;
        if (!hasDetailedAccess()) {
            renderResult({ animate: true });
            setScreen('result-screen');
            return;
        }
        if (!assignedHouseKey && IS_LOCAL_QA) assignedHouseKey = choosePreviewHouse();
        if (!assignedHouseKey && surveySessionId && bandAuthUser?.isTargetMember) {
            toast('기숙사를 배정하고 있어요.');
            try {
                const savedHouse = await submitSurvey();
                if (savedHouse && Core.HOUSE_KEYS.includes(savedHouse)) assignedHouseKey = savedHouse;
            } catch (err) {
                console.warn('[completeResultReveal] submit fallback:', err);
            }
        }
        if (!assignedHouseKey) {
            assignedHouseKey = choosePreviewHouse() || Core.HOUSE_KEYS[0];
        }
        saveLastResult();
        renderResult({ animate: true });
        setScreen('result-screen');
    }

    function formatSeconds(milliseconds) {
        return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}초`;
    }

    function hasDetailedAccess() {
        const isPreview = Boolean(
            new URLSearchParams(window.location.search).get('preview') ||
            new URLSearchParams(window.location.search).get('mbti') ||
            new URLSearchParams(window.location.search).get('type')
        );
        return IS_LOCAL_QA || isPreview || Boolean(bandAuthUser && bandAuthUser.isTargetMember === true);
    }

    function choosePreviewHouse() {
        const counts = Object.fromEntries(Core.HOUSE_KEYS.map(key => [
            key,
            Math.max(0, Number(cohortSummary.houseCounts?.[key]) || 0)
        ]));
        const minimum = Math.min(...Object.values(counts));
        const candidates = Core.HOUSE_KEYS.filter(key => counts[key] === minimum);
        return candidates[Math.floor(Math.random() * candidates.length)] || Core.HOUSE_KEYS[0];
    }

    function resultSpeedPresentation() {
        if (!timingStats?.style) return null;
        const valid = timingStats.validCount > 0 && timingStats.averageMs > 0;
        const value = valid ? formatSeconds(timingStats.averageMs) : '-';
        const samples = cohortSummary.timingMedians.map(Number)
            .filter(value => value >= Core.MIN_RESPONSE_MS && value <= Core.MAX_RESPONSE_MS);
        const cohortAverageMs = samples.length ? samples.reduce((sum, sample) => sum + sample, 0) / samples.length : timingStats.averageMs;
        const relative = valid && cohortAverageMs > 0 ? Math.log2(timingStats.averageMs / cohortAverageMs) : 0;
        const position = Math.max(7, Math.min(93, 50 + relative * 25));
        const comparison = samples.length
            ? `참여자 평균 ${formatSeconds(cohortAverageMs)} · ${samples.length}명 기준`
            : '참여자 비교 데이터 준비 중';
        const label = position <= 38
            ? '빠르게 고르는 편'
            : position >= 62
                ? '신중하게 고르는 편'
                : '균형 있게 고르는 편';
        return { value, position, comparison, label };
    }

    function renderUnifiedResult(profile, house) {
        const strengthStatement = profile.superpower || profile.summary || TYPE_READINGS[result.code] || '관찰한 내용을 자신만의 방식으로 정리해 다음 행동으로 연결합니다.';
        const bestMatchCode = profile.bestMatch?.mbti || '좋은 조합';
        const bestMatchTitle = profile.bestMatch?.title || '서로 다른 방식도 천천히 맞춰갈 수 있어요.';
        const worstMatchCode = profile.worstMatch?.mbti || '다른 조합';
        const worstMatchTitle = profile.worstMatch?.title || '속도와 기준이 달라 천천히 맞춰가야 해요.';
        const speed = resultSpeedPresentation() || { value: '측정 전', position: 50, comparison: '비교 데이터 준비 중', label: '측정 전' };
        const axisRows = result.axes.map(axisResult => {
            const copy = AXIS_REPORT_COPY[axisResult.axis];
            const first = axisResult.axis[0];
            const second = axisResult.axis[1];
            const firstCount = Number(result.letters[first]) || 0;
            const secondCount = Number(result.letters[second]) || 0;
            const totalCount = firstCount + secondCount || 1;
            const isLeftDominant = axisResult.dominant === first;

            // Calculate ratio with minimum clear offset so it always deflects distinctly
            const dominantRatio = isLeftDominant ? firstCount / totalCount : secondCount / totalCount;
            const normalizedRatio = Math.max(0.62, Math.min(0.92, dominantRatio));

            // Left dominant moves to 20%~32%, Right dominant moves to 68%~80%
            const position = isLeftDominant
                ? Math.round(50 - (normalizedRatio - 0.5) * 65)
                : Math.round(50 + (normalizedRatio - 0.5) * 65);

            return {
                title: copy?.title || axisResult.axis,
                left: copy?.left || first,
                right: copy?.right || second,
                selected: isLeftDominant ? (copy?.left || first) : (copy?.right || second),
                isLeftDominant,
                position
            };
        });
        const axisMarkup = axisRows.map(axis => `
            <div class="cw-story-axis-row" data-axis-target="${axis.position}" role="img" aria-label="${escapeHtml(`${axis.title}: ${axis.selected}`)}">
                <div class="cw-story-axis-labels">
                    <span class="${axis.isLeftDominant ? 'is-dominant' : ''}">${escapeHtml(axis.left)}</span>
                    <small>${escapeHtml(axis.title)}</small>
                    <span class="${!axis.isLeftDominant ? 'is-dominant' : ''}">${escapeHtml(axis.right)}</span>
                </div>
                <div class="cw-story-axis-track" aria-hidden="true"><i></i><b></b></div>
            </div>`).join('');

        element('result-content').innerHTML = `
            <div class="cw-story-page" style="--house-accent:${escapeHtml(house.accent)}">
                <section class="cw-story-track" data-result-story aria-label="스크롤로 확인하는 결과 리포트">
                    <div class="cw-story-sticky">
                        <header class="cw-story-topbar">
                            <button type="button" data-action="go-home" aria-label="홈으로 돌아가기">← <span>홈</span></button>
                            <div><small>결과 리포트</small><strong data-story-top-code>분석 중</strong></div>
                        </header>
                        <div class="cw-story-progress" aria-hidden="true"><i data-story-progress></i></div>
                        <div class="cw-story-stage" aria-live="polite">
                            <section class="cw-story-scene is-axis" data-story-scene="axis">
                                <div class="cw-story-result-hero">
                                    <div class="cw-story-result-character" aria-hidden="true">
                                        <strong class="cw-story-result-code" data-final-code="${escapeHtml(result.code)}">????</strong>
                                        <img src="${escapeHtml(typeCharacterPath(result.code))}" width="360" height="520" alt="" loading="eager" decoding="async">
                                    </div>
                                    <p class="cw-story-result-title">${escapeHtml(profile.title || result.typeName)}</p>
                                </div>
                                                                <div class="cw-story-axis-chart">${axisMarkup}</div>
                            </section>

                            <section class="cw-story-scene is-profile" data-story-scene="profile">
                                <article class="cw-story-card is-strength">
                                    <strong>${escapeHtml(strengthStatement)}</strong>
                                </article>
                                <article class="cw-story-card is-match">
                                    <div class="cw-story-match-type is-good"><small>좋은 상성</small><strong>${escapeHtml(bestMatchCode)}</strong><p>${escapeHtml(bestMatchTitle)}</p></div>
                                    <div class="cw-story-match-type is-bad"><small>나쁜 상성</small><strong>${escapeHtml(worstMatchCode)}</strong><p>${escapeHtml(worstMatchTitle)}</p></div>
                                </article>
                            </section>

                            <section class="cw-story-scene is-time" data-story-scene="time">
                                <small data-time-label>응답 시간 계산 중</small>
                                <strong data-time-value data-final-time="${escapeHtml(speed.value)}">--.-초</strong>
                                <div class="cw-story-speed" style="--speed-position:${speed.position}%">
                                    <div><span class="${speed.position <= 45 ? 'is-dominant' : ''}">빠른 선택</span><span class="${speed.position >= 55 ? 'is-dominant' : ''}">신중한 선택</span></div>
                                    <i aria-hidden="true"><b></b></i>
                                    <strong>${escapeHtml(speed.label)}</strong>
                                    <small>${escapeHtml(speed.comparison)}</small>
                                </div>
                            </section>

                            <section class="cw-story-scene is-house" data-story-scene="house">
                                <div class="cw-story-house-line"><span>당신의 기숙사는</span><strong data-house-name data-final-house="${escapeHtml(house.name)}">${escapeHtml(house.name)}</strong><span>입니다.</span></div>
                                <div class="cw-story-final-actions">
                                    <div class="cw-story-share-row">
                                        <button type="button" class="cw-story-kakao" data-action="share"><img src="assets/kakaolink_btn_medium.png" width="24" height="24" alt=""><span data-action-label>카카오톡 공유</span></button>
                                        <button type="button" class="cw-story-save" data-action="save-image"><i aria-hidden="true">↓</i><span data-action-label>이미지 저장</span></button>
                                    </div>
                                    ${BAND_INTEGRATION_ENABLED ? `<a class="cw-story-band" data-band-prompt href="${escapeHtml(bandTargetUrl)}" target="_blank" rel="noopener noreferrer">
                                        <img src="assets/band-app-icon-official.png?v=20260801-logo-v2" width="40" height="40" alt="">
                                        <strong>BAND로 가기</strong><i aria-hidden="true">→</i>
                                    </a>` : ''}
                                </div>
                                <small class="cw-story-credit">© 2026 CREO. All rights reserved.</small>
                            </section>
                        </div>
                        <div class="cw-story-cue" aria-hidden="true"><span>SCROLL</span><i><b></b><b></b></i></div>
                    </div>
                </section>
            </div>`;

        bindRenderedResultActions();
        resultExperienceCleanup = setupResultStory();
    }

    function renderResultTeaser(profile) {
        element('result-content').innerHTML = `
            <div class="cw-result-teaser">
                <header class="cw-story-topbar">
                    <button type="button" data-action="go-home" aria-label="홈으로 돌아가기">← <span>홈</span></button>
                    <div><small>결과 미리보기</small><strong>${escapeHtml(result.code)}</strong></div>
                </header>
                <main class="cw-result-teaser-main">
                    <div class="cw-result-teaser-hero is-guest-code">
                        <strong aria-label="${escapeHtml(result.code)}">${escapeHtml(result.code)}</strong>
                    </div>
                    <div class="cw-result-teaser-copy">
                        <p>${escapeHtml(profile.title || result.typeName)}</p>
                    </div>
                    <section class="cw-result-teaser-lock" aria-labelledby="result-unlock-title">
                        <img src="assets/band-app-icon-official.png?v=20260801-logo-v2" width="46" height="46" alt="">
                        <div>
                            <strong id="result-unlock-title">성향 분석과 내 기숙사 확인하기</strong>
                            <span>BAND 회원 인증 후 전체 결과가 바로 열려요.</span>
                        </div>
                        <button type="button" data-action="unlock-detail">BAND 인증하기</button>
                    </section>
                </main>
            </div>`;
        bindRenderedResultActions();
    }

    function bindRenderedResultActions() {
        element('result-content').querySelector('[data-action="go-home"]')?.addEventListener('click', () => navigateToTab('home'));
        element('result-content').querySelectorAll('[data-action="share"]').forEach(button => button.addEventListener('click', shareResult));
        element('result-content').querySelectorAll('[data-action="save-image"]').forEach(button => button.addEventListener('click', saveResultImage));
        element('result-content').querySelectorAll('[data-action="unlock-detail"]').forEach(button => button.addEventListener('click', handleUnlockDetail));
    }

    function setupResultStory() {
        const root = element('result-content').querySelector('[data-result-story]');
        if (!root) return () => { };
        const progressNode = root.querySelector('[data-story-progress]');
        const axisRows = [...root.querySelectorAll('[data-axis-target]')];
        const scenes = Object.fromEntries([...root.querySelectorAll('[data-story-scene]')].map(node => [node.dataset.storyScene, node]));
        const timeValueNode = root.querySelector('[data-time-value]');
        const timeLabelNode = root.querySelector('[data-time-label]');
        const heroCodeNode = root.querySelector('[data-final-code]');
        const topCodeNode = root.querySelector('[data-story-top-code]');
        const speedNode = root.querySelector('.cw-story-speed');
        const targetSpeedPosition = speedNode ? (parseFloat(speedNode.style.getPropertyValue('--speed-position')) || 50) : 50;
        if (speedNode) speedNode.style.setProperty('--speed-position', '50%');
        const bandPromptNode = root.querySelector('[data-band-prompt]');
        const clamp = value => Math.max(0, Math.min(1, value));
        const segment = (value, start, end) => clamp((value - start) / (end - start));
        let frame = 0;
        let activeScene = '';
        let timeShuffleTimer = 0;
        let heroShuffleTimer = 0;
        let bandPromptTimer = 0;
        let latestProgress = 0;
        let touchStartY = 0;
        let bandPromptAnnounced = false;
        let timeShuffleStarted = false;
        let timeShuffleSettled = false;
        let heroCodeSettled = false;
        const TIME_SCENE_START = .63;
        const TIME_SCENE_LOCK = .7;

        const randomType = () => Core.MBTI_TYPES[Math.floor(Math.random() * Core.MBTI_TYPES.length)] || '????';
        const settleHeroCode = () => {
            if (!heroCodeNode || heroCodeSettled) return;
            heroCodeSettled = true;
            window.clearInterval(heroShuffleTimer);
            heroShuffleTimer = 0;
            const finalCode = heroCodeNode.dataset.finalCode || result.code;
            heroCodeNode.textContent = finalCode;
            heroCodeNode.setAttribute('aria-label', finalCode);
            heroCodeNode.classList.remove('is-cycling');
            heroCodeNode.classList.add('is-settled');
            if (topCodeNode) topCodeNode.textContent = finalCode;
            root.classList.remove('is-code-cycling');
            root.classList.add('is-code-settled');
        };
        const startHeroShuffle = () => {
            if (!heroCodeNode || heroCodeSettled || heroShuffleTimer) return;
            root.classList.add('is-code-cycling');
            heroCodeNode.classList.add('is-cycling');
            heroCodeNode.textContent = randomType();
            heroShuffleTimer = window.setInterval(() => {
                heroCodeNode.textContent = randomType();
            }, 110);
        };

        const storyProgressToScrollY = progress => {
            const rect = root.getBoundingClientRect();
            const rootTop = window.scrollY + rect.top;
            const range = Math.max(1, root.offsetHeight - window.innerHeight);
            return rootTop + (range * progress);
        };
        const holdTimeScene = () => {
            if (!timeShuffleStarted || timeShuffleSettled) return;
            const lockY = storyProgressToScrollY(TIME_SCENE_LOCK);
            if (Math.abs(window.scrollY - lockY) > 1) window.scrollTo({ top: lockY, behavior: 'auto' });
        };
        const blockTimeSceneScroll = event => {
            if (!timeShuffleStarted || timeShuffleSettled) return;
            event.preventDefault();
            holdTimeScene();
        };
        const blockTimeSceneKeys = event => {
            if (!timeShuffleStarted || timeShuffleSettled) {
                if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) revealBandPrompt();
                return;
            }
            if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) return;
            event.preventDefault();
            holdTimeScene();
        };
        const revealBandPrompt = () => {
            if (!bandPromptNode || bandAuthUser?.isTargetMember === true || latestProgress < .96) return;
            window.clearTimeout(bandPromptTimer);
            root.classList.remove('is-band-prompted');
            requestAnimationFrame(() => root.classList.add('is-band-prompted'));
            bandPromptTimer = window.setTimeout(() => root.classList.remove('is-band-prompted'), 1500);
            if (!bandPromptAnnounced) {
                bandPromptAnnounced = true;
                toast('BAND에 참여하고 결과 이야기를 이어가보세요.');
            }
        };
        const handleEndWheel = event => {
            if (event.deltaY > 0) revealBandPrompt();
        };
        const handleEndTouchStart = event => {
            touchStartY = event.touches?.[0]?.clientY || 0;
        };
        const handleEndTouchEnd = event => {
            const endY = event.changedTouches?.[0]?.clientY || touchStartY;
            if (touchStartY - endY > 18) revealBandPrompt();
        };

        const houseNameNode = root.querySelector('[data-house-name]');
        let houseRollStarted = false;
        let houseRollSettled = false;

        const startHouseRoll = () => {
            if (!houseNameNode || houseRollStarted) return;
            houseRollStarted = true;
            houseRollSettled = false;
            const finalHouse = houseNameNode.dataset.finalHouse || '';
            const houseList = ['RED', 'GREEN', 'BLUE', 'YELLOW', finalHouse].filter(Boolean);
            let hIndex = 0;
            houseNameNode.textContent = '······';
            houseNameNode.classList.add('is-rolling');
            const hTimer = setInterval(() => {
                hIndex += 1;
                if (hIndex >= houseList.length) {
                    clearInterval(hTimer);
                    houseNameNode.textContent = finalHouse;
                    houseNameNode.classList.remove('is-rolling');
                    houseNameNode.classList.add('is-settled');
                    houseRollSettled = true;
                    return;
                }
                houseNameNode.textContent = houseList[hIndex];
            }, 80);
        };

        const settleTimeValue = () => {
            if (!timeValueNode) return;
            timeValueNode.textContent = timeValueNode.dataset.finalTime || '측정 전';
            timeValueNode.classList.remove('is-shuffling');
            timeValueNode.classList.add('is-settled');
            if (timeLabelNode) timeLabelNode.textContent = '평균 문항 시간';
            if (speedNode) {
                speedNode.style.setProperty('--speed-position', `${targetSpeedPosition}%`);
                speedNode.classList.add('is-settled');
            }
            timeShuffleSettled = true;
            scheduleSync();
        };
        const startTimeShuffle = () => {
            if (!timeValueNode || timeShuffleStarted) return;
            timeShuffleStarted = true;
            timeShuffleSettled = false;
            window.clearInterval(timeShuffleTimer);
            let ticks = 0;
            timeValueNode.classList.add('is-shuffling');
            timeValueNode.classList.remove('is-settled');
            if (timeLabelNode) timeLabelNode.textContent = '응답 시간 계산 중';
            if (speedNode) {
                speedNode.style.setProperty('--speed-position', '50%');
                speedNode.classList.remove('is-settled');
            }
            timeValueNode.textContent = `${(3 + Math.random() * 10).toFixed(1)}초`;
            timeShuffleTimer = window.setInterval(() => {
                ticks += 1;
                if (ticks >= 9) {
                    window.clearInterval(timeShuffleTimer);
                    timeShuffleTimer = 0;
                    settleTimeValue();
                    return;
                }
                timeValueNode.textContent = `${(3 + Math.random() * 10).toFixed(1)}초`;
            }, 65);
        };

        const sync = () => {
            frame = 0;
            const rect = root.getBoundingClientRect();
            const range = Math.max(1, root.offsetHeight - window.innerHeight);
            const rawProgress = clamp(-rect.top / range);
            root.style.setProperty('--hero-progress', segment(rawProgress, 0, .08));
            if (rawProgress >= .055) settleHeroCode();
            if (rawProgress >= TIME_SCENE_START && !timeShuffleStarted) startTimeShuffle();
            if (rawProgress >= .78 && !houseRollStarted) startHouseRoll();
            const progress = timeShuffleStarted && !timeShuffleSettled
                ? TIME_SCENE_LOCK
                : rawProgress;
            latestProgress = progress;
            root.style.setProperty('--story-progress', progress);
            const axisProgress = segment(progress, .02, .17);
            const profileIn = segment(progress, .35, .37);
            const profileOut = 1 - segment(progress, .59, .62);
            const timeIn = segment(progress, .64, .66);
            const timeOut = 1 - segment(progress, .77, .8);
            const houseProgress = segment(progress, .82, .92);
            const shareProgress = segment(progress, .93, .97);
            const axisOpacity = 1 - segment(progress, .31, .34);
            const profileOpacity = Math.min(profileIn, profileOut);
            const timeOpacity = Math.min(timeIn, timeOut);
            const houseOpacity = segment(progress, .81, .84);
            const strengthProgress = segment(progress, .36, .38);
            const matchProgress = segment(progress, .44, .47);

            root.style.setProperty('--story-progress', progress);
            root.style.setProperty('--axis-progress', axisProgress);
            root.style.setProperty('--axis-opacity', axisOpacity);
            root.style.setProperty('--profile-opacity', profileOpacity);
            root.style.setProperty('--strength-progress', strengthProgress);
            root.style.setProperty('--match-progress', matchProgress);
            root.style.setProperty('--time-opacity', timeOpacity);
            root.style.setProperty('--time-progress', timeIn);
            root.style.setProperty('--house-opacity', houseOpacity);
            root.style.setProperty('--house-progress', houseProgress);
            root.style.setProperty('--share-progress', shareProgress);
            if (progressNode) progressNode.style.transform = `scaleX(${progress})`;

            axisRows.forEach(row => {
                const target = Number(row.dataset.axisTarget) || 50;
                const current = 50 + (target - 50) * axisProgress;
                row.style.setProperty('--axis-current', `${current}%`);
                row.style.setProperty('--axis-fill-left', `${Math.min(50, current)}%`);
                row.style.setProperty('--axis-fill-width', `${Math.abs(current - 50)}%`);
            });

            const nextScene = progress < .35 ? 'axis' : progress < TIME_SCENE_START ? 'profile' : progress < .81 ? 'time' : 'house';
            if (nextScene !== activeScene) {
                activeScene = nextScene;
                Object.entries(scenes).forEach(([name, node]) => node.setAttribute('aria-hidden', String(name !== activeScene)));
            }
            holdTimeScene();
            root.classList.toggle('is-share-ready', shareProgress >= .98);
        };
        const scheduleSync = () => {
            if (!frame) frame = requestAnimationFrame(sync);
        };
        window.addEventListener('scroll', scheduleSync, { passive: true });
        window.addEventListener('resize', scheduleSync);
        window.addEventListener('wheel', blockTimeSceneScroll, { passive: false });
        window.addEventListener('wheel', handleEndWheel, { passive: true });
        window.addEventListener('touchmove', blockTimeSceneScroll, { passive: false });
        window.addEventListener('touchstart', handleEndTouchStart, { passive: true });
        window.addEventListener('touchend', handleEndTouchEnd, { passive: true });
        window.addEventListener('keydown', blockTimeSceneKeys);
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) settleHeroCode();
        else startHeroShuffle();
        sync();
        return () => {
            window.removeEventListener('scroll', scheduleSync);
            window.removeEventListener('resize', scheduleSync);
            window.removeEventListener('wheel', blockTimeSceneScroll);
            window.removeEventListener('wheel', handleEndWheel);
            window.removeEventListener('touchmove', blockTimeSceneScroll);
            window.removeEventListener('touchstart', handleEndTouchStart);
            window.removeEventListener('touchend', handleEndTouchEnd);
            window.removeEventListener('keydown', blockTimeSceneKeys);
            window.clearInterval(timeShuffleTimer);
            window.clearInterval(heroShuffleTimer);
            window.clearTimeout(bandPromptTimer);
            if (frame) cancelAnimationFrame(frame);
        };
    }

    function playResultRevealAnimation() {
        const root = element('result-content');
        if (!root) return;
        if (root.querySelector('[data-result-story]')) return;
        const hero = root.querySelector('.cw-story-result-hero, .cw-result-teaser-hero');
        const codeNode = root.querySelector('.cw-story-result-code, .cw-result-teaser-hero > strong');
        const copyWrapper = root.querySelector('.cw-result-teaser-copy');
        if (!hero || !codeNode || !result?.code) return;

        hero.classList.add('is-revealing');
        if (copyWrapper) copyWrapper.classList.add('is-revealing');
        codeNode.classList.add('is-cycling');
        codeNode.textContent = '????';

        const placeholders = ['????', '····', '????'];
        let idx = 0;
        const cycleInterval = setInterval(() => {
            idx = (idx + 1) % placeholders.length;
            codeNode.textContent = placeholders[idx];
        }, 120);

        setTimeout(() => {
            clearInterval(cycleInterval);
            codeNode.textContent = result.code;
            codeNode.classList.remove('is-cycling');
            codeNode.classList.add('is-settled');
            hero.classList.remove('is-revealing');
            if (copyWrapper) copyWrapper.classList.remove('is-revealing');
        }, 600);
    }

    function renderResult(options = {}) {
        resultExperienceCleanup?.();
        resultExperienceCleanup = null;
        const profile = Core.getResultProfile(result.code);
        element('result-screen')?.classList.add('is-depth-view');
        if (!hasDetailedAccess()) {
            renderResultTeaser(profile);
            if (options.animate) playResultRevealAnimation();
            return;
        }
        const house = Core.HOUSE_META[assignedHouseKey] || { name: '배정 중', accent: '#16814b' };
        renderUnifiedResult(profile, house);
        if (options.animate) playResultRevealAnimation();
    }

    function renderEmptyResult() {
        element('result-content').innerHTML = `
            <section class="cw-result-empty">
                <p>CREWARTS PERSONALITY TEST</p>
                <h1>아직 저장된 결과가 없어요</h1>
                <span>3분 만에 나의 사육 성향과 어울리는 아기 크레 캐릭터를 찾아보세요!</span>
                <button class="cw-test-action cw-primary-button" type="button" data-action="start-empty">테스트 시작하기</button>
            </section>`;
        element('result-content').querySelector('[data-action="start-empty"]')?.addEventListener('click', startCurrentSurvey);
    }

    function handleUnlockDetail() {
        if (!BAND_INTEGRATION_ENABLED) {
            toast('BAND 회원 확인은 현재 준비 중이에요.');
            return;
        }
        if (hasDetailedAccess()) {
            renderResult();
            return;
        }
        pendingResultReveal = true;
        openMemberCheck({ revealResult: true });
    }

    async function submitSurvey() {
        if (IS_QA_MODE || !result || !surveySessionId || saveInFlight || !hasDetailedAccess()) return assignedHouseKey;
        const signature = JSON.stringify({ session: surveySessionId, answers, selectedMbti, band: bandAuthUser?.id || '', member: bandAuthUser?.isTargetMember || false });
        if (signature === lastSavedSignature) return assignedHouseKey;
        saveInFlight = true;
        try {
            const participantKey = await hashSessionId(surveySessionId);
            const response = {
                participantKey,
                creMbti: result.code,
                crebtiType: result.code,
                knownMbti: selectedMbti || null,
                axisScores: result.letters,
                answers: answers.slice(),
                answerLabels: questions.map((question, index) => {
                    const scores = Core.answerLetters(question, answers[index]);
                    return {
                        questionId: question.id,
                        axis: question.axis,
                        secondaryAxis: question.secondaryAxis || '',
                        choiceId: question.optionIds?.[answers[index]] || '',
                        displayedPosition: answers[index] + 1,
                        score: scores[0],
                        secondaryScore: scores[1] || '',
                        signalScores: Core.answerScoreMap(question, answers[index]),
                        responseMs: responseTimings[index]?.elapsedMs || null,
                        timingValid: Boolean(responseTimings[index]?.valid)
                    };
                }),
                responseTimes: responseTimings.slice(),
                timingStats: {
                    validCount: timingStats.validCount,
                    totalMs: timingStats.totalMs,
                    averageMs: timingStats.averageMs,
                    medianMs: timingStats.medianMs,
                    axisMedians: timingStats.axisMedians,
                    style: timingStats.style.key,
                    fastest: timingStats.fastest,
                    slowest: timingStats.slowest
                },
                questionVersion: Core.SURVEY_VERSION,
                questionContentUpdatedAt: config.crewart_mbti_content_updated_at || null,
                createdAt: sessionCreatedAt,
                syncedAt: new Date().toISOString()
            };
            const saved = await bandFetch('/api/crewart-survey/responses', {
                method: 'POST',
                cache: 'no-store',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${bandAuthToken}`
                },
                body: JSON.stringify({ response })
            });
            if (!saved.ok) {
                const payload = await saved.json().catch(() => ({}));
                throw new Error(payload.error || '설문 결과를 저장하지 못했습니다.');
            }
            const payload = await saved.json().catch(() => ({}));
            const savedHouse = String(payload.assignedHouseKey || payload.houseId || '').toUpperCase();
            if (!Core.HOUSE_KEYS.includes(savedHouse)) throw new Error('기숙사 배정 결과를 확인하지 못했습니다.');
            assignedHouseKey = savedHouse;
            lastSavedSignature = signature;
            cohortSummary.houseCounts[savedHouse] = (Number(cohortSummary.houseCounts[savedHouse]) || 0) + 1;
            return savedHouse;
        } catch (error) {
            console.error('[Crewart survey save]', error);
            toast(error.message || '기숙사를 배정하지 못했어요. 잠시 후 다시 시도해 주세요.', true);
            return '';
        } finally {
            saveInFlight = false;
        }
    }

    function currentStage() {

        if (!element('result-screen').hidden) return 'result';
        if (!element('mbti-screen').hidden) return 'mbti';
        if (!element('question-screen').hidden) return 'questions';
        return 'intro';
    }

    async function bandFetch(url, options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        try {
            return await fetch(url, { ...(options || {}), signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    async function verifyBandSession(token) {
        const response = await bandFetch(`${BAND_MEMBER_API}/session`, {
            method: 'POST', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        if (!response.ok) throw new Error('BAND membership session expired');
        return response.json();
    }

    function updateBandUi() {
        document.querySelectorAll('[data-band-join]').forEach(link => { link.href = bandTargetUrl; });
        updateBandState();
        updatePersistentActions();
        if (!element('intro-screen').hidden) renderHome();
        if (result && !element('result-screen').hidden) renderResult();
    }

    function updatePersistentActions() {
        const nav = element('app-nav');
        const home = element('persistent-home-button');
        const stage = currentStage();
        const focused = stage === 'questions' || stage === 'mbti';
        if (home) home.hidden = !focused;
        if (nav) nav.hidden = focused;
        const activeTab = stage === 'intro' ? 'home' : stage;
        document.querySelectorAll('[data-nav]').forEach(button => {
            const active = button.dataset.nav === activeTab;
            button.classList.toggle('is-active', active);
            if (active) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
    }

    function navigationTabForStage(stage = currentStage()) {
        if (stage === 'intro') return 'home';
        return APP_TABS.includes(stage) ? stage : 'home';
    }

    function tabHistoryState(tab) {
        const previous = history.state && typeof history.state === 'object' ? history.state : {};
        return { ...previous, [APP_HISTORY_KEY]: tab };
    }

    function replaceTabHistory(tab) {
        try { history.replaceState(tabHistoryState(tab), document.title); } catch (_) { }
    }

    function pushTabHistory(tab) {
        try { history.pushState(tabHistoryState(tab), document.title); } catch (_) { }
    }

    function navigateToTab(tab, options = {}) {
        if (!APP_TABS.includes(tab)) return;
        const currentTab = navigationTabForStage();
        if (!options.fromHistory && currentTab !== tab) {
            replaceTabHistory(currentTab);
            pushTabHistory(tab);
        }
        if (tab === 'home') {
            returnToIntro();
            return;
        }
        if (tab === 'result') {
            if (result) {
                renderResult({ animate: true });
                setScreen('result-screen');
            } else restoreLastResult({ animate: true });
            return;
        }
    }

    async function initBandMembership() {
        try {
            bandAuthToken = sessionStorage.getItem(MEMBERSHIP_STORAGE_KEY) || '';
            bandAuthPhoneMask = sessionStorage.getItem(MEMBERSHIP_PHONE_STORAGE_KEY) || '';
            if (bandAuthToken && !bandAuthPhoneMask) {
                bandAuthToken = '';
                sessionStorage.removeItem(MEMBERSHIP_STORAGE_KEY);
            }
        } catch (_) {
            bandAuthToken = '';
            bandAuthPhoneMask = '';
        }
        try {
            const response = await bandFetch(`${BAND_MEMBER_API}/config`, { cache: 'no-store' });
            if (!response.ok) throw new Error('BAND membership config unavailable');
            const memberConfig = await response.json();
            bandAuthConfigured = Boolean(memberConfig.configured);
            bandTargetUrl = memberConfig.targetBandUrl || DEFAULT_BAND_URL;
            if (bandAuthConfigured && bandAuthToken) {
                const session = await verifyBandSession(bandAuthToken);
                bandAuthUser = session.user || null;
                bandTargetUrl = session.targetBandUrl || bandTargetUrl;
            }
        } catch (error) {
            console.error('[Crewart BAND membership]', error);
            bandAuthUser = null;
            bandAuthToken = '';
            bandAuthPhoneMask = '';
            try {
                sessionStorage.removeItem(MEMBERSHIP_STORAGE_KEY);
                sessionStorage.removeItem(MEMBERSHIP_PHONE_STORAGE_KEY);
            } catch (_) { }
        } finally {
            bandAuthReady = true;
            updateBandUi();
        }
    }

    function stopMembershipRecheck() {
        if (membershipRecheckTimer) clearTimeout(membershipRecheckTimer);
        membershipRecheckTimer = null;
        pendingMemberPhone = '';
        membershipRecheckStartedAt = 0;
        membershipCheckInFlight = false;
    }

    async function requestPhoneMembership(phone) {
        const response = await bandFetch(`${BAND_MEMBER_API}/verify`, {
            method: 'POST', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const payload = await response.json().catch(() => ({}));
        bandTargetUrl = payload.targetBandUrl || bandTargetUrl;
        document.querySelectorAll('[data-band-join]').forEach(link => { link.href = bandTargetUrl; });
        if (!response.ok) throw new Error(payload.error || '가입 여부를 확인하지 못했어요.');
        return payload;
    }

    function completeMembershipAccess(payload, verifiedPhone) {
        const status = element('member-check-status');
        const phoneInput = element('member-phone');
        stopMembershipRecheck();
        bandAuthToken = payload.token || '';
        bandAuthUser = payload.user || { id: 'band_member', name: 'BAND 회원', isTargetMember: true };
        bandAuthPhoneMask = maskPhone(verifiedPhone) || bandAuthPhoneMask;
        editingMembership = false;
        if (bandAuthToken) {
            try {
                sessionStorage.setItem(MEMBERSHIP_STORAGE_KEY, bandAuthToken);
                if (bandAuthPhoneMask) sessionStorage.setItem(MEMBERSHIP_PHONE_STORAGE_KEY, bandAuthPhoneMask);
            } catch (_) { }
        }
        trackReferral('verified', { authenticated: true });
        if (status) {
            status.hidden = true;
            status.textContent = '';
            status.classList.remove('is-error', 'is-action', 'is-success');
        }
        updateBandUi();
        const reveal = pendingResultReveal && Boolean(result);
        pendingResultReveal = false;
        setTimeout(() => {
            if (phoneInput) phoneInput.value = '';
            closeMemberCheck();
            if (reveal) completeResultReveal();
            else toast('회원 확인이 완료됐어요.');
        }, 350);
    }

    function scheduleMembershipRecheck() {
        if (!pendingMemberPhone || membershipRecheckTimer) return;
        const delay = document.visibilityState === 'visible' && document.hasFocus()
            ? MEMBERSHIP_RECHECK_VISIBLE_MS
            : MEMBERSHIP_RECHECK_HIDDEN_MS;
        membershipRecheckTimer = setTimeout(() => {
            membershipRecheckTimer = null;
            void recheckPendingMembership();
        }, delay);
    }

    async function recheckPendingMembership(options = {}) {
        if (!pendingMemberPhone || membershipCheckInFlight || (hasDetailedAccess() && !editingMembership)) return;
        const status = element('member-check-status');
        const joinLink = element('member-join-link');
        if (Date.now() - membershipRecheckStartedAt > MEMBERSHIP_RECHECK_TIMEOUT_MS) {
            stopMembershipRecheck();
            updateBandState();
            if (status) {
                status.hidden = false;
                status.textContent = '가입 승인 확인 시간이 지났어요. 같은 번호로 다시 확인해주세요.';
                status.classList.add('is-error');
            }
            return;
        }
        if (options.visibleOnly && document.visibilityState !== 'visible') {
            scheduleMembershipRecheck();
            return;
        }
        membershipCheckInFlight = true;
        try {
            const payload = await requestPhoneMembership(pendingMemberPhone);
            if (payload.member) {
                const verifiedPhone = pendingMemberPhone;
                completeMembershipAccess(payload, verifiedPhone);
                return;
            }
            if (status) {
                status.hidden = false;
                status.textContent = '아직 가입되지 않은 번호예요. BAND 가입 후 돌아오면 바로 연결돼요.';
                status.classList.remove('is-error', 'is-success');
                status.classList.add('is-action');
            }
            if (joinLink) joinLink.hidden = false;
            if (joinLink) joinLink.classList.add('is-recommended');
        } catch (error) {
            if (status) {
                status.hidden = false;
                status.textContent = '가입 승인을 기다리고 있어요. 화면으로 돌아오면 다시 확인할게요.';
            }
        } finally {
            membershipCheckInFlight = false;
            if (pendingMemberPhone) scheduleMembershipRecheck();
        }
    }

    async function verifyMembershipPhone(event) {
        event.preventDefault();
        const phoneInput = element('member-phone');
        const submit = element('member-check-submit');
        const status = element('member-check-status');
        const joinLink = element('member-join-link');
        const submitLabel = element('member-check-submit-label');
        if (!phoneInput || !submit || !submitLabel || !status || !joinLink) return;
        status.hidden = false;
        status.classList.remove('is-error', 'is-success', 'is-action');
        joinLink.hidden = false;
        joinLink.classList.remove('is-recommended');
        submit.classList.remove('is-recheck');
        if (!bandAuthConfigured) {
            status.textContent = '회원 명단 연결을 준비하고 있어요. 잠시 후 다시 시도해주세요.';
            status.classList.add('is-error');
            submitLabel.textContent = '다시 시도';
            submit.classList.add('is-recheck');
            return;
        }
        const phoneDigits = String(phoneInput.value || '').replace(/\D/g, '');
        if (!/^010\d{8}$/.test(phoneDigits)) {
            status.textContent = '010으로 시작하는 휴대전화번호 11자리를 입력해주세요.';
            status.classList.add('is-error');
            return;
        }
        stopMembershipRecheck();
        submit.disabled = true;
        submitLabel.textContent = '확인 중…';
        status.textContent = '회원 명단을 확인하고 있어요…';
        phoneInput.blur();
        syncMemberKeyboardState({ ensureVisible: false });
        try {
            const payload = await requestPhoneMembership(phoneDigits);
            if (!payload.member) {
                status.textContent = '아직 가입되지 않은 번호예요. BAND 가입 후 돌아오면 바로 연결돼요.';
                status.classList.remove('is-error', 'is-success');
                status.classList.add('is-action');
                pendingMemberPhone = phoneDigits;
                membershipRecheckStartedAt = Date.now();
                updateBandState();
                joinLink.hidden = false;
                joinLink.classList.add('is-recommended');
                submitLabel.textContent = '다시 확인';
                submit.classList.add('is-recheck');
                scheduleMembershipRecheck();
                return;
            }
            completeMembershipAccess(payload, phoneDigits);
        } catch (error) {
            stopMembershipRecheck();
            updateBandState();
            status.textContent = error.message || '가입 여부를 확인하지 못했어요.';
            status.classList.add('is-error');
            submitLabel.textContent = '다시 확인';
            submit.classList.add('is-recheck');
        } finally {
            submit.disabled = false;
        }
    }

    function formatMemberPhone(event) {
        const input = event.currentTarget;
        const digits = String(input.value || '').replace(/\D/g, '').slice(0, 11);
        if (digits.length > 7) input.value = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
        else if (digits.length > 3) input.value = `${digits.slice(0, 3)}-${digits.slice(3)}`;
        else input.value = digits;
    }

    function handleMemberJoinReturn() {
        if (currentStage() === 'band') {
            const status = element('member-check-status');
            if (status) {
                status.hidden = false;
                status.textContent = pendingMemberPhone
                    ? '가입 승인 후 돌아오면 자동으로 다시 확인해요.'
                    : '가입 후 이 화면에서 회원 확인을 진행해주세요.';
                status.classList.remove('is-error', 'is-success');
                status.classList.add('is-action');
            }
        }
    }

    function drawRoundedRect(context, x, y, width, height, radius) {
        const safeRadius = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + safeRadius, y);
        context.arcTo(x + width, y, x + width, y + height, safeRadius);
        context.arcTo(x + width, y + height, x, y + height, safeRadius);
        context.arcTo(x, y + height, x, y, safeRadius);
        context.arcTo(x, y, x + width, y, safeRadius);
        context.closePath();
    }

    function loadShareImage(source) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = source;
        });
    }

    function drawShareImageContain(context, image, x, y, width, height) {
        const sourceWidth = Number(image.naturalWidth || image.width) || width;
        const sourceHeight = Number(image.naturalHeight || image.height) || height;
        const scale = Math.min(width / sourceWidth, height / sourceHeight);
        const drawWidth = sourceWidth * scale;
        const drawHeight = sourceHeight * scale;
        const drawX = x + (width - drawWidth) / 2;
        const drawY = y + (height - drawHeight) / 2;
        context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    }

    function canvasBlob(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('공유 이미지를 만들 수 없습니다.')), 'image/png', .96);
        });
    }

    function drawShareScale(context, x, y, width, position, color = '#202421', density = 1) {
        const markerX = x + width * (Math.max(0, Math.min(100, position)) / 100);
        const fillX = Math.min(x + width / 2, markerX);
        const fillWidth = Math.max(6 * density, Math.abs(markerX - (x + width / 2)));
        context.fillStyle = '#dfe2dd';
        drawRoundedRect(context, x, y, width, 8 * density, 4 * density);
        context.fill();
        context.fillStyle = color;
        drawRoundedRect(context, fillX, y, fillWidth, 8 * density, 4 * density);
        context.fill();
        context.fillStyle = '#a6aaa5';
        context.fillRect(x + width / 2 - density, y - 7 * density, 2 * density, 22 * density);
        context.beginPath();
        context.arc(markerX, y + 4 * density, 13 * density, 0, Math.PI * 2);
        context.fillStyle = '#ffffff';
        context.fill();
        context.lineWidth = 7 * density;
        context.strokeStyle = color;
        context.stroke();
    }

    function fitShareText(context, text, maxWidth, startSize, minSize, weight, font) {
        let size = startSize;
        while (size > minSize) {
            context.font = `${weight} ${size}px ${font}`;
            if (context.measureText(text).width <= maxWidth) break;
            size -= 2;
        }
        return size;
    }

    function shareAccentInk(house) {
        return ['G', 'Y'].includes(house?.seal) ? '#172019' : '#ffffff';
    }

    function resultShareAxes() {
        return result.axes.map(axisResult => {
            const copy = AXIS_REPORT_COPY[axisResult.axis];
            const first = axisResult.axis[0];
            const second = axisResult.axis[1];
            const secondCount = Number(result.letters[second]) || 0;
            return {
                copy,
                firstSelected: axisResult.dominant === first,
                position: Math.max(0, Math.min(100, (secondCount / (Core.AXIS_SCORE_TOTAL || 5)) * 100))
            };
        });
    }

    function drawShareHouseBadge(context, house, x, y, width, height, font) {
        const accent = house?.accent || '#16814b';
        drawRoundedRect(context, x, y, width, height, Math.min(22, height / 4));
        context.fillStyle = accent;
        context.fill();
        context.fillStyle = shareAccentInk(house);
        context.textAlign = 'left';
        context.font = `760 ${Math.max(13, Math.round(height * .13))}px ${font}`;
        context.fillText('YOUR HOUSE', x + 22, y + height * .33);
        fitShareText(context, house?.name || 'CREWARTS', width - 44, height * .42, height * .29, 920, font);
        context.fillText(house?.name || 'CREWARTS', x + 22, y + height * .76);
    }

    function shareFileName() {
        const typeName = String(result?.typeName || 'RESULT')
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/\s+/g, '');
        return `CREWARTS_${result.code}_${typeName}.png`;
    }

    async function createResultShareFile() {
        if (!result) throw new Error('저장할 결과가 없습니다.');
        await document.fonts?.ready;

        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1440;
        const context = canvas.getContext('2d');
        const font = '"Pretendard Variable", Pretendard, sans-serif';
        if (!context) throw new Error('이미지 생성 기능을 사용할 수 없습니다.');
        const house = Core.HOUSE_META[assignedHouseKey] || { name: assignedHouseKey || 'CREWARTS', seal: 'C', accent: '#16814b' };
        const accent = house.accent || '#16814b';
        const pageX = 36;
        const pageY = 36;
        const pageWidth = 1008;
        const pageHeight = 1368;
        const contentX = 86;
        const contentWidth = 908;

        context.fillStyle = accent;
        context.fillRect(0, 0, canvas.width, canvas.height);
        drawRoundedRect(context, pageX, pageY, pageWidth, pageHeight, 34);
        context.fillStyle = '#fbfbf8';
        context.fill();
        context.strokeStyle = '#d6d8d2';
        context.lineWidth = 2;
        context.stroke();

        context.save();
        drawRoundedRect(context, pageX, pageY, pageWidth, pageHeight, 34);
        context.clip();
        context.fillStyle = accent;
        context.fillRect(pageX, pageY, pageWidth, 14);
        context.globalAlpha = .07;
        context.beginPath();
        context.arc(210, 390, 330, 0, Math.PI * 2);
        context.fill();
        context.restore();

        context.fillStyle = '#252a26';
        context.font = `860 27px ${font}`;
        context.fillText('CREWARTS', contentX, 105);
        context.fillStyle = '#858a85';
        context.font = `720 14px ${font}`;
        context.fillText('PERSONALITY RESULT', contentX, 132);

        const houseBadgeWidth = 300;
        const houseBadgeX = pageX + pageWidth - houseBadgeWidth - 44;
        drawShareHouseBadge(context, house, houseBadgeX, 66, houseBadgeWidth, 112, font);

        context.fillStyle = '#e0e2dc';
        context.fillRect(contentX, 211, contentWidth, 2);

        drawRoundedRect(context, 66, 232, 948, 500, 32);
        context.save();
        context.globalAlpha = .075;
        context.fillStyle = accent;
        context.fill();
        context.restore();
        context.strokeStyle = `${accent}55`;
        context.lineWidth = 2;
        context.stroke();

        try {
            const character = await loadShareImage(new URL(typeCharacterPath(result.code), document.baseURI).toString());
            drawShareImageContain(context, character, 82, 240, 410, 500);
        } catch (_) {
            context.fillStyle = '#eff0ec';
            context.beginPath();
            context.arc(288, 480, 170, 0, Math.PI * 2);
            context.fill();
        }

        context.fillStyle = '#7c827d';
        context.font = `780 18px ${font}`;
        context.fillText('당신의 유형', 520, 340);
        context.fillStyle = accent;
        fitShareText(context, result.code, 470, 154, 104, 940, font);
        context.textBaseline = 'alphabetic';
        context.fillText(result.code, 520, 486);
        context.fillStyle = '#343a36';
        fitShareText(context, result.typeName, 450, 34, 24, 820, font);
        context.fillText(result.typeName, 524, 545);

        context.fillStyle = '#232824';
        context.font = `880 30px ${font}`;
        context.fillText('성향 좌표', contentX, 784);
        context.fillStyle = '#838883';
        context.font = `680 18px ${font}`;
        context.textAlign = 'right';
        context.fillText('모든 축의 최종 선택 방향', contentX + contentWidth, 784);
        context.textAlign = 'left';

        resultShareAxes().forEach(({ copy, position, firstSelected }, index) => {
            const y = 846 + index * 124;

            context.fillStyle = firstSelected ? '#252a26' : '#858a85';
            context.font = `${firstSelected ? 820 : 650} 25px ${font}`;
            context.fillText(copy.left, contentX, y);
            context.textAlign = 'center';
            context.fillStyle = '#878c87';
            context.font = `720 18px ${font}`;
            context.fillText(copy.title, 540, y);
            context.textAlign = 'right';
            context.fillStyle = firstSelected ? '#858a85' : '#252a26';
            context.font = `${firstSelected ? 650 : 820} 25px ${font}`;
            context.fillText(copy.right, contentX + contentWidth, y);
            context.textAlign = 'left';
            drawShareScale(context, contentX, y + 35, contentWidth, position, accent);
        });

        context.fillStyle = '#737873';
        context.font = `650 14px ${font}`;
        context.fillText('© 2026 CREO · ALL RIGHTS RESERVED', contentX, 1370);
        context.textAlign = 'right';
        context.fillText('creok.onrender.com', contentX + contentWidth, 1370);
        context.textAlign = 'left';

        const blob = await canvasBlob(canvas);
        return new File([blob], shareFileName(), { type: 'image/png' });
    }

    async function createKakaoShareFile() {
        if (!result) throw new Error('공유할 결과가 없습니다.');
        await document.fonts?.ready;

        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 800;
        const context = canvas.getContext('2d');
        const font = '"Pretendard Variable", Pretendard, sans-serif';
        if (!context) throw new Error('이미지 생성 기능을 사용할 수 없습니다.');
        const house = Core.HOUSE_META[assignedHouseKey] || { name: assignedHouseKey || 'CREWARTS', seal: 'C', accent: '#16814b' };
        const accent = house?.accent || '#17617b';

        context.fillStyle = accent;
        context.fillRect(0, 0, canvas.width, canvas.height);

        drawRoundedRect(context, 24, 24, 1152, 752, 34);
        context.fillStyle = '#fbfbf8';
        context.fill();
        context.strokeStyle = '#d8dad4';
        context.lineWidth = 2;
        context.stroke();

        context.save();
        drawRoundedRect(context, 24, 24, 1152, 752, 34);
        context.clip();
        context.fillStyle = accent;
        context.fillRect(24, 24, 1152, 12);
        context.restore();

        context.fillStyle = '#222724';
        context.font = `860 25px ${font}`;
        context.textAlign = 'left';
        context.fillText('CREWARTS', 64, 77);
        context.fillStyle = '#7b807b';
        context.font = `720 13px ${font}`;
        context.fillText('PERSONALITY RESULT', 64, 100);
        drawShareHouseBadge(context, house, 914, 50, 222, 82, font);

        drawRoundedRect(context, 54, 148, 1092, 570, 30);
        context.save();
        context.globalAlpha = .075;
        context.fillStyle = accent;
        context.fill();
        context.restore();
        context.strokeStyle = `${accent}55`;
        context.lineWidth = 2;
        context.stroke();

        try {
            const character = await loadShareImage(new URL(typeCharacterPath(result.code), document.baseURI).toString());
            drawShareImageContain(context, character, 78, 176, 402, 500);
        } catch (_) {
            context.fillStyle = '#eceee8';
            context.beginPath();
            context.arc(278, 420, 170, 0, Math.PI * 2);
            context.fill();
        }

        context.fillStyle = '#767c77';
        context.font = `760 16px ${font}`;
        context.fillText('당신의 유형', 520, 224);
        context.fillStyle = accent;
        fitShareText(context, result.code, 576, 150, 104, 940, font);
        context.fillText(result.code, 516, 366);
        context.fillStyle = '#303632';
        fitShareText(context, result.typeName, 560, 29, 22, 820, font);
        context.fillText(result.typeName, 522, 412);

        resultShareAxes().forEach(({ copy, position, firstSelected }, index) => {
            const y = 472 + index * 56;
            context.fillStyle = firstSelected ? '#282d29' : '#8a8f8a';
            context.font = `${firstSelected ? 800 : 650} 15px ${font}`;
            context.fillText(copy.left, 520, y);
            context.textAlign = 'right';
            context.fillStyle = firstSelected ? '#8a8f8a' : '#282d29';
            context.font = `${firstSelected ? 650 : 800} 15px ${font}`;
            context.fillText(copy.right, 1100, y);
            context.textAlign = 'left';
            drawShareScale(context, 520, y + 16, 580, position, accent, .62);
        });
        context.textAlign = 'left';

        context.fillStyle = '#858a85';
        context.font = `650 11px ${font}`;
        context.fillText('© 2026 CREO · ALL RIGHTS RESERVED', 54, 750);
        context.textAlign = 'right';
        context.fillText('creok.onrender.com', 1146, 750);
        context.textAlign = 'left';

        const blob = await canvasBlob(canvas);
        return new File([blob], `CREWARTS_${result.code}_KAKAO.png`, { type: 'image/png' });
    }

    function downloadShareFile(file) {
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function initializeKakaoSdk() {
        try {
            if (!window.Kakao) return false;
            if (!window.Kakao.isInitialized()) window.Kakao.init(KAKAO_JS_KEY);
            return Boolean(window.Kakao.Share?.sendDefault && window.Kakao.Share?.uploadImage);
        } catch (error) {
            console.warn('[Crewart Kakao init]', error);
            return false;
        }
    }

    async function uploadKakaoShareImage(file) {
        if (!window.Kakao?.Share?.uploadImage || typeof DataTransfer === 'undefined') {
            throw new Error('Kakao image upload is unavailable');
        }
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const response = await window.Kakao.Share.uploadImage({ file: transfer.files });
        const imageUrl = response?.infos?.original?.url;
        if (!imageUrl) throw new Error('Kakao image URL is missing');
        return imageUrl;
    }

    function setShareButtonBusy(button, busy, busyLabel) {
        if (!button) return;
        const label = button.querySelector('[data-action-label]');
        if (busy) {
            button.dataset.idleLabel = label?.textContent || '';
            if (label && busyLabel) label.textContent = busyLabel;
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            return;
        }
        if (label && button.dataset.idleLabel) label.textContent = button.dataset.idleLabel;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        delete button.dataset.idleLabel;
    }

    function isAppleMobileDevice() {
        return /iP(?:hone|ad|od)/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function isMobileDevice() {
        return Boolean(navigator.userAgentData?.mobile)
            || isAppleMobileDevice()
            || /Android|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    function canNativeShareFile(file) {
        if (!file || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
        try {
            return navigator.canShare({ files: [file] });
        } catch (_) {
            return false;
        }
    }

    function openShareImageForLongPress(file) {
        const url = URL.createObjectURL(file);
        const opened = window.open(url, '_blank');
        if (opened) opened.opener = null;
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        return Boolean(opened);
    }

    function clearPreparedSaveImage() {
        if (preparedSaveUrl) URL.revokeObjectURL(preparedSaveUrl);
        preparedSaveUrl = '';
        preparedSaveFile = null;
        element('result-save-preview')?.removeAttribute('src');
    }

    function prepareSaveDialog(file) {
        clearPreparedSaveImage();
        preparedSaveFile = file;
        preparedSaveUrl = URL.createObjectURL(file);
        element('result-save-preview').src = preparedSaveUrl;
    }

    async function saveResultImage(event) {
        const button = event?.currentTarget;
        setShareButtonBusy(button, true, '이미지 만드는 중');
        try {
            const file = await createResultShareFile();
            prepareSaveDialog(file);
            const dialog = element('result-save-dialog');
            if (!dialog.open) dialog.showModal();
        } catch (error) {
            console.error('[Crewart image preview]', error);
            toast('저장할 이미지를 만들지 못했어요. 다시 시도해주세요.', true);
        } finally {
            setShareButtonBusy(button, false);
        }
    }

    async function savePreparedResultImage() {
        if (!preparedSaveFile) return;
        const button = element('result-save-confirm');
        const label = button.querySelector('span');
        const idleLabel = label.textContent;
        const file = preparedSaveFile;
        button.disabled = true;
        label.textContent = '저장 중';
        try {
            if (isMobileDevice() && canNativeShareFile(file)) {
                toast('공유 메뉴에서 저장 위치를 선택해주세요.');
                await navigator.share({ files: [file], title: 'CREWARTS 성향 결과' });
            } else if (isAppleMobileDevice()) {
                if (!openShareImageForLongPress(file)) throw new Error('이미지 창을 열 수 없습니다.');
                toast('이미지를 길게 눌러 사진에 저장해주세요.');
            } else if (typeof window.showSaveFilePicker === 'function') {
                const handle = await window.showSaveFilePicker({
                    suggestedName: file.name,
                    types: [{
                        description: 'PNG 이미지',
                        accept: { 'image/png': ['.png'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(file);
                await writable.close();
                toast(`${handle.name || file.name} 파일을 저장했어요.`);
            } else {
                downloadShareFile(file);
                toast('브라우저 다운로드 폴더에 저장했어요.');
            }
            element('result-save-dialog').close('saved');
        } catch (error) {
            if (error?.name !== 'AbortError') {
                console.error('[Crewart image save]', error);
                toast('이미지를 저장하지 못했어요. 다시 시도해주세요.', true);
            }
        } finally {
            button.disabled = false;
            label.textContent = idleLabel;
        }
    }

    async function openKakaoShareGuide(event, file = null) {
        const button = event?.currentTarget || null;
        setShareButtonBusy(button, true, '공유 준비 중');
        try {
            const nextFile = file || await createKakaoShareFile();
            clearPreparedKakaoShare();
            preparedKakaoShareFile = nextFile;
            preparedKakaoShareUrl = URL.createObjectURL(nextFile);
            element('kakao-share-preview').src = preparedKakaoShareUrl;
            const dialog = element('kakao-share-dialog');
            if (!dialog.open) dialog.showModal();
        } catch (error) {
            console.error('[Crewart Kakao preview]', error);
            toast('공유할 이미지를 만들지 못했어요. 다시 시도해주세요.', true);
        } finally {
            setShareButtonBusy(button, false);
        }
    }

    function clearPreparedKakaoShare() {
        if (preparedKakaoShareUrl) URL.revokeObjectURL(preparedKakaoShareUrl);
        preparedKakaoShareUrl = '';
        preparedKakaoShareFile = null;
        element('kakao-share-preview')?.removeAttribute('src');
    }

    async function sharePreparedNativeResult(event) {
        const button = event?.currentTarget;
        const title = `${result.code} · ${result.typeName}`;
        const text = `나는 크레 앞에서 어떤 유형일까?\n${Core.QUESTIONS.length}문항 약 3분`;
        setShareButtonBusy(button, true, '공유 준비 중');
        const shareUrl = createTrackedShareUrl();

        try {
            const shareFile = preparedKakaoShareFile || await createResultShareFile();
            element('kakao-share-dialog')?.close('share');
            if (navigator.share && navigator.canShare?.({ files: [shareFile] })) {
                await navigator.share({
                    files: [shareFile],
                    title,
                    text: `${text}\n${shareUrl}`
                });
                return;
            }
            if (navigator.share) {
                downloadShareFile(shareFile);
                toast('이미지는 저장했어요. 공유 앱에서 카카오톡을 선택해주세요.');
                await navigator.share({ title, text, url: shareUrl });
                return;
            }
            downloadShareFile(shareFile);
            await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
            toast('이미지 저장과 링크 복사를 완료했어요.');
        } catch (error) {
            if (error?.name === 'AbortError') return;
            console.error('[Crewart result share]', error);
            try {
                await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
                toast('공유 링크를 복사했어요.');
            } catch (_) {
                window.prompt('아래 내용을 복사해주세요.', `${text}\n${shareUrl}`);
            }
        } finally {
            setShareButtonBusy(button, false);
        }
    }

    async function shareResult(event) {
        const button = event?.currentTarget;
        const title = `${result.code} · ${result.typeName}`;
        const text = `나는 크레 앞에서 어떤 유형일까?\n${Core.QUESTIONS.length}문항 약 3분`;
        let shareFile = null;
        setShareButtonBusy(button, true, '카카오톡 여는 중');
        const shareUrl = createTrackedShareUrl();

        try {
            shareFile = await createKakaoShareFile();
            if (!initializeKakaoSdk()) throw new Error('Kakao SDK is unavailable');
            const imageUrl = await uploadKakaoShareImage(shareFile);
            await window.Kakao.Share.sendDefault({
                objectType: 'feed',
                content: {
                    title,
                    description: text,
                    imageUrl,
                    imageWidth: 1200,
                    imageHeight: 800,
                    link: { mobileWebUrl: shareUrl, webUrl: shareUrl }
                },
                buttons: [{
                    title: '나도 알아보기',
                    link: { mobileWebUrl: shareUrl, webUrl: shareUrl }
                }]
            });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return;
            console.error('[Crewart Kakao direct share]', error);
            await openKakaoShareGuide(null, shareFile);
            toast('카카오톡 직접 연결이 어려워 기기 공유로 전환했어요.');
        } finally {
            setShareButtonBusy(button, false);
        }
    }

    if (IS_LOCAL_QA) {
            window.CrewartShareQA = Object.freeze({
                createResultShareFile,
                createKakaoShareFile,
                shareFileName,
                isAppleMobileDevice,
                isMobileDevice,
                canNativeShareFile
            });
    }

    function syncThemeColor(screenId) {
        const color = screenId === 'intro-screen' ? '#111712' : '#f4f4f1';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    }

    async function startCurrentSurvey() {
        const file = Core.getSurveyVersion('v2').questionsFile;
        if (Core?.loadQuestionnaireFile) {
            try {
                await Core.loadQuestionnaireFile(file);
            } catch (err) {
                console.error('[Survey load version error]', err);
            }
        }
        startSurvey();
    }

    function bindEvents() {
        element('start-button')?.addEventListener('click', startCurrentSurvey);
        element('home-retest')?.addEventListener('click', startCurrentSurvey);
        element('home-auth-button')?.addEventListener('click', () => openMemberCheck());
        element('member-dialog-close')?.addEventListener('click', closeMemberCheck);
        element('member-dialog')?.addEventListener('click', event => {
            if (event.target === event.currentTarget) closeMemberCheck();
        });
        element('auth-phone-edit')?.addEventListener('click', editMembershipAccess);
        element('auth-phone-clear')?.addEventListener('click', clearMembershipAccess);
        element('member-check-form')?.addEventListener('submit', verifyMembershipPhone);
        element('member-phone')?.addEventListener('input', formatMemberPhone);
        element('member-phone')?.addEventListener('focus', () => syncMemberKeyboardState());
        element('member-phone')?.addEventListener('blur', () => {
            setTimeout(() => syncMemberKeyboardState({ ensureVisible: false }), 80);
        });
        element('member-join-link')?.addEventListener('click', handleMemberJoinReturn);
        document.addEventListener('click', event => {
            if (event.target.closest?.('[data-band-join], [data-band-prompt]')) trackReferral('band_click');
        });
        element('question-back').addEventListener('click', previousQuestion);
        element('mbti-unknown').addEventListener('click', () => {
            selectedMbti = '';
            showResult(true);
        });
        element('show-result').addEventListener('click', () => showResult(false));
        element('persistent-home-button').addEventListener('click', returnToIntro);
        element('kakao-share-confirm')?.addEventListener('click', sharePreparedNativeResult);
        element('kakao-share-dialog')?.addEventListener('close', clearPreparedKakaoShare);
        element('kakao-share-dialog')?.addEventListener('click', event => {
            if (event.target === event.currentTarget) event.currentTarget.close('cancel');
        });
        element('result-save-confirm')?.addEventListener('click', savePreparedResultImage);
        element('result-save-dialog')?.addEventListener('close', clearPreparedSaveImage);
        element('result-save-dialog')?.addEventListener('click', event => {
            if (event.target === event.currentTarget) event.currentTarget.close('cancel');
        });
        document.querySelectorAll('[data-nav]').forEach(button => {
            button.addEventListener('click', () => navigateToTab(button.dataset.nav));
        });
        window.addEventListener('popstate', event => {
            const tab = event.state?.[APP_HISTORY_KEY];
            navigateToTab(APP_TABS.includes(tab) ? tab : 'home', { fromHistory: true });
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') pauseTimer();
            else {
                resumeTimer();
                void recheckPendingMembership({ visibleOnly: true });
            }
        });
        window.addEventListener('pageshow', () => void recheckPendingMembership({ visibleOnly: true }));
        window.addEventListener('focus', () => void recheckPendingMembership({ visibleOnly: true }));
        window.visualViewport?.addEventListener('resize', () => {
            syncMemberKeyboardState();
        });
        window.visualViewport?.addEventListener('scroll', () => syncMemberKeyboardState({ ensureVisible: false }));
        window.addEventListener('resize', () => {
            syncMemberKeyboardState({ ensureVisible: false });
        });
    }

    function buildPreviewResult(code) {
        const axisPairs = ['EI', 'SN', 'TF', 'JP'];
        const letters = {};
        const axisTotal = Core.AXIS_SCORE_TOTAL || 5;
        const dominantScore = Math.max(1, Math.round(axisTotal * .8));
        const supportingScore = Math.max(0, axisTotal - dominantScore);
        const axes = axisPairs.map((axis, index) => {
            const dominant = code[index];
            letters[axis[0]] = dominant === axis[0] ? dominantScore : supportingScore;
            letters[axis[1]] = dominant === axis[1] ? dominantScore : supportingScore;
            return { axis, dominant };
        });
        return { code, typeName: Core.TYPE_NAMES[code] || '크레 집사', letters, axes };
    }

    function initialize() {
        if (!Core || !Array.isArray(Core.QUESTIONS) || Core.QUESTIONS.length < 1) {
            toast('테스트 데이터를 불러오지 못했어요.', true);
            return;
        }
        setupIntroVideo();
        initializeReferral();
        try { LEGACY_RESULT_STORAGE_KEYS.forEach(key => localStorage.removeItem(key)); } catch (_) { }
        bindEvents();
        const urlParams = new URLSearchParams(window.location.search);
        const previewCode = (urlParams.get('preview') || urlParams.get('mbti') || urlParams.get('type') || '').toUpperCase();
        if (previewCode && Core.MBTI_TYPES.includes(previewCode)) {
            result = buildPreviewResult(previewCode);
            timingStats = {
                validCount: 12,
                totalMs: 100800,
                averageMs: 8400,
                medianMs: 8100,
                axisMedians: {},
                style: { key: 'balanced', label: '균형 잡힌 선택' },
                fastest: null,
                slowest: null
            };
            assignedHouseKey = choosePreviewHouse();
            renderResult({ animate: false });
            setScreen('result-screen');
        } else {
            renderHome();
        }
        updatePersistentActions();
        replaceTabHistory(navigationTabForStage());
        syncThemeColor('intro-screen');
        const start = element('start-button');
        if (start) start.disabled = true;
        playWordmark();
        void loadConfig().finally(() => {
            if (start) start.disabled = false;
        });
        if (!BAND_INTEGRATION_ENABLED) {
            bandAuthReady = false;
            updateBandUi();
        } else {
            void initBandMembership();
        }
    }

    Promise.resolve(Core?.ready)
        .then(initialize)
        .catch(error => {
            console.error('[Crewart questionnaire]', error);
            toast('문항 파일을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', true);
        });
}());
