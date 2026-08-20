
import csv, os, hashlib, time
from pathlib import Path
import requests
from bs4 import BeautifulSoup
from supabase import create_client

ROOT=Path(__file__).resolve().parents[1]
sb=create_client(os.environ["SUPABASE_URL"],os.environ["SUPABASE_SERVICE_ROLE_KEY"])
session=requests.Session()
session.headers.update({"User-Agent":"StatuteComplianceResearch/0.1 (human-reviewed legal research)"})

def clean(html):
    soup=BeautifulSoup(html,"html.parser")
    for t in soup(["script","style","noscript","svg"]): t.decompose()
    return "\n".join(x.strip() for x in soup.get_text("\n").splitlines() if x.strip())

def sha(s): return hashlib.sha256(s.encode()).hexdigest()

rows=list(csv.DictReader((ROOT/"data/source_registry.csv").open(encoding="utf-8")))
stats={"fetched":0,"skipped":0,"failed":0}
for row in rows:
    url=row["official_url"].strip()
    if not url:
        stats["skipped"]+=1;print("SKIP",row["state"],row["category"],"blank URL");continue
    srcs=sb.table("sources").select("*").eq("url",url).execute().data
    payload={"state":row["state"],"category":row["category"],"agency":row["agency"] or "REVIEW","title":row["source_title"],"url":url,"active":True}
    if srcs:
        src=srcs[0];sb.table("sources").update(payload).eq("id",src["id"]).execute()
    else: src=sb.table("sources").insert(payload).execute().data[0]
    try:
        r=session.get(url,timeout=30,allow_redirects=True)
        text=clean(r.text) if "html" in (r.headers.get("content-type") or "").lower() else r.text[:500000]
        h=sha(text)
        prev=sb.table("source_snapshots").select("content_hash").eq("source_id",src["id"]).order("retrieved_at",desc=True).limit(1).execute().data
        changed=True if not prev else prev[0]["content_hash"]!=h
        sb.table("source_snapshots").insert({"source_id":src["id"],"http_status":r.status_code,"content_hash":h,"cleaned_text":text[:1000000],"changed_from_previous":changed,"review_needed":changed}).execute()
        stats["fetched"]+=1;print("OK",row["state"],row["category"],r.status_code,"CHANGED" if changed else "unchanged")
    except Exception as e:
        sb.table("source_snapshots").insert({"source_id":src["id"],"fetch_error":str(e)[:2000],"review_needed":True}).execute()
        stats["failed"]+=1;print("FAIL",row["state"],row["category"],e)
    time.sleep(.75)
print(stats)
