import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import { careTaskPreview, tasksDueToday } from "../services/care-task-presentation";
import { groupCareTasks } from "../services/care-tasks";
import type { CareCompletion, GardenCareTask } from "../types/care-task";

function task(id: string, dueAt: string | null): GardenCareTask {
  return { id, key: id, plantId: "fern", title: id, details: "", priority: "routine", dueAt };
}

test("Due today includes earlier-today overdue tasks and excludes undated, completed, invalid and other dates", () => {
  const now = new Date(2026, 9, 4, 12);
  const tasks: (GardenCareTask | CareCompletion)[] = [
    task("yesterday", new Date(2026, 9, 3, 23, 59, 59, 999).toISOString()),
    task("midnight", new Date(2026, 9, 4).toISOString()),
    task("earlier today", new Date(2026, 9, 4, 9).toISOString()),
    task("now", now.toISOString()),
    task("tonight", new Date(2026, 9, 4, 23, 59, 59, 999).toISOString()),
    task("tomorrow", new Date(2026, 9, 5).toISOString()),
    task("manual", null),
    task("invalid", "invalid date"),
    { ...task("completed", now.toISOString()), completedAt: now.toISOString() },
  ];
  const originalDates = tasks.map(item => item.dueAt);
  const due = tasksDueToday(tasks, now);
  assert.deepEqual(due.map(item => item.id), ["midnight", "earlier today", "now", "tonight"]);
  assert.equal(due[0], tasks[1], "counting must retain source tasks without inventing occurrences");
  const grouped = groupCareTasks({ today: tasks.slice(0, 8) as GardenCareTask[], upcoming: [], completed: [] }, now);
  assert.ok(grouped.overdue.some(item => item.id === "earlier today"));
  assert.ok(tasksDueToday([...grouped.overdue, ...grouped.today, ...grouped.upcoming, ...grouped.manual], now).some(item => item.id === "earlier today"));
  assert.deepEqual(tasks.map(item => item.dueAt), originalDates);
});

test("Due today follows local calendar boundaries through short and long daylight-saving days", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    for (const [month, day, duration] of [[2, 8, 23], [10, 1, 25]] as const) {
      const now = new Date(2026, month, day, 12);
      const start = new Date(2026, month, day);
      const end = new Date(2026, month, day + 1);
      assert.equal((end.getTime() - start.getTime()) / 3_600_000, duration);
      const tasks = [
        task("before", new Date(start.getTime() - 1).toISOString()),
        task("start", start.toISOString()),
        task("last instant", new Date(end.getTime() - 1).toISOString()),
        task("next day", end.toISOString()),
      ];
      assert.deepEqual(tasksDueToday(tasks, now).map(item => item.id), ["start", "last instant"]);
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("task previews retain short details and select a concise sentence without changing the saved explanation", () => {
  assert.equal(careTaskPreview("  Check the soil first.  "), "Check the soil first.");
  const details = "Review the leaves. This is a manual check, not a sensor reading. Inspect both sides of every leaf before changing your care routine.";
  const saved = details;
  assert.equal(careTaskPreview(details), "Review the leaves.");
  assert.equal(details, saved);
  const longSentence = "Inspect every leaf carefully and review the soil conditions before making changes to your watering and fertilizing schedule";
  const preview = careTaskPreview(longSentence);
  assert.ok(preview.length <= 96);
  assert.ok(preview.endsWith("…"));
  assert.ok(longSentence.startsWith(preview.slice(0, -1)));
});

type Props = {
  children?: React.ReactNode;
  accessibilityLabel?: string;
  source?: { uri: string };
  onError?: () => void;
  resizeMode?: string;
};
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  return React.Children.toArray(node).flatMap(child => React.isValidElement<Props>(child)
    ? [child, ...elements(child.props.children)] : []);
}

function thumbnailHarness() {
  const requireModule = createRequire(`${process.cwd()}/package.json`);
  let cursor = 0;
  const slots: unknown[] = [];
  const exports: { CareTaskThumbnail?: (props: { uri?: string; name: string }) => React.ReactNode } = {};
  runInNewContext(ts.transpileModule(readFileSync("components/care-task-thumbnail.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require(name: string) {
      if (name === "react/jsx-runtime") return requireModule(name);
      if (name === "react") return {
        useState(initial: unknown) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = initial;
          return [slots[index], (value: unknown) => { slots[index] = value; }];
        },
      };
      if (name === "react-native") return { View: "View", Image: "Image", StyleSheet: { create: (styles: unknown) => styles } };
      if (name === "@expo/vector-icons") return { Ionicons: "Icon" };
      throw new Error(`Unexpected thumbnail import: ${name}`);
    },
  });
  return (uri?: string) => {
    cursor = 0;
    return elements(exports.CareTaskThumbnail!({ uri, name: "Fern" }));
  };
}

test("task thumbnails show the real saved plant image or an accessible missing-photo placeholder", () => {
  const render = thumbnailHarness();
  const uri = "https://example.invalid/fern.jpg";
  const image = render(uri).find(node => node.type === "Image")!;
  assert.ok(image);
  assert.equal(image.props.source?.uri, uri);
  assert.equal(image.props.resizeMode, "cover");
  assert.equal(image.props.accessibilityLabel, "Fern photo");
  const empty = render();
  assert.ok(!empty.some(node => node.type === "Image"));
  assert.ok(empty.some(node => node.props.accessibilityLabel === "Fern: no plant photo"));
  assert.ok(empty.some(node => node.type === "Icon"));
});

test("thumbnail load errors fall back and a different saved image recovers without stale-error interference", () => {
  const render = thumbnailHarness();
  const brokenUri = "https://example.invalid/broken.jpg";
  const replacementUri = "https://example.invalid/replacement.jpg";
  const brokenImage = render(brokenUri).find(node => node.type === "Image")!;
  brokenImage.props.onError!();
  const fallback = render(brokenUri);
  assert.ok(!fallback.some(node => node.type === "Image"));
  assert.ok(fallback.some(node => node.props.accessibilityLabel === "Fern: no plant photo"));
  assert.equal(render(replacementUri).find(node => node.type === "Image")?.props.source?.uri, replacementUri);
  brokenImage.props.onError!(); // A delayed event from an old request must not hide the current photo.
  assert.equal(render(replacementUri).find(node => node.type === "Image")?.props.source?.uri, replacementUri);
});
