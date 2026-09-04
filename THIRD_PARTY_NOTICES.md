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
- Preparation: select the feature whose ADM0_A3 is TWN, remove the Kinmen polygon (118–118.6° E, 24.2–24.7° N), retain the remaining original MultiPolygon coordinates, replace unused administrative properties with name/source, and serialize as a one-feature GeoJSON FeatureCollection.
- The resulting site/assets/taiwan.geojson contains Taiwan and the offshore polygons present in this source, including Penghu, Green Island and Orchid Island. Kinmen is excluded by design. It is a generalized outline, not a detailed map of every island.
- Coordinates are longitude, latitude (WGS84); Leaflet input coordinates are latitude, longitude. No fictitious geographic outline is used.
- No online tile provider, API key, or build-time download is required.

## HydroRIVERS v1.0

- Publisher: World Wildlife Fund US (WWF), in collaboration with McGill University.
- Product: https://www.hydrosheds.org/products/hydrorivers
- Asia shapefile: https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_as_shp.zip
- Retrieved: 2026-09-04.
- Archive SHA-256: 29780b0a75f90024f22e7e2029e5e3045f7325cda0528db65c5cc4c864b98525.
- Citation: Lehner, B., Grill G. (2013). Global river hydrography and network routing: baseline data and new approaches to study the world's large river systems. Hydrological Processes 27(15), 2171–2186. https://doi.org/10.1002/hyp.9740
- License: HydroSHEDS version 1 License Agreement, Appendix A of https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v1_4.pdf . This is a custom license, not public domain or CC-BY. The original document, including required attribution in Exhibit B, is included at site/assets/hydrosheds-license.pdf and linked from the website.
- Copyright: World Wildlife Fund, Inc. (2006–2022); underlying contributors and terms are specified in the linked license. This kaladaxe map incorporates modified HydroSHEDS data under that license. The original Asia dataset is not redistributed.
- Preparation: scripts/prepare_rivers.py selects island basins intersecting the local Natural Earth coastline plus a 0.03-degree buffer, then retains classical river order 1 (main stems) only, with total main-stem length at least 40 km (sum of LENGTH_KM across all main-stem reaches in a basin). Whole stems are retained; short individual reaches in a long river are not removed. This buffer only selects basins; it does not move or clip coordinates. Kinmen is excluded.
- Adjacent reaches of each order are merged, retaining every bend; coordinates are rounded to five decimals. The resulting 685 reaches in 23 source-defined basins are represented as one MultiLineString feature in site/assets/taiwan-rivers.geojson. These basins are not Taiwan's administrative river-system classifications.
- HydroRIVERS is derived from 15 arc-second data (about 500 metres at the equator); it does not supply river names or every small stream. It is an overview backdrop, not a current river survey.
- Alignment check: the source coastline uses CRS84 and HydroRIVERS uses geographic WGS84; both enter the same Leaflet EPSG:3857 map without manual offsets. Sample northern river outlets differ from the generalized coastline by up to about 2.6 km in source coordinates. A browser check found less than 0.2 CSS px rounding error for both SVG panes, with no relative rendering shift. These source discrepancies remain visible; no snapping or clipping is applied.
- One-time preparation requires pyshp and Shapely; routine builds and browser use require neither. No remote river service is called at runtime.

## Design and interaction references

- The user-provided stitch_kaladaxe/ supplies the visual reference.
- The user-provided langmap word map was inspected for per-word loading, URL synchronization, selection priority and bounded label placement.
- kaladaxe implements these interaction ideas independently. It does not copy langmap's application code, language datasets, fonts, or simulated-annealing layout.
- The application uses system font stacks; there are no downloaded web fonts.
