import type { CiyuanCapability, CiyuanModel } from "@/services/ciyuan";

export type CiyuanPricingUsageField = {
    type?: string;
    unit?: string;
    enum?: string[];
};

export type CiyuanPricingEntry = {
    model_name: string;
    quota_type?: number;
    model_ratio?: number;
    model_price?: number;
    completion_ratio?: number;
    enable_groups?: string[];
    billing_mode?: string;
    billing_expr?: string;
    billing_usage_schema?: Record<string, CiyuanPricingUsageField>;
};

export type ModelPriceUnit = "second" | "clip" | "image" | "request";

export type ModelPriceContext = {
    capability?: CiyuanCapability;
    hasReferenceVideo?: boolean;
    resolution?: string;
    seconds?: number;
    count?: number;
    userGroup?: string;
    groupRatios?: Record<string, number>;
    spec?: CiyuanModel;
    allowResolutionRange?: boolean;
};

export type ResolvedModelPrice = {
    unit: ModelPriceUnit;
    unitPrice: number;
    minUnitPrice: number;
    maxUnitPrice: number;
    isRange: boolean;
    videoInputSurcharge: boolean;
    videoInputMultiplier?: number;
    totalPrice?: number;
    resolution?: string;
};

type TokenType = "num" | "str" | "ident" | "op" | "punct" | "eof";
type Token = { type: TokenType; value: string };
type ExprValue = number | string | boolean | null;

type ExprNode =
    | { kind: "lit"; value: ExprValue }
    | { kind: "ident"; name: string }
    | { kind: "unary"; op: string; arg: ExprNode }
    | { kind: "binary"; op: string; left: ExprNode; right: ExprNode }
    | { kind: "ternary"; cond: ExprNode; yes: ExprNode; no: ExprNode }
    | { kind: "call"; name: string; args: ExprNode[] };

type ExprUsage = {
    seconds: boolean;
    requests: boolean;
    resolution: boolean;
    videoInput: boolean;
    imageCount: boolean;
    fixed: boolean;
    tokens: boolean;
};

type CompiledExpr = {
    ast: ExprNode;
    usage: ExprUsage;
};

const TOKEN_VARS = new Set(["p", "c", "cr", "cc", "cc1h", "cc12h", "len"]);
const compiledCache = new Map<string, CompiledExpr | null>();

function tokenize(source: string): Token[] | null {
    const tokens: Token[] = [];
    let index = 0;
    const trimmed = source.trim().replace(/^v1:/i, "").trim();
    while (index < trimmed.length) {
        const ch = trimmed[index];
        if (/\s/.test(ch)) {
            index += 1;
            continue;
        }
        if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(trimmed[index + 1] || ""))) {
            const start = index;
            while (index < trimmed.length && /[0-9.]/.test(trimmed[index])) index += 1;
            if (trimmed[index] === "e" || trimmed[index] === "E") {
                index += 1;
                if (trimmed[index] === "+" || trimmed[index] === "-") index += 1;
                while (index < trimmed.length && /[0-9]/.test(trimmed[index])) index += 1;
            }
            tokens.push({ type: "num", value: trimmed.slice(start, index) });
            continue;
        }
        if (ch === "\"" || ch === "'") {
            const quote = ch;
            index += 1;
            let value = "";
            while (index < trimmed.length && trimmed[index] !== quote) {
                if (trimmed[index] === "\\" && index + 1 < trimmed.length) {
                    const next = trimmed[index + 1];
                    value += next === "n" ? "\n" : next === "t" ? "\t" : next;
                    index += 2;
                } else {
                    value += trimmed[index];
                    index += 1;
                }
            }
            if (trimmed[index] !== quote) return null;
            index += 1;
            tokens.push({ type: "str", value });
            continue;
        }
        if (/[a-zA-Z_]/.test(ch)) {
            const start = index;
            while (index < trimmed.length && /[a-zA-Z0-9_]/.test(trimmed[index])) index += 1;
            tokens.push({ type: "ident", value: trimmed.slice(start, index) });
            continue;
        }
        const two = trimmed.slice(index, index + 2);
        if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
            tokens.push({ type: "op", value: two });
            index += 2;
            continue;
        }
        if ("+-*/%<>!".includes(ch)) {
            tokens.push({ type: "op", value: ch });
            index += 1;
            continue;
        }
        if ("()?:,".includes(ch)) {
            tokens.push({ type: "punct", value: ch });
            index += 1;
            continue;
        }
        return null;
    }
    tokens.push({ type: "eof", value: "" });
    return tokens;
}

