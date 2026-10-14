// Small adapter for route mocks; the integration suite verifies these predicates
// against real MongoDB, including BSON missing/null behavior.
export function matchesWhere(row, where) {
  return Object.entries(where).every(([field, filter]) => {
    if (field === "AND") return filter.every(part => matchesWhere(row, part));
    if (field === "OR") return filter.some(part => matchesWhere(row, part));
    const value = row[field];
    if (filter === null || typeof filter !== "object" || filter instanceof Date) return value === filter;
    return Object.entries(filter).every(([operator, operand]) => {
      switch (operator) {
        case "isSet": return Object.hasOwn(row, field) === operand;
        case "equals": return value === operand;
        case "gte": return value != null && value >= operand;
        case "gt": return value != null && value > operand;
        case "lt": return value != null && value < operand;
        case "lte": return value != null && value <= operand;
        default: throw new Error(`Unsupported mock filter ${operator}`);
      }
    });
  });
}
