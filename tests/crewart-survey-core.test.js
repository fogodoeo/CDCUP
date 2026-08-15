const assert = require('node:assert/strict');
const Core = require('../crewart-survey-core.js');

function test(name, fn) {
    fn();
    console.log(`ok - ${name}`);
}

function strongestChoice(question, targetCode) {
    const targetLetter = targetCode[Core.AXES.indexOf(question.axis)];
    return question.optionScores.reduce((best, scores, index) => (
        (scores[targetLetter] || 0) > (question.optionScores[best]?.[targetLetter] || 0) ? index : best
    ), 0);
}

(async () => {
    await Core.ready;

    test('12 questions contain three primary items for every MBTI axis', () => {
        assert.equal(Core.QUESTIONS.length, 12);
        assert.equal(new Set(Core.QUESTIONS.map(question => question.id)).size, 12);
        Core.AXES.forEach(axis => {
            assert.equal(Core.QUESTIONS.filter(question => question.axis === axis).length, 3);
        });
        Core.QUESTIONS.forEach(question => {
            assert.equal(question.options.length, 4);
            assert.equal(question.optionScores.length, 4);
            question.optionScores.forEach(scores => assert.equal(typeof scores, 'object'));
        });
    });

    test('prepared survey avoids adjacent primary axes', () => {
        let value = 0;
        const prepared = Core.prepareQuestions(() => {
            value = (value + 0.371) % 1;
            return value;
        });
        assert.equal(prepared.length, 12);
        prepared.forEach((question, index) => {
            if (index > 0) assert.notEqual(question.axis, prepared[index - 1].axis);
        });
    });

    test('strongest target choices produce the intended MBTI result', () => {
        const prepared = Core.prepareQuestions(() => 0.42);
        const target = 'ENTP';
        const answers = prepared.map(question => strongestChoice(question, target));
        const result = Core.scoreAnswers(prepared, answers);
        assert.equal(result.code, target);
        result.axes.forEach(axis => assert.ok(axis.dominantCount > axis.oppositeCount));
    });

    test('timing analysis excludes accidental taps and long interruptions', () => {
        const entries = Core.QUESTIONS.map((question, index) => ({
            questionId: question.id,
            axis: question.axis,
            elapsedMs: index === 0 ? 250 : index === 11 ? 95000 : 4000 + index * 100
        }));
        const stats = Core.buildTimingStats(entries, Core.QUESTIONS);
        assert.equal(stats.validCount, 10);
        assert.ok(stats.medianMs >= 4500 && stats.medianMs <= 4700);
    });

    test('speed comparison opens only after ten valid pilot responses', () => {
        assert.equal(Core.buildSpeedBenchmark(4200, Array(9).fill(5000)).ready, false);
        const benchmark = Core.buildSpeedBenchmark(4200, Array(10).fill(5000));
        assert.equal(benchmark.ready, true);
        assert.equal(benchmark.sampleSize, 10);
    });

    test('MBTI comparison reports only changed axes', () => {
        const comparison = Core.buildMbtiComparison('ENFP', 'INFP');
        assert.equal(comparison.changes.length, 1);
        assert.equal(comparison.changes[0].axis, 'EI');
        assert.equal(comparison.sameCount, 3);
    });

    console.log('all Crewart survey core tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
