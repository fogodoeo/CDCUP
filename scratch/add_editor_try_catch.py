import re

filepath = r'c:\Users\laptop\Downloads\dc-monitor\dc-monitor\web-deploy\shipping.html'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# openWinnerEditor를 안전하게 try-catch로 감싸서 화면에 에러를 alert로 띄우기
original_js_open = """        function openWinnerEditor(winnerName) {
            const selectedCo = activeSellerCompany;
            const state = winnerStateMap[winnerName];
            if (!state) return;

            activeEditorWinner = winnerName;
            editorShippingState = {
                type: state.shipping_type || '미설정',
                company: state.shipping_company || '',
                region: state.shipping_region || '',
                hub: state.shipping_hub || '',
                memo: state.memo || ''
            };

            // 상단에는 긴 목록 대신 현재 업체의 개체 정보만 한 줄로 요약한다.
            const currentCoItems = state.allItems.filter(it => (it.company || '').trim() === selectedCo);
            const otherCoItems = state.allItems.filter(it => (it.company || '').trim() !== selectedCo);
            // 1. 낙찰자명
            document.getElementById('editor-info-winner').textContent = winnerName;
            
            // 2. 전화번호 단순 바인딩
            const phoneLabel = document.getElementById('editor-info-phone');
            if (phoneLabel) {
                phoneLabel.textContent = fmtPhone(state.phone) || '연락처 없음';
            }
            
            // 3. 합배송 버튼 제어 (합배송이 있을 때만 보이도록 설정)
            const isCombined = otherCoItems.length > 0;
            const btnToggle = document.getElementById('btn-toggle-breakdown');
            const sectionBreakdown = document.getElementById('editor-shipping-breakdown');
            if (btnToggle) {
                btnToggle.style.display = isCombined ? 'flex' : 'none';
            }
            if (sectionBreakdown) {
                sectionBreakdown.style.display = 'none';
            }
            const btnArrow = document.getElementById('btn-breakdown-arrow');
            if (btnArrow) {
                btnArrow.textContent = '▼';
            }
            
            // 4. 낙찰개체 정보 한줄로 (No. 제외하고 개체명 + 낙찰가)
            const objectNames = currentCoItems.map(it => {
                const name = it.name || '이름 없음';
                const priceVal = parseFloat(it.soldPrice || it.sold_price) || 0;
                const priceText = priceVal > 0 ? ` (${priceVal}만)` : '';
                return `${name}${priceText}`;
            }).join(', ');
            document.getElementById('editor-info-objects').textContent = objectNames;

            // Set Segmented Control Active Button
            setEditorShippingType(editorShippingState.type === '직접수령' ? '픽업' : (editorShippingState.type === '배송' ? editorShippingState.company : '미설정'), true);

            // Set Memo
            document.getElementById('editor-memo').value = editorShippingState.memo;

            // Recalculate Modal Pricing
            updateEditorPricing();

            // Show Modal
            const modal = document.getElementById('winner-edit-modal');
            const panelSlot = document.getElementById('editor-panel-slot');
            const emptyState = document.getElementById('editor-empty-state');
            modal.style.display = 'flex';
            modal.classList.add('active');
            if (panelSlot) panelSlot.classList.add('is-active');
            if (emptyState) emptyState.style.display = 'none';
            const workspace = document.querySelector('.admin-workspace');
            if (workspace) workspace.classList.add('is-editing');
            document.body.classList.add('editor-open');

            document.querySelectorAll('.winner-card').forEach(card => {
                card.classList.toggle('is-selected', card.dataset.winner === winnerName);
            });

            // 편집을 시작하면 작업 영역을 화면 상단에 맞춰 하단 금액/저장 영역도 함께 보이게 한다.
            if (panelSlot) {
                requestAnimationFrame(alignEditorPanelToViewport);
            }
        }"""

