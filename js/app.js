/* Real Jaén CF — TFG · lógica de la aplicación */

const API_BASE = "http://127.0.0.1:8000";
let isRunning = false;
let pollInterval = null;
let playerRadarInstance = null;

// ---- Significado de las columnas numéricas de *_analytics.txt ----
const ANALYTICS_LABELS = [
  { label: "Distancia recorrida", unit: "m" },
  { label: "Velocidad media", unit: "km/h" },
  { label: "Velocidad punta", unit: "km/h" }
];

function handleImgError(img){
  img.style.display = "none";
  const fb = img.nextElementSibling;
  if(fb) fb.style.display = "flex";
}

/* ============================================================
   CARRUSEL DE EJEMPLOS DE DETECCIONES (dashboard)
   ============================================================
   Añade aquí cada foto de ejemplo colocada en la carpeta /fotos.
   "src"    -> nombre del archivo dentro de /fotos
   "title"  -> texto corto que se muestra sobre la foto
   "sub"    -> texto secundario (opcional)
*/
let DETECTION_EXAMPLES = [];  // se carga desde /api/carrusel (SQLite)

let carouselIndex = 0;
let carouselTimer = null;
const CAROUSEL_AUTOPLAY_MS = 5000;

function handleCarouselImgError(img, fileName){
  const slide = img.closest('.carousel-slide');
  if(slide) slide.innerHTML = `<div class="carousel-slide-empty">No se encontró ${fileName}<br>en /fotos</div>`;
}

function renderCarousel(){
  const track = document.getElementById('carousel-track');
  const dotsBox = document.getElementById('carousel-dots');
  const counter = document.getElementById('carousel-counter');
  if(!track) return;

  if(!DETECTION_EXAMPLES || DETECTION_EXAMPLES.length === 0){
    track.innerHTML = `<div class="carousel-slide"><div class="carousel-slide-empty">No hay fotos de ejemplo todavía.<br>Añade imágenes en /fotos y regístralas en DETECTION_EXAMPLES.</div></div>`;
    if(dotsBox) dotsBox.innerHTML = '';
    if(counter) counter.textContent = '';
    return;
  }

  track.innerHTML = DETECTION_EXAMPLES.map(item => `
    <div class="carousel-slide">
      <img src="${item.src}" alt="${escapeHtml(item.title || 'Ejemplo de detección')}" onerror="handleCarouselImgError(this, '${item.src.replace(/'/g, "\\'")}')">
      ${(item.title || item.sub) ? `
      <div class="carousel-slide-caption">
        ${item.title ? `<div class="cap-title">${escapeHtml(item.title)}</div>` : ''}
        ${item.sub ? `<div class="cap-sub">${escapeHtml(item.sub)}</div>` : ''}
      </div>` : ''}
    </div>
  `).join('');

  if(dotsBox){
    dotsBox.innerHTML = DETECTION_EXAMPLES.map((_, i) =>
        `<button class="carousel-dot" onclick="carouselGoTo(${i})" aria-label="Ir a la foto ${i+1}" type="button"></button>`
    ).join('');
  }

  updateCarouselUI();
}

function updateCarouselUI(){
  const track = document.getElementById('carousel-track');
  const dots = document.querySelectorAll('#carousel-dots .carousel-dot');
  const counter = document.getElementById('carousel-counter');
  const total = DETECTION_EXAMPLES.length;
  if(!track || total === 0) return;

  carouselIndex = ((carouselIndex % total) + total) % total;
  track.style.transform = `translateX(-${carouselIndex * 100}%)`;
  dots.forEach((d, i) => d.classList.toggle('active', i === carouselIndex));
  if(counter) counter.textContent = `${carouselIndex + 1} / ${total}`;
}

function carouselMove(delta){
  if(!DETECTION_EXAMPLES || DETECTION_EXAMPLES.length === 0) return;
  carouselIndex += delta;
  updateCarouselUI();
  restartCarouselAutoplay();
}

function carouselGoTo(i){
  carouselIndex = i;
  updateCarouselUI();
  restartCarouselAutoplay();
}

function restartCarouselAutoplay(){
  if(carouselTimer) clearInterval(carouselTimer);
  if(!DETECTION_EXAMPLES || DETECTION_EXAMPLES.length <= 1) return;
  carouselTimer = setInterval(() => { carouselIndex++; updateCarouselUI(); }, CAROUSEL_AUTOPLAY_MS);
}

// Swipe táctil en móvil
(function setupCarouselSwipe(){
  const viewport = document.querySelector('#detections-carousel .carousel-viewport');
  if(!viewport) return;
  let startX = 0, isSwiping = false;
  viewport.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    isSwiping = true;
  }, { passive: true });
  viewport.addEventListener('touchend', e => {
    if(!isSwiping) return;
    isSwiping = false;
    const delta = e.changedTouches[0].clientX - startX;
    if(Math.abs(delta) > 40) carouselMove(delta < 0 ? 1 : -1);
  }, { passive: true });
})();

renderCarousel();
restartCarouselAutoplay();

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  const navBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if(navBtn) navBtn.classList.add('active');
  if(tabId === 'tab-analytics') showSquadList();
  if(tabId === 'tab-heatmaps') loadHeatmaps();
  if(tabId === 'tab-tactical') loadTacticalAnalysis();
  if(tabId === 'tab-detections') loadDetections();
  if(tabId === 'tab-jornadas'){
    document.getElementById('jornada-detail-view').style.display = 'none';
    document.getElementById('jornadas-grid-view').style.display = 'block';
    loadJornadas();
  }
  if(tabId === 'tab-pipeline') populateVideoSelect();
  document.querySelector('.main').scrollTo({ top: 0, behavior: 'smooth' });
}

function mediaBaseName(filename){
  return filename.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
}

/* ------------------------------------------------------------
   Etiquetas "Gol N <Jugador>" para mapas de calor, grafos y
   detecciones finales, a partir del nombre de fichero generado
   por el pipeline (p.ej. "jornada2_Gol1 Siverio_team0_best_player_heatmap.png").
   Solo cambia el TEXTO mostrado al usuario; no renombra ficheros
   ni afecta al filtro por jornada (que sigue leyendo "jornadaN").
   ------------------------------------------------------------ */
function extractGoalInfo(filename){
  const base = filename.split('/').pop().replace(/\.[^/.]+$/, '');
  const m = base.match(/gol\D*(\d+)[_\s]*([^_]*)/i);
  if(!m) return null;
  return { gol: m[1], player: (m[2] || '').trim() };
}

function extractTeamId(filename){
  const m = filename.match(/_team(\d+)/i);
  return m ? m[1] : null;
}

function goalFileStem(filename){
  // "<stem>_team{N}_best_player_heatmap.png" -> stem (para localizar
  // "<stem>_team_names.json", el mismo fichero que usa Análisis táctico).
  const dir = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/') + 1) : '';
  const base = filename.split('/').pop().replace(/\.[^/.]+$/, '');
  const stem = base.replace(/_team\d+.*$/i, '');
  return { dir, stem };
}

async function fetchTeamNamesForStem(dir, stem){
  try {
    const res = await fetch(`${API_BASE}/outputs/${dir}${stem}_team_names.json`);
    if(!res.ok) return {};
    const data = await res.json();
    return (data && typeof data === 'object') ? data : {};
  } catch(e) {
    return {};
  }
}

function formatHeatmapCaption(filename, teamName){
  const info = extractGoalInfo(filename);
  const base = filename.split('/').pop();

  // Heatmap del jugador destacado.
  const isMvpHeatmap = /best[_-]?player.*heat ?map/i.test(base);

  if(isMvpHeatmap){
    const playerName = info && info.player ? info.player : 'Jugador destacado';
    const goalLabel = info ? `Gol ${info.gol}` : '';
    return `${goalLabel}${goalLabel && playerName ? ' ' : ''}${playerName} [Mapa jugador]`;      }

  // Heatmap correspondiente al equipo.
  const teamId = extractTeamId(filename);
  const teamLabel = teamName || (teamId !== null ? `[ Mapa equipo ${teamId}` : 'Equipo]');

  if(info){
    return `Gol ${info.gol}${info.player ? ` ${info.player}` : ''}  [Mapa Equipo - ${teamLabel}]`;      }

  return `Equipo — ${teamLabel}`;
}

function formatGrafoCaption(filename){
  const info = extractGoalInfo(filename);
  if(!info) return mediaBaseName(filename);
  return `Gol ${info.gol}${info.player ? ' ' + info.player : ''} [Video Grafo]`;
}

function formatFinalDetectionCaption(filename){
  const info = extractGoalInfo(filename);
  if(!info) return mediaBaseName(filename);
  return `Gol ${info.gol}${info.player ? ' ' + info.player : ''} [Video Detección final]`;
}

function itemFile(item){ return typeof item === 'string' ? item : item.file; }
function itemCaption(item){ return typeof item === 'string' ? mediaBaseName(item) : (item.caption || mediaBaseName(item.file)); }

function setVideoAspect(video){
  if(video.videoWidth && video.videoHeight){
    video.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  }
}

let allHeatmapFiles = [];
let allMinimapFiles = [];
let allOtherImageFiles = [];

function extractJornada(filename){
  const m = filename.match(/jornada\D*(\d{1,3})(?!\d)/i);
  return m ? parseInt(m[1], 10) : null;
}

function getHeatmapType(filename){
  const base = filename.split('/').pop();
  // Los mapas del MVP se generan con "best_player_heatmap".
  if(/best[_-]?player.*heat ?map/i.test(base)) return 'mvp';
  // Los mapas de equipo llevan el identificador "_teamN".
  if(/_team\d+/i.test(base)) return 'team';
  return 'other';
}

function populateJornadaFilter(){
  const sel = document.getElementById('jornada-filter');
  if(!sel || sel.dataset.populated) return;
  fillJornadaSelect(sel);
}

function clearJornadaFilter(){
  const sel = document.getElementById('jornada-filter');
  if(sel) sel.value = 'all';
  applyJornadaFilter();
}

let heatmapMediaView = 'all';

function setHeatmapMediaView(view){
  // Pulsar el botón ya activo vuelve a mostrar ambos paneles.
  heatmapMediaView = (heatmapMediaView === view) ? 'all' : view;

  document.querySelectorAll('#tab-heatmaps .view-toggle .view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mediaView === heatmapMediaView);
  });

  const heatContainer = document.getElementById('heatmaps-container');
  const legend = document.querySelector('#tab-heatmaps .heatmap-legend');
  const minimapsPanel = document.getElementById('minimaps-panel');

  if(heatContainer) heatContainer.style.display = (heatmapMediaView === 'graphs') ? 'none' : '';
  if(legend) legend.style.display = (heatmapMediaView === 'graphs') ? 'none' : '';
  if(minimapsPanel) minimapsPanel.style.display = (heatmapMediaView === 'heatmaps') ? 'none' : '';
}

function clearHeatmapFilters(){
  const jornada = document.getElementById('jornada-filter');
  const type = document.getElementById('heatmap-type-filter');
  if(jornada) jornada.value = 'all';
  if(type) type.value = 'all';
  setHeatmapMediaView('all');
  applyJornadaFilter();
}

async function loadHeatmaps() {
  populateJornadaFilter();
  const heatEl = document.getElementById('heatmaps-container');
  const miniEl = document.getElementById('minimaps-container');
  heatEl.innerHTML = '<div class="placeholder-box">Buscando imágenes…</div>';
  miniEl.innerHTML = '<div class="placeholder-box">Buscando imágenes…</div>';

  try {
    const res = await fetch(`${API_BASE}/api/results`);
    const data = await res.json();
    const files = data.files || [];
    const images = files.filter(f => /\.(jpg|jpeg|png)$/i.test(f));
    const videos = files.filter(f => /\.mp4$/i.test(f));

    const heatmapFiles = images.filter(f => /heat ?map/i.test(f));
    allMinimapFiles = videos.filter(f => /mini ?map/i.test(f) && !/final/i.test(f));
    allOtherImageFiles = images.filter(f => !heatmapFiles.includes(f));

    // El nombre real del equipo (si se configuró en la corrección
    // manual de "Mejor jugador") vive en "<stem>_team_names.json",
    // junto al resto de resultados de ese vídeo. Se pide una vez por
    // vídeo distinto (varios heatmaps -equipo 0 y 1- comparten stem).
    const stemCache = new Map();
    allHeatmapFiles = await Promise.all(heatmapFiles.map(async f => {
      const { dir, stem } = goalFileStem(f);
      const cacheKey = dir + stem;
      if(!stemCache.has(cacheKey)){
        stemCache.set(cacheKey, fetchTeamNamesForStem(dir, stem));
      }
      const teamNames = await stemCache.get(cacheKey);
      const teamId = extractTeamId(f);
      const teamName = teamId !== null
          ? (teamNames[teamId] || `Equipo ${teamId}`)
          : null;
      return { file: f, caption: formatHeatmapCaption(f, teamName) };
    }));

    applyJornadaFilter();
  } catch(e) {
    console.error("Error cargando imágenes", e);
    heatEl.innerHTML = '<div class="placeholder-box" style="color:#d1453b;">Error al consultar informes.</div>';
    miniEl.innerHTML = '';
  }
}

function renderVideoGrid(files, emptyMessage){
  if(!files || files.length === 0){
    return emptyMessage ? `<div class="placeholder-box">${escapeHtml(emptyMessage)}</div>` : '';
  }
  const cards = files.map(item => {
    const f = itemFile(item);
    const caption = itemCaption(item);
    return `
        <div class="media-card video-card">
          <video class="media-video" controls preload="metadata" onloadedmetadata="setVideoAspect(this)" src="${API_BASE}/outputs/${encodeURIComponent(f)}"></video>
          <div class="media-caption">${escapeHtml(caption)}</div>
        </div>`;
  }).join('');
  return `<div class="video-grid">${cards}</div>`;
}

