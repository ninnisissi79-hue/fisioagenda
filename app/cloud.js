/* RE-HAND · Collegamento a Supabase (libreria condivisa, accessi e ruoli).
   Senza configurazione l'app funziona in modalità locale, come prima. */
(function () {
"use strict";
const cfgLocal = () => { try { return JSON.parse(localStorage.getItem("rehand-cloud") || "{}"); } catch { return {}; } };
const Cloud = {
  sb: null, user: null, ruolo: null, email: "", enabled: false, error: "",
  config() { const c = Object.assign({}, window.REHAND_CONFIG || {}, cfgLocal()); return { url: (c.supabaseUrl || "").trim(), key: (c.supabaseAnonKey || "").trim() }; },
  saveConfig(url, key) { localStorage.setItem("rehand-cloud", JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key })); },
  async init() {
    const c = this.config();
    this.enabled = !!(c.url && c.key && window.supabase);
    if (!this.enabled) return;
    try {
      this.sb = window.supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true } });
      const { data } = await Promise.race([this.sb.auth.getSession(), new Promise((r) => setTimeout(() => r({ data: null }), 4000))]);
      if (data && data.session) {
        const u = data.session.user; this.user = u; this.email = u.email || "";
        try { const c = JSON.parse(localStorage.getItem("rehand-ruolo") || "null"); if (c && c.id === u.id) this.ruolo = c.ruolo; } catch {}
      }
    } catch (e) { this.error = e.message; }
  },
  async _setUser(u) {
    this.user = u; this.email = (u && u.email) || ""; this.ruolo = null;
    if (!u) return;
    // crea il profilo RE-HAND se manca (il primo diventa admin, gli altri "in attesa") e legge il ruolo
    const { data, error } = await this.sb.rpc("rehand_registrati");
    if (error) throw error;
    this.ruolo = data || "in_attesa";
    try { localStorage.setItem("rehand-ruolo", JSON.stringify({ id: u.id, ruolo: this.ruolo })); } catch {}
  },
  async signIn(email, password) { const { data, error } = await this.sb.auth.signInWithPassword({ email, password }); if (error) { const c = error.code || error.error_code || ""; throw new Error(
      /not_confirmed/.test(c) || /not confirmed/i.test(error.message) ? "Il tuo account non è ancora confermato. Premi “Password dimenticata?”: ti arriverà un’email, scegli la password e sarai dentro."
      : /invalid_credentials/.test(c) || /Invalid login/i.test(error.message) ? "Email o password non corrette. Se non ricordi la password (o non l’hai mai scelta) premi “Password dimenticata?”."
      : error.message); } this.user = data.user; this.email = data.user.email; await this._setUser(data.user); },
  async signUp(email, password) { const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split("#")[0] } }); if (error) throw new Error(/signups? not allowed/i.test(error.message) ? "Le registrazioni dall’app sono chiuse: chiedi all’amministratrice di crearti l’account, poi premi “Accedi”." : error.message); if (data.session) await this._setUser(data.user); return !!data.session; },
  async resetPassword(email) { const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] }); if (error) throw error; },
  async signOut() { try { localStorage.removeItem("rehand-ruolo"); } catch {} await this.sb.auth.signOut(); this.user = null; this.ruolo = null; },
  isAdmin() { return this.ruolo === "admin"; },
  /* --- opuscoli --- */
  async pullDocs() { const { data, error } = await this.sb.from("rehand_opuscoli").select("id,dati,versione,aggiornato"); if (error) throw error; return data.map((r) => r.dati); },
  async pushDoc(doc) { const clean = JSON.parse(JSON.stringify(doc)); delete clean._modificheLocali; const { error } = await this.sb.from("rehand_opuscoli").upsert({ id: doc.id, dati: clean, versione: doc.versione || 1 }); if (error) throw error; },
  async deleteDoc(id) { const { error } = await this.sb.from("rehand_opuscoli").delete().eq("id", id); if (error) throw error; },
  async revisions(id) { const { data, error } = await this.sb.from("rehand_revisioni").select("id,versione,creato,dati").eq("opuscolo_id", id).order("creato", { ascending: false }).limit(30); if (error) throw error; return data; },
  /* --- richieste di modifica --- */
  async submitRequest(doc, nota) { const clean = JSON.parse(JSON.stringify(doc)); delete clean._modificheLocali; const { error } = await this.sb.from("rehand_richieste").insert({ opuscolo_id: doc.id, dati: clean, nota, autore: this.user.id, autore_email: this.email }); if (error) throw error; },
  async listRequests(stato) { let q = this.sb.from("rehand_richieste").select("*").order("creato", { ascending: false }); if (stato) q = q.eq("stato", stato); const { data, error } = await q; if (error) throw error; return data; },
  async decideRequest(id, stato, commento) { const { error } = await this.sb.from("rehand_richieste").update({ stato, commento: commento || null, deciso_da: this.user.id, deciso_il: new Date().toISOString() }).eq("id", id); if (error) throw error; },
  async withdrawRequest(id) { const { error } = await this.sb.from("rehand_richieste").delete().eq("id", id); if (error) throw error; },
  /* --- richieste di nuove patologie --- */
  async requestPathology(patologia, dettagli) { const { error } = await this.sb.from("rehand_patologie_richieste").insert({ patologia, dettagli: dettagli || null, autore: this.user.id }); if (error) throw error; },
  async listPathologyRequests() { const { data, error } = await this.sb.from("rehand_patologie_richieste").select("id,patologia,dettagli,creato,autore").order("creato", { ascending: false }); if (error) throw error; return data; },
  async deletePathologyRequest(id) { const { error } = await this.sb.from("rehand_patologie_richieste").delete().eq("id", id); if (error) throw error; },
  /* --- utenti --- */
  async listProfiles() { const { data, error } = await this.sb.from("rehand_profili").select("*").order("creato"); if (error) throw error; return data; },
  async setRole(id, ruolo) { const { error } = await this.sb.from("rehand_profili").update({ ruolo }).eq("id", id); if (error) throw error; },
  /* --- impostazioni e decisioni --- */
  async pullSettings() { const { data, error } = await this.sb.from("rehand_impostazioni").select("dati").eq("id", 1).maybeSingle(); if (error) throw error; return data ? data.dati : null; },
  async pushSettings(s) { const { error } = await this.sb.from("rehand_impostazioni").upsert({ id: 1, dati: s }); if (error) throw error; },
  async pullDecisions() { const { data, error } = await this.sb.from("rehand_decisioni").select("*"); if (error) throw error; const o = {}; data.forEach((d) => (o[d.proposta_id] = { stato: d.stato, data: d.data })); return o; },
  async pushDecision(id, d) { const { error } = await this.sb.from("rehand_decisioni").upsert({ proposta_id: id, stato: d.stato, data: d.data }); if (error) throw error; },
  async deleteDecision(id) { const { error } = await this.sb.from("rehand_decisioni").delete().eq("proposta_id", id); if (error) throw error; },
};
window.Cloud = Cloud;
})();
