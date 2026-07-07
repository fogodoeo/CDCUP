import re

filepath = r'c:\Users\laptop\Downloads\dc-monitor\dc-monitor\web-deploy\shipping.html'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. JS: getSchedule 함수에서 도도시(Dodosi)의 스케줄 역시 대구 토요일 집하 및 다음 주 도착 기준으로 수정
original_js_dodosi_schedule = """                if (comp === '도도시') {
                    // 도도시는 거점별 데이터(dayField)가 있으면 그것을 보여주고, 없으면 기본 요일 제공
                    if (dayField) {
                        const sendDay = (dayField.includes('일') || dayField.includes('일요일')) ? '목요일' : '화요일';
                        return `${sendDay} 발송 ➔ ${dayField} 수령`;
                    }
                    return `화요일 발송 ➔ 목요일 도착 | 목요일 발송 ➔ 일요일 도착`;
                }"""

new_js_dodosi_schedule = """                if (comp === '도도시') {
                    // 도도시: 대구 토요일 집하 후 다음 주 지정 요일 도착
                    if (dayField) {
                        let formattedDay = dayField.replace(/\\./g, '·');
                        if (!formattedDay.includes('요일')) {
                            formattedDay = formattedDay + '요일';
                        }
                        return `토요일 집하 ➔ 다음 주 ${formattedDay} 도착`;
                    }
                    return `토요일 집하 ➔ 다음 주 목·일요일 도착`;
                }"""

content = content.replace(original_js_dodosi_schedule, new_js_dodosi_schedule)

# Write modified content
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Success: Aligned Dodosi shipping schedule with Saturday collection and next-week delivery rules!")
