(function () {
    'use strict';

    const Core = window.CrewartSurveyCore;
    const SURVEY_URL = new URL('crewart-survey.html', document.baseURI).toString();
    const DEFAULT_BAND_URL = 'https://www.band.us/band/101992972/post';
    const BAND_OAUTH_API = 'https://creok.onrender.com/api/band-oauth';
    const KAKAO_JS_KEY = 'db7ffc8d6b9b7601b792ed69be4658fc';
    const QUESTION_IMAGE_ROOT = 'assets/crewart-illustrations/';
    const AUTH_STORAGE_KEY = 'crewart_band_auth_v1';
    const RESUME_STORAGE_KEY = 'crewart_cre_mbti_resume_v1';
    const CONTENT_CONFIG_KEY = 'crewart_mbti_content_v1';
    const BAND_INTEGRATION_ENABLED = true;
    const IS_LOCAL_QA = ['127.0.0.1', 'localhost'].includes(location.hostname);
    const IS_QA_MODE = IS_LOCAL_QA || new URLSearchParams(location.search).has('qa');

    let config = {};
    let cohortResponses = [];
    let questions = [];
    let answers = [];
    let responseTimings = [];
    let current = 0;
    let selectedMbti = '';
    let surveySessionId = '';
    let sessionCreatedAt = '';
    let assignedHouseKey = '';
    let result = null;
    let timingStats = null;
    let activeTimer = null;
    let advancing = false;
    let saveInFlight = false;
    let lastSavedSignature = '';
    let toastTimer = null;

    let bandAuthReady = false;
    let bandAuthConfigured = false;
    let bandAuthToken = '';
    let bandAuthUser = null;
    let bandTargetUrl = DEFAULT_BAND_URL;
    let pendingBandResume = false;
    let lastMembershipRefreshAt = 0;

    function element(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[character]));
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
                ? document.fonts.load('900 72px "Cinzel Decorative"').catch(() => [])
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
        introVideo.controls = false;
        introVideo.muted = true;
        introVideo.defaultMuted = true;
        introVideo.playsInline = true;
        const reveal = () => introVideo.classList.add('is-playing');
        const conceal = () => introVideo.classList.remove('is-playing');
        introVideo.addEventListener('playing', reveal);
        introVideo.addEventListener('error', conceal);
        introVideo.addEventListener('emptied', conceal);
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
        const introVideo = element('intro-video');
        if (introVideo) {
            const canPlay = screenId === 'intro-screen' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (canPlay) void introVideo.play().then(() => introVideo.classList.add('is-playing')).catch(() => introVideo.classList.remove('is-playing'));
            else introVideo.pause();
        }
        updatePersistentActions();
        window.scrollTo({ top: 0, behavior: 'instant' });
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
        let hash = 2166136261;
        source.forEach(byte => {
            hash ^= byte;
            hash = Math.imul(hash, 16777619);
        });
        return `legacy-${(hash >>> 0).toString(16)}`;
    }

    function parseCohortResponses(raw) {
        let parsed = [];
        try {
            parsed = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
        } catch (_) {
            parsed = [];
        }
        const deduped = new Map();
        parsed.forEach((response, index) => {
            if (!response || response.questionVersion !== Core.SURVEY_VERSION) return;
            const key = response.surveySessionId || response.participantKey || `response-${index}`;
            const previous = deduped.get(key);
            if (!previous || String(previous.syncedAt || previous.createdAt || '') <= String(response.syncedAt || response.createdAt || '')) {
                deduped.set(key, response);
            }
        });
        return Array.from(deduped.values());
    }

    function applyManagedContent(raw) {
        if (!raw || questions.length) return;
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const items = Array.isArray(parsed) ? parsed : parsed?.questions;
            if (!Array.isArray(items)) return;
            items.forEach(item => {
                const target = Core.QUESTIONS.find(question => question.id === String(item?.id || '').toUpperCase());
                if (!target) return;
                if (String(item.label || '').trim()) target.label = String(item.label).trim();
                if (String(item.q || '').trim()) target.q = String(item.q).trim();
                if (Array.isArray(item.options) && item.options.length >= 2) {
                    const options = item.options.slice(0, 2).map(value => String(value || '').trim());
                    if (options.every(Boolean)) target.options = options;
                }
            });
        } catch (error) {
            console.warn('[Crewart managed questions]', error);
        }
    }

    async function loadConfig() {
        try {
            config = await getConfigMap() || {};
            applyManagedContent(config[CONTENT_CONFIG_KEY]);
            cohortResponses = parseCohortResponses(config.crewart_survey_responses);
        } catch (error) {
            console.error('[Crewart config]', error);
            config = {};
            cohortResponses = [];
        }
    }

    function startTimer(index) {
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
        const elapsedMs = Math.round(activeTimer.elapsedMs);
        responseTimings[index] = {
            questionId: questions[index].id,
            axis: questions[index].axis,
            elapsedMs,
            valid: elapsedMs >= 400 && elapsedMs <= 30000
        };
    }

    function startSurvey() {
        questions = Core.prepareQuestions();
        answers = [];
        responseTimings = [];
        current = 0;
        selectedMbti = '';
        surveySessionId = createSessionId();
        sessionCreatedAt = new Date().toISOString();
        assignedHouseKey = '';
        result = null;
        timingStats = null;
        advancing = false;
        lastSavedSignature = '';
        setScreen('question-screen');
        renderQuestion();
    }

    function returnToIntro() {
        if (currentStage() !== 'intro' && !window.confirm('처음부터 다시 할까요?\n\n현재 테스트 진행 내용은 초기화되지만 BAND 연결 상태는 유지됩니다.')) return;
        pauseTimer();
        activeTimer = null;
        questions = [];
        answers = [];
        responseTimings = [];
        current = 0;
        selectedMbti = '';
        surveySessionId = '';
        sessionCreatedAt = '';
        assignedHouseKey = '';
        result = null;
        timingStats = null;
        advancing = false;
        lastSavedSignature = '';
        try { sessionStorage.removeItem(RESUME_STORAGE_KEY); } catch (_) {}
        element('result-content').replaceChildren();
        setScreen('intro-screen');
    }

    function renderQuestion() {
        const question = questions[current];
        if (!question) return;
        advancing = false;
        element('progress-text').textContent = `${current + 1} / ${questions.length}`;
        element('progress-axis').textContent = '크레 앞의 나를 찾는 중';
        element('progress-bar').style.width = `${((current + 1) / questions.length) * 100}%`;
        element('question-back').disabled = current === 0;
        element('question-label').textContent = question.label;
        element('question-title').textContent = question.q;
        const illustration = element('question-illustration');
        const image = element('question-image');
        if (question.image) {
            illustration.hidden = false;
            image.src = `${QUESTION_IMAGE_ROOT}${question.image}`;
            image.alt = question.imageAlt || `${question.label} 상황 삽화`;
        } else {
            illustration.hidden = true;
            image.removeAttribute('src');
            image.alt = '';
        }
        element('choice-list').innerHTML = question.options.map((option, index) => `
            <button class="cw-choice-button${answers[current] === index ? ' is-selected' : ''}" type="button" data-choice="${index}">
                <span>${escapeHtml(option)}</span>
            </button>`).join('');
        element('choice-list').querySelectorAll('[data-choice]').forEach(button => {
            button.addEventListener('click', () => chooseAnswer(Number(button.dataset.choice)));
        });
        const card = element('question-card');
        card.classList.remove('is-changing');
        requestAnimationFrame(() => card.classList.add('is-changing'));
        const nextImage = questions[current + 1]?.image;
        if (nextImage) {
            const preloader = new Image();
            preloader.src = `${QUESTION_IMAGE_ROOT}${nextImage}`;
        }
        startTimer(current);
    }

    function chooseAnswer(choice) {
        if (advancing) return;
        advancing = true;
        answers[current] = choice;
        captureTiming(current);
        element('choice-list').querySelectorAll('[data-choice]').forEach(button => {
            const selected = Number(button.dataset.choice) === choice;
            button.classList.toggle('is-selected', selected);
            button.disabled = true;
        });
        const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 20 : 260;
        setTimeout(() => {
            if (current < questions.length - 1) {
                current += 1;
                renderQuestion();
            } else {
                finishQuestions();
            }
        }, delay);
    }

    function previousQuestion() {
        if (advancing || current === 0) return;
        current -= 1;
        renderQuestion();
    }

    function finishQuestions() {
        activeTimer = null;
        const missing = questions.findIndex((_, index) => answers[index] === undefined);
        if (missing >= 0) {
            current = missing;
            renderQuestion();
            toast('선택하지 않은 질문이 있어요.', true);
            return;
        }
        result = Core.scoreAnswers(questions, answers);
        timingStats = Core.buildTimingStats(responseTimings, questions);
        if (!assignedHouseKey) assignedHouseKey = Core.chooseBalancedHouse(result, currentHouseCounts(), surveySessionId);
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

    function currentHouseCounts() {
        const counts = Object.fromEntries(Core.HOUSE_KEYS.map(key => [key, 0]));
        cohortResponses.forEach(response => {
            const key = response.assignedHouseKey || response.houseId;
            if (key in counts) counts[key] += 1;
        });
        return counts;
    }

    function showResult(skipMbti) {
        if (!result) return;
        if (!selectedMbti && !skipMbti) {
            toast('평소 MBTI를 고르거나 잘 모르겠어요를 눌러주세요.', true);
            return;
        }
        renderResult();
        setScreen('result-screen');
        void submitSurvey();
    }

    function formatSeconds(milliseconds) {
        return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}초`;
    }

    function typeSummary(code) {
        return [
            Core.AXIS_META.EI.letters[code[0]].short,
            Core.AXIS_META.SN.letters[code[1]].short,
            Core.AXIS_META.TF.letters[code[2]].short,
            Core.AXIS_META.JP.letters[code[3]].short
        ].join(' · ');
    }

    function speedSamples() {
        return cohortResponses.map(response => Number(response?.timingStats?.medianMs)).filter(Boolean);
    }

    function hasDetailedAccess() {
        return Boolean(bandAuthUser && bandAuthUser.isTargetMember === true);
    }

    function openBandTarget() {
        if (!BAND_INTEGRATION_ENABLED) return false;
        window.open(bandTargetUrl, '_blank', 'noopener,noreferrer');
        return true;
    }

    function renderComparison(comparison) {
        if (!selectedMbti) return '';
        const changes = comparison.changes.length
            ? `<div class="cw-change-list">${comparison.changes.map(change => `
                <div class="cw-change-row"><b>${change.from} → ${change.to}</b><span>${escapeHtml(change.message)}</span></div>`).join('')}</div>`
            : '<p class="cw-same-note">평소와 크레 앞의 내가 네 글자 모두 같아요.</p>';
        return `
            <section class="cw-result-insight">
                <header><h2>평소와 달라진 점</h2><span>${comparison.changes.length ? `${comparison.changes.length}개 축 변화` : '같은 유형'}</span></header>
                ${changes}
            </section>`;
    }

    function renderSpeedCard() {
        const valid = timingStats.validCount > 0;
        const total = valid ? formatSeconds(timingStats.totalMs) : '측정 안 됨';
        const median = valid ? formatSeconds(timingStats.medianMs) : '-';
        const benchmark = Core.buildSpeedBenchmark(timingStats.medianMs, speedSamples());
        return `
            <section class="cw-result-section cw-speed-card">
                <div class="cw-result-section-head">
                    <div><span>선택 속도</span><strong>${escapeHtml(timingStats.style.label)}</strong></div>
                    <div class="cw-speed-number">${escapeHtml(median)}<small> 문항당</small></div>
                </div>
                <p class="cw-speed-copy">${escapeHtml(timingStats.style.copy)}</p>
                <div class="cw-speed-measure"><span>전체 응답 ${escapeHtml(total)}</span><span>유효 ${timingStats.validCount} / ${questions.length}</span></div>
                <div class="cw-benchmark-inline"><b>${escapeHtml(benchmark.badge)}</b><span>${escapeHtml(benchmark.message)}</span></div>
            </section>`;
    }

    function detailedAnswerRows(axis) {
        return questions.map((question, index) => ({
            question,
            answer: question.options[answers[index]],
            letter: question.scores[answers[index]],
            timing: responseTimings[index]
        })).filter(item => item.question.axis === axis).map(item => `
            <li><span><b>${item.letter}</b> · ${escapeHtml(item.answer)}</span><time>${item.timing?.valid ? formatSeconds(item.timing.elapsedMs) : '측정 제외'}</time></li>`).join('');
    }

    function renderMemberDetail() {
        const axisCards = result.axes.map(axisResult => {
            const meta = Core.AXIS_META[axisResult.axis];
            const dominant = meta.letters[axisResult.dominant];
            return `
                <article class="cw-axis-detail">
                    <header><div><span>${escapeHtml(meta.title)}</span><strong>${axisResult.dominant} · ${escapeHtml(dominant.short)}</strong></div><b>${axisResult.dominantCount} : ${axisResult.oppositeCount}</b></header>
                    <p>${escapeHtml(dominant.description)}</p>
                    <details class="cw-answer-detail"><summary>내 선택 5개와 응답시간 보기</summary><ul>${detailedAnswerRows(axisResult.axis)}</ul></details>
                </article>`;
        }).join('');
        const slowestQuestion = questions.find(question => question.id === timingStats.slowest?.questionId);
        const fastestQuestion = questions.find(question => question.id === timingStats.fastest?.questionId);
        return `
            <section class="cw-result-section cw-member-detail">
                <h2 class="cw-detail-title">내가 뭘 골랐길래?</h2>
                <div class="cw-axis-detail-list">${axisCards}</div>
                <div class="cw-speed-meta">
                    ${fastestQuestion ? `<span>가장 빠른 선택 · ${escapeHtml(fastestQuestion.label)} ${formatSeconds(timingStats.fastest.elapsedMs)}</span>` : ''}
                    ${slowestQuestion ? `<span>가장 오래 고민 · ${escapeHtml(slowestQuestion.label)} ${formatSeconds(timingStats.slowest.elapsedMs)}</span>` : ''}
                </div>
            </section>`;
    }

    function renderHouseCard() {
        const house = Core.HOUSE_META[assignedHouseKey];
        const bandAction = BAND_INTEGRATION_ENABLED
            ? `<button class="cw-band-cta" type="button" data-action="open-band"><span>${house.name} 기숙사 참여하기</span><b aria-hidden="true">↗</b></button>`
            : '';
        return `
            <section class="cw-result-section cw-house-card" style="--house-accent:${house.accent}">
                <div class="cw-house-row"><div class="cw-house-seal">${house.seal}</div><div><small>CREWART COMMUNITY HOUSE</small><h2>${house.name}</h2></div></div>
                <p>${house.korean} · ${house.color}. MBTI와 별개로 커뮤니티 인원이 고르게 만나도록 배정된 기숙사예요.</p>
                ${bandAction}
            </section>`;
    }

    function renderLockedDetail() {
        const configured = BAND_INTEGRATION_ENABLED && bandAuthConfigured;
        const label = !configured
            ? '세부 결과 준비 중'
            : bandAuthUser ? '크레와트 BAND 가입하기' : 'BAND 가입하고 세부 분석 보기';
        const status = !BAND_INTEGRATION_ENABLED
            ? '정식 공개 전까지 잠시 닫아두었어요.'
            : !configured
                ? 'BAND 인증 오픈과 함께 제공됩니다.'
            : bandAuthUser ? '가입 후 이 페이지로 돌아오면 자동으로 다시 확인해요.' : '가입 후 선택 근거와 기숙사 배정이 열려요.';
        const description = !BAND_INTEGRATION_ENABLED
            ? '선택 근거, 고민한 문항과 기숙사 배정은<br>정식 공개와 함께 열립니다.'
            : '선택 근거, 고민한 문항과 기숙사 배정은<br>BAND 가입 확인 후 바로 선명해져요.';
        return `
            <section class="cw-detail-gate">
                <div class="cw-detail-preview" aria-hidden="true" inert>${renderMemberDetail()}${renderHouseCard()}</div>
                <div class="cw-detail-shade" aria-hidden="true"></div>
                <div class="cw-detail-unlock">
                    <span class="cw-lock-icon" aria-hidden="true">⌁</span>
                    <h2>세부 결과가 궁금한가요?</h2>
                    <p>${description}</p>
                    <button class="cw-band-cta" type="button" data-action="unlock-detail" ${configured ? '' : 'disabled'}><span>${escapeHtml(label)}</span><b aria-hidden="true">→</b></button>
                    <small class="cw-lock-status">${escapeHtml(status)}</small>
                </div>
            </section>`;
    }

    function renderResult() {
        const comparison = Core.buildMbtiComparison(selectedMbti, result.code);
        const typeFlow = selectedMbti
            ? `<div class="cw-result-code-flow"><div><small>평소</small><strong>${escapeHtml(selectedMbti)}</strong></div><i aria-hidden="true">→</i><div class="is-cre"><small>크레 앞</small><strong>${escapeHtml(result.code)}</strong></div></div>`
            : `<div class="cw-result-code-flow is-single"><div class="is-cre"><small>크레 앞의 나는</small><strong>${escapeHtml(result.code)}</strong></div></div>`;
        const detail = BAND_INTEGRATION_ENABLED && hasDetailedAccess() ? `${renderMemberDetail()}${renderHouseCard()}` : renderLockedDetail();
        const bandShare = BAND_INTEGRATION_ENABLED
            ? `<button class="cw-share-icon is-band" type="button" data-action="band-result" aria-label="크레와트 BAND 열기"><strong aria-hidden="true">B</strong></button>`
            : '';
        element('result-content').innerHTML = `
            <div class="cw-result-wrap">
                <section class="cw-result-poster">
                    <img class="cw-result-crest" src="assets/crewart-crest-v2.webp" width="720" height="838" alt="" aria-hidden="true">
                    <p class="cw-poster-kicker">CREWART PERSONALITY TEST</p>
                    ${typeFlow}
                    <h1>${escapeHtml(result.typeName)}</h1>
                    <p>${escapeHtml(typeSummary(result.code))}</p>
                </section>
                <div class="cw-share-tools" aria-label="결과 공유">
                    <button class="cw-share-icon is-kakao" type="button" data-action="share" aria-label="카카오톡으로 공유">
                        <img src="assets/kakaolink_btn_medium.png" width="24" height="24" alt="">
                    </button>
                    <button class="cw-share-icon is-instagram" type="button" data-action="instagram" aria-label="인스타그램으로 공유">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5"></rect><circle cx="12" cy="12" r="4.1"></circle><circle class="cw-instagram-dot" cx="17.4" cy="6.8" r="1.1"></circle></svg>
                    </button>
                    ${bandShare}
                </div>
                ${renderComparison(comparison)}
                ${renderSpeedCard()}
                ${detail}
            </div>`;
        element('result-content').querySelector('[data-action="unlock-detail"]')?.addEventListener('click', handleUnlockDetail);
        element('result-content').querySelector('[data-action="open-band"]')?.addEventListener('click', openBandTarget);
        element('result-content').querySelector('[data-action="share"]')?.addEventListener('click', shareResult);
        element('result-content').querySelector('[data-action="instagram"]')?.addEventListener('click', shareToInstagram);
        element('result-content').querySelector('[data-action="band-result"]')?.addEventListener('click', handleResultBand);
    }

    function handleResultBand() {
        if (!BAND_INTEGRATION_ENABLED) return;
        if (bandAuthConfigured && !bandAuthUser) {
            beginBandLogin();
            return;
        }
        openBandTarget();
    }

    function handleUnlockDetail() {
        if (!BAND_INTEGRATION_ENABLED) {
            toast('BAND 연동은 현재 준비 중이에요.');
            return;
        }
        if (!bandAuthConfigured) {
            toast('BAND 연결 설정을 준비하고 있어요.', true);
            return;
        }
        if (!bandAuthUser) {
            beginBandLogin();
            return;
        }
        if (hasDetailedAccess()) {
            openBandTarget();
            return;
        }
        openBandTarget();
        toast('가입 후 이 화면으로 돌아오면 자동으로 확인해요.');
    }

    async function submitSurvey() {
        if (IS_QA_MODE || !result || !surveySessionId || saveInFlight) return;
        const signature = JSON.stringify({ session: surveySessionId, answers, selectedMbti, band: bandAuthUser?.id || '', member: bandAuthUser?.isTargetMember || false });
        if (signature === lastSavedSignature) return;
        saveInFlight = true;
        try {
            const participantKey = await hashSessionId(surveySessionId);
            const house = Core.HOUSE_META[assignedHouseKey];
            const comparison = Core.buildMbtiComparison(selectedMbti, result.code);
            const response = {
                participantKey,
                surveySessionId,
                participationMode: bandAuthUser ? 'official' : 'guest',
                anonymous: !bandAuthUser,
                bandUserId: bandAuthUser?.id || null,
                bandProfileName: bandAuthUser?.name || null,
                bandIsTargetMember: bandAuthUser?.isTargetMember ?? null,
                name: bandAuthUser?.name || '익명 참여자',
                phone: null,
                creMbti: result.code,
                crebtiType: result.code,
                profile: `${result.code} · ${result.typeName}`,
                knownMbti: selectedMbti || null,
                mbtiComparison: selectedMbti ? comparison : null,
                axisScores: result.letters,
                assignedHouseKey,
                house: house.name,
                houseId: assignedHouseKey,
                houseColor: house.color,
                answers: answers.slice(),
                answerLabels: questions.map((question, index) => ({
                    questionId: question.id,
                    axis: question.axis,
                    question: question.q,
                    displayedPosition: answers[index] + 1,
                    label: question.options[answers[index]],
                    score: question.scores[answers[index]],
                    responseMs: responseTimings[index]?.elapsedMs || null,
                    timingValid: Boolean(responseTimings[index]?.valid)
                })),
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
            const identity = bandAuthUser?.id || `anonymous-${participantKey}`;
            const participantLine = [identity, house.name, bandAuthUser?.name || '익명 참여자'].join(',');
            await saveCrewartSurveyEntry(participantKey, participantLine, response);
            lastSavedSignature = signature;
        } catch (error) {
            console.error('[Crewart survey save]', error);
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

    function saveResumeState() {
        if (!surveySessionId || currentStage() === 'intro') return;
        const state = {
            stage: currentStage(), current, answers, responseTimings, selectedMbti,
            surveySessionId, sessionCreatedAt, assignedHouseKey,
            questions: questions.map(question => ({
                id: question.id,
                options: question.options,
                scores: question.scores,
                flipped: question.flipped
            }))
        };
        try { sessionStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    }

    function restoreResumeState() {
        if (!pendingBandResume || !bandAuthUser) return false;
        let state = null;
        try {
            state = JSON.parse(sessionStorage.getItem(RESUME_STORAGE_KEY) || 'null');
            sessionStorage.removeItem(RESUME_STORAGE_KEY);
        } catch (_) {}
        pendingBandResume = false;
        if (!state || !Array.isArray(state.questions) || !Array.isArray(state.answers)) return false;
        const baseMap = new Map(Core.QUESTIONS.map(question => [question.id, question]));
        questions = state.questions.map(saved => {
            const base = baseMap.get(saved.id);
            if (!base) return null;
            return { ...base, options: saved.options.slice(0, 2), scores: saved.scores.slice(0, 2), flipped: Boolean(saved.flipped) };
        }).filter(Boolean);
        if (questions.length !== Core.QUESTIONS.length) return false;
        answers = state.answers.slice(0, questions.length);
        responseTimings = Array.isArray(state.responseTimings) ? state.responseTimings.slice(0, questions.length) : [];
        selectedMbti = String(state.selectedMbti || '');
        surveySessionId = String(state.surveySessionId || createSessionId());
        sessionCreatedAt = String(state.sessionCreatedAt || new Date().toISOString());
        assignedHouseKey = String(state.assignedHouseKey || '');
        current = Math.min(Math.max(0, Number(state.current) || 0), questions.length - 1);
        const completed = questions.every((_, index) => answers[index] !== undefined);
        result = completed ? Core.scoreAnswers(questions, answers) : null;
        timingStats = completed ? Core.buildTimingStats(responseTimings, questions) : null;
        if (completed && !assignedHouseKey) assignedHouseKey = Core.chooseBalancedHouse(result, currentHouseCounts(), surveySessionId);
        if (state.stage === 'result') {
            if (!completed) return false;
            renderResult();
            setScreen('result-screen');
            void submitSurvey();
        } else if (state.stage === 'mbti') {
            if (!completed) return false;
            renderMbtiOptions();
            element('show-result').disabled = !selectedMbti;
            setScreen('mbti-screen');
        } else {
            setScreen('question-screen');
            renderQuestion();
        }
        toast('BAND 연결 완료 · 보던 결과를 이어서 열었어요.');
        return true;
    }

    function clearOAuthFragment() {
        const params = new URLSearchParams(location.hash.replace(/^#/, ''));
        params.delete('band_auth');
        params.delete('band_oauth_error');
        const hash = params.toString();
        history.replaceState(null, '', `${location.pathname}${location.search}${hash ? `#${hash}` : ''}`);
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
        const response = await bandFetch(`${BAND_OAUTH_API}/session`, {
            method: 'POST', mode: 'cors', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        if (!response.ok) throw new Error('BAND session expired');
        return response.json();
    }

    function updateBandUi() {
        const button = element('band-float');
        const label = element('band-float-label');
        const note = element('band-entry-note');
        button.disabled = !BAND_INTEGRATION_ENABLED || !bandAuthReady;
        button.hidden = !BAND_INTEGRATION_ENABLED;
        if (note) note.hidden = !BAND_INTEGRATION_ENABLED;
        label.textContent = !bandAuthReady
            ? 'BAND 확인 중'
            : !bandAuthConfigured
                ? 'BAND로 들어가기'
                : hasDetailedAccess()
                    ? 'BAND 연결됨 · 테스트 시작'
                    : bandAuthUser ? 'BAND 가입 후 시작' : 'BAND 로그인하고 시작';
        if (note) {
            note.textContent = !bandAuthReady
                ? 'BAND 연결 상태를 확인하고 있어요'
                : !bandAuthConfigured
                    ? 'OAuth 승인 전 · 지금은 BAND 페이지로 연결돼요'
                    : hasDetailedAccess()
                        ? `${bandAuthUser.name || 'BAND 회원'}님 · 상세 결과까지 확인할 수 있어요`
                        : bandAuthUser
                            ? '대상 BAND 가입 후 상세 결과를 확인할 수 있어요'
                            : 'BAND 로그인 시 상세 결과까지 확인할 수 있어요';
        }
        button.setAttribute('aria-label', label.textContent);
        updatePersistentActions();
        if (result && !element('result-screen').hidden) renderResult();
    }

    function updatePersistentActions() {
        const footer = element('survey-footer');
        const button = element('persistent-band-button');
        const label = element('persistent-band-label');
        const note = element('persistent-band-note');
        const home = element('persistent-home-button');
        if (!footer || !button || !label || !note || !home) return;

        const stage = currentStage();
        home.hidden = stage === 'intro';
        footer.hidden = stage === 'intro' || !BAND_INTEGRATION_ENABLED;
        if (footer.hidden) return;

        button.hidden = false;
        note.hidden = false;
        button.disabled = !bandAuthReady;
        if (!bandAuthReady) {
            label.textContent = 'BAND 연결 확인 중';
            note.textContent = '연결 상태를 확인하고 있어요.';
        } else if (!bandAuthConfigured) {
            label.textContent = '크레와트 BAND로 이동';
            note.textContent = '현재는 BAND 페이지로 바로 연결돼요.';
        } else if (!bandAuthUser) {
            label.textContent = '현재 정보 저장하고 BAND 로그인';
            note.textContent = '로그인 후 지금 보던 화면에서 그대로 이어져요.';
        } else if (!hasDetailedAccess()) {
            label.textContent = '크레와트 BAND 가입 이어서 하기';
            note.textContent = '가입 후 돌아오면 연결 상태를 자동으로 확인해요.';
        } else {
            label.textContent = '크레와트 BAND로 이동';
            note.textContent = `${bandAuthUser.name || 'BAND 회원'}님으로 연결되어 있어요.`;
        }
        button.setAttribute('aria-label', label.textContent);
    }

    function handlePersistentBand() {
        if (!BAND_INTEGRATION_ENABLED) return;
        if (!bandAuthReady) return;
        if (!bandAuthConfigured) {
            openBandTarget();
            return;
        }
        if (!bandAuthUser) {
            beginBandLogin();
            return;
        }
        openBandTarget();
        if (!hasDetailedAccess()) toast('가입 후 이 화면으로 돌아오면 자동으로 확인해요.');
    }

    function handleBandEntry() {
        if (!BAND_INTEGRATION_ENABLED) return;
        if (!bandAuthReady) return;
        if (!bandAuthConfigured) {
            openBandTarget();
            toast('OAuth 승인 전이라 BAND 페이지를 먼저 열었어요.');
            return;
        }
        if (!bandAuthUser) {
            beginBandLogin();
            return;
        }
        if (!hasDetailedAccess()) {
            openBandTarget();
            toast('BAND 가입 후 돌아오면 상세 결과까지 확인할 수 있어요.');
            return;
        }
        startSurvey();
    }

    async function initBandAuth() {
        const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
        const returnedToken = fragment.get('band_auth') || '';
        const returnedError = fragment.get('band_oauth_error') || '';
        pendingBandResume = Boolean(returnedToken);
        if (returnedToken || returnedError) clearOAuthFragment();
        try {
            bandAuthToken = returnedToken || sessionStorage.getItem(AUTH_STORAGE_KEY) || '';
            if (returnedToken) sessionStorage.setItem(AUTH_STORAGE_KEY, returnedToken);
        } catch (_) {
            bandAuthToken = returnedToken;
        }
        try {
            const response = await bandFetch(`${BAND_OAUTH_API}/config`, { mode: 'cors', cache: 'no-store' });
            if (!response.ok) throw new Error('BAND OAuth config unavailable');
            const oauthConfig = await response.json();
            bandAuthConfigured = Boolean(oauthConfig.configured);
            bandTargetUrl = oauthConfig.targetBandUrl || DEFAULT_BAND_URL;
            if (bandAuthConfigured && bandAuthToken) {
                const session = await verifyBandSession(bandAuthToken);
                bandAuthUser = session.user || null;
                bandTargetUrl = session.targetBandUrl || bandTargetUrl;
            }
        } catch (error) {
            console.error('[Crewart BAND OAuth]', error);
            bandAuthUser = null;
        } finally {
            bandAuthReady = true;
            updateBandUi();
        }
        if (!restoreResumeState() && returnedError) toast('BAND 로그인을 완료하지 못했어요.', true);
    }

    function beginBandLogin() {
        if (!BAND_INTEGRATION_ENABLED) return;
        if (!bandAuthReady || !bandAuthConfigured) {
            toast('BAND 연결 설정을 확인 중이에요.', true);
            return;
        }
        saveResumeState();
        const url = new URL(`${BAND_OAUTH_API}/start`);
        url.searchParams.set('return_url', SURVEY_URL);
        location.assign(url.toString());
    }

    async function refreshMembership() {
        if (!bandAuthToken || !bandAuthUser || Date.now() - lastMembershipRefreshAt < 8000) return;
        lastMembershipRefreshAt = Date.now();
        try {
            const session = await verifyBandSession(bandAuthToken);
            const wasMember = hasDetailedAccess();
            bandAuthUser = session.user || bandAuthUser;
            bandTargetUrl = session.targetBandUrl || bandTargetUrl;
            updateBandUi();
            if (!wasMember && hasDetailedAccess()) {
                toast('가입 확인 완료 · 세부 분석을 열었어요.');
                void submitSurvey();
            }
        } catch (error) {
            console.error('[Crewart BAND membership refresh]', error);
        }
    }

    async function shareResult() {
        const title = selectedMbti ? `평소 ${selectedMbti} → 크레 ${result.code}` : `나의 크레 MBTI는 ${result.code}`;
        const text = `${title}\n${result.typeName} · 문항당 ${formatSeconds(timingStats.medianMs)}`;
        try {
            if (window.Kakao) {
                if (!window.Kakao.isInitialized()) window.Kakao.init(KAKAO_JS_KEY);
                window.Kakao.Share.sendDefault({
                    objectType: 'feed',
                    content: {
                        title,
                        description: `${result.typeName} · 20개의 선택으로 확인한 크레 앞의 나`,
                        imageUrl: new URL('assets/crewart-cave-mobile.webp', document.baseURI).toString(),
                        link: { mobileWebUrl: SURVEY_URL, webUrl: SURVEY_URL }
                    },
                    buttons: [{ title: '나도 테스트하기', link: { mobileWebUrl: SURVEY_URL, webUrl: SURVEY_URL } }]
                });
                return;
            }
        } catch (error) {
            console.error('[Crewart Kakao share]', error);
        }
        if (navigator.share) {
            try {
                await navigator.share({ title: `${title} | 크레와트`, text, url: SURVEY_URL });
                return;
            } catch (error) {
                if (error?.name === 'AbortError') return;
            }
        }
        try {
            await navigator.clipboard.writeText(`${text}\n${SURVEY_URL}`);
            toast('결과와 링크를 복사했어요.');
        } catch (_) {
            window.prompt('아래 내용을 복사해주세요.', `${text}\n${SURVEY_URL}`);
        }
    }

    async function shareToInstagram() {
        const title = selectedMbti ? `평소 ${selectedMbti} → 크레 ${result.code}` : `나의 크레 MBTI는 ${result.code}`;
        const text = `${title}\n${result.typeName}`;
        if (navigator.share) {
            try {
                await navigator.share({ title: `${title} | 크레와트`, text, url: SURVEY_URL });
                return;
            } catch (error) {
                if (error?.name === 'AbortError') return;
            }
        }
        try {
            await navigator.clipboard.writeText(`${text}\n${SURVEY_URL}`);
            toast('링크를 복사했어요. 인스타그램에서 공유해 주세요.');
        } catch (_) {
            window.prompt('인스타그램에 공유할 내용을 복사해주세요.', `${text}\n${SURVEY_URL}`);
        }
    }

    function syncThemeColor() {
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#171819' : '#f4f1e9');
    }

    function bindEvents() {
        element('start-button').addEventListener('click', startSurvey);
        element('question-back').addEventListener('click', previousQuestion);
        element('mbti-unknown').addEventListener('click', () => {
            selectedMbti = '';
            showResult(true);
        });
        element('show-result').addEventListener('click', () => showResult(false));
        element('band-float').addEventListener('click', handleBandEntry);
        element('persistent-band-button').addEventListener('click', handlePersistentBand);
        element('persistent-home-button').addEventListener('click', returnToIntro);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') pauseTimer();
            else {
                resumeTimer();
                if (bandAuthToken && bandAuthUser) void refreshMembership();
            }
        });
        window.addEventListener('focus', () => {
            if (bandAuthToken && bandAuthUser) void refreshMembership();
        });
    }

    function initialize() {
        if (!Core || Core.QUESTIONS.length !== 20) {
            toast('테스트 데이터를 불러오지 못했어요.', true);
            return;
        }
        setupIntroVideo();
        bindEvents();
        syncThemeColor();
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeColor);
        const start = element('start-button');
        start.disabled = false;
        start.querySelector('span').textContent = '바로 테스트하기';
        playWordmark();
        void loadConfig();
        if (!BAND_INTEGRATION_ENABLED) {
            bandAuthReady = false;
            updateBandUi();
        } else if (IS_LOCAL_QA) {
            bandAuthReady = true;
            updateBandUi();
        } else {
            void initBandAuth();
        }
    }

    initialize();
}());
