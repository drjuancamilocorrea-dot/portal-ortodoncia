
let TOKEN = localStorage.getItem('ortho_admin_token');
let USER = null;
let PACS = [];
let fotoFile = null;

const COP = n => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(n||0);
const FMT = d => new Date(d+'T12:00:00').toLocaleDateString('es-CO',{day:'numeric',month:'short',year:'numeric'});
const cm = id => document.getElementById(id).classList.remove('open');
const om = id => document.getElementById(id).classList.add('open');
const G = id => document.getElementById(id);

const apiGet = url => fetch(url,{headers:{'Authorization':'Bearer '+TOKEN}}).then(r=>r.json());
const apiPost = (url,b) => fetch(url,{method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
const apiPut = (url,b) => fetch(url,{method:'PUT',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
const apiDel = url => fetch(url,{method:'DELETE',headers:{'Authorization':'Bearer '+TOKEN}}).then(r=>r.json());

async function login() {
  const email = G('l-email').value.trim();
  const pass = G('l-pass').value;
  const btn = G('l-btn'); const err = G('l-err');
  btn.textContent='Ingresando...'; btn.disabled=true; err.style.display='none';
  try {
    const r = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})});
    const d = await r.json();
    if (!r.ok || d.rol !== 'admin') throw new Error('Sin permisos');
    TOKEN = d.token; localStorage.setItem('ortho_admin_token',TOKEN); USER = d.user;
    showApp();
  } catch { err.style.display='block'; btn.textContent='Ingresar al panel'; btn.disabled=false; }
}
G('l-btn').addEventListener('click',login);
G('l-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') login(); });
G('logout-btn').addEventListener('click',()=>{ localStorage.removeItem('ortho_admin_token'); location.reload(); });

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    item.classList.add('active');
    G('page-'+item.dataset.page).classList.add('active');
    const p = item.dataset.page;
    if (p==='pacientes') renderPacs();
    if (p==='finanzas') renderFin();
    if (p==='citas-all') renderCalendario();
    if (p==='usuarios') loadUsers();
  });
});

async function showApp() {
  G('login-screen').style.display='none';
  G('app').style.display='block';
  G('sb-nombre').textContent = USER.nombre;
  G('sb-avatar').textContent = USER.nombre[0];
  PACS = await apiGet('/api/admin/pacientes');
  renderDash();
}

function tratBadge(t='') {
  if (t.toLowerCase().includes('bracket')) return `<span class="trat-b tb-brackets">${t}<\/span>`;
  if (t.toLowerCase().includes('alineador')) return `<span class="trat-b tb-alin">${t}<\/span>`;
  return `<span class="trat-b tb-otro">${t}<\/span>`;
}

function initDashFiltros() {
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  if (!G('ds-mes-ini') || G('ds-mes-ini').options.length > 0) return;
  const hoy = new Date();
  const mes = hoy.getMonth();
  const anio = hoy.getFullYear();

  ['ds-mes-ini','ds-mes-fin'].forEach(id => {
    const sel = G(id);
    meses.forEach((m, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = m;
      if (id==='ds-mes-ini' && i===0) o.selected = true; // Enero
      if (id==='ds-mes-fin' && i===mes) o.selected = true; // Mes actual
      sel.appendChild(o);
    });
  });

  ['ds-anio-ini','ds-anio-fin'].forEach(id => {
    const sel = G(id);
    for (let y = anio; y >= anio-3; y--) {
      const o = document.createElement('option');
      o.value = y; o.textContent = y;
      if (y === anio) o.selected = true;
      sel.appendChild(o);
    }
  });
}

