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
  let knownConcepts = new Set();
  let demo = null;
  let demoRequest = null;

  async function loadIndex() {
    const [concepts, varieties, subgroups] = await Promise.all([
      readJSON(new URL("data/concepts.json", siteRoot)),
      readJSON(new URL("data/varieties.json", siteRoot)),
      readJSON(new URL("data/subgroups.json", siteRoot)),
    ]);
    knownConcepts = new Set(concepts.items.map((item) => item.id));
    return { concepts, varieties, subgroups };
  }

  function loadWord(id) {
    if (!knownConcepts.has(id)) return Promise.reject(new Error("未知詞項"));
    if (cache.has(id)) return Promise.resolve(cache.get(id));
    if (pending.has(id)) return pending.get(id);
    const request = readJSON(new URL("data/words/" + encodeURIComponent(id) + ".json", siteRoot))
      .then((data) => {
        if (data.concept_id !== id || !data.forms || Array.isArray(data.forms) || typeof data.forms !== "object") {
          throw new Error("詞項資料格式不正確");
        }
        cache.set(id, data);
        return data;
      })
      .finally(() => pending.delete(id));
    pending.set(id, request);
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
