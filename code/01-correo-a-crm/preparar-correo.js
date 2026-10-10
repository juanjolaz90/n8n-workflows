// Nodo Code "Preparar correo" (Run Once for All Items).
// Limpia cada correo antes de pasarlo al modelo: descarta remitentes internos y automáticos,
// corta el hilo citado y reúne los emails que aparecen de verdad en el mensaje.

// Dominios de tu propia empresa: los correos internos se ignoran.
const DOMINIOS_PROPIOS = ['tuempresa.com'];
const REMITENTES_IGNORADOS = /^(no-?reply|noreply|mailer-daemon|postmaster|notificaciones|notifications?|bounce|newsletter)/i;
const REGEX_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const esPropio = (email) => DOMINIOS_PROPIOS.some((d) => email.endsWith('@' + d));
const direcciones = (campo) => ((campo && campo.value) || [])
  .map((v) => ({ email: String(v.address || '').toLowerCase().trim(), nombre: String(v.name || '').trim() }))
  .filter((v) => v.email);
const formatear = (lista) => lista.map((v) => (v.nombre ? v.nombre + ' <' + v.email + '>' : v.email)).join(', ');

const salida = [];
$input.all().forEach((item, indice) => {
  const m = item.json;
  const remitente = direcciones(m.from)[0] || { email: '', nombre: '' };
  if (!remitente.email || esPropio(remitente.email) || REMITENTES_IGNORADOS.test(remitente.email)) return;

  const para = direcciones(m.to);
  const copia = direcciones(m.cc);

  let texto = String(m.text || '');
  if (!texto && m.html) texto = String(m.html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

  // Marcas habituales de "aquí empieza el hilo citado" en español e inglés.
  const cortes = [
    /^\s*\**(De|From|Enviado el|Sent)\s*:\**\s/im,
    /^\s*El .{5,200}escribi[oó]:/im,
    /^\s*On .{5,200}wrote:/im,
    /^-{2,}\s*(Original Message|Mensaje original)/im,
    /^_{8,}/m
  ];
  let fin = texto.length;
  for (const r of cortes) {
    const pos = texto.search(r);
    if (pos > 0 && pos < fin) fin = pos;
  }
  const mensajeNuevo = texto.slice(0, fin).replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);

  // Solo se podrá crear en el CRM a personas cuyo email esté en esta lista.
  const candidatos = [];
  const anadir = (email) => {
    if (email && !esPropio(email) && email !== remitente.email && !candidatos.includes(email)) candidatos.push(email);
  };
  para.concat(copia).forEach((v) => anadir(v.email));
  (mensajeNuevo.match(REGEX_EMAIL) || []).forEach((e) => anadir(e.toLowerCase()));
  const esRespuesta = /^\s*(re|rv|fw|fwd|reenv)\s*:/i.test(String(m.subject || '')) || fin < texto.length;

  const textoParaIA = [
    'Remitente: ' + formatear([remitente]),
    'Para: ' + formatear(para),
    'CC: ' + (formatear(copia) || '(nadie)'),
    'Asunto: ' + (m.subject || ''),
    'Fecha: ' + (m.date || ''),
    'Es respuesta a un hilo previo: ' + (esRespuesta ? 'sí' : 'no'),
    '',
    'Mensaje nuevo (sin el hilo citado):',
    mensajeNuevo || '(vacío)'
  ].join('\n');

  salida.push({
    json: {
      gmailId: m.id || '',
      threadId: m.threadId || '',
      asunto: m.subject || '',
      fecha: m.date || '',
      remitenteEmail: remitente.email,
      remitenteNombre: remitente.nombre,
      candidatos: candidatos,
      esRespuesta: esRespuesta,
      mensajeNuevo: mensajeNuevo,
      textoParaIA: textoParaIA
    },
    pairedItem: { item: indice }
  });
});
return salida;
