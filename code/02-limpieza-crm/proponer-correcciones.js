// Nodo Code "Proponer correcciones" (Run Once for All Items).
// Recorre todos los contactos del CRM y escribe UNA FILA POR CAMBIO PROPUESTO. No modifica nada.
// Cada fila guarda el valor actual (para poder revertir), el valor propuesto y la regla aplicada.
//  - Cambios seguros (espacios, mayúsculas, formato de teléfono): aprobado = true.
//  - Cambios dudosos (separar nombre y apellido, erratas de dominio): revisar = true.
//  - Lo que el código no sabe arreglar se marca con regla "FLAG:…" y nunca se aplica solo.

const PORTAL = 'TU_PORTAL_ID'; // ID de tu portal de HubSpot, para el enlace directo a cada ficha
const LOTE = new Date().toISOString().slice(0, 10);
const NBSP = String.fromCharCode(160);
const out = [];
const contacts = [];
for (const it of $input.all()) {
  const r = it.json.results || [];
  for (const c of r) contacts.push(c);
}

function clean(s) {
  if (s === null || s === undefined) return '';
  s = String(s).split(NBSP).join(' ');
  s = Array.from(s).filter(function (ch) { return ch.codePointAt(0) < 8192; }).join('');
  return s.split(' ').filter(Boolean).join(' ');
}
// Texto mal codificado (ej.: "JosÃ©" en vez de "José").
function fixMoji(s) {
  if (!s || !/[ÃÂ]/.test(s)) return s;
  try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
}
const PART = ['de', 'del', 'la', 'las', 'los', 'y', 'da', 'van', 'von', 'di', 'le'];
function properCase(s) {
  return s.split(' ').map(function (w, i) {
    const lw = w.toLocaleLowerCase('es');
    if (i > 0 && PART.indexOf(lw) >= 0) return lw;
    return lw.split('-').map(function (p) { return p.charAt(0).toLocaleUpperCase('es') + p.slice(1); }).join('-');
  }).join(' ');
}
function needsCase(s) {
  if (!s) return false;
  const hasLetters = s.toUpperCase() !== s.toLowerCase();
  if (!hasLetters) return false;
  if (s === s.toUpperCase() && s.replace(/[^A-Za-zÁÉÍÓÚÑÜ]/g, '').length > 1) return true;
  if (s === s.toLowerCase()) return true;
  return s.split(' ').some(function (w) { return w.length > 1 && (w === w.toLowerCase() && PART.indexOf(w) < 0); });
}
const TITLES = ['dr', 'dr.', 'dra', 'dra.', 'ing', 'ing.', 'sr', 'sr.', 'sra', 'sra.', 'srta', 'srta.', 'don', 'doña'];
function stripTitles(s) {
  let w = s.split(' ');
  while (w.length > 1 && TITLES.indexOf(w[0].toLowerCase()) >= 0) w = w.slice(1);
  s = w.join(' ');
  const low = s.toLowerCase();
  const p = low.indexOf(', phd');
  if (p > 0) s = s.slice(0, p);
  return s.split('(s)').join('').split('(S)').join('').trim();
}
const EMPRESA = ['spa', 'ltda', 'ltda.', 's.a', 's.a.', 'sa', 'limitada', 'eirl', 'e.i.r.l', 'comercial', 'inversiones', 'sociedad'];
function looksCompany(s) {
  return s.toLowerCase().split(' ').some(function (w) { return EMPRESA.indexOf(w) >= 0; });
}

function add(c, bloque, campo, actual, propuesto, regla, revisar) {
  const isFlag = regla.indexOf('FLAG:') === 0;
  out.push({ json: {
    contact_id: String(c.id),
    lead_status: (c.properties && c.properties.hs_lead_status) || '',
    bloque: bloque, campo: campo,
    valor_actual: actual === null || actual === undefined ? '' : String(actual),
    valor_propuesto: propuesto === null || propuesto === undefined ? '' : String(propuesto),
    regla: regla, revisar: !!revisar || isFlag,
    aprobado: !revisar && !isFlag, aplicado: false,
    url: 'https://app.hubspot.com/contacts/' + PORTAL + '/record/0-1/' + c.id,
    lote: LOTE
  } });
}

