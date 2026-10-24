// Client Odoo JSON-2 commun aux apps HOOS (copie de référence : hoos-compta/outils/odoo-json2/odoo-json2.ts).
// Jumeau TypeScript de hoos-compta/scripts/odoo_api.py. Odoo a déclaré XML-RPC et JSON-RPC obsolètes (Odoo 20, 09/2026) ;
// ils disparaissent d'Odoo Online à la 21.1 (hiver 2027). JSON-2 : POST /json/2/<modèle>/<méthode>, clé API en bearer,
// en-tête X-Odoo-Database, arguments NOMMÉS.
//
// `call(model, method, args, kwargs)` garde la forme d'execute_kw (arguments par position) : les noms sont lus dans la
// documentation de la base (/doc-bearer/<modèle>.json), car ils changent d'une version à l'autre (ex.
// set_account_bank_statement_line : aml_id en 19, aml_ids en 20). Méthodes de MODELE : sans ids ; les autres : la
// première position est la liste d'ids. `create(vals)` avec un objet renvoie un id, comme en XML-RPC.

export type OdooConfig = { url: string; db: string; apiKey: string; timeoutMs?: number };

export class OdooError extends Error {
  readonly status?: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OdooError";
    this.status = status;
  }
}

const MODELE: Record<string, string[]> = {
  search: ["domain"], search_read: ["domain"], search_count: ["domain"], read_group: ["domain", "fields", "groupby"],
  formatted_read_group: ["domain", "groupby", "aggregates"], fields_get: [], name_search: ["name"],
  default_get: ["fields_list"], create: ["vals_list"], context_get: [], name_create: ["name"], get_views: ["views"],
};
const SECOURS: Record<string, string[]> = {
  read: ["fields"], write: ["vals"], copy: ["default"], message_post: [], send_mail: ["res_id"],
  get_view: ["view_id", "view_type"], check_access_rights: ["operation"], has_access: ["operation"],
};

export class OdooJson2 {
  private docs = new Map<string, Promise<Record<string, { parameters?: Record<string, unknown> }>>>();
  readonly config: OdooConfig;
  constructor(config: OdooConfig) {
    this.config = config;
  }

  private headers(): Record<string, string> {
    return { Authorization: `bearer ${this.config.apiKey}`, "X-Odoo-Database": this.config.db, "Content-Type": "application/json; charset=utf-8" };
  }

  /** Appel brut, arguments déjà nommés. */
  async raw<T = unknown>(model: string, method: string, body: Record<string, unknown>): Promise<T> {
    let res: Response;
    for (let essai = 0; ; essai++) {
      res = await fetch(`${this.config.url.replace(/\/$/, "")}/json/2/${model}/${method}`, {
        method: "POST", headers: this.headers(), body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 120_000),
      });
      // Débit limité par Odoo (429) : on attend et on réessaie, 3 fois au plus.
      if (res.status !== 429 || essai >= 3) break;
      const attente = Number(res.headers.get("Retry-After")) || 2 * (essai + 1);
      await new Promise((r) => setTimeout(r, attente * 1000));
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message ?? text; } catch { /* texte brut */ }
      throw new OdooError(`${model}.${method} : HTTP ${res.status} — ${String(msg).slice(0, 500)}`, res.status);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Noms des paramètres d'une méthode, d'après la documentation de la base (mis en cache par modèle). */
  async paramNames(model: string, method: string): Promise<string[]> {
    if (!this.docs.has(model)) {
      this.docs.set(model, fetch(`${this.config.url.replace(/\/$/, "")}/doc-bearer/${model}.json`, { headers: this.headers() })
        .then((r) => (r.ok ? r.json() : { methods: {} }))
        .then((d) => d.methods ?? {})
        .catch(() => ({})));
    }
    const params = (await this.docs.get(model)!)[method]?.parameters;
    if (!params) return MODELE[method] ?? SECOURS[method] ?? [];
    return Object.keys(params).filter((n) => !n.endsWith("kwargs"));
  }

  /** Même forme qu'execute_kw : args par position, kwargs nommés. */
  async call<T = unknown>(model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Promise<T> {
    const body: Record<string, unknown> = { ...kwargs };
    let rest = args;
    if (method in MODELE) {
      if (method === "create" && args[0] && !Array.isArray(args[0])) {
        const ids = await this.raw<number[]>(model, "create", { ...body, vals_list: [args[0]] });
        return ids[0] as T;
      }
    } else {
      const ids = args[0];
      body.ids = Array.isArray(ids) ? ids : ids == null ? [] : [ids];
      rest = args.slice(1);
    }
    if (rest.length) {
      const names = await this.paramNames(model, method);
      if (rest.length > names.length) {
        throw new OdooError(`${model}.${method} : ${rest.length} argument(s) positionnel(s) sans nom connu pour JSON-2`);
      }
      rest.forEach((v, i) => { body[names[i]!] = v; });
    }
    return this.raw<T>(model, method, body);
  }

  async uid(): Promise<number> {
    return (await this.raw<{ uid: number }>("res.users", "context_get", {})).uid;
  }

  /** Version du serveur, sans authentification. */
  async version(): Promise<string> {
    const r = await fetch(`${this.config.url.replace(/\/$/, "")}/web/version`);
    return (await r.json()).version as string;
  }
}
