// ====== CONFIG ======
const SETTINGS_URL = "https://raw.githubusercontent.com/katpally123/attendance-dashboard/main/config/settings.json";

// ====== State ======
let SETTINGS = null;
// Force DA to appear in tables, always in this order:
const ORDER = ["Inbound","DA","ICQA","CRETs"];

// ====== Boot ======
fetch(SETTINGS_URL)
  .then(r => { if(!r.ok) throw new Error("settings.json fetch failed"); return r.json(); })
  .then(cfg => { SETTINGS = cfg; ensureDABucket(); initUI(); })
  .catch(e => { console.error(e); alert("Couldn't load settings.json"); });

// Ensure DA exists even if settings.json doesn't list it yet
function ensureDABucket(){
  SETTINGS.departments = SETTINGS.departments || {};
  if (!SETTINGS.departments.DA) {
    SETTINGS.departments.DA = { "dept_ids": ["1211030","1211040","1299030","1299040"] };
  }
}

// ====== Elements ======
const dateEl   = document.getElementById("dateInput");
const shiftEl  = document.getElementById("shiftInput");
const newHireEl= document.getElementById("excludeNewHires");
const rosterEl = document.getElementById("rosterFile");
const mytimeEl = document.getElementById("mytimeFile");
const vacEl    = document.getElementById("vacFile");
const codesEl  = document.getElementById("shiftCodes");
const processBtn = document.getElementById("processBtn");
const fileStatus = document.getElementById("fileStatus");

const summaryChips  = document.getElementById("summaryChips");
const expectedNote  = document.getElementById("expectedNote");
const expectedTable = document.getElementById("expectedTable");
const presentTable  = document.getElementById("presentTable");

// Tabs
document.querySelectorAll(".tab").forEach(b=>{
  b.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".tabpane").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    document.getElementById(b.dataset.tab).classList.add("active");
  });
});

// ====== UI init ======
function initUI(){
  const today = new Date();
  dateEl.value = today.toISOString().slice(0,10);
  shiftEl.value = "Day";
  renderShiftCodes();
  dateEl.addEventListener("change", renderShiftCodes);
  shiftEl.addEventListener("change", renderShiftCodes);
}

