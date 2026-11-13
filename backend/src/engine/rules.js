// Pure rule evaluator. No dynamic code execution or eval().
const operators = new Set(['eq','neq','gt','gte','lt','lte','in','exists']);
export function getField(obj, path) {
  if (!/^[a-zA-Z][\w.]*(?:[\w])?$/.test(path) || path.split('.').some(x=>x==='__proto__'||x==='constructor'||x==='prototype')) throw Error('Unsafe field path');
  return path.split('.').reduce((v,k)=>v == null ? undefined : Object.hasOwn(v,k) ? v[k] : undefined,obj);
}
export function matches(condition, payload) {
  if (!condition || typeof condition!=='object') throw Error('Invalid condition');
  if (Array.isArray(condition.all)) return condition.all.every(c=>matches(c,payload));
  if (Array.isArray(condition.any)) return condition.any.some(c=>matches(c,payload));
  if (condition.not) return !matches(condition.not,payload);
  const {field,op,value}=condition;
  if (typeof field!=='string'||!operators.has(op)) throw Error('Unsupported condition');
  const actual=getField(payload,field);
  if (op==='exists') return (actual!==undefined && actual!==null) === value;
  // Strict typed comparison prevents unexpected JS coercion.
  if (op==='eq') return actual===value;
  if (op==='neq') return actual!==value;
  if (op==='in') return Array.isArray(value)&&value.includes(actual);
  if (typeof actual!=='number'||typeof value!=='number'||!Number.isFinite(actual)||!Number.isFinite(value)) return false;
  return ({gt:actual>value,gte:actual>=value,lt:actual<value,lte:actual<=value})[op];
}
export function chooseRule(definition,payload){
  const sorted=[...definition.rules].sort((a,b)=>a.priority-b.priority);
  const matched=sorted.find(rule=>matches(rule.when,payload));
  if(!matched) return {rule:null,action:definition.defaultAction,reason:'No rule matched; using configured default'};
  return {rule:matched,action:matched.action,reason:matched.reason};
}
export function validateDefinition(def){
  if(!def||typeof def.key!=='string'||!Array.isArray(def.rules)||!def.defaultAction) throw Error('Invalid workflow definition');
  const rules=new Set();
  for(const r of def.rules){
    if(!r.id||rules.has(r.id)||!Number.isInteger(r.priority)||!r.action||!r.when)throw Error('Invalid or duplicate rule');
    rules.add(r.id);matches(r.when,{});checkAction(r.action,def);
  }
  checkAction(def.defaultAction,def);
  const stages=new Set();
  for(const s of def.stages||[]){
    if(stages.has(s.id)||!s.id||!s.label||!s.onApprove)throw Error('Invalid stage');
    stages.add(s.id);
    checkAction(s.onApprove,def);
  }
  return true;
}
function checkAction(action,def){
  if(!['APPROVE','REJECT','REVIEW','VERIFY'].includes(action.type))throw Error('Invalid action type');
  if(action.type==='REVIEW' && !(def.stages||[]).some(s=>s.id===action.stageId))throw Error('Unknown stage: '+action.stageId);
}
