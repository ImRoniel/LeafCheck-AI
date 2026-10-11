// Keep root Expo launches aligned with the frontend workspace.
const { expo } = require("./frontend/app.json");
function workspacePaths(value) {
  if (typeof value === "string" && value.startsWith("./assets/")) return `./frontend/${value.slice(2)}`;
  if (Array.isArray(value)) return value.map(workspacePaths);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, workspacePaths(entry)]),
  );
  return value;
}
module.exports = {
  ...workspacePaths(expo),
  extra: { ...expo.extra, router: { ...expo.extra.router, root: "./frontend/app" } },
};
