
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RULE_ENGINE_VERSION = "2026.08.1";
const rank = { green:0, yellow:1, red:2 } as Record<string,number>;
const cats = [
 ["registration","State employer registration"],
 ["withholding","Payroll & withholding"],
 ["ui","Unemployment insurance"],
 ["workers_comp","Workers' compensation"],
 ["insurance_benefits","Insurance & benefits"],
 ["wage_hour","Wage & minimum-wage rules"],
 ["paid_leave","Paid leave"],
 ["notices","Required notices"],
 ["pay_transparency","Pay transparency"]
];

function worse(a:string,b:string){ return rank[a] >= rank[b] ? a : b; }
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{
 "Content-Type":"application/json","Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info"}})}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return json({ok:true});
 const auth=req.headers.get("Authorization");
 if(!auth) return json({error:"Unauthorized"},401);
 const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=auth.replace(/^Bearer\s+/i,"");
 const {data:u}=await admin.auth.getUser(token);
 if(!u.user) return json({error:"Unauthorized"},401);
 const {data:m}=await admin.from("company_memberships").select("company_id").eq("user_id",u.user.id).limit(1).maybeSingle();
 if(!m) return json({error:"No company membership"},403);
 const p=await req.json();
 let result:any;
 if(p.worker_type==="employee" || (p.worker_type==="intern" && p.extra?.paid===true)){
   const items:any[]=[]; let overall="green";
   for(const [category,label] of cats){
     const {data:r}=await admin.from("requirements").select("id").eq("state",p.worker_state).eq("category",category).maybeSingle();
     if(!r) return json({error:`Missing reviewed requirement: ${p.worker_state}/${category}`},422);
     const {data:v}=await admin.from("requirement_versions").select("*,sources(id,agency,title,url)")
       .eq("requirement_id",r.id).eq("approved",true).eq("active",true)
       .order("verified_at",{ascending:false}).limit(1).maybeSingle();
     if(!v) return json({error:`Missing approved version: ${p.worker_state}/${category}`},422);
     const item={id:category,label,status:v.status,requirement_version_id:v.id,
       requirement:v.requirement_text,action:v.action_text,responsible:v.responsible_role,
       deadline:v.deadline_text,verified_at:v.verified_at,source:v.sources};
     items.push(item); overall=worse(overall,v.status);
   }
   result={overall_status:overall,items};
 } else if(p.worker_type==="contractor" || p.worker_type==="freelancer"){
   const a=p.classification_answers||{}; let score=0; const flagged:string[]=[];
   const fs=[["control",2],["independence",2],["nature",2],["payment",2],["equipment",1],["other_clients",2],["duration",1]];
   for(const [k,w] of fs as any[]){if(a[k]){score+=w;flagged.push(k)}}
   let band=score<=3?"green":score<=7?"yellow":"red";
   const items=[{id:"classification",label:"Classification risk",status:band,
     requirement:`${flagged.length} structured factor(s) flagged.`,action:"Review flagged factors before finalizing.",
     flagged_factors:flagged}];
   const {data:o}=await admin.from("contractor_overlays").select("*,sources(id,agency,title,url)")
     .eq("state",p.worker_state).eq("approved",true).eq("active",true).order("verified_at",{ascending:false}).limit(1).maybeSingle();
   if(o && p.worker_state!==p.company_state){items.push({id:"state_overlay",label:`${p.worker_state} contractor overlay`,
     status:o.status,requirement:o.note_text,action:o.action_text,responsible:o.responsible_role,
     deadline:o.deadline_text,verified_at:o.verified_at,source:o.sources}); band=worse(band,o.status)}
   result={overall_status:band,items};
 } else {
   const status=p.worker_type==="intern" ? "red" : "yellow";
   result={overall_status:status,items:[{id:p.worker_type,label:`${p.worker_type} classification`,status,
     requirement:"This path requires a reviewed, fact-specific classification analysis.",
     action:"Get professional review before finalizing the relationship."}]};
 }
 const {data:saved,error}=await admin.from("hiring_cases").insert({
   company_id:m.company_id,created_by:u.user.id,worker_name:p.worker_name||null,role:p.role,
   company_state:p.company_state,worker_state:p.worker_state,worker_type:p.worker_type,
   arrangement:p.arrangement||null,employment_basis:p.employment_basis||null,
   compensation_text:p.compensation_text||null,start_date:p.start_date||null,
   overall_status:result.overall_status,rule_engine_version:RULE_ENGINE_VERSION,result_snapshot:result
 }).select("*").single();
 if(error) return json({error:error.message},500);
 await admin.from("case_events").insert({case_id:saved.id,company_id:m.company_id,created_by:u.user.id,
   event_type:"INITIAL_CHECK",event_data:{overall_status:result.overall_status,rule_engine_version:RULE_ENGINE_VERSION}});
 return json(saved);
});
