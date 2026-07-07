import re

filepath = r'c:\Users\laptop\Downloads\dc-monitor\dc-monitor\web-deploy\shipping.html'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. JS: 파르게 배송 정보를 공식 요일별 스케줄 이미지 기준으로 100% 동기화
original_get_schedule = """            // Helper to get dispatch and receipt schedule (소비자 관점에서 직관적인 전달일로 변경)
            function getSchedule(regName, dayField) {
                const region = regName || '';
                if (comp === '도도시') {
                    // 도도시는 거점별 데이터(dayField)가 있으면 그것을 보여주고, 없으면 기본 요일 제공
                    if (dayField) {
                        const sendDay = (dayField.includes('일') || dayField.includes('일요일')) ? '목요일' : '화요일';
                        return `${sendDay} 발송 ➔ ${dayField} 수령`;
                    }
                    return `화요일 발송 ➔ 목요일 도착 | 목요일 발송 ➔ 일요일 도착`;
                } else if (comp === '파르게') {
                    // 파르게: 토요일까지 취합 후 월요일 순차발송 스케줄링 (제주는 격주 별도관리)
                    if (region.includes('제주')) {
                        return `격주 배송 (배송 일정 별도 확인 필요)`;
                    } else if (region.includes('서울') || region.includes('경기') || region.includes('인천')) {
                        return `토요일 취합 ➔ 월요일부터 순차 발송 (화~수요일 도착)`;
                    } else if (region.includes('충청') || region.includes('대전') || region.includes('세종')) {
                        return `토요일 취합 ➔ 월요일부터 순차 발송 (화요일 도착)`;
                    } else if (region.includes('전라') || region.includes('광주')) {
                        return `토요일 취합 ➔ 월요일부터 순차 발송 (수요일 도착)`;
                    } else if (region.includes('대구') || region.includes('경북')) {
                        return `토요일 취합 ➔ 월요일부터 순차 발송 (월~화요일 도착)`;
                    } else if (region.includes('부산') || region.includes('경남') || region.includes('울산') || region.includes('경상')) {
                        return `토요일 취합 ➔ 월요일부터 순차 발송 (화요일 도착)`;
                    }
                    return `토요일 취합 ➔ 월요일부터 순차 발송 (수요일 전후 도착)`;
                } else if (comp === '랩팡') {
                    // 랩팡: 월요일, 목요일 발송 기준
                    if (region.includes('제주')) {
                        return `월/목요일 발송 ➔ 다음 주 화/금요일 도착 (제주 1~2일 추가 소요)`;
                    }
                    return `월요일 발송 ➔ 화요일 도착 | 목요일 발송 ➔ 금요일 도착`;
                }
                return '';
            }"""

new_get_schedule = """            // Helper to get dispatch and receipt schedule (소비자 관점에서 직관적인 전달일로 변경)
            function getSchedule(regName, dayField) {
                const region = regName || '';
                if (comp === '도도시') {
                    // 도도시는 거점별 데이터(dayField)가 있으면 그것을 보여주고, 없으면 기본 요일 제공
                    if (dayField) {
                        const sendDay = (dayField.includes('일') || dayField.includes('일요일')) ? '목요일' : '화요일';
                        return `${sendDay} 발송 ➔ ${dayField} 수령`;
                    }
                    return `화요일 발송 ➔ 목요일 도착 | 목요일 발송 ➔ 일요일 도착`;
                } else if (comp === '파르게') {
                    // 파르게 공식 주간 배송 타임라인 매핑 (전달받은 주간 스케줄 정보 100% 반영)
                    if (region.includes('제주')) {
                        return `월요일 집하 ➔ 토요일 도착 (배편·격주)`;
                    } else if (region.includes('서울') || region.includes('경기') || region.includes('인천')) {
                        return `월요일 집하 ➔ 수~목요일 도착`;
                    } else if (region.includes('충청') || region.includes('대전') || region.includes('세종')) {
                        return `월요일 집하 ➔ 화요일 도착`;
                    } else if (region.includes('전라') || region.includes('광주')) {
                        return `월요일 집하 ➔ 일요일 도착`;
                    } else if (region.includes('대구') || region.includes('경북') || region.includes('부산') || region.includes('경남') || region.includes('울산') || region.includes('경상')) {
                        return `월요일 집하 ➔ 수~목요일 도착`;
                    } else if (region.includes('강원')) {
                        return `월요일 집하 ➔ 금요일 도착`;
                    }
                    return `월요일 집하 ➔ 주간 순차 도착`;
                } else if (comp === '랩팡') {
                    // 랩팡: 월요일, 목요일 발송 기준
                    if (region.includes('제주')) {
                        return `월/목요일 발송 ➔ 다음 주 화/금요일 도착 (제주 1~2일 추가 소요)`;
                    }
                    return `월요일 발송 ➔ 화요일 도착 | 목요일 발송 ➔ 금요일 도착`;
                }
                return '';
            }"""

content = content.replace(original_get_schedule, new_get_schedule)

# Write modified content
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Success: Synced Parge shipping rules to the official weekly schedule diagram!")
