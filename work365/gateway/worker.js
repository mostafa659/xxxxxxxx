/* ClinixStudy AI gateway: the Cloudflare Worker entry point. The logic, and the explanation of why this exists, are in core.js; the setup guide is README.md. */
import { handle } from "./core.js";

export default {
  fetch(req, env, ctx) { return handle(req, env, ctx); },
};