function renderDash() {
  initDashFiltros();

  const mesIni = parseInt(G('ds-mes-ini')?.value ?? 0);
  const anioIni = parseInt(G('ds-anio-ini')?.value ?? new Date().getFullYear());
  const mesFin = parseInt(G('ds-mes-fin')?.value ?? new Date().getMonth());
  const anioFin = parseInt(G('ds-anio-fin')?.value ?? new Date().getFullYear());
  // Fecha inicio y fin del rango
  const fechaIni = new Date(anioIni, mesIni, 1);
  const fechaFin = new Date(anioFin, mesFin+1, 0); // último día del mes fin

  // Stats generales
  G('ds-total').textContent = PACS.length;
  G('ds-brackets').textContent = PACS.filter(p=>p.tratamiento?.toLowerCase().includes('bracket')).length;
  G('ds-alin').textContent = PACS.filter(p=>p.tratamiento?.toLowerCase().includes('alineador')).length;
  const hoy = new Date(); const fin = new Date(hoy); fin.setDate(hoy.getDate()+7);
  const allCitas = []; let cnt=0;
  PACS.forEach(p => (p.citas||[]).forEach(c=>{
    const fc=new Date(c.fecha+'T12:00:00');
    if(fc>=hoy&&fc<=fin) cnt++;
    if(fc>=hoy) allCitas.push({...c,pac:p.nombre});
  }));
  G('ds-citas').textContent = cnt;
  allCitas.sort((a,b)=>new Date(a.fecha)-new Date(b.fecha));
  const el = G('ds-prox-citas'); el.innerHTML='';
  allCitas.slice(0,5).forEach(c=>{
    el.innerHTML+=`<div class="tl-item"><div class="tl-dot next"><\/div><div class="tl-date">${FMT(c.fecha)} · ${c.hora}<\/div><div class="tl-title">${c.tipo}<\/div><div style="font-size:11px;color:var(--text2);">${c.pac}<\/div><\/div>`;
  });
  if(!allCitas.length) el.innerHTML='<p class="text-muted">No hay citas próximas</p>';

  // Financiero del rango
  let tp=0, tpag=0;
  PACS.forEach(p => {
    tp += (p.presupuesto?.total||0);
    // Solo contar pagos dentro del rango
    (p.presupuesto?.abonos||[]).forEach(a => {
      const fa = new Date(a.fecha+'T12:00:00');
      if (fa >= fechaIni && fa <= fechaFin) tpag += a.monto;
    });
  });
  const totalRecaudadoGlobal = PACS.reduce((s,p)=>(s+(p.presupuesto?.abonos||[]).reduce((ss,a)=>ss+a.monto,0)),0);
  G('ds-fin').innerHTML=`<div style="display:flex;flex-direction:column;gap:10px;">
    <div><div class="stat-lbl">Total presupuestado (global)<\/div><div style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--warn);">${COP(tp)}<\/div><\/div>
    <div><div class="stat-lbl">Recaudado en el rango<\/div><div style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--accent);">${COP(tpag)}<\/div><\/div>
    <div><div class="stat-lbl">Total recaudado (global)<\/div><div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:var(--text2);">${COP(totalRecaudadoGlobal)}<\/div><\/div>
    <div><div class="stat-lbl">Saldo pendiente (global)<\/div><div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:var(--danger);">${COP(tp-totalRecaudadoGlobal)}<\/div><\/div>
  <\/div>`;

  // ── RESUMEN DEL MES ──────────────────────────────────────────────
  const mesesNom = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const lbl = G('ds-mes-label');
  const labelTxt = (mesIni===mesFin && anioIni===anioFin)
    ? `Resumen — ${mesesNom[mesIni]} ${anioIni}`
    : `Resumen — ${mesesNom[mesIni]} ${anioIni} → ${mesesNom[mesFin]} ${anioFin}`;
  if(lbl) lbl.textContent = labelTxt;

  let citasMes=[], asistidas=0, canceladas=0, ingresosMes=0;
  const pagosMes = [];

  PACS.forEach(p => {
    // Citas del rango
    (p.citas||[]).forEach(c => {
      const fc = new Date(c.fecha+'T12:00:00');
      if (fc >= fechaIni && fc <= fechaFin) {
        citasMes.push({...c, pac:p.nombre});
        if (c.estado==='realizada') asistidas++;
        if (c.estado==='cancelada'||c.estado==='no_asistio') canceladas++;
      }
    });
    // Pagos del rango
    (p.presupuesto?.abonos||[]).forEach(a => {
      const fa = new Date(a.fecha+'T12:00:00');
      if (fa >= fechaIni && fa <= fechaFin) {
        ingresosMes += a.monto;
        pagosMes.push({...a, pac:p.nombre});
      }
    });
  });

  if(G('ds-mes-agendadas')) G('ds-mes-agendadas').textContent = citasMes.length;
  if(G('ds-mes-asistidas')) G('ds-mes-asistidas').textContent = asistidas;
  if(G('ds-mes-canceladas')) G('ds-mes-canceladas').textContent = canceladas;
  if(G('ds-mes-ingresos')) G('ds-mes-ingresos').textContent = COP(ingresosMes);

  // Lista de pagos del mes
  const pm = G('ds-mes-pagos');
  if(pm) {
    if(!pagosMes.length) {
      pm.innerHTML='<p style="font-size:13px;color:var(--text2);">Sin pagos registrados este mes</p>';
    } else {
      pagosMes.sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
      pm.innerHTML = pagosMes.map(a=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <div>
            <span style="color:var(--text);font-weight:500;">${a.pac}</span>
            <span style="color:var(--text2);font-size:11px;margin-left:6px;">${a.descripcion||'Pago'} · ${a.fecha}</span>
          </div>
          <span style="color:var(--accent);font-weight:700;">${COP(a.monto)}</span>
        </div>`).join('');
    }
  }
}

function verEvoluciones(id) {
  const p = PACS.find(x => x.id === id);
  if (!p) return;
  const citasConEv = (p.citas || []).filter(c => c.notas_clinicas || c.evolucion_registrada).sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
  const histPuntos = (p.gamificacion?.historial || []).slice().reverse();

  const evHtml = citasConEv.length ? citasConEv.map(c => `
    <div style="background:var(--bg3);border-radius:var(--rs);padding:14px;margin-bottom:10px;border-left:3px solid var(--accent);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="color:var(--text);font-size:14px;">${c.tipo}</strong>
        <span style="font-size:12px;color:var(--text2);">${FMT(c.fecha)} · ${c.hora}</span>
      </div>
      ${c.notas_clinicas ? `<p style="font-size:13px;color:var(--text2);margin-bottom:6px;">📝 ${c.notas_clinicas}</p>` : ''}
      ${c.elastico ? `<div style="margin:6px 0;">${generarSVGElasticoMini(c.elastico)}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:12px;">
        ${c.bracket_reparado ? '<span style="background:rgba(255,79,107,0.1);color:var(--danger);padding:3px 8px;border-radius:20px;">🔧 Bracket reparado</span>' : ''}
        ${c.elastico ? `<span style="background:rgba(226,75,74,0.1);color:#E24B4A;padding:3px 8px;border-radius:20px;">⚡ Elástico: ${c.elastico}</span>` : ''}
      </div>
    </div>`) .join('') : '<p style="color:var(--text2);font-size:13px;">Sin evoluciones registradas aún.</p>';

  const puntosHtml = histPuntos.length ? histPuntos.slice(0,10).map(h => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
      <span style="color:var(--text);">${h.desc} <span style="color:var(--text2);">${h.fecha}</span></span>
      <span style="color:var(--accent);font-weight:700;">+${h.puntos} pts</span>
    </div>`).join('') : '<p style="color:var(--text2);font-size:13px;">Sin puntos registrados.</p>';

  const totalPuntos = (p.gamificacion?.historial || []).reduce((s,h) => s + h.puntos, 0);

  const modal = document.createElement('div');
  modal.id = 'modal-ev-hist';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;display:flex;align-items:center;justify-content:center;padding:1rem;';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);width:100%;max-width:560px;max-height:85vh;overflow-y:auto;padding:1.5rem;position:relative;">
      <button onclick="document.getElementById('modal-ev-hist').remove()" style="position:absolute;top:1rem;right:1rem;background:none;border:none;color:var(--text2);font-size:20px;cursor:pointer;">×</button>
      <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:var(--text);margin-bottom:4px;">📋 Evoluciones — ${p.nombre}</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:1.5rem;">${p.tratamiento} · ${citasConEv.length} controles registrados</div>

      <div style="font-size:13px;font-weight:700;color:var(--accent);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;">Notas clínicas</div>
      ${evHtml}

      <div style="font-size:13px;font-weight:700;color:var(--accent);margin-top:1.5rem;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;">Historial de puntos · Total: ${totalPuntos} pts</div>
      ${puntosHtml}
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function eliminarPaciente(id, nombre) {
  if (!confirm('¿Seguro que deseas eliminar a ' + nombre + '? Esta acción no se puede deshacer.')) return;
  const r = await apiDel('/api/admin/pacientes/' + id);
  if (r.ok) {
    PACS = await apiGet('/api/admin/pacientes');
    renderPacs();
    const notif = document.createElement('div');
    notif.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;background:#111820;border:1px solid rgba(0,210,140,0.3);border-radius:10px;padding:12px 18px;font-size:13px;color:#00d28c;z-index:999;';
    notif.innerHTML = '🗑️ Paciente ' + nombre + ' eliminado';
    document.body.appendChild(notif);
    setTimeout(()=>notif.remove(), 4000);
  } else {
    alert('Error al eliminar: ' + (r.error || 'desconocido'));
  }
}

function renderPacs() {
  const tbody = G('tbody-p'); tbody.innerHTML='';
  PACS.forEach(p=>{
    const abonos = p.presupuesto?.abonos || [];
    const abonoInicial = abonos.find(a => a.descripcion?.toLowerCase().includes('inicial'));
    const totalPagos = abonos.length;
    const numCuotasPlan = 1 + (p.presupuesto?.num_cuotas || p.duracion || 0);
    const fechaInicioStr = abonoInicial ? abonoInicial.fecha : p.inicio;
    const inicio = new Date(fechaInicioStr+'T12:00:00');
    const meses = abonoInicial ? Math.floor((new Date()-inicio)/(1000*60*60*24*30.5)) : 0;
    const pct = numCuotasPlan > 0 ? Math.min(100,Math.round((totalPagos/numCuotasPlan)*100)) : 0;
    const prox=(p.citas||[]).find(c=>c.estado==='proxima'||c.estado==='programada');
    tbody.innerHTML+=`<tr>
      <td><strong>${p.nombre}<\/strong><br><span style="font-size:11px;color:var(--text2);">${p.email}<\/span><\/td>
      <td>${tratBadge(p.tratamiento)}<\/td>
      <td>${FMT(p.inicio)}<\/td>
      <td style="min-width:110px;"><div style="font-size:11px;color:var(--text2);margin-bottom:3px;">${pct}% · ${totalPagos}/${numCuotasPlan} cuotas<\/div><div class="prog-track"><div class="prog-fill" style="width:${pct}%"><\/div><\/div><\/td>
      <td style="font-size:12px;">${prox?FMT(prox.fecha)+'<br><span style="color:var(--text2)">'+prox.tipo+'</span>':'<span style="color:var(--text2)">—</span>'}<\/td>
      <td><div style="display:flex;flex-direction:column;gap:3px;">
        <div style="display:flex;gap:3px;">
          <button class="btn btn-xs" onclick="verDet('${p.id}')">Ver<\/button>
          <button class="btn btn-xs" onclick="editP('${p.id}')">Datos<\/button>
          <button class="btn btn-xs" onclick="abrirCita('${p.id}','${p.nombre}')">+Cita<\/button>
          <button class="btn btn-xs" onclick="abrirFotoCita('${p.id}')">+Foto<\/button>
        <\/div>
        <div style="display:flex;gap:3px;">
          <button class="btn btn-xs btn-warn" onclick="abrirFin('${p.id}')">💰 Presupuesto<\/button>
          <button class="btn btn-xs btn-info" onclick="verEvoluciones('${p.id}')">📋 Evoluciones<\/button>
          <button class="btn btn-xs btn-danger" onclick="eliminarPaciente('${p.id}','${p.nombre}')">🗑️<\/button>
        <\/div>
      <\/div><\/td>
    <\/tr>`;
  });
}

function verDet(id) {
  const p = PACS.find(x=>x.id===id); if(!p) return;
  const pagado=(p.presupuesto?.abonos||[]).reduce((s,a)=>s+a.monto,0);
  const saldo=(p.presupuesto?.total||0)-pagado;
  const meses=Math.floor((new Date()-new Date(p.inicio+'T12:00:00'))/(1000*60*60*24*30.5));
  const pct=Math.min(100,Math.round((meses/p.duracion)*100));
  const citasHtml=[...(p.citas||[])].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).map(c=>{
    const dot=c.estado==='realizada'?'done':c.estado==='proxima'?'next':'';
    const estados={'realizada':'✅ Realizada','proxima':'📅 Próxima','programada':'📅 Programada','no_asistio':'❌ No asistió','cancelada':'🔄 Cancelada'};
    const bc=c.estado==='realizada'?'bd':c.estado==='proxima'?'bn':'bp';
    const lbl=estados[c.estado]||c.estado;
    const extraStyle=c.estado==='no_asistio'?'background:rgba(255,79,107,0.1);color:var(--danger);border:1px solid rgba(255,79,107,0.2);':c.estado==='cancelada'?'background:rgba(245,166,35,0.1);color:var(--warn);border:1px solid rgba(245,166,35,0.2);':'';
    const notasHtml = c.notas_clinicas ? `<div style="margin-top:6px;background:var(--bg3);border-left:2px solid var(--accent);border-radius:0 var(--rs) var(--rs) 0;padding:6px 10px;font-size:12px;color:var(--text2);">${c.notas_clinicas}${c.bracket_reparado?'<span style="margin-left:8px;color:var(--danger);">🔧 Bracket reparado</span>':''}<\/div>` : '';
    return `<div class="tl-item"><div class="tl-dot ${dot}"><\/div>
      <div class="tl-date">${FMT(c.fecha)} · ${c.hora}<\/div>
      <div class="tl-title">${c.tipo}<\/div>
      <span class="tl-badge ${bc}" style="${extraStyle}">${lbl}<\/span>
      ${notasHtml}
    <\/div>`;
  }).join('');

  const histPuntos = (p.gamificacion?.historial||[]);
  const totalPuntos = histPuntos.reduce((s,h)=>s+h.puntos,0);
  const puntosHtml = histPuntos.length ? [...histPuntos].reverse().slice(0,8).map(h=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
      <div><span style="color:var(--text);">${h.desc}<\/span><span style="color:var(--text2);margin-left:8px;">${h.fecha}<\/span><\/div>
      <span style="font-family:'Syne',sans-serif;font-weight:700;color:var(--accent);">+${h.puntos}<\/span>
    <\/div>`).join('') : '<p style="font-size:13px;color:var(--text2);">Sin puntos aún</p>';

  const fotosHtml=(p.progreso||[]).map(pr=>{
    const img=pr.foto?`<img src="${pr.foto}" alt="Mes ${pr.mes}">`:`<div class="photo-empty"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/><\/svg><\/div>`;
    return `<div class="photo-card">${img}<div class="photo-info"><div class="photo-mes">Mes ${pr.mes}<\/div><div class="photo-nota">${pr.nota||FMT(pr.fecha)}<\/div><\/div><\/div>`;
  }).join('');

  G('det-content').innerHTML=`
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:1.5rem;">
      <div style="width:48px;height:48px;border-radius:50%;background:var(--accent-dim);border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--accent);">${p.nombre[0]}<\/div>
      <div><div style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;">${p.nombre}<\/div><div style="font-size:13px;color:var(--text2);">${p.tratamiento} · ${p.telefono||'Sin teléfono'}${p.cambio_alineador_dias?' · Cambio cada '+p.cambio_alineador_dias+' días':''}<\/div><\/div>
    <\/div>
    <div class="grid-2 mb-1">
      <div class="card" style="margin:0;"><div class="card-title">Tratamiento<\/div>
        <p style="font-size:13px;margin-bottom:5px;">Inicio: <strong>${FMT(p.inicio)}<\/strong><\/p>
        <p style="font-size:13px;margin-bottom:5px;">Duración: <strong>${p.duracion} meses<\/strong><\/p>
        <div style="font-size:11px;color:var(--text2);margin-bottom:3px;">Progreso: ${pct}%<\/div>
        <div class="prog-track"><div class="prog-fill" style="width:${pct}%"><\/div><\/div>
      <\/div>
      <div class="card" style="margin:0;">
        <div class="card-title">Finanzas<\/div>
        <p style="font-size:13px;margin-bottom:5px;">Presupuesto: <strong style="color:var(--warn);">${COP(p.presupuesto?.total||0)}<\/strong><\/p>
        <p style="font-size:13px;margin-bottom:5px;">Pagado: <strong style="color:var(--accent);">${COP(pagado)}<\/strong><\/p>
        <p style="font-size:13px;">Saldo: <strong style="color:${saldo>0?'var(--danger)':'var(--accent)'};">${COP(saldo)}<\/strong><\/p>
      <\/div>
    <\/div>
    <div class="card mb-1">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <div class="card-title" style="margin:0;">Historial de citas y notas clínicas<\/div>
        <button class="btn btn-sm" onclick="abrirCita('${p.id}','${p.nombre}')">+ Cita<\/button>
      <\/div>
      <div class="timeline">${citasHtml||'<p class="text-muted">Sin citas</p>'}<\/div>
    <\/div>
    <div class="card mb-1">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <div class="card-title" style="margin:0;">Gamificación · <span style="color:var(--accent);">${totalPuntos} pts<\/span><\/div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-acc" onclick="cm('modal-det');abrirEvolucion('${p.id}','',null)">+ Evolución<\/button>
          <button class="btn btn-sm" onclick="confirmarReferido('${p.id}','agenda')">Referido agendó<\/button>
          <button class="btn btn-sm" onclick="confirmarReferido('${p.id}','inicia')">Referido inició<\/button>
        <\/div>
      <\/div>
      ${puntosHtml}
    <\/div>
    <div class="card"><div class="card-title">Fotos de progreso<\/div><div class="photos-grid">${fotosHtml||'<p class="text-muted">Sin fotos aún</p>'}<\/div><\/div>`;
  om('modal-det');
}

function verDet(id) {
  const p = PACS.find(x=>x.id===id); if(!p) return;
  const pagado=(p.presupuesto?.abonos||[]).reduce((s,a)=>s+a.monto,0);
  const saldo=(p.presupuesto?.total||0)-pagado;
  const meses=Math.floor((new Date()-new Date(p.inicio+'T12:00:00'))/(1000*60*60*24*30.5));
  const pct=Math.min(100,Math.round((meses/p.duracion)*100));
  const citasHtml=[...(p.citas||[])].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).map(c=>{
    const dot=c.estado==='realizada'?'done':c.estado==='proxima'?'next':'';
    const bc=c.estado==='realizada'?'bd':c.estado==='proxima'?'bn':'bp';
    const lbl=c.estado==='realizada'?'Realizada':c.estado==='proxima'?'Próxima':'Programada';
    const notasHtml = c.notas_clinicas ? `<div style="margin-top:6px;background:var(--bg3);border-left:2px solid var(--accent);border-radius:0 var(--rs) var(--rs) 0;padding:6px 10px;font-size:12px;color:var(--text2);">${c.notas_clinicas}${c.bracket_reparado?'<span style="margin-left:8px;color:var(--danger);">🔧 Bracket reparado</span>':''}<\/div>` : '';
    return `<div class="tl-item"><div class="tl-dot ${dot}"><\/div>
      <div class="tl-date">${FMT(c.fecha)} · ${c.hora}<\/div>
      <div class="tl-title">${c.tipo}<\/div>
      <span class="tl-badge ${bc}">${lbl}<\/span>
      <button class="btn btn-sm btn-danger" style="margin-left:6px;font-size:11px;" onclick="elimCita('${p.id}','${c.id}')">✕<\/button>
      ${notasHtml}
    <\/div>`;
  }).join('');

  // Historial de puntos
  const histPuntos = (p.gamificacion?.historial||[]);
  const totalPuntos = histPuntos.reduce((s,h)=>s+h.puntos,0);
  const puntosHtml = histPuntos.length ? [...histPuntos].reverse().slice(0,8).map(h=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
      <div><span style="color:var(--text);">${h.desc}<\/span><span style="color:var(--text2);margin-left:8px;">${h.fecha}<\/span><\/div>
      <span style="font-family:'Syne',sans-serif;font-weight:700;color:var(--accent);">+${h.puntos}<\/span>
    <\/div>`).join('') : '<p style="font-size:13px;color:var(--text2);">Sin puntos aún</p>';

  const fotosHtml=(p.progreso||[]).map(pr=>{
    const img=pr.foto?`<img src="${pr.foto}" alt="Mes ${pr.mes}">`:`<div class="photo-empty"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/><\/svg><\/div>`;
    return `<div class="photo-card">${img}<div class="photo-info"><div class="photo-mes">Mes ${pr.mes}<\/div><div class="photo-nota">${pr.nota||FMT(pr.fecha)}<\/div><\/div><\/div>`;
  }).join('');

  G('det-content').innerHTML=`
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:1.5rem;">
      <div style="width:48px;height:48px;border-radius:50%;background:var(--accent-dim);border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--accent);">${p.nombre[0]}<\/div>
      <div><div style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;">${p.nombre}<\/div><div style="font-size:13px;color:var(--text2);">${p.tratamiento} · ${p.telefono||'Sin teléfono'}${p.cambio_alineador_dias?' · Cambio cada '+p.cambio_alineador_dias+' días':''}<\/div><\/div>
    <\/div>
    <div class="grid-2 mb-1">
      <div class="card" style="margin:0;"><div class="card-title">Tratamiento<\/div>
        <p style="font-size:13px;margin-bottom:5px;">Inicio: <strong>${FMT(p.inicio)}<\/strong><\/p>
        <p style="font-size:13px;margin-bottom:5px;">Duración: <strong>${p.duracion} meses<\/strong><\/p>
        <div style="font-size:11px;color:var(--text2);margin-bottom:3px;">Progreso: ${pct}%<\/div>
        <div class="prog-track"><div class="prog-fill" style="width:${pct}%"><\/div><\/div>
      <\/div>
      <div class="card" style="margin:0;">
        <div class="card-title">Finanzas<\/div>
        <p style="font-size:13px;margin-bottom:5px;">Presupuesto: <strong style="color:var(--warn);">${COP(p.presupuesto?.total||0)}<\/strong><\/p>
        <p style="font-size:13px;margin-bottom:5px;">Pagado: <strong style="color:var(--accent);">${COP(pagado)}<\/strong><\/p>
        <p style="font-size:13px;">Saldo: <strong style="color:${saldo>0?'var(--danger)':'var(--accent)'};">${COP(saldo)}<\/strong><\/p>
      <\/div>
    <\/div>
    <div class="card mb-1">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <div class="card-title" style="margin:0;">Historial de citas y notas clínicas<\/div>
        <button class="btn btn-sm" onclick="abrirCita('${p.id}','${p.nombre}')">+ Agendar cita<\/button>
      <\/div>
      <div class="timeline">${citasHtml||'<p class="text-muted">Sin citas</p>'}<\/div>
    <\/div>
    <div class="card mb-1">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <div class="card-title" style="margin:0;">Gamificación · <span style="color:var(--accent);">${totalPuntos} pts<\/span><\/div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-acc" onclick="cm('modal-det');abrirEvolucion('${p.id}','','')">+ Evolución<\/button>
          <button class="btn btn-sm" onclick="confirmarReferido('${p.id}','agenda')">Referido agendó<\/button>
          <button class="btn btn-sm" onclick="confirmarReferido('${p.id}','inicia')">Referido inició<\/button>
        <\/div>
      <\/div>
      ${puntosHtml}
    <\/div>
    <div class="card"><div class="card-title">Fotos de progreso<\/div><div class="photos-grid">${fotosHtml||'<p class="text-muted">Sin fotos aún</p>'}<\/div><\/div>`;
  om('modal-det');
}

async function elimCita(pid, cid) {
  if (!confirm('¿Eliminar esta cita?')) return;
  await apiDel(`/api/admin/pacientes/${pid}/citas/${cid}`);
  PACS = await apiGet('/api/admin/pacientes');
  verDet(pid);
}

function renderFin() {
  const tbody = G('tbody-fin'); tbody.innerHTML='';
  PACS.forEach(p=>{
    const pagado=(p.presupuesto?.abonos||[]).reduce((s,a)=>s+a.monto,0);
    const saldo=(p.presupuesto?.total||0)-pagado;
    tbody.innerHTML+=`<tr>
      <td><strong>${p.nombre}<\/strong><\/td>
      <td style="color:var(--warn);font-weight:600;">${COP(p.presupuesto?.total||0)}<\/td>
      <td style="color:var(--accent);font-weight:600;">${COP(pagado)}<\/td>
      <td style="color:${saldo>0?'var(--danger)':'var(--accent)'};font-weight:600;">${COP(saldo)}<\/td>
      <td><button class="btn btn-sm" onclick="abrirFin('${p.id}')">Gestionar<\/button><\/td>
    <\/tr>`;
  });
}

function renderCitasAll() { renderCalendario(); }

async function cambiarEstadoCita(pid, cid, estado, abrirModal=true) {
  await apiPut(`/api/admin/pacientes/${pid}/citas/${cid}`, {estado});
  PACS = await apiGet('/api/admin/pacientes');
  renderCalendario();
  const p = PACS.find(x=>x.id===pid);
  if(p?.telefono) {
    if(estado === 'no_asistio' || estado === 'cancelada') {
      await apiPost('/api/admin/whatsapp/inasistencia', {paciente_id: pid, tipo: estado});
    }
  }
  if(abrirModal) abrirEvolucionCita(pid, cid, estado);
}

function abrirEvolucionCita(pid, cid, estado) {
  const p = PACS.find(x=>x.id===pid);
  const cita = p?.citas?.find(c=>c.id===cid);
  G('mev-pid').value = pid;
  G('mev-cid').value = cid;
  G('mev-notas').value = cita?.notas_clinicas || '';
  G('mev-higiene').checked = false;
  G('mev-sin-caidos').checked = false;
  G('mev-bracket-rep').checked = false;
  G('mev-cambio-fecha').checked = false;
  G('mev-pago-monto').value = '';
  G('mev-pago-desc').value = '';
  G('mev-pago-tipo').value = '';
  G('mev-pago-campos').style.display = 'none';
  G('mev-elastico').value = '';
  if(G('mev-num-alineador')) G('mev-num-alineador').value = '';
  initElasticoSelector();
  G('mev-pago-nota').style.display = 'none';
  G('mev-msg').style.display = 'none';

  const asistio = estado === 'realizada';
  const estadoLabel = estado === 'no_asistio' ? '❌ No asistió' : estado === 'cancelada' ? '🔄 Canceló' : '✅ Realizada';

  G('mev-paciente-info').innerHTML = `<strong style="color:var(--text);">${p?.nombre}<\/strong> · ${p?.tratamiento} · ${estadoLabel}${cita?' · '+cita.tipo+' · '+cita.fecha:''}`;

  const esBrackets = p?.tratamiento?.toLowerCase().includes('bracket');
  const esAlin = p?.tratamiento?.toLowerCase().includes('alineador');

  // Solo mostrar puntos si asistió
  G('mev-brackets-opts').style.display = asistio && esBrackets ? 'block' : 'none';
  G('mev-alin-opts').style.display = asistio && esAlin ? 'block' : 'none';

  // Cambiar texto del resumen de puntos
  const puntosBox = G('mev-puntos-preview').parentElement;
  if (asistio) {
    puntosBox.style.display = 'block';
    actualizarPuntosPreview();
  } else {
    puntosBox.style.display = 'none';
  }

  om('modal-evolucion');
}

async function marcarRealizada(pid, cid) {
  await cambiarEstadoCita(pid, cid, 'realizada');
}

function abrirEvolucion(pid, cid, cita) {
  const p = PACS.find(x=>x.id===pid); if(!p) return;
  G('mev-pid').value = pid;
  G('mev-cid').value = cid || '';
  G('mev-notas').value = '';
  G('mev-higiene').checked = false;
  G('mev-sin-caidos').checked = false;
  G('mev-bracket-rep').checked = false;
  G('mev-cambio-fecha').checked = false;
  G('mev-msg').style.display = 'none';
  G('mev-elastico').value = '';
  initElasticoSelector();
  G('mev-paciente-info').innerHTML = `<strong style="color:var(--text);">${p.nombre}<\/strong> · ${p.tratamiento}${cita?` · ${cita.tipo} · ${cita.fecha}`:''}`;
  const esBrackets = p.tratamiento?.toLowerCase().includes('bracket');
  const esAlin = p.tratamiento?.toLowerCase().includes('alineador');
  G('mev-brackets-opts').style.display = esBrackets ? 'block' : 'none';
  G('mev-alin-opts').style.display = esAlin ? 'block' : 'none';
  actualizarPuntosPreview();
  om('modal-evolucion');
}

function actualizarTipoPago() {
  const tipo = G('mev-pago-tipo').value;
  const pid = G('mev-pid').value;
  const p = PACS.find(x=>x.id===pid);
  const campos = G('mev-pago-campos');
  const nota = G('mev-pago-nota');

  if(!tipo) { campos.style.display='none'; return; }
  campos.style.display='block';

  const pres = p?.presupuesto||{};
  const pagado = (pres.abonos||[]).reduce((s,a)=>s+a.monto,0);

  if(tipo==='inicial') {
    G('mev-pago-monto').value = pres.cuota_inicial||'';
    G('mev-pago-desc').value = 'Cuota inicial';
    nota.textContent = pres.cuota_inicial ? `Cuota inicial del presupuesto: ${COP(pres.cuota_inicial)}` : 'Sin cuota inicial configurada en el presupuesto';
    nota.style.display='block';
  } else if(tipo==='control') {
    G('mev-pago-monto').value = pres.valor_cuota||'';
    G('mev-pago-desc').value = 'Cuota mensual ' + new Date().toLocaleDateString('es-CO',{month:'long',year:'numeric'});
    nota.textContent = pres.valor_cuota ? `Valor de cuota mensual: ${COP(pres.valor_cuota)} · Pagado hasta ahora: ${COP(pagado)}` : 'Sin valor de cuota configurado';
    nota.style.display='block';
  } else if(tipo==='restauracion') {
    G('mev-pago-monto').value = '';
    G('mev-pago-desc').value = 'Restauración / procedimiento adicional';
    nota.textContent = '⚠️ Este pago NO se sumará al presupuesto del tratamiento — se registra como cobro independiente.';
    nota.style.display='block';
  } else {
    G('mev-pago-monto').value = '';
    G('mev-pago-desc').value = '';
    nota.style.display='none';
  }
}


function actualizarPuntosPreview() {
  let pts = 100;
  if(G('mev-higiene')?.checked) pts += 50;
  if(G('mev-sin-caidos')?.checked) pts += 50;
  if(G('mev-cambio-fecha')?.checked) pts += 50;
  G('mev-puntos-preview').innerHTML = `Total estimado: <strong style="color:var(--accent);">+${pts} pts<\/strong>`;
}

['mev-higiene','mev-sin-caidos','mev-cambio-fecha'].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', actualizarPuntosPreview);
});

G('btn-save-evolucion').addEventListener('click', async () => {
  const pid = G('mev-pid').value;
  const cid = G('mev-cid').value;
  const btn = G('btn-save-evolucion');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  const body = {
    cita_id: cid,
    notas: G('mev-notas').value,
    buena_higiene: G('mev-higiene').checked,
    sin_brackets_caidos: G('mev-sin-caidos').checked,
    cambio_alineador_en_fecha: G('mev-cambio-fecha').checked,
    bracket_reparado: G('mev-bracket-rep').checked,
    elastico: G('mev-elastico').value.trim() || null,
    num_alineador: G('mev-num-alineador') ? parseInt(G('mev-num-alineador').value)||null : null
  };
  const d = await apiPost(`/api/admin/pacientes/${pid}/evolucion`, body);
  btn.disabled = false; btn.textContent = 'Guardar evolución';
  if(d.ok) {
    // Marcar la cita como realizada al guardar (sin abrir modal de nuevo)
    if(cid) await cambiarEstadoCita(pid, cid, 'realizada', false);
    // Registrar pago si se ingresó monto
    const monto = parseFloat(G('mev-pago-monto').value)||0;
    const desc = G('mev-pago-desc').value || 'Pago en cita';
    let pagoOk = false;
    if(monto > 0) {
      const dp = await apiPost(`/api/admin/pacientes/${pid}/abono`, {monto, descripcion: desc});
      if(dp.ok) {
        pagoOk = true;
        // WhatsApp confirmación pago
        await apiPost('/api/admin/whatsapp/confirmacion-pago', {paciente_id: pid, monto, descripcion: desc});
      }
    }
    PACS = await apiGet('/api/admin/pacientes');
    cm('modal-evolucion');
    G('mev-pago-monto').value = '';
    G('mev-pago-desc').value = '';
    G('mev-pago-tipo').value = '';
    G('mev-pago-campos').style.display = 'none';
    const p = PACS.find(x=>x.id===pid);
    const cita = p?.citas?.find(c=>c.id===cid);
    const asistio = cita?.estado === 'realizada';
    if(p?.telefono && asistio) {
      const esInicio = cita?.tipo?.toLowerCase().includes('inicio');
      const wa = await apiPost('/api/admin/whatsapp/seguimiento', {paciente_id: pid, tipo: esInicio?'post-inicio':'post-control'});
      const notif = document.createElement('div');
      notif.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;background:#111820;border:1px solid rgba(0,210,140,0.3);border-radius:10px;padding:12px 18px;font-size:13px;color:#00d28c;z-index:999;';
      notif.innerHTML = `✅ Evolución guardada · +${d.puntos_ganados} pts${pagoOk?' · 💰 Pago registrado':''}${asistio?(wa.programado?' · ⏰ WA mañana':' · 💬 WA enviado'):''}`;
      document.body.appendChild(notif);
      setTimeout(()=>notif.remove(), 5000);
    } else {
      const notif = document.createElement('div');
      notif.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;background:#111820;border:1px solid rgba(0,210,140,0.3);border-radius:10px;padding:12px 18px;font-size:13px;color:#00d28c;z-index:999;';
      notif.innerHTML = `✅ Evolución registrada${pagoOk?' · 💰 Pago registrado':''}`;
      document.body.appendChild(notif);
      setTimeout(()=>notif.remove(), 3000);
    }
    renderFin();
  } else {
    G('mev-msg').textContent = 'Error: ' + (d.error||'No se pudo guardar');
    G('mev-msg').style.display = 'block';
  }
});

let _refPid = null, _refTipo = null;
function confirmarReferido(pid, tipo) {
  _refPid = pid; _refTipo = tipo;
  const p = PACS.find(x=>x.id===pid);
  const pts = tipo === 'inicia' ? 500 : 200;
  G('mref-title').textContent = tipo === 'inicia' ? 'Referido inició tratamiento' : 'Referido agendó consulta';
  G('mref-desc').textContent = `¿Confirmas que un referido de ${p?.nombre} ${tipo === 'inicia' ? 'inició tratamiento' : 'agendó consulta'}? Se agregarán +${pts} puntos a su cuenta.`;
  om('modal-referido');
}
G('btn-confirm-ref').addEventListener('click', async () => {
  if(!_refPid || !_refTipo) return;
  const d = await apiPost(`/api/admin/pacientes/${_refPid}/referido`, {tipo: _refTipo});
  cm('modal-referido');
  PACS = await apiGet('/api/admin/pacientes');
  const notif = document.createElement('div');
  notif.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;background:#111820;border:1px solid rgba(0,210,140,0.3);border-radius:10px;padding:12px 18px;font-size:13px;color:#00d28c;z-index:999;';
  notif.innerHTML = `✅ +${d.puntos_ganados} pts agregados`;
  document.body.appendChild(notif);
  setTimeout(()=>notif.remove(), 3000);
  _refPid = null; _refTipo = null;
});

async function elimCitaAll(pid, cid) {
  if(!confirm('¿Eliminar cita?')) return;
  await apiDel(`/api/admin/pacientes/${pid}/citas/${cid}`);
  PACS = await apiGet('/api/admin/pacientes'); renderCitasAll();
}

// NUEVO PACIENTE
G('btn-nuevo-p').addEventListener('click',()=>{
  G('mp-title').textContent='Nuevo paciente'; G('mp-id').value='';
  ['mp-nombre','mp-apellido','mp-email','mp-tel','mp-pass','mp-direccion'].forEach(id=>{ const el=G(id); if(el) el.value=''; });
  G('mp-err').style.display='none'; om('modal-p');
});

function editP(id) {
  const p=PACS.find(x=>x.id===id); if(!p) return;
  G('mp-title').textContent='Editar paciente'; G('mp-id').value=p.id;
  const partes=p.nombre.split(' ');
  if(G('mp-nombre')) G('mp-nombre').value=partes[0]||'';
  if(G('mp-apellido')) G('mp-apellido').value=partes.slice(1).join(' ')||'';
  if(G('mp-email')) G('mp-email').value=p.email;
  if(G('mp-tel')) G('mp-tel').value=p.telefono||'';
  if(G('mp-direccion')) G('mp-direccion').value=p.direccion||'';
  if(G('mp-pass')) G('mp-pass').value='';
  G('mp-err').style.display='none'; om('modal-p');
}

G('btn-save-p').addEventListener('click',async()=>{
  const id=G('mp-id').value;
  const apellido=G('mp-apellido')?.value.trim()||''; const nombreCompleto=(G('mp-nombre').value.trim()+' '+apellido).trim(); const cedula=G('mp-pass').value.trim(); const body={nombre:nombreCompleto,email:G('mp-email').value.trim(),telefono:G('mp-tel').value.trim(),direccion:G('mp-direccion')?.value.trim()||'',password:cedula,tratamiento:'Sin asignar',inicio:new Date().toISOString().split('T')[0],duracion:18,cambio_alineador_dias:null};
  if(!body.nombre||!body.email||!cedula){G('mp-err').textContent='Nombre, correo y cédula son obligatorios';G('mp-err').style.display='block';return;}
  const btn=G('btn-save-p'); btn.disabled=true; btn.innerHTML='<span class="spin"></span>';
  try {
    const d = id ? await apiPut(`/api/admin/pacientes/${id}`,body) : await apiPost('/api/admin/pacientes',body);
    if(d.error) throw new Error(d.error);
    PACS=await apiGet('/api/admin/pacientes'); cm('modal-p'); renderPacs(); renderDash();
    // Enviar bienvenida por WhatsApp si es paciente nuevo con teléfono
    if(!id && body.telefono) {
      const nuevo = PACS.find(x=>x.email===body.email);
      if(nuevo) {
        const wa = await apiPost('/api/admin/whatsapp/bienvenida', {paciente_id: nuevo.id});
        const notif = document.createElement('div');
        notif.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;background:#111820;border:1px solid rgba(0,210,140,0.3);border-radius:10px;padding:12px 18px;font-size:13px;color:#00d28c;z-index:999;';
        notif.innerHTML = wa.ok ? '✅ Paciente creado · 👋 Bienvenida enviada por WhatsApp' : '✅ Paciente creado · ⚠️ WhatsApp no enviado: ' + (wa.error||'');
        document.body.appendChild(notif);
        setTimeout(()=>notif.remove(), 5000);
      }
    }
  } catch(e) { G('mp-err').textContent=e.message; G('mp-err').style.display='block'; }
  btn.disabled=false; btn.textContent='Guardar';
});

// FINANZAS
function toggleAlineadorOpts() {
  const esAlin = G('mf-tipo') && G('mf-tipo').value.toLowerCase().includes('alineador');
  const opts = G('mf-alineador-opts');
  if(opts) opts.style.display = esAlin ? 'block' : 'none';
}

function calcCuota() {
  const total = parseFloat(G('mf-total-trat').value)||0;
  const ini = parseFloat(G('mf-cuota-inicial').value)||0;
  const n = parseInt(G('mf-num-cuotas').value)||0;
  const saldo = Math.max(0, total - ini);
  const cuota = n > 0 ? Math.ceil(saldo / n) : 0;
  G('mf-cuota-display').textContent = cuota > 0 ? COP(cuota) + ' / mes' : '$ 0 / mes';
  G('mf-resumen-total').textContent = COP(total);
  G('mf-resumen-inicial').textContent = COP(ini);
  G('mf-resumen-saldo').textContent = COP(saldo);
  G('mf-resumen-cuota').textContent = COP(cuota);
}

function abrirFin(id) {
  const p=PACS.find(x=>x.id===id); if(!p) return;
  G('mf-title').textContent='Presupuesto · '+p.nombre; G('mf-pid').value=id;
  const pres = p.presupuesto||{};
  G('mf-tipo').value = pres.tipo_ortodoncia || p.tratamiento || 'Brackets convencionales';
  G('mf-total-trat').value = pres.total || '';
  G('mf-cuota-inicial').value = pres.cuota_inicial || '';
  G('mf-num-cuotas').value = pres.num_cuotas || '';
  G('mf-notas').value = pres.notas || '';
  G('mf-inicio-alineador').value = pres.inicio_alineador || p.inicio_alineador || '';
  G('mf-cambio-superior').value = pres.cambio_dias_superior ?? p.cambio_dias_superior ?? pres.cambio_alineador_dias ?? p.cambio_alineador_dias ?? '';
  G('mf-cambio-inferior').value = pres.cambio_dias_inferior ?? p.cambio_dias_inferior ?? pres.cambio_alineador_dias ?? p.cambio_alineador_dias ?? '';
  G('mf-total-sup').value = p.total_alineadores_superior || p.total_alineadores || '';
  G('mf-total-inf').value = p.total_alineadores_inferior || p.total_alineadores || '';
  G('mf-actual-sup').value = p.num_alineador_actual_superior || '';
  G('mf-actual-inf').value = p.num_alineador_actual_inferior || '';
  G('mf-monto').value=''; G('mf-desc').value='';
  toggleAlineadorOpts();
  calcCuota();
  renderResumen(p);
  renderAbonos(p);
  om('modal-fin');
}

function renderResumen(p) {
  const pres = p.presupuesto||{};
  const pagado = (pres.abonos||[]).reduce((s,a)=>s+a.monto,0);
  const saldo = (pres.total||0) - pagado;
  const pct = pres.total > 0 ? Math.min(100,Math.round((pagado/pres.total)*100)) : 0;
  G('mf-resumen').innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <div style="flex:1;min-width:100px;background:var(--bg3);border-radius:var(--rs);padding:10px;text-align:center;">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px;">Total<\/div>
        <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:var(--warn);">${COP(pres.total||0)}<\/div>
      <\/div>
      <div style="flex:1;min-width:100px;background:var(--bg3);border-radius:var(--rs);padding:10px;text-align:center;">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px;">Pagado<\/div>
        <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:var(--accent);">${COP(pagado)}<\/div>
      <\/div>
      <div style="flex:1;min-width:100px;background:var(--bg3);border-radius:var(--rs);padding:10px;text-align:center;">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px;">Saldo<\/div>
        <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:${saldo>0?'var(--danger)':'var(--accent)'};">${COP(saldo)}<\/div>
      <\/div>
    <\/div>
    <div style="background:var(--bg3);border-radius:99px;height:6px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:99px;"><\/div>
    <\/div>
    <p style="font-size:12px;color:var(--text2);margin-top:4px;">${pct}% pagado<\/p>`;
}
function renderAbonos(p) {
  const lista=G('mf-lista'); lista.innerHTML='';
  const abonos=p.presupuesto?.abonos||[];
  if(!abonos.length){lista.innerHTML='<p class="text-muted">Sin abonos registrados</p>';return;}
  abonos.forEach(a=>{
    lista.innerHTML+=`<div class="abono-row">
      <div><strong style="color:var(--accent);">${COP(a.monto)}<\/strong><br><span style="font-size:12px;color:var(--text2);">${a.descripcion} · ${a.fecha}<\/span><\/div>
      <button class="btn btn-sm btn-danger" onclick="elimAbono('${p.id}','${a.id}')">✕<\/button>
    <\/div>`;
  });
}
G('btn-save-presup').addEventListener('click',async()=>{
  const id=G('mf-pid').value;
  const total = parseFloat(G('mf-total-trat').value)||0;
  const ini = parseFloat(G('mf-cuota-inicial').value)||0;
  const n = parseInt(G('mf-num-cuotas').value)||0;
  const saldo = Math.max(0, total - ini);
  const cuota = n > 0 ? Math.ceil(saldo / n) : 0;
  const esAlin = G('mf-tipo').value.toLowerCase().includes('alineador');
  const body = {
    total,
    tipo_ortodoncia: G('mf-tipo').value,
    cuota_inicial: ini,
    num_cuotas: n,
    valor_cuota: cuota,
    notas: G('mf-notas').value,
    cambio_alineador_dias: esAlin ? (parseInt(G('mf-cambio-superior').value) || parseInt(G('mf-cambio-inferior').value) || null) : null,
    cambio_dias_superior: esAlin ? parseInt(G('mf-cambio-superior').value)||null : null,
    cambio_dias_inferior: esAlin ? parseInt(G('mf-cambio-inferior').value)||null : null,
    inicio_alineador: esAlin ? (G('mf-inicio-alineador').value || null) : null,
    total_alineadores_superior: esAlin ? parseInt(G('mf-total-sup').value)||null : null,
    total_alineadores_inferior: esAlin ? parseInt(G('mf-total-inf').value)||null : null,
    num_alineador_actual_superior: esAlin ? parseInt(G('mf-actual-sup').value)||null : null,
    num_alineador_actual_inferior: esAlin ? parseInt(G('mf-actual-inf').value)||null : null
  };
  const d=await apiPut(`/api/admin/pacientes/${id}/presupuesto`, body);
  if(d.ok){
    // Actualizar tratamiento del paciente con el tipo de ortodoncia
    await apiPut(`/api/admin/pacientes/${id}`, { tratamiento: body.tipo_ortodoncia });
    PACS=await apiGet('/api/admin/pacientes');
    renderResumen(PACS.find(x=>x.id===id));
    renderFin();
    // Borrar localStorage para que el banner reaparezca con los tips correctos
    localStorage.removeItem('bienvenida_'+id);
    const notif=document.createElement('div');
    notif.style.cssText='position:fixed;bottom:1.5rem;right:1.5rem;background:#111820;border:1px solid rgba(0,210,140,0.3);border-radius:10px;padding:12px 18px;font-size:13px;color:#00d28c;z-index:999;';
    notif.innerHTML='✅ Presupuesto guardado · 🦷 Tratamiento asignado al paciente';
    document.body.appendChild(notif);
    setTimeout(()=>notif.remove(),4000);
  }
});
G('btn-abono').addEventListener('click',async()=>{
  const id=G('mf-pid').value; const monto=G('mf-monto').value; const desc=G('mf-desc').value;
  if(!monto){alert('Ingresa el monto');return;}
  const d=await apiPost(`/api/admin/pacientes/${id}/abono`,{monto:parseFloat(monto),descripcion:desc});
  if(d.ok){
    PACS=await apiGet('/api/admin/pacientes');
    G('mf-monto').value=''; G('mf-desc').value='';
    const p=PACS.find(x=>x.id===id);
    renderResumen(p); renderAbonos(p); renderFin();
    // Enviar WhatsApp de confirmación de pago
    const wa=await apiPost('/api/admin/whatsapp/confirmacion-pago',{paciente_id:id,monto:parseFloat(monto),descripcion:desc});
    const notif=document.createElement('div');
    notif.style.cssText='position:fixed;bottom:1.5rem;right:1.5rem;background:#111820;border:1px solid rgba(0,210,140,0.3);border-radius:10px;padding:12px 18px;font-size:13px;color:#00d28c;z-index:999;';
    notif.innerHTML = wa.ok ? '✅ Pago registrado · 💬 Confirmación enviada por WhatsApp' : '✅ Pago registrado · ⚠️ WhatsApp no enviado';
    document.body.appendChild(notif);
    setTimeout(()=>notif.remove(),4000);
  }
});
async function elimAbono(pid,abId) {
  if(!confirm('¿Eliminar este abono?')) return;
  await apiDel(`/api/admin/pacientes/${pid}/abono/${abId}`);
  PACS=await apiGet('/api/admin/pacientes'); renderAbonos(PACS.find(x=>x.id===pid)); renderFin();
}

// CITAS
function abrirFotoCita(pid) {
  const p = PACS.find(x=>x.id===pid); if(!p) return;
  G('mf2-pid').value = pid;
  G('mf2-file').value = '';
  G('mf2-nota').value = '';
  const sel = G('mf2-cita'); sel.innerHTML = '<option value="">— Selecciona la cita —</option>';
  const citas = [...(p.citas||[])].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  citas.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = FMT(c.fecha) + ' · ' + c.tipo + (c.estado==='realizada'?' ✅':'');
    sel.appendChild(opt);
  });
  om('modal-foto');
}

G('btn-save-foto2').addEventListener('click', async () => {
  const pid = G('mf2-pid').value;
  const file = G('mf2-file').files[0];
  const nota = G('mf2-nota').value;
  if(!file){ alert('Selecciona una foto'); return; }
  const btn = G('btn-save-foto2'); btn.disabled=true; btn.textContent='Subiendo...';
  const fd = new FormData();
  fd.append('foto', file);
  fd.append('nota', nota);
  const r = await fetch(`/api/admin/pacientes/${pid}/progreso`, {method:'POST', headers:{'Authorization':'Bearer '+TOKEN}, body:fd});
  const d = await r.json();
  btn.disabled=false; btn.textContent='Guardar foto';
  if(d.ok){ PACS=await apiGet('/api/admin/pacientes'); cm('modal-foto'); alert('✅ Foto guardada'); }
});

function abrirCita(pid, nombre) {
  // Desde pacientes - paciente fijo
  G('mc-pid').value=pid;
  G('mc-pnombre').value=nombre;
  G('mc-pnombre').style.display='block';
  G('mc-paciente-select').style.display='none';
  G('mc-fecha').value=new Date().toISOString().split('T')[0];
  G('mc-hora').value='09:00';
  om('modal-cita');
}

G('btn-nueva-cita-direct').addEventListener('click', () => {
  // Desde citas - selector de paciente
  G('mc-pid').value='';
  G('mc-pnombre').style.display='none';
  G('mc-paciente-select').style.display='block';
  // Llenar selector con pacientes
  const sel = G('mc-paciente-select');
  sel.innerHTML = '<option value="">— Selecciona paciente —</option>';
  PACS.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.nombre;
    sel.appendChild(opt);
  });
  G('mc-fecha').value=new Date().toISOString().split('T')[0];
  G('mc-hora').value='09:00';
  om('modal-cita');
});
function updateVirtualToggle() {
  const v = document.getElementById('mc-virtual')?.checked;
  const track = document.getElementById('mc-vtrack');
  const thumb = document.getElementById('mc-vthumb');
  if(track) track.style.background = v ? 'var(--accent)' : '#1e293b';
  if(thumb) thumb.style.transform = v ? 'translateX(20px)' : 'translateX(0)';
}

