const assert = require('node:assert/strict');
const Core = require('../crewart-survey-core.js');

function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        throw error;
    }
}

test('20 questions contain five items for every MBTI axis', () => {
    assert.equal(Core.QUESTIONS.length, 20);
    assert.equal(new Set(Core.QUESTIONS.map(question => question.id)).size, 20);
    Core.AXES.forEach(axis => {
        assert.equal(Core.QUESTIONS.filter(question => question.axis === axis).length, 5);
    });
    Core.QUESTIONS.forEach(question => {
        assert.equal(question.options.length, 2);
        assert.equal(question.scores.length, 2);
        assert.deepEqual([...question.scores].sort(), [...question.axis].sort());
        assert.match(question.image, /^question-c\d{2}\.webp$/);
        assert.match(question.imageAlt, /상황 삽화$/);
    });
});

test('prepared survey balances option positions and avoids adjacent axes', () => {
    let value = 0;
    const prepared = Core.prepareQuestions(() => {
        value = (value + 0.371) % 1;
        return value;
    });
    assert.equal(prepared.filter(question => question.flipped).length, 10);
    assert.equal(prepared.length, 20);
    prepared.forEach((question, index) => {
        if (index > 0) assert.notEqual(question.axis, prepared[index - 1].axis);
    });
});

test('five questions per axis produce an unambiguous MBTI result', () => {
    const prepared = Core.prepareQuestions(() => 0.42);
    const target = 'ENTP';
    const answers = prepared.map(question => question.scores.indexOf(target[Core.AXES.indexOf(question.axis)]));
    const result = Core.scoreAnswers(prepared, answers);
    assert.equal(result.code, target);
    result.axes.forEach(axis => {
        assert.equal(axis.dominantCount, 5);
        assert.equal(axis.oppositeCount, 0);
    });
});

test('timing analysis excludes accidental taps and long interruptions', () => {
    const entries = Core.QUESTIONS.map((question, index) => ({
        questionId: question.id,
        axis: question.axis,
        elapsedMs: index === 0 ? 250 : index === 19 ? 45000 : 1000 + index * 100
    }));
    const stats = Core.buildTimingStats(entries, Core.QUESTIONS);
    assert.equal(stats.validCount, 18);
    assert.ok(stats.medianMs >= 1800 && stats.medianMs <= 2100);
    assert.equal(stats.style.key, 'instinct');
});

test('speed comparison opens only after ten valid pilot responses', () => {
    assert.equal(Core.buildSpeedBenchmark(2200, Array(9).fill(3000)).ready, false);
    const benchmark = Core.buildSpeedBenchmark(2200, Array(10).fill(3000));
    assert.equal(benchmark.ready, true);
    assert.equal(benchmark.sampleSize, 10);
    assert.match(benchmark.message, /빠르게/);
});

test('house allocation selects among the least populated houses', () => {
    const prepared = Core.prepareQuestions(() => 0.2);
    const answers = prepared.map(question => question.scores.indexOf(question.axis[0]));
    const result = Core.scoreAnswers(prepared, answers);
    const selected = Core.chooseBalancedHouse(result, { SF: 4, ST: 2, NT: 3, NF: 3 }, 'session-a');
    assert.equal(selected, 'ST');
});

test('MBTI comparison reports only changed axes', () => {
    const comparison = Core.buildMbtiComparison('ENFP', 'INFP');
    assert.equal(comparison.changes.length, 1);
    assert.equal(comparison.changes[0].axis, 'EI');
    assert.equal(comparison.sameCount, 3);
});

console.log('all Crewart survey core tests passed');
