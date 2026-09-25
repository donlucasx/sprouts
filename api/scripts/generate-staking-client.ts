import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { readFileSync } from "node:fs";
import path from "node:path";

const idl = JSON.parse(readFileSync(path.join(import.meta.dirname, "../program/skr-staking-idl.json"), "utf8"));
const codama = createFromRoot(rootNodeFromAnchor(idl));
codama.accept(renderVisitor(path.join(import.meta.dirname, "../src/generated/staking"), { deleteFolderBeforeRendering: true }));
console.log("generated src/generated/staking");
