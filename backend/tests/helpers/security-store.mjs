import { randomUUID } from "node:crypto";

export function matches(row, where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (key === "OR") return condition.some(value => matches(row, value));
    if (key === "AND") return condition.every(value => matches(row, value));
    const value = row[key];
    if (condition === null || typeof condition !== "object" || condition instanceof Date) return value === condition;
    if ("equals" in condition && value !== condition.equals) return false;
    if ("in" in condition && !condition.in.includes(value)) return false;
    if ("gt" in condition && !(value > condition.gt)) return false;
    if ("gte" in condition && !(value >= condition.gte)) return false;
    if ("lt" in condition && !(value < condition.lt)) return false;
    if ("lte" in condition && !(value <= condition.lte)) return false;
    if ("contains" in condition && !(condition.mode === "insensitive" ? value?.toLowerCase().includes(condition.contains.toLowerCase()) : value?.includes(condition.contains))) return false;
    return true;
  });
}

function project(row, select, resolveUser) {
  if (!select) return structuredClone(row);
  return Object.fromEntries(Object.entries(select).filter(([, value]) => value).map(([key, value]) =>
    [key, key === "_count" ? { plants: 0, devices: 0, careTasks: 0, sessions: 0 }
      : key === "user" && resolveUser ? project(resolveUser(row.userId), value.select)
      : structuredClone(row[key])]));
}

/** A stateful Prisma-shaped double; the integration suite also uses real PostgreSQL. */
export function memoryModel(rows, { defaults = () => ({}), unique = [], resolveUser } = {}) {
  const filtered = where => [...rows.values()].filter(row => matches(row, where));
  const update = (row, data) => {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      row[key] = value !== null && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
    }
    return row;
  };
  return {
    findUnique: async ({ where, select, include }) => {
      const row = filtered(where)[0];
      if (!row) return null;
      const result = project(row, select, resolveUser);
      if (include?.user) result.user = structuredClone(resolveUser(row.userId));
      return result;
    },
    findFirst: async query => (await memoryModel(rows).findMany(query))[0] ?? null,
    findMany: async ({ where, select, skip = 0, take, orderBy } = {}) => {
      const order = orderBy ? Array.isArray(orderBy) ? orderBy : [orderBy] : [];
      return filtered(where).sort((a, b) => {
        for (const entry of order) { const [key, direction] = Object.entries(entry)[0]; const result = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0; if (result) return direction === "desc" ? -result : result; }
        return 0;
      }).slice(skip, take === undefined ? undefined : skip + take).map(row => project(row, select, resolveUser));
    },
    count: async ({ where } = {}) => filtered(where).length,
    create: async ({ data, select }) => {
      if (unique.some(key => data[key] != null && [...rows.values()].some(row => row[key] === data[key]))) throw { code: "P2002" };
      const row = { id: randomUUID(), ...defaults(), ...structuredClone(data) };
      rows.set(row.id, row);
      return project(row, select);
    },
    update: async ({ where, data, select }) => {
      const row = filtered(where)[0];
      if (!row) throw { code: "P2025" };
      return project(update(row, data), select);
    },
    updateMany: async ({ where, data }) => { const found = filtered(where); for (const row of found) update(row, data); return { count: found.length }; },
    deleteMany: async ({ where } = {}) => { const found = filtered(where); for (const row of found) rows.delete(row.id); return { count: found.length }; },
  };
}
