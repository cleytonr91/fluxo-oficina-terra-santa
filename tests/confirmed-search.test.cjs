const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const source=fs.readFileSync('src/components/confirmed-search.tsx','utf8'),mod={exports:{}};
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText)(name=>name.endsWith('.css')?{default:{}}:require(name),mod,mod.exports);
test('typing and clearing only edit the draft; submitting explicitly applies the trimmed query',()=>{
 let value='',queries=[],prevented=0;
 const render=()=>mod.exports.ConfirmedSearch({value,placeholder:'Placa',onChange:v=>value=v,onSearch:v=>queries.push(v)});
 render().props.children[0].props.children[1].props.onChange({target:{value:' ABC1D23 '}});
 assert.deepEqual(queries,[]);assert.equal(value,' ABC1D23 ');
 const form=render();assert.equal(form.props.children[1].props.type,'submit');
 form.props.onSubmit({preventDefault:()=>prevented++});assert.deepEqual(queries,['ABC1D23']);assert.equal(prevented,1);
 render().props.children[0].props.children[1].props.onChange({target:{value:''}});assert.deepEqual(queries,['ABC1D23']);
 render().props.onSubmit({preventDefault(){}});assert.deepEqual(queries,['ABC1D23','']);
});
test('both pages separate text entry from the applied search and parts archive lookup',()=>{
 for(const page of ['agendamento','pecas']){
  const text=fs.readFileSync(`src/app/${page}/page.tsx`,'utf8');
  assert.match(text,/value=\{searchDraft\} onChange=\{setSearchDraft\} onSearch=/);
  assert.doesNotMatch(text,/onChange=\{\(event\) => (?:applySearchQuery|setSearch)\(event.target.value\)\}/);
 }
 assert.doesNotMatch(source,/useEffect|setTimeout|setInterval|firebase|services/);
});
