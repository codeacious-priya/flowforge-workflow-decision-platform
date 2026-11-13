import mongoose from 'mongoose';
const eventSchema=new mongoose.Schema({at:{type:Date,default:Date.now},type:String,actor:String,detail:mongoose.Schema.Types.Mixed},{_id:false});
const schema=new mongoose.Schema({
  workflowKey:{type:String,required:true,index:true}, workflowVersion:{type:Number,required:true},
  definition:{type:mongoose.Schema.Types.Mixed,required:true},
  payload:{type:mongoose.Schema.Types.Mixed,required:true},
  applicant:{type:String,default:'demo-user'},
  idempotencyKey:{type:String,required:true},
  payloadHash:{type:String,required:true},
  status:{type:String,required:true,index:true},currentStage:{type:String,default:null},
  attempts:{type:Number,default:0},maxAttempts:{type:Number,default:3},
  nextRetryAt:{type:Date,default:null},error:{type:String,default:null},
  audit:{type:[eventSchema],default:[]},revision:{type:Number,default:0}
},{timestamps:true});
schema.index({workflowKey:1,idempotencyKey:1},{unique:true});
export default mongoose.model('Request',schema);
