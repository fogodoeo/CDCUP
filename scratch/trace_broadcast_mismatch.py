import re

filepath = r'c:\Users\laptop\Downloads\dc-monitor\dc-monitor\web-deploy\broadcast.html'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 세 번째 스크립트 블록 찾기
script_blocks = re.findall(r'<script\b[^>]*>(.*?)</script>', content, re.DOTALL)
if len(script_blocks) < 3:
    print("Block #3 not found!")
    sys.exit(1)

js = script_blocks[2]
lines = js.splitlines()

# 주석/리터럴 문자열 제외한 순수 코드에서 줄별로 누적 괄호 분석
brace_diff = 0
paren_diff = 0

print("=== Braces {} and Parens () Mismatch Tracer ===")
# 스크립트 블록의 실제 시작 라인은 1013라인 바로 아래(1014라인)부터입니다.
start_line_no = 1014

for idx, line in enumerate(lines):
    line_no = start_line_no + idx
    
    # 주석 제거
    line_clean = re.sub(r'\/\/.*', '', line)
    # 문자열 제거
    line_clean = re.sub(r'".*?"', '', line_clean)
    line_clean = re.sub(r"'.*?'", '', line_clean)
    line_clean = re.sub(r'`.*?`', '', line_clean)
    
    o_b = line_clean.count('{')
    c_b = line_clean.count('}')
    o_p = line_clean.count('(')
    c_p = line_clean.count(')')
    
    brace_diff += (o_b - c_b)
    paren_diff += (o_p - c_p)
    
    # 누적 차이가 음수가 되거나 0보다 크거나 작아질 때, 줄별 괄호 변화가 있는 특정 구간을 프린트
    # (특히, 함수 정의 주변의 불일치를 보기 위해 변화가 발생할 때 체크)
    if 'applyBracketPageMap' in line or 'refreshBracketPage' in line or 'renderBracketPageTree' in line:
        print(f"Line {line_no}: brace_diff={brace_diff}, paren_diff={paren_diff} | {line.strip()}")

# 전체 소스에서 괄호 불일치가 발생한 최종 시점이나 특정 어노말리를 추적하기 위해 
# brace_diff가 마이너스가 되는 임계 지점이나 최종 지점 추적
brace_diff = 0
paren_diff = 0
for idx, line in enumerate(lines):
    line_no = start_line_no + idx
    line_clean = re.sub(r'\/\/.*', '', line)
    line_clean = re.sub(r'".*?"', '', line_clean)
    line_clean = re.sub(r"'.*?'", '', line_clean)
    line_clean = re.sub(r'`.*?`', '', line_clean)
    
    o_b = line_clean.count('{')
    c_b = line_clean.count('}')
    o_p = line_clean.count('(')
    c_p = line_clean.count(')')
    
    brace_diff += (o_b - c_b)
    paren_diff += (o_p - c_p)
    
    # 닫는 괄호가 너무 많이 나와서 밸런스가 마이너스로 무너진 첫 번째 라인 출력
    if brace_diff < 0:
        print(f"CRITICAL [Brace < 0] at Line {line_no}: brace_diff={brace_diff} | {line.strip()}")
        break

brace_diff = 0
for idx, line in enumerate(lines):
    line_no = start_line_no + idx
    line_clean = re.sub(r'\/\/.*', '', line)
    line_clean = re.sub(r'".*?"', '', line_clean)
    line_clean = re.sub(r"'.*?'", '', line_clean)
    line_clean = re.sub(r'`.*?`', '', line_clean)
    
    o_b = line_clean.count('{')
    c_b = line_clean.count('}')
    brace_diff += (o_b - c_b)

print(f"Final brace_diff: {brace_diff}")
