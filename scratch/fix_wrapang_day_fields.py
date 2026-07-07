import re

filepath = r'c:\Users\laptop\Downloads\dc-monitor\dc-monitor\web-deploy\shipping.html'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. JS: getWrapangData() 로딩 루프에서 day 속성을 누락하지 않고 바인딩하도록 수정
original_wrapang_load = """                // 랩팡 동적 가격표 로드
                try {
                    const wrapangRes = await getWrapangData();
                    if (wrapangRes && wrapangRes.success && wrapangRes.data) {
                        SHIPPING_DATA['랩팡'].regions = {};
                        Object.keys(wrapangRes.data).forEach(regName => {
                            SHIPPING_DATA['랩팡'].regions[regName] = wrapangRes.data[regName].map(shopItem => ({
                                shop: shopItem.shop,
                                cost: shopItem.cost || (regName.includes('제주') ? 55000 : 25000)
                            }));
                        });
                        console.log('[Wrapang] Successfully loaded dynamic wrapang prices:', Object.keys(SHIPPING_DATA['랩팡'].regions).length, 'regions');
                    }
                } catch (wrapangErr) {"""

new_wrapang_load = """                // 랩팡 동적 가격표 로드 (day 속성을 추출하여 바인딩)
                try {
                    const wrapangRes = await getWrapangData();
                    if (wrapangRes && wrapangRes.success && wrapangRes.data) {
                        SHIPPING_DATA['랩팡'].regions = {};
                        Object.keys(wrapangRes.data).forEach(regName => {
                            SHIPPING_DATA['랩팡'].regions[regName] = wrapangRes.data[regName].map(shopItem => ({
                                shop: shopItem.shop,
                                cost: shopItem.cost || (regName.includes('제주') ? 55000 : 25000),
                                day: shopItem.day || shopItem.arrival_day || shopItem.delivery_day || ''
                            }));
                        });
                        console.log('[Wrapang] Successfully loaded dynamic wrapang prices:', Object.keys(SHIPPING_DATA['랩팡'].regions).length, 'regions');
                    }
                } catch (wrapangErr) {"""

content = content.replace(original_wrapang_load, new_wrapang_load)

# 2. JS: getSchedule 함수 내 랩팡 일정을 '금요일 집하' 및 데이터에 저장된 도착요일로 동적 매핑
original_get_schedule = """                } else if (comp === '랩팡') {
                    // 랩팡: 월요일, 목요일 발송 기준
                    if (region.includes('제주')) {
                        return `월/목요일 발송 ➔ 다음 주 화/금요일 도착 (제주 1~2일 추가 소요)`;
                    }
                    return `월요일 발송 ➔ 화요일 도착 | 목요일 발송 ➔ 금요일 도착`;
                }"""

new_get_schedule = """                } else if (comp === '랩팡') {
                    // 랩팡: 금요일 집하 및 거점별 도착 요일 동적 표시
                    if (dayField) {
                        return `금요일 집하 ➔ ${dayField} 도착`;
                    }
                    if (region.includes('제주')) {
                        return `금요일 집하 ➔ 다음 주 토요일 도착 (배편·격주)`;
                    }
                    return `금요일 집하 ➔ 토요일 도착`;
                }"""

content = content.replace(original_get_schedule, new_get_schedule)

# Write modified content
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Success: Configured Wrapang to load day fields dynamically and apply Friday collection schedule rules!")
