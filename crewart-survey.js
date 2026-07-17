(function () {
    'use strict';

    const Core = window.CrewartSurveyCore;
    const SURVEY_URL = 'https://cdcup.onrender.com/crewart-survey.html';
    const DEFAULT_BAND_URL = 'https://www.band.us/band/101992972/post';
    const BAND_OAUTH_API = 'https://creok.onrender.com/api/band-oauth';
    const AUTH_STORAGE_KEY = 'crewart_band_auth_v1';
    const RESUME_STORAGE_KEY = 'crewart_cre_mbti_resume_v1';
    const CONTENT_CONFIG_KEY = 'crewart_mbti_content_v1';
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

    function setScreen(screenId) {
        ['intro-screen', 'question-screen', 'mbti-screen', 'result-screen'].forEach(id => {
            const screen = element(id);
            const active = id === screenId;
            screen.hidden = !active;
            screen.classList.toggle('is-active', active);
            if (active) {
                screen.classList.remove('is-entering');
                requestAnimationFrame(() => screen.classList.add('is-entering'));
            }
        });
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
        element('choice-list').innerHTML = question.options.map((option, index) => `
            <button class="cw-choice-button${answers[current] === index ? ' is-selected' : ''}" type="button" data-choice="${index}">
                <span>${escapeHtml(option)}</span><b aria-hidden="true">›</b>
            </button>`).join('');
        element('choice-list').querySelectorAll('[data-choice]').forEach(button => {
            button.addEventListener('click', () => chooseAnswer(Number(button.dataset.choice)));
        });
        const card = element('question-card');
        card.classList.remove('is-changing');
        requestAnimationFrame(() => card.classList.add('is-changing'));
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

    function renderComparison(comparison) {
        if (!selectedMbti) {
            return `
                <div class="cw-type-compare is-single">
                    <div class="cw-type-card is-cre"><small>크레 앞의 나는</small><strong>${escapeHtml(result.code)}</strong></div>
                </div>`;
        }
        const changes = comparison.changes.length
            ? `<div class="cw-change-list">${comparison.changes.map(change => `
                <div class="cw-change-row"><b>${change.from} → ${change.to}</b><span>${escapeHtml(change.message)}</span></div>`).join('')}</div>`
            : '<p class="cw-same-note">평소와 크레 앞의 내가 네 글자 모두 같아요.</p>';
        return `
            <div class="cw-type-compare">
                <div class="cw-type-card"><small>평소의 나</small><strong>${escapeHtml(selectedMbti)}</strong></div>
                <div class="cw-type-arrow" aria-hidden="true">→</div>
                <div class="cw-type-card is-cre"><small>크레 앞의 나</small><strong>${escapeHtml(result.code)}</strong></div>
            </div>
            ${changes}`;
    }

    function renderSpeedCard() {
        const valid = timingStats.validCount > 0;
        const total = valid ? formatSeconds(timingStats.totalMs) : '측정 안 됨';
        const median = valid ? formatSeconds(timingStats.medianMs) : '-';
        return `
            <section class="cw-result-section cw-speed-card">
                <div class="cw-result-section-head">
                    <div><span>선택 속도</span><strong>${escapeHtml(timingStats.style.label)}</strong></div>
                    <div class="cw-speed-number">${escapeHtml(total)}<small> 총 응답</small></div>
                </div>
                <p class="cw-speed-copy">${escapeHtml(timingStats.style.copy)}</p>
                <div class="cw-speed-meta"><span>문항당 중앙값 ${escapeHtml(median)}</span><span>유효 응답 ${timingStats.validCount} / ${questions.length}</span></div>
            </section>`;
    }

    function renderBenchmarkCard() {
        const benchmark = Core.buildSpeedBenchmark(timingStats.medianMs, speedSamples());
        return `
            <section class="cw-result-section cw-benchmark">
                <span class="cw-benchmark-badge">${escapeHtml(benchmark.badge)}</span>
                <p>${escapeHtml(benchmark.message)}</p>
                <small>${benchmark.ready ? `현재 ${benchmark.sampleSize}명 표본 · 완료 응답만 비교` : `앞으로 ${benchmark.needed}명의 응답이 더 필요해요`}</small>
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
        return `
            <section class="cw-result-section cw-house-card" style="--house-accent:${house.accent}">
                <div class="cw-house-row"><div class="cw-house-seal">${house.seal}</div><div><small>CREWART COMMUNITY HOUSE</small><h2>${house.name}</h2></div></div>
                <p>${house.korean} · ${house.color}. MBTI와 별개로 커뮤니티 인원이 고르게 만나도록 배정된 기숙사예요.</p>
                <button class="cw-band-cta" type="button" data-action="open-band"><span>${house.name} 기숙사 참여하기</span><b aria-hidden="true">↗</b></button>
            </section>`;
    }

    function renderLockedDetail() {
        const configured = bandAuthConfigured;
        const label = !configured
            ? 'BAND 연결 준비 중'
            : bandAuthUser ? '크레와트 BAND 가입하기' : 'BAND 가입하고 세부 분석 보기';
        const status = !configured
            ? 'BAND OAuth 승인이 완료되면 바로 열립니다.'
            : bandAuthUser ? '가입 후 이 페이지로 돌아오면 자동으로 다시 확인해요.' : '가입 후 선택 근거와 기숙사 배정이 열려요.';
        return `
            <section class="cw-result-section cw-locked-detail">
                <span class="cw-lock-icon" aria-hidden="true">⌁</span>
                <h2>내가 뭘 골랐길래?</h2>
                <p>20개 선택과 고민한 순간을 연결해, 평소와 달라진 이유를 보여드려요.</p>
                <button class="cw-band-cta" type="button" data-action="unlock-detail" ${configured ? '' : 'disabled'}><span>${escapeHtml(label)}</span><b aria-hidden="true">→</b></button>
                <small class="cw-lock-status">${escapeHtml(status)}</small>
            </section>`;
    }

    function renderResult() {
        const comparison = Core.buildMbtiComparison(selectedMbti, result.code);
        const title = selectedMbti
            ? `평소엔 ${selectedMbti},<br>크레 앞에서는 <strong>${result.code}</strong>`
            : `크레 앞의 나는<br><strong>${result.code}</strong>`;
        const detail = hasDetailedAccess() ? `${renderMemberDetail()}${renderHouseCard()}` : renderLockedDetail();
        element('result-content').innerHTML = `
            <div class="cw-result-wrap">
                <header class="cw-result-top">
                    <img class="cw-result-crest" src="assets/crewart-crest-v2.webp" width="720" height="838" alt="" aria-hidden="true">
                    <p class="cw-eyebrow">MY CRE MBTI</p>
                    <h1>${title}</h1>
                    <p>${escapeHtml(result.typeName)} · ${escapeHtml(typeSummary(result.code))}</p>
                </header>
                ${renderComparison(comparison)}
                ${renderSpeedCard()}
                ${renderBenchmarkCard()}
                ${detail}
                <div class="cw-result-actions">
                    <button class="cw-primary-button" type="button" data-action="share"><span>결과 공유하기</span><b aria-hidden="true">↗</b></button>
                    <button class="cw-text-button" type="button" data-action="restart">다시 테스트하기</button>
                </div>
            </div>`;
        element('result-content').querySelector('[data-action="unlock-detail"]')?.addEventListener('click', handleUnlockDetail);
        element('result-content').querySelector('[data-action="open-band"]')?.addEventListener('click', () => window.open(bandTargetUrl, '_blank', 'noopener,noreferrer'));
        element('result-content').querySelector('[data-action="share"]')?.addEventListener('click', shareResult);
        element('result-content').querySelector('[data-action="restart"]')?.addEventListener('click', startSurvey);
    }

    function handleUnlockDetail() {
        if (!bandAuthConfigured) {
            toast('BAND 연결 설정을 준비하고 있어요.', true);
            return;
        }
        if (!bandAuthUser) {
            beginBandLogin();
            return;
        }
        window.open(bandTargetUrl, '_blank', 'noopener,noreferrer');
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
        button.disabled = !bandAuthReady || !bandAuthConfigured;
        button.classList.toggle('is-connected', hasDetailedAccess());
        label.textContent = !bandAuthReady
            ? 'BAND 확인 중'
            : !bandAuthConfigured
                ? 'BAND 준비 중'
                : bandAuthUser ? 'BAND 가입 확인' : 'BAND 로그인';
        if (result && !element('result-screen').hidden) renderResult();
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

    function bindEvents() {
        element('start-button').addEventListener('click', startSurvey);
        element('question-back').addEventListener('click', previousQuestion);
        element('mbti-unknown').addEventListener('click', () => {
            selectedMbti = '';
            showResult(true);
        });
        element('show-result').addEventListener('click', () => showResult(false));
        element('band-float').addEventListener('click', () => bandAuthUser ? handleUnlockDetail() : beginBandLogin());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') pauseTimer();
            else {
                resumeTimer();
                if (!element('result-screen').hidden) void refreshMembership();
            }
        });
        window.addEventListener('focus', () => {
            if (!element('result-screen').hidden) void refreshMembership();
        });
    }

    function initialize() {
        if (!Core || Core.QUESTIONS.length !== 20) {
            toast('테스트 데이터를 불러오지 못했어요.', true);
            return;
        }
        bindEvents();
        const start = element('start-button');
        start.disabled = false;
        start.querySelector('span').textContent = '테스트 시작';
        void loadConfig();
        if (IS_LOCAL_QA) {
            bandAuthReady = true;
            updateBandUi();
        } else {
            void initBandAuth();
        }
    }

    initialize();
}());