function compileExpr(source: string): CompiledExpr | null {
    if (compiledCache.has(source)) return compiledCache.get(source) ?? null;
    const tokens = tokenize(source);
    if (!tokens) {
        compiledCache.set(source, null);
        return null;
    }
    let cursor = 0;
    const usage: ExprUsage = { seconds: false, requests: false, resolution: false, videoInput: false, imageCount: false, fixed: false, tokens: false };
    const peek = () => tokens[cursor];
    const eat = () => tokens[cursor++];

    const parseTernary = (): ExprNode | null => {
        const cond = parseOr();
        if (!cond) return null;
        if (peek().type === "punct" && peek().value === "?") {
            eat();
            const yes = parseTernary();
            if (!yes || peek().type !== "punct" || peek().value !== ":") return null;
            eat();
            const no = parseTernary();
            if (!no) return null;
            return { kind: "ternary", cond, yes, no };
        }
        return cond;
    };

    const parseOr = (): ExprNode | null => {
        let left = parseAnd();
        while (left && peek().type === "op" && peek().value === "||") {
            const op = eat().value;
            const right = parseAnd();
            if (!right) return null;
            left = { kind: "binary", op, left, right };
        }
        return left;
    };

    const parseAnd = (): ExprNode | null => {
        let left = parseEquality();
        while (left && peek().type === "op" && peek().value === "&&") {
            const op = eat().value;
            const right = parseEquality();
            if (!right) return null;
            left = { kind: "binary", op, left, right };
        }
        return left;
    };

    const parseEquality = (): ExprNode | null => {
        let left = parseRelational();
        while (left && peek().type === "op" && (peek().value === "==" || peek().value === "!=")) {
            const op = eat().value;
            const right = parseRelational();
            if (!right) return null;
            left = { kind: "binary", op, left, right };
        }
        return left;
    };

    const parseRelational = (): ExprNode | null => {
        let left = parseAdditive();
        while (left && peek().type === "op" && (peek().value === "<" || peek().value === "<=" || peek().value === ">" || peek().value === ">=")) {
            const op = eat().value;
            const right = parseAdditive();
            if (!right) return null;
            left = { kind: "binary", op, left, right };
        }
        return left;
    };

    const parseAdditive = (): ExprNode | null => {
        let left = parseMultiplicative();
        while (left && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
            const op = eat().value;
            const right = parseMultiplicative();
            if (!right) return null;
            left = { kind: "binary", op, left, right };
        }
        return left;
    };

    const parseMultiplicative = (): ExprNode | null => {
        let left = parseUnary();
        while (left && peek().type === "op" && (peek().value === "*" || peek().value === "/" || peek().value === "%")) {
            const op = eat().value;
            const right = parseUnary();
            if (!right) return null;
            left = { kind: "binary", op, left, right };
        }
        return left;
    };

    const parseUnary = (): ExprNode | null => {
        if (peek().type === "op" && (peek().value === "!" || peek().value === "-" || peek().value === "+")) {
            const op = eat().value;
            const arg = parseUnary();
            return arg ? { kind: "unary", op, arg } : null;
        }
        return parsePrimary();
    };

    const parsePrimary = (): ExprNode | null => {
        const token = peek();
        if (token.type === "num") {
            eat();
            const parsed = Number(token.value);
            return Number.isFinite(parsed) ? { kind: "lit", value: parsed } : null;
        }
        if (token.type === "str") {
            eat();
            return { kind: "lit", value: token.value };
        }
        if (token.type === "punct" && token.value === "(") {
            eat();
            const inner = parseTernary();
            if (!inner || peek().type !== "punct" || peek().value !== ")") return null;
            eat();
            return inner;
        }
        if (token.type === "ident") {
            eat();
            if (token.value === "true") return { kind: "lit", value: true };
            if (token.value === "false") return { kind: "lit", value: false };
            if (token.value === "nil") return { kind: "lit", value: null };
            if (peek().type === "punct" && peek().value === "(") {
                eat();
                const args: ExprNode[] = [];
                if (!(peek().type === "punct" && peek().value === ")")) {
                    while (true) {
                        const arg = parseTernary();
                        if (!arg) return null;
                        args.push(arg);
                        if (peek().type === "punct" && peek().value === ",") {
                            eat();
                            continue;
                        }
                        break;
                    }
                }
                if (peek().type !== "punct" || peek().value !== ")") return null;
                eat();
                if (token.value === "fixed") usage.fixed = true;
                if (token.value === "u" && args[0]?.kind === "lit" && typeof args[0].value === "string") {
                    const key = args[0].value;
                    if (key === "seconds" || key === "duration") usage.seconds = true;
                    if (key === "requests") usage.requests = true;
                    if (key === "resolution") usage.resolution = true;
                    if (key === "video_input") usage.videoInput = true;
                }
                return { kind: "call", name: token.value, args };
            }
            if (token.value === "image_count") usage.imageCount = true;
            if (TOKEN_VARS.has(token.value)) usage.tokens = true;
            return { kind: "ident", name: token.value };
        }
        return null;
    };

    const ast = parseTernary();
    const result = ast && peek().type === "eof" ? { ast, usage } : null;
    if (compiledCache.size >= 128) compiledCache.clear();
    compiledCache.set(source, result);
    return result;
}

