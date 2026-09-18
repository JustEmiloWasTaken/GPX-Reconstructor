let map, outputMap, drawLine, originalLine, outputOriginalLine, outputGeneratedLine;
let route=[], originalPoints=[], outputPoints=[];
const $=id=>document.getElementById(id);

function setStatus(text,kind=""){ $("status").textContent=text; $("status").className="status "+kind; }
function boundsFor(points){ return L.latLngBounds(points.map(p=>[p.lat,p.lon])); }

function redrawDraw(){
  if(drawLine){ map.removeLayer(drawLine); drawLine=null; }
  if(route.length){
    drawLine=L.polyline(route.map(p=>[p.lat,p.lon]),{weight:5}).addTo(map);
  }
}
function setRoute(points, fit=true){
  route=points.map(p=>({lat:+p.lat,lon:+p.lon}));
  redrawDraw();
  if(fit && route.length>1) map.fitBounds(boundsFor(route),{padding:[30,30]});
}
function initMap(){
  map=L.map("map",{doubleClickZoom:false}).setView([55.7,12.57],6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors"}).addTo(map);
  map.on("click",e=>{
    if($("drawTab").classList.contains("active")){
      route.push({lat:e.latlng.lat,lon:e.latlng.lng});
      redrawDraw();
      if(route.length===1) map.panTo(e.latlng);
    }
  });
}
function parseGPXText(text){
  const points=[], re=/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi; let m;
  while((m=re.exec(text))){
    const la=/\blat="([^"]+)"/i.exec(m[1]), lo=/\blon="([^"]+)"/i.exec(m[1]);
    if(!la||!lo) continue;
    const ti=/<time>\s*([^<]+)\s*<\/time>/i.exec(m[2]);
    points.push({lat:+la[1],lon:+lo[1],time:ti?new Date(ti[1]):null});
  }
  return points;
}
function showOriginal(){
  if(originalLine) map.removeLayer(originalLine);
  if(!originalPoints.length) return;
  originalLine=L.polyline(originalPoints.map(p=>[p.lat,p.lon]),{weight:4,opacity:.65}).addTo(map);
  const last=originalPoints.at(-1);
  L.circleMarker([last.lat,last.lon],{radius:7,weight:3,fillOpacity:.9}).addTo(map);
  map.fitBounds(boundsFor(originalPoints),{padding:[35,35]});
  // The first click starts at the exact end of the existing GPX.
  setRoute([{lat:last.lat,lon:last.lon}],false);
}
function initOutput(){
  if(outputMap) return;
  outputMap=L.map("outputMap").setView([55.7,12.57],6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors"}).addTo(outputMap);
}
function showOutput(){
  initOutput();
  if(outputOriginalLine) outputMap.removeLayer(outputOriginalLine);
  if(outputGeneratedLine) outputMap.removeLayer(outputGeneratedLine);
  outputOriginalLine=L.polyline(originalPoints.map(p=>[p.lat,p.lon]),{weight:4,opacity:.55}).addTo(outputMap);
  const gen=outputPoints.slice(originalPoints.length-1);
  outputGeneratedLine=L.polyline(gen.map(p=>[p.lat,p.lon]),{weight:6}).addTo(outputMap);
  outputMap.fitBounds(boundsFor(outputPoints),{padding:[35,35]});
  $("outputCard").hidden=false;
  setTimeout(()=>outputMap.invalidateSize(),50);
}

$("gpx").addEventListener("change",async()=>{
  const file=$("gpx").files[0]; if(!file)return;
  try{
    originalPoints=parseGPXText(await file.text());
    if(originalPoints.length<2) throw Error("Der blev ikke fundet nok trackpoints i GPX-filen.");
    $("fileInfo").textContent=`${file.name} — ${originalPoints.length.toLocaleString("da-DK")} GPS-punkter fundet.`;
    showOriginal();
    setStatus("GPX indlæst og vist på kortet.","ok");
  }catch(e){ originalPoints=[]; $("fileInfo").textContent="Kunne ikke læse GPX-filen."; setStatus(e.message,"error"); }
});

$("drawTab").onclick=()=>{
  $("drawTab").classList.add("active"); $("googleTab").classList.remove("active");
  $("googlePanel").hidden=true;
  if(originalPoints.length) map.invalidateSize();
};
$("googleTab").onclick=()=>{
  $("googleTab").classList.add("active"); $("drawTab").classList.remove("active");
  $("googlePanel").hidden=false;
  map.invalidateSize();
};
$("undo").onclick=()=>{
  if(route.length>1){route.pop();redrawDraw();}
  else if(route.length===1){route=[];redrawDraw();}
};
$("clear").onclick=()=>{route=[];redrawDraw();if(originalPoints.length)route=[{...originalPoints.at(-1)}];redrawDraw();};
$("finish").onclick=()=>{
  if(route.length<2){setStatus("Tilføj mindst ét punkt mere til den manglende rute.","error");return;}
  setStatus(`Rute klar med ${route.length} tegnede punkter.`,"ok");
};

$("loadGoogle").onclick=async()=>{
  const url=$("googleUrl").value.trim();
  if(!url){setStatus("Indsæt et Google Maps-link.","error");return;}
  setStatus("Henter rute…");
  try{
    const r=await fetch("/api/route-from-google",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})});
    const d=await r.json(); if(!r.ok)throw Error(d.error||"Kunne ikke hente ruten.");
    if(!originalPoints.length) throw Error("Upload GPX-filen først, så ruten kan kobles til dens sidste punkt.");
    const last=originalPoints.at(-1);
    d.route[0]=last;
    setRoute(d.route,true);
    $("drawTab").click();
    setStatus("Google-ruten er hentet og vist på kortet.","ok");
  }catch(e){setStatus(e.message,"error")}
};

