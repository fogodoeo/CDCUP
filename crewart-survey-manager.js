const CREWART_SURVEY_CONTENT_KEY = 'crewart_survey_content_v1';
const CREWART_SURVEY_UPDATED_KEY = 'crewart_survey_content_updated_at';
const IMAGE_STATES = ['neutral', 'left', 'right'];
const IMAGE_STATE_LABELS = { neutral: '기본 장면', left: '선택 A 장면', right: '선택 B 장면' };

const DEFAULT_SURVEY_CONTENT = [
    { id: 'C01', axis: 'EI', scores: ['E', 'I'], label: '경매 마감 5분 전', q: '경매 마감 5분 전. 두 마리 중 하나를 고른다면?', a: ['친구와 이야기하며 생각을 정리한다.', '사진을 혼자 보며 생각을 정리한다.'], alt: '경매 마감 직전, 두 개체를 놓고 고민하는 모습', images: { neutral: 'question-c01-neutral-half-v1.webp', left: 'question-c01-left-v3.webp', right: 'question-c01-right-half-v1.webp' } },
    { id: 'C02', axis: 'SN', scores: ['S', 'N'], label: '어린 크레의 성장', q: '어린 크레가 자란 모습을 예상할 때, 먼저 보는 것은?', a: ['지금 보이는 색과 무늬', '부모와 형제가 자란 모습'], alt: '어린 크레의 현재 모습과 가족의 성장 기록을 비교하는 모습', images: { neutral: 'question-c02-neutral-half-v1.webp', left: 'question-c02-left-half-v1.webp', right: 'question-c02-right-half-v1.webp' } },
    { id: 'C03', axis: 'JP', scores: ['J', 'P'], label: '마지막에 나타난 선택', q: '마지막 순간, 다른 크레가 눈에 들어왔다. 어떻게 할까?', a: ['처음 고른 크레로 결정한다.', '두 크레를 다시 비교한다.'], alt: '원래 고른 개체와 새로 눈에 들어온 개체를 비교하는 모습', images: { neutral: 'question-c03-neutral-half-v1.webp', left: 'question-c03-left-half-v1.webp', right: 'question-c03-right-half-v1.webp' } },
    { id: 'C04', axis: 'TF', scores: ['T', 'F'], label: '조건이 비슷한 두 크레', q: '가격과 건강 상태가 비슷하다. 어느 쪽을 고를까?', a: ['미리 정한 조건에 더 맞는 크레', '볼수록 마음이 더 가는 크레'], alt: '기준표와 마음 사이에서 두 개체를 고르는 모습', images: { neutral: 'question-c04-neutral-half-v1.webp', left: 'question-c04-left-half-v1.webp', right: 'question-c04-right-half-v1.webp' } },
    { id: 'C05', axis: 'EI', scores: ['E', 'I'], label: '예상 밖의 변화', q: '키우던 크레의 색이 예상과 다르게 변했다. 먼저 하는 일은?', a: ['다른 사람에게 보여주며 이야기한다.', '예전 사진을 혼자 다시 살펴본다.'], alt: '예상과 다르게 변한 개체를 예전 사진과 비교하는 모습', images: { neutral: 'question-c05-neutral-v3.webp', left: 'question-c05-left-v3.webp', right: 'question-c05-right-v3.webp' } },
    { id: 'C06', axis: 'SN', scores: ['S', 'N'], label: '성장 사진 속 변화', q: '성장 사진에서 먼저 눈에 들어오는 것은?', a: ['실제로 달라진 부분', '앞으로 달라질 모습'], alt: '한 개체의 성장 과정과 앞으로의 모습을 살피는 모습', images: { neutral: 'question-c06-neutral-v3.webp', left: 'question-c06-left-v3.webp', right: 'question-c06-right-v3.webp' } },
    { id: 'C07', axis: 'TF', scores: ['T', 'F'], label: '친구의 선택을 도울 때', q: '친구가 두 크레 중 고민하고 있다. 어떻게 도와줄까?', a: ['두 크레의 장단점을 함께 비교한다.', '어느 크레가 더 마음에 남는지 묻는다.'], alt: '두 크레 사이에서 고민하는 친구의 선택을 함께 살피는 모습', images: { neutral: 'question-c07-neutral-v3.webp', left: 'question-c07-left-v3.webp', right: 'question-c07-right-v3.webp' } },
    { id: 'C08', axis: 'JP', scores: ['J', 'P'], label: '새 크레가 오기 전', q: '새 크레가 오기 전, 사육장을 어떻게 준비할까?', a: ['필요한 것을 미리 정해 완성한다.', '기본부터 만들고 반응에 맞춰 바꾼다.'], alt: '새 크레가 오기 전에 사육장을 준비하는 모습', images: { neutral: 'question-c08-neutral-v5.webp', left: 'question-c08-left-v5.webp', right: 'question-c08-right-v5.webp' } },
    { id: 'C09', axis: 'EI', scores: ['E', 'I'], label: '행사 쉬는 시간', q: '행사에서 잠깐 쉬게 됐다. 나는 어떻게 보낼까?', a: ['사람들과 방금 본 크레 이야기를 한다.', '혼자 사진을 보며 생각을 정리한다.'], alt: '행사 쉬는 시간에 대화와 기록 사이에서 고민하는 모습', images: { neutral: 'question-c09-neutral-v3.webp', left: 'question-c09-left-v3.webp', right: 'question-c09-right-v3.webp' } },
    { id: 'C10', axis: 'SN', scores: ['S', 'N'], label: '처음 보는 크레 종류', q: '처음 보는 크레 종류를 알아볼 때, 먼저 보는 것은?', a: ['크레 한 마리씩 자세히 본다.', '이 종류에서 반복되는 특징을 본다.'], alt: '처음 보는 크레 종류의 개별 특징과 공통점을 살피는 모습', images: { neutral: 'question-c10-neutral-v3.webp', left: 'question-c10-left-v3.webp', right: 'question-c10-right-v3.webp' } },
    { id: 'C11', axis: 'TF', scores: ['T', 'F'], label: '계획과 마음이 다를 때', q: '계획에 맞는 크레와 마음이 가는 크레가 다르다. 어느 쪽을 고를까?', a: ['앞으로의 계획에 더 맞는 크레', '오래 마음에 남은 크레'], alt: '앞으로의 계획과 마음이 가는 크레 사이에서 고민하는 모습', images: { neutral: 'question-c11-neutral-v3.webp', left: 'question-c11-left-v3.webp', right: 'question-c11-right-v3.webp' } },
    { id: 'C12', axis: 'JP', scores: ['J', 'P'], label: '성장 기록', q: '성장 기록을 오래 남긴다면, 어떤 방식이 편할까?', a: ['매주 같은 내용을 짧게 기록한다.', '변화가 보일 때 자세히 기록한다.'], alt: '개체의 성장 기록을 달력과 관찰 노트에 남기는 모습', images: { neutral: 'question-c12-neutral-v3.webp', left: 'question-c12-left-v3.webp', right: 'question-c12-right-v3.webp' } }
];

