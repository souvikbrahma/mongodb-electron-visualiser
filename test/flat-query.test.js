const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFlatQuery, runFlatQuery } = require('../src/flat-query');

test('parses shell data literals and BSON helpers', () => {
  const [{ args: [filter] }] = parseFlatQuery(".find({name: 'Ada', age: {$gte: 18}, _id: ObjectId('507f1f77bcf86cd799439011'), date: new Date('2020-01-01'), pattern: /a[ /]b/i, tags: [true, null,], amount: NumberDecimal('1.25')});");
  assert.equal(filter.name, 'Ada');
  assert.equal(filter._id.toHexString(), '507f1f77bcf86cd799439011');
  assert.equal(filter.date.toISOString(), '2020-01-01T00:00:00.000Z');
  assert.equal(filter.amount.toString(), '1.25');
  assert.equal(filter.pattern.flags, 'i');
});

test('find chains execute in order and return cursor rows', async () => {
  const calls = [];
  const cursor = { sort(v) { calls.push(v); return this; }, limit(v) { calls.push(v); return this; }, async toArray() { return [{ name: 'Ada' }]; } };
  const result = await runFlatQuery({ find(v) { calls.push(v); return cursor; } }, '.find({active: true}).sort({name: 1}).limit(5)');
  assert.deepEqual(calls, [{ active: true }, { name: 1 }, 5]);
  assert.deepEqual(result.documents, [{ name: 'Ada' }]);
});

test('aggregation, insert aliases, and scalar results', async () => {
  let pipeline;
  assert.deepEqual((await runFlatQuery({ aggregate(v) { pipeline = v; return { toArray: async () => [{ total: 2 }] }; } }, '.aggregate([{$count: "total"}])')).documents, [{ total: 2 }]);
  assert.deepEqual(pipeline, [{ $count: 'total' }]);
  for (const [command, method] of [['.insert({x: 1})', 'insertOne'], ['.insert([{x: 1}])', 'insertMany']]) {
    const result = await runFlatQuery({ [method]: async () => ({ acknowledged: true }) }, command);
    assert.deepEqual(result.documents, [{ acknowledged: true }]);
    assert.equal(result.resultType, 'results');
  }
  assert.deepEqual((await runFlatQuery({ countDocuments: async () => 7 }, '.countDocuments({})')).documents, [{ value: 7 }]);
});

test('rejects scripts and invalid chains before writes execute', async () => {
  for (const source of ['.find({x: process.exit()})', '.constructor()', '.find({}).constructor()', '.insert({}).find({})', '.insert({}); .insert({})']) {
    await assert.rejects(runFlatQuery({ insertOne() { assert.fail('must not execute'); } }, source));
  }
  assert.deepEqual(parseFlatQuery('{"active":true}'), [{ name: 'find', args: [{ active: true }] }]);
});
