# Third-party sources and notices

## Swadesh concepts

- Source: https://en.wikipedia.org/wiki/Swadesh_list#Swadesh_207_list
- Pinned version: https://en.wikipedia.org/w/index.php?title=Swadesh_list&oldid=1367756650#Swadesh_207_list
- Retrieved: 2026-09-04.
- The 207 English concept labels and their sequence were extracted from this section. Stable concept IDs and Traditional Chinese glosses were added for kaladaxe; the Chinese glosses are editable project translations.
- Attribution: English Wikipedia contributors, “Swadesh list”.
- Wikipedia text license: Creative Commons Attribution-ShareAlike 4.0, https://creativecommons.org/licenses/by-sa/4.0/ . Ordinary factual labels are recorded as concept data; retain attribution for the source and any adapted text.
- Downloaded HTML SHA-256: 86aa8188fae00be4c22477c1b9a2050030effa9f6ce158598408a82154c239ce.
- Runtime and routine builds use the checked-in concept catalog; they never scrape Wikipedia.

## Leaflet 1.9.4

- Project: https://leafletjs.com/
- Distribution: https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz
- Archive SHA-256: 84c65a256e50657896f54c33bd857b6849ebe94c817803be818bf32a3dde0b77.
- Vendored files: distribution leaflet.js, leaflet.css, images/, and LICENSE.
- License: BSD 2-Clause. The full copyright and license text is included in site/assets/vendor/leaflet/LICENSE.
- The distribution files are unmodified. The source map referenced by upstream leaflet.js is not needed to run the site.

## Natural Earth 5.1.2

- Project: https://www.naturalearthdata.com/
- License: public domain, https://www.naturalearthdata.com/about/terms-of-use/
- Source: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson
- Download SHA-256: 239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255.
- Preparation: select the feature whose ADM0_A3 is TWN, retain its original MultiPolygon coordinates, replace unused administrative properties with name/source, and serialize as a one-feature GeoJSON FeatureCollection.
- The resulting site/assets/taiwan.geojson contains Taiwan and the offshore polygons present in this source, including Penghu, Green Island, Orchid Island and Kinmen. It is a generalized outline, not a detailed map of every island.
- Coordinates are longitude, latitude (WGS84); Leaflet input coordinates are latitude, longitude. No fictitious geographic outline is used.
- No online tile provider, API key, or build-time download is required.

## Design and interaction references

- The user-provided stitch_kaladaxe/ supplies the visual reference.
- The user-provided langmap word map was inspected for per-word loading, URL synchronization, selection priority and bounded label placement.
- kaladaxe implements these interaction ideas independently. It does not copy langmap's application code, language datasets, fonts, or simulated-annealing layout.
- The application uses system font stacks; there are no downloaded web fonts.
