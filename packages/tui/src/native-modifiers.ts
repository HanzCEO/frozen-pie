import { createRequire } from "node:module";
import * as path from "node:path";
import { getNativeModuleCandidates } from "./native-module-path.ts";

const cjsRequire = createRequire(import.meta.url);

export type ModifierKey = "shift" | "command" | "control" | "option";

type NativeModifiersHelper = {
	isModifierPressed: (name: ModifierKey) => boolean;
};

let nativeModifiersHelper: NativeModifiersHelper | null | undefined;

function isNativeModifiersHelper(value: unknown): value is NativeModifiersHelper {
	if (typeof value !== "object" || value === null) return false;
	const candidate = (value as { isModifierPressed?: unknown }).isModifierPressed;
	return typeof candidate === "function";
}

function loadNativeModifiersHelper(): NativeModifiersHelper | undefined {
	if (nativeModifiersHelper !== undefined) return nativeModifiersHelper ?? undefined;
	nativeModifiersHelper = null;
	const arch = process.arch;
	if (arch !== "x64" && arch !== "arm64") return undefined;

	if (process.platform !== "darwin") {
		return undefined;
	}
	const nativePath = path.join("native", "darwin", "prebuilds", `darwin-${arch}`, "darwin-modifiers.node");

	for (const modulePath of getNativeModuleCandidates(nativePath)) {
		try {
			const helper = cjsRequire(modulePath) as unknown;
			if (isNativeModifiersHelper(helper)) {
				nativeModifiersHelper = helper;
				return helper;
			}
		} catch {
			// Try the next possible packaging location.
		}
	}

	return undefined;
}

export function isNativeModifierPressed(key: ModifierKey): boolean {
	const helper = loadNativeModifiersHelper();
	if (!helper) return false;
	try {
		return helper.isModifierPressed(key) === true;
	} catch {
		return false;
	}
}
