const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {buildClientSchema,getIntrospectionQuery,parse,validate}=require('graphql');
test('all UI operations match Stash v0.31.1 schema',async t=>{
  if(!process.env.STASH_TEST_URL){t.skip('Set STASH_TEST_URL to a disposable Stash v0.31.1 instance');return;}
  const result=await fetch(process.env.STASH_TEST_URL+'/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:getIntrospectionQuery()})}).then(r=>r.json());
  const schema=buildClientSchema(result.data);
  const source=fs.readFileSync('plugins/marker-compilations/ui/compilations.js','utf8');
  const screening=fs.readFileSync('plugins/marker-compilations/screening.py','utf8');
  for(const match of screening.matchAll(/^[A-Z_]+ = '([^']+)'/gm))assert.deepEqual(validate(schema,parse(match[1])).map(e=>e.message),[],match[1]);
  for(const match of source.matchAll(/gql`([^`]+)`/g))assert.deepEqual(validate(schema,parse(match[1])).map(e=>e.message),[],match[1]);
});