let managerConfig = {};
let managedQuestions = [];
let selectedQuestionId = 'C01';
let managerDirty = false;
let managerSaving = false;
const pendingImages = new Map();
const previewUrls = new Map();

function cloneDefaultContent() {
    return DEFAULT_SURVEY_CONTENT.map(question => ({
        ...question,
        a: question.a.slice(),
        scores: question.scores.slice(),
        images: { ...question.images }
    }));
}

function resolveManagedImage(value) {
    const source = String(value || '').trim();
    if (/^(?:https?:|data:|blob:)/i.test(source)) return source;
    return `assets/crewart-illustrations/${source}`;
}

function escapeManagerHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function mergeManagedContent(raw) {
    const result = cloneDefaultContent();
    if (!raw) return result;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const items = Array.isArray(parsed) ? parsed : parsed?.questions;
        if (!Array.isArray(items)) return result;
        items.forEach(item => {
            const target = result.find(question => question.id === String(item?.id || '').toUpperCase());
            if (!target) return;
            if (String(item.q || '').trim()) target.q = String(item.q).trim();
            if (String(item.label || '').trim()) target.label = String(item.label).trim();
            if (Array.isArray(item.a) && item.a.length >= 2) {
                target.a = [String(item.a[0] || '').trim() || target.a[0], String(item.a[1] || '').trim() || target.a[1]];
            }
            if (String(item.alt || '').trim()) target.alt = String(item.alt).trim();
            IMAGE_STATES.forEach(state => {
                if (String(item.images?.[state] || '').trim()) target.images[state] = String(item.images[state]).trim();
            });
        });
    } catch (error) {
        managerToast('저장된 문항 설정을 읽지 못해 기본값을 표시합니다.', true);
    }
    return result;
}

function managerToast(message, isError) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.borderColor = isError ? '#fca5a5' : 'var(--cw-gold)';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
}

function currentManagedQuestion() {
    return managedQuestions.find(question => question.id === selectedQuestionId) || managedQuestions[0];
}

function renderQuestionNav() {
    const list = document.getElementById('manager-question-list');
    list.innerHTML = managedQuestions.map((question, index) => `
        <button class="cw-manager-question-button${question.id === selectedQuestionId ? ' active' : ''}" type="button" data-question-id="${question.id}">
            <span>${String(index + 1).padStart(2, '0')}</span>
            <strong>${escapeManagerHtml(question.label)}</strong>
            <small>${question.axis}</small>
        </button>`).join('');
    list.querySelectorAll('[data-question-id]').forEach(button => {
        button.addEventListener('click', () => selectManagedQuestion(button.dataset.questionId));
    });
}

