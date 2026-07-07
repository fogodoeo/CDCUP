const fs = require('fs');
const path = require('path');
const vm = require('vm');

function checkFileJSSyntax(filename) {
    console.log(`=== Node.js VM Syntax Checking: ${filename} ===`);
    const filepath = path.join('c:\\Users\\laptop\\Downloads\\dc-monitor\\dc-monitor\\web-deploy', filename);
    const content = fs.readFileSync(filepath, 'utf8');
    
    // <script> 블록 매칭
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let index = 1;
    
    while ((match = scriptRegex.exec(content)) !== null) {
        const js = match[1];
        if (js.trim().length < 10) continue;
        
        console.log(`Testing Block #${index} (length: ${js.length} chars)...`);
        
        try {
            // vm.Script로 컴파일을 시도하여 컴파일 단계의 SyntaxError를 잡아냅/니다.
            new vm.Script(js, { filename: `${filename}#Block${index}` });
            console.log(`Block #${index}: OK`);
        } catch (err) {
            console.error(`Block #${index} FAILED:`, err.message);
            // 에러 스택/라인 출력
            console.error(err.stack);
        }
        index++;
    }
}

checkFileJSSyntax('preview.html');
checkFileJSSyntax('broadcast.html');
