import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import { createLocalStateStore, localStateKey } from "../services/local-state-storage";
import * as spaces from "../services/spaces";
import * as profilePhoto from "../services/profile-photo";
import * as validators from "../services/validators";

const requireModule = createRequire(`${process.cwd()}/package.json`);
type Props = {
  children?: React.ReactNode;
  accessibilityLabel?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: any;
  label?: string;
  onOpen?: (anchor: { x: number; y: number; width: number; height: number }) => void;
  onChangeText?: (value: string) => void;
  visible?: boolean;
  guard?: boolean;
  name?: string;
  initialRouteName?: string;
  value?: Record<string, unknown>;
};
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  return React.Children.toArray(node).flatMap(child => React.isValidElement<Props>(child)
    ? [child, ...elements(child.props.children)] : []);
}
function cardContainer(nodes: React.ReactElement<Props>[], openLabel: string) {
  return nodes.find(node => node.type === "View" && React.Children.toArray(node.props.children).some(child => React.isValidElement<Props>(child) && child.props.accessibilityLabel === openLabel))!;
}
function assertSiblingCardActions(card: React.ReactElement<Props>) {
  assert.equal(card.type, "View");
  for (const button of elements(card).filter(node => node.type === "Pressable")) {
    assert.ok(!elements(button.props.children).some(child => child.type === "Pressable" || child.type === "SpaceMenuButton"), "Card actions must not nest interactive buttons");
  }
}
function hooks() {
  let cursor = 0;
  const slots: unknown[] = [];
  const effects: (() => void)[] = [];
  return {
    reset: () => { cursor = 0; },
    flush: () => { effects.splice(0).forEach(effect => effect()); },
    react: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useEffect: (effect: () => void) => { effects.push(effect); },
      useCallback: (callback: unknown) => callback,
      useMemo: (factory: () => unknown) => factory(),
      createContext: () => ({ Provider: "Provider" }),
    },
  };
}
function load(path: string, overrides: Record<string, unknown>) {
  const exports: Record<string, (...args: any[]) => any> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, Error, AbortController, setTimeout, clearTimeout,
    require(name: string) {
      if (name in overrides) return overrides[name];
      if (name === "@/services/validators") return validators;
      if (name === "react/jsx-runtime") return requireModule(name);
      if (name === "expo-font") return { useFonts: () => [true] };
      if (name === "../assets/fonts/Inter-SemiBold.ttf") return 1;
      if (name === "./action-menu-style" || name === "@/components/action-menu-style") return load("components/action-menu-style.ts", {});
      if (name === "./anchored-action-overlay" || name === "@/components/anchored-action-overlay") return { AnchoredActionOverlay: "AnchoredActionOverlay" };
      if (name === "./animated-pressable" || name === "@/components/animated-pressable") return { AnimatedPressable: "Pressable" };
      if (name === "@/hooks/use-reduced-motion") return { useReducedMotion: () => false };
      if (name === "react-native") return {
        View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal", TouchableOpacity: "TouchableOpacity",
        TextInput: "TextInput", ScrollView: "ScrollView", Image: "Image",
        KeyboardAvoidingView: "KeyboardAvoidingView", RefreshControl: "RefreshControl",
        ActivityIndicator: "ActivityIndicator", Platform: { OS: "web" },
        useWindowDimensions: () => ({ width: 390, height: 844 }),
        StyleSheet: { create: (styles: unknown) => styles },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}
function invoke(node: React.ReactElement): React.ReactElement<Props> {
  return (node.type as (props: unknown) => React.ReactElement<Props>)(node.props);
}

test("local profile edits persist while account names use the real profile endpoint", async () => {
  let raw: string | null = null;
  const storage = { getItem: async () => raw, setItem: async (_key: string, value: string) => { raw = value; } };
  const store = createLocalStateStore(storage, localStateKey(null));
  await store.load();
  const names: string[] = [];
  const auth = { isGuest: true, user: null as null | { name: string; email: string }, updateProfile: async (name: string) => { names.push(name); } };
  const module = load("context/profile.tsx", {
    "@/services/profile-photo": profilePhoto,
    "@/services/profile-photo-native": { profilePhotoFiles: {} },
    "@/services/local-state-storage": { validProfilePhoto: (value: string) => /^https?:\/\//.test(value) },
    "./auth": { useAuth: () => auth },
    "./local-state": { useLocalState: () => ({ ...store.snapshot(), update: store.update }) },
  });
  await module.useProfile().setName("  Local Gardener  ");
  await module.useProfile().setPhotoUri("https://images.test/a.jpg");
  assert.equal(module.useProfile().name, "Local Gardener");
  assert.equal(names.length, 0);
  const restored = createLocalStateStore(storage, localStateKey(null));
  await restored.load();
  assert.equal(restored.snapshot().data.profile?.name, "Local Gardener");
  await assert.rejects(module.useProfile().setPhotoUri("file:///private"));
  auth.isGuest = false;
  auth.user = { name: "Account Name", email: "account@example.test" };
  assert.equal(module.useProfile().name, "Account Name");
  assert.equal(module.useProfile().email, "account@example.test");
  await module.useProfile().setName("Updated Account");
  assert.deepEqual(names, ["Updated Account"]);
  assert.equal(store.snapshot().data.profile?.name, "Local Gardener");
});

test("profile photo persistence preserves names and isolates late writes across session changes", async () => {
  let generation = 1;
  let data = { profile: { name: "Keep Name", photoUri: "https://images.test/old.jpg" } };
  const removed: string[] = [];
  let mode = "success";
  const saved = "file:///app/documents/leafcheck-profile-a-1.jpg";
  const module = load("context/profile.tsx", {
    "@/services/local-state-storage": { validProfilePhoto: () => true },
    "@/services/profile-photo": profilePhoto,
    "@/services/profile-photo-native": { profilePhotoFiles: {
      copy: async () => saved, remove: (uri: string) => removed.push(uri),
    } },
    "./auth": { useAuth: () => ({ isGuest: true, generation: 1 }), session: { snapshot: () => ({ generation }) } },
    "./local-state": { useLocalState: () => ({ data, update: async (change: (state: typeof data) => typeof data) => {
      if (mode === "failure") throw new Error("Disk full");
      data = change(data);
      if (mode === "switch") { generation++; throw new Error("Session changed"); }
    } }) },
  });
  await module.useProfile().savePhoto("cache");
  assert.equal(data.profile.name, "Keep Name");
  assert.equal(data.profile.photoUri, saved);
  mode = "failure";
  await assert.rejects(module.useProfile().savePhoto("cache"), /Disk full/);
  assert.deepEqual(removed, [saved]);
  mode = "switch";
  await assert.rejects(module.useProfile().savePhoto("cache"), /Session changed/);
  assert.equal(removed.length, 1); // Keep any file that the old account's completed write references.
});

test("login offers account-free Dashboard entry without calling real sign-in", () => {
  const state = hooks();
  let localEntries = 0;
  const routes: string[] = [];
  const module = load("app/login.tsx", {
    react: state.react,
    "@/components/auth-button": { AuthButton: "AuthButton" },
    "@/components/auth-layout": { AuthLayout: "AuthLayout", authStyles: {} },
    "@/components/custom-text-input": { CustomTextInput: "CustomTextInput" },
    "@/components/screen": { Notice: "Notice" },
    "@/context/auth": { useAuth: () => ({ enterLocal: () => localEntries++, login: () => { throw new Error("Should not authenticate"); } }) },
    "expo-router": { useRouter: () => ({ replace: (route: string) => routes.push(route) }) },
  });
  const nodes = elements(module.default());
  const entry = nodes.find(node => (node.props as { title?: string }).title === "Continue without an account");
  assert.ok(entry);
  entry.props.onPress!();
  assert.equal(localEntries, 1);
  assert.deepEqual(routes, ["/(tabs)"]);
  assert.ok(!nodes.some(node => typeof node.props.children === "string" && /guest mode/i.test(node.props.children)));
});

test("profile keeps independent Rename, removes duplicate rows and gates account settings", async () => {
  const state = hooks();
  const routes: string[] = [];
  const names: string[] = [];
  const module = load("app/profile.tsx", {
    react: state.react,
    "@/components/screen": { Action: "Action", Notice: "Notice", ui: {} },
    "@/components/profile-photo-crop": { ProfilePhotoCrop: "ProfilePhotoCrop" },
    "@/services/profile-photo-native": { pickProfilePhoto: () => { throw new Error("Unexpected picker"); } },
    "@/context/auth": { useAuth: () => ({ isLocal: true }) },
    "@/context/profile": { useProfile: () => ({ name: "Local Gardener", setName: async (name: string) => { names.push(name); } }) },
    "@expo/vector-icons": { Ionicons: "Icon" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "expo-router": { useRouter: () => ({ push: (route: string) => routes.push(route) }) },
  });
  const render = () => { state.reset(); return elements(module.default()); };
  assert.ok(!render().some(node => ["Update Profile", "Profile Photo"].includes(String(node.props.children))));
  render().find(node => node.props.accessibilityLabel === "Open settings")!.props.onPress!();
  assert.deepEqual(routes, []);
  assert.ok(render().some(node => node.props.children === "Sign in to manage device settings."));
  render().find(node => node.props.accessibilityLabel === "Edit profile name")!.props.onPress!();
  assert.ok(render().some(node => node.props.accessibilityLabel === "Profile name"));
  render().find(node => node.props.accessibilityLabel === "Profile name")!.props.onChangeText!("New Name");
  render().find(node => node.type === "Pressable" && elements(node.props.children).some(child => child.props.children === "Save"))!.props.onPress!();
  await nextTurn();
  assert.deepEqual(names, ["New Name"]);
});

test("circular crop controls adjust image bounds, guard duplicate saves, keep errors retryable and cancel without saving", async () => {
  const state = hooks();
  let renders = 0;
  let cancels = 0;
  let fail = true;
  const rectangles: profilePhoto.CropRect[] = [];
  const committed: string[] = [];
  const module = load("components/profile-photo-crop.tsx", {
    react: state.react,
    "@/services/profile-photo": profilePhoto,
    "@/services/profile-photo-native": { renderProfileCrop: async (_photo: unknown, rect: profilePhoto.CropRect) => {
      renders++; rectangles.push(rect); return { uri: "cropped" };
    } },
    "./screen": { Notice: "Notice" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "react-native": {
      Image: "Image", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
      StyleSheet: { create: (styles: unknown) => styles },
      useWindowDimensions: () => ({ width: 320, height: 640 }),
      PanResponder: { create: () => ({ panHandlers: {} }) },
    },
  });
  const props = {
    photo: { uri: "selected", width: 1000, height: 2000 },
    onCancel: () => cancels++,
    onConfirm: async (uri: string) => { if (fail) throw new Error("Disk full"); committed.push(uri); },
  };
  const render = () => { state.reset(); return elements(module.ProfilePhotoCrop(props)); };
  const press = (label: string) => render().find(node => node.props.accessibilityLabel === label)!.props.onPress!();
  press("Confirm profile photo");
  assert.equal(renders, 0); // Preview must load first.
  (render().find(node => node.type === "Image")!.props as { onLoad: () => void }).onLoad();
  press("Zoom in");
  press("Move photo up");
  press("Confirm profile photo");
  press("Confirm profile photo");
  await nextTurn();
  assert.equal(renders, 1);
  assert.equal(rectangles[0].width, 800);
  assert.ok(rectangles[0].originY > 600);
  assert.ok(render().some(node => String(node.props.children).includes("Unable to crop or save")));
  assert.equal(committed.length, 0);
  fail = false;
  press("Confirm profile photo");
  await nextTurn();
  assert.deepEqual(committed, ["cropped"]);
  press("Cancel photo crop");
  assert.equal(cancels, 1);
  assert.equal(renders, 2);
});

test("fresh local entry opens Dashboard once, keeps setup optional, and permits later sign-in", () => {
  const state = hooks();
  const replacements: string[] = [];
  const auth = { isGuest: true, status: "guest" };
  const local = { ready: true, data: { onboarding: { status: "pending" } } };
  const Stack = Object.assign(() => null, { Protected: "Protected", Screen: "Screen" });
  const module = load("app/_layout.tsx", {
    react: state.react,
    "@/components/screen": { Action: "Action", Notice: "Notice", Screen: "Screen" },
    "@/context/install-onboarding": { InstallOnboardingProvider: "IntroProvider", useInstallOnboarding: () => ({ phase: "completed" }) },
    "./splash": { __esModule: true, default: "Splash" },
    "@/context/auth": { AuthProvider: "AuthProvider", useAuth: () => auth },
    "@/context/local-state": { LocalStateProvider: "LocalStateProvider", useLocalState: () => local },
    "@/context/app-data": { AppDataProvider: "AppDataProvider" },
    "expo-router": {
      Stack,
      useRouter: () => ({ replace: (path: string) => replacements.push(path) }),
      useRootNavigationState: () => ({ key: "mounted" }),
    },
  });
  const root = module.default();
  const authProvider = root.props.children as React.ReactElement<Props>;
  const startup = authProvider.props.children;
  assert.ok(React.isValidElement(startup));
  const account = invoke(invoke(startup));
  const provider = account.props.children as React.ReactElement<Props>;
  const routes = provider.props.children as React.ReactElement;
  const render = () => { state.reset(); const tree = invoke(routes); state.flush(); return tree; };
  const tree = render();
  assert.equal(tree.props.initialRouteName, "(tabs)");
  const groups = React.Children.toArray(tree.props.children) as React.ReactElement<Props>[];
  assert.equal(groups[1].props.guard, true); // Guest may choose setup.
  assert.equal(groups[2].props.guard, true); // Setup does not block Spaces.
  assert.deepEqual(replacements, ["/(tabs)"]);
  render();
  assert.deepEqual(replacements, ["/(tabs)"]); // No redirect loop on later login visits.
});

test("Guest cards open the selected space and its manual-add flow, persist data, and have no Garden entry", async () => {
  let raw: string | null = null;
  let failRestore = false;
  const storage = {
    getItem: async () => raw,
    setItem: async (_key: string, value: string) => { if (failRestore) throw new Error("Disk full"); raw = value; },
  };
  const store = createLocalStateStore(storage, localStateKey(null));
  await store.load();
  const useLocalState = () => ({ ...store.snapshot(), update: store.update });
  const appHooks = hooks();
  const app = load("context/app-data.tsx", {
    react: appHooks.react,
    "@/services/api": {}, // Any cloud call would fail; guest creation must stay local.
    "@react-native-async-storage/async-storage": { default: storage },
    "./auth": { useAuth: () => ({ isGuest: true, status: "guest" }) },
    "./local-state": { useLocalState },
  });
  const useAppData = () => {
    appHooks.reset();
    return invoke(app.AppDataProvider({ children: null })).props.value!;
  };
  const context = load("context/spaces.tsx", {
    "@/services/spaces": spaces,
    "./app-data": { useAppData }, "./local-state": { useLocalState },
  });
  const navigations: unknown[] = [];
  let params = { space: "Bedroom", add: "" };
  const common = {
    "@/context/app-data": { useAppData }, "@/context/local-state": { useLocalState },
    "@/context/spaces": { useSpaces: context.useSpaces },
    "@/components/space-management": { SpaceManagement: "SpaceManagement" },
    "@/components/plant-action-menu": { PlantActionMenu: "PlantActionMenu" },
    "@/components/space-menu-button": { SpaceMenuButton: "SpaceMenuButton" },
    "@/components/profile-button": { ProfileButton: "ProfileButton" },
    "@expo/vector-icons": { Ionicons: "Icon" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "expo-router": {
      useLocalSearchParams: () => params,
      useRouter: () => ({
        push: (route: unknown) => navigations.push(route),
        replace: (route: unknown) => navigations.push(route),
        setParams: (next: Partial<typeof params>) => { params = { ...params, ...next }; },
      }),
    },
  };
  const screenHooks = hooks();
  const screen = load("app/(tabs)/spaces.tsx", { ...common, react: screenHooks.react });
  const renderSpaces = () => { screenHooks.reset(); return elements(screen.default()); };
  renderSpaces().find(node => node.props.accessibilityLabel === "Create a space")!.props.onPress!();
  renderSpaces().find(node => node.props.accessibilityLabel === "Space name")!.props.onChangeText!("Bedroom");
  const create = renderSpaces().find(node => node.type === "Pressable" &&
    elements(node.props.children).some(child => child.props.children === "Create"))!;
  create.props.onPress!();
  await nextTurn();
  assert.equal(store.snapshot().data.spaces[0].name, "Bedroom");
  assert.ok(renderSpaces().some(node => node.props.accessibilityLabel === "0 plants in Bedroom"));
  assert.equal((renderSpaces().find(node => node.type === "ScrollView")!.props as any).showsVerticalScrollIndicator, false);
  assert.ok(!renderSpaces().some(node => node.props.accessibilityLabel === "Open My Garden" || node.props.children === "My Garden"));
  const archiveButton = renderSpaces().find(node => node.props.accessibilityLabel === "Open Archive")!;
  assert.equal(archiveButton.props.style.width, 38);
  assert.equal(archiveButton.props.style.height, 38);
  assert.equal(archiveButton.props.style.borderRadius, 19);
  assert.equal(archiveButton.props.style.backgroundColor, "#EAF7EE");
  assert.equal(archiveButton.props.style.borderWidth, 1);
  renderSpaces().find(node => node.props.accessibilityLabel === "Open Bedroom")!.props.onPress!();
  assert.deepEqual(JSON.parse(JSON.stringify(navigations[0])), { pathname: "/(tabs)/space-detail", params: { space: "Bedroom" } });
  let stopped = false;
  (renderSpaces().find(node => node.props.accessibilityLabel === "Add a Plant to Bedroom")!.props.onPress as any)({ stopPropagation() { stopped = true; } });
  assert.ok(stopped);
  assert.deepEqual(JSON.parse(JSON.stringify(navigations[1])), { pathname: "/(tabs)/space-detail", params: { space: "Bedroom", add: "manual" } });
  const anchor = { x: 275, y: 154, width: 75, height: 32 };
  renderSpaces().find(node => node.props.label === "Manage Bedroom")!.props.onOpen!(anchor);
  const management = renderSpaces().find(node => node.type === "SpaceManagement")!;
  assert.equal((management.props as any).space, "Bedroom");
  assert.equal((management.props as any).anchor, anchor);

  const detailHooks = hooks();
  const detail = load("app/(tabs)/space-detail.tsx", { ...common, react: detailHooks.react });
  const renderDetail = () => { detailHooks.reset(); return elements(detail.default()); };
  renderDetail(); // Route was already mounted before manual-add navigation.
  params.add = "manual";
  let nodes = renderDetail();
  assert.equal(nodes.filter(node => node.type === "Modal").at(-1)!.props.visible, true);
  nodes.find(node => node.props.accessibilityLabel === "Plant name")!.props.onChangeText!("Basil");
  nodes.find(node => node.props.accessibilityLabel === "Plant species")!.props.onChangeText!("Ocimum basilicum");
  const add = renderDetail().find(node => node.type === "Pressable" &&
    elements(node.props.children).some(child => child.props.children === "Add"))!;
  add.props.onPress!();
  await nextTurn();
  assert.equal(params.add, "");
  const plant = store.snapshot().data.guestPlants[0];
  assert.equal(plant.name, "Basil");
  assert.equal(plant.location, "Bedroom");
  assert.ok(renderSpaces().some(node => node.props.accessibilityLabel === "1 plant in Bedroom"));
  const reloaded = createLocalStateStore(storage, localStateKey(null));
  await reloaded.load();
  assert.equal(reloaded.snapshot().data.guestPlants[0].id, plant.id);
  assert.equal(reloaded.snapshot().data.spaces[0].background, "#E8F2E8");

  nodes = renderDetail();
  const scan = nodes.find(node => node.type === "Pressable" &&
    elements(node.props.children).some(child => child.props.children === "Scan Plant"))!;
  scan.props.onPress!();
  const destination = navigations.at(-1) as { pathname: string; params: { space: string } };
  assert.equal(destination.pathname, "/(tabs)/scanner");
  assert.equal(destination.params.space, "Bedroom");
  assert.equal(useAppData().guest, true);
  assert.ok(!renderSpaces().some(node => node.props.children === "All Plants"));
  const card = cardContainer(renderSpaces(), "Open Bedroom");
  assertSiblingCardActions(card);
  assert.equal(card.props.style.width, 354);
  assert.equal(card.props.style.minHeight, 178);
  assert.equal(card.props.style.maxWidth, "100%");
  assert.equal(card.props.style.backgroundColor, "#FFFFFF");
  assert.ok(card.props.style.shadowOpacity > 0);
  const addPlantButton = elements(card).find(node => node.props.accessibilityLabel === "Add a Plant to Bedroom")!;
  assert.ok(addPlantButton.props.style.minWidth >= 112);
  assert.equal(addPlantButton.props.style.flexShrink, 0);
  assert.ok(addPlantButton.props.style.minHeight >= 44);
  const addPlantPill = elements(addPlantButton).find(node => node.type === "View")!;
  assert.ok(addPlantPill.props.style.minWidth >= 112);
  assert.ok(addPlantPill.props.style.paddingHorizontal >= 16);
  const addPlantLabel = elements(addPlantButton).find(node => node.type === "Text")!;
  assert.equal(addPlantLabel.props.children, "Add a Plant");
  assert.equal((addPlantLabel.props as any).numberOfLines, 1);
  assert.ok(addPlantLabel.props.style.fontSize >= 12);
  const footer = elements(card).find(node => node.type === "View" && node.props.style?.flexWrap === "wrap")!;
  assert.ok(footer); // Space identity and the wider pill can wrap on narrow screens.
  const menu = elements(card).find(node => node.props.label === "Manage Bedroom")!;
  assert.equal(menu.props.style.position, "absolute");
  assert.equal(menu.props.style.right, 4);
  renderDetail().find(node => node.props.accessibilityLabel === "Open Basil")!.props.onLongPress!();
  assert.equal(renderDetail().find(node => node.props.accessibilityLabel === "Delete Basil")!.props.disabled, true);
  assert.ok(renderDetail().some(node => String(node.props.children).includes("Sign in to delete plants")));
  renderDetail().find(node => node.props.accessibilityLabel === "Cancel plant removal")!.props.onPress!();
  assert.ok(!renderDetail().some(node => node.props.accessibilityLabel === "Delete Basil"));
  assert.equal(store.snapshot().data.guestPlants.length, 1);
  renderDetail().find(node => node.props.label === "Manage space")!.props.onOpen!({ x: 270, y: 20, width: 75, height: 32 });
  const detailMenu = renderDetail().find(node => node.type === "SpaceManagement")!;
  assert.equal((detailMenu.props as any).anchor.y, 20);
  assert.equal((detailMenu.props as any).space, "Bedroom");
  await context.useSpaces().archiveSpace("Bedroom");
  const empty = renderSpaces().find(node => node.type === "View" && elements(node.props.children).some(child => child.props.children === "No My Spaces yet."))!;
  assert.ok(empty);
  assert.ok(renderSpaces().some(node => node.props.children === "No My Spaces yet."));
  renderSpaces().find(node => node.props.accessibilityLabel === "Open Archive")!.props.onPress!();
  const archiveModal = renderSpaces().find(node => node.type === "Modal" && elements(node.props.children).some(child => child.props.children === "Archive"))!;
  assert.equal(archiveModal.props.visible, true);
  assert.ok(!renderSpaces().some(node => String(node.props.children).startsWith("Archived spaces (")));
  failRestore = true;
  renderSpaces().find(node => node.props.accessibilityLabel === "Restore Bedroom")!.props.onPress!();
  await nextTurn();
  assert.equal(store.snapshot().data.spaces[0].status, "archived");
  failRestore = false;
  renderSpaces().find(node => node.props.accessibilityLabel === "Restore Bedroom")!.props.onPress!();
  await nextTurn();
  assert.equal(store.snapshot().data.spaces[0].status, undefined);
  assert.equal(store.snapshot().data.guestPlants.length, 1);
  renderSpaces().find(node => node.props.accessibilityLabel === "Close Archive")!.props.onPress!();
});

test("space suggestions fill an editable name without creating a space and preserve custom-name saves in both sessions", async () => {
  for (const guest of [true, false]) {
    const state = hooks();
    const saved: string[] = [];
    const module = load("app/(tabs)/spaces.tsx", {
      react: state.react,
      "@/components/space-management": { SpaceManagement: "SpaceManagement" },
      "@/components/space-menu-button": { SpaceMenuButton: "SpaceMenuButton" },
      "@/components/profile-button": { ProfileButton: "ProfileButton" },
      "@/context/spaces": { useSpaces: () => ({ ready: true, spaces: [], plantsBySpace: {}, archivedSpaces: [], addSpace: async (name: string) => saved.push(name) }) },
      "@/context/app-data": { useAppData: () => ({ guest }) },
      "@/context/local-state": { useLocalState: () => ({ data: { onboarding: { status: "complete" } } }) },
      "@expo/vector-icons": { Ionicons: "Icon" },
      "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
      "expo-router": { useRouter: () => ({}) },
    });
    const render = () => { state.reset(); return elements(module.default()); };
    render().find(node => node.props.accessibilityLabel === "Create a space")!.props.onPress!();
    for (const suggestion of ["Bedroom", "Balcony", "Porch", "Kitchen", "Garden"]) {
      const option = render().find(node => node.props.accessibilityLabel === `Use ${suggestion} as space name`)!;
      assert.ok(option.props.style[0].minHeight >= 44);
      option.props.onPress!();
      assert.equal((render().find(node => node.props.accessibilityLabel === "Space name")!.props as any).value, suggestion);
    }
    assert.deepEqual(saved, []);
    const input = render().find(node => node.props.accessibilityLabel === "Space name")!;
    assert.equal((input.props as any).maxLength, 10);
    input.props.onChangeText!("My Nook");
    render().find(node => node.type === "Pressable" && elements(node.props.children).some(child => child.props.children === "Create"))!.props.onPress!();
    assert.equal(render().find(node => node.props.accessibilityLabel === "Use Bedroom as space name")!.props.disabled, true);
    await nextTurn();
    assert.deepEqual(saved, ["My Nook"]);
    assert.equal(render().filter(node => node.type === "Modal").at(-1)!.props.visible, false);
  }
});

test("space-card counts stay beside their names and update with the current plant groups", () => {
  const state = hooks();
  let plants = [] as { id: string }[];
  const module = load("app/(tabs)/spaces.tsx", {
    react: state.react,
    "@/components/space-management": { SpaceManagement: "SpaceManagement" },
    "@/components/space-menu-button": { SpaceMenuButton: "SpaceMenuButton" },
    "@/components/profile-button": { ProfileButton: "ProfileButton" },
    "@/context/spaces": { useSpaces: () => ({ ready: true, spaces: ["Bedroom"], plantsBySpace: { Bedroom: plants }, archivedSpaces: [] }) },
    "@/context/app-data": { useAppData: () => ({ guest: false }) },
    "@/context/local-state": { useLocalState: () => ({}) },
    "@expo/vector-icons": { Ionicons: "Icon" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "expo-router": { useRouter: () => ({}) },
  });
  const render = () => { state.reset(); return elements(module.default()); };
  for (const count of [0, 1, 2, 1]) {
    plants = Array.from({ length: count }, (_, index) => ({ id: `p${index}` }));
    const countLabel = `${count} ${count === 1 ? "plant" : "plants"}`;
    const card = cardContainer(render(), "Open Bedroom");
    assertSiblingCardActions(card);
    const nameRow = elements(card).find(node => node.type === "View" && node.props.style.flexDirection === "row" && elements(node).some(child => child.props.accessibilityLabel === `${countLabel} in Bedroom`) && React.Children.toArray(node.props.children).some(child => React.isValidElement<Props>(child) && child.props.children === "Bedroom"))!;
    assert.ok(nameRow);
    const counter = elements(nameRow).find(node => node.props.accessibilityLabel === `${countLabel} in Bedroom`)!;
    assert.equal(counter.props.children, countLabel);
  }
});

test("detail cards keep cover photos above white name footers with bottom-right anchored menus and photo fallbacks", () => {
  for (const guest of [true, false]) {
    const state = hooks();
    const routes: unknown[] = [];
    const plants = [{ id: "fern", name: "Fern", imageUrl: "https://images.test/fern.jpg" }, { id: "basil", name: "Basil" }];
    const module = load("app/(tabs)/space-detail.tsx", {
      react: state.react,
      "@/components/space-management": { SpaceManagement: "SpaceManagement" },
      "@/components/plant-action-menu": { PlantActionMenu: "PlantActionMenu" },
      "@/components/space-menu-button": { SpaceMenuButton: "SpaceMenuButton" },
      "@/context/spaces": { useSpaces: () => ({ ready: true, spaces: ["Bedroom"], plantsBySpace: { Bedroom: plants } }) },
      "@/context/app-data": { useAppData: () => ({ guest }) },
      "@expo/vector-icons": { Ionicons: "Icon" },
      "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
      "expo-router": { useLocalSearchParams: () => ({ space: "Bedroom" }), useRouter: () => ({ push: (route: unknown) => routes.push(route) }) },
    });
    const render = () => { state.reset(); return elements(module.default()); };
    const scrolls = render().filter(node => node.type === "ScrollView");
    assert.ok(scrolls.length > 0);
    assert.ok(scrolls.every(node => (node.props as any).showsVerticalScrollIndicator === false));
    assert.ok((scrolls[0].props as any).refreshControl); // Hiding the indicator must keep refresh and scrolling.
    const tile = () => cardContainer(render(), "Open Fern");
    const card = tile();
    assertSiblingCardActions(card);
    assert.equal((React.Children.toArray(card.props.children)[0] as React.ReactElement<Props>).props.accessibilityLabel, "Open Fern");
    assert.equal(card.props.style.width, "47%");
    assert.equal(card.props.style.overflow, "hidden");
    const photo = elements(card).find(node => node.type === "Image")!;
    assert.equal(photo.props.style.width, "100%");
    assert.equal(photo.props.style.aspectRatio, 1);
    assert.equal((photo.props as any).resizeMode, "cover");
    const footer = React.Children.toArray(card.props.children).filter(React.isValidElement<Props>).at(-1)!;
    assert.equal(footer.props.style.backgroundColor, "#FFFFFF");
    assert.ok(elements(footer).some(node => node.props.children === "Fern"));
    const dots = elements(footer).find(node => node.props.label === "Manage plant Fern")!;
    assert.equal(dots.props.style.alignSelf, "flex-end");
    assert.equal(dots.props.style.position, undefined);
    assert.equal((React.Children.toArray(footer.props.children).at(-1) as React.ReactElement<Props>).props.label, "Manage plant Fern");
    const anchor = { x: 128, y: 330, width: 21, height: 5 };
    dots.props.onOpen!(anchor);
    const menu = render().find(node => node.type === "PlantActionMenu")!;
    assert.equal((menu.props as any).anchor, anchor);
    assert.equal((menu.props as any).plant.id, "fern");
    assert.equal((menu.props as any).guest, guest);
    const basil = cardContainer(render(), "Open Basil");
    assert.ok(!elements(basil).some(node => node.type === "Image"));
    assert.ok(elements(basil).some(node => node.type === "Icon" && node.props.name === "leaf-outline"));
    (photo.props as any).onError();
    assert.ok(!elements(tile()).some(node => node.type === "Image"));
    assert.ok(elements(tile()).some(node => node.type === "Icon" && node.props.name === "leaf-outline"));
    plants[0].imageUrl = "https://images.test/fern-new.jpg";
    assert.equal((elements(tile()).find(node => node.type === "Image")!.props as any).source.uri, plants[0].imageUrl);
    render().find(node => node.props.accessibilityLabel === "Open Fern")!.props.onPress!();
    assert.deepEqual(JSON.parse(JSON.stringify(routes)), guest ? [] : [{ pathname: "/plant-profile", params: { id: "fern" } }]);
  }
});

test("horizontal dots match measured dimensions and colors within an invisible accessible touch area", () => {
  let presses = 0;
  const module = load("components/space-menu-button.tsx", { react: hooks().react });
  const node = module.SpaceMenuButton({ label: "Manage Bedroom", onPress: () => presses++ });
  assert.equal(node.props.accessibilityLabel, "Manage Bedroom");
  const style = node.props.style[0];
  assert.equal(style.width, 44);
  assert.equal(style.height, 44);
  assert.equal(style.backgroundColor, undefined);
  assert.equal(style.borderWidth, undefined);
  assert.equal(style.alignItems, "center");
  assert.equal(style.justifyContent, "center");
  const row = React.Children.only(node.props.children) as React.ReactElement<Props>;
  assert.equal(row.props.style.width, 21);
  assert.equal(row.props.style.height, 5);
  const dots = React.Children.toArray(row.props.children) as React.ReactElement<Props>[];
  assert.equal(dots.length, 3);
  assert.equal(dots[0].props.style.width, 5);
  assert.equal(dots[0].props.style.height, 5);
  assert.equal(dots[0].props.style.boxShadow, undefined);
  assert.equal(dots[0].props.style.backgroundColor, "#34C759");
  assert.equal(dots[1].props.style[1].backgroundColor, "#009951");
  assert.equal(dots[2].props.style.backgroundColor, "#34C759");
  node.props.onPress({ stopPropagation() {} });
  assert.equal(presses, 1);
});

test("reference dropdown has 75 by 32 pills, Inter Semi Bold labels and exact visible-dot anchoring", () => {
  const module = load("components/action-menu-style.ts", {});
  const styles = module.actionMenuStyles as any;
  const position = module.actionMenuPosition({ x: 345, y: 31, width: 30, height: 10 }, 402, 874);
  assert.deepEqual(JSON.parse(JSON.stringify(position)), { width: 75, top: 51, left: 302 });
  assert.equal(styles.button.minHeight, 32);
  assert.equal(styles.button.borderRadius, 50);
  assert.equal(styles.button.backgroundColor, "#FFFFFF");
  assert.equal(styles.button.borderColor, "#E9E9E9");
  assert.equal(styles.button.borderWidth, 1);
  assert.equal(styles.button.boxShadow, undefined);
  assert.equal(styles.label.fontSize, 14);
  assert.equal(styles.label.lineHeight, 19);
  assert.equal(styles.label.fontWeight, "600");
  assert.equal(styles.label.letterSpacing, 0);
  assert.equal(styles.button.paddingTop + styles.button.borderWidth, 7);
  assert.equal(module.useActionMenuFont(), "Inter-SemiBold");
});

test("space dots measure their actual window position and stop card navigation", () => {
  const module = load("components/space-menu-button.tsx", { react: hooks().react });
  let received: unknown;
  let stopped = false;
  const node = module.SpaceMenuButton({ label: "Manage Porch", onOpen: (anchor: unknown) => { received = anchor; } });
  const row = React.Children.only(node.props.children) as React.ReactElement<any>;
  row.props.ref.current = { measureInWindow: (callback: (...args: number[]) => void) => callback(345, 31, 30, 10) };
  node.props.onPress({ stopPropagation() { stopped = true; } });
  assert.ok(stopped);
  assert.deepEqual(JSON.parse(JSON.stringify(received)), { x: 345, y: 31, width: 30, height: 10 });
});

test("dropdown overlay converts coordinates, pops open, closes outside and respects reduced motion", async () => {
  for (const origin of [{ x: 0, y: 0 }, { x: 16, y: 59 }, { x: 0, y: 96 }]) {
    const state = hooks();
    let closed = 0;
    let back: (() => boolean) | undefined;
    let reduceMotion = false;
    const animations: { kind: string; duration?: number; useNativeDriver: boolean }[] = [];
    const animate = (kind: string, value: { value: number }, options: { toValue: number; duration?: number; useNativeDriver: boolean }) => {
      animations.push({ kind, duration: options.duration, useNativeDriver: options.useNativeDriver });
      return { start: (done: (result: { finished: boolean }) => void) => { value.value = options.toValue; done({ finished: true }); }, stop() {} };
    };
    const module = load("components/anchored-action-overlay.tsx", {
      react: state.react,
      "@/hooks/use-reduced-motion": { useReducedMotion: () => reduceMotion },
      "expo-router": { useIsFocused: () => true },
      "react-native": {
        View: "View", Pressable: "Pressable",
        Platform: { OS: "ios" },
        BackHandler: { addEventListener: (_event: string, callback: () => boolean) => { back = callback; return { remove() {} }; } },
        Animated: {
          View: "AnimatedView",
          Value: class { constructor(public value: number) {} interpolate(config: unknown) { return config; } },
          timing: (value: any, options: any) => animate("timing", value, options),
          spring: (value: any, options: any) => animate("spring", value, options),
        },
        StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
        useWindowDimensions: () => ({ width: 402, height: 874 }),
      },
    });
    const props = { visible: true, anchor: { x: 354, y: 200, width: 21, height: 5 }, closeLabel: "Close menu", onClose: () => closed++, children: "Actions" };
    const render = () => { state.reset(); return module.AnchoredActionOverlay(props); };
    const root = render();
    assert.equal(root.type, "View"); // No second native Modal coordinate system.
    (root.props as any).ref.current = { measureInWindow: (callback: (x: number, y: number) => void) => callback(origin.x, origin.y) };
    (root.props as any).onLayout();
    state.flush();
    let menu = elements(render()).find(node => node.type === "AnimatedView")!;
    state.flush(); await nextTurn();
    assert.ok(animations.some(animation => animation.kind === "spring" && animation.useNativeDriver));
    assert.equal(menu.props.style.transform[0].scale.outputRange[0], 0.82);
    reduceMotion = true;
    menu = elements(render()).find(node => node.type === "AnimatedView")!;
    state.flush();
    assert.equal(menu.props.style.transform.length, 0);
    assert.ok(animations.some(animation => animation.kind === "timing" && animation.duration === 0));
    assert.equal(menu.props.style.left + origin.x, 302);
    assert.equal(menu.props.style.top + origin.y, props.anchor.y + props.anchor.height + 10);
    // Larger accessibility text must remain on-screen and clear of the trigger.
    props.anchor.y = 810;
    (menu.props as any).onLayout({ nativeEvent: { layout: { height: 100 } } });
    menu = elements(render()).find(node => node.type === "AnimatedView")!;
    assert.equal(menu.props.style.top + origin.y, 700);
    assert.ok(menu.props.style.top + origin.y + 100 < props.anchor.y);
    elements(render()).find(node => node.props.accessibilityLabel === "Close menu")!.props.onPress!();
    assert.equal(closed, 1);
    assert.equal(back!(), true);
    assert.equal(closed, 2);
    props.visible = false;
    render(); state.flush();
    assert.equal(render(), null);
  }
});

test("plus dropdown is left of its trigger and stays within narrow screen bounds", () => {
  const position = load("components/action-menu-style.ts", {}).actionMenuPosition;
  for (const width of [280, 320, 402]) {
    const anchor = { x: width - 86, y: 630, width: 55, height: 55 };
    const placed = position(anchor, width, 844, 67, "left", 112);
    assert.equal(placed.width, 112);
    assert.equal(placed.left + placed.width + 10, anchor.x);
    assert.equal(placed.top + 67 / 2, anchor.y + anchor.height / 2);
    assert.ok(placed.left >= 16);
  }
});

test("dropdowns close on navigation blur and release native Back listeners on close and unmount", () => {
  const state = hooks();
  let effectCursor = 0;
  const effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  const pending: (() => void)[] = [];
  const react = {
    ...state.react,
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = effectCursor++;
      const previous = effects[index];
      if (previous && deps.every((dep, key) => Object.is(dep, previous.deps[key]))) return;
      const slot = { deps, cleanup: previous?.cleanup };
      effects[index] = slot;
      pending.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
    },
  };
  let focused = true;
  let oldCloses = 0;
  let latestCloses = 0;
  let subscriptionId = 0;
  let removed = 0;
  let stoppedAnimations = 0;
  const backListeners = new Map<number, () => boolean>();
  const animate = () => ({ start: (done: (result: { finished: boolean }) => void) => done({ finished: true }), stop: () => { stoppedAnimations++; } });
  const module = load("components/anchored-action-overlay.tsx", {
    react,
    "expo-router": { useIsFocused: () => focused },
    "react-native": {
      View: "View", Pressable: "Pressable", Platform: { OS: "android" },
      BackHandler: { addEventListener: (event: string, callback: () => boolean) => {
        assert.equal(event, "hardwareBackPress");
        const id = ++subscriptionId;
        backListeners.set(id, callback);
        return { remove: () => { backListeners.delete(id); removed++; } };
      } },
      Animated: { View: "AnimatedView", Value: class { interpolate(config: unknown) { return config; } }, timing: animate, spring: animate },
      StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
    },
  });
  const props = {
    visible: true, anchor: { x: 320, y: 200, width: 21, height: 5 }, closeLabel: "Close menu",
    onClose: () => { oldCloses++; props.visible = false; }, children: "Actions",
  };
  const render = () => { state.reset(); effectCursor = 0; return module.AnchoredActionOverlay(props); };
  const flush = () => pending.splice(0).forEach(effect => effect());
  const root = render();
  root.props.ref.current = { measureInWindow: (callback: (x: number, y: number) => void) => callback(0, 59) };
  root.props.onLayout();
  flush();
  render(); flush();
  assert.equal(backListeners.size, 1);
  props.onClose = () => { latestCloses++; props.visible = false; };
  focused = false;
  assert.equal(render(), null); // A retained tab screen must not paint its menu after losing focus.
  flush();
  assert.equal(latestCloses, 1);
  assert.equal(oldCloses, 0); // Blur uses the current callback rather than a stale closure.
  assert.equal(backListeners.size, 0);
  assert.equal(removed, 1);
  render(); flush();
  focused = true;
  assert.equal(render(), null);
  flush();

  props.visible = true;
  render(); flush();
  assert.ok(render());
  assert.equal(backListeners.size, 1);
  assert.equal([...backListeners.values()][0](), true);
  assert.equal(latestCloses, 2);
  render(); flush();
  assert.equal(backListeners.size, 0);
  assert.equal(removed, 2);

  props.visible = true;
  render(); flush();
  assert.equal(backListeners.size, 1);
  effects.forEach(effect => effect.cleanup?.());
  assert.equal(backListeners.size, 0);
  assert.equal(removed, 3);
  assert.ok(stoppedAnimations > 0);
});

test("large-text add menus widen and wrap while retaining the gap beside the plus on narrow screens", () => {
  const position = load("components/action-menu-style.ts", {}).actionMenuPosition;
  for (const width of [280, 320, 402]) for (const fontScale of [0.8, 1, 2, 3]) {
    const state = hooks();
    const module = load("app/(tabs)/space-detail.tsx", {
      react: state.react,
      "@/components/space-management": { SpaceManagement: "SpaceManagement" },
      "@/components/plant-action-menu": { PlantActionMenu: "PlantActionMenu" },
      "@/components/space-menu-button": { SpaceMenuButton: "SpaceMenuButton" },
      "@/context/spaces": { useSpaces: () => ({ ready: true, spaces: ["Bedroom"], plantsBySpace: {} }) },
      "@/context/app-data": { useAppData: () => ({ guest: true }) },
      "@expo/vector-icons": { Ionicons: "Icon" },
      "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
      "expo-router": { useLocalSearchParams: () => ({ space: "Bedroom" }), useRouter: () => ({}) },
      "react-native": {
        View: "View", Text: "Text", Image: "Image", Pressable: "Pressable", ScrollView: "ScrollView",
        Modal: "Modal", KeyboardAvoidingView: "KeyboardAvoidingView", RefreshControl: "RefreshControl", TextInput: "TextInput",
        Platform: { OS: "ios" }, StyleSheet: { create: (styles: unknown) => styles },
        useWindowDimensions: () => ({ width, height: 844, fontScale }),
      },
    });
    const nodes = elements(module.default());
    const menu = nodes.find(node => node.type === "AnchoredActionOverlay")!;
    const preferred = Math.ceil(112 * Math.max(1, fontScale));
    assert.equal((menu.props as any).menuWidth, preferred);
    const anchor = { x: width - 86, y: 630, width: 55, height: 55 };
    const placed = position(anchor, width, 844, fontScale > 1 ? 140 : 67, "left", preferred);
    assert.ok(placed.width <= preferred);
    assert.equal(placed.left + placed.width + 10, anchor.x);
    assert.ok(placed.left >= 16);
    assert.ok(placed.top >= 16 && placed.top + 140 <= 844 - 16);
    for (const label of elements(menu).filter(node => node.type === "Text")) {
      assert.equal((label.props as any).numberOfLines, undefined);
      assert.equal(label.props.style[0].fontSize, 14);
    }
  }
});

test("plus opens only Scan Plant and Add a Plant beside it, dismisses outside, and preserves flows in both sessions", () => {
  for (const guest of [true, false]) {
    const state = hooks();
    const routes: unknown[] = [];
    const module = load("app/(tabs)/space-detail.tsx", {
      react: state.react,
      "@/components/space-management": { SpaceManagement: "SpaceManagement" },
      "@/components/plant-action-menu": { PlantActionMenu: "PlantActionMenu" },
      "@/components/space-menu-button": { SpaceMenuButton: "SpaceMenuButton" },
      "@/context/spaces": { useSpaces: () => ({ ready: true, spaces: ["Bedroom"], plantsBySpace: {} }) },
      "@/context/app-data": { useAppData: () => ({ guest }) },
      "@expo/vector-icons": { Ionicons: "Icon" },
      "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
      "expo-router": { useLocalSearchParams: () => ({ space: "Bedroom" }), useRouter: () => ({ push: (route: unknown) => routes.push(route) }) },
    });
    const render = () => { state.reset(); return elements(module.default()); };
    const open = () => {
      const plus = render().find(node => node.props.accessibilityLabel === "Add plant")!;
      (plus.props as any).ref.current = { measureInWindow: (callback: (...args: number[]) => void) => callback(316, 650, 55, 55) };
      plus.props.onPress!();
    };
    const menu = () => render().find(node => node.type === "AnchoredActionOverlay")!;
    assert.equal(menu().props.visible, false);
    open();
    assert.equal(menu().props.visible, true);
    assert.equal((menu().props as any).placement, "left");
    assert.equal((menu().props as any).menuWidth, 112);
    assert.equal((menu().props as any).anchor.x, 316);
    assert.deepEqual(elements(menu()).filter(node => node.type === "Pressable").map(node => node.props.accessibilityLabel), ["Scan Plant", "Add a Plant"]);
    for (const button of elements(menu()).filter(node => node.type === "Pressable")) {
      const label = elements(button).find(node => node.type === "Text")!;
      assert.equal((label.props as any).numberOfLines, undefined); // Enlarged text can wrap instead of being clipped.
      assert.equal(label.props.style[0].fontSize, 14); // Widen the menu rather than shrinking labels.
      assert.ok(button.props.style[1].paddingHorizontal >= 12);
    }
    assert.ok(!elements(menu()).some(node => node.props.children === "Cancel" || node.props.children === "Add to this space"));
    (menu().props as any).onClose();
    assert.equal(menu().props.visible, false);
    assert.equal(routes.length, 0);
    open();
    elements(menu()).find(node => node.props.accessibilityLabel === "Scan Plant")!.props.onPress!();
    assert.deepEqual(JSON.parse(JSON.stringify(routes)), [{ pathname: "/(tabs)/scanner", params: { space: "Bedroom" } }]);
    assert.equal(menu().props.visible, false);
    open();
    elements(menu()).find(node => node.props.accessibilityLabel === "Add a Plant")!.props.onPress!();
    assert.equal(menu().props.visible, false);
    assert.equal(render().filter(node => node.type === "Modal").at(-1)!.props.visible, true);
  }
});

test("anchored dropdown sits below dots, closes outside or on selection, and confirms destructive changes", async () => {
  const state = hooks();
  let activeSpace: string | null = "Porch";
  const writes: string[] = [];
  let finishArchive!: () => void;
  const module = load("components/space-management.tsx", {
    react: state.react,
    "@expo/vector-icons": { Ionicons: "Icon" },
    "@/context/spaces": { useSpaces: () => ({
      archiveSpace: async (space: string) => { writes.push(`archive:${space}`); await new Promise<void>(resolve => { finishArchive = resolve; }); },
      deleteSpace: async (space: string) => { writes.push(`delete:${space}`); },
    }) },
  });
  const anchor = { x: 270, y: 140, width: 75, height: 32 };
  const render = () => { state.reset(); return elements(module.SpaceManagement({ space: activeSpace, anchor, onClose: () => { activeSpace = null; } })); };
  const press = (label: string) => label === "Close space menu" ? (render()[0].props as any).onClose() : render().find(node => node.props.accessibilityLabel === label)!.props.onPress!();
  const menu = render()[0];
  assert.equal(menu.type, "AnchoredActionOverlay");
  assert.equal((menu.props as any).anchor, anchor);
  const position = load("components/action-menu-style.ts", {}).actionMenuPosition;
  assert.equal(position(anchor, 390, 844).top, 182);
  assert.equal(position(anchor, 390, 844).left, 272);
  assert.equal(menu.props.style, undefined);
  assert.deepEqual(elements(menu).filter(node => node.type === "Pressable").map(node => node.props.accessibilityLabel), ["Archive", "Delete"]);
  assert.equal(elements(menu).find(node => node.props.children === "Archive")!.props.style[1].color, "#34C759");
  assert.equal(elements(menu).find(node => node.props.children === "Delete")!.props.style[1].color, "#FF0005");
  anchor.x = 360; anchor.y = 810;
  assert.equal(position(anchor, 390, 844).left, 299); // Keep the right edge inside the viewport.
  assert.equal(position(anchor, 390, 844).top, 733); // Remain anchored above when there is no room below.
  assert.ok(position(anchor, 390, 844).top + 67 <= 844 - 16);
  anchor.x = 270; anchor.y = 140;
  press("Close space menu");
  assert.equal(render()[0].props.visible, false);
  assert.deepEqual(writes, []);
  activeSpace = "Porch";
  press("Delete");
  assert.ok(!render().some(node => node.props.accessibilityLabel === "Close space menu"));
  assert.deepEqual(writes, []);
  press("Confirm delete space");
  await nextTurn();
  assert.deepEqual(writes, ["delete:Porch"]);
  assert.equal(activeSpace, null);
  activeSpace = "Porch";
  press("Archive");
  assert.deepEqual(writes, ["delete:Porch"]);
  assert.ok(render().some(node => node.props.accessibilityLabel === "Archive space Porch"));
  press("Confirm archive space");
  assert.ok(!render().some(node => node.props.accessibilityLabel === "Close space menu"));
  assert.ok(render().some(node => node.type === "ActivityIndicator"));
  finishArchive();
  await nextTurn();
  assert.equal(activeSpace, null);
  assert.deepEqual(writes, ["delete:Porch", "archive:Porch"]);
});

test("space Archive and Delete use existing persistence, confirm deletion, and retain failed changes", async () => {
  const state = hooks();
  const writes: string[] = [];
  let fail = true;
  let failArchive = true;
  let closed = 0;
  const module = load("components/space-management.tsx", {
    react: state.react,
    "@expo/vector-icons": { Ionicons: "Icon" },
    "@/context/spaces": { useSpaces: () => ({
      spaces: ["Bedroom", "Porch"],
      archiveSpace: async (space: string) => { writes.push(`archive:${space}`); if (failArchive) throw new Error("Unable to archive"); },
      deleteSpace: async (space: string) => { writes.push(`delete:${space}`); if (fail) throw new Error("Storage unavailable"); },
    }) },
  });
  const render = () => { state.reset(); return elements(module.SpaceManagement({ space: "Bedroom", onClose: () => closed++ })); };
  const press = (label: string) => render().find(node => node.props.accessibilityLabel === label)!.props.onPress!();
  const archive = render().find(node => node.props.accessibilityLabel === "Archive")!;
  assert.equal(elements(archive)[1].props.name, "archive-outline");
  assert.equal(elements(archive)[2].props.style?.color, "#278448");
  const trash = render().find(node => node.props.accessibilityLabel === "Delete")!;
  assert.equal(elements(trash)[1].props.name, "trash-outline");
  assert.equal(elements(trash)[2].props.style?.color, "#D93636");
  press("Delete");
  assert.deepEqual(writes, []);
  render().find(node => node.type === "Pressable" && node.props.children && elements(node).some(child => child.props.children === "Cancel"))!.props.onPress!();
  assert.equal(closed, 1);
  assert.deepEqual(writes, []);
  press("Delete");
  press("Confirm delete space");
  await nextTurn();
  assert.equal(closed, 1);
  assert.ok(render().some(node => node.props.children === "Storage unavailable"));
  fail = false;
  press("Confirm delete space");
  await nextTurn();
  assert.equal(closed, 2);
  press("Archive");
  press("Archive space Porch");
  assert.equal(closed, 2);
  press("Confirm archive space");
  await nextTurn();
  assert.equal(closed, 2);
  assert.ok(render().some(node => node.props.children === "Unable to archive"));
  failArchive = false;
  press("Confirm archive space");
  await nextTurn();
  assert.deepEqual(writes, ["delete:Bedroom", "delete:Bedroom", "archive:Porch", "archive:Porch"]);
  assert.equal(closed, 3);
});

test("detail archive is scoped to the viewed space, with separate compact styling and retained fade dismissal", async () => {
  const state = hooks();
  const writes: string[] = [];
  let space: string | null = "Bedroom";
  let anchor: { x: number; y: number; width: number; height: number } | undefined = { x: 320, y: 40, width: 44, height: 32 };
  const module = load("components/space-management.tsx", {
    react: state.react, "@expo/vector-icons": { Ionicons: "Icon" },
    "@/context/spaces": { useSpaces: () => ({ spaces: ["Bedroom", "Porch"], archiveSpace: async (name: string) => writes.push(name) }) },
  });
  const render = () => { state.reset(); return elements(module.SpaceManagement({ space, anchor, variant: "detail", onClose: () => { space = null; anchor = undefined; } })); };
  const menu = render()[0];
  assert.equal(menu.type, "AnchoredActionOverlay");
  assert.equal((menu.props as any).anchor, anchor);
  render().find(node => node.props.accessibilityLabel === "Archive")!.props.onPress!();
  assert.ok(!render().some(node => node.props.accessibilityLabel === "Archive space Porch"));
  assert.ok(render().some(node => String(node.props.children).includes("Archive Bedroom?")));
  const confirm = render().find(node => node.props.accessibilityLabel === "Confirm archive space")!;
  assert.equal(confirm.props.style.alignSelf, "center");
  confirm.props.onPress!(); await nextTurn();
  assert.deepEqual(writes, ["Bedroom"]);
  assert.equal(render()[0].props.visible, false);
  assert.equal(render()[0].type, "AnchoredActionOverlay");
  assert.equal((render()[0].props as any).anchor, (menu.props as any).anchor); // Retain the anchor during fade-out.
});

test("plant menus are separate from spaces and gate unsupported Archive and guest deletion", () => {
  for (const guest of [true, false]) {
    let closed = 0; const deleted: string[] = [];
    const module = load("components/plant-action-menu.tsx", { react: hooks().react });
    const node = module.PlantActionMenu({ plant: { id: "p1", name: "Fern" }, anchor: { x: 260, y: 220, width: 32, height: 28 }, guest, onClose: () => closed++, onDelete: (id: string) => deleted.push(id) });
    const nodes = elements(node);
    assert.equal(node.type, "AnchoredActionOverlay");
    assert.equal(nodes.find(n => n.props.accessibilityLabel === "Archive plant unavailable")!.props.disabled, true);
    const remove = nodes.find(n => n.props.accessibilityLabel === "Delete Fern")!;
    assert.equal(remove.props.disabled, guest);
    remove.props.onPress!();
    assert.deepEqual(deleted, guest ? [] : ["p1"]);
    assert.equal(closed, guest ? 0 : 1);
    (node.props as any).onClose();
    assert.equal(closed, guest ? 1 : 2);
  }
});

test("long press plant removal can be cancelled and only commits confirmed successful account deletion", async () => {
  const state = hooks();
  let plants = [{ id: "p1", name: "Fern" }];
  const deleted: string[] = [];
  const navigated: unknown[] = [];
  let fail = true;
  const module = load("app/(tabs)/space-detail.tsx", {
    react: state.react,
    "@/components/space-management": { SpaceManagement: "SpaceManagement" },
    "@/components/plant-action-menu": { PlantActionMenu: "PlantActionMenu" },
    "@/components/space-menu-button": { SpaceMenuButton: "SpaceMenuButton" },
    "@/context/spaces": { useSpaces: () => ({ ready: true, spaces: ["Bedroom"], plantsBySpace: { Bedroom: plants } }) },
    "@/context/app-data": { useAppData: () => ({ guest: false, deletePlant: async (id: string) => {
      deleted.push(id); if (fail) throw new Error("Offline"); plants = plants.filter(plant => plant.id !== id);
    } }) },
    "@expo/vector-icons": { Ionicons: "Icon" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "expo-router": { useLocalSearchParams: () => ({ space: "Bedroom" }), useRouter: () => ({ push: (route: unknown) => navigated.push(route) }) },
  });
  const render = () => { state.reset(); return elements(module.default()); };
  const press = (label: string) => render().find(node => node.props.accessibilityLabel === label)!.props.onPress!();
  const tile = render().find(node => node.props.accessibilityLabel === "Open Fern")!;
  tile.props.onLongPress!();
  tile.props.onPress!(); // Long-press release must not navigate, even before a render.
  assert.deepEqual(navigated, []);
  const minus = render().find(node => node.props.accessibilityLabel === "Delete Fern")!;
  assertSiblingCardActions(cardContainer(render(), "Open Fern"));
  assert.equal(minus.props.style.width, 44);
  assert.equal(minus.props.style.height, 44);
  assert.equal(elements(minus)[1].props.style.borderColor, "#D93636");
  assert.equal(elements(minus)[1].props.style.width, 16);
  (minus.props.onPress as any)({ stopPropagation() {} });
  assert.deepEqual(deleted, []);
  press("Cancel plant deletion");
  assert.equal(render().filter(node => node.type === "Modal")[0].props.visible, false);
  (render().find(node => node.props.accessibilityLabel === "Delete Fern")!.props.onPress as any)({ stopPropagation() {} });
  press("Confirm delete plant");
  await nextTurn();
  assert.equal(plants.length, 1);
  assert.equal(render().filter(node => node.type === "Modal")[0].props.visible, true);
  assert.ok(render().some(node => node.props.children === "Offline"));
  fail = false;
  press("Confirm delete plant");
  await nextTurn();
  assert.equal(plants.length, 0);
  assert.deepEqual(deleted, ["p1", "p1"]);
  assert.equal(render().filter(node => node.type === "Modal")[0].props.visible, false);
  press("Cancel plant removal");
  assert.ok(!render().some(node => node.props.accessibilityLabel === "Cancel plant removal"));
});