new_js_open = """        function openWinnerEditor(winnerName) {
            try {
                const selectedCo = activeSellerCompany;
                const state = winnerStateMap[winnerName];
                if (!state) {
                    alert('[openWinnerEditor] state가 없습니다: ' + winnerName);
                    return;
                }

                activeEditorWinner = winnerName;
                editorShippingState = {
                    type: state.shipping_type || '미설정',
                    company: state.shipping_company || '',
                    region: state.shipping_region || '',
                    hub: state.shipping_hub || '',
                    memo: state.memo || ''
                };

                // 상단에는 긴 목록 대신 현재 업체의 개체 정보만 한 줄로 요약한다.
                const currentCoItems = state.allItems.filter(it => (it.company || '').trim() === selectedCo);
                const otherCoItems = state.allItems.filter(it => (it.company || '').trim() !== selectedCo);
                // 1. 낙찰자명
                document.getElementById('editor-info-winner').textContent = winnerName;
                
                // 2. 전화번호 단순 바인딩
                const phoneLabel = document.getElementById('editor-info-phone');
                if (phoneLabel) {
                    phoneLabel.textContent = fmtPhone(state.phone) || '연락처 없음';
                }
                
                // 3. 합배송 버튼 제어 (합배송이 있을 때만 보이도록 설정)
                const isCombined = otherCoItems.length > 0;
                const btnToggle = document.getElementById('btn-toggle-breakdown');
                const sectionBreakdown = document.getElementById('editor-shipping-breakdown');
                if (btnToggle) {
                    btnToggle.style.display = isCombined ? 'flex' : 'none';
                }
                if (sectionBreakdown) {
                    sectionBreakdown.style.display = 'none';
                }
                const btnArrow = document.getElementById('btn-breakdown-arrow');
                if (btnArrow) {
                    btnArrow.textContent = '▼';
                }
                
                // 4. 낙찰개체 정보 한줄로 (No. 제외하고 개체명 + 낙찰가)
                const objectNames = currentCoItems.map(it => {
                    const name = it.name || '이름 없음';
                    const priceVal = parseFloat(it.soldPrice || it.sold_price) || 0;
                    const priceText = priceVal > 0 ? ` (${priceVal}만)` : '';
                    return `${name}${priceText}`;
                }).join(', ');
                document.getElementById('editor-info-objects').textContent = objectNames;

                // Set Segmented Control Active Button
                setEditorShippingType(editorShippingState.type === '직접수령' ? '픽업' : (editorShippingState.type === '배송' ? editorShippingState.company : '미설정'), true);

                // Set Memo
                document.getElementById('editor-memo').value = editorShippingState.memo;

                // Recalculate Modal Pricing
                updateEditorPricing();

                // Show Modal
                const modal = document.getElementById('winner-edit-modal');
                const panelSlot = document.getElementById('editor-panel-slot');
                const emptyState = document.getElementById('editor-empty-state');
                modal.style.display = 'flex';
                modal.classList.add('active');
                if (panelSlot) panelSlot.classList.add('is-active');
                if (emptyState) emptyState.style.display = 'none';
                const workspace = document.querySelector('.admin-workspace');
                if (workspace) workspace.classList.add('is-editing');
                document.body.classList.add('editor-open');

                document.querySelectorAll('.winner-card').forEach(card => {
                    card.classList.toggle('is-selected', card.dataset.winner === winnerName);
                });

                // 편집을 시작하면 작업 영역을 화면 상단에 맞춰 하단 금액/저장 영역도 함께 보이게 한다.
                if (panelSlot) {
                    requestAnimationFrame(alignEditorPanelToViewport);
                }
            } catch (openErr) {
                console.error('[openWinnerEditor ERROR]', openErr);
                alert('[openWinnerEditor CRASH]\\nMessage: ' + openErr.message + '\\nStack: ' + openErr.stack);
            }
        }"""

content = content.replace(original_js_open, new_js_open)

# updateEditorPricing 도 try-catch 얼럿 디버깅 추가
original_js_update_pricing = """        function updateEditorPricing() {
            const winnerName = activeEditorWinner;
            const state = winnerStateMap[winnerName];
            if (!state) return;"""

new_js_update_pricing = """        function updateEditorPricing() {
            try {
                const winnerName = activeEditorWinner;
                const state = winnerStateMap[winnerName];
                if (!state) return;"""

content = content.replace(original_js_update_pricing, new_js_update_pricing)

