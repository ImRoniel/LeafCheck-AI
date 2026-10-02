'use strict';
// PINCER runtime — scope dispositions and deletion detection (docs/runtime-contracts.md,
// "Strict coverage" → "Scope dispositions"). A deferral or removal recorded in the
// coverage map is authorized only by a resolved decision of the same change that
// names the ID and by an applicable user authorization reachable from the current
// one through its basis chain; free text is never consulted. Deleted obligations
// are detected against the retained baseline inventory (the latest authorized
// agreement's snapshot, else the latest agreement with an inventory), so deleting
// prose and map row together erases nothing. Pure functions; nothing is written.
const agreement = require('./agreement.cjs');
const requirements = require('./requirements.cjs');

// Whether a decision names an ID as a whole token in its summary or excerpt.
function namesId(decision, id) {
  const re = new RegExp(`(^|[^A-Z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Z0-9-])`);
  return re.test(decision.summary || '') || re.test(decision.excerpt || '');
}

// The user authorization that applies to a decision from the current authorization:
// the current one when it is `user` and lists the decision, else the `user`
// authorization its basis chain ends in when that one lists it. Returns the
// authorization or null with the reason.
function applicableUserAuthorization(record, current, decisionId) {
  if (!current) return { authorization: null, reason: 'no current authorization' };
  const byId = new Map(record.authorizations.map(a => [a.id, a]));
  const seen = new Set();
  let a = current;
  while (a && !seen.has(a.id)) {
    seen.add(a.id);
    if (a.disposition === 'user') {
      if (a.decisions.includes(decisionId)) return { authorization: a, reason: null };
      return { authorization: null, reason: a.id === current.id ? `the current authorization ${a.id} does not name ${decisionId}` : `the current authorization ${current.id} descends from ${a.id}, which does not name ${decisionId}` };
    }
    a = a.basis ? byId.get(a.basis) : null;
  }
  return { authorization: null, reason: `no user authorization names ${decisionId}` };
}

// Problems for every scope entry of the graph: [{ code: 'SCOPE_UNAUTHORIZED', detail, ids, id, decision, authorization }].
// `verdict` is the authorization verdict computed for the record (its `authorized` entry is the current one).
function scopeProblems(record, graph, verdict) {
  const problems = [];
  const resolved = [];
  for (const entry of Object.values(graph.scope)) {
    const id = entry.id;
    const label = `${id} (${entry.disposition})`;
    const decision = record.decisions.find(d => d.id === entry.decision);
    if (!decision) { problems.push({ code: 'SCOPE_UNAUTHORIZED', detail: `${label}: no decision ${entry.decision} on change ${record.change}`, ids: [id], id, decision: entry.decision, authorization: null }); continue; }
    if (decision.status !== 'resolved') { problems.push({ code: 'SCOPE_UNAUTHORIZED', detail: `${label}: decision ${decision.id} is open`, ids: [id], id, decision: decision.id, authorization: null }); continue; }
    if (!namesId(decision, id)) { problems.push({ code: 'SCOPE_UNAUTHORIZED', detail: `${label}: decision ${decision.id} does not name ${id}`, ids: [id], id, decision: decision.id, authorization: null }); continue; }
    // Every authorization that binds the current agreement is "the current one"; the
    // disposition is authorized when any of them is, or descends from, a user
    // authorization naming the decision. The latest one's reason is reported otherwise.
    const current = verdict && verdict.verdict === 'current' ? record.authorizations.filter(a => a.digest === verdict.current) : [];
    let applicable = { authorization: null, reason: 'no current authorization' };
    for (const a of current) { applicable = applicableUserAuthorization(record, a, decision.id); if (applicable.authorization) break; }
    if (!applicable.authorization) { problems.push({ code: 'SCOPE_UNAUTHORIZED', detail: `${label}: ${verdict && verdict.verdict !== 'current' ? `the agreement is not authorized (${verdict.verdict})` : applicable.reason}`, ids: [id], id, decision: decision.id, authorization: null }); continue; }
    resolved.push({ id, disposition: entry.disposition, decision: decision.id, authorization: applicable.authorization.id, excerpt: decision.excerpt, reference: decision.reference });
  }
  return { problems, resolved };
}

// The baseline of a strict change: the union of the inventories of its retained
// agreement snapshots (the adoption agreement and every later one, authorized or
// not), so an obligation that was ever reviewed stays one until a tombstone
// withdraws it. Returns { agreements: [G-NN], scenarios: { id: { requirement,
// agreement: <latest defining G-NN>, authorization: <latest A-NN binding a defining
// agreement> | null } } } or null when no snapshot carries an inventory.
function baseline(root, record) {
  const scenarios = {}, agreements = [];
  for (const entry of record.agreements) {
    const inventory = agreement.inventoryOf(root, record, entry);
    if (!inventory) continue;
    agreements.push(entry.id);
    const auth = record.authorizations.filter(a => a.agreement === entry.id).map(a => a.id).pop() || null;
    for (const [id, s] of Object.entries(inventory.scenarios)) {
      const prior = scenarios[id];
      scenarios[id] = { requirement: s.requirement, agreement: entry.id, authorization: auth || (prior ? prior.authorization : null) };
    }
  }
  return agreements.length ? { agreements, scenarios } : null;
}

// OBLIGATION_MISSING: baseline scenarios defined neither in the live inventory nor as
// a removed tombstone in the map. Returns [{ code, detail, ids }].
function obligationProblems(base, inventory, map) {
  if (!base) return [];
  const missing = Object.keys(base.scenarios).filter(id => !inventory.scenarios[id] && !(map.scope[id] && map.scope[id].disposition === 'removed'));
  if (!missing.length) return [];
  const ids = requirements.sortIds(missing);
  const where = ids.map(id => `${id} (last defined by ${base.scenarios[id].agreement}${base.scenarios[id].authorization ? `, authorized by ${base.scenarios[id].authorization}` : ''})`).join(', ');
  return [{ code: 'OBLIGATION_MISSING', detail: `${where} of the reviewed inventory ${ids.length === 1 ? 'is' : 'are'} defined neither in the PRD nor as a removed tombstone in the coverage map; restore ${ids.length === 1 ? 'it' : 'them'}, or record the decision and the tombstone`, ids }];
}

module.exports = { namesId, applicableUserAuthorization, scopeProblems, baseline, obligationProblems };