// Normalización a E.164 pensada para Chile (+56). Adáptala al país de tus contactos.
function normPhone(raw) {
  const s = String(raw).trim();
  const all = s.replace(/[^0-9]/g, '');
  if (!all || s.indexOf('*') >= 0 || all.length < 7 || new Set(all.split('')).size === 1) {
    return { v: '', r: 'telefono_basura', rev: false };
  }
  const lw = s.toLowerCase();
  let cut = -1;
  ['ext', 'anexo', 'anx', ' x '].forEach(function (k) { const i = lw.indexOf(k); if (i > 0 && (cut < 0 || i < cut)) cut = i; });
  const main = cut > 0 ? s.slice(0, cut) : s;
  let plus = main.trim().charAt(0) === '+';
  let d = main.replace(/[^0-9]/g, '');
  if (d.indexOf('00') === 0) { d = d.slice(2); plus = true; }
  if (plus && d.indexOf('56') !== 0) return { v: '+' + d, r: 'extranjero', rev: false, foreign: true };
  if (d.indexOf('56') === 0 && d.length === 11) d = d.slice(2);
  while (d.charAt(0) === '0') d = d.slice(1);
  let r = cut > 0 ? 'formato_quita_extension' : 'formato_e164';
  let rev = cut > 0;
  if (d.length === 9 && d.charAt(0) !== '1') {
    // móvil o fijo con el formato actual de 9 dígitos: ya es válido
  } else if (d.length === 8 && d.charAt(0) === '2') {
    d = '2' + d; r = 'fijo_santiago_antiguo'; rev = true;
  } else if (d.length === 8 && '56789'.indexOf(d.charAt(0)) >= 0) {
    d = '9' + d; r = 'movil_8_digitos'; rev = true;
  } else {
    return { v: s, r: 'FLAG:telefono_no_reconocido', rev: true };
  }
  return { v: '+56' + d, r: r, rev: rev };
}

const PLACEHOLDER = ['x', 'xx', 'xxx', '-', '--', '.', 'na', 'n/a', 'no', 'ninguna', 'ninguno', 'particular', 'hogar', 'domicilio', 'casa', 'su empresa', 'empresa', 'mi empresa', 'test', 'prueba', 'independiente', 'personal', 'none', 'sin empresa'];
const TYPO = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'yahooo.com': 'yahoo.com', 'outlok.com': 'outlook.com' };
const GENERIC = ['info', 'contacto', 'ventas', 'admin', 'administracion', 'recepcion', 'secretaria', 'gerencia', 'contact', 'hola', 'compras', 'rrhh', 'oficina', 'consultas', 'comercial'];

const stats = { contactos: contacts.length };