type EvalEnv = {
    usage: Record<string, ExprValue>;
    vars: Record<string, ExprValue>;
};

function evalNode(node: ExprNode, env: EvalEnv): ExprValue | undefined {
    switch (node.kind) {
        case "lit":
            return node.value;
        case "ident":
            return Object.hasOwn(env.vars, node.name) ? env.vars[node.name] : undefined;
        case "unary": {
            const value = evalNode(node.arg, env);
            if (node.op === "!") return typeof value === "boolean" ? !value : undefined;
            if (typeof value !== "number") return undefined;
            return node.op === "-" ? -value : value;
        }
        case "ternary": {
            const cond = evalNode(node.cond, env);
            if (typeof cond !== "boolean") return undefined;
            return evalNode(cond ? node.yes : node.no, env);
        }
        case "binary": {
            if (node.op === "&&") {
                const left = evalNode(node.left, env);
                if (typeof left !== "boolean") return undefined;
                if (!left) return false;
                const right = evalNode(node.right, env);
                return typeof right === "boolean" ? right : undefined;
            }
            if (node.op === "||") {
                const left = evalNode(node.left, env);
                if (typeof left !== "boolean") return undefined;
                if (left) return true;
                const right = evalNode(node.right, env);
                return typeof right === "boolean" ? right : undefined;
            }
            const left = evalNode(node.left, env);
            const right = evalNode(node.right, env);
            if (left === undefined || right === undefined) return undefined;
            if (node.op === "==") return left === right;
            if (node.op === "!=") return left !== right;
            if (typeof left === "number" && typeof right === "number") {
                if (node.op === "+") return left + right;
                if (node.op === "-") return left - right;
                if (node.op === "*") return left * right;
                if (node.op === "/") return right === 0 ? undefined : left / right;
                if (node.op === "%") return right === 0 ? undefined : left % right;
                if (node.op === "<") return left < right;
                if (node.op === "<=") return left <= right;
                if (node.op === ">") return left > right;
                if (node.op === ">=") return left >= right;
            }
            if (typeof left === "string" && typeof right === "string") {
                if (node.op === "<") return left < right;
                if (node.op === "<=") return left <= right;
                if (node.op === ">") return left > right;
                if (node.op === ">=") return left >= right;
            }
            return undefined;
        }
        case "call": {
            if (node.name === "tier") return node.args.length >= 2 ? evalNode(node.args[1], env) : undefined;
            if (node.name === "fixed") return node.args.length === 1 ? evalNode(node.args[0], env) : undefined;
            if (node.name === "u") {
                if (node.args.length !== 1) return undefined;
                const key = evalNode(node.args[0], env);
                if (typeof key !== "string") return undefined;
                return Object.hasOwn(env.usage, key) ? env.usage[key] : null;
            }
            if (node.name === "has") {
                if (node.args.length !== 2) return undefined;
                const haystack = evalNode(node.args[0], env);
                const needle = evalNode(node.args[1], env);
                if (typeof haystack !== "string" || typeof needle !== "string") return undefined;
                return haystack.includes(needle);
            }
            const values = node.args.map((arg) => evalNode(arg, env));
            if (values.some((item) => typeof item !== "number")) return undefined;
            const nums = values as number[];
            if (node.name === "min" && nums.length) return Math.min(...nums);
            if (node.name === "max" && nums.length) return Math.max(...nums);
            if (node.name === "abs" && nums.length === 1) return Math.abs(nums[0]);
            if (node.name === "ceil" && nums.length === 1) return Math.ceil(nums[0]);
            if (node.name === "floor" && nums.length === 1) return Math.floor(nums[0]);
            return undefined;
        }
    }
}