function applyJornadaFilter(){
  const heatEl = document.getElementById('heatmaps-container');
  const miniEl = document.getElementById('minimaps-container');
  const sel = document.getElementById('jornada-filter');
  const typeSel = document.getElementById('heatmap-type-filter');
  const jornadaValue = sel ? sel.value : 'all';
  const heatmapType = typeSel ? typeSel.value : 'all';
  const jornadaNum = jornadaValue === 'all' ? null : parseInt(jornadaValue, 10);

  const matchesJornada = item => jornadaNum === null || extractJornada(itemFile(item)) === jornadaNum;
  const matchesHeatmapType = item => {
    if(heatmapType === 'all') return true;
    return getHeatmapType(itemFile(item)) === heatmapType;
  };

  const heatmapImgs = allHeatmapFiles.filter(item => matchesJornada(item) && matchesHeatmapType(item));
  const minimapImgs = allMinimapFiles.filter(matchesJornada);
  const otherImgs = allOtherImageFiles.filter(matchesJornada);

  const suffixJornada = jornadaNum !== null ? paraJornada(jornadaNum) : '';
  const suffixType = heatmapType === 'team'
      ? ' de equipo'
      : heatmapType === 'mvp'
          ? ' de MVP'
          : '';
  const suffix = `${suffixJornada}${suffixType}`;

  // Si se selecciona un tipo concreto, no mezclamos otros tipos de imágenes.
  const heatSource = heatmapType === 'all'
      ? (heatmapImgs.length ? heatmapImgs : otherImgs)
      : heatmapImgs;
  const heatEmptyMsg = heatSource.length ? '' : `No se encontraron mapas de calor${suffix}.`;

  heatEl.innerHTML = renderImageGrid(heatSource, heatEmptyMsg);
  miniEl.innerHTML = renderVideoGrid(
      minimapImgs.map(f => ({ file: f, caption: formatGrafoCaption(f) })),
      `No se encontraron grafos${suffix}.`
  );
}

function renderImageGrid(files, emptyMessage){
  if(!files || files.length === 0){
    return emptyMessage ? `<div class="placeholder-box">${escapeHtml(emptyMessage)}</div>` : '';
  }
  const cards = files.map(item => {
    const f = itemFile(item);
    const caption = itemCaption(item);
    return `
        <a class="media-card" href="${API_BASE}/outputs/${encodeURIComponent(f)}" target="_blank" rel="noopener">
          <div class="media-thumb"><img src="${API_BASE}/outputs/${encodeURIComponent(f)}" alt="${escapeHtml(f)}" loading="lazy"></div>
          <div class="media-caption">${escapeHtml(caption)}</div>
        </a>`;
  }).join('');
  return `<div class="media-grid">${cards}</div>`;
}

/* ============================================================
   ANÁLISIS TÁCTICO DEL EQUIPO
   ============================================================ */
let allTacticalClips = [];

function populateTacticalJornadaFilter(){
  const sel = document.getElementById('tactical-jornada-filter');
  if(!sel || sel.dataset.populated) return;
  fillJornadaSelect(sel);
}

function clearTacticalJornadaFilter(){
  const sel = document.getElementById('tactical-jornada-filter');
  if(sel) sel.value = 'all';
  applyTacticalJornadaFilter();
}

function parseTeamTacticalText(text){
  const teams = [];
  let current = null;

  text.split('\n').forEach(rawLine => {
    const line = rawLine.replace(/\r$/, '');
    const teamMatch = line.match(/^\s*EQUIPO\s+(\d+)\s*$/i);
    if(teamMatch){
      current = { team: teamMatch[1], metrics: [] };
      teams.push(current);
      return;
    }
    if(!current) return;

    const metricMatch = line.match(/^\s*([^:]+?)\s*:\s*([^(]+?)\s*(?:\(([^)]*)\))?\s*$/);
    if(metricMatch){
      const label = metricMatch[1].trim();
      const value = metricMatch[2].trim();
      const detail = metricMatch[3] ? metricMatch[3].trim() : '';
      if(label && value) current.metrics.push({ label, value, detail });
    }
  });

  return teams;
}

async function loadTacticalAnalysis(){
  populateTacticalJornadaFilter();
  const el = document.getElementById('tactical-container');
  el.innerHTML = '<div class="placeholder-box">Buscando estudio estratégico…</div>';

  try {
    const res = await fetch(`${API_BASE}/api/results`);
    const data = await res.json();
    const files = (data.files || []).filter(f => /team[_-]?tactical/i.test(f) && /\.txt$/i.test(f));

    if(files.length === 0){
      allTacticalClips = [];
      el.innerHTML = '<div class="placeholder-box">No se encontraron datos del estudio estratégico.</div>';
      return;
    }

    const fileContents = await Promise.all(
        files.map(async file => {
          const text = await fetch(`${API_BASE}/outputs/${file}`).then(r => r.text());
          const teamNames = await fetchTacticalTeamNames(file);
          return { file, teams: parseTeamTacticalText(text), teamNames };
        })
    );

    allTacticalClips = fileContents.filter(c => c.teams.length > 0);
    applyTacticalJornadaFilter();
  } catch(e) {
    console.error("Error cargando el Estudio estratégico", e);
    el.innerHTML = '<div class="placeholder-box" style="color:#d1453b;">Error al consultar los informes</div>';
  }
}

function applyTacticalJornadaFilter(){
  const el = document.getElementById('tactical-container');
  const sel = document.getElementById('tactical-jornada-filter');
  const jornadaValue = sel ? sel.value : 'all';
  const jornadaNum = jornadaValue === 'all' ? null : parseInt(jornadaValue, 10);

  const clips = allTacticalClips.filter(c => jornadaNum === null || extractJornada(c.file) === jornadaNum);

  if(clips.length === 0){
    const suffix = jornadaNum !== null ? paraJornada(jornadaNum) : '';
    el.innerHTML = `<div class="placeholder-box">No se encontraron Estudio estratégico${suffix}.</div>`;
    return;
  }

  el.innerHTML = renderTacticalClips(clips);
}

function getJornadaMetaByNumber(n){
  return JORNADAS_DATA.find(j => j.numero === n) || null;
}

// Los equipos se leen del *_team_tactical.txt como "EQUIPO 0" / "EQUIPO 1".
// Si durante la corrección manual el usuario escribió los nombres reales
// (ver renderCorrectionTeamNames), se guardan en "<stem>_team_names.json"
// junto al resto de resultados del vídeo, y son los que se usan aquí.
//
// Si esa revisión se omitió (o es un vídeo antiguo sin ese fichero),
// mantenemos como red de seguridad el criterio anterior: Equipo 0 = Real
// Jaén por defecto, con un botón para intercambiar si el pipeline los
// asignó al revés en ese clip concreto (recordado por clip).
function tacticalStemFromFile(file){
  const base = file.split('/').pop();
  return base.replace(/\.[^/.]+$/, '').replace(/_team[_-]?tactical$/i, '');
}

async function fetchTacticalTeamNames(file){
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  const stem = tacticalStemFromFile(file);
  try {
    const res = await fetch(`${API_BASE}/outputs/${dir}${stem}_team_names.json`);
    if(!res.ok) return {};
    const data = await res.json();
    return (data && typeof data === 'object') ? data : {};
  } catch(e) {
    return {};
  }
}

function tacticalTeamNamesFor(clip){
  const names = clip.teamNames || {};
  if(names['0'] || names['1']){
    return [names['0'] || 'Equipo 0', names['1'] || 'Equipo 1'];
  }

  const jornadaNum = extractJornada(clip.file);
  const meta = jornadaNum ? getJornadaMetaByNumber(jornadaNum) : null;
  const rivalName = meta && meta.rival ? meta.rival : 'Rival';
  return ['Real Jaén CF', rivalName];
}

function tacticalTeamCrestSrc(teamName, jornadaMeta){
  // Resuelve el escudo a partir del NOMBRE del equipo (no del índice 0/1,
  // que puede estar intercambiado según la revisión manual de equipos).
  const n = (teamName || '').toLowerCase();
  if(n.includes('jaén') || n.includes('jaen')) return ESCUDO_JAEN;
  if(jornadaMeta && jornadaMeta.escudo_rival) return `fotos/${jornadaMeta.escudo_rival}`;
  return '';
}

function tacticalTeamName(teamIndex, names){
  const idx = parseInt(teamIndex, 10);
  if(names && names[idx] !== undefined) return names[idx];
  return `Equipo ${teamIndex}`;
}

function renderTacticalClips(clips){
  return clips.map(clip => {
    const jornadaNum = extractJornada(clip.file);
    const goalInfo = extractGoalInfo(clip.file);
    let title;
    if(jornadaNum && goalInfo){
      title = `${jornadaLabel(jornadaNum)} | Gol ${goalInfo.gol}${goalInfo.player ? ' ' + goalInfo.player : ''}`;
    } else {
      title = formatDetectionTitle(getDetectionKey(clip.file));
    }
    const names = tacticalTeamNamesFor(clip);
    const jornadaMeta = jornadaNum ? getJornadaMetaByNumber(jornadaNum) : null;

    const teamsHtml = clip.teams.map(team => {
      const tiles = team.metrics.map(m => `
                <div class="tactical-tile">
                  <div class="label">${escapeHtml(m.label)}</div>
                  <div class="value">${escapeHtml(m.value)}</div>
                  ${m.detail ? `<div class="detail">${escapeHtml(m.detail)}</div>` : ''}
                </div>`).join('');

      const teamName = tacticalTeamName(team.team, names);
      const crestSrc = tacticalTeamCrestSrc(teamName, jornadaMeta);

      return `
                <div class="tactical-team-card team-${escapeHtml(team.team)}">
                  <div class="tactical-team-head">
                    ${crestHtml(crestSrc, teamName, 'crest-xs')}
                    <span class="tactical-team-name">${escapeHtml(teamName)}</span>
                  </div>
                  <div class="tactical-metrics">${tiles}</div>
                </div>`;
    }).join('');

    return `
            <div class="tactical-clip-block">
              <div class="tactical-clip-head">
                <div>
                  <div class="tactical-clip-title">${escapeHtml(title)}</div>
                </div>
              </div>
              <div class="tactical-grid">${teamsHtml}</div>
            </div>`;
  }).join('');
}

let allDetectionFiles = [];

function populateDetectionJornadaFilter(){
  const sel = document.getElementById('detection-jornada-filter');
  if(!sel || sel.dataset.populated) return;
  fillJornadaSelect(sel);
}

function clearDetectionJornadaFilter(){
  const sel = document.getElementById('detection-jornada-filter');
  if(sel) sel.value = 'all';
  applyDetectionJornadaFilter();
}

function renderDetectionVideos(videos){
  const el = document.getElementById('detections-container');
  const sel = document.getElementById('detection-jornada-filter');
  const jornadaValue = sel ? sel.value : 'all';
  const suffix = jornadaValue === 'all' ? '' : paraJornada(parseInt(jornadaValue, 10));

  if(videos.length === 0){
    el.innerHTML = `<div class="placeholder-box">No se encontraron vídeos de detección final${suffix}.</div>`;
    return;
  }

  el.innerHTML = `<div class="video-grid">${videos.map(f => `
        <div class="media-card video-card">
          <video class="media-video" controls preload="metadata" onloadedmetadata="setVideoAspect(this)" src="${API_BASE}/outputs/${encodeURIComponent(f)}"></video>
          <div class="media-caption">${escapeHtml(formatFinalDetectionCaption(f))}</div>
        </div>`).join('')}</div>`;
}

function applyDetectionJornadaFilter(){
  const sel = document.getElementById('detection-jornada-filter');
  const jornadaValue = sel ? sel.value : 'all';
  const jornadaNum = jornadaValue === 'all' ? null : parseInt(jornadaValue, 10);
  const filtered = allDetectionFiles.filter(f =>
      jornadaNum === null || extractJornada(f) === jornadaNum
  );
  renderDetectionVideos(filtered);
}

async function loadDetections() {
  populateDetectionJornadaFilter();
  const el = document.getElementById('detections-container');
  el.innerHTML = '<div class="placeholder-box">Buscando vídeos…</div>';

  try {
    const res = await fetch(`${API_BASE}/api/results`);
    const data = await res.json();
    allDetectionFiles = (data.files || []).filter(f => /\.mp4$/i.test(f) && /final/i.test(f) && /mini ?map/i.test(f));
    applyDetectionJornadaFilter();
  } catch(e) {
    console.error("Error cargando vídeos", e);
    el.innerHTML = '<div class="placeholder-box" style="color:#d1453b;">Error al consultar los informes.</div>';
  }
}

/* ============================================================
   SELECTOR DE VÍDEO (Configuración del análisis)
   Lista los clips disponibles en OUTPUTS/primeraref/jornadaN/,
   agrupados por jornada, reutilizando el mismo endpoint que la
   pestaña de Jornadas.
   ============================================================ */
let videoSelectLoaded = false;

function clipShortLabel(filename){
  // Quita el prefijo "jornadaN" del nombre del clip: como la jornada ya
  // aparece en negrita como cabecera del grupo, sobra repetirla en cada opción.
  return mediaBaseName(filename).replace(/^jornada\s*\d+\s*/i, '').trim();
}

async function populateVideoSelect(){
  const select = document.getElementById("input-video");
  const btnRun = document.getElementById("btn-run");
  if(videoSelectLoaded) return;

  const results = await Promise.all(
      JORNADAS_DATA.map(async j => {
        try{
          const res = await fetch(`${API_BASE}/api/jornadas/${j.numero}/clips`);
          if(!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return { numero: j.numero, clips: Array.isArray(data.clips) ? data.clips : [] };
        }catch(e){
          return { numero: j.numero, clips: [] };
        }
      })
  );

  const groups = results.filter(r => r.clips.length > 0);

  if(groups.length === 0){
    select.innerHTML = '<option value="">No hay vídeos disponibles en OUTPUTS/primeraref/</option>';
    btnRun.disabled = true;
    return;
  }

  select.innerHTML = groups.map(g => `
        <optgroup label="${escapeHtml(jornadaLabel(g.numero))}">
          ${g.clips.map(c => `<option value="${escapeHtml('OUTPUTS/' + c.path)}">${escapeHtml(clipShortLabel(c.name))}</option>`).join('')}
        </optgroup>
    `).join('');

  videoSelectLoaded = true;
  btnRun.disabled = isRunning;
}

/* ============================================================
   INDICADOR "QUÉ SE ESTÁ ANALIZANDO"
   Traduce el valor seleccionado en los <select> de vídeo/dispositivo
   a un aviso legible (jornada, rival y campo, nombre del clip y
   dispositivo de cómputo), visible en el panel "Estado del pipeline"
   mientras se configura y durante toda la ejecución.
   ============================================================ */
function renderAnalysisTarget(videoValue, device){
  const box = document.getElementById('pipeline-target');
  if(!box) return;

  if(!videoValue){
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  const jornadaNum = extractJornada(videoValue);
  const j = jornadaNum !== null ? (JORNADAS_DATA.find(x => x.numero === jornadaNum) || null) : null;
  const fileName = videoValue.split('/').pop();
  const clipLabel = clipShortLabel(fileName) || fileName;
  const jornadaTxt = jornadaNum !== null ? jornadaLabel(jornadaNum) : 'Jornada sin identificar';
  const rivalTxt = (j && j.rival)
      ? `${escapeHtml(j.rival)} · ${j.campo === 'visitante' ? 'Visitante' : 'Local'}`
      : '';
  const isCpu = device === 'cpu';
  const deviceTxt = isCpu ? 'CPU' : 'GPU 0';

  // Iconos SVG de línea (estilo Lucide), heredan el color con currentColor
  const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    shield:   svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    film:     svg('<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>'),
    cpu:      svg('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>')
  };
  const chip = (cls, icon, text, title) => `
        <span class="pipeline-target-chip ${cls}"${title ? ` title="${escapeHtml(title)}"` : ''}>
            <span class="chip-ico">${icon}</span>
            <span class="chip-txt">${text}</span>
        </span>`;

  box.style.display = 'flex';
  box.innerHTML = [
    chip('jornada', ICONS.calendar, escapeHtml(jornadaTxt)),
    rivalTxt ? chip('rival', ICONS.shield, rivalTxt) : '',
    chip('video', ICONS.film, escapeHtml(clipLabel), fileName),
    chip('device', ICONS.cpu, deviceTxt)
  ].join('');
}

function updateAnalysisTargetPreview(){
  const video = document.getElementById('input-video').value;
  const device = document.getElementById('input-device').value;
  renderAnalysisTarget(video, device);
}

function setPipelineConfigLocked(locked){
  // Bloquea/desbloquea la configuración del análisis (vídeo + dispositivo)
  // mientras el pipeline está en ejecución, para que no se pueda cambiar
  // a mitad de un análisis ya lanzado.
  document.getElementById("input-video").disabled = locked;
  document.getElementById("input-device").disabled = locked;
}

async function checkBackendStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    if(res.ok) {
      const data = await res.json();
      document.getElementById("status-dot").classList.remove("error");
      document.getElementById("status-dot").classList.add("active");
      document.getElementById("status-text").innerText = data.is_running ? "Ejecutando pipeline…" : "WebApp local";

      if(data.is_running && !isRunning) {
        startPolling();
      }
    }
  } catch (e) {
    document.getElementById("status-dot").classList.remove("active");
    document.getElementById("status-dot").classList.add("error");
    document.getElementById("status-text").innerText = "Webapp local";
  }
}

