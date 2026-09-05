import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { listConfiguredPackages, printConfiguredPackages } from "../src/cli/list-packages.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const tempDirs: string[] = [];

function makeTempSetup(): { tempDir: string; agentDir: string; cwd: string } {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-list-packages-"));
	tempDirs.push(tempDir);
	const agentDir = join(tempDir, "agent");
	const cwd = join(tempDir, "cwd");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	return { tempDir, agentDir, cwd };
}

function writeSettings(agentDir: string, cwd: string, globalPackages: unknown[], projectPackages: unknown[]): void {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: globalPackages }));
	writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: projectPackages }));
}

function captureLog(fn: () => void): string[] {
	const lines: string[] = [];
	const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		lines.push(args.map(String).join(" "));
	});
	try {
		fn();
	} finally {
		spy.mockRestore();
	}
	// Strip ANSI codes so chalk styling does not affect assertions.
	return lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("printConfiguredPackages", () => {
	test("prints 'No packages installed.' when nothing is configured", () => {
		const { agentDir, cwd } = makeTempSetup();
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const lines = captureLog(() => printConfiguredPackages(cwd, agentDir, settingsManager));
		expect(lines).toEqual(["No packages installed."]);
	});

	test("lists user packages with sources, filtered markers, and installed paths", () => {
		const { agentDir, cwd } = makeTempSetup();
		writeSettings(
			agentDir,
			cwd,
			[
				"npm:pi-web-access",
				{ source: "npm:@scope/pkg", extensions: ["example"] },
				"npm:not-installed",
				"./local-pkg",
				"https://github.com/owner/repo",
			],
			[],
		);
		// Managed install dirs for the packages that exist on disk.
		mkdirSync(join(agentDir, "npm", "node_modules", "pi-web-access"), { recursive: true });
		mkdirSync(join(agentDir, "npm", "node_modules", "@scope", "pkg"), { recursive: true });
		mkdirSync(join(agentDir, "local-pkg"), { recursive: true });
		mkdirSync(join(agentDir, "git", "github.com", "owner", "repo"), { recursive: true });

		const settingsManager = SettingsManager.create(cwd, agentDir);
		const lines = captureLog(() => printConfiguredPackages(cwd, agentDir, settingsManager));

		expect(lines).toEqual([
			"User packages:",
			"  npm:pi-web-access",
			`    ${join(agentDir, "npm", "node_modules", "pi-web-access")}`,
			"  npm:@scope/pkg (filtered)",
			`    ${join(agentDir, "npm", "node_modules", "@scope", "pkg")}`,
			"  npm:not-installed",
			"  ./local-pkg",
			`    ${join(agentDir, "local-pkg")}`,
			"  https://github.com/owner/repo",
			`    ${join(agentDir, "git", "github.com", "owner", "repo")}`,
		]);
	});

	test("prints project packages after user packages with a blank line between sections", () => {
		const { agentDir, cwd } = makeTempSetup();
		writeSettings(agentDir, cwd, ["npm:user-pkg"], ["npm:proj-pkg"]);
		mkdirSync(join(agentDir, "npm", "node_modules", "user-pkg"), { recursive: true });
		mkdirSync(join(cwd, ".pi", "npm", "node_modules", "proj-pkg"), { recursive: true });

		const settingsManager = SettingsManager.create(cwd, agentDir);
		const lines = captureLog(() => printConfiguredPackages(cwd, agentDir, settingsManager));

		expect(lines).toEqual([
			"User packages:",
			"  npm:user-pkg",
			`    ${join(agentDir, "npm", "node_modules", "user-pkg")}`,
			"",
			"Project packages:",
			"  npm:proj-pkg",
			`    ${join(cwd, ".pi", "npm", "node_modules", "proj-pkg")}`,
		]);
	});

	test("prints only the project section when only project packages exist", () => {
		const { agentDir, cwd } = makeTempSetup();
		writeSettings(agentDir, cwd, [], ["npm:proj-only"]);

		const settingsManager = SettingsManager.create(cwd, agentDir);
		const lines = captureLog(() => printConfiguredPackages(cwd, agentDir, settingsManager));

		expect(lines).toEqual(["Project packages:", "  npm:proj-only"]);
	});

	test("resolves absolute local paths against the scope root", () => {
		const { agentDir, cwd } = makeTempSetup();
		const absPkg = join(agentDir, "abs-pkg");
		writeSettings(agentDir, cwd, [absPkg], []);
		mkdirSync(absPkg, { recursive: true });

		const settingsManager = SettingsManager.create(cwd, agentDir);
		const lines = captureLog(() => printConfiguredPackages(cwd, agentDir, settingsManager));

		expect(lines).toEqual(["User packages:", `  ${absPkg}`, `    ${absPkg}`]);
	});
});

describe("listConfiguredPackages", () => {
	test("returns structured entries with scope, filtered flag, and installed path", () => {
		const { agentDir, cwd } = makeTempSetup();
		writeSettings(agentDir, cwd, ["npm:user-pkg", { source: "npm:filtered-pkg", skills: ["s"] }], ["npm:proj-pkg"]);
		mkdirSync(join(agentDir, "npm", "node_modules", "user-pkg"), { recursive: true });

		const settingsManager = SettingsManager.create(cwd, agentDir);
		const packages = listConfiguredPackages(settingsManager, cwd, agentDir);

		expect(packages).toEqual([
			{
				source: "npm:user-pkg",
				scope: "user",
				filtered: false,
				installedPath: join(agentDir, "npm", "node_modules", "user-pkg"),
			},
			{ source: "npm:filtered-pkg", scope: "user", filtered: true, installedPath: undefined },
			{ source: "npm:proj-pkg", scope: "project", filtered: false, installedPath: undefined },
		]);
	});
});