function evalNumeric(compiled: CompiledExpr, env: EvalEnv): number | null {
    const value = evalNode(compiled.ast, env);
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function normalizePricingResolution(raw?: string, candidates?: string[]): string {
    const cleaned = (raw || "").trim().toLowerCase();
    if (!cleaned) return "";
    const normalized = /^\d{3,4}$/.test(cleaned) ? `${cleaned}p` : cleaned;
    if (candidates?.length) {
        const matched = candidates.find((item) => item.trim().toLowerCase() === normalized);
        if (matched) return matched;
    }
    return normalized;
}

function resolveGroupRatio(entry: CiyuanPricingEntry, userGroup?: string, groupRatios?: Record<string, number>): number {
    if (!groupRatios) return 1;
    const enabled = entry.enable_groups || [];
    if (userGroup && (enabled.includes(userGroup) || enabled.includes("all"))) {
        const direct = groupRatios[userGroup];
        if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0) return direct;
    }
    const candidates = enabled
        .map((group) => groupRatios[group])
        .filter((ratio): ratio is number => typeof ratio === "number" && Number.isFinite(ratio) && ratio >= 0);
    return candidates.length ? Math.min(...candidates) : 1;
}

function roundPrice(value: number): number {
    return Number(value.toFixed(6));
}

export function formatRmb(amount: number): string {
    if (!Number.isFinite(amount)) return "";
    const rounded = Number(amount.toFixed(4));
    const text = rounded === 0 ? "0" : rounded.toString();
    return `¥${text}`;
}

export function formatMultiplier(multiplier?: number): string {
    if (!multiplier || !Number.isFinite(multiplier) || multiplier <= 1.001) return "";
    const rounded = Number(multiplier.toFixed(2));
    return `×${rounded}`;
}