for (const c of contacts) {
  const p = c.properties || {};
  const fn0 = p.firstname || '';
  const ln0 = p.lastname || '';
  let fn = stripTitles(fixMoji(clean(fn0)));
  let ln = stripTitles(fixMoji(clean(ln0)));
  let nameRegla = [];
  let nameRev = false;
  if (fixMoji(fn0) !== fn0 || fixMoji(ln0) !== ln0) nameRegla.push('codificacion');

  const fnHasParen = fn.indexOf('(') >= 0;
  const lnHasParen = ln.indexOf('(') >= 0;
  if (fnHasParen) { fn = fn.slice(0, fn.indexOf('(')).trim(); nameRegla.push('quita_parentesis'); nameRev = true; }
  if (lnHasParen) { ln = ln.slice(0, ln.indexOf('(')).trim(); nameRegla.push('quita_parentesis'); nameRev = true; }

  const isEmailName = fn.indexOf('@') >= 0 || ln.indexOf('@') >= 0;
  const hasDigits = /[0-9]/.test(fn + ln);
  const isCompany = looksCompany(fn + ' ' + ln);

  if (!isEmailName && !hasDigits && !isCompany) {
    const fw = fn.split(' ').filter(Boolean);
    if (ln) {
      // "Ana Pérez" en nombre y "Pérez Soto" en apellido → quita el apellido repetido del nombre.
      const lw0 = ln.split(' ')[0].toLowerCase();
      const idx = fw.findIndex(function (w, i) { return i > 0 && w.toLowerCase() === lw0; });
      if (idx > 0) {
        const lnRest = ln.split(' ').slice(1).join(' ');
        const newLast = fw.slice(idx).join(' ');
        ln = lnRest && newLast.toLowerCase().indexOf(lnRest.toLowerCase()) < 0 ? newLast + ' ' + lnRest : newLast;
        fn = fw.slice(0, idx).join(' ');
        nameRegla.push('apellido_duplicado');
      }
    } else if (fw.length >= 2) {
      // Nombre completo en el campo nombre y apellido vacío: se separa, pero queda para revisar.
      const nFirst = fw.length >= 4 ? 2 : 1;
      ln = fw.slice(nFirst).join(' ');
      fn = fw.slice(0, nFirst).join(' ');
      nameRegla.push('separa_nombre_apellido');
      nameRev = true;
    }
    if (needsCase(fn)) { fn = properCase(fn); nameRegla.push('mayusculas'); }
    if (needsCase(ln)) { ln = properCase(ln); nameRegla.push('mayusculas'); }
  }

  if (fn0 !== fn || ln0 !== ln) {
    const regla = nameRegla.length ? Array.from(new Set(nameRegla)).join('+') : 'espacios';
    if (fn0 !== fn) add(c, 'nombre', 'firstname', fn0, fn, regla, nameRev);
    if (ln0 !== ln) add(c, 'nombre', 'lastname', ln0, ln, regla, nameRev);
  }
  if (!fn0 && !ln0) add(c, 'nombre', 'firstname', '', '', 'FLAG:sin_nombre', true);
  if (isEmailName) add(c, 'nombre', 'firstname', fn0, fn0, 'FLAG:nombre_es_email', true);
  else if (hasDigits) add(c, 'nombre', 'firstname', fn0 + ' | ' + ln0, '', 'FLAG:nombre_con_numeros', true);
  else if (isCompany) add(c, 'nombre', 'firstname', fn0 + ' | ' + ln0, '', 'FLAG:nombre_parece_empresa', true);
  const full = (fn0 + ' ' + ln0 + ' ' + (p.email || '')).toLowerCase();
  if (full.indexOf('test') >= 0 || full.indexOf('prueba') >= 0) add(c, 'otros', 'registro', fn0 + ' ' + ln0, '', 'FLAG:contacto_de_prueba', true);

  const em = (p.email || '').trim();
  if (em) {
    const parts = em.split('@');
    const nonAscii = Array.from(em).some(function (ch) { return ch.charCodeAt(0) > 127; });
    if (parts.length !== 2 || parts[1].indexOf('.') < 0 || em.indexOf(' ') >= 0 || nonAscii) {
      add(c, 'email', 'email', em, em, 'FLAG:email_formato_invalido', true);
    } else {
      const dom = parts[1].toLowerCase();
      if (TYPO[dom]) add(c, 'email', 'email', em, parts[0] + '@' + TYPO[dom], 'errata_dominio', true);
      if (GENERIC.indexOf(parts[0].toLowerCase()) >= 0) add(c, 'email', 'email', em, em, 'FLAG:email_generico', true);
    }
  }
  if (p.hs_email_hard_bounce_reason_enum) add(c, 'email_rebote', 'email', em, em, 'FLAG:rebote_' + p.hs_email_hard_bounce_reason_enum, true);

  let phoneNew = p.phone || '';
  let mobNew = p.mobilephone || '';
  if (p.phone) {
    const n = normPhone(p.phone);
    if (n.r.indexOf('FLAG:') === 0) add(c, 'telefono', 'phone', p.phone, p.phone, n.r, true);
    else { phoneNew = n.v; if (n.v !== p.phone) add(c, 'telefono', 'phone', p.phone, n.v, n.r, n.rev); }
  }
  if (p.mobilephone) {
    const n = normPhone(p.mobilephone);
    if (n.r.indexOf('FLAG:') === 0) add(c, 'telefono', 'mobilephone', p.mobilephone, p.mobilephone, n.r, true);
    else {
      mobNew = n.v;
      // Un fijo guardado en el campo de móvil se mueve al campo de teléfono.
      const isLandline = n.v.indexOf('+56') === 0 && n.v.indexOf('+569') !== 0;
      if (isLandline && !phoneNew) {
        add(c, 'telefono', 'phone', p.phone || '', n.v, 'fijo_movido_desde_movil', false);
        add(c, 'telefono', 'mobilephone', p.mobilephone, '', 'fijo_movido_a_phone', false);
        phoneNew = n.v; mobNew = '';
      } else if (isLandline && phoneNew === n.v) {
        add(c, 'telefono', 'mobilephone', p.mobilephone, '', 'fijo_duplicado_en_movil', false);
        mobNew = '';
      } else if (n.v !== p.mobilephone) {
        add(c, 'telefono', 'mobilephone', p.mobilephone, n.v, n.r, n.rev);
      }
    }
  }

  const co0 = p.company || '';
  if (co0) {
    let co = fixMoji(clean(co0));
    const low = co.toLowerCase();
    if (PLACEHOLDER.indexOf(low) >= 0 || /^[0-9 .-]+$/.test(co)) {
      add(c, 'empresa', 'company', co0, '', 'empresa_placeholder', false);
    } else {
      if (co !== co0) add(c, 'empresa', 'company', co0, co, 'codificacion_o_espacios', false);
      if (co.indexOf(' ') < 0 && /[.](cl|com|net|org|io|co)$/i.test(co)) add(c, 'empresa', 'company', co0, co0, 'FLAG:empresa_es_dominio', true);
    }
  }

  // Si el teléfono es chileno y el país no lo dice, se propone "Chile".
  const cl = phoneNew.indexOf('+56') === 0 || mobNew.indexOf('+56') === 0;
  if (cl && p.country !== 'Chile') add(c, 'otros', 'country', p.country || '', 'Chile', p.country ? 'pais_corregido_por_telefono' : 'pais_desde_telefono', false);
}

if (out.length === 0) return [{ json: { contact_id: 'sin_cambios', bloque: 'resumen', regla: 'contactos=' + stats.contactos } }];
return out;