G('btn-save-cita').addEventListener('click',async()=>{
  const pid = G('mc-pid').value || G('mc-paciente-select').value;
  if(!pid){ alert('Selecciona un paciente'); return; }
  const fecha=G('mc-fecha').value, hora=G('mc-hora').value, tipo=G('mc-tipo').value;
  const duracion=parseInt(G('mc-duracion').value)||30;
  const virtual = document.getElementById('mc-virtual')?.checked || false;
  if(!fecha||!hora) { alert('Completa fecha y hora'); return; }

  const btn = G('btn-save-cita');
  btn.disabled = true;
  btn.innerHTML = virtual ? '⏳ Creando sala...' : '⏳ Agendando...';

  const d=await apiPost(`/api/admin/pacientes/${pid}/citas`,{fecha,hora,tipo,duracion,virtual});
  btn.disabled = false;
  btn.textContent = 'Agendar';

  if(d.ok){
    PACS=await apiGet('/api/admin/pacientes');
    cm('modal-cita');
    // Resetear toggle
    const vcb = document.getElementById('mc-virtual');
    if(vcb) { vcb.checked = false; updateVirtualToggle(); }
    renderPacs(); renderCalendario();
    const notif=document.createElement('div');
    notif.style.cssText='position:fixed;bottom:1.5rem;right:1.5rem;background:#0d1a0d;border:1px solid rgba(0,210,140,0.4);border-radius:12px;padding:14px 18px;font-size:13px;color:#00d28c;z-index:999;max-width:320px;';
    if(virtual && d.sala_url) {
      notif.innerHTML='✅ Cita virtual agendada · 🎥 Sala creada · 📱 WhatsApp enviado al paciente';
    } else {
      notif.innerHTML='✅ Cita agendada · 📱 WhatsApp enviado al paciente';
    }
    document.body.appendChild(notif);
    setTimeout(()=>notif.remove(),5000);
  }
});