export function resolveModelPrice(entry: CiyuanPricingEntry | undefined, context: ModelPriceContext = {}): ResolvedModelPrice | null {
    if (!entry) return null;
    const capability = context.capability ?? context.spec?.capability;
    const groupRatio = resolveGroupRatio(entry, context.userGroup, context.groupRatios);
    const hasReferenceVideo = Boolean(context.hasReferenceVideo);

    if (entry.billing_mode === "tiered_expr" && entry.billing_expr?.trim()) {
        const compiled = compileExpr(entry.billing_expr);
        if (!compiled) return null;
        if (compiled.usage.tokens && !compiled.usage.seconds && !compiled.usage.requests && !compiled.usage.fixed && !compiled.usage.imageCount) {
            return null;
        }

        const unit: ModelPriceUnit = compiled.usage.seconds
            ? "second"
            : capability === "image"
              ? "image"
              : capability === "video"
                ? "clip"
                : "request";

        const schemaResolutions = entry.billing_usage_schema?.resolution?.enum || [];
        const specResolutions = context.spec?.video?.resolutions || [];
        const availableResolutions = schemaResolutions.length ? schemaResolutions : specResolutions;
        const normalizedActive = normalizePricingResolution(context.resolution, availableResolutions);
        const validActive =
            normalizedActive && (!availableResolutions.length || availableResolutions.some((item) => item.trim().toLowerCase() === normalizedActive.toLowerCase()))
                ? normalizedActive
                : "";
        const fallbackResolution = normalizePricingResolution(context.spec?.video?.default_resolution || availableResolutions[0] || "", availableResolutions);
        const activeResolution = validActive || fallbackResolution;

        const evaluateAt = (resolution: string, videoInput: boolean, seconds = 1, count = 1): number | null => {
            const raw = evalNumeric(compiled, {
                usage: {
                    seconds,
                    duration: seconds,
                    requests: 1,
                    resolution: resolution || null,
                    video_input: videoInput,
                    max_mode: false,
                },
                vars: {
                    image_count: count,
                },
            });
            return raw === null ? null : roundPrice(raw * groupRatio);
        };

        if (compiled.usage.resolution && context.allowResolutionRange && availableResolutions.length > 1) {
            const prices = availableResolutions
                .map((res) => evaluateAt(res, hasReferenceVideo))
                .filter((price): price is number => price !== null);
            if (!prices.length) return null;
            const basePrices = availableResolutions
                .map((res) => evaluateAt(res, false))
                .filter((price): price is number => price !== null);
            const minUnitPrice = Math.min(...prices);
            const maxUnitPrice = Math.max(...prices);
            const baseMin = basePrices.length ? Math.min(...basePrices) : minUnitPrice;
            const videoInputSurcharge = hasReferenceVideo && compiled.usage.videoInput && minUnitPrice > baseMin + 1e-9;
            const videoInputMultiplier = videoInputSurcharge && baseMin > 0 ? roundPrice(minUnitPrice / baseMin) : undefined;
            return {
                unit,
                unitPrice: minUnitPrice,
                minUnitPrice,
                maxUnitPrice,
                isRange: Math.abs(maxUnitPrice - minUnitPrice) > 1e-9,
                videoInputSurcharge,
                videoInputMultiplier,
            };
        }

        const unitPrice = evaluateAt(activeResolution, hasReferenceVideo);
        if (unitPrice === null) return null;
        const baseUnitPrice = compiled.usage.videoInput ? evaluateAt(activeResolution, false) : unitPrice;
        const videoInputSurcharge = Boolean(hasReferenceVideo && compiled.usage.videoInput && baseUnitPrice !== null && unitPrice > baseUnitPrice + 1e-9);
        const videoInputMultiplier = videoInputSurcharge && baseUnitPrice && baseUnitPrice > 0 ? roundPrice(unitPrice / baseUnitPrice) : undefined;

        let totalPrice: number | undefined;
        if (unit === "second") {
            if (typeof context.seconds === "number" && Number.isFinite(context.seconds) && context.seconds > 0) {
                const exactTotal = evaluateAt(activeResolution, hasReferenceVideo, context.seconds, 1);
                if (exactTotal !== null) totalPrice = exactTotal;
            }
        } else if (unit === "image") {
            const imageCount = typeof context.count === "number" && Number.isFinite(context.count) && context.count > 0 ? Math.floor(context.count) : 1;
            const exactTotal = compiled.usage.imageCount ? evaluateAt(activeResolution, hasReferenceVideo, 1, imageCount) : roundPrice(unitPrice * imageCount);
            if (exactTotal !== null) totalPrice = exactTotal;
        } else {
            totalPrice = unitPrice;
        }

        return {
            unit,
            unitPrice,
            minUnitPrice: unitPrice,
            maxUnitPrice: unitPrice,
            isRange: false,
            videoInputSurcharge,
            videoInputMultiplier,
            totalPrice,
            resolution: compiled.usage.resolution ? activeResolution || undefined : undefined,
        };
    }

    if (entry.quota_type === 1 && typeof entry.model_price === "number" && Number.isFinite(entry.model_price) && entry.model_price >= 0) {
        const unit: ModelPriceUnit = capability === "image" ? "image" : capability === "video" ? "clip" : "request";
        const unitPrice = roundPrice(entry.model_price * groupRatio);
        const count = unit === "image" && typeof context.count === "number" && context.count > 0 ? Math.floor(context.count) : 1;
        return {
            unit,
            unitPrice,
            minUnitPrice: unitPrice,
            maxUnitPrice: unitPrice,
            isRange: false,
            videoInputSurcharge: false,
            totalPrice: roundPrice(unitPrice * count),
        };
    }

    return null;
}

export function formatModelUnitPrice(price: ResolvedModelPrice, unitLabels: Record<ModelPriceUnit, string>): string {
    const suffix = unitLabels[price.unit];
    if (price.isRange) {
        return `${formatRmb(price.minUnitPrice)}~${formatRmb(price.maxUnitPrice).replace(/^¥/, "")}/${suffix}`;
    }
    return `${formatRmb(price.unitPrice)}/${suffix}`;
}
