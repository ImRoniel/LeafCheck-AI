import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import { groupArchives } from "../services/archive-groups";
import { createApiClient } from "../services/api";
import type { ArchiveEntry } from "../types";

const plantId = "11111111-1111-4111-8111-111111111111";
const sample = (id: string, name: string, plant = plantId, createdAt = "2026-10-12T00:00:00Z"): ArchiveEntry => ({
  id, plantId: plant, userId: "owner", healthStatus: "healthy", rawAnalysisText: `Report ${id}`,
  speciesName: name, notificationTime: "2026-10-15T00:00:00Z", notificationReason: "Inspect leaves",
  createdAt, plant: { id: plant, name, species: `${name} species` },
});
const rows = [sample("old", "Monstera", plantId, "2026-09-28T00:00:00Z"), sample("other", "Willow", "22222222-2222-4222-8222-222222222222"), sample("new", "Monstera")];
type Props = { children?: React.ReactNode; onPress?: () => void; accessibilityLabel?: string; accessibilityState?: { selected?: boolean; expanded?: boolean }; [key: string]: unknown };
const elements = (node: React.ReactNode): React.ReactElement<Props>[] => React.Children.toArray(node).flatMap(child => React.isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []);

function harness(filter?: unknown) {
  const slots: unknown[] = []; let cursor = 0;
  let loader: ((signal: AbortSignal) => Promise<unknown>) | undefined;
  const calls: string[] = [];
  const api = createApiClient({ baseUrl: "https://example.test", fetch: async url => { calls.push(String(url)); return new Response(JSON.stringify(rows)); } });
  const module: { default?: () => React.ReactNode } = {};
  const requireModule = createRequire(import.meta.url);
  const code = ts.transpileModule(readFileSync(new URL("../app/archives.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports: module, require(name: string) {
    if (name === "react") return { useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: unknown) => { slots[index] = value; }]; } };
    if (name === "react/jsx-runtime") return requireModule(name);
    if (name === "react-native") return { Text: "Text", View: "View", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", StyleSheet: { create: (styles: unknown) => styles } };
    if (name === "@/components/screen") return { Action: "Action", Notice: "Notice", Screen: "Screen", ui: {} };
    if (name === "@expo/vector-icons") return { Ionicons: "Icon" };
    if (name === "expo-router") return { useLocalSearchParams: () => ({ plantId: filter }) };
    if (name === "@/services/api") return { api };
    if (name === "@/services/archive-groups") return { groupArchives };
    if (name === "@/services/use-polling-resource") return { usePollingResource(key: string, load: typeof loader) { loader = key ? load : undefined; return { data: { key, entries: key ? rows : [] }, loading: false, error: null, refresh: async () => undefined }; } };
    throw new Error(`Unexpected import ${name}`);
  } });
  return { calls, render: () => { cursor = 0; return module.default!(); }, load: () => loader?.(new AbortController().signal) };
}

test("archives group scans by plant identity, newest first, without mutating the input", () => {
  const groups = groupArchives(rows);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find(group => group.name === "Monstera")?.scans.map(row => row.id), ["new", "old"]);
  assert.equal(rows[0].id, "old");
  assert.equal(groupArchives(rows, plantId).length, 1);
  assert.equal(groupArchives([sample("one", "Same name"), sample("two", "Same name", "other")]).length, 2);
});
test("plant archives exclude other plants and forward plant and date filters to the API", async () => {
  const screen = harness(plantId); let node = screen.render();
  assert.doesNotMatch(JSON.stringify(node), /Willow/);
  assert.match(JSON.stringify(node), /Monstera/);
  await screen.load(); assert.match(screen.calls.at(-1)!, new RegExp(`plantId=${plantId}$`));
  for (const [label, days] of [["Last 7 days", 7], ["Last 30 days", 30]] as const) {
    const button = elements(node).find(item => item.type === "Pressable" && item.props.children && JSON.stringify(item.props.children).includes(label));
    button?.props.onPress?.(); node = screen.render(); await screen.load();
    assert.match(screen.calls.at(-1)!, new RegExp(`plantId=${plantId}&days=${days}$`));
    assert.equal(elements(node).find(item => JSON.stringify(item.props.children).includes(label) && item.type === "Pressable")?.props.accessibilityState?.selected, true);
  }
});
test("reports and follow-up details stay collapsed until a scan row is opened", () => {
  const screen = harness(); const node = screen.render();
  assert.doesNotMatch(JSON.stringify(node), /Report new|Follow-up/);
  const row = elements(node).find(item => item.type === "Pressable" && item.props.accessibilityLabel?.startsWith("Show scan details for Monstera"));
  row?.props.onPress?.(); const expanded = screen.render();
  assert.match(JSON.stringify(expanded), /Report new|Follow-up/);
  assert.equal(elements(expanded).filter(item => item.props.accessibilityState?.expanded).length, 1);
});
test("invalid plant filters do not request the all-plant archive list", async () => {
  const screen = harness([plantId]);
  assert.match(JSON.stringify(screen.render()), /invalid plant ID/);
  await screen.load(); assert.deepEqual(screen.calls, []);
});
