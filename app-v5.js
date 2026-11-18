"use strict";
// レシート仕分け（独立版）
// データ: Supabase（receipts テーブル + receipts バケット）
// AI読み取り: ブラウザから Google Gemini API を直接呼ぶ（キーは localStorage のみ）

const CATEGORIES = [
  "ガソリン代", "租税公課", "電気代", "ガス代", "水道代", "通信費", "広告宣伝費",
  "接待交際費", "損害保険料", "修繕費・外注工賃", "消耗品費", "福利厚生費・研修費",
  "給料・賃金", "地代・家賃", "雑費"
];
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
const LS_KEY = "receipt_app_gemini_key";

const cfg = window.RECEIPT_APP_CONFIG || {};
let sb = null;
if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
}

const $ = (id) => document.getElementById(id);
const state = { user: null, editingId: null, editingImagePath: null, imageFile: null, transferRows: null, transferMeta: null };

function yen(n) { return Number(n || 0).toLocaleString("ja-JP") + "円"; }
function ymOf(dateStr) { return (dateStr || "").slice(0, 7); } // YYYY-MM
function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const start = `${ym}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, endExclusive: next };
}
function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fillCategorySelects() {
  for (const sel of [$("fCategory"), $("listCategory")]) {
    const keep = sel.value;
    if (sel.id === "fCategory") sel.innerHTML = "";
    else sel.querySelectorAll("option[data-cat]").forEach((o) => o.remove());
    for (const c of CATEGORIES) {
      const o = document.createElement("option");
      o.value = c; o.textContent = c; o.dataset.cat = "1";
      sel.appendChild(o);
    }
    if (keep) sel.value = keep;
  }
}

// ---------- 認証 ----------
async function refreshSession() {
  if (!sb) { showLogin("config.js に Supabase の URL と anon key を設定してください（SETUP.md参照）。"); return; }
  const { data } = await sb.auth.getSession();
  state.user = data.session ? data.session.user : null;
  if (state.user) showApp(); else showLogin("");
}
function showLogin(msg) {
  $("loginView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");
  $("userEmail").textContent = "";
  $("loginError").textContent = msg || "";
}
async function showApp() {
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  $("userEmail").textContent = state.user.email || "";
  const ym = currentYm();
  $("listMonth").value = ym; $("sumMonth").value = ym;
  $("homeMonthLabel").textContent = ym;
  await loadHome(); await loadList(); await loadSummary();
}
$("loginBtn").addEventListener("click", async () => {
  if (!sb) return;
  $("loginBtn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $("loginEmail").value.trim(),
    password: $("loginPassword").value
  });
  $("loginBtn").disabled = false;
  if (error) { $("loginError").textContent = "ログインできませんでした: " + error.message; return; }
  await refreshSession();
});
$("logoutBtn").addEventListener("click", async () => { if (sb) await sb.auth.signOut(); await refreshSession(); });
if (sb) sb.auth.onAuthStateChange(() => refreshSession());

// ---------- タブ ----------
document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    for (const t of ["home", "list", "summary", "settings"]) {
      $("tab-" + t).classList.toggle("hidden", t !== b.dataset.tab);
    }
  });
});

// ---------- データ取得 ----------
async function fetchMonth(ym) {
  const { start, endExclusive } = monthRange(ym);
  const { data, error } = await sb.from("receipts")
    .select("*")
    .gte("receipt_date", start).lt("receipt_date", endExclusive)
    .order("receipt_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function signedUrl(path) {
  if (!path) return "";
  const { data } = await sb.storage.from("receipts").createSignedUrl(path, 3600);
  return data ? data.signedUrl : "";
}
function receiptItemHtml(r, imgUrl) {
  const badge = r.confirmed ? '<span class="badge confirmed">確認済み</span>' : '<span class="badge unconfirmed">未確認</span>';
  return `<div class="item" data-id="${r.id}">
    ${imgUrl ? `<img src="${imgUrl}" alt="">` : `<img alt="">`}
    <div class="grow"><div><b>${r.store_name || "(店名なし)"}</b> ${badge}</div>
    <div class="muted">${r.receipt_date} ／ ${r.category} ／ ${r.usage}</div>
    <div class="muted">${(r.items_text || "").slice(0, 60)}</div></div>
    <div class="amt">${yen(r.amount)}</div></div>`;
}
async function renderListInto(el, rows) {
  const parts = [];
  for (const r of rows) parts.push(receiptItemHtml(r, await signedUrl(r.image_path)));
  el.innerHTML = parts.length ? parts.join("") : '<p class="muted">この条件のレシートはありません。</p>';
  el.querySelectorAll(".item").forEach((it) => it.addEventListener("click", () => startEdit(it.dataset.id)));
}

// ---------- ホーム ----------
async function loadHome() {
  const ym = currentYm();
  const rows = await fetchMonth(ym);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  $("homeTotal").textContent = yen(total);
  $("homeCount").textContent = rows.length;
  $("homeUnconfirmed").textContent = rows.filter((r) => !r.confirmed).length;
  await renderListInto($("homeRecent"), rows.slice(0, 5));
}

// ---------- 一覧 ----------
async function loadList() {
  const ym = $("listMonth").value || currentYm();
  let rows = await fetchMonth(ym);
  const cat = $("listCategory").value;
  const q = $("listSearch").value.trim();
  const uncOnly = $("listUnconfirmedOnly").checked;
  if (cat) rows = rows.filter((r) => r.category === cat);
  if (q) rows = rows.filter((r) => (r.store_name || "").includes(q));
  if (uncOnly) rows = rows.filter((r) => !r.confirmed);
  $("listInfo").textContent = `${ym}：${rows.length}件 ／ 合計 ${yen(rows.reduce((s, r) => s + r.amount, 0))}（月はレシートの日付で振り分け）`;
  await renderListInto($("listBody"), rows);
}
for (const id of ["listMonth", "listCategory", "listSearch", "listUnconfirmedOnly"]) {
  $(id).addEventListener("change", loadList);
  if (id === "listSearch") $(id).addEventListener("input", loadList);
}

// ---------- 登録・編集・削除 ----------
$("fImage").addEventListener("change", () => {
  state.imageFile = $("fImage").files[0] || null;
  if (state.imageFile) {
    const url = URL.createObjectURL(state.imageFile);
    $("fPreview").src = url; $("fPreview").classList.remove("hidden");
  }
  updateAiNote();
});
function resetForm() {
  state.editingId = null; state.editingImagePath = null; state.imageFile = null;
  $("formTitle").textContent = "レシートを追加";
  for (const id of ["fDate", "fAmount", "fStore", "fItems", "fMemo"]) $(id).value = "";
  $("fDate").value = new Date().toISOString().slice(0, 10);
  $("fCategory").value = "雑費"; $("fUsage").value = "未確認"; $("fConfirmed").checked = false;
  $("fImage").value = ""; $("fPreview").classList.add("hidden"); $("fPreview").src = "";
  $("cancelEditBtn").classList.add("hidden"); $("deleteBtn").classList.add("hidden");
  $("formMsg").textContent = ""; updateAiNote();
}
async function startEdit(id) {
  const { data, error } = await sb.from("receipts").select("*").eq("id", id).single();
  if (error || !data) return;
  state.editingId = data.id; state.editingImagePath = data.image_path; state.imageFile = null;
  $("formTitle").textContent = "レシートを編集";
  $("fDate").value = data.receipt_date; $("fAmount").value = data.amount;
  $("fStore").value = data.store_name; $("fItems").value = data.items_text || "";
  $("fCategory").value = data.category; $("fUsage").value = data.usage;
  $("fMemo").value = data.memo || ""; $("fConfirmed").checked = !!data.confirmed;
  $("fImage").value = "";
  const url = await signedUrl(data.image_path);
  if (url) { $("fPreview").src = url; $("fPreview").classList.remove("hidden"); }
  else $("fPreview").classList.add("hidden");
  $("cancelEditBtn").classList.remove("hidden"); $("deleteBtn").classList.remove("hidden");
  document.querySelector('.tabs button[data-tab="home"]').click();
  window.scrollTo({ top: 0, behavior: "smooth" });
  updateAiNote();
}
$("cancelEditBtn").addEventListener("click", resetForm);
$("deleteBtn").addEventListener("click", async () => {
  if (!state.editingId) return;
  if (!window.confirm("このレシートを削除しますか？（写真も消えます）")) return;
  const path = state.editingImagePath;
  const { error } = await sb.from("receipts").delete().eq("id", state.editingId);
  if (error) { $("formMsg").textContent = "削除できませんでした: " + error.message; return; }
  if (path) {
    // 複数枚読み取りで同じ写真を共有している下書きが残っていれば写真は消さない
    const { data: sharing } = await sb.from("receipts").select("id").eq("image_path", path).limit(1);
    if (!sharing || sharing.length === 0) await sb.storage.from("receipts").remove([path]);
  }
  resetForm(); await loadHome(); await loadList(); await loadSummary();
});
$("saveBtn").addEventListener("click", async () => {
  const date = $("fDate").value;
  const amount = parseInt($("fAmount").value, 10);
  if (!date) { $("formMsg").textContent = "日付を入れてください。"; return; }
  if (Number.isNaN(amount) || amount < 0) { $("formMsg").textContent = "金額を入れてください。"; return; }
  $("saveBtn").disabled = true; $("formMsg").textContent = "保存中…";
  try {
    let imagePath = state.editingImagePath;
    if (state.imageFile) {
      const ext = (state.imageFile.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${state.user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage.from("receipts")
        .upload(path, state.imageFile, { contentType: state.imageFile.type || "image/jpeg" });
      if (upErr) throw upErr;
      if (imagePath && imagePath !== path) await sb.storage.from("receipts").remove([imagePath]);
      imagePath = path;
    }
    const row = {
      user_id: state.user.id, receipt_date: date,
      store_name: $("fStore").value.trim(), amount,
      category: $("fCategory").value, items_text: $("fItems").value.trim(),
      usage: $("fUsage").value, memo: $("fMemo").value.trim(),
      confirmed: $("fConfirmed").checked, image_path: imagePath
    };
    if (state.editingId) {
      const { error } = await sb.from("receipts").update(row).eq("id", state.editingId);
      if (error) throw error;
    } else {
      const { error } = await sb.from("receipts").insert(row);
      if (error) throw error;
    }
    const ym = ymOf(date);
    $("formMsg").textContent = `保存しました（${ym} 分として集計されます）。`;
    const savedId = state.editingId;
    resetForm();
    $("formMsg").textContent = savedId ? "更新しました。" : `保存しました（${ym} 分として集計されます）。`;
    await loadHome(); await loadList(); await loadSummary();
  } catch (e) {
    $("formMsg").textContent = "保存できませんでした: " + (e.message || e);
  } finally { $("saveBtn").disabled = false; }
});

// ---------- AI読み取り（Gemini） ----------
function getGeminiKey() { return localStorage.getItem(LS_KEY) || ""; }
function updateAiNote() {
  const has = !!getGeminiKey();
  $("aiNote").textContent = has ? "" : "（APIキー未設定：設定タブで入れると読み取りできます。未設定でも手入力で保存できます）";
  $("aiBtn").disabled = !state.imageFile && !state.editingId;
}
$("aiBtn").addEventListener("click", async () => {
  const key = getGeminiKey();
  if (!key) { $("aiNote").textContent = "設定タブでGemini APIキーを入れてください。"; return; }
  if (!state.imageFile) { $("aiNote").textContent = "先に写真を選んでください。"; return; }
  $("aiBtn").disabled = true; $("aiNote").textContent = "読み取り中…";
  try {
    const base64 = await fileToBase64(state.imageFile);
    const prompt = [
      "この写真に写っているレシート・領収書をすべて読み取り、JSON配列だけを返してください。",
      "写真に複数枚のレシートが写っている場合は、1枚ごとに1つの要素に分けてください。1枚だけなら要素1つの配列にしてください。",
      "各要素の形式: {\"date\":\"YYYY-MM-DD\",\"store\":\"店名\",\"amount\":合計金額の数値,\"items\":\"品目の要約\",\"category\":\"科目\"}",
      "科目は次の15科目から1つだけ選んでください: " + CATEGORIES.join("／"),
      "分類の目安: 沖縄電力・電気料金→電気代、りゅうせきガス・ガス料金→ガス代、水道局・上下水道料金→水道代、",
      "ガソリンスタンド・燃料→ガソリン代、電話・通信→通信費、車の修理・部品→修繕費・外注工賃、",
      "日用品・消耗品→消耗品費、保険→損害保険料、税金・公的料金→租税公課、判断できない場合は雑費。",
      "読み取れない項目は空文字または0にしてください。説明文は付けずJSON配列のみ返してください。"
    ].join("\n");
    let res = null, lastStatus = 0;
    // 404（モデルなし）・503/429（混雑）の時は、間隔を広げながら別モデルで再試行する（最大8回・約2分）
    const waits = [4000, 8000, 12000, 16000, 20000, 24000, 28000];
    let attempt = 0;
    outer:
    for (let round = 0; round < 2; round++) {
      for (const model of GEMINI_MODELS) {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [
              { text: prompt },
              { inlineData: { mimeType: state.imageFile.type || "image/jpeg", data: base64 } }
            ] }] }) }
        );
        if (res.ok) break outer;
        lastStatus = res.status;
        if (![404, 429, 503].includes(res.status)) break outer;
        attempt++;
        if (attempt > 7) break outer;
        $("aiNote").textContent = `読み取り中…（混雑のため再試行しています ${attempt}/7）`;
        await new Promise((r) => setTimeout(r, waits[attempt - 1] || 20000));
      }
    }
    if (!res || !res.ok) throw new Error("Gemini API エラー: " + lastStatus);
    const j = await res.json();
    const text = (((j.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || "").join("") || "";
    let results = null;
    const am = text.match(/\[[\s\S]*\]/);
    if (am) { try { results = JSON.parse(am[0]); } catch (_) { results = null; } }
    if (!results) {
      const om = text.match(/\{[\s\S]*\}/);
      if (om) { try { results = [JSON.parse(om[0])]; } catch (_) { results = null; } }
    }
    if (!Array.isArray(results) || results.length === 0) throw new Error("読み取り結果を解釈できませんでした");
    if (results.length === 1) {
      const r = results[0];
      if (r.date) $("fDate").value = r.date;
      if (r.store) $("fStore").value = r.store;
      if (r.amount) $("fAmount").value = r.amount;
      if (r.items) $("fItems").value = r.items;
      if (r.category && CATEGORIES.includes(r.category)) $("fCategory").value = r.category;
      $("fConfirmed").checked = false; // 読み取り結果は未確認の下書きとして保存する
      $("aiNote").textContent = "読み取りました。内容を確認してから保存してください（未確認の下書きになります）。";
      return;
    }
    // 複数枚: 写真を1回だけアップロードし、各レシートを未確認の下書きとして一括保存する
    const ext = (state.imageFile.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${state.user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from("receipts")
      .upload(path, state.imageFile, { contentType: state.imageFile.type || "image/jpeg" });
    if (upErr) throw upErr;
    let saved = 0, skipped = 0;
    for (const r of results) {
      const amount = parseInt(r.amount, 10);
      if (!r.date || Number.isNaN(amount)) { skipped++; continue; }
      const row = {
        user_id: state.user.id, receipt_date: r.date,
        store_name: String(r.store || ""), amount,
        category: CATEGORIES.includes(r.category) ? r.category : "雑費",
        items_text: String(r.items || ""), usage: "未確認",
        memo: "複数枚読み取り（同じ写真から一括登録）", confirmed: false, image_path: path
      };
      const { error } = await sb.from("receipts").insert(row);
      if (error) { skipped++; } else { saved++; }
    }
    $("aiNote").textContent = saved > 0
      ? `${results.length}枚のレシートを読み取り、${saved}件を未確認の下書きとして保存しました${skipped ? `（${skipped}件は読み取れず除外）` : ""}。一覧タブで1件ずつ確認してください。`
      : "複数枚として読み取りましたが、保存できるレシートがありませんでした。1枚ずつ撮り直してください。";
    resetForm();
    $("aiNote").textContent = saved > 0
      ? `${saved}件の下書きを保存しました。一覧タブで確認してください。`
      : "保存できるレシートがありませんでした。1枚ずつ撮り直してください。";
    await loadHome(); await loadList(); await loadSummary();
  } catch (e) {
    $("aiNote").textContent = "読み取りに失敗しました: " + (e.message || e) + "（手入力で保存できます）";
  } finally { $("aiBtn").disabled = false; }
});
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// ---------- 集計・転記 ----------
function summarize(rows) {
  const byCat = {};
  for (const c of CATEGORIES) byCat[c] = { count: 0, total: 0 };
  for (const r of rows) {
    if (!byCat[r.category]) byCat[r.category] = { count: 0, total: 0 };
    byCat[r.category].count += 1; byCat[r.category].total += r.amount;
  }
  return byCat;
}
async function loadSummary() {
  const ym = $("sumMonth").value || currentYm();
  const rows = await fetchMonth(ym);
  const byCat = summarize(rows);
  const max = Math.max(1, ...CATEGORIES.map((c) => byCat[c].total));
  $("sumBars").innerHTML = CATEGORIES.map((c) =>
    `<div class="bar-row"><div class="name">${c}</div><div class="bar"><div style="width:${Math.round(byCat[c].total / max * 100)}%"></div></div><div class="val">${yen(byCat[c].total)}（${byCat[c].count}件）</div></div>`
  ).join("");
  const total = rows.reduce((s, r) => s + r.amount, 0);
  $("sumTotal").textContent = yen(total);
  // 年間累計
  const year = ym.slice(0, 4);
  const { data: yearRows } = await sb.from("receipts").select("amount")
    .gte("receipt_date", `${year}-01-01`).lt("receipt_date", `${Number(year) + 1}-01-01`);
  $("sumYearTotal").textContent = yen((yearRows || []).reduce((s, r) => s + r.amount, 0));
  // Excel転記プレビュー（確認済みのみ）
  const confirmed = rows.filter((r) => r.confirmed);
  const tByCat = summarize(confirmed);
  const sheetName = `${Number(year) + 1}年`; // 転記先は収入年の翌年シート
  const unconfirmed = rows.filter((r) => !r.confirmed);
  state.transferRows = CATEGORIES.map((c) => ({ category: c, total: tByCat[c].total }));
  state.transferMeta = { ym, sheetName };
  $("transferInfo").innerHTML =
    `<p>転記先：<b>「${sheetName}」シートの${Number(ym.slice(5))}月列</b>（${ym} 分）<br>` +
    `確認済み ${confirmed.length}件 ／ 合計 ${yen(confirmed.reduce((s, r) => s + r.amount, 0))}` +
    (unconfirmed.length ? `<br><span style="color:var(--warn)">未確認 ${unconfirmed.length}件（${yen(unconfirmed.reduce((s, r) => s + r.amount, 0))}）は転記に入りません</span>` : "") +
    `</p>`;
  $("transferBody").innerHTML =
    `<table class="transfer"><tr><th>科目</th><th class="num">金額</th></tr>` +
    state.transferRows.map((r) => `<tr><td>${r.category}</td><td class="num">${yen(r.total)}</td></tr>`).join("") +
    `<tr><td><b>合計</b></td><td class="num"><b>${yen(confirmed.reduce((s, r) => s + r.amount, 0))}</b></td></tr></table>`;
  state.summaryRowsCache = rows;
}
$("sumMonth").addEventListener("change", loadSummary);
$("sumReload").addEventListener("click", loadSummary);

function downloadCsv(filename, text) {
  const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
$("csvBtn").addEventListener("click", async () => {
  const ym = $("sumMonth").value || currentYm();
  const rows = await fetchMonth(ym);
  const byCat = summarize(rows);
  const lines = ["日付,店名,金額,科目,用途,品目,メモ,確認状態"];
  for (const r of rows) {
    lines.push([r.receipt_date, r.store_name, r.amount, r.category, r.usage, r.items_text, r.memo, r.confirmed ? "確認済み" : "未確認"].map(csvCell).join(","));
  }
  lines.push("", "科目別集計", "科目,金額,件数");
  for (const c of CATEGORIES) lines.push([c, byCat[c].total, byCat[c].count].map(csvCell).join(","));
  lines.push(["合計", rows.reduce((s, r) => s + r.amount, 0), rows.length].map(csvCell).join(","));
  downloadCsv(`receipts-${ym}.csv`, lines.join("\n"));
});
$("transferCsvBtn").addEventListener("click", () => {
  if (!state.transferRows) return;
  const { ym, sheetName } = state.transferMeta;
  const lines = [`転記先シート,${sheetName}`, `月,${Number(ym.slice(5))}月`, "科目,金額"];
  let total = 0;
  for (const r of state.transferRows) { lines.push([r.category, r.total].map(csvCell).join(",")); total += r.total; }
  lines.push(["合計", total].map(csvCell).join(","));
  downloadCsv(`excel-transfer-${ym}.csv`, lines.join("\n"));
});

// ---------- 設定 ----------
$("geminiKey").value = getGeminiKey();
$("saveKeyBtn").addEventListener("click", () => {
  localStorage.setItem(LS_KEY, $("geminiKey").value.trim());
  $("keyMsg").textContent = "保存しました。"; updateAiNote();
});
$("clearKeyBtn").addEventListener("click", () => {
  localStorage.removeItem(LS_KEY); $("geminiKey").value = "";
  $("keyMsg").textContent = "消しました（手入力モードで動作します）。"; updateAiNote();
});

// ---------- 初期化 ----------
fillCategorySelects();
resetForm();
refreshSession();
