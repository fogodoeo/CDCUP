const CREWART_MBTI_CONTENT_KEY = 'crewart_mbti_content_v1';
const CREWART_MBTI_UPDATED_KEY = 'crewart_mbti_content_updated_at';
const Core = window.CrewartSurveyCore;

let managerConfig = {};
let managedQuestions = [];
let selectedQuestionId = 'Q01';
let managerDirty = false;
let managerSaving = false;

function cloneDefaults() {
    return Core.QUESTIONS.map(question => ({
        ...question,
        options: question.options.slice(),
        scores: question.scores.slice()
    }));
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function toast(message, isError) {
    const target = document.getElementById('toast');
    target.textContent = message;
    target.style.borderColor = isError ? '#fca5a5' : 'var(--cw-gold)';
    target.classList.add('show');
    setTimeout(() => target.classList.remove('show'), 2600);
}

function mergeSavedContent(raw) {
    const result = cloneDefaults();
    if (!raw) return result;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const items = Array.isArray(parsed) ? parsed : parsed?.questions;
        if (!Array.isArray(items)) return result;
        items.forEach(item => {
            const target = result.find(question => question.id === String(item?.id || '').toUpperCase());
            if (!target) return;
            if (String(item.label || '').trim()) target.label = String(item.label).trim();
            if (String(item.q || '').trim()) target.q = String(item.q).trim();
            if (Array.isArray(item.options) && item.options.length >= 2) {
                target.options = [
                    String(item.options[0] || '').trim() || target.options[0],
                    String(item.options[1] || '').trim() || target.options[1]
                ];
            }
        });
    } catch (error) {
        toast('저장된 문항을 읽지 못해 기본 문항을 표시합니다.', true);
    }
    return result;
}

function currentQuestion() {
    return managedQuestions.find(question => question.id === selectedQuestionId) || managedQuestions[0];
}

function renderQuestionList() {
    document.getElementById('manager-question-list').innerHTML = managedQuestions.map((question, index) => `
        <button class="cw-manager-question-button${question.id === selectedQuestionId ? ' active' : ''}" type="button" data-question-id="${question.id}">
            <span>${String(index + 1).padStart(2, '0')}</span>
            <strong>${escapeHtml(question.label)}</strong>
            <small>${question.axis}</small>
        </button>`).join('');
    document.querySelectorAll('[data-question-id]').forEach(button => {
        button.addEventListener('click', () => selectQuestion(button.dataset.questionId));
    });
}

function renderEditor() {
    const question = currentQuestion();
    if (!question) return;
    document.getElementById('manager-id').textContent = question.id;
    document.getElementById('manager-axis').textContent = question.axis;
    document.getElementById('manager-label').value = question.label;
    document.getElementById('manager-question').value = question.q;
    document.getElementById('manager-answer-a').value = question.options[0];
    document.getElementById('manager-answer-b').value = question.options[1];
    document.getElementById('manager-answer-a-label').textContent = `${question.scores[0]} 성향 선택지`;
    document.getElementById('manager-answer-b-label').textContent = `${question.scores[1]} 성향 선택지`;
}

function commitEditor() {
    const question = currentQuestion();
    if (!question) return;
    question.label = document.getElementById('manager-label').value.trim();
    question.q = document.getElementById('manager-question').value.trim();
    question.options = [
        document.getElementById('manager-answer-a').value.trim(),
        document.getElementById('manager-answer-b').value.trim()
    ];
}

function setDirty() {
    managerDirty = true;
    document.getElementById('manager-save-state').textContent = '저장하지 않은 변경사항이 있습니다.';
}

function selectQuestion(id) {
    commitEditor();
    selectedQuestionId = id;
    renderQuestionList();
    renderEditor();
}

function validateQuestions() {
    commitEditor();
    if (managedQuestions.length !== 20) throw new Error('20개 문항이 모두 필요합니다.');
    managedQuestions.forEach(question => {
        if (!question.label || !question.q || !question.options[0] || !question.options[1]) {
            throw new Error(`${question.id} 문항에 빈 내용이 있습니다.`);
        }
    });
}

async function saveQuestions() {
    if (managerSaving) return;
    try {
        validateQuestions();
        managerSaving = true;
        document.getElementById('manager-save-button').disabled = true;
        document.getElementById('manager-sticky-save').disabled = true;
        const updatedAt = new Date().toISOString();
        await updateConfigs({
            [CREWART_MBTI_CONTENT_KEY]: JSON.stringify({ version: Core.SURVEY_VERSION, questions: managedQuestions }),
            [CREWART_MBTI_UPDATED_KEY]: updatedAt
        });
        managerConfig[CREWART_MBTI_CONTENT_KEY] = JSON.stringify({ version: Core.SURVEY_VERSION, questions: managedQuestions });
        managerConfig[CREWART_MBTI_UPDATED_KEY] = updatedAt;
        managerDirty = false;
        document.getElementById('manager-save-state').textContent = `저장됨 · ${new Date(updatedAt).toLocaleString('ko-KR')}`;
        toast('20개 문항을 저장했습니다.');
    } catch (error) {
        toast(error.message || '문항을 저장하지 못했습니다.', true);
    } finally {
        managerSaving = false;
        document.getElementById('manager-save-button').disabled = false;
        document.getElementById('manager-sticky-save').disabled = false;
    }
}

function resetCurrent() {
    const original = cloneDefaults().find(question => question.id === selectedQuestionId);
    const index = managedQuestions.findIndex(question => question.id === selectedQuestionId);
    if (!original || index < 0) return;
    managedQuestions[index] = original;
    renderQuestionList();
    renderEditor();
    setDirty();
}

function resetAll() {
    if (!window.confirm('20개 문항을 모두 기본값으로 되돌릴까요?')) return;
    managedQuestions = cloneDefaults();
    selectedQuestionId = 'Q01';
    renderQuestionList();
    renderEditor();
    setDirty();
}

async function loadManager() {
    try {
        managerConfig = await getConfigMap() || {};
        managedQuestions = mergeSavedContent(managerConfig[CREWART_MBTI_CONTENT_KEY]);
        const updatedAt = managerConfig[CREWART_MBTI_UPDATED_KEY];
        document.getElementById('manager-save-state').textContent = updatedAt
            ? `마지막 저장 · ${new Date(updatedAt).toLocaleString('ko-KR')}`
            : '기본 문항을 사용 중입니다.';
        renderQuestionList();
        renderEditor();
        document.getElementById('manager-loading').hidden = true;
        document.getElementById('manager-workspace').hidden = false;
    } catch (error) {
        toast('문항 설정을 불러오지 못했습니다: ' + error.message, true);
    }
}

document.getElementById('manager-save-button').addEventListener('click', saveQuestions);
document.getElementById('manager-sticky-save').addEventListener('click', saveQuestions);
document.getElementById('manager-reset-current').addEventListener('click', resetCurrent);
document.getElementById('manager-reset-all').addEventListener('click', resetAll);
['manager-label', 'manager-question', 'manager-answer-a', 'manager-answer-b'].forEach(id => {
    document.getElementById(id).addEventListener('input', setDirty);
});
window.addEventListener('beforeunload', event => {
    if (!managerDirty || managerSaving) return;
    event.preventDefault();
    event.returnValue = '';
});

loadManager();
