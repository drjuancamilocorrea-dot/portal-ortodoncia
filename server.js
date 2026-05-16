const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const JWT_SECRET = process.env.JWT_SECRET || 'secret-ortodoncia-2026';
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'data/db.json');
function readDB() { return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')); }
function writeDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalido' }); }
}

function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
    next();
  });
}

// LOGIN
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const admin = (db.admins || []).find(a => a.email === email);
  if (admin) {
    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const token = jwt.sign({ id: admin.id, nombre: admin.nombre, rol: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, rol: 'admin', user: { id: admin.id, nombre: admin.nombre } });
  }
  const paciente = db.pacientes.find(p => p.email === email);
  if (!paciente) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const valid = await bcrypt.compare(password, paciente.password);
  if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const token = jwt.sign({ id: paciente.id, nombre: paciente.nombre, rol: 'paciente' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, rol: 'paciente', user: { id: paciente.id, nombre: paciente.nombre } });
});

// ADMIN: pacientes
app.get('/api/admin/pacientes', adminAuth, (req, res) => {
  const db = readDB();
  res.json(db.pacientes.map(({ password, ...p }) => p));
});

app.post('/api/admin/pacientes', adminAuth, async (req, res) => {
  const { nombre, email, password, tratamiento, inicio, duracion, telefono, cambio_alineador_dias, direccion } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Faltan campos obligatorios' });
  const db = readDB();
  if (db.pacientes.find(p => p.email === email)) return res.status(400).json({ error: 'El email ya existe' });
  const hash = await bcrypt.hash(String(password), 10);
  const paciente = {
    id: 'p' + Date.now(), nombre, email, password: hash,
    telefono: telefono || '', direccion: direccion || '',
    tratamiento: tratamiento || '',
    inicio: inicio || new Date().toISOString().split('T')[0],
    duracion: parseInt(duracion) || 18,
    cambio_alineador_dias: parseInt(cambio_alineador_dias) || null,
    presupuesto: { total: 0, abonos: [], notas: '' },
    citas: [], progreso: []
  };
  db.pacientes.push(paciente);
  writeDB(db);
  const { password: _, ...data } = paciente;

  // Email de bienvenida (independiente del teléfono)
  if (paciente.email) {
    const html = emailTemplate('¡Bienvenido/a al portal! 🎉', `
      <p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 16px;">Hola <strong style="color:#f0f6fc;">${paciente.nombre}</strong>,</p>
      <p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 16px;">Ya tienes acceso a tu portal personal donde podrás ver tus citas, seguir tu progreso y mucho más.</p>
      <div style="background:#0d1117;border-radius:8px;padding:16px;margin:16px 0;">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">Tu acceso</div>
        <div style="font-size:14px;color:#f0f6fc;">📧 ${paciente.email}</div>
        <div style="font-size:14px;color:#f0f6fc;">🔑 La contraseña que te asignaron</div>
      </div>
      <a href="${process.env.PORTAL_URL || 'https://portal-ortodoncia-production.up.railway.app'}" 
         style="display:inline-block;background:#00d28c;color:#0d1117;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;margin-top:8px;">
        Entrar al portal →
      </a>`);
    enviarEmail(paciente.email, '¡Bienvenido/a a tu portal de ortodoncia! 🦷', html);
  }

  // Enviar bienvenida automática por WhatsApp si tiene teléfono
  if (paciente.telefono) {
    const nombre1 = paciente.nombre.split(' ')[0];
    const esAlineadores = paciente.tratamiento.toLowerCase().includes('alineador');
    const esBrackets = paciente.tratamiento.toLowerCase().includes('bracket') || paciente.tratamiento.toLowerCase().includes('fijo');

    let recomendaciones = '';
    if (esAlineadores) {
      recomendaciones = `\n\n📋 *Recomendaciones para tu tratamiento con alineadores:*\n⏰ Úsalos mínimo *22 horas al día* — solo retíralos para comer y cepillarte\n🍽️ Retíralos siempre antes de comer o tomar bebidas (excepto agua fría)\n🧼 Lávalos con *agua fría y jabón neutro* — nunca con agua caliente\n🚫 No los envuelvas en servilletas (se pierden fácilmente)\n🦷 Cepíllate los dientes antes de volver a colocártelos\n💪 Haz los ejercicios de apretamiento con el mordedor al ponerte cada alineador nuevo: *20 apretadas en la mañana y 20 en la noche*\n📦 Guarda siempre el alineador anterior por si necesitas usarlo de respaldo`;
    } else if (esBrackets) {
      recomendaciones = `\n\n📋 *Recomendaciones para tu tratamiento con brackets:*\n🚫 *Evita alimentos duros* como manzana entera, zanahoria cruda, hielo o caramelos duros\n🚫 *Evita alimentos pegajosos* como chicle, caramelos blandos o toffee\n✂️ Corta los alimentos en trozos pequeños antes de comer\n🦷 *Cepíllate después de cada comida* — mínimo 3 veces al día con cepillo ortodóncico\n🪥 Usa hilo dental con enhebrador o cepillos interproximales a diario\n⚠️ Si se cae un bracket o se suelta un arco, llámanos de inmediato al consultorio\n💊 Si sientes molestias los primeros días, puedes tomar un analgésico como ibuprofeno`;
    }

    const msg = `¡Hola ${nombre1}! 👋\n\nBienvenido a tu tratamiento con el *Dr. Juan Camilo Correa*. 🦷\n\nEstamos felices de acompañarte en este camino hacia tu mejor sonrisa. Tu portal personal ya está listo con todo lo que necesitas:\n\n✅ Tus citas programadas\n📊 Tu progreso mensual\n🤖 Asistente IA disponible 24/7\n💰 Estado de tu cuenta\n📋 Guías post-cita personalizadas\n🏆 Sistema de puntos y recompensas${recomendaciones}\n\n👉 Ingresa en: *https://portal-ortodoncia-production.up.railway.app*\n📧 Usuario: ${paciente.email}\n🔑 Contraseña: tu número de cédula\n\n¡Cualquier duda estamos aquí para ayudarte! 😊`;
    enviarWhatsApp(paciente.telefono, msg).catch(() => {}); // no bloqueamos la respuesta si falla
  }

  res.json({ ok: true, paciente: data });
});

app.delete('/api/admin/pacientes/:id', adminAuth, (req, res) => {
  const db = readDB();
  const idx = db.pacientes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  const nombre = db.pacientes[idx].nombre;
  db.pacientes.splice(idx, 1);
  writeDB(db);
  console.log('Paciente eliminado: ' + nombre);
  res.json({ ok: true });
});

app.put('/api/admin/pacientes/:id', adminAuth, async (req, res) => {
  const db = readDB();
  const idx = db.pacientes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  ['nombre','email','telefono','tratamiento','inicio','duracion','cambio_alineador_dias'].forEach(c => {
    if (req.body[c] !== undefined) db.pacientes[idx][c] = req.body[c];
  });
  if (req.body.password) db.pacientes[idx].password = await bcrypt.hash(req.body.password, 10);
  writeDB(db);
  const { password, ...data } = db.pacientes[idx];
  res.json({ ok: true, paciente: data });
});

// ADMIN: presupuesto
app.put('/api/admin/pacientes/:id/presupuesto', adminAuth, async (req, res) => {
  const db = readDB();
  const idx = db.pacientes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  if (!db.pacientes[idx].presupuesto) db.pacientes[idx].presupuesto = { total: 0, abonos: [], notas: '' };
  const campos = ['total','notas','tipo_ortodoncia','cuota_inicial','num_cuotas','valor_cuota','duracion'];
  campos.forEach(c => { if (req.body[c] !== undefined) db.pacientes[idx].presupuesto[c] = req.body[c]; });
  // Guardar frecuencia de cambio de alineador en el perfil del paciente
  if (req.body.cambio_alineador_dias) db.pacientes[idx].cambio_alineador_dias = req.body.cambio_alineador_dias;
  if (req.body.total_alineadores) db.pacientes[idx].total_alineadores = req.body.total_alineadores;
  // Actualizar tratamiento del paciente con el tipo de ortodoncia del presupuesto
  if (req.body.tipo_ortodoncia) db.pacientes[idx].tratamiento = req.body.tipo_ortodoncia;
  writeDB(db);
  // Enviar WhatsApp con resumen del presupuesto
  const p = db.pacientes[idx];
  if (p.telefono) {
    const pres = p.presupuesto;
    const COP = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0}).format(v);
    const tipoTto = pres.tipo_ortodoncia || p.tratamiento || '';
    const msg = `¡Hola ${p.nombre.split(' ')[0]}! 👋

Te compartimos tu presupuesto de tratamiento con el *Dr. Juan Camilo Correa* 🦷

🦷 *Tipo de tratamiento:* ${tipoTto}
💰 *Total del tratamiento:* ${COP(pres.total||0)}
📌 *Cuota inicial:* ${COP(pres.cuota_inicial||0)}
📅 *Cuotas mensuales:* ${COP(pres.valor_cuota||0)}
⏳ *Duración:* ${pres.duracion||pres.num_cuotas||''} meses

¡Cualquier duda estamos aquí para ayudarte! 😊`;
    await enviarWhatsApp(p.telefono, msg);
  }
  res.json({ ok: true });
});

