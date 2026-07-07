import re

filepath = r'c:\Users\laptop\Downloads\dc-monitor\dc-monitor\web-deploy\shipping.html'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. JS: copyToClipboardAndOpenKakao 함수 정의 추가 (openWinnerEditor 위에 삽입)
js_copy_func = """        // 클립보드 정산 문구 자동 복사 및 카카오톡 앱 연동 우회 구현
        async function copyToClipboardAndOpenKakao(text) {
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    const textArea = document.createElement("textarea");
                    textArea.value = text;
                    textArea.style.position = "fixed";
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                }
                showToast('정산 문구가 복사되었습니다! 카톡에 붙여넣어 전송하세요.');
                
                // 카카오톡 실행 딥링크 작동
                setTimeout(() => {
                    window.location.href = 'kakaotalk://';
                }, 800);
            } catch (err) {
                console.error('[Copy Kakao] Failed:', err);
                showToast('복사에 실패했습니다.', true);
            }
        }

        function alignEditorPanelToViewport() {"""

content = content.replace("        function alignEditorPanelToViewport() {", js_copy_func)

# 2. JS: updateEditorPricing 내부 KakaoTalk 연동 부분을 딥링크에서 클립보드 복사 함수 호출로 변경
original_js_kakao_link = """                if (kakaoBtn) {
                    kakaoBtn.href = `kakaotalk://send?text=${encodeURIComponent(smsText)}`;
                    kakaoBtn.style.display = 'inline-flex';
                }"""

new_js_kakao_link = """                if (kakaoBtn) {
                    kakaoBtn.removeAttribute('href');
                    kakaoBtn.style.cursor = 'pointer';
                    kakaoBtn.onclick = (e) => {
                        e.preventDefault();
                        copyToClipboardAndOpenKakao(smsText);
                    };
                    kakaoBtn.style.display = 'inline-flex';
                }"""

# original_js_kakao_link는 cleanPhone 분기 안에 들어 있습니다.
# exact matching을 위해 surrounding 코드를 가져와서 치환합니다.
original_target_kakao = """                if (smsBtn) {
                    smsBtn.href = `sms:${cleanPhone}?body=${encodeURIComponent(smsText)}`;
                    smsBtn.style.display = 'inline-flex';
                }
                if (kakaoBtn) {
                    kakaoBtn.href = `kakaotalk://send?text=${encodeURIComponent(smsText)}`;
                    kakaoBtn.style.display = 'inline-flex';
                }"""

new_target_kakao = """                if (smsBtn) {
                    smsBtn.href = `sms:${cleanPhone}?body=${encodeURIComponent(smsText)}`;
                    smsBtn.style.display = 'inline-flex';
                }
                if (kakaoBtn) {
                    kakaoBtn.removeAttribute('href');
                    kakaoBtn.style.cursor = 'pointer';
                    kakaoBtn.onclick = (e) => {
                        e.preventDefault();
                        copyToClipboardAndOpenKakao(smsText);
                    };
                    kakaoBtn.style.display = 'inline-flex';
                }"""

content = content.replace(original_target_kakao, new_target_kakao)

# Write modified content
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Success: Integrated clipboard fallback copy and kakaotalk:// app deep link trigger!")
