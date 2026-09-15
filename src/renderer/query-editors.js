import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle, syntaxTree } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, snippetCompletion } from '@codemirror/autocomplete';
import { linter, lintGutter } from '@codemirror/lint';

const methods = [
  ['find', 'find({${}})'], ['findOne', 'findOne({${}})'],
  ['aggregate', 'aggregate([\n  {$match: {${}}}\n])'],
  ['insert', 'insert({${}})'], ['insertOne', 'insertOne({${}})'],
  ['insertMany', 'insertMany([${documents}])'],
  ['updateOne', 'updateOne({${}}, { $set: {${}} })'],
  ['updateMany', 'updateMany({${}}, { $set: {${}} })'],
  ['replaceOne', 'replaceOne({${}}, {${}})'],
  ['deleteOne', 'deleteOne({${}})'], ['deleteMany', 'deleteMany({${}})'],
  ['countDocuments', 'countDocuments({${}})'], ['distinct', 'distinct("${field}")'],
  ['sort', 'sort({ ${field}: ${1:1} })'], ['limit', 'limit(${1:100})'],
  ['skip', 'skip(${1:0})'], ['project', 'project({ ${field}: 1 })'],
  ['createIndex', 'createIndex({ ${field}: 1 })'], ['bulkWrite', 'bulkWrite([${operations}])'],
  ...['findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'estimatedDocumentCount', 'createIndexes', 'dropIndex', 'dropIndexes', 'indexes', 'listIndexes', 'indexExists', 'indexInformation', 'options', 'isCapped', 'drop', 'rename', 'hint', 'collation', 'maxTimeMS', 'batchSize', 'allowDiskUse', 'min', 'max', 'returnKey', 'showRecordId', 'comment', 'count', 'explain', 'toArray', 'next', 'hasNext'].map(name => [name, `${name}(\${args})`]),
].map(([label, template]) => snippetCompletion(template, { label, type: 'method' }));
const operators = '$match $group $project $sort $limit $skip $unwind $lookup $count $addFields $set $unset $replaceRoot $facet $out $merge $sum $avg $min $max $push $first $last $eq $ne $gt $gte $lt $lte $in $nin $and $or $nor $not $exists $type $regex $elemMatch $all $size $inc $mul $rename $setOnInsert $addToSet $pop $pull $pullAll $each $currentDate $expr'.split(' ').map(label => ({ label, type: 'keyword' }));
const helpers = ['ObjectId', 'ISODate', 'NumberInt', 'NumberLong', 'NumberDecimal'].map(label => snippetCompletion(`${label}("\${value}")`, { label, type: 'function' }));
function mongoCompletions(context) {
  const node = syntaxTree(context.state).resolveInner(context.pos, -1);
  if (/Comment|String/.test(node.name)) return null;
  const word = context.matchBefore(/[\w$]*/);
  if (!word) return null;
  const prefix = context.state.sliceDoc(Math.max(0, word.from - 1), word.from);
  if (!context.explicit && word.from === word.to && prefix !== '.') return null;
  return { from: word.from, options: prefix === '.' ? methods : word.text.startsWith('$') ? operators : [...operators, ...helpers], validFor: /^[\w$]*$/ };
}

const theme = EditorView.theme({
  '&': { backgroundColor: '#10171c', color: '#dce8e2', fontSize: '12px', textTransform: 'none', letterSpacing: 'normal' },
  '&.cm-focused': { outline: '1px solid #a9ebc5' },
  '.cm-scroller': { fontFamily: '"DM Mono", monospace', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': { padding: '10px 0', caretColor: '#a9ebc5' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { backgroundColor: '#131a1f', color: '#63776e', borderRight: '1px solid #29342f' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#a9ebc509' },
  '.cm-cursor': { borderLeftColor: '#a9ebc5' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#315343' },
  '.cm-matchingBracket': { backgroundColor: '#315343', outline: '1px solid #709680' },
  '.cm-tooltip': { backgroundColor: '#1c2922', border: '1px solid #42634f', color: '#dce8e2' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#315343', color: '#fff' },
}, { dark: true });

const editors = new Map();
for (const [id, label, isJson] of [['queryFilter', 'Filter JSON editor', true], ['querySort', 'Sort JSON editor', true], ['flatQuery', 'Flat query JavaScript editor', false]]) {
  const textarea = document.getElementById(id);
  const container = document.createElement('div');
  container.className = `query-code-editor${isJson ? '' : ' query-code-editor-flat'}`;
  textarea.after(container);
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: textarea.value,
      extensions: [
        lineNumbers(), history(), drawSelection(), highlightActiveLine(), indentOnInput(),
        bracketMatching(), closeBrackets(), foldGutter(),
        syntaxHighlighting(defaultHighlightStyle), theme,
        isJson ? [json(), linter(jsonParseLinter()), lintGutter()] : javascript(),
        autocompletion(isJson ? {} : { override: [mongoCompletions] }),
        EditorView.contentAttributes.of({ 'aria-label': label, 'aria-describedby': 'queryEditorHelp', spellcheck: 'false' }),
        keymap.of([
          { key: 'Mod-Enter', run: () => { document.getElementById('runQueryButton').click(); return true; } },
          ...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab,
        ]),
        EditorView.updateListener.of(update => { if (update.docChanged) textarea.value = update.state.doc.toString(); }),
      ],
    }),
  });
  textarea.hidden = true;
  editors.set(id, view);
}
window.queryEditors = {
  setValue(id, value) {
    const view = editors.get(id);
    const text = String(value ?? '');
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  },
  refresh() { for (const view of editors.values()) view.requestMeasure(); },
};