app.post('/api/admin/pacientes/:id/abono', adminAuth, (req, res) => {
  const { monto, descripcion } = req.body;
  if (!monto) return res.status(400).json({ error: 'Falta el monto' });
  const db = readDB();
  const idx = db.pacientes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  if (!db.pacientes[idx].presupuesto) db.pacientes[idx].presupuesto = { total: 0, abonos: [], notas: '' };
  const abono = { id: 'ab' + Date.now(), monto: parseFloat(monto), descripcion: descripcion || '', fecha: new Date().toISOString().split('T')[0] };
  db.pacientes[idx].presupuesto.abonos.push(abono);
  writeDB(db);
  res.json({ ok: true, abono });
});

app.delete('/api/admin/pacientes/:id/abono/:abId', adminAuth, (req, res) => {
  const db = readDB();
  const idx = db.pacientes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  db.pacientes[idx].presupuesto.abonos = db.pacientes[idx].presupuesto.abonos.filter(a => a.id !== req.params.abId);
  writeDB(db);
  res.json({ ok: true });
});

// ─── DAILY.CO helper ─────────────────────────────────────────────────────────
async function crearSalaDaily(roomName) {
  const DAILY_KEY = process.env.DAILY_API_KEY;
  if (!DAILY_KEY) return null;
  try {
    const r = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DAILY_KEY}` },
      body: JSON.stringify({
        name: roomName,
        properties: {
          enable_chat: true,
          enable_screenshare: false,
          start_video_off: false,
          start_audio_off: false,
          exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 // expira en 24h
        }
      })
    });
    const d = await r.json();
    return d.url || null;
  } catch(e) {
    console.error('Daily.co error:', e.message);
    return null;
  }
}

// ADMIN: citas
app.post('/api/admin/pacientes/:id/citas', adminAuth, async (req, res) => {
  const { fecha, hora, tipo, virtual } = req.body;
  if (!fecha || !hora || !tipo) return res.status(400).json({ error: 'Faltan datos' });
  const db = readDB();
  const idx = db.pacientes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });

  const citaId = 'c' + Date.now();
  const nuevaCita = { id: citaId, fecha, hora, tipo, estado: 'programada', virtual: !!virtual };

  // Si es virtual, crear sala en Daily.co
  if (virtual) {
    const roomName = `consulta-${req.params.id}-${citaId}`;
    const salaUrl = await crearSalaDaily(roomName);
    if (salaUrl) {
      nuevaCita.sala_url = salaUrl;
      nuevaCita.room_name = roomName;
    }
  }

  db.pacientes[idx].citas.push(nuevaCita);
  writeDB(db);

  const p = db.pacientes[idx];
  const fechaFmt = new Date(fecha).toLocaleDateString('es-CO', {weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const portalUrl = process.env.BASE_URL || 'https://portal-ortodoncia-production.up.railway.app';

  // WhatsApp al paciente
  if (p.telefono) {
    let msgWsp;
    if (virtual && nuevaCita.sala_url) {
      msgWsp = `📅 *Videoconsulta programada*\n\n🦷 *${tipo}*\n📆 ${fechaFmt}\n⏰ ${hora}\n\n🎥 Es una consulta virtual. El día y hora de tu cita, entra a tu portal y ve a la sección *Videollamada*:\n\n👉 ${portalUrl}\n\n¡Te esperamos! — Dr. Juan Camilo Correa`;
    } else {
      msgWsp = `📅 *Cita programada*\n\n🦷 *${tipo}*\n📆 ${fechaFmt}\n⏰ ${hora}\n\nRecuerda llegar 5 minutos antes. ¡Te esperamos! 😊\n\n— Dr. Juan Camilo Correa`;
    }
    await enviarWhatsApp(p.telefono, msgWsp);
  }

  // Email de confirmación
  if (p.email) {
    const virtualBadge = virtual ? `<div style="background:#0d2818;border:1px solid #00d28c;border-radius:6px;padding:10px;margin:12px 0;color:#00d28c;font-size:13px;">🎥 Esta es una cita virtual. Ingresa a tu portal el día de la cita para unirte.</div>` : '';
    const html = emailTemplate('Cita programada 📅', `
      <p style="color:#9ca3af;font-size:14px;margin:0 0 16px;">Hola <strong style="color:#f0f6fc;">${p.nombre.split(' ')[0]}</strong>, tu cita ha sido programada.</p>
      <div style="background:#0d1117;border-radius:8px;padding:16px;margin:16px 0;">
        <div style="margin-bottom:10px;"><span style="color:#6b7280;font-size:12px;">TIPO</span><br><span style="color:#f0f6fc;font-size:14px;font-weight:600;">${tipo}</span></div>
        <div style="margin-bottom:10px;"><span style="color:#6b7280;font-size:12px;">FECHA</span><br><span style="color:#f0f6fc;font-size:14px;">${fechaFmt}</span></div>
        <div><span style="color:#6b7280;font-size:12px;">HORA</span><br><span style="color:#00d28c;font-size:16px;font-weight:700;">${hora}</span></div>
      </div>
      ${virtualBadge}
      <p style="color:#9ca3af;font-size:13px;">Por favor llega 5 minutos antes. Si necesitas cancelar, contáctanos con anticipación.</p>`);
    enviarEmail(p.email, `📅 Cita programada — ${tipo}`, html);
  }

  res.json({ ok: true, virtual: !!virtual, sala_url: nuevaCita.sala_url || null });
});

app.put('/api/admin/pacientes/:id/citas/:cid', adminAuth, (req, res) => {
  const db = readDB();
  const idx = db.pacientes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  const ci = db.pacientes[idx].citas.findIndex(c => c.id === req.params.cid);
  if (ci === -1) return res.status(404).json({ error: 'Cita no encontrada' });

  const estadoAnterior = db.pacientes[idx].citas[ci].estado;
  const nuevoEstado = req.body.estado;

  Object.assign(db.pacientes[idx].citas[ci], req.body);

  // Registrar nota clínica automática al cancelar o no asistir
  if (nuevoEstado && nuevoEstado !== estadoAnterior) {
    const fecha = new Date().toISOString().split('T')[0];
    if (nuevoEstado === 'cancelada') {
      db.pacientes[idx].citas[ci].notas_clinicas = `[${fecha}] Paciente canceló la cita.`;
      db.pacientes[idx].citas[ci].evolucion_registrada = true;
    } else if (nuevoEstado === 'no_asistio') {
      db.pacientes[idx].citas[ci].notas_clinicas = `[${fecha}] Paciente no canceló ni asistió a la cita.`;
      db.pacientes[idx].citas[ci].evolucion_registrada = true;
    }
  }

  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/admin/pacientes/:id/citas/:cid', adminAuth, (req, res) => {
  const db = readDB();
  const idx = db.pacientes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  db.pacientes[idx].citas = db.pacientes[idx].citas.filter(c => c.id !== req.params.cid);
  writeDB(db);
  res.json({ ok: true });
});

// ─── GAMIFICACIÓN ─────────────────────────────────────────────────────────────

const PUNTOS = {
  cita_cumplida: 100,
  buena_higiene: 50,
  sin_brackets_caidos: 50,
  cambio_alineador_en_fecha: 50,
  racha_3: 50,
  racha_6: 150,
  referido_agenda: 200,
  referido_inicia: 500,
  tratamiento_completo: 500
};

const NIVELES = [
  { nombre: 'Iniciando', min: 0, max: 200, emoji: '🌱' },
  { nombre: 'En camino', min: 201, max: 500, emoji: '⭐' },
  { nombre: 'Constante', min: 501, max: 900, emoji: '🏆' },
  { nombre: 'Experto', min: 901, max: 1999, emoji: '💎' },
  { nombre: 'Élite', min: 2000, max: 99999, emoji: '👑' }
];

const RECOMPENSAS = [
  { id: 'r1', puntos: 300, nombre: 'Kit de higiene básico', descripcion: 'Cepillo interdental, hilo dental y pasta para ortodoncia', emoji: '🪥' },
  { id: 'r2', puntos: 400, nombre: 'Kit higiene alineadores', descripcion: 'Mordedor extra, estuche y pastillas limpiadoras', emoji: '💎' },
  { id: 'r3', puntos: 600, nombre: '20% en limpieza profesional', descripcion: 'Descuento en tu próxima limpieza dental', emoji: '✨' },
  { id: 'r4', puntos: 800, nombre: '20% en blanqueamiento', descripcion: 'Descuento en tratamiento de blanqueamiento', emoji: '🦷' },
  { id: 'r5', puntos: 1000, nombre: '30% en blanqueamiento', descripcion: 'Descuento mayor en blanqueamiento completo', emoji: '⭐' },
  { id: 'r6', puntos: 1200, nombre: '20% en placa de retención', descripcion: 'Descuento en tu primera placa de retención', emoji: '🏆' },
  { id: 'r7', puntos: 1500, nombre: 'Segunda retención gratis', descripcion: 'Segunda placa de retención sin costo', emoji: '💎' },
  { id: 'r8', puntos: 2000, nombre: 'Retención completa gratis', descripcion: 'Ambas placas de retención sin costo al finalizar', emoji: '👑' }
];

function calcularPuntos(paciente) {
  return (paciente.gamificacion?.historial || []).reduce((s, h) => s + (h.puntos || 0), 0);
}

function calcularNivel(puntos) {
  return NIVELES.find(n => puntos >= n.min && puntos <= n.max) || NIVELES[0];
}

function calcularRacha(citas) {
  const realizadas = [...(citas || [])].filter(c => c.estado === 'realizada').sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
  let racha = 0;
  for (const c of realizadas) { if (c.estado === 'realizada') racha++; else break; }
  return racha;
}

// Registrar evolución clínica y asignar puntos
app.post('/api/admin/pacientes/:id/evolucion', adminAuth, (req, res) => {
  const { cita_id, notas, buena_higiene, sin_brackets_caidos, cambio_alineador_en_fecha, bracket_reparado, elastico, num_alineador } = req.body;
  const db = readDB();
  const idx = db.pacientes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });

  const p = db.pacientes[idx];
  if (!p.gamificacion) p.gamificacion = { historial: [], referido_codigo: p.nombre.split(' ')[0].toUpperCase() + new Date().getFullYear().toString().slice(-2), referidos: [] };

  const fecha = new Date().toISOString().split('T')[0];
  const entradas = [];

  // Verificar estado de la cita
  const cita = p.citas?.find(c => c.id === cita_id);
  const asistio = !cita || cita.estado === 'realizada';

  if (asistio) {
    entradas.push({ fecha, tipo: 'cita_cumplida', puntos: PUNTOS.cita_cumplida, desc: 'Cita cumplida' });
    if (buena_higiene) entradas.push({ fecha, tipo: 'buena_higiene', puntos: PUNTOS.buena_higiene, desc: 'Buena higiene en control' });
    if (sin_brackets_caidos) entradas.push({ fecha, tipo: 'sin_brackets_caidos', puntos: PUNTOS.sin_brackets_caidos, desc: 'Control sin brackets caídos' });
    if (cambio_alineador_en_fecha) entradas.push({ fecha, tipo: 'cambio_alineador_en_fecha', puntos: PUNTOS.cambio_alineador_en_fecha, desc: 'Cambio de alineador en fecha' });
    const racha = calcularRacha(p.citas);
    if (racha === 3) entradas.push({ fecha, tipo: 'racha_3', puntos: PUNTOS.racha_3, desc: '¡3 citas seguidas!' });
    if (racha === 6) entradas.push({ fecha, tipo: 'racha_6', puntos: PUNTOS.racha_6, desc: '¡6 citas seguidas!' });
  }

  p.gamificacion.historial.push(...entradas);

  // Guardar nota clínica
  if (cita_id) {
    const ci = p.citas.findIndex(c => c.id === cita_id);
    if (ci !== -1) {
      p.citas[ci].notas_clinicas = notas || '';
      p.citas[ci].bracket_reparado = bracket_reparado || false;
      p.citas[ci].evolucion_registrada = true;
      if (elastico) p.citas[ci].elastico = elastico;
      if (num_alineador) p.citas[ci].num_alineador = num_alineador;
      if (num_alineador) p.num_alineador_actual = num_alineador;
      // Actualizar elástico activo del paciente
      if (elastico) p.elastico_activo = elastico;
      else if (!elastico && cita_id) delete p.elastico_activo;
    }
  }

  writeDB(db);
  const totalPuntos = calcularPuntos(p);
  const nivel = calcularNivel(totalPuntos);
  res.json({ ok: true, puntos_ganados: entradas.reduce((s,e)=>s+e.puntos,0), total_puntos: totalPuntos, nivel, entradas });
});

// Confirmar referido
app.post('/api/admin/pacientes/:id/referido', adminAuth, (req, res) => {
  const { tipo } = req.body; // 'agenda' o 'inicia'
  const db = readDB();
  const idx = db.pacientes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  const p = db.pacientes[idx];
  if (!p.gamificacion) p.gamificacion = { historial: [], referido_codigo: p.nombre.split(' ')[0].toUpperCase() + '26', referidos: [] };
  const puntos = tipo === 'inicia' ? PUNTOS.referido_inicia : PUNTOS.referido_agenda;
  p.gamificacion.historial.push({ fecha: new Date().toISOString().split('T')[0], tipo: 'referido_' + tipo, puntos, desc: tipo === 'inicia' ? 'Referido inició tratamiento' : 'Referido agendó consulta' });
  writeDB(db);
  res.json({ ok: true, puntos_ganados: puntos, total_puntos: calcularPuntos(p) });
});

// Obtener gamificación del paciente (para portal)
app.get('/api/gamificacion', auth, (req, res) => {
  const db = readDB();
  const p = db.pacientes.find(x => x.id === req.user.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  if (!p.gamificacion) p.gamificacion = { historial: [], referido_codigo: p.nombre.split(' ')[0].toUpperCase() + '26', referidos: [] };
  const puntos = calcularPuntos(p);
  const nivel = calcularNivel(puntos);
  const sigNivel = NIVELES.find(n => n.min > puntos);
  const recompensasDisp = RECOMPENSAS.map(r => ({ ...r, desbloqueada: puntos >= r.puntos }));
  res.json({ puntos, nivel, siguiente_nivel: sigNivel || null, referido_codigo: p.gamificacion.referido_codigo, historial: p.gamificacion.historial.slice(-10), recompensas: recompensasDisp });
});

// Info gamificación en admin
app.get('/api/admin/pacientes/:id/gamificacion', adminAuth, (req, res) => {
  const db = readDB();
  const p = db.pacientes.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  if (!p.gamificacion) p.gamificacion = { historial: [], referido_codigo: p.nombre.split(' ')[0].toUpperCase() + '26', referidos: [] };
  const puntos = calcularPuntos(p);
  res.json({ puntos, nivel: calcularNivel(puntos), historial: p.gamificacion.historial, referido_codigo: p.gamificacion.referido_codigo });
});

app.get('/api/recompensas', (req, res) => res.json(RECOMPENSAS));


app.post('/api/admin/pacientes/:id/progreso', adminAuth, upload.single('foto'), (req, res) => {
  const db = readDB();
  const idx = db.pacientes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  if (!req.file) return res.status(400).json({ error: 'No se recibio foto' });
  db.pacientes[idx].progreso.push({
    mes: db.pacientes[idx].progreso.length + 1,
    fecha: new Date().toISOString().split('T')[0],
    nota: req.body.nota || '',
    foto: 'data:' + req.file.mimetype + ';base64,' + req.file.buffer.toString('base64')
  });
  writeDB(db);
  res.json({ ok: true });
});

// ADMIN: usuarios
app.get('/api/admin/usuarios', adminAuth, (req, res) => {
  const db = readDB();
  res.json((db.admins || []).map(({ password, ...a }) => a));
});

app.post('/api/admin/usuarios', adminAuth, async (req, res) => {
  const { nombre, email, password } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Faltan campos' });
  const db = readDB();
  if (!db.admins) db.admins = [];
  if (db.admins.find(a => a.email === email)) return res.status(400).json({ error: 'Email ya existe' });
  db.admins.push({ id: 'a' + Date.now(), nombre, email, password: await bcrypt.hash(password, 10), rol: 'admin' });
  writeDB(db);
  res.json({ ok: true });
});

// PACIENTE: rutas
app.get('/api/paciente', auth, (req, res) => {
  const db = readDB();
  const p = db.pacientes.find(x => x.id === req.user.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { password, ...data } = p;
  res.json(data);
});

app.get('/api/citas', auth, (req, res) => {
  const db = readDB();
  res.json(db.pacientes.find(x => x.id === req.user.id)?.citas || []);
});

app.get('/api/progreso', auth, (req, res) => {
  const db = readDB();
  res.json(db.pacientes.find(x => x.id === req.user.id)?.progreso || []);
});

app.get('/api/presupuesto', auth, (req, res) => {
  const db = readDB();
  const p = db.pacientes.find(x => x.id === req.user.id);
  const pres = p?.presupuesto || { total: 0, abonos: [], notas: '' };
  const pagado = pres.abonos.reduce((s, a) => s + a.monto, 0);
  res.json({ ...pres, pagado, saldo: pres.total - pagado });
});

// REVIEWS
app.get('/api/reviews', (req, res) => {
  res.json(readDB().reviews || []);
});

app.post('/api/reviews', auth, (req, res) => {
  const { rating, texto } = req.body;
  if (!rating || !texto) return res.status(400).json({ error: 'Faltan datos' });
  const db = readDB();
  const p = db.pacientes.find(x => x.id === req.user.id);
  db.reviews.push({
    id: 'r' + Date.now(), paciente_id: req.user.id,
    nombre: p?.nombre?.split(' ')[0] + ' ' + (p?.nombre?.split(' ')[1]?.[0] || '') + '.',
    rating: parseInt(rating), texto,
    fecha: new Date().toISOString().split('T')[0]
  });
  writeDB(db);
  res.json({ ok: true });
});

// CHAT IA
app.post('/api/chat', auth, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes('aqui-pega')) return res.status(400).json({ error: 'API key no configurada' });
  const { mensaje, historial, tratamiento } = req.body;
  const client = new Anthropic({ apiKey });

  // Obtener datos reales de la agenda del paciente y citas disponibles
  const db = readDB();
  const paciente = db.pacientes.find(p => p.id === req.user.id);
  const hoy = new Date();

  // Calcular próximos 14 días disponibles (lunes a sábado, excluyendo citas ya ocupadas)
  const citasOcupadas = [];
  db.pacientes.forEach(p => {
    (p.citas || []).forEach(c => {
      if (c.estado === 'programada' && new Date(c.fecha) >= hoy) {
        citasOcupadas.push({ fecha: c.fecha, hora: c.hora });
      }
    });
  });

  // Horarios disponibles del consultorio
  const horarioConsultorio = {
    1: ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00'], // Lunes
    2: ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00'], // Martes
    3: ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00'], // Miércoles
    4: ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00'], // Jueves
    5: ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00'], // Viernes
    6: ['08:00','08:30','09:00','09:30','10:00','10:30','11:00'] // Sábado
  };

  const diasDisponibles = [];
  for (let d = 1; d <= 14; d++) {
    const fecha = new Date(hoy);
    fecha.setDate(hoy.getDate() + d);
    const diaSemana = fecha.getDay(); // 0=dom, 1=lun...
    if (diaSemana === 0) continue; // sin domingos
    const fechaStr = fecha.toISOString().split('T')[0];
    const horasOcupadas = citasOcupadas.filter(c => c.fecha === fechaStr).map(c => c.hora);
    const horasLibres = (horarioConsultorio[diaSemana] || []).filter(h => !horasOcupadas.includes(h));
    if (horasLibres.length > 0) {
      const nombreDia = fecha.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
      diasDisponibles.push({ fecha: fechaStr, nombre: nombreDia, horas: horasLibres.slice(0, 4) });
    }
  }

  const agendaInfo = diasDisponibles.slice(0, 5).map(d =>
    `${d.nombre}: ${d.horas.join(', ')}`
  ).join('\n');

  const proximasCitasPaciente = (paciente?.citas || [])
    .filter(c => new Date(c.fecha) >= hoy && c.estado === 'programada')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .slice(0, 3)
    .map(c => `${c.fecha} a las ${c.hora} — ${c.tipo}`)
    .join('\n') || 'No tiene citas programadas';

  const tipoCita = paciente?.tratamiento?.toLowerCase().includes('alineador') ? 'alineadores' : 'brackets';

  // Construir contexto completo del paciente
  const totalPagado = (paciente?.presupuesto?.abonos || []).reduce((s, a) => s + (a.monto || 0), 0);
  const saldoPendiente = (paciente?.presupuesto?.total || 0) - totalPagado;
  const citasRealizadas = (paciente?.citas || []).filter(c => c.estado === 'realizada');
  const citasPendientes = (paciente?.citas || []).filter(c => ['programada','proxima'].includes(c.estado) && new Date(c.fecha) >= hoy).sort((a,b) => new Date(a.fecha) - new Date(b.fecha));
  const ultimaCita = citasRealizadas.sort((a,b) => new Date(b.fecha) - new Date(a.fecha))[0];
  const elasticoActual = paciente?.elastico_activo || ultimaCita?.elastico || null;
  const puntosGamif = (paciente?.gamificacion?.historial || []).reduce((s,e) => s + (e.puntos||0), 0);
  const mesesActivo = paciente?.inicio ? Math.floor((hoy - new Date(paciente.inicio)) / (1000*60*60*24*30)) : 0;
  const progreso = paciente?.duracion ? Math.round((mesesActivo / paciente.duracion) * 100) : 0;

  const abonos = (paciente?.presupuesto?.abonos || []).slice(-4).map(a =>
    `${a.fecha}: $${a.monto.toLocaleString('es-CO')} (${a.descripcion})`
  ).join('\n') || 'Sin abonos';

  const historialCitas = citasRealizadas.slice(-5).sort((a,b) => new Date(b.fecha) - new Date(a.fecha)).map(c =>
    `${c.fecha} ${c.hora} - ${c.tipo}${c.notas_clinicas ? ': ' + c.notas_clinicas : ''}${c.elastico ? ' | Elástico: ' + c.elastico : ''}`
  ).join('\n') || 'Sin citas realizadas';

  const progresoCitas = (paciente?.progreso || []).map(p =>
    `Mes ${p.mes} (${p.fecha}): ${p.nota}`
  ).join('\n') || 'Sin registros de progreso';

  const systemPrompt = `Eres el asistente virtual del consultorio del Dr. Juan Camilo Correa, ortodoncista. Tienes acceso completo al perfil clínico y financiero del paciente. Usa esta información para dar respuestas personalizadas y contextualizadas.

═══ PERFIL DEL PACIENTE ═══
Nombre: ${paciente?.nombre || 'Paciente'}
Teléfono: ${paciente?.telefono || 'No registrado'}
Tratamiento: ${paciente?.tratamiento || tratamiento}
Inicio: ${paciente?.inicio || 'No registrado'}
Duración estimada: ${paciente?.duracion || '?'} meses
Meses activo: ${mesesActivo} meses
Progreso: ${progreso}%
Puntos acumulados: ${puntosGamif} pts

═══ ESTADO FINANCIERO ═══
Presupuesto total: $${(paciente?.presupuesto?.total || 0).toLocaleString('es-CO')}
Total pagado: $${totalPagado.toLocaleString('es-CO')}
Saldo pendiente: $${saldoPendiente.toLocaleString('es-CO')}
Cuota mensual: $${(paciente?.presupuesto?.valor_cuota || 0).toLocaleString('es-CO')}
Últimos abonos:
${abonos}

═══ ELÁSTICOS ═══
Elástico actual: ${elasticoActual || 'No tiene elásticos asignados'}

═══ HISTORIAL DE CITAS (últimas 5) ═══
${historialCitas}

═══ PRÓXIMAS CITAS ═══
${proximasCitasPaciente}

═══ PROGRESO CLÍNICO ═══
${progresoCitas}

═══ AGENDA DISPONIBLE ═══
${agendaInfo}

═══ INSTRUCCIONES ═══
1. Responde con contexto del paciente — si pregunta por su saldo, díselo; si pregunta por su próxima cita, dísela; si pregunta por sus elásticos, explícale cómo usarlos
2. Para dudas clínicas (dolor, alimentación, higiene, emergencias) responde con base en su tratamiento específico
3. Si quiere agendar, muestra los horarios disponibles y cuando confirme día y hora exactos, incluye al final:
   [AGENDAR: fecha=YYYY-MM-DD hora=HH:MM tipo=Control de ${tipoCita}]
4. Sé cálido, empático y usa emojis con moderación
5. Responde siempre en español
6. Nunca inventes información — si no está en el contexto, dilo honestamente`;

  try {
    const resp = await client.messages.create({
      model: 'claude-opus-4-5', max_tokens: 800,
      system: systemPrompt,
      messages: [...(historial || []), { role: 'user', content: mensaje }]
    });
    const respuesta = resp.content[0]?.text || '';

    // Detectar si el asistente quiere agendar una cita
    const match = respuesta.match(/\[AGENDAR: fecha=(\S+) hora=(\S+) tipo=(.+?)\]/);
    if (match && paciente) {
      const [, fecha, hora, tipo] = match;
      const dbFresh = readDB();
      const pIdx = dbFresh.pacientes.findIndex(p => p.id === req.user.id);
      if (pIdx !== -1) {
        const nuevaCita = { id: 'c' + Date.now(), fecha, hora, tipo: tipo.trim(), estado: 'programada' };
        dbFresh.pacientes[pIdx].citas.push(nuevaCita);
        writeDB(dbFresh);

        // Notificar al admin por WhatsApp
        const adminTel = process.env.ADMIN_WHATSAPP || '';
        if (adminTel) {
          const msgAdmin = `📅 *Nueva cita solicitada por el portal*\n\n👤 ${paciente.nombre}\n🗓 ${fecha} a las ${hora}\n🦷 ${tipo.trim()}\n\n¡Revisa el panel admin!`;
          await enviarWhatsApp(adminTel, msgAdmin);
        }
      }
      // Limpiar el tag del mensaje antes de enviarlo
      return res.json({ respuesta: respuesta.replace(/\[AGENDAR:[^\]]+\]/, '').trim(), cita_agendada: true });
    }

    res.json({ respuesta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── VIDEO: obtener acceso a sala ────────────────────────────────────────────
app.get('/api/video/:citaId', auth, async (req, res) => {
  const db = readDB();
  const paciente = db.pacientes.find(p => p.id === req.user.id);
  if (!paciente) return res.status(404).json({ error: 'Paciente no encontrado' });

  const cita = paciente.citas.find(c => c.id === req.params.citaId);
  if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
  if (!cita.virtual || !cita.sala_url) return res.status(400).json({ error: 'Esta cita no es virtual' });

  // Verificar que la cita es hoy ±30 minutos
  const ahora = new Date();
  const citaDateTime = new Date(`${cita.fecha}T${cita.hora}:00`);
  const diffMin = (ahora - citaDateTime) / 60000;
  if (diffMin < -30 || diffMin > 90) {
    return res.status(403).json({ 
      error: 'La sala solo está disponible 30 minutos antes y hasta 90 minutos después de la cita',
      fecha: cita.fecha,
      hora: cita.hora
    });
  }

  res.json({ sala_url: cita.sala_url, nombre: paciente.nombre, cita });
});

// ─── VIDEO ADMIN: acceso directo a sala ──────────────────────────────────────
app.get('/api/admin/video/:pacienteId/:citaId', adminAuth, async (req, res) => {
  const db = readDB();
  const paciente = db.pacientes.find(p => p.id === req.params.pacienteId);
  if (!paciente) return res.status(404).json({ error: 'Paciente no encontrado' });
  const cita = paciente.citas.find(c => c.id === req.params.citaId);
  if (!cita || !cita.sala_url) return res.status(404).json({ error: 'Sala no encontrada' });
  res.json({ sala_url: cita.sala_url, nombre: paciente.nombre, cita });
});

// GUIA POST-CITA
const PROTOCOLO = 'EJERCICIOS DE APRETAMIENTO (obligatorio alineadores): 1. Con alineadores puestos, sostener mordedor 15 segundos isometrico. 2. Apretar en 5 puntos: posterior derecho, posterior izquierdo, canino derecho, canino izquierdo, incisivos. 3. Repetir 4 veces: 20 apretadas manana y 20 noche.';

app.post('/api/guia-postcita', auth, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes('aqui-pega')) return res.status(400).json({ error: 'API key no configurada' });
  const { tipo_cita, tratamiento } = req.body;
  const client = new Anthropic({ apiKey });
  const esAlin = tipo_cita?.toLowerCase().includes('alineador');
  const extra = esAlin ? ' Incluye seccion Ejercicios de apretamiento: ' + PROTOCOLO : '';
  const prompts = {
    'Inicio con brackets': 'Paciente se coloco brackets por primera vez. Guia: sensaciones primeras 72h, que comer (blando), que nunca comer, como cepillarse, alarmas.',
    'Inicio con alineadores': 'Paciente recibio primeros alineadores. Guia: como ponerselos y quitarselos, 22h uso, limpieza, molestias.' + extra,
    'Control de brackets': 'Control brackets. Guia: que esperar 48h, manejo dolor, cuidados.',
    'Control de alineadores': 'Control con nuevos alineadores. Guia: adaptacion, horas uso, manejo presion.' + extra,
    'Instalacion de aparato': 'Instalacion aparato complementario. Guia: adaptacion, higiene, alimentos, alarmas.'
  };
  try {
    const resp = await client.messages.create({
      model: 'claude-opus-4-5', max_tokens: 700,
      system: 'Asistente ortodoncia. Guias post-cita con emojis, max 320 palabras, espanol.',
      messages: [{ role: 'user', content: prompts[tipo_cita] || 'Guia post-cita ' + tipo_cita + ' con ' + tratamiento }]
    });
    res.json({ guia: resp.content[0]?.text || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── EMAIL (SENDGRID) ────────────────────────────────────────────────────────
const sgMail = require('@sendgrid/mail');

async function enviarEmail(destinatario, asunto, htmlBody) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('[EMAIL] SENDGRID_API_KEY no configurada — omitiendo');
    return { ok: false, motivo: 'sin_credenciales' };
  }
  try {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      from: { email: process.env.SENDGRID_FROM || 'noreply@ortodoncia.com', name: 'Dr. Juan Camilo Correa' },
      to: destinatario,
      subject: asunto,
      html: htmlBody
    });
    console.log(`[EMAIL] Enviado a ${destinatario}: ${asunto}`);
    return { ok: true };
  } catch (err) {
    console.error('[EMAIL] Error:', err.message);
    return { ok: false, error: err.message };
  }
}

function emailTemplate(titulo, contenido) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #21262d;">
      <div style="width:42px;height:42px;background:#0d2b1f;border:1px solid #00d28c33;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;">🦷</div>
      <div>
        <div style="font-size:15px;font-weight:800;color:#00d28c;letter-spacing:-0.3px;">Dr. Juan Camilo Correa</div>
        <div style="font-size:11px;color:#6b7280;margin-top:1px;text-transform:uppercase;letter-spacing:0.08em;">Ortodoncia</div>
      </div>
    </div>

    <!-- Card principal -->
    <div style="background:#161b22;border:1px solid #21262d;border-radius:14px;overflow:hidden;">
      <!-- Barra accent superior -->
      <div style="height:3px;background:linear-gradient(90deg,#00d28c,#00d28c44,transparent);"></div>
      <div style="padding:24px;">
        <h2 style="font-size:20px;font-weight:800;color:#f0f6fc;margin:0 0 18px;letter-spacing:-0.3px;">\${titulo}</h2>
        \${contenido}
      </div>
    </div>

    <!-- Footer -->
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #21262d;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:11px;color:#6b7280;">Enviado automáticamente · No responder</span>
      <a href="https://portal-ortodoncia-production.up.railway.app" style="font-size:11px;color:#00d28c;text-decoration:none;">Abrir portal →</a>
    </div>

  </div>
</body>
</html>`;
}

