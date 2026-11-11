import * as fs from "fs";
import * as path from "path";

/** True if `target` is `root` or lies inside it. Uses path.relative. */
export function isInside(root: string, target: string): boolean {
    const rel = path.relative(root, target);
    return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

/**
 * Maps a model-supplied path to a real host path that is guaranteed to be inside
 * `workspaceRoot` after resolving every symlink, closing all jailbreaks.
 */
export function resolveInsideWorkspace(workspaceRoot: string, requested: string): string {
    const root = fs.realpathSync.native(workspaceRoot);

    let rel = requested;
    if (rel === "/workspace") rel = ".";
    else if (rel.startsWith("/workspace/")) rel = rel.slice("/workspace/".length);

    const target = path.resolve(root, rel);
    if (!isInside(root, target)) {
        throw new Error(`SECURITY VIOLATION: Path '${requested}' escapes the workspace.`);
    }

    // Find the deepest ancestor that exists on disk
    let probe = target;
    const missing: string[] = [];
    for (;;) {
        let exists = true;
        try {
            fs.lstatSync(probe);
        } catch (e: any) {
            if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
            exists = false;
        }
        if (exists) break;
        const parent = path.dirname(probe);
        if (parent === probe) break;
        missing.push(path.basename(probe));
        probe = parent;
    }

    let real: string;
    try {
        real = fs.realpathSync.native(probe);
    } catch {
        throw new Error(`SECURITY VIOLATION: '${requested}' goes through a dangling or unreadable symlink.`);
    }

    const resolved = path.join(real, ...missing.reverse());
    if (!isInside(root, resolved)) {
        throw new Error(`SECURITY VIOLATION: Path '${requested}' escapes the workspace via symlink.`);
    }
    return resolved;
}