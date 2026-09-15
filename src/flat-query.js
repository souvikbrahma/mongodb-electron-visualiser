const { BSON } = require('mongodb');

// Parse data literals and method calls only: query text is never executed as JavaScript.
function parseFlatQuery(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Enter a collection command, such as .find({}).');
  let i = 0;
  const skip = () => { while (/\s/.test(source[i] || '') && i < source.length) i++; };
  const fail = () => { throw new Error(`Invalid query near character ${i + 1}. Use collection methods and data literals.`); };
  const eat = (c) => { skip(); if (source[i] !== c) fail(); i++; };
  const identifier = () => { skip(); const m = /^[A-Za-z_$][\w$]*/.exec(source.slice(i)); if (!m) fail(); i += m[0].length; return m[0]; };
  function string() {
    const quote = source[i++]; let result = '';
    while (i < source.length) {
      const c = source[i++];
      if (c === quote) return result;
      if (c === '\\') {
        const e = source[i++];
        if (e === 'u') { const hex = source.slice(i, i + 4); if (!/^[\da-f]{4}$/i.test(hex)) fail(); result += String.fromCharCode(parseInt(hex, 16)); i += 4; }
        else { const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' }; result += escapes[e] ?? e; }
      } else result += c;
    }
    fail();
  }
  function list(end) {
    const values = []; skip();
    while (source[i] !== end) {
      values.push(value()); skip(); if (source[i] === end) break;
      eat(','); skip();
    }
    eat(end); return values;
  }
  function value() {
    skip(); const c = source[i];
    if (c === '"' || c === "'") return string();
    if (c === '[') { i++; return list(']'); }
    if (c === '{') {
      i++; const result = {}; skip();
      while (source[i] !== '}') {
        const key = source[i] === '"' || source[i] === "'" ? string() : identifier();
        eat(':'); Object.defineProperty(result, key, { value: value(), enumerable: true, writable: true, configurable: true });
        skip(); if (source[i] === '}') break; eat(','); skip();
      }
      i++; return result;
    }
    if (c === '/') {
      i++; let pattern = ''; let inClass = false;
      while (i < source.length) {
        const ch = source[i++];
        if (ch === '\\') { pattern += ch + source[i++]; continue; }
        if (ch === '[') inClass = true;
        if (ch === ']') inClass = false;
        if (ch === '/' && !inClass) { const flags = /^[a-z]*/.exec(source.slice(i))[0]; i += flags.length; return new RegExp(pattern, flags); }
        pattern += ch;
      }
      fail();
    }
    const number = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(source.slice(i));
    if (number) { i += number[0].length; return Number(number[0]); }
    let name = identifier();
    if (name === 'true') return true;
    if (name === 'false') return false;
    if (name === 'null') return null;
    if (name === 'new') name = identifier();
    const constructors = {
      ObjectId: (...args) => new BSON.ObjectId(...args),
      ISODate: (...args) => new Date(...args), Date: (...args) => new Date(...args),
      NumberInt: (v) => new BSON.Int32(Number(v)),
      NumberLong: (v) => BSON.Long.fromString(String(v)),
      NumberDecimal: (v) => BSON.Decimal128.fromString(String(v)),
      RegExp: (...args) => new RegExp(...args),
    };
    if (!Object.hasOwn(constructors, name)) fail();
    eat('('); return constructors[name](...list(')'));
  }
  skip();
  if (source[i] === '{') { const filter = value(); skip(); if (i !== source.length) fail(); return [{ name: 'find', args: [filter] }]; }
  const calls = [];
  while (i < source.length) {
    eat('.'); const name = identifier(); eat('('); calls.push({ name, args: list(')') }); skip();
    if (source[i] === ';') { i++; skip(); break; }
  }
  if (i !== source.length || !calls.length) fail();
  return calls;
}

const collectionMethods = new Set(`find findOne aggregate insert insertOne insertMany updateOne updateMany replaceOne deleteOne deleteMany findOneAndUpdate findOneAndReplace findOneAndDelete countDocuments estimatedDocumentCount distinct bulkWrite createIndex createIndexes dropIndex dropIndexes indexes listIndexes indexExists indexInformation options isCapped drop rename count`.split(' '));
const cursorMethods = new Set(`sort limit skip project hint collation maxTimeMS batchSize allowDiskUse min max returnKey showRecordId comment addFields unwind group match lookup out geoNear redact replaceRoot count explain toArray next hasNext`.split(' '));

async function runFlatQuery(collection, source) {
  const calls = parseFlatQuery(source);
  // Validate the entire chain before any database operation can have side effects.
  const first = calls[0];
  if (!collectionMethods.has(first.name)) throw new Error(`Unsupported collection method: .${first.name}().`);
  const cursorStart = ['find', 'aggregate', 'listIndexes'].includes(first.name);
  if (calls.length > 1 && !cursorStart) throw new Error(`.${first.name}() cannot be chained.`);
  for (let index = 1; index < calls.length; index++) {
    if (!cursorMethods.has(calls[index].name)) throw new Error(`Unsupported cursor method: .${calls[index].name}().`);
    if (['toArray', 'next', 'hasNext', 'explain', 'count'].includes(calls[index].name) && index !== calls.length - 1) throw new Error('A result method must be the last call.');
  }
  let target = collection;
  for (let index = 0; index < calls.length; index++) {
    let { name, args } = calls[index];
    if (index === 0 && name === 'insert') name = Array.isArray(args[0]) ? 'insertMany' : 'insertOne';
    if (typeof target?.[name] !== 'function') throw new Error(`Method .${name}() is unavailable for this query.`);
    target = await target[name](...args);
  }
  if (target && typeof target.toArray === 'function') target = await target.toArray();
  if (first.name === 'rename') target = { collectionName: target.collectionName };
  const rows = target == null ? [] : Array.isArray(target) ? target : [target];
  return { documents: rows.map(row => row !== null && typeof row === 'object' ? row : { value: row }), resultType: ['find', 'findOne', 'aggregate'].includes(first.name) ? 'documents' : 'results' };
}

module.exports = { parseFlatQuery, runFlatQuery };