// ─── WHATSAPP ─────────────────────────────────────────────────────────────────
function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const twilio = require('twilio');
  return twilio(sid, token);
}

async function enviarWhatsApp(telefono, mensaje) {
  const client = getTwilioClient();
  if (!client) {
    console.error('❌ WhatsApp: Twilio no configurado (faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN)');
    return { error: 'Twilio no configurado' };
  }
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) {
    console.error('❌ WhatsApp: Falta TWILIO_WHATSAPP_FROM en las variables de entorno');
    return { error: 'Falta TWILIO_WHATSAPP_FROM' };
  }
  const to = telefono.startsWith('whatsapp:') ? telefono : 'whatsapp:' + telefono;
  console.log(`📤 WhatsApp: enviando a ${to} desde ${from}`);
  try {
    const msg = await client.messages.create({ from, to, body: mensaje });
    console.log(`✅ WhatsApp enviado correctamente. SID: ${msg.sid}`);
    return { ok: true, sid: msg.sid };
  } catch (err) {
    console.error(`❌ WhatsApp error al enviar a ${to}:`, err.message);
    return { error: err.message };
  }
}

// Enviar bienvenida manual desde admin
app.post('/api/admin/whatsapp/bienvenida', adminAuth, async (req, res) => {
  const { paciente_id } = req.body;
  const db = readDB();
  const p = db.pacientes.find(x => x.id === paciente_id);
  if (!p) return res.status(404).json({ error: 'Paciente no encontrado' });
  if (!p.telefono) return res.status(400).json({ error: 'El paciente no tiene teléfono registrado' });
  const msg = `¡Hola ${p.nombre.split(' ')[0]}! 👋

Bienvenido a tu tratamiento con el *Dr. Juan Camilo Correa*. 🦷

Estamos felices de acompañarte en este camino hacia tu mejor sonrisa. Tu portal personal ya está listo con todo lo que necesitas:

✅ Tus citas programadas
📊 Tu progreso mensual
🤖 Asistente IA disponible 24/7
💰 Estado de tu cuenta
📋 Guías post-cita personalizadas
🏆 Sistema de puntos y recompensas

👉 Ingresa en: *https://portal-ortodoncia-production.up.railway.app*
📧 Usuario: ${p.email}
🔑 Contraseña: tu número de cédula

¡Cualquier duda estamos aquí para ayudarte! 😊`;
  const r = await enviarWhatsApp(p.telefono, msg);
  res.json(r);
});

