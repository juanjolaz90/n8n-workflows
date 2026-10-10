// Nodo Code "Validar datos del contacto" (Run Once for All Items).
// El modelo propone; este nodo decide. Nada llega al CRM sin pasar por aquí:
//  - solo se aceptan emails que aparecen literalmente en el correo (lista "candidatos"),
//  - la industria tiene que ser un valor permitido,
//  - los teléfonos se normalizan,
//  - si el remitente ya existe en el CRM, no se crea de nuevo.

// Valores permitidos de la propiedad "industry" en tu CRM.
const INDUSTRIAS = ['Alimentación', 'Educación', 'Minería', 'Hostelería', 'Oficinas', 'Industria', 'Salud', 'Otro'];
const DOMINIOS_GENERICOS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.es', 'live.com', 'icloud.com', 'hotmail.es', 'outlook.es', 'msn.com'];
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const limpiar = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const titulo = (v) => limpiar(v).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (a, sep, letra) => sep + letra.toUpperCase());

// Normalización pensada para Chile (+56). Adáptala al país de tus contactos.
const normalizarTelefono = (v) => {
  const bruto = limpiar(v);
  if (!bruto) return '';
  const digitos = bruto.replace(/\D/g, '');
  if (digitos.length < 8) return '';
  if (bruto.startsWith('+')) return '+' + digitos;
  if (digitos.length === 9 && digitos.startsWith('9')) return '+56' + digitos;
  if (digitos.length === 11 && digitos.startsWith('56')) return '+' + digitos;
  return bruto;
};
const industriaValida = (v) => (INDUSTRIAS.includes(limpiar(v)) ? limpiar(v) : '');
const sinVacios = (o) => { Object.keys(o).forEach((k) => { if (!o[k]) delete o[k]; }); return o; };

const salida = [];
$input.all().forEach((item, i) => {
  const r = item.json.output || {};
  const tipo = limpiar(r.tipo) || 'otro';
  if (tipo !== 'derivacion' && tipo !== 'solicitud_directa') return;

  const correo = $('Preparar correo').itemMatching(i).json;
  const busqueda = $('Buscar remitente en HubSpot').itemMatching(i).json || {};
  const remitenteCrm = ((busqueda.results || [])[0] || {}).properties || {};
  const remitenteExiste = Number(busqueda.total || 0) > 0;
  const dominioRemitente = correo.remitenteEmail.split('@')[1] || '';
  const derivadoPor = correo.remitenteNombre ? correo.remitenteNombre + ' <' + correo.remitenteEmail + '>' : correo.remitenteEmail;

  if (tipo === 'solicitud_directa') {
    if (remitenteExiste) return;
    const s = r.remitente || {};
    let nombre = titulo(s.nombre);
    let apellido = titulo(s.apellido);
    if (!nombre && correo.remitenteNombre && !correo.remitenteNombre.includes('@')) {
      const partes = titulo(correo.remitenteNombre).split(' ');
      nombre = partes.shift() || '';
      apellido = apellido || partes.join(' ');
    }
    const propiedades = sinVacios({
      email: correo.remitenteEmail,
      firstname: nombre,
      lastname: apellido,
      jobtitle: limpiar(s.cargo),
      company: limpiar(s.empresa),
      industry: industriaValida(s.industria),
      phone: normalizarTelefono(s.telefono)
    });
    propiedades.hs_analytics_source = 'DIRECT_TRAFFIC';
    salida.push({
      json: { tipo: tipo, propiedades: propiedades, derivadoPor: '', motivo: limpiar(r.motivo), asunto: correo.asunto, gmailId: correo.gmailId },
      pairedItem: { item: i }
    });
    return;
  }

  const vistos = [];
  for (const c of (Array.isArray(r.contactos) ? r.contactos : [])) {
    const email = limpiar(c.email).toLowerCase();
    if (!REGEX_EMAIL.test(email)) continue;
    if (!correo.candidatos.includes(email)) continue; // el modelo no puede inventar destinatarios
    if (vistos.includes(email)) continue;
    vistos.push(email);

    // Si la persona derivada es de la misma empresa que el remitente, hereda empresa e industria del CRM.
    const dominio = email.split('@')[1];
    const mismaEmpresa = dominio === dominioRemitente && !DOMINIOS_GENERICOS.includes(dominio);

    let industria = '';
    if (mismaEmpresa && INDUSTRIAS.includes(remitenteCrm.industry)) industria = remitenteCrm.industry;
    else industria = industriaValida(c.industria);

    let empresa = limpiar(c.empresa);
    if (mismaEmpresa && remitenteCrm.company) empresa = limpiar(remitenteCrm.company);

    const propiedades = sinVacios({
      email: email,
      firstname: titulo(c.nombre),
      lastname: titulo(c.apellido),
      jobtitle: limpiar(c.cargo),
      company: empresa,
      industry: industria,
      phone: normalizarTelefono(c.telefono)
    });
    propiedades.hs_analytics_source = 'REFERRALS';

    salida.push({
      json: { tipo: tipo, propiedades: propiedades, derivadoPor: derivadoPor, motivo: limpiar(r.motivo), asunto: correo.asunto, gmailId: correo.gmailId },
      pairedItem: { item: i }
    });
  }
});
return salida;