function renderImageCards(question) {
    const container = document.getElementById('manager-images');
    container.innerHTML = IMAGE_STATES.map(state => {
        const key = `${question.id}:${state}`;
        const preview = previewUrls.get(key) || resolveManagedImage(question.images[state]);
        const pending = pendingImages.has(key);
        return `
            <article class="cw-manager-image-card${pending ? ' is-pending' : ''}" data-image-state="${state}">
                <header><strong>${IMAGE_STATE_LABELS[state]}</strong><span>${pending ? '저장 대기' : '현재 적용'}</span></header>
                <div class="cw-manager-image-preview"><img src="${escapeManagerHtml(preview)}" alt="${IMAGE_STATE_LABELS[state]} 미리보기"></div>
                <div class="cw-manager-image-actions">
                    <label class="cw-btn" for="image-${state}">이미지 선택</label>
                    <input id="image-${state}" type="file" accept="image/png,image/jpeg,image/webp" data-file-state="${state}" hidden>
                    <button class="cw-btn" type="button" data-reset-image="${state}">기본값</button>
                </div>
                <p>저장 시 1024×683 WebP로 자동 변환됩니다.</p>
            </article>`;
    }).join('');
    container.querySelectorAll('[data-file-state]').forEach(input => {
        input.addEventListener('change', event => queueManagedImage(event.target.dataset.fileState, event.target.files?.[0]));
    });
    container.querySelectorAll('[data-reset-image]').forEach(button => {
        button.addEventListener('click', () => resetManagedImage(button.dataset.resetImage));
    });
}

function renderEditor() {
    const question = currentManagedQuestion();
    if (!question) return;
    document.getElementById('manager-id').textContent = question.id;
    document.getElementById('manager-axis').textContent = `${question.axis} · A=${question.scores[0]} / B=${question.scores[1]}`;
    document.getElementById('manager-label').value = question.label;
    document.getElementById('manager-question').value = question.q;
    document.getElementById('manager-answer-a').value = question.a[0];
    document.getElementById('manager-answer-b').value = question.a[1];
    document.getElementById('manager-alt').value = question.alt;
    document.getElementById('manager-preview-link').href = `crewart-survey.html?moment=${question.id}`;
    renderImageCards(question);
    renderQuestionNav();
}

function commitEditor() {
    const question = currentManagedQuestion();
    if (!question) return;
    question.label = document.getElementById('manager-label').value.trim();
    question.q = document.getElementById('manager-question').value.trim();
    question.a = [
        document.getElementById('manager-answer-a').value.trim(),
        document.getElementById('manager-answer-b').value.trim()
    ];
    question.alt = document.getElementById('manager-alt').value.trim();
}

function markManagerDirty() {
    managerDirty = true;
    document.getElementById('manager-save-state').textContent = '저장되지 않은 변경사항';
    document.body.classList.add('cw-manager-dirty');
}

function selectManagedQuestion(id) {
    if (id === selectedQuestionId) return;
    commitEditor();
    selectedQuestionId = id;
    renderEditor();
    document.querySelector('.cw-manager-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function queueManagedImage(state, file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        managerToast('PNG, JPG, WebP 이미지만 선택할 수 있습니다.', true);
        return;
    }
    if (file.size > 15 * 1024 * 1024) {
        managerToast('이미지는 15MB 이하로 선택해주세요.', true);
        return;
    }
    const key = `${selectedQuestionId}:${state}`;
    const previousUrl = previewUrls.get(key);
    if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl);
    pendingImages.set(key, file);
    previewUrls.set(key, URL.createObjectURL(file));
    markManagerDirty();
    renderImageCards(currentManagedQuestion());
}

function resetManagedImage(state) {
    const question = currentManagedQuestion();
    const fallback = DEFAULT_SURVEY_CONTENT.find(item => item.id === question.id);
    const key = `${question.id}:${state}`;
    const previousUrl = previewUrls.get(key);
    if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl);
    previewUrls.delete(key);
    pendingImages.delete(key);
    question.images[state] = fallback.images[state];
    markManagerDirty();
    renderImageCards(question);
}

function loadImageElement(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열지 못했습니다.')); };
        image.src = url;
    });
}

async function convertManagedImage(file) {
    const image = await loadImageElement(file);
    const width = 1024;
    const height = 683;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('WebP 변환에 실패했습니다.')), 'image/webp', 0.82);
    });
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('이미지 데이터를 읽지 못했습니다.'));
        reader.readAsDataURL(blob);
    });
}

function validateManagedContent() {
    commitEditor();
    for (const question of managedQuestions) {
        if (!question.label || !question.q || !question.a[0] || !question.a[1]) {
            selectedQuestionId = question.id;
            renderEditor();
            throw new Error(`${question.id}의 질문과 선택지를 모두 입력해주세요.`);
        }
    }
}

