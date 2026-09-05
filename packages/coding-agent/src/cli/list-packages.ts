import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { CONFIG_DIR_NAME } from "../config.ts";
import type { PackageSource, SettingsManager } from "../core/settings-manager.ts";
import { type GitSource, parseGitUrl } from "../utils/git.ts";
import { isLocalPath, resolvePath } from "../utils/paths.ts";

export type PackageScope = "user" | "project";

export interface ConfiguredPackage {
	source: string;
	scope: PackageScope;
	filtered: boolean;
	installedPath: string | undefined;
}

type ParsedSource = { type: "npm"; name: string } | GitSource | { type: "local"; path: string };

function parseSource(source: string): ParsedSource {
	if (source.startsWith("npm:")) {
		const spec = source.slice("npm:".length).trim();
		// npm spec: [@scope/]name[@version]
		const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
		return { type: "npm", name: match?.[1] ?? spec };
	}

	if (isLocalPath(source)) {
		return { type: "local", path: source };
	}

	const gitParsed = parseGitUrl(source);
	if (gitParsed) {
		return gitParsed;
	}

	return { type: "local", path: source };
}

/**
 * Resolve the managed install path for a configured package source.
 * Returns undefined when the path does not exist on disk. Mirrors the
 * managed npm/git/local install layout of the former package manager
 * without restoring any install machinery: npm and git packages live
 * under <scope root>/npm/node_modules and <scope root>/git, local
 * sources resolve relative to the scope root.
 */
export function getInstalledPath(
	source: string,
	scope: PackageScope,
	agentDir: string,
	cwd: string,
): string | undefined {
	const parsed = parseSource(source);
	if (parsed.type === "npm") {
		const nodeModules =
			scope === "project"
				? join(cwd, CONFIG_DIR_NAME, "npm", "node_modules")
				: join(agentDir, "npm", "node_modules");
		const path = join(nodeModules, parsed.name);
		return existsSync(path) ? path : undefined;
	}
	if (parsed.type === "git") {
		const installRoot = scope === "project" ? join(cwd, CONFIG_DIR_NAME, "git") : join(agentDir, "git");
		const path = join(installRoot, parsed.host, parsed.path);
		return existsSync(path) ? path : undefined;
	}
	const scopeRoot = scope === "project" ? join(cwd, CONFIG_DIR_NAME) : agentDir;
	const path = resolvePath(parsed.path, scopeRoot);
	return existsSync(path) ? path : undefined;
}

/** Read configured packages from global (user) and project settings. */
export function listConfiguredPackages(
	settingsManager: SettingsManager,
	cwd: string,
	agentDir: string,
): ConfiguredPackage[] {
	const configuredPackages: ConfiguredPackage[] = [];
	for (const pkg of settingsManager.getGlobalSettings().packages ?? []) {
		configuredPackages.push(toConfiguredPackage(pkg, "user", agentDir, cwd));
	}
	for (const pkg of settingsManager.getProjectSettings().packages ?? []) {
		configuredPackages.push(toConfiguredPackage(pkg, "project", agentDir, cwd));
	}
	return configuredPackages;
}

function toConfiguredPackage(
	pkg: PackageSource,
	scope: PackageScope,
	agentDir: string,
	cwd: string,
): ConfiguredPackage {
	const source = typeof pkg === "string" ? pkg : pkg.source;
	return {
		source,
		scope,
		filtered: typeof pkg === "object",
		installedPath: getInstalledPath(source, scope, agentDir, cwd),
	};
}

/** Print configured packages grouped by scope, matching the original pi list output. */
export function printConfiguredPackages(cwd: string, agentDir: string, settingsManager: SettingsManager): void {
	const configuredPackages = listConfiguredPackages(settingsManager, cwd, agentDir);
	const userPackages = configuredPackages.filter((pkg) => pkg.scope === "user");
	const projectPackages = configuredPackages.filter((pkg) => pkg.scope === "project");

	if (configuredPackages.length === 0) {
		console.log(chalk.dim("No packages installed."));
		return;
	}

	const formatPackage = (pkg: ConfiguredPackage): void => {
		const display = pkg.filtered ? `${pkg.source} (filtered)` : pkg.source;
		console.log(`  ${display}`);
		if (pkg.installedPath) {
			console.log(chalk.dim(`    ${pkg.installedPath}`));
		}
	};

	if (userPackages.length > 0) {
		console.log(chalk.bold("User packages:"));
		for (const pkg of userPackages) {
			formatPackage(pkg);
		}
	}

	if (projectPackages.length > 0) {
		if (userPackages.length > 0) console.log();
		console.log(chalk.bold("Project packages:"));
		for (const pkg of projectPackages) {
			formatPackage(pkg);
		}
	}
}
