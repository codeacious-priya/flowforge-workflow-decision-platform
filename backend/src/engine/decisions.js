import {chooseRule} from './rules.js';
export function firstDecision(def,payload){
  const {rule,action,reason}=chooseRule(def,payload);
  return {action,reason,ruleId:rule?.id??null,priority:rule?.priority??null};
}
export function transitionFor(action,def){
  if(action.type==='APPROVE') return {status:'APPROVED',currentStage:null};
  if(action.type==='REJECT') return {status:'REJECTED',currentStage:null};
  if(action.type==='REVIEW'){
    const s=def.stages.find(s=>s.id===action.stageId);
    if(!s)throw Error('Unknown stage');
    return {status:'WAITING_REVIEW',currentStage:s.id};
  }
  if(action.type==='VERIFY')return {status:'VERIFYING',currentStage:null};
  throw Error('Unknown action');
}
export function verifyDependency(payload,attempt){
  // Deterministic mock of an external verification service, no external dependency.
  if(attempt <= (payload.simulateDependencyFailures??0))throw Error('Simulated identity provider timeout');
  if(payload.externalVerified===false)return {type:'REJECT',reason:'External verification reported a mismatch'};
  return {type:'REVIEW',stageId:'compliance',reason:'External verification succeeded'};
}
export function backoffMs(attempt){return Math.min(60_000,1000*2**Math.max(0,attempt-1));}