// FOTOS
function abrirFoto(pid) {
  G('mfoto-pid').value=pid; fotoFile=null; G('foto-fname').textContent='Haz clic o arrastra la foto'; G('foto-nota').value=''; G('foto-msg').style.display='none'; om('modal-foto');
}
G('foto-file').addEventListener('change',e=>{ fotoFile=e.target.files[0]; if(fotoFile) G('foto-fname').textContent=fotoFile.name; });
G('btn-save-foto').addEventListener('click',async()=>{
  if(!fotoFile){alert('Selecciona una foto');return;}
  const pid=G('mfoto-pid').value;
  const btn=G('btn-save-foto'); btn.disabled=true; btn.innerHTML='<span class="spin"></span>';
  const fd=new FormData(); fd.append('foto',fotoFile); fd.append('nota',G('foto-nota').value);
  const r=await fetch(`/api/admin/pacientes/${pid}/progreso`,{method:'POST',headers:{'Authorization':'Bearer '+TOKEN},body:fd});
  const d=await r.json();
  btn.disabled=false; btn.textContent='Subir foto';
  if(d.ok){ PACS=await apiGet('/api/admin/pacientes'); G('foto-msg').textContent='✓ Foto subida'; G('foto-msg').style.color='var(--accent)'; G('foto-msg').style.display='block'; fotoFile=null; G('foto-fname').textContent='Haz clic o arrastra la foto'; }
  else { G('foto-msg').textContent='Error: '+d.error; G('foto-msg').style.color='var(--danger)'; G('foto-msg').style.display='block'; }
});