// ====== Helpers ======
function toDayName(iso){ if(!iso) return "Monday"; return new Date(iso+"T00:00:00").toLocaleDateString("en-US",{weekday:"long"}); }
function first2(s){ return (s||"").slice(0,2); }
function firstAndThird(s){ return (s?.length>=3) ? s[0]+s[2] : ""; }
function canon(s){ return String(s||"").trim().toLowerCase().replace(/\s+/g," ").replace(/[^\w? ]/g,""); }
function normalizeId(v){
  const t = String(v??"").trim();
  const digits = t.replace(/\D/g,"");
  const noLead = digits.replace(/^0+/,"");
  return noLead || t;
}
function parseDateLoose(s){ const d = new Date(s); return isNaN(d) ? null : d; }
function classifyEmpType(v){
  const x = canon(v);
  if (!x) return "UNKNOWN";
  if (/(amzn|amazon|blue badge|bb|fte|full time|part time|pt)\b/.test(x)) return "AMZN";
  if (/(temp|temporary|seasonal|agency|vendor|contract|white badge|wb|csg|adecco|randstad)/.test(x)) return "TEMP";
  if (x==="temp") return "TEMP";
  if (x==="amzn") return "AMZN";
  return "UNKNOWN";
}
function findKey(row, candidates){
  const keys = Object.keys(row||{});
  const wanted = candidates.map(canon);
  for (const k of keys){ const ck = canon(k); if (wanted.includes(ck)) return k; }
  for (const k of keys){ const ck = canon(k).replace(/\?/g,""); if (wanted.includes(ck)) return k; }
  return null;
}
function renderShiftCodes(){
  if (!SETTINGS) return;
  const dayName = toDayName(dateEl.value);
  const shift = shiftEl.value;
  const codes = (SETTINGS.shift_schedule?.[shift]?.[dayName]) || [];
  codesEl.innerHTML = `Shifts for <b>${dayName}</b> — <b>${shift}</b>: ${codes.map(c=>`<code>${c}</code>`).join(" ")}`;
}
function sumBlock(block){
  const acc = {AMZN:0, TEMP:0, TOTAL:0};
  for (const k of Object.keys(block)){
    acc.AMZN += block[k].AMZN; acc.TEMP += block[k].TEMP; acc.TOTAL += block[k].TOTAL;
  }
  return acc;
}
function renderTables(expected, present){
  const header = `
    <thead><tr>
      <th>Department</th><th class="right">AMZN</th><th class="right">TEMP</th><th class="right">TOTAL</th>
    </tr></thead>`;
  const row = v => `<tr><td>${v[0]}</td><td class="right">${v[1].AMZN}</td><td class="right">${v[1].TEMP}</td><td class="right">${v[1].TOTAL}</td></tr>`;

  const rowsExp = Object.entries(expected).map(row).join("");
  const totalsExp = sumBlock(expected);
  expectedTable.innerHTML = header + `<tbody>${rowsExp}</tbody>
    <tfoot><tr><td>Total</td><td class="right">${totalsExp.AMZN}</td><td class="right">${totalsExp.TEMP}</td><td class="right">${totalsExp.TOTAL}</td></tr></tfoot>`;

  const rowsPre = Object.entries(present).map(row).join("");
  const totalsPre = sumBlock(present);
  presentTable.innerHTML = header + `<tbody>${rowsPre}</tbody>
    <tfoot><tr><td>Total</td><td class="right">${totalsPre.AMZN}</td><td class="right">${totalsPre.TEMP}</td><td class="right">${totalsPre.TOTAL}</td></tr></tfoot>`;
}
function renderChips(expected, present, dayName, shift, codes, vacExcluded){
  const exp = sumBlock(expected).TOTAL;
  const pre = sumBlock(present).TOTAL;
  const pct = exp ? ((pre/exp)*100).toFixed(1) : "0.0";
  summaryChips.innerHTML = `
    <span class="chip">Day: <b>${dayName}</b></span>
    <span class="chip">Shift: <b>${shift}</b></span>
    <span class="chip">Corners: ${codes.map(c=>`<code>${c}</code>`).join(" ")}</span>
    <span class="chip">Expected Total: <b>${exp}</b></span>
    <span class="chip ${pre>=exp?'ok':'warn'}">Present Total: <b>${pre}</b> (${pct}%)</span>
    ${vacExcluded!=null ? `<span class="chip">Vacation excluded: <b>${vacExcluded}</b></span>` : ""}
  `;
}

// CSV parsing
function parseCSVFile(file, opts={header:true, skipFirstLine:false}){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error("Failed to read file"));
    reader.onload = () => {
      let text = reader.result;
      if (opts.skipFirstLine){
        const i = text.indexOf("\n");
        text = i>=0 ? text.slice(i+1) : text;
      }
      Papa.parse(text, {
        header: opts.header,
        skipEmptyLines: true,
        transformHeader: h => h.trim(),
        complete: res => resolve(res.data)
      });
    };
    reader.readAsText(file);
  });
}