$("reconstruct").onclick=async()=>{
  try{
    const file=$("gpx").files[0], lat=+$("endLat").value, lon=+$("endLon").value, endTime=$("endTime").value;
    if(!file||!originalPoints.length) throw Error("Upload en GPX-fil først.");
    if(route.length<2) throw Error("Tegn eller hent først den manglende rute.");
    if(!Number.isFinite(lat)||!Number.isFinite(lon)) throw Error("Indtast gyldige slutkoordinater.");
    if(!endTime) throw Error("Vælg et sluttidspunkt.");
    setStatus("Genererer GPS-punkter og beregner tider…");
    const fd=new FormData();
    fd.append("gpx",file); fd.append("route",JSON.stringify(route));
    fd.append("endLat",lat); fd.append("endLon",lon); fd.append("endTime",endTime);
    const r=await fetch("/api/reconstruct",{method:"POST",body:fd});
    if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error||"Rekonstruktionen fejlede.");}
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    $("download").href=url; $("download").download="reconstructed.gpx"; $("download").hidden=false;

    // Build the output preview from the original GPX plus the route we generated.
    // The exact generated points are resampled client-side for visual preview;
    // the downloaded file is produced by the server.
    outputPoints=originalPoints.slice();
    const target={lat,lon};
    const start=originalPoints.at(-1);
    const routePreview=route.slice();
    routePreview[0]=start; routePreview[routePreview.length-1]=target;
    outputPoints=outputPoints.concat(routePreview.slice(1));
    showOutput();
    $("resultInfo").textContent=`Original: ${originalPoints.length.toLocaleString("da-DK")} punkter · rekonstrueret retning: ${routePreview.length.toLocaleString("da-DK")} rute-punkter · slut: ${lat.toFixed(8)}, ${lon.toFixed(8)} · ${endTime.replace("T"," ")}`;
    setStatus("Færdig — resultatet vises på kortet nedenfor.","ok");
    $("outputCard").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){setStatus(e.message,"error")}
};

initMap();