// USUARIOS
async function loadUsers() {
  const data=await apiGet('/api/admin/usuarios');
  const tbody=G('tbody-u'); tbody.innerHTML='';
  data.forEach(u=>{ tbody.innerHTML+=`<tr><td>${u.nombre}<\/td><td>${u.email}<\/td><td><span class="trat-b tb-otro">Admin<\/span><\/td><\/tr>`; });
}
G('btn-nuevo-u').addEventListener('click',()=>{ ['mu-nombre','mu-email','mu-pass'].forEach(id=>G(id).value=''); G('mu-err').style.display='none'; om('modal-usr'); });
G('btn-save-usr').addEventListener('click',async()=>{
  const d=await apiPost('/api/admin/usuarios',{nombre:G('mu-nombre').value,email:G('mu-email').value,password:G('mu-pass').value});
  if(d.ok){ cm('modal-usr'); loadUsers(); }
  else { G('mu-err').textContent=d.error; G('mu-err').style.display='block'; }
});

async function enviarWA(pid, tipo) {
  const p = PACS.find(x=>x.id===pid);
  const labels = {'bienvenida':'bienvenida','cambio-alineador':'recordatorio de cambio','seguimiento':'seguimiento post-cita'};
  if(!confirm(`¿Enviar mensaje de ${labels[tipo]||tipo} a ${p?.nombre} por WhatsApp?`)) return;
  const urls = {'bienvenida':'/api/admin/whatsapp/bienvenida','cambio-alineador':'/api/admin/whatsapp/cambio-alineador','seguimiento':'/api/admin/whatsapp/seguimiento'};
  const body = tipo==='seguimiento'?{paciente_id:pid,tipo:'post-control'}:{paciente_id:pid};
  const d = await apiPost(urls[tipo], body);
  if(d.ok) alert('✅ Mensaje enviado por WhatsApp');
  else alert('❌ Error: '+(d.error||'No se pudo enviar'));
}

