# GPX Reconstructor v2

Railway-ready.

## What changed
- Uploaded GPX is parsed in the browser and immediately shown on the map.
- The last existing GPX point becomes the starting point for the missing route.
- Missing route can be drawn by clicking on the map.
- Missing route can alternatively be loaded from a Google Maps directions link.
- Generated GPX points are resampled using the original track's typical point spacing.
- Generated timestamps are calculated from the original track's typical movement speed and stretched so the final timestamp is exact.
- Output gets a separate map preview.

## No Google API key
The Google-link mode reads coordinates/waypoints from the link and uses OSRM/OpenStreetMap to calculate a road route. Google Maps and OSRM can choose different roads.

## Railway
Deploy the repository and use the public Railway URL. No environment variable is required for this version.
