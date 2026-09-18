import express from "express";
import cors from "cors";
import multer from "multer";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const EARTH = 6371000;

function distance(a,b) {
  const p=Math.PI/180;
  const dLat=(b.lat-a.lat)*p, dLon=(b.lon-a.lon)*p;
  const x=Math.sin(dLat/2)**2 + Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(dLon/2)**2;
  return 2*EARTH*Math.asin(Math.sqrt(x));
}
function median(values) {
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length) return 0;
  const m=Math.floor(a.length/2);
  return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
}
function parseGPX(xml) {
  const points=[];
  const re=/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
  let m;
  while((m=re.exec(xml))) {
    const la=/\blat="([^"]+)"/i.exec(m[1]);
    const lo=/\blon="([^"]+)"/i.exec(m[1]);
    if(!la||!lo) continue;
    const ti=/<time>\s*([^<]+)\s*<\/time>/i.exec(m[2]);
    points.push({
      lat:+la[1], lon:+lo[1],
      time:ti ? new Date(ti[1]) : null
    });
  }
  return points;
}
function extractGoogleCoords(value) {
  let u;
  try { u=new URL(value); } catch { throw new Error("Ugyldigt Google Maps-link."); }
  const found=[];
  const add=(lat,lon)=>{
    lat=+lat; lon=+lon;
    if(Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180)
      found.push({lat,lon});
  };
  const dir=u.pathname.match(/\/dir\/(.+)/i);
  if(dir) {
    for(const part of dir[1].split("/")) {
      const m=part.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
      if(m) add(m[1],m[2]);
    }
  }
  for(const key of ["origin","destination","waypoints"]) {
    const value=u.searchParams.get(key);
    if(!value) continue;
    for(const part of value.split("|")) {
      const m=part.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
      if(m) add(m[1],m[2]);
    }
  }
  return found.filter((p,i,a)=>i===a.findIndex(q=>Math.abs(q.lat-p.lat)<1e-8&&Math.abs(q.lon-p.lon)<1e-8));
}
async function osrm(points) {
  if(points.length<2) throw new Error("Google-linket indeholder ikke mindst start og destination.");
  const coords=points.map(p=>`${p.lon},${p.lat}`).join(";");
  const url=`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
  const r=await fetch(url,{headers:{"User-Agent":"GPX-Reconstructor/2.0"}});
  if(!r.ok) throw new Error("Routing-tjenesten kunne ikke kontaktes.");
  const data=await r.json();
  if(data.code!=="Ok" || !data.routes?.[0]?.geometry?.coordinates)
    throw new Error("Kunne ikke beregne en rute.");
  return data.routes[0].geometry.coordinates.map(([lon,lat])=>({lat,lon}));
}
function resample(route, spacing) {
  if(route.length<2) return route;
  const out=[route[0]];
  let carry=0;
  for(let i=1;i<route.length;i++) {
    let a=route[i], b=route[i], seg=0;
    a=route[i-1]; b=route[i]; seg=distance(a,b);
    while(carry+seg>=spacing && seg>0) {
      const t=(spacing-carry)/seg;
      const p={lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t};
      out.push(p);
      a=p; seg=distance(a,b); carry=0;
    }
    carry+=seg;
  }
  if(distance(out[out.length-1],route[route.length-1])>0.5) out.push(route[route.length-1]);
  return out;
}
function buildTimes(original, newPoints, endISO) {
  const start=original[original.length-1];
  if(!start.time) throw new Error("Den sidste eksisterende GPX-position mangler et tidspunkt.");
  const target=new Date(endISO);
  if(Number.isNaN(target.getTime()) || target<=start.time)
    throw new Error("Sluttidspunktet skal være efter det sidste tidspunkt i GPX-filen.");

  const speeds=[];
  for(let i=1;i<original.length;i++) {
    if(!original[i-1].time||!original[i].time) continue;
    const dt=(original[i].time-original[i-1].time)/1000;
    const ds=distance(original[i-1],original[i]);
    if(dt>0&&ds>1&&ds/dt<100) speeds.push(ds/dt);
  }
  const typicalSpeed=median(speeds)||5;
  const totalSeconds=(target-start.time)/1000;

  let totalDistance=0;
  const ds=[];
  for(let i=1;i<newPoints.length;i++) {
    const d=distance(newPoints[i-1],newPoints[i]);
    ds.push(d); totalDistance+=d;
  }
  if(totalDistance<1) throw new Error("Den tegnede rute er for kort.");

  const rawDuration=totalDistance/typicalSpeed;
  const scale=totalSeconds/rawDuration;
  const times=[start.time];
  let elapsed=0;
  for(let i=1;i<newPoints.length;i++) {
    elapsed += (ds[i-1]/typicalSpeed)*scale;
    times.push(i===newPoints.length-1 ? target : new Date(start.time.getTime()+elapsed*1000));
  }
  return times;
}
function pointXml(p,t) {
  return `<trkpt lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}"><time>${t.toISOString()}</time></trkpt>`;
}

app.post("/api/route-from-google", async (req,res)=>{
  try {
    const coords=extractGoogleCoords(req.body.url||"");
    if(coords.length<2) throw new Error("Kunne ikke læse start og destination. Brug et fuldt Google Maps-rute-link.");
    res.json({route:await osrm(coords)});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.post("/api/reconstruct", upload.single("gpx"), async (req,res)=>{
  try {
    if(!req.file) throw new Error("Upload en GPX-fil.");
    const xml=req.file.buffer.toString("utf8");
    const original=parseGPX(xml);
    if(original.length<2) throw new Error("GPX-filen har for få trackpoints.");

    const lat=+req.body.endLat, lon=+req.body.endLon;
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)
      throw new Error("Ugyldige slutkoordinater.");

    let route=JSON.parse(req.body.route||"[]").map(p=>({lat:+p.lat,lon:+p.lon}));
    if(route.length<2) throw new Error("Tegn eller hent først den manglende rute.");

    // Always start from the exact last original point and finish at the exact requested target.
    route[0]={lat:original.at(-1).lat,lon:original.at(-1).lon};
    route.at(-1)={lat,lon};

    const spacing=median(original.slice(1).map((p,i)=>distance(original[i],p)).filter(d=>d>1))||10;
    const points=resample(route,spacing);
    points[0]={lat:original.at(-1).lat,lon:original.at(-1).lon};
    points.at(-1)={lat,lon};

    const generatedTimes=buildTimes(original,points,req.body.endTime);

    // Only append generated points after the original last point.
    const matches=[...xml.matchAll(/<trkpt\b[^>]*>[\s\S]*?<\/trkpt>/gi)];
    const last=matches.at(-1);
    const insertion=last.index+last[0].length;
    const generated=points.slice(1).map((p,i)=>pointXml(p,generatedTimes[i+1])).join("");
    const result=xml.slice(0,insertion)+generated+xml.slice(insertion);

    res.setHeader("Content-Type","application/gpx+xml; charset=utf-8");
    res.setHeader("Content-Disposition",'attachment; filename="reconstructed.gpx"');
    res.send(result);
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.get("/api/health",(req,res)=>res.json({ok:true}));
app.listen(PORT,()=>console.log(`GPX Reconstructor listening on ${PORT}`));
