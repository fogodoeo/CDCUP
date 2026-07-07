import re

filepath = r'c:\Users\laptop\Downloads\dc-monitor\dc-monitor\web-deploy\shipping.html'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. CSS: .btn:disabled에 대한 회색 비활성 스타일을 </style> 위에 추가
disabled_btn_styles = """
        /* 버튼 비활성화 상태 통합 스타일 */
        .btn:disabled {
            background: #E2E8F0 !important;
            border-color: #E2E8F0 !important;
            color: #94A3B8 !important;
            cursor: not-allowed !important;
            box-shadow: none !important;
            transform: none !important;
        }
    </style>"""

content = content.replace('    </style>', disabled_btn_styles)

# Write modified content
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Success: Configured disabled button CSS stylesheet to render gray background!")