// HH:MM → decimal hours
function toHours(val) {
  const t = String(val ?? "").trim();
  if (!t) return 0;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return parseInt(m[1],10) + parseInt(m[2],10)/60;
  const cleaned = t.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// ====== PROCESS ======
processBtn.addEventListener("click", async ()=>{
  if (!SETTINGS){ alert("Settings not loaded yet. Try again."); return; }
  const dayName = toDayName(dateEl.value);
  if (!dateEl.value){ alert("Pick a date."); return; }
  if (!rosterEl.files[0] || !mytimeEl.files[0]){ alert("Upload both Roster CSV and MyTime CSV."); return; }

  const shift = shiftEl.value;
  const codes = SETTINGS.shift_schedule?.[shift]?.[dayName] || [];
  if (!codes.length){ alert("No shift codes configured for that selection."); return; }

  fileStatus.textContent = "Parsing files…";

  try {
    const [rosterRaw, mytimeRaw] = await Promise.all([
      parseCSVFile(rosterEl.files[0], {header:true}),
      parseCSVFile(mytimeEl.files[0], {header:true, skipFirstLine:true})
    ]);

    // Vacation (optional)
    let vacIds = new Set(), vacRowsCount = 0;
    if (vacEl.files[0]) {
      const vacText = await vacEl.files[0].text();

      // detect header row (first line containing Employee/Person id)
      const lines = vacText.split(/\r?\n/).filter(l => l.trim().length);
      let headerIndex = 0;
      for (let i = 0; i < Math.min(50, lines.length); i++) {
        if (/(employee id|person id|person number)/i.test(lines[i])) { headerIndex = i; break; }
      }

      const vacRaw = await new Promise(resolve=>{
        Papa.parse(vacText, {
          header: true,
          skipEmptyLines: true,
          transformHeader: h => (h||"").trim(),
          beforeFirstChunk: chunk => {
            const arr = chunk.split(/\r?\n/);
            return arr.slice(headerIndex).join("\n");
          },
          complete: res => {
            const rows = res.data.map(r=>{
              Object.keys(r).forEach(k=>{ if (/^Unnamed/.test(k)) delete r[k]; });
              return r;
            });
            resolve(rows);
          }
        });
      });
      vacRowsCount = vacRaw.length;

      const sampleV = vacRaw[0] || {};
      const V_ID    = findKey(sampleV, ["Employee ID","Person ID","Person Number","Badge ID","ID"]) || "Employee ID";
      const V_DATE  = findKey(sampleV, ["Date","Worked Date","Shift Date","Business Date"]);
      const V_VAC   = findKey(sampleV, ["Vacation","Vacation Hours"]);
      const V_VACU  = findKey(sampleV, ["Vacation Unpaid","Vacation (Unpaid)","Vacation Unpaid Hours"]);
      const V_HOURS = findKey(sampleV, ["Hours","Total Hours","Qty","Quantity"]);
      const V_CODE1 = findKey(sampleV, ["Pay Code","PayCode","Earning Code"]);
      const V_CODE2 = findKey(sampleV, ["Absence Name","Absence Type","Time Off Type","Time-Off Type","Category"]);

      const selectedISO = dateEl.value;
      const sameDay = (val) => {
        if (!V_DATE) return true;            // some exports are single-day
        const d = new Date(val); if (isNaN(d)) return false;
        return d.toISOString().slice(0,10) === selectedISO;
      };

      // Wide-column strategy
      const vacIdsA = new Set();
      if (V_VAC || V_VACU) {
        for (const row of vacRaw) {
          const idRaw = row[V_ID];
          if (!idRaw || !sameDay(row[V_DATE])) continue;
          const a = V_VAC ? toHours(row[V_VAC]) : 0;
          const b = V_VACU? toHours(row[V_VACU]): 0;
          if ((a+b)>0){
            const id = String(idRaw).replace(/\D/g,"").replace(/^0+/,"");
            if (id) vacIdsA.add(id);
          }
        }
      }
      // Code+hours strategy
      const vacIdsB = new Set();
      if ((V_CODE1 || V_CODE2) && V_HOURS) {
        for (const row of vacRaw) {
          const idRaw = row[V_ID];
          if (!idRaw || !sameDay(row[V_DATE])) continue;
          const label = String(row[V_CODE1 || V_CODE2] || "").toLowerCase();
          const hrs = toHours(row[V_HOURS]);
          if (/vac/.test(label) && hrs > 0) {
            const id = String(idRaw).replace(/\D/g,"").replace(/^0+/,"");
            if (id) vacIdsB.add(id);
          }
        }
      }
      vacIds = new Set([...vacIdsA, ...vacIdsB]);

      expectedNote.textContent = `Expected = Corner-filtered cohort − Vacation exclusions. Vacation excluded: ${vacIds.size}`;
    } else {
      expectedNote.textContent = `Expected = Corner-filtered cohort (no vacation file uploaded).`;
    }

    // Resolve roster headers
    const r0 = rosterRaw[0] || {};
    const R_EMP   = findKey(r0, ["Employee ID","Person Number","Person ID","Badge ID"]);
    const R_DEPT  = findKey(r0, ["Department ID","Home Department ID","Dept ID"]);
    const R_AREA  = findKey(r0, ["Management Area ID","Mgmt Area ID","Area ID","Area"]);
    const R_TYPE  = findKey(r0, ["Employment Type","Associate Type","Worker Type","Badge Type","Company"]);
    const R_SP    = findKey(r0, ["Shift Pattern","Schedule Pattern","Shift"]);
    const R_CORNER= findKey(r0, ["Corner","Corner Code"]);
    const R_START = findKey(r0, ["Employment Start Date","Hire Date","Start Date"]);
    if (!R_EMP || !R_DEPT || !(R_SP || R_CORNER)) throw new Error("Missing roster cols (Employee ID, Department ID, Shift Pattern/Corner).");

    // Resolve MyTime headers
    const m0 = mytimeRaw[0] || {};
    const M_PERSON = findKey(m0, ["Person ID","Employee ID","Person Number","ID"]);
    const M_ONPREM = findKey(m0, ["On Premises","On Premises?","OnPremises"]);
    if (!M_PERSON || !M_ONPREM) throw new Error("Missing MyTime cols (Person ID / On Premises).");

    // Build On-Prem map
    const presentMarkers = {};
    const onPremMap = new Map();
    for (const row of mytimeRaw){
      const pid = normalizeId(row[M_PERSON]);
      const val = String(row[M_ONPREM] ?? "").trim().toUpperCase();
      presentMarkers[val] = (presentMarkers[val]||0)+1;
      const isOnPrem = (SETTINGS.present_markers || ["X"]).includes(val);
      if (pid) onPremMap.set(pid, (onPremMap.get(pid) || false) || isOnPrem);
    }

    // Enrich roster
    const rosterEnriched = rosterRaw.map(r => {
      const empId  = normalizeId(r[R_EMP]);
      const deptId = String(r[R_DEPT] ?? "").trim();
      const areaId = String((R_AREA? r[R_AREA] : "") ?? "").trim();
      const empType= classifyEmpType(r[R_TYPE]);
      const sp     = String((R_SP? r[R_SP] : "") ?? "");
      const corner = R_CORNER ? String(r[R_CORNER] ?? "").trim() : first2(sp);
      const met    = firstAndThird(sp);
      const start  = R_START ? parseDateLoose(r[R_START]) : null;
      const onPrem = onPremMap.get(empId) === true;
      const vac    = vacIds.has(empId);
      return { empId, deptId, areaId, empType, sp, corner, met, start, onPrem, vac };
    });

    // Corner filter
    let filtered = rosterEnriched.filter(x => codes.includes(x.corner));

    // New hires exclusion
    if (newHireEl.checked){
      const dayStart = new Date(dateEl.value+"T00:00:00");
      filtered = filtered.filter(x => {
        if (!x.start) return true;
        const diffDays = Math.floor((dayStart - x.start)/(1000*60*60*24));
        return diffDays >= 3;
      });
    }

    // Net expected (exclude vacations)
    const expectedCohort = filtered.filter(x => !x.vac);
    const vacExcludedCount = filtered.length - expectedCohort.length;

    // Buckets (Inbound excludes DA)
    const cfg = SETTINGS.departments;
    const DA_IDS = cfg.DA.dept_ids;
    const inboundMinusDA = x => cfg.Inbound.dept_ids.includes(x.deptId) && !DA_IDS.includes(x.deptId);
    const belongsDA      = x => DA_IDS.includes(x.deptId);
    const belongsICQA    = x => cfg.ICQA.dept_ids.includes(x.deptId) && x.areaId === cfg.ICQA.management_area_id;
    const belongsCRETs   = x => cfg.CRETs.dept_ids.includes(x.deptId) && x.areaId === cfg.CRETs.management_area_id;

    const group = (rows, pred) => rows.filter(pred);

    // Expected (after vacation)
    const expGroups = {
      Inbound: group(expectedCohort, inboundMinusDA),
      DA:      group(expectedCohort, belongsDA),
      ICQA:    group(expectedCohort, belongsICQA),
      CRETs:   group(expectedCohort, belongsCRETs)
    };
    // Present (MyTime)
    const preGroups = {
      Inbound: group(filtered, x => inboundMinusDA(x) && x.onPrem),
      DA:      group(filtered, x => belongsDA(x)      && x.onPrem),
      ICQA:    group(filtered, x => belongsICQA(x)    && x.onPrem),
      CRETs:   group(filtered, x => belongsCRETs(x)   && x.onPrem)
    };

    const countByType = rows => {
      const amzn = rows.filter(x => x.empType==="AMZN").length;
      const temp = rows.filter(x => x.empType==="TEMP").length;
      return { AMZN: amzn, TEMP: temp, TOTAL: amzn+temp };
    };

    const expected = {
      Inbound: countByType(expGroups.Inbound),
      DA:      countByType(expGroups.DA),
      ICQA:    countByType(expGroups.ICQA),
      CRETs:   countByType(expGroups.CRETs),
    };
    const present = {
      Inbound: countByType(preGroups.Inbound),
      DA:      countByType(preGroups.DA),
      ICQA:    countByType(preGroups.ICQA),
      CRETs:   countByType(preGroups.CRETs),
    };

    // Render
    const ordered = obj => Object.fromEntries(ORDER.map(k=>[k, obj[k]]));
    renderTables(ordered(expected), ordered(present));
    renderChips(expected, present, dayName, shift, codes, vacExcludedCount);
    fileStatus.textContent = "Done.";

    // ====== AUDIT (Verify + CSV) ======
    const tagDept = (x)=>{
      if (belongsDA(x)) return "DA";
      if (inboundMinusDA(x)) return "Inbound";
      if (belongsICQA(x)) return "ICQA";
      if (belongsCRETs(x)) return "CRETs";
      return "Other";
    };

    const auditRows = filtered.map(x=>({
      empId: x.empId, empType: x.empType, deptId: x.deptId, areaId: x.areaId,
      corner: x.corner, onPrem: x.onPrem ? "YES" : "NO", vac: x.vac ? "YES" : "NO",
      bucket: tagDept(x),
    }));

    const sampleOf = (rows, pred)=> rows.filter(pred).slice(0,200);
    const samples = {
      Inbound: {
        "exp-amzn": sampleOf(expGroups.Inbound, r=>r.empType==="AMZN"),
        "exp-temp": sampleOf(expGroups.Inbound, r=>r.empType==="TEMP"),
        "exp-tot":  expGroups.Inbound.slice(0,200),
        "pre-amzn": sampleOf(preGroups.Inbound, r=>r.empType==="AMZN"),
        "pre-temp": sampleOf(preGroups.Inbound, r=>r.empType==="TEMP"),
        "pre-tot":  preGroups.Inbound.slice(0,200)
      },
      DA: {
        "exp-amzn": sampleOf(expGroups.DA, r=>r.empType==="AMZN"),
        "exp-temp": sampleOf(expGroups.DA, r=>r.empType==="TEMP"),
        "exp-tot":  expGroups.DA.slice(0,200),
        "pre-amzn": sampleOf(preGroups.DA, r=>r.empType==="AMZN"),
        "pre-temp": sampleOf(preGroups.DA, r=>r.empType==="TEMP"),
        "pre-tot":  preGroups.DA.slice(0,200)
      },
      ICQA: {
        "exp-amzn": sampleOf(expGroups.ICQA, r=>r.empType==="AMZN"),
        "exp-temp": sampleOf(expGroups.ICQA, r=>r.empType==="TEMP"),
        "exp-tot":  expGroups.ICQA.slice(0,200),
        "pre-amzn": sampleOf(preGroups.ICQA, r=>r.empType==="AMZN"),
        "pre-temp": sampleOf(preGroups.ICQA, r=>r.empType==="TEMP"),
        "pre-tot":  preGroups.ICQA.slice(0,200)
      },
      CRETs: {
        "exp-amzn": sampleOf(expGroups.CRETs, r=>r.empType==="AMZN"),
        "exp-temp": sampleOf(expGroups.CRETs, r=>r.empType==="TEMP"),
        "exp-tot":  expGroups.CRETs.slice(0,200),
        "pre-amzn": sampleOf(preGroups.CRETs, r=>r.empType==="AMZN"),
        "pre-temp": sampleOf(preGroups.CRETs, r=>r.empType==="TEMP"),
        "pre-tot":  preGroups.CRETs.slice(0,200)
      }
    };

    renderVerify({
      day: dayName,
      shift,
      presentMarkers: SETTINGS.present_markers || ["X"],
      rosterRows: rosterRaw.length,
      mytimeRows: mytimeRaw.length,
      vacRows: vacRowsCount,
      vacExcluded: vacExcludedCount,
      rosterEnriched: filtered.length,
      afterCorner: filtered.length,
      idMatches: (filtered.filter(x => x.empId && (x.onPrem===true || x.onPrem===false))).length,
      byDept: {
        Inbound: {expected: expected.Inbound, present: present.Inbound},
        DA:      {expected: expected.DA,      present: present.DA},
        ICQA:    {expected: expected.ICQA,    present: present.ICQA},
        CRETs:   {expected: expected.CRETs,   present: present.CRETs}
      },
      samples,
      auditRows
    });

  } catch (err){
    console.error(err);
    fileStatus.textContent = "Error processing files. Check CSV headers and try again.";
    alert(err.message || "Error processing files.");
  }
});

// ====== VERIFY UI ======
function renderVerify(stats) {
  const el = document.getElementById("verify");
  if (!el) return;

  const pill = (k,v) => `<span class="chip"><b>${k}</b>: ${v}</span>`;
  const row = (name, obj, key) => `
    <tr>
      <td>${name}</td>
      <td class="right"><a href="#" data-key="${key}" data-type="exp-amzn">${obj.expected.AMZN}</a></td>
      <td class="right"><a href="#" data-key="${key}" data-type="exp-temp">${obj.expected.TEMP}</a></td>
      <td class="right"><a href="#" data-key="${key}" data-type="exp-tot">${obj.expected.TOTAL}</a></td>
      <td class="right"><a href="#" data-key="${key}" data-type="pre-amzn">${obj.present.AMZN}</a></td>
      <td class="right"><a href="#" data-key="${key}" data-type="pre-temp">${obj.present.TEMP}</a></td>
      <td class="right"><a href="#" data-key="${key}" data-type="pre-tot">${obj.present.TOTAL}</a></td>
    </tr>`;

  el.innerHTML = `
    <div class="chips">
      ${pill("Roster rows", stats.rosterRows)}
      ${pill("MyTime rows", stats.mytimeRows)}
      ${pill("Vacation rows", stats.vacRows)}
      ${pill("Vacation excluded", stats.vacExcluded)}
      ${pill("ID matches", `${stats.idMatches} / ${stats.rosterEnriched}`)}
      ${pill("Corner filter", `${stats.afterCorner} rows`)}
      ${pill("Present markers", stats.presentMarkers.join(" / "))}
    </div>
    <h4>Drill-down (click any number)</h4>
    <table class="table">
      <thead>
        <tr>
          <th>Dept</th>
          <th class="right">Exp AMZN</th><th class="right">Exp TEMP</th><th class="right">Exp TOTAL</th>
          <th class="right">Pre AMZN</th><th class="right">Pre TEMP</th><th class="right">Pre TOTAL</th>
        </tr>
      </thead>
      <tbody>
        ${row("Inbound", stats.byDept.Inbound, "Inbound")}
        ${row("DA",      stats.byDept.DA,      "DA")}
        ${row("ICQA",    stats.byDept.ICQA,    "ICQA")}
        ${row("CRETs",   stats.byDept.CRETs,   "CRETs")}
      </tbody>
    </table>
    <div id="drill" class="mt"></div>
  `;

  el.querySelectorAll("a[data-key]").forEach(a=>{
    a.addEventListener("click", ev=>{
      ev.preventDefault();
      const key = a.dataset.key, type = a.dataset.type;
      const sample = stats.samples[key][type] || [];
      const drill = document.getElementById("drill");
      drill.innerHTML = `
        <div class="card">
          <b>${key} → ${type}</b>
          <pre>${sample.slice(0,50).map(x=>`${x.empId} | ${x.empType} | dept=${x.deptId} area=${x.areaId} | corner=${x.corner} | onPrem=${x.onPrem} | vac=${x.vac ? "YES" : "NO"}`).join("\n") || "(no rows)"}</pre>
        </div>`;
    });
  });

  // Download CSV
  const dl = document.getElementById("downloadAudit");
  if (dl) dl.onclick = ()=>{
    const rows = stats.auditRows;
    if (!rows || !rows.length) return alert("No audit rows to download.");
    const headers = Object.keys(rows[0]);
    const escape = v => `"${String(v??"").replace(/"/g,'""')}"`;
    const csv = [headers.join(","), ...rows.map(r=>headers.map(h=>escape(r[h])).join(","))].join("\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `audit_${stats.day}_${stats.shift}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
}
