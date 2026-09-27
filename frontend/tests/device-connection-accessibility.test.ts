import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import * as devices from "../services/device-connection";
import { initialLocalState } from "../types/local-state";

const loadModule = createRequire(`${process.cwd()}/package.json`);
const { renderToStaticMarkup } = loadModule("react-dom/server") as {
  renderToStaticMarkup(node: React.ReactNode): string;
};
const web = loadModule("react-native-web");

// Exercise the actual assignment row with the installed web renderer. Contexts
// and navigation are isolated; no DOM, credentials, storage, or network needed.
for (const selected of [false, true]) {
  for (const busy of [false, true]) {
    test(`web assignment buttons announce selected=${selected} and disabled=${busy}`, () => {
      const state = initialLocalState();
      const exports = {} as { default: React.ComponentType };
      const source = readFileSync(
        "app/device-connection/assignment.tsx",
        "utf8",
      );
      let stateIndex = 0;
      runInNewContext(
        ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
        {
          exports,
          require(name: string) {
            switch (name) {
              case "react":
                return {
                  ...React,
                  useState: (initial: unknown) => {
                    const index = stateIndex++;
                    return React.useState(
                      index === 0
                        ? selected
                          ? { kind: "space", id: "Bedroom", name: "Bedroom" }
                          : null
                        : index === 1
                          ? busy
                          : initial,
                    );
                  },
                };
              case "react/jsx-runtime":
                return loadModule("react/jsx-runtime");
              case "react-native":
                return {
                  ...web,
                  FlatList: ({
                    data,
                    renderItem,
                  }: {
                    data: unknown[];
                    renderItem: (info: { item: unknown }) => React.ReactNode;
                  }) => renderItem({ item: data[0] }),
                };
              case "@/components/device-connection-screen":
                return { DeviceConnectionScreen: web.View, deviceStyles: {} };
              case "@/components/screen":
                return { Action: () => null, ui: {} };
              case "@/context/app-data":
                return {
                  useAppData: () => ({
                    loaded: true,
                    loading: false,
                    plants: [],
                  }),
                };
              case "@/context/local-state":
                return { useLocalState: () => ({ data: state }) };
              case "@/context/spaces":
                return { useSpaces: () => ({ spaces: ["Bedroom"] }) };
              case "@/hooks/use-device-activity":
                return { useDeviceActivity: () => true };
              case "@/services/device-connection":
                return devices;
              case "expo-router":
                return {
                  useLocalSearchParams: () => ({
                    deviceId: devices.mockHardwareNodes[0].id,
                  }),
                  useRouter: () => ({}),
                };
              default:
                throw new Error(`Unexpected import: ${name}`);
            }
          },
        },
      );
      const markup = renderToStaticMarkup(React.createElement(exports.default));
      assert.match(markup, /role="button"/);
      assert.match(markup, new RegExp(`aria-pressed="${selected}"`));
      if (busy) assert.match(markup, /aria-disabled="true"/);
      else assert.match(markup, /tabindex="0"/);
    });
  }
}
