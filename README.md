# GPX Fixer v0.1

## Kør lokalt

Node.js 20+ er anbefalet.

```bash
npm install
cp .env.example .env
# sæt GOOGLE_MAPS_API_KEY
npm start
```

Åbn http://localhost:3000

Første version forventer et Google Maps Directions-link, hvor origin/destination kan udledes af URL'en. Google Maps' officielle URL-format understøtter origin, destination og waypoints. Routes API bruges til at hente rutens polyline.

Short-links som `maps.app.goo.gl` kan kræve en senere udvidelse til at følge share-linket og udlede destinationerne.

Før offentlig lancering bør der tilføjes rate limiting, streng filvalidering, HTTPS, API-key restrictions, privacy policy og bedre håndtering af share-links.
