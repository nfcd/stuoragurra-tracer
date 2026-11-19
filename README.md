# Stuoragurra scarp tracer

A browser tool to map the postglacial fault scarps of the Stuoragurra Fault (Finnmark, northern Norway) on lidar elevation data, and to review topographic profiles across them. It accompanies the paper:

> Cardozo, N., Watson, L. Trishear inversion of lidar fault-scarp profiles along the Stuoragurra Fault, northern Norway: implications for postglacial earthquake magnitude. (in preparation)

**Open the tool:** https://USERNAME.github.io/stuoragurra-tracer/

It runs in the web browser, with nothing to install. Everything stays in your browser; nothing is uploaded.

## Using it

- **Paper's interpretation** loads the 17 scarp traces mapped for the paper and the review of the profiles across them (the accepted profiles are those analysed in the paper).
- **Trace mode (T):** click along a scarp to draw your own traces.
- **Review mode (R):** profiles every 100 m across the traces; accept, reject or mark them as unsure.
- Background layers: elevation, hillshade, texture shading and a scarp index.
- Press **?** in the tool for the full help (keys, modes and layers).

Your work is saved automatically in your browser. Use **Export GeoJSON** (traces) and **Export review** (profile decisions, CSV) to keep it as files, and the import buttons to load them again. Coordinates are ETRS89 / UTM zone 33N (EPSG:25833).

## Files

| Path | Content |
|---|---|
| `interpretation/scarps.geojson` | Scarp traces mapped for the paper (EPSG:25833) |
| `interpretation/profile_review.csv` | Review of the profiles used in the paper |
| `tiles/` | Map tiles: elevation, hillshade, texture shading, scarp index, and the terrain model itself (`tiles/dem`, elevations in cm) |
| `index.html`, `app.js`, `style.css` | The tool |

## Running it offline

Download the repository (Code > Download ZIP), unzip it and double-click `start_tracer.command` (macOS) or `start_tracer.bat` (Windows). This starts a small local web server (Python 3 is needed) and opens the tool in your browser. Opening `index.html` directly does not work, because the browser will not read the tiles from a local folder.

## Data and credits

Elevation data © Kartverket (Norwegian Mapping Authority), from [Høydedata](https://hoydedata.no): a 1 m terrain model mosaicked from the 0.5 m lidar terrain models of the projects NDH Guovdageaidnu 2pkt 2019 and NDH Maze 2pkt 2020 (averaged to 1 m) and, north-east of these, the national 1 m terrain model. The map tiles are derived from these data.

Map library: [Leaflet](https://leafletjs.com) 1.9.4, BSD 2-Clause licence (`lib/LEAFLET_LICENSE.txt`).

The code of the tool is released under the MIT licence (`LICENSE`).

## Contact

Nestor Cardozo, University of Stavanger
