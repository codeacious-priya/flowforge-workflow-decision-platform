import {Router} from 'express';
import mongoose from 'mongoose';
import {z} from 'zod';
import Workflow from '../models/Workflow.js';
import Request from '../models/Request.js';
import {latest,publish} from '../services/workflows.js';
import {createRequest,review,retryRequest,HttpError} from '../services/requests.js';
const api=Router();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
function checkId(id){if(!mongoose.isValidObjectId(id))throw new HttpError(400,'Invalid request ID');}
api.get('/health',(req,res)=>res.json({ok:true,service:'flowforge',time:new Date().toISOString()}));
api.get('/workflows',wrap(async(req,res)=>{
  const all=await Workflow.aggregate([{$match:{active:true}},{$sort:{version:-1}},{$group:{_id:'$key',doc:{$first:'$$ROOT'}}},{$replaceRoot:{newRoot:'$doc'}},{$sort:{name:1}}]);
  res.json(all);
}));
api.get('/workflows/:key',wrap(async(req,res)=>{const w=await latest(req.params.key);if(!w)throw new HttpError(404,'Workflow not found');res.json(w);}));
api.get('/workflows/:key/versions',wrap(async(req,res)=>res.json(await Workflow.find({key:req.params.key}).sort({version:-1}).lean())));
api.post('/workflows/:key/versions',wrap(async(req,res)=>res.status(201).json(await publish(req.params.key,req.body))));
api.post('/requests',wrap(async(req,res)=>{
  const schema=z.object({workflowKey:z.string().min(1),payload:z.record(z.unknown()),applicant:z.string().max(100).optional()}).strict();
  const body=schema.parse(req.body);
  const result=await createRequest({...body,idempotencyKey:req.header('Idempotency-Key')});
  res.status(result.replayed?200:201).json(result);
}));
api.get('/requests',wrap(async(req,res)=>{
  const filter={}; if(req.query.status)filter.status=String(req.query.status);
  if(req.query.workflowKey)filter.workflowKey=String(req.query.workflowKey);
  const page=Math.max(1,Math.min(1000,Number(req.query.page)||1));
  const [items,total]=await Promise.all([Request.find(filter).sort({createdAt:-1}).skip((page-1)*20).limit(20).select('-definition').lean(),Request.countDocuments(filter)]);
  res.json({items,total,page,pageSize:20});
}));
api.get('/requests/:id',wrap(async(req,res)=>{checkId(req.params.id);const item=await Request.findById(req.params.id).lean();if(!item)throw new HttpError(404,'Request not found');res.json(item);}));
api.post('/requests/:id/review',wrap(async(req,res)=>{
  checkId(req.params.id);
  const body=z.object({decision:z.enum(['APPROVE','REJECT']),expectedStage:z.string().min(1),actor:z.string().min(2).max(100),comment:z.string().max(1000).optional()}).strict().parse(req.body);
  res.json(await review(req.params.id,body));
}));
api.post('/requests/:id/retry',wrap(async(req,res)=>{checkId(req.params.id);res.json(await retryRequest(req.params.id));}));
api.get('/stats',wrap(async(req,res)=>{
  const rows=await Request.aggregate([{$group:{_id:'$status',count:{$sum:1}}}]);
  res.json({total:rows.reduce((n,r)=>n+r.count,0),byStatus:Object.fromEntries(rows.map(r=>[r._id,r.count]))});
}));
export default api;
