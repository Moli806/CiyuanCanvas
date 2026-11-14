import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../../", import.meta.url);

function loadPresetModule() {
    const source = readFileSync(new URL("lib/canvas/canvas-preset-workflow.ts", root), "utf8").replace("import.meta.env?.BASE_URL", '"/canvas/"');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    let seq = 0;
    const context = {
        exports: {},
        require: (name) => {
            if (name === "nanoid") return { nanoid: () => `id-${++seq}` };
            if (name === "@/types/canvas") {
                return {
                    CanvasNodeType: { Text: "text", Image: "image", Video: "video", Audio: "audio", Group: "group", Config: "config" },
                };
            }
            if (name === "./canvas-resource-references") {
                return { getGroupResourceNodes: () => [] };
            }
            return {};
        },
        URL,
        DOMException,
        window: { location: { origin: "https://ciyuanweb.cn" }, setTimeout, clearTimeout },
    };
    vm.runInNewContext(code, context, { filename: "canvas-preset-workflow.ts" });
    return context.exports;
}

test("fresh preset workflow graph passes unmodified check across diamond DAG and builds 3 topological stages", () => {
    const mod = loadPresetModule();
    const { nodes, connections } = mod.buildPresetWorkflowGraph();
    assert.equal(nodes.length, 12);
    assert.equal(connections.length, 16);
    assert.equal(mod.isEntireWorkflowUnmodifiedPreset(nodes, connections), true);

    const stages = mod.buildWorkflowStages(nodes, connections);
    assert.equal(stages.length, 3);
    assert.deepEqual(
        JSON.parse(JSON.stringify(stages.map((stage) => stage.map((node) => node.id)))),
        [
            [mod.PRESET_NODE_IDS.cfgThreeView, mod.PRESET_NODE_IDS.cfgScene, mod.PRESET_NODE_IDS.cfgScript],
            [mod.PRESET_NODE_IDS.cfgStoryboard],
            [mod.PRESET_NODE_IDS.cfgVideo],
        ],
    );
});

test("channel-prefixed model names remain recognized as unmodified preset", () => {
    const mod = loadPresetModule();
    const { nodes, connections } = mod.buildPresetWorkflowGraph();
    const prefixedNodes = nodes.map((node) =>
        node.id === mod.PRESET_NODE_IDS.cfgThreeView
            ? { ...node, metadata: { ...node.metadata, model: "ciyuan::gpt-image-2.6-flare" } }
            : node,
    );
    assert.equal(mod.isEntireWorkflowUnmodifiedPreset(prefixedNodes, connections), true);
});

test("replacing character reference marks dependent branches modified while keeping scene branch free", () => {
    const mod = loadPresetModule();
    const { nodes, connections } = mod.buildPresetWorkflowGraph();
    const editedNodes = nodes.map((node) =>
        node.id === mod.PRESET_NODE_IDS.inputPortrait
            ? { ...node, metadata: { ...node.metadata, content: "/canvas-assets/custom-avatar.png", storageKey: "image:custom" } }
            : node,
    );

    assert.equal(mod.isEntireWorkflowUnmodifiedPreset(editedNodes, connections), false);
    assert.equal(mod.isPresetConfigStepUnmodified(mod.PRESET_NODE_IDS.cfgScene, editedNodes, connections, false), true);
    assert.equal(mod.isPresetConfigStepUnmodified(mod.PRESET_NODE_IDS.cfgThreeView, editedNodes, connections, false), false);
    assert.equal(mod.isPresetConfigStepUnmodified(mod.PRESET_NODE_IDS.cfgScript, editedNodes, connections, false), false);
    assert.equal(mod.isPresetConfigStepUnmodified(mod.PRESET_NODE_IDS.cfgStoryboard, editedNodes, connections, false), false);
    assert.equal(mod.isPresetConfigStepUnmodified(mod.PRESET_NODE_IDS.cfgVideo, editedNodes, connections, false), false);
});

test("changing config aspect ratio or duration switches only that step and downstream to live mode", () => {
    const mod = loadPresetModule();
    const { nodes, connections } = mod.buildPresetWorkflowGraph();
    const editedNodes = nodes.map((node) =>
        node.id === mod.PRESET_NODE_IDS.cfgVideo ? { ...node, metadata: { ...node.metadata, size: "9:16" } } : node,
    );

    assert.equal(mod.isEntireWorkflowUnmodifiedPreset(editedNodes, connections), false);
    assert.equal(mod.isPresetConfigStepUnmodified(mod.PRESET_NODE_IDS.cfgStoryboard, editedNodes, connections, false), true);
    assert.equal(mod.isPresetConfigStepUnmodified(mod.PRESET_NODE_IDS.cfgVideo, editedNodes, connections, false), false);
});
