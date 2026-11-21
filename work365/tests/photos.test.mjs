import test from "node:test";
import assert from "node:assert/strict";
import { parseShots, createPicker, sourcesFor, mapGoogle, mapUnsplash, mapPexels, similar, urlKey, worthAsking, cacheKey, RIGHTS, MAX_PHOTOS } from "../src/lib/photos.js";

const shot = (q, kind = "diagram", why = "x") => ({ q, kind, why });
const item = (src, id, title, extra = {}) => ({ id: `${src[0]}:${id}`, src, key: `${src}:${id}`, url: `https://x/${id}.jpg`, thumb: `https://x/${id}-t.jpg`, page: `https://x/p/${id}`, credit: "c", creditUrl: `https://x/u/${id}`, title, ...extra });

test("parseShots: no pictures unless the model says so, max 5, distinct queries", () => {
  assert.deepEqual(parseShots("not json"), { need: false, shots: [] });
  assert.deepEqual(parseShots('{"need":false,"shots":[]}'), { need: false, shots: [] });
  assert.equal(parseShots('{"need":true,"shots":[]}').need, false);                                     // "need" without a single usable shot
  const r = parseShots('```json\n{"need":true,"shots":[{"q":"heart anatomy chambers","kind":"diagram","why":"أجزاء القلب"},{"q":"Heart  anatomy chambers!","kind":"diagram"},{"q":"ab"},{"q":"stethoscope on chest","kind":"photo"}]}\n```');
  assert.equal(r.need, true);
  assert.deepEqual(r.shots.map((s) => s.q), ["heart anatomy chambers", "stethoscope on chest"]);     // duplicate + too short dropped
  assert.equal(r.shots[1].kind, "photo");
  const many = parseShots(JSON.stringify({ need: true, shots: Array.from({ length: 9 }, (_, i) => ({ q: `topic${i} alpha${i} beta${i}` })) }));
  assert.equal(many.shots.length, MAX_PHOTOS);
});

test("sourcesFor: diagrams go to Google when it exists, photos to every source", () => {
  assert.deepEqual(sourcesFor("diagram", ["google", "unsplash", "pexels"]), ["google"]);
  assert.deepEqual(sourcesFor("diagram", ["unsplash", "pexels"]), ["pexels", "unsplash"]);
  assert.deepEqual(sourcesFor("photo", ["google", "unsplash", "pexels"]), ["unsplash", "pexels", "google"]);
});

test("picker: the preferred source wins, and a photo is never used twice", () => {
  const got = [];
  const p = createPicker([shot("a", "photo"), shot("b", "photo")], ["unsplash", "pexels"], (l) => got.push(l.length));
  p.record(0, "pexels", [item("pexels", 1, "red fox in snow")]);       // pexels answers first, but unsplash is preferred → waits
  assert.equal(got.length, 0);
  p.record(0, "unsplash", [item("unsplash", 9, "arctic fox winter")]);
  assert.equal(got.at(-1), 1);
  p.record(1, "unsplash", [item("unsplash", 9, "arctic fox winter"), item("unsplash", 10, "forest river")]);   // same photo as shot 0 → skipped
  p.record(1, "pexels", []);
  const all = p.finish();
  assert.deepEqual(all.map((x) => x.id), ["u:9", "u:10"]);
  assert.equal(all[0].why, "x");
});

test("picker: near-identical scenes are rejected, grace lets a slow source be skipped", () => {
  const p = createPicker([shot("a", "photo"), shot("b", "photo")], ["unsplash", "pexels"], () => {});
  p.record(0, "unsplash", [item("unsplash", 1, "nurse checking blood pressure with a cuff")]);
  p.record(1, "pexels", [item("pexels", 2, "nurse checking blood pressure with cuff"), item("pexels", 3, "hospital corridor at night")]);   // pexels only: unsplash for shot 1 still pending
  p.grace(1);                                                                                              // grace is over → takes what is there
  const all = p.finish();
  assert.deepEqual(all.map((x) => x.id), ["u:1", "p:3"]);
  assert.ok(Array.isArray(all[0].alts));
});

test("source mappers: https only, credit + original page on every photo", () => {
  const g = mapGoogle({ items: [{ title: "Heart", link: "https://a.org/img/heart-300x200.jpg", displayLink: "a.org", image: { contextLink: "https://a.org/heart", thumbnailLink: "https://gstatic.com/t.jpg", width: 800, height: 600 } }, { link: "http://bad/x.jpg" }] });
  assert.equal(g.length, 1);
  assert.equal(g[0].page, "https://a.org/heart"); assert.equal(g[0].credit, "a.org");
  const u = mapUnsplash({ results: [{ id: "Z1", alt_description: "a cat", urls: { small: "https://i/s", regular: "https://i/r" }, user: { name: "Sam", links: { html: "https://unsplash.com/@sam" } }, links: { html: "https://unsplash.com/photos/Z1" } }] });
  assert.match(u[0].creditUrl, /@sam\?utm_source=clinixstudy/); assert.equal(u[0].credit, "Sam · Unsplash");
  const x = mapPexels({ photos: [{ id: 5, alt: "dog", src: { medium: "https://p/m", large: "https://p/l" }, photographer: "Lee", photographer_url: "https://www.pexels.com/@lee", url: "https://www.pexels.com/photo/5" }] });
  assert.equal(x[0].credit, "Lee · Pexels");
});

test("helpers: urlKey ignores size + query, similar, worthAsking, cacheKey, rights filter", () => {
  assert.equal(urlKey("https://www.A.org/p/heart-300x200.jpg?w=300"), urlKey("https://a.org/p/heart-1200x800.jpg"));
  assert.ok(similar("red fox in snow", "snow red fox") > 0.9);
  assert.ok(!worthAsking("hi there", "short"));
  assert.ok(worthAsking("explain the heart", "x".repeat(200)));
  assert.equal(cacheKey("What is the HEART?!"), cacheKey("what is the heart"));
  assert.equal(RIGHTS, "cc_publicdomain,cc_attribute,cc_sharealike");
});
