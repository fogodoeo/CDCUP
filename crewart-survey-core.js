(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.CrewartSurveyCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    let SURVEY_VERSION = 'crewart-tendency-v28.0-pasamo-ultimate';

    const SURVEY_VERSION_REGISTRY = {
        v1: {
            id: 'v1',
            versionKey: 'v24',
            displayName: 'Ver 1',
            questionVersion: 'crewart-tendency-v12.3-balanced-3to2',
            resultsVersion: 'crewart-results-v1-legacy',
            questionsFile: 'crewart-survey-questions-v24.json',
            resultsFile: null,
            active: false,
            legacy: true
        },
        v2: {
            id: 'v2',
            versionKey: 'v28',
            displayName: 'Ver 2',
            questionVersion: 'crewart-tendency-v28.0-pasamo-ultimate',
            resultsVersion: 'crewart-results-v28.0-pasamo-ultimate',
            questionsFile: 'crewart-survey-questions-v28.json',
            resultsFile: 'crewart-survey-results-v28.json',
            active: true,
            legacy: false
        }
    };

    function getSurveyVersion(keyOrId) {
        if (!keyOrId) return SURVEY_VERSION_REGISTRY.v2;
        const normalized = String(keyOrId).trim().toLowerCase();
        if (SURVEY_VERSION_REGISTRY[normalized]) return SURVEY_VERSION_REGISTRY[normalized];
        for (const reg of Object.values(SURVEY_VERSION_REGISTRY)) {
            if (reg.versionKey.toLowerCase() === normalized || reg.id.toLowerCase() === normalized || reg.questionVersion.toLowerCase() === normalized) {
                return reg;
            }
        }
        return SURVEY_VERSION_REGISTRY.v2;
    }

    let AXIS_SCORE_TOTAL = 15;
    let PRIMARY_SIGNAL_POINTS = 3;
    let SECONDARY_SIGNAL_POINTS = 2;
    const MIN_RESPONSE_MS = 3000;
    const MAX_RESPONSE_MS = 90000;
    const AXES = ['EI', 'SN', 'TF', 'JP'];
    const HOUSE_KEYS = ['SF', 'ST', 'NT', 'NF'];
    const MBTI_TYPES = [
        'ISTJ', 'ISFJ', 'INFJ', 'INTJ',
        'ISTP', 'ISFP', 'INFP', 'INTP',
        'ESTP', 'ESFP', 'ENFP', 'ENTP',
        'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'
    ];

    // This inline set remains only as a compatibility fallback. The deployed v24
    // questionnaire and its graded, single-axis signals load from the JSON spec below.
    const QUESTIONS = [
        { id: 'Q01', axis: 'TF', secondaryAxis: 'JP', facet: 'selection', label: '두 개체 중 하나를 고를 때', q: '둘 중 하나를 정하기 위해 마지막으로 하는 일은?', options: ['두 개체 사진을 한 화면에 놓고 본다', '한 마리씩 따로 다시 살펴본다', '잠깐 다른 곳을 본 뒤 다시 돌아온다', '각각 마음에 드는 점을 하나씩 짚어본다'], scores: ['T', 'T', 'F', 'F'], scorePairs: [['T', 'J'], ['T', 'P'], ['F', 'P'], ['F', 'J']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] },
        { id: 'Q02', axis: 'JP', secondaryAxis: 'EI', facet: 'orientation', label: '찾던 부스가 보이지 않을 때', q: '먼저 어떻게 할까?', options: ['안내 요원에게 위치를 묻는다', '온라인 지도를 다시 확인한다', '주변 부스를 보며 근처부터 찾아본다', '다음에 볼 부스로 갔다가 나중에 돌아온다'], scores: ['J', 'J', 'P', 'P'], scorePairs: [['J', 'E'], ['J', 'I'], ['P', 'E'], ['P', 'I']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] },
        { id: 'Q03', axis: 'TF', secondaryAxis: 'JP', facet: 'shortlist', label: '후보 세 개를 하나로 줄일 때', q: '세 후보를 하나로 줄이는 방식은?', options: ['세 글을 나란히 띄워 한꺼번에 본다', '가장 기억에 남는 후보를 기준으로 비교한다', '가장 덜 끌리는 후보 하나를 먼저 뺀다', '두 개씩 짝지어 비교해 마지막 둘을 남긴다'], scores: ['T', 'F', 'F', 'T'], scorePairs: [['T', 'P'], ['F', 'J'], ['F', 'P'], ['T', 'J']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] },
        { id: 'Q04', axis: 'EI', secondaryAxis: 'SN', facet: 'storytelling', label: '행사를 설명할 때', q: '나는 어떻게 이야기를 시작할까?', options: ['가장 기억나는 한 마리부터 이야기한다', '찍어둔 사진 한 장부터 보여준다', '마지막까지 고민했던 두 마리를 비교한다', '행사 전체 분위기부터 설명한다'], scores: ['I', 'E', 'I', 'E'], scorePairs: [['I', 'S'], ['E', 'S'], ['I', 'N'], ['E', 'N']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] },
        { id: 'Q05', axis: 'SN', secondaryAxis: 'TF', facet: 'naming', label: '이름 후보가 둘 남았을 때', q: '마지막 결정은 어떻게 할까?', options: ['사진을 보며 이름을 각각 소리 내어 부른다', '사진 아래에 두 이름을 번갈아 써본다', '두 이름에서 나올 별명을 각각 떠올린다', '가까운 사람에게 두 이름을 들려주고 반응을 본다'], scores: ['S', 'S', 'N', 'N'], scorePairs: [['S', 'F'], ['S', 'T'], ['N', 'T'], ['N', 'F']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] },
        { id: 'Q06', axis: 'SN', secondaryAxis: 'TF', facet: 'concept', label: '두 가지 콘셉트를 비교할 때', q: '처음 비교하는 방식은?', options: ['두 이미지를 번갈아 전체로 본다', '같은 위치의 소품끼리 비교한다', '내 공간에 놓인 모습을 각각 떠올린다', '각 이미지에서 마음에 드는 부분을 하나씩 찾는다'], scores: ['N', 'S', 'N', 'S'], scorePairs: [['N', 'F'], ['S', 'T'], ['N', 'T'], ['S', 'F']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] },
        { id: 'Q07', axis: 'JP', secondaryAxis: 'EI', facet: 'free-time', label: '행사에서 시간이 남았을 때', q: '남은 시간을 어떻게 쓸까?', options: ['가장 기억나는 부스에 다시 간다', '아직 자세히 안 본 구역을 둘러본다', '잠깐 앉아서 찍은 사진을 확인한다', '같이 간 사람과 한 곳을 정해 다시 간다'], scores: ['J', 'P', 'P', 'J'], scorePairs: [['J', 'I'], ['P', 'E'], ['P', 'I'], ['J', 'E']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] },
        { id: 'Q08', axis: 'JP', secondaryAxis: 'SN', facet: 'sorting', label: '행사 사진을 정리할 때', q: '처음 정리하는 방식은?', options: ['촬영 순서를 유지한 채 정리한다', '부스별로 묶을 폴더부터 만든다', '눈에 띄는 사진부터 표시해둔다', '전체를 훑으며 비슷한 사진끼리 묶는다'], scores: ['J', 'J', 'P', 'P'], scorePairs: [['J', 'S'], ['J', 'N'], ['P', 'S'], ['P', 'N']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] },
        { id: 'Q09', axis: 'EI', secondaryAxis: 'SN', facet: 'incoming-photos', label: '사진 여러 장을 채팅으로 받았을 때', q: '사진을 처음 확인할 때 나는?', options: ['전체 썸네일을 훑고 눈에 띈 사진에 바로 반응한다', '받은 순서대로 본 뒤 한 번에 답한다', '비슷한 사진을 비교한 뒤 궁금한 점을 묻는다', '가장 인상적인 사진을 저장해두고 나중에 다시 본다'], scores: ['E', 'I', 'E', 'I'], scorePairs: [['E', 'N'], ['I', 'S'], ['E', 'S'], ['I', 'N']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] },
        { id: 'Q10', axis: 'TF', secondaryAxis: 'EI', facet: 'explaining', label: '처음 가는 친구에게 설명할 때', q: '나는 어떻게 답하기 시작할까?', options: ['무엇을 기대하는지 먼저 물어본다', '재미있었는지 결론부터 말해준다', '행사에서 찍은 사진 두 장을 보여준다', '기억에 남는 장면 하나를 이야기한다'], scores: ['T', 'T', 'F', 'F'], scorePairs: [['T', 'E'], ['T', 'I'], ['F', 'E'], ['F', 'I']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] },
        { id: 'Q11', axis: 'EI', secondaryAxis: 'JP', facet: 'rejoining', label: '친구와 다시 합류했을 때', q: '다시 만난 뒤 먼저 하는 행동은?', options: ['서로 가장 기억나는 부스를 말하고 한 곳을 정한다', '서로 찍은 사진을 보며 다음에 볼 곳을 고른다', '내가 찍은 사진을 훑고 다시 볼 한 곳을 정한다', '각자 조금 더 둘러본 뒤 다시 만나자고 한다'], scores: ['E', 'E', 'I', 'I'], scorePairs: [['E', 'J'], ['E', 'P'], ['I', 'J'], ['I', 'P']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] },
        { id: 'Q12', axis: 'SN', secondaryAxis: 'TF', facet: 'name-card', label: '이름표 시안 중 하나를 고를 때', q: '두 시안을 처음 비교하는 방식은?', options: ['글자 크기와 사진 배치의 차이를 본다', '매일 볼 때 어느 쪽이 더 마음에 들지 본다', '사육장 전체 분위기와 어떻게 이어질지 본다', '나중에 사진이나 장식을 바꿔도 어울릴지 본다'], scores: ['S', 'S', 'N', 'N'], scorePairs: [['S', 'T'], ['S', 'F'], ['N', 'F'], ['N', 'T']], scoreWeights: [[3, 2], [3, 2], [3, 2], [3, 2]] }
    ];

    let QUESTIONNAIRE_FILE = 'crewart-survey-questions-v28.json';

    const DEFAULT_QUESTIONS_SPEC_V28 = {
  "version": "crewart-tendency-v28.0-pasamo-ultimate",
  "title": "크레와트 성향 테스트 — Pasamo Ultimate Edition (v28.0)",
  "editorGuide": {
    "rule": "P0 psychometric invariants strictly enforced: question text length between 75 and 115 characters, option text length between 23 and 38 characters. Required keeper context keywords included."
  },
  "scoring": {
    "method": "graded_forced_choice",
    "strongSignalPoints": 3,
    "supportingSignalPoints": 1,
    "primaryQuestionsPerAxis": 3,
    "secondaryQuestionsPerAxis": 3,
    "displayScoresToUser": false
  },
  "axisReference": {
    "EI": "에너지 충전과 소통 스타일 (외향 vs 내향)",
    "SN": "개체 관찰과 유전 판단 방식 (감각 vs 직관)",
    "TF": "분양·입양 및 선택 결정의 기준 (사고 vs 감정)",
    "JP": "사육장 관리와 탐방 일정 운영 (판단 vs 인식)"
  },
  "questions": [
    {
      "id": "Q01",
      "axis": "TF",
      "secondaryAxis": "JP",
      "label": "마감 직전 경매 개체 선택",
      "q": "밴드 경매 마감 10초 전! 찜해둔 두 아이 중 딱 하나만 입찰한다면?",
      "options": [
        "부모 혈통이랑 모프 정보부터 냉정하게 따져본다",
        "지금 체중이랑 밥 잘 먹는지 건강 상태부터 체크한다",
        "파업 사진 다시 보며 처음 심장 뛰었던 아이로 직진!",
        "지금 놓치면 며칠 동안 눈에 밟힐 원픽에 올인한다"
      ],
      "optionScores": [
        {
          "T": 3,
          "F": 0,
          "J": 1,
          "P": 0
        },
        {
          "T": 2,
          "F": 1,
          "J": 1,
          "P": 0
        },
        {
          "T": 1,
          "F": 2,
          "J": 0,
          "P": 1
        },
        {
          "T": 0,
          "F": 3,
          "J": 0,
          "P": 1
        }
      ],
      "scorePairs": [
        [
          "T",
          "J"
        ],
        [
          "T",
          "J"
        ],
        [
          "F",
          "P"
        ],
        [
          "F",
          "P"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q01-O1",
        "Q01-O2",
        "Q01-O3",
        "Q01-O4"
      ]
    },
    {
      "id": "Q02",
      "axis": "JP",
      "secondaryAxis": "EI",
      "label": "파충류 박람회 추천 부스 탐방",
      "q": "파충류 박람회장 도착! 찜해둔 부스로 가는데 입구에 줄이 늘어섰다면?",
      "options": [
        "원래 계획대로 돌되 동선 중간에 잠깐 들러본다",
        "계획했던 부스부터 싹 다 보고 시간 남으면 가본다",
        "헐 금방 분양가겠다! 일단 나도 줄부터 서러 달려간다",
        "줄 설 생각 없이 발길 닿는 대로 편하게 구경한다"
      ],
      "optionScores": [
        {
          "J": 3,
          "P": 0,
          "E": 1,
          "I": 0
        },
        {
          "J": 2,
          "P": 1,
          "E": 0,
          "I": 1
        },
        {
          "J": 1,
          "P": 2,
          "E": 1,
          "I": 0
        },
        {
          "J": 0,
          "P": 3,
          "E": 0,
          "I": 1
        }
      ],
      "scorePairs": [
        [
          "J",
          "E"
        ],
        [
          "J",
          "I"
        ],
        [
          "P",
          "E"
        ],
        [
          "P",
          "I"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q02-O1",
        "Q02-O2",
        "Q02-O3",
        "Q02-O4"
      ]
    },
    {
      "id": "Q03",
      "axis": "TF",
      "secondaryAxis": "JP",
      "label": "성장 기록 자랑글과 사진 선택",
      "q": "폭풍 성장한 아이의 성장 기록을 올릴 때, 썸네일로 고를 인생샷은?",
      "options": [
        "등 핀이랑 옆구리 발색이 완벽하게 나온 고화질 샷",
        "아기 때 쪼꼬미 시절 vs 지금 뚱크레 체중 비교 샷",
        "손 위에서 똘망똘망 눈 마주쳐주는 심쿵 교감 샷",
        "유리벽에 찰떡처럼 엉뚱하게 붙어있는 귀여운 엽사 샷"
      ],
      "optionScores": [
        {
          "T": 3,
          "F": 0,
          "J": 1,
          "P": 0
        },
        {
          "T": 2,
          "F": 1,
          "J": 1,
          "P": 0
        },
        {
          "T": 1,
          "F": 2,
          "J": 0,
          "P": 1
        },
        {
          "T": 0,
          "F": 3,
          "J": 0,
          "P": 1
        }
      ],
      "scorePairs": [
        [
          "T",
          "J"
        ],
        [
          "T",
          "J"
        ],
        [
          "F",
          "P"
        ],
        [
          "F",
          "P"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q03-O1",
        "Q03-O2",
        "Q03-O3",
        "Q03-O4"
      ]
    },
    {
      "id": "Q04",
      "axis": "EI",
      "secondaryAxis": "SN",
      "label": "새 사육장 세팅과 첫 입주",
      "q": "새 사육장 예쁘게 세팅하고 아이를 첫 입주시켰을 때, 내 모습은?",
      "options": [
        "단체방에 세팅 사진 올리고 집사들과 사육 꿀팁 나누기",
        "친한 집사에게 카톡 보내며 앞으로 키울 계획 나누기",
        "사육장 앞에서 백업에 잘 적응하는지 가만히 지켜보기",
        "방 불 끄고 무드등 아래서 편안해하는 아이 멍하니 보기"
      ],
      "optionScores": [
        {
          "E": 3,
          "I": 0,
          "S": 1,
          "N": 0
        },
        {
          "E": 2,
          "I": 1,
          "S": 1,
          "N": 0
        },
        {
          "E": 1,
          "I": 2,
          "S": 0,
          "N": 1
        },
        {
          "E": 0,
          "I": 3,
          "S": 0,
          "N": 1
        }
      ],
      "scorePairs": [
        [
          "E",
          "S"
        ],
        [
          "E",
          "S"
        ],
        [
          "I",
          "N"
        ],
        [
          "I",
          "N"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q04-O1",
        "Q04-O2",
        "Q04-O3",
        "Q04-O4"
      ]
    },
    {
      "id": "Q05",
      "axis": "SN",
      "secondaryAxis": "TF",
      "label": "새로운 해칭 개체 실물 확인",
      "q": "기다리던 알에서 드디어 첫 해칭! 갓 나온 꼬물이의 어디를 먼저 볼까?",
      "options": [
        "등 핀 굵기랑 발색이 얼마나 잘 빠졌는지 살펴본다",
        "난황은 깔끔하게 뗐는지, 튼튼하고 건강한지 확인한다",
        "다 자랐을 때 얼마나 멋진 성체가 될지 상상해본다",
        "작은 몸으로 세상에 나와준 게 너무 기특해서 뭉클"
      ],
      "optionScores": [
        {
          "S": 3,
          "N": 0,
          "T": 1,
          "F": 0
        },
        {
          "S": 2,
          "N": 1,
          "T": 1,
          "F": 0
        },
        {
          "S": 1,
          "N": 2,
          "T": 0,
          "F": 1
        },
        {
          "S": 0,
          "N": 3,
          "T": 0,
          "F": 1
        }
      ],
      "scorePairs": [
        [
          "S",
          "T"
        ],
        [
          "S",
          "T"
        ],
        [
          "N",
          "F"
        ],
        [
          "N",
          "F"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q05-O1",
        "Q05-O2",
        "Q05-O3",
        "Q05-O4"
      ]
    },
    {
      "id": "Q06",
      "axis": "SN",
      "secondaryAxis": "TF",
      "label": "차세대 라인업 조합 구상",
      "q": "다음 시즌 사육실에서 새로운 메이팅 조합을 짤 때 내 첫 번째 기준은?",
      "options": [
        "산란 주기, 해칭 성공률 같은 검증된 번식 기록 데이터",
        "부모 개체들의 실제 핀 형상과 발색 퀄리티 직접 대조",
        "새로운 모프 조합이 터졌을 때 나올 역대급 비주얼 상상",
        "내 취향과 사육 철학이 듬뿍 담긴 나만의 시그니처 라인"
      ],
      "optionScores": [
        {
          "S": 3,
          "N": 0,
          "T": 1,
          "F": 0
        },
        {
          "S": 2,
          "N": 1,
          "T": 1,
          "F": 0
        },
        {
          "S": 1,
          "N": 2,
          "T": 0,
          "F": 1
        },
        {
          "S": 0,
          "N": 3,
          "T": 0,
          "F": 1
        }
      ],
      "scorePairs": [
        [
          "S",
          "T"
        ],
        [
          "S",
          "T"
        ],
        [
          "N",
          "F"
        ],
        [
          "N",
          "F"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q06-O1",
        "Q06-O2",
        "Q06-O3",
        "Q06-O4"
      ]
    },
    {
      "id": "Q07",
      "axis": "JP",
      "secondaryAxis": "EI",
      "label": "파충류 박람회 마감 직전 일정",
      "q": "파충류 박람회 폐장 30분 전! 남은 시간 동안 나는 어떻게 보낼까?",
      "options": [
        "계획했던 마지막 부스까지 시간 맞춰 싹 돌고 깔끔 퇴장",
        "마음에 담아둔 아이들 분양가랑 퀄리티 최종 비교해보기",
        "안 가본 부스 돌면서 막판 뽑기랑 현장 이벤트 챙기기",
        "여유롭게 돌아다니며 마감 시간대 북적이는 열기 즐기기"
      ],
      "optionScores": [
        {
          "J": 3,
          "P": 0,
          "E": 1,
          "I": 0
        },
        {
          "J": 2,
          "P": 1,
          "E": 0,
          "I": 1
        },
        {
          "J": 1,
          "P": 2,
          "E": 1,
          "I": 0
        },
        {
          "J": 0,
          "P": 3,
          "E": 0,
          "I": 1
        }
      ],
      "scorePairs": [
        [
          "J",
          "E"
        ],
        [
          "J",
          "I"
        ],
        [
          "P",
          "E"
        ],
        [
          "P",
          "I"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q07-O1",
        "Q07-O2",
        "Q07-O3",
        "Q07-O4"
      ]
    },
    {
      "id": "Q08",
      "axis": "JP",
      "secondaryAxis": "SN",
      "label": "스마트폰 사진과 사육 팁 정리",
      "q": "폰 용량이 꽉 찰 정도로 쌓인 크레 사진과 사육 팁, 내 정리 스타일은?",
      "options": [
        "아이별 폴더 만들어서 날짜·체중순으로 칼같이 정리",
        "핵심 사육 팁이랑 유전 정보만 따로 모아 앨범화하기",
        "파업 인생샷 위주로 즐겨찾기(하트) 꾹꾹 눌러두기",
        "정리 없이 그냥 그때그때 눈에 띄는 귀여운 사진 모으기"
      ],
      "optionScores": [
        {
          "J": 3,
          "P": 0,
          "S": 1,
          "N": 0
        },
        {
          "J": 2,
          "P": 1,
          "S": 0,
          "N": 1
        },
        {
          "J": 1,
          "P": 2,
          "S": 1,
          "N": 0
        },
        {
          "J": 0,
          "P": 3,
          "S": 0,
          "N": 1
        }
      ],
      "scorePairs": [
        [
          "J",
          "S"
        ],
        [
          "J",
          "N"
        ],
        [
          "P",
          "S"
        ],
        [
          "P",
          "N"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q08-O1",
        "Q08-O2",
        "Q08-O3",
        "Q08-O4"
      ]
    },
    {
      "id": "Q09",
      "axis": "EI",
      "secondaryAxis": "SN",
      "label": "집사 모임 오프라인 대화",
      "q": "집사 모임이나 뒤풀이 테이블에서 크레 수다가 터졌을 때 내 모습은?",
      "options": [
        "\"요즘 이 모프 핫하잖아요!\" 화제 꺼내며 대화 주도하기",
        "\"헐 대박 진짜요?!\" 폭풍 맞장구치며 분위기 띄우기",
        "다른 집사님들의 생생한 사육 경험담 조용히 경청하기",
        "조용히 듣다가 궁금했던 유전 질문이나 생각 툭 던지기"
      ],
      "optionScores": [
        {
          "E": 3,
          "I": 0,
          "S": 1,
          "N": 0
        },
        {
          "E": 2,
          "I": 1,
          "S": 0,
          "N": 1
        },
        {
          "E": 1,
          "I": 2,
          "S": 1,
          "N": 0
        },
        {
          "E": 0,
          "I": 3,
          "S": 0,
          "N": 1
        }
      ],
      "scorePairs": [
        [
          "E",
          "S"
        ],
        [
          "E",
          "N"
        ],
        [
          "I",
          "S"
        ],
        [
          "I",
          "N"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q09-O1",
        "Q09-O2",
        "Q09-O3",
        "Q09-O4"
      ]
    },
    {
      "id": "Q10",
      "axis": "TF",
      "secondaryAxis": "EI",
      "label": "동료 집사의 입양 고민 상담",
      "q": "친한 집사가 사진 2장을 보내며 \"둘 중 누가 나아?\" 묻는다면?",
      "options": [
        "\"핀이랑 발색 대비 분양가 보면 이쪽이 훨씬 괜찮네\"",
        "\"부모 혈통이랑 현재 체중, 건강 상태 꼼꼼히 따져봐\"",
        "\"그래서 네 심장이 먼저 쿵쿵 뛴 애는 누구야?!\"",
        "\"어떤 아이든 네 가족이 되면 최고의 도마뱀이 될 거야\""
      ],
      "optionScores": [
        {
          "T": 3,
          "F": 0,
          "E": 1,
          "I": 0
        },
        {
          "T": 2,
          "F": 1,
          "E": 0,
          "I": 1
        },
        {
          "T": 1,
          "F": 2,
          "E": 1,
          "I": 0
        },
        {
          "T": 0,
          "F": 3,
          "E": 0,
          "I": 1
        }
      ],
      "scorePairs": [
        [
          "T",
          "E"
        ],
        [
          "T",
          "I"
        ],
        [
          "F",
          "E"
        ],
        [
          "F",
          "I"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q10-O1",
        "Q10-O2",
        "Q10-O3",
        "Q10-O4"
      ]
    },
    {
      "id": "Q11",
      "axis": "EI",
      "secondaryAxis": "JP",
      "label": "사육장 청소 후 심야 힐링",
      "q": "청소와 슈푸 급여까지 무사히 마친 늦은 밤, 나만의 힐링 시간은?",
      "options": [
        "단체방이나 SNS에 인증샷 올리고 사람들과 수다 떨기",
        "커뮤니티 인기글이나 재밌는 숏폼 보며 댓글 달기",
        "방 불 끄고 잔잔한 음악 틀어놓고 조용히 멍때리기",
        "아늑한 침대에 누워서 넷플릭스나 유튜브 보며 뒹굴거리기"
      ],
      "optionScores": [
        {
          "E": 3,
          "I": 0,
          "J": 1,
          "P": 0
        },
        {
          "E": 2,
          "I": 1,
          "J": 0,
          "P": 1
        },
        {
          "E": 1,
          "I": 2,
          "J": 1,
          "P": 0
        },
        {
          "E": 0,
          "I": 3,
          "J": 0,
          "P": 1
        }
      ],
      "scorePairs": [
        [
          "E",
          "J"
        ],
        [
          "E",
          "P"
        ],
        [
          "I",
          "J"
        ],
        [
          "I",
          "P"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q11-O1",
        "Q11-O2",
        "Q11-O3",
        "Q11-O4"
      ]
    },
    {
      "id": "Q12",
      "axis": "SN",
      "secondaryAxis": "TF",
      "label": "사육장 야간 활동 관찰",
      "q": "불 꺼진 밤, 사육장 안에서 신나게 벽 타고 활보하는 아이를 볼 때 내 시선은?",
      "options": [
        "백업이랑 벽면을 오가는 점프력과 움직임을 관찰한다",
        "다리를 절거나 탈피 껍질 남은 곳은 없는지 체크한다",
        "낮과 달리 밤에 살아나는 야생의 카리스마에 몰입한다",
        "어두운 밤에 혼자 뽈뽈거리는 게 너무 귀엽고 힐링된다"
      ],
      "optionScores": [
        {
          "S": 3,
          "N": 0,
          "T": 1,
          "F": 0
        },
        {
          "S": 2,
          "N": 1,
          "T": 1,
          "F": 0
        },
        {
          "S": 1,
          "N": 2,
          "T": 0,
          "F": 1
        },
        {
          "S": 0,
          "N": 3,
          "T": 0,
          "F": 1
        }
      ],
      "scorePairs": [
        [
          "S",
          "T"
        ],
        [
          "S",
          "T"
        ],
        [
          "N",
          "F"
        ],
        [
          "N",
          "F"
        ]
      ],
      "scoreWeights": [
        [
          3,
          1
        ],
        [
          2,
          1
        ],
        [
          2,
          1
        ],
        [
          3,
          1
        ]
      ],
      "optionIds": [
        "Q12-O1",
        "Q12-O2",
        "Q12-O3",
        "Q12-O4"
      ]
    }
  ]
};

    let questionnaireSpec = null;

    function normalizeQuestionnaireSpec(spec) {
        if (!spec || !Array.isArray(spec.questions) || !spec.questions.length) {
            throw new Error('Questionnaire spec must contain a non-empty questions array.');
        }
        const scoring = spec.scoring || {};
        const primaryPoints = Number(scoring.strongSignalPoints) || PRIMARY_SIGNAL_POINTS;
        const secondaryPoints = Number(scoring.supportingSignalPoints) || SECONDARY_SIGNAL_POINTS;
        const questions = spec.questions.map((question, index) => {
            if (!question.id || !question.axis || !question.secondaryAxis
                || !AXES.includes(question.axis) || !AXES.includes(question.secondaryAxis)
                || question.axis === question.secondaryAxis
                || !Array.isArray(question.options) || question.options.length !== 4) {
                throw new Error(`Invalid questionnaire item at index ${index}.`);
            }
            const allowedLetters = [...question.axis, ...question.secondaryAxis];
            let optionScores;
            if (Array.isArray(question.optionScores)) {
                optionScores = question.optionScores.map((rawScore, choiceIndex) => {
                    const score = Object.fromEntries(allowedLetters.map(letter => [letter, Number(rawScore?.[letter])]));
                    if (Object.values(score).some(points => !Number.isInteger(points) || points < 0)
                        || score[question.axis[0]] + score[question.axis[1]] !== primaryPoints
                        || score[question.secondaryAxis[0]] + score[question.secondaryAxis[1]] !== secondaryPoints) {
                        throw new Error(`Invalid option score at question ${question.id}, choice ${choiceIndex + 1}.`);
                    }
                    return score;
                });
            } else {
                const optionCriteria = Array.isArray(question.optionCriteria)
                    ? question.optionCriteria
                    : question.scorePairs;
                const legacyPairs = Array.isArray(optionCriteria)
                    ? optionCriteria.map(criteria => {
                        if (Array.isArray(criteria)) return criteria.slice(0, 2);
                        return [criteria?.[question.axis], criteria?.[question.secondaryAxis]];
                    })
                    : [];
                const legacyWeights = (question.optionWeights || question.scoreWeights || [])
                    .map(weight => Array.isArray(weight) ? weight.slice(0, 2).map(Number) : [primaryPoints, secondaryPoints]);
                if (legacyPairs.length !== 4 || legacyWeights.length !== 4
                    || legacyPairs.some(pair => pair.length !== 2 || !pair[0] || !pair[1])) {
                    throw new Error(`Invalid legacy questionnaire item at index ${index}.`);
                }
                optionScores = legacyPairs.map((pair, choiceIndex) => {
                    const score = Object.fromEntries(allowedLetters.map(letter => [letter, 0]));
                    score[pair[0]] += legacyWeights[choiceIndex][0];
                    score[pair[1]] += legacyWeights[choiceIndex][1];
                    return score;
                });
            }
            if (optionScores.length !== 4) throw new Error(`Question ${question.id} must contain four option scores.`);
            const dominantLetter = (axis, score) => (
                score[axis[0]] === score[axis[1]] ? '' : score[axis[0]] > score[axis[1]] ? axis[0] : axis[1]
            );
            const scorePairs = optionScores.map(score => [
                dominantLetter(question.axis, score),
                dominantLetter(question.secondaryAxis, score)
            ].filter(Boolean));
            const optionIds = Array.isArray(question.optionIds) && question.optionIds.length === 4
                ? question.optionIds.map(String)
                : question.options.map((_, choiceIndex) => `${question.id}-${choiceIndex + 1}`);
            if (new Set(optionIds).size !== 4) throw new Error(`Question ${question.id} option ids must be unique.`);
            return {
                ...question,
                options: question.options.slice(),
                optionIds,
                optionScores,
                scores: scorePairs.map(pair => pair[0]),
                scorePairs,
                scoreWeights: scorePairs.map((pair, choiceIndex) => pair.map(letter => optionScores[choiceIndex][letter]))
            };
        });
        const ids = new Set(questions.map(question => question.id));
        if (ids.size !== questions.length) throw new Error('Questionnaire item ids must be unique.');
        return {
            version: String(spec.version || SURVEY_VERSION),
            scoring,
            questions
        };
    }

    function applyQuestionnaireSpec(spec) {
        const normalized = normalizeQuestionnaireSpec(spec);
        questionnaireSpec = normalized;
        SURVEY_VERSION = normalized.version;
        PRIMARY_SIGNAL_POINTS = Number(normalized.scoring.strongSignalPoints) || PRIMARY_SIGNAL_POINTS;
        SECONDARY_SIGNAL_POINTS = Number(normalized.scoring.supportingSignalPoints) || SECONDARY_SIGNAL_POINTS;
        AXIS_SCORE_TOTAL = (Number(normalized.scoring.primaryQuestionsPerAxis) || 3) * PRIMARY_SIGNAL_POINTS
            + (Number(normalized.scoring.secondaryQuestionsPerAxis) || 3) * SECONDARY_SIGNAL_POINTS;
        QUESTIONS.splice(0, QUESTIONS.length, ...normalized.questions);
        return normalized;
    }

    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });

    if (typeof module === 'object' && module.exports && typeof require === 'function') {
        try {
            applyQuestionnaireSpec(require(`./${QUESTIONNAIRE_FILE}`));
            readyResolve();
        } catch (error) {
            readyReject(error);
        }
    } else if (typeof fetch === 'function' && typeof document !== 'undefined') {
        const url = new URL(QUESTIONNAIRE_FILE, document.baseURI).href;
        fetch(url, { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error(`Questionnaire fetch failed: ${response.status}`);
                return response.json();
            })
            .then(spec => { applyQuestionnaireSpec(spec); readyResolve(); })
            .catch(error => {
                console.warn('[Core.ready] Fetch failed, applying embedded v28 fallback spec:', error);
                try {
                    applyQuestionnaireSpec(DEFAULT_QUESTIONS_SPEC_V28);
                } catch (_) { }
                readyResolve();
            });
    } else {
        readyResolve();
    }

    const AXIS_META = {
        EI: {
            title: '생각을 정리하는 방향',
            letters: {
                E: { short: '함께 나누며 정리', description: '사람들과 경험을 주고받을 때 판단이 더 선명해져요.' },
                I: { short: '혼자 관찰하며 정리', description: '조용히 관찰하고 기록을 비교할 때 판단이 더 선명해져요.' }
            }
        },
        SN: {
            title: '크레를 바라보는 시선',
            letters: {
                S: { short: '지금 보이는 정보', description: '현재 확인되는 컨디션과 구체적인 차이를 먼저 봐요.' },
                N: { short: '앞으로의 가능성', description: '성장 흐름과 아직 드러나지 않은 다음 모습을 먼저 그려요.' }
            }
        },
        TF: {
            title: '선택을 결정하는 기준',
            letters: {
                T: { short: '조건과 근거', description: '비교할 수 있는 조건과 이유가 분명할 때 확신해요.' },
                F: { short: '취향과 관계', description: '나와 잘 맞고 오래 마음이 가는지를 중요하게 봐요.' }
            }
        },
        JP: {
            title: '사육을 운영하는 방식',
            letters: {
                J: { short: '미리 정하고 준비', description: '순서와 기준을 먼저 정해 두면 마음이 편해요.' },
                P: { short: '보면서 유연하게 조정', description: '실제 반응을 확인하며 계획을 바꿀 때 자연스러워요.' }
            }
        }
    };

    const CHANGE_MESSAGES = {
        'E>I': '평소보다 크레 앞에서는 혼자 관찰하고 정리하는 시간이 길어져요.',
        'I>E': '평소보다 크레 앞에서는 사람과 경험을 나눌 때 판단이 빨라져요.',
        'S>N': '평소보다 크레 앞에서는 현재 모습보다 성장 흐름과 다음 가능성을 더 봐요.',
        'N>S': '평소보다 크레 앞에서는 가능성보다 지금 확인되는 상태를 더 꼼꼼히 봐요.',
        'T>F': '평소보다 크레를 고를 때 조건보다 취향과 오래 갈 마음을 더 믿어요.',
        'F>T': '평소보다 크레 앞에서는 마음만큼 비교할 수 있는 조건과 근거를 챙겨요.',
        'J>P': '평소보다 크레를 돌볼 때 실제 반응에 맞춰 계획을 유연하게 바꿔요.',
        'P>J': '평소보다 크레 앞에서는 기준과 순서를 미리 정해 두는 편이에요.'
    };

    const TYPE_NAMES = {
        ISTJ: '기록 설계자', ISFJ: '세심한 보호자', INFJ: '성장 관찰자', INTJ: '장기 설계자',
        ISTP: '현장 조율자', ISFP: '감각 돌봄형', INFP: '애착 발견자', INTP: '원리 탐구자',
        ESTP: '즉시 해결사', ESFP: '반응 공유자', ENFP: '가능성 발견자', ENTP: '실험 개척자',
        ESTJ: '루틴 운영자', ESFJ: '함께 돌보는 사람', ENFJ: '방향 연결자', ENTJ: '프로젝트 지휘자'
    };

    // The four teams use a single, immediately readable RGBY system everywhere.
    // Keys stay semantic so existing saved results and score aggregation remain compatible.
    const HOUSE_META = {
        SF: { name: 'RED', korean: '레드', color: 'RED', seal: 'R', accent: '#df5a4b' },
        ST: { name: 'GREEN', korean: '그린', color: 'GREEN', seal: 'G', accent: '#5f9667' },
        NT: { name: 'BLUE', korean: '블루', color: 'BLUE', seal: 'B', accent: '#4f7fc8' },
        NF: { name: 'YELLOW', korean: '옐로우', color: 'YELLOW', seal: 'Y', accent: '#d9a83e' }
    };

    function cloneQuestions() {
        return QUESTIONS.map(question => ({
            ...question,
            options: question.options.slice(),
            optionIds: question.optionIds?.slice(),
            optionScores: question.optionScores?.map(score => ({ ...score })),
            scores: question.scores.slice(),
            scorePairs: question.scorePairs?.map(pair => pair.slice()),
            scoreWeights: question.scoreWeights?.map(pair => pair.slice()),
            flipped: false
        }));
    }

    function randomInt(limit, rng) {
        return Math.floor((rng || Math.random)() * limit);
    }

    function shuffle(items, rng) {
        const result = items.slice();
        for (let index = result.length - 1; index > 0; index -= 1) {
            const target = randomInt(index + 1, rng);
            [result[index], result[target]] = [result[target], result[index]];
        }
        return result;
    }

    function prepareQuestions(rng) {
        const questions = cloneQuestions();
        const axesByFlipCount = shuffle(AXES, rng);
        axesByFlipCount.forEach((axis, axisIndex) => {
            const group = shuffle(questions.filter(question => question.axis === axis && !question.scorePairs), rng);
            const flipCount = axisIndex < 2 ? 3 : 2;
            group.slice(0, flipCount).forEach(question => {
                [question.options[0], question.options[1]] = [question.options[1], question.options[0]];
                [question.scores[0], question.scores[1]] = [question.scores[1], question.scores[0]];
                question.flipped = true;
            });
        });

        questions.filter(question => question.scorePairs).forEach(question => {
            const choices = shuffle(question.options.map((option, index) => ({
                option,
                optionId: question.optionIds?.[index],
                optionScore: question.optionScores?.[index],
                score: question.scores[index],
                pair: question.scorePairs[index],
                weight: question.scoreWeights?.[index]
            })), rng);
            question.options = choices.map(item => item.option);
            question.optionIds = choices.map(item => item.optionId);
            question.optionScores = choices.map(item => ({ ...item.optionScore }));
            question.scores = choices.map(item => item.score);
            question.scorePairs = choices.map(item => item.pair);
            question.scoreWeights = choices.map(item => item.weight);
        });

        let ordered = questions;
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const candidate = shuffle(questions, rng);
            const previewStartsFirst = !questions.some(question => question.scorePairs) || candidate[0]?.id === 'Q01';
            if (previewStartsFirst && candidate.every((question, index) => index === 0 || candidate[index - 1].axis !== question.axis)) {
                ordered = candidate;
                break;
            }
        }
        if (ordered === questions) {
            const remaining = questions.filter(question => question.id !== 'Q01');
            const first = questions.find(question => question.id === 'Q01');
            ordered = first ? [first] : [];
            while (remaining.length) {
                const previousAxis = ordered[ordered.length - 1]?.axis;
                let nextIndex = remaining.findIndex(question => question.axis !== previousAxis);
                if (nextIndex < 0) nextIndex = 0;
                ordered.push(remaining.splice(nextIndex, 1)[0]);
            }
        }
        return ordered;
    }

    function answerScoreMap(question, choice) {
        const configured = question?.optionScores?.[choice];
        if (configured && typeof configured === 'object') return { ...configured };
        const letters = Array.isArray(question?.scorePairs)
            ? question.scorePairs[choice] || []
            : [question?.scores?.[choice]].filter(Boolean);
        const weights = question?.scoreWeights?.[choice] || letters.map(() => 1);
        return Object.fromEntries(letters.map((letter, index) => [letter, Number(weights[index]) || 1]));
    }

    function answerLetters(question, choice) {
        const score = answerScoreMap(question, choice);
        return [question?.axis, question?.secondaryAxis].filter(Boolean).map(axis => {
            const left = Number(score[axis[0]]) || 0;
            const right = Number(score[axis[1]]) || 0;
            return left === right ? '' : left > right ? axis[0] : axis[1];
        }).filter(Boolean);
    }

    function answerSignals(question, choice) {
        return Object.entries(answerScoreMap(question, choice))
            .filter(([, points]) => Number(points) > 0)
            .map(([letter, points]) => ({ letter, points: Number(points) }));
    }

    function scoreAnswers(questions, answers) {
        const letters = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
        questions.forEach((question, index) => {
            answerSignals(question, answers[index]).forEach(signal => {
                if (signal.letter in letters) letters[signal.letter] += signal.points;
            });
        });
        const code = (letters.E > letters.I ? 'E' : 'I')
            + (letters.S > letters.N ? 'S' : 'N')
            + (letters.T > letters.F ? 'T' : 'F')
            + (letters.J > letters.P ? 'J' : 'P');

        const axes = AXES.map((axis, index) => {
            const dominant = code[index];
            const opposite = axis[0] === dominant ? axis[1] : axis[0];
            const diff = Math.abs(letters[dominant] - letters[opposite]);
            const confidence = diff / AXIS_SCORE_TOTAL;
            const confidenceLabel = diff <= 2
                ? `${dominant}에 조금 가까움`
                : `확실한 ${dominant} 성향`;
            return {
                axis,
                dominant,
                opposite,
                dominantCount: letters[dominant],
                oppositeCount: letters[opposite],
                confidence,
                confidenceLabel
            };
        });

        return { letters, code, axes, typeName: TYPE_NAMES[code] || '크레 집사' };
    }

    function buildMbtiComparison(knownType, creType) {
        if (!knownType || !MBTI_TYPES.includes(knownType)) return { knownType: '', creType, changes: [], sameCount: 0 };
        const changes = AXES.map((axis, index) => {
            if (knownType[index] === creType[index]) return null;
            const key = `${knownType[index]}>${creType[index]}`;
            return {
                axis,
                title: AXIS_META[axis].title,
                from: knownType[index],
                to: creType[index],
                message: CHANGE_MESSAGES[key]
            };
        }).filter(Boolean);
        return { knownType, creType, changes, sameCount: 4 - changes.length };
    }

    function median(values) {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function average(values) {
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    }

    function buildTimingStats(entries, questions) {
        const normalized = (entries || []).map((entry, index) => ({
            questionId: entry?.questionId || questions[index]?.id || '',
            axis: entry?.axis || questions[index]?.axis || '',
            elapsedMs: Math.round(Number(entry?.elapsedMs) || 0),
            valid: entry?.valid !== false
                && Number(entry?.elapsedMs) >= MIN_RESPONSE_MS
                && Number(entry?.elapsedMs) <= MAX_RESPONSE_MS
        }));
        const valid = normalized.filter(entry => entry.valid);
        const values = valid.map(entry => entry.elapsedMs);
        const axisMedians = {};
        AXES.forEach(axis => {
            axisMedians[axis] = Math.round(median(valid.filter(entry => entry.axis === axis).map(entry => entry.elapsedMs)));
        });
        const medianMs = Math.round(median(values));
        const style = medianMs < 2500
            ? { key: 'instinct', label: '빠른 직감형', copy: '첫 느낌을 빠르게 붙잡는 편이에요.' }
            : medianMs < 5000
                ? { key: 'balanced', label: '균형 판단형', copy: '직감과 확인 사이의 속도가 균형 잡혀 있어요.' }
                : { key: 'deliberate', label: '신중한 숙고형', copy: '한 번 더 비교한 뒤 선택하는 편이에요.' };
        return {
            entries: normalized,
            validCount: valid.length,
            totalMs: Math.round(values.reduce((sum, value) => sum + value, 0)),
            averageMs: Math.round(average(values)),
            medianMs,
            axisMedians,
            fastest: valid.slice().sort((a, b) => a.elapsedMs - b.elapsedMs)[0] || null,
            slowest: valid.slice().sort((a, b) => b.elapsedMs - a.elapsedMs)[0] || null,
            style
        };
    }

    function buildSpeedBenchmark(medianMs, sampleValues) {
        const samples = (sampleValues || []).map(Number)
            .filter(value => value >= MIN_RESPONSE_MS && value <= MAX_RESPONSE_MS);
        if (samples.length < 10) {
            return {
                ready: false,
                sampleSize: samples.length,
                needed: 10 - samples.length,
                badge: `기준 데이터 ${samples.length} / 10`,
                message: '초기 응답이 쌓이면 다른 참여자와 선택 속도를 비교해 드려요.'
            };
        }
        const sampleAverage = Math.round(average(samples));
        const deltaMs = Math.abs(medianMs - sampleAverage);
        const fasterCount = samples.filter(value => value < medianMs).length;
        const rank = fasterCount + 1;
        const topPercent = Math.min(100, Math.max(10, Math.ceil((rank / (samples.length + 1)) * 10) * 10));
        const isFaster = medianMs <= sampleAverage;
        return {
            ready: true,
            sampleSize: samples.length,
            sampleAverage,
            deltaMs,
            topPercent,
            badge: isFaster && topPercent <= 50 ? `빠른 응답 상위 ${topPercent}%` : `참여자 ${samples.length}명 기준`,
            message: deltaMs < 250
                ? '현재 참여자 평균과 거의 같은 속도로 골랐어요.'
                : `현재 참여자 평균보다 ${Math.max(0.1, deltaMs / 1000).toFixed(1)}초 ${isFaster ? '빠르게' : '천천히'} 골랐어요.`
        };
    }

    function loadQuestionnaireFile(questionsFile, resultsFile) {
        if (typeof fetch !== 'function' || typeof document === 'undefined') return Promise.resolve(null);
        const questionsUrl = new URL(questionsFile, document.baseURI).href;
        const fetchQuestions = fetch(questionsUrl, { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error(`Questions fetch failed: ${response.status}`);
                return response.json();
            })
            .catch(error => {
                console.warn('[loadQuestionnaireFile] Fallback to embedded spec:', error);
                return DEFAULT_QUESTIONS_SPEC_V28;
            });

        const fetchResults = resultsFile
            ? fetch(new URL(resultsFile, document.baseURI).href, { cache: 'no-store' })
                .then(response => response.ok ? response.json() : null)
                .catch(() => null)
            : Promise.resolve(null);

        return Promise.all([fetchQuestions, fetchResults]).then(([spec, resultsSpec]) => {
            if (resultsSpec && resultsSpec.results) {
                spec.results = resultsSpec;
            }
            return applyQuestionnaireSpec(spec);
        });
    }

    function loadQuestionnaireVersion(versionKey) {
        const reg = getSurveyVersion(versionKey);
        return loadQuestionnaireFile(reg.questionsFile, reg.resultsFile);
    }

    const DEFAULT_RESULTS_V28 = {
    "ISTJ": {
        "mbti": "ISTJ",
        "title": "온습도 0.1도 오차 불허! 적재형 엑셀 사육 집사",
        "subtitle": "온습도와 슈푸 피딩 주기를 철저하게 관리하는 데이터 마스터 집사",
        "summary": "사육장의 모든 적재형 케이지마다 개체 라벨과 엑셀 기록이 완벽히 정돈되어 있습니다. 감에 의존하기보다 검증된 사육 데이터와 철저한 피딩 루틴을 중요하게 여깁니다.",
        "traits": [
            "사육장 온습도 체크와 정기 슈푸 피딩 루틴을 매일 칼같이 지킴",
            "개체별 먹성, 0.1g 단위 체중, 해칭일을 엑셀에 꼼꼼히 기록함",
            "박람회 가기 전 부스 배치도와 목표 개체 리스트를 사전 작성해 탐방함",
            "충동 입양보다는 부모 개체의 유전력과 혈통 정보부터 꼼꼼히 따짐"
        ],
        "superpower": "철저한 온습도 케어로 개체의 탈피와 건강 컨디션을 안정적으로 관리하는 능력",
        "weakness": "0.1g 몸무게 변화나 슈푸 거식에 지나치게 신경 쓰며 밤잠을 설치기도 함",
        "bestMatch": {
            "mbti": "ESFP",
            "title": "24시간 꼬물이 짤 공유! 파사모 톡방 인싸 집사"
        },
        "worstMatch": {
            "mbti": "ENFP",
            "title": "신규 콤보 상상력 만렙! 기발한 모프 창작집사"
        },
        "actionItem": "엑셀 시트는 잠시 닫아두고, 오늘 밤엔 꼬물이 슈푸 먹방을 보며 힐링하세요!"
    },
    "ISFJ": {
        "mbti": "ISFJ",
        "title": "슈푸 묽기 달인! 꼬물이 맞춤 피딩 집사",
        "subtitle": "슈푸 농도를 세심하게 맞추고 한 마리 한 마리 챙기는 헌신형 집사",
        "summary": "사육장의 모든 아이들이 슈푸를 잘 받아먹고 건강하게 자라는 것이 최고의 보람입니다. 단톡방에서 조용하지만 초보 집사들의 거식 고민글에 따뜻한 피딩 노하우를 건네줍니다.",
        "traits": [
            "슈푸 농도를 개체 입맛에 맞게 개어주고 한 땀 한 땀 핸드피딩해줌",
            "판게아, 레파시 등 브랜드별 기호성을 파악해 맞춤 식단을 차려줌",
            "푸딩컵 시절 데려온 꼬물이가 폭풍 성장해 준성체가 되면 혼자 울컥함",
            "분양글을 올릴 때 아이의 식성과 성격, 케어 꿀팁을 장문으로 적어줌"
        ],
        "superpower": "거식 온 개체도 밥 먹게 만드는 정성 어린 맞춤 피딩과 케어 기술",
        "weakness": "모든 아이에게 정을 쏟다 보니 분양을 못 보내고 사육장이 금세 가득 참",
        "bestMatch": {
            "mbti": "ESTP",
            "title": "순발력 최강! 밴드 경매 입찰의 신"
        },
        "worstMatch": {
            "mbti": "ENTP",
            "title": "새 유전 가설 탐구! 열정 토론 연구원"
        },
        "actionItem": "남의 집 꼬물이 걱정은 잠시 내려놓고, 집사 본인의 든든한 야식부터 챙기세요!"
    },
    "INFJ": {
        "mbti": "INFJ",
        "title": "사진 한 장으로 성체 풀핀 퀄리티 알아보는 크레 관상가",
        "subtitle": "베이비 사진 한 장으로 성체 폼과 숨은 유전 핏을 꿰뚫어 보는 통찰 브리더",
        "summary": "조용히 지켜보다가도 갓 해칭한 베이비 사진만 보면 성체가 되었을 때 핀과 월이 어떻게 터질지 직관적으로 알아챕니다. 단순 분양을 넘어 깊이 있는 라인 브리딩의 비전을 품습니다.",
        "traits": [
            "사육방 불을 끄고 은은한 조명 아래 아이들의 힐링 멍 타임을 지켜봄",
            "베이비 시절 미세한 톤 차이와 도살 형질만 보고 미래 퀄리티를 예견함",
            "밴드 경매 마감 직전 묵묵히 나만의 원픽 개체에 결정적 입찰을 던짐",
            "진정성 있는 브리더와 밤새 모프 유전과 혈통 라인에 대해 대화하길 좋아함"
        ],
        "superpower": "해칭 베이비의 성장 잠재력과 성체 폼을 섬세하게 읽어내는 뛰어난 안목",
        "weakness": "생각을 신중하게 거듭하다가 첫눈에 반한 개체 입찰 타이밍을 놓치기도 함",
        "bestMatch": {
            "mbti": "ENFP",
            "title": "신규 콤보 상상력 만렙! 기발한 모프 창작집사"
        },
        "worstMatch": {
            "mbti": "ESTJ",
            "title": "철저한 루틴 실행! 박람회 탐방 총괄 매니저"
        },
        "actionItem": "너무 깊은 고민은 내려두고, 눈에 확 꽂힌 아이는 손가락이 먼저 입찰하게 두세요!"
    },
    "INTJ": {
        "mbti": "INTJ",
        "title": "5년 뒤 시장을 미리 설계하는 족보 타임머신",
        "subtitle": "수 세대 앞을 내다보는 유전 콤보 타임라인, 사육실의 전략가 브리더",
        "summary": "일시적 유행에 흔들리지 않고 3~5년 뒤 커뮤니티를 뒤흔들 나만의 시그니처 콤보 라인을 설계합니다. 완벽한 유전자 형질 고정을 위해 메이팅 데이터를 체계적으로 축적합니다.",
        "traits": [
            "사육 리듬을 일정하게 유지하며 아이들이 안정적으로 성장하게 케어함",
            "부모-자손 메이팅 차트를 구축해 모프 유전 확률과 콤보를 시뮬레이션함",
            "박람회 부스 방문 시 개체 형질의 유전 고정률과 혈통 데이터를 집요하게 확인함",
            "직접 설계한 메이팅 조합에서 목표했던 시그니처 형질이 딱 터졌을 때 전율을 느낌"
        ],
        "superpower": "시장의 트렌드를 한발 앞서 나가는 독창적인 시그니처 라인 구축력",
        "weakness": "나만의 유전 가설에 깊이 몰입하느라 주변 집사들의 피드백을 지나칠 수 있음",
        "bestMatch": {
            "mbti": "ENTP",
            "title": "새 유전 가설 탐구! 열정 토론 연구원"
        },
        "worstMatch": {
            "mbti": "ESFJ",
            "title": "초보 멘토! 밴드 경매 톡방 따뜻한 반장 집사"
        },
        "actionItem": "혼자 족보만 파지 말고, 단톡방에 입이 떡 벌어지는 해칭 인증샷도 자랑해 보세요!"
    },
    "ISTP": {
        "mbti": "ISTP",
        "title": "실전 맞춤 해결사! DIY 사육 장인",
        "subtitle": "사육장 커스텀부터 개체 스펙 팩트체크까지, 쿨한 현장형 집사",
        "summary": "기성 사육장이 성에 안 차면 아크릴 재단과 알루미늄 프로파일로 직접 사육장을 제작합니다. 장황한 감성보다 핀 수, 월 커버리지, 체중 데이터로 명확하게 팩트를 짚습니다.",
        "traits": [
            "사육장 자동 미스팅 분무기와 개별 환기 시스템을 직접 커스텀함",
            "백업과 코르크보드를 아이의 야간 점프 동선에 맞춰 완벽하게 배치함",
            "개체 퀄리티 문의를 받으면 군더더기 없이 객관적인 장단점만 팩트체크해 줌",
            "자율피딩이 안 되는 아이는 사육장 구조와 슈푸 농도를 즉각 유연하게 교체함"
        ],
        "superpower": "어떤 사육 환경 문제도 즉시 뜯어고쳐 해결하는 강력한 DIY 제작 기술",
        "weakness": "담백하게 팩트 위주로 직언하다가 초보 집사의 마음에 상처를 줄 수 있음",
        "bestMatch": {
            "mbti": "ESFJ",
            "title": "초보 멘토! 밴드 경매 톡방 따뜻한 반장 집사"
        },
        "worstMatch": {
            "mbti": "ENFJ",
            "title": "동반 성장 유도! 라인 브리딩 비전 리더"
        },
        "actionItem": "팩트를 전하기 전에 '아이 발색이 참 예쁘네요' 따뜻한 한마디를 먼저 건네보세요!"
    },
    "ISFP": {
        "mbti": "ISFP",
        "title": "조명·매크로 렌즈로 감성 화보 남기는 핀/월 아티스트",
        "subtitle": "조명과 매크로 렌즈로 개체 인생샷을 남기는 미학 중심의 힐링 집사",
        "summary": "개체의 발색이 선명하게 올라오는 파업 골든타임을 놓치지 않고 예술적인 인생샷을 남깁니다. 비바리움 세팅부터 감성 촬영까지 크레 사육을 시각적 예술로 즐깁니다.",
        "traits": [
            "꼬물이의 슈푸 먹방 혓바닥 샷과 앙증맞은 발가락 젤리를 보며 힐링함",
            "스마트폰 매크로 렌즈와 스튜디오 조명으로 화보급 사진을 찍느라 밤을 새움",
            "숫자 스펙에 연연하기보다 내 눈에 한눈에 예쁜 비주얼과 감성을 중시함",
            "박람회에 가도 부스를 뛰어다니기보다 마음에 꽂힌 개체 앞에서 한참을 멍때림"
        ],
        "superpower": "파사모와 인스타그램 집사들을 감탄하게 만드는 압도적 퀄리티의 크레 사진 촬영력",
        "weakness": "감성적인 비주얼에 반해 데려오다 보면 렉사 공간과 방이 금세 부족해짐",
        "bestMatch": {
            "mbti": "ESTJ",
            "title": "철저한 루틴 실행! 박람회 탐방 총괄 매니저"
        },
        "worstMatch": {
            "mbti": "ENTJ",
            "title": "대표 라인 구축! 목표 중심 브리딩 총괄 리더"
        },
        "actionItem": "감성 입양을 누르기 전에, 방안 적재형 케이지 놓을 공간부터 먼저 확인하세요!"
    },
    "INFP": {
        "mbti": "INFP",
        "title": "눈에 띄지 않던 꼬물이의 폭풍성장에 감동하는 낭만집사",
        "subtitle": "어릴 때 눈에 띄지 않던 베이비가 멋진 개체로 성장할 때 감동하는 낭만 브리더",
        "summary": "남들이 지나치던 평범한 베이비를 데려와 정성으로 키워내며 폭풍 성장의 기적을 볼 때 가장 행복합니다. 사육장의 모든 개체에게 이름을 지어주고 가족처럼 대합니다.",
        "traits": [
            "아이들마다 정성껏 이름을 붙여주고 매일 눈 맞추며 따뜻하게 보살핌",
            "아이가 밥을 남기면 슈푸 맛을 판게아 인섹트에서 바나나파파야로 정성껏 바꿔봄",
            "분양 보낸 아이가 새로운 집사님 댁에서 잘 지내는지 늘 마음으로 응원함",
            "파사모에 글을 쓸 때 긴 장문의 입양 일기와 뭉클한 성장 스토리를 담아냄"
        ],
        "superpower": "성장 잠재력을 가진 꼬물이를 끝까지 믿고 건강한 성체로 키워내는 깊은 애정",
        "weakness": "사소한 탈피나 거식에도 마음을 졸이며 과도하게 걱정하기 쉬움",
        "bestMatch": {
            "mbti": "ENFJ",
            "title": "동반 성장 유도! 라인 브리딩 비전 리더"
        },
        "worstMatch": {
            "mbti": "ESTP",
            "title": "순발력 최강! 밴드 경매 입찰의 신"
        },
        "actionItem": "너무 불안해하지 마세요. 집사님의 따뜻한 사랑 덕분에 아이는 잘 자라고 있습니다!"
    },
    "INTP": {
        "mbti": "INTP",
        "title": "해외 렙타일 포럼 번역하는 변종 콤보 가설 연구원",
        "subtitle": "해외 포럼과 모프 유전 가설을 파헤치는 사육실의 지식 탐구자 브리더",
        "summary": "남들이 단순 교배할 때 해외 렙타일 포럼과 유전 학술자료를 찾아보며 모프 발현 메커니즘을 파고듭니다. 새로운 유전 변이 가설을 세우고 사육실에서 직접 검증해 봅니다.",
        "traits": [
            "해외 자료를 바탕으로 칼슘 D3 함량과 피딩 영양 밸런스를 분석함",
            "신규 모프 콤보 소식이 들리면 부모 개체의 유전자형 조합부터 역추적함",
            "단톡방 질문에 단순 답변보다 다양한 유전적 가능성과 메커니즘을 설명해 줌",
            "자신만의 연구 노트에 모프 매핑과 세대별 표현형 확률을 꼼꼼히 기록함"
        ],
        "superpower": "남들이 보지 못하는 유전적 원리와 변이 콤보 가능성을 논리적으로 밝혀내는 분석력",
        "weakness": "이론 연구에 깊이 몰두하다가 정작 오늘 밤 꼬물이 피딩 시간을 놓치기도 함",
        "bestMatch": {
            "mbti": "INFJ",
            "title": "사진 한 장으로 성체 풀핀 퀄리티 알아보는 크레 관상가"
        },
        "worstMatch": {
            "mbti": "ESFJ",
            "title": "초보 멘토! 밴드 경매 톡방 따뜻한 반장 집사"
        },
        "actionItem": "연구 노트도 좋지만, 입 벌리고 밥 달라고 기다리는 꼬물이 슈푸부터 챙겨주세요!"
    },
    "ESTP": {
        "mbti": "ESTP",
        "title": "순발력 최강! 밴드 경매 입찰의 신",
        "subtitle": "마감 3초 전 빛의 속도로 입찰 버튼 누르는 순발력의 행동파 집사",
        "summary": "복잡하게 계산하기보다 직관적으로 기회가 보이면 빠르게 행동으로 옮깁니다. 밴드 경매 마감 직전 과감한 타이밍의 막타 입찰로 목표 개체를 손에 넣습니다.",
        "traits": [
            "활기찬 사육 일상을 즐기며 박람회 현장 이벤트와 럭키드로우에 적극 참여함",
            "경매 마감 직전까지 관망하다가 마지막 3초 카운트다운에 결정타를 날림",
            "박람회장에 도착하자마자 망설임 없이 전 부스를 빠르게 훑으며 득템을 노림",
            "개체 실물 퀄리티가 마음에 들면 현장에서 즉시 쿨거래 결정을 내림"
        ],
        "superpower": "망설임 없는 과감한 결단력과 순발력으로 최고의 개체를 선점하는 능력",
        "weakness": "순간의 짜릿한 손맛에 이끌려 입찰하다가 사육장 케이지가 순식간에 꽉 참",
        "bestMatch": {
            "mbti": "ISFJ",
            "title": "슈푸 묽기 달인! 꼬물이 맞춤 피딩 집사"
        },
        "worstMatch": {
            "mbti": "INFP",
            "title": "눈에 띄지 않던 꼬물이의 폭풍성장에 감동하는 낭만집사"
        },
        "actionItem": "입찰 버튼 누르기 전, 내 방 렉사에 남은 빈 방 개수부터 먼저 세어보세요!"
    },
    "ESFP": {
        "mbti": "ESFP",
        "title": "24시간 꼬물이 짤 공유! 파사모 톡방 인싸 집사",
        "subtitle": "귀여운 개체 영상과 먹방 짤로 단톡방 분위기를 띄우는 사육실 분위기 메이커",
        "summary": "혼자 사육하는 것보다 집사들과 사육의 즐거움을 함께 나누는 것을 가장 좋아합니다. 꼬물이의 귀여운 먹방 짤과 파업 영상을 공유하며 커뮤니티에 활력을 불어넣습니다.",
        "traits": [
            "귀여운 꼬물이 슈푸 핥아먹는 영상을 찍어 단톡방과 파사모에 올려 소통함",
            "개체가 웃긴 포즈를 취하거나 탈피 껍질을 먹으면 즉시 짤방으로 제작함",
            "박람회나 렙페에 가면 아는 집사님들과 반갑게 인사 나누고 간식을 나눔",
            "새 개체를 데려오면 파사모 입양 신고글을 올리고 축하를 듬뿍 받음"
        ],
        "superpower": "주변 집사들까지 크레 사육의 매력에 푹 빠져들게 만드는 유쾌한 에너지",
        "weakness": "단톡방 수다에 푹 빠져 시간 가는 줄 모르다 사육장 청소 루틴을 살짝 미룸",
        "bestMatch": {
            "mbti": "ISTJ",
            "title": "온습도 0.1도 오차 불허! 적재형 엑셀 사육 집사"
        },
        "worstMatch": {
            "mbti": "INTJ",
            "title": "5년 뒤 시장을 미리 설계하는 족보 타임머신"
        },
        "actionItem": "신나는 단톡방 수다를 마친 뒤엔, 사육장 분무와 키친타월 교체도 꼭 챙기세요!"
    },
    "ENFP": {
        "mbti": "ENFP",
        "title": "신규 콤보 상상력 만렙! 기발한 모프 창작집사",
        "subtitle": "\"이 모프 조합 진짜 대박일 듯!\" 아이디어와 열정이 넘치는 창작 브리더",
        "summary": "머릿속에 새로운 유전 조합과 개성 넘치는 비주얼 아이디어가 끊임없이 샘솟습니다. 남들이 시도하지 않은 색다른 브리딩 라인을 창조하는 도전에 가슴이 뜁니다.",
        "traits": [
            "사육장 인테리어를 예쁜 구조물과 은신처로 기분에 따라 자주 새롭게 바꿔줌",
            "아직 세상에 흔치 않은 새로운 콤보의 해칭 모습을 상상하며 두근거림",
            "박람회 부스에서 독특한 형질의 개체를 발견하면 흥분해서 브리더와 열띤 대화를 나눔",
            "아이디어 번뜩이는 재미난 모프 조합 프로젝트를 사육실에서 시도해 봄"
        ],
        "superpower": "고정관념을 깨부수는 창의적인 메이팅 구상과 거침없는 도전 정신",
        "weakness": "새로운 상상과 프로젝트에 몰두하다가 기존 사육 관리 일정이 흔들릴 수 있음",
        "bestMatch": {
            "mbti": "INFJ",
            "title": "사진 한 장으로 성체 풀핀 퀄리티 알아보는 크레 관상가"
        },
        "worstMatch": {
            "mbti": "ISTJ",
            "title": "온습도 0.1도 오차 불허! 적재형 엑셀 사육 집사"
        },
        "actionItem": "새로운 콤보 구상에 빠지기 전에, 오늘 밤 슈푸 급여부터 든든하게 마무리하세요!"
    },
    "ENTP": {
        "mbti": "ENTP",
        "title": "새 유전 가설 탐구! 열정 토론 연구원",
        "subtitle": "\"그 유전 법칙 검증된 건가요?\" 통념을 뒤엎는 사육실의 혁신가 브리더",
        "summary": "커뮤니티에 통용되는 사육 팁이나 모프 유전 공식에 대해 날카로운 의문을 던집니다. 새로운 사육 방식이나 메이팅 가설을 다각도로 테스트하며 활발한 토론을 즐깁니다.",
        "traits": [
            "슈푸 배합 비율이나 자율피딩 방식 등 새로운 사육 방식을 직접 실험해 봄",
            "릴리나 아잔틱, 카푸치노 유전 발현에 대해 단톡방에서 깊이 있는 토론을 펼침",
            "박람회 부스에서 브리더와 마주치면 라인 유전 히스토리에 대해 끝장 토론을 벌임",
            "유행하는 대세 모프보다 비인기 모프의 숨겨진 유전 잠재력에 더 큰 흥미를 느낌"
        ],
        "superpower": "편견에 갇히지 않고 새로운 모프 콤보 가설을 발굴해내는 혁신적인 탐구력",
        "weakness": "유전 토론에 과몰입하다가 상대방의 사육 방식을 지나치게 따질 수 있음",
        "bestMatch": {
            "mbti": "INTJ",
            "title": "5년 뒤 시장을 미리 설계하는 족보 타임머신"
        },
        "worstMatch": {
            "mbti": "ISFJ",
            "title": "슈푸 묽기 달인! 꼬물이 맞춤 피딩 집사"
        },
        "actionItem": "토론에 불붙기보다 '사육엔 정답이 없죠' 하고 부드럽게 웃어넘기는 여유를 가지세요!"
    },
    "ESTJ": {
        "mbti": "ESTJ",
        "title": "철저한 루틴 실행! 박람회 탐방 총괄 매니저",
        "subtitle": "개체 관리부터 렉사 배치, 피딩 스케줄까지 각이 잡힌 총괄 매니저",
        "summary": "박람회장에 도착하면 부스 배치도를 체크하고 최단 동선으로 부스를 체계적으로 공략합니다. 사육장은 정돈되어 있으며 피딩과 청소 루틴이 매우 철저합니다.",
        "traits": [
            "매일 정해진 피딩 시간과 렉사 청소, 분무 루틴을 칼같이 실행함",
            "박람회 마감 직전까지 재방문 부스와 최단 분양 동선을 완벽히 통제함",
            "분양 거래 시 개체 건강 보증 기준과 혈통 정보를 명확하게 확인함",
            "적재형 케이지 라벨에 생년월일, 부모 라인, 주간 체중을 정확히 기재함"
        ],
        "superpower": "사육장 운영 효율을 극대화하고 사육 사고 위험을 사전에 방지하는 관리 능력",
        "weakness": "비효율적인 사육 루틴을 보면 개선안과 잔소리가 턱밑까지 차오를 수 있음",
        "bestMatch": {
            "mbti": "ISFP",
            "title": "조명·매크로 렌즈로 감성 화보 남기는 핀/월 아티스트"
        },
        "worstMatch": {
            "mbti": "INFJ",
            "title": "사진 한 장으로 성체 풀핀 퀄리티 알아보는 크레 관상가"
        },
        "actionItem": "다른 집사님의 방식이 조금 느려 보여도 너그럽게 웃어넘기는 여유를 가져보세요!"
    },
    "ESFJ": {
        "mbti": "ESFJ",
        "title": "초보 멘토! 밴드 경매 톡방 따뜻한 반장 집사",
        "subtitle": "초보 집사 질문에 1초 만에 꿀팁 답변을 건네주는 멘토 집사",
        "summary": "단톡방이나 파사모에 새로 들어온 뉴비 집사들을 다정하게 환영해 줍니다. 꼬물이 케어 고민글이 올라오면 본인의 생생한 경험담과 팁을 나누며 커뮤니티의 따뜻함을 이끕니다.",
        "traits": [
            "초보 집사들의 거식이나 탈피부전 고민글에 친절하게 꿀팁 댓글을 달아줌",
            "단톡방 멤버들의 개체 모프와 취향을 기억하고 따뜻하게 맞장구쳐 줌",
            "경매나 분양글이 올라오면 응원의 댓글과 이모티콘으로 분위기를 훈훈하게 함",
            "내 개체 칭찬보다 '집사님 덕분에 아이가 슈푸 잘 먹어요' 인사받을 때 최고로 뿌듯함"
        ],
        "superpower": "초보 집사들이 파충류 사육에 잘 적응하도록 돕는 헌신적인 소통 친화력",
        "weakness": "남의 고민을 모두 챙겨주다 정작 자신의 휴식과 개인 시간이 줄어듦",
        "bestMatch": {
            "mbti": "ISTP",
            "title": "실전 맞춤 해결사! DIY 사육 장인"
        },
        "worstMatch": {
            "mbti": "INTP",
            "title": "해외 렙타일 포럼 번역하는 변종 콤보 가설 연구원"
        },
        "actionItem": "다른 집 꼬물이 걱정도 좋지만, 오늘 밤은 집사 본인의 꿀잠부터 챙기세요!"
    },
    "ENFJ": {
        "mbti": "ENFJ",
        "title": "동반 성장 유도! 라인 브리딩 비전 리더",
        "subtitle": "\"함께 멋진 라인을 만들어봅시다!\" 집사들의 선한 영향력 리더",
        "summary": "혼자만 잘나가는 브리더가 아니라, 주변 집사들과 함께 멋진 라인을 구축하고 올바른 사육 문화를 함께 발전시키고자 합니다. 명확한 비전과 열정으로 집사들을 이끕니다.",
        "traits": [
            "아이들이 건강하고 편안하게 지낼 수 있는 쾌적한 사육 환경을 구축함",
            "우수한 라인의 개체를 동료 집사들과 나누며 함께 성장하는 선순환을 만듦",
            "올바른 크레 사육 문화와 개체 케어 노하우 전파에 앞장섬",
            "내 라인을 입양해 간 집사님이 멋진 성체로 키워냈을 때 자기 일처럼 기뻐함"
        ],
        "superpower": "주변 집사들의 잠재력을 끌어올리고 함께 발전하도록 돕는 따뜻한 리더십",
        "weakness": "사람을 너무 깊이 믿다가 분양 예약 파기나 약속 어김에 마음의 상처를 받기도 함",
        "bestMatch": {
            "mbti": "INFP",
            "title": "눈에 띄지 않던 꼬물이의 폭풍성장에 감동하는 낭만집사"
        },
        "worstMatch": {
            "mbti": "ISTP",
            "title": "실전 맞춤 해결사! DIY 사육 장인"
        },
        "actionItem": "상대방의 열정을 믿더라도 분양 거래 시엔 절차를 사전에 명확히 정해두세요!"
    },
    "ENTJ": {
        "mbti": "ENTJ",
        "title": "대표 라인 구축! 목표 중심 브리딩 총괄 리더",
        "subtitle": "목표한 퀄리티 라인을 체계적으로 구축하고 사육실 브랜딩을 이끄는 총괄 브리더",
        "summary": "여러 마리를 분산해 데려오기보다 확실한 퀄리티의 메인 부모 개체에 집중하는 비전가입니다. 사육실 브랜딩과 목표 라인 완성을 향해 명확한 계획을 세우고 실행합니다.",
        "traits": [
            "쾌적한 위생 상태와 최고 수준의 자동화 케어 시스템을 정비함",
            "입양 시 개체가 향후 메이팅 라인에서 가지는 유전적 가치를 다각도로 계산함",
            "뚜렷한 퀄리티의 대표 라인을 구축해 나만의 사육 브랜드와 방향성을 확립함",
            "목표한 라인 브리딩 결과가 나오면 완성도 높은 사진으로 멋지게 공개함"
        ],
        "superpower": "명확한 목표와 선택과 집중으로 나만의 대표 라인을 완성해내는 추진력",
        "weakness": "목표와 성과 중심의 열정이 커서 소소한 소통의 여유를 지나치기 쉬움",
        "bestMatch": {
            "mbti": "INTP",
            "title": "해외 렙타일 포럼 번역하는 변종 콤보 가설 연구원"
        },
        "worstMatch": {
            "mbti": "ISFP",
            "title": "조명·매크로 렌즈로 감성 화보 남기는 핀/월 아티스트"
        },
        "actionItem": "목표 달성도 좋지만, 귀여운 꼬물이가 슈푸를 할짝거리는 소소한 평화도 즐기세요!"
    }
};

    function getResultProfile(code) {
        if (questionnaireSpec && questionnaireSpec.results && questionnaireSpec.results.results && questionnaireSpec.results.results[code]) {
            return questionnaireSpec.results.results[code];
        }
        if (DEFAULT_RESULTS_V28 && DEFAULT_RESULTS_V28[code]) {
            return DEFAULT_RESULTS_V28[code];
        }
        return {
            mbti: code,
            title: TYPE_NAMES[code] || '크레 집사',
            subtitle: `${code} 성향의 마스터 크레 집사`,
            summary: `나만의 뚜렷한 사육 철학과 행동 방식으로 크레 라이프를 즐기는 ${code} 타입 집사입니다.`,
            traits: [
                '뚜렷한 판단 기준과 관찰력으로 사육장을 다스림',
                '개체 피딩과 환경 케어를 자신만의 방식으로 완성함',
                '파충류 박람회 탐방과 커뮤니티 소통에서 고유한 존재감을 드러냄',
                '지속적인 호기심과 애정으로 크레 집사 생활을 이어감'
            ],
            superpower: '나만의 개성과 노하우로 완성하는 크레 케어 능력',
            weakness: '자신만의 방식에 몰입하여 가끔 휴식이 필요함',
            bestMatch: { mbti: 'ESFP', title: '파사모 톡방 인싸 집사' },
            worstMatch: { mbti: 'ENFP', title: '모프 상상 창작집사' },
            actionItem: '오늘 밤엔 편안하게 꼬물이 슈푸 먹방을 보며 힐링하세요!'
        };
    }


    const api = {
        AXES,
        HOUSE_KEYS,
        HOUSE_META,
        MBTI_TYPES,
        MIN_RESPONSE_MS,
        MAX_RESPONSE_MS,
        QUESTIONS,
        AXIS_META,
        TYPE_NAMES,
        prepareQuestions,
        scoreAnswers,
        answerLetters,
        answerSignals,
        answerScoreMap,
        buildMbtiComparison,
        buildTimingStats,
        buildSpeedBenchmark,
        median,
        average,
        ready,
        loadQuestionnaireFile,
        loadQuestionnaireVersion,
        getSurveyVersion,
        getResultProfile,
        SURVEY_VERSION_REGISTRY,
        applyQuestionnaireSpec,
        questionnaireFile: QUESTIONNAIRE_FILE,
        getQuestionnaireSpec: () => questionnaireSpec
    };
    Object.defineProperties(api, {
        SURVEY_VERSION: { enumerable: true, get: () => SURVEY_VERSION },
        AXIS_SCORE_TOTAL: { enumerable: true, get: () => AXIS_SCORE_TOTAL },
        PRIMARY_SIGNAL_POINTS: { enumerable: true, get: () => PRIMARY_SIGNAL_POINTS },
        SECONDARY_SIGNAL_POINTS: { enumerable: true, get: () => SECONDARY_SIGNAL_POINTS }
    });
    return api;
}));