// Recordatorio cambio de alineador
app.post('/api/admin/whatsapp/cambio-alineador', adminAuth, async (req, res) => {
  const { paciente_id } = req.body;
  const db = readDB();
  const p = db.pacientes.find(x => x.id === paciente_id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  if (!p.telefono) return res.status(400).json({ error: 'Sin teléfono registrado' });
  const puntos = calcularPuntos(p);
  const nivel = calcularNivel(puntos);
  const msg = `¡Hola ${p.nombre.split(' ')[0]}! 😊

🔄 *Hoy es tu día de cambio de alineador.*

Recuerda los ejercicios de apretamiento:
1️⃣ Con los alineadores puestos, sostén el mordedor *15 segundos*
2️⃣ Aprieta en 5 puntos: posterior derecho, posterior izquierdo, canino derecho, canino izquierdo, incisivos
3️⃣ Repite 4 veces → *20 apretadas en la mañana y 20 en la noche*

💡 Los ejercicios mejoran el asentamiento del alineador.

🏆 *Tus puntos:* ${puntos} pts · Nivel ${nivel.emoji} ${nivel.nombre}
Si tu ortodoncista confirma que hiciste el cambio en fecha, ¡sumas *+50 puntos* más! 🎯

Consulta tus recompensas en: *https://portal-ortodoncia-production.up.railway.app* 🦷`;
  const r = await enviarWhatsApp(p.telefono, msg);
  res.json(r);
});

// Seguimiento post-cita (con delay de 24 horas)
app.post('/api/admin/whatsapp/seguimiento', adminAuth, async (req, res) => {
  const { paciente_id, tipo } = req.body;
  const db = readDB();
  const p = db.pacientes.find(x => x.id === paciente_id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  if (!p.telefono) return res.status(400).json({ error: 'Sin teléfono registrado' });
  const puntos = calcularPuntos(p);
  const nivel = calcularNivel(puntos);
  const msgs = {
    'post-inicio': `¡Hola ${p.nombre.split(' ')[0]}! 😊\n\n¿Cómo te has sentido con tu nuevo tratamiento de *${p.tratamiento}*? Es normal sentir algo de molestia los primeros días. 💪\n\n🏆 *¡Felicitaciones!* Ganaste *+100 puntos* por tu primera cita. Ya estás en nivel ${nivel.emoji} ${nivel.nombre}.\n\nRevisa tus puntos y recompensas en tu portal 👉 *https://portal-ortodoncia-production.up.railway.app*\n\n¡Estamos pendientes de tu proceso! 🦷`,
    'post-control': `¡Hola ${p.nombre.split(' ')[0]}! 😊\n\n¿Cómo amaneciste hoy después de tu cita de ayer? Esperamos que te hayas sentido bien. 🦷\n\n🏆 *Tus puntos:* ${puntos} pts · Nivel ${nivel.emoji} ${nivel.nombre}\n\nSi tienes molestias, tu asistente IA está disponible 24/7 👉 *https://portal-ortodoncia-production.up.railway.app*\n\n¡Vas excelente! ✨`,
  };
  const msg = msgs[tipo] || msgs['post-control'];
  const delayMs = tipo === 'post-control' ? 24 * 60 * 60 * 1000 : tipo === 'post-inicio' ? 48 * 60 * 60 * 1000 : 0;
  if (delayMs > 0) {
    setTimeout(async () => { await enviarWhatsApp(p.telefono, msg); }, delayMs);
    res.json({ ok: true, programado: true, enviara_en: tipo === 'post-inicio' ? '48 horas' : '24 horas' });
  } else {
    const r = await enviarWhatsApp(p.telefono, msg);
    res.json(r);
  }
});

// Mensaje automático al registrar un pago
// Email de confirmación de pago
app.post('/api/admin/email/confirmacion-pago', adminAuth, async (req, res) => {
  const { paciente_id, monto, descripcion } = req.body;
  const db = readDB();
  const p = db.pacientes.find(x => x.id === paciente_id);
  if (!p || !p.email) return res.json({ ok: false, motivo: 'sin_email' });
  const html = emailTemplate('Pago recibido ✅', `
    <p style="color:#9ca3af;font-size:14px;margin:0 0 16px;">Hola <strong style="color:#f0f6fc;">${p.nombre.split(' ')[0]}</strong>, registramos tu pago exitosamente.</p>
    <div style="background:#0d1117;border-radius:8px;padding:16px;margin:16px 0;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="color:#6b7280;font-size:13px;">Concepto</span>
        <span style="color:#f0f6fc;font-size:13px;">${descripcion}</span>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="color:#6b7280;font-size:13px;">Valor</span>
        <span style="color:#00d28c;font-size:16px;font-weight:700;">${new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(monto)}</span>
      </div>
    </div>
    <p style="color:#9ca3af;font-size:13px;margin:0;">Consulta tu estado de cuenta completo en el portal.</p>`);
  const r = await enviarEmail(p.email, '✅ Pago recibido — Dr. Juan Camilo Correa', html);
  res.json(r);
});

app.post('/api/admin/whatsapp/confirmacion-pago', adminAuth, async (req, res) => {
  const { paciente_id, monto, descripcion } = req.body;
  const db = readDB();
  const p = db.pacientes.find(x => x.id === paciente_id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  if (!p.telefono) return res.json({ ok: false, motivo: 'sin_telefono' });

  const COP = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
  const esInicial = descripcion?.toLowerCase().includes('inicial');

  const puntos = calcularPuntos(p);
  const nivel = calcularNivel(puntos);
  const sigNivel = NIVELES.find(n => n.min > puntos);
  const puntosParaSig = sigNivel ? sigNivel.min - puntos : 0;
  const recompensaProx = RECOMPENSAS.find(r => r.puntos > puntos);

  const msg = esInicial
    ? `¡Hola ${p.nombre.split(' ')[0]}! ✅\n\nHemos confirmado tu pago de cuota inicial por *${COP(monto)}*.\n\n🦷 Tu tratamiento de *${p.tratamiento}* está oficialmente en marcha. ¡Bienvenido a este camino hacia tu mejor sonrisa!\n\n🏆 *¡Ya tienes ${puntos} puntos!* Estás en nivel ${nivel.emoji} ${nivel.nombre}.${sigNivel ? `\n📈 Te faltan *${puntosParaSig} pts* para llegar a nivel ${sigNivel.nombre}.` : ''}${recompensaProx ? `\n🎁 Tu próxima recompensa: *${recompensaProx.nombre}* (${recompensaProx.puntos} pts).` : ''}\n\nSigue acumulando puntos asistiendo a tus citas, manteniendo buena higiene y cumpliendo con tu tratamiento. 💪\n\n👉 Revisa tus puntos y recompensas en: *https://portal-ortodoncia-production.up.railway.app*`
    : `¡Hola ${p.nombre.split(' ')[0]}! ✅\n\nHemos confirmado tu pago de *${COP(monto)}* — ${descripcion || 'cuota mensual'}.\n\n💪 ¡Gracias por mantenerte al día con tu tratamiento! Eso hace la diferencia en tus resultados.\n\n🏆 *Tus puntos:* ${puntos} pts · Nivel ${nivel.emoji} ${nivel.nombre}${recompensaProx ? `\n🎁 Próxima recompensa: *${recompensaProx.nombre}* a ${recompensaProx.puntos} pts.` : ''}\n\n👉 Consulta tu cuenta y recompensas en: *https://portal-ortodoncia-production.up.railway.app*`;

  const r = await enviarWhatsApp(p.telefono, msg);
  res.json(r);
});

// Mensaje de inasistencia / cancelación
app.post('/api/admin/whatsapp/inasistencia', adminAuth, async (req, res) => {
  const { paciente_id, tipo } = req.body;
  const db = readDB();
  const p = db.pacientes.find(x => x.id === paciente_id);
  if (!p?.telefono) return res.json({ ok: false });

  const nombre = p.nombre.split(' ')[0];
  const msg = tipo === 'no_asistio'
    ? `¡Hola ${nombre}! 👋\n\nNotamos que hoy no pudiste asistir a tu cita. ¡No te preocupes, sabemos que a veces pasan imprevistos!\n\n⚠️ Recuerda que mantener tus citas es clave para el éxito de tu tratamiento y para cumplir los tiempos estimados.\n\n📅 Pronto te contactaremos para reagendar tu cita a la mayor brevedad posible.\n\n¡Estamos pendientes de ti! 🦷`
    : `¡Hola ${nombre}! 👋\n\nGracias por avisarnos con anticipación sobre tu cita de hoy. ¡Lo apreciamos mucho!\n\n📅 Pronto te contactaremos para buscar el mejor espacio y reagendar tu cita.\n\nRecuerda que la constancia en tus controles es fundamental para ver los resultados que esperas. 🦷✨`;

  const r = await enviarWhatsApp(p.telefono, msg);
  res.json(r);
});


app.post('/api/admin/whatsapp/confirmacion-cita', adminAuth, async (req, res) => {
  const { paciente_id, fecha, hora, tipo } = req.body;
  const db = readDB();
  const p = db.pacientes.find(x => x.id === paciente_id);
  if (!p?.telefono) return res.json({ ok: false });
  const fechaFmt = new Date(fecha + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  const puntos = calcularPuntos(p);
  const msg = `¡Hola ${p.nombre.split(' ')[0]}! 📅\n\nTu cita ha sido confirmada:\n\n📋 *${tipo}*\n📆 ${fechaFmt}\n🕐 ${hora}\n\n🏆 Recuerda que al asistir sumas *+100 puntos* para tu cuenta de recompensas. ${puntos > 0 ? `Ya llevas *${puntos} pts* acumulados.` : '¡Esta puede ser tu primera oportunidad de ganar puntos!'}\n\n¡Te esperamos! 🦷`;
  const r = await enviarWhatsApp(p.telefono, msg);
  res.json(r);
});


// ─── ELÁSTICOS ────────────────────────────────────────────────────────────────

// Obtener elástico activo del paciente (para portal)
app.get('/api/elastico', auth, (req, res) => {
  const db = readDB();
  const p = db.pacientes.find(x => x.id === req.user.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  res.json({ elastico: p.elastico_activo || null });
});

// Recordatorio WhatsApp de elásticos
app.post('/api/admin/whatsapp/recordatorio-elastico', adminAuth, async (req, res) => {
  const { paciente_id } = req.body;
  const db = readDB();
  const p = db.pacientes.find(x => x.id === paciente_id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  if (!p.telefono) return res.json({ ok: false, motivo: 'sin_telefono' });
  if (!p.elastico_activo) return res.json({ ok: false, motivo: 'sin_elastico' });

  const e = p.elastico_activo;
  const msg = `¡Hola ${p.nombre.split(' ')[0]}! 🦷\n\n⚡ *Recordatorio de elásticos*\n\nRecuerda usar tus elásticos hoy:\n📌 *${e}*\n\n✅ Úsalos las 22 horas del día\n✅ Solo retíralos para comer y cepillarte\n✅ Si se rompe uno, repónlo de inmediato\n\nRevisa el diagrama en tu portal 👉 *https://portal-ortodoncia-production.up.railway.app*\n\n¡Tu constancia hace la diferencia! 💪`;
  const r = await enviarWhatsApp(p.telefono, msg);
  res.json(r);
});

// Recordatorios masivos de elásticos (todos los pacientes con elástico activo)
app.post('/api/admin/whatsapp/recordatorios-elasticos', adminAuth, async (req, res) => {
  const db = readDB();
  const resultados = [];
  for (const p of db.pacientes) {
    if (!p.elastico_activo || !p.telefono) continue;
    const e = p.elastico_activo;
    const msg = `¡Hola ${p.nombre.split(' ')[0]}! 🦷\n\n⚡ *Recordatorio de elásticos*\n\nRecuerda usar tus elásticos hoy:\n📌 *${e}*\n\n✅ Úsalos las 22 horas del día\n✅ Solo retíralos para comer y cepillarte\n\n¡Tu constancia hace la diferencia! 💪`;
    const r = await enviarWhatsApp(p.telefono, msg);
    resultados.push({ paciente: p.nombre, elastico: e, ...r });
  }
  res.json({ ok: true, enviados: resultados.length, resultados });
});

// ─── SCHEDULER: recordatorio elásticos 8 días post-cita ─────────────────────
// Corre cada día a las 9am — revisa citas con elástico de hace exactamente 8 días
function verificarRecordatoriosElasticos() {
  const db = readDB();
  const hoy = new Date().toISOString().split('T')[0];
  for (const p of db.pacientes) {
    if (!p.telefono || !p.citas) continue;
    for (const c of p.citas) {
      if (!c.elastico || !c.fecha) continue;
      const fechaCita = new Date(c.fecha);
      const diasDiff = Math.floor((new Date(hoy) - fechaCita) / (1000*60*60*24));
      if (diasDiff === 8 && !c.recordatorio_elastico_enviado) {
        const e = c.elastico;
        const msg = `¡Hola ${p.nombre.split(' ')[0]}! 🦷

⚡ *Recordatorio de elásticos*

Han pasado 8 días desde tu última cita. Recuerda continuar usando tus elásticos:
📌 *${e}*

✅ Úsalos las 22 horas del día
✅ Solo retíralos para comer y cepillarte
✅ Si se rompe uno, repónlo de inmediato

¿Tienes dudas? Escríbenos 😊`;
        enviarWhatsApp(p.telefono, msg).then(() => {
          c.recordatorio_elastico_enviado = true;
          writeDB(db);
          console.log(`[ELASTICO] Recordatorio enviado a ${p.nombre}`);
        }).catch(err => console.error(`[ELASTICO] Error:`, err));
        break; // Solo un recordatorio por paciente por día
      }
    }
  }
}

// ─── SCHEDULER: recordatorios diarios ────────────────────────────────────────
function programarRecordatoriosDiarios() {
  const ahora = new Date();
  // Programar para las 8:00 AM del día siguiente
  const manana8am = new Date(ahora);
  manana8am.setDate(ahora.getDate() + 1);
  manana8am.setHours(8, 0, 0, 0);
  const msHasta8am = manana8am - ahora;

  setTimeout(async () => {
    await enviarRecordatorios();
    verificarRecordatoriosElasticos();
    verificarValoracionesPendientes();
    // Repetir cada 24 horas
    setInterval(() => {
      enviarRecordatorios();
      verificarRecordatoriosElasticos();
      verificarValoracionesPendientes();
    }, 24 * 60 * 60 * 1000);
  }, msHasta8am);

  console.log(`⏰ Recordatorios programados — próxima ejecución: ${manana8am.toLocaleString('es-CO')}`);
}

async function enviarRecordatorios() {
  const db = readDB();
  const hoy = new Date();
  const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
  const fmtFecha = d => d.toISOString().split('T')[0];

  for (const p of db.pacientes) {
    if (!p.telefono) continue;
    for (const c of (p.citas || [])) {
      if (c.estado === 'realizada') continue;

      // Recordatorio día anterior
      if (c.fecha === fmtFecha(manana)) {
        const msg = `¡Hola ${p.nombre.split(' ')[0]}! 🦷\n\n⏰ Recuerda que *mañana tienes cita*:\n📋 ${c.tipo}\n🕐 ${c.hora}\n\n¡Te esperamos! 😊`;
        await enviarWhatsApp(p.telefono, msg);
      }

      // Recordatorio mismo día
      if (c.fecha === fmtFecha(hoy)) {
        const msg = `¡Buenos días ${p.nombre.split(' ')[0]}! ☀️\n\n🦷 *Hoy es tu cita de ortodoncia*:\n📋 ${c.tipo}\n🕐 ${c.hora}\n\n¡Te esperamos hoy! Recuerda llegar puntual. 😊`;
        await enviarWhatsApp(p.telefono, msg);
      }
    }
  }
  console.log(`✅ Recordatorios enviados: ${new Date().toLocaleString('es-CO')}`);
}

programarRecordatoriosDiarios();

// ─── SCHEDULER: seguimiento valoraciones pendientes ──────────────────────────
async function verificarValoracionesPendientes() {
  try {
    const propuestas = readPropuestas();
    const ahora = new Date();

    for (const p of propuestas) {
      if (p.estado !== 'pendiente') continue;
      if (!p.telefono) continue;
      if (p.seguimiento_enviado) continue;

      const creada = new Date(p.creada);
      const diasTranscurridos = Math.floor((ahora - creada) / (1000 * 60 * 60 * 24));

      if (diasTranscurridos >= 3) {
        const nombre = p.nombre.split(' ')[0];
        const plan = (p.planes && p.planes[0]) ? p.planes[0] : { tratamiento: p.tratamiento };
        const link = `${process.env.BASE_URL || 'https://portal-ortodoncia-production.up.railway.app'}/propuesta/${p.token}`;

        const msg = `¡Hola ${nombre}! 😊

Hace unos días te compartí tu valoración de ortodoncia con el Dr. Juan Camilo Correa y quería saber si tienes alguna pregunta.

🦷 *${plan.tratamiento}*

Muchos pacientes me preguntan si duele, cuánto tiempo lleva o si realmente vale la pena. La respuesta es sí — una sonrisa bien alineada cambia la confianza completamente.

Puedes revisar tu propuesta aquí:
👉 ${link}

Si quieres hablar directamente conmigo, escríbeme. ¡Estoy disponible para resolver cualquier duda! 🙌

— Dr. Juan Camilo Correa`;

        await enviarWhatsApp(p.telefono, msg);

        // Marcar como enviado
        const idx = propuestas.indexOf(p);
        propuestas[idx].seguimiento_enviado = true;
        propuestas[idx].seguimiento_fecha = new Date().toISOString();
        writePropuestas(propuestas);

        console.log(`📲 Seguimiento enviado a ${p.nombre} (valoración ${p.token})`);
      }
    }
  } catch(e) {
    console.error('Error verificando valoraciones pendientes:', e.message);
  }
}


app.post('/api/admin/whatsapp/recordatorios-masivos', adminAuth, async (req, res) => {
  const db = readDB();
  const hoy = new Date();
  const resultados = [];
  for (const p of db.pacientes) {
    if (!p.cambio_alineador_dias || !p.telefono) continue;
    const inicio = new Date(p.inicio + 'T12:00:00');
    const diasDesdeInicio = Math.floor((hoy - inicio) / (1000 * 60 * 60 * 24));
    const diasEnCiclo = diasDesdeInicio % p.cambio_alineador_dias;
    if (diasEnCiclo === 0 && diasDesdeInicio > 0) {
      const r = await enviarWhatsApp(p.telefono, `¡Hola ${p.nombre.split(' ')[0]}! 🔄 Hoy es tu día de cambio de alineador. No olvides los ejercicios de apretamiento: 20 mañana + 20 noche con el mordedor. ¡Vas muy bien! 🦷`);
      resultados.push({ paciente: p.nombre, ...r });
    }
  }
  res.json({ ok: true, enviados: resultados.length, resultados });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('\n✅ Portal corriendo en http://localhost:' + PORT + '\n'));


// ═══════════════════════════════════════════════════════
// MÓDULO PROPUESTAS DE TRATAMIENTO
// ═══════════════════════════════════════════════════════

const PROPUESTAS_PATH = path.join(__dirname, 'data/propuestas.json');
function readPropuestas() {
  if (!fs.existsSync(PROPUESTAS_PATH)) return [];
  return JSON.parse(fs.readFileSync(PROPUESTAS_PATH, 'utf-8'));
}
function writePropuestas(data) { fs.writeFileSync(PROPUESTAS_PATH, JSON.stringify(data, null, 2)); }

// Crear propuesta
app.post('/api/admin/propuestas', adminAuth, upload.fields([
  { name: 'foto', maxCount: 1 },
  { name: 'stl', maxCount: 2 }
]), async (req, res) => {
  try {
    const { nombre, telefono, tratamiento, duracion, presupuesto_total, cuota_inicial, cuota_mensual, notas, planes: planesStr } = req.body;
    const planes = planesStr ? JSON.parse(planesStr) : [{
      id: 0, tratamiento, duracion: parseInt(duracion)||18,
      presupuesto_total: parseInt(presupuesto_total)||0,
      cuota_inicial: parseInt(cuota_inicial)||0,
      cuota_mensual: parseInt(cuota_mensual)||0,
      descripcion: ''
    }];
    const token = Math.random().toString(36).substr(2, 10) + Date.now().toString(36);
    const expira = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString(); // Sin expiración práctica

    let fotoBase64 = null;
    let stlBase64 = null;

    if (req.files?.foto?.[0]) {
      const f = req.files.foto[0];
      fotoBase64 = `data:${f.mimetype};base64,${f.buffer.toString('base64')}`;
    }
  if (req.files?.stl?.length > 0) {
      // Guardar todos los STL como array
      const stlFiles = req.files.stl;
      if (stlFiles.length === 1) {
        stlBase64 = `data:application/octet-stream;base64,${stlFiles[0].buffer.toString('base64')}`;
      } else {
        // Múltiples arcos - guardar como JSON array
        stlBase64 = JSON.stringify(stlFiles.map(s => `data:application/octet-stream;base64,${s.buffer.toString('base64')}`));
      }
    }

    const propuesta = {
      id: 'prop_' + Date.now(),
      token,
      expira,
      nombre,
      telefono: telefono || '',
      tratamiento: tratamiento || 'Ortodoncia con alineadores',
      duracion: parseInt(duracion) || 18,
      presupuesto_total: parseInt(presupuesto_total) || 0,
      cuota_inicial: parseInt(cuota_inicial) || 0,
      cuota_mensual: parseInt(cuota_mensual) || 0,
      notas: notas || '',
      planes,
      foto: fotoBase64,
      stl: stlBase64,
      simulacion: null,
      estado: 'pendiente',
      creada: new Date().toISOString()
    };

    const propuestas = readPropuestas();
    propuestas.push(propuesta);
    writePropuestas(propuestas);

    res.json({ ok: true, token, link: `/propuesta/${token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar propuestas
app.get('/api/admin/propuestas', adminAuth, (req, res) => {
  const propuestas = readPropuestas();
  res.json(propuestas.map(p => ({ ...p, foto: p.foto ? true : false, stl: p.stl ? true : false, simulacion: p.simulacion ? true : false })));
});

// Generar simulación IA con OpenAI
app.post('/api/admin/propuestas/:token/simular', adminAuth, async (req, res) => {
  try {
    const propuestas = readPropuestas();
    const idx = propuestas.findIndex(p => p.token === req.params.token);
    if (idx === -1) return res.status(404).json({ error: 'Propuesta no encontrada' });
    const propuesta = propuestas[idx];
    if (!propuesta.foto) return res.status(400).json({ error: 'Se necesita foto del paciente' });

    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return res.status(500).json({ error: 'No hay API key de OpenAI configurada' });

    // Extraer base64 puro
    const base64Data = propuesta.foto.split(',')[1];
    const mimeType = propuesta.foto.split(';')[0].split(':')[1];

    const instrucciones = req.body.instrucciones || propuesta.notas || '';

    // Usar GPT-4o image edit para modificar la foto real del paciente
    const prompt = `This is a real patient photo. Edit ONLY the teeth and smile area. Apply orthodontic treatment results: perfectly aligned teeth, correct crossbite fixed, closed spaces, symmetric smile line, white and clean teeth${instrucciones ? ', ' + instrucciones : ''}. Keep the patient's face, skin, lips and all other features EXACTLY the same. Only improve the teeth. Photorealistic dental result.`;

    // Convertir base64 a buffer para FormData
    const imgBuffer = Buffer.from(base64Data, 'base64');
    const { Readable } = require('stream');

    const FormData = require('form-data');
    const fd = new FormData();
    
    // Agregar imagen como archivo PNG
    fd.append('image', imgBuffer, { filename: 'patient.png', contentType: 'image/png' });
    fd.append('prompt', prompt);
    fd.append('model', 'gpt-image-1');
    fd.append('n', '1');
    fd.append('size', '1024x1024');

    const editResp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${OPENAI_KEY}`,
        ...fd.getHeaders()
      },
      body: fd
    });

    const editData = await editResp.json();
    if (editData.error) {
      // Fallback a DALL-E 3 si gpt-image-1 no está disponible
      const visionResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 300,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
            { type: 'text', text: 'Describe la persona: género, edad aproximada, color de piel, forma de cara, color de cabello. Luego describe los dientes: color, alineación, espacios, irregularidades.' }
          ]}]
        })
      });
      const visionData = await visionResp.json();
      const descripcion = visionData.choices?.[0]?.message?.content || '';
      const fallbackPrompt = `Professional dental photography, realistic portrait. ${descripcion}. After orthodontic treatment: perfectly aligned white teeth, fixed crossbite, symmetric smile, same person same face. Photorealistic.`;
      const dalleResp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'dall-e-3', prompt: fallbackPrompt, n: 1, size: '1024x1024', quality: 'hd', response_format: 'b64_json' })
      });
      const dalleData = await dalleResp.json();
      if (dalleData.error) return res.status(500).json({ error: dalleData.error.message });
      const simulacionB64 = `data:image/png;base64,${dalleData.data[0].b64_json}`;
      propuestas[idx].simulacion = simulacionB64;
      writePropuestas(propuestas);
      return res.json({ ok: true, simulacion: simulacionB64 });
    }

    const simulacionB64 = `data:image/png;base64,${editData.data[0].b64_json}`;
    propuestas[idx].simulacion = simulacionB64;
    writePropuestas(propuestas);

    res.json({ ok: true, simulacion: simulacionB64 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ver propuesta pública (con token, verifica expiración)
app.get('/api/propuesta/:token', (req, res) => {
  const propuestas = readPropuestas();
  const p = propuestas.find(pr => pr.token === req.params.token);
  if (!p) return res.status(404).json({ error: 'Propuesta no encontrada' });
  // Sin expiración
  // No enviar STL crudo en esta llamada, se pide aparte
  const { stl, ...data } = p;
  res.json({ ...data, tieneStl: !!stl });
});

// Obtener STL para visor
app.get('/api/propuesta/:token/stl', (req, res) => {
  const propuestas = readPropuestas();
  const p = propuestas.find(pr => pr.token === req.params.token);
  if (!p || new Date() > new Date(p.expira)) return res.status(404).json({ error: 'No disponible' });
  if (!p.stl) return res.status(404).json({ error: 'Sin modelo 3D' });
  res.json({ stl: p.stl });
});

// Paciente acepta propuesta → se convierte en paciente
app.post('/api/propuesta/:token/aceptar', async (req, res) => {
  try {
    const propuestas = readPropuestas();
    const idx = propuestas.findIndex(p => p.token === req.params.token);
    if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
    if (new Date() > new Date(propuestas[idx].expira)) return res.status(410).json({ error: 'Expirada' });

    const p = propuestas[idx];
    // Obtener plan seleccionado
    const planIdx = parseInt(req.body.planIdx) || 0;
    const plan = (p.planes && p.planes[planIdx]) ? p.planes[planIdx] : {
      tratamiento: p.tratamiento, duracion: p.duracion,
      presupuesto_total: p.presupuesto_total, cuota_inicial: p.cuota_inicial,
      cuota_mensual: p.cuota_mensual
    };
    const db = readDB();

    // Verificar que no exista ya
    if (db.pacientes.find(pac => pac.telefono === p.telefono && p.telefono)) {
      propuestas[idx].estado = 'aceptada';
      writePropuestas(propuestas);
      return res.json({ ok: true, mensaje: 'Ya registrado' });
    }

    // Crear paciente
    const hash = await bcrypt.hash(p.telefono.replace(/\D/g, '').slice(-4) || '1234', 10);
    const nuevoPaciente = {
      id: 'p' + Date.now(),
      nombre: p.nombre,
      email: '',
      password: hash,
      telefono: p.telefono,
      tratamiento: plan.tratamiento,
      inicio: new Date().toISOString().split('T')[0],
      duracion: plan.duracion,
      cambio_alineador_dias: null,
      presupuesto: {
        total: plan.presupuesto_total,
        notas: `Plan elegido: ${plan.tratamiento} | Cuota inicial: $${plan.cuota_inicial.toLocaleString()} | Cuota mensual: $${plan.cuota_mensual.toLocaleString()}`,
        abonos: []
      },
      citas: [],
      progreso: []
    };
    db.pacientes.push(nuevoPaciente);
    writeDB(db);

    propuestas[idx].estado = 'aceptada';
    propuestas[idx].paciente_id = nuevoPaciente.id;
    writePropuestas(propuestas);

    // Notificar por WhatsApp al admin
    const adminMsg = `🎉 *¡Nuevo paciente aceptó su propuesta!*\n\n👤 ${p.nombre}\n📱 ${p.telefono}\n🦷 ${p.tratamiento}\n💰 Presupuesto: $${p.presupuesto_total.toLocaleString()}\n\n¡Ya quedó registrado en el portal!`;
    const adminTel = process.env.ADMIN_WHATSAPP || '';
    if (adminTel) await enviarWhatsApp(adminTel, adminMsg);

    res.json({ ok: true, paciente_id: nuevoPaciente.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ruta HTML para propuesta pública
app.get('/propuesta/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/propuesta.html'));
});

