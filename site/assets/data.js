// URLs are rooted at this module, so /repo/ and local subdirectory previews work.
const siteRoot = new URL("../", import.meta.url);

async function readJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("讀取失敗（HTTP " + response.status + "）");
  return response.json();
}

export function createDataStore() {
  const cache = new Map();
  const pending = new Map();
  let knownConcepts = new Map();
  let demo = null;
  let demoRequest = null;

  async function loadIndex() {
    const [concepts, varieties, subgroups, learning] = await Promise.all([
      readJSON(new URL("data/concepts.json", siteRoot)),
      readJSON(new URL("data/varieties.json", siteRoot)),
      readJSON(new URL("data/subgroups.json", siteRoot)),
      readJSON(new URL("data/learning/concepts.json", siteRoot)),
    ]);
    knownConcepts = new Map([
      ["basic", new Set(concepts.items.map((item) => item.id))],
      ["learning", new Set(learning.items.map((item) => item.id))],
    ]);
    return { concepts, varieties, subgroups, learning };
  }

  function loadWord(id, mode = "basic") {
    if (!knownConcepts.get(mode)?.has(id)) return Promise.reject(new Error("未知詞項"));
    const key = mode + ":" + id;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (pending.has(key)) return pending.get(key);
    const directory = mode === "learning" ? "data/learning/words/" : "data/words/";
    const request = readJSON(new URL(directory + encodeURIComponent(id) + ".json", siteRoot))
      .then((data) => {
        if (data.concept_id !== id || !data.forms || Array.isArray(data.forms) || typeof data.forms !== "object") {
          throw new Error("詞項資料格式不正確");
        }
        cache.set(key, data);
        return data;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  function loadDemo() {
    if (demo) return Promise.resolve(demo);
    if (demoRequest) return demoRequest;
    demoRequest = readJSON(new URL("assets/debug/999.json", siteRoot))
      .then((data) => {
        if (data.concept?.id !== "debug_999" || data.concept.swadesh_number !== 999
          || !Array.isArray(data.varieties) || !Array.isArray(data.subgroups) || !data.forms) {
          throw new Error("示範語料格式不正確");
        }
        demo = data;
        return data;
      })
      .finally(() => { demoRequest = null; });
    return demoRequest;
  }

  return { loadIndex, loadWord, loadDemo };
}