async function uploadPendingManagedImages() {
    for (const [key, file] of pendingImages.entries()) {
        const [questionId, state] = key.split(':');
        const question = managedQuestions.find(item => item.id === questionId);
        if (!question) continue;
        const data = await convertManagedImage(file);
        const urls = await uploadPhotos([{ data, filename: `${questionId.toLowerCase()}-${state}.webp`, mimeType: 'image/webp' }]);
        if (!urls?.[0]) throw new Error(`${questionId} ${IMAGE_STATE_LABELS[state]} 업로드에 실패했습니다.`);
        question.images[state] = urls[0];
    }
}

function serializedManagedContent(updatedAt) {
    return JSON.stringify({
        version: 1,
        updatedAt,
        questions: managedQuestions.map(question => ({
            id: question.id,
            label: question.label,
            q: question.q,
            a: question.a.slice(0, 2),
            alt: question.alt,
            images: { ...question.images }
        }))
    });
}

async function saveManagedSurvey() {
    if (managerSaving) return;
    const button = document.getElementById('manager-save-button');
    try {
        validateManagedContent();
        managerSaving = true;
        button.disabled = true;
        button.textContent = pendingImages.size ? `이미지 ${pendingImages.size}장 처리 중...` : '저장 중...';
        await uploadPendingManagedImages();
        const updatedAt = new Date().toISOString();
        await updateConfigs({
            [CREWART_SURVEY_CONTENT_KEY]: serializedManagedContent(updatedAt),
            [CREWART_SURVEY_UPDATED_KEY]: updatedAt
        });
        previewUrls.forEach(url => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
        previewUrls.clear();
        pendingImages.clear();
        managerDirty = false;
        document.body.classList.remove('cw-manager-dirty');
        document.getElementById('manager-save-state').textContent = `마지막 저장 ${new Date(updatedAt).toLocaleString('ko-KR')}`;
        renderEditor();
        managerToast('문항과 삽화를 저장했습니다. 새로 시작하는 설문부터 반영됩니다.');
    } catch (error) {
        managerToast(error.message || '저장에 실패했습니다.', true);
    } finally {
        managerSaving = false;
        button.disabled = false;
        button.textContent = '전체 변경사항 저장';
    }
}

function resetCurrentManagedQuestion() {
    if (!confirm(`${selectedQuestionId} 문항을 기본 문구와 이미지로 되돌릴까요? 저장 전까지는 설문에 반영되지 않습니다.`)) return;
    const index = managedQuestions.findIndex(question => question.id === selectedQuestionId);
    const fallback = cloneDefaultContent().find(question => question.id === selectedQuestionId);
    managedQuestions[index] = fallback;
    IMAGE_STATES.forEach(state => {
        const key = `${selectedQuestionId}:${state}`;
        const url = previewUrls.get(key);
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
        previewUrls.delete(key);
        pendingImages.delete(key);
    });
    markManagerDirty();
    renderEditor();
}

function resetAllManagedQuestions() {
    if (!confirm('12개 문항의 문구와 이미지를 모두 기본값으로 되돌릴까요?')) return;
    previewUrls.forEach(url => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
    previewUrls.clear();
    pendingImages.clear();
    managedQuestions = cloneDefaultContent();
    selectedQuestionId = 'C01';
    markManagerDirty();
    renderEditor();
}

async function loadSurveyManager() {
    const loading = document.getElementById('manager-loading');
    try {
        managerConfig = await getConfigMap() || {};
        managedQuestions = mergeManagedContent(managerConfig[CREWART_SURVEY_CONTENT_KEY]);
        const updatedAt = managerConfig[CREWART_SURVEY_UPDATED_KEY];
        document.getElementById('manager-save-state').textContent = updatedAt
            ? `마지막 저장 ${new Date(updatedAt).toLocaleString('ko-KR')}`
            : '기본 문항 사용 중';
        renderEditor();
        document.getElementById('manager-workspace').hidden = false;
    } catch (error) {
        managerToast('문항 설정을 불러오지 못했습니다: ' + error.message, true);
    } finally {
        loading.hidden = true;
    }
}

document.addEventListener('input', event => {
    if (event.target.closest('.cw-manager-editor') && !event.target.matches('input[type="file"]')) markManagerDirty();
});
document.getElementById('manager-save-button').addEventListener('click', saveManagedSurvey);
document.getElementById('manager-reset-current').addEventListener('click', resetCurrentManagedQuestion);
document.getElementById('manager-reset-all').addEventListener('click', resetAllManagedQuestions);
window.addEventListener('beforeunload', event => {
    if (!managerDirty || managerSaving) return;
    event.preventDefault();
    event.returnValue = '';
});

loadSurveyManager();
