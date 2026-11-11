/* A programmable fake of Google + Groq: every lane gets a "script" (what its next request does). */
const enc = new TextEncoder();
export const log = [];                       // every request that reached the "network"
const scripts = new Map();                   // key → array of behaviours (consumed in order; the last one repeats)
export const script = (key, ...steps) => scripts.set(key, steps);
export const reset = () => { log.length = 0; scripts.clear(); };

const next = (key) => { const a = scripts.get(key) || [{ ok: "hello from " + key }]; return a.length > 1 ? a.shift() : a[0]; };

function sse(chunks, { delay = 0, signal } = {}) {
  let i = 0;
  return new ReadableStream({
    async pull(ctrl) {
      if (signal && signal.aborted) { ctrl.error(Object.assign(new Error("aborted"), { name: "AbortError" })); return; }
      if (i >= chunks.length) { ctrl.close(); return; }
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (signal && signal.aborted) { ctrl.error(Object.assign(new Error("aborted"), { name: "AbortError" })); return; }
      ctrl.enqueue(enc.encode(chunks[i++]));
    },
  });
}

export function installFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const isGem = u.includes("generativelanguage");
    const body = init.body ? JSON.parse(init.body) : null;
    const model = isGem ? (u.match(/models\/([^:?]+)/) || [])[1] : body && body.model;
    const isClaude = u.includes("anthropic.com");
    const prov = u.includes("groq") ? "groq" : u.includes("mistral") ? "mistral" : u.includes("openai.com") ? "openai" : isClaude ? "anthropic" : "openrouter";
    const lane = isGem ? `gemini:${model}` : `${prov}:${model}`;
    const hh = init.headers || {};
    const keyHdr = isGem ? hh["x-goog-api-key"] : isClaude ? hh["x-api-key"] : String(hh.Authorization || "").replace(/^Bearer /, "");
    const signal = init.signal;
    if (!/chat\/completions|streamGenerateContent|\/v1\/messages/.test(u)) {                 // model lists
      log.push({ lane: "list", url: u, t: Date.now(), key: keyHdr });
      const st0 = scripts.get(`list:${isGem ? "gemini" : prov}#${keyHdr}`) || scripts.get("list#" + keyHdr);   // a list script can be bound to one provider: script("list:gemini#KEY", …)
      if (st0) return new Response(JSON.stringify({ error: { message: st0[0].msg || "x" } }), { status: st0[0].status });
      return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }, { id: "openai/gpt-oss-20b" }, { id: "whisper-large-v3" }] }), { status: 200 });
    }
    log.push({ lane, t: Date.now(), body, key: keyHdr });
    const st = scripts.has(lane + "#" + keyHdr) ? next(lane + "#" + keyHdr) : next(lane);       // a script can be bound to ONE key: script("gemini:model#KEY", …)
    if (st.wait) await new Promise((r, j) => { const t = setTimeout(r, st.wait); if (signal) signal.addEventListener("abort", () => { clearTimeout(t); j(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true }); });
    if (signal && signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (st.status) {
      const payload = isGem ? { error: { code: st.status, message: st.msg || "x", details: st.details || (st.retry ? [{ retryDelay: st.retry + "s" }] : []) } } : { error: { message: st.msg || "x" } };
      return new Response(JSON.stringify(payload), { status: st.status, headers: st.retryHeader ? { "retry-after": String(st.retryHeader) } : {} });
    }
    const text = st.ok;
    const parts = text.match(/.{1,12}/gs) || [""];
    const chunks = isClaude
      ? [`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: {} })}\n\n`, ...parts.map((p) => `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: p } })}\n\n`), `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: st.finish || "end_turn" } })}\n\n`]
      : isGem
      ? parts.map((p) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] } }] })}\n\n`).concat([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP", ...(st.grounding ? { groundingMetadata: st.grounding } : {}) }] })}\n\n`])
      : [`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" } }] })}\n\n`, ...parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`), `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: st.finish || "stop" }] })}\n\n`, "data: [DONE]\n\n"];
    return new Response(sse(chunks, { delay: st.gap || 0, signal }), { status: 200 });
  };
}
