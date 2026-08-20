
import csv, os
from pathlib import Path
from datetime import datetime, timezone
from supabase import create_client
ROOT=Path(__file__).resolve().parents[1]
sb=create_client(os.environ["SUPABASE_URL"],os.environ["SUPABASE_SERVICE_ROLE_KEY"])
rows=list(csv.DictReader((ROOT/"data/reviewed_requirements.csv").open(encoding="utf-8")))
count=0
for x in rows:
    st=x["state"].strip(); cat=x["category"].strip(); status=x["status"].strip(); text=x["requirement_text"].strip(); url=x["official_url"].strip()
    if not status or not text or not url:
        print("SKIP",st,cat); continue
    if status not in {"green","yellow","red"}: raise ValueError(f"{st}/{cat}: invalid status")
    srcs=sb.table("sources").select("*").eq("url",url).execute().data
    src=srcs[0] if srcs else sb.table("sources").insert({"state":st,"category":cat,"agency":x["agency"].strip() or "REVIEW","title":x["source_title"].strip(),"url":url,"active":True}).execute().data[0]
    reqs=sb.table("requirements").select("*").eq("state",st).eq("category",cat).execute().data
    req=reqs[0] if reqs else sb.table("requirements").insert({"state":st,"category":cat}).execute().data[0]
    sb.table("requirement_versions").update({"active":False}).eq("requirement_id",req["id"]).eq("active",True).execute()
    sb.table("requirement_versions").insert({
      "requirement_id":req["id"],"source_id":src["id"],"status":status,"requirement_text":text,
      "action_text":x["action_text"].strip() or None,"responsible_role":x["responsible_role"].strip() or None,
      "deadline_text":x["deadline_text"].strip() or None,"effective_from":x["effective_from"].strip() or None,
      "effective_to":x["effective_to"].strip() or None,"verified_at":x["verified_at"].strip() or datetime.now(timezone.utc).isoformat(),
      "approved":True,"active":True}).execute()
    count+=1;print("IMPORTED",st,cat)
print("Imported",count)