async function startAnalysis() {
  const video = document.getElementById("input-video").value;
  const device = document.getElementById("input-device").value;

  if(!video){
    appendLog("[ERROR] Selecciona primero un vídeo de la lista.", "err");
    return;
  }

  renderAnalysisTarget(video, device);
  document.getElementById("btn-run").disabled = true;
  setPipelineConfigLocked(true);
  appendLog("[INFO] Solicitando inicio de proceso…", "info");
  renderPipelineStage(1, false, "Arrancando el pipeline…");

  try {
    const res = await fetch(`${API_BASE}/api/run?video=${encodeURIComponent(video)}&device=${encodeURIComponent(device)}`, {
      method: "POST"
    });

    const data = await res.json();
    if(res.ok) {
      appendLog(`[OK] ${data.message}: ${data.command}`, "info");
      startPolling();
    } else {
      appendLog(`[ERROR] ${data.message}`, "err");
      document.getElementById("btn-run").disabled = false;
      setPipelineConfigLocked(false);
    }
  } catch (e) {
    appendLog(`[ERROR] No se pudo conectar con el backend server.py`, "err");
    document.getElementById("btn-run").disabled = false;
    setPipelineConfigLocked(false);
  }
}

function startPolling() {
  isRunning = true;
  document.getElementById("btn-run").disabled = true;
  setPipelineConfigLocked(true);
  if(pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    let logs = [];
    let running = true;
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      const data = await res.json();
      logs = data.logs || [];
      running = data.is_running;

      const term = document.getElementById("terminal");
      term.innerHTML = "";
      logs.forEach(line => {
        const p = document.createElement("p");
        if(line.includes("Error") || line.includes("❌")) p.className = "err";
        else if(line.includes("✅") || line.includes("Iniciando")) p.className = "info";
        p.innerText = line;
        term.appendChild(p);
      });
      term.scrollTop = term.scrollHeight;

      if(!running) {
        clearInterval(pollInterval);
        isRunning = false;
        document.getElementById("btn-run").disabled = false;
        setPipelineConfigLocked(false);
        document.getElementById("status-text").innerText = "Análisis finalizado";
      }
    } catch(e) {
      console.error("Error consultando estado", e);
    }
    await pollCorrectionReview();
    updatePipelineFromLogs(logs, running);
  }, 1000);
}

/* ============================================================
   BARRA DE PROGRESO DEL PIPELINE
   Traduce las líneas de log en un estado visual simple para
   usuarios que no leen la terminal.
   ============================================================ */
const PIPELINE_STAGES = [
  "Configuración",
  "Iniciando ejecución",
  "Analizando frame a frame",
  "Corrección manual",
  "Generando resultados",
  "Codificando vídeos",
  "Completado"
];
const STAGE_MESSAGES = [
  "Elige un vídeo y pulsa «Ejecutar análisis» para empezar.",
  "Arrancando el pipeline y cargando los modelos…",
  "Analizando el vídeo frame a frame (detección y seguimiento de jugadores)…",
  "Hay tracks pendientes de revisión manual. Corrígelos en el panel de abajo.",
  "Generando minimapa, estadísticas e informe final…",
  "Codificando los vídeos generados a H.264 para que se puedan reproducir en el navegador…",
  "Análisis completado. Ya puedes consultar los resultados."
];

let correctionIsActive = false;
let currentPipelineStage = 0;

// El backend (server.py) recodifica a H.264 los .mp4 que lo necesiten
// justo después de imprimir "✅ Análisis completado con éxito." y ANTES
// de marcar is_running=false (ver fix_output_videos() en server.py). Por
// eso ese mensaje por sí solo no significa que todo haya terminado: hay
// que esperar a que el backend confirme que ya no está en ejecución.
const RE_ANALYSIS_DONE = /✅ Análisis completado con éxito/;
const RE_ENCODING_START = /🎞️ Recodificando (.+?) para el navegador…/g;
const RE_ENCODING_DONE = /✅ (.+?) recodificado a H\.264\./g;

function detectPipelineStage(logs, running){
  const text = (logs || []).join("\n");
  if(RE_ANALYSIS_DONE.test(text)){
    // El proceso principal terminó bien; mientras el backend siga
    // "is_running", está en la fase de recodificar vídeos a H.264.
    return running ? 5 : 6;
  }
  const reportingMarkers = [
    /=== Final roles summary/, /=== Minimap summary/, /=== Speed & distance/,
    /=== Player performance/, /=== Heatmaps/, /=== Team tactical analysis/,
    /=== Ball possession — field/, /=== Match report/
  ];
  if(reportingMarkers.some(r => r.test(text))) return 4;
  if(correctionIsActive || /=== Manual review \+ names/.test(text) || /track\(s\) need manual review/.test(text)) return 3;
  const analyzingMarkers = [
    /=== Detection summary/, /=== Tracking summary/, /=== Track stitching/,
    /=== ID-swap correction/, /=== Manual ID-switch swaps/, /=== Role refinement summary/
  ];
  if(analyzingMarkers.some(r => r.test(text))) return 2;
  return 1;
}

function encodingStageMessage(logs){
  // Mensaje dinámico para la fase de recodificación a H.264: muestra
  // cuántos vídeos llevamos y, si se conoce, cuál se está procesando.
  const text = (logs || []).join("\n");
  const started = [...text.matchAll(RE_ENCODING_START)].map(m => m[1]);
  if(started.length === 0) return STAGE_MESSAGES[5];

  const done = new Set([...text.matchAll(RE_ENCODING_DONE)].map(m => m[1]));
  const current = started[started.length - 1];
  const doneCount = started.filter(name => done.has(name)).length;

  if(!done.has(current)){
    return `Codificando vídeo ${doneCount + 1}/${started.length} a H.264: ${current}…`;
  }
  return `Codificación a H.264 completada (${doneCount}/${started.length} vídeo${started.length === 1 ? '' : 's'}). Finalizando…`;
}

function updatePipelineFromLogs(logs, running){
  const text = (logs || []).join("\n");
  const isError = /❌ Error en la ejecución|❌ Excepción en ejecución/.test(text);

  if(!running && !correctionIsActive){
    if(RE_ANALYSIS_DONE.test(text)){
      renderPipelineStage(6, false, STAGE_MESSAGES[6]);
      return;
    }
    if(isError){
      const stage = Math.max(1, detectPipelineStage(logs, running));
      renderPipelineStage(stage, true, "❌ Ha ocurrido un error durante la ejecución. Consulta la terminal para más detalles.");
      return;
    }
  }

  const stage = detectPipelineStage(logs, running);
  const message = stage === 5 ? encodingStageMessage(logs) : (STAGE_MESSAGES[stage] || "");
  renderPipelineStage(stage, false, message);
}

function renderPipelineStage(stage, isError, message){
  currentPipelineStage = stage;
  const wrap = document.getElementById("pipeline-stepper");
  if(wrap){
    wrap.innerHTML = PIPELINE_STAGES.map((label, i) => {
      let cls = "p-step";
      // El último paso (Completado) es terminal: cuando se alcanza
      // sin error se marca como hecho (con tick), no como "activo".
      const isFinalDone = !isError && stage === PIPELINE_STAGES.length - 1;
      if(isError && i === stage) cls += " error";
      else if(i < stage || (isFinalDone && i === stage)) cls += " done";
      else if(i === stage) cls += " active";
      const dotContent = (cls.includes("done"))
          ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
          : (i + 1);
      return `
              <div class="${cls}">
                <div class="p-step-line"></div>
                <div class="p-step-dot">${dotContent}</div>
                <div class="p-step-label">${label}</div>
              </div>`;
    }).join('');
  }

  const msgBox = document.getElementById("pipeline-current-msg");
  const msgText = document.getElementById("pipeline-current-msg-text");
  if(msgBox && msgText){
    msgBox.classList.remove("is-active", "is-error", "is-done");
    if(isError) msgBox.classList.add("is-error");
    else if(stage === 6) msgBox.classList.add("is-done");
    else if(stage > 0) msgBox.classList.add("is-active");
    msgText.textContent = message;
  }
  updatePipelineResultsPanel(!isError && stage === PIPELINE_STAGES.length - 1);
}


/* ============================================================
   RESULTADOS LISTOS: al completar el análisis se muestran accesos
   directos que llevan a cada vista con la jornada ya filtrada.
   ============================================================ */
function analyzedJornadaNum(){
  const v = document.getElementById('input-video');
  return v && v.value ? extractJornada(v.value) : null;
}