// == CALENDARIO ==
let calSemana = 0;

function getLunesSemana(offset) {
  const hoy = new Date();
  const dia = hoy.getDay(); // 0=dom, 1=lun...
  const diff = dia === 0 ? -6 : 1 - dia;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() + diff + (offset * 7));
  lunes.setHours(0,0,0,0);
  return lunes;
}

function fmtFechaCorta(d) {
  return d.toLocaleDateString('es-CO',{weekday:'short',day:'numeric',month:'short'});
}

function renderCalendario() {
  const lunes = getLunesSemana(calSemana);
  const viernes = new Date(lunes); viernes.setDate(lunes.getDate()+4);
  G('cal-titulo').textContent = fmtFechaCorta(lunes) + ' — ' + fmtFechaCorta(viernes);

  const dias = Array.from({length:5}, (_,i) => { const d=new Date(lunes); d.setDate(lunes.getDate()+i); return d; });
  const horas = [];
  for(let h=8; h<18; h++) {
    horas.push(h+':00');
    horas.push(h+':15');
    horas.push(h+':30');
    horas.push(h+':45');
  }

  // Recopilar todas las citas de la semana
  const todasCitas = [];
  PACS.forEach(p => (p.citas||[]).forEach(c => todasCitas.push({...c, pacNombre:p.nombre, pacId:p.id})));

  // Header
  const header = G('cal-header');
  header.innerHTML = '<div style="font-size:11px;color:var(--text3);padding:4px 0;"></div>';
  dias.forEach(d => {
    const esHoy = d.toDateString() === new Date().toDateString();
    header.innerHTML += `<div style="text-align:center;padding:6px 4px;font-size:12px;font-weight:${esHoy?'700':'400'};color:${esHoy?'var(--accent)':'var(--text2)'};background:${esHoy?'rgba(0,210,140,0.08)':'var(--bg3)'};border-radius:var(--rs);">
      ${d.toLocaleDateString('es-CO',{weekday:'short'}).toUpperCase()}<br><span style="font-size:16px;font-family:'Syne',sans-serif;font-weight:800;">${d.getDate()}<\/span>
    <\/div>`;
  });

  // Body
  const body = G('cal-body');
  body.innerHTML = '';

  horas.forEach(hora => {
    // Columna de hora
    const [h,m] = hora.split(':').map(Number);
    body.innerHTML += '<div style="font-size:10px;color:var(--text3);padding:4px 2px;text-align:right;padding-right:8px;height:16px;display:flex;align-items:center;justify-content:flex-end;">' + (m===0?hora:'') + '<' + '/div>';

    dias.forEach(dia => {
      const fechaStr = dia.toISOString().split('T')[0];
      // Buscar citas en este slot
      const citasSlot = todasCitas.filter(c => {
        if(c.fecha !== fechaStr) return false;
        const [ch, cm2] = c.hora.split(':').map(Number);
        const inicioMin = ch*60+cm2;
        const finMin = inicioMin + (c.duracion||30);
        const slotMin = h*60+m;
        return slotMin >= inicioMin && slotMin < finMin;
      });

      const esInicio = citasSlot.length > 0 && (() => {
        const [ch,cm2] = citasSlot[0].hora.split(':').map(Number);
        return ch===h && cm2===m;
      })();

      const esOcupado = citasSlot.length > 0;
      const colores = {'realizada':'rgba(0,210,140,0.2)','no_asistio':'rgba(255,79,107,0.2)','cancelada':'rgba(245,166,35,0.15)'};
      const bgColor = esOcupado ? (colores[citasSlot[0].estado] || 'rgba(79,163,255,0.2)') : 'var(--bg3)';
      const borderColor = esOcupado ? (citasSlot[0].estado==='realizada'?'var(--accent)':citasSlot[0].estado==='no_asistio'?'var(--danger)':'var(--info)') : 'var(--border)';

      if(esInicio) {
        const c = citasSlot[0];
        body.innerHTML += `<div onclick="abrirDetalleCita('${c.pacId}','${c.id}')" style="height:16px;background:${bgColor};border-left:2px solid ${borderColor};border-radius:0 var(--rs) var(--rs) 0;padding:1px 6px;cursor:pointer;overflow:hidden;">
          <div style="font-size:10px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.pacNombre.split(' ')[0]} · ${c.tipo.split(' ').slice(0,2).join(' ')}<\/div>
        <\/div>`;
      } else if(esOcupado) {
        body.innerHTML += `<div style="height:16px;background:${bgColor};border-left:2px solid ${borderColor};opacity:0.5;"><\/div>`;
      } else {
        body.innerHTML += `<div onclick="citaRapida('${fechaStr}','${hora}')" style="height:16px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--rs);cursor:pointer;transition:background .1s;" onmouseover="this.style.background='rgba(0,210,140,0.05)'" onmouseout="this.style.background='var(--bg3)'"><\/div>`;
      }
    });
  });
}

function citaRapida(fecha, hora) {
  G('mc-pid').value='';
  G('mc-pnombre').style.display='none';
  G('mc-paciente-select').style.display='block';
  const sel = G('mc-paciente-select');
  sel.innerHTML = '<option value="">— Selecciona paciente —</option>';
  PACS.forEach(p => { const opt=document.createElement('option'); opt.value=p.id; opt.textContent=p.nombre; sel.appendChild(opt); });
  G('mc-fecha').value = fecha;
  // Asegurar formato HH:MM para el input time
  const [hh, mm] = hora.split(':');
  G('mc-hora').value = hh.padStart(2,'0') + ':' + (mm||'00').padStart(2,'0');
  om('modal-cita');
}

function abrirDetalleCita(pid, cid) {
  const p = PACS.find(x=>x.id===pid);
  const c = p?.citas?.find(x=>x.id===cid);
  if(!p||!c) return;
  const det = G('cal-dia-detalle');
  G('cal-dia-titulo').textContent = p.nombre + ' · ' + c.tipo + ' · ' + FMT(c.fecha) + ' ' + c.hora;
  const estados = {'realizada':'✅ Realizada','proxima':'📅 Próxima','programada':'📅 Programada','no_asistio':'❌ No asistió','cancelada':'🔄 Cancelada'};
  G('cal-dia-citas').innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:10px 0;">
      <span style="font-size:13px;color:var(--text2);">Estado: <strong style="color:var(--text);">${estados[c.estado]||c.estado}<\/strong><\/span>
      <span style="font-size:13px;color:var(--text2);">Duración: <strong style="color:var(--text);">${c.duracion||30} min<\/strong><\/span>
      ${c.notas_clinicas?`<span style="font-size:13px;color:var(--text2);">Notas: <strong style="color:var(--text);">${c.notas_clinicas}</strong></span>`:''}
    <\/div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${c.estado!=='realizada'&&c.estado!=='no_asistio'&&c.estado!=='cancelada'?`
        <button class="btn btn-sm btn-acc" onclick="G('cal-dia-detalle').style.display='none';abrirEvolucionCita('${pid}','${cid}','realizada');">✅ Registrar asistencia</button>
        <button class="btn btn-sm btn-danger" onclick="cambiarEstadoCita('${pid}','${cid}','no_asistio',false);G('cal-dia-detalle').style.display='none';">❌ No asistió</button>
        <button class="btn btn-sm" onclick="cambiarEstadoCita('${pid}','${cid}','cancelada',false);G('cal-dia-detalle').style.display='none';">🔄 Canceló</button>
      `:''}
      ${c.estado==='realizada'?`<button class="btn btn-sm btn-acc" onclick="G('cal-dia-detalle').style.display='none';abrirEvolucionCita('${pid}','${cid}','realizada');">📋 Ver evolución<\/button>`:''}
      <button class="btn btn-sm" onclick="G('cal-dia-detalle').style.display='none';">Cerrar<\/button>
    <\/div>`;
  det.style.display = 'block';
  det.scrollIntoView({behavior:'smooth',block:'nearest'});
}

G('cal-prev').addEventListener('click',()=>{ calSemana--; renderCalendario(); });
G('cal-next').addEventListener('click',()=>{ calSemana++; renderCalendario(); });
G('cal-hoy').addEventListener('click',()=>{ calSemana=0; renderCalendario(); });


if(TOKEN) {
  fetch('/api/admin/pacientes',{headers:{'Authorization':'Bearer '+TOKEN}})
    .then(r=>r.ok?r.json():Promise.reject())
    .then(data=>{ USER={nombre:'Admin'}; PACS=data; showApp(); })
    .catch(()=>{ localStorage.removeItem('ortho_admin_token'); TOKEN=null; });
}

if(TOKEN) {
}

if(TOKEN) {
  fetch('/api/admin/pacientes',{headers:{'Authorization':'Bearer '+TOKEN}})
    .then(r=>r.ok?r.json():Promise.reject())
    .then(data=>{ USER={nombre:'Admin'}; PACS=data; showApp(); })
    .catch(()=>{ localStorage.removeItem('ortho_admin_token'); TOKEN=null; });
}
// ─── SELECTOR VISUAL DE ELÁSTICOS (multi-elástico) ───────────────────────────

const COLORES_ELASTICO = ['#E24B4A','#1D9E75','#EF9F27','#7F77DD'];

const DIENTE_CENTROS = {
  '17':{x:128,y:155},'16':{x:173,y:150},'15':{x:215,y:145},
  '14':{x:251,y:140},'13':{x:285,y:132},'12':{x:314,y:129},
  '11':{x:342,y:126},'21':{x:372,y:126},'22':{x:400,y:129},
  '23':{x:428,y:132},'24':{x:461,y:140},'25':{x:494,y:145},
  '26':{x:533,y:150},'27':{x:573,y:155},
  '47':{x:128,y:282},'46':{x:173,y:284},'45':{x:215,y:281},
  '44':{x:251,y:277},'43':{x:285,y:277},'42':{x:314,y:278},
  '41':{x:342,y:276},'31':{x:372,y:276},'32':{x:400,y:278},
  '33':{x:428,y:277},'34':{x:461,y:277},'35':{x:494,y:281},
  '36':{x:533,y:284},'37':{x:573,y:282}
};

const DIENTE_ZONAS = {
  '17':{x:108,y:130,w:40,h:50},'16':{x:152,y:122,w:42,h:56},
  '15':{x:198,y:118,w:34,h:55},'14':{x:235,y:112,w:32,h:56},
  '13':{x:270,y:100,w:30,h:65},'12':{x:302,y:98,w:24,h:62},
  '11':{x:328,y:93,w:28,h:66},'21':{x:358,y:93,w:28,h:66},
  '22':{x:388,y:98,w:24,h:62},'23':{x:414,y:100,w:28,h:65},
  '24':{x:447,y:112,w:28,h:56},'25':{x:479,y:118,w:31,h:55},
  '26':{x:514,y:122,w:38,h:56},'27':{x:556,y:130,w:34,h:50},
  '47':{x:108,y:262,w:40,h:40},'46':{x:152,y:263,w:42,h:42},
  '45':{x:198,y:262,w:34,h:39},'44':{x:235,y:259,w:32,h:37},
  '43':{x:270,y:255,w:30,h:44},'42':{x:302,y:257,w:24,h:42},
  '41':{x:328,y:255,w:28,h:43},'31':{x:358,y:255,w:28,h:43},
  '32':{x:388,y:257,w:24,h:42},'33':{x:414,y:255,w:28,h:44},
  '34':{x:447,y:259,w:28,h:37},'35':{x:479,y:262,w:31,h:39},
  '36':{x:514,y:263,w:38,h:42},'37':{x:556,y:262,w:34,h:40}
};

let ELASTICOS = [[],[],[],[]];
let ELASTICO_ACTIVO = 0;

function initElasticoSelector() {
  ELASTICOS = [[],[],[],[]];
  ELASTICO_ACTIVO = 0;
  renderTabs();
  renderElasticoSVG();
  actualizarResumen();
}

function setElasticoActivo(idx) {
  ELASTICO_ACTIVO = idx;
  renderTabs();
  renderElasticoSVG();
}

function renderTabs() {
  const tabs = G('elastico-tabs');
  if (!tabs) return;
  tabs.innerHTML = ['Elástico 1','Elástico 2','Elástico 3','Elástico 4'].map((n, i) => {
    const activo = i === ELASTICO_ACTIVO;
    const c = COLORES_ELASTICO[i];
    const conf = ELASTICOS[i].length > 0;
    return `<button type="button" onclick="setElasticoActivo(${i})"
      style="font-size:11px;padding:4px 12px;border-radius:20px;border:2px solid ${c};
      background:${activo ? c : 'transparent'};color:${activo ? '#fff' : c};
      cursor:pointer;font-weight:600;">${conf?'✅ ':''}${n}</button>`;
  }).join('');
  const inst = G('elastico-instruccion');
  if (inst) inst.innerHTML = `Selecciona los dientes del <strong style="color:${COLORES_ELASTICO[ELASTICO_ACTIVO]};">Elástico ${ELASTICO_ACTIVO+1}</strong> y presiona ✅ Confirmar.`;
}