# updateEditorPricing 함수 마지막 닫는 중괄호에 catch문 추가
# renderEditorShippingBreakdown 호출 직후가 함수 끝부분입니다.
original_js_pricing_end_line = """            if (smsBtn) {
                if (cleanPhone) {
                    const smsObjects = groupItems.map(it => {
                        const name = it.name || '이름 없음';
                        const priceVal = parseFloat(it.soldPrice || it.sold_price) || 0;
                        return `${name}${priceVal > 0 ? `(${priceVal}만)` : ''}`;
                    }).join(', ');

                    let smsShipInfo = '';
                    if (editorShippingState.type === '직접수령') {
                        smsShipInfo = '현장 직접 수령';
                    } else if (editorShippingState.type === '배송') {
                        if (comp === '기타') {
                            smsShipInfo = `[기타배송] ${reg}`;
                        } else if (reg && hub) {
                            smsShipInfo = `[${comp}] ${reg} (${hub})`;
                        } else {
                            smsShipInfo = `배송 거점 미지정`;
                        }
                    } else {
                        smsShipInfo = '미설정';
                    }

                    const smsText = `[배송관리 - ${selectedCo}]
${winnerName}님 낙찰 정산 안내입니다.

■ 낙찰개체: ${smsObjects}
■ 낙찰금액: ${(totalBid * 10000).toLocaleString()}원
■ 배송방식: ${smsShipInfo}
■ 배송금액: ${shipCost.toLocaleString()}원
■ 최종 입금액: ${grandTotal.toLocaleString()}원

확인 부탁드립니다. 감사합니다.`;

                    smsBtn.href = `sms:${cleanPhone}?body=${encodeURIComponent(smsText)}`;
                    smsBtn.style.display = 'inline-flex';
                } else {
                    smsBtn.removeAttribute('href');
                    smsBtn.style.display = 'none';
                }
            }

            const kakaoBtn = document.getElementById('editor-info-kakao-btn');
            if (kakaoBtn) {
                if (cleanPhone) {
                    kakaoBtn.href = `kakaotalk://send?text=${encodeURIComponent(smsText)}`;
                    kakaoBtn.style.display = 'inline-flex';
                } else {
                    kakaoBtn.removeAttribute('href');
                    kakaoBtn.style.display = 'none';
                }
            }
        }"""

new_js_pricing_end_line = """            if (smsBtn) {
                if (cleanPhone) {
                    const smsObjects = groupItems.map(it => {
                        const name = it.name || '이름 없음';
                        const priceVal = parseFloat(it.soldPrice || it.sold_price) || 0;
                        return `${name}${priceVal > 0 ? `(${priceVal}만)` : ''}`;
                    }).join(', ');

                    let smsShipInfo = '';
                    if (editorShippingState.type === '직접수령') {
                        smsShipInfo = '현장 직접 수령';
                    } else if (editorShippingState.type === '배송') {
                        if (comp === '기타') {
                            smsShipInfo = `[기타배송] ${reg}`;
                        } else if (reg && hub) {
                            smsShipInfo = `[${comp}] ${reg} (${hub})`;
                        } else {
                            smsShipInfo = `배송 거점 미지정`;
                        }
                    } else {
                        smsShipInfo = '미설정';
                    }

                    const smsText = `[배송관리 - ${selectedCo}]
${winnerName}님 낙찰 정산 안내입니다.

■ 낙찰개체: ${smsObjects}
■ 낙찰금액: ${(totalBid * 10000).toLocaleString()}원
■ 배송방식: ${smsShipInfo}
■ 배송금액: ${shipCost.toLocaleString()}원
■ 최종 입금액: ${grandTotal.toLocaleString()}원

확인 부탁드립니다. 감사합니다.`;

                    smsBtn.href = `sms:${cleanPhone}?body=${encodeURIComponent(smsText)}`;
                    smsBtn.style.display = 'inline-flex';
                } else {
                    smsBtn.removeAttribute('href');
                    smsBtn.style.display = 'none';
                }
            }

            const kakaoBtn = document.getElementById('editor-info-kakao-btn');
            if (kakaoBtn) {
                if (cleanPhone) {
                    kakaoBtn.href = `kakaotalk://send?text=${encodeURIComponent(smsText)}`;
                    kakaoBtn.style.display = 'inline-flex';
                } else {
                    kakaoBtn.removeAttribute('href');
                    kakaoBtn.style.display = 'none';
                }
            }
            } catch (pricingErr) {
                console.error('[updateEditorPricing ERROR]', pricingErr);
                alert('[updateEditorPricing CRASH]\\nMessage: ' + pricingErr.message + '\\nStack: ' + pricingErr.stack);
            }
        }"""

content = content.replace(original_js_pricing_end_line, new_js_pricing_end_line)

# Write modified content
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Success: Configured openWinnerEditor and updateEditorPricing try-catch alert wrappers!")