function updatePipelineResultsPanel(show){
  const box = document.getElementById('pipeline-results');
  if(!box) return;
  const wasVisible = box.classList.contains('is-visible');
  box.classList.toggle('is-visible', !!show);
  if(show){
    const n = analyzedJornadaNum();
    document.getElementById('pipeline-results-title').textContent =
        n !== null ? `Resultados de ${deLaJornada(n, true)} listos` : 'Resultados listos';
    if(!wasVisible) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function goToResults(target){
  const n = analyzedJornadaNum();
  const value = n !== null ? String(n) : 'all';
  const preset = (populateFn, selectId) => {
    populateFn();
    const sel = document.getElementById(selectId);
    if(sel) sel.value = value;
  };
  if(target === 'heatmaps'){
    preset(populateJornadaFilter, 'jornada-filter');
    const type = document.getElementById('heatmap-type-filter');
    if(type) type.value = 'all';
    setHeatmapMediaView('all');
    switchTab('tab-heatmaps');
  } else if(target === 'tactical'){
    preset(populateTacticalJornadaFilter, 'tactical-jornada-filter');
    switchTab('tab-tactical');
  } else if(target === 'detections'){
    preset(populateDetectionJornadaFilter, 'detection-jornada-filter');
    switchTab('tab-detections');
  } else if(target === 'jornada'){
    switchTab('tab-jornadas');
    if(n !== null) openJornada(n);
  }
}

function toggleTerminal(){
  const wrap = document.getElementById("terminal-wrap");
  const btn = document.getElementById("terminal-toggle-btn");
  const collapsed = wrap.classList.toggle("collapsed");
  btn.textContent = collapsed ? "Ver terminal" : "Ocultar terminal";
  if(!collapsed){
    const term = document.getElementById("terminal");
    term.scrollTop = term.scrollHeight;
  }
}

/* ============================================================
   CORRECCIÓN MANUAL DE ROLES (sustituye a la ventana Tkinter)
   ============================================================ */
const ROLE_LABEL_ES = {
  player: "Jugador", goalkeeper: "Portero", referee: "Árbitro",
  ball: "Balón", unknown: "Desconocido", ignore: "Ignorar (mantener rol automático)"
};
const ROLE_CHOICES = ["player", "goalkeeper", "referee", "ball", "unknown", "ignore"];

let correctionState = null;
let correctionLoaded = false;
let correctionFrameSize = null;

async function pollCorrectionReview(){
  try{
    const res = await fetch(`${API_BASE}/api/correction/review`);
    if(!res.ok) return;
    const data = await res.json();
    const panel = document.getElementById("correction-panel");
    correctionIsActive = !!data.active;
    if(data.active){
      panel.classList.add("is-active");
      if(!correctionLoaded || !correctionState || correctionState.stem !== data.stem){
        correctionState = data;
        correctionLoaded = true;
        renderCorrectionPanel(data);
        appendLog(`[INFO] Revisión manual pendiente: ${data.n_candidates} track(s). Consulta el panel "Corrección manual" más abajo.`, "info");
      }
    } else if(correctionLoaded) {
      appendLog("[OK] Revisión manual finalizada.", "info");
      panel.classList.remove("is-active");
      correctionState = null;
      correctionLoaded = false;
    }
  } catch(e){
    // sin revisión activa / backend no disponible todavía: silencioso
  }
}

function correctionImgUrl(path){
  return `${API_BASE}/api/correction/image?path=${encodeURIComponent(path)}`;
}

function renderCorrectionPanel(data){
  document.getElementById("correction-banner-title").innerText =
      `${data.n_candidates} track(s) pendientes de revisar`;
  correctionFrameSize = (Array.isArray(data.frame_size) && data.frame_size.length === 2)
      ? data.frame_size : null;
  renderCorrectionTeamLegend(data.team_legend || {});
  renderCorrectionTeamNames(data.team_legend || {}, data.team_names || {});
  renderCorrectionSummary(data.summary || {});
  buildCorrectionCards(data.candidates || [], data.team_legend || {});
  renderCorrectionCandidates();
}

// Deja que el usuario escriba, durante la propia corrección manual, qué
// equipo real es "Equipo 0" y cuál es "Equipo 1" (ya se ven sus colores
// en el chip de arriba). Una vez guardado, la vista de Análisis táctico
// usa estos nombres automáticamente en vez de asumir Real Jaén CF + rival
// con un botón para intercambiar.
// Lista de equipos para el desplegable de nombres: los rivales de toda la
// temporada (JORNADAS_DATA) + el propio Real Jaén, sin duplicados. Se
// pinta con un menú propio (en vez de un <datalist> nativo, cuyo estilo
// no se puede tocar con CSS) para que combine con el resto de la webapp;
// si algún clip es de un equipo que no está en el calendario se puede
// seguir escribiendo el nombre a mano.
// Igual que el combo de nombre de equipo, pero para el nombre del jugador
// dentro de la corrección manual: en vez de tener que escribir el nombre
// entero a mano, se ofrece la plantilla como desplegable a medida que se
// escribe. Los nombres se leen directamente de las tarjetas de la
// plantilla (data-name), así que si se añade/quita un jugador ahí, el
// desplegable se actualiza solo.
function squadPlayerNamesList(){
  const seen = new Set();
  const players = [];
  document.querySelectorAll('.player-card[data-name]').forEach(c => {
    const name = c.dataset.name;
    if(!name || seen.has(name)) return;
    seen.add(name);
    players.push({ name, number: c.dataset.number || '' });
  });
  return players.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function renderPlayerNameMenu(tid, filterText){
  const menu = document.getElementById(`player-name-menu-${tid}`);
  if(!menu) return;
  const q = (filterText || "").trim().toLowerCase();
  const all = squadPlayerNamesList();
  const filtered = q
      ? all.filter(p => p.name.toLowerCase().includes(q) || p.number.toLowerCase() === q)
      : all;
  menu.innerHTML = filtered.length
      ? filtered.map(p => `
            <div class="team-name-option" data-tid="${tid}" data-value="${escapeHtml(p.name)}"
                 onmousedown="event.preventDefault(); selectPlayerNameOption(this)">${escapeHtml(p.name)}${p.number ? ` <span class="player-name-option-num">#${escapeHtml(p.number)}</span>` : ''}</div>
          `).join("")
      : `<div class="team-name-option-empty">Sin coincidencias — se guardará el nombre escrito</div>`;
}

function openPlayerNameMenu(tid){
  const input = document.getElementById(`corr-name-${tid}`);
  renderPlayerNameMenu(tid, input ? input.value : "");
  const menu = document.getElementById(`player-name-menu-${tid}`);
  if(menu) menu.classList.add("is-open");
}

function closePlayerNameMenu(tid){
  const menu = document.getElementById(`player-name-menu-${tid}`);
  if(menu) menu.classList.remove("is-open");
}

function filterPlayerNameOptions(tid){
  const input = document.getElementById(`corr-name-${tid}`);
  renderPlayerNameMenu(tid, input ? input.value : "");
  openPlayerNameMenu(tid);
}

function selectPlayerNameOption(el){
  const tid = el.dataset.tid;
  const input = document.getElementById(`corr-name-${tid}`);
  if(input){ input.value = el.dataset.value; input.focus(); }
  closePlayerNameMenu(tid);
}

function teamNameOptionsList(){
  const names = new Set(["Real Jaén CF"]);
  JORNADAS_DATA.forEach(j => { if(j.rival) names.add(j.rival); });
  return Array.from(names).sort((a, b) => a.localeCompare(b, "es"));
}

function renderTeamNameMenu(tid, filterText){
  const menu = document.getElementById(`team-name-menu-${tid}`);
  if(!menu) return;
  const q = (filterText || "").trim().toLowerCase();
  const all = teamNameOptionsList();
  const filtered = q ? all.filter(n => n.toLowerCase().includes(q)) : all;
  menu.innerHTML = filtered.length
      ? filtered.map(n => `
            <div class="team-name-option" data-tid="${tid}" data-value="${escapeHtml(n)}"
                 onmousedown="event.preventDefault(); selectTeamNameOption(this)">${escapeHtml(n)}</div>
          `).join("")
      : `<div class="team-name-option-empty">Sin coincidencias — se guardará el nombre escrito</div>`;
}

function openTeamNameMenu(tid){
  const input = document.getElementById(`team-name-${tid}`);
  renderTeamNameMenu(tid, input ? input.value : "");
  const menu = document.getElementById(`team-name-menu-${tid}`);
  if(menu) menu.classList.add("is-open");
}

function closeTeamNameMenu(tid){
  const menu = document.getElementById(`team-name-menu-${tid}`);
  if(menu) menu.classList.remove("is-open");
}

function filterTeamNameOptions(tid){
  const input = document.getElementById(`team-name-${tid}`);
  renderTeamNameMenu(tid, input ? input.value : "");
  openTeamNameMenu(tid);
}

function selectTeamNameOption(el){
  const tid = el.dataset.tid;
  const input = document.getElementById(`team-name-${tid}`);
  if(input){ input.value = el.dataset.value; input.focus(); }
  closeTeamNameMenu(tid);
}

function renderCorrectionTeamNames(legend, teamNames){
  const box = document.getElementById("correction-team-names");
  const teamIds = ["0", "1"];
  box.innerHTML = `
        <div class="team-names-hint">¿Qué equipo es cada uno? Se usará automáticamente en "Análisis táctico".</div>
        ${teamIds.map(tid => {
    const info = legend[tid];
    const rgb = (info && info.color_rgb && info.color_rgb.length === 3) ? info.color_rgb.join(",") : "150,150,150";
    const colorLabel = info && info.label ? ` — ${escapeHtml(info.label)}` : "";
    return `
                <div class="team-name-field">
                    <span class="team-name-label">
                        <span class="team-legend-swatch" style="background: rgb(${rgb})"></span>
                        Equipo ${tid}${colorLabel}
                    </span>
                    <div class="team-name-combo">
                        <input type="text" id="team-name-${tid}" autocomplete="off"
                               placeholder="Elige o escribe un equipo"
                               value="${escapeHtml(teamNames[tid] || '')}"
                               onfocus="openTeamNameMenu('${tid}')"
                               oninput="filterTeamNameOptions('${tid}')"
                               onblur="closeTeamNameMenu('${tid}')"
                               onkeydown="if(event.key==='Escape') this.blur();">
                        <span class="team-name-caret">▾</span>
                        <div class="team-name-menu" id="team-name-menu-${tid}"></div>
                    </div>
                </div>`;
  }).join("")}
        <button class="btn-save-team-names" onclick="saveCorrectionTeamNames()">Guardar nombres de equipo</button>
        <span class="team-names-status" id="team-names-status"></span>
    `;
}

async function saveCorrectionTeamNames(){
  const status = document.getElementById("team-names-status");
  const names = {};
  ["0", "1"].forEach(tid => {
    const input = document.getElementById(`team-name-${tid}`);
    if(input && input.value.trim()) names[tid] = input.value.trim();
  });
  status.textContent = "Guardando…";
  status.className = "team-names-status";
  status.title = "";
  try {
    const res = await fetch(`${API_BASE}/api/correction/team-names`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names })
    });
    if(!res.ok){
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if(body && body.detail) detail = body.detail;
      } catch(parseErr){ /* la respuesta no era JSON, nos quedamos con el HTTP status */ }
      throw new Error(detail);
    }
    status.textContent = "Guardado ✓";
    status.className = "team-names-status is-saved";
  } catch(e) {
    console.error("Error guardando nombres de equipo:", e);
    const msg = (e.message || String(e));
    status.textContent = "Error: " + (msg.length > 70 ? msg.slice(0, 70) + "…" : msg);
    status.title = msg;
    status.className = "team-names-status is-error";
  }
}

function renderCorrectionTeamLegend(legend){
  const el = document.getElementById("correction-team-legend");
  const teams = Object.values(legend);
  if(!teams.length){ el.innerHTML = ""; return; }
  el.innerHTML = teams.map(t => {
    const rgb = (t.color_rgb && t.color_rgb.length === 3) ? t.color_rgb.join(",") : "150,150,150";
    return `<span class="team-legend-chip">
            <span class="team-legend-swatch" style="background: rgb(${rgb})"></span>
            Equipo ${t.team_id} — ${escapeHtml(t.label || "sin etiqueta")}
        </span>`;
  }).join("");
}

function renderCorrectionSummary(summary){
  const el = document.getElementById("correction-summary");
  const total = summary.total ?? 0;
  const corrected = summary.corrected ?? 0;
  el.innerHTML = `
        <span class="correction-pill ${corrected===total && total>0 ? 'done':''}">${corrected}/${total} corregidos</span>
        <span class="correction-pill">${summary.players||0} jugadores</span>
        <span class="correction-pill">${summary.referees||0} árbitros</span>
        <span class="correction-pill">${summary.goalkeepers||0} porteros</span>
        <span class="correction-pill">${summary.id_switches||0} cambios de ID</span>
    `;
}

function teamOptionsHtml(legend, selected){
  let opts = `<option value="" ${selected==null?'selected':''}>Sin equipo / no aplica</option>`;
  [0,1].forEach(team=>{
    const info = legend[String(team)];
    const label = info && info.label ? ` — ${info.label}` : "";
    const sel = (selected!=null && Number(selected)===team) ? "selected" : "";
    opts += `<option value="${team}" ${sel}>Equipo ${team}${escapeHtml(label)}</option>`;
  });
  return opts;
}

function buildCorrectionCards(candidates, legend){
  const grid = document.getElementById("correction-grid");
  grid.innerHTML = "";
  candidates.forEach(cand => {
    const card = buildCorrectionCard(cand, legend);
    grid.appendChild(card);
  });
}

function buildCorrectionCard(cand, legend){
  const tid = cand.track_id;
  const corr = cand.correction;
  const role = corr ? corr.role : cand.current_role;
  const teamId = corr ? corr.team_id : cand.team_id;

  const card = document.createElement("div");
  card.className = "correction-card" + (corr ? " is-saved" : "");
  card.id = `corr-card-${tid}`;
  card.dataset.uncorrected = corr ? "0" : "1";
  card.dataset.unknown = cand.current_role === "unknown" ? "1" : "0";
  card.dataset.lowconf = (cand.role_confidence < 0.65) ? "1" : "0";
  card.dataset.idswitch = (corr && corr.id_switch) ? "1" : "0";

  const thumbs = (cand.crop_paths||[]).map((p,i) => {
    const bbox = (cand.bboxes||[])[i] || [];
    return `<img src="${correctionImgUrl(p)}" data-frame="${escapeHtml((cand.frame_paths||[])[i]||'')}"
             data-bbox="${bbox.join(',')}"
             class="${i===0?'is-selected':''}" loading="lazy"
             onclick="selectCorrectionFrame(${tid}, this)" onerror="this.style.display='none'">`;
  }).join("");

  const framePaths = cand.frame_paths || [];
  let firstFrameIdx = -1;
  for (let i = 0; i < framePaths.length; i++) {
    if (framePaths[i]) { firstFrameIdx = i; break; }
  }
  const firstFrame = firstFrameIdx >= 0 ? framePaths[firstFrameIdx] : "";
  const firstBbox = firstFrameIdx >= 0 ? ((cand.bboxes||[])[firstFrameIdx] || []) : [];
  const aspectRatio = correctionFrameSize ? `${correctionFrameSize[0]} / ${correctionFrameSize[1]}` : "16 / 9";

  card.innerHTML = `
        <div class="correction-card-head">
            <span class="role-badge role-${escapeHtml(cand.current_role)}">${escapeHtml(ROLE_LABEL_ES[cand.current_role]||cand.current_role)}</span>
            <span class="track-id">ID ${tid}</span>
        </div>
        <div class="correction-meta">
            Confianza automática: ${Math.round((cand.role_confidence||0)*100)}% · ${cand.track_length||0} frames
            ${cand.role_reason ? ` · ${escapeHtml(cand.role_reason)}` : ""}
        </div>
        <div class="correction-thumbs">${thumbs}</div>
        <div class="correction-frame-preview" id="corr-frame-preview-${tid}" style="${firstFrame?'':'display:none'}">
            <div class="correction-frame-inner" style="aspect-ratio: ${aspectRatio};">
                <img id="corr-frame-${tid}" src="${firstFrame?correctionImgUrl(firstFrame):''}" onerror="document.getElementById('corr-frame-preview-${tid}').style.display='none'">
                <div class="correction-bbox" id="corr-bbox-${tid}"></div>
            </div>
        </div>
        <div class="correction-fields">
            <div class="field">
                <label>Rol</label>
                <select id="corr-role-${tid}" onchange="onCorrectionRoleChange(${tid})">
                    ${ROLE_CHOICES.map(r=>`<option value="${r}" ${r===role?'selected':''}>${ROLE_LABEL_ES[r]}</option>`).join("")}
                </select>
            </div>
            <div class="field" id="corr-team-wrap-${tid}" style="${role==='player'?'':'display:none'}">
                <label>Equipo</label>
                <select id="corr-team-${tid}">${teamOptionsHtml(legend, teamId)}</select>
            </div>
            <div class="field span-2">
                <label>Nombre del jugador (opcional)</label>
                <div class="team-name-combo">
                    <input type="text" id="corr-name-${tid}" autocomplete="off"
                           value="${escapeHtml((corr && corr.player_name) || '')}"
                           placeholder="Ej. Pérez"
                           onfocus="openPlayerNameMenu(${tid})"
                           oninput="filterPlayerNameOptions(${tid})"
                           onblur="closePlayerNameMenu(${tid})"
                           onkeydown="if(event.key==='Escape') this.blur();">
                    <span class="team-name-caret">▾</span>
                    <div class="team-name-menu" id="player-name-menu-${tid}"></div>
                </div>
            </div>
        </div>
        <details class="correction-advanced">
            <summary>Cambio de identidad (ID switch)</summary>
            <div class="correction-advanced-body">
                <div class="checkbox-row">
                    <input type="checkbox" id="corr-idswitch-${tid}" ${corr && corr.id_switch ? 'checked':''}>
                    <label for="corr-idswitch-${tid}">Este track mezcla dos personas distintas</label>
                </div>
                <div class="field">
                    <label>Continúa como ID</label>
                    <input type="number" id="corr-merge-${tid}" value="${(corr && corr.merge_with_track_id!=null)?corr.merge_with_track_id:''}">
                </div>
                <div class="field">
                    <label>Frame del cambio</label>
                    <input type="number" id="corr-frame-num-${tid}" value="${(corr && corr.switch_frame!=null)?corr.switch_frame:''}">
                </div>
                <div class="field span-2">
                    <label>Nota</label>
                    <input type="text" id="corr-note-${tid}" value="${escapeHtml((corr && corr.switch_note) || '')}">
                </div>
            </div>
        </details>
        <button class="btn-save-correction ${corr?'is-saved':''}" id="corr-save-${tid}" onclick="saveCorrectionCard(${tid})">
            ${corr ? 'Guardado ✓ (pulsa para actualizar)' : 'Guardar'}
        </button>
    `;
  applyBboxStyle(card.querySelector(`#corr-bbox-${tid}`), firstBbox.length === 4 ? firstBbox : null);
  return card;
}

function applyBboxStyle(boxEl, bboxArr){
  if(!boxEl) return;
  if(!bboxArr || bboxArr.length !== 4 || !correctionFrameSize){
    boxEl.style.display = "none";
    return;
  }
  const [x1, y1, x2, y2] = bboxArr.map(Number);
  const [fw, fh] = correctionFrameSize;
  if(!fw || !fh || [x1,y1,x2,y2].some(Number.isNaN)){
    boxEl.style.display = "none";
    return;
  }
  boxEl.style.display = "block";
  boxEl.style.left = (x1/fw*100) + "%";
  boxEl.style.top = (y1/fh*100) + "%";
  boxEl.style.width = (Math.max(x2-x1, 0)/fw*100) + "%";
  boxEl.style.height = (Math.max(y2-y1, 0)/fh*100) + "%";
}

function onCorrectionRoleChange(tid){
  const role = document.getElementById(`corr-role-${tid}`).value;
  document.getElementById(`corr-team-wrap-${tid}`).style.display = role==='player' ? '' : 'none';
}

function selectCorrectionFrame(tid, imgEl){
  const card = imgEl.closest(".correction-card");
  card.querySelectorAll(".correction-thumbs img").forEach(i=>i.classList.remove("is-selected"));
  imgEl.classList.add("is-selected");
  const framePath = imgEl.dataset.frame;
  const previewWrap = document.getElementById(`corr-frame-preview-${tid}`);
  const preview = document.getElementById(`corr-frame-${tid}`);
  const bboxArr = (imgEl.dataset.bbox || "").split(",").filter(s => s !== "").map(Number);
  if(framePath){
    preview.src = correctionImgUrl(framePath);
    previewWrap.style.display = "";
    applyBboxStyle(document.getElementById(`corr-bbox-${tid}`), bboxArr.length === 4 ? bboxArr : null);
  } else {
    applyBboxStyle(document.getElementById(`corr-bbox-${tid}`), null);
  }
}

async function saveCorrectionCard(tid){
  const btn = document.getElementById(`corr-save-${tid}`);
  const role = document.getElementById(`corr-role-${tid}`).value;
  const teamSel = document.getElementById(`corr-team-${tid}`);
  const teamVal = teamSel ? teamSel.value : "";
  const mergeVal = document.getElementById(`corr-merge-${tid}`).value;
  const frameVal = document.getElementById(`corr-frame-num-${tid}`).value;
  const payload = {
    track_id: tid,
    role: role,
    team_id: teamVal === "" ? null : Number(teamVal),
    player_name: document.getElementById(`corr-name-${tid}`).value.trim() || null,
    id_switch: document.getElementById(`corr-idswitch-${tid}`).checked,
    switch_note: document.getElementById(`corr-note-${tid}`).value.trim(),
    merge_with_track_id: mergeVal === "" ? null : Number(mergeVal),
    switch_frame: frameVal === "" ? null : Number(frameVal),
  };
  btn.disabled = true;
  btn.innerText = "Guardando…";
  try{
    const res = await fetch(`${API_BASE}/api/correction/save`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if(res.ok){
      const card = document.getElementById(`corr-card-${tid}`);
      card.classList.add("is-saved");
      card.dataset.uncorrected = "0";
      card.dataset.idswitch = payload.id_switch ? "1" : "0";
      btn.classList.add("is-saved");
      btn.innerText = "Guardado ✓ (pulsa para actualizar)";
      renderCorrectionSummary(data.summary || {});
    } else {
      btn.innerText = "Error al guardar";
      appendLog(`[ERROR] ${data.detail || "No se pudo guardar la corrección"}`, "err");
    }
  } catch(e){
    btn.innerText = "Error de conexión";
  } finally {
    btn.disabled = false;
  }
}

function renderCorrectionCandidates(){
  const mode = document.getElementById("correction-filter").value;
  document.querySelectorAll("#correction-grid .correction-card").forEach(card=>{
    let show = true;
    if(mode==="unknown") show = card.dataset.unknown === "1";
    else if(mode==="low_confidence") show = card.dataset.lowconf === "1";
    else if(mode==="uncorrected") show = card.dataset.uncorrected === "1";
    else if(mode==="id_switch") show = card.dataset.idswitch === "1";
    card.style.display = show ? "" : "none";
  });
}

async function finishCorrectionReview(action){
  const msg = action === "skip"
      ? "¿Omitir la revisión manual? Los tracks sin corregir mantendrán su rol automático."
      : "¿Finalizar la revisión y continuar el análisis con las correcciones guardadas?";
  if(!confirm(msg)) return;
  try{
    const res = await fetch(`${API_BASE}/api/correction/finish?action=${action}`, { method: "POST" });
    const data = await res.json();
    if(res.ok){
      appendLog(`[OK] Revisión manual ${action==='submit'?'finalizada':'omitida'}. El análisis continúa…`, "info");
      document.getElementById("correction-panel").classList.remove("is-active");
      correctionState = null;
      correctionLoaded = false;
    } else {
      appendLog(`[ERROR] ${data.detail}`, "err");
    }
  } catch(e){
    appendLog("[ERROR] No se pudo contactar con el backend para finalizar la revisión.", "err");
  }
}

function escapeHtml(str){
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function isReportHeaderLine(line){
  // Detecta las líneas de cabecera/título de los .txt generados por el
  // pipeline (p. ej. "INFORME DE VELOCIDAD Y DISTANCIA — jornada1_Gol2
  // Siverio" o el separador "========..."). Estas líneas repiten el
  // nombre del archivo/vídeo analizado y por tanto SIEMPRE contienen el
  // nombre de cualquier jugador que dé nombre a ese clip, aunque el
  // análisis no haya detectado ni generado ningún dato real sobre él.
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^=+$/.test(trimmed)) return true;
  if (/^(INFORME|AN[ÁA]LISIS|POSESI[ÓO]N)\b.*—/i.test(trimmed)) return true;
  return false;
}

function parseNarrativeLine(line){
  const valMatch = line.match(/valoraci[oó]n\s*[:\-]?\s*([\d.,]+)\s*\/\s*10/i);
  const impactoMatch = line.match(/impacto\s*[:\-]?\s*(\w+)/i);
  const fatigaMatch = line.match(/fatiga\s*[:\-]?\s*(\w+)/i);
  if(!valMatch && !impactoMatch && !fatigaMatch) return null;

  const descMatch = line.split('|');
  const description = descMatch.length > 1 ? descMatch.slice(1).join('|').trim() : null;

  return {
    type: 'narrative',
    score: valMatch ? valMatch[1].replace(',', '.') : null,
    impacto: impactoMatch ? impactoMatch[1] : null,
    fatiga: fatigaMatch ? fatigaMatch[1] : null,
    description: description
  };
}

function parseMetricsLine(line){
  const parts = line.trim().split(/\s{2,}|\t+/).filter(Boolean);
  const nums = parts.filter(p => /^-?\d+([.,]\d+)?$/.test(p));
  if(nums.length < 2) return null;

  const trackingId = /^\d+$/.test(parts[2]) ? parts[2] : (nums[0] || null);
  const stats = nums.slice(-3).map(n => n.replace(',', '.'));

  return { type: 'metrics', trackingId, stats };
}

function levelClass(level){
  if(!level) return 'tag-level-medio';
  const l = level.toLowerCase();
  if(l.startsWith('alto')) return 'tag-level-alto';
  if(l.startsWith('baj')) return 'tag-level-bajo';
  return 'tag-level-medio';
}

function getDetectionKey(filename){
  // Se ignora la carpeta y la extensión: solo cuenta el nombre del archivo.
  let base = filename.split('/').pop().replace(/\.[^/.]+$/, '');
  const m = base.match(/jornada\D*(\d+).*?gol\D*(\d+)/i);
  if(m) return `jornada${m[1]}_gol${m[2]}`;
  // Se quitan en bucle TODOS los sufijos finales (p. ej. "..._player_analytics"
  // -> "..."), separados por "_", "-" o espacio, para que el informe del clip
  // y el del jugador acaben con la misma clave y se fusionen en una tarjeta.
  const suffix = /[_\s-]+(analytics|final[_-]?report|final|report|metrics|stats|summary|data|tracking|player)$/i;
  let prev;
  do {
    prev = base;
    base = base.replace(suffix, '');
  } while(base !== prev);
  return base.trim();
}

function formatDetectionTitle(key){
  const m = key.match(/^jornada\s*(\d+)[_\s]*gol\s*(\d+)$/i);
  if(m) return `${jornadaLabel(parseInt(m[1], 10))} — Gol ${m[2]}`;
  return key.replace(/_/g, ' ');
}

function groupMatchesByDetection(matches){
  const groups = new Map();
  const order = [];

  matches.forEach(match => {
    const key = getDetectionKey(match.file);
    if(!groups.has(key)){
      groups.set(key, { key, files: new Set(), narrative: null, metrics: null, raws: [] });
      order.push(key);
    }
    const group = groups.get(key);
    group.files.add(match.file);

    const narrative = parseNarrativeLine(match.line);
    if(narrative){
      if(!group.narrative){
        group.narrative = { parsed: narrative, file: match.file, line: match.line };
      } else {
        // Ya había datos narrativos de otra línea para este mismo jugador/detección:
        // combinamos en vez de sobrescribir, para no perder score/impacto/fatiga/descripción
        // cuando vienen repartidos en varias líneas de distintos .txt.
        const prev = group.narrative.parsed;
        if(prev.score === null) prev.score = narrative.score;
        if(prev.impacto === null) prev.impacto = narrative.impacto;
        if(prev.fatiga === null) prev.fatiga = narrative.fatiga;
        if(narrative.description && narrative.description !== prev.description){
          prev.description = prev.description
              ? `${prev.description} ${narrative.description}`
              : narrative.description;
        }
        group.raws.push({ file: match.file, line: match.line });
      }
      return;
    }
    const metrics = parseMetricsLine(match.line);
    if(metrics){
      if(!group.metrics){
        group.metrics = { parsed: metrics, file: match.file, line: match.line };
      } else {
        group.raws.push({ file: match.file, line: match.line });
      }
      return;
    }
    group.raws.push({ file: match.file, line: match.line });
  });

  return order.map(key => groups.get(key));
}

/* ============================================================
   RENDER SPIDER-CHART (RADAR) DEBAJO DEL JUGADOR
   ============================================================ */
function renderPlayerRadarChart(metricsData) {
  const card = document.getElementById('radar-chart-card');
  const ctx = document.getElementById('playerRadarChart');

  if (!ctx) return;
  card.style.display = 'block';

  if (playerRadarInstance) {
    playerRadarInstance.destroy();
  }

  // Normalización a escala (0-100) para el Spider-chart
  const vAvg = metricsData.speedAvg ? Math.min(100, parseFloat(metricsData.speedAvg) * 8) : 65;
  const vMax = metricsData.speedMax ? Math.min(100, parseFloat(metricsData.speedMax) * 2.5) : 80;
  const dist = metricsData.distance ? Math.min(100, parseFloat(metricsData.distance) * 2) : 70;

  let fatigaVal = 60;
  if (metricsData.fatiga) {
    const f = metricsData.fatiga.toLowerCase();
    if (f.startsWith('baj')) fatigaVal = 90;
    else if (f.startsWith('med')) fatigaVal = 65;
    else if (f.startsWith('alt')) fatigaVal = 40;
  }

  let impactoVal = 70;
  if (metricsData.impacto) {
    const imp = metricsData.impacto.toLowerCase();
    if (imp.startsWith('alt')) impactoVal = 95;
    else if (imp.startsWith('med')) impactoVal = 70;
    else if (imp.startsWith('baj')) impactoVal = 45;
  }

  playerRadarInstance = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Vel. Media', 'Vel. Punta', 'Distancia', 'Gestión Fatiga', 'Impacto Juego'],
      datasets: [{
        label: 'Rendimiento en Vídeo',
        data: [vAvg, vMax, dist, fatigaVal, impactoVal],
        backgroundColor: 'rgba(107, 44, 145, 0.22)',
        borderColor: '#6b2c91',
        borderWidth: 2,
        pointBackgroundColor: '#c79a3a',
        pointBorderColor: '#ffffff',
        pointHoverBackgroundColor: '#ffffff',
        pointHoverBorderColor: '#c79a3a',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          angleLines: { color: '#e6e1ef' },
          grid: { color: '#eeeaf5' },
          pointLabels: {
            font: { family: 'Inter', size: 10, weight: '600' },
            color: '#221430'
          },
          ticks: { display: false },
          suggestedMin: 0,
          suggestedMax: 100
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// ============================================================
//  Frases de respaldo para el informe de rendimiento (siempre hay una)
// ============================================================
// - Cada frase depende de las métricas reales (vel. media, distancia,
//   vel. punta, impacto, fatiga, nota), así no dice "Cubrió mucho
//   terreno" con 9 m recorridos.
// - Hay varias variantes por situación y se elige una por "semilla"
//   (la clave de la detección): siempre sale la misma frase para el
//   mismo clip, pero distintos clips tienen frases distintas.
// - Solo se usa si el .txt no trae ninguna frase; nunca se deja vacío.
const PHRASE_CONFIG = { MAX_PARTS: 2 };

const PHRASE_BANK = {
  impactoAlto: [
    "Fue protagonista en la acción y participó de forma decisiva.",
    "Tuvo una influencia clara en el desarrollo de la jugada.",
    "Estuvo muy presente en el juego y marcó la diferencia.",
    "Su intervención condicionó el rumbo de la acción.",
    "Se le vio muy involucrado, siempre cerca del balón."
  ],
  impactoMedio: [
    "Participación constante durante la acción.",
    "Aportó de forma regular sin ser el foco principal.",
    "Estuvo correctamente integrado en la dinámica del equipo.",
    "Su presencia fue estable, sin grandes picos de protagonismo.",
    "Cumplió su función dentro del bloque."
  ],
  impactoBajo: [
    "Tuvo un papel discreto en esta acción.",
    "Intervino poco y desde posiciones secundarias.",
    "Su influencia en la jugada fue limitada.",
    "Estuvo más como apoyo que como protagonista.",
    "Participó de forma puntual."
  ],
  puntaAlta: [
    "Mostró una gran aceleración en el momento clave.",
    "Alcanzó una velocidad punta muy destacada.",
    "Su arrancada fue explosiva.",
    "Dejó un sprint de nivel élite."
  ],
  puntaMedia: [
    "Realizó algún cambio de ritmo apreciable.",
    "Alcanzó una velocidad punta sólida, sin llegar al máximo.",
    "Tuvo buenas progresiones a lo largo de la acción."
  ],
  puntaBaja: [
    "No necesitó acelerar a fondo.",
    "Se movió a un ritmo controlado, sin sprints.",
    "La acción se resolvió sin grandes explosiones de velocidad."
  ],
  distanciaAlta: [
    "Cubrió mucho terreno.",
    "Recorrió una distancia considerable.",
    "Fue un auténtico ida y vuelta."
  ],
  distanciaBaja: [
    "Se movió en un espacio reducido.",
    "Recorrió poca distancia en esta acción.",
    "Actuó sobre todo por posición, sin grandes desplazamientos."
  ],
  ritmoAlto: [
    "Mantuvo un ritmo medio muy elevado.",
    "Imprimió una intensidad alta de principio a fin."
  ],
  ritmoBajo: [
    "Ritmo medio tranquilo, más pausado que dinámico.",
    "Administró esfuerzos con un tempo bajo."
  ],
  fatigaAlta: [
    "La intensidad bajó en las etapas finales.",
    "Se apreciaron señales de cansancio hacia el final.",
    "Su rendimiento decayó conforme avanzaba la acción."
  ],
  fatigaBaja: [
    "Mantuvo el nivel de energía sin bajar el pistón.",
    "Llegó fresco al final de la acción.",
    "No mostró síntomas de desgaste."
  ],
  notaAlta: [
    "Valoración muy positiva de su actuación.",
    "Una de las actuaciones más completas del análisis."
  ],
  notaBaja: [
    "Actuación por debajo de lo esperado.",
    "Margen de mejora claro en esta acción."
  ]
};

function seededRng(seedStr){
  let h = 1779033703 ^ seedStr.length;
  for(let i = 0; i < seedStr.length; i++){
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateFallbackDescription(parsed, metrics, seedKey){
  const rnd = seededRng(String(seedKey || 'x'));

  const lvl = s => (s || '').toLowerCase().slice(0, 3); // alt / med / baj
  const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  const [dist, vAvg, vMax] = metrics ? metrics.stats.map(num) : [null, null, null];
  const score = num(parsed && parsed.score);

  // Cada candidato: [peso, categoría]. Se elige sin repetir categoría.
  const candidates = [];
  const imp = lvl(parsed && parsed.impacto);
  if(imp === 'alt') candidates.push([3, 'impactoAlto']);
  else if(imp === 'med') candidates.push([2, 'impactoMedio']);
  else if(imp === 'baj') candidates.push([2, 'impactoBajo']);

  if(vMax !== null){
    if(vMax >= 32) candidates.push([3, 'puntaAlta']);
    else if(vMax >= 27) candidates.push([1, 'puntaMedia']);
    else candidates.push([2, 'puntaBaja']);
  }
  if(dist !== null){
    if(dist >= 40) candidates.push([2, 'distanciaAlta']);
    else if(dist < 15) candidates.push([2, 'distanciaBaja']);
  }
  if(vAvg !== null){
    if(vAvg >= 18) candidates.push([1, 'ritmoAlto']);
    else if(vAvg < 8) candidates.push([1, 'ritmoBajo']);
  }
  const fat = lvl(parsed && parsed.fatiga);
  if(fat === 'alt') candidates.push([3, 'fatigaAlta']);
  else if(fat === 'baj') candidates.push([1, 'fatigaBaja']);
  if(score !== null){
    if(score >= 8.5) candidates.push([1, 'notaAlta']);
    else if(score <= 4.5) candidates.push([1, 'notaBaja']);
  }

  if(!candidates.length) return "Actuación equilibrada, sin rasgos destacables en esta acción.";

  // Número de frases: 1 o 2 (según la semilla)
  const nParts = Math.min(candidates.length, rnd() < 0.5 ? 1 : PHRASE_CONFIG.MAX_PARTS);
  const parts = [];
  const pool = candidates.slice();
  for(let i = 0; i < nParts && pool.length; i++){
    const total = pool.reduce((s, c) => s + c[0], 0);
    let r = rnd() * total, idx = 0;
    for(; idx < pool.length; idx++){ r -= pool[idx][0]; if(r <= 0) break; }
    idx = Math.min(idx, pool.length - 1);
    const variants = PHRASE_BANK[pool[idx][1]];
    parts.push(variants[Math.floor(rnd() * variants.length)]);
    pool.splice(idx, 1);
  }
  return parts.join(' ');
}

function renderDetectionCard(group){
  const box = document.createElement("div");
  box.className = "result-block";

  let bodyHtml = '';

  if(group.narrative){
    const parsed = group.narrative.parsed;
    let summaryHtml = '';
    if(parsed.score){
      const pct = Math.min(100, (parseFloat(parsed.score) / 10) * 100);
      summaryHtml += `
              <div class="score-badge"><span class="num">${escapeHtml(parsed.score)}</span><span class="den">/10</span></div>`;
    }
    // Si el .txt no trae impacto, se deduce de la nota (misma regla que el backend)
    const impactoShown = parsed.impacto || (parsed.score
        ? (parseFloat(parsed.score) >= 7.5 ? 'Alto' : (parseFloat(parsed.score) >= 5 ? 'Medio' : 'Bajo'))
        : null);
    if(impactoShown){
      summaryHtml += `<span class="tag-pill ${levelClass(impactoShown)}"><span class="dot"></span>Impacto ${escapeHtml(impactoShown)}</span>`;
    }
    if(parsed.fatiga){
      summaryHtml += `<span class="tag-pill ${levelClass(parsed.fatiga)}"><span class="dot"></span>Fatiga ${escapeHtml(parsed.fatiga)}</span>`;
    }
    if(summaryHtml) bodyHtml += `<div class="report-summary">${summaryHtml}</div>`;
    if(parsed.description) bodyHtml += `<p class="report-description">${escapeHtml(parsed.description)}</p>`;
  }

  // Siempre debe haber una frase: si el .txt no la trae, se genera a partir de las métricas.
  if(!(group.narrative && group.narrative.parsed.description)){
    const np = group.narrative ? group.narrative.parsed : null;
    const mp = group.metrics ? group.metrics.parsed : null;
    const seed = `${group.key}:${mp ? mp.stats.join(',') : ''}:${np && np.score ? np.score : ''}`;
    const fallbackText = generateFallbackDescription(
        np ? Object.assign({}, np, { impacto: np.impacto || (np.score ? (parseFloat(np.score) >= 7.5 ? 'Alto' : (parseFloat(np.score) >= 5 ? 'Medio' : 'Bajo')) : null) }) : null,
        mp, seed);
    bodyHtml += `<p class="report-description">${escapeHtml(fallbackText)}</p>`;
  }

  if(group.metrics){
    const parsed = group.metrics.parsed;
    const tiles = parsed.stats.map((val, i) => {
      const meta = ANALYTICS_LABELS[i] || { label: `Valor ${i+1}`, unit: '' };
      return `
              <div class="stat-tile">
                <div class="value">${escapeHtml(val)}${meta.unit ? `<span class="unit">${meta.unit}</span>` : ''}</div>
                <div class="label">${meta.label}</div>
              </div>`;
    }).join('');

    bodyHtml += `
            <div class="stat-strip">${tiles}</div>`;
  }

  const sourceFiles = Array.from(group.files);
  const primaryFile = sourceFiles[0] || group.key;
  const jornadaNum = extractJornada(primaryFile);
  const goalInfo = extractGoalInfo(primaryFile);
  const detectionTitle = (jornadaNum && goalInfo)
      ? `${jornadaLabel(jornadaNum)} | Gol ${goalInfo.gol}${goalInfo.player ? ' ' + goalInfo.player : ''}`
      : formatDetectionTitle(group.key);

  box.innerHTML = `
        <div class="result-source">${escapeHtml(detectionTitle)}</div>
        ${bodyHtml}
    `;
  return box;
}

function showSquadList(){
  document.getElementById('player-detail-view').style.display = 'none';
  document.getElementById('squad-list-view').style.display = 'block';
  document.querySelectorAll('.player-card').forEach(c => c.classList.remove('active'));
}

let squadFlatBuilt = false;
let currentSquadView = 'position';

function buildFlatSquad(){
  if(squadFlatBuilt) return;
  const grid = document.getElementById('squad-flat-grid');
  const cards = Array.from(document.querySelectorAll('#squad-grouped .player-card'));

  cards
      .map(c => ({ el: c.cloneNode(true), number: parseInt(c.dataset.number, 10) || 0 }))
      .sort((a, b) => a.number - b.number)
      .forEach(({ el }) => grid.appendChild(el));

  squadFlatBuilt = true;
}

function setSquadView(view){
  currentSquadView = view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));

  if(view === 'dorsal'){
    buildFlatSquad();
    document.getElementById('squad-grouped').style.display = 'none';
    document.getElementById('squad-flat').style.display = 'block';
  } else {
    document.getElementById('squad-grouped').style.display = 'block';
    document.getElementById('squad-flat').style.display = 'none';
  }
  applySquadFilter();
}

function applySquadFilter(){
  const filter = document.getElementById('position-filter').value;

  if(currentSquadView === 'position'){
    document.querySelectorAll('#squad-grouped .position-block').forEach(block => {
      const match = filter === 'all' || block.dataset.positionGroup === filter;
      block.style.display = match ? '' : 'none';
    });
  } else {
    document.querySelectorAll('#squad-flat .player-card').forEach(card => {
      const match = filter === 'all' || card.dataset.position === filter;
      card.style.display = match ? '' : 'none';
    });
  }
}

// Detecciones del jugador actualmente abierto (sin filtrar), para poder
// aplicar los filtros de jornada/impacto/búsqueda sin volver a pedir los datos.
let currentPlayerDetections = [];

// NAVEGA A LA FICHA DEL JUGADOR Y BUSCA SUS DATOS EN LOS .TXT
async function selectPlayer(playerName, number, position, cardElement, searchName) {
  // searchName permite forzar un término de búsqueda distinto al nombre mostrado
  // (por ejemplo, "Keita" para "Moha Keita", para no confundirlo con el jugador "Moha").
  const searchTerm = (searchName || playerName).toLowerCase();
  document.getElementById('squad-list-view').style.display = 'none';
  document.getElementById('player-detail-view').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const photoHtml = cardElement.querySelector('.player-photo').innerHTML;
  document.getElementById('player-profile-photo').innerHTML = photoHtml;
  document.getElementById('player-profile-info').innerHTML = `
        <div class="hero-name">${escapeHtml(playerName)}</div>
        <div class="hero-meta">
          <span class="meta-badge number">#${escapeHtml(number)}</span>
          <span class="meta-badge position">${escapeHtml(position)}</span>
        </div>`;

  const container = document.getElementById("player-data-container");
  container.innerHTML = '<div class="placeholder-box">Buscando datos del jugador…</div>';
  currentPlayerDetections = [];
  hidePlayerReportFilterBar();

  try {
    const res = await fetch(`${API_BASE}/api/results`);
    const data = await res.json();

    if (!data.files || data.files.length === 0) {
      container.innerHTML = '<div class="placeholder-box" style="color:#d1453b;">No se encontraron datos para este jugador.</div>';
      document.getElementById('radar-chart-card').style.display = 'none';
      return;
    }

    const txtFiles = data.files.filter(f => f.endsWith('.txt'));

    if (txtFiles.length === 0) {
      container.innerHTML = '<div class="placeholder-box">No se encontraron datos disponibles.</div>';
      document.getElementById('radar-chart-card').style.display = 'none';
      return;
    }

    let matchesFound = [];

    const fileContents = await Promise.all(
        txtFiles.map(file =>
            fetch(`${API_BASE}/outputs/${file}`)
                .then(res => res.text())
                .then(text => ({ file, text }))
        )
    );

    fileContents.forEach(({ file, text }) => {
      const lines = text.split('\n');
      const matchingLines = lines.filter(line => {
        const l = line.toLowerCase();
        const matchesTerm =
            l.includes(searchTerm) ||
            l.includes(`player_${number}`) ||
            l.includes(`dorsal ${number}`) ||
            l.includes(`id ${number}`);
        if (!matchesTerm) return false;

        // Descartamos la línea de cabecera de cada informe, p. ej.
        // "INFORME DE VELOCIDAD Y DISTANCIA — jornada1_Gol2 Siverio".
        // Esa línea SIEMPRE contiene el nombre del jugador porque
        // repite el nombre del archivo/vídeo analizado, no porque el
        // análisis lo haya detectado e identificado de verdad dentro
        // del contenido. Si la contáramos como coincidencia, todo
        // jugador cuyo nombre esté en el nombre del vídeo aparecería
        // como "detectado", aunque el tracking no lo haya reconocido
        // ni haya generado ningún dato real sobre él.
        if (isReportHeaderLine(line)) return false;

        return true;
      });

      matchingLines.forEach(line => matchesFound.push({ file, line }));
    });

    if (matchesFound.length > 0) {
      const detections = groupMatchesByDetection(matchesFound);

      // Etiquetamos cada detección con su número de jornada (a partir de la
      // clave "jornadaN_golM" o, si no está disponible, del nombre de fichero)
      // para poder filtrar el informe por jornada concreta.
      detections.forEach(group => {
        group.jornada = extractJornada(group.key);
        if (group.jornada === null) {
          for (const f of group.files) {
            const j = extractJornada(f);
            if (j !== null) { group.jornada = j; break; }
          }
        }
      });

      // Extraemos métricas del primer resultado para pintar el Spider-chart
      const firstGroup = detections[0];
      const metricsObj = {
        distance: firstGroup && firstGroup.metrics ? firstGroup.metrics.parsed.stats[0] : null,
        speedAvg: firstGroup && firstGroup.metrics ? firstGroup.metrics.parsed.stats[1] : null,
        speedMax: firstGroup && firstGroup.metrics ? firstGroup.metrics.parsed.stats[2] : null,
        fatiga: firstGroup && firstGroup.narrative ? firstGroup.narrative.parsed.fatiga : null,
        impacto: firstGroup && firstGroup.narrative ? firstGroup.narrative.parsed.impacto : null
      };

      // Renderiza el gráfico Radar en la tarjeta izquierda del jugador
      renderPlayerRadarChart(metricsObj);

      currentPlayerDetections = detections;
      populatePlayerJornadaFilter();
      showPlayerReportFilterBar();
      clearPlayerReportFilters(); // reinicia filtros y pinta todas las tarjetas
    } else {
      container.innerHTML = `
                    <div class="placeholder-box">
                        No se encontraron datos para <strong>${escapeHtml(playerName)}</strong> (dorsal #${escapeHtml(number)}) tras analizar los videos.
                    </div>
                `;
      document.getElementById('radar-chart-card').style.display = 'none';
    }

  } catch (e) {
    console.error("Error al buscar información", e);
    container.innerHTML = '<div class="placeholder-box" style="color:#d1453b;">Error al consultar los informes.</div>';
    document.getElementById('radar-chart-card').style.display = 'none';
  }
}

/* ============================================================
   FILTROS DEL INFORME DE RENDIMIENTO DEL JUGADOR
   (jornada concreta, nivel de impacto, búsqueda de texto libre
   y ordenación por jornada o por nota)
   ============================================================ */
function populatePlayerJornadaFilter(){
  const sel = document.getElementById('player-jornada-filter');
  if(!sel || sel.dataset.populated) return;
  fillJornadaSelect(sel);
}

function showPlayerReportFilterBar(){
  const bar = document.getElementById('player-report-filter-bar');
  if (bar) bar.style.display = 'flex';
}

function hidePlayerReportFilterBar(){
  const bar = document.getElementById('player-report-filter-bar');
  if (bar) bar.style.display = 'none';
  const countEl = document.getElementById('player-report-count');
  if (countEl) countEl.textContent = '';
}

function clearPlayerReportFilters(){
  const jornadaSel = document.getElementById('player-jornada-filter');
  const sortSel = document.getElementById('player-report-sort');
  if (jornadaSel) jornadaSel.value = 'all';
  if (sortSel) sortSel.value = 'score-desc';
  applyPlayerReportFilters();
}

function applyPlayerReportFilters(){
  const jornadaSel = document.getElementById('player-jornada-filter');
  if (!jornadaSel) return;

  const jornadaVal = jornadaSel.value;
  const sortVal = document.getElementById('player-report-sort').value;

  let list = currentPlayerDetections.slice();

  if (jornadaVal !== 'all') {
    const n = parseInt(jornadaVal, 10);
    list = list.filter(g => g.jornada === n);
  }

  list.sort((a, b) => {
    const sa = (a.narrative && a.narrative.parsed.score !== null && a.narrative.parsed.score !== undefined) ? parseFloat(a.narrative.parsed.score) : -Infinity;
    const sb = (b.narrative && b.narrative.parsed.score !== null && b.narrative.parsed.score !== undefined) ? parseFloat(b.narrative.parsed.score) : -Infinity;
    return sortVal === 'score-asc' ? sa - sb : sb - sa;
  });

  renderPlayerReportCards(list);
}

function renderPlayerReportCards(list){
  const container = document.getElementById('player-data-container');
  const countEl = document.getElementById('player-report-count');
  const total = currentPlayerDetections.length;

  if (countEl) {
    countEl.textContent = (list.length === total)
        ? `${total} detección${total === 1 ? '' : 'es'}`
        : `${list.length} de ${total} detecciones`;
  }

  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = '<div class="placeholder-box">No hay resultados para estos filtros.</div>';
    return;
  }

  list.forEach(group => container.appendChild(renderDetectionCard(group)));
}

function appendLog(msg, type="") {
  const term = document.getElementById("terminal");
  const p = document.createElement("p");
  if(type) p.className = type;
  p.innerText = msg;
  term.appendChild(p);
  term.scrollTop = term.scrollHeight;
}

function clearLogs() {
  document.getElementById("terminal").innerHTML = '<p class="info">[SISTEMA] Consola limpia.</p>';
}

/* ============================================================
   JORNADAS DE LIGA — mini base de datos (rival, resultado, clips)
   ============================================================ */
let JORNADAS_DATA = [];  // se carga desde /api/jornadas (SQLite)

/* ============================================================
   COMPETICIONES: Liga (jornadas 1-38) y Copa del Rey (partidos 101+)
   Si el servidor aún no devuelve el campo "competicion", se deduce
   del número: todo lo que sea > 100 es Copa.
   ============================================================ */
const COPA_NUM_BASE = 100;

function isCopa(j){
  if(!j) return false;
  if(j.competicion) return String(j.competicion).toLowerCase() === 'copa';
  return Number(j.numero) > COPA_NUM_BASE;
}

function isCopaNum(n){
  const j = JORNADAS_DATA.find(x => x.numero === Number(n));
  return j ? isCopa(j) : Number(n) > COPA_NUM_BASE;
}

function copaRonda(n){
  const j = JORNADAS_DATA.find(x => x.numero === Number(n));
  return (j && j.ronda) ? j.ronda : `Eliminatoria ${Number(n) - COPA_NUM_BASE}`;
}

// "Jornada 7"  /  "Copa del Rey · Dieciseisavos"
function jornadaLabel(n){
  n = Number(n);
  return isCopaNum(n) ? `Copa del Rey · ${copaRonda(n)}` : `Jornada ${n}`;
}

// "la jornada 7"  /  "la Copa del Rey · Dieciseisavos"  (para frases)
function deLaJornada(n, capital){
  n = Number(n);
  if(isCopaNum(n)) return `la ${jornadaLabel(n)}`;
  return `la ${capital ? 'Jornada' : 'jornada'} ${n}`;
}

function paraJornada(n){ return ` para ${deLaJornada(n)}`; }

function numOrNull(v){
  return (v === null || v === undefined || v === '') ? null : Number(v);
}

function penaltyPair(j){
  const a = numOrNull(j.penaltis_jaen), b = numOrNull(j.penaltis_rival);
  return (a !== null && b !== null) ? [a, b] : null;
}

// " (4-3 pen.)" o ""  — siempre en orden Jaén-rival
function penSuffix(j){
  const p = penaltyPair(j);
  return p ? ` (${p[0]}-${p[1]} pen.)` : '';
}

// Clave ordenable (YYYYMMDD) de la fecha de un partido. Acepta ISO
// (2026-10-28), dd/mm/yyyy, dd-mm-yyyy y objetos Date/ISO con hora.
function fechaKey(j){
  const f = j && j.fecha ? String(j.fecha).trim() : '';
  let m = f.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  m = f.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if(m) return Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
  return 99991231;
}

// Calendario: todos los partidos (liga y Copa) ordenados por fecha.
// Si coinciden o no tienen fecha, se desempata por número.
function calendarioOrdenado(list){
  return [...list].sort((a, b) =>
      fechaKey(a) - fechaKey(b) || Number(a.numero) - Number(b.numero));
}

// Rellena un <select> de jornada (el primer hijo es la opción "todas")
function fillJornadaSelect(sel){
  if(!sel) return;
  const prev = sel.value;
  Array.from(sel.children).slice(1).forEach(c => c.remove());

  const ligaNums = JORNADAS_DATA.filter(j => !isCopa(j)).map(j => j.numero).sort((a, b) => a - b);
  const copaNums = JORNADAS_DATA.filter(isCopa).map(j => j.numero).sort((a, b) => a - b);
  const ligaList = ligaNums.length ? ligaNums : Array.from({ length: 38 }, (_, i) => i + 1);

  const mk = (n, text) => {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = text;
    return o;
  };

  if(copaNums.length){
    const gLiga = document.createElement('optgroup');
    gLiga.label = 'Liga';
    ligaList.forEach(n => gLiga.appendChild(mk(n, `Jornada ${n}`)));
    const gCopa = document.createElement('optgroup');
    gCopa.label = 'Copa del Rey';
    copaNums.forEach(n => gCopa.appendChild(mk(n, jornadaLabel(n))));
    sel.appendChild(gLiga);
    sel.appendChild(gCopa);
  } else {
    ligaList.forEach(n => sel.appendChild(mk(n, `Jornada ${n}`)));
  }

  if(prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
  sel.dataset.populated = "true";
}

function refreshJornadaSelects(){
  ['jornada-filter', 'tactical-jornada-filter', 'detection-jornada-filter', 'player-jornada-filter']
      .forEach(id => fillJornadaSelect(document.getElementById(id)));
}

/* Carga los datos de temporada desde la base de datos (vía API).
   staticDataReady se resuelve cuando JORNADAS_DATA, JORNADA_STATS y
   DETECTION_EXAMPLES ya están rellenos. */
async function loadStaticData(){
  const get = async path => {
    const res = await fetch(`${API_BASE}${path}`);
    if(!res.ok) throw new Error(`HTTP ${res.status} en ${path}`);
    return res.json();
  };
  try {
    const [jor, st, car] = await Promise.all([
      get('/api/jornadas'), get('/api/jornada-stats'), get('/api/carrusel')
    ]);
    JORNADAS_DATA = jor.jornadas || [];
    JORNADA_STATS = st.stats || {};
    DETECTION_EXAMPLES = car.items || [];
  } catch(e) {
    console.error('No se pudieron cargar los datos de la base de datos', e);
  }
  jornadasCache = JORNADAS_DATA;
  refreshJornadaSelects();
  renderCarousel();
  updateSidebarQuickStats();
}
const staticDataReady = loadStaticData();

// ---- Estadísticas de partido por jornada ----

let JORNADA_STATS = {};  // se carga desde /api/jornada-stats (SQLite)

const STAT_LABELS = {
  posesion:       'Posesión (%)',
  tiros:          'Tiros totales',
  tiros_puerta:   'Tiros a puerta',
  corners:        'Córners',
  faltas:         'Faltas',
  fuera_de_juego: 'Fuera de juego',
  amarillas:      'Tarjetas amarillas',
  rojas:          'Tarjetas rojas',
  paradas:        'Paradas del portero'
};

let jornadasCache = null;
let allClipFiles = [];
let clipCountsByJornada = {};
let currentJornadaNum = null;
let jornadasLoadToken = 0;

const ESCUDO_JAEN = "fotos/escudo.png";

async function loadJornadas(){
  await staticDataReady;
  jornadasCache = JORNADAS_DATA;
  const loadToken = ++jornadasLoadToken;

  // Al entrar en la vista de jornadas, cargamos en paralelo el listado
  // de clips de cada jornada. Así el contador se conoce antes de pulsar
  // ninguna tarjeta.
  clipCountsByJornada = {};
  allClipFiles = [];

  const container = document.getElementById('jornadas-container');
  if(container){
    container.innerHTML = '<div class="placeholder-box">Cargando cantidad de clips…</div>';
  }

  const results = await Promise.all(
      JORNADAS_DATA.map(async j => {
        try {
          const res = await fetch(`${API_BASE}/api/jornadas/${j.numero}/clips`);
          if(!res.ok) throw new Error(`HTTP ${res.status}`);

          const data = await res.json();
          const clips = Array.isArray(data.clips) ? data.clips : [];

          return {
            numero: j.numero,
            clips,
            ok: true
          };
        } catch(e) {
          console.error(`Error al consultar los informes`, e);
          return {
            numero: j.numero,
            clips: [],
            ok: false
          };
        }
      })
  );

  // Si el usuario ha provocado otra carga mientras esta terminaba,
  // no sobrescribimos el estado más reciente.
  if(loadToken !== jornadasLoadToken) return;

  results.forEach(({numero, clips, ok}) => {
    clipCountsByJornada[numero] = ok ? clips.length : null;
    clips.forEach(clip => {
      if(clip && clip.path) allClipFiles.push(clip.path);
    });
  });

  renderJornadasGrid();
}

function updateSidebarQuickStats(){
  const sinJugar = j => j.goles_jaen === null || j.goles_jaen === undefined || j.goles_jaen === '';
  // Próximo / último partido: calendario completo (liga + copa)
  const calendario = calendarioOrdenado(JORNADAS_DATA);
  const jugadas = calendario.filter(j => !sinJugar(j));
  const proxima = calendario.find(sinJugar);
  const ultima = jugadas.length ? jugadas[jugadas.length - 1] : null;
  // Progreso de temporada: solo cuentan las 38 jornadas de liga
  const ligaTodas = JORNADAS_DATA.filter(j => !isCopa(j));
  const jugados = ligaTodas.filter(j => !sinJugar(j)).length;

  const partidosEl = document.getElementById('qs-partidos');
  const jugadoresEl = document.getElementById('qs-jugadores');

  if(partidosEl) partidosEl.textContent = `${jugados} / ${ligaTodas.length}`;
  if(jugadoresEl){
    const total = squadPlayerNamesList().length;
    jugadoresEl.textContent = total > 0 ? total : '—';
  }

  // Barra de progreso de temporada
  const pctEl = document.getElementById('qs-progreso-pct');
  const fillEl = document.getElementById('qs-progreso-fill');
  const pct = ligaTodas.length ? Math.round((jugados / ligaTodas.length) * 100) : 0;
  if(pctEl) pctEl.textContent = `${pct}%`;
  if(fillEl) fillEl.style.width = `${pct}%`;

  // Tarjeta de próximo partido
  const nextBox = document.getElementById('side-next-match');
  if(nextBox){
    if(proxima){
      nextBox.style.display = '';
      const crestBox = document.getElementById('qs-next-crest');
      const rivalEl = document.getElementById('qs-next-rival');
      const venueEl = document.getElementById('qs-next-venue');
      const fechaEl = document.getElementById('qs-next-fecha');

      rivalEl.textContent = (proxima.rival || '—') + (isCopa(proxima) ? ' · Copa' : '');
      fechaEl.textContent = proxima.fecha || '';
      if(venueEl){
        const esLocal = proxima.campo === 'local';
        venueEl.textContent = esLocal ? 'Local' : 'Visitante';
        venueEl.className = `side-tag ${esLocal ? 'local' : 'visitante'}`;
      }
      if(crestBox){
        const src = proxima.escudo_rival ? `fotos/${proxima.escudo_rival}` : '';
        const initials = initialsOf(proxima.rival);
        crestBox.innerHTML = src
            ? `<img src="${src}" alt="${escapeHtml(proxima.rival || '')}" onerror="this.style.display='none'; this.parentElement.innerHTML='<span>${escapeHtml(initials)}</span>';">`
            : `<span>${escapeHtml(initials)}</span>`;
      }
    } else {
      nextBox.style.display = 'none';
    }
  }

  // Tarjeta de último resultado
  const lastBox = document.getElementById('side-last-match');
  if(lastBox){
    if(ultima){
      lastBox.style.display = '';
      const crestBox = document.getElementById('qs-last-crest');
      const rivalEl = document.getElementById('qs-last-rival');
      const resultEl = document.getElementById('qs-last-result');
      const scoreEl = document.getElementById('qs-last-score');

      rivalEl.textContent = (ultima.rival || '—') + (isCopa(ultima) ? ' · Copa' : '');
      const st = matchState(ultima);
      if(resultEl){
        resultEl.textContent = st.text;
        resultEl.className = `side-tag ${st.cls}`;
      }
      if(scoreEl){
        scoreEl.textContent = `${ultima.goles_jaen} - ${ultima.goles_rival}${penSuffix(ultima)}`;
      }
      if(crestBox){
        const src = ultima.escudo_rival ? `fotos/${ultima.escudo_rival}` : '';
        const initials = initialsOf(ultima.rival);
        crestBox.innerHTML = src
            ? `<img src="${src}" alt="${escapeHtml(ultima.rival || '')}" onerror="this.style.display='none'; this.parentElement.innerHTML='<span>${escapeHtml(initials)}</span>';">`
            : `<span>${escapeHtml(initials)}</span>`;
      }
    } else {
      lastBox.style.display = 'none';
    }
  }
}

function matchState(j){
  if(j.goles_jaen === null || j.goles_jaen === undefined || j.goles_jaen === '' ||
      j.goles_rival === null || j.goles_rival === undefined || j.goles_rival === ''){
    return { text: 'Pendiente', cls: 'pending' };
  }
  const gj = Number(j.goles_jaen), gr = Number(j.goles_rival);
  if(gj > gr) return { text: 'Victoria', cls: 'win' };
  if(gj < gr) return { text: 'Derrota', cls: 'loss' };
  // Empate en el marcador: en Copa se decide en los penaltis
  const pens = penaltyPair(j);
  if(pens && pens[0] !== pens[1]){
    return pens[0] > pens[1] ? { text: 'Victoria', cls: 'win' } : { text: 'Derrota', cls: 'loss' };
  }
  return { text: 'Empate', cls: 'draw' };
}

// Texto extra del desenlace ("Prórroga · Penaltis 4 : 3"), orientado local-visitante
function matchExtraNote(j){
  const pens = penaltyPair(j);
  const parts = [];
  if(pens || Number(j.prorroga) === 1 || j.prorroga === true) parts.push('Prórroga');
  if(pens){
    const [l, r] = j.campo === 'visitante' ? [pens[1], pens[0]] : [pens[0], pens[1]];
    parts.push(`Penaltis ${l} : ${r}`);
  }
  return parts.join(' · ');
}

function initialsOf(name){
  if(!name) return '?';
  return name.trim().split(/\s+/).slice(0,2).map(w => w[0].toUpperCase()).join('');
}

function crestHtml(src, name, sizeClass){
  const initials = escapeHtml(initialsOf(name));
  const altText = escapeHtml(name || 'Escudo');
  return `
        <div class="crest-wrap ${sizeClass}">
          ${src ? `<img src="${src}" alt="${altText}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ''}
          <div class="crest-fallback" style="${src ? 'display:none;' : 'display:flex;'}"><span>${initials}</span></div>
        </div>`;
}

function applyJornadasFilters(){
  renderJornadasGrid();
}

function clearJornadasFilters(){
  const resultSel = document.getElementById('jornada-result-filter');
  const venueSel = document.getElementById('jornada-venue-filter');
  const compSel = document.getElementById('jornada-comp-filter');
  if(resultSel) resultSel.value = 'all';
  if(venueSel) venueSel.value = 'all';
  if(compSel) compSel.value = 'all';
  renderJornadasGrid();
}

function renderJornadasGrid(){
  const container = document.getElementById('jornadas-container');
  if(!jornadasCache || jornadasCache.length === 0){
    container.innerHTML = '<div class="placeholder-box">No hay jornadas.</div>';
    return;
  }

  const resultSel = document.getElementById('jornada-result-filter');
  const venueSel = document.getElementById('jornada-venue-filter');
  const compSel = document.getElementById('jornada-comp-filter');
  const compWrap = document.getElementById('jornada-comp-filter-wrap');
  const resultValue = resultSel ? resultSel.value : 'all';
  const venueValue = venueSel ? venueSel.value : 'all';

  // El filtro de competición solo aparece cuando ya hay partidos de Copa
  const hayCopa = jornadasCache.some(isCopa);
  if(compWrap) compWrap.style.display = hayCopa ? '' : 'none';
  if(!hayCopa && compSel) compSel.value = 'all';
  const compValue = compSel ? compSel.value : 'all';

  const filteredJornadas = calendarioOrdenado(jornadasCache).filter(j => {
    const st = matchState(j);
    const matchesResult = resultValue === 'all' || st.cls === resultValue;
    const matchesVenue = venueValue === 'all' || j.campo === venueValue;
    const matchesComp = compValue === 'all' || (compValue === 'copa') === isCopa(j);
    return matchesResult && matchesVenue && matchesComp;
  });

  if(filteredJornadas.length === 0){
    container.innerHTML = '<div class="placeholder-box">No hay jornadas que coincidan con los filtros seleccionados.</div>';
    return;
  }

  container.innerHTML = filteredJornadas.map(j => {
    const st = matchState(j);
    const rivalCrestSrc = j.escudo_rival ? `fotos/${j.escudo_rival}` : '';
    const jaenCrest = crestHtml(ESCUDO_JAEN, 'Real Jaén', 'crest-sm');
    const rivalCrest = crestHtml(rivalCrestSrc, j.rival, 'crest-sm');
    const crestsInOrder = j.campo === 'visitante'
        ? `${rivalCrest}<span class="vs-sep">–</span>${jaenCrest}`
        : `${jaenCrest}<span class="vs-sep">–</span>${rivalCrest}`;
    return `
        <button class="jornada-card" onclick="openJornada(${j.numero})">
          <span class="jnum">${isCopa(j) ? escapeHtml(copaRonda(j.numero)) : `Jornada ${j.numero}`}</span>
          <div class="crest-vs-row">
            ${crestsInOrder}
          </div>
          <div class="jornada-bottom">
            <span class="result-chip ${st.cls}">${st.text}</span>
            <span class="clip-count">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              ${countClipsForJornada(j.numero)}
            </span>
          </div>
        </button>
    `;
  }).join('');
}

function countClipsForJornada(n){
  // El contador se obtiene al cargar la rejilla, sin necesidad de abrir
  // la jornada. null significa que el backend no respondió correctamente.
  if(Object.prototype.hasOwnProperty.call(clipCountsByJornada, n)){
    const count = clipCountsByJornada[n];
    return count === null ? '—' : count;
  }

  // Fallback para estados transitorios mientras se carga la información.
  return '…';
}

function openJornada(n){
  currentJornadaNum = n;
  const j = jornadasCache.find(x => x.numero === n) ||
      { numero: n, rival: "", escudo_rival: "", estadio: "", fecha: "", campo: "local", goles_jaen: null, goles_rival: null, notas: "" };

  document.getElementById('jornadas-grid-view').style.display = 'none';
  document.getElementById('jornada-detail-view').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  document.getElementById('jornada-detail-title').textContent = jornadaLabel(n);

  const st = matchState(j);
  const fechaTxt = j.fecha ? j.fecha : 'Sin fecha';
  const estadioTxt = j.estadio ? j.estadio : 'Estadio sin definir';
  const rivalNombre = j.rival ? escapeHtml(j.rival) : 'Rival sin definir';
  const rivalCrestSrc = j.escudo_rival ? `fotos/${j.escudo_rival}` : '';

  const leftName = j.campo === 'visitante' ? rivalNombre : 'Real Jaén CF';
  const rightName = j.campo === 'visitante' ? 'Real Jaén CF' : rivalNombre;
  const leftCrest = j.campo === 'visitante' ? rivalCrestSrc : ESCUDO_JAEN;
  const rightCrest = j.campo === 'visitante' ? ESCUDO_JAEN : rivalCrestSrc;
  const leftAlt = j.campo === 'visitante' ? j.rival : 'Real Jaén';
  const rightAlt = j.campo === 'visitante' ? 'Real Jaén' : j.rival;
  const scoreLeft = j.campo === 'visitante' ? j.goles_rival : j.goles_jaen;
  const scoreRight = j.campo === 'visitante' ? j.goles_jaen : j.goles_rival;
  const scoreTxtOriented = (st.cls === 'pending')
      ? '– : –'
      : `${scoreLeft ?? '–'} : ${scoreRight ?? '–'}`;

  const extraNote = matchExtraNote(j);

  document.getElementById('jornada-info-container').innerHTML = `
        <div class="match-header">
          <div class="match-side">
            ${crestHtml(leftCrest, leftAlt, 'crest-lg')}
            <div class="side-name">${escapeHtml(leftName)}</div>
          </div>
          <div class="match-center">
            <div class="match-score-big">${scoreTxtOriented}</div>
            <div class="match-state-label ${st.cls}">${st.text}</div>
            ${extraNote ? `<div class="match-extra-note">${escapeHtml(extraNote)}</div>` : ''}
          </div>
          <div class="match-side">
            ${crestHtml(rightCrest, rightAlt, 'crest-lg')}
            <div class="side-name">${escapeHtml(rightName)}</div>
          </div>
        </div>
        <div class="match-meta-row">
          <span class="${j.fecha ? '' : 'muted'}">${escapeHtml(fechaTxt)}</span>
          <span class="meta-dot">·</span>
          <span class="${j.estadio ? '' : 'muted'}">${escapeHtml(estadioTxt)}</span>
          <span class="meta-dot">·</span>
          <span>${j.campo === 'visitante' ? 'Visitante (fuera)' : 'Local (en casa)'}</span>
        </div>
        ${j.notas ? `<div class="match-notes">${escapeHtml(j.notas)}</div>` : ''}
    `;

  renderJornadaStats(n, j);
  loadClipsForJornada(n);
}

function toggleJornadaStats(){
  const btn = document.getElementById('stats-toggle-btn');
  const body = document.getElementById('jornada-stats-body');
  const isOpen = body.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
}

function statBarHtml(pair, homeName, awayName, key){
  const [homeVal, awayVal] = pair;
  const total = (Number(homeVal) || 0) + (Number(awayVal) || 0);
  // Reparto proporcional de la barra; si ambos son 0 se reparte a partes iguales.
  const homePct = total > 0 ? (Number(homeVal) / total) * 100 : 50;
  const awayPct = 100 - homePct;
  const label = STAT_LABELS[key] || key;
  return `
      <div class="stat-block">
        <div class="stat-block-top">
          <span class="stat-val home">${escapeHtml(String(homeVal))}</span>
          <span class="stat-label">${escapeHtml(label)}</span>
          <span class="stat-val away">${escapeHtml(String(awayVal))}</span>
        </div>
        <div class="stat-bar">
          <div class="stat-bar-home" style="width:${homePct}%"></div>
          <div class="stat-bar-away" style="width:${awayPct}%"></div>
        </div>
      </div>`;
}

function renderJornadaStats(n, j){
  const container = document.getElementById('jornada-stats-container');
  // Reiniciamos el desplegable a "cerrado" cada vez que se entra en una jornada.
  const btn = document.getElementById('stats-toggle-btn');
  const body = document.getElementById('jornada-stats-body');
  body.classList.remove('open');
  btn.classList.remove('open');

  const stats = JORNADA_STATS[n];
  const rivalNombre = j.rival || 'Rival';
  const homeIsJaen = j.campo !== 'visitante';
  const homeName = homeIsJaen ? 'Real Jaén' : rivalNombre;
  const awayName = homeIsJaen ? rivalNombre : 'Real Jaén';
  const flashscoreUrl = j.flashscore_url || '';

  const linkHtml = flashscoreUrl
      ? `<a class="stats-source-link" href="${flashscoreUrl}" target="_blank" rel="noopener">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
             Ver más detalles
           </a>`
      : '';

  if(!stats){
    container.innerHTML = `
            <div class="stats-empty">
              Estadísticas aún no disponibles para esta jornada.<br>
              Se publican al finalizar el partido.
              ${flashscoreUrl ? `<div style="margin-top:12px;">${linkHtml}</div>` : ''}
            </div>`;
    return;
  }

  const rows = Object.keys(stats).map(key => statBarHtml(stats[key], homeName, awayName, key)).join('');

  container.innerHTML = `
        <div class="stats-teams-row">
          <div class="stats-team home">${crestHtml(homeIsJaen ? ESCUDO_JAEN : (j.escudo_rival ? `fotos/${j.escudo_rival}` : ''), homeName, 'crest-sm')}<span>${escapeHtml(homeName)}</span></div>
          ${linkHtml}
          <div class="stats-team away"><span>${escapeHtml(awayName)}</span>${crestHtml(homeIsJaen ? (j.escudo_rival ? `fotos/${j.escudo_rival}` : '') : ESCUDO_JAEN, awayName, 'crest-sm')}</div>
        </div>
        ${rows}
    `;
}

function closeJornadaDetail(){
  document.getElementById('jornada-detail-view').style.display = 'none';
  document.getElementById('jornadas-grid-view').style.display = 'block';
  renderJornadasGrid();
}

async function loadClipsForJornada(n){
  const container = document.getElementById('jornada-clips-container');
  container.innerHTML = '<div class="placeholder-box">Buscando clips del partido…</div>';

  try {
    const res = await fetch(`${API_BASE}/api/jornadas/${n}/clips`);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const clips = Array.isArray(data.clips) ? data.clips : [];

    // Actualizamos también el contador por si el contenido de esa
    // jornada ha cambiado desde la carga inicial.
    clipCountsByJornada[n] = clips.length;

    if(!allClipFiles) allClipFiles = [];
    allClipFiles = allClipFiles.filter(f => extractJornada(f) !== n);
    clips.forEach(clip => {
      if(clip && clip.path) allClipFiles.push(clip.path);
    });

    if(clips.length === 0){
      container.innerHTML = `<div class="placeholder-box">Clips pendientes de subir al finalizar el partido.</div>`;
      renderJornadasGrid();
      return;
    }

    container.innerHTML = `
            <div class="panel-title">
              Clips de ${deLaJornada(n)}
              <span class="hint">${clips.length} vídeo${clips.length === 1 ? '' : 's'}</span>
            </div>
            <div class="video-grid">
              ${clips.map(clip => {
      const videoUrl = `${API_BASE}${clip.url}`;
      return `
                    <div class="media-card video-card">
                      <video
                        class="media-video"
                        controls
                        preload="metadata"
                        onloadedmetadata="setVideoAspect(this)"
                        src="${videoUrl}">
                      </video>
                      <div class="media-caption">${escapeHtml(clipShortLabel(clip.name))}</div>
                    </div>`;
    }).join('')}
            </div>`;

    renderJornadasGrid();
  } catch (e) {
    console.error('No se pudieron cargar los clips de la jornada', e);
    container.innerHTML = '<div class="placeholder-box" style="color:#a3352c;">Error al consultar los informes.</div>';
  }
}

renderPipelineStage(0, false, STAGE_MESSAGES[0]);
checkBackendStatus();
setInterval(checkBackendStatus, 5000);