// Genera el path del polígono del elástico (forma de caja)
// Ordena superiores de izq a der, inferiores de der a izq para cerrar el polígono
function elasticoPoligono(dientes, color) {
  const sup = dientes.filter(d => parseInt(d) <= 27)
    .sort((a,b) => DIENTE_CENTROS[a].x - DIENTE_CENTROS[b].x);
  const inf = dientes.filter(d => parseInt(d) >= 31)
    .sort((a,b) => DIENTE_CENTROS[b].x - DIENTE_CENTROS[a].x); // reverso para cerrar caja

  if (!sup.length || !inf.length) return '';

  // Puntos del polígono: sup izq→der, luego inf der→izq
  const puntos = [...sup, ...inf].map(id => {
    const c = DIENTE_CENTROS[id];
    return `${c.x},${c.y}`;
  }).join(' ');

  return `<polygon points="${puntos}" fill="${color}20" stroke="${color}" 
    stroke-width="2.5" stroke-dasharray="8,4" stroke-linejoin="round" opacity="0.9"/>`;
}

function renderElasticoSVG() {
  const el = G('elastico-selector');
  if (!el) return;

  let poligonos = '', highlights = '', clicks = '';

  ELASTICOS.forEach((dientes, idx) => {
    if (!dientes.length) return;
    const c = COLORES_ELASTICO[idx];
    poligonos += elasticoPoligono(dientes, c);
    dientes.forEach(id => {
      const z = DIENTE_ZONAS[id]; if (!z) return;
      highlights += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="3"
        fill="${c}44" stroke="${c}" stroke-width="2" pointer-events="none"/>`;
    });
  });

  Object.entries(DIENTE_ZONAS).forEach(([id, z]) => {
    clicks += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="3"
      fill="transparent" style="cursor:pointer;" onclick="toggleDiente('${id}')"/>`;
  });

  el.innerHTML = `<svg width="100%" viewBox="0 0 680 360" style="display:block;border-radius:8px;">
    <image href="/diagrama_elasticos.svg" x="0" y="0" width="680" height="520"/>
    ${poligonos}${highlights}${clicks}
  </svg>`;

  actualizarEstadoElastico();
}

function toggleDiente(id) {
  const arr = ELASTICOS[ELASTICO_ACTIVO];
  const idx = arr.indexOf(id);
  if (idx === -1) arr.push(id); else arr.splice(idx, 1);
  renderElasticoSVG();
}

function confirmarElasticoActual() {
  const arr = ELASTICOS[ELASTICO_ACTIVO];
  if (!arr.length) { alert('Selecciona al menos un diente'); return; }
  const sup = arr.filter(d => parseInt(d) <= 27);
  const inf = arr.filter(d => parseInt(d) >= 31);
  if (!sup.length || !inf.length) { alert('Selecciona dientes de ambas arcadas'); return; }
  if (ELASTICO_ACTIVO < 3) setElasticoActivo(ELASTICO_ACTIVO + 1);
  actualizarResumen();
}

function limpiarElasticoActual() {
  ELASTICOS[ELASTICO_ACTIVO] = [];
  renderElasticoSVG();
  actualizarResumen();
}

function actualizarEstadoElastico() {
  const estado = G('mev-elastico-estado'); if (!estado) return;
  const arr = ELASTICOS[ELASTICO_ACTIVO];
  const sup = arr.filter(d => parseInt(d) <= 27).sort();
  const inf = arr.filter(d => parseInt(d) >= 31).sort();
  if (!arr.length) estado.innerHTML = '<span style="color:var(--text3);">Ningún diente seleccionado</span>';
  else if (!sup.length) estado.innerHTML = '<span style="color:#EF9F27;">⚠️ Falta diente superior</span>';
  else if (!inf.length) estado.innerHTML = '<span style="color:#EF9F27;">⚠️ Falta diente inferior</span>';
  else estado.innerHTML = `<span style="color:${COLORES_ELASTICO[ELASTICO_ACTIVO]};">✅ ${sup.join(',')} → ${inf.join(',')}</span>`;
}

function actualizarResumen() {
  const res = G('elastico-resumen');
  const input = G('mev-elastico');
  if (!res) return;
  const confirmados = ELASTICOS.map((arr, i) => {
    const sup = arr.filter(d => parseInt(d) <= 27).sort();
    const inf = arr.filter(d => parseInt(d) >= 31).sort();
    if (!sup.length || !inf.length) return null;
    return { idx: i, texto: `${sup.join(',')} → ${inf.join(',')}` };
  }).filter(Boolean);
  if (!confirmados.length) { res.innerHTML = ''; if(input) input.value = ''; return; }
  res.innerHTML = '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;">Elásticos confirmados:</div>' +
    confirmados.map(c => {
      const col = COLORES_ELASTICO[c.idx];
      return `<span style="display:inline-flex;align-items:center;gap:5px;background:${col}22;
        border:1px solid ${col};border-radius:20px;padding:3px 10px;font-size:11px;
        color:${col};font-weight:600;margin:2px;">
        E${c.idx+1}: ${c.texto}
        <span onclick="eliminarElasticoConfirmado(${c.idx})" style="cursor:pointer;opacity:0.7;">✕</span>
      </span>`;
    }).join('');
  if (input) input.value = confirmados.map(c => c.texto).join(' | ');
}

function eliminarElasticoConfirmado(idx) {
  ELASTICOS[idx] = [];
  setElasticoActivo(idx);
  actualizarResumen();
  renderElasticoSVG();
}

// SVG miniatura del elástico para el historial de evoluciones
function generarSVGElasticoMini(texto) {
  const centros = {
    '17':{x:128,y:155},'16':{x:173,y:150},'15':{x:215,y:145},
    '14':{x:251,y:140},'13':{x:285,y:132},'12':{x:314,y:129},
    '11':{x:342,y:126},'21':{x:372,y:126},'22':{x:400,y:129},
    '23':{x:428,y:132},'24':{x:461,y:140},'25':{x:494,y:145},
    '26':{x:533,y:150},'27':{x:573,y:155},
    '47':{x:128,y:282},'46':{x:173,y:284},'45':{x:215,y:281},
    '44':{x:251,y:277},'43':{x:285,y:277},'42':{x:314,y:278},
    '41':{x:342,y:276},'31':{x:372,y:276},'32':{x:400,y:278},
    '33':{x:428,y:277},'34':{x:461,y:277},'35':{x:494,y:281},
    '36':{x:533,y:284},'37':{x:573,y:282}
  };
  const COLORES = ['#E24B4A','#1D9E75','#EF9F27','#7F77DD'];

  const elasticos = texto.split('|').map(e=>e.trim()).filter(Boolean);
  let poligonos = '', circulos = '';

  elasticos.forEach((t, idx) => {
    const color = COLORES[idx % COLORES.length];
    const partes = t.replace(/→|->|>/g,'|').split('|');
    const sup = (partes[0]||'').split(',').map(x=>x.trim()).filter(Boolean)
      .sort((a,b)=>(centros[a]||{x:0}).x-(centros[b]||{x:0}).x);
    const inf = (partes[1]||'').split(',').map(x=>x.trim()).filter(Boolean)
      .sort((a,b)=>(centros[b]||{x:0}).x-(centros[a]||{x:0}).x);
    if (!sup.length||!inf.length) return;
    const pts = [...sup,...inf].map(id=>{const c=centros[id];return c?`${c.x},${c.y}`:null;}).filter(Boolean).join(' ');
    poligonos+=`<polygon points="${pts}" fill="${color}20" stroke="${color}" stroke-width="2.5" stroke-dasharray="6,3" opacity="0.9"/>`;
    [...sup,...inf].forEach(id=>{const c=centros[id];if(!c)return;circulos+=`<circle cx="${c.x}" cy="${c.y}" r="7" fill="${color}44" stroke="${color}" stroke-width="2"/>`;});
  });

  return `<svg width="100%" viewBox="0 0 680 360" style="border-radius:6px;max-height:120px;display:block;">
    <image href="/diagrama_elasticos.svg" x="0" y="0" width="680" height="520"/>
    ${poligonos}${circulos}
  </svg>`;
}

// ═══════════════════════════════════════════════════════
// MÓDULO PROPUESTAS
// ═══════════════════════════════════════════════════════
let propuestaTokenActual = null;
let pacienteWspActual = null;

document.addEventListener('DOMContentLoaded', () => {
  const btnNueva = document.getElementById('btn-nueva-propuesta');
  if (btnNueva) btnNueva.addEventListener('click', () => {
    limpiarFormPropuesta();
    document.getElementById('modal-propuesta').style.display = 'block';
  });

  const btnGuardar = document.getElementById('btn-guardar-propuesta');
  if (btnGuardar) btnGuardar.addEventListener('click', crearPropuesta);
});

function limpiarFormPropuesta() {
  ['pp-nombre','pp-tel','pp-notas'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['pp-dur'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '18'; });
  ['pp-total','pp-inicial','pp-mensual'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const err = document.getElementById('pp-error');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
}

async function cargarPropuestas() {
  const tbody = document.getElementById('tbody-propuestas');
  if (!tbody) return;
  try {
    const lista = await apiGet('/api/admin/propuestas');
    if (!lista || lista.error) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text2)">No hay propuestas aún</td></tr>'; return; }
    tbody.innerHTML = lista.length === 0
      ? '<tr><td colspan="5" style="text-align:center;color:var(--text2)">No hay propuestas aún. Crea la primera.</td></tr>'
      : lista.reverse().map(p => {
        const expirada = new Date() > new Date(p.expira);
        const estado = p.estado === 'aceptada' ? '<span style="color:#00e5a0;font-weight:600">✅ Aceptada</span>'
          : expirada ? '<span style="color:#ff6b6b">⏰ Expirada</span>'
          : '<span style="color:#f5a623">⏳ Pendiente</span>';
        const expiraFmt = new Date(p.expira).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
        const link = `${location.origin}/propuesta/${p.token}`;
        return `<tr>
          <td>${p.nombre}</td>
          <td style="font-size:12px;color:var(--text2)">${p.tratamiento}</td>
          <td>${estado}</td>
          <td style="font-size:12px;color:var(--text2)">${expiraFmt}</td>
          <td>
            <button onclick="navigator.clipboard.writeText('${link}').then(()=>alert('Link copiado'))" class="btn" style="font-size:11px;padding:4px 10px;background:rgba(0,229,160,0.1);border:1px solid rgba(0,229,160,0.2);color:#00e5a0;">📋 Copiar</button>
            ${p.foto && !p.simulacion && !expirada ? `<button onclick="simularExistente('${p.token}')" class="btn" style="font-size:11px;padding:4px 10px;margin-left:4px;background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.2);color:var(--warn);">✨ IA</button>` : ''}
          </td>
        </tr>`;
      }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#ff6b6b">Error cargando propuestas</td></tr>';
  }
}

async function crearPropuesta() {
  const nombre = document.getElementById('pp-nombre')?.value?.trim();
  const errEl = document.getElementById('pp-error');
  if (!nombre) { errEl.textContent = 'El nombre es obligatorio'; errEl.style.display = 'block'; return; }

  const planes = obtenerPlanes();
  if (planes.length === 0) { errEl.textContent = 'Agrega al menos un plan de tratamiento'; errEl.style.display = 'block'; return; }
  if (planes.some(p => !p.tratamiento || p.presupuesto_total === 0)) {
    errEl.textContent = 'Completa el tratamiento y presupuesto de cada plan'; errEl.style.display = 'block'; return;
  }

  const btn = document.getElementById('btn-guardar-propuesta');
  btn.disabled = true; btn.textContent = 'Creando...';
  errEl.style.display = 'none';

  try {
    const fd = new FormData();
    fd.append('nombre', nombre);
    fd.append('telefono', document.getElementById('pp-tel')?.value || '');
    fd.append('planes', JSON.stringify(planes));
    // Compatibilidad con campos simples (usar primer plan)
    fd.append('tratamiento', planes[0].tratamiento);
    fd.append('duracion', planes[0].duracion);
    fd.append('presupuesto_total', planes[0].presupuesto_total);
    fd.append('cuota_inicial', planes[0].cuota_inicial);
    fd.append('cuota_mensual', planes[0].cuota_mensual);
    fd.append('notas', document.getElementById('pp-notas')?.value || '');

    const fotoFile = document.getElementById('pp-foto')?.files?.[0];
    if (fotoFile) fd.append('foto', fotoFile);
    const stlFile = document.getElementById('pp-stl')?.files?.[0];
    if (stlFile) fd.append('stl', stlFile);

    const token = localStorage.getItem('ortho_admin_token');
    const r = await fetch('/api/admin/propuestas', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: fd
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);

    propuestaTokenActual = d.token;
    pacienteWspActual = document.getElementById('pp-tel')?.value || '';

    document.getElementById('modal-propuesta').style.display = 'none';
    const link = `${location.origin}${d.link}`;
    document.getElementById('link-generado').textContent = link;

    const btnSim = document.getElementById('btn-simular');
    if (btnSim) btnSim.style.display = fotoFile ? 'block' : 'none';

    document.getElementById('modal-link').style.display = 'flex';
    cargarPropuestas();
  } catch(e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'Crear propuesta y generar link';
}

function copiarLink() {
  const link = document.getElementById('link-generado')?.textContent;
  if (link) navigator.clipboard.writeText(link).then(() => {
    const btn = event.target;
    btn.textContent = '✅ ¡Copiado!';
    setTimeout(() => { btn.textContent = '📋 Copiar link'; }, 2000);
  });
}

function enviarPorWsp() {
  const link = document.getElementById('link-generado')?.textContent;
  const tel = pacienteWspActual?.replace(/\D/g,'') || '';
  const msg = encodeURIComponent(`Hola 👋 Te comparto tu propuesta de tratamiento personalizada del Dr. Juan Camilo Correa.\n\n📋 Incluye tu simulación de sonrisa, modelo 3D y plan completo:\n\n${link}\n\n⏰ *Válida por 24 horas*. ¡Cualquier duda me escribes!`);
  window.open(`https://wa.me/${tel ? '57'+tel : ''}?text=${msg}`, '_blank');
}

async function simularSonrisa() {
  if (!propuestaTokenActual) return;
  const btn = document.getElementById('btn-simular');
  btn.disabled = true; btn.textContent = '⏳ Generando simulación... (30s)';
  try {
    const token = localStorage.getItem('ortho_admin_token');
    const r = await fetch(`/api/admin/propuestas/${propuestaTokenActual}/simular`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    btn.textContent = '✅ Simulación lista en la propuesta';
    btn.style.color = '#00e5a0';
  } catch(e) {
    btn.textContent = '❌ Error: ' + e.message;
    btn.disabled = false;
  }
}

async function simularExistente(token) {
  const adminToken = localStorage.getItem('ortho_admin_token');
  const r = await fetch(`/api/admin/propuestas/${token}/simular`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const d = await r.json();
  if (d.ok) { alert('✅ Simulación generada'); cargarPropuestas(); }
  else alert('Error: ' + d.error);
}

function cerrarModalLink() {
  document.getElementById('modal-link').style.display = 'none';
  propuestaTokenActual = null;
}

// Interceptar navegación para cargar propuestas
const _origShowPage = typeof showPage === 'function' ? showPage : null;
document.addEventListener('click', (e) => {
  const navItem = e.target.closest('[data-page]');
  if (navItem && navItem.dataset.page === 'propuestas') {
    setTimeout(cargarPropuestas, 100);
  }
});

// Calculadora cuota mensual en valoraciones
function calcCuotaVal() {
  const total = parseFloat(document.getElementById('pp-total')?.value) || 0;
  const inicial = parseFloat(document.getElementById('pp-inicial')?.value) || 0;
  const meses = parseFloat(document.getElementById('pp-dur')?.value) || 1;
  const cuota = meses > 0 ? Math.round((total - inicial) / meses) : 0;
  const display = document.getElementById('pp-mensual-display');
  const hidden = document.getElementById('pp-mensual');
  if (display) display.textContent = cuota > 0 ? '$ ' + cuota.toLocaleString('es-CO') + ' / mes' : '$ 0 / mes';
  if (hidden) hidden.value = cuota;
}

// ═══════════════════════════════════════════════════
// PLANES MÚLTIPLES EN VALORACIONES
// ═══════════════════════════════════════════════════
let numPlanes = 0;

function planHTML(idx) {
  const colores = ['rgba(0,229,160,0.08)', 'rgba(99,102,241,0.08)', 'rgba(245,166,35,0.08)'];
  const bordes = ['rgba(0,229,160,0.25)', 'rgba(99,102,241,0.25)', 'rgba(245,166,35,0.25)'];
  const iconos = ['🥇', '🥈', '🥉'];
  const color = colores[idx % colores.length];
  const borde = bordes[idx % bordes.length];
  const icono = iconos[idx % iconos.length];
  const tratamientos = ['Ortodoncia con alineadores Invisalign','Ortodoncia con brackets metálicos','Ortodoncia con brackets estéticos','Ortodoncia con brackets de zafiro','Retenedores'];
  const opts = tratamientos.map(t => `<option>${t}</option>`).join('');
  return `
  <div id="plan-${idx}" style="background:${color};border:1px solid ${borde};border-radius:12px;padding:16px;position:relative;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:13px;font-weight:700;">${icono} Plan ${idx + 1}</div>
      ${idx > 0 ? `<button onclick="eliminarPlan(${idx})" style="background:rgba(255,107,107,0.1);border:1px solid rgba(255,107,107,0.2);color:#ff6b6b;padding:3px 10px;border-radius:6px;font-size:12px;cursor:pointer;">✕ Quitar</button>` : ''}
    </div>
    <div style="display:grid;gap:10px;">
      <div>
        <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Tratamiento *</label>
        <select id="plan-trat-${idx}" class="inp">${opts}</select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <div>
          <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Duración (meses)</label>
          <input id="plan-dur-${idx}" class="inp" type="number" value="18" min="1" oninput="calcPlan(${idx})">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Total</label>
          <input id="plan-total-${idx}" class="inp" type="number" placeholder="8500000" oninput="calcPlan(${idx})">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Cuota inicial</label>
          <input id="plan-inicial-${idx}" class="inp" type="number" placeholder="2000000" oninput="calcPlan(${idx})">
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.2);border-radius:8px;padding:10px 14px;">
        <span style="font-size:11px;color:var(--text2);">Cuota mensual · (Total - Inicial) ÷ Meses</span>
        <span id="plan-cuota-${idx}" style="font-size:16px;font-weight:800;color:#00e5a0;">$ 0 / mes</span>
        <input type="hidden" id="plan-mensual-${idx}" value="0">
      </div>
      <div>
        <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Descripción del plan (opcional)</label>
        <input id="plan-desc-${idx}" class="inp" type="text" placeholder="Ej: Opción premium · Mayor precisión · Invisible">
      </div>
    </div>
  </div>`;
}

function calcPlan(idx) {
  const total = parseFloat(document.getElementById(`plan-total-${idx}`)?.value) || 0;
  const inicial = parseFloat(document.getElementById(`plan-inicial-${idx}`)?.value) || 0;
  const meses = parseFloat(document.getElementById(`plan-dur-${idx}`)?.value) || 1;
  const cuota = meses > 0 ? Math.round((total - inicial) / meses) : 0;
  const display = document.getElementById(`plan-cuota-${idx}`);
  const hidden = document.getElementById(`plan-mensual-${idx}`);
  if (display) display.textContent = cuota > 0 ? '$ ' + cuota.toLocaleString('es-CO') + ' / mes' : '$ 0 / mes';
  if (hidden) hidden.value = cuota;
}

function agregarPlan() {
  if (numPlanes >= 3) { alert('Máximo 3 planes por valoración'); return; }
  const container = document.getElementById('planes-container');
  if (container) {
    const div = document.createElement('div');
    div.innerHTML = planHTML(numPlanes);
    container.appendChild(div.firstElementChild);
    numPlanes++;
  }
}

function eliminarPlan(idx) {
  const el = document.getElementById(`plan-${idx}`);
  if (el) el.parentElement.remove();
}

function obtenerPlanes() {
  const planes = [];
  for (let i = 0; i < numPlanes; i++) {
    const el = document.getElementById(`plan-${i}`);
    if (!el) continue;
    planes.push({
      id: i,
      tratamiento: document.getElementById(`plan-trat-${i}`)?.value || '',
      duracion: parseInt(document.getElementById(`plan-dur-${i}`)?.value) || 18,
      presupuesto_total: parseInt(document.getElementById(`plan-total-${i}`)?.value) || 0,
      cuota_inicial: parseInt(document.getElementById(`plan-inicial-${i}`)?.value) || 0,
      cuota_mensual: parseInt(document.getElementById(`plan-mensual-${i}`)?.value) || 0,
      descripcion: document.getElementById(`plan-desc-${i}`)?.value || ''
    });
  }
  return planes;
}

// Override limpiarFormPropuesta para inicializar planes
const _origLimpiar = typeof limpiarFormPropuesta === 'function' ? limpiarFormPropuesta : null;
function limpiarFormPropuesta() {
  ['pp-nombre','pp-tel','pp-notas'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const err = document.getElementById('pp-error');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  // Resetear planes
  numPlanes = 0;
  const container = document.getElementById('planes-container');
  if (container) container.innerHTML = '';
  agregarPlan(); // Agregar primer plan por defecto
}
