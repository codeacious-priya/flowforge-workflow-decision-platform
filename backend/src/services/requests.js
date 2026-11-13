import crypto from 'node:crypto';
import Request from '../models/Request.js';
import {latest} from './workflows.js';
import {firstDecision,transitionFor,verifyDependency,backoffMs} from '../engine/decisions.js';
export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const digest=(v)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function event(type,actor,detail){return {at:new Date(),type,actor,detail};}
export function validatePayload(def,payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new HttpError(400,'Payload must be an object');
  for(const f of def.fields){
    const v=payload[f.name];
    if((v===undefined||v===null||v==='')&&f.required)throw new HttpError(400,'Missing required field: '+f.name);
    if(v===undefined||v===null)continue;
    if(f.type==='number'&&(typeof v!=='number'||!Number.isFinite(v)||(f.min!==undefined&&v<f.min)||(f.max!==undefined&&v>f.max)))throw new HttpError(400,'Invalid number: '+f.name);
    if(f.type==='text'&&(typeof v!=='string'||!v.trim()||v.length>500))throw new HttpError(400,'Invalid text: '+f.name);
    if(f.type==='boolean'&&typeof v!=='boolean')throw new HttpError(400,'Invalid boolean: '+f.name);
    if(f.type==='select'&&!f.options.includes(v))throw new HttpError(400,'Invalid option: '+f.name);
  }
  const allowed=new Set(def.fields.map(f=>f.name));
  if(Object.keys(payload).some(k=>!allowed.has(k)))throw new HttpError(400,'Unknown payload field');
}
export async function createRequest({workflowKey,payload,idempotencyKey,applicant}){
  if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>150)throw new HttpError(400,'Idempotency-Key header must be 8–150 characters');
  const def=await latest(workflowKey);
  if(!def)throw new HttpError(404,'Workflow not found');
  validatePayload(def,payload);
  const payloadHash=digest({payload,applicant:applicant||'demo-user'});
  const prev=await Request.findOne({workflowKey,idempotencyKey}).lean();
  if(prev){if(prev.payloadHash!==payloadHash)throw new HttpError(409,'Idempotency key already used for different data');return {item:prev,replayed:true};}
  const d=firstDecision(def,payload);
  const state=transitionFor(d.action,def);
  const audit=[event('REQUEST_SUBMITTED',applicant||'demo-user',{workflowKey,version:def.version}),event('RULE_EVALUATED','engine',{ruleId:d.ruleId,priority:d.priority,reason:d.reason,action:d.action}),event('STATE_CHANGED','engine',state)];
  const data={workflowKey,workflowVersion:def.version,definition:def,payload,applicant:applicant||'demo-user',idempotencyKey,payloadHash,...state,audit};
  try{
    const item=await Request.create(data);
    if(item.status==='VERIFYING') await processVerification(item._id);
    return {item:await Request.findById(item._id).lean(),replayed:false};
  }catch(e){
    if(e.code!==11000)throw e;
    const exists=await Request.findOne({workflowKey,idempotencyKey}).lean();
    if(!exists)throw e;
    if(exists.payloadHash!==payloadHash)throw new HttpError(409,'Idempotency key reused for different data');
    return {item:exists,replayed:true};
  }
}
// Conditional atomic update: status and audit grow together in the same MongoDB document.
async function change(id,filter,updates,events){
  const item=await Request.findOneAndUpdate({_id:id,...filter},{$set:updates,$inc:{revision:1},$push:{audit:{$each:events}}},{new:true}).lean();
  if(!item)throw new HttpError(409,'Request changed concurrently or operation not allowed');
  return item;
}
export async function review(id,{decision,actor,comment,expectedStage}){
  const item=await Request.findById(id).lean();
  if(!item)throw new HttpError(404,'Request not found');
  if(item.status!=='WAITING_REVIEW')throw new HttpError(409,'Request is not awaiting review');
  if(item.currentStage!==expectedStage)throw new HttpError(409,'Stale approval stage; refresh before deciding');
  const stage=item.definition.stages.find(s=>s.id===item.currentStage);
  if(!stage)throw new HttpError(500,'Stage configuration missing');
  const action=decision==='APPROVE'?stage.onApprove:{type:'REJECT'};
  const state=transitionFor(action,item.definition);
  return change(id,{status:'WAITING_REVIEW',revision:item.revision,currentStage:item.currentStage},state,[
    event('REVIEW_DECISION',actor,{stage:stage.id,decision,comment:comment||''}),
    event('STATE_CHANGED','engine',{...state,reason:decision==='APPROVE'?'Review approved':'Review rejected'})
  ]);
}
export async function processVerification(id){
  const item=await Request.findById(id).lean();
  if(!item)throw new HttpError(404,'Request not found');
  if(!['VERIFYING','RETRY_SCHEDULED'].includes(item.status))throw new HttpError(409,'Verification not pending');
  const attempt=item.attempts+1;
  try{
    const action=verifyDependency(item.payload,attempt);
    const state=transitionFor(action,item.definition);
    return change(id,{revision:item.revision,status:item.status},{...state,attempts:attempt,error:null,nextRetryAt:null},[
      event('DEPENDENCY_SUCCEEDED','mock-verifier',{attempt,reason:action.reason}),event('STATE_CHANGED','engine',state)
    ]);
  }catch(e){
    const exhausted=attempt>=item.maxAttempts;
    const status=exhausted?'FAILED':'RETRY_SCHEDULED';
    const retryAt=exhausted?null:new Date(Date.now()+backoffMs(attempt));
    return change(id,{revision:item.revision,status:item.status},{status,attempts:attempt,error:e.message,nextRetryAt:retryAt},[
      event('DEPENDENCY_FAILED','mock-verifier',{attempt,error:e.message}),
      event(exhausted?'RETRIES_EXHAUSTED':'RETRY_SCHEDULED','engine',{attempt,nextRetryAt:retryAt})
    ]);
  }
}
export async function retryRequest(id){
  const item=await Request.findById(id).lean();
  if(!item)throw new HttpError(404,'Request not found');
  if(item.status==='FAILED'){
    await change(id,{status:'FAILED',revision:item.revision},{status:'VERIFYING',attempts:0,error:null,nextRetryAt:null},[event('MANUAL_RETRY','demo-operator',{reason:'Operator requested recovery'})]);
  }else if(item.status!=='RETRY_SCHEDULED') throw new HttpError(409,'Request has no retryable failure');
  return processVerification(id);
}
export async function runDueRetries(){
  const due=await Request.find({status:'RETRY_SCHEDULED',nextRetryAt:{$lte:new Date()}}).limit(20).select('_id').lean();
  for(const item of due){try{await processVerification(item._id)}catch(e){if(e.status!==409)console.error('Retry error:',e.message);}}
}
