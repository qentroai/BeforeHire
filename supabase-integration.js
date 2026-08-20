
(async function(){
  const cfg = window.STATUTE_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR_")) return;

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);

  async function getSession(){
    const { data:{session} } = await sb.auth.getSession();
    return session;
  }

  const session = await getSession();
  if(!session){
    if(!location.pathname.endsWith("login.html")) location.href = "login.html";
    return;
  }

  // Add signed-in identity + sign out to the existing top bar.
  try{
    const {data:profile} = await sb.from("profiles").select("full_name").eq("id",session.user.id).single();
    const {data:membership} = await sb.from("company_memberships").select("company_id,companies(name)").eq("user_id",session.user.id).single();
    const topRight = document.querySelector(".topbar > div:last-child");
    if(topRight){
      const who = document.createElement("span");
      who.style.cssText="font-size:12px;color:var(--text-muted);margin-right:4px";
      who.textContent = `${profile?.full_name || session.user.email} · ${membership?.companies?.name || ""}`;
      const signout = document.createElement("button");
      signout.className="ghostBtn";
      signout.style.width="auto";
      signout.style.padding="0 10px";
      signout.textContent="Sign out";
      signout.onclick=async()=>{await sb.auth.signOut(); location.href="login.html";};
      topRight.appendChild(who);
      topRight.appendChild(signout);
    }
  }catch(e){ console.warn("Identity display failed",e); }

  async function callRunCheck(){
    const s = await getSession();
    if(!s) throw new Error("Please sign in again.");

    const classification_answers = {};
    try{
      if(typeof answers === "object" && answers){
        Object.entries(answers).forEach(([k,v])=>{
          classification_answers[k] = !!(v && Number(v.value) > 0);
        });
      }
    }catch(_){}

    const extra = {};
    try{
      extra.paid = subAnswers?.internPaid === "paid";
      extra.primary_beneficiary_clear = subAnswers?.internFactors === "yes";
      extra.equity_pct = Number(subAnswers?.equityPct || 0);
      extra.salary = subAnswers?.partnerSalary === "yes";
      extra.management_rights = subAnswers?.partnerMgmt === "yes";
      extra.cash_comp = subAnswers?.advisorComp === "cash";
      extra.hours_per_month = Number(subAnswers?.advisorHours || 0);
      extra.company_control = subAnswers?.advisorControl === "yes";
    }catch(_){}

    const payload = {
      worker_name: null,
      role: basics.role || "New hire",
      company_state: basics.companyState,
      worker_state: basics.workerState,
      worker_type: basics.workType,
      arrangement: basics.arrangement,
      employment_basis: basics.hoursBasis,
      compensation_text: basics.comp || null,
      start_date: basics.start || null,
      classification_answers,
      extra
    };

    const r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${cfg.EDGE_FUNCTION_NAME || "run-check"}`,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${s.access_token}`,
        "apikey":cfg.SUPABASE_PUBLISHABLE_KEY
      },
      body:JSON.stringify(payload)
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error || "Unable to save compliance file.");
    return data;
  }

  // Wrap original Save-to-Compliance-File function.
  if(typeof window.saveToProfile === "function"){
    const originalSave = window.saveToProfile;
    window.saveToProfile = async function(items, overall){
      try{
        const saved = await callRunCheck();
        const serverItems = saved.result_snapshot?.items || items;
        // Translate server result back into the ORIGINAL prototype's Compliance File model.
        profile = {
          name:(basics.role || "New hire") + " — " + (STATES[basics.workerState]?.name || basics.workerState),
          companyState:saved.company_state,
          workerState:saved.worker_state,
          workType:saved.worker_type,
          arrangement:saved.arrangement,
          hoursBasis:saved.employment_basis,
          role:saved.role,
          comp:saved.compensation_text || "",
          start:saved.start_date || "",
          band:saved.overall_status,
          items:serverItems.map(it=>({
            ...it,
            text:it.requirement || it.text || "",
            source:it.source?.agency || it.source || "",
            source_url:it.source?.url || "",
            action:it.action || "",
            responsible:it.responsible || "HR",
            deadline:it.deadline || "",
            done:false
          })),
          timeline:[{
            date:todayStr(),
            dotVar:BAND_META[saved.overall_status].colorVar,
            label:"Initial check",
            detail:`${cap(saved.overall_status)} — ${serverItems.filter(i=>i.status!=="green").length} item(s) need attention`
          }]
        };
        switchMode("track");
        renderTrack();
      }catch(e){
        alert(e.message || String(e));
      }
    };
  }

  // Load latest saved file into original Compliance File tab on sign-in.
  try{
    const {data:rows} = await sb.from("hiring_cases").select("*").order("created_at",{ascending:false}).limit(1);
    const c=rows?.[0];
    if(c){
      const its=c.result_snapshot?.items || [];
      profile = {
        name:c.worker_name || c.role || "Saved hire",
        companyState:c.company_state, workerState:c.worker_state, workType:c.worker_type,
        arrangement:c.arrangement, hoursBasis:c.employment_basis, role:c.role,
        comp:c.compensation_text || "", start:c.start_date || "", band:c.overall_status,
        items:its.map(it=>({...it,text:it.requirement||it.text||"",source:it.source?.agency||it.source||"",
          source_url:it.source?.url||"",responsible:it.responsible||"HR",deadline:it.deadline||"",done:false})),
        timeline:[{date:new Date(c.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
          dotVar:BAND_META[c.overall_status].colorVar,label:"Initial check",detail:"Saved in Supabase"}]
      };
    }
  }catch(e){ console.warn("Could not load latest saved case",e); }
})();
